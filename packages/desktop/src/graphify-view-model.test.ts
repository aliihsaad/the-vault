import { describe, expect, it } from 'vitest';

import {
  buildGraphifyProjectGraphViewModel,
  buildGraphifySettingsViewModel,
} from './graphify-view-model.js';
import type {
  GraphifyArtifactDiscoveryResult,
  GraphifyBuildRecord,
  GraphifyInstallPlan,
  GraphifyProjectState,
  GraphifyProjectStatus,
  GraphifyRuntimeConfig,
  GraphifyRuntimeStatus,
  GraphifyUpdateCheck,
} from '@the-vault/core';

const timestamp = '2026-05-24T20:00:00.000Z';

function runtimeStatus(overrides: Partial<GraphifyRuntimeStatus> = {}): GraphifyRuntimeStatus {
  return {
    python: { available: false, version: null, reason: 'Python was not detected.' },
    uv: { available: false, version: null, reason: 'uv was not detected.' },
    pipx: { available: false, version: null, reason: 'pipx was not detected.' },
    graphify: { available: false, version: null, reason: 'Graphify CLI was not detected.', command: 'graphify' },
    ...overrides,
  };
}

function runtimeConfig(overrides: Partial<GraphifyRuntimeConfig> = {}): GraphifyRuntimeConfig {
  return {
    runtimeMode: 'managed',
    managedRuntimePath: 'C:/Vault/extensions/graphify/runtime',
    customExecutablePath: null,
    localSourceCheckoutPath: null,
    installProfile: 'base',
    installExtras: [],
    debounce: {
      autoBuildDelayMs: 60000,
      maxCoalesceDelayMs: 300000,
    },
    semantic: {
      enabled: false,
      provider: null,
      allowExternalProviders: false,
    },
    ...overrides,
  };
}

function installPlan(commandCount = 1): GraphifyInstallPlan {
  return {
    runtimeMode: 'managed',
    developerMode: false,
    packageName: 'graphifyy',
    cliCommand: 'graphify',
    runtimePath: 'C:/Vault/extensions/graphify/runtime',
    selectedInstaller: commandCount > 0 ? 'uv' : null,
    commands: Array.from({ length: commandCount }, (_, index) => ({
      label: `Install step ${index + 1}`,
      command: 'uv',
      args: ['pip', 'install', 'graphifyy'],
      preview: 'uv pip install graphifyy',
    })),
  };
}

