import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  BookCopy,
  CheckCircle2,
  Copy,
  Download,
  FolderRoot,
  KeyRound,
  Coins,
  Network,
  RefreshCw,
  Save,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wifi,
  Gauge,
} from 'lucide-react';
import { ConnectPanel } from './ConnectPanel.js';
import { buildGraphifySettingsViewModel } from '../graphify-view-model.js';
import { resolveAiProviderSettings } from '@the-vault/core/provider-resolution';
import type {
  GraphifyInstallPlan,
  GraphifyRuntimeConfig,
  GraphifyRuntimeStatus,
  GraphifyUpdateCheck,
  VaultCollabInstallPlan,
  VaultCollabRuntimeConfig,
  VaultCollabRuntimeStatus,
} from '@the-vault/core';

const DEFAULT_VAULT_COLLAB_REPOSITORY_URL = 'https://github.com/aliihsaad/vault-collab';

type EditableSettings = Pick<
  VaultSettings,
  | 'enrichment_model'
  | 'enrichment_enabled'
  | 'recall_max_results'
  | 'recall_compact_limit'
  | 'recall_top_match_limit'
  | 'recall_detail_expansion_limit'
  | 'recall_related_limit'
  | 'recall_proactive_limit'
  | 'auto_log'
>;

type SettingsTabId = 'overview' | 'ai' | 'memory' | 'extensions' | 'connections' | 'skills' | 'prompts';

type AgentDutiesState = {
  projectMaintenanceEnabled: boolean;
  projectMaintenanceCooldownDays: number;
  projectMaintenanceMinItemsForReview: number;
  projectMaintenanceMergeCandidateMaxItems: number;
  staleArchivalEnabled: boolean;
  staleActiveToStaleDays: number;
  staleStaleToArchivedDays: number;
  staleArchivedToPendingDeleteDays: number;
};

const DEFAULT_AGENT_DUTIES: AgentDutiesState = {
  projectMaintenanceEnabled: false,
  projectMaintenanceCooldownDays: 7,
  projectMaintenanceMinItemsForReview: 3,
  projectMaintenanceMergeCandidateMaxItems: 2,
  staleArchivalEnabled: false,
  staleActiveToStaleDays: 30,
  staleStaleToArchivedDays: 30,
  staleArchivedToPendingDeleteDays: 60,
};

type SkillEntry = {
  id: string;
  title: string;
  path: string;
  summary: string;
  snippet: string;
  assistantPrompt: string;
};

type RoutingPresetId = 'cost_saver' | 'balanced' | 'high_reasoning';

const DEFAULT_SETTINGS: VaultSettings = {
  vault_root: '',
  enrichment_model: '',
  enrichment_enabled: false,
  recall_max_results: 10,
  recall_compact_limit: 6,
  recall_top_match_limit: 4,
  recall_detail_expansion_limit: 2,
  recall_related_limit: 2,
  recall_proactive_limit: 2,
  auto_log: true,
};

const DEFAULT_ROUTING_TABLE: ModelRoutingTable = {
  defaultModelId: 'anthropic/claude-sonnet-4',
  routes: [
    { taskType: 'coding', modelId: 'anthropic/claude-sonnet-4', fallbackModelId: 'openai/codex-mini', maxTokens: 4096, temperature: 0.2, timeoutMs: 60000 },
    { taskType: 'image', modelId: 'google/gemini-2.5-flash-image', fallbackModelId: 'openai/gpt-5-image', maxTokens: 1024, temperature: 0.8, timeoutMs: 120000 },
    { taskType: 'analysis', modelId: 'anthropic/claude-opus-4', fallbackModelId: 'openai/o3', maxTokens: 8192, temperature: 0.3, timeoutMs: 120000 },
    { taskType: 'summarize', modelId: 'anthropic/claude-haiku-3.5', fallbackModelId: 'openai/gpt-4o-mini', maxTokens: 1024, temperature: 0.2, timeoutMs: 15000 },
    { taskType: 'organize', modelId: 'anthropic/claude-haiku-3.5', maxTokens: 1024, temperature: 0.1, timeoutMs: 15000 },
    { taskType: 'research', modelId: 'anthropic/claude-sonnet-4', fallbackModelId: 'openai/o3', maxTokens: 4096, temperature: 0.3, timeoutMs: 90000 },
    { taskType: 'enrich', modelId: 'anthropic/claude-haiku-3.5', maxTokens: 500, temperature: 0.2, timeoutMs: 10000 },
    { taskType: 'general', modelId: 'anthropic/claude-sonnet-4', maxTokens: 2048, temperature: 0.3, timeoutMs: 30000 },
  ],
};

const FALLBACK_MODELS: OpenRouterModelSummary[] = [
  { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', contextLength: null, promptPrice: null, completionPrice: null },
  { id: 'anthropic/claude-opus-4.1', name: 'Claude Opus 4.1', contextLength: null, promptPrice: null, completionPrice: null },
  { id: 'anthropic/claude-haiku-3.5', name: 'Claude Haiku 3.5', contextLength: null, promptPrice: null, completionPrice: null },
  { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextLength: null, promptPrice: null, completionPrice: null },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextLength: null, promptPrice: null, completionPrice: null },
  { id: 'openai/gpt-5.4-mini', name: 'GPT-5.4 Mini', contextLength: null, promptPrice: null, completionPrice: null },
  { id: 'openai/gpt-5.4', name: 'GPT-5.4', contextLength: null, promptPrice: null, completionPrice: null },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', contextLength: null, promptPrice: null, completionPrice: null },
  { id: 'openai/o3', name: 'OpenAI o3', contextLength: null, promptPrice: null, completionPrice: null },
  { id: 'openai/codex-mini', name: 'Codex Mini', contextLength: null, promptPrice: null, completionPrice: null },
  { id: 'x-ai/grok-4', name: 'Grok 4', contextLength: null, promptPrice: null, completionPrice: null },
];

const IMAGE_ROUTE_MODELS: Array<{ id: string; name: string }> = [
  { id: 'google/gemini-2.5-flash-image', name: 'Gemini 2.5 Flash Image' },
  { id: 'openai/gpt-5-image', name: 'GPT-5 Image' },
];

const ROUTING_EDITOR_TASKS: Array<{
  taskType: VaultTaskType;
  label: string;
  description: string;
  modelKind: 'text' | 'image';
}> = [
  { taskType: 'general', label: 'General', description: 'Catch-all delegated work that does not map to a narrower task type.', modelKind: 'text' },
  { taskType: 'coding', label: 'Coding', description: 'Implementation-heavy work where output should be directly usable.', modelKind: 'text' },
  { taskType: 'research', label: 'Research', description: 'Background research and preparation tasks.', modelKind: 'text' },
  { taskType: 'analysis', label: 'Analysis', description: 'Deeper reasoning tasks where quality matters more than speed.', modelKind: 'text' },
  { taskType: 'summarize', label: 'Summarize', description: 'Compression and structured summarization work.', modelKind: 'text' },
  { taskType: 'organize', label: 'Organize', description: 'Low-cost cleanup and restructuring tasks.', modelKind: 'text' },
  { taskType: 'enrich', label: 'Enrich', description: 'Metadata and polish flows that should stay inexpensive.', modelKind: 'text' },
  { taskType: 'image', label: 'Image', description: 'Image-generation tasks run through the executor.', modelKind: 'image' },
];

const ROUTING_PRESETS: Array<{
  id: RoutingPresetId;
  label: string;
  description: string;
  table: ModelRoutingTable;
}> = [
  {
    id: 'cost_saver',
    label: 'Cost saver',
    description: 'Bias cheap models for most delegated work and keep premium models off by default.',
    table: {
      defaultModelId: 'google/gemini-2.5-flash',
      routes: [
        { taskType: 'general', modelId: 'google/gemini-2.5-flash' },
        { taskType: 'coding', modelId: 'openai/gpt-5.4-mini' },
        { taskType: 'research', modelId: 'google/gemini-2.5-flash' },
        { taskType: 'analysis', modelId: 'google/gemini-2.5-flash', fallbackModelId: 'openai/o3' },
        { taskType: 'summarize', modelId: 'openai/gpt-4o-mini' },
        { taskType: 'organize', modelId: 'anthropic/claude-haiku-3.5' },
        { taskType: 'enrich', modelId: 'anthropic/claude-haiku-3.5' },
        { taskType: 'image', modelId: 'google/gemini-2.5-flash-image', fallbackModelId: 'openai/gpt-5-image' },
      ],
    },
  },
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'Use stronger models where quality matters but keep lightweight flows inexpensive.',
    table: {
      defaultModelId: 'anthropic/claude-sonnet-4',
      routes: [
        { taskType: 'general', modelId: 'anthropic/claude-sonnet-4' },
        { taskType: 'coding', modelId: 'anthropic/claude-sonnet-4', fallbackModelId: 'openai/codex-mini' },
        { taskType: 'research', modelId: 'anthropic/claude-sonnet-4', fallbackModelId: 'openai/o3' },
        { taskType: 'analysis', modelId: 'anthropic/claude-opus-4.1', fallbackModelId: 'openai/o3' },
        { taskType: 'summarize', modelId: 'anthropic/claude-haiku-3.5', fallbackModelId: 'openai/gpt-4o-mini' },
        { taskType: 'organize', modelId: 'anthropic/claude-haiku-3.5' },
        { taskType: 'enrich', modelId: 'anthropic/claude-haiku-3.5' },
        { taskType: 'image', modelId: 'google/gemini-2.5-flash-image', fallbackModelId: 'openai/gpt-5-image' },
      ],
    },
  },
  {
    id: 'high_reasoning',
    label: 'High reasoning',
    description: 'Push more work onto premium reasoning models when quality matters more than spend.',
    table: {
      defaultModelId: 'anthropic/claude-sonnet-4',
      routes: [
        { taskType: 'general', modelId: 'anthropic/claude-sonnet-4' },
        { taskType: 'coding', modelId: 'anthropic/claude-sonnet-4', fallbackModelId: 'openai/gpt-5.4' },
        { taskType: 'research', modelId: 'anthropic/claude-opus-4.1', fallbackModelId: 'openai/o3' },
        { taskType: 'analysis', modelId: 'anthropic/claude-opus-4.1', fallbackModelId: 'openai/o3' },
        { taskType: 'summarize', modelId: 'anthropic/claude-sonnet-4', fallbackModelId: 'anthropic/claude-haiku-3.5' },
        { taskType: 'organize', modelId: 'anthropic/claude-sonnet-4', fallbackModelId: 'anthropic/claude-haiku-3.5' },
        { taskType: 'enrich', modelId: 'anthropic/claude-sonnet-4', fallbackModelId: 'anthropic/claude-haiku-3.5' },
        { taskType: 'image', modelId: 'openai/gpt-5-image', fallbackModelId: 'google/gemini-2.5-flash-image' },
      ],
    },
  },
];

const SETTINGS_TABS: Array<{
  id: SettingsTabId;
  label: string;
  description: string;
  group: string;
  icon: typeof Bot;
}> = [
  { id: 'overview', label: 'Overview', description: 'Vault status, runtime root, and product orientation', group: 'Operate', icon: Gauge },
  { id: 'ai', label: 'AI & Models', description: 'Provider, API keys, enrichment model, and task routing', group: 'Operate', icon: Sparkles },
  { id: 'memory', label: 'Memory & Recall', description: 'Recall sizing and background agent duties', group: 'Operate', icon: Bot },
  { id: 'extensions', label: 'Extensions', description: 'Graphify runtime and project graph controls', group: 'Operate', icon: Network },
  { id: 'connections', label: 'Client setup', description: 'Connect Codex, Claude Desktop, or another MCP client', group: 'Install', icon: Wifi },
  { id: 'skills', label: 'Install guides', description: 'Copy or download the full client guidance files', group: 'Reference', icon: BookCopy },
  { id: 'prompts', label: 'Prompt library', description: 'Reusable recall, save, and setup prompts', group: 'Reference', icon: ScrollText },
];

