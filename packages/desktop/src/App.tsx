import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  Activity,
  Bot,
  BrainCircuit,
  ClipboardList,
  Database,
  FolderKanban,
  FolderTree,
  GitBranch,
  LayoutDashboard,
  ListChecks,
  Network,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import { ActivityLogsView } from './components/ActivityLogsView.js';
import { AgentReviewPane, type AgentReviewTab } from './components/AgentReviewPane.js';
import { BrandMark } from './components/BrandMark.js';
import {
  AnalyticsOperationsView,
  FilteredMemoryWorkspaceView,
  GraphOperationsView,
  LoopsOperationsView,
  ProjectsOperationsView,
  RecallOperationsView,
} from './components/CockpitOperationsViews.js';
import { MemoryView } from './components/MemoryView.js';
import { OverviewCockpitView } from './components/OverviewCockpitView.js';
import { SettingsView } from './components/SettingsView.js';
import { VaultAgentView } from './components/VaultAgentView.js';
import { VaultStructureView } from './components/VaultStructureView.js';
import './app.css';

type PrimaryTab =
  | 'overview'
  | 'memories'
  | 'projects'
  | 'handoffs'
  | 'decisions'
  | 'loops'
  | 'graph'
  | 'recall'
  | 'analytics'
  | 'agent'
  | 'settings';

type SecondaryTab = 'activity' | 'files' | 'reviews';
type AppTab = PrimaryTab | SecondaryTab;

type NavItem<T extends AppTab = AppTab> = {
  id: T;
  label: string;
  description: string;
  icon: typeof LayoutDashboard;
};

const PRIMARY_NAV: Array<NavItem<PrimaryTab>> = [
  { id: 'overview', label: 'Overview', description: 'Local memory cockpit', icon: LayoutDashboard },
  { id: 'memories', label: 'Memories', description: 'Browse and curate context', icon: Database },
  { id: 'projects', label: 'Projects', description: 'Project radar and workspaces', icon: FolderKanban },
  { id: 'handoffs', label: 'Handoffs', description: 'Filtered transfer notes', icon: GitBranch },
  { id: 'decisions', label: 'Decisions', description: 'Promoted choices and rationale', icon: ShieldCheck },
  { id: 'loops', label: 'Loops', description: 'Open-loop control surface', icon: ListChecks },
  { id: 'graph', label: 'Graph', description: 'Relationship preview', icon: Network },
  { id: 'recall', label: 'Recall', description: 'Recall efficiency and logs', icon: Search },
  { id: 'analytics', label: 'Analytics', description: 'Operational telemetry', icon: BrainCircuit },
  { id: 'agent', label: 'Agent', description: 'Runtime, queue, local agents', icon: Bot },
  { id: 'settings', label: 'Settings', description: 'Local configuration', icon: Settings },
];

const SECONDARY_NAV: Array<NavItem<SecondaryTab>> = [
  { id: 'activity', label: 'Activity', description: 'Full event stream', icon: Activity },
  { id: 'files', label: 'Files', description: 'Vault file browser', icon: FolderTree },
  { id: 'reviews', label: 'Reviews', description: 'Proposals and deletes', icon: ClipboardList },
];

const TAB_META: Record<AppTab, { title: string; description: string }> = {
  overview: {
    title: 'Operations overview',
    description: 'The Vault is running locally with live memory, recall, loop, and agent telemetry.',
  },
  memories: {
    title: 'Memories',
    description: 'Search stored context, inspect details, edit memory metadata, and save new structured notes.',
  },
  projects: {
    title: 'Projects',
    description: 'Compare project momentum, workspace registration, open loops, and local activity.',
  },
  handoffs: {
    title: 'Handoffs',
    description: 'A filtered workspace for handoff memories and the next actions they preserve.',
  },
  decisions: {
    title: 'Decisions',
    description: 'Review saved decisions, their project context, and the related files or memories behind them.',
  },
  loops: {
    title: 'Open loops',
    description: 'Resolve, snooze, or open unfinished work surfaced from active Vault memory.',
  },
  graph: {
    title: 'Graph',
    description: 'Read-only relationship preview built from stored related memory IDs, files, and projects.',
  },
  recall: {
    title: 'Recall',
    description: 'Inspect recall activity, candidate reduction, and prompt-packing efficiency.',
  },
  analytics: {
    title: 'Analytics',
    description: 'Operational charts derived from logs, memory state, and task queue counters.',
  },
  agent: {
    title: 'Agent',
    description: 'Control Vault agent runtime, queue, local workbench runs, and executor activity.',
  },
  settings: {
    title: 'Settings',
    description: 'Configure local runtime behavior, integrations, skills, and model routing.',
  },
  activity: {
    title: 'Activity',
    description: 'Full operational event stream with search, filters, and recall detail inspection.',
  },
  files: {
    title: 'Files',
    description: 'Browse the on-disk vault structure and preview stored files.',
  },
  reviews: {
    title: 'Reviews',
    description: 'Decide project proposals and pending deletes queued by Vault duties.',
  },
};

