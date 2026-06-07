/**
 * Host-side structural contracts for the Spark Brain (`@spark/brain`) runtime.
 *
 * The Vault desktop host cannot statically import `@spark/brain`: that package
 * lives in a separate workspace (vault-spark), is installed under
 * `VaultRoot/extensions/spark-brain` and is loaded at runtime as built ESM.
 * To keep The Vault decoupled from that build, we mirror the minimal subset of
 * the brain's public shapes here. The real runtime, once dynamically imported,
 * structurally satisfies these types — and our Vault-backed store structurally
 * satisfies the `BrainVaultStore` interface the runtime consumes.
 *
 * These are intentionally a faithful subset of the upstream contracts; fields
 * we never read or write are omitted.
 */

export type SparkBrainRecordKind =
  | 'identity'
  | 'policy'
  | 'skill'
  | 'skill_proposal'
  | 'capability_pack'
  | 'pack_proposal'
  | 'provider'
  | 'provider_proposal'
  | 'workflow'
  | 'implementation_handoff'
  | 'ledger_entry'
  | 'artifact'
  | 'adapter'
  | 'context_cursor';

export type SparkBrainRecordStatus =
  | 'active'
  | 'draft'
  | 'approved'
  | 'rejected'
  | 'suppressed'
  | 'queued'
  | 'disabled'
  | 'archived';

export interface SparkBrainStoreRecord {
  id: string;
  kind: SparkBrainRecordKind;
  version: string;
  status: SparkBrainRecordStatus;
  createdAt: string;
  updatedAt: string;
  payload: Record<string, unknown>;
  sourceRefs?: string[];
}

export type BrainArtifactKind =
  | 'SPARK.md'
  | 'USER.md'
  | 'MEMORY.md'
  | 'VAULT.md'
  | 'SKILLS.md'
  | 'CONTEXT.md';

export interface BrainArtifactRedactionMetadata {
  policy: string;
  redactedRecords: number;
  redactedRecordIds: string[];
  omittedPrivateLedgerEntries: number;
  omittedRecordIds: string[];
}

export interface BrainArtifactProvenance {
  canonicalStore: 'vault';
  projectId: string;
  projectName: string;
  sourceRecordIds: string[];
  sourceRefs: string[];
  manualEdits: 'draft_proposals_only';
}

export interface BrainVaultArtifact {
  artifactId: string;
  artifactKind: BrainArtifactKind;
  projectId: string;
  version: string;
  rendererVersion: string;
  renderedAt: string;
  sourceRefs: string[];
  contentHash: string;
  content: string;
  redaction: BrainArtifactRedactionMetadata;
  provenance: BrainArtifactProvenance;
  createdAt: string;
  updatedAt: string;
}

