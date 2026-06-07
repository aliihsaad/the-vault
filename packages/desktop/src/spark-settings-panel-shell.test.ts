import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function readSource(relativeUrl: string): string {
  return readFileSync(new URL(relativeUrl, import.meta.url), 'utf8');
}

describe('Spark settings panel shell', () => {
  it('wires SparkSettingsPanel into Settings > Extensions', () => {
    const settingsSource = readSource('./components/SettingsView.tsx');

    expect(settingsSource).toContain("import { SparkSettingsPanel } from './SparkSettingsPanel.js'");
    expect(settingsSource).toContain('<SparkSettingsPanel copyText={copyText} copiedToken={copiedToken} />');
    expect(settingsSource).toContain('Detect Graphify, Vault Collab, and Spark');
  });

  it('uses accessible local tabs with keyboard handling and all Wave 8 tab wiring', () => {
    const panelSource = readSource('./components/SparkSettingsPanel.tsx');

    expect(panelSource).toContain('role="tablist"');
    expect(panelSource).toContain('role="tab"');
    expect(panelSource).toContain('aria-selected=');
    expect(panelSource).toContain('aria-controls=');
    expect(panelSource).toContain('role="tabpanel"');
    expect(panelSource).toContain('aria-labelledby=');
    expect(panelSource).toContain('onKeyDown=');
    expect(panelSource).toContain('getNextSparkSettingsTabId');
    expect(panelSource).toContain('<OverviewTab');
    expect(panelSource).toContain('<ProvidersTab');
    expect(panelSource).toContain('<SkillsTab');
    expect(panelSource).toContain('<ApprovalsTab');
    expect(panelSource).toContain('<PacksTab');
    expect(panelSource).toContain('<BrainTab');
    expect(panelSource).toContain('<EvolutionTab');
    expect(panelSource).toContain('onConfigureProvider');
    expect(panelSource).toContain('onToggleSkill');
    expect(panelSource).toContain('onApproveSkill');
    expect(panelSource).toContain('onRejectSkill');
    expect(panelSource).toContain('onInstallPack');
    expect(panelSource).toContain('onUninstallPack');
    expect(panelSource).toContain('onApproveSuggestion');
    expect(panelSource).toContain('onRejectSuggestion');
  });

  it('renders the Spark Brain install command preview with the shared snippet pattern', () => {
    const panelSource = readSource('./components/SparkSettingsPanel.tsx');

    expect(panelSource).toContain('Install preview');
    expect(panelSource).toContain("copyText('spark-install-plan', status.installCommands.join('\\n'))");
    expect(panelSource).toContain('status.installCommands.join');
    expect(panelSource).toContain('snippet-block');
  });

  it('keeps the hook on the dedicated window.sparkApi snapshot bridge', () => {
    const viewModelSource = readSource('./spark-settings-view-model.ts');

    expect(viewModelSource).toContain('useSparkSettingsViewModel');
    expect(viewModelSource).toContain('window.sparkApi');
    expect(viewModelSource).toContain('getSnapshot');
    expect(viewModelSource).toContain('loading');
    expect(viewModelSource).toContain('error');
  });

  it('keeps Spark renderer view-model imports type-only against core', () => {
    const viewModelSource = readSource('./spark-settings-view-model.ts');

    expect(viewModelSource).toContain("import type {");
    expect(viewModelSource).not.toContain("import {\n  SPARK_BRAIN_ARTIFACT_NAMES");
    expect(viewModelSource).not.toContain('SPARK_BRAIN_ARTIFACT_NAMES');
  });
});
