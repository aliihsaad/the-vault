import { useEffect, useMemo, useState } from 'react';
import {
  ChevronRight,
  Database,
  FileCode2,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  RefreshCw,
  ScrollText,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

type StructureRole = 'project' | 'type' | 'archive' | 'logs' | 'database' | 'memory' | 'image' | 'other';

export function VaultStructureView() {
  const [snapshot, setSnapshot] = useState<VaultStructureSnapshot | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<VaultFilePreview | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadStructure();
  }, []);

  useEffect(() => {
    if (!snapshot || selectedPath) {
      return;
    }

    const firstFile = findFirstFile(snapshot.nodes);
    if (firstFile) {
      setSelectedPath(firstFile.relativePath);
      void loadPreview(firstFile.relativePath);
    }
  }, [snapshot, selectedPath]);

  async function loadStructure() {
    setLoading(true);
    setError(null);

    try {
      const response = await window.vaultAPI.getVaultStructure();
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to load the vault structure');
      }

      setSnapshot(response.data);
      setExpandedPaths(buildInitialExpandedPaths(response.data.nodes));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the vault structure');
    } finally {
      setLoading(false);
    }
  }

  async function loadPreview(relativePath: string) {
    setPreviewLoading(true);
    setError(null);

    try {
      const response = await window.vaultAPI.readVaultFilePreview(relativePath);
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to read the selected vault file');
      }

      setPreview(response.data);
    } catch (err) {
      setPreview(null);
      setError(err instanceof Error ? err.message : 'Failed to read the selected vault file');
    } finally {
      setPreviewLoading(false);
    }
  }

  function toggleExpanded(path: string) {
    setExpandedPaths((current) => ({
      ...current,
      [path]: !current[path],
    }));
  }

  const selectedNode = useMemo(
    () => (snapshot && selectedPath ? findNode(snapshot.nodes, selectedPath) : null),
    [snapshot, selectedPath],
  );
  const selectedRole = selectedNode ? getStructureRole(selectedNode) : null;

  return (
    <div className="logs-layout">
      <section className="section-intro">
        <div className="section-intro-copy">
          <span className="section-intro-eyebrow">Vault Files</span>
          <div className="section-intro-title">Inspect the real vault layout without getting lost in the tree</div>
          <p className="section-intro-text">The structure view stays focused on one job: browse the on-disk hierarchy on the left and preview the selected file on the right.</p>
        </div>
        <div className="section-intro-meta">
          <span className="section-intro-chip">tree browser</span>
          <span className="section-intro-chip">file preview</span>
          <span className="section-intro-chip">path verification</span>
        </div>
      </section>

      <div className="stats-strip">
        <div className="stat-chip">
          <span className="stat-label">Directories</span>
          <strong className="stat-value">{snapshot?.totalDirectories || 0}</strong>
        </div>
        <div className="stat-chip">
          <span className="stat-label">Files</span>
          <strong className="stat-value">{snapshot?.totalFiles || 0}</strong>
        </div>
        <div className="stat-chip">
          <span className="stat-label">Memory files</span>
          <strong className="stat-value">{snapshot?.memoryFiles || 0}</strong>
        </div>
        <div className="stat-chip">
          <span className="stat-label">Log files</span>
          <strong className="stat-value">{snapshot?.logFiles || 0}</strong>
        </div>
      </div>

      <div className="section-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Vault file structure</div>
              <div className="panel-subtitle">Inspect the real on-disk layout under the vault root so you can verify project grouping, memory-type routing, archive placement, and internal files.</div>
            </div>
            <button type="button" className="header-button" onClick={() => void loadStructure()} disabled={loading}>
              <RefreshCw size={16} />
              <span>{loading ? 'Refreshing...' : 'Refresh tree'}</span>
            </button>
          </div>

          {snapshot ? (
            <div className="note-card" style={{ marginBottom: '16px' }}>
              <p>Root: <span className="text-mono">{snapshot.root}</span></p>
              <p>The tree shows the real folders and files inside the vault root, including Markdown memories, archive folders, logs, and database files.</p>
              <div className="vault-legend-row">
                <span className="vault-legend-chip vault-legend-project">project</span>
                <span className="vault-legend-chip vault-legend-type">memory type</span>
                <span className="vault-legend-chip vault-legend-archive">archive</span>
                <span className="vault-legend-chip vault-legend-logs">logs</span>
                <span className="vault-legend-chip vault-legend-database">database</span>
                <span className="vault-legend-chip vault-legend-memory">memory file</span>
                <span className="vault-legend-chip vault-legend-image">image artifact</span>
              </div>
            </div>
          ) : null}

          {loading ? (
            <div className="empty-state">Loading vault structure...</div>
          ) : error && !snapshot ? (
            <div className="empty-state empty-state-error">{error}</div>
          ) : snapshot && snapshot.nodes.length > 0 ? (
            <div className="vault-tree-panel">
              {snapshot.nodes.map((node) => (
                <VaultTreeNodeRow
                  key={node.relativePath}
                  node={node}
                  depth={0}
                  expandedPaths={expandedPaths}
                  selectedPath={selectedPath}
                  onToggleExpanded={toggleExpanded}
                  onSelect={(relativePath) => {
                    setSelectedPath(relativePath);
                    if (findNode(snapshot.nodes, relativePath)?.nodeType === 'file') {
                      void loadPreview(relativePath);
                    }
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="empty-state">The vault root is empty.</div>
          )}
        </section>

        <aside className="detail-panel panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">File preview</div>
              <div className="panel-subtitle">Open one file from the tree to check naming, path placement, and the actual saved content.</div>
            </div>
            {selectedNode?.nodeType === 'file' ? <FileText size={18} className="panel-icon" /> : <FolderOpen size={18} className="panel-icon" />}
          </div>

          {error && snapshot ? <div className="error-text">{error}</div> : null}

          {!selectedNode ? (
            <div className="empty-state">Select a file from the structure tree to preview it.</div>
          ) : selectedNode.nodeType === 'directory' ? (
            <div className="detail-stack">
              <div className="detail-headline">
                {selectedRole ? <span className={`vault-legend-chip vault-legend-${selectedRole}`}>{selectedRole}</span> : null}
                <h3>{selectedNode.name}</h3>
                <p>This is a folder. Expand it from the left and select a file to inspect its content.</p>
              </div>
              <div className="detail-grid">
                <div className="detail-block">
                  <span className="detail-label">Relative path</span>
                  <strong className="text-mono">{selectedNode.relativePath}</strong>
                </div>
                <div className="detail-block">
                  <span className="detail-label">Role</span>
                  <strong>{selectedRole || 'other'}</strong>
                </div>
                <div className="detail-block">
                  <span className="detail-label">Updated</span>
                  <strong>{selectedNode.modifiedAt ? formatDistanceToNow(new Date(selectedNode.modifiedAt)) : 'unknown'} ago</strong>
                </div>
              </div>
            </div>
          ) : previewLoading ? (
            <div className="empty-state">Loading file preview...</div>
          ) : preview ? (
            <div className="detail-stack">
              <div className="detail-headline">
                <span className={`vault-legend-chip vault-legend-${selectedRole || 'other'}`}>
                  {selectedRole || selectedNode.fileKind || 'file'}
                </span>
                <h3>{selectedNode.name}</h3>
                <p>{preview.relativePath}</p>
              </div>

              <div className="detail-grid">
                <div className="detail-block">
                  <span className="detail-label">Relative path</span>
                  <strong className="text-mono">{preview.relativePath}</strong>
                </div>
                <div className="detail-block">
                  <span className="detail-label">Classification</span>
                  <strong>{selectedRole || 'other'}</strong>
                </div>
                <div className="detail-block">
                  <span className="detail-label">Size</span>
                  <strong>{formatBytes(preview.size)}</strong>
                </div>
                <div className="detail-block">
                  <span className="detail-label">Updated</span>
                  <strong>{formatDistanceToNow(new Date(preview.modifiedAt))} ago</strong>
                </div>
                <div className="detail-block">
                  <span className="detail-label">Absolute path</span>
                  <strong className="text-mono">{preview.absolutePath}</strong>
                </div>
              </div>

              <div className="detail-section">
                <div className="detail-section-title">
                  <ScrollText size={16} />
                  <span>{preview.imageDataUrl ? 'Image preview' : 'Content preview'}</span>
                </div>
                {preview.imageDataUrl ? (
                  <div className="detail-stack">
                    <img
                      className="task-image-preview"
                      src={preview.imageDataUrl}
                      alt={selectedNode.name}
                    />
                    <div className="detail-path text-mono">{preview.absolutePath}</div>
                  </div>
                ) : (
                  <pre className="snippet-block">{preview.content}</pre>
                )}
                {preview.truncated && !preview.imageDataUrl ? (
                  <p className="field-help" style={{ marginTop: '10px' }}>
                    Preview truncated to keep the renderer responsive.
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="empty-state">No preview is available for the selected file yet.</div>
          )}
        </aside>
      </div>
    </div>
  );
}

function VaultTreeNodeRow({
  node,
  depth,
  expandedPaths,
  selectedPath,
  onToggleExpanded,
  onSelect,
}: {
  node: VaultStructureNode;
  depth: number;
  expandedPaths: Record<string, boolean>;
  selectedPath: string | null;
  onToggleExpanded: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  const isExpanded = expandedPaths[node.relativePath] ?? depth < 1;
  const isSelected = selectedPath === node.relativePath;
  const hasChildren = node.nodeType === 'directory' && (node.children?.length || 0) > 0;
  const role = getStructureRole(node);

  return (
    <>
      <button
        type="button"
        className={`vault-tree-row vault-tree-row-${role} ${isSelected ? 'vault-tree-row-active' : ''}`}
        style={{ paddingLeft: `${12 + depth * 18}px` }}
        onClick={() => {
          if (node.nodeType === 'directory') {
            onToggleExpanded(node.relativePath);
          }
          onSelect(node.relativePath);
        }}
      >
        <span className={`vault-tree-caret ${hasChildren && isExpanded ? 'vault-tree-caret-open' : ''}`}>
          {hasChildren ? <ChevronRight size={14} /> : null}
        </span>
        <span className={`vault-tree-icon vault-tree-icon-${role}`}>
          {node.nodeType === 'directory'
            ? (isExpanded ? <FolderOpen size={16} /> : <Folder size={16} />)
            : getFileIcon(node.fileKind)}
        </span>
        <span className="vault-tree-label">{node.name}</span>
        <span className="vault-tree-meta">{role}</span>
      </button>

      {node.nodeType === 'directory' && isExpanded && node.children?.map((child) => (
        <VaultTreeNodeRow
          key={child.relativePath}
          node={child}
          depth={depth + 1}
          expandedPaths={expandedPaths}
          selectedPath={selectedPath}
          onToggleExpanded={onToggleExpanded}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

function getFileIcon(kind: VaultStructureNode['fileKind']) {
  if (kind === 'image') {
    return <FileImage size={16} />;
  }
  if (kind === 'memory') {
    return <FileText size={16} />;
  }
  if (kind === 'database') {
    return <Database size={16} />;
  }
  return <FileCode2 size={16} />;
}

function getStructureRole(node: VaultStructureNode): StructureRole {
  const normalized = node.relativePath.replace(/\\/g, '/').toLowerCase();
  const parts = normalized.split('/').filter(Boolean);

  if (node.nodeType === 'file') {
    if (node.fileKind === 'image') {
      return 'image';
    }
    if (node.fileKind === 'database') {
      return 'database';
    }
    if (node.fileKind === 'log') {
      return 'logs';
    }
    if (node.fileKind === 'memory') {
      return 'memory';
    }
    return 'other';
  }

  if (parts[0] === 'logs' || parts.includes('logs')) {
    return 'logs';
  }
  if (parts[parts.length - 1] === 'archive' || parts.includes('archive')) {
    return 'archive';
  }
  if (isMemoryTypeName(parts[parts.length - 1] || '')) {
    return 'type';
  }
  if (parts.length === 1 && !isSystemDirectory(parts[0] || '')) {
    return 'project';
  }
  return 'other';
}

function isMemoryTypeName(value: string): boolean {
  return ['session', 'summary', 'decision', 'plan', 'artifact', 'handoff', 'reference'].includes(value);
}

function isSystemDirectory(value: string): boolean {
  return ['logs', 'archive'].includes(value);
}

function buildInitialExpandedPaths(nodes: VaultStructureNode[]): Record<string, boolean> {
  const expanded: Record<string, boolean> = {};
  for (const node of nodes) {
    if (node.nodeType === 'directory') {
      expanded[node.relativePath] = true;
      for (const child of node.children || []) {
        if (child.nodeType === 'directory') {
          expanded[child.relativePath] = false;
        }
      }
    }
  }
  return expanded;
}

function findFirstFile(nodes: VaultStructureNode[]): VaultStructureNode | null {
  for (const node of nodes) {
    if (node.nodeType === 'file') {
      return node;
    }
    const childMatch = node.children ? findFirstFile(node.children) : null;
    if (childMatch) {
      return childMatch;
    }
  }
  return null;
}

function findNode(nodes: VaultStructureNode[], relativePath: string): VaultStructureNode | null {
  for (const node of nodes) {
    if (node.relativePath === relativePath) {
      return node;
    }
    const childMatch = node.children ? findNode(node.children, relativePath) : null;
    if (childMatch) {
      return childMatch;
    }
  }
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
