import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  SparkBrainArtifactFreshness,
  SparkBrainArtifactName,
  SparkBrainArtifactSummary,
  SparkApprovalRiskLevel,
  SparkApproveSuggestionAction,
  SparkApproveSkillAction,
  SparkConfigureProviderAction,
  SparkEvolutionSuggestionConfidenceLevel,
  SparkEvolutionSuggestionRow,
  SparkEvolutionSuggestionType,
  SparkExtensionAction,
  SparkExtensionActionResult,
  SparkExtensionActionType,
  SparkExtensionInstallState,
  SparkExtensionSnapshot,
  SparkCapabilityPackRow,
  SparkInstallPackAction,
  SparkPendingApprovalRow,
  SparkProviderCredentialState,
  SparkProviderHealthSnapshot,
  SparkProviderHealthState,
  SparkProviderMode,
  SparkRejectSuggestionAction,
  SparkRejectSkillAction,
  SparkSkillCatalogItem,
  SparkSkillHealthState,
  SparkSkillRow,
  SparkToggleExtensionAction,
  SparkToggleSkillAction,
  SparkUninstallPackAction,
  SparkProviderAuthStyle,
  SparkProviderCredentialStateView,
  SparkProviderRole,
  SparkRoleAssignments,
} from '@the-vault/core';
import {
  getDefaultRoleAssignments,
  getProvidersForRole,
  getSparkProviderCatalog,
  SPARK_DEFAULT_PROVIDER_ID,
  SPARK_PROVIDER_ROLES,
} from './spark/spark-provider-catalog-renderer.js';

const SPARK_BRAIN_ARTIFACT_ORDER: readonly SparkBrainArtifactName[] = [
  'SPARK.md',
  'USER.md',
  'MEMORY.md',
  'VAULT.md',
  'SKILLS.md',
  'CONTEXT.md',
];

export type SparkSettingsTabId =
  | 'overview'
  | 'providers'
  | 'skills'
  | 'approvals'
  | 'packs'
  | 'brain'
  | 'evolution';

export interface SparkSettingsTabModel {
  id: SparkSettingsTabId;
  label: string;
  tabId: string;
  panelId: string;
  placeholder: string;
}

export interface SparkSettingsStatusModel {
  state: SparkExtensionInstallState;
  primaryLabel: string;
  detail: string;
  sourceLabel: string;
  versionLabel: string;
  enabledLabel: string;
  issueCount: number;
  installCommands: string[];
}

export interface SparkOverviewMetricModel {
  label: string;
  value: string;
}

export interface SparkOverviewModel {
  installStatusLabel: string;
  installDetail: string;
  sourceLabel: string;
  versionLabel: string;
  activeProviderLabel: string;
  extensionToggle: {
    enabled: boolean;
    label: string;
    disabled: boolean;
    action: SparkToggleExtensionAction | null;
  };
  brainProjectLink: {
    label: string;
    href: string;
  } | null;
  lastSyncLabel: string;
  healthSummary: string;
  issues: string[];
  metrics: SparkOverviewMetricModel[];
}

export type SparkProviderUiHealth = 'healthy' | 'degraded' | 'unavailable';

export interface SparkProviderRowModel {
  providerId: string;
  name: string;
  health: SparkProviderUiHealth;
  healthLabel: string;
  healthClassName: string;
  activeModeLabel: string;
  lastCheckedLabel: string;
  credentialIndicatorLabel: string;
  configureAction: SparkConfigureProviderAction;
}

export interface SparkProvidersModel {
  summaryLabel: string;
  emptyLabel: string;
  rows: SparkProviderRowModel[];
}

export interface SparkInstalledSkillRowModel {
  skillId: string;
  name: string;
  namespace: string;
  versionLabel: string;
  sourceLabel: string;
  stateLabel: string;
  stateClassName: string;
  packSourceLabel: string;
  permissionsSummary: string;
  executionLabel: string;
  supportedToolsSummary: string;
  outputContractsSummary: string;
  healthLabel: string;
  lockedReasonLabel: string | null;
  toggleLabel: string;
  toggleDisabled: boolean;
  toggleAction: SparkToggleSkillAction | null;
}

export interface SparkCatalogSkillRowModel {
  skillId: string;
  name: string;
  namespace: string;
  versionLabel: string;
  sourceLabel: string;
  packSourceLabel: string;
  permissionsSummary: string;
  executionLabel: string;
  supportedToolsSummary: string;
  outputContractsSummary: string;
  categoryLabel: string;
  description: string;
}

export interface SparkSkillsModel {
  summaryLabel: string;
  installedEmptyLabel: string;
  catalogEmptyLabel: string;
  installedRows: SparkInstalledSkillRowModel[];
  catalogRows: SparkCatalogSkillRowModel[];
}

export interface SparkPendingApprovalRowModel {
  proposalId: string;
  skillName: string;
  purpose: string;
  requiredPermissionsSummary: string;
  riskLevel: SparkApprovalRiskLevel;
  riskLabel: string;
  riskClassName: string;
  highRisk: boolean;
  approveAction: SparkApproveSkillAction;
  rejectAction: SparkRejectSkillAction;
}

export interface SparkApprovalsModel {
  summaryLabel: string;
  emptyLabel: string;
  rows: SparkPendingApprovalRowModel[];
}

export interface SparkCapabilityPackRowModel {
  packId: string;
  name: string;
  description: string;
  includedSkillsCountLabel: string;
  statusLabel: 'Installed' | 'Available';
  statusClassName: string;
  actionLabel: 'Install' | 'Uninstall';
  actionClassName: 'primary-button' | 'danger-button';
  action: SparkInstallPackAction | SparkUninstallPackAction;
  includedSkills: string[];
}

export interface SparkPacksModel {
  summaryLabel: string;
  emptyLabel: string;
  rows: SparkCapabilityPackRowModel[];
}

export interface SparkBrainArtifactRowModel {
  artifactName: SparkBrainArtifactName;
  displayName: string;
  freshness: SparkBrainArtifactFreshness;
  freshnessLabel: string;
  freshnessClassName: string;
  renderedAtLabel: string;
  contentHashLabel: string;
  sourceProjectLabel: string;
  staleReasonLabel: string | null;
  markdownContent: string;
}

export interface SparkBrainModel {
  summaryLabel: string;
  rows: SparkBrainArtifactRowModel[];
}

