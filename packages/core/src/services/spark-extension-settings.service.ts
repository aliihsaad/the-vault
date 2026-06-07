import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  SPARK_BRAIN_ARTIFACT_NAMES,
  SPARK_EXTENSION_ACTION_TYPES,
  type SparkBrainArtifactName,
  type SparkBrainArtifactFreshnessSummary,
  type SparkExtensionAction,
  type SparkExtensionActionResult,
  type SparkExtensionActionType,
  type SparkExtensionSnapshot,
  type SparkExtensionStatus,
  type SparkProviderMode,
} from '../types/spark-extension.js';

type MaybePromise<T> = T | Promise<T>;

export const SPARK_BRAIN_REPOSITORY_URL = 'https://github.com/aliihsaad/vault-spark';
export const SPARK_BRAIN_PACKAGE_PATH = 'packages/spark-brain';
export const SPARK_BRAIN_EXTENSION_FOLDER = 'spark-brain';

export interface SparkExtensionSettingsAdapter {
  getSnapshot?: () => MaybePromise<SparkExtensionSnapshot | null | undefined>;
  executeAction?: (action: SparkExtensionAction) => MaybePromise<SparkExtensionActionResult>;
}

export interface SparkExtensionSettingsServiceOptions {
  adapter?: SparkExtensionSettingsAdapter;
  now?: () => string;
  vaultRoot?: string;
}

export interface SparkBrainExtensionPaths {
  root: string;
  packageRoot: string;
}

export interface SparkBrainInstallPlan {
  ready: boolean;
  repositoryUrl: string;
  packagePath: string;
  extensionRoot: string;
  packageRoot: string;
  commands: string[];
  notes: string[];
}

interface ValidationFailure {
  ok: false;
  message: string;
}

type ValidationResult = SparkExtensionAction | ValidationFailure;

const actionTypes = new Set<string>(SPARK_EXTENSION_ACTION_TYPES);
const artifactNames = new Set<string>(SPARK_BRAIN_ARTIFACT_NAMES);
const providerModes = new Set<string>(['classic', 'realtime']);
const evolutionSuggestionTypes = new Set<string>([
  'new-skill',
  'new-pack',
  'workflow-improvement',
  'missing-api',
]);
const evolutionConfidenceLevels = new Set<string>(['low', 'medium', 'high']);
const SPARK_BRAIN_INSTALL_COMMAND = 'pnpm --filter @spark/brain install';
const sensitiveFieldNames = new Set([
  'apikey',
  'accesstoken',
  'refreshtoken',
  'bearertoken',
  'providersecret',
  'secret',
  'secrets',
  'password',
  'credential',
  'credentials',
  'credentialvalue',
  'privatekey',
  'sessiontoken',
  'ownertoken',
  'authorization',
  'authheader',
]);

export class SparkExtensionSettingsService {
  private readonly adapter: SparkExtensionSettingsAdapter;
  private readonly now: () => string;
  private readonly vaultRoot: string | null;

  constructor(options: SparkExtensionSettingsServiceOptions = {}) {
    this.adapter = options.adapter ?? {};
    this.now = options.now ?? (() => new Date().toISOString());
    this.vaultRoot = options.vaultRoot?.trim() ? resolve(options.vaultRoot) : null;
  }

  async getSnapshot(): Promise<SparkExtensionSnapshot> {
    const snapshot = await this.adapter.getSnapshot?.();
    return sanitizeSparkExtensionSnapshot(
      snapshot ?? getDefaultSparkExtensionSnapshot(this.now(), this.vaultRoot),
      this.vaultRoot,
    );
  }

