import { describe, expect, it } from 'vitest';

import {
  SPARK_DEFAULT_PROVIDER_ID,
  getDefaultRoleAssignments,
  getProvidersForRole,
  getSparkProviderById,
  getSparkProviderCatalog,
  isRoleSupportedByProvider,
} from './services/spark-provider-catalog.js';
import { SPARK_PROVIDER_ROLES } from './types/spark-provider.js';

describe('Spark provider catalog', () => {
  it('declares the eight S2 providers', () => {
    const ids = getSparkProviderCatalog().map((p) => p.id).sort();
    expect(ids).toEqual(
      ['claude', 'deepgram', 'elevenlabs', 'freellmapi', 'gemini', 'ollama', 'openai', 'openrouter'].sort(),
    );
  });

  it('marks FreeLLMAPI as the default covering every role', () => {
    const freellmapi = getSparkProviderById('freellmapi');
    expect(freellmapi).toBeDefined();
    expect(freellmapi?.isDefault).toBe(true);
    expect(freellmapi?.authStyle).toBe('bearer');
    expect(freellmapi?.baseUrlRequired).toBe(true);
    for (const role of SPARK_PROVIDER_ROLES) {
      expect(freellmapi?.roles).toContain(role);
    }
    expect(SPARK_DEFAULT_PROVIDER_ID).toBe('freellmapi');
  });

  it('maps role capabilities faithfully', () => {
    expect(getProvidersForRole('STT').map((p) => p.id)).toEqual(
      expect.arrayContaining(['freellmapi', 'deepgram', 'openai', 'gemini']),
    );
    expect(getProvidersForRole('TTS').map((p) => p.id)).toEqual(
      expect.arrayContaining(['freellmapi', 'elevenlabs', 'openai', 'gemini']),
    );
    expect(getProvidersForRole('LLM').map((p) => p.id)).toEqual(
      expect.arrayContaining(['freellmapi', 'openai', 'gemini', 'claude', 'openrouter', 'ollama']),
    );
    expect(getProvidersForRole('Realtime').map((p) => p.id)).toEqual(
      expect.arrayContaining(['freellmapi', 'openai', 'gemini']),
    );

    // Deepgram is STT-only; ElevenLabs is TTS-only; Claude/OpenRouter/Ollama are LLM-only.
    expect(isRoleSupportedByProvider('deepgram', 'STT')).toBe(true);
    expect(isRoleSupportedByProvider('deepgram', 'LLM')).toBe(false);
    expect(isRoleSupportedByProvider('elevenlabs', 'TTS')).toBe(true);
    expect(isRoleSupportedByProvider('elevenlabs', 'STT')).toBe(false);
    expect(isRoleSupportedByProvider('claude', 'LLM')).toBe(true);
    expect(isRoleSupportedByProvider('claude', 'TTS')).toBe(false);
  });

  it('carries vendor-specific defaults (ElevenLabs voiceId, Ollama local baseUrl)', () => {
    expect(getSparkProviderById('elevenlabs')?.voiceId).toBeTruthy();
    expect(getSparkProviderById('ollama')?.authStyle).toBe('none');
    expect(getSparkProviderById('ollama')?.baseUrlRequired).toBe(true);
  });

  it('defaults every role assignment to FreeLLMAPI', () => {
    const assignments = getDefaultRoleAssignments();
    for (const role of SPARK_PROVIDER_ROLES) {
      expect(assignments[role]).toBe('freellmapi');
    }
  });

  it('returns undefined for unknown providers', () => {
    expect(getSparkProviderById('does-not-exist')).toBeUndefined();
  });
});
