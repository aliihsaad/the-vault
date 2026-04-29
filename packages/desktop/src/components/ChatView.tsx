import { useEffect, useState } from 'react';
import { Bot, Database, Save, Send, Sparkles, TerminalSquare, X } from 'lucide-react';

type ChatMessage = {
  role: 'user' | 'vault' | 'system';
  text: string;
  prefillDraft?: Partial<VaultMemoryComposerDraft>;
  prefillLabel?: string;
};

const QUICK_PROMPTS = [
  '/recall authentication bug fixes',
  '/save vault Add settings screen -- Implement a working settings UI in the desktop app',
  'What decisions were saved about the desktop UI?',
];

export function ChatView({ onPrefillMemoryDraft }: { onPrefillMemoryDraft?: (draft: Partial<VaultMemoryComposerDraft>) => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'system',
      text: 'Modes: plain text = natural chat, /recall = direct Vault memory search, /save [project] [title] -- [summary] = structured memory write.',
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [taskKey, setTaskKey] = useState('');
  const [taskKeyDraft, setTaskKeyDraft] = useState('');
  const [agentBackend, setAgentBackend] = useState<{
    selected: VaultAgentBackend;
    apiReady: boolean;
    apiModel: string | null;
    localReady: boolean;
    label: string | null;
    localModel: string | null;
  }>({
    selected: 'api',
    apiReady: false,
    apiModel: null,
    localReady: false,
    label: null,
    localModel: null,
  });

  useEffect(() => {
    void loadBackendState();
  }, []);

  async function loadBackendState() {
    try {
      const [response, secretResponse] = await Promise.all([
        window.vaultAPI.getAllSettings(),
        window.vaultAPI.getSecretSetting('openrouter_api_key'),
      ]);

      if (!response.success || !response.data || !secretResponse.success) {
        return;
      }

      const adapterConfig = response.data.local_adapter_config as LocalAdapterConfig | undefined;
      const lastTest = response.data.local_adapter_last_test as LocalAdapterTestResult | null | undefined;
      const savedTaskKey = typeof response.data.local_adapter_active_task_key === 'string'
        ? response.data.local_adapter_active_task_key
        : '';

      setTaskKey(savedTaskKey);
      setTaskKeyDraft(savedTaskKey);

      const apiReady = Boolean(secretResponse.data?.trim()) && Boolean(response.data.enrichment_enabled) && Boolean(response.data.enrichment_model);
      const localReady = Boolean(adapterConfig?.enabled && adapterConfig.type && lastTest?.canProceed);

      setAgentBackend({
        selected: (response.data.vault_agent_backend as VaultAgentBackend | undefined) || 'api',
        apiReady,
        apiModel: response.data.enrichment_model || null,
        localReady,
        label: localReady && adapterConfig?.type ? getAdapterLabel(adapterConfig.type) : null,
        localModel: adapterConfig?.model || null,
      });

      if (!localReady && !apiReady) {
        setAgentBackend({
          selected: (response.data.vault_agent_backend as VaultAgentBackend | undefined) || 'api',
          apiReady: false,
          apiModel: response.data.enrichment_model || null,
          localReady: false,
          label: null,
          localModel: null,
        });
      }
    } catch {
      setAgentBackend({
        selected: 'api',
        apiReady: false,
        apiModel: null,
        localReady: false,
        label: null,
        localModel: null,
      });
    }
  }

  async function saveTaskKey() {
    const normalizedTaskKey = taskKeyDraft.trim();
    const response = await window.vaultAPI.setSetting('local_adapter_active_task_key', normalizedTaskKey);

    if (!response.success) {
      throw new Error(response.error || 'Failed to save the session thread key');
    }

    setTaskKey(normalizedTaskKey);
    setTaskKeyDraft(normalizedTaskKey);
    setMessages((current) => [
      ...current,
      {
        role: 'system',
        text: `Session thread key saved: ${normalizedTaskKey || 'none'}.`,
      },
    ]);
  }

  async function clearTaskKey() {
    const response = await window.vaultAPI.setSetting('local_adapter_active_task_key', '');
    if (!response.success) {
      throw new Error(response.error || 'Failed to clear the session thread key');
    }

    setTaskKey('');
    setTaskKeyDraft('');
    setMessages((current) => [
      ...current,
      {
        role: 'system',
        text: 'Session thread key cleared.',
      },
    ]);
  }

  function pushSystemError(error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown failure';
    setMessages((current) => [...current, { role: 'system', text: `Error: ${message}` }]);
  }

  async function handleSend() {
    if (!input.trim()) {
      return;
    }

    const currentInput = input.trim();
    setMessages((current) => [...current, { role: 'user', text: currentInput }]);
    setInput('');
    setBusy(true);

    try {
      if (currentInput.startsWith('/save ')) {
        await handleSave(currentInput);
      } else if (currentInput.startsWith('/recall ')) {
        await handleRecall(currentInput);
      } else if (agentBackend.selected === 'api' && agentBackend.apiReady) {
        await handleApiAgent(currentInput);
      } else if (agentBackend.selected === 'local' && agentBackend.localReady) {
        await handleLocalAgent(currentInput);
      } else {
        await handleRecall(currentInput);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown failure';
      setMessages((current) => [...current, { role: 'system', text: `Error: ${message}` }]);
    } finally {
      setBusy(false);
    }
  }

  async function handleSave(command: string) {
    const match = command.match(/^\/save\s+([\w-]+)\s+(.+?)\s*--\s*(.+)$/);

    if (!match) {
      setMessages((current) => [
        ...current,
        {
          role: 'system',
          text: 'Save syntax: /save [project] [title] -- [summary]',
        },
      ]);
      return;
    }

    const [, project, title, summary] = match;
    const response = await window.vaultAPI.saveMemory({
      project,
      title: title.trim(),
      summary: summary.trim(),
      memoryType: 'session',
      subject: title.trim(),
      sourceApp: 'manual',
    });

    if (!response.success || !response.data) {
      throw new Error(response.error || 'Failed to save memory');
    }

    const data = response.data;

    setMessages((current) => [
      ...current,
      {
        role: 'vault',
        text: `Saved "${data.item.title}" as ${data.item.itemUid}.\nPath: ${data.vaultPath}`,
      },
    ]);
  }

  async function handleLocalAgent(rawInput: string) {
    const memoryContext = await buildAgentMemoryContext(rawInput);

    const response = await window.vaultAPI.executeEnabledLocalAdapter({
      prompt: rawInput,
      memoryContext,
      taskKey: taskKey.trim() || undefined,
    });

    if (!response.success || !response.data) {
      throw new Error(response.error || 'Failed to execute the local adapter');
    }

    const data = response.data;
    const sessionBadge = data.metadata.resumeFailed
      ? 'session reset'
      : data.metadata.reusedSession
        ? 'resumed session'
        : data.sessionId
          ? 'fresh session'
          : 'stateless run';
    const scopeBadge = data.metadata.sessionScope === 'task'
      ? `task:${data.metadata.taskKey || taskKey || 'unknown'}`
      : data.metadata.sessionScope === 'adapter'
        ? 'adapter fallback'
        : 'no stored scope';
    const footer = [
      getAdapterLabel(data.adapterType),
      data.model || agentBackend.localModel || 'default model',
      scopeBadge,
      sessionBadge,
      `${Math.max(1, Math.round(data.durationMs / 1000))}s`,
    ].join(' • ');

    setMessages((current) => [
      ...current,
      {
        role: 'vault',
        text: `${data.output}\n\n[${footer}]`,
      },
    ]);
  }

  async function handleApiAgent(rawInput: string) {
    const memoryContext = await buildAgentMemoryContext(rawInput);

    const response = await window.vaultAPI.executeVaultApiAgent({
      prompt: rawInput,
      memoryContext,
    });

    if (!response.success || !response.data) {
      throw new Error(response.error || 'Failed to execute the Vault API agent');
    }

    const data = response.data;
    const footer = [
      'Vault agent',
      'OpenRouter',
      data.model || agentBackend.apiModel || 'default model',
      `${Math.max(1, Math.round(data.durationMs / 1000))}s`,
      `${data.usage.promptTokens + data.usage.completionTokens} tokens`,
    ].join(' • ');

    setMessages((current) => [
      ...current,
      {
        role: 'vault',
        text: `${data.output}\n\n[${footer}]`,
      },
    ]);
  }

  async function handleRecall(rawInput: string) {
    const queryText = rawInput.startsWith('/recall ') ? rawInput.replace('/recall ', '').trim() : rawInput;
    const response = await window.vaultAPI.recallContext({
      queryText,
      limit: 6,
    });

    if (!response.success || !response.data) {
      throw new Error(response.error || 'Failed to recall context');
    }

    const data = response.data;
    const highlights = data.topMatches.slice(0, 3);
    const summary = highlights.length > 0
      ? highlights
          .map((match) => {
            const reasonText = match.reasons.length > 0
              ? `\n  why: ${match.reasons.join(', ')}`
              : '';
            return `• ${match.item.title} (${match.item.project}, ${match.item.memoryType}, score ${match.score.toFixed(1)})${reasonText}`;
          })
          .join('\n')
      : 'No matching memories surfaced.';
    const contextSummary = data.contextSummary ? `\nContext summary: ${data.contextSummary}` : '';
    const relatedSummary = data.related.length > 0 ? `\nRelated surfaced: ${data.related.length}` : '';
    const proactiveSummary = data.proactive.length > 0 ? `\nProactive surfaced: ${data.proactive.length}` : '';

    setMessages((current) => [
      ...current,
      {
        role: 'vault',
        text: `Scanned ${data.totalCandidates} candidates.\nTop score: ${data.topScore.toFixed(1)}${contextSummary}${relatedSummary}${proactiveSummary}\n${summary}`,
        prefillDraft: buildRecallPrefillDraft(queryText, data),
        prefillLabel: 'Save recall as memory',
      },
    ]);
  }

  return (
    <div className="chat-page">
      <section className="section-intro">
        <div className="section-intro-copy">
          <span className="section-intro-eyebrow">Recall Console</span>
          <div className="section-intro-title">Use one surface for chat, direct recall, and structured save</div>
          <p className="section-intro-text">The mode cards explain what happens before you send anything, so the console reads like an operator tool instead of a mystery chat box.</p>
        </div>
        <div className="section-intro-meta">
          <span className="section-intro-chip">plain chat</span>
          <span className="section-intro-chip">direct recall</span>
          <span className="section-intro-chip">structured save</span>
        </div>
      </section>

      <div className="chat-console-grid">
        <section className="panel assistant-card">
          <div className="panel-header">
            <div>
              <div className="panel-title">Recall operator</div>
              <div className="panel-subtitle">Query memory naturally or push structured saves without leaving the desktop UI.</div>
            </div>
            <Sparkles size={18} className="panel-icon" />
          </div>

          <div className="command-grid">
            {QUICK_PROMPTS.map((prompt) => (
              <button key={prompt} type="button" className="pill-button" onClick={() => setInput(prompt)}>
                {prompt}
              </button>
            ))}
          </div>

          <div className="chat-mode-grid">
            <div className="snippet-card">
              <div className="snippet-head">
                <div>
                  <div className="field-label">Plain text</div>
                  <div className="field-help">Use this when you want the fastest natural interaction.</div>
                </div>
              </div>
              <div className="connect-step-guide">
                {agentBackend.selected === 'api' && agentBackend.apiReady
                  ? `Vault sends your prompt to OpenRouter${agentBackend.apiModel ? ` using ${agentBackend.apiModel}` : ''} and injects recalled Vault context when useful.`
                  : agentBackend.selected === 'local' && agentBackend.localReady
                  ? `Vault sends your prompt to ${agentBackend.label}${agentBackend.localModel ? ` using ${agentBackend.localModel}` : ''} and still injects recalled Vault context when useful.`
                  : 'Vault treats plain text as a recall-style query against the local memory store.'}
              </div>
            </div>

            <div className="snippet-card">
              <div className="snippet-head">
                <div>
                  <div className="field-label">/recall</div>
                  <div className="field-help">Use this when you want direct memory retrieval with no model-side interpretation.</div>
                </div>
              </div>
              <div className="connect-step-guide">Runs a direct Vault recall query and returns scored matches, reasons, and a prefill option to save the recall pack.</div>
            </div>

            <div className="snippet-card">
              <div className="snippet-head">
                <div>
                  <div className="field-label">/save</div>
                  <div className="field-help">Use this when you already know you want a durable structured memory entry.</div>
                </div>
              </div>
              <div className="connect-step-guide">Writes a session memory directly into Vault without routing through the local backend model.</div>
            </div>
          </div>

          <div className="assistant-note">
            <TerminalSquare size={16} />
            <span>
              {agentBackend.selected === 'api' && agentBackend.apiReady
                ? `Plain text goes through the Vault OpenRouter agent${agentBackend.apiModel ? ` using ${agentBackend.apiModel}` : ''}. \`/recall\` and \`/save\` still talk to Vault memory directly.`
                : agentBackend.selected === 'local' && agentBackend.localReady
                ? `Plain text goes through ${agentBackend.label}${agentBackend.localModel ? ` using ${agentBackend.localModel}` : ''}. \`/recall\` and \`/save\` still talk to Vault memory directly. The work thread key only labels which local CLI conversation Vault resumes.`
                : 'Without a local backend, plain text behaves like direct Vault recall. Use `/save` only when you want an explicit structured memory write.'}
            </span>
          </div>

          {agentBackend.selected === 'local' && agentBackend.localReady ? (
            <div className="detail-block">
              <div className="field-row">
                <span className="field-label">Work thread key</span>
                <input
                  className="text-input"
                  value={taskKeyDraft}
                  onChange={(event) => setTaskKeyDraft(event.target.value)}
                  placeholder="issue-123 / auth-bug / onboarding-flow"
                />
                <span className="field-help">Use one stable key per work thread if you want Vault to resume a separate native CLI conversation for that thread. This is only a continuity label, not a task object or agent assignment.</span>
              </div>
              <div className="inline-actions">
                <button
                  type="button"
                  className="header-button"
                  onClick={() => {
                    void saveTaskKey().catch(pushSystemError);
                  }}
                >
                  <Save size={16} />
                  <span>Save work thread</span>
                </button>
                <button
                  type="button"
                  className="header-button"
                  onClick={() => {
                    void clearTaskKey().catch(pushSystemError);
                  }}
                  disabled={!taskKey && !taskKeyDraft}
                >
                  <X size={16} />
                  <span>Clear work thread</span>
                </button>
                <span className="field-help">
                  Current work thread: {taskKey || 'none'}
                </span>
              </div>
            </div>
          ) : null}
        </section>

        <section className="panel chat-panel">
          <div className="chat-panel-header">
            <div className="panel-title">Conversation</div>
            <div className="panel-subtitle">
              {agentBackend.selected === 'api' && agentBackend.apiReady
                ? 'Plain text goes through the Vault OpenRouter agent. Direct Vault operations still happen through /recall and /save.'
                : agentBackend.selected === 'local' && agentBackend.localReady
                ? `Plain text goes through ${agentBackend.label}. Direct Vault operations still happen through /recall and /save.`
                : 'Plain text and /recall both query Vault memory directly in this mode.'}
            </div>
          </div>

          <div className="message-list">
            {messages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={`message-row ${message.role}`}>
                <div className="message-avatar">
                  {message.role === 'user' ? 'U' : message.role === 'vault' ? <Database size={14} /> : <Bot size={14} />}
                </div>
                <div className="message-bubble">
                  {message.text}
                  {message.prefillDraft && onPrefillMemoryDraft ? (
                    <div className="inline-actions" style={{ marginTop: '12px' }}>
                      <button
                        type="button"
                        className="header-button"
                        onClick={() => onPrefillMemoryDraft(message.prefillDraft!)}
                      >
                        <Save size={14} />
                        <span>{message.prefillLabel || 'Prefill memory draft'}</span>
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div className="composer-card">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void handleSend();
                }
              }}
              placeholder="Plain text for natural chat, /recall for direct memory lookup, or /save for a structured memory write..."
              disabled={busy}
              rows={3}
            />

            <button type="button" className="primary-button" onClick={() => void handleSend()} disabled={busy || !input.trim()}>
              <Send size={16} />
              <span>{busy ? 'Working...' : 'Send'}</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

async function buildAgentMemoryContext(queryText: string): Promise<string> {
  try {
    const recallResponse = await window.vaultAPI.buildRecallMemoryContext({
      queryText,
    });

    if (!recallResponse.success || !recallResponse.data) {
      return '';
    }

    return recallResponse.data.memoryContext;
  } catch {
    return '';
  }
}

function getAdapterLabel(type: LocalAdapterType): string {
  switch (type) {
    case 'claude_local':
      return 'Claude Code';
    case 'codex_local':
      return 'Codex CLI';
    default:
      return type;
  }
}

function buildRecallPrefillDraft(queryText: string, pack: VaultRecallPack): Partial<VaultMemoryComposerDraft> {
  const topMatches = pack.topMatches.slice(0, 4);
  const firstProject = topMatches[0]?.item.project || '';
  const relatedFiles = [...new Set(topMatches.flatMap((match) => match.item.relatedFiles || []))];
  const keywords = [...new Set(queryText.split(/\s+/).map((word) => word.trim().toLowerCase()).filter((word) => word.length > 2))];
  const content = topMatches.length > 0
    ? [
        `Recall query: ${queryText}`,
        '',
        'Top matches:',
        ...topMatches.map((match) => {
          const reasonText = match.reasons.length > 0 ? ` | why: ${match.reasons.join(', ')}` : '';
          return `- ${match.item.title} [${match.item.project}] (${match.item.memoryType}, score ${match.score.toFixed(1)})${reasonText}\n  ${match.item.summary}`;
        }),
      ].join('\n')
    : `Recall query: ${queryText}\n\nNo matches were returned.`;

  return {
    project: firstProject,
    title: `Recall pack: ${queryText}`.slice(0, 120),
    memoryType: 'summary',
    subject: queryText.slice(0, 200),
    summary: topMatches.length > 0
      ? `Vault surfaced ${topMatches.length} relevant memories for "${queryText}" with top score ${pack.topScore.toFixed(1)}.`
      : `Vault recall returned no strong matches for "${queryText}".`,
    content,
    status: 'active',
    priority: topMatches.some((match) => match.item.promoted) ? 'high' : 'normal',
    routineType: 'review',
    tagsText: 'recall, continuity',
    keywordsText: keywords.join(', '),
    nextStepsText: topMatches.length > 0 ? 'Review whether one of these memories should be promoted or updated.' : '',
    relatedFilesText: relatedFiles.join('\n'),
  };
}
