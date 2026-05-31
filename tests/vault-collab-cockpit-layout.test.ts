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
  it('lets the cockpit page own the scroll while only the conversation feed is bounded', () => {
    expect(cssBlock('.vault-collab-cockpit-grid')).not.toContain('height:');
    expect(cssBlock('.vault-collab-cockpit-grid')).toContain('align-items: start');
    expect(cssBlock('.vault-collab-work-columns')).toContain('overflow: visible');
    expect(cssBlock('.vault-collab-work-columns')).not.toContain('overflow: auto');
    expect(cssBlock('.vault-collab-conversation-zone')).toContain('max-height:');
    expect(cssBlock('.vault-collab-conversation-zone .vault-collab-event-list')).toContain('flex: 1 1 auto');
    expect(cssBlock('.vault-collab-conversation-zone .vault-collab-event-list')).toContain('overflow-y: auto');
  });

  it('keeps the all-clear Needs You state compact', () => {
    expect(cssBlock('.vault-collab-needs-list .empty-state')).toContain('min-height: 46px');
  });

  it('clamps long handoff and launch previews inside cockpit cards', () => {
    expect(cssBlock('.vault-collab-work-card-preview')).toContain('display: -webkit-box');
    expect(cssBlock('.vault-collab-work-card-preview')).toContain('overflow: hidden');
    expect(cssBlock('.vault-collab-work-card-preview')).toContain('-webkit-line-clamp: 3');
    expect(cssBlock('.vault-collab-work-card-preview')).toContain('overflow-wrap: anywhere');
    expect(cssBlock('.vault-collab-command-preview')).toContain('-webkit-line-clamp: 3');
    expect(cssBlock('.vault-collab-command-preview')).not.toContain('white-space: nowrap');
  });

  it('allows long conversation tokens to wrap instead of widening the page', () => {
    expect(cssBlock('.vault-collab-event-row')).toContain('min-width: 0');
    expect(cssBlock('.vault-collab-event-row p')).toContain('overflow-wrap: anywhere');
    expect(cssBlock('.vault-collab-event-row .text-mono')).toContain('overflow-wrap: anywhere');
  });
});
