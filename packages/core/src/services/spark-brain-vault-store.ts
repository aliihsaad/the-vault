import type {
  BrainArtifactDraftProposal,
  BrainArtifactDraftProposalInput,
  BrainSkillDraftProposal,
  BrainSkillDraftProposalInput,
  BrainSkillDraftProposalUpdate,
  BrainVaultArtifact,
  BrainVaultAvailability,
  BrainVaultEnsureProjectResult,
  BrainVaultEnsureRecordResult,
  BrainVaultPersistArtifactResult,
  BrainVaultPersistRecordResult,
  BrainVaultProject,
  BrainVaultProjectConfig,
  BrainVaultProposal,
  BrainVaultStore,
  BrainVaultStoreSnapshot,
  SparkBrainStoreRecord,
} from '../types/spark-brain-host.js';

/**
 * Minimal Vault memory item shape the store reads back. The real
 * `MemoryItem` is a structural superset of this.
 */
export interface SparkBrainHostMemoryItem {
  itemUid: string;
  project: string;
  subject: string;
  content: string | null;
  tags: string[];
}

export interface SparkBrainHostSaveInput {
  title: string;
  project: string;
  memoryType: 'reference' | 'artifact';
  subject: string;
  summary: string;
  content?: string;
  tags?: string[];
  status?: 'active';
  sourceApp?: 'other';
}

export interface SparkBrainHostFindQuery {
  project?: string;
  tags?: string[];
  subject?: string;
  limit?: number;
}

/**
 * The subset of the Vault class the Spark Brain store depends on. The real
 * `Vault` instance structurally satisfies this contract.
 */
export interface VaultBrainStoreHost {
  getProject(name: string): { name: string } | null;
  createProject(name: string, description?: string): { name: string };
  saveMemory(input: SparkBrainHostSaveInput): { item: SparkBrainHostMemoryItem };
  findMemory(query: SparkBrainHostFindQuery): SparkBrainHostMemoryItem[];
  updateMemory(
    itemUid: string,
    updates: Partial<SparkBrainHostMemoryItem>,
  ): SparkBrainHostMemoryItem | null;
}

export interface VaultBrainStoreOptions {
  now?: () => string;
}

const TAG_BASE = 'spark-brain';
const TAG_RECORD = 'spark-brain-record';
const TAG_ARTIFACT = 'spark-brain-artifact';
const TAG_SKILL_PROPOSAL = 'spark-brain-skill-proposal';
const TAG_ARTIFACT_PROPOSAL = 'spark-brain-artifact-proposal';

/**
 * A real, Vault-backed implementation of the `@spark/brain` `BrainVaultStore`
 * contract. Brain records, rendered artifacts and draft proposals are
 * persisted as Vault memory items (one item per entity, JSON-encoded in the
 * body) under the canonical Spark Brain project, so they survive restarts and
 * remain inspectable through normal Vault tooling. This is the host adapter the
 * brain runtime writes through when bootstrapping and installing skills/packs.
 */
export function createVaultBrainStore(
  host: VaultBrainStoreHost,
  options: VaultBrainStoreOptions = {},
): BrainVaultStore {
  return new VaultBrainStore(host, options);
}

class VaultBrainStore implements BrainVaultStore {
  private readonly now: () => string;
  private projectName = 'Spark-Brain';
  private projectSlug = 'spark-brain';

