// ============================================================================
// Vault — AI Provider Role Resolution (pure)
// Browser-safe module: no database, filesystem, or Node-only imports. The
// desktop renderer imports this via the '@the-vault/core/provider-resolution'
// subpath, so nothing here may pull in SQLite/drizzle/node built-ins.
// ============================================================================

import type { AiProviderId } from '../services/openrouter-client.js';

export type EnrichmentModelSettingKey = 'enrichment_model' | 'enrichment_model_llm_hub';

export interface ResolvedAiProviderSettings {
  primaryProvider: AiProviderId;
  fallbackProvider: AiProviderId | null;
  primaryProviderLabel: string;
  fallbackProviderLabel: string | null;
  backendLabel: string;
  enrichmentModels: Record<AiProviderId, string>;
  primaryEnrichmentModelKey: EnrichmentModelSettingKey;
  primaryEnrichmentModel: string;
}

function asProviderId(value: unknown): AiProviderId | null {
  return value === 'openrouter' || value === 'llm-hub' ? value : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function getAiProviderDisplayName(provider: AiProviderId): string {
  return provider === 'llm-hub' ? 'LLM-Hub' : 'OpenRouter';
}

/** The per-provider settings key holding that provider's enrichment model. */
export function getEnrichmentModelKey(provider: AiProviderId): EnrichmentModelSettingKey {
  return provider === 'llm-hub' ? 'enrichment_model_llm_hub' : 'enrichment_model';
}

/** The per-provider settings key holding that provider's routing overrides. */
export function getRoutingTableKey(provider: AiProviderId): string {
  return provider === 'llm-hub' ? 'model_routing_table_llm_hub' : 'model_routing_table';
}

/** Resolve provider roles, labels, and per-provider enrichment models from settings. */
export function resolveAiProviderSettings(
  values: Record<string, unknown>,
): ResolvedAiProviderSettings {
  const primaryProvider = asProviderId(values.ai_provider_primary)
    ?? asProviderId(values.ai_provider)
    ?? 'openrouter';
  const fallbackCandidate = asProviderId(values.ai_provider_fallback);
  const fallbackProvider = fallbackCandidate && fallbackCandidate !== primaryProvider
    ? fallbackCandidate
    : null;
  const enrichmentModels: Record<AiProviderId, string> = {
    openrouter: asString(values.enrichment_model),
    'llm-hub': asString(values.enrichment_model_llm_hub),
  };
  const primaryProviderLabel = getAiProviderDisplayName(primaryProvider);
  const fallbackProviderLabel = fallbackProvider
    ? getAiProviderDisplayName(fallbackProvider)
    : null;
  const primaryEnrichmentModelKey = getEnrichmentModelKey(primaryProvider);

  return {
    primaryProvider,
    fallbackProvider,
    primaryProviderLabel,
    fallbackProviderLabel,
    backendLabel: fallbackProviderLabel
      ? `${primaryProviderLabel} (primary) · ${fallbackProviderLabel} (fallback)`
      : `${primaryProviderLabel} (primary) · No fallback`,
    enrichmentModels,
    primaryEnrichmentModelKey,
    primaryEnrichmentModel: enrichmentModels[primaryProvider],
  };
}
