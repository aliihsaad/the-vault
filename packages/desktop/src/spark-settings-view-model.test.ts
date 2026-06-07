import { describe, expect, it } from 'vitest';

import {
  SPARK_SETTINGS_TABS,
  buildApproveSparkSuggestionAction,
  buildApproveSparkSkillAction,
  buildConfigureProviderAction,
  buildRejectSparkSuggestionAction,
  buildRejectSparkSkillAction,
  buildInstallSparkPackAction,
  buildUninstallSparkPackAction,
  buildSparkApprovalsModel,
  buildSparkEvolutionModel,
  buildSparkOverviewModel,
  buildSparkPacksModel,
  buildSparkProvidersModel,
  buildSparkSettingsStatusModel,
  buildSparkSkillsModel,
  buildToggleSparkExtensionAction,
  buildToggleSparkSkillAction,
  fetchSparkSettingsSnapshot,
  getNextSparkSettingsTabId,
  performSparkSettingsAction,
} from './spark-settings-view-model.js';
import type { SparkExtensionAction, SparkExtensionSnapshot } from '@the-vault/core';

describe('spark settings view model', () => {
  it('defines the Wave 2 local subnavigation placeholders in order', () => {
    expect(SPARK_SETTINGS_TABS.map((tab) => tab.label)).toEqual([
      'Overview',
      'Providers',
      'Skills',
      'Approvals',
      'Packs',
      'Brain',
      'Evolution',
    ]);

    expect(SPARK_SETTINGS_TABS.map((tab) => tab.id)).toEqual([
      'overview',
      'providers',
      'skills',
      'approvals',
      'packs',
      'brain',
      'evolution',
    ]);

    for (const tab of SPARK_SETTINGS_TABS) {
      expect(tab.panelId).toBe(`spark-settings-panel-${tab.id}`);
      expect(tab.tabId).toBe(`spark-settings-tab-${tab.id}`);
      expect(tab.placeholder).toContain('placeholder');
    }
  });

  it('moves tab focus with arrow, home, and end keys', () => {
    expect(getNextSparkSettingsTabId('overview', 'ArrowRight')).toBe('providers');
    expect(getNextSparkSettingsTabId('overview', 'ArrowLeft')).toBe('evolution');
    expect(getNextSparkSettingsTabId('providers', 'Home')).toBe('overview');
    expect(getNextSparkSettingsTabId('providers', 'End')).toBe('evolution');
    expect(getNextSparkSettingsTabId('providers', 'Enter')).toBe('providers');
  });

  it('unwraps successful window.sparkApi snapshot responses', async () => {
    const snapshot = makeSnapshot({
      status: {
        installState: 'ready',
        enabled: true,
        source: 'managed',
        version: '0.1.0',
        brainProject: 'Spark Brain',
        activeProviderId: 'openrouter',
        activeProviderMode: 'classic',
        message: 'Spark settings are ready.',
        installCommands: [],
        issues: [],
      },
    });

    await expect(fetchSparkSettingsSnapshot({
      getSnapshot: async () => ({ success: true, data: snapshot }),
    })).resolves.toEqual({
      snapshot,
      error: null,
    });
  });

  it('returns a stable error when snapshot loading fails', async () => {
    await expect(fetchSparkSettingsSnapshot({
      getSnapshot: async () => ({ success: false, error: 'Spark IPC failed' }),
    })).resolves.toEqual({
      snapshot: null,
      error: 'Spark IPC failed',
    });

    await expect(fetchSparkSettingsSnapshot({
      getSnapshot: async () => ({ success: true }),
    })).resolves.toEqual({
      snapshot: null,
      error: 'Spark settings snapshot was empty.',
    });
  });

  it('maps snapshot status into compact shell labels', () => {
    expect(buildSparkSettingsStatusModel(null)).toEqual({
      state: 'missing',
      primaryLabel: 'Spark settings unavailable',
      detail: 'Load the Spark extension snapshot to inspect settings state.',
      sourceLabel: 'unknown',
      versionLabel: 'not installed',
      enabledLabel: 'disabled',
      issueCount: 0,
      installCommands: [],
    });

    expect(buildSparkSettingsStatusModel(makeSnapshot())).toEqual({
      state: 'missing',
      primaryLabel: 'Spark missing',
      detail: 'Spark Brain is not connected to The Vault settings yet.',
      sourceLabel: 'not-installed',
      versionLabel: 'not installed',
      enabledLabel: 'disabled',
      issueCount: 0,
      installCommands: ['pnpm --filter @spark/brain install'],
    });

    expect(buildSparkSettingsStatusModel(makeSnapshot({
      status: {
        installState: 'degraded',
        enabled: true,
        source: 'local-source',
        version: '0.2.0',
        brainProject: 'Spark Brain',
        activeProviderId: 'openrouter',
        activeProviderMode: 'realtime',
        message: 'Provider health is degraded.',
        installCommands: [],
        issues: ['Realtime provider unavailable'],
      },
    }))).toEqual({
      state: 'degraded',
      primaryLabel: 'Spark degraded',
      detail: 'Provider health is degraded.',
      sourceLabel: 'local-source',
      versionLabel: '0.2.0',
      enabledLabel: 'enabled',
      issueCount: 1,
      installCommands: [],
    });
  });

  it('exposes Spark Brain install command previews from the status snapshot', () => {
    const status = buildSparkSettingsStatusModel(makeSnapshot({
      status: {
        installState: 'installable',
        enabled: false,
        source: 'managed',
        version: null,
        brainProject: 'Spark Brain',
        activeProviderId: null,
        activeProviderMode: null,
        message: 'Spark Brain can be installed from the workspace.',
        installCommands: ['pnpm --filter @spark/brain install'],
        issues: [],
      },
    }));

    expect(status.installCommands).toEqual(['pnpm --filter @spark/brain install']);
  });

  it('builds the Wave 3 overview model from the extension snapshot', () => {
    const overview = buildSparkOverviewModel(makeSnapshot({
      generatedAt: '2026-06-05T09:17:18.000Z',
      status: {
        installState: 'ready',
        enabled: true,
        source: 'managed',
        version: '0.3.0',
        brainProject: 'Spark Brain',
        activeProviderId: 'openrouter',
        activeProviderMode: 'realtime',
        message: 'Spark settings are ready.',
        installCommands: [],
        issues: ['Realtime provider fallback is visible.'],
      },
      providerHealth: {
        activeProviderId: 'openrouter',
        activeProviderMode: 'realtime',
        ready: 1,
        degraded: 1,
        unavailable: 1,
        unknown: 0,
        providers: [],
      },
      counts: {
        skills: 8,
        enabledSkills: 6,
        installedPacks: 2,
        pendingApprovals: 3,
        brainArtifacts: 6,
        staleBrainArtifacts: 1,
        ledgerSuggestions: 4,
        pendingLedgerSuggestions: 2,
      },
    }));

    expect(overview.installStatusLabel).toBe('Spark ready');
    expect(overview.extensionToggle).toEqual({
      enabled: true,
      label: 'Disable Spark',
      disabled: false,
      action: { type: 'toggle-extension', enabled: false },
    });
    expect(overview.brainProjectLink).toEqual({
      label: 'Spark Brain',
      href: '#vault-project-Spark%20Brain',
    });
    expect(overview.lastSyncLabel).toBe('Last sync 2026-06-05 09:17 UTC');
    expect(overview.healthSummary).toBe('1 healthy / 1 degraded / 1 unavailable providers');
    expect(overview.metrics).toContainEqual({ label: 'Pending approvals', value: '3' });
    expect(overview.metrics).toContainEqual({ label: 'Installed skills', value: '8' });
    expect(overview.metrics).toContainEqual({ label: 'Installed packs', value: '2' });
  });

  it('builds provider rows without carrying credential-bearing snapshot fields forward', () => {
    const providers = buildSparkProvidersModel(makeSnapshot({
      providerHealth: {
        activeProviderId: 'openrouter',
        activeProviderMode: 'realtime',
        ready: 1,
        degraded: 1,
        unavailable: 1,
        unknown: 0,
        providers: [
          {
            providerId: 'gemini',
            displayName: 'Gemini',
            enabled: true,
            credentialState: 'missing',
            aggregateHealth: 'unavailable',
            classic: {
              state: 'unavailable',
              message: 'apiKey gemini-secret should never render',
              checkedAt: null,
              latencyMs: null,
              lastRedactedError: 'apiKey gemini-secret should never render',
            },
            realtime: {
              state: 'unavailable',
              message: 'offline',
              checkedAt: null,
              latencyMs: null,
              lastRedactedError: null,
            },
            apiKey: 'gemini-secret',
          },
          {
            providerId: 'openrouter',
            displayName: 'OpenRouter',
            enabled: true,
            credentialState: 'configured',
            aggregateHealth: 'ready',
            classic: {
              state: 'ready',
              message: 'Classic ready.',
              checkedAt: '2026-06-05T09:10:00.000Z',
              latencyMs: 120,
              lastRedactedError: null,
            },
            realtime: {
              state: 'ready',
              message: 'Realtime ready.',
              checkedAt: '2026-06-05T09:15:00.000Z',
              latencyMs: 80,
              lastRedactedError: null,
            },
            secret: 'sk-live-openrouter',
          },
          {
            providerId: 'ollama',
            displayName: 'Ollama',
            enabled: false,
            credentialState: 'needsRefresh',
            aggregateHealth: 'degraded',
            classic: {
              state: 'degraded',
              message: 'Local endpoint slow.',
              checkedAt: '2026-06-05T09:08:00.000Z',
              latencyMs: 900,
              lastRedactedError: null,
            },
            realtime: {
              state: 'unavailable',
              message: 'Realtime unsupported.',
              checkedAt: null,
              latencyMs: null,
              lastRedactedError: null,
            },
          },
        ] as SparkExtensionSnapshot['providerHealth']['providers'],
      },
    }));

    expect(providers.rows.map((row) => row.name)).toEqual(['OpenRouter', 'Ollama', 'Gemini']);
    expect(providers.rows[0]).toMatchObject({
      providerId: 'openrouter',
      name: 'OpenRouter',
      health: 'healthy',
      healthLabel: 'Healthy',
      activeModeLabel: 'Realtime active',
      lastCheckedLabel: 'Last checked 2026-06-05 09:15 UTC',
      credentialIndicatorLabel: 'Key stored',
      configureAction: { type: 'configure-provider', providerId: 'openrouter' },
    });
    expect(providers.rows[1]).toMatchObject({
      providerId: 'ollama',
      health: 'degraded',
      activeModeLabel: 'Not active',
      credentialIndicatorLabel: 'Refresh key',
    });
    expect(providers.rows[2]).toMatchObject({
      providerId: 'gemini',
      health: 'unavailable',
      lastCheckedLabel: 'Not checked',
      credentialIndicatorLabel: 'Key missing',
    });

    const serializedModel = JSON.stringify(providers);
    expect(serializedModel).not.toContain('credentialState');
    expect(serializedModel).not.toContain('apiKey');
    expect(serializedModel).not.toContain('secret');
    expect(serializedModel).not.toContain('sk-live-openrouter');
    expect(serializedModel).not.toContain('gemini-secret');
    expect(serializedModel).not.toContain('lastRedactedError');
  });

  it('builds Wave 4 installed skill rows, catalog rows, and toggle actions from the snapshot', () => {
    const skills = buildSparkSkillsModel(makeSnapshot({
      skillStatus: {
        total: 2,
        enabled: 1,
        disabled: 1,
        locked: 0,
        pendingApproval: 0,
      },
      skills: [
        {
          skillId: 'vault-memory',
          name: 'Vault Memory',
          namespace: 'vault.native',
          source: 'vault-native',
          version: '1.0.0',
          enabled: true,
          packSource: 'Vault platform',
          permissions: ['vault:read', 'vault:write'],
          supportedTools: ['vault_recall_context', 'vault_save_memory'],
          outputContracts: ['memory-pack'],
          hasExecutableRegistration: true,
          health: 'ready',
          lockedReason: null,
        },
        {
          skillId: 'ops-meeting-notes',
          name: 'Meeting Notes',
          namespace: 'operations',
          source: 'pack',
          version: null,
          enabled: false,
          packSource: 'Operations Pack',
          permissions: [],
          supportedTools: [],
          outputContracts: ['summary'],
          hasExecutableRegistration: false,
          health: 'unknown',
          lockedReason: null,
        },
      ] as SparkExtensionSnapshot['skills'],
      skillCatalog: [
        {
          skillId: 'vault-memory',
          name: 'Vault Memory',
          namespace: 'vault.native',
          source: 'vault-native',
          version: '1.0.0',
          packSource: 'Vault platform',
          permissions: ['vault:read'],
          supportedTools: ['vault_recall_context'],
          outputContracts: ['memory-pack'],
          hasExecutableRegistration: true,
          category: 'Vault Native',
          description: 'Installed platform skill.',
        },
        {
          skillId: 'architecture-reviewer',
          name: 'Architecture Reviewer',
          namespace: 'architecture',
          source: 'pack',
          version: '0.4.0',
          packSource: 'Architecture Pack',
          permissions: ['repo:read'],
          supportedTools: [],
          outputContracts: ['review-notes'],
          hasExecutableRegistration: false,
          category: 'Architecture',
          description: 'Catalog-only review helper.',
        },
      ] as SparkExtensionSnapshot['skillCatalog'],
    }));

    expect(skills.summaryLabel).toBe('1 enabled / 1 disabled / 0 locked skills');
    expect(skills.installedRows).toHaveLength(2);
    expect(skills.installedRows[0]).toMatchObject({
      skillId: 'vault-memory',
      name: 'Vault Memory',
      namespace: 'vault.native',
      versionLabel: '1.0.0',
      stateLabel: 'Enabled',
      packSourceLabel: 'Vault platform',
      permissionsSummary: 'vault:read, vault:write',
      executionLabel: 'Executable',
      toggleLabel: 'Disable',
      toggleDisabled: false,
      toggleAction: { type: 'toggle-skill', skillId: 'vault-memory', enabled: false },
    });
    expect(skills.installedRows[1]).toMatchObject({
      skillId: 'ops-meeting-notes',
      versionLabel: 'unversioned',
      stateLabel: 'Disabled',
      permissionsSummary: 'No extra permissions',
      executionLabel: 'Discovery-only',
      toggleDisabled: true,
      toggleAction: null,
      lockedReasonLabel: 'Discovery-only until executable registration is available.',
    });
    expect(skills.catalogRows.map((row) => row.skillId)).toEqual(['architecture-reviewer']);
    expect(skills.catalogRows[0]).toMatchObject({
      name: 'Architecture Reviewer',
      namespace: 'architecture',
      versionLabel: '0.4.0',
      packSourceLabel: 'Architecture Pack',
      permissionsSummary: 'repo:read',
      executionLabel: 'Discovery-only',
    });
    expect(buildToggleSparkSkillAction('vault-memory', false)).toEqual({
      type: 'toggle-skill',
      skillId: 'vault-memory',
      enabled: false,
    });
  });

  it('builds Wave 5 pending approval rows and approve/reject actions from the snapshot', () => {
    const approvals = buildSparkApprovalsModel(makeSnapshot({
      approvals: {
        pending: 2,
        skillProposals: 2,
        evolutionSuggestions: 0,
      },
      counts: {
        skills: 8,
        enabledSkills: 6,
        installedPacks: 2,
        pendingApprovals: 2,
        brainArtifacts: 6,
        staleBrainArtifacts: 1,
        ledgerSuggestions: 4,
        pendingLedgerSuggestions: 2,
      },
      pendingApprovals: [
        {
          proposalId: 'proposal-low',
          skillName: 'Meeting Notes',
          purpose: 'Summarize recurring meeting workflows.',
          requiredPermissions: ['vault:read'],
          riskLevel: 'low',
        },
        {
          proposalId: 'proposal-critical',
          skillName: 'Release Executor',
          purpose: 'Runs release workflow commands after approval.',
          requiredPermissions: ['repo:write', 'process:execute'],
          riskLevel: 'critical',
        },
      ] as SparkExtensionSnapshot['pendingApprovals'],
    }));

    expect(approvals.summaryLabel).toBe('2 pending skill approvals');
    expect(approvals.emptyLabel).toBe('No pending Skill Creator approvals.');
    expect(approvals.rows.map((row) => row.proposalId)).toEqual(['proposal-critical', 'proposal-low']);
    expect(approvals.rows[0]).toMatchObject({
      proposalId: 'proposal-critical',
      skillName: 'Release Executor',
      purpose: 'Runs release workflow commands after approval.',
      requiredPermissionsSummary: 'repo:write, process:execute',
      riskLabel: 'Critical risk',
      riskClassName: 'spark-approval-risk-critical',
      highRisk: true,
      approveAction: { type: 'approve-skill', proposalId: 'proposal-critical' },
      rejectAction: {
        type: 'reject-skill',
        proposalId: 'proposal-critical',
        reason: 'Rejected from Spark settings approvals queue.',
      },
    });
    expect(approvals.rows[1]).toMatchObject({
      proposalId: 'proposal-low',
      requiredPermissionsSummary: 'vault:read',
      riskLabel: 'Low risk',
      highRisk: false,
    });
    expect(buildApproveSparkSkillAction('proposal-low')).toEqual({
      type: 'approve-skill',
      proposalId: 'proposal-low',
    });
    expect(buildRejectSparkSkillAction('proposal-low')).toEqual({
      type: 'reject-skill',
      proposalId: 'proposal-low',
      reason: 'Rejected from Spark settings approvals queue.',
    });
  });

  it('builds Wave 6 capability pack rows and install/uninstall actions from the snapshot', () => {
    const packs = buildSparkPacksModel(makeSnapshot({
      capabilityPacks: [
        {
          packId: 'research',
          name: 'Research',
          description: 'Research workflow helpers for literature review and source synthesis.',
          installed: true,
          includedSkills: ['literature-review', 'source-synthesis'],
        },
        {
          packId: 'operations',
          name: 'Operations',
          description: 'Operational runbook and incident support.',
          installed: false,
          includedSkills: ['runbook-writer'],
        },
      ],
      packStatus: {
        total: 2,
        installed: 1,
        updateAvailable: 0,
      },
    } as Partial<SparkExtensionSnapshot>));

    expect(packs.summaryLabel).toBe('1 installed / 1 available packs');
    expect(packs.emptyLabel).toBe('No Spark capability packs are available yet.');
    expect(packs.rows.map((row) => row.packId)).toEqual(['research', 'operations']);
    expect(packs.rows[0]).toMatchObject({
      packId: 'research',
      name: 'Research',
      description: 'Research workflow helpers for literature review and source synthesis.',
      includedSkillsCountLabel: '2 skills',
      statusLabel: 'Installed',
      actionLabel: 'Uninstall',
      actionClassName: 'danger-button',
      action: { type: 'uninstall-pack', packId: 'research' },
      includedSkills: ['literature-review', 'source-synthesis'],
    });
    expect(packs.rows[1]).toMatchObject({
      packId: 'operations',
      includedSkillsCountLabel: '1 skill',
      statusLabel: 'Available',
      actionLabel: 'Install',
      actionClassName: 'primary-button',
      action: { type: 'install-pack', packId: 'operations' },
      includedSkills: ['runbook-writer'],
    });
    expect(buildInstallSparkPackAction('operations')).toEqual({
      type: 'install-pack',
      packId: 'operations',
    });
    expect(buildUninstallSparkPackAction('research')).toEqual({
      type: 'uninstall-pack',
      packId: 'research',
    });
  });

  it('builds Wave 8 evolution suggestion rows and approve/reject actions from the snapshot', () => {
    const evolution = buildSparkEvolutionModel(makeSnapshot({
      approvals: {
        pending: 3,
        skillProposals: 0,
        evolutionSuggestions: 3,
      },
      ledgerSuggestions: {
        total: 4,
        pending: 3,
        approved: 0,
        rejected: 1,
        deferred: 0,
        superseded: 0,
      },
      counts: {
        skills: 8,
        enabledSkills: 6,
        installedPacks: 2,
        pendingApprovals: 3,
        brainArtifacts: 6,
        staleBrainArtifacts: 1,
        ledgerSuggestions: 4,
        pendingLedgerSuggestions: 3,
      },
      evolutionSuggestions: [
        {
          suggestionId: 'suggestion-skill',
          type: 'new-skill',
          description: 'Promote repeated release handoff cleanup into a reusable Spark skill.',
          confidenceLevel: 'high',
        },
        {
          suggestionId: 'suggestion-pack',
          type: 'new-pack',
          description: 'Install the Architecture pack for recurring design review workflows.',
          confidenceLevel: 'medium',
        },
        {
          suggestionId: 'suggestion-api',
          type: 'missing-api',
          description: 'Add a bounded provider API handoff for realtime diagnostics.',
          confidenceLevel: 'high',
        },
      ],
    }));

    expect(evolution.summaryLabel).toBe('3 pending Self Evolution suggestions / 2 high confidence');
    expect(evolution.emptyLabel).toBe('No pending Self Evolution suggestions.');
    expect(evolution.rows.map((row) => row.suggestionId)).toEqual([
      'suggestion-skill',
      'suggestion-api',
      'suggestion-pack',
    ]);
    expect(evolution.rows[0]).toMatchObject({
      suggestionId: 'suggestion-skill',
      typeLabel: 'New skill',
      description: 'Promote repeated release handoff cleanup into a reusable Spark skill.',
      confidenceLabel: 'High confidence',
      confidenceClassName: 'spark-evolution-confidence-high',
      highConfidence: true,
      approveAction: {
        type: 'approve-suggestion',
        suggestionId: 'suggestion-skill',
        routeTarget: 'skill-creator',
      },
      rejectAction: {
        type: 'reject-suggestion',
        suggestionId: 'suggestion-skill',
        reason: 'Rejected from Spark settings evolution suggestions.',
      },
    });
    expect(evolution.rows[1]).toMatchObject({
      suggestionId: 'suggestion-api',
      typeLabel: 'Missing API',
      confidenceLabel: 'High confidence',
      highConfidence: true,
      approveAction: {
        type: 'approve-suggestion',
        suggestionId: 'suggestion-api',
        routeTarget: 'provider-config',
      },
    });
    expect(evolution.rows[2]).toMatchObject({
      suggestionId: 'suggestion-pack',
      typeLabel: 'New pack',
      confidenceLabel: 'Medium confidence',
      highConfidence: false,
      approveAction: {
        type: 'approve-suggestion',
        suggestionId: 'suggestion-pack',
        routeTarget: 'capability-pack',
      },
    });
    expect(buildApproveSparkSuggestionAction('suggestion-skill', 'skill-creator')).toEqual({
      type: 'approve-suggestion',
      suggestionId: 'suggestion-skill',
      routeTarget: 'skill-creator',
    });
    expect(buildRejectSparkSuggestionAction('suggestion-skill')).toEqual({
      type: 'reject-suggestion',
      suggestionId: 'suggestion-skill',
      reason: 'Rejected from Spark settings evolution suggestions.',
    });
  });

  it('dispatches safe Spark settings actions through the renderer bridge', async () => {
    const calls: SparkExtensionAction[] = [];
    const actionResult = await performSparkSettingsAction({
      getSnapshot: async () => ({ success: true, data: makeSnapshot() }),
      executeAction: async (input) => {
        calls.push(input);
        return {
          success: true,
          data: {
            ok: false,
            actionType: input.type,
            reason: 'not_implemented',
            message: 'Spark extension settings actions are not wired to Spark Brain yet.',
          },
        };
      },
    }, buildConfigureProviderAction('openrouter'));

    expect(calls).toEqual([{ type: 'configure-provider', providerId: 'openrouter' }]);
    expect(actionResult.error).toBeNull();
    expect(actionResult.result?.actionType).toBe('configure-provider');
    expect(buildToggleSparkExtensionAction(false)).toEqual({ type: 'toggle-extension', enabled: false });
  });
});