function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('overview');
  const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [globalSearch, setGlobalSearch] = useState('');
  const [memorySearchSeed, setMemorySearchSeed] = useState<{ query: string; nonce: number } | null>(null);
  const [memoryComposerPrefill, setMemoryComposerPrefill] = useState<{
    draft: Partial<VaultMemoryComposerDraft>;
    nonce: number;
  } | null>(null);
  const [memoryInitialSelection, setMemoryInitialSelection] = useState<{ itemUid: string; nonce: number } | null>(null);
  const [reviewInitialTab, setReviewInitialTab] = useState<AgentReviewTab>('proposals');

  useEffect(() => {
    void fetchStatus();
  }, []);

  async function fetchStatus() {
    setLoadingStatus(true);
    setStatusError(null);

    try {
      if (!window.vaultAPI) {
        throw new Error('Vault bridge is unavailable in the renderer process.');
      }

      const status = await window.vaultAPI.status();
      setVaultStatus(status);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Failed to load vault status');
    } finally {
      setLoadingStatus(false);
    }
  }

  const activeMeta = TAB_META[activeTab];
  const totalMemories = useMemo(
    () => vaultStatus?.projects?.reduce((count, project) => count + (project.memoryCount || 0), 0) || 0,
    [vaultStatus],
  );

  function openMemoryComposerPrefill(draft: Partial<VaultMemoryComposerDraft>) {
    setMemoryComposerPrefill({
      draft,
      nonce: Date.now(),
    });
    setActiveTab('memories');
  }

  function openReviewPane(tab: AgentReviewTab) {
    setReviewInitialTab(tab);
    setActiveTab('reviews');
  }

  function openMemoryItem(itemUid: string) {
    setMemoryInitialSelection({ itemUid, nonce: Date.now() });
    setActiveTab('memories');
  }

  function submitGlobalSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = globalSearch.trim();
    if (!query) {
      return;
    }

    setMemorySearchSeed({ query, nonce: Date.now() });
    setActiveTab('memories');
  }

  return (
    <div className="app-shell">
      <div className="app-backdrop" />

      <div className="titlebar">
        <span className="titlebar-label">THE VAULT</span>
        <span className="titlebar-caption">local-first memory operations</span>
      </div>

      <div className="app-chrome">
        <aside className="sidebar-shell">
          <div className="sidebar-brand">
            <BrandMark size="lg" />
            <div className="brand-copy">
              <strong>The Vault</strong>
              <span>Local memory cockpit</span>
            </div>
          </div>

          <div className="sidebar-local panel panel-muted">
            <span className="status-dot status-dot-online" />
            <div>
              <strong>{vaultStatus?.initialized ? 'Local runtime active' : loadingStatus ? 'Connecting locally' : 'Local runtime unavailable'}</strong>
              <span>All data stays on this machine.</span>
            </div>
          </div>

          <div className="sidebar-root panel panel-muted">
            <span className="sidebar-root-label">Vault root</span>
            <span className="sidebar-root-path text-mono">
              {vaultStatus?.root || (loadingStatus ? 'Connecting...' : 'Unavailable')}
            </span>
          </div>

          <nav className="nav-stack" aria-label="Primary">
            <div className="nav-section">
              <span className="nav-section-label">Operations</span>
              <div className="nav-section-items">
                {PRIMARY_NAV.map((item) => (
                  <NavButton
                    key={item.id}
                    item={item}
                    active={activeTab === item.id}
                    onClick={() => setActiveTab(item.id)}
                  />
                ))}
              </div>
            </div>
          </nav>

          <div className="sidebar-tools">
            <span className="nav-section-label">Inspectors</span>
            <div className="sidebar-tool-grid">
              {SECONDARY_NAV.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`sidebar-tool ${activeTab === item.id ? 'active' : ''}`}
                    onClick={() => setActiveTab(item.id)}
                    title={item.description}
                  >
                    <Icon size={16} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="sidebar-summary panel">
            <div className="summary-row">
              <span>Projects</span>
              <strong>{vaultStatus?.projects.length || 0}</strong>
            </div>
            <div className="summary-row">
              <span>Memories</span>
              <strong>{totalMemories}</strong>
            </div>
            <div className="summary-row">
              <span>Status</span>
              <strong>{vaultStatus?.initialized ? 'Online' : loadingStatus ? 'Booting' : 'Offline'}</strong>
            </div>
            <div className="summary-row">
              <span>Index size</span>
              <strong>{vaultStatus?.directorySize?.displaySize || (loadingStatus ? 'Scanning' : '--')}</strong>
            </div>
          </div>

          <div className="sidebar-version">
            <span className="sidebar-version-label">Version</span>
            <span className="sidebar-version-value text-mono">
              {vaultStatus?.appVersion ? `v${vaultStatus.appVersion}` : '--'}
            </span>
          </div>
        </aside>

        <main className="workspace">
          <header className="workspace-header">
            <div className="header-copy">
              <span className="header-eyebrow">Local cockpit</span>
              <h1>{activeMeta.title}</h1>
              <p>{activeMeta.description}</p>
            </div>

            <div className="header-actions">
              <form className="command-bar" onSubmit={submitGlobalSearch}>
                <Search size={16} />
                <input
                  value={globalSearch}
                  onChange={(event) => setGlobalSearch(event.target.value)}
                  placeholder="Search memories, projects, files"
                  aria-label="Search memories"
                />
                <button type="submit">Search</button>
              </form>

              <div className={`status-pill ${vaultStatus?.initialized ? 'status-pill-online' : 'status-pill-offline'}`}>
                <span className="status-dot" />
                <span>{vaultStatus?.initialized ? 'Local' : loadingStatus ? 'Connecting' : 'Unavailable'}</span>
              </div>

              <button type="button" className="header-button icon-only-button" onClick={() => void fetchStatus()} title="Refresh status">
                <RefreshCw size={16} />
              </button>
            </div>
          </header>

          <div className="content-scroll">
            {statusError ? <div className="panel empty-state empty-state-error">{statusError}</div> : null}

            <div className="content-surface">
              {activeTab === 'overview' ? (
                <OverviewCockpitView
                  vaultStatus={vaultStatus}
                  onOpenReview={openReviewPane}
                  onOpenMemory={openMemoryItem}
                  onNavigate={(tab) => setActiveTab(tab)}
                />
              ) : null}
              {activeTab === 'memories' ? (
                <MemoryView
                  composerPrefill={memoryComposerPrefill}
                  initialSelection={memoryInitialSelection}
                  searchSeed={memorySearchSeed}
                  onComposerPrefillConsumed={() => setMemoryComposerPrefill(null)}
                  onInitialSelectionConsumed={() => setMemoryInitialSelection(null)}
                />
              ) : null}
              {activeTab === 'projects' ? <ProjectsOperationsView vaultStatus={vaultStatus} /> : null}
              {activeTab === 'handoffs' ? (
                <FilteredMemoryWorkspaceView
                  memoryType="handoff"
                  label="Handoffs"
                  title="Handoff workspace"
                  text="This view is a smart filter over stored handoff memories. It does not invent a new workflow; it highlights the transfer notes already saved in Vault."
                  onOpenMemory={openMemoryItem}
                />
              ) : null}
              {activeTab === 'decisions' ? (
                <FilteredMemoryWorkspaceView
                  memoryType="decision"
                  label="Decisions"
                  title="Decision ledger"
                  text="This view is a smart filter over decision memories so tradeoffs, constraints, and rationale stay easy to inspect."
                  onOpenMemory={openMemoryItem}
                />
              ) : null}
              {activeTab === 'loops' ? <LoopsOperationsView onOpenMemory={openMemoryItem} /> : null}
              {activeTab === 'graph' ? <GraphOperationsView vaultStatus={vaultStatus} onOpenMemory={openMemoryItem} /> : null}
              {activeTab === 'recall' ? <RecallOperationsView /> : null}
              {activeTab === 'analytics' ? <AnalyticsOperationsView /> : null}
              {activeTab === 'agent' ? <VaultAgentView /> : null}
              {activeTab === 'settings' ? <SettingsView vaultStatus={vaultStatus} /> : null}
              {activeTab === 'activity' ? <ActivityLogsView onPrefillMemoryDraft={openMemoryComposerPrefill} /> : null}
              {activeTab === 'files' ? <VaultStructureView /> : null}
              {activeTab === 'reviews' ? <AgentReviewPane initialTab={reviewInitialTab} /> : null}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function NavButton({
  item,
  active,
  onClick,
}: {
  item: NavItem<PrimaryTab>;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;

  return (
    <button type="button" className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>
      <span className="nav-icon">
        <Icon size={17} />
      </span>
      <span className="nav-copy">
        <span className="nav-label">{item.label}</span>
        <span className="nav-description">{item.description}</span>
      </span>
    </button>
  );
}

export default App;
