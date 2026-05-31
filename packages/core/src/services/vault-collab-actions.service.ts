import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveVaultCollabCliPath, VAULT_COLLAB_REPOSITORY_URL } from './vault-collab-runtime.service.js';
import type {
  VaultCollabActionResult,
  VaultCollabActionInvocation,
  VaultCollabDashboardActionInput,
  VaultCollabDashboardActor,
  VaultCollabHandoffActionSet,
  VaultCollabRuntimeConfig,
} from '../types/vault-collab.js';

const TOKEN_OPTION = '--session-token';
const ACTOR_TOKEN_OPTION = '--actor-session-token';
const execFileAsync = promisify(execFile);

export interface VaultCollabActionRunnerResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type VaultCollabActionRunner = (
  invocation: VaultCollabActionInvocation,
) => Promise<VaultCollabActionRunnerResult>;

export interface VaultCollabDashboardSessionInput {
  project: string;
  workspacePath: string;
}

export interface VaultCollabDashboardSessionRegistrationResult {
  actor: VaultCollabDashboardActor;
  publicResult: {
    ok: boolean;
    invocation: VaultCollabActionInvocation;
    sessionUid: string | null;
    error: string | null;
  };
}

export function buildVaultCollabActionInvocation(
  config: VaultCollabRuntimeConfig,
  actor: VaultCollabDashboardActor,
  input: VaultCollabDashboardActionInput,
): VaultCollabActionInvocation {
  const base = buildBaseInvocation(config);
  const args = [
    ...base.args,
    ...buildActionArgs(config.databasePath, actor, input),
  ];

  return {
    command: base.command,
    args,
  };
}

export function redactVaultCollabActionInvocation(
  invocation: VaultCollabActionInvocation,
): VaultCollabActionInvocation {
  const args = invocation.args.map((arg, index) => (
    index > 0 && (invocation.args[index - 1] === TOKEN_OPTION || invocation.args[index - 1] === ACTOR_TOKEN_OPTION)
      ? '[redacted]'
      : arg
  ));

  return {
    command: invocation.command,
    args,
  };
}

export function buildVaultCollabDashboardSessionInvocation(
  config: VaultCollabRuntimeConfig,
  input: VaultCollabDashboardSessionInput,
): VaultCollabActionInvocation {
  const base = buildBaseInvocation(config);
  return {
    command: base.command,
    args: [
      ...base.args,
      'register',
      '--db',
      config.databasePath,
      '--display-name',
      'The Vault dashboard',
      '--client-type',
      'other',
      '--project',
      input.project,
      '--workspace-path',
      input.workspacePath,
      '--capability',
      'dashboardActions=true',
      '--capability',
      'launchApproval=true',
      '--capability',
      'launchBroker=true',
      '--capability',
      'sessionAdmin=true',
    ],
  };
}

export async function executeVaultCollabDashboardSessionRegistration(
  config: VaultCollabRuntimeConfig,
  input: VaultCollabDashboardSessionInput,
  runner: VaultCollabActionRunner = runVaultCollabActionInvocation,
): Promise<VaultCollabDashboardSessionRegistrationResult> {
  const invocation = buildVaultCollabDashboardSessionInvocation(config, input);
  const redactedInvocation = redactVaultCollabActionInvocation(invocation);
  const result = await runner(invocation);

  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `Vault Collab dashboard session registration failed with exit code ${result.exitCode}.`);
  }

  const parsed = parseActionOutput(result.stdout);
  const record = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  const sessionUid = typeof record.sessionUid === 'string' ? record.sessionUid : null;
  const sessionToken = typeof record.sessionToken === 'string' ? record.sessionToken : null;

  if (!sessionUid || !sessionToken) {
    throw new Error('Vault Collab dashboard session registration did not return a session owner token.');
  }

  return {
    actor: {
      sessionUid,
      sessionToken,
    },
    publicResult: {
      ok: true,
      invocation: redactedInvocation,
      sessionUid,
      error: null,
    },
  };
}

