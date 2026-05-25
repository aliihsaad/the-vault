import type {
  GraphifyArtifactDiscoveryResult,
  GraphifyBuildRecord,
  GraphifyFreshnessState,
  GraphifyHtmlArtifactResult,
  GraphifyInstallPlan,
  GraphifyProjectStatus,
  GraphifyRuntimeConfig,
  GraphifyRuntimeStatus,
} from '@the-vault/core';

export type GraphifySettingsState =
  | 'missing'
  | 'detected'
  | 'installed'
  | 'failed'
  | 'developerMode';

export type GraphifyProjectGraphState =
  | 'sourceRootRequired'
  | 'queued'
  | 'building'
  | 'fresh'
  | 'stale'
  | 'failed'
  | 'disabled'
  | 'missing';

export interface GraphifyActionModel {
  enabled: boolean;
  label: string;
  reason: string | null;
}

export interface GraphifySettingsViewModelInput {
  config: GraphifyRuntimeConfig;
  runtimeStatus: GraphifyRuntimeStatus | null;
  installPlan: GraphifyInstallPlan | null;
  detectionError?: string | null;
}

export interface GraphifySettingsViewModel {
  state: GraphifySettingsState;
  primaryLabel: string;
  detail: string;
  installedVersion: string | null;
  developerSourcePath: string | null;
  errorMessage: string | null;
  installCommands: string[];
  actions: {
    detect: GraphifyActionModel;
    install: GraphifyActionModel;
  };
}

export interface GraphifyProjectGraphViewModelInput {
  projectStatus: GraphifyProjectStatus;
  artifactDiscovery?: GraphifyArtifactDiscoveryResult | null;
  htmlArtifact?: GraphifyHtmlArtifactResult | null;
  artifactUrl?: string | null;
  buildHistory?: GraphifyBuildRecord[];
  semanticEnabled?: boolean;
}

export interface GraphifyProjectGraphViewModel {
  project: string;
  state: GraphifyProjectGraphState;
  preferredTab: 'graph' | 'report' | 'vault';
  statusLabel: string;
  detail: string;
  warning: string | null;
  sourceRoot: string | null;
  buildMode: string;
  stats: {
    nodes: number;
    edges: number;
    communities: number;
  } | null;
  embedUrl: string | null;
  reportPath: string | null;
  artifactRoot: string | null;
  failure: {
    message: string;
    logPath: string | null;
  } | null;
  actions: {
    install: GraphifyActionModel;
    rebuild: GraphifyActionModel;
    fullRebuild: GraphifyActionModel;
    semanticRebuild: GraphifyActionModel;
    exportArtifacts: GraphifyActionModel;
    openGraph: GraphifyActionModel;
    openReport: GraphifyActionModel;
    openFolder: GraphifyActionModel;
    changeSourceRoot: GraphifyActionModel;
  };
}