const SKILL_ENTRIES: SkillEntry[] = [
  {
    id: 'codex-skill',
    title: 'Codex skill',
    path: 'skills/codex-vault-skill.md',
    summary: 'Install this when Codex should recall prior work, bootstrap Codex-brain if needed, and save structured handoffs consistently.',
    snippet: [
      'Best practice:',
      '- Install the full Markdown file, not just the short notes.',
      '- Keep it close to Codex project instructions or workspace guidance.',
      '- Use it with Vault MCP tools so Codex can recall and save directly.',
      '- Let Codex verify Codex-brain with vault_list_projects before it saves durable assistant lessons.',
      '- Use Vault Collab MCP tools only when the optional live inbox server is attached.',
    ].join('\n'),
    assistantPrompt: [
      'Use the file skills/codex-vault-skill.md as the operating guide for Codex.',
      'Tell me where Codex project instructions should store it, how to reference it, how to bootstrap Codex-brain if missing, and how to verify Vault recall/save plus Vault Collab MCP behavior after installation.',
    ].join('\n'),
  },
  {
    id: 'claude-skill',
    title: 'Claude skill',
    path: 'skills/claude-vault-skill.md',
    summary: 'Install this when Claude should recall continuity, bootstrap claude-code-brain or claude-desktop-brain, and save higher-signal decisions.',
    snippet: [
      'Best practice:',
      '- Install the full Markdown file into Claude instructions or project guidance.',
      '- Keep the file path stable so later setup prompts can reference it directly.',
      '- Use it alongside the Vault MCP server config, not instead of it.',
      '- Let Claude verify claude-code-brain or claude-desktop-brain with vault_list_projects before it saves durable operating lessons.',
      '- Use Vault Collab MCP tools only when the optional live inbox server is attached.',
    ].join('\n'),
    assistantPrompt: [
      'Use the file skills/claude-vault-skill.md as the operating guide for Claude.',
      'Tell me where Claude instructions should store it, how to connect Vault MCP beside it, how to bootstrap claude-code-brain or claude-desktop-brain if missing, and how to verify recall/save plus Vault Collab MCP flows afterwards.',
    ].join('\n'),
  },
  {
    id: 'codex-collab-skill',
    title: 'Codex Collab skill',
    path: 'skills/codex-vault-collab-skill.md',
    summary: 'Install this when Codex joins the Vault Collab coordination layer — registering sessions, draining attention, and claiming/updating/resolving handoffs. Separate from the memory skill.',
    snippet: [
      'Best practice:',
      '- Install alongside the Codex memory skill, not instead of it.',
      '- Only needed when the optional Vault Collab MCP server is attached.',
      '- Have Codex read vault_collab_get_agent_guide as the authoritative live loop.',
      '- Keep session tokens private; never claim work owned by another active session.',
    ].join('\n'),
    assistantPrompt: [
      'Use the file skills/codex-vault-collab-skill.md as the Vault Collab operating guide for Codex.',
      'Tell me how Codex should register a session, drain attention, claim and update handoffs, and resolve only after verification.',
    ].join('\n'),
  },
  {
    id: 'claude-collab-skill',
    title: 'Claude Collab skill',
    path: 'skills/claude-vault-collab-skill.md',
    summary: 'Install this when Claude joins the Vault Collab coordination layer — registering sessions, draining attention, and claiming/updating/resolving handoffs. Separate from the memory skill.',
    snippet: [
      'Best practice:',
      '- Install alongside the Claude memory skill, not instead of it.',
      '- Only needed when the optional Vault Collab MCP server is attached.',
      '- Have Claude read vault_collab_get_agent_guide as the authoritative live loop.',
      '- Keep session tokens private; never claim work owned by another active session.',
    ].join('\n'),
    assistantPrompt: [
      'Use the file skills/claude-vault-collab-skill.md as the Vault Collab operating guide for Claude.',
      'Tell me how Claude should register a session, drain attention, claim and update handoffs, and resolve only after verification.',
    ].join('\n'),
  },
];

const PROMPT_SNIPPETS = [
  {
    id: 'recall-prompt',
    title: 'Session-start recall',
    description: 'Use this before continuing prior project work or debugging an existing feature.',
    snippet: JSON.stringify(
      {
        tool: 'vault_recall_context',
        args: {
          project: 'the-vault',
          keywords: ['desktop', 'electron', 'settings'],
          query_text: 'Recall prior desktop settings work, MCP integration notes, and recent UI fixes.',
        },
      },
      null,
      2,
    ),
  },
  {
    id: 'save-prompt',
    title: 'Implementation save',
    description: 'Use this after a substantial fix, decision, or handoff worth preserving.',
    snippet: JSON.stringify(
      {
        tool: 'vault_save_memory',
        args: {
          title: 'Desktop settings UI update',
          project: 'the-vault',
          memory_type: 'session',
          subject: 'Desktop MCP and prompt settings UI',
          summary: 'Added MCP connection snippets, skill references, and reusable prompt templates to the desktop settings screen.',
          keywords: ['desktop', 'settings', 'mcp', 'skills', 'prompts'],
          tags: ['ui', 'desktop', 'implementation'],
          routine_type: 'implementation',
          source_app: 'codex',
          related_files: ['packages/desktop/src/components/SettingsView.tsx', 'packages/desktop/src/app.css'],
          next_steps: ['Validate the renderer on Windows and confirm copy-to-clipboard behavior.'],
        },
      },
      null,
      2,
    ),
  },
  {
    id: 'protocol-rules',
    title: 'Protocol reminder',
    description: 'Short rules pulled from the protocol and skill guidance.',
    snippet: [
      'Recall before continuing prior project work.',
      'Save only significant outcomes, decisions, handoffs, or reusable summaries.',
      'Keep the subject specific and the next_steps explicit.',
      'Use real file names, function names, and module names in keywords.',
    ].join('\n'),
  },
  {
    id: 'brain-collab-prompt',
    title: 'Brain + Collab setup',
    description: 'Use this after MCP is connected so the client creates its brain and registers with the live inbox.',
    snippet: [
      'Use the installed Vault guide as your operating protocol.',
      'First run vault_list_projects. If your client brain is missing, create one bootstrap brain memory: Codex-brain for Codex, claude-code-brain for Claude Code, or claude-desktop-brain for Claude Desktop.',
      'Recall your brain for durable operating lessons, then recall the current project for task context.',
      'If Vault Collab MCP tools are attached, ask once whether to use it for this session. Shortcut: /vault-collab means opt in, register with vault_collab_register_session, show current state, and list available work with vault_collab_list_inbox.',
      'Call vault_collab_claim_handoff only after user approval or when the session is clearly idle.',
    ].join('\n'),
  },
] as const;

function WorkflowCard({
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
      <ol className="settings-guide-list">
        {steps.map((step) => (
          <li key={`${title}-${step}`}>{step}</li>
        ))}
      </ol>
    </div>
  );
}

