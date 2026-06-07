import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function readSource(relativeUrl: string): string {
  return readFileSync(new URL(relativeUrl, import.meta.url), 'utf8');
}

describe('Spark sidebar extension entry', () => {
  it('registers a Spark entry in the Extensions nav section', () => {
    const appSource = readSource('./App.tsx');

    // Spark is a primary tab alongside the other extensions.
    expect(appSource).toMatch(/type PrimaryTab =[\s\S]*\| 'spark'/);
    // The Extensions nav section includes a Spark item next to Vault Collab.
    expect(appSource).toMatch(/EXTENSION_NAV[\s\S]*id: 'spark', label: 'Spark'/);
    expect(appSource).toContain('SparkView');
  });

  it('renders the dedicated Spark page when the spark tab is active', () => {
    const appSource = readSource('./App.tsx');
    expect(appSource).toContain("activeTab === 'spark' ? <SparkView");
    expect(appSource).toContain("import { SparkView } from './components/SparkView.js'");
  });

  it('builds the dedicated Spark page on the real Control Page, not the Settings panel', () => {
    const viewSource = readSource('./components/SparkView.tsx');
    // S1 replaced the Settings-panel duplicate with the dedicated control page.
    expect(viewSource).toContain("import { SparkControlPage } from './spark/SparkControlPage.js'");
    expect(viewSource).toContain('<SparkControlPage');
    expect(viewSource).not.toContain('SparkSettingsPanel');
  });

  it('adds Spark tab metadata', () => {
    const appSource = readSource('./App.tsx');
    expect(appSource).toMatch(/spark: \{\s*title: 'Spark'/);
  });
});
