import {
  SPARK_PROVIDER_ROLES,
  type SparkProviderCatalogEntry,
  type SparkProviderRole,
  type SparkRoleAssignments,
} from '../types/spark-provider.js';

/** FreeLLMAPI is the zero-config default + fallback covering every role. */
export const SPARK_DEFAULT_PROVIDER_ID = 'freellmapi';

/**
 * Declarative Spark provider catalog (S2). Pure, non-secret data describing
 * which providers can fill which capability roles and how they authenticate.
 * Safe to import in the renderer; credentials are never part of this catalog.
 */
const SPARK_PROVIDER_CATALOG: readonly SparkProviderCatalogEntry[] = [
  {
    id: 'freellmapi',
    displayName: 'FreeLLMAPI',
    roles: ['STT', 'LLM', 'Realtime', 'TTS'],
    authStyle: 'bearer',
    baseUrlRequired: true,
    isDefault: true,
    description: 'Default OpenAI-compatible VPS gateway covering every role. Configure your VPS base URL and bearer key.',
  },
  {
    id: 'deepgram',
    displayName: 'Deepgram',
    roles: ['STT'],
    authStyle: 'apikey',
    baseUrl: 'https://api.deepgram.com',
    description: 'Low-latency speech-to-text.',
  },
  {
    id: 'elevenlabs',
    displayName: 'ElevenLabs',
    roles: ['TTS'],
    authStyle: 'apikey',
    baseUrl: 'https://api.elevenlabs.io',
    voiceId: 'EXAVITQu4vr4xnSDxMaL',
    description: 'High-quality text-to-speech voices.',
  },
  {
    id: 'openai',
    displayName: 'OpenAI',
    roles: ['LLM', 'STT', 'TTS', 'Realtime'],
    authStyle: 'bearer',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    description: 'LLM, transcription, speech, and realtime APIs.',
  },
  {
    id: 'gemini',
    displayName: 'Google Gemini',
    roles: ['LLM', 'Realtime', 'STT', 'TTS'],
    authStyle: 'apikey',
    baseUrl: 'https://generativelanguage.googleapis.com',
    model: 'gemini-2.0-flash',
    description: 'Gemini language and live multimodal models.',
  },
  {
    id: 'claude',
    displayName: 'Anthropic Claude',
    roles: ['LLM'],
    authStyle: 'apikey',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-6',
    description: 'Anthropic Claude language models.',
  },
  {
    id: 'openrouter',
    displayName: 'OpenRouter',
    roles: ['LLM'],
    authStyle: 'bearer',
    baseUrl: 'https://openrouter.ai/api/v1',
    description: 'Aggregated access to many hosted LLMs.',
  },
  {
    id: 'ollama',
    displayName: 'Ollama (local)',
    roles: ['LLM'],
    authStyle: 'none',
    baseUrl: 'http://localhost:11434',
    baseUrlRequired: true,
    description: 'Locally hosted open models; no API key required.',
  },
];

/** Return the full provider catalog (defensive copy). */
export function getSparkProviderCatalog(): SparkProviderCatalogEntry[] {
  return SPARK_PROVIDER_CATALOG.map((entry) => ({ ...entry, roles: [...entry.roles] }));
}

/** Look up a catalog entry by id, or `undefined` when unknown. */
export function getSparkProviderById(providerId: string): SparkProviderCatalogEntry | undefined {
  const entry = SPARK_PROVIDER_CATALOG.find((p) => p.id === providerId);
  return entry ? { ...entry, roles: [...entry.roles] } : undefined;
}

/** Providers that can fill a given capability role. */
export function getProvidersForRole(role: SparkProviderRole): SparkProviderCatalogEntry[] {
  return getSparkProviderCatalog().filter((p) => p.roles.includes(role));
}

/** Whether a provider supports a given role. */
export function isRoleSupportedByProvider(providerId: string, role: SparkProviderRole): boolean {
  return Boolean(getSparkProviderById(providerId)?.roles.includes(role));
}

/** Default per-role assignment: FreeLLMAPI fills every role out of the box. */
export function getDefaultRoleAssignments(): SparkRoleAssignments {
  return SPARK_PROVIDER_ROLES.reduce((acc, role) => {
    acc[role] = SPARK_DEFAULT_PROVIDER_ID;
    return acc;
  }, {} as SparkRoleAssignments);
}
