import type {
  SparkApprovalRiskLevel,
  SparkBrainArtifactName,
  SparkBrainArtifactSummary,
  SparkCapabilityPackRow,
  SparkExtensionAction,
  SparkExtensionActionResult,
  SparkExtensionSnapshot,
  SparkExtensionStatus,
  SparkProviderHealthSummary,
  SparkSkillCatalogItem,
  SparkSkillRow,
  SparkSkillSource,
} from '../types/spark-extension.js';
import { SPARK_BRAIN_ARTIFACT_NAMES } from '../types/spark-extension.js';
import type {
  BrainVaultArtifact,
  BrainVaultStore,
} from '../types/spark-brain-host.js';
import type { BrainToolRegistryLike } from './spark-voice/spark-voice-tools.js';

// ---------------------------------------------------------------------------
// Structural contracts for the dynamically-loaded @spark/brain runtime.
// The Vault host never statically imports @spark/brain (separate, externally
// built workspace). The real runtime structurally satisfies these shapes.
// ---------------------------------------------------------------------------

export interface SparkBrainResultLike<T> {
  ok: boolean;
  value?: T;
  error?: { code?: string; message?: string };
}

export interface SparkBrainSkillManifestLike {
  id: string;
  namespace: string;
  version: string;
  title: string;
  purpose: string;
  permissions?: string[];
  supportedTools?: string[];
  examples?: string[];
  inputContract?: Record<string, unknown>;
  outputContract?: Record<string, unknown>;
  packId?: string;
  sparkBrainApiVersion?: string;
  sparkCoreMinVersion?: string;
}

export interface SparkBrainInstalledSkillLike {
  manifest: SparkBrainSkillManifestLike;
  status: string;
  sourceKind: string;
  packSource?: string;
  disabledReason?: string;
  canDisable: boolean;
  alwaysAvailable: boolean;
}

export interface SparkBrainInstalledPackLike {
  manifest: { id: string; title: string; description?: string; skills: Array<{ id: string }> };
  status: string;
}

export interface SparkBrainRuntimeLike {
  project: string;
  projectId: string;
  store: BrainVaultStore;
  /**
   * The Wave 8 runtime's executable tool registry (@spark/core ToolRegistry).
   * Optional so older brain builds without it degrade gracefully. The host
   * bridges its executable tools into the realtime voice tool set.
   */
  runtimeToolRegistry?: BrainToolRegistryLike;
  coreSkillPack: { id: string; title: string; skills: SparkBrainSkillManifestLike[] };
  nativeSkills: unknown[];
  skillRegistry: {
    installPack: (pack: unknown, options?: unknown) => SparkBrainResultLike<unknown>;
    installMany: (defs: unknown[], options?: unknown) => SparkBrainResultLike<unknown>;
    discover: (filter?: unknown) => SparkBrainInstalledSkillLike[];
    enable: (id: string, version?: string) => SparkBrainResultLike<unknown>;
    disable: (id: string, reason: string, version?: string) => SparkBrainResultLike<unknown>;
  };
  capabilityPackRegistry: {
    listInstalled: () => SparkBrainInstalledPackLike[];
    install: (pack: unknown, options?: unknown) => Promise<SparkBrainResultLike<unknown>>;
    uninstall: (packId: string, options?: unknown) => Promise<SparkBrainResultLike<unknown>>;
  };
  improvementLedger: {
    listEntries: (filter?: unknown) => unknown;
    approve: (id: string, options?: unknown) => SparkBrainResultLike<unknown>;
    reject: (id: string, reason?: string) => SparkBrainResultLike<unknown>;
  };
  providerRegistry: {
    listAdapters: () => unknown[];
  };
  skillCreator: {
    listProposals: () => unknown[];
    approveProposal: (proposalId: string, options?: unknown) => SparkBrainResultLike<unknown>;
    rejectProposal: (proposalId: string, reason?: string) => SparkBrainResultLike<unknown>;
  };
  ensureBootstrapped: (
    options?: unknown,
  ) => Promise<SparkBrainResultLike<{ artifacts?: BrainVaultArtifact[]; health?: { status?: string }; renderedAt?: string }>>;
}

export interface SparkBrainModuleLike {
  createSparkBrainRuntime: (options: { store: BrainVaultStore }) => SparkBrainResultLike<SparkBrainRuntimeLike>;
}

