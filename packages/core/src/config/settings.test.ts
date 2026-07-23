import { describe, expect, it } from 'vitest';
import { resolveAiProviderSettings } from './settings.js';

describe('resolveAiProviderSettings', () => {
  it('resolves the primary provider label, fallback, and primary model from provider-specific settings', () => {
    const resolved = resolveAiProviderSettings({
      ai_provider_primary: 'llm-hub',
      ai_provider_fallback: 'openrouter',
      enrichment_model: 'openai/gpt-4.1-mini',
      enrichment_model_llm_hub: 'gemini-2.5-flash',
    });

    expect(resolved).toEqual({
      primaryProvider: 'llm-hub',
      fallbackProvider: 'openrouter',
      primaryProviderLabel: 'LLM-Hub',
      fallbackProviderLabel: 'OpenRouter',
      backendLabel: 'LLM-Hub (primary) · OpenRouter (fallback)',
      enrichmentModels: {
        openrouter: 'openai/gpt-4.1-mini',
        'llm-hub': 'gemini-2.5-flash',
      },
      primaryEnrichmentModelKey: 'enrichment_model_llm_hub',
      primaryEnrichmentModel: 'gemini-2.5-flash',
    });
  });

  it('honors the legacy primary key and removes a duplicate fallback', () => {
    const resolved = resolveAiProviderSettings({
      ai_provider: 'openrouter',
      ai_provider_fallback: 'openrouter',
      enrichment_model: 'openai/gpt-4.1-mini',
      enrichment_model_llm_hub: 'gemini-2.5-flash',
    });

    expect(resolved.primaryProvider).toBe('openrouter');
    expect(resolved.fallbackProvider).toBeNull();
    expect(resolved.backendLabel).toBe('OpenRouter (primary) · No fallback');
    expect(resolved.primaryEnrichmentModelKey).toBe('enrichment_model');
    expect(resolved.primaryEnrichmentModel).toBe('openai/gpt-4.1-mini');
  });
});