function makeSnapshot(overrides: Partial<SparkExtensionSnapshot> = {}): SparkExtensionSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: '2026-06-05T09:00:00.000Z',
    status: {
      installState: 'missing',
      enabled: false,
      source: 'not-installed',
      version: null,
      brainProject: null,
      activeProviderId: null,
      activeProviderMode: null,
      message: 'Spark Brain is not connected to The Vault settings yet.',
      installCommands: ['pnpm --filter @spark/brain install'],
      issues: [],
    },
    providerHealth: {
      activeProviderId: null,
      activeProviderMode: null,
      ready: 0,
      degraded: 0,
      unavailable: 0,
      unknown: 0,
      providers: [],
    },
    skillStatus: {
      total: 0,
      enabled: 0,
      disabled: 0,
      locked: 0,
      pendingApproval: 0,
    },
    skills: [],
    skillCatalog: [],
    pendingApprovals: [],
    capabilityPacks: [],
    evolutionSuggestions: [],
    packStatus: {
      total: 0,
      installed: 0,
      updateAvailable: 0,
    },
    approvals: {
      pending: 0,
      skillProposals: 0,
      evolutionSuggestions: 0,
    },
    brainArtifacts: {
      fresh: 0,
      stale: 0,
      missing: 0,
      latestGeneratedAt: null,
      artifacts: [],
    },
    ledgerSuggestions: {
      total: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      deferred: 0,
      superseded: 0,
    },
    counts: {
      skills: 0,
      enabledSkills: 0,
      installedPacks: 0,
      pendingApprovals: 0,
      brainArtifacts: 0,
      staleBrainArtifacts: 0,
      ledgerSuggestions: 0,
      pendingLedgerSuggestions: 0,
    },
    ...overrides,
  };
}