export interface SparkEvolutionSuggestionRowModel {
  suggestionId: string;
  typeLabel: string;
  description: string;
  confidenceLevel: SparkEvolutionSuggestionConfidenceLevel;
  confidenceLabel: string;
  confidenceClassName: string;
  highConfidence: boolean;
  approveAction: SparkApproveSuggestionAction;
  rejectAction: SparkRejectSuggestionAction;
}

export interface SparkEvolutionModel {
  summaryLabel: string;
  emptyLabel: string;
  rows: SparkEvolutionSuggestionRowModel[];
}

export interface SparkSettingsSnapshotLoadResult {
  snapshot: SparkExtensionSnapshot | null;
  error: string | null;
}

export interface SparkSettingsActionRunResult {
  result: SparkExtensionActionResult | null;
  snapshot: SparkExtensionSnapshot | null;
  error: string | null;
}

export interface SparkSettingsApi {
  getSnapshot: () => Promise<VaultResponse<SparkExtensionSnapshot>>;
  executeAction?: (input: SparkExtensionAction) => Promise<VaultResponse<SparkExtensionActionResult>>;
  // S2 secure provider credential channels (optional — absent in tests/older bridges).
  setProviderCredential?: (
    providerId: string,
    key: string,
    baseUrl?: string | null,
  ) => Promise<VaultResponse<SparkProviderCredentialStateView>>;
  getProviderCredentialState?: (
    providerId: string,
  ) => Promise<VaultResponse<SparkProviderCredentialStateView>>;
  setRoleAssignment?: (
    role: SparkProviderRole,
    providerId: string,
  ) => Promise<VaultResponse<SparkRoleAssignments>>;
  getRoleAssignments?: () => Promise<VaultResponse<SparkRoleAssignments>>;
}

export interface SparkSettingsViewModel {
  activeTab: SparkSettingsTabModel;
  activeTabId: SparkSettingsTabId;
  tabs: readonly SparkSettingsTabModel[];
  setActiveTabId: (tabId: SparkSettingsTabId) => void;
  snapshot: SparkExtensionSnapshot | null;
  status: SparkSettingsStatusModel;
  overview: SparkOverviewModel;
  providers: SparkProvidersModel;
  providerRegistry: SparkProviderRegistryModel;
  skills: SparkSkillsModel;
  approvals: SparkApprovalsModel;
  packs: SparkPacksModel;
  brain: SparkBrainModel;
  evolution: SparkEvolutionModel;
  loading: boolean;
  error: string | null;
  actionError: string | null;
  pendingAction: SparkExtensionActionType | null;
  actionPendingProviderId: string | null;
  actionPendingRole: SparkProviderRole | null;
  actionPendingSkillId: string | null;
  actionPendingApprovalId: string | null;
  actionPendingPackId: string | null;
  actionPendingSuggestionId: string | null;
  refresh: () => Promise<void>;
  toggleExtension: () => Promise<void>;
  configureProvider: (providerId: string) => Promise<void>;
  configureProviderCredential: (providerId: string, key: string, baseUrl?: string | null) => Promise<void>;
  assignRole: (role: SparkProviderRole, providerId: string) => Promise<void>;
  toggleSkill: (skillId: string) => Promise<void>;
  approveSkill: (proposalId: string) => Promise<void>;
  rejectSkill: (proposalId: string) => Promise<void>;
  installPack: (packId: string) => Promise<void>;
  uninstallPack: (packId: string) => Promise<void>;
  approveSuggestion: (suggestionId: string) => Promise<void>;
  rejectSuggestion: (suggestionId: string) => Promise<void>;
}

export const SPARK_SETTINGS_TABS: readonly SparkSettingsTabModel[] = [
  sparkSettingsTab('overview', 'Overview', 'Overview placeholder for future Spark status controls.'),
  sparkSettingsTab('providers', 'Providers', 'Providers placeholder for future provider configuration.'),
  sparkSettingsTab('skills', 'Skills', 'Skills placeholder for future installed skill and catalog controls.'),
  sparkSettingsTab('approvals', 'Approvals', 'Approvals placeholder for future Skill Creator review queues.'),
  sparkSettingsTab('packs', 'Packs', 'Packs placeholder for future capability pack previews.'),
  sparkSettingsTab('brain', 'Brain', 'Brain placeholder for future read-only Spark Brain artifacts.'),
  sparkSettingsTab('evolution', 'Evolution', 'Evolution placeholder for future Self Evolution suggestions.'),
];

const stateLabels: Record<SparkExtensionInstallState, string> = {
  missing: 'Spark missing',
  installable: 'Spark installable',
  installedDisabled: 'Spark installed disabled',
  bootstrapping: 'Spark bootstrapping',
  ready: 'Spark ready',
  degraded: 'Spark degraded',
  failed: 'Spark failed',
};

export function getNextSparkSettingsTabId(
  currentTabId: SparkSettingsTabId,
  key: string,
): SparkSettingsTabId {
  const currentIndex = SPARK_SETTINGS_TABS.findIndex((tab) => tab.id === currentTabId);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;

  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return SPARK_SETTINGS_TABS[(safeIndex + 1) % SPARK_SETTINGS_TABS.length].id;
    case 'ArrowLeft':
    case 'ArrowUp':
      return SPARK_SETTINGS_TABS[
        (safeIndex - 1 + SPARK_SETTINGS_TABS.length) % SPARK_SETTINGS_TABS.length
      ].id;
    case 'Home':
      return SPARK_SETTINGS_TABS[0].id;
    case 'End':
      return SPARK_SETTINGS_TABS[SPARK_SETTINGS_TABS.length - 1].id;
    default:
      return currentTabId;
  }
}

export async function fetchSparkSettingsSnapshot(
  sparkApi: SparkSettingsApi,
): Promise<SparkSettingsSnapshotLoadResult> {
  try {
    const response = await sparkApi.getSnapshot();
    if (!response.success) {
      return {
        snapshot: null,
        error: response.error || 'Failed to load Spark settings snapshot.',
      };
    }

    if (!response.data) {
      return {
        snapshot: null,
        error: 'Spark settings snapshot was empty.',
      };
    }

    return {
      snapshot: response.data,
      error: null,
    };
  } catch (error) {
    return {
      snapshot: null,
      error: error instanceof Error ? error.message : 'Failed to load Spark settings snapshot.',
    };
  }
}