export function SettingsView({ vaultStatus }: { vaultStatus: VaultStatus | null }) {
  const [settings, setSettings] = useState<VaultSettings>(DEFAULT_SETTINGS);
  const [routingTables, setRoutingTables] = useState<Record<AiProviderId, ModelRoutingTable>>({
    openrouter: DEFAULT_ROUTING_TABLE,
    'llm-hub': DEFAULT_ROUTING_TABLE,
  });
  const [apiKey, setApiKey] = useState('');
  const [primaryProvider, setPrimaryProvider] = useState<AiProviderId>('openrouter');
  const [fallbackProvider, setFallbackProvider] = useState<AiProviderId | 'none'>('none');
  const [routingProvider, setRoutingProvider] = useState<AiProviderId>('openrouter');
  const [enrichmentModels, setEnrichmentModels] = useState<Record<AiProviderId, string>>({
    openrouter: '',
    'llm-hub': '',
  });
  const [llmHubBaseUrl, setLlmHubBaseUrl] = useState('');
  const [llmHubApiKey, setLlmHubApiKey] = useState('');
  const [llmHubTestResult, setLlmHubTestResult] = useState<LlmHubConnectionTestResult | null>(null);
  const [modelsByProvider, setModelsByProvider] = useState<Record<AiProviderId, OpenRouterModelSummary[]>>({
    openrouter: FALLBACK_MODELS,
    'llm-hub': [],
  });
  const [testingKey, setTestingKey] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [testResult, setTestResult] = useState<OpenRouterKeyTestResult | null>(null);

  // The routing editor always works on one provider's table + model list.
  const routingTable = routingTables[routingProvider];
  const models = modelsByProvider[routingProvider];
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTabId>('overview');
  const [skillFiles, setSkillFiles] = useState<Record<string, VaultSkillFile>>({});
  const [loadingSkillId, setLoadingSkillId] = useState<string | null>(null);
  const [agentDuties, setAgentDuties] = useState<AgentDutiesState>(DEFAULT_AGENT_DUTIES);
  const [graphifyConfig, setGraphifyConfig] = useState<GraphifyRuntimeConfig | null>(null);
  const [graphifyRuntimeStatus, setGraphifyRuntimeStatus] = useState<GraphifyRuntimeStatus | null>(null);
  const [graphifyInstallPlan, setGraphifyInstallPlan] = useState<GraphifyInstallPlan | null>(null);
  const [graphifyError, setGraphifyError] = useState<string | null>(null);
  const [loadingGraphify, setLoadingGraphify] = useState(false);
  const [graphifyUpdateCheck, setGraphifyUpdateCheck] = useState<GraphifyUpdateCheck | null>(null);
  const [graphifyUpdating, setGraphifyUpdating] = useState(false);
  const [graphifyUpdateResult, setGraphifyUpdateResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [vaultCollabConfig, setVaultCollabConfig] = useState<VaultCollabRuntimeConfig | null>(null);
  const [vaultCollabRuntimeStatus, setVaultCollabRuntimeStatus] = useState<VaultCollabRuntimeStatus | null>(null);
  const [vaultCollabInstallPlan, setVaultCollabInstallPlan] = useState<VaultCollabInstallPlan | null>(null);
  const [vaultCollabDetectedSource, setVaultCollabDetectedSource] = useState<VaultCollabSourcePathDetection | null>(null);
  const [vaultCollabError, setVaultCollabError] = useState<string | null>(null);
  const [loadingVaultCollab, setLoadingVaultCollab] = useState(false);

  useEffect(() => {
    void loadSettings();
    void loadGraphifyExtension();
    void loadVaultCollabExtension();
  }, []);

  async function loadSettings() {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const [response, secretResponse, llmHubSecretResponse, routingResponse, llmHubRoutingResponse] = await Promise.all([
        window.vaultAPI.getAllSettings(),
        window.vaultAPI.getSecretSetting('openrouter_api_key'),
        window.vaultAPI.getSecretSetting('llm_hub_api_key'),
        window.vaultAPI.getModelRoutingTable('openrouter'),
        window.vaultAPI.getModelRoutingTable('llm-hub'),
      ]);

      if (!response.success) {
        throw new Error(response.error || 'Failed to load settings');
      }

      if (!secretResponse.success) {
        throw new Error(secretResponse.error || 'Failed to load API key');
      }

      if (!routingResponse.success || !routingResponse.data) {
        throw new Error(routingResponse.error || 'Failed to load task routing');
      }

      const nextSettings = {
        ...DEFAULT_SETTINGS,
        ...response.data,
      };
      const nextRoutingTables: Record<AiProviderId, ModelRoutingTable> = {
        openrouter: routingResponse.data,
        'llm-hub': llmHubRoutingResponse.success && llmHubRoutingResponse.data
          ? llmHubRoutingResponse.data
          : DEFAULT_ROUTING_TABLE,
      };
      const resolvedProviderSettings = resolveAiProviderSettings(nextSettings);
      const nextPrimary = resolvedProviderSettings.primaryProvider;
      const nextFallback = resolvedProviderSettings.fallbackProvider ?? 'none';
      const nextEnrichmentModels = resolvedProviderSettings.enrichmentModels;
      const nextLlmHubBaseUrl = typeof nextSettings.llm_hub_base_url === 'string' ? nextSettings.llm_hub_base_url : '';
      const nextLlmHubApiKey = llmHubSecretResponse.success ? (llmHubSecretResponse.data || '') : '';
      const nextOpenRouterKey = secretResponse.data || '';

      setSettings(nextSettings);
      setRoutingTables(nextRoutingTables);
      setApiKey(nextOpenRouterKey);
      setPrimaryProvider(nextPrimary);
      setFallbackProvider(nextFallback);
      setRoutingProvider(nextPrimary);
      setEnrichmentModels(nextEnrichmentModels);
      setLlmHubBaseUrl(nextLlmHubBaseUrl);
      setLlmHubApiKey(nextLlmHubApiKey);

      const raw = response.data as Record<string, unknown>;
      const num = (key: string, fallback: number): number => {
        const v = raw[key];
        return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
      };
      const bool = (key: string, fallback: boolean): boolean => {
        const v = raw[key];
        return typeof v === 'boolean' ? v : fallback;
      };
      setAgentDuties({
        projectMaintenanceEnabled: bool('agent.project_maintenance.enabled', DEFAULT_AGENT_DUTIES.projectMaintenanceEnabled),
        projectMaintenanceCooldownDays: num('agent.project_maintenance.cooldown_days', DEFAULT_AGENT_DUTIES.projectMaintenanceCooldownDays),
        projectMaintenanceMinItemsForReview: num('agent.project_maintenance.min_items_for_review', DEFAULT_AGENT_DUTIES.projectMaintenanceMinItemsForReview),
        projectMaintenanceMergeCandidateMaxItems: num('agent.project_maintenance.merge_candidate_max_items', DEFAULT_AGENT_DUTIES.projectMaintenanceMergeCandidateMaxItems),
        staleArchivalEnabled: bool('agent.stale_archival.enabled', DEFAULT_AGENT_DUTIES.staleArchivalEnabled),
        staleActiveToStaleDays: num('agent.stale_archival.active_to_stale_days', DEFAULT_AGENT_DUTIES.staleActiveToStaleDays),
        staleStaleToArchivedDays: num('agent.stale_archival.stale_to_archived_days', DEFAULT_AGENT_DUTIES.staleStaleToArchivedDays),
        staleArchivedToPendingDeleteDays: num('agent.stale_archival.archived_to_pending_delete_days', DEFAULT_AGENT_DUTIES.staleArchivedToPendingDeleteDays),
      });

      // Load each provider's model list with its own saved selections pinned.
      const openRouterSelected = collectSelectedTextModels(nextEnrichmentModels.openrouter, nextRoutingTables.openrouter);
      const llmHubSelected = collectSelectedTextModels(nextEnrichmentModels['llm-hub'], nextRoutingTables['llm-hub']);
      await Promise.all([
        nextOpenRouterKey
          ? loadOpenRouterModels(nextOpenRouterKey, openRouterSelected)
          : Promise.resolve(setProviderModels('openrouter', FALLBACK_MODELS, openRouterSelected)),
        nextLlmHubBaseUrl && nextLlmHubApiKey
          ? loadLlmHubModels(nextLlmHubBaseUrl, nextLlmHubApiKey, llmHubSelected)
          : Promise.resolve(setProviderModels('llm-hub', [], llmHubSelected)),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }

  async function loadGraphifyExtension() {
    setLoadingGraphify(true);
    setGraphifyError(null);

    try {
      const configResponse = await window.vaultAPI.getGraphifyRuntimeConfig();
      if (!configResponse.success || !configResponse.data) {
        throw new Error(configResponse.error || 'Failed to load Graphify config');
      }

      setGraphifyConfig(configResponse.data);

      const runtimeResponse = await window.vaultAPI.detectGraphifyRuntime();
      const runtimeStatus = runtimeResponse.success && runtimeResponse.data
        ? runtimeResponse.data
        : null;
      setGraphifyRuntimeStatus(runtimeStatus);
      if (!runtimeResponse.success) {
        setGraphifyError(runtimeResponse.error || 'Graphify detection failed');
      }

      const installPlanResponse = await window.vaultAPI.planGraphifyInstall({
        runtimeMode: configResponse.data.runtimeMode,
        availableTools: {
          python: Boolean(runtimeStatus?.python.available),
          uv: Boolean(runtimeStatus?.uv.available),
          pipx: Boolean(runtimeStatus?.pipx.available),
        },
        extras: configResponse.data.installExtras,
        localSourcePath: configResponse.data.localSourceCheckoutPath,
      });
      if (installPlanResponse.success && installPlanResponse.data) {
        setGraphifyInstallPlan(installPlanResponse.data);
      }

      // Automatic update check: installed version vs latest PyPI release. Offline or
      // failed checks degrade to a disabled update action, never to an error state.
      if (runtimeStatus?.graphify.available) {
        const updateCheckResponse = await window.vaultAPI.checkGraphifyUpdate();
        setGraphifyUpdateCheck(updateCheckResponse.success && updateCheckResponse.data
          ? updateCheckResponse.data
          : null);
      } else {
        setGraphifyUpdateCheck(null);
      }
    } catch (err) {
      setGraphifyError(err instanceof Error ? err.message : 'Failed to load Graphify extension');
      setGraphifyRuntimeStatus(null);
      setGraphifyInstallPlan(null);
      setGraphifyUpdateCheck(null);
    } finally {
      setLoadingGraphify(false);
    }
  }

  async function runGraphifyUpdate() {
    setGraphifyUpdating(true);
    setGraphifyUpdateResult(null);
    try {
      const response = await window.vaultAPI.updateGraphifyRuntime();
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Graphify update failed.');
      }
      const rebuilds = response.data.rebuildsQueued;
      setGraphifyUpdateResult({
        ok: true,
        message: `Graphify updated to ${response.data.installedVersion ?? 'an unknown version'}${
          rebuilds.length > 0
            ? `. Graph rebuilds queued for: ${rebuilds.join(', ')}.`
            : '.'
        }`,
      });
      await loadGraphifyExtension();
    } catch (err) {
      setGraphifyUpdateResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Graphify update failed.',
      });
    } finally {
      setGraphifyUpdating(false);
    }
  }

  async function loadVaultCollabExtension() {
    setLoadingVaultCollab(true);
    setVaultCollabError(null);

    try {
      const configResponse = await window.vaultAPI.getVaultCollabRuntimeConfig();
      if (!configResponse.success || !configResponse.data) {
        throw new Error(configResponse.error || 'Failed to load Vault Collab config');
      }

      setVaultCollabConfig(configResponse.data);

      const [runtimeResponse, installPlanResponse, sourcePathResponse] = await Promise.all([
        window.vaultAPI.detectVaultCollabRuntime(),
        window.vaultAPI.planVaultCollabInstall(),
        window.vaultAPI.detectVaultCollabSourcePath(),
      ]);

      if (runtimeResponse.success && runtimeResponse.data) {
        setVaultCollabRuntimeStatus(runtimeResponse.data);
      } else {
        setVaultCollabRuntimeStatus(null);
        setVaultCollabError(runtimeResponse.error || 'Vault Collab detection failed');
      }

      if (installPlanResponse.success && installPlanResponse.data) {
        setVaultCollabInstallPlan(installPlanResponse.data);
      }

      if (sourcePathResponse.success && sourcePathResponse.data) {
        setVaultCollabDetectedSource(sourcePathResponse.data);
      }
    } catch (err) {
      setVaultCollabError(err instanceof Error ? err.message : 'Failed to load Vault Collab extension');
      setVaultCollabRuntimeStatus(null);
      setVaultCollabInstallPlan(null);
      setVaultCollabDetectedSource(null);
    } finally {
      setLoadingVaultCollab(false);
    }
  }

  async function useDetectedVaultCollabSourcePath() {
    setLoadingVaultCollab(true);
    setVaultCollabError(null);
    setMessage(null);

    try {
      const response = await window.vaultAPI.useDetectedVaultCollabSourcePath();
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to use the detected Vault Collab repo');
      }

      setVaultCollabConfig(response.data);
      setMessage('Detected Vault Collab repo saved.');
      await loadVaultCollabExtension();
    } catch (err) {
      setVaultCollabError(err instanceof Error ? err.message : 'Failed to use the detected Vault Collab repo');
    } finally {
      setLoadingVaultCollab(false);
    }
  }

  async function useManagedVaultCollabRuntime() {
    setLoadingVaultCollab(true);
    setVaultCollabError(null);
    setMessage(null);

    try {
      const response = await window.vaultAPI.resetVaultCollabRuntimeConfig();
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to switch Vault Collab to managed GitHub install');
      }

      setVaultCollabConfig(response.data);
      setMessage('Vault Collab managed GitHub install selected.');
      await loadVaultCollabExtension();
    } catch (err) {
      setVaultCollabError(err instanceof Error ? err.message : 'Failed to switch Vault Collab to managed GitHub install');
    } finally {
      setLoadingVaultCollab(false);
    }
  }

  async function chooseVaultCollabSourcePath() {
    setLoadingVaultCollab(true);
    setVaultCollabError(null);
    setMessage(null);

    try {
      const response = await window.vaultAPI.chooseVaultCollabSourcePath();
      if (!response.success) {
        throw new Error(response.error || 'Failed to choose Vault Collab source folder');
      }

      if (response.data) {
        setVaultCollabConfig(response.data);
        setMessage('Vault Collab source folder saved.');
      }

      await loadVaultCollabExtension();
    } catch (err) {
      setVaultCollabError(err instanceof Error ? err.message : 'Failed to choose Vault Collab source folder');
    } finally {
      setLoadingVaultCollab(false);
    }
  }

  function updateSetting<K extends keyof EditableSettings>(key: K, value: EditableSettings[K]) {
    setSettings((current: VaultSettings) => ({
      ...current,
      [key]: value,
    }));
  }

  function ensureSelectedModels(list: OpenRouterModelSummary[], selectedModels: string[]) {
    const uniqueSelections = Array.from(new Set(selectedModels.filter(Boolean)));
    const missing = uniqueSelections.filter((modelId) => !list.some((model) => model.id === modelId));

    return [
      ...missing.map((modelId) => ({
        id: modelId,
        name: `${modelId} (saved)`,
        contextLength: null,
        promptPrice: null,
        completionPrice: null,
      })),
      ...list,
    ];
  }

  function setProviderModels(provider: AiProviderId, list: OpenRouterModelSummary[], selectedModels: string[]) {
    setModelsByProvider((current) => ({
      ...current,
      [provider]: ensureSelectedModels(list, selectedModels),
    }));
  }

  function selectedModelsFor(provider: AiProviderId): string[] {
    return collectSelectedTextModels(enrichmentModels[provider], routingTables[provider]);
  }

  async function loadOpenRouterModels(nextApiKey: string, selectedModels: string[]) {
    if (!nextApiKey.trim()) {
      setProviderModels('openrouter', FALLBACK_MODELS, selectedModels);
      return;
    }

    setLoadingModels(true);

    try {
      const response = await window.vaultAPI.getOpenRouterModels(nextApiKey.trim());
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to load model list');
      }

      setProviderModels('openrouter', response.data, selectedModels);
    } catch (err) {
      setProviderModels('openrouter', FALLBACK_MODELS, selectedModels);
      setError(err instanceof Error ? err.message : 'Failed to load model list');
    } finally {
      setLoadingModels(false);
    }
  }

  async function loadLlmHubModels(baseUrl: string, key: string, selectedModels: string[]) {
    if (!baseUrl.trim() || !key.trim()) {
      setProviderModels('llm-hub', [], selectedModels);
      return;
    }

    setLoadingModels(true);

    try {
      const response = await window.vaultAPI.getLlmHubModels(baseUrl.trim(), key.trim());
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to load LLM-Hub model list');
      }

      setProviderModels('llm-hub', response.data, selectedModels);
    } catch (err) {
      setProviderModels('llm-hub', [], selectedModels);
      setError(err instanceof Error ? err.message : 'Failed to load LLM-Hub model list');
    } finally {
      setLoadingModels(false);
    }
  }

  async function handleTestLlmHubConnection() {
    if (!llmHubBaseUrl.trim() || !llmHubApiKey.trim()) {
      setError('Enter the LLM-Hub base URL and API key before testing.');
      setLlmHubTestResult(null);
      return;
    }

    setTestingKey(true);
    setError(null);
    setMessage(null);

    try {
      const [testResponse] = await Promise.all([
        window.vaultAPI.testLlmHubConnection(llmHubBaseUrl.trim(), llmHubApiKey.trim()),
        loadLlmHubModels(llmHubBaseUrl, llmHubApiKey, selectedModelsFor('llm-hub')),
      ]);

      if (!testResponse.success || !testResponse.data) {
        throw new Error(testResponse.error || 'LLM-Hub connection test failed');
      }

      setLlmHubTestResult(testResponse.data);
      setMessage(`LLM-Hub connected — ${testResponse.data.modelCount} models available.`);
    } catch (err) {
      setLlmHubTestResult(null);
      setError(err instanceof Error ? err.message : 'LLM-Hub connection test failed');
    } finally {
      setTestingKey(false);
    }
  }

  function refreshProviderModels(provider: AiProviderId) {
    if (provider === 'llm-hub') {
      void loadLlmHubModels(llmHubBaseUrl, llmHubApiKey, selectedModelsFor('llm-hub'));
    } else {
      void loadOpenRouterModels(apiKey.trim(), selectedModelsFor('openrouter'));
    }
  }

  function changePrimaryProvider(next: AiProviderId) {
    setPrimaryProvider(next);
    setRoutingProvider(next);
    if (fallbackProvider === next) {
      setFallbackProvider('none');
    }
  }

  async function handleTestApiKey() {
    if (!apiKey.trim()) {
      setError('Enter an OpenRouter API key before testing.');
      setTestResult(null);
      return;
    }

    setTestingKey(true);
    setError(null);
    setMessage(null);

    try {
      const [testResponse] = await Promise.all([
        window.vaultAPI.testOpenRouterApiKey(apiKey.trim()),
        loadOpenRouterModels(apiKey.trim(), selectedModelsFor('openrouter')),
      ]);

      if (!testResponse.success || !testResponse.data) {
        throw new Error(testResponse.error || 'API key test failed');
      }

      setTestResult(testResponse.data);
      setMessage(`API key verified for ${testResponse.data.label}.`);
    } catch (err) {
      setTestResult(null);
      setError(err instanceof Error ? err.message : 'API key test failed');
    } finally {
      setTestingKey(false);
    }
  }

  async function saveSettings() {
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const updates: EditableSettings = {
        enrichment_model: enrichmentModels.openrouter,
        enrichment_enabled: settings.enrichment_enabled,
        recall_max_results: Number(settings.recall_max_results) || 10,
        recall_compact_limit: clampNumber(settings.recall_compact_limit, 6, 1, 12),
        recall_top_match_limit: clampNumber(settings.recall_top_match_limit, 4, 1, 8),
        recall_detail_expansion_limit: clampNumber(settings.recall_detail_expansion_limit, 2, 0, 4),
        recall_related_limit: clampNumber(settings.recall_related_limit, 2, 0, 4),
        recall_proactive_limit: clampNumber(settings.recall_proactive_limit, 2, 0, 4),
        auto_log: settings.auto_log,
      };

      for (const [key, value] of Object.entries(updates)) {
        const response = await window.vaultAPI.setSetting(key, value);
        if (!response.success) {
          throw new Error(response.error || `Failed to save ${key}`);
        }
      }

      const dutyUpdates: Array<[string, unknown]> = [
        ['agent.project_maintenance.enabled', agentDuties.projectMaintenanceEnabled],
        ['agent.project_maintenance.cooldown_days', Math.max(0, Math.floor(agentDuties.projectMaintenanceCooldownDays) || 0)],
        ['agent.project_maintenance.min_items_for_review', Math.max(1, Math.floor(agentDuties.projectMaintenanceMinItemsForReview) || 1)],
        ['agent.project_maintenance.merge_candidate_max_items', Math.max(1, Math.floor(agentDuties.projectMaintenanceMergeCandidateMaxItems) || 1)],
        ['agent.stale_archival.enabled', agentDuties.staleArchivalEnabled],
        ['agent.stale_archival.active_to_stale_days', Math.max(1, Math.floor(agentDuties.staleActiveToStaleDays) || 1)],
        ['agent.stale_archival.stale_to_archived_days', Math.max(1, Math.floor(agentDuties.staleStaleToArchivedDays) || 1)],
        ['agent.stale_archival.archived_to_pending_delete_days', Math.max(1, Math.floor(agentDuties.staleArchivedToPendingDeleteDays) || 1)],
      ];
      for (const [key, value] of dutyUpdates) {
        const response = await window.vaultAPI.setSetting(key, value);
        if (!response.success) {
          throw new Error(response.error || `Failed to save ${key}`);
        }
      }

      const providerSettings: Array<[string, unknown]> = [
        ['ai_provider_primary', primaryProvider],
        ['ai_provider_fallback', fallbackProvider],
        // Legacy single-provider key kept in sync for older readers.
        ['ai_provider', primaryProvider],
        ['llm_hub_base_url', llmHubBaseUrl.trim()],
        ['enrichment_model_llm_hub', enrichmentModels['llm-hub']],
      ];
      for (const [key, value] of providerSettings) {
        const response = await window.vaultAPI.setSetting(key, value);
        if (!response.success) {
          throw new Error(response.error || `Failed to save ${key}`);
        }
      }

      const secretResponse = await window.vaultAPI.setSecretSetting('openrouter_api_key', apiKey.trim());
      if (!secretResponse.success) {
        throw new Error(secretResponse.error || 'Failed to save API key');
      }

      const llmHubSecretResponse = await window.vaultAPI.setSecretSetting('llm_hub_api_key', llmHubApiKey.trim());
      if (!llmHubSecretResponse.success) {
        throw new Error(llmHubSecretResponse.error || 'Failed to save LLM-Hub API key');
      }

      const openRouterRoutingResponse = await window.vaultAPI.setModelRoutingTable(routingTables.openrouter, 'openrouter');
      if (!openRouterRoutingResponse.success || !openRouterRoutingResponse.data) {
        throw new Error(openRouterRoutingResponse.error || 'Failed to save task routing');
      }

      const llmHubRoutingResponse = await window.vaultAPI.setModelRoutingTable(routingTables['llm-hub'], 'llm-hub');
      if (!llmHubRoutingResponse.success || !llmHubRoutingResponse.data) {
        throw new Error(llmHubRoutingResponse.error || 'Failed to save LLM-Hub task routing');
      }

      setRoutingTables({
        openrouter: openRouterRoutingResponse.data,
        'llm-hub': llmHubRoutingResponse.data,
      });

      // Re-initialize the enrichment client with the new settings
      await window.vaultAPI.refreshEnrichment();

      setMessage('Settings saved locally. API key is stored encrypted at rest and task routing overrides were updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  async function copyText(token: string, value: string, successMessage?: string) {
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
      if (successMessage) {
        setMessage(successMessage);
        setError(null);
      }

      window.setTimeout(() => {
        setCopiedToken((current) => (current === token ? null : current));
      }, 1600);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Copy failed');
    }
  }

  async function getSkillFile(entry: SkillEntry): Promise<VaultSkillFile> {
    if (skillFiles[entry.id]) {
      return skillFiles[entry.id];
    }

    setLoadingSkillId(entry.id);

    try {
      const response = await window.vaultAPI.readSkillFile(entry.path);
      if (!response.success || !response.data) {
        throw new Error(response.error || `Failed to read ${entry.path}`);
      }

      setSkillFiles((current) => ({
        ...current,
        [entry.id]: response.data!,
      }));

      return response.data;
    } finally {
      setLoadingSkillId((current) => (current === entry.id ? null : current));
    }
  }

  async function handleCopySkillFile(entry: SkillEntry) {
    try {
      const skillFile = await getSkillFile(entry);
      await copyText(`${entry.id}-file`, skillFile.content, `Copied ${skillFile.filename}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to copy ${entry.title}`);
    }
  }

  async function handleDownloadSkillFile(entry: SkillEntry) {
    try {
      const skillFile = await getSkillFile(entry);
      const blob = new Blob([skillFile.content], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = skillFile.filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      setMessage(`Downloaded ${skillFile.filename}.`);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to download ${entry.title}`);
    }
  }

  function updateRoutingTableForEditor(updater: (current: ModelRoutingTable) => ModelRoutingTable) {
    setRoutingTables((tables) => ({
      ...tables,
      [routingProvider]: updater(tables[routingProvider]),
    }));
  }

  function updateRouteModel(taskType: VaultTaskType, modelId: string) {
    updateRoutingTableForEditor((current) => {
      const existingRoute = getRouteConfig(current, taskType);
      const nextRoute = existingRoute
        ? { ...existingRoute, modelId }
        : { taskType, modelId };

      return {
        ...current,
        routes: [
          ...current.routes.filter((route) => route.taskType !== taskType),
          nextRoute,
        ],
      };
    });
  }

  function updateFallbackRouteModel(taskType: VaultTaskType, fallbackModelId: string) {
    updateRoutingTableForEditor((current) => {
      const existingRoute = getRouteConfig(current, taskType);
      const nextRoute = existingRoute
        ? {
            ...existingRoute,
            fallbackModelId: fallbackModelId || undefined,
          }
        : {
            taskType,
            modelId: current.defaultModelId,
            fallbackModelId: fallbackModelId || undefined,
          };

      return {
        ...current,
        routes: [
          ...current.routes.filter((route) => route.taskType !== taskType),
          nextRoute,
        ],
      };
    });
  }

  function getRouteModel(taskType: VaultTaskType): string {
    return getRouteConfig(routingTable, taskType)?.modelId || routingTable.defaultModelId;
  }

  function getRouteFallbackModel(taskType: VaultTaskType): string {
    return getRouteConfig(routingTable, taskType)?.fallbackModelId || '';
  }

  function applyRoutingPreset(presetId: RoutingPresetId) {
    const preset = ROUTING_PRESETS.find((entry) => entry.id === presetId);
    if (!preset) {
      return;
    }

    updateRoutingTableForEditor(() => structuredClone(preset.table));
    setMessage(`Applied the ${preset.label.toLowerCase()} routing preset. Save settings to persist it.`);
    setError(null);
  }

  function getSelectedRoutingPreset(): RoutingPresetId | null {
    const match = ROUTING_PRESETS.find((preset) => routingTablesEqual(routingTable, preset.table));
    return match?.id || null;
  }

  function getModelPricingSummary(modelId: string, modelKind: 'text' | 'image'): string {
    if (modelKind === 'image') {
      return 'Image pricing varies by provider and is not surfaced in the current text-model list.';
    }

    const model = models.find((entry) => entry.id === modelId);
    if (!model) {
      return 'Pricing unavailable for this saved model.';
    }

    if (!model.promptPrice && !model.completionPrice) {
      return 'Pricing unavailable from the current model list.';
    }

    const promptPrice = model.promptPrice ? formatPerMillionPrice(model.promptPrice) : null;
    const completionPrice = model.completionPrice ? formatPerMillionPrice(model.completionPrice) : null;

    if (promptPrice && completionPrice) {
      return `Approx. ${promptPrice} input + ${completionPrice} output per 1M tokens.`;
    }

    if (promptPrice) {
      return `Approx. ${promptPrice} input per 1M tokens.`;
    }

    return `Approx. ${completionPrice} output per 1M tokens.`;
  }

  function collectSelectedTextModels(
    enrichmentModel: string | undefined,
    nextRoutingTable: ModelRoutingTable,
  ): string[] {
    const textRouteModels = ROUTING_EDITOR_TASKS
      .filter((task) => task.modelKind === 'text')
      .flatMap((task) => {
        const route = getRouteConfig(nextRoutingTable, task.taskType);
        return [route?.modelId || '', route?.fallbackModelId || ''];
      });

    return [
      enrichmentModel || '',
      nextRoutingTable.defaultModelId,
      ...textRouteModels,
    ].filter(Boolean);
  }

  function renderOverviewTab() {
    const primaryTable = routingTables[primaryProvider];
    const selectedPresetLabel = ROUTING_PRESETS.find((preset) => routingTablesEqual(primaryTable, preset.table))?.label
      || 'Custom';

    return (
      <div className="settings-tab-panel">
        <section className="section-intro">
          <div className="section-intro-copy">
            <span className="section-intro-eyebrow">Settings</span>
            <div className="section-intro-title">Where this vault runs and how it is meant to be used</div>
            <p className="section-intro-text">This tab shows the live runtime and product orientation. Configure the AI provider and model routing under “AI &amp; Models”, and recall sizing plus agent duties under “Memory &amp; Recall”.</p>
          </div>
          <div className="section-intro-meta">
            <span className="section-intro-chip">runtime</span>
            <span className="section-intro-chip">status</span>
          </div>
        </section>

        <section className="settings-overview-grid">
          <article className="hero-card">
            <span className="hero-card-label">Connected root</span>
            <strong className="hero-card-value hero-card-value-compact">{vaultStatus?.root ? 'Live vault' : 'Unavailable'}</strong>
            <span className="hero-card-note">{vaultStatus?.root || 'The current desktop process has not reported a live vault root.'}</span>
          </article>
          <article className="hero-card">
            <span className="hero-card-label">Recall packing</span>
            <strong className="hero-card-value hero-card-value-compact">
              {settings.recall_top_match_limit ?? DEFAULT_SETTINGS.recall_top_match_limit}/{settings.recall_detail_expansion_limit ?? DEFAULT_SETTINGS.recall_detail_expansion_limit}
            </strong>
            <span className="hero-card-note">Top compact matches / expanded detail slots in the current recall snapshot.</span>
          </article>
          <article className="hero-card hero-card-accent">
            <span className="hero-card-label">Delegated routing</span>
            <strong className="hero-card-value hero-card-value-compact">{selectedPresetLabel}</strong>
            <span className="hero-card-note">{primaryTable.defaultModelId} is the default delegated task model on {primaryProvider === 'llm-hub' ? 'LLM-Hub' : 'OpenRouter'}.</span>
          </article>
        </section>

        <section className="panel settings-section">
          <div className="panel-header">
            <div>
              <div className="panel-title">Core operating modes</div>
              <div className="panel-subtitle">Treat Vault as the memory system first. External clients stay the AI surface through MCP.</div>
            </div>
            <ShieldCheck size={18} className="panel-icon" />
          </div>

          <div className="note-card">
            <p>The product center is local structured memory: save durable outcomes, recall them with low context cost, and keep the file-backed vault readable on disk.</p>
            <p>The main distinction is simple: MCP means another client calls Vault tools, while Vault remains the local memory and workflow source of truth.</p>
          </div>

          <div className="settings-card-grid">
            <WorkflowCard
              title="Vault memory core"
              description="This is the part that should feel finished first."
              steps={[
                'Vault stores structured memory locally and keeps readable files on disk.',
                'Recall searches saved decisions, summaries, plans, references, and handoffs.',
                'Desktop, CLI, and MCP all sit on top of the same memory store.',
              ]}
            />
            <WorkflowCard
              title="External clients through MCP"
              description="Use this when Codex, Claude Desktop, Claude Code, or another MCP client should stay the AI."
              steps={[
                'Client stays the model and conversation surface.',
                'Vault exposes recall and save tools through MCP.',
                'Use this path when you want external tools to call Vault memory directly.',
              ]}
            />
            <WorkflowCard
              title="MCP operating guide"
              description="Use this when client agents need consistent recall and save habits."
              steps={[
                'Install the full Codex or Claude guide in the target client.',
                'Connect the vault-memory MCP server from Client setup.',
                'Verify one recall at session start and one save after a meaningful outcome.',
              ]}
            />
          </div>
        </section>

        <div className="settings-grid">
          <section className="panel settings-section">
            <div className="panel-header">
              <div>
                <div className="panel-title">Vault runtime</div>
                <div className="panel-subtitle">What this desktop session is currently attached to.</div>
              </div>
              <FolderRoot size={18} className="panel-icon" />
            </div>

            <div className="field-grid">
              <label className="field-row">
                <span className="field-label">Live vault root</span>
                <input className="text-input" value={vaultStatus?.root || 'Unavailable'} readOnly />
              </label>

              <label className="field-row">
                <span className="field-label">Configured default root</span>
                <input className="text-input" value={String(settings.vault_root || '')} readOnly />
                <span className="field-help">Shown for visibility only. The current session root is controlled by the running main process.</span>
              </label>

              <label className="field-row">
                <span className="field-label">Known projects</span>
                <input className="text-input" value={String(vaultStatus?.projects.length || 0)} readOnly />
              </label>
            </div>
          </section>

          <section className="panel settings-section">
            <div className="panel-header">
              <div>
                <div className="panel-title">Current product focus</div>
                <div className="panel-subtitle">What is meant to feel solid now versus what is still secondary.</div>
              </div>
              <ShieldCheck size={18} className="panel-icon" />
            </div>

            <div className="note-card">
              <p>This desktop UI writes settings to the local vault store and reloads them on refresh.</p>
              <p>Provider API keys are stored encrypted at rest. On Windows and macOS Vault uses Electron safe storage when available; otherwise it falls back to AES-256-GCM local encryption.</p>
              <p>Core memory, structured save, recall ranking, similarity checks, and file-backed persistence are the product center. The multi-agent control plane is still secondary to this memory workflow.</p>
            </div>
          </section>
        </div>
      </div>
    );
  }

  function renderMemoryTab() {
    return (
      <div className="settings-tab-panel">
        <section className="section-intro">
          <div className="section-intro-copy">
            <span className="section-intro-eyebrow">Memory &amp; Recall</span>
            <div className="section-intro-title">Tune the recall context budget and background maintenance</div>
            <p className="section-intro-text">Recall sizing controls how much context comes back per query. Agent duties are the opt-in background passes that keep the registry clean — they only produce reviewable proposals.</p>
          </div>
          <div className="section-intro-meta">
            <span className="section-intro-chip">recall packing</span>
            <span className="section-intro-chip">agent duties</span>
          </div>
        </section>

        <div className="settings-grid">
          <section className="panel settings-section">
            <div className="panel-header">
              <div>
                <div className="panel-title">Recall behavior</div>
                <div className="panel-subtitle">Tune how much context comes back when you query the vault.</div>
              </div>
              <Bot size={18} className="panel-icon" />
            </div>

            <div className="field-grid">
              <div className="detail-section">
                <div className="detail-section-title">
                  <Bot size={16} />
                  <span>Essential recall sizing</span>
                </div>
                <div className="dense-grid">
                  <label className="field-row">
                    <span className="field-label">Maximum recall results</span>
                    <input
                      className="text-input"
                      type="number"
                      min={1}
                      max={50}
                      value={settings.recall_max_results}
                      onChange={(event) => updateSetting('recall_max_results', Number(event.target.value) || 1)}
                    />
                    <span className="field-help">Used as the default recall cap when the client does not provide one.</span>
                  </label>

                  <label className="field-row">
                    <span className="field-label">Compact candidate limit</span>
                    <input
                      className="text-input"
                      type="number"
                      min={1}
                      max={12}
                      value={settings.recall_compact_limit ?? DEFAULT_SETTINGS.recall_compact_limit}
                      onChange={(event) => updateSetting('recall_compact_limit', Number(event.target.value) || 1)}
                    />
                    <span className="field-help">How many ranked candidates are inspected before compact packing.</span>
                  </label>

                  <label className="field-row">
                    <span className="field-label">Compact top matches</span>
                    <input
                      className="text-input"
                      type="number"
                      min={1}
                      max={8}
                      value={settings.recall_top_match_limit ?? DEFAULT_SETTINGS.recall_top_match_limit}
                      onChange={(event) => updateSetting('recall_top_match_limit', Number(event.target.value) || 1)}
                    />
                    <span className="field-help">How many compact match summaries are injected into the model-facing recall snapshot.</span>
                  </label>
                </div>
              </div>

              <div className="detail-section">
                <div className="detail-section-title">
                  <Sparkles size={16} />
                  <span>Advanced recall packing</span>
                </div>
                <div className="dense-grid">
                  <label className="field-row">
                    <span className="field-label">Expanded detail slots</span>
                    <input
                      className="text-input"
                      type="number"
                      min={0}
                      max={4}
                      value={settings.recall_detail_expansion_limit ?? DEFAULT_SETTINGS.recall_detail_expansion_limit}
                      onChange={(event) => updateSetting('recall_detail_expansion_limit', Math.max(0, Number(event.target.value) || 0))}
                    />
                    <span className="field-help">How many top matches are expanded with fuller detail after the compact recall stage.</span>
                  </label>

                  <label className="field-row">
                    <span className="field-label">Related cues</span>
                    <input
                      className="text-input"
                      type="number"
                      min={0}
                      max={4}
                      value={settings.recall_related_limit ?? DEFAULT_SETTINGS.recall_related_limit}
                      onChange={(event) => updateSetting('recall_related_limit', Math.max(0, Number(event.target.value) || 0))}
                    />
                    <span className="field-help">How many related memories should be carried into the compact recall snapshot.</span>
                  </label>

                  <label className="field-row">
                    <span className="field-label">Proactive cues</span>
                    <input
                      className="text-input"
                      type="number"
                      min={0}
                      max={4}
                      value={settings.recall_proactive_limit ?? DEFAULT_SETTINGS.recall_proactive_limit}
                      onChange={(event) => updateSetting('recall_proactive_limit', Math.max(0, Number(event.target.value) || 0))}
                    />
                    <span className="field-help">How many proactive same-project cues should be carried into the compact recall snapshot.</span>
                  </label>
                </div>
              </div>

              <label className="toggle-row">
                <div>
                  <span className="field-label">Automatic activity logging</span>
                  <span className="field-help">Keep operational traces for saves, recalls, promotions, and other automated flows.</span>
                </div>
                <input
                  type="checkbox"
                  checked={settings.auto_log}
                  onChange={(event) => updateSetting('auto_log', event.target.checked)}
                />
              </label>
            </div>
          </section>
        </div>

        <div className="settings-grid">
          <section className="panel settings-section">
            <div className="panel-header">
              <div>
                <div className="panel-title">Agent duties</div>
                <div className="panel-subtitle">Background maintenance the Vault agent runs on the registry. All duties are off by default and produce reviewable proposals rather than acting silently.</div>
              </div>
              <Gauge size={18} className="panel-icon" />
            </div>

            <div className="field-grid">
              <label className="toggle-row">
                <div>
                  <span className="field-label">Project review duty</span>
                  <span className="field-help">Periodically inspects each project and queues description / relationship / merge proposals. Decisions are made via vault_decide_project_proposal.</span>
                </div>
                <input
                  type="checkbox"
                  checked={agentDuties.projectMaintenanceEnabled}
                  onChange={(event) => setAgentDuties((d) => ({ ...d, projectMaintenanceEnabled: event.target.checked }))}
                />
              </label>

              <div className="field-row-pair">
                <label className="field-row">
                  <span className="field-label">Cooldown days</span>
                  <input
                    className="text-input"
                    type="number"
                    min={0}
                    value={agentDuties.projectMaintenanceCooldownDays}
                    onChange={(event) => setAgentDuties((d) => ({ ...d, projectMaintenanceCooldownDays: Number(event.target.value) || 0 }))}
                  />
                  <span className="field-help">Minimum days between reviews of the same project.</span>
                </label>

                <label className="field-row">
                  <span className="field-label">Min items for review</span>
                  <input
                    className="text-input"
                    type="number"
                    min={1}
                    value={agentDuties.projectMaintenanceMinItemsForReview}
                    onChange={(event) => setAgentDuties((d) => ({ ...d, projectMaintenanceMinItemsForReview: Number(event.target.value) || 1 }))}
                  />
                  <span className="field-help">Skip projects with fewer items than this.</span>
                </label>

                <label className="field-row">
                  <span className="field-label">Merge-candidate max items</span>
                  <input
                    className="text-input"
                    type="number"
                    min={1}
                    value={agentDuties.projectMaintenanceMergeCandidateMaxItems}
                    onChange={(event) => setAgentDuties((d) => ({ ...d, projectMaintenanceMergeCandidateMaxItems: Number(event.target.value) || 1 }))}
                  />
                  <span className="field-help">Only propose merging projects with at most this many items (avoids accidental large merges).</span>
                </label>
              </div>

              <label className="toggle-row">
                <div>
                  <span className="field-label">Lifecycle pipeline (stale → archive → pending delete)</span>
                  <span className="field-help">Demotes low-usage memory through tiers. Items in pending_delete are excluded from recall but never deleted automatically — vault_confirm_delete is required.</span>
                </div>
                <input
                  type="checkbox"
                  checked={agentDuties.staleArchivalEnabled}
                  onChange={(event) => setAgentDuties((d) => ({ ...d, staleArchivalEnabled: event.target.checked }))}
                />
              </label>

              <div className="field-row-pair">
                <label className="field-row">
                  <span className="field-label">Active → stale (days)</span>
                  <input
                    className="text-input"
                    type="number"
                    min={1}
                    value={agentDuties.staleActiveToStaleDays}
                    onChange={(event) => setAgentDuties((d) => ({ ...d, staleActiveToStaleDays: Number(event.target.value) || 1 }))}
                  />
                  <span className="field-help">Untouched + low-usage items move to stale after this many days.</span>
                </label>

                <label className="field-row">
                  <span className="field-label">Stale → archived (days)</span>
                  <input
                    className="text-input"
                    type="number"
                    min={1}
                    value={agentDuties.staleStaleToArchivedDays}
                    onChange={(event) => setAgentDuties((d) => ({ ...d, staleStaleToArchivedDays: Number(event.target.value) || 1 }))}
                  />
                  <span className="field-help">Stale items rest this long before becoming archived.</span>
                </label>

                <label className="field-row">
                  <span className="field-label">Archived → pending delete (days)</span>
                  <input
                    className="text-input"
                    type="number"
                    min={1}
                    value={agentDuties.staleArchivedToPendingDeleteDays}
                    onChange={(event) => setAgentDuties((d) => ({ ...d, staleArchivedToPendingDeleteDays: Number(event.target.value) || 1 }))}
                  />
                  <span className="field-help">Archived items rest this long before queuing for human delete review.</span>
                </label>
              </div>
            </div>
          </section>
        </div>

      </div>
    );
  }

  function renderAiModelsTab() {
    const selectedPresetId = getSelectedRoutingPreset();

    return (
      <div className="settings-tab-panel">
        <section className="section-intro">
          <div className="section-intro-copy">
            <span className="section-intro-eyebrow">AI &amp; Models</span>
            <div className="section-intro-title">One provider, one model list, one routing table</div>
            <p className="section-intro-text">Pick the AI provider and credentials first — the model dropdowns load from it. Then choose the enrichment model and route each delegated task type to a cheaper or stronger model.</p>
          </div>
          <div className="section-intro-meta">
            <span className="section-intro-chip">provider</span>
            <span className="section-intro-chip">enrichment</span>
            <span className="section-intro-chip">task routing</span>
          </div>
        </section>

        <div className="settings-grid">
          <section className="panel settings-section">
            <div className="panel-header">
              <div>
                <div className="panel-title">AI provider &amp; enrichment</div>
                <div className="panel-subtitle">Credentials, model source, and the enrichment model used for metadata generation.</div>
              </div>
              <Sparkles size={18} className="panel-icon" />
            </div>

            <div className="field-grid">
              <label className="toggle-row">
                <div>
                  <span className="field-label">Enable enrichment</span>
                  <span className="field-help">Allow the vault to use model-backed enrichment when that feature path is invoked.</span>
                </div>
                <input
                  type="checkbox"
                  checked={settings.enrichment_enabled}
                  onChange={(event) => updateSetting('enrichment_enabled', event.target.checked)}
                />
              </label>

              <div className="field-row-pair">
                <label className="field-row">
                  <span className="field-label">Primary provider</span>
                  <select
                    className="text-input"
                    value={primaryProvider}
                    onChange={(event) => changePrimaryProvider(event.target.value === 'llm-hub' ? 'llm-hub' : 'openrouter')}
                  >
                    <option value="openrouter">OpenRouter</option>
                    <option value="llm-hub">LLM-Hub (OpenAI-compatible)</option>
                  </select>
                  <span className="field-help">Handles the task executor, enrichment, and the Vault API backend first.</span>
                </label>

                <label className="field-row">
                  <span className="field-label">Fallback provider</span>
                  <select
                    className="text-input"
                    value={fallbackProvider}
                    onChange={(event) => setFallbackProvider(
                      event.target.value === 'llm-hub' || event.target.value === 'openrouter'
                        ? event.target.value
                        : 'none',
                    )}
                  >
                    <option value="none">None</option>
                    {primaryProvider !== 'openrouter' ? <option value="openrouter">OpenRouter</option> : null}
                    {primaryProvider !== 'llm-hub' ? <option value="llm-hub">LLM-Hub (OpenAI-compatible)</option> : null}
                  </select>
                  <span className="field-help">Tried automatically — with its own models below — when the primary fails.</span>
                </label>
              </div>

              <div className="detail-section">
                <div className="detail-section-title">
                  <KeyRound size={16} />
                  <span>OpenRouter{primaryProvider === 'openrouter' ? ' — primary' : fallbackProvider === 'openrouter' ? ' — fallback' : ''}</span>
                </div>

                <label className="field-row">
                  <span className="field-label">API key</span>
                  <input
                    className="text-input"
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder="Stored locally in encrypted form"
                  />
                  <div className="inline-actions">
                    <button
                      type="button"
                      className="header-button"
                      onClick={() => void handleTestApiKey()}
                      disabled={testingKey || loading}
                    >
                      <Wifi size={16} />
                      <span>{testingKey ? 'Testing...' : 'Test API key'}</span>
                    </button>
                    <button
                      type="button"
                      className="header-button"
                      onClick={() => refreshProviderModels('openrouter')}
                      disabled={loadingModels || !apiKey.trim()}
                    >
                      <Sparkles size={16} />
                      <span>{loadingModels ? 'Loading models...' : 'Refresh models'}</span>
                    </button>
                  </div>
                  <span className="field-help">The key is saved locally in encrypted form and tested against OpenRouter before use.</span>
                </label>

                <label className="field-row">
                  <span className="field-label">Enrichment model</span>
                  <select
                    className="text-input"
                    value={enrichmentModels.openrouter}
                    onChange={(event) => setEnrichmentModels((current) => ({ ...current, openrouter: event.target.value }))}
                  >
                    <option value="">Select a model</option>
                    {modelsByProvider.openrouter.map((model) => (
                      <option key={`or-enrich-${model.id}`} value={model.id}>
                        {model.name} ({model.id})
                      </option>
                    ))}
                  </select>
                  <span className="field-help">Used for enrichment whenever OpenRouter serves the request.</span>
                </label>

                {testResult ? (
                  <div className="note-card">
                    <p>Label: {testResult.label} · Remaining limit: {testResult.limitRemaining ?? 'unknown'} · Usage: {testResult.usage ?? 'unknown'} · Free tier: {testResult.isFreeTier ? 'yes' : 'no'}</p>
                  </div>
                ) : null}
              </div>

              <div className="detail-section">
                <div className="detail-section-title">
                  <KeyRound size={16} />
                  <span>LLM-Hub{primaryProvider === 'llm-hub' ? ' — primary' : fallbackProvider === 'llm-hub' ? ' — fallback' : ''}</span>
                </div>

                <label className="field-row">
                  <span className="field-label">Base URL</span>
                  <input
                    className="text-input"
                    type="text"
                    value={llmHubBaseUrl}
                    onChange={(event) => setLlmHubBaseUrl(event.target.value)}
                    placeholder="http://localhost:3000/v1"
                  />
                  <span className="field-help">OpenAI-compatible API root of your LLM-Hub instance (the /v1 path).</span>
                </label>

                <label className="field-row">
                  <span className="field-label">API key</span>
                  <input
                    className="text-input"
                    type="password"
                    value={llmHubApiKey}
                    onChange={(event) => setLlmHubApiKey(event.target.value)}
                    placeholder="Stored locally in encrypted form"
                  />
                  <div className="inline-actions">
                    <button
                      type="button"
                      className="header-button"
                      onClick={() => void handleTestLlmHubConnection()}
                      disabled={testingKey || loading}
                    >
                      <Wifi size={16} />
                      <span>{testingKey ? 'Testing...' : 'Test connection'}</span>
                    </button>
                    <button
                      type="button"
                      className="header-button"
                      onClick={() => refreshProviderModels('llm-hub')}
                      disabled={loadingModels || !llmHubBaseUrl.trim() || !llmHubApiKey.trim()}
                    >
                      <Sparkles size={16} />
                      <span>{loadingModels ? 'Loading models...' : 'Refresh models'}</span>
                    </button>
                  </div>
                  <span className="field-help">The key is saved locally in encrypted form. Testing fetches the model list from your hub.</span>
                </label>

                <label className="field-row">
                  <span className="field-label">Enrichment model</span>
                  <select
                    className="text-input"
                    value={enrichmentModels['llm-hub']}
                    onChange={(event) => setEnrichmentModels((current) => ({ ...current, 'llm-hub': event.target.value }))}
                  >
                    <option value="">Select a model</option>
                    {modelsByProvider['llm-hub'].map((model) => (
                      <option key={`hub-enrich-${model.id}`} value={model.id}>
                        {model.name} ({model.id})
                      </option>
                    ))}
                  </select>
                  <span className="field-help">Used for enrichment whenever LLM-Hub serves the request. Test the connection to load the list.</span>
                </label>

                {llmHubTestResult ? (
                  <div className="note-card">
                    <p>Status: {llmHubTestResult.label} · Models available: {llmHubTestResult.modelCount}</p>
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <section className="panel settings-section">
            <div className="panel-header">
              <div>
                <div className="panel-title">Task model routing</div>
                <div className="panel-subtitle">Choose cheaper or stronger models per delegated task type. Each provider keeps its own routing table — the fallback provider uses its own models when it takes over.</div>
              </div>
              <Sparkles size={18} className="panel-icon" />
            </div>

            <div className="field-grid">
              <label className="field-row">
                <span className="field-label">Edit routing for</span>
                <select
                  className="text-input"
                  value={routingProvider}
                  onChange={(event) => setRoutingProvider(event.target.value === 'llm-hub' ? 'llm-hub' : 'openrouter')}
                >
                  <option value="openrouter">OpenRouter{primaryProvider === 'openrouter' ? ' (primary)' : fallbackProvider === 'openrouter' ? ' (fallback)' : ''}</option>
                  <option value="llm-hub">LLM-Hub{primaryProvider === 'llm-hub' ? ' (primary)' : fallbackProvider === 'llm-hub' ? ' (fallback)' : ''}</option>
                </select>
                <span className="field-help">The dropdowns below use this provider's model list and save to its own routing table.</span>
              </label>
            </div>

            {routingProvider === 'openrouter' ? (
              <div className="note-card">
                <div className="detail-section-title">
                  <Coins size={16} />
                  <span>Routing presets</span>
                </div>
                <div className="inline-actions routing-preset-actions">
                  {ROUTING_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className={`header-button routing-preset-button ${selectedPresetId === preset.id ? 'routing-preset-button-active' : ''}`}
                      onClick={() => applyRoutingPreset(preset.id)}
                    >
                      <span>{preset.label}</span>
                    </button>
                  ))}
                </div>
                <p>
                  {selectedPresetId
                    ? `Current preset match: ${ROUTING_PRESETS.find((preset) => preset.id === selectedPresetId)?.label || 'Custom'}.`
                    : 'Current routing is custom.'}
                </p>
                <p>
                  {selectedPresetId
                    ? ROUTING_PRESETS.find((preset) => preset.id === selectedPresetId)?.description
                    : 'Presets overwrite the current route table in the editor. You can still tweak individual task types before saving.'}
                </p>
              </div>
            ) : (
              <div className="note-card">
                <p>Presets use OpenRouter model IDs, so they are hidden while editing the LLM-Hub table. Pick models from your hub's list below; test the LLM-Hub connection first to load it.</p>
              </div>
            )}

            <div className="field-grid">
              <label className="field-row">
                <span className="field-label">Default task model</span>
                <select
                  className="text-input"
                  value={routingTable.defaultModelId}
                  onChange={(event) => updateRoutingTableForEditor((current) => ({ ...current, defaultModelId: event.target.value }))}
                >
                  {models.map((model) => (
                    <option key={`default-${model.id}`} value={model.id}>
                      {model.name} ({model.id})
                    </option>
                  ))}
                </select>
                <span className="field-help">Used when a delegated task type has no specific route override.</span>
                <span className="field-help routing-cost-hint">{getModelPricingSummary(routingTable.defaultModelId, 'text')}</span>
              </label>

              {ROUTING_EDITOR_TASKS.map((task) => {
                const routeOptions = task.modelKind === 'image'
                  ? IMAGE_ROUTE_MODELS
                  : models.map((model) => ({ id: model.id, name: `${model.name} (${model.id})` }));
                const fallbackOptions = [
                  { id: '', name: 'No fallback' },
                  ...routeOptions,
                ];

                return (
                  <div key={task.taskType} className="detail-section">
                    <div className="detail-section-title">
                      <span>{task.label}</span>
                    </div>
                    <div className="field-grid">
                      <label className="field-row">
                        <span className="field-label">Primary model</span>
                        <select
                          className="text-input"
                          value={getRouteModel(task.taskType)}
                          onChange={(event) => updateRouteModel(task.taskType, event.target.value)}
                        >
                          {routeOptions.map((model) => (
                            <option key={`${task.taskType}-${model.id}`} value={model.id}>
                              {model.name}
                            </option>
                          ))}
                        </select>
                        <span className="field-help">{task.description}</span>
                        <span className="field-help routing-cost-hint">{getModelPricingSummary(getRouteModel(task.taskType), task.modelKind)}</span>
                      </label>

                      <label className="field-row">
                        <span className="field-label">Fallback model</span>
                        <select
                          className="text-input"
                          value={getRouteFallbackModel(task.taskType)}
                          onChange={(event) => updateFallbackRouteModel(task.taskType, event.target.value)}
                        >
                          {fallbackOptions.map((model) => (
                            <option key={`${task.taskType}-fallback-${model.id || 'none'}`} value={model.id}>
                              {model.name}
                            </option>
                          ))}
                        </select>
                        <span className="field-help">Used when the primary route fails or the executor needs to fall back.</span>
                        <span className="field-help routing-cost-hint">
                          {getRouteFallbackModel(task.taskType)
                            ? getModelPricingSummary(getRouteFallbackModel(task.taskType), task.modelKind)
                            : 'No fallback configured for this task type.'}
                        </span>
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="note-card">
              <p>For cost control, keep lightweight flows like organize, enrich, and summarize on cheaper models. Reserve the heavier models for coding and analysis only when the quality difference is worth it.</p>
              <p>The desktop model still comes from the provider selector above. This routing section is specifically for delegated tasks and the background executor.</p>
            </div>
          </section>
        </div>
      </div>
    );
  }

  function renderExtensionsTab() {
    const graphifyModel = graphifyConfig
      ? buildGraphifySettingsViewModel({
          config: graphifyConfig,
          runtimeStatus: graphifyRuntimeStatus,
          installPlan: graphifyInstallPlan,
          detectionError: graphifyError,
          updateCheck: graphifyUpdateCheck,
          updating: graphifyUpdating,
        })
      : null;
    const GraphifyStateIcon = graphifyModel?.state === 'installed'
      ? CheckCircle2
      : graphifyModel?.state === 'failed'
        ? AlertTriangle
        : Network;
    const vaultCollabReady = Boolean(vaultCollabRuntimeStatus?.ready);
    const vaultCollabConfigured = Boolean(vaultCollabRuntimeStatus?.configured);
    const vaultCollabStatusBadge = vaultCollabReady ? 'installed' : vaultCollabConfigured ? 'needs install' : 'not installed';
    const VaultCollabStateIcon = vaultCollabReady
      ? CheckCircle2
      : vaultCollabConfigured
        ? AlertTriangle
        : Bot;
    const currentVaultCollabSourcePath = vaultCollabConfig?.localSourceCheckoutPath || vaultCollabConfig?.managedRuntimePath || null;
    const vaultCollabUsesManagedInstall = vaultCollabConfig?.runtimeMode === 'managed';
    const vaultCollabInstallSourceLabel = vaultCollabUsesManagedInstall ? 'GitHub managed install' : 'Developer local source';
    const vaultCollabRepositoryUrl = vaultCollabInstallPlan?.repositoryUrl || DEFAULT_VAULT_COLLAB_REPOSITORY_URL;
    const vaultCollabRuntimeSource = vaultCollabUsesManagedInstall
      ? vaultCollabRepositoryUrl
      : vaultCollabRuntimeStatus?.sourceRoot.path || vaultCollabConfig?.localSourceCheckoutPath || vaultCollabConfig?.managedRuntimePath || 'unresolved';
    const vaultCollabPackageLabel = vaultCollabUsesManagedInstall
      ? vaultCollabReady ? 'GitHub npm exec checked' : 'GitHub npm exec'
      : vaultCollabRuntimeStatus?.packageInfo.available
        ? `${vaultCollabRuntimeStatus.packageInfo.name || 'vault-collab'} ${vaultCollabRuntimeStatus.packageInfo.version || ''}`.trim()
        : 'missing';
    const vaultCollabCliLabel = vaultCollabUsesManagedInstall
      ? vaultCollabReady ? 'npm exec checked' : 'npm exec preview'
      : vaultCollabRuntimeStatus?.cli.available ? 'available' : 'missing';
    const vaultCollabMcpLabel = vaultCollabUsesManagedInstall
      ? 'npm exec command'
      : vaultCollabRuntimeStatus?.mcpServer.available ? 'available' : 'missing';
    const detectedVaultCollabSourceAvailable = Boolean(
      vaultCollabDetectedSource?.detected
      && vaultCollabDetectedSource.path
      && vaultCollabDetectedSource.path !== currentVaultCollabSourcePath,
    );

    return (
      <div className="settings-tab-panel">
        <section className="section-intro">
          <div className="section-intro-copy">
            <span className="section-intro-eyebrow">Extensions</span>
            <div className="section-intro-title">Extensions stay optional, local, and explicitly installed</div>
            <p className="section-intro-text">Detect Graphify and Vault Collab settings, inspect install plans, and keep every extension boundary visible before the dashboard uses it.</p>
          </div>
          <div className="section-intro-meta">
            <span className="section-intro-chip">optional runtime</span>
            <span className="section-intro-chip">managed artifacts</span>
            <span className="section-intro-chip">manual install</span>
            <button
              type="button"
              className="header-button header-button-compact"
              onClick={() => {
                void loadGraphifyExtension();
                void loadVaultCollabExtension();
              }}
              disabled={loadingGraphify || loadingVaultCollab}
            >
              <RefreshCw size={15} />
              <span>{loadingGraphify || loadingVaultCollab ? 'Detecting' : 'Detect'}</span>
            </button>
          </div>
        </section>

        <section className="panel settings-section graphify-settings-panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Graphify</div>
              <div className="panel-subtitle">Runtime status, installer preview, and developer source mode.</div>
            </div>
            <GraphifyStateIcon size={18} className="panel-icon" />
          </div>

          {!graphifyConfig || !graphifyModel ? (
            <div className="empty-state">{loadingGraphify ? 'Detecting Graphify runtime...' : 'Graphify extension status is unavailable.'}</div>
          ) : (
            <>
              <div className={`graphify-status-card graphify-status-card-${graphifyModel.state}`}>
                <div className="graphify-status-main">
                  <span className="graphify-status-icon">
                    <GraphifyStateIcon size={18} />
                  </span>
                  <div>
                    <strong>{graphifyModel.primaryLabel}</strong>
                    <p>{graphifyModel.detail}</p>
                  </div>
                </div>
                <div className="graphify-status-meta">
                  <span>{graphifyConfig.runtimeMode}</span>
                  <strong>{graphifyModel.installedVersion || 'not installed'}</strong>
                  {graphifyModel.latestVersion ? (
                    <span>{graphifyModel.updateAvailable ? `update ${graphifyModel.latestVersion}` : `latest ${graphifyModel.latestVersion}`}</span>
                  ) : null}
                </div>
              </div>

              {graphifyModel.errorMessage ? (
                <div className="note-card note-card-warning">
                  <p>{graphifyModel.errorMessage}</p>
                </div>
              ) : null}

              <div className="settings-card-grid">
                <div className="snippet-card">
                  <div className="snippet-head">
                    <div>
                      <div className="field-label">Managed runtime</div>
                      <div className="field-help">{graphifyConfig.managedRuntimePath}</div>
                    </div>
                    <FolderRoot size={17} />
                  </div>
                  <ul className="settings-guide-list">
                    <li>Profile: {graphifyConfig.installProfile}</li>
                    <li>Extras: {graphifyConfig.installExtras.length > 0 ? graphifyConfig.installExtras.join(', ') : 'none'}</li>
                    <li>Auto-build debounce: {Math.round(graphifyConfig.debounce.autoBuildDelayMs / 1000)}s</li>
                  </ul>
                </div>

                <div className="snippet-card">
                  <div className="snippet-head">
                    <div>
                      <div className="field-label">Detected tools</div>
                      <div className="field-help">Python, uv, pipx, and graphify are detected through a safe IPC call.</div>
                    </div>
                    <Terminal size={17} />
                  </div>
                  <div className="graphify-tool-grid">
                    {[
                      ['Python', graphifyRuntimeStatus?.python],
                      ['uv', graphifyRuntimeStatus?.uv],
                      ['pipx', graphifyRuntimeStatus?.pipx],
                      ['Graphify', graphifyRuntimeStatus?.graphify],
                    ].map(([label, tool]) => (
                      <div key={String(label)} className="graphify-tool-row">
                        <span>{String(label)}</span>
                        <strong>{tool && typeof tool === 'object' && tool.available ? tool.version || 'available' : 'missing'}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {graphifyModel.state === 'installed' ? (
                <div className="snippet-card">
                  <div className="snippet-head">
                    <div>
                      <div className="field-label">Runtime updates</div>
                      <div className="field-help">
                        {graphifyModel.updateAvailable && graphifyModel.latestVersion
                          ? `Graphify ${graphifyModel.latestVersion} is published on PyPI (installed: ${graphifyModel.installedVersion ?? 'unknown'}). Updating upgrades the managed runtime and queues project graph rebuilds so new features (like named communities) appear.`
                          : graphifyModel.updateCheckError
                            ? `Update check failed: ${graphifyModel.updateCheckError}`
                            : graphifyModel.actions.update.reason || 'Vault checks PyPI for newer Graphify releases on every detect.'}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="header-button"
                      onClick={() => void runGraphifyUpdate()}
                      disabled={!graphifyModel.actions.update.enabled}
                      title={graphifyModel.actions.update.reason || graphifyModel.actions.update.label}
                    >
                      <RefreshCw size={16} />
                      <span>{graphifyModel.actions.update.label}</span>
                    </button>
                  </div>
                  {graphifyUpdateResult ? (
                    <div className={`note-card${graphifyUpdateResult.ok ? '' : ' note-card-warning'}`}>
                      <p>{graphifyUpdateResult.message}</p>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {graphifyModel.state !== 'installed' ? (
                <div className="snippet-card">
                  <div className="snippet-head">
                    <div>
                      <div className="field-label">Install preview</div>
                      <div className="field-help">Vault shows commands before any install and never silently installs Graphify.</div>
                    </div>
                    <button
                      type="button"
                      className="header-button"
                      onClick={() => void copyText('graphify-install-plan', graphifyModel.installCommands.join('\n'))}
                      disabled={!graphifyModel.actions.install.enabled || graphifyModel.installCommands.length === 0}
                      title={graphifyModel.actions.install.reason || graphifyModel.actions.install.label}
                    >
                      <Copy size={16} />
                      <span>{copiedToken === 'graphify-install-plan' ? 'Copied' : graphifyModel.actions.install.label}</span>
                    </button>
                  </div>
                  <pre className="snippet-block">
                    {graphifyModel.installCommands.length > 0
                      ? graphifyModel.installCommands.join('\n')
                      : graphifyModel.actions.install.reason || 'No install command is available.'}
                  </pre>
                </div>
              ) : null}
            </>
          )}
        </section>

        <section className="panel settings-section graphify-settings-panel vault-collab-settings-panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Vault Collab</div>
              <div className="panel-subtitle">Install from the public GitHub repo, or point Vault at a local checkout while developing the extension.</div>
            </div>
            <VaultCollabStateIcon size={18} className="panel-icon" />
          </div>

          {!vaultCollabConfig ? (
            <div className="empty-state">{loadingVaultCollab ? 'Detecting Vault Collab runtime...' : 'Vault Collab extension status is unavailable.'}</div>
          ) : (
            <>
              <div className={`graphify-status-card vault-collab-status-card ${vaultCollabReady ? 'vault-collab-status-card-ready' : ''}`}>
                <div className="graphify-status-main">
                  <span className="graphify-status-icon">
                    <VaultCollabStateIcon size={18} />
                  </span>
                  <div>
                    <strong>{vaultCollabReady ? 'Ready for dashboard wiring' : vaultCollabConfigured ? 'Configuration needs install' : 'Choose a runtime source'}</strong>
                    <p>{vaultCollabRuntimeStatus?.message || vaultCollabError || 'Vault Collab has not been detected yet.'}</p>
                  </div>
                </div>
                <div className="graphify-status-meta">
                  <span>{vaultCollabInstallSourceLabel}</span>
                  <strong>{vaultCollabStatusBadge}</strong>
                </div>
              </div>

              <div className="note-card">
                <p>Default install source: {vaultCollabRepositoryUrl}</p>
                <p>Managed mode is the normal user flow. Local repo mode is only a developer shortcut for this machine or another manually cloned checkout.</p>
              </div>

              {vaultCollabError ? (
                <div className="note-card note-card-warning">
                  <p>{vaultCollabError}</p>
                </div>
              ) : null}

              <div className="settings-card-grid">
                <div className="snippet-card">
                  <div className="snippet-head">
                    <div>
                      <div className="field-label">Runtime source</div>
                      <div className="field-help">{vaultCollabRuntimeSource}</div>
                    </div>
                    <FolderRoot size={17} />
                  </div>
                  <ul className="settings-guide-list">
                    <li>Mode: {vaultCollabInstallSourceLabel}</li>
                    <li>Repository: {vaultCollabRepositoryUrl}</li>
                    <li>CLI: {vaultCollabCliLabel}</li>
                    <li>MCP server: {vaultCollabMcpLabel}</li>
                  </ul>
                  {vaultCollabDetectedSource ? (
                    <p className="field-help">
                      {vaultCollabDetectedSource.detected && vaultCollabDetectedSource.path
                        ? `Detected repo: ${vaultCollabDetectedSource.path}`
                        : vaultCollabDetectedSource.reason}
                    </p>
                  ) : null}
                  <div className="inline-actions">
                    {!vaultCollabUsesManagedInstall ? (
                      <button type="button" className="primary-button" onClick={() => void useManagedVaultCollabRuntime()} disabled={loadingVaultCollab}>
                        <Download size={16} />
                        <span>Use GitHub install</span>
                      </button>
                    ) : null}
                    {detectedVaultCollabSourceAvailable ? (
                      <button type="button" className="header-button" onClick={() => void useDetectedVaultCollabSourcePath()} disabled={loadingVaultCollab}>
                        <CheckCircle2 size={16} />
                        <span>Use local repo</span>
                      </button>
                    ) : null}
                    <button type="button" className="header-button" onClick={() => void chooseVaultCollabSourcePath()} disabled={loadingVaultCollab}>
                      <FolderRoot size={16} />
                      <span>{loadingVaultCollab ? 'Opening...' : 'Choose local source'}</span>
                    </button>
                    <button type="button" className="header-button" onClick={() => void loadVaultCollabExtension()} disabled={loadingVaultCollab}>
                      <RefreshCw size={16} />
                      <span>{loadingVaultCollab ? 'Detecting...' : 'Detect'}</span>
                    </button>
                  </div>
                </div>

                <div className="snippet-card">
                  <div className="snippet-head">
                    <div>
                      <div className="field-label">Local database</div>
                      <div className="field-help">{vaultCollabConfig.databasePath}</div>
                    </div>
                    <Terminal size={17} />
                  </div>
                  <div className="graphify-tool-grid">
                    {[
                      ['Package', vaultCollabPackageLabel],
                      ['Database', vaultCollabRuntimeStatus?.database.available ? 'exists' : 'will be created'],
                      ['CLI', vaultCollabUsesManagedInstall ? 'GitHub npm exec' : vaultCollabRuntimeStatus?.cli.path || 'unresolved'],
                    ].map(([label, value]) => (
                      <div key={label} className="graphify-tool-row">
                        <span>{label}</span>
                        <strong>{value}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="snippet-card">
                <div className="snippet-head">
                  <div>
                    <div className="field-label">Install preview</div>
                    <div className="field-help">
                      {vaultCollabUsesManagedInstall
                        ? 'Normal user flow: run the verified GitHub npm exec health check and open the local SQLite database.'
                        : 'Developer shortcut: build the selected local checkout. Switch back to GitHub install for the normal user flow.'}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="header-button"
                    onClick={() => void copyText('vault-collab-install-plan', vaultCollabInstallPlan?.commands.join('\n') || '')}
                    disabled={!vaultCollabInstallPlan || vaultCollabInstallPlan.commands.length === 0}
                  >
                    <Copy size={16} />
                    <span>{copiedToken === 'vault-collab-install-plan' ? 'Copied' : 'Copy plan'}</span>
                  </button>
                </div>
                <pre className="snippet-block">
                  {vaultCollabInstallPlan?.commands.length
                    ? vaultCollabInstallPlan.commands.join('\n')
                    : 'Choose a Vault Collab source folder to generate an install plan.'}
                </pre>
                {vaultCollabInstallPlan?.notes.length ? (
                  <ul className="settings-guide-list">
                    {vaultCollabInstallPlan.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </>
          )}
        </section>
      </div>
    );
  }

  function renderConnectionsTab() {
    return (
      <div className="settings-tab-panel">
        <section className="section-intro">
          <div className="section-intro-copy">
            <span className="section-intro-eyebrow">Connections</span>
            <div className="section-intro-title">Connect the client first, then install the operating guide</div>
            <p className="section-intro-text">This tab is about external MCP wiring. The client keeps being the AI surface, while Vault stays the memory server and workflow source of truth.</p>
          </div>
          <div className="section-intro-meta">
            <span className="section-intro-chip">MCP setup</span>
            <span className="section-intro-chip">client configs</span>
            <span className="section-intro-chip">guided install</span>
          </div>
        </section>

        <ConnectPanel copyText={copyText} copiedToken={copiedToken} />
      </div>
    );
  }

  function renderSkillsTab() {
    return (
      <div className="settings-tab-panel">
        <section className="section-intro">
          <div className="section-intro-copy">
            <span className="section-intro-eyebrow">Skills</span>
            <div className="section-intro-title">Install the full guidance file, not a shortened reminder</div>
            <p className="section-intro-text">These files teach Codex or Claude when to recall, when to save, how brain bootstrap works, and how to use queued work, executor state, and the optional Vault Collab inbox. They are meant to be copied whole.</p>
          </div>
          <div className="section-intro-meta">
            <span className="section-intro-chip">full markdown files</span>
            <span className="section-intro-chip">copy-ready prompts</span>
            <span className="section-intro-chip">stable file paths</span>
          </div>
        </section>

        <section className="panel settings-section">
          <div className="panel-header">
            <div>
              <div className="panel-title">Skills</div>
              <div className="panel-subtitle">Install the full file into the target client workflow. Copying only the path or a short note is usually not enough.</div>
            </div>
            <BookCopy size={18} className="panel-icon" />
          </div>

          <div className="note-card">
            <p>Best practice: keep the full Markdown skill file in the target client instruction system or project guidance, and keep the file path stable so future setup prompts can reference it directly.</p>
            <p>These guides assume the client connects to Vault through MCP and calls the memory tools directly.</p>
          </div>
        </section>

        <section className="panel settings-section">
          <div className="panel-header">
            <div>
              <div className="panel-title">Skill setup flows</div>
              <div className="panel-subtitle">Start here if you want the shortest path to a working install.</div>
            </div>
            <BookCopy size={18} className="panel-icon" />
          </div>

          <div className="settings-card-grid">
            <WorkflowCard
              title="Codex"
              description="Use this when Codex should keep recalling and saving Vault context while working in this repository."
              steps={[
                'Connect Vault MCP from the MCP setup tab.',
                'Install the Codex guide or copy the full codex-vault-skill.md file into stable project instructions.',
                'Verify by asking Codex to call vault_recall_context before work and vault_save_memory after a meaningful change.',
              ]}
            />
            <WorkflowCard
              title="Claude"
              description="Use this when Claude Desktop or Claude Code should keep the same Vault memory habits."
              steps={[
                'Connect Vault MCP for Claude Desktop or Claude Code.',
                'Install the Claude guide or copy the full claude-vault-skill.md file into CLAUDE.md or project instructions.',
                'Verify with one recall call at session start and one save call after a real implementation step.',
              ]}
            />
            <WorkflowCard
              title="Other MCP clients"
              description="Use this when a different stdio MCP client should access Vault memory."
              steps={[
                'Copy the generic MCP command or JSON config from Client setup.',
                'Add the full skill guidance to the client instruction system if it supports project instructions.',
                'Verify with vault_get_latest, then save one small test memory through that client.',
              ]}
            />
          </div>
        </section>

        <section className="panel settings-section">
          <div className="panel-header">
            <div>
              <div className="panel-title">Skill files</div>
              <div className="panel-subtitle">Copy the full file first. Copy the path only when another setup flow needs to reference it.</div>
            </div>
            <BookCopy size={18} className="panel-icon" />
          </div>

          <div className="settings-card-grid">
            {SKILL_ENTRIES.map((entry) => (
              <div key={entry.id} className="snippet-card">
                <div className="snippet-head">
                  <div>
                    <div className="field-label">{entry.title}</div>
                    <div className="field-help">{entry.summary}</div>
                  </div>
                  <div className="inline-actions">
                    <button type="button" className="header-button" onClick={() => void copyText(`${entry.id}-path`, entry.path)}>
                      <Copy size={16} />
                      <span>{copiedToken === `${entry.id}-path` ? 'Copied' : 'Copy path'}</span>
                    </button>
                    <button
                      type="button"
                      className="header-button"
                      onClick={() => void handleCopySkillFile(entry)}
                      disabled={loadingSkillId === entry.id}
                    >
                      <Copy size={16} />
                      <span>{loadingSkillId === entry.id ? 'Loading...' : copiedToken === `${entry.id}-file` ? 'Copied' : 'Copy full .md'}</span>
                    </button>
                    <button
                      type="button"
                      className="header-button"
                      onClick={() => void handleDownloadSkillFile(entry)}
                      disabled={loadingSkillId === entry.id}
                    >
                      <Download size={16} />
                      <span>{loadingSkillId === entry.id ? 'Loading...' : 'Download .md'}</span>
                    </button>
                  </div>
                </div>
                <pre className="snippet-block">{`Path: ${entry.path}\n\n${entry.snippet}`}</pre>
                <div className="inline-actions">
                  <button type="button" className="header-button" onClick={() => void copyText(`${entry.id}-assist`, entry.assistantPrompt)}>
                    <Copy size={16} />
                    <span>{copiedToken === `${entry.id}-assist` ? 'Copied' : 'Copy assistant setup prompt'}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }

  function renderPromptsTab() {
    return (
      <div className="settings-tab-panel">
        <section className="section-intro">
          <div className="section-intro-copy">
            <span className="section-intro-eyebrow">Prompts</span>
            <div className="section-intro-title">Start from the smallest prompt that preserves the workflow</div>
            <p className="section-intro-text">These snippets are grouped for session start, save handoff, and correction. They are here to reduce repetition and keep the Vault workflow legible in real usage.</p>
          </div>
          <div className="section-intro-meta">
            <span className="section-intro-chip">recall templates</span>
            <span className="section-intro-chip">save templates</span>
            <span className="section-intro-chip">protocol reminders</span>
          </div>
        </section>

        <section className="panel settings-section">
          <div className="panel-header">
            <div>
              <div className="panel-title">Prompts</div>
              <div className="panel-subtitle">Reusable recall, save, and protocol prompts aligned with the Vault memory workflow.</div>
            </div>
            <ScrollText size={18} className="panel-icon" />
          </div>

          <div className="note-card">
            <p>These are operator-ready templates, not hidden system prompts. Use them as reusable starting points for Codex, Claude, or Vault desktop workflows.</p>
            <p>The normal rhythm is simple: recall before continuing prior work, save after a real outcome, and use the protocol reminder when a client starts drifting away from the Vault workflow.</p>
          </div>
        </section>

        <section className="panel settings-section">
          <div className="panel-header">
            <div>
              <div className="panel-title">Prompt workflow</div>
              <div className="panel-subtitle">Use the smallest prompt that fits the job.</div>
            </div>
            <ScrollText size={18} className="panel-icon" />
          </div>

          <div className="settings-card-grid">
            <WorkflowCard
              title="Continue prior work"
              description="Use the recall template before resuming implementation, debugging, or a partially finished UI flow."
              steps={[
                'Copy the Session-start recall prompt.',
                'Adjust the project, keywords, and query text to the current task.',
                'Run it before coding so the client starts with prior context instead of rediscovering it.',
              ]}
            />
            <WorkflowCard
              title="Save a meaningful outcome"
              description="Use the save template after a fix, decision, handoff, or reusable implementation result."
              steps={[
                'Copy the Implementation save prompt.',
                'Replace the title, summary, keywords, files, and next steps with the actual work you just completed.',
                'Save only higher-signal outcomes, not trivial edits.',
              ]}
            />
            <WorkflowCard
              title="Correct the workflow"
              description="Use the protocol reminder when a client stops recalling context, saving results, or naming memories clearly."
              steps={[
                'Copy the Protocol reminder snippet.',
                'Drop it into the active conversation or setup flow.',
                'Then continue with a proper recall or save call instead of repeating the whole explanation manually.',
              ]}
            />
          </div>
        </section>

        <section className="panel settings-section">
          <div className="panel-header">
            <div>
              <div className="panel-title">Prompt library</div>
              <div className="panel-subtitle">Copy a template, adjust it, then run it through the target client.</div>
            </div>
            <ScrollText size={18} className="panel-icon" />
          </div>

          <div className="settings-card-grid">
            {PROMPT_SNIPPETS.map((prompt) => (
              <div key={prompt.id} className="snippet-card">
                <div className="snippet-head">
                  <div>
                    <div className="field-label">{prompt.title}</div>
                    <div className="field-help">{prompt.description}</div>
                  </div>
                  <button type="button" className="header-button" onClick={() => void copyText(prompt.id, prompt.snippet)}>
                    <Copy size={16} />
                    <span>{copiedToken === prompt.id ? 'Copied' : 'Copy template'}</span>
                  </button>
                </div>
                <pre className="snippet-block">{prompt.snippet}</pre>
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }

  function renderActiveTab() {
    switch (activeTab) {
      case 'overview':
        return renderOverviewTab();
      case 'ai':
        return renderAiModelsTab();
      case 'memory':
        return renderMemoryTab();
      case 'extensions':
        return renderExtensionsTab();
      case 'connections':
        return renderConnectionsTab();
      case 'skills':
        return renderSkillsTab();
      case 'prompts':
        return renderPromptsTab();
      default:
        return renderOverviewTab();
    }
  }

  const activeTabMeta = SETTINGS_TABS.find((tab) => tab.id === activeTab) || SETTINGS_TABS[0];
  const activeTabIndex = SETTINGS_TABS.findIndex((tab) => tab.id === activeTab);
  const ActiveTabIcon = activeTabMeta.icon;
  const runtimeStatus = vaultStatus?.initialized ? 'Online' : loading ? 'Connecting' : 'Offline';
  const projectCount = vaultStatus?.projects.length || 0;
  const tabGroups = SETTINGS_TABS.reduce<Array<{ label: string; tabs: Array<(typeof SETTINGS_TABS)[number]> }>>((groups, tab) => {
    const existingGroup = groups.find((group) => group.label === tab.group);
    if (existingGroup) {
      existingGroup.tabs.push(tab);
      return groups;
    }

    groups.push({
      label: tab.group,
      tabs: [tab],
    });
    return groups;
  }, []);

  return (
    <div className="settings-layout settings-cockpit">
      <section className="settings-cockpit-header panel">
        <div className="settings-cockpit-copy">
          <span className="cockpit-kicker">Local configuration</span>
          <h2>Settings control surface</h2>
          <p>
            Configure local runtime behavior, client wiring, skill installs, prompt templates,
            and model routing without leaving the cockpit layout.
          </p>
        </div>

        <div className="settings-cockpit-metrics">
          <div className="settings-cockpit-metric">
            <span>Runtime</span>
            <strong>{runtimeStatus}</strong>
          </div>
          <div className="settings-cockpit-metric">
            <span>Projects</span>
            <strong>{projectCount}</strong>
          </div>
          <div className="settings-cockpit-metric">
            <span>Active tab</span>
            <strong>{activeTabMeta.label}</strong>
          </div>
        </div>
      </section>

      <div className="settings-shell">
        <aside className="settings-rail">
          <div className="panel settings-rail-card">
            <div>
              <span className="header-eyebrow">Settings workspace</span>
              <div className="panel-title">Local cockpit controls</div>
              <div className="panel-subtitle">Tabs are grouped by the actual Vault surfaces they configure.</div>
            </div>
            <div className="settings-rail-status-grid">
              <div className="settings-rail-status-row">
                <span>Mode</span>
                <strong>Dark local</strong>
              </div>
              <div className="settings-rail-status-row">
                <span>Vault root</span>
                <strong>{vaultStatus?.root ? 'Connected' : 'Unavailable'}</strong>
              </div>
              <div className="settings-rail-status-row">
                <span>Save scope</span>
                <strong>{activeTab === 'overview' ? 'Runtime' : 'Reference'}</strong>
              </div>
            </div>
          </div>

          <div className="settings-tab-strip panel">
            {tabGroups.map((group) => (
              <div key={group.label} className="settings-tab-group">
                <span className="settings-tab-group-label">{group.label}</span>
                <div className="settings-tab-group-items">
                  {group.tabs.map((tab) => (
                    (() => {
                      const TabIcon = tab.icon;
                      const tabIndex = SETTINGS_TABS.findIndex((item) => item.id === tab.id) + 1;

                      return (
                        <button
                          key={tab.id}
                          type="button"
                          className={`settings-tab-button ${activeTab === tab.id ? 'settings-tab-button-active' : ''}`}
                          onClick={() => setActiveTab(tab.id)}
                        >
                          <span className="settings-tab-icon">
                            <TabIcon size={16} />
                          </span>
                          <span className="settings-tab-copy">
                            <span className="settings-tab-label">{tab.label}</span>
                            <span className="settings-tab-description">{tab.description}</span>
                          </span>
                          <span className="settings-tab-index">{String(tabIndex).padStart(2, '0')}</span>
                        </button>
                      );
                    })()
                  ))}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <div className="settings-main">
          <section className="settings-active-panel panel">
            <span className="settings-active-icon">
              <ActiveTabIcon size={20} />
            </span>
            <div className="settings-active-copy">
              <span className="settings-active-eyebrow">Settings / {activeTabMeta.group} / {String(activeTabIndex + 1).padStart(2, '0')}</span>
              <strong>{activeTabMeta.label}</strong>
              <span>{activeTabMeta.description}</span>
            </div>
            <div className="settings-active-actions">
              {message ? <span className="success-text">{message}</span> : null}
              {error ? <span className="error-text">{error}</span> : null}
              {activeTab === 'overview' || activeTab === 'ai' || activeTab === 'memory' ? (
                <button type="button" className="primary-button" onClick={() => void saveSettings()} disabled={loading || saving}>
                  <Save size={16} />
                  <span>{saving ? 'Saving...' : 'Save settings'}</span>
                </button>
              ) : (
                <span className="settings-save-hint">No runtime save needed on this tab</span>
              )}
            </div>
          </section>

          {loading ? (
            <div className="panel empty-state">Loading settings...</div>
          ) : (
            renderActiveTab()
          )}
        </div>
      </div>
    </div>
  );
}

function clampNumber(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.floor(value)));
}

function getRouteConfig(table: ModelRoutingTable, taskType: VaultTaskType): ModelRouteConfig | undefined {
  return table.routes.find((route) => route.taskType === taskType);
}

function routingTablesEqual(left: ModelRoutingTable, right: ModelRoutingTable): boolean {
  return JSON.stringify(normalizeRoutingTable(left)) === JSON.stringify(normalizeRoutingTable(right));
}

function normalizeRoutingTable(table: ModelRoutingTable): ModelRoutingTable {
  return {
    defaultModelId: table.defaultModelId,
    routes: [...table.routes]
      .map((route) => ({
        ...route,
        fallbackModelId: route.fallbackModelId || undefined,
      }))
      .sort((left, right) => left.taskType.localeCompare(right.taskType)),
  };
}

function formatPerMillionPrice(rawValue: string): string {
  const numericValue = Number(rawValue);
  if (!Number.isFinite(numericValue)) {
    return rawValue;
  }

  const perMillion = numericValue * 1_000_000;
  if (perMillion >= 1) {
    return `$${perMillion.toFixed(perMillion >= 10 ? 2 : 3)}`;
  }

  if (perMillion >= 0.01) {
    return `$${perMillion.toFixed(3)}`;
  }

  return `$${perMillion.toPrecision(2)}`;
}
