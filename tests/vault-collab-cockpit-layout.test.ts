import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const appCssSource = readFileSync(join(process.cwd(), 'packages/desktop/src/app.css'), 'utf8');

function cssBlock(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`, 'm').exec(appCssSource);
  return match?.groups?.body ?? '';
}

describe('Vault Collab cockpit layout', () => {
  it('keeps the Phase 6 cockpit in tabbed sections with normal page flow', () => {
    expect(cssBlock('.vault-collab-dashboard')).toContain('display: flex');
    expect(cssBlock('.vault-collab-dashboard')).toContain('flex-direction: column');
    expect(cssBlock('.vault-collab-dashboard')).toContain('flex: 1 1 auto');
    expect(cssBlock('.vault-collab-dashboard')).toContain('height: 100%');
    expect(cssBlock('.vault-collab-dashboard')).toContain('overflow: hidden');
    expect(cssBlock('.vault-collab-cockpit-shell')).toContain('display: flex');
    expect(cssBlock('.vault-collab-cockpit-shell')).toContain('flex-direction: column');
    expect(cssBlock('.vault-collab-cockpit-shell')).toContain('flex: 1 1 auto');
    expect(cssBlock('.vault-collab-cockpit-shell')).toContain('height: 100%');
    expect(cssBlock('.vault-collab-cockpit-shell')).toContain('min-height: 0');
    expect(cssBlock('.vault-collab-cockpit-shell')).toContain('overflow: hidden');
    expect(cssBlock('.vault-collab-cockpit-tabs')).toContain('display: flex');
    expect(cssBlock('.vault-collab-cockpit-tabs')).toContain('overflow-x: auto');
    expect(cssBlock('.vault-collab-cockpit-tab-panel')).toContain('display: flex');
    expect(cssBlock('.vault-collab-cockpit-tab-panel')).toContain('flex: 1 1 auto');
    expect(cssBlock('.vault-collab-cockpit-tab-panel')).toContain('flex-direction: column');
    expect(cssBlock('.vault-collab-cockpit-tab-panel')).toContain('min-width: 0');
    expect(cssBlock('.vault-collab-cockpit-tab-panel')).toContain('min-height: 0');
    expect(cssBlock('.vault-collab-cockpit-tab-panel')).toContain('height: 100%');
    expect(cssBlock('.vault-collab-cockpit-tab-panel')).toContain('overflow: hidden');
    expect(cssBlock('.vault-collab-cockpit-tab-panel')).not.toContain('overflow: visible');
    expect(cssBlock('.vault-collab-zone')).toContain('min-height: 0');
    expect(cssBlock('.vault-collab-zone')).toContain('height: 100%');
    expect(cssBlock('.vault-collab-zone')).toContain('overflow: hidden');
    expect(cssBlock('.vault-collab-zone-scroll')).toContain('min-height: 0');
    expect(cssBlock('.vault-collab-zone-scroll')).toContain('overflow-y: auto');
    expect(cssBlock('.vault-collab-work-columns')).toContain('flex: 1 1 auto');
    expect(cssBlock('.vault-collab-work-columns')).toContain('min-height: 0');
    expect(cssBlock('.vault-collab-work-columns')).toContain('grid-template-columns: repeat(auto-fit, minmax(260px, 1fr))');
    expect(cssBlock('.vault-collab-work-columns')).toContain('overflow-y: auto');
    expect(cssBlock('.vault-collab-work-columns')).not.toContain('overflow: visible');
  });

  it('keeps the all-clear Needs You state compact', () => {
    expect(cssBlock('.vault-collab-needs-list .empty-state')).toContain('min-height: 46px');
  });

  it('clamps long handoff and launch previews inside cockpit cards', () => {
    expect(cssBlock('.vault-collab-work-columns')).toContain('grid-template-columns: repeat(auto-fit, minmax(260px, 1fr))');
    expect(cssBlock('.vault-collab-work-card-preview')).toContain('display: -webkit-box');
    expect(cssBlock('.vault-collab-work-card-preview')).toContain('overflow: hidden');
    expect(cssBlock('.vault-collab-work-card-preview')).toContain('-webkit-line-clamp: 3');
    expect(cssBlock('.vault-collab-work-card-preview')).toContain('overflow-wrap: anywhere');
    expect(cssBlock('.vault-collab-command-preview')).toContain('-webkit-line-clamp: 3');
    expect(cssBlock('.vault-collab-command-preview')).not.toContain('white-space: nowrap');
  });

  it('renders handoff details in a modal instead of reserving tab-panel height', () => {
    expect(cssBlock('.vault-collab-selected-handoff')).toBe('');
    expect(cssBlock('.vault-collab-handoff-modal-backdrop')).toContain('position: fixed');
    expect(cssBlock('.vault-collab-handoff-modal-backdrop')).toContain('inset: 0');
    expect(cssBlock('.vault-collab-handoff-modal')).toContain('max-height: min(820px, calc(100vh - 48px))');
    expect(cssBlock('.vault-collab-handoff-modal')).toContain('overflow: hidden');
    expect(cssBlock('.vault-collab-handoff-modal-body')).toContain('grid-template-columns: minmax(0, 0.95fr) minmax(360px, 0.8fr)');
    expect(cssBlock('.vault-collab-handoff-modal-body')).toContain('overflow-y: auto');
    expect(cssBlock('.vault-collab-handoff-modal-title')).toContain('display: -webkit-box');
    expect(cssBlock('.vault-collab-handoff-modal-title')).toContain('-webkit-line-clamp: 5');
    expect(cssBlock('.vault-collab-handoff-modal-meta-grid')).toContain('grid-template-columns: repeat(auto-fit, minmax(170px, 1fr))');
    expect(cssBlock('.vault-collab-handoff-modal-thread-composer')).toContain('grid-template-columns: minmax(0, 1fr) auto');
    expect(cssBlock('.vault-collab-handoff-modal-thread-events')).toContain('max-height: 340px');
  });

  it('keeps office details and Request agent as modal surfaces', () => {
    expect(cssBlock('.vault-collab-role-profile-panel')).toBe('');
    expect(appCssSource).toContain('.vault-collab-role-profile-modal-backdrop');
    expect(appCssSource).toContain('.vault-collab-role-profile-modal');
    expect(appCssSource).toContain('.vault-collab-request-agent-modal-backdrop');
    expect(appCssSource).toContain('.vault-collab-request-agent-modal');
    expect(appCssSource).not.toContain('.vault-collab-request-agent-form {\n  grid-column: 1 / -1;');
  });

  it('allows long conversation tokens to wrap instead of widening the page', () => {
    expect(cssBlock('.vault-collab-event-row')).toContain('min-width: 0');
    expect(cssBlock('.vault-collab-event-row p')).toContain('overflow-wrap: anywhere');
    expect(cssBlock('.vault-collab-event-row .text-mono')).toContain('overflow-wrap: anywhere');
  });

  it('clips long office agent names inside the office cards', () => {
    expect(cssBlock('.vault-collab-office-agent-stack')).toContain('max-width: 100%');
    expect(cssBlock('.vault-collab-office-agent-stack')).toContain('overflow: hidden');
    expect(cssBlock('.vault-collab-office-agent-pill')).toContain('display: block');
    expect(cssBlock('.vault-collab-office-agent-pill')).toContain('box-sizing: border-box');
    expect(cssBlock('.vault-collab-office-agent-pill')).toContain('min-width: 0');
    expect(cssBlock('.vault-collab-office-agent-pill')).toContain('max-width: 100%');
    expect(cssBlock('.vault-collab-office-agent-pill')).toContain('overflow: hidden');
    expect(cssBlock('.vault-collab-office-agent-pill')).toContain('text-overflow: ellipsis');
    expect(cssBlock('.vault-collab-office-agent-pill')).toContain('white-space: nowrap');
  });
});
