import type {
  SparkProviderHealthSnapshot,
  SparkProviderHealthSummary,
  SparkProviderModeHealth,
} from '../types/spark-extension.js';
import {
  type SparkActiveProviderForRole,
  type SparkProviderCredentialStateView,
  type SparkProviderRole,
  type SparkRoleAssignments,
  SPARK_PROVIDER_ROLES,
} from '../types/spark-provider.js';
import {
  getDefaultRoleAssignments,
  getSparkProviderById,
  getSparkProviderCatalog,
  isRoleSupportedByProvider,
  SPARK_DEFAULT_PROVIDER_ID,
} from './spark-provider-catalog.js';

// Settings/secret key conventions. Credentials live in the encrypted secret
// store (safeStorage/AES-GCM); base URLs and role assignments are non-secret
// plain settings.
const CREDENTIAL_KEY_PREFIX = 'spark_provider_credential_';
const BASE_URL_KEY_PREFIX = 'spark_provider_baseurl_';
const ROLE_ASSIGNMENTS_KEY = 'spark_role_assignments';

function credentialKey(providerId: string): string {
  return `${CREDENTIAL_KEY_PREFIX}${providerId}`;
}

function baseUrlKey(providerId: string): string {
  return `${BASE_URL_KEY_PREFIX}${providerId}`;
}

/**
 * Host-side dependencies. `getSecret`/`setSecret` MUST be backed by the
 * encrypted secret store (e.g. main.ts getSecretSetting/setSecretSetting using
 * safeStorage/AES-GCM). `getSetting`/`setSetting` are plain Vault settings.
 */
export interface SparkProviderCredentialStoreDeps {
  getSecret: (key: string) => string;
  setSecret: (key: string, value: string) => void;
  getSetting: (key: string) => unknown;
  setSetting: (key: string, value: unknown) => void;
  now?: () => string;
}

export interface SparkProviderCredentialStore {
  /** Store a provider credential (key + optional base URL). Returns credential state only — never the key. */
  setProviderCredential: (providerId: string, key: string, baseUrl?: string | null) => SparkProviderCredentialStateView;
  /** Credential state for a provider — `configured` + base URL, never the key. */
  getProviderCredentialState: (providerId: string) => SparkProviderCredentialStateView;
  /** Credential state for every catalog provider. */
  listCredentialStates: () => SparkProviderCredentialStateView[];
  /** Active per-role provider selection, defaulted to FreeLLMAPI. */
  getRoleAssignments: () => SparkRoleAssignments;
  /** Assign a provider to a role (validated against catalog capabilities). */
  setRoleAssignment: (role: SparkProviderRole, providerId: string) => SparkRoleAssignments;
  /** Renderer-safe provider health summary (no keys). */
  getProviderHealthSummary: () => SparkProviderHealthSummary;
  /** HOST-ONLY: resolve the raw credential for a provider. Never call from the renderer. */
  getKeyForProvider: (providerId: string) => string;
  /** HOST-ONLY: resolve the active provider for a role with a lazy getKey(). */
  getActiveProviderForRole: (role: SparkProviderRole) => SparkActiveProviderForRole;
}

