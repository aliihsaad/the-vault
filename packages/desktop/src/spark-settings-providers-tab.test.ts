import { readFileSync } from 'node:fs';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ProvidersTab } from './components/spark/ProvidersTab.js';
import { buildSparkProviderRegistryModel } from './spark-settings-view-model.js';

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

function readProvidersTabSource(): string {
  return readFileSync(new URL('./components/spark/ProvidersTab.tsx', import.meta.url), 'utf8');
}

describe('Spark S2 Providers tab', () => {
  it('renders a role assignment dropdown for every capability role', () => {
    const html = render(React.createElement(ProvidersTab, {
      model: buildSparkProviderRegistryModel(null),
      providerPending: null,
      roleAssignmentPending: null,
      onConfigureProvider: () => undefined,
      onAssignRole: () => undefined,
    }));

    // One labelled <select> per role.
    expect(html).toContain('id="spark-role-STT"');
    expect(html).toContain('id="spark-role-LLM"');
    expect(html).toContain('id="spark-role-Realtime"');
    expect(html).toContain('id="spark-role-TTS"');
    expect(html).toContain('Speech-to-text');
    expect(html).toContain('Language model');
    expect(html).toContain('Text-to-speech');
  });

  it('renders the catalog with health badges and per-provider configure forms', () => {
    const html = render(React.createElement(ProvidersTab, {
      model: buildSparkProviderRegistryModel(null),
      providerPending: null,
      roleAssignmentPending: null,
      onConfigureProvider: () => undefined,
      onAssignRole: () => undefined,
    }));

    expect(html).toContain('FreeLLMAPI');
    expect(html).toContain('Default (always available)');
    expect(html).toContain('OpenAI');
    expect(html).toContain('Ollama');
    expect(html).toContain('0 of 8 providers configured');
    // Honest unconfigured health badge by default.
    expect(html).toContain('spark-provider-health-unavailable');
    // API key field is masked.
    expect(html).toContain('type="password"');
    // Base URL field is present for providers that require it (e.g. FreeLLMAPI/Ollama).
    expect(html).toContain('Base URL');
  });

  it('never leaks a key value or key getter into rendered markup', () => {
    const html = render(React.createElement(ProvidersTab, {
      model: buildSparkProviderRegistryModel(null),
      providerPending: null,
      roleAssignmentPending: null,
      onConfigureProvider: () => undefined,
      onAssignRole: () => undefined,
    }));

    expect(html).not.toContain('getKey');
    expect(html).not.toContain('value="sk-');
  });

  it('wires configure + role assignment handlers and clears the key after save', () => {
    const source = readProvidersTabSource();

    expect(source).toContain('onConfigureProvider');
    expect(source).toContain('onAssignRole');
    // Submit clears the transient key state — never retained in the renderer.
    expect(source).toContain("setApiKey('')");
    // Key input stays masked; no plaintext type for the key.
    expect(source).toContain('type="password"');
  });
});
