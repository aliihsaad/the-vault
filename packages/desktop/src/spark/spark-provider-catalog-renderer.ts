import type {
  SparkProviderCatalogEntry,
  SparkProviderRole,
  SparkRoleAssignments,
} from '@the-vault/core';

export const SPARK_PROVIDER_ROLES: readonly SparkProviderRole[] = ['STT', 'LLM', 'Realtime', 'TTS'];
export const SPARK_DEFAULT_PROVIDER_ID = 'freellmapi';

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

export function getSparkProviderCatalog(): SparkProviderCatalogEntry[] {
  return SPARK_PROVIDER_CATALOG.map((entry) => ({ ...entry, roles: [...entry.roles] }));
}

export function getProvidersForRole(role: SparkProviderRole): SparkProviderCatalogEntry[] {
  return getSparkProviderCatalog().filter((provider) => provider.roles.includes(role));
}

export function getDefaultRoleAssignments(): SparkRoleAssignments {
  return SPARK_PROVIDER_ROLES.reduce((acc, role) => {
    acc[role] = SPARK_DEFAULT_PROVIDER_ID;
    return acc;
  }, {} as SparkRoleAssignments);
}
