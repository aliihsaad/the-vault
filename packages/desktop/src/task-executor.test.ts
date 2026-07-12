import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const openRouterCompleteMock = vi.fn();
const openRouterGenerateImageMock = vi.fn();
const openRouterConstructorMock = vi.fn();
const createdRoots: string[] = [];

import { TaskExecutor, type TaskExecutorEvent } from '../electron/task-executor.js';

interface TestTask {
  id: number;
  taskUid: string;
  title: string;
  taskType: string;
  status: string;
  priority: string;
  project: string | null;
  prompt: string;
  context: Record<string, unknown>;
  routedModel: string | null;
  resultText: string | null;
  resultMetadata: Record<string, unknown> | null;
  errorMessage: string | null;
  retryCount: number;
  maxRetries: number;
  parentTaskUid: string | null;
  sourceMemoryUid: string | null;
  targetMemoryUid: string | null;
  createdBy: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

describe('TaskExecutor', () => {
  afterEach(async () => {
    vi.clearAllMocks();
    await Promise.all(
      createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it('executes a claimed task and emits started/completed events', async () => {
    const task = createTask({
      taskUid: 'vt_success',
      title: 'Summarize notes',
      taskType: 'summarize',
      project: 'Vault',
      prompt: 'Summarize the migration notes.',
      routedModel: null,
    });

    openRouterCompleteMock.mockResolvedValue({
      text: 'Summary complete.',
      model: 'anthropic/claude-haiku-3.5',
      usage: {
        promptTokens: 10,
        completionTokens: 24,
      },
    });

    const { vault, state } = createVaultHarness(task, {
      route: {
        taskType: 'summarize',
        modelId: 'anthropic/claude-haiku-3.5',
        fallbackModelId: 'openai/gpt-4o-mini',
        maxTokens: 1024,
        temperature: 0.2,
        timeoutMs: 15000,
      },
    });
    const events: TaskExecutorEvent[] = [];

    const executor = new TaskExecutor({
      vault: vault as never,
      getApiKey: () => 'test-api-key',
      emitEvent: (event) => {
        events.push(event);
      },
      pollIntervalMs: 60000,
      createClient: createMockClientFactory(),
    });

    executor.start();

    await vi.waitFor(() => {
      expect(vault.completeTask).toHaveBeenCalledTimes(1);
    });

    executor.stop();

    expect(openRouterConstructorMock).toHaveBeenCalledWith('test-api-key', 'anthropic/claude-haiku-3.5');
    expect(vault.claimNextTask).toHaveBeenCalledTimes(1);
    expect(vault.completeTask).toHaveBeenCalledWith(
      task.taskUid,
      'Summary complete.',
      expect.objectContaining({
        model: 'anthropic/claude-haiku-3.5',
        taskType: 'summarize',
        fallbackUsed: false,
      }),
    );
    expect(state.get(task.taskUid)?.status).toBe('completed');
    expect(events.map((event) => event.type)).toEqual(['task-started', 'task-completed']);
    expect(executor.getStatus()).toEqual(
      expect.objectContaining({
        running: false,
        processedCount: 1,
        failedCount: 0,
        activeTaskUid: null,
        lastError: null,
      }),
    );
  });

  it('tries the fallback model when the primary routed model fails', async () => {
    const task = createTask({
      taskUid: 'vt_fallback',
      title: 'Research adapters',
      taskType: 'research',
      project: 'Vault',
      prompt: 'Research local adapter resume patterns.',
      routedModel: null,
    });

    openRouterCompleteMock
      .mockRejectedValueOnce(new Error('primary unavailable'))
      .mockResolvedValueOnce({
        text: 'Fallback result.',
        model: 'openai/o3',
        usage: {
          promptTokens: 18,
          completionTokens: 31,
        },
      });

    const { vault } = createVaultHarness(task, {
      route: {
        taskType: 'research',
        modelId: 'anthropic/claude-sonnet-4',
        fallbackModelId: 'openai/o3',
        maxTokens: 4096,
        temperature: 0.3,
        timeoutMs: 90000,
      },
    });

    const executor = new TaskExecutor({
      vault: vault as never,
      getApiKey: () => 'test-api-key',
      emitEvent: vi.fn(),
      pollIntervalMs: 60000,
      createClient: createMockClientFactory(),
    });

    executor.start();

    await vi.waitFor(() => {
      expect(vault.completeTask).toHaveBeenCalledTimes(1);
    });

    executor.stop();

    expect(openRouterConstructorMock.mock.calls).toEqual([
      ['test-api-key', 'anthropic/claude-sonnet-4'],
      ['test-api-key', 'openai/o3'],
    ]);
    expect(vault.completeTask).toHaveBeenCalledWith(
      task.taskUid,
      'Fallback result.',
      expect.objectContaining({
        model: 'openai/o3',
        fallbackUsed: true,
      }),
    );
  });

  it('annotates action-like text tasks so model output is not mistaken for applied Vault mutations', async () => {
    const task = createTask({
      taskUid: 'vt_organize_action',
      title: 'Merge duplicate SwiftFlow project',
      taskType: 'organize',
      project: 'Social-Media-Manager-AI-Tool',
      prompt: 'Verify SwiftFlow is a duplicate, then merge it into Social-Media-Manager-AI-Tool with file relocation enabled.',
      routedModel: null,
      context: {
        requested_action: 'verify_then_merge_duplicate_project',
      },
    });

    openRouterCompleteMock.mockResolvedValue({
      text: 'Merged SwiftFlow into Social-Media-Manager-AI-Tool.',
      model: 'openai/gpt-4.1-mini',
      usage: {
        promptTokens: 22,
        completionTokens: 15,
      },
    });

    const { vault } = createVaultHarness(task, {
      route: {
        taskType: 'organize',
        modelId: 'openai/gpt-4.1-mini',
        maxTokens: 1024,
        temperature: 0.1,
        timeoutMs: 15000,
      },
    });

    const executor = new TaskExecutor({
      vault: vault as never,
      getApiKey: () => 'test-api-key',
      emitEvent: vi.fn(),
      pollIntervalMs: 60000,
      createClient: createMockClientFactory(),
    });

    executor.start();

    await vi.waitFor(() => {
      expect(vault.completeTask).toHaveBeenCalledTimes(1);
    });

    executor.stop();

    const completeParams = openRouterCompleteMock.mock.calls[0]?.[0] as {
      systemPrompt: string;
      userPrompt: string;
    };
    expect(completeParams.systemPrompt).toContain('You cannot call Vault tools');
    expect(completeParams.userPrompt).toContain('Execution boundary:');
    expect(vault.completeTask).toHaveBeenCalledWith(
      task.taskUid,
      expect.stringMatching(/^Executor note: No Vault mutations/),
      expect.objectContaining({
        taskType: 'organize',
        sideEffectsAppliedByExecutor: false,
      }),
    );
  });

  it('retries a failed task when retries remain and emits a retried event', async () => {
    const task = createTask({
      taskUid: 'vt_retry',
      title: 'System duty placeholder',
      taskType: 'analysis',
      prompt: 'SYSTEM_DUTY: refresh stale project briefing',
      retryCount: 0,
      maxRetries: 1,
    });

    const { vault, state } = createVaultHarness(task);
    const events: TaskExecutorEvent[] = [];

    const executor = new TaskExecutor({
      vault: vault as never,
      getApiKey: () => 'test-api-key',
      emitEvent: (event) => {
        events.push(event);
      },
      pollIntervalMs: 60000,
      createClient: createMockClientFactory(),
    });

    executor.start();

    await vi.waitFor(() => {
      expect(vault.retryTask).toHaveBeenCalledTimes(1);
    });

    executor.stop();

    expect(vault.failTask).not.toHaveBeenCalled();
    expect(state.get(task.taskUid)?.status).toBe('pending');
    expect(state.get(task.taskUid)?.retryCount).toBe(1);
    expect(events.map((event) => event.type)).toEqual(['task-started', 'task-retried']);
    expect(events[1]).toEqual(
      expect.objectContaining({
        type: 'task-retried',
        taskUid: task.taskUid,
        metadata: expect.objectContaining({
          error: 'SYSTEM_DUTY tasks are reserved for Phase 5 agent duties and are not executable yet.',
          retryCount: 1,
          maxRetries: 1,
        }),
      }),
    );
  });

  it('executes an image task, stores the generated asset, and completes the task', async () => {
    const task = createTask({
      taskUid: 'vt_image',
      title: 'Generate logo concept',
      taskType: 'image',
      prompt: 'Create a clean logo concept for Vault.',
      routedModel: null,
      retryCount: 0,
      maxRetries: 1,
      context: {
        aspectRatio: '1:1',
        imageSize: '1K',
      },
    });
    const vaultRoot = await createTempVaultRoot();

    openRouterGenerateImageMock.mockResolvedValue({
      text: 'Generated a refined logo concept.',
      model: 'google/gemini-2.5-flash-image',
      images: [
        {
          dataUrl: 'data:image/png;base64,aGVsbG8=',
          mimeType: 'image/png',
        },
      ],
      usage: {
        promptTokens: 12,
        completionTokens: 34,
      },
    });

    const { vault, state } = createVaultHarness(task, {
      vaultRoot,
      route: {
        taskType: 'image',
        modelId: 'openai/dall-e-3',
        maxTokens: 1024,
        temperature: 0.8,
        timeoutMs: 120000,
      },
    });
    const executor = new TaskExecutor({
      vault: vault as never,
      getApiKey: () => 'test-api-key',
      emitEvent: vi.fn(),
      pollIntervalMs: 60000,
      createClient: createMockClientFactory(),
    });

    executor.start();

    await vi.waitFor(() => {
      expect(vault.completeTask).toHaveBeenCalledTimes(1);
    });

    executor.stop();

    expect(openRouterConstructorMock).toHaveBeenCalledWith('test-api-key', 'google/gemini-2.5-flash-image');
    const completedTask = state.get(task.taskUid);
    expect(completedTask?.status).toBe('completed');
    expect(completedTask?.resultText).toContain('Generated 1 image');
    expect(completedTask?.resultMetadata).toEqual(
      expect.objectContaining({
        model: 'google/gemini-2.5-flash-image',
        taskType: 'image',
        imageCount: 1,
        primaryImageDataUrl: 'data:image/png;base64,aGVsbG8=',
        primaryMimeType: 'image/png',
        primaryAssetPath: expect.stringContaining('/projects/vault/artifacts/'),
        assetPaths: [expect.stringContaining('/projects/vault/artifacts/')],
        modalitiesUsed: ['image', 'text'],
      }),
    );

    const assetPath = completedTask?.resultMetadata?.primaryAssetPath;
    expect(typeof assetPath).toBe('string');
    expect(existsSync(assetPath as string)).toBe(true);
    expect(readFileSync(assetPath as string, 'utf-8')).toBe('hello');
  });

  it('marks a task failed when retries are exhausted', async () => {
    const task = createTask({
      taskUid: 'vt_fail',
      title: 'Persistent upstream failure',
      taskType: 'analysis',
      prompt: 'Analyze an upstream outage.',
      retryCount: 1,
      maxRetries: 1,
    });

    openRouterCompleteMock.mockRejectedValue(new Error('primary unavailable'));

    const { vault, state } = createVaultHarness(task, {
      route: {
        taskType: 'analysis',
        modelId: 'anthropic/claude-sonnet-4',
        maxTokens: 1024,
        temperature: 0.2,
        timeoutMs: 30000,
      },
    });
    const events: TaskExecutorEvent[] = [];

    const executor = new TaskExecutor({
      vault: vault as never,
      getApiKey: () => 'test-api-key',
      emitEvent: (event) => {
        events.push(event);
      },
      pollIntervalMs: 60000,
      createClient: createMockClientFactory(),
    });

    executor.start();

    await vi.waitFor(() => {
      expect(vault.failTask).toHaveBeenCalledTimes(1);
    });

    executor.stop();

    expect(vault.retryTask).not.toHaveBeenCalled();
    expect(vault.failTask).toHaveBeenCalledWith(
      task.taskUid,
      'primary unavailable',
    );
    expect(state.get(task.taskUid)?.status).toBe('failed');
    expect(events.map((event) => event.type)).toEqual(['task-started', 'task-failed']);
    expect(executor.getStatus()).toEqual(
      expect.objectContaining({
        failedCount: 1,
        processedCount: 0,
      }),
    );
  });
});

function createTask(overrides: Partial<TestTask> = {}): TestTask {
  return {
    id: 1,
    taskUid: 'vt_default',
    title: 'Default task',
    taskType: 'general',
    status: 'running',
    priority: 'normal',
    project: 'Vault',
    prompt: 'Do the task.',
    context: {},
    routedModel: 'anthropic/claude-sonnet-4',
    resultText: null,
    resultMetadata: null,
    errorMessage: null,
    retryCount: 0,
    maxRetries: 2,
    parentTaskUid: null,
    sourceMemoryUid: null,
    targetMemoryUid: null,
    createdBy: 'desktop',
    createdAt: '2026-04-17T00:00:00.000Z',
    startedAt: '2026-04-17T00:00:01.000Z',
    completedAt: null,
    updatedAt: '2026-04-17T00:00:01.000Z',
    ...overrides,
  };
}

function createVaultHarness(
  initialTask: TestTask,
  options?: {
    vaultRoot?: string;
    route?: {
      taskType: string;
      modelId: string;
      fallbackModelId?: string;
      maxTokens?: number;
      temperature?: number;
      timeoutMs?: number;
    };
  },
) {
  const state = new Map<string, TestTask>([
    [initialTask.taskUid, initialTask],
  ]);
  let nextClaim: TestTask | null = initialTask;

  const route = options?.route ?? {
    taskType: initialTask.taskType,
    modelId: initialTask.routedModel ?? 'anthropic/claude-sonnet-4',
    fallbackModelId: 'openai/gpt-4o-mini',
    maxTokens: 2048,
    temperature: 0.3,
    timeoutMs: 30000,
  };
  const vaultRoot = options?.vaultRoot ?? 'C:/tmp/vault-test';

  const vault = {
    claimNextTask: vi.fn(() => {
      if (!nextClaim) {
        return null;
      }

      const claimed = nextClaim;
      nextClaim = null;
      return claimed;
    }),
    completeTask: vi.fn((taskUid: string, resultText: string, resultMetadata: Record<string, unknown>) => {
      const existing = state.get(taskUid);
      if (!existing) {
        return null;
      }

      const updated = {
        ...existing,
        status: 'completed',
        resultText,
        resultMetadata,
        completedAt: '2026-04-17T00:00:10.000Z',
        updatedAt: '2026-04-17T00:00:10.000Z',
      };
      state.set(taskUid, updated);
      return updated;
    }),
    getTask: vi.fn((taskUid: string) => state.get(taskUid) ?? null),
    retryTask: vi.fn((taskUid: string) => {
      const existing = state.get(taskUid);
      if (!existing) {
        return null;
      }

      const updated = {
        ...existing,
        status: 'pending',
        retryCount: Number(existing.retryCount) + 1,
        errorMessage: null,
        startedAt: null,
        updatedAt: '2026-04-17T00:00:20.000Z',
      };
      state.set(taskUid, updated);
      return updated;
    }),
    failTask: vi.fn((taskUid: string, errorMessage: string) => {
      const existing = state.get(taskUid);
      if (!existing) {
        return null;
      }

      const updated = {
        ...existing,
        status: 'failed',
        errorMessage,
        completedAt: '2026-04-17T00:00:30.000Z',
        updatedAt: '2026-04-17T00:00:30.000Z',
      };
      state.set(taskUid, updated);
      return updated;
    }),
    recoverStaleRunningTasks: vi.fn(() => ({
      requeuedTaskUids: [],
      failedTaskUids: [],
    })),
    applyDutyTaskResult: vi.fn((taskUid: string) => ({
      taskUid,
      targetMemoryUid: null,
      applied: false,
      appliedFields: [],
    })),
    executeStaleArchival: vi.fn(() => ({
      archivedItemUids: [],
      promotedItemUids: [],
    })),
    executeAutoPromotion: vi.fn(() => ({
      archivedItemUids: [],
      promotedItemUids: [],
    })),
    resolveModelForTask: vi.fn(() => route),
    getVaultRoot: vi.fn(() => vaultRoot),
  };

  return { vault, state };
}

async function createTempVaultRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'vault-task-executor-'));
  createdRoots.push(root);
  return root;
}

function createMockClientFactory() {
  return (apiKey: string, model: string) => {
    openRouterConstructorMock(apiKey, model);

    return {
      complete: (params: unknown) => openRouterCompleteMock(params),
      generateImage: (params: unknown) => openRouterGenerateImageMock(params),
    };
  };
}