export function buildGraphifySettingsViewModel(
  input: GraphifySettingsViewModelInput,
): GraphifySettingsViewModel {
  const installCommandCount = input.installPlan?.commands.length ?? 0;
  const installCommands = input.installPlan?.commands.map((command) => command.preview) ?? [];
  const hasInstaller = installCommandCount > 0;
  const detectionError = normalizeOptionalText(input.detectionError);
  const developerSourcePath = input.config.localSourceCheckoutPath;

  if (detectionError) {
    return {
      state: 'failed',
      primaryLabel: 'Graphify detection failed',
      detail: 'Vault could not inspect the local Graphify runtime. Core Vault memory features remain available.',
      installedVersion: null,
      developerSourcePath: null,
      errorMessage: detectionError,
      installCommands,
      actions: {
        detect: enabledAction('Detect runtime'),
        install: hasInstaller
          ? enabledAction('Copy install commands')
          : disabledAction('Install Graphify', 'No supported installer was detected.'),
      },
    };
  }

  if (input.config.runtimeMode === 'localSource') {
    return {
      state: 'developerMode',
      primaryLabel: 'Developer source mode',
      detail: developerSourcePath
        ? `Vault will use the local Graphify checkout at ${developerSourcePath}.`
        : 'Choose a local Graphify checkout before installing developer mode.',
      installedVersion: input.runtimeStatus?.graphify.version ?? null,
      developerSourcePath,
      errorMessage: null,
      installCommands,
      actions: {
        detect: enabledAction('Detect runtime'),
        install: hasInstaller
          ? enabledAction('Copy developer install commands')
          : disabledAction('Install developer checkout', 'No supported installer was detected.'),
      },
    };
  }

  if (input.runtimeStatus?.graphify.available) {
    const version = input.runtimeStatus.graphify.version;
    return {
      state: 'installed',
      primaryLabel: 'Graphify installed',
      detail: version
        ? `Graphify ${version} is available through ${input.runtimeStatus.graphify.command}.`
        : `Graphify is available through ${input.runtimeStatus.graphify.command}.`,
      installedVersion: version,
      developerSourcePath: null,
      errorMessage: null,
      installCommands: [],
      actions: {
        detect: enabledAction('Detect runtime'),
        install: disabledAction('Already installed', 'Graphify is already available.'),
      },
    };
  }

  const prerequisiteDetected = Boolean(
    input.runtimeStatus?.python.available
    || input.runtimeStatus?.uv.available
    || input.runtimeStatus?.pipx.available,
  );

  if (prerequisiteDetected) {
    return {
      state: 'detected',
      primaryLabel: 'Ready to install Graphify',
      detail: 'Vault found a supported local installer or Python runtime but not the Graphify CLI.',
      installedVersion: null,
      developerSourcePath: null,
      errorMessage: null,
      installCommands,
      actions: {
        detect: enabledAction('Detect runtime'),
        install: hasInstaller
          ? enabledAction('Copy install commands')
          : disabledAction('Install Graphify', 'No install command is available.'),
      },
    };
  }

  return {
    state: 'missing',
    primaryLabel: 'Graphify missing',
    detail: 'Vault has not detected Graphify or a supported installer. Memory, recall, and MCP flows continue normally.',
    installedVersion: null,
    developerSourcePath: null,
    errorMessage: null,
    installCommands,
    actions: {
      detect: enabledAction('Detect runtime'),
      install: hasInstaller
        ? enabledAction('Copy install commands')
        : disabledAction('Install Graphify', 'No supported installer was detected.'),
    },
  };
}

export function buildGraphifyProjectGraphViewModel(
  input: GraphifyProjectGraphViewModelInput,
): GraphifyProjectGraphViewModel {
  const state = getProjectGraphState(input.projectStatus);
  const graphStats = input.projectStatus.state?.graphStats ?? input.artifactDiscovery?.graphStats ?? null;
  const artifactPaths = input.projectStatus.state?.artifactPaths ?? input.artifactDiscovery?.artifactPaths ?? null;
  const htmlAvailable = input.htmlArtifact?.status === 'available';
  const reportPath = artifactPaths?.graphReport ?? null;
  const artifactRoot = input.artifactDiscovery?.artifactRoot
    ?? inferArtifactRoot(artifactPaths?.graphHtml ?? artifactPaths?.graphJson ?? artifactPaths?.graphReport ?? null);
  const busy = state === 'queued' || state === 'building';
  const buildEligible = input.projectStatus.buildEligible && state !== 'disabled' && state !== 'sourceRootRequired';
  const canChangeSourceRoot = state !== 'disabled';
  const graphCanOpen = htmlAvailable && Boolean(input.artifactUrl);
  const reportCanOpen = Boolean(reportPath);
  const preferredTab = graphCanOpen ? 'graph' : reportCanOpen ? 'report' : 'vault';
  const artifactsAvailable = Boolean(artifactPaths?.graphJson || artifactPaths?.graphHtml || artifactPaths?.graphReport);
  const failedBuild = input.buildHistory?.find((build) => build.status === 'failed') ?? null;
  const lastError = normalizeOptionalText(input.projectStatus.state?.lastError)
    ?? normalizeOptionalText(failedBuild?.errorMessage);

  return {
    project: input.projectStatus.project,
    state,
    preferredTab,
    statusLabel: getProjectStatusLabel(state),
    detail: input.projectStatus.message,
    warning: getProjectWarning(state, graphCanOpen),
    sourceRoot: input.projectStatus.sourceRoot,
    buildMode: input.projectStatus.buildMode,
    stats: graphStats
      ? {
          nodes: graphStats.nodeCount,
          edges: graphStats.edgeCount,
          communities: graphStats.communityCount,
        }
      : null,
    embedUrl: graphCanOpen ? input.artifactUrl ?? null : null,
    reportPath,
    artifactRoot,
    failure: state === 'failed'
      ? {
          message: lastError ?? 'Graphify build failed.',
          logPath: failedBuild?.logPath ?? null,
        }
      : null,
    actions: {
      install: disabledAction('Install Graphify', 'Install Graphify from Settings.'),
      rebuild: buildAction('Rebuild', buildEligible, busy, input.projectStatus.buildBlockedReason),
      fullRebuild: buildAction('Full rebuild', buildEligible, busy, input.projectStatus.buildBlockedReason),
      semanticRebuild: input.semanticEnabled
        ? buildAction('Semantic rebuild', buildEligible, busy, input.projectStatus.buildBlockedReason)
        : disabledAction('Semantic rebuild', 'Semantic mode is not enabled for this project.'),
      exportArtifacts: artifactsAvailable && (state === 'fresh' || state === 'stale')
        ? enabledAction('Export artifacts')
        : disabledAction('Export artifacts', artifactsAvailable ? 'Artifacts are not ready to export.' : 'No graph artifacts are available.'),
      openGraph: graphCanOpen
        ? enabledAction('Open graph')
        : disabledAction(
          'Open graph',
          htmlAvailable
            ? 'Artifact URL is not available yet.'
            : reportCanOpen
              ? 'graph.html is missing; use the report fallback.'
              : 'graph.html is missing.',
        ),
      openReport: reportCanOpen
        ? enabledAction('Open report')
        : disabledAction('Open report', 'GRAPH_REPORT.md is missing.'),
      openFolder: artifactRoot && artifactsAvailable
        ? enabledAction('Open folder')
        : disabledAction('Open folder', 'No graph artifact folder is available yet.'),
      changeSourceRoot: canChangeSourceRoot
        ? enabledAction('Change folder')
        : disabledAction('Change folder', 'Enable Graphify before changing the source folder.'),
    },
  };
}

