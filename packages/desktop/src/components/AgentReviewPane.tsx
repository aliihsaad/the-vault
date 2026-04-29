import { useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Inbox,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';

export type AgentReviewTab = 'proposals' | 'pending-deletes';

interface AgentReviewPaneProps {
  initialTab?: AgentReviewTab;
  onCountsChanged?: (counts: { proposals: number; pendingDeletes: number }) => void;
}

interface ProposalActionState {
  pending: boolean;
  rejectingNote: string;
  showRejectInput: boolean;
  expandedEvidence: boolean;
  evidenceTitles: Record<string, string>;
  errorMessage: string | null;
}

const DEFAULT_ACTION_STATE: ProposalActionState = {
  pending: false,
  rejectingNote: '',
  showRejectInput: false,
  expandedEvidence: false,
  evidenceTitles: {},
  errorMessage: null,
};

export function AgentReviewPane({ initialTab = 'proposals', onCountsChanged }: AgentReviewPaneProps) {
  const [activeTab, setActiveTab] = useState<AgentReviewTab>(initialTab);
  const [proposals, setProposals] = useState<VaultProjectProposal[]>([]);
  const [pendingDeletes, setPendingDeletes] = useState<VaultMemory[]>([]);
  const [loadingProposals, setLoadingProposals] = useState(false);
  const [loadingPendingDeletes, setLoadingPendingDeletes] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [actionStateByUid, setActionStateByUid] = useState<Record<string, ProposalActionState>>({});
  const [confirmDeleteUid, setConfirmDeleteUid] = useState<string | null>(null);
  const [deletingUid, setDeletingUid] = useState<string | null>(null);
  const [restoringUid, setRestoringUid] = useState<string | null>(null);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    void refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onCountsChanged?.({
      proposals: proposals.length,
      pendingDeletes: pendingDeletes.length,
    });
  }, [proposals.length, pendingDeletes.length, onCountsChanged]);

  async function refreshProposals() {
    setLoadingProposals(true);
    try {
      const response = await window.vaultAPI.listProjectProposals({ status: 'pending' });
      if (response.success && Array.isArray(response.data)) {
        setProposals(response.data);
        setGlobalError(null);
      } else {
        setProposals([]);
        if (response.error) {
          setGlobalError(response.error);
        }
      }
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Failed to load proposals');
    } finally {
      setLoadingProposals(false);
    }
  }

  async function refreshPendingDeletes() {
    setLoadingPendingDeletes(true);
    try {
      const response = await window.vaultAPI.findMemory({ status: 'pending_delete', limit: 200 });
      if (response.success && Array.isArray(response.data)) {
        setPendingDeletes(response.data);
        setGlobalError(null);
      } else {
        setPendingDeletes([]);
        if (response.error) {
          setGlobalError(response.error);
        }
      }
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Failed to load pending deletes');
    } finally {
      setLoadingPendingDeletes(false);
    }
  }

  async function refreshAll() {
    await Promise.all([refreshProposals(), refreshPendingDeletes()]);
  }

  function getActionState(uid: string): ProposalActionState {
    return actionStateByUid[uid] ?? DEFAULT_ACTION_STATE;
  }

  function patchActionState(uid: string, patch: Partial<ProposalActionState>) {
    setActionStateByUid((prev) => ({
      ...prev,
      [uid]: { ...DEFAULT_ACTION_STATE, ...prev[uid], ...patch },
    }));
  }

  async function toggleEvidence(proposal: VaultProjectProposal) {
    const state = getActionState(proposal.proposalUid);
    const expanding = !state.expandedEvidence;
    patchActionState(proposal.proposalUid, { expandedEvidence: expanding });

    if (!expanding) {
      return;
    }

    const missing = proposal.evidenceItemUids.filter((uid) => !state.evidenceTitles[uid]);
    if (missing.length === 0) {
      return;
    }

    const titleEntries = await Promise.all(
      missing.map(async (uid) => {
        try {
          const res = await window.vaultAPI.getMemoryDetail(uid);
          if (res.success && res.data) {
            return [uid, res.data.title] as const;
          }
        } catch {
          // swallow per-item errors; just leave title unresolved
        }
        return [uid, '(missing)'] as const;
      }),
    );

    const titles = Object.fromEntries(titleEntries);
    patchActionState(proposal.proposalUid, {
      evidenceTitles: { ...state.evidenceTitles, ...titles },
    });
  }

  async function acceptProposal(proposal: VaultProjectProposal) {
    patchActionState(proposal.proposalUid, { pending: true, errorMessage: null });
    try {
      const response = await window.vaultAPI.decideProjectProposal({
        proposalUid: proposal.proposalUid,
        decision: 'accept',
        decidedBy: 'user',
      });

      if (!response.success) {
        patchActionState(proposal.proposalUid, {
          pending: false,
          errorMessage: response.error ?? 'Accept failed',
        });
        return;
      }

      const result = response.data;
      if (result && result.applied === false) {
        patchActionState(proposal.proposalUid, {
          pending: false,
          errorMessage: result.error ?? 'Accept did not apply',
        });
        return;
      }

      await refreshProposals();
    } catch (err) {
      patchActionState(proposal.proposalUid, {
        pending: false,
        errorMessage: err instanceof Error ? err.message : 'Accept failed',
      });
    }
  }

  async function rejectProposal(proposal: VaultProjectProposal) {
    const state = getActionState(proposal.proposalUid);
    patchActionState(proposal.proposalUid, { pending: true, errorMessage: null });
    try {
      const response = await window.vaultAPI.decideProjectProposal({
        proposalUid: proposal.proposalUid,
        decision: 'reject',
        decidedBy: 'user',
        decisionNote: state.rejectingNote.trim() || undefined,
      });

      if (!response.success) {
        patchActionState(proposal.proposalUid, {
          pending: false,
          errorMessage: response.error ?? 'Reject failed',
        });
        return;
      }

      await refreshProposals();
    } catch (err) {
      patchActionState(proposal.proposalUid, {
        pending: false,
        errorMessage: err instanceof Error ? err.message : 'Reject failed',
      });
    }
  }

  async function restoreItem(item: VaultMemory) {
    setRestoringUid(item.itemUid);
    try {
      const response = await window.vaultAPI.updateMemory(item.itemUid, { status: 'active' });
      if (!response.success) {
        setGlobalError(response.error ?? `Failed to restore ${item.itemUid}`);
        return;
      }
      setPendingDeletes((prev) => prev.filter((entry) => entry.itemUid !== item.itemUid));
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Failed to restore item');
    } finally {
      setRestoringUid(null);
    }
  }

  async function permanentlyDelete(item: VaultMemory) {
    setDeletingUid(item.itemUid);
    try {
      const response = await window.vaultAPI.confirmMemoryDelete(item.itemUid);
      if (!response.success) {
        setGlobalError(response.error ?? `Failed to delete ${item.itemUid}`);
        return;
      }
      setPendingDeletes((prev) => prev.filter((entry) => entry.itemUid !== item.itemUid));
      setConfirmDeleteUid(null);
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Failed to delete item');
    } finally {
      setDeletingUid(null);
    }
  }

  const proposalsTabLabel = useMemo(() => `Project proposals${proposals.length ? ` (${proposals.length})` : ''}`, [proposals.length]);
  const pendingDeletesTabLabel = useMemo(() => `Pending deletes${pendingDeletes.length ? ` (${pendingDeletes.length})` : ''}`, [pendingDeletes.length]);

  return (
    <div className="content-surface">
      <section className="section-intro">
        <div className="section-intro-copy">
          <span className="section-intro-eyebrow">Agent review</span>
          <div className="section-intro-title">Decide what the lifecycle pipeline and review duty have queued for you</div>
          <p className="section-intro-text">Project proposals come from the project_review duty. Pending deletes come from the active &rarr; stale &rarr; archived &rarr; pending_delete pipeline. Nothing here is final until you act.</p>
        </div>
        <div className="section-intro-meta">
          <button type="button" className="header-button" onClick={() => void refreshAll()}>
            <RefreshCw size={16} />
            <span>Refresh</span>
          </button>
        </div>
      </section>

      <div className="panel">
        <div className="panel-header" style={{ paddingBottom: 0 }}>
          <nav className="agent-review-tabs" role="tablist" aria-label="Agent review tabs">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'proposals'}
              className={`agent-review-tab ${activeTab === 'proposals' ? 'active' : ''}`}
              onClick={() => setActiveTab('proposals')}
            >
              <Inbox size={16} />
              <span>{proposalsTabLabel}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'pending-deletes'}
              className={`agent-review-tab ${activeTab === 'pending-deletes' ? 'active' : ''}`}
              onClick={() => setActiveTab('pending-deletes')}
            >
              <Trash2 size={16} />
              <span>{pendingDeletesTabLabel}</span>
            </button>
          </nav>
        </div>

        {globalError ? (
          <div className="empty-state empty-state-error" style={{ marginTop: 16 }}>{globalError}</div>
        ) : null}

        {activeTab === 'proposals' ? (
          <ProposalsList
            proposals={proposals}
            loading={loadingProposals}
            getActionState={getActionState}
            onToggleEvidence={(proposal) => void toggleEvidence(proposal)}
            onAccept={(proposal) => void acceptProposal(proposal)}
            onReject={(proposal) => void rejectProposal(proposal)}
            onRejectingNoteChange={(uid, value) => patchActionState(uid, { rejectingNote: value })}
            onShowRejectInput={(uid, show) => patchActionState(uid, { showRejectInput: show, errorMessage: null })}
          />
        ) : (
          <PendingDeletesList
            items={pendingDeletes}
            loading={loadingPendingDeletes}
            confirmUid={confirmDeleteUid}
            restoringUid={restoringUid}
            deletingUid={deletingUid}
            onRestore={(item) => void restoreItem(item)}
            onRequestConfirm={(uid) => setConfirmDeleteUid(uid)}
            onCancelConfirm={() => setConfirmDeleteUid(null)}
            onConfirmDelete={(item) => void permanentlyDelete(item)}
          />
        )}
      </div>
    </div>
  );
}

