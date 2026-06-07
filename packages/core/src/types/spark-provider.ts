// Declarative provider registry contracts for Spark S2.
//
// These describe the *capability roles* Spark composes a voice assistant from
// (speech-to-text, language model, realtime, text-to-speech) and the providers
// that can fill each role. Catalog data is non-secret and safe to ship to the
// renderer; provider credentials are resolved host-side only (main process) and
// NEVER surfaced through these shapes.

export const SPARK_PROVIDER_ROLES = ['STT', 'LLM', 'Realtime', 'TTS'] as const;
export type SparkProviderRole = typeof SPARK_PROVIDER_ROLES[number];

/**
 * How a provider authenticates outbound calls:
 * - `bearer`  — `Authorization: Bearer <key>`
 * - `apikey`  — vendor-specific API-key header (e.g. Deepgram, ElevenLabs, Gemini, Claude)
 * - `none`    — local/no-auth providers (e.g. Ollama); only a baseUrl is needed
 */
export type SparkProviderAuthStyle = 'bearer' | 'apikey' | 'none';

export interface SparkProviderCatalogEntry {
  id: string;
  displayName: string;
  roles: SparkProviderRole[];
  authStyle: SparkProviderAuthStyle;
  /** Default base URL, when the vendor exposes a fixed endpoint. */
  baseUrl?: string;
  /** True when the user must supply a base URL (self-hosted VPS, local runtime). */
  baseUrlRequired?: boolean;
  /** Default model identifier, when applicable. */
  model?: string;
  /** Default voice identifier for TTS providers. */
  voiceId?: string;
  /** FreeLLMAPI is the zero-config default + fallback covering every role. */
  isDefault?: boolean;
  description?: string;
}

/** Active provider chosen per capability role. `null` means "unassigned". */
export type SparkRoleAssignments = Record<SparkProviderRole, string | null>;

/**
 * Credential state for a single provider — the ONLY credential-derived data the
 * renderer is ever allowed to see. It reports whether a key is stored and the
 * (non-secret) base URL; it never contains the key itself.
 */
export interface SparkProviderCredentialStateView {
  providerId: string;
  configured: boolean;
  baseUrl: string | null;
}

/**
 * Host-side resolution of the active provider for a role. `getKey()` resolves
 * the raw credential lazily in the main process only — it must never be called
 * in, or its result passed to, the renderer.
 */
export interface SparkActiveProviderForRole {
  role: SparkProviderRole;
  providerId: string;
  baseUrl: string | null;
  model: string | null;
  voiceId: string | null;
  authStyle: SparkProviderAuthStyle;
  getKey: () => string;
}
