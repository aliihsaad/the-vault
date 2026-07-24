import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Vault } from './vault.js';
import { getDatabase, getRawDatabase } from './database/connection.js';
import {
  createOpenLoop as createOpenLoopService,
  resolveOpenLoop as resolveOpenLoopService,
} from './services/open-loop.service.js';
import {
  createAuthorizationPolicy,
  evaluateAuthorizationPolicy,
} from './services/authorization.service.js';
import type {
  ActorContext,
  CreateOpenLoopInput,
  DedicatedOpenLoop,
} from './types/index.js';

describe.sequential('Open-Loops v2 Phases B-D lifecycle', () => {
  let root: string;
  let vault: Vault;
  let actor: ActorContext;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vault-open-loops-v2-'));
    vault = new Vault(root);
    vault.initialize();
    actor = vault.getOpenLoopInstallationDefaults().actor;
  });

  afterEach(() => {
    vault.reset();
    rmSync(root, { recursive: true, force: true });
  });

  it('keeps legacy projects unclassified, never infers from names, and governs classification', () => {
    vault.saveMemory({
      title: 'Legacy context',
      project: 'Brain-looking legacy project',
      memoryType: 'reference',
      subject: 'Legacy',
      summary: 'Ambiguous legacy context.',
    });
    expect(vault.getProject('Brain-looking legacy project')?.projectType).toBe('unclassified');

    const explicitlyWork = vault.createProject({
      name: 'Codex-brain',
      projectType: 'work_project',
      description: 'An executable project despite its name.',
      canonicalRoot: root,
    });
    expect(explicitlyWork.projectType).toBe('work_project');

    const unauthorized = { actorUid: 'actor_intruder', actorKind: 'user' as const, roles: [] };
    const dryRun = vault.buildProjectClassificationDryRun({
      project: 'Brain-looking legacy project',
      targetType: 'brain_context',
      config: { memoryPurpose: 'Durable context.' },
      actor: unauthorized,
      expectedVersion: 0,
      idempotencyKey: 'classification-dry-run',
      dryRun: true,
    });
    expect(dryRun.allowed).toBe(false);
    expect(dryRun.reasonCodes).toContain('AUTHORIZATION_DENIED');
    expect(() => vault.classifyProject({
      project: 'Brain-looking legacy project',
      targetType: 'brain_context',
      config: { memoryPurpose: 'Durable context.' },
      actor: unauthorized,
      expectedVersion: 0,
      idempotencyKey: 'classification-denied',
    })).toThrow(/not allowed/i);
    expect(vault.getProject('Brain-looking legacy project')).toMatchObject({ projectType: 'unclassified', version: 0 });

    const classified = vault.classifyProject({
      project: 'Brain-looking legacy project',
      targetType: 'brain_context',
      config: { memoryPurpose: 'Durable context.' },
      actor,
      expectedVersion: 0,
      idempotencyKey: 'classification-approved',
    });
    expect(classified.project).toMatchObject({ projectType: 'brain_context', lifecycleState: 'shadow', version: 1 });
    expect(vault.classifyProject({
      project: 'Brain-looking legacy project',
      targetType: 'brain_context',
      config: { memoryPurpose: 'Durable context.' },
      actor,
      expectedVersion: 0,
      idempotencyKey: 'classification-approved',
    }).idempotentReplay).toBe(true);
  });

  it('converts project types transactionally while preserving identity and enforcing Brain zero-loop history', () => {
    const convertible = createWorkProject('Convertible project');
    const asBrain = vault.convertProjectType({
      project: convertible.projectUid!,
      targetType: 'brain_context',
      config: { memoryPurpose: 'Retained reference context.' },
      reason: 'Execution has moved elsewhere.',
      actor,
      expectedVersion: convertible.version,
      idempotencyKey: 'convert-to-brain',
    });
    expect(asBrain.project).toMatchObject({
      projectUid: convertible.projectUid,
      projectType: 'brain_context',
      lifecycleState: 'shadow',
      version: 2,
    });

    const asWork = vault.convertProjectType({
      project: convertible.projectUid!,
      targetType: 'work_project',
      config: { description: 'Execution is active again.', canonicalRoot: root },
      reason: 'The context now owns executable work.',
      actor,
      expectedVersion: 2,
      idempotencyKey: 'convert-back-to-work',
    });
    expect(asWork.project).toMatchObject({
      projectUid: convertible.projectUid,
      projectType: 'work_project',
      version: 3,
    });

    const historical = createWorkProject('Loop-history project');
    const created = vault.createOpenLoop(loopInput(historical.projectUid!, 'history-loop', 'history-loop-create'));
    const evidenced = vault.addLoopEvidence({
      loopUid: created.loop.loopUid,
      evidence: [{ kind: 'decision', reference: 'decision:retire-history-loop', description: 'Durable retirement decision.' }],
      currentEvidenceSummary: 'The retirement decision is recorded.',
      actor,
      expectedVersion: created.loop.version,
      idempotencyKey: 'history-loop-evidence',
    });
    vault.resolveOpenLoop({
      loopUid: created.loop.loopUid,
      outcome: 'obsolete',
      resolutionNote: 'The commitment is no longer applicable.',
      verifier: actor,
      expectedVersion: evidenced.loop.version,
      idempotencyKey: 'history-loop-resolve',
    });

    const dryRun = vault.buildProjectClassificationDryRun({
      project: historical.projectUid!,
      targetType: 'brain_context',
      config: { memoryPurpose: 'Attempted context conversion.' },
      reason: 'Test strict invariant.',
      actor,
      expectedVersion: historical.version,
      idempotencyKey: 'history-convert-dry-run',
      dryRun: true,
    });
    expect(dryRun).toMatchObject({
      allowed: false,
      dedicatedNonterminalLoopCount: 0,
      dedicatedLoopCount: 1,
    });
    expect(dryRun.reasonCodes).toContain('LOOPS_PREVENT_BRAIN_CONVERSION');
    expect(() => vault.convertProjectType({
      project: historical.projectUid!,
      targetType: 'brain_context',
      config: { memoryPurpose: 'Attempted context conversion.' },
      reason: 'Test strict invariant.',
      actor,
      expectedVersion: historical.version,
      idempotencyKey: 'history-convert',
    })).toThrow(/LOOPS_PREVENT_BRAIN_CONVERSION/i);
    expect(() => getRawDatabase()!.prepare(
      'UPDATE projects SET project_type = ? WHERE project_uid = ?',
    ).run('brain_context', historical.projectUid)).toThrow(/BRAIN_CONTEXT_HAS_LOOP_HISTORY/);
  });

  it('enforces strict admission, Brain rejection, dedupe, and rollback without partial events', async () => {
    const work = createWorkProject('Admission work');
    const brain = vault.createProject({
      name: 'Admission brain',
      projectType: 'brain_context',
      memoryPurpose: 'Context only.',
    });

    expect(() => vault.createOpenLoop(loopInput(brain.projectUid!, 'brain-loop', 'brain-create')))
      .toThrow(/Brain contexts cannot own/);
    expect(() => vault.createOpenLoop({
      ...loopInput(work.projectUid!, 'missing-field', 'missing-create'),
      closureCriteria: '',
    })).toThrow();

    const first = loopInput(work.projectUid!, 'shared-dedupe', 'concurrent-a');
    const second = loopInput(work.projectUid!, 'shared-dedupe', 'concurrent-b');
    const raced = await Promise.allSettled([
      Promise.resolve().then(() => vault.createOpenLoop(first)),
      Promise.resolve().then(() => vault.createOpenLoop(second)),
    ]);
    expect(raced.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(raced.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(vault.countDedicatedOpenLoops({ projectUid: work.projectUid! }).total).toBe(1);

    const replayInput = loopInput(work.projectUid!, 'idempotent-loop', 'same-idempotency');
    const created = vault.createOpenLoop(replayInput);
    const replay = vault.createOpenLoop(replayInput);
    expect(replay).toMatchObject({ eventUid: created.eventUid, idempotentReplay: true });
    expect(replay.loop.loopUid).toBe(created.loop.loopUid);
    expect(() => vault.transitionOpenLoop({
      loopUid: created.loop.loopUid,
      nextState: 'verification_needed',
      reason: 'Conflicting idempotency reuse.',
      actor,
      expectedVersion: created.loop.version,
      idempotencyKey: 'same-idempotency',
    })).toThrow(/different loop mutation/i);

    const raw = getRawDatabase()!;
    const beforeRows = countRows('open_loops');
    const beforeEvents = countRows('loop_events');
    const beforeApprovals = countRows('approval_records');
    const db = getDatabase(join(root, 'registry', 'vault.db'));
    expect(() => createOpenLoopService(
      db,
      loopInput(work.projectUid!, 'rollback-loop', 'rollback-create'),
      { beforeEventWrite: () => { throw new Error('injected event failure'); } },
    )).toThrow(/injected event failure/);
    expect(countRows('open_loops')).toBe(beforeRows);
    expect(countRows('loop_events')).toBe(beforeEvents);
    expect(countRows('approval_records')).toBe(beforeApprovals);
    expect(raw.prepare('SELECT COUNT(*) AS count FROM open_loops WHERE dedupe_key = ?').get('rollback-loop'))
      .toEqual({ count: 0 });
  });

  it('evaluates same-project blockers deterministically while leaving independent projects available', async () => {
    const blocked = createWorkProject('Blocked project');
    const independent = createWorkProject('Independent project');
    const loop = vault.createOpenLoop(loopInput(blocked.projectUid!, 'gate-loop', 'gate-loop-create')).loop;

    const denied = vault.evaluateProjectGate({
      projectUid: blocked.projectUid!,
      workIntent: 'normal_work',
      actor,
      idempotencyKey: 'gate-denied',
    });
    expect(denied).toMatchObject({ allowed: false, reasonCode: 'SAME_PROJECT_BLOCKED' });
    expect(denied.blockerUids).toEqual([loop.loopUid]);

    expect(vault.evaluateProjectGate({
      projectUid: blocked.projectUid!,
      workIntent: 'gather_evidence',
      relatedLoopUid: loop.loopUid,
      actor,
      idempotencyKey: 'gate-evidence',
    })).toMatchObject({ allowed: true, reasonCode: 'RELATED_LOOP_ALLOWED' });
    expect(vault.evaluateProjectGate({
      projectUid: independent.projectUid!,
      workIntent: 'normal_work',
      actor,
      idempotencyKey: 'gate-independent',
    })).toMatchObject({ allowed: true, reasonCode: 'NO_BLOCKERS' });

    const concurrent = await Promise.all([
      Promise.resolve().then(() => vault.evaluateProjectGate({
        projectUid: blocked.projectUid!, workIntent: 'normal_work', actor, idempotencyKey: 'gate-race',
      })),
      Promise.resolve().then(() => vault.evaluateProjectGate({
        projectUid: blocked.projectUid!, workIntent: 'normal_work', actor, idempotencyKey: 'gate-race',
      })),
    ]);
    expect(concurrent.every((result) => result.allowed === false)).toBe(true);
    expect(concurrent.filter((result) => result.idempotentReplay)).toHaveLength(1);
    expect(getRawDatabase()!.prepare('SELECT COUNT(*) AS count FROM gate_events WHERE idempotency_key = ?').get('gate-race'))
      .toEqual({ count: 1 });
    expect(() => vault.evaluateProjectGate({
      projectUid: blocked.projectUid!,
      workIntent: 'memory_maintenance',
      actor,
      idempotencyKey: 'gate-race',
    })).toThrow(/different gate evaluation/i);
  });

  it('requires governed snooze approval, preserves resume state, and re-blocks on expiry', () => {
    const project = createWorkProject('Snooze work');
    const created = vault.createOpenLoop(loopInput(project.projectUid!, 'snooze-loop', 'snooze-create')).loop;
    const waiting = vault.transitionOpenLoop({
      loopUid: created.loopUid,
      nextState: 'awaiting_user',
      reason: 'Waiting for a user answer.',
      actor,
      expectedVersion: created.version,
      idempotencyKey: 'snooze-waiting',
    }).loop;
    const snoozedUntil = new Date(Date.now() + 60_000).toISOString();
    const request = vault.requestLoopSnooze({
      loopUid: waiting.loopUid,
      reason: 'Pause until the review window.',
      snoozedUntil,
      requester: actor,
      expectedVersion: waiting.version,
      idempotencyKey: 'snooze-request',
    });
    expect(() => vault.decideLoopSnooze({
      requestUid: request.request.requestUid,
      loopUid: waiting.loopUid,
      decision: 'approved',
      reason: 'Unauthorized attempt.',
      approver: { actorUid: 'actor_intruder', actorKind: 'user', roles: [] },
      expectedVersion: request.loop.version,
      idempotencyKey: 'snooze-unauthorized',
    })).toThrow(/not eligible/);
    expect(vault.getDedicatedOpenLoop(waiting.loopUid)?.state).toBe('awaiting_user');

    const decision = vault.decideLoopSnooze({
      requestUid: request.request.requestUid,
      loopUid: waiting.loopUid,
      decision: 'approved',
      reason: 'Approved pause.',
      approver: actor,
      expectedVersion: request.loop.version,
      idempotencyKey: 'snooze-approved',
    });
    expect(decision.loop).toMatchObject({
      state: 'snoozed',
      resumeState: 'awaiting_user',
      snoozedUntil,
    });
    expect(vault.evaluateProjectGate({
      projectUid: project.projectUid!,
      workIntent: 'normal_work',
      actor,
      idempotencyKey: 'snooze-gate-open',
    }).allowed).toBe(true);
    expect(() => vault.decideLoopSnooze({
      requestUid: request.request.requestUid,
      loopUid: waiting.loopUid,
      decision: 'approved',
      reason: 'Silent extension.',
      approver: actor,
      expectedVersion: decision.loop.version,
      idempotencyKey: 'snooze-reuse-request',
    })).toThrow(/already approved/);

    expect(vault.expireDueSnoozes(new Date(Date.now() + 120_000).toISOString())).toBe(1);
    expect(vault.getDedicatedOpenLoop(waiting.loopUid)).toMatchObject({
      state: 'awaiting_user',
      resumeState: null,
      snoozedUntil: null,
    });
    expect(vault.evaluateProjectGate({
      projectUid: project.projectUid!,
      workIntent: 'normal_work',
      actor,
      idempotencyKey: 'snooze-gate-reblocked',
    }).allowed).toBe(false);
  });

  it('evaluates owner, role, quorum, and external authorization policy fixtures', () => {
    const db = getDatabase(join(root, 'registry', 'vault.db'));
    const owner = createAuthorizationPolicy(db, {
      policyUid: 'auth_owner_fixture',
      name: 'Owner fixture',
      mode: 'owner',
      ownerActorUid: 'owner-1',
      actions: ['decide_loop_snooze'],
    });
    expect(evaluateAuthorizationPolicy(db, owner, {
      actorUid: 'owner-1', actorKind: 'user', roles: [],
    }).authorized).toBe(true);
    expect(evaluateAuthorizationPolicy(db, owner, {
      actorUid: 'owner-2', actorKind: 'user', roles: [],
    }).authorized).toBe(false);

    const role = createAuthorizationPolicy(db, {
      policyUid: 'auth_role_fixture',
      name: 'Role fixture',
      mode: 'role',
      allowedRoles: ['reviewer'],
      actions: ['decide_loop_snooze'],
    });
    expect(evaluateAuthorizationPolicy(db, role, {
      actorUid: 'reviewer-1', actorKind: 'user', roles: ['reviewer'],
    }).authorized).toBe(true);

    const quorum = createAuthorizationPolicy(db, {
      policyUid: 'auth_quorum_fixture',
      name: 'Quorum fixture',
      mode: 'quorum',
      allowedRoles: ['reviewer'],
      quorum: 2,
      actions: ['decide_loop_snooze'],
    });
    const raw = getRawDatabase()!;
    raw.prepare(`
      INSERT INTO approval_requests (
        request_uid, action, target_uid, policy_uid, policy_version,
        requester_actor_uid, requester_actor_kind, scope_json, reason,
        status, idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('request-quorum', 'decide_loop_snooze', 'target', quorum.policyUid, quorum.version,
      'requester', 'user', '{}', 'Fixture', 'pending', 'request-quorum-idem', new Date().toISOString());
    for (const approver of ['reviewer-a', 'reviewer-b']) {
      raw.prepare(`
        INSERT INTO approval_records (
          approval_uid, request_uid, action, target_uid, policy_uid, policy_version,
          actor_uid, actor_kind, actor_roles_json, decision, scope_json, reason,
          idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(`approval-${approver}`, 'request-quorum', 'decide_loop_snooze', 'target', quorum.policyUid,
        quorum.version, approver, 'user', '["reviewer"]', 'approved', '{}', 'Fixture',
        `approval-${approver}-idem`, new Date().toISOString());
    }
    expect(evaluateAuthorizationPolicy(db, quorum, {
      actorUid: 'requester', actorKind: 'user', roles: [],
    }, null, 'request-quorum', {
      action: 'decide_loop_snooze',
      targetUid: 'target',
      scope: {},
      requireApprovedRequest: false,
    })).toMatchObject({ authorized: true, approvalsRecorded: 2 });

    const external = createAuthorizationPolicy(db, {
      policyUid: 'auth_external_fixture',
      name: 'External fixture',
      mode: 'external',
      externalProvider: 'policy-engine',
      actions: ['decide_loop_snooze'],
    });
    expect(evaluateAuthorizationPolicy(db, external, {
      actorUid: 'external-decision',
      actorKind: 'external',
      roles: [],
      externalProvider: 'policy-engine',
      externalDecisionId: 'decision-123',
      externalApproved: true,
    }).authorized).toBe(false);

    const future = new Date(Date.now() + 10 * 60_000).toISOString();
    const roleProject = createWorkProject('Role snooze fixture');
    const roleLoop = vault.createOpenLoop(loopInput(roleProject.projectUid!, 'role-snooze', 'role-snooze-create')).loop;
    raw.prepare('UPDATE projects SET authorization_policy_id = ? WHERE project_uid = ?')
      .run(role.policyUid, roleProject.projectUid);
    const roleRequest = vault.requestLoopSnooze({
      loopUid: roleLoop.loopUid,
      reason: 'Role policy fixture.',
      snoozedUntil: future,
      requester: actor,
      expectedVersion: roleLoop.version,
      idempotencyKey: 'role-snooze-request',
    });
    expect(vault.decideLoopSnooze({
      requestUid: roleRequest.request.requestUid,
      loopUid: roleLoop.loopUid,
      decision: 'approved',
      reason: 'Reviewer approved.',
      approver: { actorUid: 'reviewer-1', actorKind: 'user', roles: ['reviewer'] },
      expectedVersion: roleRequest.loop.version,
      idempotencyKey: 'role-snooze-approve',
    }).policySatisfied).toBe(true);

    const quorumProject = createWorkProject('Quorum snooze fixture');
    const quorumLoop = vault.createOpenLoop(loopInput(quorumProject.projectUid!, 'quorum-snooze', 'quorum-snooze-create')).loop;
    raw.prepare('UPDATE projects SET authorization_policy_id = ? WHERE project_uid = ?')
      .run(quorum.policyUid, quorumProject.projectUid);
    const quorumRequest = vault.requestLoopSnooze({
      loopUid: quorumLoop.loopUid,
      reason: 'Quorum policy fixture.',
      snoozedUntil: future,
      requester: actor,
      expectedVersion: quorumLoop.version,
      idempotencyKey: 'quorum-snooze-request',
    });
    const firstQuorumDecision = vault.decideLoopSnooze({
      requestUid: quorumRequest.request.requestUid,
      loopUid: quorumLoop.loopUid,
      decision: 'approved',
      reason: 'First reviewer.',
      approver: { actorUid: 'reviewer-c', actorKind: 'user', roles: ['reviewer'] },
      expectedVersion: quorumRequest.loop.version,
      idempotencyKey: 'quorum-snooze-first',
    });
    expect(firstQuorumDecision).toMatchObject({ policySatisfied: false, loop: { state: 'open' } });
    expect(vault.decideLoopSnooze({
      requestUid: quorumRequest.request.requestUid,
      loopUid: quorumLoop.loopUid,
      decision: 'approved',
      reason: 'Second reviewer.',
      approver: { actorUid: 'reviewer-d', actorKind: 'user', roles: ['reviewer'] },
      expectedVersion: firstQuorumDecision.loop.version,
      idempotencyKey: 'quorum-snooze-second',
    })).toMatchObject({ policySatisfied: true, loop: { state: 'snoozed' } });

    const externalProject = createWorkProject('External snooze fixture');
    const externalLoop = vault.createOpenLoop(loopInput(externalProject.projectUid!, 'external-snooze', 'external-snooze-create')).loop;
    raw.prepare('UPDATE projects SET authorization_policy_id = ? WHERE project_uid = ?')
      .run(external.policyUid, externalProject.projectUid);
    const externalRequest = vault.requestLoopSnooze({
      loopUid: externalLoop.loopUid,
      reason: 'External policy fixture.',
      snoozedUntil: future,
      requester: actor,
      expectedVersion: externalLoop.version,
      idempotencyKey: 'external-snooze-request',
    });
    expect(() => vault.decideLoopSnooze({
      requestUid: externalRequest.request.requestUid,
      loopUid: externalLoop.loopUid,
      decision: 'approved',
      reason: 'Caller-asserted external approval must be rejected.',
      approver: {
        actorUid: 'external-decision',
        actorKind: 'external',
        roles: [],
        externalProvider: 'policy-engine',
        externalDecisionId: 'decision-456',
        externalApproved: true,
      },
      expectedVersion: externalRequest.loop.version,
      idempotencyKey: 'external-snooze-forged',
    })).toThrow(/trusted provider|provider-bound|not authorized/i);

    vault.recordExternalApprovalDecision({
      approvalUid: 'external-snooze-trusted-approval',
      requestUid: externalRequest.request.requestUid,
      action: 'decide_loop_snooze',
      targetUid: externalLoop.loopUid,
      policyUid: external.policyUid,
      externalProvider: 'policy-engine',
      externalDecisionId: 'decision-456',
      scope: externalRequest.request.scope,
      reason: 'Trusted policy engine approved the bounded snooze.',
      idempotencyKey: 'external-snooze-ingest',
    });
    expect(vault.decideLoopSnooze({
      requestUid: externalRequest.request.requestUid,
      loopUid: externalLoop.loopUid,
      decision: 'approved',
      reason: 'Apply the already-ingested trusted decision.',
      approver: actor,
      expectedVersion: externalRequest.loop.version,
      idempotencyKey: 'external-snooze-apply',
    })).toMatchObject({
      policySatisfied: true,
      request: { status: 'approved' },
      approval: {
        actorUid: 'external:policy-engine',
        externalProvider: 'policy-engine',
        externalDecisionId: 'decision-456',
      },
      loop: { state: 'snoozed' },
    });
  });

  it('requires outcome-specific evidence and rolls resolution back if its event write fails', () => {
    const project = createWorkProject('Evidence work');
    const fixed = vault.createOpenLoop(loopInput(project.projectUid!, 'fixed-loop', 'fixed-create')).loop;
    expect(() => vault.resolveOpenLoop({
      loopUid: fixed.loopUid,
      outcome: 'fixed',
      resolutionNote: 'No evidence yet.',
      verifier: actor,
      expectedVersion: fixed.version,
      idempotencyKey: 'fixed-insufficient',
    })).toThrow(/verification_needed|evidence/i);
    const verified = vault.addLoopEvidence({
      loopUid: fixed.loopUid,
      evidence: [{ kind: 'test', reference: 'suite:fixed-abc123', description: 'Regression suite passed.', immutableHash: 'abc12345' }],
      currentEvidenceSummary: 'Regression suite passed.',
      actor,
      expectedVersion: fixed.version,
      idempotencyKey: 'fixed-evidence',
      transitionToVerification: true,
    }).loop;
    const beforeEvents = countRows('loop_events');
    const db = getDatabase(join(root, 'registry', 'vault.db'));
    expect(() => resolveOpenLoopService(db, {
      loopUid: fixed.loopUid,
      outcome: 'fixed',
      resolutionNote: 'Verified.',
      verifier: actor,
      expectedVersion: verified.version,
      idempotencyKey: 'fixed-rollback',
    }, { beforeEventWrite: () => { throw new Error('resolution event failure'); } }))
      .toThrow(/resolution event failure/);
    expect(vault.getDedicatedOpenLoop(fixed.loopUid)).toMatchObject({ state: 'verification_needed', version: verified.version });
    expect(countRows('loop_events')).toBe(beforeEvents);

    const resolved = vault.resolveOpenLoop({
      loopUid: fixed.loopUid,
      outcome: 'fixed',
      resolutionNote: 'Verified.',
      verifier: actor,
      expectedVersion: verified.version,
      idempotencyKey: 'fixed-resolved',
    });
    expect(resolved.loop).toMatchObject({ state: 'resolved', terminalOutcome: 'fixed' });
    expect(resolved.gate.allowed).toBe(true);

    for (const outcome of ['obsolete', 'wont_fix'] as const) {
      const loop = vault.createOpenLoop(loopInput(project.projectUid!, `${outcome}-loop`, `${outcome}-create`)).loop;
      const evidenced = vault.addLoopEvidence({
        loopUid: loop.loopUid,
        evidence: [{ kind: 'decision', reference: `decision:${outcome}:2026-07-23`, description: `Durable ${outcome} decision.` }],
        currentEvidenceSummary: `Decision recorded for ${outcome}.`,
        actor,
        expectedVersion: loop.version,
        idempotencyKey: `${outcome}-evidence`,
      }).loop;
      expect(vault.resolveOpenLoop({
        loopUid: loop.loopUid,
        outcome,
        resolutionNote: `Closed as ${outcome}.`,
        verifier: actor,
        expectedVersion: evidenced.version,
        idempotencyKey: `${outcome}-resolved`,
      }).loop.terminalOutcome).toBe(outcome);
    }

    const canonical = vault.createOpenLoop(loopInput(project.projectUid!, 'canonical-loop', 'canonical-create')).loop;
    const duplicate = vault.createOpenLoop(loopInput(project.projectUid!, 'duplicate-loop', 'duplicate-create')).loop;
    const duplicateEvidence = vault.addLoopEvidence({
      loopUid: duplicate.loopUid,
      evidence: [{ kind: 'canonical_loop', reference: canonical.loopUid, description: 'Canonical replacement loop.' }],
      currentEvidenceSummary: 'Canonical duplicate identified.',
      actor,
      expectedVersion: duplicate.version,
      idempotencyKey: 'duplicate-evidence',
    }).loop;
    expect(vault.resolveOpenLoop({
      loopUid: duplicate.loopUid,
      outcome: 'duplicate',
      duplicateOfLoopUid: canonical.loopUid,
      resolutionNote: 'Tracked by canonical loop.',
      verifier: actor,
      expectedVersion: duplicateEvidence.version,
      idempotencyKey: 'duplicate-resolved',
    }).loop.terminalOutcome).toBe('duplicate');
  });

  it('rejects illegal transitions without writes and requires authorization plus version for recovery', () => {
    const project = createWorkProject('Recovery work');
    const loop = vault.createOpenLoop(loopInput(project.projectUid!, 'recovery-loop', 'recovery-create')).loop;
    const beforeEvents = countRows('loop_events');
    expect(() => vault.transitionOpenLoop({
      loopUid: loop.loopUid,
      nextState: 'open',
      reason: 'No-op transition.',
      actor,
      expectedVersion: loop.version,
      idempotencyKey: 'illegal-transition',
    })).toThrow(/Illegal loop transition/);
    expect(vault.getDedicatedOpenLoop(loop.loopUid)).toMatchObject({ state: 'open', version: loop.version });
    expect(countRows('loop_events')).toBe(beforeEvents);

    const evidenced = vault.addLoopEvidence({
      loopUid: loop.loopUid,
      evidence: [{ kind: 'decision', reference: 'decision:obsolete:recovery', description: 'Retirement decision.' }],
      currentEvidenceSummary: 'Retirement decision recorded.',
      actor,
      expectedVersion: loop.version,
      idempotencyKey: 'recovery-evidence',
    }).loop;
    const resolved = vault.resolveOpenLoop({
      loopUid: loop.loopUid,
      outcome: 'obsolete',
      resolutionNote: 'Obsolete.',
      verifier: actor,
      expectedVersion: evidenced.version,
      idempotencyKey: 'recovery-resolve',
    }).loop;
    expect(() => vault.recoverOpenLoop({
      loopUid: loop.loopUid,
      reason: 'Unauthorized reopen.',
      actor: { actorUid: 'intruder', actorKind: 'user', roles: [] },
      expectedVersion: resolved.version,
      idempotencyKey: 'recovery-unauthorized',
    })).toThrow(/not authorized/i);
    expect(() => vault.recoverOpenLoop({
      loopUid: loop.loopUid,
      reason: 'Stale version.',
      actor,
      expectedVersion: resolved.version - 1,
      idempotencyKey: 'recovery-version-conflict',
    })).toThrow(/version conflict/i);
    expect(vault.recoverOpenLoop({
      loopUid: loop.loopUid,
      reason: 'New evidence reopened the commitment.',
      actor,
      expectedVersion: resolved.version,
      idempotencyKey: 'recovery-approved',
      recoveryState: 'verification_needed',
    }).loop).toMatchObject({ state: 'verification_needed', terminalOutcome: null });
  });

  it('reports legacy reconciliation candidates without auto-creating dedicated loops', () => {
    const active = vault.saveMemory({
      title: 'Legacy next step',
      project: 'Legacy candidates',
      memoryType: 'session',
      subject: 'Candidate',
      summary: 'Has a legacy next step.',
      nextSteps: ['Review manually'],
    });
    vault.saveMemory({
      title: 'Debugging candidate',
      project: 'Legacy candidates',
      memoryType: 'session',
      subject: 'Debugging',
      summary: 'Active debugging context.',
      routineType: 'debugging',
    });
    vault.updateMemory(active.item.itemUid, { snoozedUntil: new Date(Date.now() + 60_000).toISOString() });

    const report = vault.inventoryLegacyLoopCandidates('Legacy candidates');
    expect(report).toMatchObject({ dedicatedLoopsCreated: 0 });
    expect(report.total).toBe(2);
    expect(report.byReason).toMatchObject({ non_empty_next_steps: 1, snoozed: 1, active_debugging: 1 });
    expect(vault.countDedicatedOpenLoops().total).toBe(0);
    expect(vault.getOpenLoopShadowTelemetry()).toMatchObject({
      legacySource: 'legacy_memory_items',
      dedicatedSource: 'dedicated_open_loops',
      legacyCount: 1,
      dedicatedCount: 0,
      divergence: -1,
      gateEnforced: false,
    });
  });

  it('preserves dedicated loop references across safe project merges and rejects dedupe collisions', () => {
    const source = createWorkProject('Merge source');
    const target = createWorkProject('Merge target');
    const created = vault.createOpenLoop(loopInput(source.projectUid!, 'merge-loop', 'merge-loop-create'));

    const merged = vault.mergeProject(source.name, target.name, { relocateFiles: false });
    expect(merged.movedLoopUids).toEqual([created.loop.loopUid]);
    expect(vault.getDedicatedOpenLoop(created.loop.loopUid)).toMatchObject({
      projectUid: target.projectUid,
      projectName: target.name,
    });
    expect(vault.getProject(source.name)).toBeNull();

    const conflictingSource = createWorkProject('Conflicting merge source');
    const conflictingTarget = createWorkProject('Conflicting merge target');
    vault.createOpenLoop(loopInput(conflictingSource.projectUid!, 'same-active-key', 'merge-source-create'));
    vault.createOpenLoop(loopInput(conflictingTarget.projectUid!, 'same-active-key', 'merge-target-create'));

    expect(() => vault.mergeProject(conflictingSource.name, conflictingTarget.name, { relocateFiles: false }))
      .toThrow(/duplicate active loop dedupe key/i);
    expect(vault.getProject(conflictingSource.name)).not.toBeNull();
    expect(vault.countDedicatedOpenLoops({ projectUid: conflictingSource.projectUid! }).total).toBe(1);
  });

  function createWorkProject(name: string) {
    return vault.createProject({
      name,
      projectType: 'work_project',
      description: `${name} description`,
      canonicalRoot: root,
    });
  }

  function loopInput(
    projectUid: string,
    dedupeKey: string,
    idempotencyKey: string,
    overrides: Partial<CreateOpenLoopInput> = {},
  ): CreateOpenLoopInput {
    return {
      projectUid,
      title: 'Concrete open loop',
      commitment: 'Deliver a concrete verified result.',
      deferredReason: 'The result requires a later verification step.',
      ownerKind: 'user',
      ownerReference: actor.actorUid,
      immediateNextAction: 'Run the verification procedure.',
      triggerKind: 'checkpoint',
      triggerValue: 'next verified session',
      currentEvidenceSummary: 'Implementation status is known; final verification is pending.',
      closureCriteria: 'A durable evidence reference confirms the verified result.',
      priority: 'high',
      blockingScope: 'project',
      dedupeKey,
      sourceContext: { source: 'acceptance-test', projectUid },
      creatingActor: actor,
      idempotencyKey,
      ...overrides,
    };
  }

  function countRows(table: 'open_loops' | 'loop_events' | 'approval_records'): number {
    return Number((getRawDatabase()!.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
  }
});
