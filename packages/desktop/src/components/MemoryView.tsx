import { useEffect, useMemo, useState } from 'react';
import { Archive, Clock3, Database, Filter, Link2, RefreshCw, Save, Search, Sparkles, Tags } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { DayGroupedList } from './DayGroupedList.js';

const ROUTINE_TYPE_OPTIONS = [
  '',
  'debugging',
  'planning',
  'implementation',
  'review',
  'testing',
  'brainstorming',
  'refactor',
  'deployment',
] as const;

const MEMORY_TYPE_OPTIONS: VaultMemoryType[] = [
  'session',
  'summary',
  'decision',
  'plan',
  'artifact',
  'handoff',
  'reference',
];

type MemoryDraft = {
  title: string;
  subject: string;
  summary: string;
  content: string;
  status: VaultStatusValue;
  priority: VaultPriorityValue;
  routineType: string;
  tagsText: string;
  keywordsText: string;
  nextStepsText: string;
  relatedItemIdsText: string;
  relatedFilesText: string;
};

type SaveComposerDraft = VaultMemoryComposerDraft;

type ComposerHint = {
  level: 'pass' | 'warn' | 'fail';
  message: string;
  detail?: string;
};

type MemoryViewMode = 'browse' | 'create';

export function MemoryView({
  composerPrefill,
  onComposerPrefillConsumed,
}: {
  composerPrefill?: { draft: Partial<VaultMemoryComposerDraft>; nonce: number } | null;
  onComposerPrefillConsumed?: () => void;
}) {
  const [memories, setMemories] = useState<VaultMemory[]>([]);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<VaultMemoryDetail | null>(null);
  const [draft, setDraft] = useState<MemoryDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<'save' | 'promote' | 'demote' | 'archive' | null>(null);
  const [composerDraft, setComposerDraft] = useState<SaveComposerDraft>(buildInitialComposerDraft());
  const [creatingMemory, setCreatingMemory] = useState(false);
  const [composerPathPreview, setComposerPathPreview] = useState('');
  const [similarMemories, setSimilarMemories] = useState<VaultSimilarMemoryMatch[]>([]);
  const [detectingSimilar, setDetectingSimilar] = useState(false);
  const [selectedArtifactPath, setSelectedArtifactPath] = useState<string | null>(null);
  const [artifactPreview, setArtifactPreview] = useState<VaultFilePreview | null>(null);
  const [artifactPreviewLoading, setArtifactPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | VaultStatusValue>('all');
  const [activeMode, setActiveMode] = useState<MemoryViewMode>('browse');

  useEffect(() => {
    void fetchMemories();
  }, []);

  useEffect(() => {
    if (!selectedDetail) {
      setDraft(null);
      return;
    }

    setDraft(buildDraft(selectedDetail));
  }, [selectedDetail]);

  useEffect(() => {
    if (!selectedDetail) {
      setSelectedArtifactPath(null);
      setArtifactPreview(null);
      setArtifactPreviewLoading(false);
      return;
    }

    setSelectedArtifactPath(getInitialArtifactPreviewPath(selectedDetail));
  }, [selectedDetail]);

  useEffect(() => {
    if (!selectedArtifactPath) {
      setArtifactPreview(null);
      setArtifactPreviewLoading(false);
      return;
    }

    const artifactPath = selectedArtifactPath;
    let active = true;

    async function loadArtifactPreview() {
      setArtifactPreviewLoading(true);

      try {
        const response = await window.vaultAPI.readVaultFilePreview(artifactPath);
        if (!active) {
          return;
        }

        if (!response.success || !response.data) {
          throw new Error(response.error || 'Failed to load artifact preview');
        }

        setArtifactPreview(response.data);
      } catch {
        if (active) {
          setArtifactPreview(null);
        }
      } finally {
        if (active) {
          setArtifactPreviewLoading(false);
        }
      }
    }

    void loadArtifactPreview();

    return () => {
      active = false;
    };
  }, [selectedArtifactPath]);

  useEffect(() => {
    if (!composerPrefill) {
      return;
    }

    setActiveMode('create');
    setComposerDraft((current) => ({
      ...current,
      ...composerPrefill.draft,
    }));
    setMessage('Composer prefilled from a recall or activity context.');
    setError(null);
    onComposerPrefillConsumed?.();
  }, [composerPrefill, onComposerPrefillConsumed]);

  useEffect(() => {
    if (composerDraft.project.trim()) {
      return;
    }

    const fallbackProject = selectedDetail?.project || projectOptionsFromMemories(memories)[0] || '';
    if (!fallbackProject) {
      return;
    }

    setComposerDraft((current) => current.project.trim() ? current : {
      ...current,
      project: fallbackProject,
    });
  }, [selectedDetail, memories, composerDraft.project]);

  useEffect(() => {
    const project = composerDraft.project.trim();
    const title = composerDraft.title.trim();

    if (!project || !title) {
      setComposerPathPreview('');
      return;
    }

    let cancelled = false;

    void window.vaultAPI
      .suggestSavePath(project, composerDraft.memoryType, title)
      .then((response) => {
        if (cancelled) {
          return;
        }

        setComposerPathPreview(response.success && response.data ? response.data : '');
      })
      .catch(() => {
        if (!cancelled) {
          setComposerPathPreview('');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [composerDraft.project, composerDraft.memoryType, composerDraft.title]);

  useEffect(() => {
    const project = composerDraft.project.trim();
    const title = composerDraft.title.trim();
    const subject = composerDraft.subject.trim();
    const summary = composerDraft.summary.trim();

    if (!project || (title.length < 6 && subject.length < 6 && summary.length < 24)) {
      setSimilarMemories([]);
      setDetectingSimilar(false);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      setDetectingSimilar(true);

      void window.vaultAPI
        .detectSimilarMemories({
          project,
          title,
          subject,
          summary,
          limit: 6,
        })
        .then((response) => {
          if (cancelled) {
            return;
          }

          setSimilarMemories(response.success && response.data ? response.data : []);
        })
        .catch(() => {
          if (!cancelled) {
            setSimilarMemories([]);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setDetectingSimilar(false);
          }
        });
    }, 280);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [composerDraft.project, composerDraft.title, composerDraft.subject, composerDraft.summary]);

  async function fetchMemories(preferredUid?: string) {
    setLoading(true);
    setError(null);

    try {
      const response = await window.vaultAPI.findMemory({ limit: 120 });
      if (!response.success) {
        throw new Error(response.error || 'Failed to load memories');
      }

      const nextMemories = response.data || [];
      setMemories(nextMemories);

      if (nextMemories.length === 0) {
        setSelectedUid(null);
        setSelectedDetail(null);
        return;
      }

      const desiredUid = preferredUid || selectedUid;
      const fallbackUid = nextMemories[0].itemUid;
      const nextUid = desiredUid && nextMemories.some((memory) => memory.itemUid === desiredUid)
        ? desiredUid
        : fallbackUid;

      setSelectedUid(nextUid);
      await fetchMemoryDetail(nextUid);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load memories');
    } finally {
      setLoading(false);
    }
  }

  async function fetchMemoryDetail(uid: string) {
    setDetailLoading(true);

    try {
      const response = await window.vaultAPI.getMemoryDetail(uid);
      if (!response.success) {
        throw new Error(response.error || 'Failed to load memory detail');
      }

      setSelectedDetail(response.data || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load memory detail');
    } finally {
      setDetailLoading(false);
    }
  }

  async function refreshSelectedMemory(uid: string) {
    await fetchMemoryDetail(uid);
    await refreshMemoryList(uid);
  }

  async function refreshMemoryList(uid?: string) {
    const response = await window.vaultAPI.findMemory({ limit: 120 });
    if (!response.success) {
      throw new Error(response.error || 'Failed to refresh memory list');
    }

    const nextMemories = response.data || [];
    setMemories(nextMemories);

    if (uid && nextMemories.some((memory) => memory.itemUid === uid)) {
      setSelectedUid(uid);
      return;
    }

    if (nextMemories.length > 0) {
      setSelectedUid(nextMemories[0].itemUid);
      return;
    }

    setSelectedUid(null);
    setSelectedDetail(null);
  }

  async function handleSelectMemory(uid: string) {
    setActiveMode('browse');
    setSelectedUid(uid);
    setMessage(null);
    setError(null);
    await fetchMemoryDetail(uid);
  }

  async function handleSaveChanges() {
    if (!selectedDetail || !draft) {
      return;
    }

    setBusyAction('save');
    setError(null);
    setMessage(null);

    try {
      const response = await window.vaultAPI.updateMemory(selectedDetail.itemUid, {
        title: draft.title.trim(),
        subject: draft.subject.trim(),
        summary: draft.summary.trim(),
        content: draft.content.trim() || null,
        status: draft.status,
        priority: draft.priority,
        routineType: draft.routineType.trim() || null,
        tags: parseTagLikeList(draft.tagsText),
        keywords: parseTagLikeList(draft.keywordsText),
        nextSteps: parseLineList(draft.nextStepsText),
        relatedItemIds: parseFlexibleList(draft.relatedItemIdsText),
        relatedFiles: parseFlexibleList(draft.relatedFilesText),
      });

      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to update memory');
      }

      setMessage(`Saved changes to ${response.data.title}.`);
      await refreshSelectedMemory(response.data.itemUid);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update memory');
    } finally {
      setBusyAction(null);
    }
  }

  async function handlePromote() {
    if (!selectedDetail) {
      return;
    }

    setBusyAction('promote');
    setError(null);
    setMessage(null);

    try {
      const response = await window.vaultAPI.promoteMemory(selectedDetail.itemUid);
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to promote memory');
      }

      setMessage(`Promoted ${response.data.title} for higher-priority recall.`);
      await refreshSelectedMemory(response.data.itemUid);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to promote memory');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDemote() {
    if (!selectedDetail || !draft) {
      return;
    }

    setBusyAction('demote');
    setError(null);
    setMessage(null);

    try {
      const response = await window.vaultAPI.updateMemory(selectedDetail.itemUid, {
        promoted: false,
        status: draft.status === 'promoted' ? 'active' : draft.status,
      });

      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to demote memory');
      }

      setMessage(`Demoted ${response.data.title}. It will no longer receive promoted recall weighting.`);
      await refreshSelectedMemory(response.data.itemUid);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to demote memory');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleArchive() {
    if (!selectedDetail) {
      return;
    }

    setBusyAction('archive');
    setError(null);
    setMessage(null);

    try {
      const response = await window.vaultAPI.archiveMemory(selectedDetail.itemUid);
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to archive memory');
      }

      setMessage(`Archived ${response.data.title}.`);
      await refreshSelectedMemory(response.data.itemUid);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive memory');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCreateMemory() {
    setCreatingMemory(true);
    setError(null);
    setMessage(null);

    try {
      const response = await window.vaultAPI.saveMemory({
        project: composerDraft.project.trim(),
        title: composerDraft.title.trim(),
        memoryType: composerDraft.memoryType,
        subject: composerDraft.subject.trim(),
        summary: composerDraft.summary.trim(),
        content: composerDraft.content.trim() || undefined,
        status: composerDraft.status,
        priority: composerDraft.priority,
        routineType: composerDraft.routineType.trim() || undefined,
        tags: parseTagLikeList(composerDraft.tagsText),
        keywords: parseTagLikeList(composerDraft.keywordsText),
        nextSteps: parseLineList(composerDraft.nextStepsText),
        relatedItemIds: parseFlexibleList(composerDraft.relatedItemIdsText),
        relatedFiles: parseFlexibleList(composerDraft.relatedFilesText),
        sourceApp: 'manual',
      });

      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to save memory');
      }

      const savedItem = response.data.item;
      setMessage(`Saved new ${savedItem.memoryType} memory: ${savedItem.title}.`);
      setComposerDraft(buildInitialComposerDraft(savedItem.project));
      setActiveMode('browse');
      await fetchMemories(savedItem.itemUid);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save memory');
    } finally {
      setCreatingMemory(false);
    }
  }

  function resetDraft() {
    if (!selectedDetail) {
      return;
    }

    setDraft(buildDraft(selectedDetail));
    setMessage('Draft reset to the stored memory values.');
    setError(null);
  }

  function resetComposerDraft() {
    setComposerDraft(buildInitialComposerDraft(composerDraft.project.trim()));
    setMessage('New memory composer reset.');
    setError(null);
  }

  function addRelatedMemoryToComposer(itemUid: string) {
    setComposerDraft((current) => {
      const existingIds = parseFlexibleList(current.relatedItemIdsText);
      if (existingIds.includes(itemUid)) {
        return current;
      }

      return {
        ...current,
        relatedItemIdsText: [...existingIds, itemUid].join('\n'),
      };
    });
    setMessage('Added the similar memory as an explicit relation in the draft.');
    setError(null);
  }

  const projectOptions = projectOptionsFromMemories(memories);
  const visibleMemories = memories.filter((memory) => {
    const haystack = [
      memory.title,
      memory.subject,
      memory.summary,
      ...memory.tags,
      ...memory.keywords,
    ]
      .join(' ')
      .toLowerCase();

    const matchesSearch = !search.trim() || haystack.includes(search.trim().toLowerCase());
    const matchesProject = projectFilter === 'all' || memory.project === projectFilter;
    const matchesStatus = statusFilter === 'all' || memory.status === statusFilter;

    return matchesSearch && matchesProject && matchesStatus;
  });
  const relatedMemoryMap = useMemo(
    () => new Map(memories.map((memory) => [memory.itemUid, memory])),
    [memories],
  );
  const composerQualityHints = useMemo(
    () => getComposerQualityHints(composerDraft, similarMemories),
    [composerDraft, similarMemories],
  );
  const strongestComposerMatch = similarMemories[0] || null;
  const composerCanSave = Boolean(
    composerDraft.project.trim()
    && composerDraft.title.trim()
    && composerDraft.subject.trim()
    && composerDraft.summary.trim(),
  );
  const promotedVisibleCount = visibleMemories.filter((memory) => memory.promoted).length;
  const draftVisibleCount = visibleMemories.filter((memory) => memory.status === 'draft').length;

  return (
    <div className="memory-layout">
      <section className="section-intro">
        <div className="section-intro-copy">
          <span className="section-intro-eyebrow">Memory Bank</span>
          <div className="section-intro-title">Write cleaner memories and browse them without drowning in the backlog</div>
          <p className="section-intro-text">Creation stays at the top, browsing stays grouped by day, and detail editing remains on the right so the page reads like one workflow instead of three competing screens.</p>
        </div>
        <div className="section-intro-meta">
          <span className="section-intro-chip">structured save</span>
          <span className="section-intro-chip">duplicate hints</span>
          <span className="section-intro-chip">daily browse groups</span>
        </div>
      </section>

      <div className="page-mode-strip">
        <button
          type="button"
          className={`page-mode-button ${activeMode === 'browse' ? 'page-mode-button-active' : ''}`}
          onClick={() => setActiveMode('browse')}
        >
          <div className="page-mode-heading">
            <span className="page-mode-label">Browse and curate</span>
            <span className="page-mode-meta">{visibleMemories.length} visible</span>
          </div>
          <span className="page-mode-description">Search the bank, review daily groups, and edit one selected memory at a time.</span>
        </button>

        <button
          type="button"
          className={`page-mode-button ${activeMode === 'create' ? 'page-mode-button-active' : ''}`}
          onClick={() => setActiveMode('create')}
        >
          <div className="page-mode-heading">
            <span className="page-mode-label">Create new memory</span>
            <span className="page-mode-meta">{composerCanSave ? 'ready to save' : 'draft'}</span>
          </div>
          <span className="page-mode-description">Write one structured memory cleanly, check duplicates, and preview the final saved path before committing.</span>
        </button>
      </div>

      {error ? <div className="panel empty-state empty-state-error">{error}</div> : null}
      {message ? <div className="panel note-card success-text">{message}</div> : null}

      {activeMode === 'create' ? (
        <section className="panel settings-section">
          <div className="panel-header">
            <div>
              <div className="panel-title">Structured save composer</div>
              <div className="panel-subtitle">Create high-quality memory with project, type, summary, tags, next steps, and file context without relying on command syntax.</div>
            </div>
          </div>

          <div className="field-grid">
            <div className="detail-grid">
              <label className="field-row">
                <span className="field-label">Project</span>
                <input
                  className="text-input"
                  value={composerDraft.project}
                  onChange={(event) => setComposerDraft((current) => ({ ...current, project: event.target.value }))}
                  placeholder={projectOptions[0] || 'vault'}
                  list="vault-project-options"
                />
              </label>

              <label className="field-row">
                <span className="field-label">Memory type</span>
                <select
                  className="text-input"
                  value={composerDraft.memoryType}
                  onChange={(event) => setComposerDraft((current) => ({ ...current, memoryType: event.target.value as VaultMemoryType }))}
                >
                  {MEMORY_TYPE_OPTIONS.map((memoryType) => (
                    <option key={memoryType} value={memoryType}>
                      {memoryType}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field-row">
                <span className="field-label">Status</span>
                <select
                  className="text-input"
                  value={composerDraft.status}
                  onChange={(event) => setComposerDraft((current) => ({ ...current, status: event.target.value as VaultStatusValue }))}
                >
                  <option value="active">active</option>
                  <option value="resolved">resolved</option>
                  <option value="draft">draft</option>
                  <option value="archived">archived</option>
                  <option value="promoted">promoted</option>
                </select>
              </label>

              <label className="field-row">
                <span className="field-label">Priority</span>
                <select
                  className="text-input"
                  value={composerDraft.priority}
                  onChange={(event) => setComposerDraft((current) => ({ ...current, priority: event.target.value as VaultPriorityValue }))}
                >
                  <option value="low">low</option>
                  <option value="normal">normal</option>
                  <option value="high">high</option>
                  <option value="critical">critical</option>
                  <option value="canonical">canonical</option>
                </select>
              </label>
            </div>

            <label className="field-row">
              <span className="field-label">Title</span>
              <input
                className="text-input"
                value={composerDraft.title}
                onChange={(event) => setComposerDraft((current) => ({ ...current, title: event.target.value }))}
                placeholder="Auth middleware decision for desktop recall flow"
              />
            </label>

            <label className="field-row">
              <span className="field-label">Subject</span>
              <input
                className="text-input"
                value={composerDraft.subject}
                onChange={(event) => setComposerDraft((current) => ({ ...current, subject: event.target.value }))}
                placeholder="desktop auth middleware"
              />
            </label>

            <label className="field-row">
              <span className="field-label">Summary</span>
              <textarea
                className="text-area-input"
                rows={4}
                value={composerDraft.summary}
                onChange={(event) => setComposerDraft((current) => ({ ...current, summary: event.target.value }))}
                placeholder="Concise reusable description of the decision, summary, bug result, or handoff."
              />
            </label>

            <label className="field-row">
              <span className="field-label">Content body</span>
              <textarea
                className="text-area-input"
                rows={6}
                value={composerDraft.content}
                onChange={(event) => setComposerDraft((current) => ({ ...current, content: event.target.value }))}
                placeholder="Optional longer note, implementation detail, or handoff body."
              />
            </label>

            <div className="detail-grid">
              <label className="field-row">
                <span className="field-label">Routine type</span>
                <select
                  className="text-input"
                  value={composerDraft.routineType}
                  onChange={(event) => setComposerDraft((current) => ({ ...current, routineType: event.target.value }))}
                >
                  {ROUTINE_TYPE_OPTIONS.map((option) => (
                    <option key={option || 'none'} value={option}>
                      {option || 'none'}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field-row">
                <span className="field-label">Tags</span>
                <input
                  className="text-input"
                  value={composerDraft.tagsText}
                  onChange={(event) => setComposerDraft((current) => ({ ...current, tagsText: event.target.value }))}
                  placeholder="auth, bug, desktop"
                />
              </label>

              <label className="field-row">
                <span className="field-label">Keywords</span>
                <input
                  className="text-input"
                  value={composerDraft.keywordsText}
                  onChange={(event) => setComposerDraft((current) => ({ ...current, keywordsText: event.target.value }))}
                  placeholder="login, redirect, middleware"
                />
              </label>
            </div>

            <label className="field-row">
              <span className="field-label">Next steps</span>
              <textarea
                className="text-area-input"
                rows={4}
                value={composerDraft.nextStepsText}
                onChange={(event) => setComposerDraft((current) => ({ ...current, nextStepsText: event.target.value }))}
                placeholder={'Validate desktop flow with Codex backend\nPromote if this becomes the stable convention'}
              />
              <span className="field-help">One follow-up action per line.</span>
            </label>

            <label className="field-row">
              <span className="field-label">Related memory UIDs</span>
              <textarea
                className="text-area-input"
                rows={3}
                value={composerDraft.relatedItemIdsText}
                onChange={(event) => setComposerDraft((current) => ({ ...current, relatedItemIdsText: event.target.value }))}
                placeholder={'vault-abc123\nvault-def456'}
              />
              <span className="field-help">Link this draft to an existing memory when it extends, supersedes, or depends on that earlier item.</span>
            </label>

            <label className="field-row">
              <span className="field-label">Related files</span>
              <textarea
                className="text-area-input"
                rows={4}
                value={composerDraft.relatedFilesText}
                onChange={(event) => setComposerDraft((current) => ({ ...current, relatedFilesText: event.target.value }))}
                placeholder={'packages/desktop/src/components/ChatView.tsx\npackages/core/src/services/retrieve.service.ts'}
              />
              <span className="field-help">Use one file per line or a comma-separated list.</span>
            </label>

            <div className="inline-actions">
              <button
                type="button"
                className="primary-button"
                onClick={() => void handleCreateMemory()}
                disabled={creatingMemory || !composerCanSave}
              >
                <Save size={16} />
                <span>{creatingMemory ? 'Saving...' : 'Save new memory'}</span>
              </button>
              <button
                type="button"
                className="header-button"
                onClick={resetComposerDraft}
                disabled={creatingMemory}
              >
                <RefreshCw size={16} />
                <span>Reset composer</span>
              </button>
            </div>

            {composerPathPreview ? (
              <div className="snippet-card">
                <div className="snippet-head">
                  <div>
                    <div className="field-label">Save path preview</div>
                    <div className="field-help">Vault will store this memory as Markdown in a deterministic path built from project, type, and title.</div>
                  </div>
                </div>
                <pre className="snippet-block">{composerPathPreview}</pre>
              </div>
            ) : (
              <div className="note-card">
                <p>Enter at least a project and title to preview the final Markdown path.</p>
              </div>
            )}

            <div className="detail-section">
              <div className="detail-section-title">
                <Search size={16} />
                <span>Duplicate and similarity check</span>
              </div>

              {strongestComposerMatch && strongestComposerMatch.similarity >= 0.92 ? (
                <div className="note-card">
                  <p>This draft looks like an update to an existing memory, not a brand new one.</p>
                  <div className="inline-actions">
                    <button
                      type="button"
                      className="header-button"
                      onClick={() => void handleSelectMemory(strongestComposerMatch.itemUid)}
                    >
                      <span>Open strongest match</span>
                    </button>
                    <button
                      type="button"
                      className="header-button"
                      onClick={() => addRelatedMemoryToComposer(strongestComposerMatch.itemUid)}
                    >
                      <span>Link strongest match</span>
                    </button>
                  </div>
                </div>
              ) : null}

              {detectingSimilar ? (
                <div className="note-card">
                  <p>Checking the current project for similar memory so you do not save the same context twice.</p>
                </div>
              ) : similarMemories.length > 0 ? (
                <div className="memory-card-list">
                  {similarMemories.map((match) => (
                    <button
                      key={match.itemUid}
                      type="button"
                      className="memory-card"
                      onClick={() => void handleSelectMemory(match.itemUid)}
                    >
                      <div className="memory-card-header">
                        <div>
                          <div className="memory-card-project">{match.project}</div>
                          <div className="memory-card-title">{match.title}</div>
                        </div>
                        <span className="badge">{formatSimilarity(match.similarity)} match</span>
                      </div>
                      <div className="memory-row-summary">{match.summary}</div>
                      <div className="memory-card-footer">
                        <span>{match.memoryType}</span>
                        <span>{match.subject}</span>
                      </div>
                      <div className="inline-actions">
                        <button
                          type="button"
                          className="header-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleSelectMemory(match.itemUid);
                          }}
                        >
                          <span>Open existing</span>
                        </button>
                        <button
                          type="button"
                          className="header-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            addRelatedMemoryToComposer(match.itemUid);
                          }}
                        >
                          <span>Link to draft</span>
                        </button>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="note-card">
                  <p>No close match was found from the current project sample. Save quality still depends on title, summary, tags, and file context.</p>
                </div>
              )}
            </div>

            <div className="detail-section">
              <div className="detail-section-title">
                <Sparkles size={16} />
                <span>Save quality hints</span>
              </div>
              <div className="adapter-check-list">
                {composerQualityHints.map((hint) => (
                  <div key={`${hint.level}-${hint.message}`} className={`adapter-check adapter-check-${hint.level}`}>
                    <div className="adapter-check-head">
                      <span className="badge">{hint.level}</span>
                      <strong>{hint.message}</strong>
                    </div>
                    {hint.detail ? <p>{hint.detail}</p> : null}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <datalist id="vault-project-options">
            {projectOptions.map((project) => (
              <option key={project} value={project} />
            ))}
          </datalist>
        </section>
      ) : (
        <>
          <div className="stats-strip">
            <div className="stat-chip">
              <span className="stat-label">Visible results</span>
              <strong className="stat-value">{visibleMemories.length}</strong>
            </div>
            <div className="stat-chip">
              <span className="stat-label">Promoted in view</span>
              <strong className="stat-value">{promotedVisibleCount}</strong>
            </div>
            <div className="stat-chip">
              <span className="stat-label">Drafts in view</span>
              <strong className="stat-value">{draftVisibleCount}</strong>
            </div>
          </div>

          <div className="panel">
            <div className="toolbar-row">
              <label className="search-field">
                <Search size={16} />
                <input
                  type="text"
                  placeholder="Search titles, subjects, summaries, tags, and keywords"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>

              <label className="select-field">
                <Filter size={16} />
                <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
                  <option value="all">All projects</option>
                  {projectOptions.map((project) => (
                    <option key={project} value={project}>
                      {project}
                    </option>
                  ))}
                </select>
              </label>

              <label className="select-field">
                <Database size={16} />
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | VaultStatusValue)}>
                  <option value="all">All states</option>
                  <option value="active">active</option>
                  <option value="resolved">resolved</option>
                  <option value="draft">draft</option>
                  <option value="archived">archived</option>
                  <option value="promoted">promoted</option>
                </select>
              </label>

              <button type="button" className="header-button" onClick={() => void fetchMemories(selectedUid || undefined)}>
                <RefreshCw size={16} />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          <div className="memory-results">
            <div className="memory-results-grid panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Stored memories</div>
                  <div className="panel-subtitle">{visibleMemories.length} results in the current view.</div>
                </div>
              </div>

              {loading ? (
                <div className="empty-state">Loading memory bank...</div>
              ) : visibleMemories.length === 0 ? (
                <div className="empty-state">No memories match the current filters.</div>
              ) : (
                <DayGroupedList
                  items={visibleMemories}
                  getDate={(memory) => memory.createdAt}
                  getKey={(memory) => memory.itemUid}
                  emptyMessage="No memories match the current filters."
                  renderItem={(memory) => (
                    <button
                      type="button"
                      className={`memory-card ${selectedUid === memory.itemUid ? 'memory-card-active' : ''}`}
                      onClick={() => void handleSelectMemory(memory.itemUid)}
                    >
                      <div className="memory-card-header">
                        <span className={`badge badge-${memory.memoryType}`}>{memory.memoryType}</span>
                        <span className="memory-card-project">{memory.project}</span>
                      </div>

                      <div className="memory-card-title">{memory.title}</div>
                      <div className="memory-card-summary">{memory.summary}</div>

                      <div className="chip-row">
                        {memory.tags.slice(0, 3).map((tag: string) => (
                          <span key={tag} className="chip">
                            {tag}
                          </span>
                        ))}
                        {memory.promoted ? <span className="chip chip-accent">promoted</span> : null}
                      </div>

                      <div className="memory-card-footer">
                        <span>{memory.status}</span>
                        <span>{formatDistanceToNow(new Date(memory.createdAt))} ago</span>
                      </div>
                    </button>
                  )}
                />
              )}
            </div>

            <aside className="detail-panel panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Memory detail</div>
                  <div className="panel-subtitle">Inspect, edit, promote, or archive the selected record.</div>
                </div>
              </div>

              {detailLoading ? (
                <div className="empty-state">Loading selected memory...</div>
              ) : !selectedDetail || !draft ? (
                <div className="empty-state">Select a memory to inspect its details.</div>
              ) : (
                <div className="detail-stack">
              <div className="detail-headline">
                <span className={`badge badge-${selectedDetail.memoryType}`}>{selectedDetail.memoryType}</span>
                <h3>{selectedDetail.title}</h3>
                <p>
                  {selectedDetail.promoted
                    ? 'This item is promoted and should receive stronger recall priority.'
                    : 'Use this panel to curate the stored memory rather than leaving structure quality to chance.'}
                </p>
              </div>

              <div className="inline-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void handleSaveChanges()}
                  disabled={busyAction !== null}
                >
                  <Save size={16} />
                  <span>{busyAction === 'save' ? 'Saving...' : 'Save changes'}</span>
                </button>
                <button
                  type="button"
                  className="header-button"
                  onClick={resetDraft}
                  disabled={busyAction !== null}
                >
                  <RefreshCw size={16} />
                  <span>Reset draft</span>
                </button>
                <button
                  type="button"
                  className="header-button"
                  onClick={() => void handlePromote()}
                  disabled={busyAction !== null || selectedDetail.promoted}
                >
                  <Sparkles size={16} />
                  <span>{busyAction === 'promote' ? 'Promoting...' : selectedDetail.promoted ? 'Promoted' : 'Promote'}</span>
                </button>
                <button
                  type="button"
                  className="header-button"
                  onClick={() => void handleDemote()}
                  disabled={busyAction !== null || !selectedDetail.promoted}
                >
                  <Sparkles size={16} />
                  <span>{busyAction === 'demote' ? 'Demoting...' : 'Demote'}</span>
                </button>
                <button
                  type="button"
                  className="header-button"
                  onClick={() => void handleArchive()}
                  disabled={busyAction !== null || selectedDetail.status === 'archived'}
                >
                  <Archive size={16} />
                  <span>{busyAction === 'archive' ? 'Archiving...' : selectedDetail.status === 'archived' ? 'Archived' : 'Archive'}</span>
                </button>
              </div>

              <div className="detail-grid">
                <div className="detail-block">
                  <span className="detail-label">Project</span>
                  <strong>{selectedDetail.project}</strong>
                </div>
                <div className="detail-block">
                  <span className="detail-label">Source app</span>
                  <strong>{selectedDetail.sourceApp}</strong>
                </div>
                <div className="detail-block">
                  <span className="detail-label">Routine type</span>
                  <strong>{selectedDetail.routineType || 'none'}</strong>
                </div>
                <div className="detail-block">
                  <span className="detail-label">Created</span>
                  <strong>{formatDistanceToNow(new Date(selectedDetail.createdAt))} ago</strong>
                </div>
                <div className="detail-block">
                  <span className="detail-label">Updated</span>
                  <strong>{formatDistanceToNow(new Date(selectedDetail.updatedAt))} ago</strong>
                </div>
                <div className="detail-block">
                  <span className="detail-label">Access count</span>
                  <strong>{selectedDetail.accessCount}</strong>
                </div>
                <div className="detail-block">
                  <span className="detail-label">Memory UID</span>
                  <strong className="text-mono">{selectedDetail.itemUid}</strong>
                </div>
              </div>

              {(artifactPreviewLoading || artifactPreview?.imageDataUrl) ? (
                <div className="detail-section">
                  <div className="detail-section-title">
                    <Database size={16} />
                    <span>Artifact preview</span>
                  </div>
                  {artifactPreviewLoading ? (
                    <p>Loading artifact preview...</p>
                  ) : artifactPreview?.imageDataUrl ? (
                    <div className="detail-stack">
                      <img
                        className="task-image-preview"
                        src={artifactPreview.imageDataUrl}
                        alt={selectedDetail.title}
                      />
                      <div className="detail-path text-mono">{artifactPreview.absolutePath}</div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="detail-section">
                <div className="detail-section-title">
                  <Database size={16} />
                  <span>Core fields</span>
                </div>
                <div className="field-grid">
                  <label className="field-row">
                    <span className="field-label">Title</span>
                    <input
                      className="text-input"
                      value={draft.title}
                      onChange={(event) => setDraft((current) => current ? { ...current, title: event.target.value } : current)}
                    />
                  </label>

                  <label className="field-row">
                    <span className="field-label">Subject</span>
                    <input
                      className="text-input"
                      value={draft.subject}
                      onChange={(event) => setDraft((current) => current ? { ...current, subject: event.target.value } : current)}
                    />
                  </label>

                  <label className="field-row">
                    <span className="field-label">Summary</span>
                    <textarea
                      className="text-area-input"
                      rows={4}
                      value={draft.summary}
                      onChange={(event) => setDraft((current) => current ? { ...current, summary: event.target.value } : current)}
                    />
                  </label>

                  <label className="field-row">
                    <span className="field-label">Content body</span>
                    <textarea
                      className="text-area-input"
                      rows={8}
                      value={draft.content}
                      onChange={(event) => setDraft((current) => current ? { ...current, content: event.target.value } : current)}
                    />
                    <span className="field-help">This is the reusable content field that Vault persists into both the registry and the Markdown file.</span>
                  </label>
                </div>
              </div>

              <div className="detail-section">
                <div className="detail-section-title">
                  <Tags size={16} />
                  <span>Classification</span>
                </div>
                <div className="field-grid">
                  <div className="detail-grid">
                    <label className="field-row">
                      <span className="field-label">Status</span>
                      <select
                        className="text-input"
                        value={draft.status}
                        onChange={(event) => setDraft((current) => current ? { ...current, status: event.target.value as VaultStatusValue } : current)}
                      >
                        <option value="active">active</option>
                        <option value="resolved">resolved</option>
                        <option value="draft">draft</option>
                        <option value="archived">archived</option>
                        <option value="promoted">promoted</option>
                      </select>
                    </label>

                    <label className="field-row">
                      <span className="field-label">Priority</span>
                      <select
                        className="text-input"
                        value={draft.priority}
                        onChange={(event) => setDraft((current) => current ? { ...current, priority: event.target.value as VaultPriorityValue } : current)}
                      >
                        <option value="low">low</option>
                        <option value="normal">normal</option>
                        <option value="high">high</option>
                        <option value="critical">critical</option>
                        <option value="canonical">canonical</option>
                      </select>
                    </label>

                    <label className="field-row">
                      <span className="field-label">Routine type</span>
                      <select
                        className="text-input"
                        value={draft.routineType}
                        onChange={(event) => setDraft((current) => current ? { ...current, routineType: event.target.value } : current)}
                      >
                        {ROUTINE_TYPE_OPTIONS.map((option) => (
                          <option key={option || 'none'} value={option}>
                            {option || 'none'}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <label className="field-row">
                    <span className="field-label">Tags</span>
                    <input
                      className="text-input"
                      value={draft.tagsText}
                      onChange={(event) => setDraft((current) => current ? { ...current, tagsText: event.target.value } : current)}
                      placeholder="auth, bug, ui"
                    />
                    <span className="field-help">Comma-separated classification labels.</span>
                  </label>

                  <label className="field-row">
                    <span className="field-label">Keywords</span>
                    <input
                      className="text-input"
                      value={draft.keywordsText}
                      onChange={(event) => setDraft((current) => current ? { ...current, keywordsText: event.target.value } : current)}
                      placeholder="login, redirect, middleware"
                    />
                    <span className="field-help">Comma-separated search terms used during recall.</span>
                  </label>

                  <label className="field-row">
                    <span className="field-label">Next steps</span>
                    <textarea
                      className="text-area-input"
                      rows={4}
                      value={draft.nextStepsText}
                      onChange={(event) => setDraft((current) => current ? { ...current, nextStepsText: event.target.value } : current)}
                      placeholder={'Investigate auth middleware ordering\nValidate fix in desktop app'}
                    />
                    <span className="field-help">One next step per line.</span>
                  </label>
                </div>
              </div>

              <div className="detail-section">
                <div className="detail-section-title">
                  <Link2 size={16} />
                  <span>Relations and file context</span>
                </div>
                <div className="field-grid">
                  <label className="field-row">
                    <span className="field-label">Related memory UIDs</span>
                    <textarea
                      className="text-area-input"
                      rows={4}
                      value={draft.relatedItemIdsText}
                      onChange={(event) => setDraft((current) => current ? { ...current, relatedItemIdsText: event.target.value } : current)}
                      placeholder={'vault-abc123\nvault-def456'}
                    />
                    <span className="field-help">Use one UID per line or a comma-separated list. These links stay with the memory item.</span>
                  </label>

                  {selectedDetail.relatedItemIds.length > 0 ? (
                    <div className="detail-block">
                      <span className="detail-label">Resolved related memories</span>
                      <div className="chip-row">
                        {selectedDetail.relatedItemIds.map((itemUid) => {
                          const relatedMemory = relatedMemoryMap.get(itemUid);
                          return (
                            <button
                              key={itemUid}
                              type="button"
                              className="chip"
                              onClick={() => {
                                if (relatedMemory) {
                                  void handleSelectMemory(relatedMemory.itemUid);
                                }
                              }}
                              disabled={!relatedMemory}
                            >
                              {relatedMemory ? relatedMemory.title : itemUid}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  <label className="field-row">
                    <span className="field-label">Related files</span>
                    <textarea
                      className="text-area-input"
                      rows={4}
                      value={draft.relatedFilesText}
                      onChange={(event) => setDraft((current) => current ? { ...current, relatedFilesText: event.target.value } : current)}
                      placeholder={'packages/desktop/src/components/MemoryView.tsx\npackages/core/src/services/retrieve.service.ts'}
                    />
                    <span className="field-help">Store touched files or code references here so future sessions can reopen the right area faster.</span>
                  </label>

                  {selectedDetail.relatedFiles.length > 0 ? (
                    <div className="detail-block">
                      <span className="detail-label">Stored file references</span>
                      <div className="chip-row">
                        {selectedDetail.relatedFiles.map((filePath) => (
                          <button
                            key={filePath}
                            type="button"
                            className={`chip ${selectedArtifactPath === filePath ? '' : 'chip-muted'}`}
                            onClick={() => setSelectedArtifactPath(filePath)}
                          >
                            {filePath}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="detail-section">
                <div className="detail-section-title">
                  <Clock3 size={16} />
                  <span>Stored content preview</span>
                </div>
                <div className="detail-content">
                  {selectedDetail.fileContent || selectedDetail.content || 'No file-backed content is stored for this memory.'}
                </div>
              </div>

              {selectedDetail.vaultPath ? (
                <div className="detail-section">
                  <div className="detail-section-title">
                    <Database size={16} />
                    <span>Vault path</span>
                  </div>
                  <div className="detail-path text-mono">{selectedDetail.vaultPath}</div>
                </div>
              ) : null}
                </div>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

function buildDraft(detail: VaultMemoryDetail): MemoryDraft {
  return {
    title: detail.title,
    subject: detail.subject,
    summary: detail.summary,
    content: detail.content || '',
    status: detail.status,
    priority: detail.priority,
    routineType: detail.routineType || '',
    tagsText: detail.tags.join(', '),
    keywordsText: detail.keywords.join(', '),
    nextStepsText: detail.nextSteps.join('\n'),
    relatedItemIdsText: detail.relatedItemIds.join('\n'),
    relatedFilesText: detail.relatedFiles.join('\n'),
  };
}

function parseTagLikeList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseLineList(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseFlexibleList(value: string): string[] {
  return value
    .split(/[\r\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildInitialComposerDraft(project = ''): SaveComposerDraft {
  return {
    project,
    title: '',
    memoryType: 'session',
    subject: '',
    summary: '',
    content: '',
    status: 'active',
    priority: 'normal',
    routineType: '',
    tagsText: '',
    keywordsText: '',
    nextStepsText: '',
    relatedItemIdsText: '',
    relatedFilesText: '',
  };
}

function getInitialArtifactPreviewPath(detail: VaultMemoryDetail): string | null {
  const imagePath = detail.relatedFiles.find(isImageFilePath);
  if (imagePath) {
    return imagePath;
  }

  return detail.relatedFiles[0] || null;
}

function isImageFilePath(filePath: string): boolean {
  return /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(filePath);
}

function projectOptionsFromMemories(memories: VaultMemory[]): string[] {
  return [...new Set(memories.map((memory) => memory.project))].sort();
}

function getComposerQualityHints(
  draft: SaveComposerDraft,
  similarMemories: VaultSimilarMemoryMatch[],
): ComposerHint[] {
  const hints: ComposerHint[] = [];
  const title = draft.title.trim();
  const subject = draft.subject.trim();
  const summary = draft.summary.trim();
  const keywords = parseTagLikeList(draft.keywordsText);
  const tags = parseTagLikeList(draft.tagsText);
  const nextSteps = parseLineList(draft.nextStepsText);
  const relatedFiles = parseFlexibleList(draft.relatedFilesText);

  if (!draft.project.trim()) {
    hints.push({
      level: 'fail',
      message: 'Project is required.',
      detail: 'Project is the first routing key for both path structure and recall precision.',
    });
  } else {
    hints.push({
      level: 'pass',
      message: `Project routing is set to ${draft.project.trim()}.`,
    });
  }

  if (title.length < 8 || /^(note|update|fix|misc|memory)$/i.test(title)) {
    hints.push({
      level: 'warn',
      message: 'Title is still vague.',
      detail: 'Use a specific title that names the bug, decision, feature, or handoff so the memory is easier to recall later.',
    });
  } else {
    hints.push({
      level: 'pass',
      message: 'Title looks specific enough for pathing and recall.',
    });
  }

  if (subject.length < 6) {
    hints.push({
      level: 'warn',
      message: 'Subject is too short.',
      detail: 'The subject should name the main topic directly, not just repeat a generic title.',
    });
  }

  if (summary.length < 30) {
    hints.push({
      level: 'warn',
      message: 'Summary is short.',
      detail: 'A stronger summary reduces future context usage because recall can surface the point of the memory without reopening the whole file.',
    });
  } else {
    hints.push({
      level: 'pass',
      message: 'Summary is long enough to be useful during recall.',
    });
  }

  if (keywords.length < 2) {
    hints.push({
      level: 'warn',
      message: 'Add more keywords.',
      detail: 'Two to five precise keywords usually improve low-context retrieval significantly.',
    });
  }

  if (tags.length === 0) {
    hints.push({
      level: 'warn',
      message: 'No tags yet.',
      detail: 'Controlled tags make filtering and later cleanup easier.',
    });
  }

  if ((draft.status === 'active' || draft.status === 'draft') && nextSteps.length === 0) {
    hints.push({
      level: 'warn',
      message: 'Unfinished work has no next steps.',
      detail: 'If the work is still active or draft, next steps help the next session continue without rediscovery.',
    });
  }

  if ((draft.memoryType === 'decision' || draft.memoryType === 'plan' || draft.memoryType === 'artifact') && relatedFiles.length === 0) {
    hints.push({
      level: 'warn',
      message: 'Consider adding related files.',
      detail: 'File references reduce future search cost when this memory is used during implementation.',
    });
  }

  const strongestMatch = similarMemories[0];
  if (strongestMatch && strongestMatch.similarity >= 0.92) {
    hints.push({
      level: 'warn',
      message: 'A very similar memory already exists.',
      detail: `Open ${strongestMatch.title} first. If this save is still valid, make the title or summary state what changed so recall can distinguish the two items.`,
    });
  } else if (strongestMatch && strongestMatch.similarity >= 0.75) {
    hints.push({
      level: 'warn',
      message: 'This draft overlaps with an existing memory.',
      detail: `Review ${strongestMatch.title} before saving so you can merge or clarify instead of creating parallel notes.`,
    });
  } else {
    hints.push({
      level: 'pass',
      message: 'No high-overlap memory was detected in the current project sample.',
    });
  }

  return hints;
}

function formatSimilarity(value: number): string {
  return `${Math.round(value * 100)}%`;
}
