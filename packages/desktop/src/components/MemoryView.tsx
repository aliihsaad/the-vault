import { useEffect, useMemo, useState } from 'react';
import { Archive, Clock3, Database, FileText, Filter, Link2, Pencil, RefreshCw, Save, Search, Sparkles, Tags, X } from 'lucide-react';
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
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    void fetchMemories();
  }, []);

  useEffect(() => {
    setIsEditing(false);
  }, [selectedUid]);

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
      setIsEditing(false);
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
      <header className="mb-intro">
        <span className="mb-intro-eyebrow">Memory Bank</span>
        <h1 className="mb-intro-title">Curate the recall surface</h1>
        <p className="mb-intro-text">Browse the bank or compose a new structured memory. Selection stays single-focus on the right.</p>
      </header>

      <nav className="mb-tabs" role="tablist" aria-label="Memory bank mode">
        <button
          type="button"
          role="tab"
          aria-selected={activeMode === 'browse'}
          className={`mb-tab ${activeMode === 'browse' ? 'mb-tab-active' : ''}`}
          onClick={() => setActiveMode('browse')}
        >
          <span>Browse</span>
          <span className="mb-tab-count">{visibleMemories.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeMode === 'create'}
          className={`mb-tab ${activeMode === 'create' ? 'mb-tab-active' : ''}`}
          onClick={() => setActiveMode('create')}
        >
          <span>Create</span>
          <span className="mb-tab-count">{composerCanSave ? 'ready' : 'draft'}</span>
        </button>
      </nav>

      {error ? <div className="mb-banner mb-banner-error">{error}</div> : null}
      {message ? <div className="mb-banner mb-banner-success">{message}</div> : null}

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
          <div className="mb-toolbar">
            <label className="mb-search">
              <Search size={16} />
              <input
                type="text"
                placeholder="Search titles, subjects, summaries, tags, keywords"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>

            <div className="mb-toolbar-divider" aria-hidden="true" />

            <label className="mb-pill-select">
              <Filter size={14} />
              <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
                <option value="all">All projects</option>
                {projectOptions.map((project) => (
                  <option key={project} value={project}>
                    {project}
                  </option>
                ))}
              </select>
            </label>

            <label className="mb-pill-select">
              <Database size={14} />
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | VaultStatusValue)}>
                <option value="all">All states</option>
                <option value="active">active</option>
                <option value="resolved">resolved</option>
                <option value="draft">draft</option>
                <option value="archived">archived</option>
                <option value="promoted">promoted</option>
              </select>
            </label>

            <button type="button" className="mb-icon-button" onClick={() => void fetchMemories(selectedUid || undefined)}>
              <RefreshCw size={14} />
              <span>Refresh</span>
            </button>
          </div>

          <div className="mb-toolbar-meta">
            <span><strong>{visibleMemories.length}</strong> visible</span>
            <span><strong>{promotedVisibleCount}</strong> promoted</span>
            <span><strong>{draftVisibleCount}</strong> drafts</span>
          </div>

          <div className="mb-results">
            <div className="mb-list-panel">
              <div className="mb-list-header">
                <span className="mb-list-header-title">Stored memories</span>
                <span className="mb-list-header-title">{visibleMemories.length} results</span>
              </div>

              {loading ? (
                <div className="mb-empty">Loading memory bank...</div>
              ) : visibleMemories.length === 0 ? (
                <div className="mb-empty">
                  <span className="mb-empty-title">Nothing matches yet</span>
                  Try a different search term or clear the project / status filter.
                </div>
              ) : (
                <div className="mb-list-scroll">
                  <DayGroupedList
                    items={visibleMemories}
                    getDate={(memory) => memory.createdAt}
                    getKey={(memory) => memory.itemUid}
                    emptyMessage="No memories match the current filters."
                    renderItem={(memory) => (
                      <button
                        type="button"
                        className={`mb-card ${selectedUid === memory.itemUid ? 'mb-card-active' : ''}`}
                        onClick={() => void handleSelectMemory(memory.itemUid)}
                      >
                        <div className="mb-card-top">
                          <span className={`badge badge-${memory.memoryType}`}>{memory.memoryType}</span>
                          <span className="mb-card-divider">·</span>
                          <span className="mb-card-project">{memory.project}</span>
                          <span className="mb-card-time">{formatDistanceToNow(new Date(memory.createdAt))} ago</span>
                        </div>

                        <div className="mb-card-title">{memory.title}</div>
                        <div className="mb-card-summary">{memory.summary}</div>

                        <div className="mb-card-footer">
                          {memory.tags.slice(0, 3).map((tag: string) => (
                            <span key={tag} className="mb-card-tag">{tag}</span>
                          ))}
                          {memory.promoted ? (
                            <span className="mb-card-promoted">
                              <Sparkles size={11} />
                              promoted
                            </span>
                          ) : null}
                          <span className="mb-card-status">{memory.status}</span>
                        </div>
                      </button>
                    )}
                  />
                </div>
              )}
            </div>

            <aside className="mb-detail-panel">
              {detailLoading ? (
                <div className="mb-empty">Loading selected memory...</div>
              ) : !selectedDetail || !draft ? (
                <div className="mb-empty">
                  <span className="mb-empty-title">Nothing selected</span>
                  Pick a memory from the list to inspect its content.
                </div>
              ) : isEditing ? (
                <>
                  <div className="mb-detail-head">
                    <div className="mb-detail-meta-row">
                      <span className={`badge badge-${selectedDetail.memoryType}`}>{selectedDetail.memoryType}</span>
                      <span className="mb-card-project">{selectedDetail.project}</span>
                      <div className="mb-detail-actions">
                        <button
                          type="button"
                          className="mb-icon-button mb-icon-button-primary"
                          onClick={() => void handleSaveChanges()}
                          disabled={busyAction !== null}
                        >
                          <Save size={14} />
                          <span>{busyAction === 'save' ? 'Saving...' : 'Save'}</span>
                        </button>
                        <button
                          type="button"
                          className="mb-icon-button"
                          onClick={() => { resetDraft(); setIsEditing(false); }}
                          disabled={busyAction !== null}
                        >
                          <X size={14} />
                          <span>Cancel</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="mb-detail-body">
                    <div className="mb-detail-section">
                      <span className="mb-detail-section-title"><Database size={12} />Core fields</span>
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
                        </label>
                      </div>
                    </div>

                    <div className="mb-detail-section">
                      <span className="mb-detail-section-title"><Tags size={12} />Classification</span>
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
                        </label>
                        <label className="field-row">
                          <span className="field-label">Keywords</span>
                          <input
                            className="text-input"
                            value={draft.keywordsText}
                            onChange={(event) => setDraft((current) => current ? { ...current, keywordsText: event.target.value } : current)}
                            placeholder="login, redirect, middleware"
                          />
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

                    <div className="mb-detail-section">
                      <span className="mb-detail-section-title"><Link2 size={12} />Relations</span>
                      <div className="field-grid">
                        <label className="field-row">
                          <span className="field-label">Related memory UIDs</span>
                          <textarea
                            className="text-area-input"
                            rows={3}
                            value={draft.relatedItemIdsText}
                            onChange={(event) => setDraft((current) => current ? { ...current, relatedItemIdsText: event.target.value } : current)}
                            placeholder={'vault-abc123\nvault-def456'}
                          />
                        </label>
                        <label className="field-row">
                          <span className="field-label">Related files</span>
                          <textarea
                            className="text-area-input"
                            rows={4}
                            value={draft.relatedFilesText}
                            onChange={(event) => setDraft((current) => current ? { ...current, relatedFilesText: event.target.value } : current)}
                            placeholder={'packages/desktop/src/components/MemoryView.tsx'}
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="mb-detail-head">
                    <div className="mb-detail-meta-row">
                      <span className={`badge badge-${selectedDetail.memoryType}`}>{selectedDetail.memoryType}</span>
                      <span className="mb-card-project">{selectedDetail.project}</span>
                      {selectedDetail.promoted ? (
                        <span className="mb-card-promoted">
                          <Sparkles size={11} />
                          promoted
                        </span>
                      ) : null}
                      <span className="mb-card-time">{formatDistanceToNow(new Date(selectedDetail.updatedAt))} ago</span>
                      <div className="mb-detail-actions">
                        <button
                          type="button"
                          className="mb-icon-button mb-icon-button-primary"
                          onClick={() => setIsEditing(true)}
                          disabled={busyAction !== null}
                        >
                          <Pencil size={14} />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          className="mb-icon-button"
                          onClick={() => void (selectedDetail.promoted ? handleDemote() : handlePromote())}
                          disabled={busyAction !== null}
                          title={selectedDetail.promoted ? 'Demote' : 'Promote'}
                        >
                          <Sparkles size={14} />
                          <span>{selectedDetail.promoted ? 'Demote' : 'Promote'}</span>
                        </button>
                        <button
                          type="button"
                          className="mb-icon-button mb-icon-button-danger"
                          onClick={() => void handleArchive()}
                          disabled={busyAction !== null || selectedDetail.status === 'archived'}
                          title="Archive"
                        >
                          <Archive size={14} />
                        </button>
                      </div>
                    </div>
                    <h2 className="mb-detail-title">{selectedDetail.title}</h2>
                    {selectedDetail.subject ? (
                      <span className="mb-card-project">{selectedDetail.subject}</span>
                    ) : null}
                    <p className="mb-detail-summary">{selectedDetail.summary}</p>
                  </div>

                  <div className="mb-detail-body">
                    <div className="mb-detail-section">
                      <span className="mb-detail-section-title"><Database size={12} />Properties</span>
                      <div className="mb-meta-grid">
                        <div className="mb-meta-cell">
                          <span className="mb-meta-label">Status</span>
                          <span className="mb-meta-value">{selectedDetail.status}</span>
                        </div>
                        <div className="mb-meta-cell">
                          <span className="mb-meta-label">Priority</span>
                          <span className="mb-meta-value">{selectedDetail.priority}</span>
                        </div>
                        <div className="mb-meta-cell">
                          <span className="mb-meta-label">Routine</span>
                          <span className="mb-meta-value">{selectedDetail.routineType || '—'}</span>
                        </div>
                        <div className="mb-meta-cell">
                          <span className="mb-meta-label">Source</span>
                          <span className="mb-meta-value">{selectedDetail.sourceApp}</span>
                        </div>
                        <div className="mb-meta-cell">
                          <span className="mb-meta-label">Created</span>
                          <span className="mb-meta-value">{formatDistanceToNow(new Date(selectedDetail.createdAt))} ago</span>
                        </div>
                        <div className="mb-meta-cell">
                          <span className="mb-meta-label">Recalled</span>
                          <span className="mb-meta-value">{selectedDetail.accessCount}×</span>
                        </div>
                        <div className="mb-meta-cell" style={{ gridColumn: '1 / -1' }}>
                          <span className="mb-meta-label">Memory UID</span>
                          <span className="mb-meta-value mb-meta-value-mono">{selectedDetail.itemUid}</span>
                        </div>
                      </div>
                    </div>

                    {(selectedDetail.tags.length > 0 || selectedDetail.keywords.length > 0) ? (
                      <div className="mb-detail-section">
                        <span className="mb-detail-section-title"><Tags size={12} />Tags &amp; keywords</span>
                        <div className="mb-tag-row">
                          {selectedDetail.tags.map((tag) => (
                            <span key={`tag-${tag}`} className="mb-tag">{tag}</span>
                          ))}
                          {selectedDetail.keywords.map((keyword) => (
                            <span key={`kw-${keyword}`} className="mb-tag mb-tag-keyword">{keyword}</span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {selectedDetail.nextSteps && selectedDetail.nextSteps.length > 0 ? (
                      <div className="mb-detail-section">
                        <span className="mb-detail-section-title"><Clock3 size={12} />Next steps</span>
                        <ul className="mb-next-steps">
                          {selectedDetail.nextSteps.map((step, index) => (
                            <li key={`step-${index}`} className="mb-next-step">{step}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {(artifactPreviewLoading || artifactPreview?.imageDataUrl) ? (
                      <div className="mb-detail-section">
                        <span className="mb-detail-section-title"><FileText size={12} />Artifact preview</span>
                        {artifactPreviewLoading ? (
                          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>Loading artifact preview...</p>
                        ) : artifactPreview?.imageDataUrl ? (
                          <>
                            <img
                              className="task-image-preview"
                              src={artifactPreview.imageDataUrl}
                              alt={selectedDetail.title}
                            />
                            <div className="mb-path-box">{artifactPreview.absolutePath}</div>
                          </>
                        ) : null}
                      </div>
                    ) : null}

                    {selectedDetail.relatedItemIds.length > 0 ? (
                      <div className="mb-detail-section">
                        <span className="mb-detail-section-title"><Link2 size={12} />Related memories</span>
                        <div className="mb-tag-row">
                          {selectedDetail.relatedItemIds.map((itemUid) => {
                            const relatedMemory = relatedMemoryMap.get(itemUid);
                            return (
                              <button
                                key={itemUid}
                                type="button"
                                className="mb-tag"
                                onClick={() => {
                                  if (relatedMemory) {
                                    void handleSelectMemory(relatedMemory.itemUid);
                                  }
                                }}
                                disabled={!relatedMemory}
                                style={{ cursor: relatedMemory ? 'pointer' : 'default' }}
                              >
                                {relatedMemory ? relatedMemory.title : itemUid}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    {selectedDetail.relatedFiles.length > 0 ? (
                      <div className="mb-detail-section">
                        <span className="mb-detail-section-title"><FileText size={12} />Related files</span>
                        <div className="mb-tag-row">
                          {selectedDetail.relatedFiles.map((filePath) => (
                            <button
                              key={filePath}
                              type="button"
                              className="mb-tag"
                              onClick={() => setSelectedArtifactPath(filePath)}
                              style={{ cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: '0.76rem' }}
                            >
                              {filePath}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {(selectedDetail.fileContent || selectedDetail.content) ? (
                      <div className="mb-detail-section">
                        <span className="mb-detail-section-title"><FileText size={12} />Content</span>
                        <div className="mb-content-box">
                          {selectedDetail.fileContent || selectedDetail.content}
                        </div>
                      </div>
                    ) : null}

                    {selectedDetail.vaultPath ? (
                      <div className="mb-detail-section">
                        <span className="mb-detail-section-title"><Database size={12} />Vault path</span>
                        <div className="mb-path-box">{selectedDetail.vaultPath}</div>
                      </div>
                    ) : null}
                  </div>
                </>
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
