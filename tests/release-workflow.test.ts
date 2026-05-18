import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Windows release workflow', () => {
  const workflow = readFileSync(join(process.cwd(), '.github/workflows/release-windows.yml'), 'utf8');

  it('does not publish a hardcoded version-specific release body', () => {
    expect(workflow).not.toMatch(/The Vault v\d+\.\d+\.\d+ hardens/);
    expect(workflow).not.toMatch(/body:\s*\|\s*\r?\n\s*The Vault v\d+\.\d+\.\d+/);
  });
});
