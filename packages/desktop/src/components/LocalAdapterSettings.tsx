import { useEffect, useState } from 'react';
import { Cable, ChevronDown, ChevronUp, Copy, RefreshCw, RotateCcw, ShieldCheck, Sparkles } from 'lucide-react';

const DEFAULT_LOCAL_ADAPTER_CONFIG: LocalAdapterConfig = {
  enabled: false,
  type: '',
  cwd: '',
  command: '',
  model: '',
  effort: '',
  chrome: false,
  maxTurns: null,
};

const CLAUDE_EFFORT_OPTIONS = ['', 'low', 'medium', 'high', 'max'];
const CODEX_EFFORT_OPTIONS = ['', 'low', 'medium', 'high', 'xhigh'];

export function LocalAdapterSettings({
  savedConfig,
  savedLastTest,
  savedRuntimeState,
  savedTaskSessions,
  savedTaskKey,
  defaultCwd = '',
}: {
  savedConfig?: LocalAdapterConfig;
  savedLastTest?: LocalAdapterTestResult | null;
  savedRuntimeState?: LocalAdapterRuntimeState;
  savedTaskSessions?: LocalAdapterTaskSessions;
  savedTaskKey?: string;
  defaultCwd?: string;
}) {
  const [config, setConfig] = useState<LocalAdapterConfig>(savedConfig || DEFAULT_LOCAL_ADAPTER_CONFIG);
  const [definitions, setDefinitions] = useState<LocalAdapterDefinitionSummary[]>([]);
  const [models, setModels] = useState<LocalAdapterModelSummary[]>(savedLastTest?.models || []);
  const [runtimeState, setRuntimeState] = useState<LocalAdapterRuntimeState>(savedRuntimeState || {});
  const [taskSessions, setTaskSessions] = useState<LocalAdapterTaskSessions>(savedTaskSessions || {});
  const [envText, setEnvText] = useState('');
  const [testResult, setTestResult] = useState<LocalAdapterTestResult | null>(savedLastTest || null);
  const [loadingDefinitions, setLoadingDefinitions] = useState(true);
  const [loadingModels, setLoadingModels] = useState(false);
  const [detectingModel, setDetectingModel] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [detectedModel, setDetectedModel] = useState<string | null>(null);

  useEffect(() => {
    void loadAdapterSettings();
  }, []);

  useEffect(() => {
    setConfig(savedConfig || DEFAULT_LOCAL_ADAPTER_CONFIG);
    setTestResult(savedLastTest || null);
    setModels(savedLastTest?.models || []);
    setRuntimeState(savedRuntimeState || {});
    setTaskSessions(savedTaskSessions || {});
  }, [savedConfig, savedLastTest, savedRuntimeState, savedTaskSessions]);

  useEffect(() => {
    if (!defaultCwd.trim()) {
      return;
    }

    setConfig((current) => {
      if (current.cwd.trim()) {
        return current;
      }

      return {
        ...current,
        cwd: defaultCwd.trim(),
      };
    });
  }, [defaultCwd]);

  useEffect(() => {
    if (!config.type) {
      setModels([]);
      setDetectedModel(null);
      return;
    }

    void refreshModels(true);
    void detectModel(true);
  }, [config.type]);

  async function loadAdapterSettings() {
    setLoadingDefinitions(true);
    setError(null);

    try {
      const [definitionsResponse, envResponse] = await Promise.all([
        window.vaultAPI.getSupportedLocalAdapters(),
        window.vaultAPI.getSecretSetting('local_adapter_env_override'),
      ]);

      if (!definitionsResponse.success || !definitionsResponse.data) {
        throw new Error(definitionsResponse.error || 'Failed to load local adapter types');
      }

      if (!envResponse.success) {
        throw new Error(envResponse.error || 'Failed to load local adapter environment overrides');
      }

      setDefinitions(definitionsResponse.data);
      setEnvText(envResponse.data || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load local adapter settings');
    } finally {
      setLoadingDefinitions(false);
    }
  }

  function updateConfig<K extends keyof LocalAdapterConfig>(key: K, value: LocalAdapterConfig[K]) {
    setConfig((current) => ({ ...current, [key]: value }));
    setTestResult(null);
    setMessage(null);
  }

  function updateEnvText(nextValue: string) {
    setEnvText(nextValue);
    setTestResult(null);
    setMessage(null);
  }

  function getSelectedDefinition() {
    return definitions.find((definition) => definition.type === config.type) || null;
  }

  function getEffortOptions() {
    return config.type === 'claude_local' ? CLAUDE_EFFORT_OPTIONS : CODEX_EFFORT_OPTIONS;
  }

  function buildRuntimeConfig(): LocalAdapterConfig {
    const parsedEnv = parseEnvOverrides(envText);
    const effectiveCwd = config.cwd.trim() || defaultCwd.trim();

    return {
      ...config,
      command: config.command.trim(),
      cwd: effectiveCwd,
      env: parsedEnv,
    };
  }

  async function refreshModels(silent = false) {
    if (!config.type) {
      if (!silent) {
        setError('Choose an adapter type before refreshing models.');
      }
      return;
    }

    setLoadingModels(true);
    if (!silent) {
      setError(null);
    }

    try {
      const response = await window.vaultAPI.getLocalAdapterModels(buildRuntimeConfig());
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to load local adapter models');
      }

      setModels(response.data);
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : 'Failed to load local adapter models');
      }
    } finally {
      setLoadingModels(false);
    }
  }

  async function detectModel(silent = false) {
    if (!config.type) {
      setDetectedModel(null);
      return;
    }

    setDetectingModel(true);
    if (!silent) {
      setError(null);
    }

    try {
      const response = await window.vaultAPI.detectLocalAdapterModel(buildRuntimeConfig());
      if (!response.success) {
        throw new Error(response.error || 'Failed to detect the adapter model');
      }

      const nextDetectedModel = response.data || null;
      setDetectedModel(nextDetectedModel);

      if (nextDetectedModel) {
        setConfig((current) => current.model.trim() ? current : {
          ...current,
          model: nextDetectedModel,
        });
      }
    } catch (err) {
      setDetectedModel(null);
      if (!silent) {
        setError(err instanceof Error ? err.message : 'Failed to detect the adapter model');
      }
    } finally {
      setDetectingModel(false);
    }
  }

  async function testEnvironment() {
    if (!config.type) {
      setError('Choose an adapter type before testing.');
      return;
    }

    setTesting(true);
    setError(null);
    setMessage(null);

    try {
      const response = await window.vaultAPI.testLocalAdapterEnvironment(buildRuntimeConfig());
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Local adapter environment test failed');
      }

      setTestResult(response.data);
      setModels(response.data.models);
      setMessage(
        response.data.canProceed
          ? 'Environment test completed. This adapter is ready to be enabled.'
          : 'Environment test completed with warnings. Review the checks before enabling this adapter.',
      );
    } catch (err) {
      setTestResult(null);
      setError(err instanceof Error ? err.message : 'Local adapter environment test failed');
    } finally {
      setTesting(false);
    }
  }

  async function saveAdapter() {
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const runtimeConfig = buildRuntimeConfig();

      if (runtimeConfig.enabled) {
        if (!runtimeConfig.type) {
          throw new Error('Choose an adapter type before enabling a local adapter.');
        }

        if (!testResult?.canProceed) {
          throw new Error('Run Test now and get a recognized environment result before enabling this adapter.');
        }
      }

      const storedConfig: LocalAdapterConfig = {
        enabled: runtimeConfig.enabled,
        type: runtimeConfig.type,
        cwd: runtimeConfig.cwd,
        command: runtimeConfig.command,
        model: runtimeConfig.model,
        effort: runtimeConfig.effort,
        chrome: runtimeConfig.chrome,
        maxTurns: runtimeConfig.maxTurns,
      };

      const [configResponse, envResponse, testResponse] = await Promise.all([
        window.vaultAPI.setSetting('local_adapter_config', storedConfig),
        window.vaultAPI.setSecretSetting('local_adapter_env_override', envText.trim()),
        window.vaultAPI.setSetting('local_adapter_last_test', testResult),
      ]);

      if (!configResponse.success) {
        throw new Error(configResponse.error || 'Failed to save local adapter config');
      }

      if (!envResponse.success) {
        throw new Error(envResponse.error || 'Failed to save local adapter env overrides');
      }

      if (!testResponse.success) {
        throw new Error(testResponse.error || 'Failed to save local adapter test state');
      }

      setMessage(runtimeConfig.enabled ? 'Local adapter saved and enabled.' : 'Local adapter settings saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save local adapter settings');
    } finally {
      setSaving(false);
    }
  }

  async function resetStoredSession() {
    if (!config.type) {
      setError('Choose an adapter type before resetting its saved session.');
      return;
    }

    setError(null);
    setMessage(null);

    try {
      const response = await window.vaultAPI.clearLocalAdapterSession(config.type);
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to clear the saved local adapter session');
      }

      setRuntimeState(response.data);
      setMessage('Stored local adapter session cleared.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear the saved local adapter session');
    }
  }

  async function resetTaskSession() {
    if (!config.type) {
      setError('Choose an adapter type before resetting a thread-scoped session.');
      return;
    }

    if (!savedTaskKey?.trim()) {
      setError('No active session thread key is saved yet. Set one from the chat screen first.');
      return;
    }

    setError(null);
    setMessage(null);

    try {
      const response = await window.vaultAPI.clearLocalAdapterTaskSession(config.type, savedTaskKey.trim());
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to clear the saved thread session');
      }

      setTaskSessions(response.data);
      setMessage(`Thread session cleared for ${savedTaskKey.trim()}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear the saved thread session');
    }
  }

  async function copyText(token: string, value: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = value;
        textArea.setAttribute('readonly', 'true');
        textArea.style.position = 'absolute';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }

      setCopiedToken(token);
      window.setTimeout(() => {
        setCopiedToken((current) => (current === token ? null : current));
      }, 1600);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Copy failed');
    }
  }

  const selectedDefinition = getSelectedDefinition();
  const effortOptions = getEffortOptions();
  const effectiveCwd = config.cwd.trim() || defaultCwd.trim();
  const effectiveCommand = config.command.trim() || selectedDefinition?.defaultCommand || '';
  const selectedRuntimeSession = config.type ? runtimeState[config.type] || null : null;
  const selectedTaskSessions = config.type ? Object.entries(taskSessions[config.type] || {}) : [];
  const activeTaskSession = config.type && savedTaskKey?.trim()
    ? taskSessions[config.type]?.[savedTaskKey.trim()] || null
    : null;
  const recentTaskSessions = [...selectedTaskSessions]
    .sort((left, right) => right[1].updatedAt.localeCompare(left[1].updatedAt))
    .slice(0, 6);

  return (
    <section className="panel settings-section local-adapter-section">
      <div className="panel-header">
        <div>
          <div className="panel-title">Local AI backend</div>
          <div className="panel-subtitle">Use Claude Code or Codex as the desktop app's internal execution backend. This is separate from MCP client connections and controls how natural chat runs inside Vault.</div>
        </div>
        <Cable size={18} className="panel-icon" />
      </div>

      <div className="field-grid">
        <label className="toggle-row">
          <div>
            <span className="field-label">Enable local adapter</span>
            <span className="field-help">Use an explicit environment test before this profile is treated as recognized and allowed to power natural chat inside Vault.</span>
          </div>
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(event) => updateConfig('enabled', event.target.checked)}
          />
        </label>

        <label className="field-row">
          <span className="field-label">Adapter type</span>
          <select
            className="text-input"
            value={config.type}
            onChange={(event) => {
              const nextType = event.target.value as LocalAdapterType | '';
              setConfig((current) => ({
                ...current,
                type: nextType,
                command: '',
                model: '',
                effort: '',
                chrome: false,
                maxTurns: null,
                cwd: current.cwd.trim() || defaultCwd.trim(),
              }));
              setTestResult(null);
              setMessage(null);
              setError(null);
              setModels([]);
            }}
            disabled={loadingDefinitions}
          >
            <option value="">Select a local adapter</option>
            {definitions.map((definition) => (
              <option key={definition.type} value={definition.type}>
                {definition.label}
              </option>
            ))}
          </select>
          <span className="field-help">
            {selectedDefinition
              ? `${selectedDefinition.description} Default command: ${selectedDefinition.defaultCommand}`
              : 'Choose a supported local adapter first.'}
          </span>
        </label>

        <div className="note-card">
          <p>Workspace: {effectiveCwd || 'No default workspace available yet.'}</p>
          <p>Command: {effectiveCommand || 'Choose an adapter type to see the default command.'}</p>
          <p>The normal flow is: choose adapter type, choose model, run `Test now`, then enable and save.</p>
          <p>Advanced fields are optional. Most users should leave workspace, command, and environment overrides untouched unless the CLI lives somewhere unusual.</p>
          <p>This section does not connect Claude Desktop or Codex to Vault over MCP. It only defines which local CLI Vault itself will launch for natural chat.</p>
        </div>

          <div className="field-grid local-adapter-options">
            <label className="field-row">
              <span className="field-label">Model</span>
              <select
                className="text-input"
              value={config.model}
              onChange={(event) => updateConfig('model', event.target.value)}
            >
                <option value="">Use adapter default</option>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name} ({model.id})
                  </option>
                ))}
              </select>
                <span className="field-help">
                  {detectedModel
                    ? `Detected local CLI default: ${detectedModel}. Claude reads it from local Claude settings; Codex reads it from local Codex config.`
                  : 'Claude uses built-in static model lists. Codex merges a static fallback with OpenAI `/v1/models` when `OPENAI_API_KEY` is available. Your explicit selection here is what Vault passes into the CLI at runtime.'}
              </span>
            </label>

            <label className="field-row">
              <span className="field-label">Effort</span>
            <select
              className="text-input"
              value={config.effort}
              onChange={(event) => updateConfig('effort', event.target.value)}
            >
              {effortOptions.map((option) => (
                <option key={option || 'default'} value={option}>
                  {option || 'Use CLI default'}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="inline-actions">
          <button
            type="button"
            className="header-button"
            onClick={() => void testEnvironment()}
            disabled={testing || loadingDefinitions || !config.type}
          >
            <ShieldCheck size={16} />
            <span>{testing ? 'Testing...' : 'Test now'}</span>
          </button>
          <button
            type="button"
            className="header-button"
            onClick={() => void refreshModels()}
            disabled={loadingModels || loadingDefinitions || !config.type}
          >
            <RefreshCw size={16} />
            <span>{loadingModels ? 'Refreshing...' : 'Refresh models'}</span>
          </button>
          <button
            type="button"
            className="header-button"
            onClick={() => void detectModel()}
            disabled={detectingModel || loadingDefinitions || !config.type}
          >
            <Sparkles size={16} />
            <span>{detectingModel ? 'Detecting...' : 'Detect model'}</span>
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => void saveAdapter()}
            disabled={saving}
          >
            <Sparkles size={16} />
            <span>{saving ? 'Saving...' : 'Save adapter'}</span>
          </button>
        </div>

        {message ? <span className="success-text">{message}</span> : null}
        {error ? <span className="error-text">{error}</span> : null}

        {selectedRuntimeSession ? (
          <div className="snippet-card">
            <div className="snippet-head">
              <div>
                <div className="field-label">Adapter fallback session</div>
                <div className="field-help">This is the coarse latest session Vault can fall back to for the selected adapter when no task-scoped session exists.</div>
              </div>
              <button type="button" className="header-button" onClick={() => void resetStoredSession()}>
                <RotateCcw size={16} />
                <span>Reset fallback</span>
              </button>
            </div>
            <pre className="snippet-block">{[
              `sessionId: ${selectedRuntimeSession.sessionDisplayId || selectedRuntimeSession.sessionId}`,
              `cwd: ${selectedRuntimeSession.cwd}`,
              `model: ${selectedRuntimeSession.model || 'default'}`,
              `promptBundleVersion: ${selectedRuntimeSession.promptBundleVersion || 'none'}`,
              `sessionParams: ${JSON.stringify(selectedRuntimeSession.sessionParams || {}, null, 2)}`,
              `updatedAt: ${new Date(selectedRuntimeSession.updatedAt).toLocaleString()}`,
            ].join('\n')}</pre>
          </div>
        ) : (
          <div className="note-card">
            <p>No persisted adapter fallback session is stored for the currently selected adapter yet.</p>
            <p>Once a compatible local run completes, Vault keeps the latest adapter-level session here as a coarse fallback.</p>
          </div>
        )}

        <div className="advanced-panel">
          <button
            type="button"
            className="advanced-toggle"
            onClick={() => setAdvancedOpen((current) => !current)}
          >
            <span>Advanced adapter settings</span>
            {advancedOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>

          {advancedOpen ? (
            <div className="advanced-content">
              <label className="field-row">
                <span className="field-label">Optional workspace override</span>
                <input
                  className="text-input"
                  value={config.cwd}
                  onChange={(event) => updateConfig('cwd', event.target.value)}
                  placeholder={defaultCwd || 'C:\\Projects\\my-repo'}
                />
                <span className="field-help">Leave this blank in normal use. Vault then uses the current app workspace automatically. Override it only when the adapter must run against a different absolute project folder.</span>
              </label>

              <label className="field-row">
                <span className="field-label">Optional command override</span>
                <input
                  className="text-input"
                  value={config.command}
                  onChange={(event) => updateConfig('command', event.target.value)}
                  placeholder={selectedDefinition?.defaultCommand || 'Select an adapter type first'}
                />
                <span className="field-help">Leave this blank to use the native default command. Override it only if your CLI is exposed under a different command name or path. Native hello probes still run only when the basename stays `claude` or `codex`.</span>
              </label>

              <label className="field-row">
                <span className="field-label">Optional environment override JSON</span>
                <textarea
                  className="text-area-input"
                  value={envText}
                  onChange={(event) => updateEnvText(event.target.value)}
                  rows={5}
                  placeholder={'{\n  "OPENAI_API_KEY": "sk-...",\n  "PATH": "C:\\\\Tools;..."\n}'}
                />
                <span className="field-help">Leave this empty unless you need to inject auth or PATH values for the CLI. This JSON is merged over the current process environment and stored encrypted locally.</span>
              </label>

              {config.type === 'claude_local' ? (
                <>
                  <label className="toggle-row">
                    <div>
                      <span className="field-label">Enable Claude Chrome mode</span>
                    <span className="field-help">Forward `--chrome` during the explicit hello probe and later runtime execution.</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={config.chrome}
                      onChange={(event) => updateConfig('chrome', event.target.checked)}
                    />
                  </label>

                  <label className="field-row">
                    <span className="field-label">Max turns</span>
                    <input
                      className="text-input"
                      type="number"
                      min={1}
                      value={config.maxTurns ?? ''}
                      onChange={(event) => updateConfig('maxTurns', event.target.value ? Number(event.target.value) : null)}
                    />
                    <span className="field-help">Stored for the adapter profile, but the current verified Claude CLI probe does not expose a matching `--max-turns` flag yet.</span>
                  </label>
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        {testResult ? (
          <div className="detail-stack">
            <div className="note-card">
              <div className="detail-section-title">
                <ShieldCheck size={16} />
                <span>Latest environment test</span>
              </div>
              <p>Recognized: {testResult.recognized ? 'yes' : 'no'}</p>
              <p>Can proceed: {testResult.canProceed ? 'yes' : 'no'}</p>
              <p>Auth mode: {testResult.authMode || 'unknown'}</p>
              <p>Resolved command: {testResult.resolvedCommand || 'not resolved'}</p>
              <p>Tested at: {new Date(testResult.testedAt).toLocaleString()}</p>
            </div>

            <div className="detail-section">
              <div className="detail-section-title">
                <Cable size={16} />
                <span>Checks</span>
              </div>
              <div className="adapter-check-list">
                {testResult.checks.map((check) => (
                  <div key={`${check.code}-${check.message}`} className={`adapter-check adapter-check-${check.status}`}>
                    <div className="adapter-check-head">
                      <span className="badge">{check.status}</span>
                      <strong>{check.message}</strong>
                    </div>
                    {check.detail ? <p>{check.detail}</p> : null}
                    {check.hint ? <p className="adapter-check-hint">Hint: {check.hint}</p> : null}
                  </div>
                ))}
              </div>
            </div>

            {testResult.manualCommand ? (
              <div className="snippet-card">
                <div className="snippet-head">
                  <div>
                    <div className="field-label">Manual test command</div>
                    <div className="field-help">Run this yourself if you need to reproduce the exact hello probe in a terminal.</div>
                  </div>
                  <button type="button" className="header-button" onClick={() => void copyText('adapter-manual-command', testResult.manualCommand)}>
                    <Copy size={16} />
                    <span>{copiedToken === 'adapter-manual-command' ? 'Copied' : 'Copy command'}</span>
                  </button>
                </div>
                <pre className="snippet-block">{testResult.manualCommand}</pre>
              </div>
            ) : null}

            {testResult.probe.summary ? (
              <div className="note-card">
                <div className="detail-section-title">
                  <ShieldCheck size={16} />
                  <span>Probe summary</span>
                </div>
                <p>{testResult.probe.summary}</p>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="note-card">
            <p>No explicit environment test has been recorded for the current adapter form yet.</p>
            <p>Use `Test now` before enabling a local adapter profile. That is the current onboarding gate for local adapters in this desktop app.</p>
          </div>
        )}

        <div className="snippet-card">
          <div className="snippet-head">
            <div>
              <div className="field-label">Session threads</div>
              <div className="field-help">Session-thread keys let the same adapter keep separate native CLI conversations for different work items without pretending there is a full task system yet.</div>
            </div>
            <button
              type="button"
              className="header-button"
              onClick={() => void resetTaskSession()}
              disabled={!config.type || !savedTaskKey?.trim() || !activeTaskSession}
            >
              <RotateCcw size={16} />
              <span>Reset active thread</span>
            </button>
          </div>
          <pre className="snippet-block">{activeTaskSession ? [
            `activeThreadKey: ${savedTaskKey?.trim() || 'none'}`,
            `sessionId: ${activeTaskSession.sessionDisplayId || activeTaskSession.sessionId}`,
            `cwd: ${activeTaskSession.cwd}`,
            `model: ${activeTaskSession.model || 'default'}`,
            `sessionParams: ${JSON.stringify(activeTaskSession.sessionParams || {}, null, 2)}`,
            `updatedAt: ${new Date(activeTaskSession.updatedAt).toLocaleString()}`,
          ].join('\n') : `activeThreadKey: ${savedTaskKey?.trim() || 'none'}\nNo saved thread-scoped session for the current key.`}</pre>
          {recentTaskSessions.length > 0 ? (
            <div className="adapter-check-list">
              {recentTaskSessions.map(([taskKey, session]) => (
                <div key={`${taskKey}-${session.sessionId}`} className="adapter-check adapter-check-pass">
                  <div className="adapter-check-head">
                    <span className="badge">thread</span>
                    <strong>{taskKey}</strong>
                  </div>
                  <p>{session.sessionDisplayId || session.sessionId}</p>
                  <p>{session.cwd}</p>
                  <p>Updated: {new Date(session.updatedAt).toLocaleString()}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="note-card">
              <p>No thread-scoped sessions are stored for this adapter yet.</p>
              <p>Set a session thread key in chat before running the local adapter if you want independent session continuity per work thread.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function parseEnvOverrides(text: string): Record<string, string> {
  if (!text.trim()) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Environment override must be valid JSON.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Environment override must be a JSON object.');
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (value === undefined || value === null) {
      continue;
    }

    normalized[key] = String(value);
  }

  return normalized;
}
