import type { SparkProviderRole } from './spark-provider.js';

export const SPARK_EXTENSION_ACTION_TYPES = [
  'toggle-extension',
  'configure-provider',
  'toggle-skill',
  'install-pack',
  'uninstall-pack',
  'approve-skill',
  'reject-skill',
  'approve-suggestion',
  'reject-suggestion',
  'view-artifact',
] as const;

export const SPARK_BRAIN_ARTIFACT_NAMES = [
  'SPARK.md',
  'USER.md',
  'MEMORY.md',
  'VAULT.md',
  'SKILLS.md',
  'CONTEXT.md',
] as const;

export type SparkExtensionActionType = typeof SPARK_EXTENSION_ACTION_TYPES[number];
export type SparkBrainArtifactName = typeof SPARK_BRAIN_ARTIFACT_NAMES[number];

export type SparkExtensionInstallState =
  | 'missing'
  | 'installable'
  | 'installedDisabled'
  | 'bootstrapping'
  | 'ready'
  | 'degraded'
  | 'failed';

export type SparkExtensionSource =
  | 'not-installed'
  | 'managed'
  | 'local-source'
  | 'custom'
  | 'unknown';

export type SparkProviderMode = 'classic' | 'realtime';
export type SparkProviderHealthState = 'unknown' | 'ready' | 'degraded' | 'unavailable';
export type SparkProviderCredentialState = 'missing' | 'configured' | 'invalid' | 'needsRefresh';
export type SparkBrainArtifactFreshness = 'fresh' | 'stale' | 'missing';
export type SparkSkillSource = 'core' | 'vault-native' | 'pack' | 'custom' | 'proposal';
export type SparkSkillHealthState = 'unknown' | 'ready' | 'degraded' | 'unavailable';
export type SparkApprovalRiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type SparkEvolutionSuggestionType = 'new-skill' | 'new-pack' | 'workflow-improvement' | 'missing-api';
export type SparkEvolutionSuggestionConfidenceLevel = 'low' | 'medium' | 'high';

export interface SparkExtensionStatus {
  installState: SparkExtensionInstallState;
  enabled: boolean;
  source: SparkExtensionSource;
  version: string | null;
  brainProject: string | null;
  activeProviderId: string | null;
  activeProviderMode: SparkProviderMode | null;
  message: string;
  installCommands: string[];
  issues: string[];
}

export interface SparkProviderModeHealth {
  state: SparkProviderHealthState;
  message: string;
  checkedAt: string | null;
  latencyMs?: number | null;
  lastRedactedError?: string | null;
}

export interface SparkProviderHealthSnapshot {
  providerId: string;
  displayName: string;
  enabled: boolean;
  credentialState: SparkProviderCredentialState;
  aggregateHealth: SparkProviderHealthState;
  classic: SparkProviderModeHealth;
  realtime: SparkProviderModeHealth;
}

export interface SparkProviderHealthSummary {
  activeProviderId: string | null;
  activeProviderMode: SparkProviderMode | null;
  ready: number;
  degraded: number;
  unavailable: number;
  unknown: number;
  providers: SparkProviderHealthSnapshot[];
  /**
   * Active per-role provider selection (S2). Optional so default/empty snapshots
   * stay valid; populated from the credential store when providers are wired.
   */
  roleAssignments?: Partial<Record<SparkProviderRole, string | null>>;
}

export interface SparkSkillStatusSummary {
  total: number;
  enabled: number;
  disabled: number;
  locked: number;
  pendingApproval: number;
}

export interface SparkSkillRow {
  skillId: string;
  name: string;
  namespace: string;
  source: SparkSkillSource;
  version: string | null;
  enabled: boolean;
  packSource: string | null;
  permissions: string[];
  supportedTools: string[];
  outputContracts: string[];
  hasExecutableRegistration: boolean;
  health: SparkSkillHealthState;
  lockedReason: string | null;
}

export interface SparkSkillCatalogItem {
  skillId: string;
  name: string;
  namespace: string;
  source: SparkSkillSource;
  version: string | null;
  packSource: string | null;
  permissions: string[];
  supportedTools: string[];
  outputContracts: string[];
  hasExecutableRegistration: boolean;
  category: string;
  description: string | null;
}

export interface SparkPendingApprovalRow {
  proposalId: string;
  skillName: string;
  purpose: string;
  requiredPermissions: string[];
  riskLevel: SparkApprovalRiskLevel;
}

export interface SparkCapabilityPackRow {
  packId: string;
  name: string;
  description: string | null;
  installed: boolean;
  includedSkills: string[];
}