  async executeAction(input: unknown): Promise<SparkExtensionActionResult> {
    const action = normalizeSparkExtensionAction(input);
    if (isValidationFailure(action)) {
      return {
        ok: false,
        actionType: getActionType(input),
        reason: 'validation_failed',
        message: action.message,
      };
    }

    if (this.adapter.executeAction) {
      try {
        return sanitizeSparkExtensionActionResult(await this.adapter.executeAction(action));
      } catch (error) {
        return {
          ok: false,
          actionType: action.type,
          reason: 'adapter_failed',
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }

    return {
      ok: false,
      actionType: action.type,
      reason: 'not_implemented',
      message: 'Spark extension settings actions are not wired to Spark Brain yet.',
      snapshot: await this.getSnapshot(),
    };
  }
}

export function getSparkBrainExtensionPaths(vaultRoot: string): SparkBrainExtensionPaths {
  const root = resolve(vaultRoot, 'extensions', SPARK_BRAIN_EXTENSION_FOLDER);
  return {
    root,
    packageRoot: join(root, ...SPARK_BRAIN_PACKAGE_PATH.split('/')),
  };
}

export function planSparkBrainInstall(vaultRoot: string): SparkBrainInstallPlan {
  const paths = getSparkBrainExtensionPaths(vaultRoot);
  const ready = readSparkBrainPackageInfo(paths).available;

  return {
    ready,
    repositoryUrl: SPARK_BRAIN_REPOSITORY_URL,
    packagePath: SPARK_BRAIN_PACKAGE_PATH,
    extensionRoot: paths.root,
    packageRoot: paths.packageRoot,
    commands: [
      [
        `$extension = "${escapePowerShellDoubleQuotedString(paths.root)}"`,
        'New-Item -ItemType Directory -Force -Path (Split-Path $extension) | Out-Null',
        `if (!(Test-Path $extension)) { git clone ${SPARK_BRAIN_REPOSITORY_URL} $extension; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }`,
        `$package = Join-Path $extension "${SPARK_BRAIN_PACKAGE_PATH}"`,
        'if (!(Test-Path $package)) { throw "Spark Brain package path not found: $package" }',
        'pnpm --dir $package install',
      ].join('; '),
    ],
    notes: [
      `Managed install uses the public vault-spark GitHub source ${SPARK_BRAIN_REPOSITORY_URL}.`,
      `Spark Brain lives in ${SPARK_BRAIN_PACKAGE_PATH} within that repository.`,
      'Vault shows this command preview first and does not run it silently.',
    ],
  };
}

export function getDefaultSparkExtensionSnapshot(
  generatedAt = new Date().toISOString(),
  vaultRoot?: string | null,
): SparkExtensionSnapshot {
  return {
    schemaVersion: 1,
    generatedAt,
    status: getDefaultSparkExtensionStatus(vaultRoot),
    providerHealth: {
      activeProviderId: null,
      activeProviderMode: null,
      ready: 0,
      degraded: 0,
      unavailable: 0,
      unknown: 0,
      providers: [],
    },
    skillStatus: {
      total: 0,
      enabled: 0,
      disabled: 0,
      locked: 0,
      pendingApproval: 0,
    },
    skills: [],
    skillCatalog: [],
    pendingApprovals: [],
    capabilityPacks: [],
    evolutionSuggestions: [],
    packStatus: {
      total: 0,
      installed: 0,
      updateAvailable: 0,
    },
    approvals: {
      pending: 0,
      skillProposals: 0,
      evolutionSuggestions: 0,
    },
    brainArtifacts: getDefaultSparkBrainArtifactSummary(),
    ledgerSuggestions: {
      total: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      deferred: 0,
      superseded: 0,
    },
    counts: {
      skills: 0,
      enabledSkills: 0,
      installedPacks: 0,
      pendingApprovals: 0,
      brainArtifacts: 0,
      staleBrainArtifacts: 0,
      ledgerSuggestions: 0,
      pendingLedgerSuggestions: 0,
    },
  };
}

export function sanitizeSparkExtensionSnapshot(
  snapshot: SparkExtensionSnapshot,
  vaultRoot?: string | null,
): SparkExtensionSnapshot {
  const sanitized = stripSensitiveFields(snapshot) as SparkExtensionSnapshot;
  const rawStatus = isRecord(sanitized.status)
    ? sanitized.status as Partial<SparkExtensionStatus>
    : {};
  return {
    ...sanitized,
    status: normalizeSparkExtensionStatus(rawStatus, vaultRoot),
    skills: Array.isArray(sanitized.skills) ? sanitized.skills : [],
    skillCatalog: Array.isArray(sanitized.skillCatalog) ? sanitized.skillCatalog : [],
    pendingApprovals: Array.isArray(sanitized.pendingApprovals) ? sanitized.pendingApprovals : [],
    capabilityPacks: Array.isArray(sanitized.capabilityPacks) ? sanitized.capabilityPacks : [],
    evolutionSuggestions: normalizeSparkEvolutionSuggestions(sanitized.evolutionSuggestions),
    brainArtifacts: normalizeSparkBrainArtifacts(sanitized.brainArtifacts),
  };
}

function getDefaultSparkExtensionStatus(vaultRoot?: string | null): SparkExtensionStatus {
  if (vaultRoot) {
    const plan = planSparkBrainInstall(vaultRoot);
    const packageInfo = readSparkBrainPackageInfo(getSparkBrainExtensionPaths(vaultRoot));

    if (packageInfo.available) {
      return {
        installState: 'ready',
        enabled: true,
        source: 'managed',
        version: packageInfo.version,
        brainProject: 'Spark Brain',
        activeProviderId: null,
        activeProviderMode: null,
        message: `Spark Brain is installed at ${plan.packageRoot}.`,
        installCommands: [],
        issues: [],
      };
    }

    return {
      installState: 'installable',
      enabled: false,
      source: 'managed',
      version: null,
      brainProject: 'Spark Brain',
      activeProviderId: null,
      activeProviderMode: null,
      message: `Spark Brain is available through GitHub managed install from ${SPARK_BRAIN_REPOSITORY_URL}.`,
      installCommands: plan.commands,
      issues: [],
    };
  }

  return {
    installState: 'missing',
    enabled: false,
    source: 'not-installed',
    version: null,
    brainProject: null,
    activeProviderId: null,
    activeProviderMode: null,
    message: 'Spark Brain is not connected to The Vault settings yet.',
    installCommands: [SPARK_BRAIN_INSTALL_COMMAND],
    issues: [],
  };
}

function normalizeSparkExtensionStatus(
  status: Partial<SparkExtensionStatus>,
  vaultRoot?: string | null,
): SparkExtensionStatus {
  const defaults = getDefaultSparkExtensionStatus(vaultRoot);
  return {
    ...defaults,
    ...status,
    installCommands: normalizeSparkInstallCommands(status.installCommands, vaultRoot),
    issues: Array.isArray(status.issues)
      ? status.issues
        .filter((issue): issue is string => typeof issue === 'string')
        .map((issue) => issue.trim())
        .filter(Boolean)
      : [],
  };
}

function normalizeSparkInstallCommands(value: unknown, vaultRoot?: string | null): string[] {
  if (!Array.isArray(value)) {
    return vaultRoot ? planSparkBrainInstall(vaultRoot).commands : [SPARK_BRAIN_INSTALL_COMMAND];
  }

  return value
    .filter((command): command is string => typeof command === 'string')
    .map((command) => command.trim())
    .filter(Boolean);
}

function readSparkBrainPackageInfo(paths: SparkBrainExtensionPaths): {
  available: boolean;
  version: string | null;
} {
  const packageJsonPath = join(paths.packageRoot, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return {
      available: false,
      version: null,
    };
  }

  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>;
    return {
      available: parsed.name === '@spark/brain',
      version: typeof parsed.version === 'string' ? parsed.version : null,
    };
  } catch {
    return {
      available: false,
      version: null,
    };
  }
}

function escapePowerShellDoubleQuotedString(value: string): string {
  return value.replace(/`/g, '``').replace(/"/g, '`"').replace(/\$/g, '`$');
}

function getDefaultSparkBrainArtifactSummary(): SparkBrainArtifactFreshnessSummary {
  return {
    fresh: 0,
    stale: 0,
    missing: 0,
    latestGeneratedAt: null,
    artifacts: [],
  };
}

function normalizeSparkBrainArtifacts(value: unknown): SparkBrainArtifactFreshnessSummary {
  if (!isRecord(value)) {
    return getDefaultSparkBrainArtifactSummary();
  }

  return {
    fresh: typeof value.fresh === 'number' ? value.fresh : 0,
    stale: typeof value.stale === 'number' ? value.stale : 0,
    missing: typeof value.missing === 'number' ? value.missing : 0,
    latestGeneratedAt: typeof value.latestGeneratedAt === 'string' ? value.latestGeneratedAt : null,
    artifacts: Array.isArray(value.artifacts)
      ? value.artifacts.filter(isRecord).map((artifact) => ({
          ...artifact,
          generatedAt: typeof artifact.generatedAt === 'string' ? artifact.generatedAt : null,
          renderedAt: typeof artifact.renderedAt === 'string' ? artifact.renderedAt : null,
          contentHash: typeof artifact.contentHash === 'string' ? artifact.contentHash : null,
          markdownContent: typeof artifact.markdownContent === 'string' ? artifact.markdownContent : null,
          sourceProject: typeof artifact.sourceProject === 'string' ? artifact.sourceProject : null,
          staleReason: typeof artifact.staleReason === 'string' ? artifact.staleReason : null,
        })) as SparkBrainArtifactFreshnessSummary['artifacts']
      : [],
  };
}

function normalizeSparkEvolutionSuggestions(value: unknown): SparkExtensionSnapshot['evolutionSuggestions'] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isRecord)
    .map((suggestion) => {
      const suggestionId = typeof suggestion.suggestionId === 'string' ? suggestion.suggestionId.trim() : '';
      const description = typeof suggestion.description === 'string' ? suggestion.description.trim() : '';
      const type = typeof suggestion.type === 'string' && evolutionSuggestionTypes.has(suggestion.type)
        ? suggestion.type as SparkExtensionSnapshot['evolutionSuggestions'][number]['type']
        : null;
      const confidenceLevel = typeof suggestion.confidenceLevel === 'string'
        && evolutionConfidenceLevels.has(suggestion.confidenceLevel)
        ? suggestion.confidenceLevel as SparkExtensionSnapshot['evolutionSuggestions'][number]['confidenceLevel']
        : null;

      if (!suggestionId || !description || !type || !confidenceLevel) {
        return null;
      }

      return {
        suggestionId,
        type,
        description,
        confidenceLevel,
      };
    })
    .filter((suggestion): suggestion is SparkExtensionSnapshot['evolutionSuggestions'][number] => Boolean(suggestion));
}