export function createSparkProviderCredentialStore(
  deps: SparkProviderCredentialStoreDeps,
): SparkProviderCredentialStore {
  const now = deps.now ?? (() => new Date().toISOString());

  function readBaseUrl(providerId: string): string | null {
    const stored = deps.getSetting(baseUrlKey(providerId));
    if (typeof stored === 'string' && stored.trim()) {
      return stored.trim();
    }
    return null;
  }

  function getProviderCredentialState(providerId: string): SparkProviderCredentialStateView {
    const entry = getSparkProviderById(providerId);
    if (!entry) {
      return { providerId, configured: false, baseUrl: null };
    }
    const baseUrl = readBaseUrl(providerId);
    const hasKey = Boolean(deps.getSecret(credentialKey(providerId)).trim());
    // No-auth providers (e.g. Ollama) are "configured" once a base URL exists.
    const configured = entry.authStyle === 'none' ? Boolean(baseUrl) : hasKey;
    return { providerId, configured, baseUrl };
  }

  function setProviderCredential(
    providerId: string,
    key: string,
    baseUrl?: string | null,
  ): SparkProviderCredentialStateView {
    const entry = getSparkProviderById(providerId);
    if (!entry) {
      throw new Error(`Unknown Spark provider: ${providerId}`);
    }
    // Always write the secret (empty string clears it). The secret store never
    // surfaces back through any return value.
    deps.setSecret(credentialKey(providerId), typeof key === 'string' ? key : '');
    if (baseUrl !== undefined) {
      deps.setSetting(baseUrlKey(providerId), typeof baseUrl === 'string' ? baseUrl.trim() : '');
    }
    return getProviderCredentialState(providerId);
  }

  function listCredentialStates(): SparkProviderCredentialStateView[] {
    return getSparkProviderCatalog().map((entry) => getProviderCredentialState(entry.id));
  }

  function getRoleAssignments(): SparkRoleAssignments {
    const defaults = getDefaultRoleAssignments();
    const stored = deps.getSetting(ROLE_ASSIGNMENTS_KEY);
    const parsed = parseStoredAssignments(stored);
    const resolved = { ...defaults };
    for (const role of SPARK_PROVIDER_ROLES) {
      const candidate = parsed[role];
      // Only honor a stored assignment if the provider still supports the role.
      if (candidate && isRoleSupportedByProvider(candidate, role)) {
        resolved[role] = candidate;
      }
    }
    return resolved;
  }

  function setRoleAssignment(role: SparkProviderRole, providerId: string): SparkRoleAssignments {
    if (!SPARK_PROVIDER_ROLES.includes(role)) {
      throw new Error(`Unknown Spark role: ${role}`);
    }
    if (!isRoleSupportedByProvider(providerId, role)) {
      throw new Error(`Provider ${providerId} cannot fill the ${role} role.`);
    }
    const next = { ...getRoleAssignments(), [role]: providerId };
    deps.setSetting(ROLE_ASSIGNMENTS_KEY, next);
    return next;
  }

  function getProviderHealthSummary(): SparkProviderHealthSummary {
    return buildSparkProviderHealthSummary({
      credentialStates: listCredentialStates(),
      assignments: getRoleAssignments(),
      now: now(),
    });
  }

  function getKeyForProvider(providerId: string): string {
    return deps.getSecret(credentialKey(providerId));
  }

  function getActiveProviderForRole(role: SparkProviderRole): SparkActiveProviderForRole {
    const assignments = getRoleAssignments();
    const providerId = assignments[role] ?? SPARK_DEFAULT_PROVIDER_ID;
    const entry = getSparkProviderById(providerId);
    if (!entry) {
      throw new Error(`Active provider ${providerId} for role ${role} is not in the catalog.`);
    }
    const baseUrl = readBaseUrl(providerId) ?? entry.baseUrl ?? null;
    return {
      role,
      providerId,
      baseUrl,
      model: entry.model ?? null,
      voiceId: entry.voiceId ?? null,
      authStyle: entry.authStyle,
      getKey: () => deps.getSecret(credentialKey(providerId)),
    };
  }

  return {
    setProviderCredential,
    getProviderCredentialState,
    listCredentialStates,
    getRoleAssignments,
    setRoleAssignment,
    getProviderHealthSummary,
    getKeyForProvider,
    getActiveProviderForRole,
  };
}

function parseStoredAssignments(value: unknown): Partial<SparkRoleAssignments> {
  if (!value) {
    return {};
  }
  let record: unknown = value;
  if (typeof value === 'string') {
    try {
      record = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (typeof record !== 'object' || record === null) {
    return {};
  }
  const result: Partial<SparkRoleAssignments> = {};
  for (const role of SPARK_PROVIDER_ROLES) {
    const candidate = (record as Record<string, unknown>)[role];
    if (typeof candidate === 'string' && candidate.trim()) {
      result[role] = candidate;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Pure health-summary builder. Renderer-safe: input is credential *state* only
// (never raw keys), output mirrors SparkProviderHealthSummary for the snapshot.
// ---------------------------------------------------------------------------

export interface BuildSparkProviderHealthSummaryInput {
  credentialStates: SparkProviderCredentialStateView[];
  assignments: SparkRoleAssignments;
  now?: string;
}

export function buildSparkProviderHealthSummary(
  input: BuildSparkProviderHealthSummaryInput,
): SparkProviderHealthSummary {
  const stateById = new Map(input.credentialStates.map((s) => [s.providerId, s]));
  const providers: SparkProviderHealthSnapshot[] = getSparkProviderCatalog().map((entry) => {
    const state = stateById.get(entry.id);
    const configured = Boolean(state?.configured);
    const mode = (message: string): SparkProviderModeHealth => ({
      state: configured ? 'ready' : 'unknown',
      message,
      checkedAt: null,
    });
    return {
      providerId: entry.id,
      displayName: entry.displayName,
      enabled: configured,
      credentialState: configured ? 'configured' : 'missing',
      aggregateHealth: configured ? 'ready' : 'unknown',
      classic: mode(configured ? 'Credential configured.' : 'Awaiting credential.'),
      realtime: mode(configured ? 'Credential configured.' : 'Awaiting credential.'),
    };
  });

  const counts = providers.reduce(
    (acc, provider) => {
      acc[provider.aggregateHealth] += 1;
      return acc;
    },
    { ready: 0, degraded: 0, unavailable: 0, unknown: 0 } as Record<
      SparkProviderHealthSnapshot['aggregateHealth'],
      number
    >,
  );

  // Surface the LLM-role provider as the headline "active" provider for the
  // existing single-active-provider snapshot fields.
  const activeProviderId = input.assignments.LLM ?? null;

  return {
    activeProviderId,
    activeProviderMode: activeProviderId ? 'classic' : null,
    ready: counts.ready,
    degraded: counts.degraded,
    unavailable: counts.unavailable,
    unknown: counts.unknown,
    providers,
    roleAssignments: { ...input.assignments },
  };
}
