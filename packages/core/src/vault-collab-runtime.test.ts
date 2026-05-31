import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  VAULT_COLLAB_REPOSITORY_URL,
  detectVaultCollabRuntime,
  getDefaultVaultCollabRuntimeConfig,
  getVaultCollabDashboardSnapshot,
  getVaultCollabExtensionPaths,
  getVaultCollabRuntimeConfig,
  planVaultCollabInstall,
  saveVaultCollabRuntimeConfig,
} from './index.js';

describe('Vault Collab extension runtime config', () => {
  let extractedNativeBindingDir: string | null = null;
  const previousNativeBinding = process.env.VAULT_BETTER_SQLITE3_NATIVE_BINDING;

  beforeAll(() => {
    const cachedPrebuild = findCachedBetterSqlitePrebuild();
    if (!cachedPrebuild) {
      return;
    }

    extractedNativeBindingDir = mkdtempSync(join(tmpdir(), 'vault-collab-sqlite-native-'));
    execFileSync('tar', ['-xf', cachedPrebuild, '-C', extractedNativeBindingDir]);
    process.env.VAULT_BETTER_SQLITE3_NATIVE_BINDING = join(
      extractedNativeBindingDir,
      'build',
      'Release',
      'better_sqlite3.node',
    );
  });

  afterAll(() => {
    if (previousNativeBinding === undefined) {
      delete process.env.VAULT_BETTER_SQLITE3_NATIVE_BINDING;
    } else {
      process.env.VAULT_BETTER_SQLITE3_NATIVE_BINDING = previousNativeBinding;
    }

    if (extractedNativeBindingDir) {
      try {
        rmSync(extractedNativeBindingDir, { recursive: true, force: true });
      } catch {
        // Windows keeps native .node files locked for the lifetime of the process.
      }
    }
  });

  it('stores local runtime config under the vault extensions folder', () => {
    const vaultRoot = mkdtempSync(join(tmpdir(), 'vault-collab-config-'));
    const paths = getVaultCollabExtensionPaths(vaultRoot);

    expect(getDefaultVaultCollabRuntimeConfig(vaultRoot)).toEqual({
      runtimeMode: 'managed',
      managedRuntimePath: paths.runtime,
      localSourceCheckoutPath: null,
      customCliPath: null,
      databasePath: paths.database,
    });

    const sourceRoot = join(vaultRoot, 'checkouts', 'vault-collab');
    const databasePath = join(vaultRoot, 'collab', 'collab.db');
    const saved = saveVaultCollabRuntimeConfig(vaultRoot, {
      runtimeMode: 'localSource',
      localSourceCheckoutPath: sourceRoot,
      databasePath,
    });

    expect(saved).toEqual(expect.objectContaining({
      runtimeMode: 'localSource',
      localSourceCheckoutPath: sourceRoot,
      databasePath,
    }));
    expect(getVaultCollabRuntimeConfig(vaultRoot)).toEqual(saved);
  });

  it('detects a built local source checkout and reports install commands', () => {
    const vaultRoot = mkdtempSync(join(tmpdir(), 'vault-collab-detect-'));
    const sourceRoot = join(vaultRoot, 'vault-collab');
    mkdirSync(join(sourceRoot, 'dist', 'mcp'), { recursive: true });
    writeFileSync(join(sourceRoot, 'package.json'), JSON.stringify({ name: 'vault-collab', version: '0.1.0' }), 'utf8');
    writeFileSync(join(sourceRoot, 'dist', 'cli.js'), 'console.log("cli");\n', 'utf8');
    writeFileSync(join(sourceRoot, 'dist', 'mcp', 'server.js'), 'console.log("mcp");\n', 'utf8');

    const config = saveVaultCollabRuntimeConfig(vaultRoot, {
      runtimeMode: 'localSource',
      localSourceCheckoutPath: sourceRoot,
      databasePath: join(sourceRoot, 'vault-collab.db'),
    });
    const status = detectVaultCollabRuntime(config);
    const plan = planVaultCollabInstall(config);

    expect(status.ready).toBe(true);
    expect(plan.repositoryUrl).toBe(VAULT_COLLAB_REPOSITORY_URL);
    expect(status.cli.available).toBe(true);
    expect(status.mcpServer.available).toBe(true);
    expect(status.packageInfo).toEqual(expect.objectContaining({
      name: 'vault-collab',
      version: '0.1.0',
    }));
    expect(status.message).toContain('database will be created');
    expect(plan.commands).toEqual([
      `cd "${sourceRoot}"`,
      'npm install',
      'npm run build',
      `node dist\\cli.js sessions --db "${join(sourceRoot, 'vault-collab.db')}"`,
    ]);
  });

  it('uses the public GitHub repo for managed install preview when runtime is missing', () => {
    const vaultRoot = mkdtempSync(join(tmpdir(), 'vault-collab-managed-'));
    const config = getDefaultVaultCollabRuntimeConfig(vaultRoot);
    const status = detectVaultCollabRuntime(config);
    const plan = planVaultCollabInstall(config);

    expect(status.configured).toBe(true);
    expect(status.ready).toBe(false);
    expect(status.message).toContain('GitHub npm exec install check');
    expect(plan.repositoryUrl).toBe(VAULT_COLLAB_REPOSITORY_URL);
    expect(plan.commands).toEqual([
      `$db = "${config.databasePath}"; New-Item -ItemType Directory -Force -Path (Split-Path $db) | Out-Null; npm exec --yes --package ${VAULT_COLLAB_REPOSITORY_URL} -- vault-collab check --db $db`,
    ]);
    expect(plan.notes.join('\n')).toContain('no source checkout is required');
    expect(plan.notes.join('\n')).toContain('does not run it silently');
  });

  it('treats a managed npm exec health check database as ready without a source checkout', () => {
    const vaultRoot = mkdtempSync(join(tmpdir(), 'vault-collab-managed-ready-'));
    const config = getDefaultVaultCollabRuntimeConfig(vaultRoot);
    mkdirSync(join(config.databasePath, '..'), { recursive: true });
    writeFileSync(config.databasePath, '', 'utf8');

    const status = detectVaultCollabRuntime(config);

    expect(status.configured).toBe(true);
    expect(status.ready).toBe(true);
    expect(status.sourceRoot.available).toBe(false);
    expect(status.sourceRoot.path).toBeNull();
    expect(status.cli.available).toBe(true);
    expect(status.cli.path).toBeNull();
    expect(status.message).toContain('GitHub npm exec check passed');
  });

  it('builds a read-only dashboard snapshot from Vault Collab sessions, handoffs, and events', () => {
    const vaultRoot = mkdtempSync(join(tmpdir(), 'vault-collab-dashboard-'));
    const config = getDefaultVaultCollabRuntimeConfig(vaultRoot);
    const db = createVaultCollabFixtureDatabase(config.databasePath);

    db.prepare(`
      INSERT INTO sessions (
        session_uid,
        display_name,
        client_type,
        project,
        workspace_path,
        status,
        status_detail,
        capabilities_json,
        current_handoff_uid,
        session_token,
        last_heartbeat_at,
        created_at,
        updated_at,
        disconnected_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'vc_sess_codex',
      'Codex terminal',
      'codex',
      'Vault',
      'C:\\workspace\\the-vault',
      'working',
      'Building the dashboard',
      JSON.stringify({ tools: ['mcp', 'shell'] }),
      'vc_handoff_urgent',
      'secret-token',
      '2026-05-28T11:59:00.000Z',
      '2026-05-28T11:00:00.000Z',
      '2026-05-28T11:59:00.000Z',
      null,
    );

    db.prepare(`
      INSERT INTO sessions (
        session_uid,
        display_name,
        client_type,
        project,
        workspace_path,
        status,
        status_detail,
        capabilities_json,
        current_handoff_uid,
        session_token,
        last_heartbeat_at,
        created_at,
        updated_at,
        disconnected_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'vc_sess_claude',
      'Claude Code',
      'claude-code',
      'Vault Collab',
      'C:\\workspace\\vault-collab',
      'idle',
      null,
      '{}',
      null,
      'secret-token-2',
      '2026-05-28T11:45:00.000Z',
      '2026-05-28T11:10:00.000Z',
      '2026-05-28T11:45:00.000Z',
      null,
    );

    db.prepare(`
      INSERT INTO sessions (
        session_uid,
        display_name,
        client_type,
        project,
        workspace_path,
        status,
        status_detail,
        capabilities_json,
        current_handoff_uid,
        session_token,
        last_heartbeat_at,
        created_at,
        updated_at,
        disconnected_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'vc_sess_closed_recent',
      'Claude Desktop',
      'claude-desktop',
      'Vault Collab',
      'C:\\workspace\\vault-collab',
      'disconnected',
      null,
      '{}',
      null,
      'secret-token-3',
      '2026-05-28T11:52:00.000Z',
      '2026-05-28T11:30:00.000Z',
      '2026-05-28T11:55:00.000Z',
      '2026-05-28T11:55:00.000Z',
    );

    db.prepare(`
      INSERT INTO sessions (
        session_uid,
        display_name,
        client_type,
        project,
        workspace_path,
        status,
        status_detail,
        capabilities_json,
        current_handoff_uid,
        session_token,
        last_heartbeat_at,
        created_at,
        updated_at,
        disconnected_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'vc_sess_closed_old',
      'Old Codex terminal',
      'codex',
      'Vault Collab',
      'C:\\workspace\\vault-collab',
      'disconnected',
      null,
      '{}',
      null,
      'secret-token-4',
      '2026-05-28T02:55:00.000Z',
      '2026-05-28T02:30:00.000Z',
      '2026-05-28T03:00:00.000Z',
      '2026-05-28T03:00:00.000Z',
    );

    db.prepare(`
      INSERT INTO sessions (
        session_uid,
        display_name,
        client_type,
        project,
        workspace_path,
        status,
        status_detail,
        capabilities_json,
        current_handoff_uid,
        session_token,
        last_heartbeat_at,
        created_at,
        updated_at,
        disconnected_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'vc_sess_stale_old',
      'Old Claude Code',
      'claude-code',
      'Vault Collab',
      'C:\\workspace\\vault-collab',
      'idle',
      null,
      '{}',
      null,
      'secret-token-5',
      '2026-05-28T09:30:00.000Z',
      '2026-05-28T09:00:00.000Z',
      '2026-05-28T09:30:00.000Z',
      null,
    );

    db.exec(`
      ALTER TABLE sessions ADD COLUMN delivery_mode TEXT NOT NULL DEFAULT 'manual_poll';
      ALTER TABLE sessions ADD COLUMN delivery_wakeable INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE sessions ADD COLUMN delivery_last_ack_event_id INTEGER;
      ALTER TABLE sessions ADD COLUMN delivery_last_ack_at TEXT;
    `);

    db.prepare(`
      UPDATE sessions
      SET delivery_mode = ?,
          delivery_wakeable = ?,
          delivery_last_ack_event_id = ?,
          delivery_last_ack_at = ?
      WHERE session_uid = ?
    `).run('managed_process', 1, 42, '2026-05-28T11:58:00.000Z', 'vc_sess_codex');

    db.prepare(`
      INSERT INTO handoffs (
        handoff_uid,
        vault_memory_uid,
        short_prompt,
        source_project,
        target_project,
        related_projects_json,
        related_files_json,
        source_session_uid,
        suggested_session_uid,
        suggested_client_type,
        status,
        priority,
        urgent,
        claimed_by_session_uid,
        claim_token,
        lease_expires_at,
        progress_note,
        resolution_summary,
        reopen_reason,
        created_at,
        updated_at,
        resolved_at,
        stale_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'vc_handoff_available',
      'vm_available',
      'Pick up the installer copy review.',
      'Vault',
      'Vault Collab',
      JSON.stringify(['the-vault']),
      JSON.stringify(['README.md']),
      'vc_sess_codex',
      null,
      null,
      'available',
      'normal',
      0,
      null,
      null,
      null,
      null,
      null,
      null,
      '2026-05-28T11:20:00.000Z',
      '2026-05-28T11:20:00.000Z',
      null,
      null,
    );

    db.prepare(`
      INSERT INTO handoffs (
        handoff_uid,
        vault_memory_uid,
        short_prompt,
        source_project,
        target_project,
        related_projects_json,
        related_files_json,
        source_session_uid,
        suggested_session_uid,
        suggested_client_type,
        status,
        priority,
        urgent,
        claimed_by_session_uid,
        claim_token,
        lease_expires_at,
        progress_note,
        resolution_summary,
        reopen_reason,
        created_at,
        updated_at,
        resolved_at,
        stale_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'vc_handoff_urgent',
      'vm_urgent',
      'Verify the Collab dashboard bridge before UI work continues.',
      'Vault Collab',
      'Vault',
      JSON.stringify([]),
      JSON.stringify(['packages/desktop/src/components/VaultAgentView.tsx']),
      'vc_sess_claude',
      'vc_sess_codex',
      'codex',
      'in_progress',
      'urgent',
      1,
      'vc_sess_codex',
      'claim-token',
      null,
      'Writing tests first',
      null,
      null,
      '2026-05-28T11:30:00.000Z',
      '2026-05-28T11:58:00.000Z',
      null,
      null,
    );

    db.prepare(`
      INSERT INTO handoffs (
        handoff_uid,
        vault_memory_uid,
        short_prompt,
        source_project,
        target_project,
        related_projects_json,
        related_files_json,
        source_session_uid,
        suggested_session_uid,
        suggested_client_type,
        status,
        priority,
        urgent,
        claimed_by_session_uid,
        claim_token,
        lease_expires_at,
        progress_note,
        resolution_summary,
        reopen_reason,
        created_at,
        updated_at,
        resolved_at,
        stale_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'vc_handoff_resolved',
      null,
      'Already done.',
      'Vault',
      'Vault',
      '[]',
      '[]',
      null,
      null,
      null,
      'resolved',
      'low',
      0,
      null,
      null,
      null,
      null,
      'Completed earlier',
      null,
      '2026-05-28T10:00:00.000Z',
      '2026-05-28T10:10:00.000Z',
      '2026-05-28T10:10:00.000Z',
      null,
    );

    db.prepare('INSERT INTO events (handoff_uid, session_uid, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)').run(
      'vc_handoff_available',
      'vc_sess_codex',
      'handoff.published',
      JSON.stringify({ targetProject: 'Vault Collab' }),
      '2026-05-28T11:20:00.000Z',
    );
    db.prepare('INSERT INTO events (handoff_uid, session_uid, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)').run(
      'vc_handoff_urgent',
      'vc_sess_codex',
      'handoff.updated',
      JSON.stringify({ status: 'in_progress' }),
      '2026-05-28T11:58:00.000Z',
    );
    db.close();

    const snapshot = getVaultCollabDashboardSnapshot(config, {
      now: new Date('2026-05-28T12:00:00.000Z'),
      staleSessionAfterMs: 5 * 60 * 1000,
      sessionLimit: 10,
      handoffLimit: 10,
      eventLimit: 10,
    });

    expect(snapshot.ready).toBe(true);
    expect(snapshot.dataReady).toBe(true);
    expect(snapshot.sessions).toHaveLength(3);
    expect(snapshot.sessions.some((session) => session.sessionUid === 'vc_sess_closed_old')).toBe(false);
    expect(snapshot.sessions.some((session) => session.sessionUid === 'vc_sess_stale_old')).toBe(false);
    expect(snapshot.sessions.find((session) => session.sessionUid === 'vc_sess_codex')).toEqual(expect.objectContaining({
      displayName: 'Codex terminal',
      agentUid: null,
      agentName: null,
      agentDisplayName: null,
      agentRole: null,
      effectiveStatus: 'working',
      heartbeatAgeMs: 60_000,
      capabilities: { tools: ['mcp', 'shell'] },
      delivery: {
        mode: 'managed_process',
        wakeable: true,
        lastAckEventId: 42,
        lastAckAt: '2026-05-28T11:58:00.000Z',
      },
    }));
    expect(snapshot.sessions.find((session) => session.sessionUid === 'vc_sess_claude')).toEqual(expect.objectContaining({
      displayName: 'Claude Code',
      status: 'idle',
      effectiveStatus: 'idle',
      connectionState: 'stale',
      delivery: {
        mode: 'manual_poll',
        wakeable: false,
        lastAckEventId: null,
        lastAckAt: null,
      },
    }));
    expect(snapshot.sessions.find((session) => session.sessionUid === 'vc_sess_closed_recent')).toEqual(expect.objectContaining({
      displayName: 'Claude Desktop',
      status: 'disconnected',
      effectiveStatus: 'disconnected',
      connectionState: 'disconnected',
    }));
    expect(snapshot.handoffs.map((handoff) => handoff.handoffUid)).toEqual([
      'vc_handoff_urgent',
      'vc_handoff_available',
    ]);
    expect(snapshot.handoffs[0]).toEqual(expect.objectContaining({
      priority: 'urgent',
      urgent: true,
      queueKey: 'default',
      labels: [],
      queuePosition: null,
      dependsOnHandoffUid: null,
      discussionThreads: [],
      relatedFiles: ['packages/desktop/src/components/VaultAgentView.tsx'],
    }));
    expect(snapshot.handoffs.some((handoff) => handoff.status === 'resolved')).toBe(false);
    expect(snapshot.launchRequests).toEqual([]);
    expect(snapshot.events.map((event) => event.eventId)).toEqual([2, 1]);
    expect(snapshot.events[0].payload).toEqual({ status: 'in_progress' });
    expect(snapshot.counts).toEqual(expect.objectContaining({
      sessions: 3,
      activeSessions: 1,
      idleSessions: 1,
      staleSessions: 1,
      disconnectedSessions: 1,
      openHandoffs: 2,
      availableHandoffs: 1,
      urgentHandoffs: 1,
      launchRequests: 0,
      activeLaunchRequests: 0,
      events: 2,
    }));
    expect(snapshot.counts.sessionsByStatus).toEqual(expect.objectContaining({
      working: 1,
      idle: 1,
      disconnected: 1,
    }));
    expect(snapshot.counts.handoffsByStatus).toEqual(expect.objectContaining({
      available: 1,
      in_progress: 1,
    }));
    expect(snapshot.counts.launchRequestsByStatus).toEqual(expect.objectContaining({
      requested: 0,
      running: 0,
      failed: 0,
    }));

    const serializedSnapshot = JSON.stringify(snapshot);
    expect(serializedSnapshot).not.toContain('secret-token');
    expect(serializedSnapshot).not.toContain('claim-token');
  });

  it('reads v2 agent, queue, dependency, and discussion metadata without leaking owner tokens', () => {
    const vaultRoot = mkdtempSync(join(tmpdir(), 'vault-collab-dashboard-v2-'));
    const config = getDefaultVaultCollabRuntimeConfig(vaultRoot);
    const db = createVaultCollabV2FixtureDatabase(config.databasePath);

    db.prepare(`
      INSERT INTO agent_profiles (
        agent_uid,
        stable_name,
        display_name,
        role,
        client_type,
        project,
        description,
        capabilities_json,
        status,
        created_by_session_uid,
        created_at,
        updated_at,
        archived_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'vc_agent_reviewer',
      'claude.reviewer',
      'Claude Reviewer',
      'reviewer',
      'claude-code',
      'the-vault',
      'Architecture verification',
      JSON.stringify({ reviews: true }),
      'active',
      null,
      '2026-05-28T10:00:00.000Z',
      '2026-05-28T10:00:00.000Z',
      null,
    );

    db.prepare(`
      INSERT INTO sessions (
        session_uid,
        display_name,
        client_type,
        project,
        workspace_path,
        status,
        status_detail,
        capabilities_json,
        agent_uid,
        current_handoff_uid,
        session_token,
        last_heartbeat_at,
        created_at,
        updated_at,
        disconnected_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'vc_sess_claude_reviewer',
      'Claude Code review terminal',
      'claude-code',
      'the-vault',
      'C:\\workspace\\the-vault',
      'working',
      'Checking read-only integration',
      JSON.stringify({ can_review: true }),
      'vc_agent_reviewer',
      'vc_handoff_position_10',
      'v2-session-secret',
      '2026-05-28T11:59:30.000Z',
      '2026-05-28T11:00:00.000Z',
      '2026-05-28T11:59:30.000Z',
      null,
    );

    insertV2Handoff(db, {
      handoffUid: 'vc_handoff_position_20',
      shortPrompt: 'Second queue item.',
      labels: ['backend'],
      queuePosition: 20,
      createdAt: '2026-05-28T11:20:00.000Z',
      updatedAt: '2026-05-28T11:20:00.000Z',
    });
    insertV2Handoff(db, {
      handoffUid: 'vc_handoff_position_10',
      shortPrompt: 'First queue item with discussion.',
      labels: ['ui', 'read-only'],
      queuePosition: 10,
      dependsOnHandoffUid: 'vc_handoff_position_20',
      claimedBySessionUid: 'vc_sess_claude_reviewer',
      claimToken: 'v2-claim-secret',
      progressNote: 'Reviewing dashboard contract',
      createdAt: '2026-05-28T11:40:00.000Z',
      updatedAt: '2026-05-28T11:58:00.000Z',
    });

    db.prepare(`
      INSERT INTO discussion_threads (
        thread_uid,
        handoff_uid,
        project,
        title,
        status,
        created_by_session_uid,
        created_at,
        updated_at,
        resolved_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'vc_thread_dashboard',
      'vc_handoff_position_10',
      'the-vault',
      'Dashboard integration questions',
      'open',
      'vc_sess_claude_reviewer',
      '2026-05-28T11:45:00.000Z',
      '2026-05-28T11:55:00.000Z',
      null,
    );
    db.prepare(`
      INSERT INTO discussion_messages (
        message_uid,
        thread_uid,
        session_uid,
        agent_uid,
        message_type,
        body,
        metadata_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'vc_msg_1',
      'vc_thread_dashboard',
      'vc_sess_claude_reviewer',
      'vc_agent_reviewer',
      'question',
      'Should the UI expose lifecycle actions?',
      '{}',
      '2026-05-28T11:50:00.000Z',
    );
    db.prepare(`
      INSERT INTO discussion_messages (
        message_uid,
        thread_uid,
        session_uid,
        agent_uid,
        message_type,
        body,
        metadata_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'vc_msg_2',
      'vc_thread_dashboard',
      'vc_sess_claude_reviewer',
      'vc_agent_reviewer',
      'decision',
      'Keep lifecycle mutations in MCP only.',
      '{}',
      '2026-05-28T11:55:00.000Z',
    );
    db.close();

    const snapshot = getVaultCollabDashboardSnapshot(config, {
      now: new Date('2026-05-28T12:00:00.000Z'),
      staleSessionAfterMs: 5 * 60 * 1000,
      sessionLimit: 10,
      handoffLimit: 10,
      eventLimit: 10,
    });

    expect(snapshot.ready).toBe(true);
    expect(snapshot.dataReady).toBe(true);
    expect(snapshot.sessions.find((session) => session.sessionUid === 'vc_sess_claude_reviewer')).toEqual(expect.objectContaining({
      displayName: 'Claude Code review terminal',
      clientType: 'claude-code',
      agentUid: 'vc_agent_reviewer',
      agentName: 'claude.reviewer',
      agentDisplayName: 'Claude Reviewer',
      agentRole: 'reviewer',
      effectiveStatus: 'working',
    }));
    expect(snapshot.handoffs.map((handoff) => handoff.handoffUid)).toEqual([
      'vc_handoff_position_10',
      'vc_handoff_position_20',
    ]);
    expect(snapshot.handoffs[0]).toEqual(expect.objectContaining({
      shortPrompt: 'First queue item with discussion.',
      queueKey: 'integration',
      labels: ['ui', 'read-only'],
      queuePosition: 10,
      dependsOnHandoffUid: 'vc_handoff_position_20',
      progressNote: 'Reviewing dashboard contract',
    }));
    expect(snapshot.handoffs[0].discussionThreads).toEqual([
      expect.objectContaining({
        threadUid: 'vc_thread_dashboard',
        handoffUid: 'vc_handoff_position_10',
        project: 'the-vault',
        title: 'Dashboard integration questions',
        status: 'open',
        createdBySessionUid: 'vc_sess_claude_reviewer',
        messageCount: 2,
        lastMessageAt: '2026-05-28T11:55:00.000Z',
      }),
    ]);
    expect(snapshot.handoffs[1]).toEqual(expect.objectContaining({
      queueKey: 'integration',
      labels: ['backend'],
      queuePosition: 20,
      dependsOnHandoffUid: null,
      discussionThreads: [],
    }));

    const serializedSnapshot = JSON.stringify(snapshot);
    expect(serializedSnapshot).not.toContain('v2-session-secret');
    expect(serializedSnapshot).not.toContain('v2-claim-secret');
  });

  it('counts permission-needed states and attention events without leaking owner tokens', () => {
    const vaultRoot = mkdtempSync(join(tmpdir(), 'vault-collab-dashboard-attention-'));
    const config = getDefaultVaultCollabRuntimeConfig(vaultRoot);
    const db = createVaultCollabV2FixtureDatabase(config.databasePath);

    db.prepare(`
      INSERT INTO sessions (
        session_uid,
        display_name,
        client_type,
        project,
        workspace_path,
        status,
        status_detail,
        capabilities_json,
        agent_uid,
        current_handoff_uid,
        session_token,
        last_heartbeat_at,
        created_at,
        updated_at,
        disconnected_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'vc_sess_permission',
      'Codex awaiting permission',
      'codex',
      'the-vault',
      'C:\\workspace\\the-vault',
      'awaiting_user',
      'Allow npm test?',
      JSON.stringify({ can_test: true }),
      null,
      'vc_handoff_permission',
      'permission-session-secret',
      '2026-05-28T11:59:30.000Z',
      '2026-05-28T11:00:00.000Z',
      '2026-05-28T11:59:30.000Z',
      null,
    );

    insertV2Handoff(db, {
      handoffUid: 'vc_handoff_permission',
      shortPrompt: 'Needs desktop build permission.',
      labels: ['permission-needed'],
      queuePosition: 1,
      claimedBySessionUid: 'vc_sess_permission',
      claimToken: 'permission-claim-secret',
      status: 'awaiting_user',
      progressNote: 'Allow desktop build?',
      createdAt: '2026-05-28T11:40:00.000Z',
      updatedAt: '2026-05-28T11:59:00.000Z',
    });

    db.prepare('INSERT INTO events (handoff_uid, session_uid, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)').run(
      null,
      'vc_sess_permission',
      'session.permission_requested',
      JSON.stringify({
        permissionRequest: {
          question: 'Allow npm test?',
          requestedCapability: 'shell.escalated',
          commandPreview: 'pnpm test',
          source: 'agent',
          createdAt: '2026-05-28T11:58:00.000Z',
        },
      }),
      '2026-05-28T11:58:00.000Z',
    );
    db.prepare('INSERT INTO events (handoff_uid, session_uid, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)').run(
      'vc_handoff_permission',
      'vc_sess_permission',
      'handoff.permission_requested',
      JSON.stringify({
        permissionRequest: {
          question: 'Allow desktop build?',
          requestedCapability: 'desktop.build',
          commandPreview: 'pnpm --filter @the-vault/desktop build',
          source: 'agent',
          createdAt: '2026-05-28T11:59:00.000Z',
        },
      }),
      '2026-05-28T11:59:00.000Z',
    );
    db.prepare('INSERT INTO events (handoff_uid, session_uid, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)').run(
      null,
      'vc_sess_permission',
      'session.pinged',
      JSON.stringify({
        actorSessionUid: 'vc_sess_reviewer',
        message: 'Need your approval.',
        createdAt: '2026-05-28T11:59:30.000Z',
      }),
      '2026-05-28T11:59:30.000Z',
    );
    db.close();

    const snapshot = getVaultCollabDashboardSnapshot(config, {
      now: new Date('2026-05-28T12:00:00.000Z'),
      staleSessionAfterMs: 5 * 60 * 1000,
      sessionLimit: 10,
      handoffLimit: 10,
      eventLimit: 10,
    });

    expect(snapshot.ready).toBe(true);
    expect(snapshot.dataReady).toBe(true);
    expect(snapshot.sessions[0]).toEqual(expect.objectContaining({
      sessionUid: 'vc_sess_permission',
      effectiveStatus: 'awaiting_user',
      statusDetail: 'Allow npm test?',
    }));
    expect(snapshot.handoffs[0]).toEqual(expect.objectContaining({
      handoffUid: 'vc_handoff_permission',
      status: 'awaiting_user',
      progressNote: 'Allow desktop build?',
    }));
    expect(snapshot.events.map((event) => event.eventType)).toEqual([
      'session.pinged',
      'handoff.permission_requested',
      'session.permission_requested',
    ]);
    expect(snapshot.events.find((event) => event.eventType === 'session.permission_requested')?.payload).toEqual({
      permissionRequest: expect.objectContaining({
        question: 'Allow npm test?',
        requestedCapability: 'shell.escalated',
        source: 'agent',
      }),
    });
    expect(snapshot.counts).toEqual(expect.objectContaining({
      permissionNeeded: 2,
      permissionNeededSessions: 1,
      permissionNeededHandoffs: 1,
      permissionRequestEvents: 2,
      attentionPingEvents: 1,
    }));

    const serializedSnapshot = JSON.stringify(snapshot);
    expect(serializedSnapshot).not.toContain('permission-session-secret');
    expect(serializedSnapshot).not.toContain('permission-claim-secret');
  });

  it('reads launch request records as an optional read-only dashboard slice', () => {
    const vaultRoot = mkdtempSync(join(tmpdir(), 'vault-collab-dashboard-launch-'));
    const config = getDefaultVaultCollabRuntimeConfig(vaultRoot);
    const db = createVaultCollabV2FixtureDatabase(config.databasePath);
    createLaunchRequestTable(db);

    insertLaunchRequest(db, {
      launchRequestUid: 'vc_launch_requested',
      provider: 'codex',
      model: 'gpt-5-codex',
      effortLevel: 'high',
      project: 'the-vault',
      workspacePath: 'C:\\workspace\\the-vault',
      role: 'dashboard implementer',
      initialInstructions: 'Add read-only cards.',
      permissionMode: 'workspace-write',
      commandPreview: 'codex --project the-vault',
      requestedCapabilities: ['code_editing', 'shell_tests'],
      approvalPolicyVersion: 'v2.0',
      approvalSnapshot: null,
      status: 'requested',
      statusDetail: null,
      requestedBySessionUid: 'vc_sess_requester',
      approvedBySessionUid: null,
      rejectedBySessionUid: null,
      brokerSessionUid: null,
      launchedSessionUid: null,
      metadata: { source: 'dashboard' },
      createdAt: '2026-05-28T11:50:00.000Z',
      updatedAt: '2026-05-28T11:59:00.000Z',
      approvedAt: null,
      rejectedAt: null,
      startedAt: null,
      completedAt: null,
    });
    insertLaunchRequest(db, {
      launchRequestUid: 'vc_launch_running',
      provider: 'claude-code',
      model: 'claude-opus',
      effortLevel: null,
      project: 'the-vault',
      workspacePath: 'C:\\workspace\\the-vault',
      role: 'reviewer',
      initialInstructions: 'Review implementation.',
      permissionMode: 'read-only',
      commandPreview: null,
      requestedCapabilities: ['review'],
      approvalPolicyVersion: 'v2.0',
      approvalSnapshot: { provider: 'claude-code', model: 'claude-opus' },
      status: 'running',
      statusDetail: 'Registered launched session',
      requestedBySessionUid: 'vc_sess_requester',
      approvedBySessionUid: 'vc_sess_approver',
      rejectedBySessionUid: null,
      brokerSessionUid: 'vc_sess_broker',
      launchedSessionUid: 'vc_sess_launched',
      metadata: {},
      createdAt: '2026-05-28T11:40:00.000Z',
      updatedAt: '2026-05-28T11:57:00.000Z',
      approvedAt: '2026-05-28T11:45:00.000Z',
      rejectedAt: null,
      startedAt: '2026-05-28T11:46:00.000Z',
      completedAt: null,
    });
    insertLaunchRequest(db, {
      launchRequestUid: 'vc_launch_failed',
      provider: 'codex',
      model: 'gpt-5-codex',
      effortLevel: null,
      project: 'the-vault',
      workspacePath: 'C:\\workspace\\the-vault',
      role: null,
      initialInstructions: 'Try launch.',
      permissionMode: 'workspace-write',
      commandPreview: null,
      requestedCapabilities: [],
      approvalPolicyVersion: null,
      approvalSnapshot: null,
      status: 'failed',
      statusDetail: 'Broker failed before process start',
      requestedBySessionUid: 'vc_sess_requester',
      approvedBySessionUid: 'vc_sess_approver',
      rejectedBySessionUid: null,
      brokerSessionUid: 'vc_sess_broker',
      launchedSessionUid: null,
      metadata: {},
      createdAt: '2026-05-28T11:30:00.000Z',
      updatedAt: '2026-05-28T11:58:00.000Z',
      approvedAt: '2026-05-28T11:35:00.000Z',
      rejectedAt: null,
      startedAt: null,
      completedAt: '2026-05-28T11:58:00.000Z',
    });
    db.prepare('INSERT INTO events (handoff_uid, session_uid, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)').run(
      null,
      'vc_sess_requester',
      'launch_request.requested',
      JSON.stringify({ launchRequestUid: 'vc_launch_requested', provider: 'codex', model: 'gpt-5-codex' }),
      '2026-05-28T11:59:00.000Z',
    );
    db.close();

    const snapshot = getVaultCollabDashboardSnapshot(config, {
      now: new Date('2026-05-28T12:00:00.000Z'),
      launchRequestLimit: 10,
      eventLimit: 10,
    });

    expect(snapshot.ready).toBe(true);
    expect(snapshot.dataReady).toBe(true);
    expect(snapshot.launchRequests.map((launchRequest) => launchRequest.launchRequestUid)).toEqual([
      'vc_launch_requested',
      'vc_launch_running',
      'vc_launch_failed',
    ]);
    expect(snapshot.launchRequests[0]).toEqual(expect.objectContaining({
      provider: 'codex',
      model: 'gpt-5-codex',
      effortLevel: 'high',
      project: 'the-vault',
      role: 'dashboard implementer',
      permissionMode: 'workspace-write',
      commandPreview: 'codex --project the-vault',
      requestedCapabilities: ['code_editing', 'shell_tests'],
      status: 'requested',
      requestedBySessionUid: 'vc_sess_requester',
      metadata: { source: 'dashboard' },
    }));
    expect(snapshot.launchRequests[1]).toEqual(expect.objectContaining({
      status: 'running',
      brokerSessionUid: 'vc_sess_broker',
      launchedSessionUid: 'vc_sess_launched',
      approvalSnapshot: { provider: 'claude-code', model: 'claude-opus' },
    }));
    expect(snapshot.events[0]).toEqual(expect.objectContaining({
      eventType: 'launch_request.requested',
      payload: expect.objectContaining({ launchRequestUid: 'vc_launch_requested' }),
    }));
    expect(snapshot.counts).toEqual(expect.objectContaining({
      launchRequests: 3,
      activeLaunchRequests: 1,
      requestedLaunchRequests: 1,
      runningLaunchRequests: 1,
      failedLaunchRequests: 1,
    }));
    expect(snapshot.counts.launchRequestsByStatus).toEqual(expect.objectContaining({
      requested: 1,
      running: 1,
      failed: 1,
    }));

    const serializedSnapshot = JSON.stringify(snapshot);
    expect(serializedSnapshot).not.toContain('session-token');
    expect(serializedSnapshot).not.toContain('claim-token');
  });
});

function createVaultCollabFixtureDatabase(databasePath: string): Database.Database {
  mkdirSync(dirname(databasePath), { recursive: true });
  const nativeBinding = process.env.VAULT_BETTER_SQLITE3_NATIVE_BINDING?.trim();
  const db = nativeBinding
    ? new Database(databasePath, { nativeBinding })
    : new Database(databasePath);
  db.exec(`
    CREATE TABLE sessions (
      session_uid TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      client_type TEXT NOT NULL,
      project TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      status TEXT NOT NULL,
      status_detail TEXT,
      capabilities_json TEXT NOT NULL,
      current_handoff_uid TEXT,
      session_token TEXT NOT NULL,
      last_heartbeat_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      disconnected_at TEXT
    );

    CREATE TABLE handoffs (
      handoff_uid TEXT PRIMARY KEY,
      vault_memory_uid TEXT,
      short_prompt TEXT NOT NULL,
      source_project TEXT NOT NULL,
      target_project TEXT NOT NULL,
      related_projects_json TEXT NOT NULL,
      related_files_json TEXT NOT NULL,
      source_session_uid TEXT,
      suggested_session_uid TEXT,
      suggested_client_type TEXT,
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      urgent INTEGER NOT NULL,
      claimed_by_session_uid TEXT,
      claim_token TEXT,
      lease_expires_at TEXT,
      progress_note TEXT,
      resolution_summary TEXT,
      reopen_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT,
      stale_at TEXT
    );

    CREATE TABLE events (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      handoff_uid TEXT,
      session_uid TEXT,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

function createVaultCollabV2FixtureDatabase(databasePath: string): Database.Database {
  const db = createVaultCollabFixtureDatabase(databasePath);
  db.exec(`
    ALTER TABLE sessions ADD COLUMN agent_uid TEXT;

    CREATE TABLE agent_profiles (
      agent_uid TEXT PRIMARY KEY,
      stable_name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'implementer',
      client_type TEXT,
      project TEXT,
      description TEXT,
      capabilities_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active',
      created_by_session_uid TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    );

    ALTER TABLE handoffs ADD COLUMN queue_key TEXT NOT NULL DEFAULT 'default';
    ALTER TABLE handoffs ADD COLUMN labels_json TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE handoffs ADD COLUMN queue_position INTEGER;
    ALTER TABLE handoffs ADD COLUMN depends_on_handoff_uid TEXT;

    CREATE TABLE discussion_threads (
      thread_uid TEXT PRIMARY KEY,
      handoff_uid TEXT,
      project TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_by_session_uid TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE TABLE discussion_messages (
      message_uid TEXT PRIMARY KEY,
      thread_uid TEXT NOT NULL,
      session_uid TEXT,
      agent_uid TEXT,
      message_type TEXT NOT NULL,
      body TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

function createLaunchRequestTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE launch_requests (
      launch_request_uid TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      project_key TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      effort_level TEXT,
      workspace_path TEXT NOT NULL,
      role TEXT,
      initial_instructions TEXT NOT NULL,
      permission_mode TEXT NOT NULL,
      command_preview TEXT,
      requested_capabilities_json TEXT NOT NULL DEFAULT '[]',
      approval_policy_version TEXT,
      approval_snapshot_json TEXT,
      status TEXT NOT NULL,
      status_detail TEXT,
      requested_by_session_uid TEXT NOT NULL,
      approved_by_session_uid TEXT,
      rejected_by_session_uid TEXT,
      broker_session_uid TEXT,
      launched_session_uid TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      approved_at TEXT,
      rejected_at TEXT,
      started_at TEXT,
      completed_at TEXT
    );
  `);
}

function insertLaunchRequest(
  db: Database.Database,
  input: {
    launchRequestUid: string;
    provider: string;
    model: string;
    effortLevel: string | null;
    project: string;
    workspacePath: string;
    role: string | null;
    initialInstructions: string;
    permissionMode: string;
    commandPreview: string | null;
    requestedCapabilities: string[];
    approvalPolicyVersion: string | null;
    approvalSnapshot: Record<string, unknown> | null;
    status: string;
    statusDetail: string | null;
    requestedBySessionUid: string;
    approvedBySessionUid: string | null;
    rejectedBySessionUid: string | null;
    brokerSessionUid: string | null;
    launchedSessionUid: string | null;
    metadata: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
    approvedAt: string | null;
    rejectedAt: string | null;
    startedAt: string | null;
    completedAt: string | null;
  },
): void {
  db.prepare(`
    INSERT INTO launch_requests (
      launch_request_uid,
      project,
      project_key,
      provider,
      model,
      effort_level,
      workspace_path,
      role,
      initial_instructions,
      permission_mode,
      command_preview,
      requested_capabilities_json,
      approval_policy_version,
      approval_snapshot_json,
      status,
      status_detail,
      requested_by_session_uid,
      approved_by_session_uid,
      rejected_by_session_uid,
      broker_session_uid,
      launched_session_uid,
      metadata_json,
      created_at,
      updated_at,
      approved_at,
      rejected_at,
      started_at,
      completed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.launchRequestUid,
    input.project,
    input.project.toLowerCase(),
    input.provider,
    input.model,
    input.effortLevel,
    input.workspacePath,
    input.role,
    input.initialInstructions,
    input.permissionMode,
    input.commandPreview,
    JSON.stringify(input.requestedCapabilities),
    input.approvalPolicyVersion,
    input.approvalSnapshot ? JSON.stringify(input.approvalSnapshot) : null,
    input.status,
    input.statusDetail,
    input.requestedBySessionUid,
    input.approvedBySessionUid,
    input.rejectedBySessionUid,
    input.brokerSessionUid,
    input.launchedSessionUid,
    JSON.stringify(input.metadata),
    input.createdAt,
    input.updatedAt,
    input.approvedAt,
    input.rejectedAt,
    input.startedAt,
    input.completedAt,
  );
}

function insertV2Handoff(
  db: Database.Database,
  input: {
    handoffUid: string;
    shortPrompt: string;
    labels: string[];
    queuePosition: number | null;
    createdAt: string;
    updatedAt: string;
    dependsOnHandoffUid?: string | null;
    claimedBySessionUid?: string | null;
    claimToken?: string | null;
    progressNote?: string | null;
    status?: string;
  },
): void {
  db.prepare(`
    INSERT INTO handoffs (
      handoff_uid,
      vault_memory_uid,
      short_prompt,
      source_project,
      target_project,
      related_projects_json,
      related_files_json,
      source_session_uid,
      suggested_session_uid,
      suggested_client_type,
      queue_key,
      labels_json,
      queue_position,
      depends_on_handoff_uid,
      status,
      priority,
      urgent,
      claimed_by_session_uid,
      claim_token,
      lease_expires_at,
      progress_note,
      resolution_summary,
      reopen_reason,
      created_at,
      updated_at,
      resolved_at,
      stale_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.handoffUid,
    null,
    input.shortPrompt,
    'Vault Collab',
    'the-vault',
    JSON.stringify(['Vault Collab']),
    JSON.stringify(['packages/desktop/src/components/VaultCollabView.tsx']),
    'vc_sess_claude_reviewer',
    null,
    null,
    'integration',
    JSON.stringify(input.labels),
    input.queuePosition,
    input.dependsOnHandoffUid ?? null,
    input.status ?? (input.claimedBySessionUid ? 'in_progress' : 'available'),
    'high',
    0,
    input.claimedBySessionUid ?? null,
    input.claimToken ?? null,
    null,
    input.progressNote ?? null,
    null,
    null,
    input.createdAt,
    input.updatedAt,
    null,
    null,
  );
}

function findCachedBetterSqlitePrebuild(): string | null {
  const expectedSuffix = `better-sqlite3-v12.9.0-node-v${process.versions.modules}-${process.platform}-${process.arch}.tar.gz`;
  const cacheDirs = [
    join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'npm-cache', '_prebuilds'),
    join(homedir(), '.npm', '_prebuilds'),
  ];

  for (const cacheDir of cacheDirs) {
    if (!existsSync(cacheDir)) {
      continue;
    }

    const match = readdirSync(cacheDir).find((entry) => entry.endsWith(expectedSuffix));
    if (match) {
      return join(cacheDir, match);
    }
  }

  return null;
}
