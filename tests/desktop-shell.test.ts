import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('desktop shell navigation', () => {
  const appSource = readFileSync(join(process.cwd(), 'packages/desktop/src/App.tsx'), 'utf8');
  const agentSource = readFileSync(join(process.cwd(), 'packages/desktop/src/components/VaultAgentView.tsx'), 'utf8');
  const overviewSource = readFileSync(join(process.cwd(), 'packages/desktop/src/components/OverviewCockpitView.tsx'), 'utf8');
  const operationsSource = readFileSync(join(process.cwd(), 'packages/desktop/src/components/CockpitOperationsViews.tsx'), 'utf8');
  const settingsSource = readFileSync(join(process.cwd(), 'packages/desktop/src/components/SettingsView.tsx'), 'utf8');

  it('removes Recall Console from the primary desktop shell', () => {
    expect(appSource).not.toContain('Recall Console');
    expect(appSource).not.toContain('ChatView');
  });

  it('presents local client orchestration as Local Agents instead of Workbench', () => {
    expect(agentSource).toContain('Local Agents');
    expect(agentSource).not.toContain('page-mode-label">Workbench');
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

  it('presents Settings as a cockpit-aligned tab workspace', () => {
    expect(settingsSource).toContain('settings-cockpit-header');
    expect(settingsSource).toContain('settings-rail-status-grid');
    expect(settingsSource).toContain('settings-active-panel');
    expect(settingsSource).toContain('settings-tab-icon');
    expect(settingsSource).toContain('settings-tab-index');
  });

  it('keeps the Overview project radar grounded in direct project counters', () => {
    expect(overviewSource).toContain('cockpit-project-signal-board');
    expect(overviewSource).not.toContain('<RadarChart');
    expect(overviewSource).not.toContain('qualityScore');
    expect(overviewSource).not.toContain('taskPressureScore');
  });
});
