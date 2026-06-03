import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

import {
  buildVaultCollabDashboardViewModel,
  type VaultCollabPolicyPackRow,
} from '../vault-collab-view-model.js';
import { EventFeed } from './vault-collab/EventFeed.js';
import { EventRegistry } from './vault-collab/EventRegistry.js';
import { NeedsYou } from './vault-collab/NeedsYou.js';
import { PolicyPanel } from './vault-collab/PolicyPanel.js';
import { Roster } from './vault-collab/Roster.js';
import { useVaultCollabActions } from './vault-collab/useVaultCollabActions.js';
import { WorkBoard } from './vault-collab/WorkBoard.js';

type VaultCollabSnapshot = NonNullable<Awaited<ReturnType<typeof window.vaultAPI.getVaultCollabDashboardSnapshot>>['data']>;
type VaultCollabEventTypes = NonNullable<Awaited<ReturnType<typeof window.vaultAPI.listVaultCollabEventTypes>>['data']>;

interface VaultCollabViewProps {
  vaultStatus: VaultStatus | null;
}

interface RequestAgentProjectOption {
  project: string;
  workspacePath: string;
}

type VaultCollabCockpitTabId = 'work' | 'agents' | 'events' | 'policy' | 'registry';

export function VaultCollabView({ vaultStatus }: VaultCollabViewProps) {
  const [snapshot, setSnapshot] = useState<VaultCollabSnapshot | null>(null);
  const [eventTypes, setEventTypes] = useState<VaultCollabEventTypes>([]);
  const [projectWorkspaces, setProjectWorkspaces] = useState<ProjectWorkspaceConfig[]>([]);
  const [selectedHandoffUid, setSelectedHandoffUid] = useState<string | null>(null);
  const [selectedRoleProfileId, setSelectedRoleProfileId] = useState<string | null>(null);
  const [selectedEventTypePrefix, setSelectedEventTypePrefix] = useState('session.');
  const [activeCockpitTab, setActiveCockpitTab] = useState<VaultCollabCockpitTabId>('work');
  const [policyBusyUid, setPolicyBusyUid] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dashboardSessionUid, setDashboardSessionUid] = useState<string | null>(null);
  const [discussionDraft, setDiscussionDraft] = useState('');
  const [approvedLaunchCommands, setApprovedLaunchCommands] = useState<Record<string, string>>({});

  useEffect(() => {
    void loadDashboard();
    const refresh = window.setInterval(() => void loadDashboard(true), 15000);
    return () => window.clearInterval(refresh);
  }, []);

  useEffect(() => {
    if (!selectedHandoffUid) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const response = await window.vaultAPI.getVaultCollabHandoffActions(selectedHandoffUid);
      if (!cancelled && response.success && response.data) {
        setDashboardSessionUid(response.data.actingSessionUid);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedHandoffUid]);

  const model = useMemo(
    () => snapshot
      ? buildVaultCollabDashboardViewModel(snapshot, lastLoadedAt ?? new Date(), selectedHandoffUid, {
        approvedLaunchCommands,
        dashboardSessionUid,
        eventTypePrefix: selectedEventTypePrefix,
        eventTypes,
        selectedRoleProfileId,
      })
      : null,
    [approvedLaunchCommands, dashboardSessionUid, eventTypes, lastLoadedAt, selectedEventTypePrefix, selectedHandoffUid, selectedRoleProfileId, snapshot],
  );

  const requestAgentProjectOptions = useMemo<RequestAgentProjectOption[]>(() => {
    const options = new Map<string, RequestAgentProjectOption>();

    for (const project of vaultStatus?.projects ?? []) {
      options.set(project.name, { project: project.name, workspacePath: '' });
    }

    for (const workspace of projectWorkspaces) {
      options.set(workspace.project, {
        project: workspace.project,
        workspacePath: workspace.workspacePath,
      });
    }

    return Array.from(options.values()).sort((left, right) => left.project.localeCompare(right.project));
  }, [projectWorkspaces, vaultStatus?.projects]);

  const requestAgentDefault = useMemo(() => {
    const activeWorkspaceRoot = normalizeWorkspacePath(vaultStatus?.workspaceRoot ?? '');
    const activeWorkspace = activeWorkspaceRoot
      ? requestAgentProjectOptions.find((option) => normalizeWorkspacePath(option.workspacePath) === activeWorkspaceRoot)
      : null;
    const mappedWorkspace = activeWorkspace
      ?? requestAgentProjectOptions.find((option) => option.workspacePath.trim().length > 0);

    return {
      defaultProject: mappedWorkspace?.project ?? '',
      defaultWorkspacePath: mappedWorkspace?.workspacePath ?? '',
    };
  }, [requestAgentProjectOptions, vaultStatus?.workspaceRoot]);

  const actions = useVaultCollabActions({
    discussionDraft,
    loadDashboard,
    selectedHandoff: model?.cockpit.selectedHandoff ?? null,
    setApprovedLaunchCommands,
    setDashboardSessionUid,
    setDiscussionDraft,
  });

  async function loadDashboard(silent = false) {
    if (!silent) {
      setLoading(true);
    }
    setError(null);

    try {
      const [response, workspacesResponse, eventTypesResponse] = await Promise.all([
        window.vaultAPI.getVaultCollabDashboardSnapshot({
          eventLimit: 48,
          handoffLimit: 40,
          launchRequestLimit: 24,
          sessionLimit: 32,
        }),
        window.vaultAPI.listProjectWorkspaces(),
        window.vaultAPI.listVaultCollabEventTypes(),
      ]);

      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to load Vault Collab dashboard data');
      }

      setSnapshot(response.data);
      if (workspacesResponse.success) {
        setProjectWorkspaces(workspacesResponse.data ?? []);
      }
      setEventTypes(eventTypesResponse.success ? eventTypesResponse.data ?? [] : []);
      setLastLoadedAt(new Date());
      setSelectedHandoffUid((current) => {
        if (response.data!.handoffs.length === 0) {
          return null;
        }

        return current && response.data!.handoffs.some((handoff) => handoff.handoffUid === current)
          ? current
          : response.data!.handoffs[0].handoffUid;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Vault Collab dashboard data');
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }

  async function togglePolicyPack(pack: VaultCollabPolicyPackRow) {
    setPolicyBusyUid(pack.uid);
    setError(null);

    try {
      const response = pack.toggleAction === 'activate'
        ? await window.vaultAPI.activateVaultCollabPolicyPack({ uid: pack.uid })
        : await window.vaultAPI.deactivateVaultCollabPolicyPack({ uid: pack.uid });
      if (!response.success) {
        throw new Error(response.error || 'Policy pack update failed');
      }

      await loadDashboard(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Policy pack update failed');
    } finally {
      setPolicyBusyUid(null);
    }
  }

  const needsYou = model?.dataReady ? (
    <NeedsYou
      items={model.cockpit.needsYou}
      launchRequests={model.launchRequestRows}
      actionBusy={actions.actionBusy}
      projectOptions={requestAgentProjectOptions}
      defaultProject={requestAgentDefault.defaultProject}
      defaultWorkspacePath={requestAgentDefault.defaultWorkspacePath}
      onRequestAgent={(input) => void actions.requestAgent(input)}
      onLaunchAction={(action, uid) => void actions.runLaunchAction(action, uid)}
      onHandoffAction={(action, uid) => void actions.runHandoffAction(action, uid)}
      onCopyLaunchCommand={(uid, command) => void actions.copyLaunchCommand(uid, command)}
    />
  ) : null;

  const cockpitTabs = model?.dataReady ? [
    {
      id: 'work' as const,
      label: 'Work',
      count: model.cockpit.work.reduce((total, column) => total + column.cards.length, 0),
    },
    {
      id: 'agents' as const,
      label: 'Agents',
      count: model.cockpit.officeGroups.reduce((total, group) => total + group.agents.length, 0),
    },
    {
      id: 'events' as const,
      label: 'Events',
      count: model.cockpit.eventFeed.visibleEvents.length,
    },
    {
      id: 'policy' as const,
      label: 'Policy',
      count: model.cockpit.policyPanel.packs.length,
    },
    {
      id: 'registry' as const,
      label: 'Registry',
      count: model.cockpit.eventRegistry.totalCount,
    },
  ] : [];

  return (
    <div className="vault-collab-dashboard">
      <div className="vault-collab-dashboard-top">
        <div className={`vault-collab-ops-bar ${model?.attentionActive ? 'vault-collab-ops-bar-attention' : ''}`}>
          <div className="vault-collab-ops-state">
            <span className={`status-dot ${model?.dataReady ? 'status-dot-online' : 'status-dot-warning'}`} />
            <div>
              <strong>{loading && !model ? 'Loading' : model?.statusLabel ?? 'Unavailable'}</strong>
              <span>{model?.message ?? 'Reading Vault Collab dashboard state.'}</span>
            </div>
          </div>

          <div className="vault-collab-ops-items" aria-label="Vault Collab status">
            {(model?.statusItemModels ?? [
              { label: 'Loading', tone: 'muted' as const },
              { label: 'Reading dashboard', tone: 'muted' as const },
            ]).map((item) => (
              <span key={item.label} className={`vault-collab-ops-item vault-collab-ops-item-${item.tone}`}>
                {item.label}
              </span>
            ))}
          </div>

          <button
            type="button"
            className="header-button icon-only-button"
            onClick={() => void loadDashboard()}
            disabled={loading}
            title={loading ? 'Refreshing' : 'Refresh Vault Collab'}
          >
            <RefreshCw size={16} />
          </button>
        </div>

        {error ? <span className="error-text">{error}</span> : null}
        {actions.actionError ? <span className="error-text">{actions.actionError}</span> : null}
        {actions.actionNotice ? <span className="success-text">{actions.actionNotice}</span> : null}
        {needsYou}
      </div>

      {loading && !model ? (
        <div className="empty-state">Loading Vault Collab dashboard...</div>
      ) : model ? (
        !model.dataReady ? (
          <section className="vault-collab-unavailable">
            <div className="detail-section-title">
              <AlertTriangle size={16} />
              <span>Dashboard data unavailable</span>
            </div>
            <p>Vault Collab is configured at <span className="text-mono">{model.databasePath}</span>.</p>
            {model.errorMessage ? <p>{model.errorMessage}</p> : null}
          </section>
        ) : (
          <section className="vault-collab-cockpit-shell" aria-label="Vault Collab cockpit">
            <div className="vault-collab-cockpit-tabs" role="tablist" aria-label="Vault Collab sections">
              {cockpitTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`vault-collab-cockpit-tab ${activeCockpitTab === tab.id ? 'vault-collab-cockpit-tab-active' : ''}`}
                  role="tab"
                  aria-selected={activeCockpitTab === tab.id}
                  aria-controls={`vault-collab-tab-${tab.id}`}
                  onClick={() => setActiveCockpitTab(tab.id)}
                >
                  <span>{tab.label}</span>
                  <strong>{tab.count}</strong>
                </button>
              ))}
            </div>
            <div
              id={`vault-collab-tab-${activeCockpitTab}`}
              className="vault-collab-cockpit-tab-panel"
              role="tabpanel"
            >
              {activeCockpitTab === 'agents' ? (
                <Roster
                  groups={model.cockpit.officeGroups}
                  selectedRoleProfile={model.cockpit.selectedRoleProfile}
                  selectedRoleProfileId={selectedRoleProfileId ?? model.cockpit.selectedRoleProfile?.roleProfileId ?? null}
                  onSelectRoleProfile={setSelectedRoleProfileId}
                />
              ) : null}
              {activeCockpitTab === 'work' ? (
                <WorkBoard
                  columns={model.cockpit.work}
                  selectedHandoffUid={model.cockpit.selectedHandoff?.uid ?? null}
                  selectedHandoff={model.cockpit.selectedHandoff}
                  conversation={model.cockpit.conversation}
                  discussionDraft={discussionDraft}
                  discussionDisabled={Boolean(actions.actionBusy) || !model.cockpit.selectedHandoff}
                  onSelectHandoff={setSelectedHandoffUid}
                  onDiscussionDraftChange={setDiscussionDraft}
                  onDiscussionSubmit={() => void actions.runDiscussionAction()}
                />
              ) : null}
              {activeCockpitTab === 'events' ? (
                <EventFeed
                  feed={model.cockpit.eventFeed}
                  selectedPrefix={selectedEventTypePrefix}
                  onPrefixChange={setSelectedEventTypePrefix}
                />
              ) : null}
              {activeCockpitTab === 'policy' ? (
                <PolicyPanel
                  panel={model.cockpit.policyPanel}
                  busyUid={policyBusyUid}
                  onTogglePack={(pack) => void togglePolicyPack(pack)}
                />
              ) : null}
              {activeCockpitTab === 'registry' ? <EventRegistry registry={model.cockpit.eventRegistry} /> : null}
            </div>
          </section>
        )
      ) : (
        <div className="empty-state">Vault Collab dashboard data is unavailable.</div>
      )}
    </div>
  );
}

function normalizeWorkspacePath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLocaleLowerCase();
}
