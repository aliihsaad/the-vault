import { useEffect, useState } from 'react';
import {
  Activity,
  Bot,
  ClipboardList,
  Database,
  FolderTree,
  LayoutDashboard,
  MessageSquare,
  RefreshCw,
  Settings,
  TerminalSquare,
} from 'lucide-react';
import { ActivityLogsView } from './components/ActivityLogsView.js';
import { AgentReviewPane, type AgentReviewTab } from './components/AgentReviewPane.js';
import { ChatView } from './components/ChatView.js';
import { DashboardView } from './components/DashboardView.js';
import { MemoryView } from './components/MemoryView.js';
import { SettingsView } from './components/SettingsView.js';
import { VaultAgentView } from './components/VaultAgentView.js';
import { VaultStructureView } from './components/VaultStructureView.js';
import './app.css';

type AppTab = 'dashboard' | 'agent' | 'memory' | 'structure' | 'chat' | 'reviews' | 'logs' | 'settings';

const NAV_ITEMS: Record<AppTab, {
  id: AppTab;
  label: string;
  description: string;
  icon: typeof LayoutDashboard;
}> = {
  dashboard: {
    id: 'dashboard',
    label: 'Overview',
    description: 'Project and memory pulse',
    icon: LayoutDashboard,
  },
  agent: {
    id: 'agent',
    label: 'Vault Agent',
    description: 'Backend, runtime, and operator activity',
    icon: Bot,
  },
  memory: {
    id: 'memory',
    label: 'Memory Bank',
    description: 'Search and inspect stored context',
    icon: TerminalSquare,
  },
  structure: {
    id: 'structure',
    label: 'Vault Files',
    description: 'Browse folders and preview saved files',
    icon: FolderTree,
  },
  chat: {
    id: 'chat',
    label: 'Recall Console',
    description: 'Query and write from one surface',
    icon: MessageSquare,
  },
  reviews: {
    id: 'reviews',
    label: 'Agent Review',
    description: 'Decide proposals and pending deletes',
    icon: ClipboardList,
  },
  logs: {
    id: 'logs',
    label: 'Activity',
    description: 'Operational event stream',
    icon: Activity,
  },
  settings: {
    id: 'settings',
    label: 'Settings',
    description: 'Runtime and enrichment controls',
    icon: Settings,
  },
};

const NAV_SECTIONS: Array<{ label: string; items: AppTab[] }> = [
  {
    label: 'Start',
    items: ['dashboard'],
  },
  {
    label: 'Workflows',
    items: ['chat', 'memory', 'agent', 'reviews'],
  },
  {
    label: 'Inspect',
    items: ['logs', 'structure'],
  },
  {
    label: 'Configure',
    items: ['settings'],
  },
];

const TAB_META: Record<AppTab, { title: string; description: string }> = {
  dashboard: {
    title: 'Vault overview',
    description: 'A high-signal snapshot of projects, recent captures, and system activity.',
  },
  agent: {
    title: 'Vault agent',
    description: 'Choose the Vault chat backend, inspect runtime state, and review Vault-owned activity.',
  },
  memory: {
    title: 'Memory bank',
    description: 'Browse stored memories, inspect details, and filter down to exactly what matters.',
  },
  structure: {
    title: 'Vault files',
    description: 'Inspect the on-disk vault structure and preview the files that hold your saved memory.',
  },
  chat: {
    title: 'Recall console',
    description: 'Plain text, /recall, and /save each follow a distinct Vault workflow.',
  },
  reviews: {
    title: 'Agent review',
    description: 'Project proposals and pending deletes queued by Vault agent duties.',
  },
  logs: {
    title: 'Activity logs',
    description: 'Review what the vault has been doing across saves, recalls, promotions, and updates.',
  },
  settings: {
    title: 'Settings',
    description: 'Configure vault behavior, enrichment, and local operational defaults.',
  },
};

const vaultIconSrc = `${import.meta.env.BASE_URL}vault-icon.png`;