export async function performSparkSettingsAction(
  sparkApi: SparkSettingsApi,
  action: SparkExtensionAction,
): Promise<SparkSettingsActionRunResult> {
  if (!sparkApi.executeAction) {
    return {
      result: null,
      snapshot: null,
      error: 'Spark settings action bridge is unavailable.',
    };
  }

  try {
    const response = await sparkApi.executeAction(action);
    if (!response.success) {
      return {
        result: null,
        snapshot: null,
        error: response.error || 'Spark settings action failed.',
      };
    }

    if (!response.data) {
      return {
        result: null,
        snapshot: null,
        error: 'Spark settings action returned an empty response.',
      };
    }

    return {
      result: response.data,
      snapshot: response.data.snapshot ?? null,
      error: null,
    };
  } catch (error) {
    return {
      result: null,
      snapshot: null,
      error: error instanceof Error ? error.message : 'Spark settings action failed.',
    };
  }
}

export function buildToggleSparkExtensionAction(enabled: boolean): SparkToggleExtensionAction {
  return {
    type: 'toggle-extension',
    enabled,
  };
}

export function buildConfigureProviderAction(providerId: string): SparkConfigureProviderAction {
  return {
    type: 'configure-provider',
    providerId,
  };
}

export function buildToggleSparkSkillAction(skillId: string, enabled: boolean): SparkToggleSkillAction {
  return {
    type: 'toggle-skill',
    skillId,
    enabled,
  };
}

export function buildApproveSparkSkillAction(proposalId: string): SparkApproveSkillAction {
  return {
    type: 'approve-skill',
    proposalId,
  };
}

export function buildRejectSparkSkillAction(
  proposalId: string,
  reason = 'Rejected from Spark settings approvals queue.',
): SparkRejectSkillAction {
  return {
    type: 'reject-skill',
    proposalId,
    reason,
  };
}

export function buildInstallSparkPackAction(packId: string): SparkInstallPackAction {
  return {
    type: 'install-pack',
    packId,
  };
}

export function buildUninstallSparkPackAction(packId: string): SparkUninstallPackAction {
  return {
    type: 'uninstall-pack',
    packId,
  };
}

export function buildApproveSparkSuggestionAction(
  suggestionId: string,
  routeTarget?: SparkApproveSuggestionAction['routeTarget'],
): SparkApproveSuggestionAction {
  return {
    type: 'approve-suggestion',
    suggestionId,
    ...(routeTarget ? { routeTarget } : {}),
  };
}

export function buildRejectSparkSuggestionAction(
  suggestionId: string,
  reason = 'Rejected from Spark settings evolution suggestions.',
): SparkRejectSuggestionAction {
  return {
    type: 'reject-suggestion',
    suggestionId,
    reason,
  };
}

export function buildSparkOverviewModel(
  snapshot: SparkExtensionSnapshot | null,
): SparkOverviewModel {
  const status = buildSparkSettingsStatusModel(snapshot);
  const enabled = Boolean(snapshot?.status.enabled);
  const toggleDisabled = !snapshot || snapshot.status.installState === 'missing' || snapshot.status.installState === 'bootstrapping';
  const brainProject = snapshot?.status.brainProject?.trim() || null;

  return {
    installStatusLabel: status.primaryLabel,
    installDetail: status.detail,
    sourceLabel: status.sourceLabel,
    versionLabel: status.versionLabel,
    activeProviderLabel: buildActiveProviderLabel(snapshot),
    extensionToggle: {
      enabled,
      label: enabled ? 'Disable Spark' : 'Enable Spark',
      disabled: toggleDisabled,
      action: toggleDisabled ? null : buildToggleSparkExtensionAction(!enabled),
    },
    brainProjectLink: brainProject
      ? {
          label: brainProject,
          href: `#vault-project-${encodeURIComponent(brainProject)}`,
        }
      : null,
    lastSyncLabel: snapshot ? `Last sync ${formatSparkTimestamp(snapshot.generatedAt)}` : 'Last sync unavailable',
    healthSummary: buildProviderHealthSummary(snapshot),
    issues: snapshot?.status.issues ?? [],
    metrics: [
      { label: 'Pending approvals', value: formatSparkCount(snapshot?.counts.pendingApprovals) },
      { label: 'Installed skills', value: formatSparkCount(snapshot?.counts.skills) },
      { label: 'Installed packs', value: formatSparkCount(snapshot?.counts.installedPacks) },
      { label: 'Brain artifacts', value: formatSparkCount(snapshot?.counts.brainArtifacts) },
    ],
  };
}

export function buildSparkProvidersModel(
  snapshot: SparkExtensionSnapshot | null,
): SparkProvidersModel {
  if (!snapshot || snapshot.providerHealth.providers.length === 0) {
    return {
      summaryLabel: buildProviderHealthSummary(snapshot),
      emptyLabel: 'No Spark providers are configured yet.',
      rows: [],
    };
  }

  const activeProviderId = snapshot.providerHealth.activeProviderId ?? snapshot.status.activeProviderId;
  const activeProviderMode = snapshot.providerHealth.activeProviderMode ?? snapshot.status.activeProviderMode;
  const rows = snapshot.providerHealth.providers
    .map((provider) => buildProviderRow(provider, activeProviderId, activeProviderMode))
    .sort(compareProviderRows);

  return {
    summaryLabel: buildProviderHealthSummary(snapshot),
    emptyLabel: 'No Spark providers are configured yet.',
    rows,
  };
}

// --- S2: provider registry (catalog + role assignments) -------------------

export interface SparkProviderCatalogRowModel {
  providerId: string;
  name: string;
  description: string;
  roles: SparkProviderRole[];
  rolesLabel: string;
  authStyle: SparkProviderAuthStyle;
  requiresBaseUrl: boolean;
  requiresKey: boolean;
  isDefault: boolean;
  defaultBaseUrl: string | null;
  configured: boolean;
  statusLabel: string;
  statusClassName: string;
}

export interface SparkRoleAssignmentOptionModel {
  providerId: string;
  name: string;
}

export interface SparkRoleAssignmentRowModel {
  role: SparkProviderRole;
  label: string;
  selectedProviderId: string;
  options: SparkRoleAssignmentOptionModel[];
}

export interface SparkProviderRegistryModel {
  catalogRows: SparkProviderCatalogRowModel[];
  roleAssignmentRows: SparkRoleAssignmentRowModel[];
  configuredCount: number;
  summaryLabel: string;
}

const SPARK_ROLE_LABELS: Record<SparkProviderRole, string> = {
  STT: 'Speech-to-text',
  LLM: 'Language model',
  Realtime: 'Realtime',
  TTS: 'Text-to-speech',
};

