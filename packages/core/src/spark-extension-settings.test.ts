import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getSparkBrainExtensionPaths,
  planSparkBrainInstall,
  SPARK_BRAIN_PACKAGE_PATH,
  SPARK_BRAIN_REPOSITORY_URL,
  SPARK_EXTENSION_ACTION_TYPES,
  SparkExtensionSettingsService,
  type SparkExtensionAction,
  type SparkExtensionSnapshot,
} from './index.js';

describe('Spark extension settings service', () => {
  it('returns a disabled empty snapshot with Wave 1 status summaries', async () => {
    const service = new SparkExtensionSettingsService({
      now: () => '2026-06-05T09:00:00.000Z',
    });

    const snapshot = await service.getSnapshot();

    expect(snapshot).toEqual({
      schemaVersion: 1,
      generatedAt: '2026-06-05T09:00:00.000Z',
      status: {
        installState: 'missing',
        enabled: false,
        source: 'not-installed',
        version: null,
        brainProject: null,
        activeProviderId: null,
        activeProviderMode: null,
        message: 'Spark Brain is not connected to The Vault settings yet.',
        installCommands: ['pnpm --filter @spark/brain install'],
        issues: [],
      },
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
      brainArtifacts: {
        fresh: 0,
        stale: 0,
        missing: 0,
        latestGeneratedAt: null,
        artifacts: [],
      },
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
    });
  });

  it('normalizes missing Spark Brain install commands to the default install preview', async () => {
    const vaultRoot = mkdtempSync(join(tmpdir(), 'spark-extension-managed-'));
    const service = new SparkExtensionSettingsService({
      vaultRoot,
      adapter: {
        getSnapshot: () => {
          const snapshot = makeSnapshot() as Partial<SparkExtensionSnapshot>;
          snapshot.status = {
            ...makeSnapshot().status,
            installState: 'missing',
            source: 'not-installed',
            version: null,
          } as SparkExtensionSnapshot['status'];
          delete (snapshot.status as Partial<SparkExtensionSnapshot['status']> & { installCommands?: string[] }).installCommands;
          return snapshot as SparkExtensionSnapshot;
        },
      },
    });

    await expect(service.getSnapshot()).resolves.toMatchObject({
      status: {
        installCommands: planSparkBrainInstall(vaultRoot).commands,
      },
    });
  });

  it('registers Spark Brain as a managed GitHub source under the Vault extensions folder', async () => {
    const vaultRoot = mkdtempSync(join(tmpdir(), 'spark-extension-source-'));
    const paths = getSparkBrainExtensionPaths(vaultRoot);
    const service = new SparkExtensionSettingsService({
      vaultRoot,
      now: () => '2026-06-05T09:00:00.000Z',
    });

    const snapshot = await service.getSnapshot();
    const plan = planSparkBrainInstall(vaultRoot);
    const installPreview = plan.commands.join('\n');

    expect(snapshot.status.source).toBe('managed');
    expect(snapshot.status.installState).toBe('installable');
    expect(plan.repositoryUrl).toBe('https://github.com/aliihsaad/vault-spark');
    expect(plan.packagePath).toBe('packages/spark-brain');
    expect(plan.extensionRoot).toBe(paths.root);
    expect(plan.packageRoot).toBe(paths.packageRoot);
    expect(installPreview).toContain(SPARK_BRAIN_REPOSITORY_URL);
    expect(installPreview).toContain(SPARK_BRAIN_PACKAGE_PATH);
    expect(installPreview).toContain(paths.root);
    expect(installPreview).toContain('if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }');
    expect(installPreview).toContain('Spark Brain package path not found');
    expect(snapshot.status.installCommands).toEqual(plan.commands);
    expect(snapshot.status.message).toContain('GitHub managed install');
  });

  it('detects Spark Brain as installed when the managed package folder exists', async () => {
    const vaultRoot = mkdtempSync(join(tmpdir(), 'spark-extension-installed-'));
    const paths = getSparkBrainExtensionPaths(vaultRoot);
    mkdirSync(paths.packageRoot, { recursive: true });
    writeFileSync(join(paths.packageRoot, 'package.json'), JSON.stringify({
      name: '@spark/brain',
      version: '0.1.0',
    }), 'utf8');

    const service = new SparkExtensionSettingsService({
      vaultRoot,
      now: () => '2026-06-05T09:00:00.000Z',
    });

    const snapshot = await service.getSnapshot();

    expect(snapshot.status).toEqual(expect.objectContaining({
      installState: 'ready',
      enabled: true,
      source: 'managed',
      version: '0.1.0',
      brainProject: 'Spark Brain',
    }));
    expect(snapshot.status.message).toContain('installed');
    expect(snapshot.status.installCommands).toEqual([]);
  });

  it('normalizes missing pending approval rows to an empty approval queue', async () => {
    const service = new SparkExtensionSettingsService({
      adapter: {
        getSnapshot: () => {
          const snapshot = makeSnapshot() as Partial<SparkExtensionSnapshot>;
          delete snapshot.pendingApprovals;
          return snapshot as SparkExtensionSnapshot;
        },
      },
    });

    await expect(service.getSnapshot()).resolves.toMatchObject({
      pendingApprovals: [],
    });
  });

  it('normalizes missing capability pack rows to an empty pack catalog', async () => {
    const service = new SparkExtensionSettingsService({
      adapter: {
        getSnapshot: () => {
          const snapshot = makeSnapshot() as Partial<SparkExtensionSnapshot>;
          delete snapshot.capabilityPacks;
          return snapshot as SparkExtensionSnapshot;
        },
      },
    });

    await expect(service.getSnapshot()).resolves.toMatchObject({
      capabilityPacks: [],
    });
  });

  it('normalizes missing evolution suggestion rows to an empty suggestion list', async () => {
    const service = new SparkExtensionSettingsService({
      adapter: {
        getSnapshot: () => {
          const snapshot = makeSnapshot() as Partial<SparkExtensionSnapshot>;
          delete snapshot.evolutionSuggestions;
          return snapshot as SparkExtensionSnapshot;
        },
      },
    });

    await expect(service.getSnapshot()).resolves.toMatchObject({
      evolutionSuggestions: [],
    });
  });

  it('normalizes missing Brain artifact summaries to an empty artifact set', async () => {
    const service = new SparkExtensionSettingsService({
      adapter: {
        getSnapshot: () => {
          const snapshot = makeSnapshot() as Partial<SparkExtensionSnapshot>;
          delete snapshot.brainArtifacts;
          return snapshot as SparkExtensionSnapshot;
        },
      },
    });

    await expect(service.getSnapshot()).resolves.toMatchObject({
      brainArtifacts: {
        fresh: 0,
        stale: 0,
        missing: 0,
        latestGeneratedAt: null,
        artifacts: [],
      },
    });
  });

  it('strips provider credentials and owner tokens from adapter snapshots', async () => {
    const service = new SparkExtensionSettingsService({
      now: () => '2026-06-05T09:00:00.000Z',
      adapter: {
        getSnapshot: () => ({
          ...makeSnapshot(),
          providerHealth: {
            ...makeSnapshot().providerHealth,
            providers: [
              {
                providerId: 'openai',
                displayName: 'OpenAI',
                enabled: true,
                credentialState: 'configured',
                aggregateHealth: 'ready',
                classic: { state: 'ready', message: 'ok', checkedAt: null },
                realtime: { state: 'unknown', message: 'not checked', checkedAt: null },
                apiKey: 'sk-should-not-leak',
                sessionToken: 'vc-secret-token',
              },
            ],
          },
          ownerToken: 'owner-secret',
        } as unknown as SparkExtensionSnapshot),
      },
    });

    const snapshot = await service.getSnapshot();
    const serialized = JSON.stringify(snapshot);

    expect(serialized).not.toContain('sk-should-not-leak');
    expect(serialized).not.toContain('vc-secret-token');
    expect(serialized).not.toContain('owner-secret');
    expect(serialized).not.toContain('apiKey');
    expect(serialized).not.toContain('sessionToken');
    expect(snapshot.providerHealth.providers[0]).toEqual({
      providerId: 'openai',
      displayName: 'OpenAI',
      enabled: true,
      credentialState: 'configured',
      aggregateHealth: 'ready',
      classic: { state: 'ready', message: 'ok', checkedAt: null },
      realtime: { state: 'unknown', message: 'not checked', checkedAt: null },
    });
  });

  it('rejects credential-bearing action payloads without echoing the secret', async () => {
    const service = new SparkExtensionSettingsService();

    const result = await service.executeAction({
      type: 'configure-provider',
      providerId: 'openai',
      apiKey: 'sk-should-not-leak',
    } as unknown);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('validation_failed');
    expect(result.message).toContain('provider credentials');
    expect(JSON.stringify(result)).not.toContain('sk-should-not-leak');
  });

  it('recognizes every Wave 1 action type as a typed no-op while Spark Brain is not wired', async () => {
    const service = new SparkExtensionSettingsService();
    const actionByType: Record<(typeof SPARK_EXTENSION_ACTION_TYPES)[number], SparkExtensionAction> = {
      'toggle-extension': { type: 'toggle-extension', enabled: true },
      'configure-provider': { type: 'configure-provider', providerId: 'openrouter', enabled: true },
      'toggle-skill': { type: 'toggle-skill', skillId: 'vault-memory', enabled: true },
      'install-pack': { type: 'install-pack', packId: 'research' },
      'uninstall-pack': { type: 'uninstall-pack', packId: 'research' },
      'approve-skill': { type: 'approve-skill', proposalId: 'proposal-1' },
      'reject-skill': { type: 'reject-skill', proposalId: 'proposal-1', reason: 'Not needed' },
      'approve-suggestion': { type: 'approve-suggestion', suggestionId: 'suggestion-1' },
      'reject-suggestion': { type: 'reject-suggestion', suggestionId: 'suggestion-1', reason: 'Not needed' },
      'view-artifact': { type: 'view-artifact', artifactName: 'SPARK.md' },
    };

    await expect(Promise.all(
      SPARK_EXTENSION_ACTION_TYPES.map(async (type) => service.executeAction(actionByType[type])),
    )).resolves.toEqual(
      SPARK_EXTENSION_ACTION_TYPES.map((type) => expect.objectContaining({
        ok: false,
        actionType: type,
        reason: 'not_implemented',
      })),
    );
  });
});

