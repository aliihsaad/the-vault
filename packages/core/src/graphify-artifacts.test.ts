import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getGraphifyProjectPaths } from './services/graphify-paths.service.js';
import {
  discoverGraphifyArtifacts,
  getGraphifyHtmlArtifact,
  readGraphifyArtifactJson,
  readGraphifyArtifactReport,
  resolveGraphifyArtifactPath,
} from './services/graphify-artifact.service.js';

describe('Graphify artifact gateway', () => {
  it('discovers managed artifacts and reads graph stats from graph.json', async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), 'vault-graphify-artifacts-'));
    try {
      const paths = getGraphifyProjectPaths(vaultRoot, 'The Vault');
      await mkdir(paths.artifactRoot, { recursive: true });
      await writeFile(paths.graphJson, JSON.stringify({
        nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }],
        communities: [{ id: 'one' }],
      }));
      await writeFile(paths.graphReport, '# Report\n');

      const discovered = discoverGraphifyArtifacts(vaultRoot, 'The Vault');

      expect(discovered).toEqual({
        available: true,
        artifactRoot: paths.artifactRoot,
        artifactPaths: {
          graphJson: paths.graphJson,
          graphHtml: null,
          graphReport: paths.graphReport,
          graphSvg: null,
        },
        graphStats: {
          nodeCount: 3,
          edgeCount: 2,
          communityCount: 1,
        },
        missingRequired: [],
        errorMessage: null,
      });
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it('counts communities from per-node community attributes when there is no top-level list', async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), 'vault-graphify-communities-'));
    try {
      const paths = getGraphifyProjectPaths(vaultRoot, 'The Vault');
      await mkdir(paths.artifactRoot, { recursive: true });
      // Real Graphify graph.json stores community membership on each node, not as a
      // top-level `communities` array — so the count must be derived from the nodes.
      await writeFile(paths.graphJson, JSON.stringify({
        nodes: [
          { id: 'a', community: 0 },
          { id: 'b', community: 0 },
          { id: 'c', community: 1 },
          { id: 'd', community: 2 },
        ],
        edges: [{ source: 'a', target: 'b' }],
      }));

      const discovered = discoverGraphifyArtifacts(vaultRoot, 'The Vault');
      expect(discovered.graphStats).toEqual({ nodeCount: 4, edgeCount: 1, communityCount: 3 });
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it('rejects traversal and paths outside the managed artifact root', async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), 'vault-graphify-safe-artifacts-'));
    try {
      const paths = getGraphifyProjectPaths(vaultRoot, 'The Vault');
      await mkdir(paths.artifactRoot, { recursive: true });
      await writeFile(paths.graphJson, '{}');

      expect(resolveGraphifyArtifactPath(vaultRoot, 'The Vault', 'graph.json')).toBe(paths.graphJson);
      expect(resolveGraphifyArtifactPath(vaultRoot, 'The Vault', paths.graphJson)).toBe(paths.graphJson);
      expect(() => resolveGraphifyArtifactPath(vaultRoot, 'The Vault', '../logs/latest.log'))
        .toThrow('Graphify artifact paths must stay under the managed artifact root.');
      expect(() => resolveGraphifyArtifactPath(vaultRoot, 'The Vault', paths.latestLog))
        .toThrow('Graphify artifact paths must stay under the managed artifact root.');
      expect(() => resolveGraphifyArtifactPath(vaultRoot, 'The Vault', join(tmpdir(), 'outside-graph.json')))
        .toThrow('Graphify artifact paths must stay under the managed artifact root.');
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it('budget-reads graph JSON and report text with typed too-large fallbacks', async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), 'vault-graphify-budget-artifacts-'));
    try {
      const paths = getGraphifyProjectPaths(vaultRoot, 'The Vault');
      await mkdir(paths.artifactRoot, { recursive: true });
      await writeFile(paths.graphJson, JSON.stringify({ nodes: [{ id: 'a' }], edges: [] }));
      await writeFile(paths.graphReport, '# Report\nThis report is intentionally longer than a tiny budget.\n');

      expect(readGraphifyArtifactJson(vaultRoot, 'The Vault', { maxBytes: 1024 })).toEqual(expect.objectContaining({
        status: 'available',
        path: paths.graphJson,
        data: { nodes: [{ id: 'a' }], edges: [] },
      }));
      expect(readGraphifyArtifactJson(vaultRoot, 'The Vault', { maxBytes: 8 })).toEqual(expect.objectContaining({
        status: 'tooLarge',
        path: paths.graphJson,
        maxBytes: 8,
      }));

      expect(readGraphifyArtifactReport(vaultRoot, 'The Vault', { maxBytes: 1024 })).toEqual(expect.objectContaining({
        status: 'available',
        path: paths.graphReport,
        text: await readFile(paths.graphReport, 'utf8'),
      }));
      expect(readGraphifyArtifactReport(vaultRoot, 'The Vault', { maxBytes: 10 })).toEqual(expect.objectContaining({
        status: 'tooLarge',
        path: paths.graphReport,
        maxBytes: 10,
      }));
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it('returns a typed fallback when graph.html is missing', async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), 'vault-graphify-html-fallback-'));
    try {
      const paths = getGraphifyProjectPaths(vaultRoot, 'The Vault');
      await mkdir(paths.artifactRoot, { recursive: true });
      await writeFile(paths.graphJson, '{"nodes":[]}');
      await writeFile(paths.graphReport, '# Report\n');

      expect(getGraphifyHtmlArtifact(vaultRoot, 'The Vault')).toEqual({
        status: 'missing',
        path: paths.graphHtml,
        fallback: {
          graphJson: paths.graphJson,
          graphReport: paths.graphReport,
        },
        message: 'graph.html is missing; use graph.json or GRAPH_REPORT.md until Graphify rebuilds the HTML artifact.',
      });
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });
});