export function buildSparkProviderCatalogRows(
  snapshot: SparkExtensionSnapshot | null,
): SparkProviderCatalogRowModel[] {
  const configuredById = new Map(
    (snapshot?.providerHealth.providers ?? []).map(
      (provider) => [provider.providerId, provider.credentialState === 'configured'] as const,
    ),
  );

  return getSparkProviderCatalog().map((entry) => {
    const configured = configuredById.get(entry.id) ?? false;
    const requiresKey = entry.authStyle !== 'none';
    return {
      providerId: entry.id,
      name: entry.displayName,
      description: entry.description ?? '',
      roles: entry.roles,
      rolesLabel: entry.roles.join(' · '),
      authStyle: entry.authStyle,
      requiresBaseUrl: Boolean(entry.baseUrlRequired),
      requiresKey,
      isDefault: Boolean(entry.isDefault),
      defaultBaseUrl: entry.baseUrl ?? null,
      configured,
      statusLabel: configured
        ? 'Configured'
        : entry.isDefault
          ? 'Default — configure your VPS'
          : 'Not configured',
      statusClassName: configured ? 'spark-provider-health-healthy' : 'spark-provider-health-unavailable',
    };
  });
}

export function buildSparkRoleAssignmentRows(
  snapshot: SparkExtensionSnapshot | null,
): SparkRoleAssignmentRowModel[] {
  const assignments = snapshot?.providerHealth.roleAssignments ?? getDefaultRoleAssignments();
  return SPARK_PROVIDER_ROLES.map((role) => ({
    role,
    label: SPARK_ROLE_LABELS[role],
    selectedProviderId: assignments[role] ?? SPARK_DEFAULT_PROVIDER_ID,
    options: getProvidersForRole(role).map((provider) => ({
      providerId: provider.id,
      name: provider.displayName,
    })),
  }));
}

export function buildSparkProviderRegistryModel(
  snapshot: SparkExtensionSnapshot | null,
): SparkProviderRegistryModel {
  const catalogRows = buildSparkProviderCatalogRows(snapshot);
  const configuredCount = catalogRows.filter((row) => row.configured).length;
  return {
    catalogRows,
    roleAssignmentRows: buildSparkRoleAssignmentRows(snapshot),
    configuredCount,
    summaryLabel: `${configuredCount} of ${catalogRows.length} providers configured`,
  };
}

export function buildSparkSkillsModel(
  snapshot: SparkExtensionSnapshot | null,
): SparkSkillsModel {
  const installedSkills = snapshot?.skills ?? [];
  const installedSkillIds = new Set(installedSkills.map((skill) => skill.skillId));
  const catalogRows = (snapshot?.skillCatalog ?? [])
    .filter((item) => !installedSkillIds.has(item.skillId))
    .map(buildCatalogSkillRow);

  return {
    summaryLabel: buildSkillSummaryLabel(snapshot),
    installedEmptyLabel: 'No Spark skills are installed yet.',
    catalogEmptyLabel: 'No uninstalled Spark catalog skills are available.',
    installedRows: installedSkills.map(buildInstalledSkillRow),
    catalogRows,
  };
}

export function buildSparkApprovalsModel(
  snapshot: SparkExtensionSnapshot | null,
): SparkApprovalsModel {
  const rows = (snapshot?.pendingApprovals ?? [])
    .map(buildPendingApprovalRow)
    .sort(compareApprovalRows);

  return {
    summaryLabel: `${rows.length} pending skill approval${rows.length === 1 ? '' : 's'}`,
    emptyLabel: 'No pending Skill Creator approvals.',
    rows,
  };
}

export function buildSparkPacksModel(
  snapshot: SparkExtensionSnapshot | null,
): SparkPacksModel {
  const rows = (snapshot?.capabilityPacks ?? [])
    .map(buildCapabilityPackRow)
    .sort(compareCapabilityPackRows);
  const installed = rows.filter((row) => row.statusLabel === 'Installed').length;
  const available = rows.length - installed;

  return {
    summaryLabel: `${installed} installed / ${available} available packs`,
    emptyLabel: 'No Spark capability packs are available yet.',
    rows,
  };
}

export function buildSparkBrainModel(
  snapshot: SparkExtensionSnapshot | null,
): SparkBrainModel {
  const artifactByName = new Map<SparkBrainArtifactName, SparkBrainArtifactSummary>();
  for (const artifact of snapshot?.brainArtifacts?.artifacts ?? []) {
    artifactByName.set(artifact.artifactName, artifact);
  }

  const rows = SPARK_BRAIN_ARTIFACT_ORDER.map((artifactName) => buildBrainArtifactRow(
    artifactName,
    artifactByName.get(artifactName),
  ));
  const counts = rows.reduce((accumulator, row) => {
    accumulator[row.freshness] += 1;
    return accumulator;
  }, {
    fresh: 0,
    stale: 0,
    missing: 0,
  } satisfies Record<SparkBrainArtifactFreshness, number>);

  return {
    summaryLabel: `${counts.fresh} fresh / ${counts.stale} stale / ${counts.missing} missing Brain artifacts`,
    rows,
  };
}

export function buildSparkEvolutionModel(
  snapshot: SparkExtensionSnapshot | null,
): SparkEvolutionModel {
  const rows = (snapshot?.evolutionSuggestions ?? [])
    .map(buildEvolutionSuggestionRow)
    .sort(compareEvolutionSuggestionRows);
  const highConfidenceCount = rows.filter((row) => row.highConfidence).length;

  return {
    summaryLabel: `${rows.length} pending Self Evolution suggestion${rows.length === 1 ? '' : 's'} / ${highConfidenceCount} high confidence`,
    emptyLabel: 'No pending Self Evolution suggestions.',
    rows,
  };
}

export function buildSparkSettingsStatusModel(
  snapshot: SparkExtensionSnapshot | null,
): SparkSettingsStatusModel {
  if (!snapshot) {
    return {
      state: 'missing',
      primaryLabel: 'Spark settings unavailable',
      detail: 'Load the Spark extension snapshot to inspect settings state.',
      sourceLabel: 'unknown',
      versionLabel: 'not installed',
      enabledLabel: 'disabled',
      issueCount: 0,
      installCommands: [],
    };
  }

  return {
    state: snapshot.status.installState,
    primaryLabel: stateLabels[snapshot.status.installState],
    detail: snapshot.status.message,
    sourceLabel: snapshot.status.source,
    versionLabel: snapshot.status.version || 'not installed',
    enabledLabel: snapshot.status.enabled ? 'enabled' : 'disabled',
    issueCount: snapshot.status.issues.length,
    installCommands: normalizeSparkInstallCommands(snapshot.status.installCommands),
  };
}

