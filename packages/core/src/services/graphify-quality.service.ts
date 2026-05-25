import type {
  GraphifyRuntimeConfig,
  GraphifyScheduledFullRebuildPlan,
  GraphifySemanticModeStatus,
  GraphifyProjectStatus,
  PlanGraphifyScheduledFullRebuildInput,
} from '../types/graphify.js';

const EXTERNAL_SEMANTIC_PROVIDERS = new Set(['openai', 'gemini', 'bedrock']);
const DEFAULT_FULL_REBUILD_INTERVAL_HOURS = 24;

export function getGraphifySemanticModeStatus(
  config: GraphifyRuntimeConfig,
): GraphifySemanticModeStatus {
  const provider = normalizeProvider(config.semantic.provider);
  const enabled = config.semantic.enabled;
  const externalProvider = provider !== null && EXTERNAL_SEMANTIC_PROVIDERS.has(provider);
  const warnings: string[] = [];

  if (externalProvider) {
    warnings.push(
      `Semantic provider "${provider}" may send project source and Vault memory export content to an external provider. Review cost and privacy before running semantic builds.`,
    );
  }
  if (enabled) {
    warnings.push('Semantic builds are manual and budgeted; scheduled full rebuilds do not run semantic extraction automatically.');
  }

  if (!enabled) {
    return {
      enabled,
      provider,
      providerConfigured: provider !== null,
      allowExternalProviders: config.semantic.allowExternalProviders,
      externalProvider,
      buildAllowed: false,
      warnings,
      message: 'Graphify semantic mode is disabled by default. Enable semantic mode and configure a provider before running semantic builds.',
    };
  }

  if (!provider) {
    return {
      enabled,
      provider,
      providerConfigured: false,
      allowExternalProviders: config.semantic.allowExternalProviders,
      externalProvider,
      buildAllowed: false,
      warnings,
      message: 'Choose a Graphify semantic provider before running semantic builds.',
    };
  }

  if (externalProvider && !config.semantic.allowExternalProviders) {
    return {
      enabled,
      provider,
      providerConfigured: true,
      allowExternalProviders: config.semantic.allowExternalProviders,
      externalProvider,
      buildAllowed: false,
      warnings,
      message: `Graphify semantic provider "${provider}" uses an external provider. Enable external provider use before running semantic builds.`,
    };
  }

  return {
    enabled,
    provider,
    providerConfigured: true,
    allowExternalProviders: config.semantic.allowExternalProviders,
    externalProvider,
    buildAllowed: true,
    warnings,
    message: `Graphify semantic builds are enabled for provider "${provider}".`,
  };
}

export function assertGraphifySemanticBuildAllowed(config: GraphifyRuntimeConfig): GraphifySemanticModeStatus {
  const status = getGraphifySemanticModeStatus(config);
  if (!status.buildAllowed) {
    throw new Error(status.message);
  }
  return status;
}

export function planGraphifyScheduledFullRebuild(
  projectStatus: GraphifyProjectStatus,
  runtimeConfig: GraphifyRuntimeConfig,
  input: PlanGraphifyScheduledFullRebuildInput = {},
): GraphifyScheduledFullRebuildPlan {
  const warnings = buildScheduledFullRebuildWarnings(runtimeConfig);
  const project = projectStatus.project;
  const intervalHours = normalizePositiveNumber(input.intervalHours, DEFAULT_FULL_REBUILD_INTERVAL_HOURS);
  const now = parseDate(input.now) ?? new Date();

  if (!projectStatus.enabled) {
    return {
      shouldQueue: false,
      project,
      buildMode: null,
      reason: 'disabled',
      nextEligibleAt: null,
      warnings,
    };
  }

  if (!projectStatus.sourceRoot || projectStatus.buildBlockedReason === 'sourceRootRequired') {
    return {
      shouldQueue: false,
      project,
      buildMode: null,
      reason: 'sourceRootRequired',
      nextEligibleAt: null,
      warnings,
    };
  }

  if (projectStatus.freshness === 'queued') {
    return {
      shouldQueue: false,
      project,
      buildMode: null,
      reason: 'alreadyQueued',
      nextEligibleAt: null,
      warnings,
    };
  }

  if (projectStatus.freshness === 'building') {
    return {
      shouldQueue: false,
      project,
      buildMode: null,
      reason: 'alreadyBuilding',
      nextEligibleAt: null,
      warnings,
    };
  }

  const completedAt = parseDate(projectStatus.state?.lastBuildCompletedAt ?? null);
  if (!completedAt) {
    return {
      shouldQueue: true,
      project,
      buildMode: 'full',
      reason: 'missing',
      nextEligibleAt: null,
      warnings,
    };
  }

  const nextEligibleAt = new Date(completedAt.getTime() + intervalHours * 60 * 60 * 1000);
  if (now >= nextEligibleAt) {
    return {
      shouldQueue: true,
      project,
      buildMode: 'full',
      reason: 'due',
      nextEligibleAt: nextEligibleAt.toISOString(),
      warnings,
    };
  }

  return {
    shouldQueue: false,
    project,
    buildMode: null,
    reason: 'notDue',
    nextEligibleAt: nextEligibleAt.toISOString(),
    warnings,
  };
}

function buildScheduledFullRebuildWarnings(config: GraphifyRuntimeConfig): string[] {
  return config.semantic.enabled
    ? ['Scheduled full rebuilds use full mode only; semantic extraction stays manual and requires an explicit semantic rebuild.']
    : [];
}

function normalizeProvider(provider: string | null): string | null {
  const normalized = provider?.trim().toLowerCase() ?? '';
  return normalized || null;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizePositiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}