interface ProposalsListProps {
  proposals: VaultProjectProposal[];
  loading: boolean;
  getActionState: (uid: string) => ProposalActionState;
  onToggleEvidence: (proposal: VaultProjectProposal) => void;
  onAccept: (proposal: VaultProjectProposal) => void;
  onReject: (proposal: VaultProjectProposal) => void;
  onRejectingNoteChange: (uid: string, value: string) => void;
  onShowRejectInput: (uid: string, show: boolean) => void;
}

function ProposalsList(props: ProposalsListProps) {
  const { proposals, loading, getActionState, onToggleEvidence, onAccept, onReject, onRejectingNoteChange, onShowRejectInput } = props;

  if (loading && proposals.length === 0) {
    return <div className="empty-state">Loading proposals...</div>;
  }

  if (proposals.length === 0) {
    return <div className="empty-state">No agent proposals are waiting for a decision.</div>;
  }

  return (
    <div className="agent-review-list">
      {proposals.map((proposal) => {
        const state = getActionState(proposal.proposalUid);
        return (
          <article key={proposal.proposalUid} className="agent-review-card">
            <header className="agent-review-card-header">
              <div className="agent-review-card-titles">
                <div className="agent-review-card-title">{proposal.project}</div>
                <div className="agent-review-card-subtitle">
                  <span className={`badge badge-${proposal.proposalType}`}>{proposal.proposalType}</span>
                  {typeof proposal.confidence === 'number' ? (
                    <span className="chip">confidence {proposal.confidence}</span>
                  ) : null}
                  <span className="agent-review-card-time">
                    {formatDistanceToNow(new Date(proposal.createdAt))} ago
                  </span>
                </div>
              </div>
            </header>

            <PayloadPreview payload={proposal.payload} />

            {proposal.rationale ? (
              <p className="agent-review-card-rationale">{proposal.rationale}</p>
            ) : null}

            {proposal.evidenceItemUids.length > 0 ? (
              <div className="agent-review-evidence">
                <button
                  type="button"
                  className="agent-review-evidence-toggle"
                  onClick={() => onToggleEvidence(proposal)}
                >
                  {state.expandedEvidence ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span>Evidence ({proposal.evidenceItemUids.length})</span>
                </button>
                {state.expandedEvidence ? (
                  <ul className="agent-review-evidence-list">
                    {proposal.evidenceItemUids.map((uid) => (
                      <li key={uid}>
                        <span className="text-mono agent-review-evidence-uid">{uid}</span>
                        <span className="agent-review-evidence-title">
                          {state.evidenceTitles[uid] ?? 'loading...'}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {state.errorMessage ? (
              <div className="agent-review-error">
                <AlertTriangle size={14} />
                <span>{state.errorMessage}</span>
              </div>
            ) : null}

            <footer className="agent-review-card-actions">
              <button
                type="button"
                className="primary-button"
                disabled={state.pending}
                onClick={() => onAccept(proposal)}
              >
                <Check size={16} />
                <span>{state.pending ? 'Working...' : 'Accept'}</span>
              </button>

              {state.showRejectInput ? (
                <div className="agent-review-reject-row">
                  <input
                    type="text"
                    className="agent-review-reject-note"
                    placeholder="Optional note (why rejected)"
                    value={state.rejectingNote}
                    onChange={(event) => onRejectingNoteChange(proposal.proposalUid, event.target.value)}
                    disabled={state.pending}
                  />
                  <button
                    type="button"
                    className="danger-button"
                    disabled={state.pending}
                    onClick={() => onReject(proposal)}
                  >
                    <span>{state.pending ? 'Rejecting...' : 'Confirm reject'}</span>
                  </button>
                  <button
                    type="button"
                    className="pill-button"
                    disabled={state.pending}
                    onClick={() => onShowRejectInput(proposal.proposalUid, false)}
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="pill-button"
                  disabled={state.pending}
                  onClick={() => onShowRejectInput(proposal.proposalUid, true)}
                >
                  <X size={16} />
                  <span>Reject</span>
                </button>
              )}
            </footer>
          </article>
        );
      })}
    </div>
  );
}

interface PendingDeletesListProps {
  items: VaultMemory[];
  loading: boolean;
  confirmUid: string | null;
  restoringUid: string | null;
  deletingUid: string | null;
  onRestore: (item: VaultMemory) => void;
  onRequestConfirm: (uid: string) => void;
  onCancelConfirm: () => void;
  onConfirmDelete: (item: VaultMemory) => void;
}

function PendingDeletesList(props: PendingDeletesListProps) {
  const { items, loading, confirmUid, restoringUid, deletingUid, onRestore, onRequestConfirm, onCancelConfirm, onConfirmDelete } = props;

  if (loading && items.length === 0) {
    return <div className="empty-state">Loading pending deletes...</div>;
  }

  if (items.length === 0) {
    return <div className="empty-state">Lifecycle pipeline has nothing queued for delete review.</div>;
  }

  return (
    <div className="agent-review-list">
      {items.map((item) => {
        const isConfirming = confirmUid === item.itemUid;
        const isRestoring = restoringUid === item.itemUid;
        const isDeleting = deletingUid === item.itemUid;
        const lastSeen = item.lastAccessedAt ? new Date(item.lastAccessedAt) : null;

        return (
          <article key={item.itemUid} className="agent-review-card">
            <header className="agent-review-card-header">
              <div className="agent-review-card-titles">
                <div className="agent-review-card-title">{item.title}</div>
                <div className="agent-review-card-subtitle">
                  <span className={`badge badge-${item.memoryType}`}>{item.memoryType}</span>
                  <span className="chip">{item.project}</span>
                  <span className="agent-review-card-time">
                    created {formatDistanceToNow(new Date(item.createdAt))} ago
                  </span>
                </div>
              </div>
            </header>

            <p className="agent-review-card-summary">{item.summary}</p>

            <div className="agent-review-meta-row">
              <span>Access count: <strong>{item.accessCount}</strong></span>
              <span>
                Last accessed: <strong>{lastSeen ? `${formatDistanceToNow(lastSeen)} ago` : 'never'}</strong>
              </span>
            </div>

            <footer className="agent-review-card-actions">
              <button
                type="button"
                className="pill-button"
                disabled={isRestoring || isDeleting}
                onClick={() => onRestore(item)}
              >
                <RotateCcw size={16} />
                <span>{isRestoring ? 'Restoring...' : 'Restore'}</span>
              </button>

              {isConfirming ? (
                <div className="agent-review-confirm-row">
                  <span className="agent-review-confirm-warning">
                    <AlertTriangle size={14} />
                    <span>This permanently deletes the file and registry row. No undo.</span>
                  </span>
                  <button
                    type="button"
                    className="danger-button"
                    disabled={isDeleting}
                    onClick={() => onConfirmDelete(item)}
                  >
                    <span>{isDeleting ? 'Deleting...' : 'Yes, permanently delete'}</span>
                  </button>
                  <button
                    type="button"
                    className="pill-button"
                    disabled={isDeleting}
                    onClick={onCancelConfirm}
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="danger-button"
                  disabled={isRestoring || isDeleting}
                  onClick={() => onRequestConfirm(item.itemUid)}
                >
                  <Trash2 size={16} />
                  <span>Permanently delete</span>
                </button>
              )}
            </footer>
          </article>
        );
      })}
    </div>
  );
}

function PayloadPreview({ payload }: { payload: VaultProposalPayload }) {
  if (payload.type === 'description') {
    return (
      <div className="agent-review-payload">
        <span className="agent-review-payload-label">Proposed description</span>
        <p>{payload.description}</p>
      </div>
    );
  }

  if (payload.type === 'relationship') {
    return (
      <div className="agent-review-payload">
        <span className="agent-review-payload-label">Proposed relationship</span>
        <p>
          <strong>{payload.sourceProject}</strong>
          {' '}<span className="chip">{payload.linkType.replace(/_/g, ' ')}</span>{' '}
          <strong>{payload.targetProject}</strong>
        </p>
        {payload.note ? <p className="agent-review-card-rationale">{payload.note}</p> : null}
      </div>
    );
  }

  return (
    <div className="agent-review-payload">
      <span className="agent-review-payload-label">Proposed merge</span>
      <p>
        Merge <strong>{payload.sourceProject}</strong> into <strong>{payload.targetProject}</strong>
        {payload.relocateFiles ? ' (relocate files)' : ' (registry only)'}
      </p>
    </div>
  );
}