function normalizeSparkInstallCommands(values: readonly string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => value.trim())
    .filter(Boolean);
}

export function useSparkSettingsViewModel(
  sparkApi: SparkSettingsApi | null = getWindowSparkApi(),
): SparkSettingsViewModel {
  const [activeTabId, setActiveTabId] = useState<SparkSettingsTabId>('overview');
  const [snapshot, setSnapshot] = useState<SparkExtensionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<SparkExtensionActionType | null>(null);
  const [actionPendingProviderId, setActionPendingProviderId] = useState<string | null>(null);
  const [actionPendingRole, setActionPendingRole] = useState<SparkProviderRole | null>(null);
  const [actionPendingSkillId, setActionPendingSkillId] = useState<string | null>(null);
  const [actionPendingApprovalId, setActionPendingApprovalId] = useState<string | null>(null);
  const [actionPendingPackId, setActionPendingPackId] = useState<string | null>(null);
  const [actionPendingSuggestionId, setActionPendingSuggestionId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!sparkApi) {
      setSnapshot(null);
      setError('Spark settings bridge is unavailable.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const result = await fetchSparkSettingsSnapshot(sparkApi);
    setSnapshot(result.snapshot);
    setError(result.error);
    setLoading(false);
  }, [sparkApi]);

  const runAction = useCallback(async (
    action: SparkExtensionAction,
    providerId: string | null = null,
    skillId: string | null = null,
    approvalId: string | null = null,
    packId: string | null = null,
    suggestionId: string | null = null,
  ) => {
    if (!sparkApi) {
      setActionError('Spark settings bridge is unavailable.');
      return;
    }

    setPendingAction(action.type);
    setActionPendingProviderId(providerId);
    setActionPendingSkillId(skillId);
    setActionPendingApprovalId(approvalId);
    setActionPendingPackId(packId);
    setActionPendingSuggestionId(suggestionId);
    setActionError(null);

    const result = await performSparkSettingsAction(sparkApi, action);
    if (result.snapshot) {
      setSnapshot(result.snapshot);
    } else if (!result.error && result.result?.ok) {
      await refresh();
    }

    setActionError(result.error ?? (result.result && !result.result.ok ? result.result.message : null));
    setPendingAction(null);
    setActionPendingProviderId(null);
    setActionPendingSkillId(null);
    setActionPendingApprovalId(null);
    setActionPendingPackId(null);
    setActionPendingSuggestionId(null);
  }, [refresh, sparkApi]);

  const toggleExtension = useCallback(async () => {
    if (!snapshot) {
      setActionError('Spark settings snapshot is unavailable.');
      return;
    }

    await runAction(buildToggleSparkExtensionAction(!snapshot.status.enabled));
  }, [runAction, snapshot]);

  const configureProvider = useCallback(async (providerId: string) => {
    await runAction(buildConfigureProviderAction(providerId), providerId);
  }, [runAction]);

  // S2: store a provider credential through the dedicated secure channel (never
  // executeAction). The key is sent one-way; only credential state comes back,
  // after which we refresh the snapshot to update provider health.
  const configureProviderCredential = useCallback(async (
    providerId: string,
    key: string,
    baseUrl: string | null = null,
  ) => {
    if (!sparkApi?.setProviderCredential) {
      setActionError('Spark provider credential bridge is unavailable.');
      return;
    }

    setActionPendingProviderId(providerId);
    setActionError(null);
    try {
      const response = await sparkApi.setProviderCredential(providerId, key, baseUrl);
      if (!response.success) {
        setActionError(response.error || 'Failed to store the provider credential.');
      } else {
        await refresh();
      }
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Failed to store the provider credential.');
    } finally {
      setActionPendingProviderId(null);
    }
  }, [refresh, sparkApi]);

  // S2: assign a provider to a capability role through the dedicated channel.
  const assignRole = useCallback(async (role: SparkProviderRole, providerId: string) => {
    if (!sparkApi?.setRoleAssignment) {
      setActionError('Spark role-assignment bridge is unavailable.');
      return;
    }

    setActionPendingRole(role);
    setActionError(null);
    try {
      const response = await sparkApi.setRoleAssignment(role, providerId);
      if (!response.success) {
        setActionError(response.error || 'Failed to assign the provider role.');
      } else {
        await refresh();
      }
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Failed to assign the provider role.');
    } finally {
      setActionPendingRole(null);
    }
  }, [refresh, sparkApi]);

  const toggleSkill = useCallback(async (skillId: string) => {
    if (!snapshot) {
      setActionError('Spark settings snapshot is unavailable.');
      return;
    }

    const skill = (snapshot.skills ?? []).find((entry) => entry.skillId === skillId);
    if (!skill) {
      setActionError('Spark skill is not available in the current snapshot.');
      return;
    }

    const lockedReason = getSkillLockedReason(skill);
    if (lockedReason) {
      setActionError(lockedReason);
      return;
    }

    await runAction(buildToggleSparkSkillAction(skill.skillId, !skill.enabled), null, skill.skillId);
  }, [runAction, snapshot]);

  const approveSkill = useCallback(async (proposalId: string) => {
    if (!snapshot) {
      setActionError('Spark settings snapshot is unavailable.');
      return;
    }

    const proposal = (snapshot.pendingApprovals ?? []).find((entry) => entry.proposalId === proposalId);
    if (!proposal) {
      setActionError('Spark skill proposal is not available in the current snapshot.');
      return;
    }

    await runAction(buildApproveSparkSkillAction(proposal.proposalId), null, null, proposal.proposalId);
  }, [runAction, snapshot]);

  const rejectSkill = useCallback(async (proposalId: string) => {
    if (!snapshot) {
      setActionError('Spark settings snapshot is unavailable.');
      return;
    }

    const proposal = (snapshot.pendingApprovals ?? []).find((entry) => entry.proposalId === proposalId);
    if (!proposal) {
      setActionError('Spark skill proposal is not available in the current snapshot.');
      return;
    }

    await runAction(buildRejectSparkSkillAction(proposal.proposalId), null, null, proposal.proposalId);
  }, [runAction, snapshot]);

  const installPack = useCallback(async (packId: string) => {
    if (!snapshot) {
      setActionError('Spark settings snapshot is unavailable.');
      return;
    }

    const pack = (snapshot.capabilityPacks ?? []).find((entry) => entry.packId === packId);
    if (!pack) {
      setActionError('Spark capability pack is not available in the current snapshot.');
      return;
    }

    if (pack.installed) {
      setActionError('Spark capability pack is already installed.');
      return;
    }

    await runAction(buildInstallSparkPackAction(pack.packId), null, null, null, pack.packId);
  }, [runAction, snapshot]);

  const uninstallPack = useCallback(async (packId: string) => {
    if (!snapshot) {
      setActionError('Spark settings snapshot is unavailable.');
      return;
    }

    const pack = (snapshot.capabilityPacks ?? []).find((entry) => entry.packId === packId);
    if (!pack) {
      setActionError('Spark capability pack is not available in the current snapshot.');
      return;
    }

    if (!pack.installed) {
      setActionError('Spark capability pack is not installed.');
      return;
    }

    await runAction(buildUninstallSparkPackAction(pack.packId), null, null, null, pack.packId);
  }, [runAction, snapshot]);

  const approveSuggestion = useCallback(async (suggestionId: string) => {
    if (!snapshot) {
      setActionError('Spark settings snapshot is unavailable.');
      return;
    }

    const suggestion = (snapshot.evolutionSuggestions ?? []).find((entry) => entry.suggestionId === suggestionId);
    if (!suggestion) {
      setActionError('Spark evolution suggestion is not available in the current snapshot.');
      return;
    }

    const routeTarget = evolutionSuggestionRouteTargets[normalizeEvolutionSuggestionType(suggestion.type)];
    await runAction(buildApproveSparkSuggestionAction(suggestion.suggestionId, routeTarget), null, null, null, null, suggestion.suggestionId);
  }, [runAction, snapshot]);

  const rejectSuggestion = useCallback(async (suggestionId: string) => {
    if (!snapshot) {
      setActionError('Spark settings snapshot is unavailable.');
      return;
    }

    const suggestion = (snapshot.evolutionSuggestions ?? []).find((entry) => entry.suggestionId === suggestionId);
    if (!suggestion) {
      setActionError('Spark evolution suggestion is not available in the current snapshot.');
      return;
    }

    await runAction(buildRejectSparkSuggestionAction(suggestion.suggestionId), null, null, null, null, suggestion.suggestionId);
  }, [runAction, snapshot]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activeTab = useMemo(
    () => SPARK_SETTINGS_TABS.find((tab) => tab.id === activeTabId) ?? SPARK_SETTINGS_TABS[0],
    [activeTabId],
  );
  const status = useMemo(() => buildSparkSettingsStatusModel(snapshot), [snapshot]);
  const overview = useMemo(() => buildSparkOverviewModel(snapshot), [snapshot]);
  const providers = useMemo(() => buildSparkProvidersModel(snapshot), [snapshot]);
  const providerRegistry = useMemo(() => buildSparkProviderRegistryModel(snapshot), [snapshot]);
  const skills = useMemo(() => buildSparkSkillsModel(snapshot), [snapshot]);
  const approvals = useMemo(() => buildSparkApprovalsModel(snapshot), [snapshot]);
  const packs = useMemo(() => buildSparkPacksModel(snapshot), [snapshot]);
  const brain = useMemo(() => buildSparkBrainModel(snapshot), [snapshot]);
  const evolution = useMemo(() => buildSparkEvolutionModel(snapshot), [snapshot]);

  return {
    activeTab,
    activeTabId,
    tabs: SPARK_SETTINGS_TABS,
    setActiveTabId,
    snapshot,
    status,
    overview,
    providers,
    providerRegistry,
    skills,
    approvals,
    packs,
    brain,
    evolution,
    loading,
    error,
    actionError,
    pendingAction,
    actionPendingProviderId,
    actionPendingRole,
    actionPendingSkillId,
    actionPendingApprovalId,
    actionPendingPackId,
    actionPendingSuggestionId,
    refresh,
    toggleExtension,
    configureProvider,
    configureProviderCredential,
    assignRole,
    toggleSkill,
    approveSkill,
    rejectSkill,
    installPack,
    uninstallPack,
    approveSuggestion,
    rejectSuggestion,
  };
}

function buildActiveProviderLabel(snapshot: SparkExtensionSnapshot | null): string {
  if (!snapshot?.status.activeProviderId || !snapshot.status.activeProviderMode) {
    return 'No active provider';
  }

  const activeProvider = snapshot.providerHealth.providers.find(
    (provider) => provider.providerId === snapshot.status.activeProviderId,
  );
  const providerName = activeProvider?.displayName || snapshot.status.activeProviderId;
  return `${providerName} / ${snapshot.status.activeProviderMode}`;
}

function buildProviderHealthSummary(snapshot: SparkExtensionSnapshot | null): string {
  const ready = snapshot?.providerHealth.ready ?? 0;
  const degraded = snapshot?.providerHealth.degraded ?? 0;
  const unavailable = (snapshot?.providerHealth.unavailable ?? 0) + (snapshot?.providerHealth.unknown ?? 0);
  const total = ready + degraded + unavailable;
  return `${ready} healthy / ${degraded} degraded / ${unavailable} unavailable ${total === 1 ? 'provider' : 'providers'}`;
}

function buildProviderRow(
  provider: SparkProviderHealthSnapshot,
  activeProviderId: string | null,
  activeProviderMode: SparkProviderMode | null,
): SparkProviderRowModel {
  const health = mapProviderHealth(provider.aggregateHealth);
  const checkedAt = pickProviderCheckedAt(provider, provider.providerId === activeProviderId ? activeProviderMode : null);

  return {
    providerId: provider.providerId,
    name: provider.displayName,
    health,
    healthLabel: providerHealthLabels[health],
    healthClassName: `spark-provider-health-${health}`,
    activeModeLabel: provider.providerId === activeProviderId && activeProviderMode
      ? `${capitalizeSparkLabel(activeProviderMode)} active`
      : 'Not active',
    lastCheckedLabel: checkedAt ? `Last checked ${formatSparkTimestamp(checkedAt)}` : 'Not checked',
    credentialIndicatorLabel: credentialIndicatorLabels[provider.credentialState],
    configureAction: buildConfigureProviderAction(provider.providerId),
  };
}

const providerHealthLabels: Record<SparkProviderUiHealth, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  unavailable: 'Unavailable',
};

