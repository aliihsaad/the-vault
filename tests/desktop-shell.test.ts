import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('desktop shell navigation', () => {
  const appSource = readFileSync(join(process.cwd(), 'packages/desktop/src/App.tsx'), 'utf8');
  const agentSource = readFileSync(join(process.cwd(), 'packages/desktop/src/components/VaultAgentView.tsx'), 'utf8');
  const overviewSource = readFileSync(join(process.cwd(), 'packages/desktop/src/components/OverviewCockpitView.tsx'), 'utf8');
  const operationsSource = readFileSync(join(process.cwd(), 'packages/desktop/src/components/CockpitOperationsViews.tsx'), 'utf8');
  const settingsSource = readFileSync(join(process.cwd(), 'packages/desktop/src/components/SettingsView.tsx'), 'utf8');
  const connectPanelSource = readFileSync(join(process.cwd(), 'packages/desktop/src/components/ConnectPanel.tsx'), 'utf8');
  const electronMainSource = readFileSync(join(process.cwd(), 'packages/desktop/electron/main.ts'), 'utf8');
  const electronPreloadSource = readFileSync(join(process.cwd(), 'packages/desktop/electron/preload.ts'), 'utf8');
  const desktopTypesSource = readFileSync(join(process.cwd(), 'packages/desktop/src/types.d.ts'), 'utf8');

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
    expect(overviewSource).toContain("window.vaultAPI.getRecentLogs(420, { actionType: 'recall' })");
    expect(overviewSource).toContain('buildRecallTrend(recallLogs, 14');
    expect(overviewSource).not.toContain('buildRecallTrend(logs, 7');
    expect(overviewSource).not.toContain('over 7 days');
  });

  it('frames the Recall page as an efficiency dashboard instead of an Activity duplicate', () => {
    expect(operationsSource).toContain('Estimated tokens saved');
    expect(operationsSource).toContain('Compact recall log');
    expect(operationsSource).toContain('Activity keeps full event detail');
    expect(operationsSource).toContain('recall-cta-grid');
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