function getProjectGraphState(status: GraphifyProjectStatus): GraphifyProjectGraphState {
  if (status.uiState === 'disabled' || status.freshness === 'disabled') {
    return 'disabled';
  }

  if (status.uiState === 'sourceRootRequired') {
    return 'sourceRootRequired';
  }

  return status.freshness as GraphifyFreshnessState;
}

function getProjectStatusLabel(state: GraphifyProjectGraphState): string {
  switch (state) {
    case 'sourceRootRequired':
      return 'Choose source folder';
    case 'queued':
      return 'Build queued';
    case 'building':
      return 'Graphify building';
    case 'fresh':
      return 'Graph fresh';
    case 'stale':
      return 'Graph stale';
    case 'failed':
      return 'Build failed';
    case 'disabled':
      return 'Graphify disabled';
    case 'missing':
      return 'No graph built';
  }
}

function getProjectWarning(state: GraphifyProjectGraphState, graphCanOpen: boolean): string | null {
  if (state === 'stale') {
    return graphCanOpen
      ? 'This graph is stale. The last good graph remains available while Vault queues or runs a rebuild.'
      : 'This graph is stale and graph.html is not available.';
  }

  if (state === 'failed' && graphCanOpen) {
    return 'The latest build failed. Vault is preserving the last good graph artifact.';
  }

  return null;
}

function buildAction(
  label: string,
  buildEligible: boolean,
  busy: boolean,
  blockedReason: string | null,
): GraphifyActionModel {
  if (busy) {
    return disabledAction(label, 'A Graphify build is already queued or running.');
  }

  if (!buildEligible) {
    return disabledAction(label, blockedReason === 'sourceRootRequired'
      ? 'Choose a source folder before building.'
      : 'Graphify is disabled for this project.');
  }

  return enabledAction(label);
}

function enabledAction(label: string): GraphifyActionModel {
  return {
    enabled: true,
    label,
    reason: null,
  };
}

function disabledAction(label: string, reason: string): GraphifyActionModel {
  return {
    enabled: false,
    label,
    reason,
  };
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed ? trimmed : null;
}

function inferArtifactRoot(pathValue: string | null): string | null {
  if (!pathValue) {
    return null;
  }

  const normalized = pathValue.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  return index > 0 ? pathValue.slice(0, index) : null;
}
