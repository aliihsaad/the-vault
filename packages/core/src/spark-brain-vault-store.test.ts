import { describe, expect, it } from 'vitest';
import { createVaultBrainStore } from './services/spark-brain-vault-store.js';
import type {
  BrainVaultArtifact,
  SparkBrainStoreRecord,
} from './types/spark-brain-host.js';
import { FakeVaultHost } from './spark-brain-test-host.js';

function makeRecord(id: string, kind: SparkBrainStoreRecord['kind'] = 'policy'): SparkBrainStoreRecord {
  return {
    id,
    kind,
    version: '1.0.0',
    status: 'active',
    createdAt: '2026-06-06T00:00:00.000Z',
    updatedAt: '2026-06-06T00:00:00.000Z',
    payload: { hello: 'world' },
    sourceRefs: ['test'],
  };
}

function makeArtifact(kind: BrainVaultArtifact['artifactKind'], hash: string): BrainVaultArtifact {
  return {
    artifactId: `artifact.${kind}`,
    artifactKind: kind,
    projectId: 'project.spark-brain',
    version: '1.0.0',
    rendererVersion: '1.0.0',
    renderedAt: '2026-06-06T00:00:00.000Z',
    sourceRefs: ['test'],
    contentHash: hash,
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
    createdAt: '2026-06-06T00:00:00.000Z',
    updatedAt: '2026-06-06T00:00:00.000Z',
  };
}

describe('Vault-backed Spark Brain store', () => {
  it('ensures a Vault project and reports created only on first ensure', async () => {
    const host = new FakeVaultHost();
    const store = createVaultBrainStore(host);

    const first = await store.ensureProject({ name: 'Spark-Brain', slug: 'spark-brain' });
    expect(first.created).toBe(true);
    expect(first.project.id).toBe('project.spark-brain');
    expect(first.project.name).toBe('Spark-Brain');
    expect(host.getProject('Spark-Brain')).not.toBeNull();

    const second = await store.ensureProject({ name: 'Spark-Brain', slug: 'spark-brain' });
    expect(second.created).toBe(false);
  });

  it('persists a record to Vault and round-trips it through listRecords', async () => {
    const host = new FakeVaultHost();
    const store = createVaultBrainStore(host);
    const { project } = await store.ensureProject({ name: 'Spark-Brain', slug: 'spark-brain' });

    const result = await store.ensureRecord(project.id, makeRecord('brain.identity.spark', 'identity'));
    expect(result.created).toBe(true);

    const records = await store.listRecords(project.id);
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe('brain.identity.spark');
    expect(records[0].payload).toEqual({ hello: 'world' });
  });

  it('does not recreate a record that already exists on ensureRecord', async () => {
    const host = new FakeVaultHost();
    const store = createVaultBrainStore(host);
    const { project } = await store.ensureProject({ name: 'Spark-Brain', slug: 'spark-brain' });

    await store.ensureRecord(project.id, makeRecord('brain.policy.x'));
    const again = await store.ensureRecord(project.id, makeRecord('brain.policy.x'));

    expect(again.created).toBe(false);
    expect(await store.listRecords(project.id)).toHaveLength(1);
  });

  it('updates an existing record on persistRecord and preserves original createdAt', async () => {
    const host = new FakeVaultHost();
    const store = createVaultBrainStore(host);
    const { project } = await store.ensureProject({ name: 'Spark-Brain', slug: 'spark-brain' });

    await store.persistRecord(project.id, makeRecord('brain.policy.x'));
    const changed = { ...makeRecord('brain.policy.x'), updatedAt: '2026-06-07T00:00:00.000Z', payload: { hello: 'changed' } };
    const updated = await store.persistRecord(project.id, changed);

    expect(updated.created).toBe(false);
    expect(updated.updated).toBe(true);
    expect(updated.record.createdAt).toBe('2026-06-06T00:00:00.000Z');
    const records = await store.listRecords(project.id);
    expect(records[0].payload).toEqual({ hello: 'changed' });
  });

  it('treats an unchanged persistRecord as a no-op', async () => {
    const host = new FakeVaultHost();
    const store = createVaultBrainStore(host);
    const { project } = await store.ensureProject({ name: 'Spark-Brain', slug: 'spark-brain' });

    await store.persistRecord(project.id, makeRecord('brain.policy.x'));
    const again = await store.persistRecord(project.id, makeRecord('brain.policy.x'));

    expect(again.created).toBe(false);
    expect(again.updated).toBe(false);
  });

  it('persists and updates artifacts keyed by artifact kind', async () => {
    const host = new FakeVaultHost();
    const store = createVaultBrainStore(host);
    const { project } = await store.ensureProject({ name: 'Spark-Brain', slug: 'spark-brain' });

    const created = await store.persistArtifact(project.id, makeArtifact('SPARK.md', 'hash-1'));
    expect(created.created).toBe(true);

    const unchanged = await store.persistArtifact(project.id, makeArtifact('SPARK.md', 'hash-1'));
    expect(unchanged.created).toBe(false);
    expect(unchanged.updated).toBe(false);

    const rerendered = await store.persistArtifact(project.id, makeArtifact('SPARK.md', 'hash-2'));
    expect(rerendered.updated).toBe(true);

    const artifacts = await store.listArtifacts(project.id);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].contentHash).toBe('hash-2');
  });

  it('saves and lists skill draft proposals and updates their status', async () => {
    const host = new FakeVaultHost();
    const store = createVaultBrainStore(host);
    const { project } = await store.ensureProject({ name: 'Spark-Brain', slug: 'spark-brain' });

    const proposal = await store.saveSkillDraftProposal({
      workflowFingerprint: 'fp-1',
      workflowIds: ['w1'],
      detectionReason: 'repetition_threshold',
      draft: {
        id: 'user.demo',
        namespace: 'user',
        version: '1.0.0',
        title: 'Demo',
        purpose: 'demo',
        permissions: [],
        supportedTools: [],
        examples: [],
        inputContract: {},
        outputContract: {},
        sparkBrainApiVersion: '1.0.0',
      },
      risk: 'low',
      observedPermissions: [],
      requestedPermissions: [],
      approvalRequiredPermissions: [],
      sourceRefs: ['test'],
    });
    expect(proposal.status).toBe('draft');

    const listed = await store.listSkillDraftProposals(project.id);
    expect(listed).toHaveLength(1);

    const updated = await store.updateSkillDraftProposal(project.id, proposal.proposalId, {
      status: 'approved',
      installedSkillId: 'user.demo',
    });
    expect(updated.status).toBe('approved');

    const relisted = await store.listSkillDraftProposals(project.id);
    expect(relisted[0].status).toBe('approved');
  });

  it('composes a snapshot from records, artifacts and proposals', async () => {
    const host = new FakeVaultHost();
    const store = createVaultBrainStore(host);
    const { project } = await store.ensureProject({ name: 'Spark-Brain', slug: 'spark-brain' });

    await store.ensureRecord(project.id, makeRecord('brain.identity.spark', 'identity'));
    await store.persistArtifact(project.id, makeArtifact('SPARK.md', 'hash-1'));

    const snapshot = await store.createSnapshot(project.id);
    expect(snapshot.project.id).toBe('project.spark-brain');
    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.artifacts).toHaveLength(1);
  });
});
