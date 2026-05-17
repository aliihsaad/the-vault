import { existsSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { now } from '../utils/datetime.js';
import type {
  ProjectWorkspaceConfig,
  ProjectWorkspaceRegistry,
  SetProjectWorkspaceInput,
  WorkspaceValidationResult,
} from '../types/index.js';

export function normalizeWorkspaceProject(project: string): string {
  return project.trim();
}

export function validateWorkspacePath(rawWorkspacePath: string): WorkspaceValidationResult {
  const trimmedPath = rawWorkspacePath.trim();

  if (!trimmedPath) {
    return {
      ok: false,
      workspacePath: '',
      exists: false,
      isDirectory: false,
      gitRootDetected: false,
      message: 'Workspace path is required.',
    };
  }

  if (!isAbsolute(trimmedPath)) {
    return {
      ok: false,
      workspacePath: trimmedPath,
      exists: false,
      isDirectory: false,
      gitRootDetected: false,
      message: 'Workspace path must be absolute.',
    };
  }

  const workspacePath = resolve(trimmedPath);
  const exists = existsSync(workspacePath);
  const isDirectory = exists ? statSync(workspacePath).isDirectory() : false;
  const gitRootDetected = isDirectory && existsSync(join(workspacePath, '.git'));
  const ok = exists && isDirectory;

  return {
    ok,
    workspacePath,
    exists,
    isDirectory,
    gitRootDetected,
    message: ok
      ? gitRootDetected
        ? 'Workspace path is valid and contains a .git directory.'
        : 'Workspace path is valid. No .git directory was detected.'
      : exists
        ? 'Workspace path exists but is not a directory.'
        : 'Workspace path does not exist.',
  };
}

export function getProjectWorkspace(
  registry: ProjectWorkspaceRegistry | null | undefined,
  project: string,
): ProjectWorkspaceConfig | null {
  const normalizedProject = normalizeWorkspaceProject(project);
  if (!normalizedProject || !registry) {
    return null;
  }

  return registry[normalizedProject] ?? null;
}

export function setProjectWorkspace(
  registry: ProjectWorkspaceRegistry | null | undefined,
  input: SetProjectWorkspaceInput,
): ProjectWorkspaceRegistry {
  const project = normalizeWorkspaceProject(input.project);
  if (!project) {
    throw new Error('Project is required.');
  }

  const validation = validateWorkspacePath(input.workspacePath);
  if (!validation.ok) {
    throw new Error(validation.message);
  }

  const nextConfig: ProjectWorkspaceConfig = {
    project,
    workspacePath: validation.workspacePath,
    trusted: input.trusted ?? false,
    gitRootDetected: validation.gitRootDetected,
    lastValidatedAt: now(),
    notes: input.notes?.trim() || null,
  };

  return {
    ...(registry ?? {}),
    [project]: nextConfig,
  };
}

export function removeProjectWorkspace(
  registry: ProjectWorkspaceRegistry | null | undefined,
  project: string,
): ProjectWorkspaceRegistry {
  const normalizedProject = normalizeWorkspaceProject(project);
  const next = { ...(registry ?? {}) };
  delete next[normalizedProject];
  return next;
}

export function listProjectWorkspaces(
  registry: ProjectWorkspaceRegistry | null | undefined,
): ProjectWorkspaceConfig[] {
  return Object.values(registry ?? {}).sort((left, right) => left.project.localeCompare(right.project));
}
