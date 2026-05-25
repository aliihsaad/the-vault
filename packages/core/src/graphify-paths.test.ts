import { describe, expect, it } from 'vitest';
import { isAbsolute, relative } from 'node:path';
import {
  getGraphifyExtensionPaths,
  getGraphifyProjectPaths,
} from './services/graphify-paths.service.js';

describe('Graphify managed paths', () => {
  it('derives extension paths under the Vault-managed root', () => {
    const paths = getGraphifyExtensionPaths('C:/Users/Mini/Vault');

    expect(paths.root).toBe('C:\\Users\\Mini\\Vault\\extensions\\graphify');
    expect(paths.runtime).toBe('C:\\Users\\Mini\\Vault\\extensions\\graphify\\runtime');
    expect(paths.cache).toBe('C:\\Users\\Mini\\Vault\\extensions\\graphify\\cache');
    expect(paths.config).toBe('C:\\Users\\Mini\\Vault\\extensions\\graphify\\config.json');
    expect(Object.values(paths).every((pathValue) => isAbsolute(pathValue))).toBe(true);
  });

  it('derives per-project corpus, artifact, log, and build-state paths', () => {
    const paths = getGraphifyProjectPaths('C:/Users/Mini/Vault', 'The Vault');

    expect(paths.projectSlug).toBe('the-vault');
    expect(paths.projectRoot).toBe('C:\\Users\\Mini\\Vault\\extensions\\graphify\\projects\\the-vault');
    expect(paths.corpusRoot).toBe(`${paths.projectRoot}\\corpus`);
    expect(paths.sourceManifest).toBe(`${paths.corpusRoot}\\source-manifest.json`);
    expect(paths.memoryExportRoot).toBe(`${paths.corpusRoot}\\vault-memory-export`);
    expect(paths.memoryExportNdjson).toBe(`${paths.memoryExportRoot}\\memories.ndjson`);
    expect(paths.memoryExportItems).toBe(`${paths.memoryExportRoot}\\memories`);
    expect(paths.artifactRoot).toBe(`${paths.projectRoot}\\graphify-out`);
    expect(paths.graphHtml).toBe(`${paths.artifactRoot}\\graph.html`);
    expect(paths.graphJson).toBe(`${paths.artifactRoot}\\graph.json`);
    expect(paths.graphReport).toBe(`${paths.artifactRoot}\\GRAPH_REPORT.md`);
    expect(paths.graphSvg).toBe(`${paths.artifactRoot}\\graph.svg`);
    expect(paths.logsRoot).toBe(`${paths.projectRoot}\\logs`);
    expect(paths.latestLog).toBe(`${paths.logsRoot}\\latest.log`);
    expect(paths.buildState).toBe(`${paths.projectRoot}\\build-state.json`);
  });

  it('keeps managed artifacts outside a user source root', () => {
    const sourceRoot = 'C:/Users/Mini/Desktop/Projects/the-vault';
    const paths = getGraphifyProjectPaths('C:/Users/Mini/Vault', 'the-vault');

    expect(relative(sourceRoot, paths.artifactRoot).startsWith('..')).toBe(true);
    expect(paths.artifactRoot).not.toContain('Desktop\\Projects\\the-vault');
  });
});

