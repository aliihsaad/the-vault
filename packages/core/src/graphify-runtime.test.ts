import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  checkGraphifyUpdate,
  compareGraphifyVersions,
  detectGraphifyRuntime,
  fetchLatestGraphifyVersion,
  planGraphifyInstall,
  planGraphifyUpdate,
  resolveGraphifyCommandForRuntimeConfig,
  type GraphifyCommandRunner,
  type GraphifyFetchLike,
} from './services/graphify-runtime.service.js';

describe('Graphify runtime detection and install planning', () => {
  it('parses Python, uv, pipx, and Graphify versions from an injected command runner', async () => {
    const runner = createRunner({
      'python --version': { exitCode: 0, stdout: 'Python 3.12.4\n' },
      'uv --version': { exitCode: 0, stdout: 'uv 0.7.8 (c3a9a4d)\n' },
      'pipx --version': { exitCode: 0, stdout: '1.6.0\n' },
      'graphify --version': { exitCode: 0, stdout: 'graphify 0.8.17\n' },
    });

    const status = await detectGraphifyRuntime({ commandRunner: runner });

    expect(status).toEqual({
      python: { available: true, version: '3.12.4' },
      uv: { available: true, version: '0.7.8' },
      pipx: { available: true, version: '1.6.0' },
      graphify: { available: true, version: '0.8.17', command: 'graphify' },
    });
  });

  it('reports missing Graphify without throwing when the command is absent', async () => {
    const runner = createRunner({
      'python --version': { exitCode: 0, stdout: 'Python 3.11.9\n' },
      'uv --version': { exitCode: 1, stderr: 'uv not found\n' },
      'pipx --version': { exitCode: 1, stderr: 'pipx not found\n' },
      'graphify --version': { exitCode: 127, stderr: 'graphify not found\n' },
    });

    const status = await detectGraphifyRuntime({ commandRunner: runner });

    expect(status.graphify).toEqual({
      available: false,
      version: null,
      command: 'graphify',
      reason: 'Graphify CLI was not detected.',
    });
    expect(status.python).toEqual({ available: true, version: '3.11.9' });
  });

  it('resolves the selected Graphify executable from runtime configuration', () => {
    const managedRuntimePath = join('C:/Users/Mini/Vault', 'extensions', 'graphify', 'runtime');
    const managedCommand = join(managedRuntimePath, 'Scripts', 'graphify.exe');

    expect(resolveGraphifyCommandForRuntimeConfig({
      runtimeMode: 'managed',
      managedRuntimePath,
      customExecutablePath: null,
    })).toBe(managedCommand);

    expect(resolveGraphifyCommandForRuntimeConfig({
      runtimeMode: 'localSource',
      managedRuntimePath,
      customExecutablePath: null,
    })).toBe(managedCommand);

    expect(resolveGraphifyCommandForRuntimeConfig({
      runtimeMode: 'path',
      managedRuntimePath,
      customExecutablePath: 'C:/Tools/graphify.exe',
    })).toBe('C:/Tools/graphify.exe');

    expect(resolveGraphifyCommandForRuntimeConfig({
      runtimeMode: 'path',
      managedRuntimePath,
      customExecutablePath: null,
    })).toBe('graphify');
  });

  it('plans a managed uv install first under the Vault Graphify runtime directory', () => {
    const vaultRoot = 'C:/Users/Mini/Vault';
    const plan = planGraphifyInstall({
      vaultRoot,
      runtimeMode: 'managed',
      availableTools: {
        uv: true,
        pipx: true,
        python: true,
      },
      extras: [],
    });

    expect(plan).toEqual({
      runtimeMode: 'managed',
      developerMode: false,
      packageName: 'graphifyy',
      cliCommand: 'graphify',
      runtimePath: join(vaultRoot, 'extensions', 'graphify', 'runtime'),
      selectedInstaller: 'uv',
      commands: [
        {
          label: 'Create managed Graphify virtual environment',
          command: 'uv',
          args: ['venv', join(vaultRoot, 'extensions', 'graphify', 'runtime')],
          preview: `uv venv "${join(vaultRoot, 'extensions', 'graphify', 'runtime')}"`,
        },
        {
          label: 'Install Graphify into managed runtime',
          command: 'uv',
          args: [
            'pip',
            'install',
            '--python',
            join(vaultRoot, 'extensions', 'graphify', 'runtime', 'Scripts', 'python.exe'),
            'graphifyy',
          ],
          preview: `uv pip install --python "${join(vaultRoot, 'extensions', 'graphify', 'runtime', 'Scripts', 'python.exe')}" graphifyy`,
        },
      ],
    });
  });

  it('falls back from uv to pipx and then Python venv command previews', () => {
    const vaultRoot = 'C:/Users/Mini/Vault';
    const runtimePath = join(vaultRoot, 'extensions', 'graphify', 'runtime');
    const managedPython = join(runtimePath, 'Scripts', 'python.exe');
    const pipxPlan = planGraphifyInstall({
      vaultRoot,
      runtimeMode: 'managed',
      availableTools: { uv: false, pipx: true, python: true },
      extras: ['mcp'],
    });
    const pythonPlan = planGraphifyInstall({
      vaultRoot,
      runtimeMode: 'managed',
      availableTools: { uv: false, pipx: false, python: true },
      extras: ['mcp'],
    });

    expect(pipxPlan.selectedInstaller).toBe('pipx');
    expect(pipxPlan.commands[0]?.preview).toContain(runtimePath);
    expect(pythonPlan.selectedInstaller).toBe('pythonVenv');
    expect(pythonPlan.commands.map((command) => command.preview).join('\n')).toContain(runtimePath);
    expect(pythonPlan.commands.map((command) => command.preview)).toEqual([
      `python -m venv "${runtimePath}"`,
      `& "${managedPython}" -m pip install "graphifyy[mcp]"`,
    ]);
  });

  it('uses PyPI package graphifyy, expects graphify CLI, and includes extras only when selected', () => {
    const vaultRoot = 'C:/Users/Mini/Vault';

    const basePlan = planGraphifyInstall({
      vaultRoot,
      runtimeMode: 'managed',
      availableTools: { uv: false, pipx: true, python: true },
      extras: [],
    });
    const extrasPlan = planGraphifyInstall({
      vaultRoot,
      runtimeMode: 'managed',
      availableTools: { uv: false, pipx: true, python: true },
      extras: ['mcp', 'pdf', 'office'],
    });

    expect(basePlan.packageName).toBe('graphifyy');
    expect(basePlan.cliCommand).toBe('graphify');
    expect(basePlan.commands[0]?.args).toContain('graphifyy');
    expect(basePlan.commands[0]?.preview).toContain('graphifyy');
    expect(basePlan.commands[0]?.preview).not.toContain('[');

    expect(extrasPlan.commands[0]?.args).toContain('graphifyy[mcp,pdf,office]');
    expect(extrasPlan.commands[0]?.preview).toContain('"graphifyy[mcp,pdf,office]"');
  });

  it('marks localSource as developer mode and never assumes the local clone exists', () => {
    const plan = planGraphifyInstall({
      vaultRoot: 'C:/Users/Mini/Vault',
      runtimeMode: 'localSource',
      localSourcePath: 'C:/Users/Mini/Desktop/cloned-repos/graphify',
      availableTools: { uv: true, pipx: true, python: true },
      extras: ['mcp'],
    });

    expect(plan.runtimeMode).toBe('localSource');
    expect(plan.developerMode).toBe(true);
    expect(plan.localSourcePath).toBe('C:\\Users\\Mini\\Desktop\\cloned-repos\\graphify');
    expect(plan.localSourceExists).toBeNull();
    expect(plan.commands[0]?.preview).toContain('--editable');
    expect(plan.commands[0]?.preview).toContain('"C:\\Users\\Mini\\Desktop\\cloned-repos\\graphify[mcp]"');
  });

  it('returns install command previews without executing them', () => {
    let executed = false;
    const plan = planGraphifyInstall({
      vaultRoot: 'C:/Users/Mini/Vault',
      runtimeMode: 'managed',
      availableTools: { uv: true, pipx: false, python: true },
      extras: [],
      commandRunner: async () => {
        executed = true;
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    });

    expect(executed).toBe(false);
    expect(plan.commands.every((command) => command.preview.length > 0)).toBe(true);
  });
});

describe('Graphify update planning', () => {
  const vaultRoot = 'C:/Users/Mini/Vault';
  const runtimePath = join(vaultRoot, 'extensions', 'graphify', 'runtime');
  const pythonPath = join(runtimePath, 'Scripts', 'python.exe');

  it('plans an in-place uv upgrade for the managed runtime', () => {
    const plan = planGraphifyUpdate({
      vaultRoot,
      runtimeMode: 'managed',
      availableTools: { uv: true, pipx: true, python: true },
      extras: [],
    });

    expect(plan.supported).toBe(true);
    expect(plan.reason).toBeNull();
    expect(plan.selectedInstaller).toBe('uv');
    expect(plan.commands).toHaveLength(1);
    expect(plan.commands[0]?.command).toBe('uv');
    expect(plan.commands[0]?.args).toEqual([
      'pip', 'install', '--python', pythonPath, '--upgrade', 'graphifyy',
    ]);
  });

  it('carries configured extras into the upgrade spec', () => {
    const plan = planGraphifyUpdate({
      vaultRoot,
      runtimeMode: 'managed',
      availableTools: { uv: true, pipx: false, python: true },
      extras: ['mcp', 'leiden'],
    });

    expect(plan.commands[0]?.args).toContain('graphifyy[mcp,leiden]');
  });

  it('uses pipx upgrade without extras and a force reinstall with extras', () => {
    const upgrade = planGraphifyUpdate({
      vaultRoot,
      runtimeMode: 'managed',
      availableTools: { uv: false, pipx: true, python: true },
      extras: [],
    });
    const reinstall = planGraphifyUpdate({
      vaultRoot,
      runtimeMode: 'managed',
      availableTools: { uv: false, pipx: true, python: true },
      extras: ['mcp'],
    });

    expect(upgrade.commands[0]?.command).toBe('pipx');
    expect(upgrade.commands[0]?.args).toEqual(['upgrade', 'graphifyy']);
    expect(upgrade.commands[0]?.env?.PIPX_HOME).toBe(join(runtimePath, 'pipx'));
    expect(reinstall.commands[0]?.args).toEqual(['install', '--force', 'graphifyy[mcp]']);
  });

  it('falls back to pip --upgrade inside the managed venv when only Python exists', () => {
    const plan = planGraphifyUpdate({
      vaultRoot,
      runtimeMode: 'managed',
      availableTools: { uv: false, pipx: false, python: true },
      extras: [],
    });

    expect(plan.commands[0]?.command).toBe(pythonPath);
    expect(plan.commands[0]?.args).toEqual(['-m', 'pip', 'install', '--upgrade', 'graphifyy']);
  });

  it('marks PATH and developer-source modes as unsupported with a reason', () => {
    const pathPlan = planGraphifyUpdate({
      vaultRoot,
      runtimeMode: 'path',
      availableTools: { uv: true, pipx: true, python: true },
    });
    const devPlan = planGraphifyUpdate({
      vaultRoot,
      runtimeMode: 'localSource',
      availableTools: { uv: true, pipx: true, python: true },
    });

    expect(pathPlan.supported).toBe(false);
    expect(pathPlan.commands).toEqual([]);
    expect(pathPlan.reason).toContain('managed');
    expect(devPlan.supported).toBe(false);
    expect(devPlan.reason).toContain('checkout');
  });

  it('reports unsupported when no installer is available', () => {
    const plan = planGraphifyUpdate({
      vaultRoot,
      runtimeMode: 'managed',
      availableTools: { uv: false, pipx: false, python: false },
    });

    expect(plan.supported).toBe(false);
    expect(plan.selectedInstaller).toBeNull();
    expect(plan.reason).toContain('No supported installer');
  });
});

describe('Graphify version comparison and update checks', () => {
  it('compares dotted versions numerically', () => {
    expect(compareGraphifyVersions('0.8.18', '0.9.17')).toBeLessThan(0);
    expect(compareGraphifyVersions('0.9.17', '0.9.17')).toBe(0);
    expect(compareGraphifyVersions('0.10.0', '0.9.99')).toBeGreaterThan(0);
    expect(compareGraphifyVersions('1.0', '1.0.0')).toBe(0);
    expect(compareGraphifyVersions(null, '1.0.0')).toBeLessThan(0);
    expect(compareGraphifyVersions('garbage', '0.0.1')).toBeLessThan(0);
  });

  it('fetches the latest version from PyPI through an injected fetch', async () => {
    const requests: string[] = [];
    const fetchImpl: GraphifyFetchLike = async (url) => {
      requests.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({ info: { version: '0.9.17' } }),
      };
    };

    const result = await fetchLatestGraphifyVersion({ fetchImpl });

    expect(result).toEqual({ version: '0.9.17', error: null });
    expect(requests).toEqual(['https://pypi.org/pypi/graphifyy/json']);
  });

  it('degrades to an error result on HTTP failure, malformed payload, or network error', async () => {
    const httpFailure = await fetchLatestGraphifyVersion({
      fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    });
    const malformed = await fetchLatestGraphifyVersion({
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ info: {} }) }),
    });
    const network = await fetchLatestGraphifyVersion({
      fetchImpl: async () => {
        throw new Error('getaddrinfo ENOTFOUND pypi.org');
      },
    });

    expect(httpFailure.version).toBeNull();
    expect(httpFailure.error).toContain('503');
    expect(malformed.version).toBeNull();
    expect(malformed.error).toContain('did not include');
    expect(network.version).toBeNull();
    expect(network.error).toContain('ENOTFOUND');
  });

  it('flags an available update when the installed CLI is older than PyPI', async () => {
    const check = await checkGraphifyUpdate({
      commandRunner: createRunner({
        'graphify --version': { exitCode: 0, stdout: 'graphify 0.8.18\n' },
      }),
      config: { runtimeMode: 'path', managedRuntimePath: 'C:/ignored', customExecutablePath: null },
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ info: { version: '0.9.17' } }),
      }),
    });

    expect(check.installedVersion).toBe('0.8.18');
    expect(check.latestVersion).toBe('0.9.17');
    expect(check.updateAvailable).toBe(true);
    expect(check.error).toBeNull();
    expect(Number.isNaN(Date.parse(check.checkedAt))).toBe(false);
  });

  it('reports an up-to-date runtime and a missing CLI without claiming an update', async () => {
    const fetchLatest: GraphifyFetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ info: { version: '0.9.17' } }),
    });

    const upToDate = await checkGraphifyUpdate({
      commandRunner: createRunner({
        'graphify --version': { exitCode: 0, stdout: 'graphify 0.9.17\n' },
      }),
      config: { runtimeMode: 'path', managedRuntimePath: 'C:/ignored', customExecutablePath: null },
      fetchImpl: fetchLatest,
    });
    const missingCli = await checkGraphifyUpdate({
      commandRunner: createRunner({}),
      config: { runtimeMode: 'path', managedRuntimePath: 'C:/ignored', customExecutablePath: null },
      fetchImpl: fetchLatest,
    });

    expect(upToDate.updateAvailable).toBe(false);
    expect(upToDate.error).toBeNull();
    expect(missingCli.installedVersion).toBeNull();
    expect(missingCli.updateAvailable).toBe(false);
    expect(missingCli.error).toContain('not detected');
  });
});

function createRunner(
  results: Record<string, { exitCode: number; stdout?: string; stderr?: string }>,
): GraphifyCommandRunner {
  return async (command, args) => {
    const key = [command, ...args].join(' ');
    return results[key] ?? {
      exitCode: 127,
      stdout: '',
      stderr: `${key} was not found`,
    };
  };
}