  constructor(
    private readonly host: VaultBrainStoreHost,
    options: VaultBrainStoreOptions,
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async validateAvailability(): Promise<BrainVaultAvailability> {
    return {
      status: 'ready',
      checkedAt: this.now(),
      details: 'Vault memory store is available.',
    };
  }

  async ensureProject(project: BrainVaultProjectConfig): Promise<BrainVaultEnsureProjectResult> {
    this.projectName = project.name;
    this.projectSlug = project.slug;
    const existing = this.host.getProject(project.name);
    if (!existing) {
      this.host.createProject(project.name, 'Spark Brain durable runtime store.');
    }
    return {
      project: this.buildProject(),
      created: !existing,
    };
  }

  async ensureRecord(
    _projectId: string,
    record: SparkBrainStoreRecord,
  ): Promise<BrainVaultEnsureRecordResult> {
    const existing = this.findEntity(TAG_RECORD, record.id);
    if (existing) {
      return { record: parse<SparkBrainStoreRecord>(existing.content) ?? record, created: false };
    }
    this.saveEntity(TAG_RECORD, record.id, record, `Spark Brain record ${record.id}`);
    return { record, created: true };
  }

  async persistRecord(
    _projectId: string,
    record: SparkBrainStoreRecord,
  ): Promise<BrainVaultPersistRecordResult> {
    const existing = this.findEntity(TAG_RECORD, record.id);
    if (!existing) {
      this.saveEntity(TAG_RECORD, record.id, record, `Spark Brain record ${record.id}`);
      return { record, created: true, updated: false };
    }

    const stored = parse<SparkBrainStoreRecord>(existing.content);
    if (stored && stableStringify(stored) === stableStringify(record)) {
      return { record: stored, created: false, updated: false };
    }

    const merged: SparkBrainStoreRecord = {
      ...record,
      createdAt: stored?.createdAt ?? record.createdAt,
    };
    this.host.updateMemory(existing.itemUid, { content: JSON.stringify(merged) });
    return { record: merged, created: false, updated: true };
  }

  async listRecords(_projectId: string): Promise<SparkBrainStoreRecord[]> {
    return this.listEntities<SparkBrainStoreRecord>(TAG_RECORD).sort(
      (a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id),
    );
  }

  async persistArtifact(
    _projectId: string,
    artifact: BrainVaultArtifact,
  ): Promise<BrainVaultPersistArtifactResult> {
    const existing = this.findEntity(TAG_ARTIFACT, artifact.artifactKind);
    if (!existing) {
      this.saveEntity(
        TAG_ARTIFACT,
        artifact.artifactKind,
        artifact,
        `Spark Brain artifact ${artifact.artifactKind}`,
        'artifact',
      );
      return { artifact, created: true, updated: false };
    }

    const stored = parse<BrainVaultArtifact>(existing.content);
    if (stored && stored.contentHash === artifact.contentHash) {
      return { artifact: stored, created: false, updated: false };
    }

    const merged: BrainVaultArtifact = {
      ...artifact,
      artifactId: stored?.artifactId ?? artifact.artifactId,
      createdAt: stored?.createdAt ?? artifact.createdAt,
      updatedAt: this.now(),
    };
    this.host.updateMemory(existing.itemUid, { content: JSON.stringify(merged) });
    return { artifact: merged, created: false, updated: true };
  }

  async listArtifacts(_projectId: string): Promise<BrainVaultArtifact[]> {
    return this.listEntities<BrainVaultArtifact>(TAG_ARTIFACT).sort((a, b) =>
      a.artifactKind.localeCompare(b.artifactKind),
    );
  }

  async saveArtifactDraftProposal(
    input: BrainArtifactDraftProposalInput,
  ): Promise<BrainArtifactDraftProposal> {
    const count = this.findByTag(TAG_ARTIFACT_PROPOSAL).length;
    const proposal: BrainArtifactDraftProposal = {
      proposalType: 'artifact',
      proposalId: `proposal.${input.artifactKind.toLowerCase()}.${count + 1}`,
      projectId: this.projectId(),
      artifactKind: input.artifactKind,
      proposedContent: input.proposedContent,
      reason: input.reason,
      sourceRefs: [...input.sourceRefs],
      status: 'draft',
      createdAt: this.now(),
    };
    this.saveEntity(
      TAG_ARTIFACT_PROPOSAL,
      proposal.proposalId,
      proposal,
      `Spark Brain artifact proposal ${proposal.proposalId}`,
    );
    return proposal;
  }

  async saveSkillDraftProposal(
    input: BrainSkillDraftProposalInput,
  ): Promise<BrainSkillDraftProposal> {
    const count = this.findByTag(TAG_SKILL_PROPOSAL).length;
    const createdAt = this.now();
    const proposal: BrainSkillDraftProposal = {
      proposalType: 'skill',
      proposalId: input.proposalId ?? `proposal.skill.${slugify(input.draft.id)}.${count + 1}`,
      projectId: this.projectId(),
      workflowFingerprint: input.workflowFingerprint,
      workflowIds: unique(input.workflowIds),
      detectionReason: input.detectionReason,
      draft: input.draft,
      status: input.status ?? 'draft',
      risk: input.risk,
      observedPermissions: unique(input.observedPermissions),
      requestedPermissions: unique(input.requestedPermissions),
      approvalRequiredPermissions: unique(input.approvalRequiredPermissions),
      sourceRefs: unique(input.sourceRefs),
      createdAt,
      updatedAt: createdAt,
    };
    applyOptionalProposalFields(proposal, input);
    this.saveEntity(
      TAG_SKILL_PROPOSAL,
      proposal.proposalId,
      proposal,
      `Spark Brain skill proposal ${proposal.proposalId}`,
    );
    return proposal;
  }

  async updateSkillDraftProposal(
    _projectId: string,
    proposalId: string,
    update: BrainSkillDraftProposalUpdate,
  ): Promise<BrainSkillDraftProposal> {
    const existing = this.findEntity(TAG_SKILL_PROPOSAL, proposalId);
    const stored = existing ? parse<BrainSkillDraftProposal>(existing.content) : null;
    if (!existing || !stored) {
      throw new Error(`Unknown skill draft proposal: ${proposalId}`);
    }

    const updated: BrainSkillDraftProposal = {
      ...stored,
      status: update.status ?? stored.status,
      sourceRefs: update.sourceRefs
        ? unique([...stored.sourceRefs, ...update.sourceRefs])
        : stored.sourceRefs,
      updatedAt: this.now(),
    };
    if (update.rejectionReason) updated.rejectionReason = update.rejectionReason;
    if (update.suppressedByProposalId) updated.suppressedByProposalId = update.suppressedByProposalId;
    if (update.installedSkillId) updated.installedSkillId = update.installedSkillId;
    if (update.installedSkillVersion) updated.installedSkillVersion = update.installedSkillVersion;

    this.host.updateMemory(existing.itemUid, { content: JSON.stringify(updated) });
    return updated;
  }

  async listSkillDraftProposals(_projectId: string): Promise<BrainSkillDraftProposal[]> {
    return this.listEntities<BrainSkillDraftProposal>(TAG_SKILL_PROPOSAL).sort(sortProposals);
  }

  async createSnapshot(projectId: string): Promise<BrainVaultStoreSnapshot> {
    const proposals: BrainVaultProposal[] = [
      ...this.listEntities<BrainVaultProposal>(TAG_ARTIFACT_PROPOSAL),
      ...this.listEntities<BrainVaultProposal>(TAG_SKILL_PROPOSAL),
    ].sort(sortProposals);

    return {
      project: this.buildProject(),
      records: await this.listRecords(projectId),
      artifacts: await this.listArtifacts(projectId),
      proposals,
    };
  }

  // --- internals -----------------------------------------------------------

  private projectId(): string {
    return `project.${this.projectSlug}`;
  }

  private buildProject(): BrainVaultProject {
    const timestamp = this.now();
    return {
      id: this.projectId(),
      name: this.projectName,
      slug: this.projectSlug,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  private findByTag(tag: string): SparkBrainHostMemoryItem[] {
    return this.host.findMemory({ project: this.projectName, tags: [TAG_BASE, tag] });
  }

  private findEntity(tag: string, subject: string): SparkBrainHostMemoryItem | undefined {
    return this.host
      .findMemory({ project: this.projectName, tags: [TAG_BASE, tag], subject })
      .find((item) => item.subject === subject);
  }

  private listEntities<T>(tag: string): T[] {
    return this.findByTag(tag)
      .map((item) => parse<T>(item.content))
      .filter((value): value is T => value !== null);
  }

  private saveEntity(
    tag: string,
    subject: string,
    value: unknown,
    title: string,
    memoryType: 'reference' | 'artifact' = 'reference',
  ): void {
    this.host.saveMemory({
      title,
      project: this.projectName,
      memoryType,
      subject,
      summary: title,
      content: JSON.stringify(value),
      tags: [TAG_BASE, tag],
      status: 'active',
      sourceApp: 'other',
    });
  }
}

function applyOptionalProposalFields(
  proposal: BrainSkillDraftProposal,
  input: BrainSkillDraftProposalInput,
): void {
  if (input.rejectionReason) proposal.rejectionReason = input.rejectionReason;
  if (input.suppressedByProposalId) proposal.suppressedByProposalId = input.suppressedByProposalId;
  if (input.installedSkillId) proposal.installedSkillId = input.installedSkillId;
  if (input.installedSkillVersion) proposal.installedSkillVersion = input.installedSkillVersion;
}

function sortProposals(a: BrainVaultProposal, b: BrainVaultProposal): number {
  return a.createdAt.localeCompare(b.createdAt) || a.proposalId.localeCompare(b.proposalId);
}

function parse<T>(content: string | null): T | null {
  if (!content) return null;
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`).join(',')}}`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