const providerHealthOrder: Record<SparkProviderUiHealth, number> = {
  healthy: 0,
  degraded: 1,
  unavailable: 2,
};

const credentialIndicatorLabels: Record<SparkProviderCredentialState, string> = {
  configured: 'Key stored',
  missing: 'Key missing',
  invalid: 'Key invalid',
  needsRefresh: 'Refresh key',
};

function compareProviderRows(a: SparkProviderRowModel, b: SparkProviderRowModel): number {
  const aActive = a.activeModeLabel === 'Not active' ? 1 : 0;
  const bActive = b.activeModeLabel === 'Not active' ? 1 : 0;
  if (aActive !== bActive) {
    return aActive - bActive;
  }

  const healthDelta = providerHealthOrder[a.health] - providerHealthOrder[b.health];
  if (healthDelta !== 0) {
    return healthDelta;
  }

  return a.name.localeCompare(b.name);
}

function mapProviderHealth(state: SparkProviderHealthState): SparkProviderUiHealth {
  if (state === 'ready') {
    return 'healthy';
  }

  if (state === 'degraded') {
    return 'degraded';
  }

  return 'unavailable';
}

function pickProviderCheckedAt(
  provider: SparkProviderHealthSnapshot,
  activeMode: SparkProviderMode | null,
): string | null {
  if (activeMode) {
    const activeCheckedAt = provider[activeMode].checkedAt;
    if (activeCheckedAt) {
      return activeCheckedAt;
    }
  }

  const candidates = [provider.classic.checkedAt, provider.realtime.checkedAt]
    .filter((value): value is string => Boolean(value));
  if (candidates.length === 0) {
    return null;
  }

  return candidates.sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}

