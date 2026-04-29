// ============================================================================
// Vault — Model Routing
// Maps task types to optimal AI models via OpenRouter.
// Users can override defaults via vault settings.
// ============================================================================

import type { ModelRoutingTable, ModelRouteConfig } from '../types/index.js';
import type { TaskType } from './controlled-values.js';

// ---------------------------------------------------------------------------
// Default Routing Table
// ---------------------------------------------------------------------------

export const DEFAULT_MODEL_ROUTING: ModelRoutingTable = {
  defaultModelId: 'anthropic/claude-sonnet-4.6',
  routes: [
    {
      taskType: 'coding',
      modelId: 'anthropic/claude-sonnet-4.6',
      fallbackModelId: 'openai/codex-mini',
      maxTokens: 4096,
      temperature: 0.2,
      timeoutMs: 60000,
    },
    {
      taskType: 'image',
      modelId: 'google/gemini-2.5-flash-image',
      fallbackModelId: 'openai/gpt-5-image',
      maxTokens: 1024,
      temperature: 0.8,
      timeoutMs: 120000,
    },
    {
      taskType: 'analysis',
      modelId: 'anthropic/claude-opus-4.7',
      fallbackModelId: 'openai/o3',
      maxTokens: 8192,
      temperature: 0.3,
      timeoutMs: 120000,
    },
    {
      taskType: 'summarize',
      modelId: 'anthropic/claude-haiku-4.5',
      fallbackModelId: 'openai/gpt-4o-mini',
      maxTokens: 1024,
      temperature: 0.2,
      timeoutMs: 15000,
    },
    {
      taskType: 'organize',
      modelId: 'anthropic/claude-haiku-4.5',
      maxTokens: 1024,
      temperature: 0.1,
      timeoutMs: 15000,
    },
    {
      taskType: 'research',
      modelId: 'anthropic/claude-sonnet-4.6',
      fallbackModelId: 'openai/o3',
      maxTokens: 4096,
      temperature: 0.3,
      timeoutMs: 90000,
    },
    {
      taskType: 'enrich',
      modelId: 'anthropic/claude-haiku-4.5',
      maxTokens: 500,
      temperature: 0.2,
      timeoutMs: 10000,
    },
    {
      taskType: 'general',
      modelId: 'anthropic/claude-sonnet-4.6',
      maxTokens: 2048,
      temperature: 0.3,
      timeoutMs: 30000,
    },
  ],
};

// ---------------------------------------------------------------------------
// Route Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the model route for a given task type.
 * Returns the matching route or a generic fallback using the default model.
 */
export function resolveModelRoute(
  table: ModelRoutingTable,
  taskType: TaskType,
): ModelRouteConfig {
  const route = table.routes.find((r) => r.taskType === taskType);
  if (route) return route;

  return {
    taskType,
    modelId: table.defaultModelId,
    maxTokens: 2048,
    temperature: 0.3,
    timeoutMs: 30000,
  };
}

// ---------------------------------------------------------------------------
// Merge User Overrides
// ---------------------------------------------------------------------------

/**
 * Merge user-configured overrides on top of the default routing table.
 * User routes override defaults by taskType; unmatched defaults are kept.
 */
export function mergeRoutingTable(
  defaults: ModelRoutingTable,
  userOverrides: Partial<ModelRoutingTable> | null,
): ModelRoutingTable {
  if (!userOverrides) return defaults;

  const mergedRoutes = [...defaults.routes];

  for (const override of userOverrides.routes || []) {
    const idx = mergedRoutes.findIndex((r) => r.taskType === override.taskType);
    if (idx >= 0) {
      mergedRoutes[idx] = { ...mergedRoutes[idx], ...override };
    } else {
      mergedRoutes.push(override);
    }
  }

  return {
    defaultModelId: userOverrides.defaultModelId || defaults.defaultModelId,
    routes: mergedRoutes,
  };
}