export interface BrainVaultProject {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface BrainVaultProjectConfig {
  name: string;
  slug: string;
}

export interface BrainVaultAvailability {
  status: 'ready' | 'degraded' | 'unavailable';
  checkedAt: string;
  details: string;
}

/** Minimal skill manifest shape carried inside skill draft proposals. */
export interface BrainSkillManifestLike {
  id: string;
  namespace: string;
  version: string;
  title: string;
  purpose: string;
  permissions: string[];
  supportedTools: string[];
  examples: string[];
  inputContract: Record<string, unknown>;
  outputContract: Record<string, unknown>;
  requiredProviders?: string[];
  packId?: string;
  sparkBrainApiVersion: string;
  sparkCoreMinVersion?: string;
  status?: string;
  disabledReason?: string;
  migrationNotes?: string[];
}

export type BrainSkillDraftProposalStatus = 'draft' | 'approved' | 'rejected' | 'suppressed';
export type BrainSkillDraftRisk = 'low' | 'medium' | 'high';
export type BrainSkillDetectionReason =
  | 'repetition_threshold'
  | 'user_pinned'
  | 'suppressed_similarity';

export interface BrainArtifactDraftProposalInput {
  artifactKind: BrainArtifactKind;
  proposedContent: string;
  reason: string;
  sourceRefs: string[];
  projectId?: string;
}

export interface BrainArtifactDraftProposal {
  proposalType: 'artifact';
  proposalId: string;
  artifactKind: BrainArtifactKind;
  projectId: string;
  proposedContent: string;
  reason: string;
  sourceRefs: string[];
  status: 'draft';
  createdAt: string;
}

export interface BrainSkillDraftProposalInput {
  proposalId?: string;
  workflowFingerprint: string;
  workflowIds: string[];
  detectionReason: BrainSkillDetectionReason;
  draft: BrainSkillManifestLike;
  risk: BrainSkillDraftRisk;
  observedPermissions: string[];
  requestedPermissions: string[];
  approvalRequiredPermissions: string[];
  sourceRefs: string[];
  status?: BrainSkillDraftProposalStatus;
  rejectionReason?: string;
  suppressedByProposalId?: string;
  installedSkillId?: string;
  installedSkillVersion?: string;
}

export interface BrainSkillDraftProposalUpdate {
  status?: BrainSkillDraftProposalStatus;
  rejectionReason?: string;
  suppressedByProposalId?: string;
  installedSkillId?: string;
  installedSkillVersion?: string;
  sourceRefs?: string[];
}

export interface BrainSkillDraftProposal {
  proposalType: 'skill';
  proposalId: string;
  projectId: string;
  workflowFingerprint: string;
  workflowIds: string[];
  detectionReason: BrainSkillDetectionReason;
  draft: BrainSkillManifestLike;
  status: BrainSkillDraftProposalStatus;
  risk: BrainSkillDraftRisk;
  observedPermissions: string[];
  requestedPermissions: string[];
  approvalRequiredPermissions: string[];
  sourceRefs: string[];
  createdAt: string;
  updatedAt: string;
  rejectionReason?: string;
  suppressedByProposalId?: string;
  installedSkillId?: string;
  installedSkillVersion?: string;
}

export type BrainVaultProposal = BrainArtifactDraftProposal | BrainSkillDraftProposal;

export interface BrainVaultStoreSnapshot {
  project: BrainVaultProject;
  records: SparkBrainStoreRecord[];
  artifacts: BrainVaultArtifact[];
  proposals: BrainVaultProposal[];
}

export interface BrainVaultEnsureProjectResult {
  project: BrainVaultProject;
  created: boolean;
}

export interface BrainVaultEnsureRecordResult {
  record: SparkBrainStoreRecord;
  created: boolean;
}

export interface BrainVaultPersistRecordResult {
  record: SparkBrainStoreRecord;
  created: boolean;
  updated: boolean;
}

export interface BrainVaultPersistArtifactResult {
  artifact: BrainVaultArtifact;
  created: boolean;
  updated: boolean;
}

/**
 * The store contract `@spark/brain`'s runtime depends on. The Vault-backed
 * implementation in `spark-brain-vault-store.ts` satisfies this so it can be
 * passed straight into `createSparkBrainRuntime({ store })`.
 */
export interface BrainVaultStore {
  validateAvailability(): Promise<BrainVaultAvailability>;
  ensureProject(project: BrainVaultProjectConfig): Promise<BrainVaultEnsureProjectResult>;
  ensureRecord(projectId: string, record: SparkBrainStoreRecord): Promise<BrainVaultEnsureRecordResult>;
  persistRecord(projectId: string, record: SparkBrainStoreRecord): Promise<BrainVaultPersistRecordResult>;
  listRecords(projectId: string): Promise<SparkBrainStoreRecord[]>;
  persistArtifact(projectId: string, artifact: BrainVaultArtifact): Promise<BrainVaultPersistArtifactResult>;
  listArtifacts(projectId: string): Promise<BrainVaultArtifact[]>;
  saveArtifactDraftProposal(input: BrainArtifactDraftProposalInput): Promise<BrainArtifactDraftProposal>;
  saveSkillDraftProposal(input: BrainSkillDraftProposalInput): Promise<BrainSkillDraftProposal>;
  updateSkillDraftProposal(
    projectId: string,
    proposalId: string,
    update: BrainSkillDraftProposalUpdate,
  ): Promise<BrainSkillDraftProposal>;
  listSkillDraftProposals(projectId: string): Promise<BrainSkillDraftProposal[]>;
  createSnapshot(projectId: string): Promise<BrainVaultStoreSnapshot>;
}
