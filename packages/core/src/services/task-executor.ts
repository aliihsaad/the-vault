import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  createProviderClient,
  isProviderConfigUsable,
  type AiProviderChain,
  type AiProviderConfig,
  type AiProviderId,
  type GeneratedImage,
} from './openrouter-client.js';
import { buildProjectContextPack } from './project-context-pack.service.js';
import type {
  ModelRouteConfig,
  TaskProviderAttemptError,
  TaskResultMetadata,
  VaultTask,
} from '../types/index.js';
import type { TaskType } from '../rules/controlled-values.js';
import type { Vault } from '../vault.js';

const PROJECT_CONTEXT_RECENT_MEMORIES = 6;
const PROJECT_CONTEXT_RECENT_LOGS = 25;
const PROJECT_CONTEXT_RECALL_LIMIT = 8;
const NO_SIDE_EFFECTS_NOTE = [
  'Executor note: No Vault mutations, file edits, or external actions were applied by this text task executor.',
  'Treat any requested merge/update/delete/archive/promote/save operation below as analysis or a recommendation unless separate tool metadata confirms it was applied.',
].join(' ');
const MUTATING_ACTION_PATTERN = /\b(merge|merged|delete|deleted|archive|archived|promote|promoted|update|updated|relocate|relocated|move|moved|rename|renamed|create relationship|created relationship|decide proposal|apply proposal)\b/i;

export type TaskExecutorEventType =
  | 'task-created'
  | 'task-started'
  | 'task-completed'
  | 'task-failed'
  | 'task-retried'
  | 'task-cancelled';

export interface TaskExecutorEvent {
  type: TaskExecutorEventType;
  taskUid: string;
  task: VaultTask | null;
  timestamp: string;
  message: string;
  metadata?: TaskResultMetadata;
}

export interface TaskExecutorStatus {
  running: boolean;
  pollIntervalMs: number;
  activeTaskUid: string | null;
  lastTickAt: string | null;
  lastCompletedAt: string | null;
  lastError: string | null;
  processedCount: number;
  failedCount: number;
}

interface TaskExecutorClient {
  complete(params: {
    systemPrompt: string;
    userPrompt: string;
    maxTokens: number;
    temperature: number;
    timeoutMs: number;
  }): Promise<{
    text: string;
    model: string;
    usage?: Record<string, unknown>;
  }>;
  generateImage(params: {
    prompt: string;
    modalities: string[];
    aspectRatio?: string;
    imageSize?: string;
    timeoutMs: number;
  }): Promise<{
    text: string;
    model: string;
    usage?: Record<string, unknown>;
    images: GeneratedImage[];
  }>;
}

export interface TaskExecutorOptions {
  vault: Vault;
  getApiKey: () => string;
  /**
   * Optional provider resolution. When supplied, it takes precedence over
   * getApiKey and selects which AI provider executes tasks (OpenRouter or an
   * OpenAI-compatible hub like LLM-Hub with a configurable base URL).
   */
  getProviderConfig?: () => AiProviderConfig;
  /**
   * Optional primary + fallback provider resolution. Takes precedence over
   * getProviderConfig. The fallback provider (with its own routing table and
   * models) is tried when the primary fails or is not configured.
   */
  getProviderChain?: () => AiProviderChain;
  emitEvent: (event: TaskExecutorEvent) => void;
  pollIntervalMs?: number;
  createClient?: (apiKey: string, modelId: string, providerConfig?: AiProviderConfig) => TaskExecutorClient;
}

interface TaskExecutionSuccess {
  text: string;
  metadata: TaskResultMetadata;
}

export class TaskExecutor {
  private static readonly MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;
  private readonly vault: Vault;
  private readonly getApiKey: () => string;
  private readonly getProviderConfig?: () => AiProviderConfig;
  private readonly getProviderChain?: () => AiProviderChain;
  private readonly emitEvent: (event: TaskExecutorEvent) => void;
  private readonly pollIntervalMs: number;
  private readonly createClient: (apiKey: string, modelId: string, providerConfig?: AiProviderConfig) => TaskExecutorClient;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private processing = false;
  private activeTaskUid: string | null = null;
  private lastTickAt: string | null = null;
  private lastCompletedAt: string | null = null;
  private lastError: string | null = null;
  private processedCount = 0;
  private failedCount = 0;
  private lastMaintenanceRunAt = 0;

