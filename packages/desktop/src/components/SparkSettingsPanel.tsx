import type { KeyboardEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import {
  getNextSparkSettingsTabId,
  useSparkSettingsViewModel,
  type SparkSettingsTabId,
} from '../spark-settings-view-model.js';
import { OverviewTab } from './spark/OverviewTab.js';
import { ProvidersTab } from './spark/ProvidersTab.js';
import { SkillsTab } from './spark/SkillsTab.js';
import { ApprovalsTab } from './spark/ApprovalsTab.js';
import { PacksTab } from './spark/PacksTab.js';
import { BrainTab } from './spark/BrainTab.js';
import { EvolutionTab } from './spark/EvolutionTab.js';

interface SparkSettingsPanelProps {
  copyText: (token: string, value: string, successMessage?: string) => Promise<void>;
  copiedToken: string | null;
}

export function SparkSettingsPanel({ copyText, copiedToken }: SparkSettingsPanelProps) {
  const {
    activeTab,
    activeTabId,
    tabs,
    setActiveTabId,
    snapshot,
    status,
    overview,
    providerRegistry,
    skills,
    approvals,
    packs,
    brain,
    evolution,
    loading,
    error,
    actionError,
    pendingAction,
    actionPendingProviderId,
    actionPendingRole,
    actionPendingSkillId,
    actionPendingApprovalId,
    actionPendingPackId,
    actionPendingSuggestionId,
    refresh,
    toggleExtension,
    configureProviderCredential,
    assignRole,
    toggleSkill,
    approveSkill,
    rejectSkill,
    installPack,
    uninstallPack,
    approveSuggestion,
    rejectSuggestion,
  } = useSparkSettingsViewModel();
  const StateIcon = getSparkStateIcon(Boolean(error), status.state);

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const nextTabId = getNextSparkSettingsTabId(activeTabId, event.key);
    if (nextTabId === activeTabId) {
      return;
    }

    event.preventDefault();
    setActiveTabId(nextTabId);
    focusSparkTab(nextTabId);
  }

  return (
    <section className="panel settings-section graphify-settings-panel spark-settings-panel" aria-labelledby="spark-settings-title">
      <div className="panel-header">
        <div>
          <div className="panel-title" id="spark-settings-title">Spark</div>
          <div className="panel-subtitle">Extension settings shell and local navigation.</div>
        </div>
        <Sparkles size={18} className="panel-icon" />
      </div>

      <div className={`graphify-status-card spark-settings-status-card spark-settings-status-card-${status.state}`}>
        <div className="graphify-status-main">
          <span className="graphify-status-icon">
            <StateIcon size={18} />
          </span>
          <div>
            <strong>{loading ? 'Loading Spark settings' : status.primaryLabel}</strong>
            <p>{loading ? 'Reading the Spark extension snapshot.' : status.detail}</p>
          </div>
        </div>
        <div className="graphify-status-meta">
          <span>{status.sourceLabel}</span>
          <strong>{status.versionLabel}</strong>
          <span>{status.enabledLabel}</span>
        </div>
      </div>

      {error ? (
        <div className="note-card note-card-warning">
          <p>{error}</p>
        </div>
      ) : null}

      {actionError ? (
        <div className="note-card note-card-warning">
          <p>{actionError}</p>
        </div>
      ) : null}

      {status.installCommands.length > 0 ? (
        <div className="snippet-card">
          <div className="snippet-head">
            <div>
              <div className="field-label">Install preview</div>
              <div className="field-help">Vault shows commands before any install and never silently installs Spark Brain.</div>
            </div>
            <button
              type="button"
              className="header-button"
              onClick={() => void copyText('spark-install-plan', status.installCommands.join('\n'))}
              disabled={status.installCommands.length === 0}
              title="Copy Spark Brain install commands"
            >
              <Copy size={16} />
              <span>{copiedToken === 'spark-install-plan' ? 'Copied' : 'Copy install commands'}</span>
            </button>
          </div>
          <pre className="snippet-block">{status.installCommands.join('\n')}</pre>
        </div>
      ) : null}

      <div className="spark-settings-toolbar">
        <div className="spark-settings-toolbar-copy">
          <span className="field-label">Spark settings</span>
          <span className="field-help">
            {snapshot
              ? `${status.issueCount} issue${status.issueCount === 1 ? '' : 's'} reported by the current snapshot.`
              : 'Snapshot data is not available yet.'}
          </span>
        </div>
        <button type="button" className="header-button" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw size={16} />
          <span>{loading ? 'Loading...' : 'Refresh'}</span>
        </button>
      </div>

      <div className="spark-settings-tabs" role="tablist" aria-label="Spark settings sections">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            id={tab.tabId}
            type="button"
            className={`spark-settings-tab ${tab.id === activeTabId ? 'spark-settings-tab-active' : ''}`}
            role="tab"
            aria-selected={tab.id === activeTabId}
            aria-controls={tab.panelId}
            tabIndex={tab.id === activeTabId ? 0 : -1}
            onClick={() => setActiveTabId(tab.id)}
            onKeyDown={handleTabKeyDown}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        id={activeTab.panelId}
        className={activeTab.id === 'overview'
          || activeTab.id === 'providers'
          || activeTab.id === 'skills'
          || activeTab.id === 'approvals'
          || activeTab.id === 'packs'
          || activeTab.id === 'brain'
          || activeTab.id === 'evolution'
          ? 'spark-settings-tab-panel'
          : 'spark-settings-placeholder'}
        role="tabpanel"
        aria-labelledby={activeTab.tabId}
        tabIndex={0}
      >
        {activeTab.id === 'overview' ? (
          <OverviewTab
            model={overview}
            actionPending={pendingAction === 'toggle-extension'}
            onToggleEnabled={() => void toggleExtension()}
          />
        ) : activeTab.id === 'providers' ? (
          <ProvidersTab
            model={providerRegistry}
            providerPending={actionPendingProviderId}
            roleAssignmentPending={actionPendingRole}
            onConfigureProvider={(providerId, key, baseUrl) => void configureProviderCredential(providerId, key, baseUrl)}
            onAssignRole={(role, providerId) => void assignRole(role, providerId)}
            error={actionError}
          />
        ) : activeTab.id === 'skills' ? (
          <SkillsTab
            model={skills}
            actionPendingSkillId={actionPendingSkillId}
            onToggleSkill={(skillId) => void toggleSkill(skillId)}
          />
        ) : activeTab.id === 'approvals' ? (
          <ApprovalsTab
            model={approvals}
            actionPendingApprovalId={actionPendingApprovalId}
            onApproveSkill={(proposalId) => void approveSkill(proposalId)}
            onRejectSkill={(proposalId) => void rejectSkill(proposalId)}
          />
        ) : activeTab.id === 'packs' ? (
          <PacksTab
            model={packs}
            actionPendingPackId={actionPendingPackId}
            onInstallPack={(packId) => void installPack(packId)}
            onUninstallPack={(packId) => void uninstallPack(packId)}
          />
        ) : activeTab.id === 'brain' ? (
          <BrainTab model={brain} />
        ) : activeTab.id === 'evolution' ? (
          <EvolutionTab
            model={evolution}
            actionPendingSuggestionId={actionPendingSuggestionId}
            onApproveSuggestion={(suggestionId) => void approveSuggestion(suggestionId)}
            onRejectSuggestion={(suggestionId) => void rejectSuggestion(suggestionId)}
          />
        ) : (
          <>
            <div className="field-label">{activeTab.label}</div>
            <p>{activeTab.placeholder}</p>
          </>
        )}
      </div>
    </section>
  );
}

function getSparkStateIcon(hasError: boolean, state: string) {
  if (hasError || state === 'failed' || state === 'degraded') {
    return AlertTriangle;
  }

  if (state === 'ready') {
    return CheckCircle2;
  }

  return Sparkles;
}

function focusSparkTab(tabId: SparkSettingsTabId) {
  if (typeof document === 'undefined') {
    return;
  }

  window.requestAnimationFrame(() => {
    document.getElementById(`spark-settings-tab-${tabId}`)?.focus();
  });
}
