import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('desktop shell navigation', () => {
  const appSource = readFileSync(join(process.cwd(), 'packages/desktop/src/App.tsx'), 'utf8');
  const agentSource = readFileSync(join(process.cwd(), 'packages/desktop/src/components/VaultAgentView.tsx'), 'utf8');

  it('removes Recall Console from the primary desktop shell', () => {
    expect(appSource).not.toContain('Recall Console');
    expect(appSource).not.toContain('ChatView');
  });

  it('presents local client orchestration as Local Agents instead of Workbench', () => {
    expect(agentSource).toContain('Local Agents');
    expect(agentSource).not.toContain('page-mode-label">Workbench');
  });
});