export async function executeVaultCollabAction(
  config: VaultCollabRuntimeConfig,
  actor: VaultCollabDashboardActor,
  input: VaultCollabDashboardActionInput,
  runner: VaultCollabActionRunner = runVaultCollabActionInvocation,
): Promise<VaultCollabActionResult> {
  const invocation = buildVaultCollabActionInvocation(config, actor, input);
  const redactedInvocation = redactVaultCollabActionInvocation(invocation);

  try {
    const result = await runner(invocation);
    if (result.exitCode !== 0) {
      return {
        ok: false,
        invocation: redactedInvocation,
        data: null,
        error: result.stderr.trim() || `Vault Collab action failed with exit code ${result.exitCode}.`,
      };
    }

    return {
      ok: true,
      invocation: redactedInvocation,
      data: parseActionOutput(result.stdout),
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      invocation: redactedInvocation,
      data: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildVaultCollabHandoffActionsInvocation(
  config: VaultCollabRuntimeConfig,
  actor: VaultCollabDashboardActor,
  handoffUid: string,
): VaultCollabActionInvocation {
  const base = buildBaseInvocation(config);
  return {
    command: base.command,
    args: [
      ...base.args,
      'handoff-actions',
      '--db',
      config.databasePath,
      '--handoff-uid',
      handoffUid,
      '--session-uid',
      actor.sessionUid,
      TOKEN_OPTION,
      actor.sessionToken,
    ],
  };
}

export async function executeVaultCollabHandoffActions(
  config: VaultCollabRuntimeConfig,
  actor: VaultCollabDashboardActor,
  handoffUid: string,
  runner: VaultCollabActionRunner = runVaultCollabActionInvocation,
): Promise<{
  ok: boolean;
  invocation: VaultCollabActionInvocation;
  data: VaultCollabHandoffActionSet | null;
  error: string | null;
}> {
  const invocation = buildVaultCollabHandoffActionsInvocation(config, actor, handoffUid);
  const redactedInvocation = redactVaultCollabActionInvocation(invocation);

  try {
    const result = await runner(invocation);
    if (result.exitCode !== 0) {
      return {
        ok: false,
        invocation: redactedInvocation,
        data: null,
        error: result.stderr.trim() || `Vault Collab handoff actions failed with exit code ${result.exitCode}.`,
      };
    }

    return {
      ok: true,
      invocation: redactedInvocation,
      data: parseActionOutput(result.stdout) as VaultCollabHandoffActionSet,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      invocation: redactedInvocation,
      data: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runVaultCollabActionInvocation(
  invocation: VaultCollabActionInvocation,
): Promise<VaultCollabActionRunnerResult> {
  try {
    const { stdout, stderr } = await execFileAsync(invocation.command, invocation.args, {
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 5,
    });

    return {
      exitCode: 0,
      stdout,
      stderr,
    };
  } catch (error) {
    const maybeError = error as NodeJS.ErrnoException & {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };

    return {
      exitCode: typeof maybeError.code === 'number' ? maybeError.code : 1,
      stdout: maybeError.stdout ?? '',
      stderr: maybeError.stderr ?? maybeError.message,
    };
  }
}

function parseActionOutput(stdout: string): unknown | null {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }

  return JSON.parse(trimmed) as unknown;
}

function buildBaseInvocation(config: VaultCollabRuntimeConfig): VaultCollabActionInvocation {
  if (config.runtimeMode === 'managed') {
    return {
      command: 'npm',
      args: ['exec', '--yes', '--package', VAULT_COLLAB_REPOSITORY_URL, '--', 'vault-collab'],
    };
  }

  const cliPath = resolveVaultCollabCliPath(config);
  if (!cliPath) {
    throw new Error('Vault Collab CLI path is not configured.');
  }

  return {
    command: 'node',
    args: [cliPath],
  };
}

function buildActionArgs(
  databasePath: string,
  actor: VaultCollabDashboardActor,
  input: VaultCollabDashboardActionInput,
): string[] {
  if (input.kind === 'handoff') {
    return buildHandoffActionArgs(databasePath, actor, input);
  }

  if (input.kind === 'discussion') {
    if (input.action === 'create_thread') {
      return [
        'discussion-create',
        '--db',
        databasePath,
        '--project',
        input.project,
        '--handoff-uid',
        input.handoffUid,
        '--title',
        input.title,
        '--session-uid',
        actor.sessionUid,
        TOKEN_OPTION,
        actor.sessionToken,
      ];
    }

    return [
      'discussion-add-message',
      '--db',
      databasePath,
      '--thread-uid',
      input.threadUid,
      '--session-uid',
      actor.sessionUid,
      TOKEN_OPTION,
      actor.sessionToken,
      '--type',
      input.messageType ?? 'note',
      '--body',
      input.body,
    ];
  }

  if (input.kind === 'session') {
    return buildSessionActionArgs(databasePath, actor, input);
  }

  return buildLaunchActionArgs(databasePath, actor, input);
}

function buildSessionActionArgs(
  databasePath: string,
  actor: VaultCollabDashboardActor,
  input: Extract<VaultCollabDashboardActionInput, { kind: 'session' }>,
): string[] {
  switch (input.action) {
    case 'rename':
      return [
        'session-rename',
        '--db',
        databasePath,
        '--session-uid',
        input.sessionUid,
        TOKEN_OPTION,
        actor.sessionToken,
        '--display-name',
        requiredValue(input.displayName, 'Session display name'),
      ];
    case 'close':
      return [
        'session-close',
        '--db',
        databasePath,
        '--target-session-uid',
        input.targetSessionUid,
        '--actor-session-uid',
        actor.sessionUid,
        ACTOR_TOKEN_OPTION,
        actor.sessionToken,
        ...(input.reason ? ['--reason', input.reason] : []),
      ];
    case 'ping':
      return [
        'ping-session',
        '--db',
        databasePath,
        '--target-session-uid',
        input.targetSessionUid,
        '--actor-session-uid',
        actor.sessionUid,
        ...(input.message ? ['--message', input.message] : []),
      ];
  }
}

function buildHandoffActionArgs(
  databasePath: string,
  actor: VaultCollabDashboardActor,
  input: Extract<VaultCollabDashboardActionInput, { kind: 'handoff' }>,
): string[] {
  const ownerArgs = [
    '--handoff-uid',
    input.handoffUid,
    '--session-uid',
    actor.sessionUid,
    TOKEN_OPTION,
    actor.sessionToken,
  ];

  switch (input.action) {
    case 'claim':
      return ['claim', '--db', databasePath, ...ownerArgs];
    case 'release':
      return ['release', '--db', databasePath, ...ownerArgs];
    case 'update':
      return [
        'update',
        '--db',
        databasePath,
        ...ownerArgs,
        '--status',
        requiredValue(input.status, 'Handoff update status'),
        '--progress-note',
        requiredValue(input.progressNote, 'Handoff progress note'),
      ];
    case 'request_user_confirmation':
      return [
        'user-confirmation-request',
        '--db',
        databasePath,
        ...ownerArgs,
        '--question',
        requiredValue(input.question, 'User confirmation question'),
      ];
    case 'request_handoff_permission':
      return [
        'handoff-permission-request',
        '--db',
        databasePath,
        ...ownerArgs,
        '--question',
        requiredValue(input.question, 'Handoff permission question'),
      ];
    case 'resolve':
      return [
        'resolve',
        '--db',
        databasePath,
        ...ownerArgs,
        '--summary',
        requiredValue(input.summary, 'Handoff resolution summary'),
      ];
    case 'recover':
      return [
        'recover',
        '--db',
        databasePath,
        '--handoff-uid',
        input.handoffUid,
        '--actor-session-uid',
        actor.sessionUid,
        ACTOR_TOKEN_OPTION,
        actor.sessionToken,
        '--reason',
        requiredValue(input.reason, 'Handoff recovery reason'),
        '--summary',
        requiredValue(input.summary, 'Handoff recovery summary'),
        '--evidence-vault-memory-uid',
        requiredValue(input.evidenceVaultMemoryUid, 'Recovery evidence Vault memory UID'),
      ];
    case 'reopen':
      return [
        'reopen',
        '--db',
        databasePath,
        '--handoff-uid',
        input.handoffUid,
        '--reason',
        requiredValue(input.reason, 'Handoff reopen reason'),
      ];
  }
}

function buildLaunchActionArgs(
  databasePath: string,
  actor: VaultCollabDashboardActor,
  input: Extract<VaultCollabDashboardActionInput, { kind: 'launch' }>,
): string[] {
  const ownerArgs = [
    '--launch-request-uid',
    input.launchRequestUid,
    '--session-uid',
    actor.sessionUid,
    TOKEN_OPTION,
    actor.sessionToken,
  ];

  switch (input.action) {
    case 'approve':
      return [
        'launch-approve',
        '--db',
        databasePath,
        ...ownerArgs,
        ...(input.detail ? ['--detail', input.detail] : []),
      ];
    case 'reject':
      return [
        'launch-reject',
        '--db',
        databasePath,
        ...ownerArgs,
        '--reason',
        requiredValue(input.reason, 'Launch rejection reason'),
      ];
    case 'cancel':
      return [
        'launch-cancel',
        '--db',
        databasePath,
        ...ownerArgs,
        '--reason',
        requiredValue(input.reason, 'Launch cancellation reason'),
      ];
    case 'mark_launching':
      return [
        'launch-mark-launching',
        '--db',
        databasePath,
        ...ownerArgs,
        ...(input.detail ? ['--detail', input.detail] : []),
      ];
    case 'mark_running':
      return [
        'launch-mark-running',
        '--db',
        databasePath,
        ...ownerArgs,
        '--launched-session-uid',
        requiredValue(input.launchedSessionUid, 'Launched session UID'),
        ...(input.detail ? ['--detail', input.detail] : []),
      ];
    case 'stop':
      // Clean terminal transition for a managed worker that ended without error.
      // Distinct from `fail` (which is for spawn errors / non-zero exits).
      return [
        'launch-stop',
        '--db',
        databasePath,
        ...ownerArgs,
        ...(input.detail ? ['--detail', input.detail] : []),
        ...(typeof input.exitCode === 'number' && Number.isFinite(input.exitCode) ? ['--exit-code', String(input.exitCode)] : []),
      ];
    case 'fail':
      return [
        'launch-fail',
        '--db',
        databasePath,
        ...ownerArgs,
        '--reason',
        requiredValue(input.reason, 'Launch failure reason'),
      ];
  }
}

function requiredValue(value: string | undefined, label: string): string {
  if (!value?.trim()) {
    throw new Error(`${label} is required.`);
  }

  return value;
}
