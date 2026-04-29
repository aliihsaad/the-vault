import { useEffect, useState } from 'react';
import {
  BookCopy,
  Cable,
  Check,
  ChevronRight,
  Copy,
  RefreshCw,
  Terminal,
  Unplug,
  X,
  Minus,
  Zap,
  Trash2,
} from 'lucide-react';

const MCP_SERVER_COMMAND = 'pnpm --filter @the-vault/mcp-server dev';

const JSON_CLIENT_SNIPPET = JSON.stringify(
  {
    mcpServers: {
      'vault-memory': {
        command: 'pnpm',
        args: ['--filter', '@the-vault/mcp-server', 'dev'],
      },
    },
  },
  null,
  2,
);

interface ConnectPanelProps {
  copyText: (token: string, value: string, successMessage?: string) => Promise<void>;
  copiedToken: string | null;
}

function StepIcon({ status }: { status: ConnectStepStatus }) {
  if (status === 'success') return <Check size={14} />;
  if (status === 'fail') return <X size={14} />;
  return <Minus size={14} />;
}

function StepList({ steps }: { steps: ConnectStep[] }) {
  return (
    <div className="connect-steps">
      {steps.map((step) => (
        <div key={step.id} className={`connect-step connect-step-${step.status}`}>
          <span className="connect-step-icon">
            <StepIcon status={step.status} />
          </span>
          <div>
            <div className="connect-step-label">{step.label}</div>
            {step.detail ? <div className="connect-step-detail">{step.detail}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function QuickStartCard({
  title,
  description,
  steps,
}: {
  title: string;
  description: string;
  steps: string[];
}) {
  return (
    <div className="snippet-card">
      <div className="snippet-head">
        <div>
          <div className="field-label">{title}</div>
          <div className="field-help">{description}</div>
        </div>
      </div>
      <ol className="connect-quickstart-list">
        {steps.map((step) => (
          <li key={`${title}-${step}`}>{step}</li>
        ))}
      </ol>
    </div>
  );
}

export function ConnectPanel({ copyText, copiedToken }: ConnectPanelProps) {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [desktopResult, setDesktopResult] = useState<ConnectResult | null>(null);
  const [codeResult, setCodeResult] = useState<ConnectResult | null>(null);
  const [codexResult, setCodexResult] = useState<ConnectResult | null>(null);
  const [claudeSkillResult, setClaudeSkillResult] = useState<ConnectResult | null>(null);
  const [codexSkillResult, setCodexSkillResult] = useState<ConnectResult | null>(null);
  const [connectingDesktop, setConnectingDesktop] = useState(false);
  const [connectingCode, setConnectingCode] = useState(false);
  const [connectingCodex, setConnectingCodex] = useState(false);
  const [installingClaudeSkill, setInstallingClaudeSkill] = useState(false);
  const [installingCodexSkill, setInstallingCodexSkill] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  const desktopConnected = connectionStatus?.claudeDesktop.configured ?? false;
  const codeConnected = connectionStatus?.claudeCode.configured ?? false;
  const codexConnected = connectionStatus?.codex.configured ?? false;
  const claudeSkillInstalled = connectionStatus?.skill.claudeInstalled ?? false;
  const codexSkillInstalled = connectionStatus?.skill.codexInstalled ?? false;

  useEffect(() => {
    void refreshStatus();
  }, []);

  // Auto-expand manual section when any operation fails
  useEffect(() => {
    const anyFailed =
      (desktopResult && !desktopResult.success) ||
      (codeResult && !codeResult.success) ||
      (codexResult && !codexResult.success) ||
      (claudeSkillResult && !claudeSkillResult.success) ||
      (codexSkillResult && !codexSkillResult.success);
    if (anyFailed) {
      setManualOpen(true);
    }
  }, [desktopResult, codeResult, codexResult, claudeSkillResult, codexSkillResult]);

  async function refreshStatus() {
    setLoadingStatus(true);
    try {
      const response = await window.vaultAPI.checkConnectionStatus();
      if (response.success && response.data) {
        setConnectionStatus(response.data);
      }
    } catch {
      // Silently ignore — status will show as unknown
    } finally {
      setLoadingStatus(false);
    }
  }

  async function handleToggleDesktop() {
    setConnectingDesktop(true);
    setDesktopResult(null);
    try {
      const response = desktopConnected
        ? await window.vaultAPI.disconnectClaudeDesktop()
        : await window.vaultAPI.connectClaudeDesktop();
      if (response.success && response.data) {
        setDesktopResult(response.data);
      } else {
        setDesktopResult({ success: false, steps: [{ id: 'error', label: 'Operation failed', status: 'fail', detail: response.error }] });
      }
      await refreshStatus();
    } catch (err) {
      setDesktopResult({ success: false, steps: [{ id: 'error', label: 'Operation failed', status: 'fail', detail: err instanceof Error ? err.message : 'Unknown error' }] });
    } finally {
      setConnectingDesktop(false);
    }
  }

  async function handleToggleCode() {
    setConnectingCode(true);
    setCodeResult(null);
    try {
      const response = codeConnected
        ? await window.vaultAPI.disconnectClaudeCode()
        : await window.vaultAPI.connectClaudeCode();
      if (response.success && response.data) {
        setCodeResult(response.data);
      } else {
        setCodeResult({ success: false, steps: [{ id: 'error', label: 'Operation failed', status: 'fail', detail: response.error }] });
      }
      await refreshStatus();
    } catch (err) {
      setCodeResult({ success: false, steps: [{ id: 'error', label: 'Operation failed', status: 'fail', detail: err instanceof Error ? err.message : 'Unknown error' }] });
    } finally {
      setConnectingCode(false);
    }
  }

  async function handleToggleCodex() {
    setConnectingCodex(true);
    setCodexResult(null);
    try {
      const response = codexConnected
        ? await window.vaultAPI.disconnectCodex()
        : await window.vaultAPI.connectCodex();
      if (response.success && response.data) {
        setCodexResult(response.data);
      } else {
        setCodexResult({ success: false, steps: [{ id: 'error', label: 'Operation failed', status: 'fail', detail: response.error }] });
      }
      await refreshStatus();
    } catch (err) {
      setCodexResult({ success: false, steps: [{ id: 'error', label: 'Operation failed', status: 'fail', detail: err instanceof Error ? err.message : 'Unknown error' }] });
    } finally {
      setConnectingCodex(false);
    }
  }

  async function handleToggleClaudeSkill() {
    setInstallingClaudeSkill(true);
    setClaudeSkillResult(null);
    try {
      const response = claudeSkillInstalled
        ? await window.vaultAPI.uninstallSkillFile('claude')
        : await window.vaultAPI.installSkillFile('claude');
      if (response.success && response.data) {
        setClaudeSkillResult(response.data);
      } else {
        setClaudeSkillResult({ success: false, steps: [{ id: 'error', label: 'Operation failed', status: 'fail', detail: response.error }] });
      }
      await refreshStatus();
    } catch (err) {
      setClaudeSkillResult({ success: false, steps: [{ id: 'error', label: 'Operation failed', status: 'fail', detail: err instanceof Error ? err.message : 'Unknown error' }] });
    } finally {
      setInstallingClaudeSkill(false);
    }
  }

  async function handleToggleCodexSkill() {
    setInstallingCodexSkill(true);
    setCodexSkillResult(null);
    try {
      const response = codexSkillInstalled
        ? await window.vaultAPI.uninstallSkillFile('codex')
        : await window.vaultAPI.installSkillFile('codex');
      if (response.success && response.data) {
        setCodexSkillResult(response.data);
      } else {
        setCodexSkillResult({ success: false, steps: [{ id: 'error', label: 'Operation failed', status: 'fail', detail: response.error }] });
      }
      await refreshStatus();
    } catch (err) {
      setCodexSkillResult({ success: false, steps: [{ id: 'error', label: 'Operation failed', status: 'fail', detail: err instanceof Error ? err.message : 'Unknown error' }] });
    } finally {
      setInstallingCodexSkill(false);
    }
  }

  function badgeClass(configured: boolean | undefined): string {
    if (configured === undefined) return 'connect-badge connect-badge-unknown';
    return configured ? 'connect-badge connect-badge-ok' : 'connect-badge connect-badge-fail';
  }

  function badgeLabel(configured: boolean | undefined, name: string): string {
    if (configured === undefined) return `${name}: checking...`;
    return configured ? `${name}: connected` : `${name}: not configured`;
  }

  return (
    <div className="settings-tab-panel">
      {/* Status overview */}
      <section className="panel settings-section">
        <div className="panel-header">
          <div>
            <div className="panel-title">Connection status</div>
            <div className="panel-subtitle">Current state of Vault MCP wiring and client guide installation.</div>
          </div>
          <button
            type="button"
            className="header-button"
            onClick={() => void refreshStatus()}
            disabled={loadingStatus}
          >
            <RefreshCw size={16} />
            <span>{loadingStatus ? 'Checking...' : 'Refresh'}</span>
          </button>
        </div>

        <div className="connect-status-row">
          <span className={badgeClass(connectionStatus?.claudeDesktop.configured)}>
            <span className="connect-badge-dot" />
            {badgeLabel(connectionStatus?.claudeDesktop.configured, 'Claude Desktop')}
          </span>
          <span className={badgeClass(connectionStatus?.claudeCode.configured)}>
            <span className="connect-badge-dot" />
            {badgeLabel(connectionStatus?.claudeCode.configured, 'Claude Code')}
          </span>
          <span className={badgeClass(connectionStatus?.codex.configured)}>
            <span className="connect-badge-dot" />
            {badgeLabel(connectionStatus?.codex.configured, 'Codex')}
          </span>
          <span className={badgeClass(connectionStatus?.skill.claudeInstalled)}>
            <span className="connect-badge-dot" />
            {badgeLabel(connectionStatus?.skill.claudeInstalled, 'Claude skill')}
          </span>
          <span className={badgeClass(connectionStatus?.skill.codexInstalled)}>
            <span className="connect-badge-dot" />
            {badgeLabel(connectionStatus?.skill.codexInstalled, 'Codex skill')}
          </span>
        </div>
      </section>

      <section className="panel settings-section">
        <div className="panel-header">
          <div>
            <div className="panel-title">How to connect a client</div>
            <div className="panel-subtitle">Use one of these flows. MCP connects the client to Vault memory. The skill or guide file teaches the client when to recall and when to save.</div>
          </div>
          <Terminal size={18} className="panel-icon" />
        </div>

        <div className="settings-card-grid">
          <QuickStartCard
            title="Codex"
            description="Best when you want Codex to call Vault tools directly from the Codex app or CLI."
            steps={[
              'Click Connect MCP to write the vault-memory entry into ~/.codex/config.toml.',
              'Click Install guide to append the Vault Memory Skill section into AGENTS.md.',
              'Restart Codex or reload tool servers, then verify with vault_get_latest or vault_recall_context.',
            ]}
          />
          <QuickStartCard
            title="Claude Desktop"
            description="Best when you want Claude Desktop to stay the model and use Vault as its memory tool server."
            steps={[
              'Click Connect MCP to write the vault-memory entry into the Claude Desktop MCP config.',
              'Install the Claude guide if you also want durable recall and save habits in project instructions.',
              'Restart Claude Desktop, then verify by asking it to call vault_get_latest.',
            ]}
          />
          <QuickStartCard
            title="Claude Code or another MCP client"
            description="Use the same Vault server, but match the config format to that client."
            steps={[
              'For Claude Code, use Connect MCP here or follow the manual JSON guide below.',
              'For another client, copy the launcher command or JSON snippet from the manual guide.',
              'Keep the skill file nearby as operator guidance, then verify with a Vault recall tool call.',
            ]}
          />
        </div>
      </section>

      {/* Auto-connect cards */}
      <section className="panel settings-section">
        <div className="panel-header">
          <div>
            <div className="panel-title">Guided setup actions</div>
            <div className="panel-subtitle">These actions edit only the Vault-specific MCP entry or guide reference. Existing client configs stay in place.</div>
          </div>
          <Zap size={18} className="panel-icon" />
        </div>

        <div className="settings-card-grid">
          {/* Claude Desktop */}
          <div className="snippet-card">
            <div className="snippet-head">
              <div>
                <div className="field-label">Claude Desktop</div>
                <div className="field-help">
                  {desktopConnected ? 'vault-memory entry is configured in' : 'Writes vault-memory MCP entry to'}{' '}
                  {connectionStatus?.claudeDesktop.configPath || 'claude_desktop_config.json'}
                </div>
              </div>
              <button
                type="button"
                className={desktopConnected ? 'header-button danger-button' : 'primary-button'}
                onClick={() => void handleToggleDesktop()}
                disabled={connectingDesktop}
              >
                {desktopConnected ? <Unplug size={16} /> : <Cable size={16} />}
                <span>
                  {connectingDesktop
                    ? (desktopConnected ? 'Disconnecting...' : 'Connecting...')
                    : (desktopConnected ? 'Disconnect MCP' : 'Connect MCP')}
                </span>
              </button>
            </div>
            {desktopResult ? <StepList steps={desktopResult.steps} /> : null}
            {desktopResult?.backupPath ? (
              <div className="connect-card-description">Backup saved to: {desktopResult.backupPath}</div>
            ) : null}
            {desktopResult && !desktopResult.success ? (
              <p className="error-text" style={{ marginTop: 8 }}>Operation failed. See steps above or use the manual guide below.</p>
            ) : null}
            {desktopResult?.success && desktopConnected ? (
              <p className="success-text" style={{ marginTop: 8 }}>Claude Desktop configured. Restart Claude Desktop to activate.</p>
            ) : null}
            {desktopResult?.success && !desktopConnected ? (
              <p className="success-text" style={{ marginTop: 8 }}>Claude Desktop disconnected. Restart Claude Desktop to apply.</p>
            ) : null}
          </div>

          {/* Claude Code */}
          <div className="snippet-card">
            <div className="snippet-head">
              <div>
                <div className="field-label">Claude Code</div>
                <div className="field-help">
                  {codeConnected ? 'vault-memory entry is configured in' : 'Writes vault-memory MCP entry to'}{' '}
                  {connectionStatus?.claudeCode.configPath || 'settings.json'}
                </div>
              </div>
              <button
                type="button"
                className={codeConnected ? 'header-button danger-button' : 'primary-button'}
                onClick={() => void handleToggleCode()}
                disabled={connectingCode}
              >
                {codeConnected ? <Unplug size={16} /> : <Cable size={16} />}
                <span>
                  {connectingCode
                    ? (codeConnected ? 'Disconnecting...' : 'Connecting...')
                    : (codeConnected ? 'Disconnect MCP' : 'Connect MCP')}
                </span>
              </button>
            </div>
            {codeResult ? <StepList steps={codeResult.steps} /> : null}
            {codeResult?.backupPath ? (
              <div className="connect-card-description">Backup saved to: {codeResult.backupPath}</div>
            ) : null}
            {codeResult && !codeResult.success ? (
              <p className="error-text" style={{ marginTop: 8 }}>Operation failed. See steps above or use the manual guide below.</p>
            ) : null}
            {codeResult?.success && codeConnected ? (
              <p className="success-text" style={{ marginTop: 8 }}>Claude Code configured. Restart Claude Code to activate.</p>
            ) : null}
            {codeResult?.success && !codeConnected ? (
              <p className="success-text" style={{ marginTop: 8 }}>Claude Code disconnected. Restart Claude Code to apply.</p>
            ) : null}
          </div>

          {/* Codex */}
          <div className="snippet-card">
            <div className="snippet-head">
              <div>
                <div className="field-label">Codex</div>
                <div className="field-help">
                  {codexConnected ? 'vault-memory entry is configured in' : 'Writes vault-memory MCP entry to'}{' '}
                  {connectionStatus?.codex.configPath || '~/.codex/config.toml'}
                </div>
              </div>
              <button
                type="button"
                className={codexConnected ? 'header-button danger-button' : 'primary-button'}
                onClick={() => void handleToggleCodex()}
                disabled={connectingCodex}
              >
                {codexConnected ? <Unplug size={16} /> : <Cable size={16} />}
                <span>
                  {connectingCodex
                    ? (codexConnected ? 'Disconnecting...' : 'Connecting...')
                    : (codexConnected ? 'Disconnect MCP' : 'Connect MCP')}
                </span>
              </button>
            </div>
            {codexResult ? <StepList steps={codexResult.steps} /> : null}
            {codexResult?.backupPath ? (
              <div className="connect-card-description">Backup saved to: {codexResult.backupPath}</div>
            ) : null}
            {codexResult && !codexResult.success ? (
              <p className="error-text" style={{ marginTop: 8 }}>Operation failed. See steps above or use the manual guide below.</p>
            ) : null}
            {codexResult?.success && codexConnected ? (
              <p className="success-text" style={{ marginTop: 8 }}>Codex configured. Restart Codex or reload tool servers to activate.</p>
            ) : null}
            {codexResult?.success && !codexConnected ? (
              <p className="success-text" style={{ marginTop: 8 }}>Codex disconnected. Restart Codex or reload tool servers to apply.</p>
            ) : null}
            <div className="inline-actions">
              <button type="button" className="header-button" onClick={() => void copyText('codex-command', MCP_SERVER_COMMAND, 'Copied Vault launcher command for Codex.')}>
                <Copy size={16} />
                <span>{copiedToken === 'codex-command' ? 'Copied' : 'Copy MCP command'}</span>
              </button>
            </div>
          </div>

          {/* Claude Skill Installation */}
          <div className="snippet-card">
            <div className="snippet-head">
              <div>
                <div className="field-label">{claudeSkillInstalled ? 'Claude skill installed' : 'Install Claude skill'}</div>
                <div className="field-help">
                  {claudeSkillInstalled ? 'Vault memory skill reference is in' : 'Appends a Vault memory skill reference to'}{' '}
                  {connectionStatus?.skill.claudeMdPath || '~/.claude/CLAUDE.md'}
                </div>
              </div>
              <button
                type="button"
                className={claudeSkillInstalled ? 'header-button danger-button' : 'primary-button'}
                onClick={() => void handleToggleClaudeSkill()}
                disabled={installingClaudeSkill}
              >
                {claudeSkillInstalled ? <Trash2 size={16} /> : <BookCopy size={16} />}
                <span>
                  {installingClaudeSkill
                    ? (claudeSkillInstalled ? 'Removing...' : 'Installing...')
                    : (claudeSkillInstalled ? 'Remove guide' : 'Install guide')}
                </span>
              </button>
            </div>
            {claudeSkillResult ? <StepList steps={claudeSkillResult.steps} /> : null}
            {claudeSkillResult && !claudeSkillResult.success ? (
              <p className="error-text" style={{ marginTop: 8 }}>Operation failed. See steps above.</p>
            ) : null}
            {claudeSkillResult?.success && claudeSkillInstalled ? (
              <p className="success-text" style={{ marginTop: 8 }}>Skill reference added to CLAUDE.md.</p>
            ) : null}
            {claudeSkillResult?.success && !claudeSkillInstalled ? (
              <p className="success-text" style={{ marginTop: 8 }}>Skill reference removed from CLAUDE.md.</p>
            ) : null}
          </div>

          {/* Codex Skill Installation */}
          <div className="snippet-card">
            <div className="snippet-head">
              <div>
                <div className="field-label">{codexSkillInstalled ? 'Codex skill installed' : 'Install Codex skill'}</div>
                <div className="field-help">
                  {codexSkillInstalled ? 'Vault memory skill reference is in' : 'Appends a Vault memory skill reference to'}{' '}
                  {connectionStatus?.skill.codexAgentsPath || 'AGENTS.md'}
                </div>
              </div>
              <button
                type="button"
                className={codexSkillInstalled ? 'header-button danger-button' : 'primary-button'}
                onClick={() => void handleToggleCodexSkill()}
                disabled={installingCodexSkill}
              >
                {codexSkillInstalled ? <Trash2 size={16} /> : <BookCopy size={16} />}
                <span>
                  {installingCodexSkill
                    ? (codexSkillInstalled ? 'Removing...' : 'Installing...')
                    : (codexSkillInstalled ? 'Remove guide' : 'Install guide')}
                </span>
              </button>
            </div>
            {codexSkillResult ? <StepList steps={codexSkillResult.steps} /> : null}
            {codexSkillResult && !codexSkillResult.success ? (
              <p className="error-text" style={{ marginTop: 8 }}>Operation failed. See steps above.</p>
            ) : null}
            {codexSkillResult?.success && codexSkillInstalled ? (
              <p className="success-text" style={{ marginTop: 8 }}>Skill reference added to AGENTS.md.</p>
            ) : null}
            {codexSkillResult?.success && !codexSkillInstalled ? (
              <p className="success-text" style={{ marginTop: 8 }}>Skill reference removed from AGENTS.md.</p>
            ) : null}
          </div>
        </div>
      </section>

      {/* Manual setup guide — always accessible */}
      <section className="panel settings-section">
        <button
          type="button"
          className="manual-toggle"
          onClick={() => setManualOpen((open) => !open)}
        >
          <span className={`manual-toggle-arrow ${manualOpen ? 'manual-toggle-arrow-open' : ''}`}>
            <ChevronRight size={16} />
          </span>
          <span>Manual setup guide</span>
          <span className="field-help" style={{ marginLeft: 8 }}>Use this if guided setup fails or for unsupported clients</span>
        </button>

        {manualOpen ? (
          <>
            {/* Shared config snippets */}
            <section className="manual-guide-section">
              <div className="manual-guide-heading">Config snippets</div>
              <div className="manual-guide-description">Use these when manually configuring any MCP client.</div>

              <div className="settings-card-grid">
                <div className="snippet-card">
                  <div className="snippet-head">
                    <div>
                      <div className="field-label">Launcher command</div>
                      <div className="field-help">For clients that start MCP servers from a shell command.</div>
                    </div>
                    <button type="button" className="header-button" onClick={() => void copyText('mcp-command', MCP_SERVER_COMMAND, 'Copied Vault MCP launcher command.')}>
                      <Copy size={16} />
                      <span>{copiedToken === 'mcp-command' ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                  <pre className="snippet-block">{MCP_SERVER_COMMAND}</pre>
                </div>

                <div className="snippet-card">
                  <div className="snippet-head">
                    <div>
                      <div className="field-label">JSON config block</div>
                      <div className="field-help">For clients that use an mcpServers JSON config.</div>
                    </div>
                    <button type="button" className="header-button" onClick={() => void copyText('mcp-json', JSON_CLIENT_SNIPPET, 'Copied Vault MCP JSON snippet.')}>
                      <Copy size={16} />
                      <span>{copiedToken === 'mcp-json' ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                  <pre className="snippet-block">{JSON_CLIENT_SNIPPET}</pre>
                </div>
              </div>
            </section>

            {/* Per-client guides */}
            <section className="manual-guide-section">
              <div className="manual-guide-heading">Claude Desktop</div>
              <div className="manual-guide-description">
                Config file: <code>{connectionStatus?.claudeDesktop.configPath || '%APPDATA%\\Claude\\claude_desktop_config.json'}</code>
              </div>
              <ol className="manual-guide-steps">
                <li>Open the config file above (create it if it does not exist).</li>
                <li>Add or merge the JSON config block into the <code>mcpServers</code> object.</li>
                <li>Save the file and fully restart Claude Desktop.</li>
                <li>Verify by asking Claude to call <code>vault_get_latest</code> for a known project.</li>
              </ol>
            </section>

            <section className="manual-guide-section">
              <div className="manual-guide-heading">Claude Code</div>
              <div className="manual-guide-description">
                Config file: <code>{connectionStatus?.claudeCode.configPath || '~/.claude/settings.json'}</code>
              </div>
              <ol className="manual-guide-steps">
                <li>Open the config file above (create it if it does not exist).</li>
                <li>Add or merge the JSON config block into the <code>mcpServers</code> object.</li>
                <li>Save the file and restart Claude Code.</li>
                <li>Verify by asking Claude Code to call <code>vault_recall_context</code>.</li>
              </ol>
            </section>

            <section className="manual-guide-section">
              <div className="manual-guide-heading">Codex</div>
              <div className="manual-guide-description">
                Config file: <code>{connectionStatus?.codex.configPath || '~/.codex/config.toml'}</code>
              </div>
              <ol className="manual-guide-steps">
                <li>Open the config file above or use the Connect button.</li>
                <li>Add or update the <code>[mcp_servers.vault-memory]</code> block to point at the Vault MCP server.</li>
                <li>Save the file and restart Codex or reload its tool servers.</li>
                <li>Verify by asking Codex to run <code>vault_get_latest</code> or <code>vault_recall_context</code>.</li>
              </ol>
            </section>

            <section className="manual-guide-section">
              <div className="manual-guide-heading">Other stdio MCP clients</div>
              <div className="manual-guide-description">
                Any client that can launch a command or accept an MCP server config can connect to Vault.
              </div>
              <ol className="manual-guide-steps">
                <li>Use either the launcher command or JSON config block from above.</li>
                <li>The client stays the AI — Vault provides the memory tool server.</li>
                <li>Verify with <code>vault_get_latest</code> after connecting.</li>
              </ol>
            </section>

            <section className="manual-guide-section">
              <div className="manual-guide-heading">Skill installation (manual)</div>
              <div className="manual-guide-description">
                The skill file teaches agents when to recall, when to save, and how to structure memory items.
              </div>
              <ol className="manual-guide-steps">
                <li>Copy the contents of <code>skills/claude-vault-skill.md</code> (or <code>skills/codex-vault-skill.md</code> for Codex).</li>
                <li>Paste the full file into your agent's project instructions, CLAUDE.md, or system prompt.</li>
                <li>Keep the file path stable so future setup prompts can reference it.</li>
              </ol>
            </section>

            <div className="note-card">
              <p>MCP means the external client stays the model and Vault stays the memory tool server.</p>
              <p>This is separate from the Local backend tab, where Vault itself launches a CLI for desktop chat.</p>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
