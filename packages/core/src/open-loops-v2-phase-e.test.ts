import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Vault } from './vault.js';
import { getRawDatabase } from './database/connection.js';
import type { ActorContext, CreateOpenLoopInput } from './types/index.js';

describe.sequential('Open-Loops v2 Phase E enforcement', () => {
  let root: string;
  let vault: Vault;
  let actor: ActorContext;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vault-phase-e-'));
    vault = new Vault(root);
    vault.initialize();
    actor = vault.getOpenLoopInstallationDefaults().actor;
  });

  afterEach(() => {
    vault.reset();
    rmSync(root, { recursive: true, force: true });
  });

  it('governs activation, supports idempotent read-back, and permits audited rollback', () => {
    const project = createWorkProject('Canary fixture');
    const intruder: ActorContext = { actorUid: 'actor_intruder', actorKind: 'user', roles: [] };

    expect(() => vault.transitionProjectLifecycle({
      project: project.projectUid!,
      nextState: 'gate_active',
      reason: 'Attempt activation without authorization.',
      actor: intruder,
      expectedVersion: project.version,
      idempotencyKey: 'phase-e-activation-denied',
    })).toThrow(/not authorized/i);
    expect(vault.getProject(project.name)).toMatchObject({ lifecycleState: 'shadow', version: project.version });

    const activated = vault.transitionProjectLifecycle({
      project: project.projectUid!,
      nextState: 'gate_active',
      reason: 'Enable the verified canary gate.',
      actor,
      expectedVersion: project.version,
      idempotencyKey: 'phase-e-activation',
    });
    expect(activated).toMatchObject({
      previousState: 'shadow',
      nextState: 'gate_active',
      project: { lifecycleState: 'gate_active', version: project.version + 1 },
      idempotentReplay: false,
    });
    expect(vault.transitionProjectLifecycle({
      project: project.projectUid!,
      nextState: 'gate_active',
      reason: 'Enable the verified canary gate.',
      actor,
      expectedVersion: project.version,
      idempotencyKey: 'phase-e-activation',
    })).toMatchObject({ eventUid: activated.eventUid, idempotentReplay: true });

    const rolledBack = vault.transitionProjectLifecycle({
      project: project.projectUid!,
      nextState: 'shadow',
      reason: 'Rollback the canary after verification.',
      actor,
      expectedVersion: project.version + 1,
      idempotencyKey: 'phase-e-rollback',
    });
    expect(rolledBack).toMatchObject({
      previousState: 'gate_active',
      nextState: 'shadow',
      project: { lifecycleState: 'shadow', version: project.version + 2 },
    });
    expect(vault.getProject(project.name)).toMatchObject({ lifecycleState: 'shadow', version: project.version + 2 });
  });

  it('enforces task admission transactionally only for active work-project gates', () => {
    const project = createWorkProject('Active gate fixture');
    const independent = createWorkProject('Independent fixture');
    const blocker = vault.createOpenLoop(loopInput(project.projectUid!, 'active-blocker', 'active-blocker-create')).loop;

    const shadowTask = vault.createTask({
      title: 'Shadow-mode work remains available',
      taskType: 'analysis',
      prompt: 'Confirm shadow mode remains non-blocking.',
      project: project.name,
      workIntent: 'normal_work',
      actor,
      createdBy: 'test',
    });
    expect(shadowTask.workIntent).toBe('normal_work');

    vault.transitionProjectLifecycle({
      project: project.projectUid!,
      nextState: 'gate_active',
      reason: 'Activate after migration checks.',
      actor,
      expectedVersion: project.version,
      idempotencyKey: 'active-gate-enable',
    });

    const taskCountBefore = countRows('tasks');
    expect(() => vault.createTask({
      title: 'Unrelated work is blocked',
      taskType: 'analysis',
      prompt: 'This insert must roll back with the denial.',
      project: project.name,
      workIntent: 'normal_work',
      actor,
      createdBy: 'test',
    })).toThrow(/SAME_PROJECT_BLOCKED/);
    expect(countRows('tasks')).toBe(taskCountBefore);

    const evidenceTask = vault.createTask({
      title: 'Gather blocker evidence',
      taskType: 'analysis',
      prompt: 'Gather verification evidence for the blocking commitment.',
      project: project.name,
      workIntent: 'gather_evidence',
      relatedLoopUid: blocker.loopUid,
      actor,
      createdBy: 'test',
    });
    expect(evidenceTask).toMatchObject({
      workIntent: 'gather_evidence',
      relatedLoopUid: blocker.loopUid,
    });

    expect(vault.createTask({
      title: 'Independent work remains available',
      taskType: 'analysis',
      prompt: 'Work in another project.',
      project: independent.name,
      workIntent: 'normal_work',
      actor,
      createdBy: 'test',
    }).status).toBe('pending');
  });

  it('keeps Brain contexts zero-loop and allows only explicit memory maintenance tasks', () => {
    vault.saveMemory({
      title: 'Legacy commitment',
      project: 'Legacy brain fixture',
      memoryType: 'plan',
      subject: 'Legacy commitment',
      summary: 'Legacy state before classification.',
      nextSteps: ['Perform executable follow-up work.'],
    });
    const legacy = vault.getProject('Legacy brain fixture')!;
    expect(() => vault.classifyProject({
      project: legacy.name,
      targetType: 'brain_context',
      config: { memoryPurpose: 'Reference-only context.' },
      actor,
      expectedVersion: legacy.version,
      idempotencyKey: 'brain-with-legacy-loop',
    })).toThrow(/BRAIN_CONTEXT_NEXT_STEPS_FORBIDDEN/);

    const brain = vault.createProject({
      name: 'Reference context fixture',
      projectType: 'brain_context',
      memoryPurpose: 'Reference-only context.',
    });
    expect(() => vault.createTask({
      title: 'Executable work is rejected',
      taskType: 'analysis',
      prompt: 'Do normal project work.',
      project: brain.name,
      workIntent: 'normal_work',
      actor,
      createdBy: 'test',
    })).toThrow(/BRAIN_LOOP_OPERATION_DENIED/);

    const maintenance = vault.createTask({
      title: 'Maintain reference context',
      taskType: 'organize',
      prompt: 'Improve reference metadata only.',
      project: brain.name,
      workIntent: 'memory_maintenance',
      actor,
      createdBy: 'test',
    });
    expect(maintenance).toMatchObject({ status: 'pending', workIntent: 'memory_maintenance' });
    expect(vault.countDedicatedOpenLoops({ projectUid: brain.projectUid! }).total).toBe(0);
  });

  it('never turns task results or generated next-step suggestions into successor loops', () => {
    const project = createWorkProject('Completion fixture');
    const task = vault.createTask({
      title: 'Routine completion',
      taskType: 'summarize',
      prompt: 'Return a summary and suggestions.',
      project: project.name,
      workIntent: 'normal_work',
      actor,
      createdBy: 'test',
    });
    const completed = vault.completeTask(
      task.taskUid,
      'Summary complete. Next step: create another task and continue later.',
    );
    const saved = vault.getMemoryDetail(completed!.resultMetadata!.savedMemoryUid as string);
    expect(saved?.nextSteps).toEqual([]);
    expect(vault.countDedicatedOpenLoops({ projectUid: project.projectUid! }).total).toBe(0);

    const source = vault.saveMemory({
      title: 'Reference to enrich',
      project: project.name,
      memoryType: 'reference',
      subject: 'Reference',
      summary: 'Short reference.',
    }).item;
    const duty = vault.createTask({
      title: 'Enrich reference',
      taskType: 'enrich',
      prompt: 'Improve metadata.',
      project: project.name,
      targetMemoryUid: source.itemUid,
      context: { dutyType: 'post_save_enrich', skipResultMemory: true },
      workIntent: 'memory_maintenance',
      actor,
      createdBy: 'system',
    });
    vault.completeTask(duty.taskUid, JSON.stringify({
      summary: 'A substantially improved reference summary that remains reusable and concrete.',
      tags: ['reference'],
      keywords: ['metadata'],
      next_steps: ['Automatically create follow-up work.'],
    }));
    const applied = vault.applyDutyTaskResult(duty.taskUid);
    expect(applied.appliedFields).not.toContain('nextSteps');
    expect(vault.getMemoryDetail(source.itemUid)?.nextSteps).toEqual([]);
    expect(vault.countDedicatedOpenLoops({ projectUid: project.projectUid! }).total).toBe(0);
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
  ): CreateOpenLoopInput {
    return {
      projectUid,
      title: 'Blocking commitment',
      commitment: 'Deliver a verified result.',
      deferredReason: 'Verification must occur later.',
      ownerKind: 'user',
      ownerReference: actor.actorUid,
      immediateNextAction: 'Gather evidence.',
      triggerKind: 'checkpoint',
      triggerValue: 'next verification checkpoint',
      currentEvidenceSummary: 'Implementation is pending verification.',
      closureCriteria: 'Evidence confirms the result.',
      priority: 'high',
      blockingScope: 'project',
      dedupeKey,
      sourceContext: { source: 'phase-e-test' },
      creatingActor: actor,
      idempotencyKey,
    };
  }

  function countRows(table: 'tasks'): number {
    const row = getRawDatabase()!.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
    return Number(row.count);
  }
});