function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');
  const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
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

  const totalMemories =
    vaultStatus?.projects?.reduce((count: number, project: VaultProject) => count + (project.memoryCount || 0), 0) || 0;
  const activeMeta = TAB_META[activeTab];

  function openMemoryComposerPrefill(draft: Partial<VaultMemoryComposerDraft>) {
    setMemoryComposerPrefill({
      draft,
      nonce: Date.now(),
    });
    setActiveTab('memory');
  }

  function openReviewPane(tab: AgentReviewTab) {
    setReviewInitialTab(tab);
    setActiveTab('reviews');
  }

  function openMemoryItem(itemUid: string) {
    setMemoryInitialSelection({ itemUid, nonce: Date.now() });
    setActiveTab('memory');
  }

  return (
    <div className="app-shell">
      <div className="app-backdrop" />

      <div className="titlebar">
        <span className="titlebar-label">THE VAULT</span>
        <span className="titlebar-caption">local-first memory system</span>
      </div>

      <div className="app-chrome">
        <aside className="sidebar-shell">
          <div className="sidebar-brand">
            <div className="brand-mark">
              <img src={vaultIconSrc} alt="Vault Logo" style={{ width: 24, height: 24, borderRadius: 4 }} />
            </div>
            <div className="brand-copy">
              <strong>Vault OS</strong>
              <span>Memory operations cockpit</span>
            </div>
          </div>

          <div className="sidebar-root panel panel-muted">
            <span className="sidebar-root-label">Connected root</span>
            <span className="sidebar-root-path text-mono">
              {vaultStatus?.root || (loadingStatus ? 'Connecting...' : 'Unavailable')}
            </span>
          </div>

          <div className="nav-stack">
            {NAV_SECTIONS.map((section) => (
              <div key={section.label} className="nav-section">
                <span className="nav-section-label">{section.label}</span>
                <nav className="nav-section-items">
                  {section.items.map((tabId) => {
                    const item = NAV_ITEMS[tabId];
                    const Icon = item.icon;

                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
                        onClick={() => setActiveTab(item.id)}
                      >
                        <span className="nav-icon">
                          <Icon size={18} />
                        </span>
                        <span className="nav-copy">
                          <span className="nav-label">{item.label}</span>
                          <span className="nav-description">{item.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </nav>
              </div>
            ))}
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
          </div>

          <div className="sidebar-version">
            <span className="sidebar-version-label">Version</span>
            <span className="sidebar-version-value text-mono">
              {vaultStatus?.appVersion ? `v${vaultStatus.appVersion}` : '—'}
            </span>
          </div>
        </aside>

        <main className="workspace">
          <header className="workspace-header">
            <div className="header-copy">
              <span className="header-eyebrow">Desktop console</span>
              <h1>{activeMeta.title}</h1>
              <p>{activeMeta.description}</p>
            </div>

            <div className="header-actions">
              <div className={`status-pill ${vaultStatus?.initialized ? 'status-pill-online' : 'status-pill-offline'}`}>
                <span className="status-dot" />
                <span>{vaultStatus?.initialized ? 'Vault online' : loadingStatus ? 'Connecting' : 'Unavailable'}</span>
              </div>

              <button type="button" className="header-button" onClick={() => void fetchStatus()}>
                <RefreshCw size={16} />
                <span>Refresh</span>
              </button>
            </div>
          </header>

          <div className="content-scroll">
            {statusError ? <div className="panel empty-state empty-state-error">{statusError}</div> : null}

            <div className="content-surface">
              {activeTab === 'dashboard' ? (
                <DashboardView vaultStatus={vaultStatus} onOpenReview={openReviewPane} onOpenMemory={openMemoryItem} />
              ) : null}
              {activeTab === 'reviews' ? <AgentReviewPane initialTab={reviewInitialTab} /> : null}
              {activeTab === 'agent' ? <VaultAgentView /> : null}
              {activeTab === 'memory' ? (
                <MemoryView
                  composerPrefill={memoryComposerPrefill}
                  initialSelection={memoryInitialSelection}
                  onComposerPrefillConsumed={() => setMemoryComposerPrefill(null)}
                  onInitialSelectionConsumed={() => setMemoryInitialSelection(null)}
                />
              ) : null}
              {activeTab === 'structure' ? <VaultStructureView /> : null}
              {activeTab === 'chat' ? <ChatView onPrefillMemoryDraft={openMemoryComposerPrefill} /> : null}
              {activeTab === 'logs' ? <ActivityLogsView onPrefillMemoryDraft={openMemoryComposerPrefill} /> : null}
              {activeTab === 'settings' ? <SettingsView vaultStatus={vaultStatus} /> : null}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