function sanitizeSparkExtensionActionResult(result: SparkExtensionActionResult): SparkExtensionActionResult {
  return stripSensitiveFields(result) as SparkExtensionActionResult;
}

function normalizeSparkExtensionAction(input: unknown): ValidationResult {
  if (!isRecord(input)) {
    return invalidAction('Spark extension action must be an object.');
  }

  if (containsSensitiveField(input)) {
    return invalidAction('Spark extension action payloads cannot include provider credentials or session owner tokens.');
  }

  const type = typeof input.type === 'string' ? input.type : null;
  if (!type || !actionTypes.has(type)) {
    return invalidAction('Spark extension action type is not supported.');
  }

  switch (type) {
    case 'toggle-extension': {
      if (typeof input.enabled !== 'boolean') {
        return invalidAction('Spark toggle-extension action requires an enabled boolean.');
      }
      return {
        type,
        enabled: input.enabled,
        confirmationToken: optionalString(input.confirmationToken),
      };
    }
    case 'configure-provider': {
      const providerId = requiredString(input.providerId, 'providerId');
      if (isValidationFailure(providerId)) {
        return providerId;
      }
      const mode = optionalProviderMode(input.mode);
      if (isValidationFailure(mode)) {
        return mode;
      }
      return {
        type,
        providerId,
        enabled: optionalBoolean(input.enabled),
        makeActive: optionalBoolean(input.makeActive),
        mode,
        baseUrl: optionalNullableString(input.baseUrl),
        model: optionalNullableString(input.model),
        metadata: optionalMetadata(input.metadata),
        previewToken: optionalString(input.previewToken),
        confirmationToken: optionalString(input.confirmationToken),
      };
    }
    case 'toggle-skill': {
      const skillId = requiredString(input.skillId, 'skillId');
      if (isValidationFailure(skillId)) {
        return skillId;
      }
      if (typeof input.enabled !== 'boolean') {
        return invalidAction('Spark toggle-skill action requires an enabled boolean.');
      }
      return {
        type,
        skillId,
        enabled: input.enabled,
        confirmationToken: optionalString(input.confirmationToken),
      };
    }
    case 'install-pack':
    case 'uninstall-pack': {
      const packId = requiredString(input.packId, 'packId');
      if (isValidationFailure(packId)) {
        return packId;
      }
      return {
        type,
        packId,
        previewToken: optionalString(input.previewToken),
        confirmationToken: optionalString(input.confirmationToken),
      };
    }
    case 'approve-skill': {
      const proposalId = requiredString(input.proposalId, 'proposalId');
      if (isValidationFailure(proposalId)) {
        return proposalId;
      }
      return {
        type,
        proposalId,
        enableNow: optionalBoolean(input.enableNow),
        confirmationToken: optionalString(input.confirmationToken),
      };
    }
    case 'reject-skill': {
      const proposalId = requiredString(input.proposalId, 'proposalId');
      if (isValidationFailure(proposalId)) {
        return proposalId;
      }
      const reason = requiredString(input.reason, 'reason');
      if (isValidationFailure(reason)) {
        return reason;
      }
      return {
        type,
        proposalId,
        reason,
      };
    }
    case 'approve-suggestion': {
      const suggestionId = requiredString(input.suggestionId, 'suggestionId');
      if (isValidationFailure(suggestionId)) {
        return suggestionId;
      }
      return {
        type,
        suggestionId,
        routeTarget: optionalRouteTarget(input.routeTarget),
        confirmationToken: optionalString(input.confirmationToken),
      };
    }
    case 'reject-suggestion': {
      const suggestionId = requiredString(input.suggestionId, 'suggestionId');
      if (isValidationFailure(suggestionId)) {
        return suggestionId;
      }
      const reason = requiredString(input.reason, 'reason');
      if (isValidationFailure(reason)) {
        return reason;
      }
      return {
        type,
        suggestionId,
        reason,
      };
    }
    case 'view-artifact': {
      const artifactName = requiredString(input.artifactName, 'artifactName');
      if (isValidationFailure(artifactName)) {
        return artifactName;
      }
      if (!artifactNames.has(artifactName)) {
        return invalidAction('Spark view-artifact action requires a known Spark Brain artifact name.');
      }
      return {
        type,
        artifactName: artifactName as SparkBrainArtifactName,
      };
    }
    default:
      return invalidAction('Spark extension action type is not supported.');
  }
}