  constructor(options: TaskExecutorOptions) {
    this.vault = options.vault;
    this.getApiKey = options.getApiKey;
    this.getProviderConfig = options.getProviderConfig;
    this.getProviderChain = options.getProviderChain;
    this.emitEvent = options.emitEvent;
    this.pollIntervalMs = options.pollIntervalMs ?? 5000;
    this.createClient = options.createClient
      ?? ((apiKey, modelId, providerConfig) =>
        createProviderClient(providerConfig ?? { provider: 'openrouter', apiKey }, modelId));
  }

  private resolveProviderChain(): AiProviderChain {
    const chain = this.getProviderChain?.();
    if (chain) {
      return chain;
    }

    const config = this.getProviderConfig?.();
    if (config) {
      return { primary: config, fallback: null };
    }

    return { primary: { provider: 'openrouter', apiKey: this.getApiKey() }, fallback: null };
  }

  start(): TaskExecutorStatus {
    if (this.running) {
      return this.getStatus();
    }

    this.running = true;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);

    void this.tick();
    return this.getStatus();
  }

  stop(): TaskExecutorStatus {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.running = false;
    return this.getStatus();
  }

  isRunning(): boolean {
    return this.running;
  }

  getStatus(): TaskExecutorStatus {
    return {
      running: this.running,
      pollIntervalMs: this.pollIntervalMs,
      activeTaskUid: this.activeTaskUid,
      lastTickAt: this.lastTickAt,
      lastCompletedAt: this.lastCompletedAt,
      lastError: this.lastError,
      processedCount: this.processedCount,
      failedCount: this.failedCount,
    };
  }

  private async tick(): Promise<void> {
    if (!this.running || this.processing) {
      return;
    }

    this.processing = true;
    this.lastTickAt = new Date().toISOString();

    try {
      this.recoverStaleTasks();
      this.runMaintenanceIfDue();

      const task = this.vault.claimNextTask();
      if (!task) {
        return;
      }

      this.activeTaskUid = task.taskUid;
      this.emit('task-started', task, `Started task: ${task.title}`);

      const execution = await this.executeTask(task);
      const completedTask = this.vault.completeTask(task.taskUid, execution.text, execution.metadata);

      if (!completedTask) {
        // The task left pending/running state mid-flight (e.g. user cancelled
        // it while the model call was running) — its final state must win.
        const currentTask = this.vault.getTask(task.taskUid);
        this.emit('task-cancelled', currentTask, `Task no longer completable: ${task.title}`, {
          status: currentTask?.status ?? 'unknown',
        });
        return;
      }

      this.processedCount += 1;
      this.lastCompletedAt = new Date().toISOString();
      this.lastError = null;

      const dutyApply = this.applyDutyResultIfNeeded(completedTask);
      this.emit('task-completed', completedTask, `Completed task: ${task.title}`, {
        ...execution.metadata,
        ...(dutyApply ? { dutyApplied: dutyApply.applied, dutyAppliedFields: dutyApply.appliedFields } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = message;
      this.failedCount += 1;

      if (this.activeTaskUid) {
        const failedTask = this.vault.getTask(this.activeTaskUid);
        if (failedTask && failedTask.status === 'cancelled') {
          this.emit('task-cancelled', failedTask, `Task was cancelled during execution: ${failedTask.title}`);
        } else if (failedTask && failedTask.retryCount < failedTask.maxRetries) {
          const retriedTask = this.vault.retryTask(failedTask.taskUid);
          this.emit('task-retried', retriedTask, `Retrying task: ${failedTask.title}`, {
            error: message,
            retryCount: retriedTask?.retryCount ?? failedTask.retryCount + 1,
            maxRetries: failedTask.maxRetries,
          });
        } else if (failedTask) {
          const finalizedTask = this.vault.failTask(failedTask.taskUid, message);
          this.emit('task-failed', finalizedTask, `Failed task: ${failedTask.title}`, {
            error: message,
          });
        }
      }
    } finally {
      this.activeTaskUid = null;
      this.processing = false;
    }
  }

  private applyDutyResultIfNeeded(task: VaultTask): { applied: boolean; appliedFields: string[] } | null {
    const dutyType = task.context?.dutyType;
    if (dutyType !== 'post_save_enrich' && dutyType !== 'post_save_organize') {
      return null;
    }

    try {
      const result = this.vault.applyDutyTaskResult(task.taskUid);
      return { applied: result.applied, appliedFields: result.appliedFields };
    } catch {
      // Applying suggestions is best-effort; the raw result stays on the
      // task either way.
      return { applied: false, appliedFields: [] };
    }
  }

  private recoverStaleTasks(): void {
    // Heal tasks orphaned in 'running' by a crashed/quit executor process so
    // queue stats never show phantom running tasks. Cheap (one indexed read),
    // so it runs every tick; the staleness threshold protects tasks a live
    // executor in another process is still working on.
    try {
      const recovery = this.vault.recoverStaleRunningTasks();
      for (const taskUid of recovery.requeuedTaskUids) {
        this.emitEvent({
          type: 'task-retried',
          taskUid,
          task: this.vault.getTask(taskUid),
          timestamp: new Date().toISOString(),
          message: 'Requeued task abandoned by an interrupted executor.',
        });
      }
      for (const taskUid of recovery.failedTaskUids) {
        this.emitEvent({
          type: 'task-failed',
          taskUid,
          task: this.vault.getTask(taskUid),
          timestamp: new Date().toISOString(),
          message: 'Failed task abandoned by an interrupted executor.',
        });
      }
    } catch {
      // Recovery is best-effort; it must never block normal task processing.
    }
  }

  private runMaintenanceIfDue(): void {
    const nowMs = Date.now();
    if (this.lastMaintenanceRunAt !== 0 && (nowMs - this.lastMaintenanceRunAt) < TaskExecutor.MAINTENANCE_INTERVAL_MS) {
      return;
    }

    this.vault.executeStaleArchival();
    this.vault.executeAutoPromotion();
    this.lastMaintenanceRunAt = nowMs;
  }

  private async executeTask(task: VaultTask): Promise<TaskExecutionSuccess> {
    if (task.prompt.startsWith('SYSTEM_DUTY:')) {
      throw new Error('SYSTEM_DUTY tasks are reserved for Phase 5 agent duties and are not executable yet.');
    }

    const chain = this.resolveProviderChain();
    const attempts: Array<{ config: AiProviderConfig; isPrimary: boolean }> = [
      { config: { ...chain.primary, apiKey: chain.primary.apiKey.trim() }, isPrimary: true },
      ...(chain.fallback
        ? [{ config: { ...chain.fallback, apiKey: chain.fallback.apiKey.trim() }, isPrimary: false }]
        : []),
    ];

    if (!attempts.some((attempt) => isProviderConfigUsable(attempt.config))) {
      const primaryLabel = chain.primary.provider === 'llm-hub' ? 'LLM-Hub' : 'OpenRouter';
      throw new Error(`${primaryLabel} is not configured (missing API key${chain.primary.provider === 'llm-hub' ? ' or base URL' : ''}) and no usable fallback provider is set.`);
    }

    let lastError: Error | null = null;
    const providerAttempts: TaskProviderAttemptError[] = [];

    for (const attempt of attempts) {
      const provider = attempt.config.provider;
      const route = this.getEffectiveRoute(task, provider, attempt.isPrimary);

      if (!isProviderConfigUsable(attempt.config)) {
        if (attempt.isPrimary) {
          providerAttempts.push({
            provider,
            models: getRouteModelIds(route),
            error: getProviderConfigurationError(provider),
            timestamp: new Date().toISOString(),
          });
        }
        continue;
      }

      // Each provider routes with its own table; the model stamped on the
      // task at creation only applies to the primary provider it came from.
      try {
        const execution = task.taskType === 'image' || /dall-e|image/i.test(route.modelId)
          ? await this.executeImageTask(task, route, attempt.config, attempt.isPrimary)
          : await this.executeTextTask(task, route, attempt.config, attempt.isPrimary);

        if (providerAttempts.length === 0) {
          return execution;
        }

        const primaryProviderError = providerAttempts.find(
          (providerAttempt) => providerAttempt.provider === chain.primary.provider,
        );

        return {
          ...execution,
          metadata: {
            ...execution.metadata,
            providerAttempts,
            ...(primaryProviderError ? { primaryProviderError } : {}),
          },
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        providerAttempts.push({
          provider: attempt.config.provider,
          models: getRouteModelIds(route),
          error: lastError.message,
          timestamp: new Date().toISOString(),
        });
      }
    }

    throw lastError ?? new Error('Task execution failed without an error message.');
  }

  private async executeTextTask(
    task: VaultTask,
    route: ModelRouteConfig,
    providerConfig: AiProviderConfig,
    isPrimaryProvider: boolean,
  ): Promise<TaskExecutionSuccess> {
    const projectContext = await this.buildProjectContextBlock(task);
    const prompt = buildUserPrompt(task, projectContext);
    const systemPrompt = buildSystemPrompt(task.taskType);

    const modelsToTry = [route.modelId, route.fallbackModelId]
      .filter((model): model is string => typeof model === 'string' && model.trim().length > 0)
      .filter((model, index, all) => all.indexOf(model) === index);

    let lastError: Error | null = null;

    for (let index = 0; index < modelsToTry.length; index += 1) {
      const modelId = modelsToTry[index];
      const startedAt = Date.now();

      try {
        const client = this.createClient(providerConfig.apiKey, modelId, providerConfig);
        const result = await client.complete({
          systemPrompt,
          userPrompt: prompt,
          maxTokens: route.maxTokens ?? 2048,
          temperature: route.temperature ?? 0.3,
          timeoutMs: route.timeoutMs ?? 30000,
        });

        const annotated = annotateNoSideEffectsIfNeeded(task, result.text);

        return {
          text: annotated.text,
          metadata: {
            model: result.model,
            usage: result.usage,
            latencyMs: Date.now() - startedAt,
            taskType: task.taskType,
            fallbackUsed: index > 0,
            provider: providerConfig.provider,
            providerFallbackUsed: !isPrimaryProvider,
            route,
            ...(annotated.annotated ? { sideEffectsAppliedByExecutor: false } : {}),
          },
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    throw lastError ?? new Error('Task execution failed without an error message.');
  }

  private async executeImageTask(
    task: VaultTask,
    route: ModelRouteConfig,
    providerConfig: AiProviderConfig,
    isPrimaryProvider: boolean = true,
  ): Promise<TaskExecutionSuccess> {
    const prompt = buildImagePrompt(task);
    const aspectRatio = getStringTaskContextValue(task, 'aspectRatio')
      || getStringTaskContextValue(task, 'aspect_ratio')
      || undefined;
    const imageSize = getStringTaskContextValue(task, 'imageSize')
      || getStringTaskContextValue(task, 'image_size')
      || undefined;
    const modelsToTry = [route.modelId, route.fallbackModelId]
      .filter((model): model is string => typeof model === 'string' && model.trim().length > 0)
      .filter((model, index, all) => all.indexOf(model) === index);
    const modalityVariants: string[][] = [
      ['image', 'text'],
      ['image'],
    ];

    let lastError: Error | null = null;

    for (let index = 0; index < modelsToTry.length; index += 1) {
      const modelId = modelsToTry[index];
      const client = this.createClient(providerConfig.apiKey, modelId, providerConfig);

      for (const modalities of modalityVariants) {
        const startedAt = Date.now();

        try {
          const result = await client.generateImage({
            prompt,
            modalities,
            aspectRatio,
            imageSize,
            timeoutMs: route.timeoutMs ?? 120000,
          });
          const persistedImages = result.images.map((image, imageIndex) =>
            persistGeneratedImage(this.vault.getVaultRoot(), task, image, imageIndex),
          );
          const primaryImage = persistedImages[0];

          return {
            text: buildImageResultSummary(task, result.text, persistedImages),
            metadata: {
              model: result.model,
              usage: result.usage,
              latencyMs: Date.now() - startedAt,
              taskType: task.taskType,
              fallbackUsed: index > 0,
              provider: providerConfig.provider,
              providerFallbackUsed: !isPrimaryProvider,
              route,
              modalitiesUsed: modalities,
              imageCount: persistedImages.length,
              primaryImageDataUrl: primaryImage?.dataUrl || null,
              primaryAssetPath: primaryImage?.assetPath || null,
              primaryMimeType: primaryImage?.mimeType || null,
              assetPaths: persistedImages.map((image) => image.assetPath),
              images: persistedImages.map((image) => ({
                assetPath: image.assetPath,
                mimeType: image.mimeType,
                fileName: image.fileName,
              })),
              ...(aspectRatio ? { aspectRatio } : {}),
              ...(imageSize ? { imageSize } : {}),
            },
          };
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
        }
      }
    }

    throw lastError ?? new Error('Image generation failed without an error message.');
  }

  private async buildProjectContextBlock(task: VaultTask): Promise<string> {
    const project = task.project?.trim();
    if (!project || task.context?.skipProjectContext === true) {
      return '';
    }

    const pack = await buildProjectContextPack(this.vault, {
      project,
      title: task.title,
      prompt: task.prompt,
      maxRecall: PROJECT_CONTEXT_RECALL_LIMIT,
      maxLatest: PROJECT_CONTEXT_RECENT_MEMORIES,
      maxLogs: PROJECT_CONTEXT_RECENT_LOGS,
    });

    return pack.markdown;
  }

  private getEffectiveRoute(
    task: VaultTask,
    provider: AiProviderId,
    honorTaskRoutedModel: boolean,
  ): ModelRouteConfig {
    const route = this.vault.resolveModelForTask(task.taskType, provider);
    // task.routedModel was stamped from the primary provider's table at
    // creation — it means nothing on the fallback provider.
    const routedModel = honorTaskRoutedModel ? task.routedModel : null;
    const modelId = routedModel || route.modelId;
    const fallbackModelId = route.fallbackModelId;

    if (task.taskType === 'image') {
      return normalizeImageRoute({
        ...route,
        modelId,
        fallbackModelId,
      });
    }

    return routedModel
      ? {
          ...route,
          modelId: routedModel,
        }
      : route;
  }

  private emit(
    type: TaskExecutorEventType,
    task: VaultTask | null,
    message: string,
    metadata?: TaskResultMetadata,
  ): void {
    this.emitEvent({
      type,
      taskUid: task?.taskUid ?? this.activeTaskUid ?? 'unknown',
      task,
      timestamp: new Date().toISOString(),
      message,
      metadata,
    });
  }
}

function getRouteModelIds(route: ModelRouteConfig): string[] {
  return [route.modelId, route.fallbackModelId]
    .filter((model): model is string => typeof model === 'string' && model.trim().length > 0)
    .filter((model, index, models) => models.indexOf(model) === index);
}

function getProviderConfigurationError(provider: AiProviderId): string {
  return provider === 'llm-hub'
    ? 'LLM-Hub is not configured (missing API key or base URL).'
    : 'OpenRouter is not configured (missing API key).';
}

function buildSystemPrompt(taskType: TaskType): string {
  switch (taskType) {
    case 'coding':
      return 'You are the Vault task executor. Produce code-focused output that is precise, implementation-ready, and explicit about assumptions.';
    case 'analysis':
      return 'You are the Vault task executor. Analyze the request carefully and return a structured, technically rigorous answer.';
    case 'summarize':
      return 'You are the Vault task executor. Summarize the provided material concisely while preserving the key facts and next steps.';
    case 'organize':
      return [
        'You are the Vault task executor. Reorganize the material into a clean, structured form that is easy to reuse later.',
        'You cannot call Vault tools, edit files, or mutate the database from this execution path.',
        'Do not claim that a merge, update, delete, archive, promotion, save, or file relocation was performed unless the prompt includes explicit tool-result metadata showing it already happened.',
        'When asked to perform a side effect, verify the evidence and state the exact recommended operation as not yet applied by this executor.',
      ].join(' ');
    case 'research':
      return 'You are the Vault task executor. Return a focused research brief with the strongest conclusions first, followed by useful supporting detail.';
    case 'enrich':
      return 'You are the Vault task executor. Improve clarity, structure, and reusability without changing the technical meaning.';
    case 'general':
      return 'You are the Vault task executor. Respond concisely and operationally.';
    case 'image':
      return 'You are the Vault task executor. Image generation is currently unsupported in this execution path.';
    default:
      return 'You are the Vault task executor. Respond clearly and operationally.';
  }
}

function buildUserPrompt(task: VaultTask, projectContext: string): string {
  const sanitizedContext = stripInternalContextKeys(task.context);
  const contextBlock = Object.keys(sanitizedContext).length > 0
    ? JSON.stringify(sanitizedContext, null, 2)
    : '';

  return [
    `Task title: ${task.title}`,
    `Task type: ${task.taskType}`,
    task.project ? `Project: ${task.project}` : '',
    projectContext ? `\n${projectContext}` : '',
    '',
    'Execution boundary:',
    'This task executor returns text and persists that text as a task result. It does not invoke Vault mutation tools, edit files, or apply external side effects for text tasks.',
    '',
    'Instructions:',
    task.prompt,
    contextBlock ? '\nTask context:\n' + contextBlock : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function stripInternalContextKeys(context: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!context) {
    return {};
  }
  const { skipProjectContext: _skip, skipResultMemory: _skipMemory, ...rest } = context;
  return rest;
}

function annotateNoSideEffectsIfNeeded(task: VaultTask, resultText: string): { text: string; annotated: boolean } {
  if (!shouldAnnotateNoSideEffects(task)) {
    return { text: resultText, annotated: false };
  }

  const trimmed = resultText.trimStart();
  if (trimmed.startsWith(NO_SIDE_EFFECTS_NOTE)) {
    return { text: resultText, annotated: true };
  }

  return {
    text: `${NO_SIDE_EFFECTS_NOTE}\n\n${resultText}`,
    annotated: true,
  };
}

function shouldAnnotateNoSideEffects(task: VaultTask): boolean {
  if (task.taskType === 'image') {
    return false;
  }

  const contextText = JSON.stringify(stripInternalContextKeys(task.context));
  const taskText = [task.title, task.prompt, contextText].filter(Boolean).join('\n');
  return MUTATING_ACTION_PATTERN.test(taskText);
}

function buildImagePrompt(task: VaultTask): string {
  const contextBlock = Object.keys(task.context || {}).length > 0
    ? JSON.stringify(task.context, null, 2)
    : '';

  return [
    task.prompt,
    contextBlock ? `Additional context:\n${contextBlock}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function getStringTaskContextValue(task: VaultTask, key: string): string | null {
  const value = task.context?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function persistGeneratedImage(
  vaultRoot: string,
  task: VaultTask,
  image: GeneratedImage,
  index: number,
): { dataUrl: string; mimeType: string; assetPath: string; fileName: string } {
  const extension = getImageExtension(image.mimeType);
  const fileName = [
    new Date().toISOString().slice(0, 10),
    slugify(task.title),
    task.taskUid,
    `${index + 1}.${extension}`,
  ].join('-');
  const assetPath = join(
    vaultRoot,
    'projects',
    slugify(task.project || 'shared'),
    'artifacts',
    fileName,
  );
  const base64Payload = extractBase64Payload(image.dataUrl);

  mkdirSync(dirname(assetPath), { recursive: true });
  writeFileSync(assetPath, Buffer.from(base64Payload, 'base64'));

  return {
    dataUrl: image.dataUrl,
    mimeType: image.mimeType,
    assetPath: assetPath.replace(/\\/g, '/'),
    fileName,
  };
}

function extractBase64Payload(dataUrl: string): string {
  const match = /^data:[^;]+;base64,(.+)$/i.exec(dataUrl);
  if (!match?.[1]) {
    throw new Error('Generated image response did not contain a valid base64 data URL.');
  }

  return match[1];
}

function getImageExtension(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/png':
    default:
      return 'png';
  }
}

function slugify(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  return normalized || 'task';
}

function buildImageResultSummary(
  task: VaultTask,
  modelText: string,
  images: Array<{ assetPath: string }>,
): string {
  return [
    `Generated ${images.length} image${images.length === 1 ? '' : 's'} for task "${task.title}".`,
    images[0]?.assetPath ? `Primary asset path: ${images[0].assetPath}` : '',
    modelText.trim(),
  ]
    .filter(Boolean)
    .join('\n');
}

function normalizeImageRoute(route: ModelRouteConfig): ModelRouteConfig {
  const normalizedModelId = remapLegacyImageModel(route.modelId);
  const normalizedFallback = route.fallbackModelId
    ? remapLegacyImageModel(route.fallbackModelId)
    : 'openai/gpt-5-image';

  if (!route.fallbackModelId && normalizedModelId === normalizedFallback) {
    return {
      ...route,
      modelId: normalizedModelId,
    };
  }

  return {
    ...route,
    modelId: normalizedModelId,
    fallbackModelId: normalizedFallback === normalizedModelId ? undefined : normalizedFallback,
  };
}

function remapLegacyImageModel(modelId: string): string {
  if (modelId === 'openai/dall-e-3') {
    return 'google/gemini-2.5-flash-image';
  }

  return modelId;
}
