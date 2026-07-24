import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Vault } from './vault.js';
import { getDatabase, getRawDatabase } from './database/connection.js';
import {
  createAuthorizationPolicy,
  evaluateAuthorizationPolicy,
  recordExternalApprovalDecision,
} from './services/authorization.service.js';
import type { ActorContext, CreateOpenLoopInput } from './types/index.js';

describe.sequential('v0.6.3 governance security regressions', () => {
  let root: string;
  let vault: Vault;
  let actor: ActorContext;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vault-v063-security-'));
    vault = new Vault(root);
    vault.initialize();
    actor = vault.getOpenLoopInstallationDefaults().actor;
  });

  afterEach(() => {
    vault.reset();
    rmSync(root, { recursive: true, force: true });
  });

  it('does not trust a caller-declared external approval without a stored decision', () => {
    const db = getDatabase(join(root, 'registry', 'vault.db'));
    const policy = createAuthorizationPolicy(db, {
      policyUid: 'auth_external_stored_only',
      name: 'Stored external decisions only',
      mode: 'external',
      externalProvider: 'policy-engine',
      actions: ['transition_project_lifecycle'],
    });

    expect(evaluateAuthorizationPolicy(db, policy, {
      actorUid: 'forged-external',
      actorKind: 'external',
      roles: [],
      externalProvider: 'policy-engine',
      externalDecisionId: 'forged-decision',
      externalApproved: true,
    }).authorized).toBe(false);
  });

  it('binds quorum approvals to request action, target, policy, status, expiry, and scope', () => {
    const db = getDatabase(join(root, 'registry', 'vault.db'));
    const raw = getRawDatabase()!;
    const policy = createAuthorizationPolicy(db, {
      policyUid: 'auth_quorum_bound',
      name: 'Bound quorum',
      mode: 'quorum',
      allowedRoles: ['reviewer'],
      quorum: 2,
      actions: ['transition_project_lifecycle'],
    });
    const future = new Date(Date.now() + 60_000).toISOString();
    const scope = JSON.stringify({ previousState: 'shadow', nextState: 'gate_active' });
    raw.prepare(`
      INSERT INTO approval_requests (
        request_uid, action, target_uid, policy_uid, policy_version,
        requester_actor_uid, requester_actor_kind, scope_json, reason,
        status, expires_at, idempotency_key, created_at, decided_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'request-bound', 'transition_project_lifecycle', 'project-a', policy.policyUid, policy.version,
      'requester', 'user', scope, 'Bound request', 'approved', future,
      'request-bound-idem', new Date().toISOString(), new Date().toISOString(),
    );
    for (const reviewer of ['reviewer-a', 'reviewer-b']) {
      raw.prepare(`
        INSERT INTO approval_records (
          approval_uid, request_uid, action, target_uid, policy_uid, policy_version,
          actor_uid, actor_kind, actor_roles_json, decision, scope_json, reason,
          idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `approval-${reviewer}`, 'request-bound', 'transition_project_lifecycle', 'project-a',
        policy.policyUid, policy.version, reviewer, 'user', '["reviewer"]', 'approved', scope,
        'Bound approval', `approval-${reviewer}-idem`, new Date().toISOString(),
      );
    }

    const evaluateBound = (targetUid: string, expectedScope: Record<string, unknown>) => (
      evaluateAuthorizationPolicy as unknown as (...args: unknown[]) => { authorized: boolean }
    )(
      db,
      policy,
      { actorUid: 'requester', actorKind: 'user', roles: [] },
      null,
      'request-bound',
      {
        action: 'transition_project_lifecycle',
        targetUid,
        scope: expectedScope,
        requireApprovedRequest: true,
      },
    );

    expect(evaluateBound('project-b', { previousState: 'shadow', nextState: 'gate_active' }).authorized).toBe(false);
    expect(evaluateBound('project-a', { previousState: 'shadow', nextState: 'gate_ready' }).authorized).toBe(false);
    expect(evaluateBound('project-a', { previousState: 'shadow', nextState: 'gate_active' }).authorized).toBe(true);
    expect(evaluateBound('project-a', {
      previousState: 'shadow',
      nextState: 'gate_active',
      optionalPersistedField: undefined,
    }).authorized).toBe(true);

    raw.prepare("UPDATE approval_requests SET expires_at = ? WHERE request_uid = 'request-bound'")
      .run(new Date(Date.now() - 60_000).toISOString());
    expect(evaluateBound('project-a', { previousState: 'shadow', nextState: 'gate_active' }).authorized).toBe(false);
  });

  it('requires and persists structured evidence before gate activation', () => {
    const project = createWorkProject('Evidence activation');
    const base = {
      project: project.projectUid!,
      nextState: 'gate_active' as const,
      reason: 'Activate only with verifiable evidence.',
      actor,
      expectedVersion: project.version,
      idempotencyKey: 'activation-evidence-required',
    };

    expect(() => vault.transitionProjectLifecycle(base)).toThrow(/evidence/i);
    const activated = vault.transitionProjectLifecycle({
      ...base,
      idempotencyKey: 'activation-evidence-present',
      evidence: [{
        kind: 'test',
        reference: 'vitest://v063/security-regression',
        description: 'The focused governance regression suite passed.',
      }],
    } as Parameters<typeof vault.transitionProjectLifecycle>[0] & { evidence: unknown[] });
    expect(activated.project.lifecycleState).toBe('gate_active');

    const raw = getRawDatabase()!;
    const row = raw.prepare('SELECT payload_json FROM project_events WHERE event_uid = ?')
      .get(activated.eventUid) as { payload_json: string };
    expect(JSON.parse(row.payload_json)).toMatchObject({
      evidence: [{ kind: 'test', reference: 'vitest://v063/security-regression' }],
    });
  });

  it('blocks Work-to-Brain conversion while executable tasks are pending', () => {
    const project = createWorkProject('Conversion with pending work');
    vault.createTask({
      title: 'Pending executable task',
      taskType: 'analysis',
      prompt: 'This work must not survive a Brain conversion.',
      project: project.name,
      createdBy: 'test',
    });

    expect(() => vault.convertProjectType({
      project: project.projectUid!,
      targetType: 'brain_context',
      config: { memoryPurpose: 'Reference only.' },
      reason: 'Attempt conversion with queued work.',
      actor,
      expectedVersion: project.version,
      idempotencyKey: 'brain-conversion-pending-task',
    })).toThrow(/task|executable work/i);
    expect(vault.getProject(project.name)?.projectType).toBe('work_project');
  });

  it('enforces Brain zero-loop invariants against direct alternate writers', () => {
    const brain = vault.createProject({
      name: 'Trigger protected Brain',
      projectType: 'brain_context',
      memoryPurpose: 'Reference only.',
    });
    const memory = vault.saveMemory({
      title: 'Reference memory',
      project: brain.name,
      memoryType: 'reference',
      subject: 'Reference',
      summary: 'A reference without executable commitments.',
    }).item;
    const raw = getRawDatabase()!;

    expect(() => raw.prepare('UPDATE memory_items SET next_steps_json = ? WHERE item_uid = ?')
      .run('["Execute forbidden work"]', memory.itemUid)).toThrow(/brain/i);
    expect(() => raw.prepare(`
      INSERT INTO tasks (
        task_uid, title, task_type, status, priority, project, prompt, context_json,
        retry_count, max_retries, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, 'pending', 'normal', ?, ?, ?, 0, 2, 'alternate-writer', ?, ?)
    `).run(
      'vt_direct_brain_bypass', 'Forbidden direct task', 'analysis', brain.name,
      'Execute work in a Brain context.', JSON.stringify({ $vaultLifecycle: { workIntent: 'normal_work' } }),
      new Date().toISOString(), new Date().toISOString(),
    )).toThrow(/brain/i);
  });

  it('rejects missing projects and caller-forged maintenance intent', () => {
    // Deliberately omit the now-required project to prove runtime admission
    // still rejects a malformed caller, not only the compile-time contract.
    expect(() => vault.createTask({
      title: 'Projectless bypass',
      taskType: 'analysis',
      prompt: 'Attempt to bypass project governance by omitting the project.',
      createdBy: 'test',
    } as unknown as Parameters<typeof vault.createTask>[0])).toThrow(/project/i);

    const brain = vault.createProject({
      name: 'Maintenance forgery Brain',
      projectType: 'brain_context',
      memoryPurpose: 'Reference only.',
    });
    expect(() => vault.createTask({
      title: 'Forged maintenance task',
      taskType: 'organize',
      prompt: 'Attempt to self-declare trusted maintenance.',
      project: brain.name,
      workIntent: 'memory_maintenance',
      createdBy: 'system',
    })).toThrow(/trusted internal duty writers/i);
  });

  it('rejects unknown and memory-mismatched task projects', () => {
    expect(() => vault.createTask({
      title: 'Unknown project bypass',
      taskType: 'analysis',
      prompt: 'Bypass a governed project using an unknown name.',
      project: 'does-not-exist',
      createdBy: 'test',
    })).toThrow(/project/i);

    const owner = createWorkProject('Memory owner');
    const other = createWorkProject('Wrong task project');
    const memory = vault.saveMemory({
      title: 'Owned memory',
      project: owner.name,
      memoryType: 'reference',
      subject: 'Owned memory',
      summary: 'This memory belongs to its canonical project.',
    }).item;
    expect(() => vault.createTask({
      title: 'Mismatched memory target',
      taskType: 'enrich',
      prompt: 'Attempt to target a memory through another project.',
      project: other.name,
      targetMemoryUid: memory.itemUid,
      createdBy: 'test',
    })).toThrow(/project|memory/i);
  });

  it('deduplicates task creation by idempotency key and rejects conflicting reuse', () => {
    const project = createWorkProject('Idempotent tasks');
    const input = {
      title: 'One durable task',
      taskType: 'analysis' as const,
      prompt: 'Create exactly one task row.',
      project: project.name,
      idempotencyKey: 'task-idempotency-security',
      createdBy: 'test',
    };
    const first = vault.createTask(input);
    const replay = vault.createTask(input);
    expect(replay.taskUid).toBe(first.taskUid);
    expect(() => vault.createTask({ ...input, prompt: 'Conflicting mutation.' })).toThrow(/idempotency/i);
  });

  it('preserves governed intent on claim and revalidates queued tasks before execution', () => {
    const project = createWorkProject('Claim revalidation');
    const loop = vault.createOpenLoop(loopInput(project.projectUid!, 'claim-loop', 'claim-loop-create')).loop;
    const evidenceTask = vault.createTask({
      title: 'Gather loop evidence',
      taskType: 'analysis',
      prompt: 'Gather evidence for the loop.',
      project: project.name,
      workIntent: 'gather_evidence',
      relatedLoopUid: loop.loopUid,
      createdBy: 'test',
    });
    const claimedEvidence = vault.claimNextTask('analysis');
    expect(claimedEvidence).toMatchObject({
      taskUid: evidenceTask.taskUid,
      workIntent: 'gather_evidence',
      relatedLoopUid: loop.loopUid,
    });
    vault.cancelTask(evidenceTask.taskUid);

    const queued = vault.createTask({
      title: 'Queued normal work',
      taskType: 'research',
      prompt: 'This was admitted before gate activation.',
      project: project.name,
      createdBy: 'test',
    });
    vault.transitionProjectLifecycle({
      project: project.projectUid!,
      nextState: 'gate_active',
      reason: 'Activate with a known blocker.',
      actor,
      expectedVersion: project.version,
      idempotencyKey: 'claim-revalidation-activate',
      evidence: [{
        kind: 'test',
        reference: 'vitest://claim/revalidation',
        description: 'Claim-time revalidation fixture.',
      }],
    } as Parameters<typeof vault.transitionProjectLifecycle>[0] & { evidence: unknown[] });

    expect(vault.claimNextTask('research')).toBeNull();
    expect(vault.getTask(queued.taskUid)).toMatchObject({
      status: 'failed',
      errorMessage: expect.stringMatching(/admission|gate|blocked/i),
    });
  });

  it('fails legacy projectless and unknown-project tasks at claim time instead of running them', () => {
    const raw = getRawDatabase()!;
    const insertLegacy = (uid: string, project: string | null) => raw.prepare(`
      INSERT INTO tasks (
        task_uid, title, task_type, status, priority, project, prompt, context_json,
        retry_count, max_retries, created_by, created_at, updated_at
      ) VALUES (?, ?, 'analysis', 'pending', 'normal', ?, ?, '{}', 0, 2, 'system', ?, ?)
    `).run(uid, `Legacy ${uid}`, project, 'Legacy work admitted under v0.6.2.',
      new Date().toISOString(), new Date().toISOString());
    // Both rows model tasks that existed before v0.6.3 required a canonical project.
    insertLegacy('vt_legacy_projectless', null);
    insertLegacy('vt_legacy_unknown', 'does-not-exist');

    expect(vault.claimNextTask('analysis')).toBeNull();
    expect(vault.getTask('vt_legacy_projectless')).toMatchObject({
      status: 'failed',
      errorMessage: expect.stringMatching(/project/i),
    });
    expect(vault.getTask('vt_legacy_unknown')).toMatchObject({
      status: 'failed',
      errorMessage: expect.stringMatching(/project/i),
    });
  });

  it('authorizes only a trusted external decision whose persisted provider matches the policy', () => {
    const db = getDatabase(join(root, 'registry', 'vault.db'));
    const raw = getRawDatabase()!;
    const policy = createAuthorizationPolicy(db, {
      policyUid: 'auth_external_trusted',
      name: 'Trusted external provider',
      mode: 'external',
      externalProvider: 'policy-engine',
      actions: ['transition_project_lifecycle'],
    });
    const future = new Date(Date.now() + 60_000).toISOString();
    const scope = { previousState: 'shadow', nextState: 'gate_active' };
    const insertRequest = (requestUid: string) => raw.prepare(`
      INSERT INTO approval_requests (
        request_uid, action, target_uid, policy_uid, policy_version,
        requester_actor_uid, requester_actor_kind, scope_json, reason,
        status, expires_at, idempotency_key, created_at, decided_at
      ) VALUES (?, 'transition_project_lifecycle', 'project-ext', ?, ?, 'requester', 'user', ?, 'External request', 'approved', ?, ?, ?, ?)
    `).run(requestUid, policy.policyUid, policy.version, JSON.stringify(scope), future,
      `${requestUid}-idem`, new Date().toISOString(), new Date().toISOString());
    insertRequest('req-ext');

    // A mismatched provider is refused at the trusted ingestion boundary.
    expect(() => recordExternalApprovalDecision(db, {
      approvalUid: 'appr-ext-wrong',
      requestUid: 'req-ext',
      action: 'transition_project_lifecycle',
      targetUid: 'project-ext',
      policyUid: policy.policyUid,
      externalProvider: 'impostor-engine',
      externalDecisionId: 'decision-wrong',
      scope,
      reason: 'Provider does not match the policy.',
      idempotencyKey: 'appr-ext-wrong-idem',
    })).toThrow(/provider/i);

    expect(() => recordExternalApprovalDecision(db, {
      approvalUid: 'appr-ext-wrong-scope',
      requestUid: 'req-ext',
      action: 'transition_project_lifecycle',
      targetUid: 'project-ext',
      policyUid: policy.policyUid,
      externalProvider: 'policy-engine',
      externalDecisionId: 'decision-wrong-scope',
      scope: { previousState: 'shadow', nextState: 'gate_ready' },
      reason: 'Scope does not match the request.',
      idempotencyKey: 'appr-ext-wrong-scope-idem',
    })).toThrow(/scope/i);

    // The correct provider ingests a bound, persisted decision.
    recordExternalApprovalDecision(db, {
      approvalUid: 'appr-ext-ok',
      requestUid: 'req-ext',
      action: 'transition_project_lifecycle',
      targetUid: 'project-ext',
      policyUid: policy.policyUid,
      externalProvider: 'policy-engine',
      externalDecisionId: 'decision-ok',
      scope,
      reason: 'Trusted external approval.',
      idempotencyKey: 'appr-ext-ok-idem',
    });

    const evaluate = (targetUid: string, requestUid: string) => (
      evaluateAuthorizationPolicy as unknown as (...args: unknown[]) => { authorized: boolean }
    )(
      db,
      policy,
      { actorUid: 'requester', actorKind: 'external', roles: [] },
      null,
      requestUid,
      { action: 'transition_project_lifecycle', targetUid, scope, requireApprovedRequest: true },
    );
    expect(evaluate('project-ext', 'req-ext').authorized).toBe(true);
    expect(evaluate('project-other', 'req-ext').authorized).toBe(false);

    // A raw record persisted with a mismatched provider must not authorize, proving
    // the evaluator binds the stored provider to the policy — not just ingestion.
    insertRequest('req-ext-mismatch');
    raw.prepare(`
      INSERT INTO approval_records (
        approval_uid, request_uid, action, target_uid, policy_uid, policy_version,
        actor_uid, actor_kind, actor_roles_json, decision, scope_json, reason,
        external_decision_id, external_provider, idempotency_key, created_at
      ) VALUES ('appr-ext-mismatch', 'req-ext-mismatch', 'transition_project_lifecycle', 'project-ext', ?, ?, 'external:impostor-engine', 'external', '[]', 'approved', ?, 'Mismatched provider', 'decision-mismatch', 'impostor-engine', 'appr-ext-mismatch-idem', ?)
    `).run(policy.policyUid, policy.version, JSON.stringify(scope), new Date().toISOString());
    expect(evaluate('project-ext', 'req-ext-mismatch').authorized).toBe(false);
  });

  it('uses one provider-bound external record as the sole lifecycle authority', () => {
    const project = createWorkProject('External lifecycle authority');
    const db = getDatabase(join(root, 'registry', 'vault.db'));
    const raw = getRawDatabase()!;
    const policy = createAuthorizationPolicy(db, {
      policyUid: 'auth_external_lifecycle',
      name: 'External lifecycle authority',
      mode: 'external',
      externalProvider: 'policy-engine',
      actions: ['transition_project_lifecycle'],
    });
    raw.prepare('UPDATE projects SET authorization_policy_id = ? WHERE project_uid = ?')
      .run(policy.policyUid, project.projectUid);

    const evidence = [{
      kind: 'test' as const,
      reference: 'vitest://external/lifecycle-authority',
      description: 'Trusted external lifecycle authorization fixture.',
    }];
    const scope = {
      previousState: 'shadow',
      nextState: 'gate_active',
      evidence,
    };
    const requestUid = 'req-external-lifecycle';
    const future = new Date(Date.now() + 60_000).toISOString();
    raw.prepare(`
      INSERT INTO approval_requests (
        request_uid, action, target_uid, policy_uid, policy_version,
        requester_actor_uid, requester_actor_kind, scope_json, reason,
        status, expires_at, idempotency_key, created_at, decided_at
      ) VALUES (?, 'transition_project_lifecycle', ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, NULL)
    `).run(
      requestUid,
      project.projectUid,
      policy.policyUid,
      policy.version,
      actor.actorUid,
      actor.actorKind,
      JSON.stringify(scope),
      'Request external lifecycle approval.',
      future,
      'req-external-lifecycle-idem',
      new Date().toISOString(),
    );

    vault.recordExternalApprovalDecision({
      approvalUid: 'appr-external-lifecycle',
      requestUid,
      action: 'transition_project_lifecycle',
      targetUid: project.projectUid!,
      policyUid: policy.policyUid,
      externalProvider: 'policy-engine',
      externalDecisionId: 'decision-external-lifecycle',
      scope,
      reason: 'Trusted external policy engine approved activation.',
      idempotencyKey: 'appr-external-lifecycle-idem',
    });
    const activated = vault.transitionProjectLifecycle({
      project: project.projectUid!,
      nextState: 'gate_active',
      reason: 'Apply the provider-bound activation decision.',
      evidence,
      actor,
      expectedVersion: project.version,
      idempotencyKey: 'external-lifecycle-activation',
      authorizationRequestUid: requestUid,
    });
    expect(activated.project.lifecycleState).toBe('gate_active');

    const approvals = raw.prepare(`
      SELECT actor_uid, actor_kind, external_provider, external_decision_id
      FROM approval_records WHERE request_uid = ?
    `).all(requestUid);
    expect(approvals).toEqual([{
      actor_uid: 'external:policy-engine',
      actor_kind: 'external',
      external_provider: 'policy-engine',
      external_decision_id: 'decision-external-lifecycle',
    }]);
  });
  function createWorkProject(name: string) {
    return vault.createProject({
      name,
      projectType: 'work_project',
      description: `${name} description`,
      canonicalRoot: root,
    });
  }

  function loopInput(projectUid: string, dedupeKey: string, idempotencyKey: string): CreateOpenLoopInput {
    return {
      projectUid,
      title: 'Blocking commitment',
      commitment: 'Deliver a verified result.',
      deferredReason: 'Verification must occur later.',
      ownerKind: 'user',
      ownerReference: actor.actorUid,
      immediateNextAction: 'Gather evidence.',
      triggerKind: 'checkpoint',
      triggerValue: 'verification',
      currentEvidenceSummary: 'No evidence yet.',
      closureCriteria: 'Verification evidence is attached.',
      priority: 'normal',
      dedupeKey,
      sourceContext: { test: true },
      creatingActor: actor,
      idempotencyKey,
    };
  }
});