export interface SparkBrainSettingsAdapterOptions {
  loadModule: () => Promise<SparkBrainModuleLike | null>;
  createStore: () => BrainVaultStore;
  getPackageInfo: () => { available: boolean; version: string | null };
  /**
   * Host-side resolver for the live provider health summary (S2). Built from the
   * credential store in the main process; renderer-safe (no keys). When omitted
   * the snapshot reports an empty provider registry.
   */
  getProviderHealth?: () => SparkProviderHealthSummary;
  now?: () => string;
}

export interface SparkBrainSettingsAdapter {
  getSnapshot: () => Promise<SparkExtensionSnapshot>;
  executeAction: (action: SparkExtensionAction) => Promise<SparkExtensionActionResult>;
  /**
   * Resolve the bootstrapped brain runtime's executable tool registry, so the
   * voice host can expose the brain's policy-gated skills as realtime tools.
   * Returns null when the runtime can't load or the build predates the registry.
   */
  getRuntimeToolRegistry: () => Promise<BrainToolRegistryLike | null>;
}

const RISK_LEVELS = new Set<SparkApprovalRiskLevel>(['low', 'medium', 'high', 'critical']);

/**
 * Wires the Spark extension Settings UI to the real @spark/brain runtime. It
 * loads the externally-built runtime via an injectable loader, bootstraps it
 * through the Vault-backed store on enable, and translates runtime/registry
 * state into a live SparkExtensionSnapshot plus IPC action results. When the
 * runtime cannot be loaded it degrades to a clear, non-crashing status.
 */