function getActionType(input: unknown): SparkExtensionActionType | null {
  if (!isRecord(input) || typeof input.type !== 'string' || !actionTypes.has(input.type)) {
    return null;
  }

  return input.type as SparkExtensionActionType;
}

function requiredString(value: unknown, field: string): string | ValidationFailure {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized ? normalized : invalidAction(`Spark extension action requires ${field}.`);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalNullableString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }

  return optionalString(value);
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function optionalProviderMode(value: unknown): SparkProviderMode | undefined | ValidationFailure {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return typeof value === 'string' && providerModes.has(value)
    ? value as SparkProviderMode
    : invalidAction('Spark configure-provider action requires mode to be classic or realtime.');
}

function optionalMetadata(value: unknown): Record<string, string | number | boolean | null> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const metadata: Record<string, string | number | boolean | null> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean' || entry === null) {
      metadata[key] = entry;
    }
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function optionalRouteTarget(value: unknown): 'skill-creator' | 'capability-pack' | 'provider-config' | 'handoff' | undefined {
  return value === 'skill-creator' || value === 'capability-pack' || value === 'provider-config' || value === 'handoff'
    ? value
    : undefined;
}

function invalidAction(message: string): ValidationFailure {
  return {
    ok: false,
    message,
  };
}

function isValidationFailure(value: unknown): value is ValidationFailure {
  return isRecord(value) && value.ok === false && typeof value.message === 'string';
}

function containsSensitiveField(value: unknown, seen = new WeakSet<object>()): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => containsSensitiveField(entry, seen));
  }

  if (!isRecord(value)) {
    return false;
  }

  if (seen.has(value)) {
    return false;
  }
  seen.add(value);

  for (const [key, entry] of Object.entries(value)) {
    if (isSensitiveFieldName(key) || containsSensitiveField(entry, seen)) {
      return true;
    }
  }

  return false;
}

function stripSensitiveFields<T>(value: T, seen = new WeakSet<object>()): T {
  if (Array.isArray(value)) {
    return value.map((entry) => stripSensitiveFields(entry, seen)) as T;
  }

  if (!isRecord(value)) {
    return value;
  }

  if (seen.has(value)) {
    return null as T;
  }
  seen.add(value);

  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isSensitiveFieldName(key)) {
      sanitized[key] = stripSensitiveFields(entry, seen);
    }
  }

  return sanitized as T;
}

function isSensitiveFieldName(key: string): boolean {
  return sensitiveFieldNames.has(key.replace(/[-_\s]/g, '').toLowerCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
