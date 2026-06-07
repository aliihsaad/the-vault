import { describe, expect, it } from 'vitest';
import { createSparkBrainSettingsAdapter } from './services/spark-brain-adapter.js';
import { createVaultBrainStore } from './services/spark-brain-vault-store.js';
import type {
  SparkBrainModuleLike,
  SparkBrainRuntimeLike,
  SparkBrainInstalledSkillLike,
} from './services/spark-brain-adapter.js';
import type { BrainVaultArtifact, BrainVaultStore } from './types/spark-brain-host.js';
import { FakeVaultHost } from './spark-brain-test-host.js';

const NOW = '2026-06-06T12:00:00.000Z';

function ok<T>(value: T) {
  return { ok: true as const, value };
}

function artifact(kind: BrainVaultArtifact['artifactKind']): BrainVaultArtifact {
  return {
    artifactId: `artifact.${kind}`,
    artifactKind: kind,
    projectId: 'project.spark-brain',
    version: '1.0.0',
    rendererVersion: '1.0.0',
    renderedAt: NOW,
    sourceRefs: ['test'],
    contentHash: `hash-${kind}`,
    content: `# ${kind}`,
    redaction: {
      policy: 'artifact-safe',
      redactedRecords: 0,
      redactedRecordIds: [],
      omittedPrivateLedgerEntries: 0,
      omittedRecordIds: [],
    },
    provenance: {
      canonicalStore: 'vault',
      projectId: 'project.spark-brain',
      projectName: 'Spark-Brain',
      sourceRecordIds: [],
      sourceRefs: ['test'],
      manualEdits: 'draft_proposals_only',
    },
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function coreSkill(id: string): SparkBrainInstalledSkillLike {
  return {
    manifest: {
      id,
      namespace: 'core',
      version: '1.0.0',
      title: id,
      purpose: 'demo',
      permissions: ['vault.memory.read'],
      supportedTools: ['vault.recall'],
      examples: [],
      inputContract: {},
      outputContract: { saved: { type: 'boolean' } },
      sparkBrainApiVersion: '1.0.0',
    },
    status: 'enabled',
    sourceKind: 'core',
    canDisable: false,
    alwaysAvailable: false,
  };
}

interface FakeRuntimeCalls {
  installedPack: boolean;
  installedNative: boolean;
  bootstrapped: boolean;
  disabled: string[];
  enabled: string[];
}

function createFakeModule(store: BrainVaultStore): {
  module: SparkBrainModuleLike;
  calls: FakeRuntimeCalls;
} {
  const calls: FakeRuntimeCalls = {
    installedPack: false,
    installedNative: false,
    bootstrapped: false,
    disabled: [],
    enabled: [],
  };
  let skills: SparkBrainInstalledSkillLike[] = [];

  const runtime: SparkBrainRuntimeLike = {
    project: 'Spark-Brain',
    projectId: 'project.spark-brain',
    store,
    coreSkillPack: { id: 'core.pack', title: 'Core Pack', skills: [coreSkill('core.vault-memory').manifest] },
    nativeSkills: [],
    skillRegistry: {
      installPack: () => {
        calls.installedPack = true;
        skills = [coreSkill('core.vault-memory'), coreSkill('core.graphify-query')];
        return ok({ installed: 2, updated: 0, skipped: 0, registeredRuntimeTools: 0 });
      },
      installMany: () => {
        calls.installedNative = true;
        return ok({ installed: 0, updated: 0, skipped: 0, registeredRuntimeTools: 0 });
      },
      discover: () => skills.map((s) => ({ ...s })),
      enable: (id) => {
        calls.enabled.push(id);
        skills = skills.map((s) => (s.manifest.id === id ? { ...s, status: 'enabled' } : s));
        return ok(skills.find((s) => s.manifest.id === id) ?? coreSkill(id));
      },
      disable: (id, reason) => {
        calls.disabled.push(id);
        skills = skills.map((s) =>
          s.manifest.id === id ? { ...s, status: 'disabled', disabledReason: reason } : s,
        );
        return ok(skills.find((s) => s.manifest.id === id) ?? coreSkill(id));
      },
    },
    capabilityPackRegistry: {
      listInstalled: () => [],
      install: async () => ok({ installedSkills: 0 }),
      uninstall: async () => ok({ disabledSkills: 0 }),
    },
    improvementLedger: {
      listEntries: () => [],
      approve: () => ok({ id: 'x' }),
      reject: () => ok({ id: 'x' }),
    },
    providerRegistry: {
      listAdapters: () => [],
    },
    skillCreator: {
      listProposals: () => [],
      approveProposal: () => ok({ proposalId: 'p' }),
      rejectProposal: () => ok({ proposalId: 'p' }),
    },
    ensureBootstrapped: async () => {
      calls.bootstrapped = true;
      await store.ensureProject({ name: 'Spark-Brain', slug: 'spark-brain' });
      const kinds: BrainVaultArtifact['artifactKind'][] = [
        'SPARK.md',
        'USER.md',
        'MEMORY.md',
        'VAULT.md',
        'SKILLS.md',
        'CONTEXT.md',
      ];
      for (const kind of kinds) {
        await store.persistArtifact('project.spark-brain', artifact(kind));
      }
      return ok({ artifacts: kinds.map(artifact), health: { status: 'ready' }, renderedAt: NOW });
    },
  };

  return {
    module: { createSparkBrainRuntime: () => ok(runtime) },
    calls,
  };
}

function makeAdapter(moduleOrNull: SparkBrainModuleLike | null) {
  const host = new FakeVaultHost();
  const store = createVaultBrainStore(host, { now: () => NOW });
  return createSparkBrainSettingsAdapter({
    loadModule: async () => moduleOrNull,
    createStore: () => store,
    getPackageInfo: () => ({ available: moduleOrNull !== null, version: '0.0.0' }),
    now: () => NOW,
  });
}

describe('Spark Brain settings adapter', () => {
  it('reports a degraded-but-installable status when the brain module cannot load', async () => {
    const adapter = makeAdapter(null);
    const snapshot = await adapter.getSnapshot();
    expect(snapshot.status.enabled).toBe(false);
    expect(snapshot.skills).toHaveLength(0);
    expect(snapshot.status.issues.length).toBeGreaterThan(0);
  });

  it('bootstraps on first snapshot and surfaces installed skills + rendered artifacts', async () => {
    const host = new FakeVaultHost();
    const store = createVaultBrainStore(host, { now: () => NOW });
    const { module, calls } = createFakeModule(store);
    const adapter = createSparkBrainSettingsAdapter({
      loadModule: async () => module,
      createStore: () => store,
      getPackageInfo: () => ({ available: true, version: '0.0.0' }),
      now: () => NOW,
    });

    const snapshot = await adapter.getSnapshot();

    expect(calls.bootstrapped).toBe(true);
    expect(calls.installedPack).toBe(true);
    expect(snapshot.status.enabled).toBe(true);
    expect(snapshot.status.installState).toBe('ready');
    expect(snapshot.skills).toHaveLength(2);
    expect(snapshot.skillStatus.total).toBe(2);
    expect(snapshot.skillStatus.enabled).toBe(2);
    expect(snapshot.brainArtifacts.fresh).toBe(6);
    expect(snapshot.brainArtifacts.artifacts).toHaveLength(6);
    expect(snapshot.counts.skills).toBe(2);
    expect(snapshot.counts.brainArtifacts).toBe(6);
  });

  it('maps a core skill row faithfully', async () => {
    const host = new FakeVaultHost();
    const store = createVaultBrainStore(host, { now: () => NOW });
    const { module } = createFakeModule(store);
    const adapter = createSparkBrainSettingsAdapter({
      loadModule: async () => module,
      createStore: () => store,
      getPackageInfo: () => ({ available: true, version: '0.0.0' }),
      now: () => NOW,
    });

    const snapshot = await adapter.getSnapshot();
    const row = snapshot.skills.find((s) => s.skillId === 'core.vault-memory');
    expect(row).toBeDefined();
    expect(row?.source).toBe('core');
    expect(row?.enabled).toBe(true);
    expect(row?.permissions).toContain('vault.memory.read');
    expect(row?.outputContracts).toContain('saved');
  });

  it('routes a toggle-skill disable action to the registry', async () => {
    const host = new FakeVaultHost();
    const store = createVaultBrainStore(host, { now: () => NOW });
    const { module, calls } = createFakeModule(store);
    const adapter = createSparkBrainSettingsAdapter({
      loadModule: async () => module,
      createStore: () => store,
      getPackageInfo: () => ({ available: true, version: '0.0.0' }),
      now: () => NOW,
    });
    await adapter.getSnapshot();

    const result = await adapter.executeAction!({
      type: 'toggle-skill',
      skillId: 'core.graphify-query',
      enabled: false,
    });

    expect(result.ok).toBe(true);
    expect(calls.disabled).toContain('core.graphify-query');
    expect(result.snapshot?.skills.find((s) => s.skillId === 'core.graphify-query')?.enabled).toBe(false);
  });

  it('returns artifact markdown for a view-artifact action', async () => {
    const host = new FakeVaultHost();
    const store = createVaultBrainStore(host, { now: () => NOW });
    const { module } = createFakeModule(store);
    const adapter = createSparkBrainSettingsAdapter({
      loadModule: async () => module,
      createStore: () => store,
      getPackageInfo: () => ({ available: true, version: '0.0.0' }),
      now: () => NOW,
    });
    await adapter.getSnapshot();

    const result = await adapter.executeAction!({ type: 'view-artifact', artifactName: 'SPARK.md' });
    expect(result.ok).toBe(true);
    expect(result.data?.markdownContent).toBe('# SPARK.md');
  });
});
