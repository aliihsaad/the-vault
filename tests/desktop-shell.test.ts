import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('desktop shell navigation', () => {
  const appSource = readFileSync(join(process.cwd(), 'packages/desktop/src/App.tsx'), 'utf8');
  const agentSource = readFileSync(join(process.cwd(), 'packages/desktop/src/components/VaultAgentView.tsx'), 'utf8');
  const overviewSource = readFileSync(join(process.cwd(), 'packages/desktop/src/components/OverviewCockpitView.tsx'), 'utf8');
  const operationsSource = readFileSync(join(process.cwd(), 'packages/desktop/src/components/CockpitOperationsViews.tsx'), 'utf8');
  const settingsSource = readFileSync(join(process.cwd(), 'packages/desktop/src/components/SettingsView.tsx'), 'utf8');
  const collabSource = readFileSync(join(process.cwd(), 'packages/desktop/src/components/VaultCollabView.tsx'), 'utf8');
  const collabConversationSource = readFileSync(join(process.cwd(), 'packages/desktop/src/components/vault-collab/ConversationStream.tsx'), 'utf8');
  const collabHandoffDetailSource = readFileSync(join(process.cwd(), 'packages/desktop/src/components/vault-collab/HandoffDetail.tsx'), 'utf8');
  const collabHandoffDetailModalSource = readFileSync(join(process.cwd(), 'packages/desktop/src/components/vault-collab/HandoffDetailModal.tsx'), 'utf8');
  const collabNeedsYouSource = readFileSync(join(process.cwd(), 'packages/desktop/src/components/vault-collab/NeedsYou.tsx'), 'utf8');
  const collabRoleProfileModalSource = readFileSync(join(process.cwd(), 'packages/desktop/src/components/vault-collab/RoleProfileModal.tsx'), 'utf8');
  const collabRosterSource = readFileSync(join(process.cwd(), 'packages/desktop/src/components/vault-collab/Roster.tsx'), 'utf8');
  const collabWorkBoardSource = readFileSync(join(process.cwd(), 'packages/desktop/src/components/vault-collab/WorkBoard.tsx'), 'utf8');
  const collabViewModelSource = readFileSync(join(process.cwd(), 'packages/desktop/src/vault-collab-view-model.ts'), 'utf8');
  const coreVaultCollabTypesSource = readFileSync(join(process.cwd(), 'packages/core/src/types/vault-collab.ts'), 'utf8');
  const collabComponentSurface = [
    collabSource,
    collabConversationSource,
    collabHandoffDetailSource,
    collabHandoffDetailModalSource,
    collabNeedsYouSource,
    collabRoleProfileModalSource,
    collabRosterSource,
    collabWorkBoardSource,
  ].join('\n');
  const connectPanelSource = readFileSync(join(process.cwd(), 'packages/desktop/src/components/ConnectPanel.tsx'), 'utf8');
  const electronMainSource = readFileSync(join(process.cwd(), 'packages/desktop/electron/main.ts'), 'utf8');
  const electronPreloadSource = readFileSync(join(process.cwd(), 'packages/desktop/electron/preload.ts'), 'utf8');
  const desktopTypesSource = readFileSync(join(process.cwd(), 'packages/desktop/src/types.d.ts'), 'utf8');
  const codexSkillSource = readFileSync(join(process.cwd(), 'skills/codex-vault-skill.md'), 'utf8');
  const claudeSkillSource = readFileSync(join(process.cwd(), 'skills/claude-vault-skill.md'), 'utf8');

  it('removes Recall Console from the primary desktop shell', () => {
    expect(appSource).not.toContain('Recall Console');
    expect(appSource).not.toContain('ChatView');
  });

  it('removes Vault-owned local CLI agent orchestration from the desktop shell', () => {
    expect(agentSource).not.toContain('Local Agents');
    expect(agentSource).not.toContain('local workbench');
    expect(agentSource).not.toContain('Local CLI');
    expect(settingsSource).not.toContain('Local chat');
    expect(settingsSource).not.toContain('Local backend');
    expect(overviewSource).not.toContain('local agent');
  });

  it('keeps MCP setup as the Codex and Claude integration path', () => {
    expect(settingsSource).toContain('ConnectPanel');
    expect(connectPanelSource).toContain('connectCodex');
    expect(connectPanelSource).toContain('connectClaudeDesktop');
    expect(connectPanelSource).toContain('connectClaudeCode');
    expect(connectPanelSource).toContain('MCP means the external client stays the model');
  });

  it('keys activity bar charts by unique date instead of duplicated weekday labels', () => {
    expect(overviewSource).toContain('<XAxis dataKey="key"');
    expect(operationsSource).toContain('<XAxis dataKey="key"');
  });

  it('derives overview recall telemetry from the same recall-only window as the Recall page', () => {
    expect(overviewSource).toContain('const [recallLogs, setRecallLogs]');
    expect(overviewSource).toContain("window.vaultAPI.getRecentLogs(RECALL_ANALYTICS_LOG_LIMIT, { actionType: 'recall', dateFrom: getRecallAnalyticsDateFrom() })");
    expect(overviewSource).toContain('buildRecallTrend(recallLogs, 14');
    expect(overviewSource).not.toContain('buildRecallTrend(logs, 7');
    expect(overviewSource).not.toContain('over 7 days');
  });

  it('frames the Recall page as an efficiency dashboard instead of an Activity duplicate', () => {
    expect(operationsSource).toContain('Estimated tokens saved');
    expect(operationsSource).toContain('Compact recall log');
    expect(operationsSource).toContain('Activity keeps full event detail');
    expect(operationsSource).toContain('recall-cta-grid');
    expect(operationsSource).toContain("window.vaultAPI.getRecentLogs(RECALL_ANALYTICS_LOG_LIMIT, { actionType: 'recall', dateFrom: getRecallAnalyticsDateFrom() })");
    expect(operationsSource).not.toContain("window.vaultAPI.getRecentLogs(420, { actionType: 'recall' })");
  });

  it('gives Handoffs and Decisions type-aware cockpit surfaces', () => {
    expect(operationsSource).toContain('workspace-cta-grid');
    expect(operationsSource).toContain('Transfer notes');
    expect(operationsSource).toContain('Handoff readiness');
    expect(operationsSource).toContain('Promoted constraints');
    expect(operationsSource).toContain('Decision quality');
  });

  it('keeps Agent focused on runtime and delegated task execution', () => {
    expect(agentSource).toContain('agent-runtime-dashboard');
    expect(agentSource).toContain('Agent Runtime');
    expect(agentSource).toContain("type AgentRuntimeTab = 'queue' | 'tasks' | 'runtime' | 'events'");
    expect(agentSource).toContain('agent-runtime-tabs');
    expect(agentSource).toContain('setActiveAgentTab');
    expect(agentSource).toContain('Runtime controls');
    expect(agentSource).toContain('Queue composer');
    expect(agentSource).toContain('Task detail');
    expect(agentSource).toContain('Executor events');
    expect(agentSource).not.toContain('agent-runtime-grid');
    expect(agentSource).not.toContain('page-mode-label">Vault activity');
    expect(agentSource).not.toContain("activeSection === 'activity'");
  });

  it('presents Settings as a cockpit-aligned tab workspace', () => {
    expect(settingsSource).toContain('settings-cockpit-header');
    expect(settingsSource).toContain('settings-rail-status-grid');
    expect(settingsSource).toContain('settings-active-panel');
    expect(settingsSource).toContain('settings-tab-icon');
    expect(settingsSource).toContain('settings-tab-index');
  });

  it('keeps internal implementation phase labels out of Settings UI copy', () => {
    expect(settingsSource).not.toMatch(/Phase\s+\d+/);
  });

  it('detects Graphify through the configured runtime command instead of PATH only', () => {
    const handlerStart = electronMainSource.indexOf("ipcMain.handle('vault:detectGraphifyRuntime'");
    const handlerEnd = electronMainSource.indexOf("ipcMain.handle('vault:planGraphifyInstall'", handlerStart);
    const handlerSource = electronMainSource.slice(handlerStart, handlerEnd);

    expect(handlerSource).toContain('vault.getGraphifyRuntimeConfig()');
    expect(handlerSource).toContain('resolveGraphifyCommandForRuntimeConfig(config)');
    expect(handlerSource).toContain('graphifyCommand:');
  });

  it('exposes Vault Collab extension install and detect wiring through Settings', () => {
    expect(electronMainSource).toContain("ipcMain.handle('vault:getVaultCollabRuntimeConfig'");
    expect(electronMainSource).toContain("ipcMain.handle('vault:resetVaultCollabRuntimeConfig'");
    expect(electronMainSource).toContain("ipcMain.handle('vault:detectVaultCollabRuntime'");
    expect(electronMainSource).toContain("ipcMain.handle('vault:planVaultCollabInstall'");
    expect(electronMainSource).toContain("ipcMain.handle('vault:detectVaultCollabSourcePath'");
    expect(electronMainSource).toContain("ipcMain.handle('vault:useDetectedVaultCollabSourcePath'");
    expect(electronMainSource).toContain("ipcMain.handle('vault:chooseVaultCollabSourcePath'");
    expect(electronPreloadSource).toContain('getVaultCollabRuntimeConfig');
    expect(electronPreloadSource).toContain('resetVaultCollabRuntimeConfig');
    expect(electronPreloadSource).toContain('useDetectedVaultCollabSourcePath');
    expect(electronPreloadSource).toContain('chooseVaultCollabSourcePath');
    expect(desktopTypesSource).toContain('VaultCollabRuntimeConfig');
    expect(settingsSource).toContain('Vault Collab');
    expect(settingsSource).toContain('https://github.com/aliihsaad/vault-collab');
    expect(settingsSource).not.toContain("import { VAULT_COLLAB_REPOSITORY_URL } from '@the-vault/core'");
    expect(settingsSource).toContain('npm exec health check');
    expect(settingsSource).toContain('GitHub managed install');
    expect(settingsSource).toContain('vaultCollabStatusBadge');
    expect(settingsSource).toContain('Use GitHub install');
    expect(settingsSource).toContain('Install preview');
    expect(settingsSource).toContain('Use local repo');
    expect(settingsSource).toContain('Choose local source');
    expect(settingsSource).toContain('vault-collab-install-plan');
  });

  it('wires the Vault Collab cockpit into a separate workspace tab', () => {
    expect(electronMainSource).toContain("ipcMain.handle('vault:getVaultCollabDashboardSnapshot'");
    expect(electronPreloadSource).toContain('getVaultCollabDashboardSnapshot');
    expect(desktopTypesSource).toContain('VaultCollabDashboardSnapshot');
    expect(desktopTypesSource).toContain('getVaultCollabDashboardSnapshot');
    expect(appSource).toContain("import { VaultCollabView }");
    expect(appSource).toContain("| 'collab'");
    expect(appSource).toContain('const EXTENSION_NAV');
    expect(appSource).toContain("label: 'Extensions'");
    expect(appSource).toContain("id: 'graph', label: 'Graphify'");
    expect(appSource).toContain("id: 'collab', label: 'Vault Collab'");
    expect(appSource).toContain("title: 'Vault Collab'");
    expect(appSource).toContain("activeTab === 'collab' ? <VaultCollabView vaultStatus={vaultStatus} />");
    expect(collabSource).toContain('window.vaultAPI.getVaultCollabDashboardSnapshot');
    expect(collabComponentSurface).toContain('Agents');
    expect(collabComponentSurface).toContain('Work');
    expect(collabComponentSurface).toContain('Conversation');
    expect(collabWorkBoardSource).toContain('card.title');
    expect(collabWorkBoardSource).toContain('card.promptPreview');
    expect(collabWorkBoardSource).toContain('RESOLVED_CARD_COLLAPSED_LIMIT = 3');
    expect(collabWorkBoardSource).toContain("column.state === 'resolved'");
    expect(collabWorkBoardSource).toContain('Show more');
    expect(collabWorkBoardSource).toContain('HandoffDetailModal');
    expect(collabWorkBoardSource).toContain('onCloseHandoff');
    expect(collabHandoffDetailModalSource).toContain('role="dialog"');
    expect(collabHandoffDetailModalSource).toContain('aria-modal="true"');
    expect(collabHandoffDetailModalSource).toContain("event.key === 'Escape'");
    expect(collabHandoffDetailModalSource).toContain('vault-collab-handoff-modal-backdrop');
    expect(collabWorkBoardSource).not.toContain('aria-label="Selected handoff"');
    expect(collabWorkBoardSource).not.toContain('vault-collab-selected-handoff');
    expect(collabWorkBoardSource).not.toContain('<strong>{card.prompt}</strong>');
    expect(collabSource).toContain('vault-collab-ops-bar');
    expect(collabSource).toContain('openHandoffDetail');
    expect(collabSource).toContain('closeHandoffDetail');
    expect(collabSource).toContain('handoffDetailOpen');
    expect(collabSource).toContain('const activeHandoffUid = handoffDetailOpen ? selectedHandoffUid : null');
    expect(collabSource).toContain('setHandoffDetailOpen(true)');
    expect(collabSource).toContain('setHandoffDetailOpen(false)');
    expect(collabSource).toContain('selectedHandoff={handoffDetailOpen ? model.cockpit.selectedHandoff : null}');
    expect(collabSource).toContain('roleProfileDetailOpen');
    expect(collabSource).toContain('const activeRoleProfileId = roleProfileDetailOpen ? selectedRoleProfileId : null');
    expect(collabSource).toContain('setRoleProfileDetailOpen(true)');
    expect(collabSource).toContain('setRoleProfileDetailOpen(false)');
    expect(collabSource).toContain('selectedRoleProfile={roleProfileDetailOpen ? model.cockpit.selectedRoleProfile : null}');
    expect(collabRosterSource).toContain('RoleProfileModal');
    expect(collabRosterSource).toContain('onCloseRoleProfile');
    expect(collabRosterSource).not.toContain('vault-collab-role-profile-panel');
    expect(collabRoleProfileModalSource).toContain('role="dialog"');
    expect(collabRoleProfileModalSource).toContain('aria-modal="true"');
    expect(collabRoleProfileModalSource).toContain("event.key === 'Escape'");
    expect(collabRoleProfileModalSource).toContain('vault-collab-role-profile-modal-backdrop');
    expect(collabSource).not.toContain('Session mesh');
    expect(collabSource).not.toContain('vault-collab-live-map');
    expect(collabSource).not.toContain('vault-collab-hero');
    expect(collabSource).not.toContain("from '@the-vault/core'");
    expect(agentSource).not.toContain('Vault Collab');
    expect(agentSource).not.toContain('getVaultCollabDashboardSnapshot');
  });

  it('renders Vault Collab v2 agent, queue, dependency, and discussion fields', () => {
    const collabModelSurface = `${collabComponentSurface}\n${collabViewModelSource}`;

    expect(collabModelSurface).toContain('agentDisplayName');
    expect(collabModelSurface).toContain('agentName');
    expect(collabModelSurface).toContain('agentRole');
    expect(collabModelSurface).toContain('queueKey');
    expect(collabModelSurface).toContain('queuePosition');
    expect(collabModelSurface).toContain('dependsOnHandoffUid');
    expect(collabModelSurface).toContain('labels');
    expect(collabModelSurface).toContain('discussionThreads');
    expect(collabComponentSurface).toContain('Threads');
    expect(collabSource).toContain('buildVaultCollabDashboardViewModel');
    expect(collabSource).not.toContain('Manual orchestration only');
    expect(collabSource).not.toContain('sessionToken');
    expect(collabSource).not.toContain('claimHandoff');
    expect(collabSource).not.toContain('resolveHandoff');
    expect(collabSource).not.toContain('releaseHandoff');
  });

  it('renders Vault Collab launch requests in the Needs You cockpit lane', () => {
    const appCssSource = readFileSync(join(process.cwd(), 'packages/desktop/src/app.css'), 'utf8');
    const collabModelSurface = `${collabComponentSurface}\n${collabViewModelSource}`;

    expect(collabComponentSurface).toContain('launchRequests');
    expect(collabSource).toContain('model.launchRequestRows');
    expect(collabNeedsYouSource).toContain('vault-collab-approved-command');
    expect(collabNeedsYouSource).toContain('onLaunchAction');
    expect(collabModelSurface).toContain('launchRequests');
    expect(collabModelSurface).toContain('activeLaunchRequests');
    expect(collabViewModelSource).toContain('launch_request.');
    expect(collabViewModelSource).toContain("label: 'Launch'");
    expect(electronMainSource).toContain('openExternalVaultCollabTerminal');
    expect(electronMainSource).toContain('getWindowsCommandShellPath');
    expect(electronMainSource).toContain("'start'");
    expect(electronMainSource).toContain('PowerShell launch window opened');
    expect(electronMainSource).toContain("action: 'mark_launching'");
    expect(electronMainSource).toContain('externalTerminalLaunched');
    expect(appCssSource).toContain('vault-collab-command-preview');
    expect(collabSource).not.toContain('approveLaunchRequest');
    expect(collabSource).not.toContain('rejectLaunchRequest');
    expect(collabSource).not.toContain('cancelLaunchRequest');
    expect(collabSource).not.toContain('markLaunchRequestRunning');
  });

  it('wires Vault Collab dashboard Request agent through preload, main, and cockpit UI', () => {
    const requestAgentSurface = `${collabSource}\n${collabNeedsYouSource}`;
    const requestAgentInputType = sourceBlock(
      coreVaultCollabTypesSource,
      'export interface VaultCollabAgentRequestInput',
      'export type VaultCollabDashboardActionInput',
    );

    expect(electronMainSource).toContain("ipcMain.handle('vault:requestVaultCollabAgent'");
    expect(electronPreloadSource).toContain('requestVaultCollabAgent');
    expect(desktopTypesSource).toContain('VaultCollabAgentRequestInput');
    expect(desktopTypesSource).toContain('requestVaultCollabAgent');
    expect(requestAgentInputType).toContain('project: string');
    expect(requestAgentInputType).toContain('workspacePath: string');
    expect(requestAgentSurface).toContain('Request agent');
    expect(requestAgentSurface).toContain('Project');
    expect(requestAgentSurface).toContain('Workspace');
    expect(requestAgentSurface).toContain("provider: 'codex'");
    expect(requestAgentSurface).toContain("provider: 'claude-code'");
    expect(requestAgentSurface).toContain('onRequestAgent');
    expect(requestAgentSurface).toContain('defaultProject');
    expect(requestAgentSurface).toContain('defaultWorkspacePath');
    expect(requestAgentSurface).toContain('project: trimmedProject');
    expect(requestAgentSurface).toContain('workspacePath: trimmedWorkspacePath');
    expect(requestAgentSurface).toContain('requestAgentRoleOptions');
    expect(requestAgentSurface).toContain('roleOptions={requestAgentRoleOptions}');
    expect(requestAgentSurface).toContain('roleOptions.map');
    expect(requestAgentSurface).toContain('<option value="" disabled>Choose office</option>');
    expect(requestAgentSurface).toContain('<option key={option.role} value={option.role}>{option.label}</option>');
    expect(requestAgentSurface).not.toContain("useState('implementation-worker')");
    expect(requestAgentSurface).toContain('projectSelectOptions.map');
    expect(requestAgentSurface).toContain('<option value="" disabled>Choose project</option>');
    expect(requestAgentSurface).toContain('<option key={option.project} value={option.project}>{option.project}</option>');
    expect(requestAgentSurface).not.toContain('datalist id="vault-collab-request-agent-projects"');
    expect(requestAgentSurface).not.toContain('list="vault-collab-request-agent-projects"');
    expect(requestAgentSurface).toContain('agentInstructions');
    expect(requestAgentSurface).toContain('requestFormOpen');
    expect(requestAgentSurface).toContain('RequestAgentModal');
    expect(requestAgentSurface).toContain('role="dialog"');
    expect(requestAgentSurface).toContain('aria-modal="true"');
    expect(requestAgentSurface).toContain("event.key === 'Escape'");
    expect(requestAgentSurface).toContain('vault-collab-request-agent-modal-backdrop');
    expect(requestAgentSurface).toContain('vault-collab-request-agent-form');
    expect(requestAgentSurface).not.toContain('vault-collab-need-row vault-collab-request-agent-form');
    expect(requestAgentSurface).toContain('Cancel');
  });

  it('uses explicit project and workspace values for Vault Collab Request agent IPC', () => {
    const requestAgentParserSource = sourceBlock(
      electronMainSource,
      'function parseVaultCollabAgentRequestInput',
      'function getVaultCollabAgentRequestModel',
    );
    const requestAgentHandlerSource = sourceBlock(
      electronMainSource,
      "ipcMain.handle('vault:requestVaultCollabAgent'",
      "ipcMain.handle('vault:approveVaultCollabLaunchRequest'",
    );

    expect(requestAgentParserSource).toContain('raw.project');
    expect(requestAgentParserSource).toContain('raw.workspacePath');
    expect(requestAgentParserSource).toContain('Agent project is required.');
    expect(requestAgentParserSource).toContain('Agent workspace path is required.');
    expect(requestAgentParserSource).toContain('return { role, provider, instructions, project, workspacePath }');
    expect(requestAgentHandlerSource).toContain('project: request.project');
    expect(requestAgentHandlerSource).toContain('workspacePath: request.workspacePath');
    expect(requestAgentHandlerSource).toContain('getVaultCollabAgentRequestCommandPreview(request.provider, request.workspacePath)');
    expect(electronMainSource).toContain('claude --add-dir "${workspacePath}" -- "[launch instructions]"');
    expect(requestAgentHandlerSource).not.toContain("project: 'the-vault'");
    expect(requestAgentHandlerSource).not.toContain("const workspacePath = resolve(__dirname, '../../..')");
  });

  it('renders Vault Collab permission-needed and attention indicators as read-only UI', () => {
    expect(collabViewModelSource).toContain('permissionNeeded');
    expect(collabViewModelSource).toContain('permissionRequestEvents');
    expect(collabViewModelSource).toContain('attentionPingEvents');
    expect(collabViewModelSource).toContain('need attention');
    expect(collabViewModelSource).toContain('session.permission_requested');
    expect(collabViewModelSource).toContain('handoff.permission_requested');
    expect(collabViewModelSource).toContain('session.pinged');
    expect(collabViewModelSource).toContain('permissionRequest');
    expect(collabComponentSurface).toContain('Needs You');
    expect(collabComponentSurface).toContain('vault-collab-permission-note');
    expect(collabSource).not.toContain('requestSessionPermission');
    expect(collabSource).not.toContain('requestHandoffPermission');
    expect(collabSource).not.toContain('pingSession');
  });

  it('renders Vault Collab cockpit sections behind tabs with normal page flow', () => {
    const appCssSource = readFileSync(join(process.cwd(), 'packages/desktop/src/app.css'), 'utf8');

    expect(collabSource).toContain('vault-collab-cockpit-shell');
    expect(collabSource).toContain('role="tablist"');
    expect(collabSource).toContain('role="tabpanel"');
    expect(collabSource).toContain('activeCockpitTab');
    expect(appCssSource).not.toContain('height: min(780px, calc(100vh - 238px))');
    expect(appCssSource).not.toContain('height: calc(100vh - 112px)');
    expect(appCssSource).toContain('.vault-collab-cockpit-tabs');
    expect(appCssSource).toContain('overflow-x: auto');
    expect(appCssSource).toContain('overflow: visible');
    expect(appCssSource).toContain('overflow-wrap: anywhere');
  });

  it('respects reduced motion for Vault Collab attention animation', () => {
    const appCssSource = readFileSync(join(process.cwd(), 'packages/desktop/src/app.css'), 'utf8');

    expect(appCssSource).toContain('vault-collab-attention-card');
    expect(appCssSource).toContain('vault-collab-attention-row');
    expect(appCssSource).toContain('vault-collab-permission-note');
    expect(appCssSource).toContain('@keyframes vault-collab-attention-pulse');
    expect(appCssSource).toContain('@media (prefers-reduced-motion: reduce)');
    expect(appCssSource).toContain('.vault-collab-attention-card');
  });

  it('teaches Codex and Claude to bootstrap their own brain projects', () => {
    expect(codexSkillSource).toContain('Codex-brain');
    expect(codexSkillSource).toContain('vault_list_projects');
    expect(codexSkillSource).toContain('bootstrap brain memory');
    expect(codexSkillSource).toContain('Do not save ordinary project implementation details to Codex-brain');

    expect(claudeSkillSource).toContain('claude-code-brain');
    expect(claudeSkillSource).toContain('claude-desktop-brain');
    expect(claudeSkillSource).toContain('vault_list_projects');
    expect(claudeSkillSource).toContain('bootstrap brain memory');
    expect(claudeSkillSource).toContain('Do not save ordinary project implementation details to a brain project');
  });

  it('documents Vault Collab MCP as the live session handoff layer in skills and setup UI', () => {
    for (const source of [codexSkillSource, claudeSkillSource, connectPanelSource, settingsSource]) {
      expect(source).toContain('Vault Collab MCP');
      expect(source).toContain('vault_collab_register_session');
      expect(source).toContain('vault_collab_list_inbox');
      expect(source).toContain('vault_collab_claim_handoff');
    }

    expect(codexSkillSource).toContain('Never auto-claim while actively working');
    expect(claudeSkillSource).toContain('Never auto-claim while actively working');
    expect(codexSkillSource).toContain('ask one short opt-in question');
    expect(claudeSkillSource).toContain('ask one short opt-in question');
    expect(codexSkillSource).toContain('Use Vault Collab for this session?');
    expect(claudeSkillSource).toContain('Use Vault Collab for this session?');
    expect(codexSkillSource).toContain('use vault collab');
    expect(codexSkillSource).toContain('current Codex builds reject unknown unprefixed slash commands');
    expect(claudeSkillSource).toContain('/vault-collab');
    expect(settingsSource).toContain('/vault-collab');
    expect(connectPanelSource).toContain('Connect Vault Collab MCP');
    expect(connectPanelSource).toContain('Codex uses prompt shortcut');
    expect(settingsSource).toContain('brain bootstrap');
    expect(settingsSource).toContain('Codex-brain');
    expect(settingsSource).toContain('claude-code-brain');
    expect(settingsSource).toContain('claude-desktop-brain');
  });

  it('offers one-click Vault Collab MCP wiring and /vault-collab command installation', () => {
    expect(electronMainSource).toContain("ipcMain.handle('vault:connectVaultCollabClients'");
    expect(electronMainSource).toContain("ipcMain.handle('vault:disconnectVaultCollabClients'");
    expect(electronMainSource).toContain('resolveVaultCollabMcpServerPath');
    expect(electronMainSource).toContain('vault-collab-mcp');
    expect(electronMainSource).toContain('vault-collab.md');
    expect(electronMainSource).toContain('buildVaultCollabCommandContent');
    expect(electronMainSource).toContain('connectVaultCollabClients');
    expect(electronMainSource).toContain('disconnectVaultCollabClients');
    expect(electronPreloadSource).toContain('connectVaultCollabClients');
    expect(electronPreloadSource).toContain('disconnectVaultCollabClients');
    expect(desktopTypesSource).toContain('vaultCollab:');
    expect(desktopTypesSource).toContain('connectVaultCollabClients');
    expect(desktopTypesSource).toContain('disconnectVaultCollabClients');
    expect(connectPanelSource).toContain('Connect Vault Collab MCP');
    expect(connectPanelSource).toContain('/vault-collab');
    expect(connectPanelSource).toContain('use vault collab');
    expect(connectPanelSource).toContain('Codex uses prompt shortcut');
    expect(connectPanelSource).toContain('connectVaultCollabClients');
    expect(connectPanelSource).toContain('disconnectVaultCollabClients');
  });

  it('hides the Graphify install preview after the runtime is installed', () => {
    const installPreviewIndex = settingsSource.indexOf('<div className="field-label">Install preview</div>');
    const guardStart = settingsSource.lastIndexOf("graphifyModel.state !== 'installed'", installPreviewIndex);

    expect(installPreviewIndex).toBeGreaterThan(0);
    expect(guardStart).toBeGreaterThan(0);
  });

  it('does not ask the OS to open a missing Graphify artifact folder', () => {
    const handlerStart = electronMainSource.indexOf("ipcMain.handle('vault:openGraphifyArtifactFolder'");
    const handlerEnd = electronMainSource.indexOf("ipcMain.handle('vault:exportGraphifyArtifacts'", handlerStart);
    const handlerSource = electronMainSource.slice(handlerStart, handlerEnd);

    expect(handlerSource).toContain('existsSync(folder)');
    expect(handlerSource.indexOf('existsSync(folder)')).toBeLessThan(handlerSource.indexOf('shell.openPath(folder)'));
  });

  it('offers a real folder picker for Graphify projects without a source root', () => {
    expect(electronMainSource).toContain("ipcMain.handle('vault:chooseGraphifyProjectSourceRoot'");
    expect(electronMainSource).toContain("properties: ['openDirectory']");
    expect(electronPreloadSource).toContain('chooseGraphifyProjectSourceRoot');
    expect(desktopTypesSource).toContain('chooseGraphifyProjectSourceRoot');
    expect(operationsSource).toContain('chooseGraphifyProjectSourceRoot');
    expect(operationsSource).toContain('Choose folder');
  });

  it('lets users change a saved Graphify source folder after initial selection', () => {
    expect(operationsSource).toContain('Change source folder');
    expect(operationsSource).toContain('graphifyModel.actions.changeSourceRoot.enabled');
    expect(operationsSource).toContain('Change folder');
    expect(operationsSource).toContain('graphify-source-actions');
    expect(operationsSource).not.toContain('graphify-disable-row');
  });

  it('lets the Graphify graph use the full workspace instead of a constrained panel', () => {
    expect(appSource).toContain("content-scroll ${activeTab === 'graph' ? 'content-scroll-graph' : ''}");
    expect(appSource).toContain("content-surface ${activeTab === 'graph' ? 'content-surface-graph' : ''}");
    expect(operationsSource).toContain('<div className="ops-layout graphify-workspace">');
    expect(operationsSource).toContain('<section className="graphify-dashboard">');
    expect(operationsSource).not.toContain('<section className="panel graphify-dashboard">');
  });

  it('uses a large enough Graphify report budget for report-only builds', () => {
    expect(operationsSource).toContain("window.vaultAPI.readGraphifyArtifactReport(project, { maxBytes: 256 * 1024 })");
    expect(operationsSource).toContain('graphifyModel.preferredTab');
  });

  it('keeps the Overview project radar grounded in direct project counters', () => {
    expect(overviewSource).toContain('cockpit-project-signal-board');
    expect(overviewSource).not.toContain('<RadarChart');
    expect(overviewSource).not.toContain('qualityScore');
    expect(overviewSource).not.toContain('taskPressureScore');
  });
});

function sourceBlock(source: string, startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(endNeedle, start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}