function buildSkillSummaryLabel(snapshot: SparkExtensionSnapshot | null): string {
  const enabled = snapshot?.skillStatus.enabled ?? 0;
  const disabled = snapshot?.skillStatus.disabled ?? 0;
  const locked = snapshot?.skillStatus.locked ?? 0;
  return `${enabled} enabled / ${disabled} disabled / ${locked} locked skills`;
}

function buildInstalledSkillRow(skill: SparkSkillRow): SparkInstalledSkillRowModel {
  const lockedReason = getSkillLockedReason(skill);
  const stateLabel = skill.enabled ? 'Enabled' : 'Disabled';

  return {
    skillId: skill.skillId,
    name: normalizeSkillText(skill.name, skill.skillId),
    namespace: normalizeSkillText(skill.namespace, 'default'),
    versionLabel: formatOptionalSkillText(skill.version, 'unversioned'),
    sourceLabel: skill.source,
    stateLabel,
    stateClassName: skill.enabled ? 'spark-skill-state-enabled' : 'spark-skill-state-disabled',
    packSourceLabel: formatOptionalSkillText(skill.packSource, skill.source),
    permissionsSummary: summarizeSkillList(skill.permissions, 'No extra permissions'),
    executionLabel: skill.hasExecutableRegistration ? 'Executable' : 'Discovery-only',
    supportedToolsSummary: summarizeSkillList(skill.supportedTools, 'No registered tools'),
    outputContractsSummary: summarizeSkillList(skill.outputContracts, 'No output contract'),
    healthLabel: skillHealthLabels[skill.health],
    lockedReasonLabel: lockedReason,
    toggleLabel: skill.enabled ? 'Disable' : 'Enable',
    toggleDisabled: Boolean(lockedReason),
    toggleAction: lockedReason ? null : buildToggleSparkSkillAction(skill.skillId, !skill.enabled),
  };
}

function buildCatalogSkillRow(item: SparkSkillCatalogItem): SparkCatalogSkillRowModel {
  return {
    skillId: item.skillId,
    name: normalizeSkillText(item.name, item.skillId),
    namespace: normalizeSkillText(item.namespace, 'default'),
    versionLabel: formatOptionalSkillText(item.version, 'unversioned'),
    sourceLabel: item.source,
    packSourceLabel: formatOptionalSkillText(item.packSource, item.source),
    permissionsSummary: summarizeSkillList(item.permissions, 'No extra permissions'),
    executionLabel: item.hasExecutableRegistration ? 'Executable' : 'Discovery-only',
    supportedToolsSummary: summarizeSkillList(item.supportedTools, 'No registered tools'),
    outputContractsSummary: summarizeSkillList(item.outputContracts, 'No output contract'),
    categoryLabel: formatOptionalSkillText(item.category, 'Uncategorized'),
    description: formatOptionalSkillText(item.description, 'No catalog description available.'),
  };
}

function buildPendingApprovalRow(proposal: SparkPendingApprovalRow): SparkPendingApprovalRowModel {
  const riskLevel = normalizeApprovalRiskLevel(proposal.riskLevel);

  return {
    proposalId: proposal.proposalId,
    skillName: normalizeSkillText(proposal.skillName, proposal.proposalId),
    purpose: formatOptionalSkillText(proposal.purpose, 'No proposal purpose provided.'),
    requiredPermissionsSummary: summarizeSkillList(proposal.requiredPermissions, 'No extra permissions'),
    riskLevel,
    riskLabel: `${capitalizeSparkLabel(riskLevel)} risk`,
    riskClassName: `spark-approval-risk-${riskLevel}`,
    highRisk: riskLevel === 'high' || riskLevel === 'critical',
    approveAction: buildApproveSparkSkillAction(proposal.proposalId),
    rejectAction: buildRejectSparkSkillAction(proposal.proposalId),
  };
}

function buildCapabilityPackRow(pack: SparkCapabilityPackRow): SparkCapabilityPackRowModel {
  const includedSkills = normalizePackSkills(pack.includedSkills);
  const statusLabel = pack.installed ? 'Installed' : 'Available';

  return {
    packId: normalizeSkillText(pack.packId, 'unknown-pack'),
    name: normalizeSkillText(pack.name, pack.packId),
    description: formatOptionalSkillText(pack.description, 'No capability pack description available.'),
    includedSkillsCountLabel: `${includedSkills.length} ${includedSkills.length === 1 ? 'skill' : 'skills'}`,
    statusLabel,
    statusClassName: pack.installed ? 'spark-pack-status-installed' : 'spark-pack-status-available',
    actionLabel: pack.installed ? 'Uninstall' : 'Install',
    actionClassName: pack.installed ? 'danger-button' : 'primary-button',
    action: pack.installed
      ? buildUninstallSparkPackAction(pack.packId)
      : buildInstallSparkPackAction(pack.packId),
    includedSkills,
  };
}