export interface SparkEvolutionSuggestionRow {
  suggestionId: string;
  type: SparkEvolutionSuggestionType;
  description: string;
  confidenceLevel: SparkEvolutionSuggestionConfidenceLevel;
}

export interface SparkCapabilityPackStatusSummary {
  total: number;
  installed: number;
  updateAvailable: number;
}

export interface SparkApprovalSummary {
  pending: number;
  skillProposals: number;
  evolutionSuggestions: number;
}

export interface SparkBrainArtifactSummary {
  artifactName: SparkBrainArtifactName;
  freshness: SparkBrainArtifactFreshness;
  renderedAt?: string | null;
  generatedAt: string | null;
  contentHash?: string | null;
  markdownContent?: string | null;
  sourceProject: string | null;
  staleReason: string | null;
}

export interface SparkBrainArtifactFreshnessSummary {
  fresh: number;
  stale: number;
  missing: number;
  latestGeneratedAt: string | null;
  artifacts: SparkBrainArtifactSummary[];
}

export interface SparkLedgerSuggestionSummary {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  deferred: number;
  superseded: number;
}

export interface SparkExtensionCounts {
  skills: number;
  enabledSkills: number;
  installedPacks: number;
  pendingApprovals: number;
  brainArtifacts: number;
  staleBrainArtifacts: number;
  ledgerSuggestions: number;
  pendingLedgerSuggestions: number;
}

export interface SparkExtensionSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  status: SparkExtensionStatus;
  providerHealth: SparkProviderHealthSummary;
  skillStatus: SparkSkillStatusSummary;
  skills: SparkSkillRow[];
  skillCatalog: SparkSkillCatalogItem[];
  pendingApprovals: SparkPendingApprovalRow[];
  capabilityPacks: SparkCapabilityPackRow[];
  evolutionSuggestions: SparkEvolutionSuggestionRow[];
  packStatus: SparkCapabilityPackStatusSummary;
  approvals: SparkApprovalSummary;
  brainArtifacts: SparkBrainArtifactFreshnessSummary;
  ledgerSuggestions: SparkLedgerSuggestionSummary;
  counts: SparkExtensionCounts;
}

export interface SparkToggleExtensionAction {
  type: 'toggle-extension';
  enabled: boolean;
  confirmationToken?: string;
}

export interface SparkConfigureProviderAction {
  type: 'configure-provider';
  providerId: string;
  enabled?: boolean;
  makeActive?: boolean;
  mode?: SparkProviderMode;
  baseUrl?: string | null;
  model?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
  previewToken?: string;
  confirmationToken?: string;
}

export interface SparkToggleSkillAction {
  type: 'toggle-skill';
  skillId: string;
  enabled: boolean;
  confirmationToken?: string;
}

export interface SparkInstallPackAction {
  type: 'install-pack';
  packId: string;
  previewToken?: string;
  confirmationToken?: string;
}

export interface SparkUninstallPackAction {
  type: 'uninstall-pack';
  packId: string;
  previewToken?: string;
  confirmationToken?: string;
}

export interface SparkApproveSkillAction {
  type: 'approve-skill';
  proposalId: string;
  enableNow?: boolean;
  confirmationToken?: string;
}

export interface SparkRejectSkillAction {
  type: 'reject-skill';
  proposalId: string;
  reason: string;
}

export interface SparkApproveSuggestionAction {
  type: 'approve-suggestion';
  suggestionId: string;
  routeTarget?: 'skill-creator' | 'capability-pack' | 'provider-config' | 'handoff';
  confirmationToken?: string;
}

export interface SparkRejectSuggestionAction {
  type: 'reject-suggestion';
  suggestionId: string;
  reason: string;
}

export interface SparkViewArtifactAction {
  type: 'view-artifact';
  artifactName: SparkBrainArtifactName;
}

export type SparkExtensionAction =
  | SparkToggleExtensionAction
  | SparkConfigureProviderAction
  | SparkToggleSkillAction
  | SparkInstallPackAction
  | SparkUninstallPackAction
  | SparkApproveSkillAction
  | SparkRejectSkillAction
  | SparkApproveSuggestionAction
  | SparkRejectSuggestionAction
  | SparkViewArtifactAction;

export type SparkExtensionActionResultReason =
  | 'not_implemented'
  | 'validation_failed'
  | 'adapter_failed';

export interface SparkExtensionActionResult {
  ok: boolean;
  actionType: SparkExtensionActionType | null;
  reason: SparkExtensionActionResultReason;
  message: string;
  snapshot?: SparkExtensionSnapshot;
  data?: Record<string, unknown> | null;
}