export function createSparkBrainSettingsAdapter(
  options: SparkBrainSettingsAdapterOptions,
): SparkBrainSettingsAdapter {
  const now = options.now ?? (() => new Date().toISOString());
  const resolveProviderHealth = (): SparkProviderHealthSummary =>
    options.getProviderHealth?.() ?? emptyProviderHealth();
  let store: BrainVaultStore | null = null;
  let runtime: SparkBrainRuntimeLike | null = null;
  let bootstrapped = false;
  let enabled = true;
  let loadError: string | null = null;

  function getStore(): BrainVaultStore {
    if (!store) {
      store = options.createStore();
    }
    return store;
  }

  async function ensureRuntime(): Promise<SparkBrainRuntimeLike | null> {
    if (runtime && bootstrapped) {
      return runtime;
    }
    let mod: SparkBrainModuleLike | null;
    try {
      mod = await options.loadModule();
    } catch (error) {
      loadError = error instanceof Error ? error.message : 'Spark Brain runtime failed to load.';
      return null;
    }
    if (!mod) {
      loadError = 'Spark Brain runtime is not built or could not be loaded from the extension folder.';
      return null;
    }

    const created = mod.createSparkBrainRuntime({ store: getStore() });
    if (!created.ok || !created.value) {
      loadError = created.error?.message ?? 'Spark Brain runtime could not be created.';
      return null;
    }
    runtime = created.value;

    const boot = await runtime.ensureBootstrapped();
    if (!boot.ok) {
      loadError = boot.error?.message ?? 'Spark Brain bootstrap failed.';
    }

    // Install the immutable core skill pack and Vault-native platform skills so
    // the Skills tab reflects the real registry instead of zeros.
    try {
      runtime.skillRegistry.installPack(runtime.coreSkillPack, { sourceKind: 'core' });
    } catch {
      /* non-fatal: snapshot still reflects whatever installed */
    }
    try {
      runtime.skillRegistry.installMany(runtime.nativeSkills, {
        sourceKind: 'platform',
        alwaysAvailable: true,
        canDisable: false,
      });
    } catch {
      /* non-fatal */
    }

    bootstrapped = true;
    loadError = null;
    return runtime;
  }

  function buildStatus(rt: SparkBrainRuntimeLike | null): SparkExtensionStatus {
    const pkg = options.getPackageInfo();
    if (!rt) {
      return {
        installState: pkg.available ? 'installable' : 'missing',
        enabled: false,
        source: pkg.available ? 'managed' : 'not-installed',
        version: pkg.version,
        brainProject: 'Spark-Brain',
        activeProviderId: null,
        activeProviderMode: null,
        message:
          loadError ??
          'Spark Brain runtime is not loaded. Build the extension to enable live settings.',
        installCommands: [],
        issues: [loadError ?? 'Spark Brain runtime is not loaded.'],
      };
    }
    return {
      installState: enabled ? 'ready' : 'installedDisabled',
      enabled,
      source: 'managed',
      version: pkg.version,
      brainProject: rt.project,
      activeProviderId: null,
      activeProviderMode: null,
      message: enabled
        ? `Spark Brain is active for project ${rt.project}.`
        : 'Spark Brain is installed but disabled.',
      installCommands: [],
      issues: [],
    };
  }

  async function buildSnapshot(): Promise<SparkExtensionSnapshot> {
    const rt = enabled ? await ensureRuntime() : runtime;
    const status = buildStatus(rt);
    const generatedAt = now();

    if (!rt) {
      return emptySnapshot(generatedAt, status, resolveProviderHealth());
    }

    const installed = safeArray(() => rt.skillRegistry.discover({ includeDisabled: true }));
    const artifacts = await safeAsyncArray(() => rt.store.listArtifacts(rt.projectId));
    const proposals = await safeAsyncArray(() => rt.store.listSkillDraftProposals(rt.projectId));
    const installedPacks = safeArray(() => rt.capabilityPackRegistry.listInstalled());

    const skills = installed.map(toSkillRow);
    const skillCatalog = buildCatalog(rt);
    const pendingApprovals = proposals
      .filter((p) => p.status === 'draft')
      .map((p) => ({
        proposalId: p.proposalId,
        skillName: p.draft?.title ?? p.proposalId,
        purpose: p.draft?.purpose ?? '',
        requiredPermissions:
          p.approvalRequiredPermissions?.length ? p.approvalRequiredPermissions : p.requestedPermissions ?? [],
        riskLevel: normalizeRisk(p.risk),
      }));
    const brainArtifacts = buildArtifactSummary(artifacts);
    const capabilityPacks = installedPacks.map(toPackRow);

    const enabledSkills = skills.filter((s) => s.enabled).length;

    return {
      schemaVersion: 1,
      generatedAt,
      status,
      providerHealth: resolveProviderHealth(),
      skillStatus: {
        total: skills.length,
        enabled: enabledSkills,
        disabled: skills.filter((s) => !s.enabled && !s.lockedReason).length,
        locked: skills.filter((s) => s.lockedReason !== null).length,
        pendingApproval: pendingApprovals.length,
      },
      skills,
      skillCatalog,
      pendingApprovals,
      capabilityPacks,
      evolutionSuggestions: [],
      packStatus: {
        total: capabilityPacks.length,
        installed: installedPacks.length,
        updateAvailable: 0,
      },
      approvals: {
        pending: pendingApprovals.length,
        skillProposals: pendingApprovals.length,
        evolutionSuggestions: 0,
      },
      brainArtifacts,
      ledgerSuggestions: {
        total: 0,
        pending: 0,
        approved: 0,
        rejected: 0,
        deferred: 0,
        superseded: 0,
      },
      counts: {
        skills: skills.length,
        enabledSkills,
        installedPacks: installedPacks.length,
        pendingApprovals: pendingApprovals.length,
        brainArtifacts: brainArtifacts.fresh + brainArtifacts.stale,
        staleBrainArtifacts: brainArtifacts.stale,
        ledgerSuggestions: 0,
        pendingLedgerSuggestions: 0,
      },
    };
  }

  async function executeAction(action: SparkExtensionAction): Promise<SparkExtensionActionResult> {
    if (action.type === 'toggle-extension') {
      enabled = action.enabled;
      if (enabled) {
        await ensureRuntime();
      }
      return result(action.type, true, 'Spark extension toggled.', await buildSnapshot());
    }

    const rt = await ensureRuntime();
    if (!rt) {
      return {
        ok: false,
        actionType: action.type,
        reason: 'adapter_failed',
        message: loadError ?? 'Spark Brain runtime is not available.',
        snapshot: await buildSnapshot(),
      };
    }

    switch (action.type) {
      case 'toggle-skill': {
        const res = action.enabled
          ? rt.skillRegistry.enable(action.skillId)
          : rt.skillRegistry.disable(action.skillId, 'Disabled from Spark settings.');
        return toActionResult(action.type, res, await buildSnapshot());
      }
      case 'install-pack': {
        const res = await rt.capabilityPackRegistry.install({ id: action.packId });
        return toActionResult(action.type, res, await buildSnapshot());
      }
      case 'uninstall-pack': {
        const res = await rt.capabilityPackRegistry.uninstall(action.packId);
        return toActionResult(action.type, res, await buildSnapshot());
      }
      case 'approve-skill': {
        const res = rt.skillCreator.approveProposal(action.proposalId, { enableNow: action.enableNow });
        return toActionResult(action.type, res, await buildSnapshot());
      }
      case 'reject-skill': {
        const res = rt.skillCreator.rejectProposal(action.proposalId, action.reason);
        return toActionResult(action.type, res, await buildSnapshot());
      }
      case 'approve-suggestion': {
        const res = rt.improvementLedger.approve(action.suggestionId);
        return toActionResult(action.type, res, await buildSnapshot());
      }
      case 'reject-suggestion': {
        const res = rt.improvementLedger.reject(action.suggestionId, action.reason);
        return toActionResult(action.type, res, await buildSnapshot());
      }
      case 'view-artifact': {
        const artifacts = await safeAsyncArray(() => rt.store.listArtifacts(rt.projectId));
        const match = artifacts.find((a) => a.artifactKind === action.artifactName);
        return {
          ok: Boolean(match),
          actionType: action.type,
          reason: match ? 'not_implemented' : 'adapter_failed',
          message: match ? 'Artifact loaded.' : 'Artifact has not been rendered yet.',
          data: match ? { markdownContent: match.content, renderedAt: match.renderedAt } : null,
        };
      }
      case 'configure-provider':
        return result(action.type, false, 'Provider configuration is not available yet.', await buildSnapshot(), 'not_implemented');
      default:
        return result((action as { type: never }).type, false, 'Unsupported action.', await buildSnapshot());
    }
  }

  return {
    getSnapshot: () => buildSnapshot(),
    executeAction,
    async getRuntimeToolRegistry() {
      const rt = enabled ? await ensureRuntime() : runtime;
      return rt?.runtimeToolRegistry ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function toSkillRow(skill: SparkBrainInstalledSkillLike): SparkSkillRow {
  const m = skill.manifest;
  const locked = !skill.canDisable || skill.alwaysAvailable;
  return {
    skillId: m.id,
    name: m.title,
    namespace: m.namespace,
    source: mapSkillSource(skill.sourceKind),
    version: m.version,
    enabled: skill.status === 'enabled',
    packSource: skill.packSource ?? null,
    permissions: m.permissions ?? [],
    supportedTools: m.supportedTools ?? [],
    outputContracts: Object.keys(m.outputContract ?? {}),
    hasExecutableRegistration: (m.supportedTools ?? []).length > 0,
    health: skill.status === 'blocked' ? 'unavailable' : skill.status === 'enabled' ? 'ready' : 'unknown',
    lockedReason: skill.status === 'blocked'
      ? skill.disabledReason ?? 'Skill is blocked by an unavailable capability.'
      : locked
        ? 'Platform skill is always available and cannot be disabled.'
        : null,
  };
}

function buildCatalog(rt: SparkBrainRuntimeLike): SparkSkillCatalogItem[] {
  const fromPack = rt.coreSkillPack.skills.map((m) => toCatalogItem(m, 'core', rt.coreSkillPack.id));
  const native = (rt.nativeSkills as Array<{ manifest?: SparkBrainSkillManifestLike }>)
    .map((d) => d?.manifest)
    .filter((m): m is SparkBrainSkillManifestLike => Boolean(m))
    .map((m) => toCatalogItem(m, 'vault-native'));
  return [...fromPack, ...native];
}

function toCatalogItem(
  m: SparkBrainSkillManifestLike,
  source: SparkSkillSource,
  packSource?: string,
): SparkSkillCatalogItem {
  return {
    skillId: m.id,
    name: m.title,
    namespace: m.namespace,
    source,
    version: m.version,
    packSource: packSource ?? m.packId ?? null,
    permissions: m.permissions ?? [],
    supportedTools: m.supportedTools ?? [],
    outputContracts: Object.keys(m.outputContract ?? {}),
    hasExecutableRegistration: (m.supportedTools ?? []).length > 0,
    category: m.namespace,
    description: m.purpose ?? null,
  };
}

function toPackRow(pack: SparkBrainInstalledPackLike): SparkCapabilityPackRow {
  return {
    packId: pack.manifest.id,
    name: pack.manifest.title,
    description: pack.manifest.description ?? null,
    installed: pack.status === 'active',
    includedSkills: pack.manifest.skills.map((s) => s.id),
  };
}

function buildArtifactSummary(artifacts: BrainVaultArtifact[]): SparkExtensionSnapshot['brainArtifacts'] {
  const summaries: SparkBrainArtifactSummary[] = artifacts.map((a) => ({
    artifactName: a.artifactKind as SparkBrainArtifactName,
    freshness: 'fresh',
    renderedAt: a.renderedAt,
    generatedAt: a.renderedAt,
    contentHash: a.contentHash,
    markdownContent: a.content,
    sourceProject: a.provenance?.projectName ?? null,
    staleReason: null,
  }));
  const present = new Set(summaries.map((s) => s.artifactName));
  const missing = SPARK_BRAIN_ARTIFACT_NAMES.filter((name) => !present.has(name)).length;
  const latest = summaries
    .map((s) => s.generatedAt)
    .filter((v): v is string => Boolean(v))
    .sort()
    .pop();
  return {
    fresh: summaries.length,
    stale: 0,
    missing,
    latestGeneratedAt: latest ?? null,
    artifacts: summaries,
  };
}

function mapSkillSource(sourceKind: string): SparkSkillSource {
  switch (sourceKind) {
    case 'core':
      return 'core';
    case 'platform':
      return 'vault-native';
    case 'pack':
      return 'pack';
    default:
      return 'custom';
  }
}

function normalizeRisk(risk: string): SparkApprovalRiskLevel {
  return RISK_LEVELS.has(risk as SparkApprovalRiskLevel) ? (risk as SparkApprovalRiskLevel) : 'medium';
}

function toActionResult(
  actionType: SparkExtensionAction['type'],
  res: SparkBrainResultLike<unknown>,
  snapshot: SparkExtensionSnapshot,
): SparkExtensionActionResult {
  return {
    ok: res.ok,
    actionType,
    reason: res.ok ? 'not_implemented' : 'adapter_failed',
    message: res.ok ? 'Action applied.' : res.error?.message ?? 'Spark Brain rejected the action.',
    snapshot,
  };
}

function result(
  actionType: SparkExtensionAction['type'],
  okFlag: boolean,
  message: string,
  snapshot: SparkExtensionSnapshot,
  reason: SparkExtensionActionResult['reason'] = okFlag ? 'not_implemented' : 'adapter_failed',
): SparkExtensionActionResult {
  return { ok: okFlag, actionType, reason, message, snapshot };
}

function emptyProviderHealth(): SparkProviderHealthSummary {
  return {
    activeProviderId: null,
    activeProviderMode: null,
    ready: 0,
    degraded: 0,
    unavailable: 0,
    unknown: 0,
    providers: [],
  };
}

function emptySnapshot(
  generatedAt: string,
  status: SparkExtensionStatus,
  providerHealth: SparkProviderHealthSummary = emptyProviderHealth(),
): SparkExtensionSnapshot {
  return {
    schemaVersion: 1,
    generatedAt,
    status,
    providerHealth,
    skillStatus: { total: 0, enabled: 0, disabled: 0, locked: 0, pendingApproval: 0 },
    skills: [],
    skillCatalog: [],
    pendingApprovals: [],
    capabilityPacks: [],
    evolutionSuggestions: [],
    packStatus: { total: 0, installed: 0, updateAvailable: 0 },
    approvals: { pending: 0, skillProposals: 0, evolutionSuggestions: 0 },
    brainArtifacts: { fresh: 0, stale: 0, missing: SPARK_BRAIN_ARTIFACT_NAMES.length, latestGeneratedAt: null, artifacts: [] },
    ledgerSuggestions: { total: 0, pending: 0, approved: 0, rejected: 0, deferred: 0, superseded: 0 },
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

function safeArray<T>(fn: () => T[]): T[] {
  try {
    const value = fn();
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

async function safeAsyncArray<T>(fn: () => Promise<T[]>): Promise<T[]> {
  try {
    const value = await fn();
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
