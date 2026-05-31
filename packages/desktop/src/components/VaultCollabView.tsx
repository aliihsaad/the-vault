import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

import { buildVaultCollabDashboardViewModel } from '../vault-collab-view-model.js';
import { ConversationStream } from './vault-collab/ConversationStream.js';
import { HandoffDetail } from './vault-collab/HandoffDetail.js';
import { NeedsYou } from './vault-collab/NeedsYou.js';
import { Roster } from './vault-collab/Roster.js';
import { useVaultCollabActions } from './vault-collab/useVaultCollabActions.js';
import { WorkBoard } from './vault-collab/WorkBoard.js';

type VaultCollabSnapshot = NonNullable<Awaited<ReturnType<typeof window.vaultAPI.getVaultCollabDashboardSnapshot>>['data']>;

export function VaultCollabView() {
  const [snapshot, setSnapshot] = useState<VaultCollabSnapshot | null>(null);
  const [selectedHandoffUid, setSelectedHandoffUid] = useState<string | null>(null);
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
      })
      : null,
    [approvedLaunchCommands, dashboardSessionUid, lastLoadedAt, selectedHandoffUid, snapshot],
  );

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
      const response = await window.vaultAPI.getVaultCollabDashboardSnapshot({
        eventLimit: 48,
        handoffLimit: 40,
        launchRequestLimit: 24,
        sessionLimit: 32,
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
      {actions.actionError ? <span className="error-text">{actions.actionError}</span> : null}
      {actions.actionNotice ? <span className="success-text">{actions.actionNotice}</span> : null}

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
          <>
            <NeedsYou
              items={model.cockpit.needsYou}
              launchRequests={model.launchRequestRows}
              actionBusy={actions.actionBusy}
              onRequestAgent={(input) => void actions.requestAgent(input)}
              onLaunchAction={(action, uid) => void actions.runLaunchAction(action, uid)}
              onHandoffAction={(action, uid) => void actions.runHandoffAction(action, uid)}
              onCopyLaunchCommand={(uid, command) => void actions.copyLaunchCommand(uid, command)}
            />
            <section className="vault-collab-cockpit-grid">
              <Roster groups={model.cockpit.roster} />
              <WorkBoard
                columns={model.cockpit.work}
                selectedHandoffUid={model.cockpit.selectedHandoff?.uid ?? null}
                onSelectHandoff={setSelectedHandoffUid}
              />
              <ConversationStream
                entries={model.cockpit.conversation}
                draft={discussionDraft}
                disabled={Boolean(actions.actionBusy) || !model.cockpit.selectedHandoff}
                onDraftChange={setDiscussionDraft}
                onSubmit={() => void actions.runDiscussionAction()}
              />
              <HandoffDetail handoff={model.cockpit.selectedHandoff} />
            </section>
          </>
        )
      ) : (
        <div className="empty-state">Vault Collab dashboard data is unavailable.</div>
      )}
    </div>
  );
}