function buildEvolutionSuggestionRow(
  suggestion: SparkEvolutionSuggestionRow,
): SparkEvolutionSuggestionRowModel {
  const confidenceLevel = normalizeEvolutionConfidenceLevel(suggestion.confidenceLevel);
  const type = normalizeEvolutionSuggestionType(suggestion.type);

  return {
    suggestionId: normalizeSkillText(suggestion.suggestionId, 'unknown-suggestion'),
    typeLabel: evolutionSuggestionTypeLabels[type],
    description: formatOptionalSkillText(suggestion.description, 'No suggestion description available.'),
    confidenceLevel,
    confidenceLabel: `${capitalizeSparkLabel(confidenceLevel)} confidence`,
    confidenceClassName: `spark-evolution-confidence-${confidenceLevel}`,
    highConfidence: confidenceLevel === 'high',
    approveAction: buildApproveSparkSuggestionAction(
      suggestion.suggestionId,
      evolutionSuggestionRouteTargets[type],
    ),
    rejectAction: buildRejectSparkSuggestionAction(suggestion.suggestionId),
  };
}

function buildBrainArtifactRow(
  artifactName: SparkBrainArtifactName,
  artifact: SparkBrainArtifactSummary | undefined,
): SparkBrainArtifactRowModel {
  const freshness = normalizeArtifactFreshness(artifact?.freshness);
  const renderedAt = artifact?.renderedAt ?? artifact?.generatedAt ?? null;
  const contentHash = artifact?.contentHash?.trim();
  const sourceProject = artifact?.sourceProject?.trim();
  const staleReason = artifact?.staleReason?.trim();
  const markdownContent = artifact?.markdownContent?.trim();

  return {
    artifactName,
    displayName: artifactName,
    freshness,
    freshnessLabel: capitalizeSparkLabel(freshness),
    freshnessClassName: `spark-brain-freshness-${freshness}`,
    renderedAtLabel: renderedAt ? `Rendered ${formatSparkTimestamp(renderedAt)}` : 'Not rendered yet',
    contentHashLabel: contentHash ? `Hash ${contentHash}` : 'Hash unavailable',
    sourceProjectLabel: sourceProject || 'Source project unavailable',
    staleReasonLabel: staleReason || null,
    markdownContent: markdownContent || 'Artifact content is not available in the current Spark snapshot.',
  };
}

function normalizeArtifactFreshness(
  value: SparkBrainArtifactFreshness | undefined,
): SparkBrainArtifactFreshness {
  return value === 'fresh' || value === 'stale' || value === 'missing'
    ? value
    : 'missing';
}

function compareCapabilityPackRows(
  a: SparkCapabilityPackRowModel,
  b: SparkCapabilityPackRowModel,
): number {
  const installDelta = (a.statusLabel === 'Installed' ? 0 : 1) - (b.statusLabel === 'Installed' ? 0 : 1);
  if (installDelta !== 0) {
    return installDelta;
  }

  return a.name.localeCompare(b.name);
}

const approvalRiskOrder: Record<SparkApprovalRiskLevel, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const evolutionConfidenceOrder: Record<SparkEvolutionSuggestionConfidenceLevel, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const evolutionSuggestionTypeLabels: Record<SparkEvolutionSuggestionType, string> = {
  'new-skill': 'New skill',
  'new-pack': 'New pack',
  'workflow-improvement': 'Workflow improvement',
  'missing-api': 'Missing API',
};

const evolutionSuggestionRouteTargets: Record<
  SparkEvolutionSuggestionType,
  SparkApproveSuggestionAction['routeTarget']
> = {
  'new-skill': 'skill-creator',
  'new-pack': 'capability-pack',
  'workflow-improvement': 'handoff',
  'missing-api': 'provider-config',
};

function compareApprovalRows(a: SparkPendingApprovalRowModel, b: SparkPendingApprovalRowModel): number {
  const riskDelta = approvalRiskOrder[a.riskLevel] - approvalRiskOrder[b.riskLevel];
  if (riskDelta !== 0) {
    return riskDelta;
  }

  return a.skillName.localeCompare(b.skillName);
}

function compareEvolutionSuggestionRows(
  a: SparkEvolutionSuggestionRowModel,
  b: SparkEvolutionSuggestionRowModel,
): number {
  return evolutionConfidenceOrder[a.confidenceLevel] - evolutionConfidenceOrder[b.confidenceLevel];
}

function normalizeApprovalRiskLevel(value: SparkApprovalRiskLevel): SparkApprovalRiskLevel {
  return value === 'critical' || value === 'high' || value === 'medium' || value === 'low'
    ? value
    : 'medium';
}

function normalizeEvolutionConfidenceLevel(
  value: SparkEvolutionSuggestionConfidenceLevel,
): SparkEvolutionSuggestionConfidenceLevel {
  return value === 'high' || value === 'medium' || value === 'low'
    ? value
    : 'medium';
}

function normalizeEvolutionSuggestionType(
  value: SparkEvolutionSuggestionType,
): SparkEvolutionSuggestionType {
  return value === 'new-skill'
    || value === 'new-pack'
    || value === 'workflow-improvement'
    || value === 'missing-api'
    ? value
    : 'workflow-improvement';
}

function getSkillLockedReason(skill: Pick<SparkSkillRow, 'hasExecutableRegistration' | 'lockedReason'>): string | null {
  if (skill.lockedReason?.trim()) {
    return skill.lockedReason.trim();
  }

  if (!skill.hasExecutableRegistration) {
    return 'Discovery-only until executable registration is available.';
  }

  return null;
}

const skillHealthLabels: Record<SparkSkillHealthState, string> = {
  ready: 'Ready',
  degraded: 'Degraded',
  unavailable: 'Unavailable',
  unknown: 'Unknown',
};

function summarizeSkillList(values: readonly string[], emptyLabel: string): string {
  const normalized = values
    .map((value) => value.trim())
    .filter(Boolean);
  return normalized.length > 0 ? normalized.join(', ') : emptyLabel;
}

function normalizePackSkills(values: readonly string[]): string[] {
  return values
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeSkillText(value: string, fallback: string): string {
  return value.trim() || fallback;
}

function formatOptionalSkillText(value: string | null, fallback: string): string {
  return value?.trim() || fallback;
}

function formatSparkTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function formatSparkCount(value: number | null | undefined): string {
  return String(value ?? 0);
}

function capitalizeSparkLabel(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function sparkSettingsTab(
  id: SparkSettingsTabId,
  label: string,
  placeholder: string,
): SparkSettingsTabModel {
  return {
    id,
    label,
    tabId: `spark-settings-tab-${id}`,
    panelId: `spark-settings-panel-${id}`,
    placeholder,
  };
}

function getWindowSparkApi(): SparkSettingsApi | null {
  if (typeof window === 'undefined' || !window.sparkApi) {
    return null;
  }

  return window.sparkApi;
}