function makeSnapshot(): SparkExtensionSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: '2026-06-05T09:00:00.000Z',
    status: {
      installState: 'ready',
      enabled: true,
      source: 'managed',
      version: '0.1.0',
      brainProject: 'Spark Brain',
      activeProviderId: 'openai',
      activeProviderMode: 'classic',
      message: 'Ready',
      installCommands: [],
      issues: [],
    },
    providerHealth: {
      activeProviderId: 'openai',
      activeProviderMode: 'classic',
      ready: 1,
      degraded: 0,
      unavailable: 0,
      unknown: 0,
      providers: [],
    },
    skillStatus: {
      total: 1,
      enabled: 1,
      disabled: 0,
      locked: 0,
      pendingApproval: 0,
    },
    skills: [
      {
        skillId: 'vault-memory',
        name: 'Vault Memory',
        namespace: 'vault.native',
        source: 'vault-native',
        version: '1.0.0',
        enabled: true,
        packSource: 'Vault platform',
        permissions: ['vault:read'],
        supportedTools: ['vault_recall_context'],
        outputContracts: ['memory-pack'],
        hasExecutableRegistration: true,
        health: 'ready',
        lockedReason: null,
      },
    ],
    skillCatalog: [],
    pendingApprovals: [],
    capabilityPacks: [
      {
        packId: 'research',
        name: 'Research',
        description: 'Research workflow helpers.',
        installed: true,
        includedSkills: ['literature-review'],
      },
    ],
    evolutionSuggestions: [],
    packStatus: {
      total: 1,
      installed: 1,
      updateAvailable: 0,
    },
    approvals: {
      pending: 0,
      skillProposals: 0,
      evolutionSuggestions: 0,
    },
    brainArtifacts: {
      fresh: 1,
      stale: 0,
      missing: 0,
      latestGeneratedAt: '2026-06-05T08:59:00.000Z',
      artifacts: [
        {
          artifactName: 'SPARK.md',
          freshness: 'fresh',
          generatedAt: '2026-06-05T08:59:00.000Z',
          sourceProject: 'Spark Brain',
          staleReason: null,
        },
      ],
    },
    ledgerSuggestions: {
      total: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      deferred: 0,
      superseded: 0,
    },
    counts: {
      skills: 1,
      enabledSkills: 1,
      installedPacks: 1,
      pendingApprovals: 0,
      brainArtifacts: 1,
      staleBrainArtifacts: 0,
      ledgerSuggestions: 0,
      pendingLedgerSuggestions: 0,
    },
  };
}
