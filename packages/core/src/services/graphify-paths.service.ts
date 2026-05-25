import { join, resolve } from 'node:path';
import { slugify } from '../rules/naming.js';

export interface GraphifyExtensionPaths {
  root: string;
  runtime: string;
  cache: string;
  projectsRoot: string;
  config: string;
}

export interface GraphifyProjectPaths {
  projectSlug: string;
  projectRoot: string;
  corpusRoot: string;
  sourceManifest: string;
  memoryExportRoot: string;
  memoryExportNdjson: string;
  memoryExportItems: string;
  artifactRoot: string;
  graphHtml: string;
  graphJson: string;
  graphReport: string;
  graphSvg: string;
  logsRoot: string;
  latestLog: string;
  buildState: string;
}

export function getGraphifyExtensionPaths(vaultRoot: string): GraphifyExtensionPaths {
  const root = resolve(vaultRoot, 'extensions', 'graphify');

  return {
    root,
    runtime: join(root, 'runtime'),
    cache: join(root, 'cache'),
    projectsRoot: join(root, 'projects'),
    config: join(root, 'config.json'),
  };
}

export function getGraphifyProjectPaths(vaultRoot: string, project: string): GraphifyProjectPaths {
  const extensionPaths = getGraphifyExtensionPaths(vaultRoot);
  const projectSlug = slugify(project);
  const projectRoot = join(extensionPaths.projectsRoot, projectSlug);
  const corpusRoot = join(projectRoot, 'corpus');
  const memoryExportRoot = join(corpusRoot, 'vault-memory-export');
  const artifactRoot = join(projectRoot, 'graphify-out');
  const logsRoot = join(projectRoot, 'logs');

  return {
    projectSlug,
    projectRoot,
    corpusRoot,
    sourceManifest: join(corpusRoot, 'source-manifest.json'),
    memoryExportRoot,
    memoryExportNdjson: join(memoryExportRoot, 'memories.ndjson'),
    memoryExportItems: join(memoryExportRoot, 'memories'),
    artifactRoot,
    graphHtml: join(artifactRoot, 'graph.html'),
    graphJson: join(artifactRoot, 'graph.json'),
    graphReport: join(artifactRoot, 'GRAPH_REPORT.md'),
    graphSvg: join(artifactRoot, 'graph.svg'),
    logsRoot,
    latestLog: join(logsRoot, 'latest.log'),
    buildState: join(projectRoot, 'build-state.json'),
  };
}