function projectState(overrides: Partial<GraphifyProjectState> = {}): GraphifyProjectState {
  return {
    project: 'the-vault',
    enabled: true,
    sourceRoot: 'C:/Users/Mini/Desktop/Projects/the-vault',
    freshness: 'fresh',
    buildMode: 'fast',
    latestBuildId: 'gb_the_vault_1',
    artifactPaths: {
      graphJson: 'C:/Vault/extensions/graphify/projects/the-vault/graphify-out/graph.json',
      graphHtml: 'C:/Vault/extensions/graphify/projects/the-vault/graphify-out/graph.html',
      graphReport: 'C:/Vault/extensions/graphify/projects/the-vault/graphify-out/GRAPH_REPORT.md',
      graphSvg: null,
    },
    graphPath: 'C:/Vault/extensions/graphify/projects/the-vault/graphify-out/graph.json',
    htmlPath: 'C:/Vault/extensions/graphify/projects/the-vault/graphify-out/graph.html',
    reportPath: 'C:/Vault/extensions/graphify/projects/the-vault/graphify-out/GRAPH_REPORT.md',
    svgPath: null,
    graphStats: {
      nodeCount: 42,
      edgeCount: 84,
      communityCount: 6,
    },
    detectedGraphifyVersion: '0.8.17',
    lastBuildStartedAt: timestamp,
    lastBuildCompletedAt: timestamp,
    failureCount: 0,
    lastError: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function projectStatus(overrides: Partial<GraphifyProjectStatus> = {}): GraphifyProjectStatus {
  const state = overrides.state === undefined ? projectState() : overrides.state;
  return {
    project: 'the-vault',
    enabled: state?.enabled ?? true,
    sourceRoot: state?.sourceRoot ?? 'C:/Users/Mini/Desktop/Projects/the-vault',
    sourceRootCandidate: null,
    freshness: state?.freshness ?? 'fresh',
    buildMode: state?.buildMode ?? 'fast',
    buildEligible: true,
    buildBlockedReason: null,
    uiState: 'ready',
    message: 'Graphify source root is configured.',
    state,
    ...overrides,
  };
}

function missingArtifactDiscovery(): GraphifyArtifactDiscoveryResult {
  return {
    available: false,
    artifactRoot: 'C:/Vault/extensions/graphify/projects/the-vault/graphify-out',
    artifactPaths: {
      graphJson: null,
      graphHtml: null,
      graphReport: null,
      graphSvg: null,
    },
    graphStats: null,
    missingRequired: ['graph.json'],
    errorMessage: 'Graphify build did not produce graph.json.',
  };
}

describe('graphify settings view model', () => {
  it('maps runtime detection outcomes to missing, detected, installed, failed, and developer states', () => {
    expect(buildGraphifySettingsViewModel({
      config: runtimeConfig(),
      runtimeStatus: runtimeStatus(),
      installPlan: installPlan(0),
    })).toMatchObject({
      state: 'missing',
      primaryLabel: 'Graphify missing',
      actions: {
        install: { enabled: false },
      },
    });

    expect(buildGraphifySettingsViewModel({
      config: runtimeConfig(),
      runtimeStatus: runtimeStatus({
        python: { available: true, version: '3.12.4' },
        uv: { available: true, version: '0.7.2' },
      }),
      installPlan: installPlan(2),
    })).toMatchObject({
      state: 'detected',
      primaryLabel: 'Ready to install Graphify',
      actions: {
        install: { enabled: true, label: 'Copy install commands' },
      },
    });

    expect(buildGraphifySettingsViewModel({
      config: runtimeConfig(),
      runtimeStatus: runtimeStatus({
        graphify: { available: true, version: '0.8.17', command: 'graphify' },
      }),
      installPlan: installPlan(2),
    })).toMatchObject({
      state: 'installed',
      primaryLabel: 'Graphify installed',
      installedVersion: '0.8.17',
      actions: {
        install: { enabled: false, label: 'Already installed' },
      },
    });

    expect(buildGraphifySettingsViewModel({
      config: runtimeConfig({
        runtimeMode: 'localSource',
        localSourceCheckoutPath: 'C:/Users/Mini/Desktop/cloned-repos/graphify',
      }),
      runtimeStatus: runtimeStatus(),
      installPlan: installPlan(1),
    })).toMatchObject({
      state: 'developerMode',
      primaryLabel: 'Developer source mode',
      developerSourcePath: 'C:/Users/Mini/Desktop/cloned-repos/graphify',
      actions: {
        install: { enabled: true, label: 'Copy developer install commands' },
      },
    });

    expect(buildGraphifySettingsViewModel({
      config: runtimeConfig(),
      runtimeStatus: null,
      installPlan: installPlan(1),
      detectionError: 'spawn graphify EPERM',
    })).toMatchObject({
      state: 'failed',
      primaryLabel: 'Graphify detection failed',
      errorMessage: 'spawn graphify EPERM',
      actions: {
        install: { enabled: true },
      },
    });
  });

  it('does not expose install commands once Graphify is already installed', () => {
    const model = buildGraphifySettingsViewModel({
      config: runtimeConfig(),
      runtimeStatus: runtimeStatus({
        graphify: {
          available: true,
          version: '0.8.18',
          command: 'C:/Users/Mini/Vault/extensions/graphify/runtime/Scripts/graphify.exe',
        },
      }),
      installPlan: installPlan(2),
    });

    expect(model.state).toBe('installed');
    expect(model.installCommands).toEqual([]);
    expect(model.actions.install).toEqual({
      enabled: false,
      label: 'Already installed',
      reason: 'Graphify is already available.',
    });
  });

  it('drives the runtime update action from the persisted update check', () => {
    const installedRuntime = runtimeStatus({
      graphify: { available: true, version: '0.8.18', command: 'graphify' },
    });
    const check = (overrides: Partial<GraphifyUpdateCheck> = {}): GraphifyUpdateCheck => ({
      installedVersion: '0.8.18',
      latestVersion: '0.9.17',
      updateAvailable: true,
      checkedAt: timestamp,
      source: 'pypi',
      error: null,
      ...overrides,
    });

    expect(buildGraphifySettingsViewModel({
      config: runtimeConfig(),
      runtimeStatus: installedRuntime,
      installPlan: installPlan(0),
      updateCheck: check(),
    })).toMatchObject({
      state: 'installed',
      primaryLabel: 'Graphify update available',
      latestVersion: '0.9.17',
      updateAvailable: true,
      actions: {
        update: { enabled: true, label: 'Update to 0.9.17' },
      },
    });

    expect(buildGraphifySettingsViewModel({
      config: runtimeConfig(),
      runtimeStatus: installedRuntime,
      installPlan: installPlan(0),
      updateCheck: check({ latestVersion: '0.8.18', updateAvailable: false }),
    })).toMatchObject({
      primaryLabel: 'Graphify installed',
      updateAvailable: false,
      actions: {
        update: { enabled: false, label: 'Up to date' },
      },
    });

    expect(buildGraphifySettingsViewModel({
      config: runtimeConfig(),
      runtimeStatus: installedRuntime,
      installPlan: installPlan(0),
      updateCheck: check(),
      updating: true,
    })).toMatchObject({
      actions: {
        update: { enabled: false, label: 'Updating Graphify...' },
      },
    });

    expect(buildGraphifySettingsViewModel({
      config: runtimeConfig(),
      runtimeStatus: installedRuntime,
      installPlan: installPlan(0),
    })).toMatchObject({
      actions: {
        update: { enabled: false, label: 'Update Graphify', reason: 'No update check has run yet.' },
      },
    });

    expect(buildGraphifySettingsViewModel({
      config: runtimeConfig(),
      runtimeStatus: installedRuntime,
      installPlan: installPlan(0),
      updateCheck: check({ latestVersion: null, updateAvailable: false, error: 'PyPI version check timed out after 8000ms.' }),
    }).actions.update).toMatchObject({
      enabled: false,
      reason: expect.stringContaining('Update check failed'),
    });

    expect(buildGraphifySettingsViewModel({
      config: runtimeConfig({ runtimeMode: 'path' }),
      runtimeStatus: installedRuntime,
      installPlan: installPlan(0),
      updateCheck: check(),
    }).actions.update).toMatchObject({
      enabled: false,
      reason: expect.stringContaining('managed runtime'),
    });

    expect(buildGraphifySettingsViewModel({
      config: runtimeConfig(),
      runtimeStatus: runtimeStatus(),
      installPlan: installPlan(0),
      updateCheck: check(),
    }).actions.update).toMatchObject({
      enabled: false,
      reason: 'Install Graphify first.',
    });
  });

  it('keeps install previews ordered and PowerShell paste-safe', () => {
    const model = buildGraphifySettingsViewModel({
      config: runtimeConfig(),
      runtimeStatus: runtimeStatus({
        python: { available: true, version: '3.14.0' },
      }),
      installPlan: {
        runtimeMode: 'managed',
        developerMode: false,
        packageName: 'graphifyy',
        cliCommand: 'graphify',
        runtimePath: 'C:/Users/Mini/Vault/extensions/graphify/runtime',
        selectedInstaller: 'pythonVenv',
        commands: [
          {
            label: 'Create managed Graphify virtual environment',
            command: 'python',
            args: ['-m', 'venv', 'C:/Users/Mini/Vault/extensions/graphify/runtime'],
            preview: 'python -m venv "C:\\Users\\Mini\\Vault\\extensions\\graphify\\runtime"',
          },
          {
            label: 'Install Graphify into managed runtime',
            command: 'C:/Users/Mini/Vault/extensions/graphify/runtime/Scripts/python.exe',
            args: ['-m', 'pip', 'install', 'graphifyy'],
            preview: '& "C:\\Users\\Mini\\Vault\\extensions\\graphify\\runtime\\Scripts\\python.exe" -m pip install graphifyy',
          },
        ],
      },
    });

    expect(model.installCommands).toEqual([
      'python -m venv "C:\\Users\\Mini\\Vault\\extensions\\graphify\\runtime"',
      '& "C:\\Users\\Mini\\Vault\\extensions\\graphify\\runtime\\Scripts\\python.exe" -m pip install graphifyy',
    ]);
  });
});

describe('graphify project graph view model', () => {
  it('maps project graph states and build action availability', () => {
    expect(buildGraphifyProjectGraphViewModel({
      projectStatus: projectStatus({
        enabled: true,
        sourceRoot: null,
        buildEligible: false,
        buildBlockedReason: 'sourceRootRequired',
        uiState: 'sourceRootRequired',
        state: null,
      }),
    })).toMatchObject({
      state: 'sourceRootRequired',
      actions: {
        rebuild: { enabled: false },
      },
    });

    for (const freshness of ['queued', 'building', 'fresh', 'stale', 'failed'] as const) {
      const model = buildGraphifyProjectGraphViewModel({
        projectStatus: projectStatus({
          freshness,
          state: projectState({ freshness }),
        }),
        htmlArtifact: { status: 'available', path: 'C:/Vault/extensions/graphify/projects/the-vault/graphify-out/graph.html' },
        artifactUrl: 'vault-graphify://artifact?project=the-vault&artifact=graphHtml',
      });

      expect(model.state).toBe(freshness);
      expect(model.actions.rebuild.enabled).toBe(!['queued', 'building'].includes(freshness));
      expect(model.actions.fullRebuild.enabled).toBe(!['queued', 'building'].includes(freshness));
      expect(model.actions.semanticRebuild.enabled).toBe(false);
      expect(model.actions.openFolder.enabled).toBe(true);
      expect(model.actions.exportArtifacts.enabled).toBe(freshness === 'fresh' || freshness === 'stale');
      expect(model.actions.changeSourceRoot).toEqual({
        enabled: true,
        label: 'Change folder',
        reason: null,
      });
    }

    expect(buildGraphifyProjectGraphViewModel({
      projectStatus: projectStatus({
        enabled: false,
        buildEligible: false,
        buildBlockedReason: 'disabled',
        uiState: 'disabled',
        freshness: 'disabled',
        state: projectState({ enabled: false, freshness: 'disabled' }),
      }),
    })).toMatchObject({
      state: 'disabled',
      actions: {
        rebuild: { enabled: false },
        fullRebuild: { enabled: false },
        semanticRebuild: { enabled: false },
        changeSourceRoot: { enabled: false },
      },
    });
  });

  it('does not enable opening the artifact folder before artifacts exist', () => {
    const model = buildGraphifyProjectGraphViewModel({
      projectStatus: projectStatus({
        enabled: true,
        sourceRoot: null,
        buildEligible: false,
        buildBlockedReason: 'sourceRootRequired',
        uiState: 'sourceRootRequired',
        state: null,
      }),
      artifactDiscovery: missingArtifactDiscovery(),
    });

    expect(model.artifactRoot).toBe('C:/Vault/extensions/graphify/projects/the-vault/graphify-out');
    expect(model.actions.openFolder).toEqual({
      enabled: false,
      label: 'Open folder',
      reason: 'No graph artifact folder is available yet.',
    });
  });

  it('shows failed build detail and keeps stale graph opening available', () => {
    const failed = buildGraphifyProjectGraphViewModel({
      projectStatus: projectStatus({
        freshness: 'failed',
        state: projectState({
          freshness: 'failed',
          failureCount: 2,
          lastError: 'Graphify exited with code 1.',
        }),
      }),
      buildHistory: [
        {
          buildId: 'gb_the_vault_2',
          project: 'the-vault',
          status: 'failed',
          buildMode: 'fast',
          startedAt: timestamp,
          completedAt: timestamp,
          artifactPaths: null,
          graphStats: null,
          detectedGraphifyVersion: '0.8.17',
          logPath: 'C:/Vault/extensions/graphify/projects/the-vault/logs/gb_the_vault_2.log',
          errorMessage: 'Graphify exited with code 1.',
          createdAt: timestamp,
          updatedAt: timestamp,
        } satisfies GraphifyBuildRecord,
      ],
      htmlArtifact: { status: 'available', path: 'C:/Vault/extensions/graphify/projects/the-vault/graphify-out/graph.html' },
      artifactUrl: 'vault-graphify://artifact?project=the-vault&artifact=graphHtml',
    });

    expect(failed.failure).toEqual({
      message: 'Graphify exited with code 1.',
      logPath: 'C:/Vault/extensions/graphify/projects/the-vault/logs/gb_the_vault_2.log',
    });
    expect(failed.actions.openGraph.enabled).toBe(true);

    const stale = buildGraphifyProjectGraphViewModel({
      projectStatus: projectStatus({
        freshness: 'stale',
        state: projectState({ freshness: 'stale' }),
      }),
      htmlArtifact: { status: 'available', path: 'C:/Vault/extensions/graphify/projects/the-vault/graphify-out/graph.html' },
      artifactUrl: 'vault-graphify://artifact?project=the-vault&artifact=graphHtml',
    });

    expect(stale.warning).toContain('stale');
    expect(stale.actions.openGraph.enabled).toBe(true);
    expect(stale.embedUrl).toBe('vault-graphify://artifact?project=the-vault&artifact=graphHtml');
  });

  it('prefers the report fallback when Graphify builds graph.json without graph.html', () => {
    const model = buildGraphifyProjectGraphViewModel({
      projectStatus: projectStatus({
        freshness: 'fresh',
        state: projectState({
          artifactPaths: {
            graphJson: 'C:/Vault/extensions/graphify/projects/the-vault/graphify-out/graph.json',
            graphHtml: null,
            graphReport: 'C:/Vault/extensions/graphify/projects/the-vault/graphify-out/GRAPH_REPORT.md',
            graphSvg: null,
          },
          graphPath: 'C:/Vault/extensions/graphify/projects/the-vault/graphify-out/graph.json',
          htmlPath: null,
          reportPath: 'C:/Vault/extensions/graphify/projects/the-vault/graphify-out/GRAPH_REPORT.md',
        }),
      }),
      artifactDiscovery: {
        available: true,
        artifactRoot: 'C:/Vault/extensions/graphify/projects/the-vault/graphify-out',
        artifactPaths: {
          graphJson: 'C:/Vault/extensions/graphify/projects/the-vault/graphify-out/graph.json',
          graphHtml: null,
          graphReport: 'C:/Vault/extensions/graphify/projects/the-vault/graphify-out/GRAPH_REPORT.md',
          graphSvg: null,
        },
        graphStats: {
          nodeCount: 6072,
          edgeCount: 9828,
          communityCount: 0,
        },
        missingRequired: [],
        errorMessage: null,
      },
      htmlArtifact: {
        status: 'missing',
        path: 'C:/Vault/extensions/graphify/projects/the-vault/graphify-out/graph.html',
        fallback: {
          graphJson: 'C:/Vault/extensions/graphify/projects/the-vault/graphify-out/graph.json',
          graphReport: 'C:/Vault/extensions/graphify/projects/the-vault/graphify-out/GRAPH_REPORT.md',
        },
        message: 'graph.html is missing; use graph.json or GRAPH_REPORT.md until Graphify rebuilds the HTML artifact.',
      },
    });

    expect(model.preferredTab).toBe('report');
    expect(model.embedUrl).toBeNull();
    expect(model.reportPath).toBe('C:/Vault/extensions/graphify/projects/the-vault/graphify-out/GRAPH_REPORT.md');
    expect(model.actions.openReport.enabled).toBe(true);
    expect(model.actions.openGraph).toEqual({
      enabled: false,
      label: 'Open graph',
      reason: 'graph.html is missing; use the report fallback.',
    });
  });
});
