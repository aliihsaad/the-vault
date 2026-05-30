import { useEffect, useState } from 'react';
import {
  BookCopy,
  Cable,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  RefreshCw,
  Settings2,
  Terminal,
  Unplug,
  Wrench,
  X,
  Minus,
  Zap,
  Trash2,
} from 'lucide-react';

const ONE_COMMAND_SETUP = 'pnpm setup:mcp';
const ONE_COMMAND_DRY_RUN = 'pnpm setup:mcp:dry-run';
const MCP_SERVER_COMMAND = 'pnpm --filter @the-vault/mcp-server dev';

interface ConnectPanelProps {
  copyText: (token: string, value: string, successMessage?: string) => Promise<void>;
  copiedToken: string | null;
}

function quoteCliArg(value: string): string {
  return /\s/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function buildRuntimeCommand(runtime?: ConnectionStatus['mcpRuntime']): string {
  if (!runtime) {
    return MCP_SERVER_COMMAND;
  }

  return [runtime.command, ...runtime.args].map(quoteCliArg).join(' ');
}

function buildJsonClientSnippet(runtime?: ConnectionStatus['mcpRuntime'], serverName = 'vault-memory'): string {
  const fallback = serverName === 'vault-collab'
    ? {
        command: 'npm',
        args: ['exec', '--yes', '--package', 'https://github.com/aliihsaad/vault-collab', '--', 'vault-collab-mcp'],
      }
    : { command: 'pnpm', args: ['--filter', '@the-vault/mcp-server', 'dev'] };

  return JSON.stringify(
    {
      mcpServers: {
        [serverName]: runtime
          ? { command: runtime.command, args: runtime.args }
          : fallback,
      },
    },
    null,
    2,
  );
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
  const [collabResult, setCollabResult] = useState<ConnectResult | null>(null);
  const [claudeSkillResult, setClaudeSkillResult] = useState<ConnectResult | null>(null);
  const [codexSkillResult, setCodexSkillResult] = useState<ConnectResult | null>(null);
  const [connectingDesktop, setConnectingDesktop] = useState(false);
  const [connectingCode, setConnectingCode] = useState(false);
  const [connectingCodex, setConnectingCodex] = useState(false);
  const [connectingAll, setConnectingAll] = useState(false);
  const [connectingCollab, setConnectingCollab] = useState(false);
  const [installingClaudeSkill, setInstallingClaudeSkill] = useState(false);
  const [installingCodexSkill, setInstallingCodexSkill] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [troubleshootingOpen, setTroubleshootingOpen] = useState(false);

  const desktopConnected = connectionStatus?.claudeDesktop.configured ?? false;
  const codeConnected = connectionStatus?.claudeCode.configured ?? false;
  const codexConnected = connectionStatus?.codex.configured ?? false;
  const claudeSkillInstalled = connectionStatus?.skill.claudeInstalled ?? false;
  const codexSkillInstalled = connectionStatus?.skill.codexInstalled ?? false;
  const collabDesktopConnected = connectionStatus?.vaultCollab?.claudeDesktop.configured ?? false;
  const collabCodeConnected = connectionStatus?.vaultCollab?.claudeCode.configured ?? false;
  const collabCodexConnected = connectionStatus?.vaultCollab?.codex.configured ?? false;
  const claudeCollabCommandInstalled = connectionStatus?.vaultCollab?.command.claudeInstalled ?? false;
  const codexCollabSlashSupported = connectionStatus?.vaultCollab?.command.codexSlashCommandSupported ?? false;
  const connectedClientCount = [desktopConnected, codeConnected, codexConnected].filter(Boolean).length;
  const allClientsConnected = connectedClientCount === 3;
  const collabConnectedClientCount = [collabDesktopConnected, collabCodeConnected, collabCodexConnected].filter(Boolean).length;
  const allCollabClientsConnected = collabConnectedClientCount === 3;
  const vaultCollabInstalled = allCollabClientsConnected && claudeCollabCommandInstalled;
  const isPackagedRuntime = connectionStatus?.mcpRuntime.mode === 'packaged';
  const runtimeCommand = buildRuntimeCommand(connectionStatus?.mcpRuntime);
  const jsonClientSnippet = buildJsonClientSnippet(connectionStatus?.mcpRuntime);
  const collabRuntimeCommand = buildRuntimeCommand(connectionStatus?.vaultCollab?.mcpRuntime);
  const collabJsonClientSnippet = buildJsonClientSnippet(connectionStatus?.vaultCollab?.mcpRuntime, 'vault-collab');

  useEffect(() => {
    void refreshStatus();
  }, []);

  // Auto-expand manual section when any operation fails
  useEffect(() => {
    const anyFailed =
      (desktopResult && !desktopResult.success) ||
      (codeResult && !codeResult.success) ||
      (codexResult && !codexResult.success) ||
      (collabResult && !collabResult.success) ||
      (claudeSkillResult && !claudeSkillResult.success) ||
      (codexSkillResult && !codexSkillResult.success);
    if (anyFailed) {
      setManualOpen(true);
    }
  }, [desktopResult, codeResult, codexResult, collabResult, claudeSkillResult, codexSkillResult]);

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

  async function handleToggleTroubleshooting() {
    setTroubleshootingOpen((open) => !open);
    setManualOpen(true);
    await refreshStatus();
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

  async function handleToggleVaultCollabClients() {
    setConnectingCollab(true);
    setCollabResult(null);
    try {
      const response = vaultCollabInstalled
        ? await window.vaultAPI.disconnectVaultCollabClients()
        : await window.vaultAPI.connectVaultCollabClients();
      if (response.success && response.data) {
        setCollabResult(response.data);
      } else {
        setCollabResult({ success: false, steps: [{ id: 'error', label: 'Operation failed', status: 'fail', detail: response.error }] });
      }
      await refreshStatus();
    } catch (err) {
      setCollabResult({ success: false, steps: [{ id: 'error', label: 'Operation failed', status: 'fail', detail: err instanceof Error ? err.message : 'Unknown error' }] });
    } finally {
      setConnectingCollab(false);
    }
  }

  async function handleConnectAllMcp() {
    setConnectingAll(true);
    setDesktopResult(null);
    setCodeResult(null);
    setCodexResult(null);

    try {
      if (!desktopConnected) {
        const response = await window.vaultAPI.connectClaudeDesktop();
        setDesktopResult(response.success && response.data
          ? response.data
          : { success: false, steps: [{ id: 'error', label: 'Claude Desktop setup failed', status: 'fail', detail: response.error }] });
      }

      if (!codeConnected) {
        const response = await window.vaultAPI.connectClaudeCode();
        setCodeResult(response.success && response.data
          ? response.data
          : { success: false, steps: [{ id: 'error', label: 'Claude Code setup failed', status: 'fail', detail: response.error }] });
      }

      if (!codexConnected) {
        const response = await window.vaultAPI.connectCodex();
        setCodexResult(response.success && response.data
          ? response.data
          : { success: false, steps: [{ id: 'error', label: 'Codex setup failed', status: 'fail', detail: response.error }] });
      }

      await refreshStatus();
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Unknown error';
      setCodexResult({ success: false, steps: [{ id: 'error', label: 'Connect all failed', status: 'fail', detail }] });
    } finally {
      setConnectingAll(false);
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

  const clientDiagnostics: Array<{ label: string; configured: boolean; configPath: string }> = [
    {
      label: 'Claude Desktop',
      configured: desktopConnected,
      configPath: connectionStatus?.claudeDesktop.configPath || 'claude_desktop_config.json',
    },
    {
      label: 'Claude Code',
      configured: codeConnected,
      configPath: connectionStatus?.claudeCode.configPath || '~/.claude.json',
    },
    {
      label: 'Codex',
      configured: codexConnected,
      configPath: connectionStatus?.codex.configPath || '~/.codex/config.toml',
    },
  ];

  return (
    <div className="settings-tab-panel">
      <section className="connect-hero-grid">
        <div className="panel settings-section connect-primary-panel">
          <div className="connect-kicker">
            <Terminal size={16} />
            <span>New user setup</span>
          </div>
          <div className="connect-hero-copy">
            <h2>Connect Vault MCP without hand-editing configs</h2>
            <p>
              {isPackagedRuntime
                ? 'The installed app ships its own MCP runtime. Use the connect button once, then restart your client so it launches Vault from the installed app resources.'
                : 'From the Vault repo root, run the setup command once. It builds the server, deploys the standalone MCP runtime, writes client config, creates backups, and checks the MCP handshake.'}
            </p>
          </div>

          <div className="connect-command-card">
            <div>
              <span className="field-label">{isPackagedRuntime ? 'Bundled MCP runtime' : 'Terminal command'}</span>
              <code>{isPackagedRuntime ? connectionStatus?.mcpRuntime.displayPath || 'Packaged with Vault' : ONE_COMMAND_SETUP}</code>
            </div>
            {isPackagedRuntime ? null : (
              <button
                type="button"
                className="header-button"
                onClick={() => void copyText('setup-mcp-command', ONE_COMMAND_SETUP, 'Copied one-command MCP setup.')}
              >
                <Copy size={16} />
                <span>{copiedToken === 'setup-mcp-command' ? 'Copied' : 'Copy'}</span>
              </button>
            )}
          </div>

          <div className="inline-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => void handleConnectAllMcp()}
              disabled={connectingAll || allClientsConnected}
            >
              <Cable size={16} />
              <span>{connectingAll ? 'Connecting...' : allClientsConnected ? 'All MCP clients connected' : 'Connect all MCP clients'}</span>
            </button>
            {isPackagedRuntime ? null : (
              <button
                type="button"
                className="header-button"
                onClick={() => void copyText('setup-mcp-dry-run', ONE_COMMAND_DRY_RUN, 'Copied dry-run setup command.')}
              >
                <CheckCircle2 size={16} />
                <span>{copiedToken === 'setup-mcp-dry-run' ? 'Copied' : 'Copy dry run'}</span>
              </button>
            )}
            <button
              type="button"
              className="header-button"
              onClick={() => void handleToggleTroubleshooting()}
            >
              <Wrench size={16} />
              <span>{troubleshootingOpen ? 'Hide troubleshoot' : 'Troubleshoot MCP'}</span>
            </button>
          </div>

          <ol className="connect-flow-list">
            <li>{isPackagedRuntime ? 'Install Vault from the GitHub release installer.' : <>Run <code>pnpm install</code> if dependencies are not installed yet.</>}</li>
            <li>{isPackagedRuntime ? 'Use Connect all MCP clients or the per-client buttons on this page.' : <>Run <code>{ONE_COMMAND_SETUP}</code> or use the connect buttons on this page.</>}</li>
            <li>Restart Codex, Claude Desktop, or Claude Code so the client launches the updated server.</li>
          </ol>
        </div>

        <div className="panel settings-section connect-status-panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Connection status</div>
              <div className="panel-subtitle">{connectedClientCount}/3 MCP clients configured.</div>
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

          <div className="connect-status-row connect-status-stack">
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
            <span className={badgeClass(connectionStatus ? allCollabClientsConnected : undefined)}>
              <span className="connect-badge-dot" />
              {connectionStatus ? `Vault Collab MCP: ${collabConnectedClientCount}/3 clients` : 'Vault Collab MCP: checking...'}
            </span>
            <span className={badgeClass(connectionStatus ? claudeCollabCommandInstalled : undefined)}>
              <span className="connect-badge-dot" />
              {connectionStatus ? `Claude /vault-collab: ${claudeCollabCommandInstalled ? 'installed' : 'not installed'}` : 'Claude /vault-collab: checking...'}
            </span>
          </div>
        </div>
      </section>

      {troubleshootingOpen ? (
        <section className="panel settings-section connect-troubleshoot-panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">MCP troubleshooting</div>
              <div className="panel-subtitle">Use this when a client says vault-memory disconnected, cannot attach, or starts with a handshake error.</div>
            </div>
            <button
              type="button"
              className="header-button"
              onClick={() => void refreshStatus()}
              disabled={loadingStatus}
            >
              <RefreshCw size={16} />
              <span>{loadingStatus ? 'Checking...' : 'Recheck'}</span>
            </button>
          </div>

          <div className="connect-troubleshoot-grid">
            <div className="connect-diagnostic-card">
              <div className="field-label">Runtime used by clients</div>
              <div className="connect-diagnostic-row">
                <span>Mode</span>
                <strong>{connectionStatus?.mcpRuntime.mode || 'checking'}</strong>
              </div>
              <div className="connect-diagnostic-row">
                <span>Command</span>
                <code>{connectionStatus?.mcpRuntime.command || 'unavailable'}</code>
              </div>
              <div className="connect-diagnostic-row">
                <span>Args</span>
                <code>{connectionStatus?.mcpRuntime.args.join(' ') || 'none'}</code>
              </div>
            </div>

            <div className="connect-diagnostic-card">
              <div className="field-label">Client config files</div>
              {clientDiagnostics.map(({ label, configured, configPath }) => (
                <div key={label} className="connect-client-row">
                  <span className={badgeClass(configured)}>
                    <span className="connect-badge-dot" />
                    {configured ? 'connected' : 'needs setup'}
                  </span>
                  <div>
                    <strong>{label}</strong>
                    <code>{configPath}</code>
                  </div>
                </div>
              ))}
            </div>

            <div className="connect-diagnostic-card connect-diagnostic-card-wide">
              <div className="field-label">Fast fix checklist</div>
              <ol className="connect-fix-list">
                <li>Click <strong>Connect all MCP clients</strong> or the affected client's <strong>Connect MCP</strong> button.</li>
                <li>Fully restart the affected client after setup. MCP config is usually read only at client startup.</li>
                <li>{isPackagedRuntime ? 'If the runtime path is missing, reinstall Vault from the latest release.' : <>If using a source checkout, run <code>{ONE_COMMAND_SETUP}</code> from the repo root.</>}</li>
                <li>Verify with <code>vault_get_latest</code> or <code>vault_recall_context</code> inside the client.</li>
              </ol>
              <div className="inline-actions">
                <button type="button" className="header-button" onClick={() => void copyText('troubleshoot-command', runtimeCommand, 'Copied MCP runtime command.')}>
                  <Copy size={16} />
                  <span>{copiedToken === 'troubleshoot-command' ? 'Copied' : 'Copy runtime command'}</span>
                </button>
                <button type="button" className="header-button" onClick={() => void copyText('troubleshoot-json', jsonClientSnippet, 'Copied MCP JSON config.')}>
                  <Copy size={16} />
                  <span>{copiedToken === 'troubleshoot-json' ? 'Copied' : 'Copy JSON config'}</span>
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section className="panel settings-section">
        <div className="panel-header">
          <div>
            <div className="panel-title">How to connect a client</div>
            <div className="panel-subtitle">Pick the client your new user already works in. MCP gives the client Vault tools; the guide teaches recall and save habits.</div>
          </div>
          <Settings2 size={18} className="panel-icon" />
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
          <QuickStartCard
            title="Brain + Vault Collab"
            description="After memory MCP is connected, add durable client memory and the optional live handoff inbox."
            steps={[
              'Let the installed guide create or recall the client brain: Codex-brain, claude-code-brain, or claude-desktop-brain.',
              'Click Connect Vault Collab MCP to add the provider-neutral inbox server beside vault-memory.',
              'Use /vault-collab in Claude Code after restart, or type "use vault collab" in Codex because Codex does not load personal unprefixed slash commands.',
              'Verify with vault_collab_register_session, vault_collab_list_inbox, and vault_collab_claim_handoff before using active handoffs.',
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

        <div className="connect-action-grid">
          {/* Vault Collab MCP + Claude slash command */}
          <div className="snippet-card connect-action-card">
            <div className="snippet-head">
              <div>
                <div className="field-label">Vault Collab MCP + /vault-collab</div>
                <div className="field-help">
                  <span>
                    {vaultCollabInstalled
                      ? 'vault-collab MCP entries and the Claude Code command are installed'
                      : 'Writes vault-collab MCP entries and installs the Claude Code /vault-collab command'}
                  </span>
                  <code className="connect-config-path">{connectionStatus?.vaultCollab?.mcpRuntime.displayPath || 'vault-collab-mcp'}</code>
                </div>
              </div>
              <button
                type="button"
                className={vaultCollabInstalled ? 'header-button danger-button' : 'primary-button'}
                onClick={() => void handleToggleVaultCollabClients()}
                disabled={connectingCollab}
              >
                {vaultCollabInstalled ? <Unplug size={16} /> : <Cable size={16} />}
                <span>
                  {connectingCollab
                    ? (vaultCollabInstalled ? 'Disconnecting...' : 'Connecting...')
                    : (vaultCollabInstalled ? 'Disconnect Vault Collab' : 'Connect Vault Collab MCP')}
                </span>
              </button>
            </div>
            <div className="connect-status-row">
              <span className={badgeClass(connectionStatus ? allCollabClientsConnected : undefined)}>
                <span className="connect-badge-dot" />
                {connectionStatus ? `${collabConnectedClientCount}/3 clients` : 'checking clients'}
              </span>
              <span className={badgeClass(connectionStatus ? claudeCollabCommandInstalled : undefined)}>
                <span className="connect-badge-dot" />
                {claudeCollabCommandInstalled ? 'Claude /vault-collab installed' : 'Claude /vault-collab missing'}
              </span>
              <span className="connect-badge connect-badge-unknown">
                <span className="connect-badge-dot" />
                {codexCollabSlashSupported ? 'Codex slash command supported' : 'Codex uses prompt shortcut'}
              </span>
            </div>
            <div className="field-help">
              This adds a second MCP server beside <code>vault-memory</code>. Restart Codex, Claude Code, or Claude Desktop before expecting <code>vault_collab_*</code> tools to appear. Codex should be prompted with <code>use vault collab</code>; Claude Code can run <code>/vault-collab</code>.
            </div>
            {collabResult ? <StepList steps={collabResult.steps} /> : null}
            {collabResult?.backupPath ? (
              <div className="connect-card-description">Backups saved to: {collabResult.backupPath}</div>
            ) : null}
            {collabResult && !collabResult.success ? (
              <p className="error-text" style={{ marginTop: 8 }}>Operation failed. See steps above or use the manual guide below.</p>
            ) : null}
            {collabResult?.success && vaultCollabInstalled ? (
              <p className="success-text" style={{ marginTop: 8 }}>Vault Collab MCP is configured. Restart clients, then run <code>/vault-collab</code> in Claude Code or type <code>use vault collab</code> in Codex.</p>
            ) : null}
            {collabResult?.success && !vaultCollabInstalled ? (
              <p className="success-text" style={{ marginTop: 8 }}>Vault Collab MCP and command files were removed. Restart clients to apply.</p>
            ) : null}
            <div className="inline-actions">
              <button type="button" className="header-button" onClick={() => void copyText('vault-collab-command', collabRuntimeCommand, 'Copied Vault Collab MCP command.')}>
                <Copy size={16} />
                <span>{copiedToken === 'vault-collab-command' ? 'Copied' : 'Copy MCP command'}</span>
              </button>
            </div>
          </div>

          {/* Claude Desktop */}
          <div className="snippet-card connect-action-card">
            <div className="snippet-head">
              <div>
                <div className="field-label">Claude Desktop</div>
                <div className="field-help">
                  <span>{desktopConnected ? 'vault-memory entry is configured in' : 'Writes vault-memory MCP entry to'}</span>
                  <code className="connect-config-path">{connectionStatus?.claudeDesktop.configPath || 'claude_desktop_config.json'}</code>
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
          <div className="snippet-card connect-action-card">
            <div className="snippet-head">
              <div>
                <div className="field-label">Claude Code</div>
                <div className="field-help">
                  <span>{codeConnected ? 'vault-memory entry is configured in' : 'Writes vault-memory MCP entry to'}</span>
                  <code className="connect-config-path">{connectionStatus?.claudeCode.configPath || '~/.claude.json'}</code>
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
          <div className="snippet-card connect-action-card">
            <div className="snippet-head">
              <div>
                <div className="field-label">Codex</div>
                <div className="field-help">
                  <span>{codexConnected ? 'vault-memory entry is configured in' : 'Writes vault-memory MCP entry to'}</span>
                  <code className="connect-config-path">{connectionStatus?.codex.configPath || '~/.codex/config.toml'}</code>
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
              <button type="button" className="header-button" onClick={() => void copyText('codex-command', runtimeCommand, 'Copied Vault launcher command for Codex.')}>
                <Copy size={16} />
                <span>{copiedToken === 'codex-command' ? 'Copied' : 'Copy MCP command'}</span>
              </button>
            </div>
          </div>

          {/* Claude Skill Installation */}
          <div className="snippet-card connect-action-card">
            <div className="snippet-head">
              <div>
                <div className="field-label">{claudeSkillInstalled ? 'Claude skill installed' : 'Install Claude skill'}</div>
                <div className="field-help">
                  <span>{claudeSkillInstalled ? 'Vault memory skill is installed at' : 'Writes Vault memory SKILL.md to'}</span>
                  <code className="connect-config-path">{connectionStatus?.skill.claudeSkillPath || '~/.claude/skills/vault-memory/SKILL.md'}</code>
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
              <p className="success-text" style={{ marginTop: 8 }}>SKILL.md installed for Claude Code.</p>
            ) : null}
            {claudeSkillResult?.success && !claudeSkillInstalled ? (
              <p className="success-text" style={{ marginTop: 8 }}>Claude Code skill removed.</p>
            ) : null}
          </div>

          {/* Codex Skill Installation */}
          <div className="snippet-card connect-action-card">
            <div className="snippet-head">
              <div>
                <div className="field-label">{codexSkillInstalled ? 'Codex skill installed' : 'Install Codex skill'}</div>
                <div className="field-help">
                  <span>{codexSkillInstalled ? 'Vault memory skill reference is in' : 'Appends a Vault memory skill reference to'}</span>
                  <code className="connect-config-path">{connectionStatus?.skill.codexAgentsPath || 'AGENTS.md'}</code>
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
                    <button type="button" className="header-button" onClick={() => void copyText('mcp-command', runtimeCommand, 'Copied Vault MCP launcher command.')}>
                      <Copy size={16} />
                      <span>{copiedToken === 'mcp-command' ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                  <pre className="snippet-block">{runtimeCommand}</pre>
                </div>

                <div className="snippet-card">
                  <div className="snippet-head">
                    <div>
                      <div className="field-label">JSON config block</div>
                      <div className="field-help">For clients that use an mcpServers JSON config.</div>
                    </div>
                    <button type="button" className="header-button" onClick={() => void copyText('mcp-json', jsonClientSnippet, 'Copied Vault MCP JSON snippet.')}>
                      <Copy size={16} />
                      <span>{copiedToken === 'mcp-json' ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                  <pre className="snippet-block">{jsonClientSnippet}</pre>
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
                Config file: <code>{connectionStatus?.claudeCode.configPath || '~/.claude.json'}</code>
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
                The skill file teaches agents when to recall, when to save, how to create their own brain memory if missing, and how to use Vault Collab MCP when attached.
              </div>
              <ol className="manual-guide-steps">
                <li>Copy the contents of <code>skills/claude-vault-skill.md</code> (or <code>skills/codex-vault-skill.md</code> for Codex).</li>
                <li>Paste the full file into your agent's project instructions, CLAUDE.md, or system prompt.</li>
                <li>Keep the file path stable so future setup prompts can reference it.</li>
                <li>After Vault MCP is connected, verify the client can call <code>vault_list_projects</code>, then let it bootstrap <code>Codex-brain</code>, <code>claude-code-brain</code>, or <code>claude-desktop-brain</code> as appropriate.</li>
              </ol>
            </section>

            <section className="manual-guide-section">
              <div className="manual-guide-heading">Vault Collab MCP (optional)</div>
              <div className="manual-guide-description">
                Vault Collab is a second MCP server for live sessions and handoff inbox routing. Vault MCP still owns durable memory.
              </div>
              <ol className="manual-guide-steps">
                <li>Prefer the <strong>Connect Vault Collab MCP</strong> guided action above. It adds the <code>vault-collab</code> server and installs the Claude Code <code>/vault-collab</code> command file.</li>
                <li>For manual setup, add the JSON block below as a second MCP server beside <code>vault-memory</code> in the target client.</li>
                <li>Restart the client. In Claude Code, run <code>/vault-collab</code>. In Codex, type <code>use vault collab</code>. Then verify with <code>vault_collab_register_session</code> and <code>vault_collab_list_inbox</code>.</li>
                <li>Only call <code>vault_collab_claim_handoff</code> when the user approves the handoff or the current session is idle.</li>
              </ol>
              <pre className="snippet-block">{collabJsonClientSnippet}</pre>
            </section>

            <div className="note-card">
              <p>MCP means the external client stays the model and Vault stays the memory tool server.</p>
              <p>Vault does not need to launch Codex or Claude itself; connected clients call Vault tools directly.</p>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
