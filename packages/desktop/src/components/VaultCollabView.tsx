import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  CheckCircle2,
  Clock3,
  Inbox,
  Link2,
  MessageSquareText,
  RefreshCw,
  Rocket,
  Tag,
  Users,
} from 'lucide-react';

import { buildVaultCollabDashboardViewModel } from '../vault-collab-view-model.js';

type VaultCollabSnapshot = NonNullable<Awaited<ReturnType<typeof window.vaultAPI.getVaultCollabDashboardSnapshot>>['data']>;
type VaultCollabDashboardActionInput = Parameters<typeof window.vaultAPI.performVaultCollabDashboardAction>[0];
type VaultCollabHandoffActionSet = NonNullable<Awaited<ReturnType<typeof window.vaultAPI.getVaultCollabHandoffActions>>['data']>;
type VaultCollabPanelKey = 'roster' | 'queue' | 'inspector';

export function VaultCollabView() {
  const [snapshot, setSnapshot] = useState<VaultCollabSnapshot | null>(null);
  const [selectedHandoffUid, setSelectedHandoffUid] = useState<string | null>(null);
  const [collapsedPanels, setCollapsedPanels] = useState<Set<VaultCollabPanelKey>>(() => new Set());
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dashboardSessionUid, setDashboardSessionUid] = useState<string | null>(null);
  const [discussionDraft, setDiscussionDraft] = useState('');
  const [handoffActionSet, setHandoffActionSet] = useState<VaultCollabHandoffActionSet | null>(null);

  useEffect(() => {
    void loadDashboard();
    const refresh = window.setInterval(() => {
      void loadDashboard(true);
    }, 15000);

    return () => window.clearInterval(refresh);
  }, []);

  useEffect(() => {
    const handoffUid = selectedHandoffUid;
    if (!handoffUid) {
      setHandoffActionSet(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      const response = await window.vaultAPI.getVaultCollabHandoffActions(handoffUid);
      if (cancelled) {
        return;
      }

      if (response.success && response.data) {
        setHandoffActionSet(response.data);
        setDashboardSessionUid(response.data.actingSessionUid);
      } else {
        setHandoffActionSet(null);
        setActionError(response.error || 'Could not load handoff actions');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedHandoffUid]);

  async function loadDashboard(silent = false) {
    if (!silent) {
      setLoading(true);
    }

    setError(null);

    try {
      const response = await window.vaultAPI.getVaultCollabDashboardSnapshot({
        sessionLimit: 18,
        handoffLimit: 28,
        eventLimit: 32,
      });

      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to load Vault Collab dashboard data');
      }

      setSnapshot(response.data);
      setLastLoadedAt(new Date());
      setSelectedHandoffUid((current) => {
        if (response.data!.handoffs.length === 0) {
          return null;
        }

        if (current && response.data!.handoffs.some((handoff) => handoff.handoffUid === current)) {
          return current;
        }

        return response.data!.handoffs[0].handoffUid;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Vault Collab dashboard data');
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }

  const model = useMemo(
    () => snapshot
      ? buildVaultCollabDashboardViewModel(snapshot, lastLoadedAt ?? new Date(), selectedHandoffUid, { dashboardSessionUid })
      : null,
    [dashboardSessionUid, lastLoadedAt, selectedHandoffUid, snapshot],
  );
  const rosterCollapsed = collapsedPanels.has('roster');
  const queueCollapsed = collapsedPanels.has('queue');
  const inspectorCollapsed = collapsedPanels.has('inspector');

  function toggleCollapsedPanel(panel: VaultCollabPanelKey) {
    setCollapsedPanels((current) => {
      const next = new Set(current);
      if (next.has(panel)) {
        next.delete(panel);
      } else {
        next.add(panel);
      }

      return next;
    });
  }

  async function performDashboardAction(input: VaultCollabDashboardActionInput, busyKey: string): Promise<unknown | null> {
    setActionBusy(busyKey);
    setActionError(null);

    try {
      const response = await window.vaultAPI.performVaultCollabDashboardAction(input);
      if (!response.success || !response.data?.ok) {
        throw new Error(response.error || response.data?.error || 'Vault Collab action failed');
      }

      const actionData = response.data.data;
      if (actionData && typeof actionData === 'object' && 'claimedBySessionUid' in actionData) {
        const claimedBySessionUid = (actionData as { claimedBySessionUid?: unknown }).claimedBySessionUid;
        if (typeof claimedBySessionUid === 'string') {
          setDashboardSessionUid(claimedBySessionUid);
        }
      }

      await loadDashboard(true);
      if (selectedHandoffUid) {
        const actionsResponse = await window.vaultAPI.getVaultCollabHandoffActions(selectedHandoffUid);
        if (actionsResponse.success && actionsResponse.data) {
          setHandoffActionSet(actionsResponse.data);
          setDashboardSessionUid(actionsResponse.data.actingSessionUid);
        }
      }
      return actionData;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Vault Collab action failed');
      return null;
    } finally {
      setActionBusy(null);
    }
  }

  async function runHandoffAction(action: string, handoffUid: string) {
    if (action === 'claim') {
      await performDashboardAction({ kind: 'handoff', action: 'claim', handoffUid }, `${handoffUid}:claim`);
      return;
    }

    if (action === 'release') {
      await performDashboardAction({ kind: 'handoff', action: 'release', handoffUid }, `${handoffUid}:release`);
      return;
    }

    if (action === 'update_in_progress') {
      await performDashboardAction({
        kind: 'handoff',
        action: 'update',
        handoffUid,
        status: 'in_progress',
        progressNote: 'Updated from The Vault dashboard.',
      }, `${handoffUid}:update_in_progress`);
      return;
    }

    if (action === 'update') {
      const progressNote = window.prompt('Progress note');
      if (!progressNote) {
        return;
      }
      await performDashboardAction({
        kind: 'handoff',
        action: 'update',
        handoffUid,
        status: 'in_progress',
        progressNote,
      }, `${handoffUid}:update`);
      return;
    }

    if (action === 'request_user_confirmation' || action === 'request_handoff_permission' || action === 'recover') {
      setActionError(`${action.replace(/_/g, ' ')} is not wired in this dashboard build yet.`);
      return;
    }

    if (action === 'update_blocked') {
      const progressNote = window.prompt('Blocker note');
      if (!progressNote) {
        return;
      }
      await performDashboardAction({
        kind: 'handoff',
        action: 'update',
        handoffUid,
        status: 'blocked',
        progressNote,
      }, `${handoffUid}:update_blocked`);
      return;
    }

    if (action === 'update_verification_needed') {
      await performDashboardAction({
        kind: 'handoff',
        action: 'update',
        handoffUid,
        status: 'verification_needed',
        progressNote: 'Ready for verification from The Vault dashboard.',
      }, `${handoffUid}:update_verification_needed`);
      return;
    }

    if (action === 'resolve') {
      const summary = window.prompt('Resolution summary');
      if (!summary) {
        return;
      }
      await performDashboardAction({ kind: 'handoff', action: 'resolve', handoffUid, summary }, `${handoffUid}:resolve`);
      return;
    }

    if (action === 'reopen') {
      const reason = window.prompt('Reopen reason');
      if (!reason) {
        return;
      }
      await performDashboardAction({ kind: 'handoff', action: 'reopen', handoffUid, reason }, `${handoffUid}:reopen`);
    }
  }

  async function runDiscussionAction() {
    const selectedHandoff = model?.selectedHandoff;
    const body = discussionDraft.trim();
    if (!selectedHandoff || !body) {
      setActionError('Write a discussion message first.');
      return;
    }

    const openThread = selectedHandoff.discussionThreads.find((thread) => thread.status === 'open')
      ?? selectedHandoff.discussionThreads[0];

    if (openThread) {
      await performDashboardAction({
        kind: 'discussion',
        action: 'add_message',
        threadUid: openThread.uid,
        messageType: 'note',
        body,
      }, `${selectedHandoff.uid}:discussion`);
      setDiscussionDraft('');
      return;
    }

    const title = window.prompt('Thread title', 'Dashboard discussion');
    if (!title) {
      return;
    }

    const createResult = await performDashboardAction({
      kind: 'discussion',
      action: 'create_thread',
      handoffUid: selectedHandoff.uid,
      project: 'the-vault',
      title,
    }, `${selectedHandoff.uid}:discussion`);
    const threadUid = createResult && typeof createResult === 'object'
      ? (createResult as { threadUid?: unknown }).threadUid
      : null;
    if (typeof threadUid === 'string') {
      await performDashboardAction({
        kind: 'discussion',
        action: 'add_message',
        threadUid,
        messageType: 'note',
        body,
      }, `${selectedHandoff.uid}:discussion-message`);
    }
    setDiscussionDraft('');
  }

  async function runLaunchAction(action: string, launchRequestUid: string) {
    if (action === 'approve') {
      await performDashboardAction({ kind: 'launch', action: 'approve', launchRequestUid, detail: 'Approved from The Vault dashboard.' }, `${launchRequestUid}:approve`);
      return;
    }

    if (action === 'reject') {
      const reason = window.prompt('Rejection reason');
      if (!reason) {
        return;
      }
      await performDashboardAction({ kind: 'launch', action: 'reject', launchRequestUid, reason }, `${launchRequestUid}:reject`);
      return;
    }

    if (action === 'cancel') {
      const reason = window.prompt('Cancellation reason');
      if (!reason) {
        return;
      }
      await performDashboardAction({ kind: 'launch', action: 'cancel', launchRequestUid, reason }, `${launchRequestUid}:cancel`);
    }
  }

  return (
    <div className="vault-collab-dashboard">
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
      {actionError ? <span className="error-text">{actionError}</span> : null}

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
            <p>Run the install check from Settings, then refresh this workspace.</p>
          </section>
        ) : (
          <section className="vault-collab-ops-grid">
            <aside className={`vault-collab-roster-panel ${rosterCollapsed ? 'vault-collab-panel-collapsed' : ''}`}>
              <div className="vault-collab-panel-header">
                <div>
                  <strong>Agent roster</strong>
                  <span>{snapshot?.counts.activeSessions ?? 0} live / {snapshot?.counts.staleSessions ?? 0} stale / {snapshot?.counts.disconnectedSessions ?? 0} closed</span>
                </div>
                <div className="vault-collab-panel-actions">
                  <Users size={17} />
                  <button
                    type="button"
                    className="vault-collab-panel-toggle"
                    onClick={() => toggleCollapsedPanel('roster')}
                    aria-expanded={!rosterCollapsed}
                    title={rosterCollapsed ? 'Expand agent roster' : 'Collapse agent roster'}
                  >
                    <ChevronDown size={15} />
                  </button>
                </div>
              </div>

              <div className="vault-collab-panel-body">
                {model.sessionGroups.length === 0 ? (
                  <div className="empty-state">No live or recent sessions are visible yet.</div>
                ) : (
                  <div className="vault-collab-roster-groups">
                    {model.sessionGroups.map((group) => (
                      <div key={group.key} className="vault-collab-roster-group">
                        <div className="vault-collab-group-label">
                          <span>{group.label}</span>
                          <span>{group.sessions.length}</span>
                        </div>

                        {group.sessions.map((session) => (
                          <div
                            key={session.uid}
                            className={`vault-collab-roster-row ${session.attention ? 'vault-collab-attention-card' : ''}`}
                          >
                            <span className="vault-collab-client-dot">{session.clientInitial}</span>
                            <div className="vault-collab-roster-main">
                              <div className="vault-collab-row-title">
                                <strong>{session.displayName}</strong>
                                <span className={`badge ${session.badgeClass}`}>{session.statusLabel}</span>
                              </div>
                              <span>{session.secondary}</span>
                              <div className="vault-collab-row-meta">
                                {session.roleLabel ? <span>{session.roleLabel}</span> : null}
                                <span className={`vault-collab-connection-pill ${session.connectionClass}`}>
                                  {session.connectionLabel}
                                </span>
                                <span>{session.heartbeatLabel}</span>
                                <span className="text-mono">{session.shortUid}</span>
                              </div>
                              {session.detail ? (
                                <div className={`vault-collab-session-note ${session.attention ? 'vault-collab-permission-note' : ''}`}>
                                  {session.attention ? (
                                    <div className="detail-section-title">
                                      <AlertTriangle size={14} />
                                      <span>Permission needed</span>
                                    </div>
                                  ) : null}
                                  <p>{session.detail}</p>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </aside>

            <main className={`vault-collab-queue-panel ${queueCollapsed ? 'vault-collab-panel-collapsed' : ''}`}>
              <div className="vault-collab-panel-header">
                <div>
                  <strong>Handoff queue</strong>
                  <span>{snapshot?.counts.openHandoffs ?? 0} unresolved / {snapshot?.counts.availableHandoffs ?? 0} available</span>
                </div>
                <div className="vault-collab-panel-actions">
                  <Inbox size={17} />
                  <button
                    type="button"
                    className="vault-collab-panel-toggle"
                    onClick={() => toggleCollapsedPanel('queue')}
                    aria-expanded={!queueCollapsed}
                    title={queueCollapsed ? 'Expand handoff queue' : 'Collapse handoff queue'}
                  >
                    <ChevronDown size={15} />
                  </button>
                </div>
              </div>

              <div className="vault-collab-panel-body">
                <div className="vault-collab-launch-section">
                  <div className="vault-collab-subsection-header">
                    <div>
                      <strong>Launch requests</strong>
                      <span>{snapshot?.counts.activeLaunchRequests ?? 0} active / {snapshot?.counts.launchRequests ?? 0} shown</span>
                    </div>
                    <Rocket size={16} />
                  </div>

                  {model.launchRequestRows.length === 0 ? (
                    <div className="empty-state">No launch requests are visible yet.</div>
                  ) : (
                    <div className="vault-collab-launch-list">
                      {model.launchRequestRows.map((launchRequest) => (
                        <div
                          key={launchRequest.uid}
                          className={`vault-collab-launch-card ${launchRequest.attention ? 'vault-collab-attention-row' : ''}`}
                        >
                          <span className={`queue-status-rail ${launchRequest.railClass}`} />
                          <div className="vault-collab-launch-main">
                            <div className="vault-collab-row-title">
                              <strong>{launchRequest.title}</strong>
                              <span className={`badge ${launchRequest.badgeClass}`}>{launchRequest.statusLabel}</span>
                            </div>
                            <div className="vault-collab-row-meta">
                              <span>{launchRequest.providerLabel}</span>
                              <span>{launchRequest.routeLabel}</span>
                              <span className="text-mono">{launchRequest.actorLabel}</span>
                              {launchRequest.capabilityLabel ? (
                                <span className="vault-collab-meta-chip">{launchRequest.capabilityLabel}</span>
                              ) : null}
                              <span className="text-mono">{launchRequest.shortUid}</span>
                            </div>
                            {launchRequest.detail ? (
                              <p>{launchRequest.detail}</p>
                            ) : null}
                            {launchRequest.commandPreview ? (
                              <span className="vault-collab-command-preview text-mono">{launchRequest.commandPreview}</span>
                            ) : null}
                            {launchRequest.actions.length > 0 ? (
                              <div className="inline-actions vault-collab-action-row">
                                {launchRequest.actions.map((action) => (
                                  <button
                                    key={action.action}
                                    type="button"
                                    className={action.tone === 'danger' ? 'danger-button' : action.tone === 'primary' ? 'primary-button' : 'header-button'}
                                    disabled={action.disabled || actionBusy === `${launchRequest.uid}:${action.action}`}
                                    title={action.reason ?? action.label}
                                    onClick={() => runLaunchAction(action.action, launchRequest.uid)}
                                  >
                                    {action.label}
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                          <span className="vault-collab-age">
                            <Clock3 size={13} />
                            {launchRequest.ageLabel}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {model.handoffRows.length === 0 ? (
                  <div className="empty-state">No open handoffs are waiting right now.</div>
                ) : (
                  <div className="vault-collab-handoff-table">
                    <div className="vault-collab-table-head">
                      <span>Work</span>
                      <span>Route</span>
                      <span>Owner</span>
                      <span>Updated</span>
                    </div>

                    {model.handoffRows.map((handoff) => (
                      <button
                        type="button"
                        key={handoff.uid}
                        className={`vault-collab-queue-row ${handoff.attention ? 'vault-collab-attention-row' : ''} ${model.selectedHandoff?.uid === handoff.uid ? 'vault-collab-queue-row-active' : ''}`}
                        onClick={() => setSelectedHandoffUid(handoff.uid)}
                      >
                        <span className={`queue-status-rail ${handoff.railClass}`} />
                        <span className="vault-collab-queue-main">
                          <span className="vault-collab-row-title">
                            <strong>{handoff.prompt}</strong>
                            <span className={`badge ${handoff.badgeClass}`}>{handoff.statusLabel}</span>
                          </span>
                          <span className="vault-collab-row-meta">
                            <span className="text-mono">{handoff.queueLabel}</span>
                            <span>{handoff.priorityLabel}</span>
                            {handoff.dependencyLabel ? <span>{handoff.dependencyLabel}</span> : null}
                            {handoff.threadLabel ? <span>{handoff.threadLabel}</span> : null}
                            {handoff.visibleLabels.map((label) => (
                              <span key={label} className="vault-collab-meta-chip">{label}</span>
                            ))}
                            {handoff.extraLabel ? <span>{handoff.extraLabel}</span> : null}
                          </span>
                        </span>
                        <span>{handoff.routeLabel}</span>
                        <span className="text-mono">{handoff.ownerLabel}</span>
                        <span className="vault-collab-age">
                          <Clock3 size={13} />
                          {handoff.ageLabel}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </main>

            <aside className={`vault-collab-inspector-panel ${inspectorCollapsed ? 'vault-collab-panel-collapsed' : ''}`}>
              <div className="vault-collab-panel-header">
                <div>
                  <strong>Handoff inspector</strong>
                  <span>Selected detail and context</span>
                </div>
                <div className="vault-collab-panel-actions">
                  {model.selectedHandoff ? (
                    <span className={`badge ${model.selectedHandoff.badgeClass}`}>
                      {model.selectedHandoff.statusLabel}
                    </span>
                  ) : (
                    <Activity size={17} />
                  )}
                  <button
                    type="button"
                    className="vault-collab-panel-toggle"
                    onClick={() => toggleCollapsedPanel('inspector')}
                    aria-expanded={!inspectorCollapsed}
                    title={inspectorCollapsed ? 'Expand handoff inspector' : 'Collapse handoff inspector'}
                  >
                    <ChevronDown size={15} />
                  </button>
                </div>
              </div>

              <div className="vault-collab-panel-body">
                {!model.selectedHandoff ? (
                  <div className="empty-state">Select a handoff to inspect it.</div>
                ) : (
                  <div className="vault-collab-inspector-stack">
                  <div className="vault-collab-inspector-headline">
                    <h3>{model.selectedHandoff.prompt}</h3>
                    <span className="text-mono">{model.selectedHandoff.shortUid}</span>
                  </div>

                  {model.selectedHandoff.attentionQuestion ? (
                    <div className="vault-collab-permission-note vault-collab-detail-permission-note">
                      <div className="detail-section-title">
                        <AlertTriangle size={15} />
                        <span>Permission needed</span>
                      </div>
                      <p>{model.selectedHandoff.attentionQuestion}</p>
                      {model.selectedHandoff.permissionMeta ? (
                        <p className="text-mono">{model.selectedHandoff.permissionMeta}</p>
                      ) : null}
                    </div>
                  ) : model.selectedHandoff.progressNote ? (
                    <div className="vault-collab-progress-note">
                      <div className="detail-section-title">
                        <CheckCircle2 size={15} />
                        <span>Progress note</span>
                      </div>
                      <p>{model.selectedHandoff.progressNote}</p>
                    </div>
                  ) : null}

                  <div className="vault-collab-detail-section">
                    <div className="detail-section-title">
                      <Activity size={15} />
                      <span>Actions</span>
                    </div>
                    <div className="inline-actions vault-collab-action-row">
                      {(handoffActionSet?.actions ?? []).map((action) => (
                        <button
                          key={action.kind}
                          type="button"
                          className={action.kind === 'resolve' || action.kind === 'claim' ? 'primary-button' : action.kind === 'recover' ? 'danger-button' : 'header-button'}
                          disabled={!action.enabled || actionBusy === `${model.selectedHandoff!.uid}:${action.kind}`}
                          title={action.reason}
                          onClick={() => runHandoffAction(action.kind, model.selectedHandoff!.uid)}
                        >
                          {formatHandoffActionLabel(action.kind)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="vault-collab-detail-grid">
                    {model.selectedHandoff.meta.map((item) => (
                      <span key={item.label}>
                        <span>{item.label}</span>
                        <strong className={item.mono ? 'text-mono' : undefined}>{item.value}</strong>
                      </span>
                    ))}
                  </div>

                  {model.selectedHandoff.labels.length > 0 ? (
                    <div className="vault-collab-detail-section">
                      <div className="detail-section-title">
                        <Tag size={15} />
                        <span>Labels</span>
                      </div>
                      <div className="chip-row">
                        {model.selectedHandoff.labels.map((label) => (
                          <span key={label} className="chip chip-muted">{label}</span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="vault-collab-detail-section">
                    <div className="detail-section-title">
                      <MessageSquareText size={15} />
                      <span>Discussion threads</span>
                    </div>
                    <div className="vault-collab-discussion-composer">
                      <textarea
                        value={discussionDraft}
                        onChange={(event) => setDiscussionDraft(event.target.value)}
                        placeholder="Write a thread message"
                        rows={3}
                      />
                      <button
                        type="button"
                        className="primary-button"
                        disabled={Boolean(actionBusy) || discussionDraft.trim().length === 0}
                        onClick={() => void runDiscussionAction()}
                      >
                        {model.selectedHandoff.discussionAction.label}
                      </button>
                    </div>
                    {model.selectedHandoff.discussionThreads.length === 0 ? (
                      <div className="empty-state">No discussion threads are linked to this handoff.</div>
                    ) : (
                      <div className="vault-collab-discussion-list">
                        {model.selectedHandoff.discussionThreads.map((thread) => (
                          <div key={thread.uid} className="vault-collab-discussion-row">
                            <div className="vault-collab-row-title">
                              <strong>{thread.title}</strong>
                              <span className={`badge ${thread.badgeClass}`}>{thread.status}</span>
                            </div>
                            <p>{thread.summary}</p>
                            <span className="text-mono">{thread.shortUid}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {model.selectedHandoff.relatedFiles.length > 0 ? (
                    <div className="vault-collab-detail-section">
                      <div className="detail-section-title">
                        <Link2 size={15} />
                        <span>Related files</span>
                      </div>
                      <div className="vault-collab-path-list">
                        {model.selectedHandoff.relatedFiles.map((filePath) => (
                          <span key={filePath} className="detail-path text-mono">{filePath}</span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="vault-collab-detail-section">
                    <div className="detail-section-title">
                      <Activity size={15} />
                      <span>Event timeline</span>
                    </div>
                    {model.eventRows.length === 0 ? (
                      <div className="empty-state">No collaboration events are available yet.</div>
                    ) : (
                      <div className="vault-collab-event-list">
                        {model.eventRows.map((event) => (
                          <div key={event.id} className="vault-collab-event-row">
                            <span className="badge badge-recall">{event.type}</span>
                            <strong>{event.timeLabel}</strong>
                            <p>{event.summary}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  </div>
                )}
              </div>
            </aside>
          </section>
        )
      ) : (
        <div className="empty-state">Vault Collab dashboard data is unavailable.</div>
      )}
    </div>
  );
}

function formatHandoffActionLabel(action: string): string {
  switch (action) {
    case 'request_user_confirmation':
      return 'Ask user';
    case 'request_handoff_permission':
      return 'Request permission';
    default:
      return action
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
  }
}
