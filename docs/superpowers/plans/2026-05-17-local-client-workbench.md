# Local Client Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Vault Agent Workbench that lets the user map Vault projects to local repository paths, generate a Vault context pack, and launch useful Codex CLI or Claude Code work from the right repo without turning Vault into a terminal multiplexer.

**Architecture:** Keep Vault as the memory, routing, and context-preparation layer. Store trusted project workspace paths in core settings, extract the existing task-executor project-context logic into a reusable core service, and add a desktop workbench that prepares copy-ready local CLI launches for Codex and Claude. The first implementation does not manage live terminals; it creates a safe manual bridge that can be extended into managed process runs after the workflow proves useful.

**Tech Stack:** TypeScript, pnpm workspace, Vitest, Electron IPC/preload, React, existing Vault core settings, existing local adapter config/session code.

---

## Scope Decisions

- Phase 1 builds a manual local-client workbench, not an embedded terminal manager.
- Repositories may live outside the Vault repo. Workspace paths are absolute paths stored per Vault project and validated before use.
- Vault only prepares context, prompt files, and launch commands in Phase 1. Codex CLI and Claude Code still own their native execution, authentication, session files, and terminal UX.
- The Recall console remains a lightweight chat/recall surface. The new Workbench is for task setup and repo-targeted agent launches.
- The existing task queue remains for API-backed delegated tasks. Local CLI tasks get metadata and context pack files first; automatic background execution is a separate phase after manual launch proves useful.

## File Structure

### Create

- `packages/core/src/services/workspace-registry.service.ts`  
  Owns per-project workspace config validation, normalization, registry update helpers, and read helpers.

- `packages/core/src/services/project-context-pack.service.ts`  
  Builds reusable project context packs from project description, recall, latest memories, activity logs, and optional task/user prompt.

- `packages/core/src/workspace-registry.test.ts`  
  Unit tests workspace validation and registry mutation using temporary directories.

- `packages/core/src/project-context-pack.test.ts`  
  Unit tests context pack formatting with fake Vault-like source methods.

- `packages/core/src/local-workbench-launch.test.ts`  
  Unit tests launch command rendering for Codex and Claude.

- `packages/core/src/services/local-workbench-launch.service.ts`  
  Produces structured launch specs and display-safe PowerShell command strings without spawning processes.

- `packages/desktop/src/components/AgentWorkbenchView.tsx`  
  New focused React component for workspace registry, context preview, launch command generation, and result capture.

### Modify

- `packages/core/src/config/settings.ts`  
  Seed `project_workspace_registry` and `local_workbench_recent_runs`.

- `packages/core/src/types/index.ts`  
  Export workspace registry, context pack, and local workbench launch types.

- `packages/core/src/vault.ts`  
  Add methods that wrap workspace registry, context pack builder, and launch preparation services.

- `packages/core/src/services/task-executor.ts`  
  Replace the private project-context builder with the shared project-context pack service so API tasks and local workbench packs stay consistent.

- `packages/desktop/electron/main.ts`  
  Add IPC handlers for workspace registry, context pack preparation, launch preparation, recent workbench runs, and saving pasted local-agent results.

- `packages/desktop/electron/preload.ts`  
  Expose the new IPC methods on `window.vaultAPI`.

- `packages/desktop/src/types.d.ts`  
  Add renderer-facing types and `VaultAPI` method signatures.

- `packages/desktop/src/components/VaultAgentView.tsx`  
  Add a `workbench` section and mount `AgentWorkbenchView`.

- `packages/desktop/src/app.css`  
  Add restrained workbench layout styles matching the existing Vault Agent panels.

---

## Task 1: Workspace Registry Core

**Files:**
- Create: `packages/core/src/services/workspace-registry.service.ts`
- Modify: `packages/core/src/config/settings.ts`
- Modify: `packages/core/src/types/index.ts`
- Modify: `packages/core/src/vault.ts`
- Test: `packages/core/src/workspace-registry.test.ts`

- [ ] **Step 1: Write the failing workspace registry tests**

Create `packages/core/src/workspace-registry.test.ts`:

```ts
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import {
  getProjectWorkspace,
  removeProjectWorkspace,
  setProjectWorkspace,
  validateWorkspacePath,
} from './services/workspace-registry.service.js';
import type { ProjectWorkspaceRegistry } from './types/index.js';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeTempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'vault-workspace-'));
  tempRoots.push(root);
  mkdirSync(join(root, '.git'));
  return root;
}

describe('workspace registry service', () => {
  it('validates an absolute repository path and detects .git', () => {
    const workspacePath = makeTempRepo();

    const result = validateWorkspacePath(workspacePath);

    expect(result.ok).toBe(true);
    expect(result.workspacePath).toBe(resolve(workspacePath));
    expect(result.exists).toBe(true);
    expect(result.isDirectory).toBe(true);
    expect(result.gitRootDetected).toBe(true);
  });

  it('rejects relative paths before any launch command can be prepared', () => {
    const result = validateWorkspacePath('relative/project');

    expect(result.ok).toBe(false);
    expect(result.exists).toBe(false);
    expect(result.isDirectory).toBe(false);
    expect(result.message).toBe('Workspace path must be absolute.');
  });

  it('stores a trusted workspace by normalized project name', () => {
    const workspacePath = makeTempRepo();
    const registry: ProjectWorkspaceRegistry = {};

    const next = setProjectWorkspace(registry, {
      project: 'The Vault',
      workspacePath,
      trusted: true,
      notes: 'Main repo',
    });

    expect(Object.keys(next)).toEqual(['The Vault']);
    expect(next['The Vault'].workspacePath).toBe(resolve(workspacePath));
    expect(next['The Vault'].trusted).toBe(true);
    expect(next['The Vault'].gitRootDetected).toBe(true);
    expect(next['The Vault'].notes).toBe('Main repo');
    expect(getProjectWorkspace(next, 'The Vault')?.workspacePath).toBe(resolve(workspacePath));
  });

  it('removes a workspace without mutating the original registry object', () => {
    const workspacePath = makeTempRepo();
    const registry = setProjectWorkspace({}, {
      project: 'the-vault',
      workspacePath,
      trusted: true,
      notes: null,
    });

    const next = removeProjectWorkspace(registry, 'the-vault');

    expect(registry['the-vault']).toBeDefined();
    expect(next['the-vault']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the workspace registry test and verify it fails**

Run:

```powershell
pnpm test -- packages/core/src/workspace-registry.test.ts
```

Expected result: FAIL because `workspace-registry.service.ts` and the exported types do not exist yet.

- [ ] **Step 3: Add workspace registry types**

In `packages/core/src/types/index.ts`, add this section after the `ProjectMomentum` interface:

```ts
// ---------------------------------------------------------------------------
// Project Workspace Registry
// ---------------------------------------------------------------------------
export interface ProjectWorkspaceConfig {
  project: string;
  workspacePath: string;
  trusted: boolean;
  gitRootDetected: boolean;
  lastValidatedAt: string;
  notes: string | null;
}

export type ProjectWorkspaceRegistry = Record<string, ProjectWorkspaceConfig>;

export interface SetProjectWorkspaceInput {
  project: string;
  workspacePath: string;
  trusted?: boolean;
  notes?: string | null;
}

export interface WorkspaceValidationResult {
  ok: boolean;
  workspacePath: string;
  exists: boolean;
  isDirectory: boolean;
  gitRootDetected: boolean;
  message: string;
}
```

- [ ] **Step 4: Implement the registry service**

Create `packages/core/src/services/workspace-registry.service.ts`:

```ts
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
```

- [ ] **Step 5: Seed workspace registry settings**

In `packages/core/src/config/settings.ts`, add these defaults after `local_adapter_active_task_key`:

```ts
  project_workspace_registry: {},
  local_workbench_recent_runs: [],
```

- [ ] **Step 6: Add Vault wrappers**

In `packages/core/src/vault.ts`, add imports:

```ts
import {
  getProjectWorkspace,
  listProjectWorkspaces,
  removeProjectWorkspace,
  setProjectWorkspace,
  validateWorkspacePath,
} from './services/workspace-registry.service.js';
```

Add these imported types to the existing type import block:

```ts
  ProjectWorkspaceConfig,
  ProjectWorkspaceRegistry,
  SetProjectWorkspaceInput,
  WorkspaceValidationResult,
```

Add these methods inside the `Vault` class near existing settings methods:

```ts
  listProjectWorkspaces(): ProjectWorkspaceConfig[] {
    return listProjectWorkspaces(this.getSetting('project_workspace_registry') as ProjectWorkspaceRegistry | undefined);
  }

  getProjectWorkspace(project: string): ProjectWorkspaceConfig | null {
    return getProjectWorkspace(
      this.getSetting('project_workspace_registry') as ProjectWorkspaceRegistry | undefined,
      project,
    );
  }

  validateWorkspacePath(workspacePath: string): WorkspaceValidationResult {
    return validateWorkspacePath(workspacePath);
  }

  setProjectWorkspace(input: SetProjectWorkspaceInput): ProjectWorkspaceConfig {
    const nextRegistry = setProjectWorkspace(
      this.getSetting('project_workspace_registry') as ProjectWorkspaceRegistry | undefined,
      input,
    );
    this.setSetting('project_workspace_registry', nextRegistry);
    const workspace = getProjectWorkspace(nextRegistry, input.project);
    if (!workspace) {
      throw new Error('Workspace was not stored.');
    }
    return workspace;
  }

  removeProjectWorkspace(project: string): ProjectWorkspaceConfig[] {
    const nextRegistry = removeProjectWorkspace(
      this.getSetting('project_workspace_registry') as ProjectWorkspaceRegistry | undefined,
      project,
    );
    this.setSetting('project_workspace_registry', nextRegistry);
    return listProjectWorkspaces(nextRegistry);
  }
```

- [ ] **Step 7: Run the workspace registry test**

Run:

```powershell
pnpm test -- packages/core/src/workspace-registry.test.ts
```

Expected result: PASS.

- [ ] **Step 8: Commit workspace registry core**

Run:

```powershell
git add packages/core/src/types/index.ts packages/core/src/config/settings.ts packages/core/src/services/workspace-registry.service.ts packages/core/src/workspace-registry.test.ts packages/core/src/vault.ts
git commit -m "Add project workspace registry"
```

---

## Task 2: Shared Project Context Pack

**Files:**
- Create: `packages/core/src/services/project-context-pack.service.ts`
- Modify: `packages/core/src/types/index.ts`
- Modify: `packages/core/src/vault.ts`
- Modify: `packages/core/src/services/task-executor.ts`
- Test: `packages/core/src/project-context-pack.test.ts`

- [ ] **Step 1: Write the failing context pack tests**

Create `packages/core/src/project-context-pack.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildProjectContextPack } from './services/project-context-pack.service.js';
import type { ActivityLogEntry, MemoryItem, MemoryPack, Project } from './types/index.js';

function memory(overrides: Partial<MemoryItem>): MemoryItem {
  return {
    id: 1,
    itemUid: overrides.itemUid ?? 'vm_test',
    title: overrides.title ?? 'Memory title',
    project: overrides.project ?? 'the-vault',
    sourceApp: 'codex',
    sourceSessionId: null,
    memoryType: overrides.memoryType ?? 'session',
    subject: overrides.subject ?? 'Subject',
    summary: overrides.summary ?? 'Summary',
    content: null,
    keywords: overrides.keywords ?? [],
    tags: overrides.tags ?? [],
    routineType: null,
    status: 'active',
    priority: 'normal',
    promoted: false,
    nextSteps: overrides.nextSteps ?? [],
    relatedItemIds: [],
    relatedFiles: overrides.relatedFiles ?? [],
    vaultPath: null,
    createdAt: '2026-05-17T00:00:00.000Z',
    updatedAt: '2026-05-17T00:00:00.000Z',
    lastAccessedAt: null,
    accessCount: 0,
    snoozedUntil: null,
    outcome: null,
  };
}

describe('project context pack service', () => {
  it('builds a stable markdown pack with description, recall, latest memories, and activity', async () => {
    const recalled = memory({
      itemUid: 'vm_recalled',
      title: 'Released v0.2.5 queue overview refresh',
      summary: 'Queue overview UI was clarified and released.',
      relatedFiles: ['packages/desktop/src/components/VaultAgentView.tsx'],
    });
    const latest = memory({
      itemUid: 'vm_latest',
      title: 'Local adapter execution path',
      summary: 'Claude and Codex can run from a configured cwd.',
    });
    const source = {
      recallContext: async (): Promise<MemoryPack> => ({
        summaries: [],
        decisions: [],
        plans: [],
        other: [],
        related: [],
        proactive: [],
        topMatches: [{ item: recalled, score: 42, reasons: ['same project'], signals: {} }],
        totalCandidates: 1,
        topScore: 42,
        openLoops: [],
      }),
      getLatest: (): MemoryItem[] => [latest],
      getRecentLogs: (): ActivityLogEntry[] => [{
        sourceClient: 'codex',
        project: 'the-vault',
        actionType: 'recall',
        message: 'Recall tested',
        timestamp: '2026-05-17T00:05:00.000Z',
      }],
      listProjects: (): Project[] => [{
        id: 1,
        name: 'the-vault',
        description: 'Local-first memory system.',
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-05-01T00:00:00.000Z',
      }],
    };

    const pack = await buildProjectContextPack(source, {
      project: 'the-vault',
      title: 'Plan local Codex workbench',
      prompt: 'Use local clients better.',
      maxRecall: 3,
      maxLatest: 2,
      maxLogs: 2,
    });

    expect(pack.project).toBe('the-vault');
    expect(pack.markdown).toContain('Project context (the-vault)');
    expect(pack.markdown).toContain('Project description: Local-first memory system.');
    expect(pack.markdown).toContain('vm_recalled');
    expect(pack.markdown).toContain('vm_latest');
    expect(pack.markdown).toContain('Recall tested');
    expect(pack.sections.map((section) => section.kind)).toEqual(['description', 'recall', 'latest', 'activity']);
  });

  it('returns an empty pack when project is missing', async () => {
    const pack = await buildProjectContextPack({
      recallContext: async () => ({
        summaries: [],
        decisions: [],
        plans: [],
        other: [],
        related: [],
        proactive: [],
        topMatches: [],
        totalCandidates: 0,
        topScore: 0,
        openLoops: [],
      }),
      getLatest: () => [],
      getRecentLogs: () => [],
      listProjects: () => [],
    }, {
      project: '',
      title: 'No project',
      prompt: 'No project',
    });

    expect(pack.markdown).toBe('');
    expect(pack.sections).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the context pack test and verify it fails**

Run:

```powershell
pnpm test -- packages/core/src/project-context-pack.test.ts
```

Expected result: FAIL because the service and types do not exist.

- [ ] **Step 3: Add context pack types**

In `packages/core/src/types/index.ts`, add this section after workspace registry types:

```ts
// ---------------------------------------------------------------------------
// Project Context Pack
// ---------------------------------------------------------------------------
export type ProjectContextPackSectionKind = 'description' | 'recall' | 'latest' | 'activity';

export interface ProjectContextPackSection {
  kind: ProjectContextPackSectionKind;
  title: string;
  content: string;
}

export interface ProjectContextPackInput {
  project: string;
  title?: string;
  prompt?: string;
  maxRecall?: number;
  maxLatest?: number;
  maxLogs?: number;
}

export interface ProjectContextPack {
  project: string;
  queryText: string;
  markdown: string;
  sections: ProjectContextPackSection[];
  generatedAt: string;
}
```

- [ ] **Step 4: Implement context pack service**

Create `packages/core/src/services/project-context-pack.service.ts`:

```ts
import { now } from '../utils/datetime.js';
import type {
  ActivityLogEntry,
  MemoryItem,
  MemoryPack,
  Project,
  ProjectContextPack,
  ProjectContextPackInput,
  ProjectContextPackSection,
  RecallQuery,
} from '../types/index.js';

export interface ProjectContextPackSource {
  recallContext(query: RecallQuery): Promise<MemoryPack> | MemoryPack;
  getLatest(project?: string, limit?: number): MemoryItem[];
  getRecentLogs(limit?: number, filters?: Record<string, string>): ActivityLogEntry[];
  listProjects(): Project[];
}

const DEFAULT_CONTEXT_RECALL_LIMIT = 4;
const DEFAULT_CONTEXT_LATEST_LIMIT = 4;
const DEFAULT_CONTEXT_LOG_LIMIT = 4;

export async function buildProjectContextPack(
  source: ProjectContextPackSource,
  input: ProjectContextPackInput,
): Promise<ProjectContextPack> {
  const project = input.project.trim();
  const generatedAt = now();
  const queryText = [input.title, input.prompt].filter(Boolean).join(' ').slice(0, 800);

  if (!project) {
    return {
      project: '',
      queryText,
      markdown: '',
      sections: [],
      generatedAt,
    };
  }

  const sections: ProjectContextPackSection[] = [];

  const description = safeProjectDescription(source, project);
  if (description) {
    sections.push({
      kind: 'description',
      title: 'Project description',
      content: `Project description: ${description}`,
    });
  }

  const recallSection = await safeRecallSection(source, {
    project,
    queryText,
    limit: clampPositive(input.maxRecall, DEFAULT_CONTEXT_RECALL_LIMIT),
  });
  if (recallSection) {
    sections.push(recallSection);
  }

  const latestSection = safeLatestSection(source, project, clampPositive(input.maxLatest, DEFAULT_CONTEXT_LATEST_LIMIT));
  if (latestSection) {
    sections.push(latestSection);
  }

  const activitySection = safeActivitySection(source, project, clampPositive(input.maxLogs, DEFAULT_CONTEXT_LOG_LIMIT));
  if (activitySection) {
    sections.push(activitySection);
  }

  const markdown = sections.length > 0
    ? [
        `Project context (${project}) - pulled from the Vault registry. Use this as ground truth before asking for more material:`,
        ...sections.map((section) => section.content),
      ].join('\n\n')
    : '';

  return {
    project,
    queryText,
    markdown,
    sections,
    generatedAt,
  };
}

function safeProjectDescription(source: ProjectContextPackSource, project: string): string {
  try {
    const entry = source.listProjects().find((candidate) => candidate.name === project);
    return entry?.description?.trim() || '';
  } catch {
    return '';
  }
}

async function safeRecallSection(
  source: ProjectContextPackSource,
  query: RecallQuery,
): Promise<ProjectContextPackSection | null> {
  try {
    const pack = await source.recallContext(query);
    const lines = pack.topMatches
      .slice(0, query.limit ?? DEFAULT_CONTEXT_RECALL_LIMIT)
      .map((match) => formatMemoryLine(match.item));

    return lines.length > 0
      ? {
          kind: 'recall',
          title: 'Top recalled items',
          content: `Top recalled items (ranked):\n${lines.join('\n')}`,
        }
      : null;
  } catch {
    return null;
  }
}

function safeLatestSection(
  source: ProjectContextPackSource,
  project: string,
  limit: number,
): ProjectContextPackSection | null {
  try {
    const lines = source.getLatest(project, limit).map(formatMemoryLine);
    return lines.length > 0
      ? {
          kind: 'latest',
          title: 'Most recent memories',
          content: `Most recent memories:\n${lines.join('\n')}`,
        }
      : null;
  } catch {
    return null;
  }
}

function safeActivitySection(
  source: ProjectContextPackSource,
  project: string,
  limit: number,
): ProjectContextPackSection | null {
  try {
    const logs = source.getRecentLogs(limit, { project });
    const lines = logs.map(formatLogLine);
    return lines.length > 0
      ? {
          kind: 'activity',
          title: 'Recent activity',
          content: `Recent activity (newest first):\n${lines.join('\n')}`,
        }
      : null;
  } catch {
    return null;
  }
}

function formatMemoryLine(item: MemoryItem): string {
  const relatedFiles = item.relatedFiles.length > 0
    ? ` Files: ${item.relatedFiles.slice(0, 3).join(', ')}.`
    : '';
  const nextSteps = item.nextSteps.length > 0
    ? ` Next: ${item.nextSteps.slice(0, 2).join(' | ')}.`
    : '';

  return `- ${item.itemUid} | ${item.title} | ${item.summary}${relatedFiles}${nextSteps}`;
}

function formatLogLine(log: ActivityLogEntry): string {
  const timestamp = log.timestamp ? `${log.timestamp} ` : '';
  const message = log.message || `${log.actionType} event`;
  return `- ${timestamp}${log.sourceClient}/${log.actionType}: ${message}`;
}

function clampPositive(value: number | undefined, fallback: number): number {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallback;
  }
  return Math.max(1, Math.floor(numericValue));
}
```

- [ ] **Step 5: Add Vault wrapper**

In `packages/core/src/vault.ts`, add:

```ts
import { buildProjectContextPack } from './services/project-context-pack.service.js';
```

Add imported types:

```ts
  ProjectContextPack,
  ProjectContextPackInput,
```

Add this method inside `Vault` near recall methods:

```ts
  async buildProjectContextPack(input: ProjectContextPackInput): Promise<ProjectContextPack> {
    return buildProjectContextPack(this, input);
  }
```

- [ ] **Step 6: Reuse the service in task executor**

In `packages/core/src/services/task-executor.ts`, import:

```ts
import { buildProjectContextPack } from './project-context-pack.service.js';
```

Replace the body of `private async buildProjectContextBlock(task: VaultTask): Promise<string>` with:

```ts
    const project = task.project?.trim();
    if (!project || task.context?.skipProjectContext === true) {
      return '';
    }

    const pack = await buildProjectContextPack(this.vault, {
      project,
      title: task.title,
      prompt: task.prompt,
      maxRecall: PROJECT_CONTEXT_RECALL_LIMIT,
      maxLatest: PROJECT_CONTEXT_RECENT_MEMORIES,
      maxLogs: PROJECT_CONTEXT_RECENT_LOGS,
    });

    return pack.markdown;
```

Keep the existing constants at the top of `task-executor.ts`. Remove helper functions that become unused only after TypeScript reports them unused.

- [ ] **Step 7: Run focused tests**

Run:

```powershell
pnpm test -- packages/core/src/project-context-pack.test.ts packages/core/src/workspace-registry.test.ts
```

Expected result: PASS.

- [ ] **Step 8: Run task executor tests**

Run:

```powershell
pnpm test -- packages/core/src/task-executor.test.ts
```

Expected result: PASS. If this file name differs, run `rg -n "TaskExecutor" packages/core/src tests` and run the matching Vitest file.

- [ ] **Step 9: Commit shared context pack**

Run:

```powershell
git add packages/core/src/types/index.ts packages/core/src/services/project-context-pack.service.ts packages/core/src/project-context-pack.test.ts packages/core/src/services/task-executor.ts packages/core/src/vault.ts
git commit -m "Share project context packs"
```

---

## Task 3: Local Workbench Launch Specs

**Files:**
- Create: `packages/core/src/services/local-workbench-launch.service.ts`
- Modify: `packages/core/src/types/index.ts`
- Modify: `packages/core/src/vault.ts`
- Test: `packages/core/src/local-workbench-launch.test.ts`

- [ ] **Step 1: Write failing launch spec tests**

Create `packages/core/src/local-workbench-launch.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildLocalWorkbenchLaunch } from './services/local-workbench-launch.service.js';

describe('local workbench launch service', () => {
  it('builds a Codex CLI launch spec with repo cwd and context pack path', () => {
    const launch = buildLocalWorkbenchLaunch({
      adapterType: 'codex_local',
      workspacePath: 'C:\\Users\\Mini\\Desktop\\Projects\\the-vault',
      contextPackPath: 'C:\\tmp\\vault-context.md',
      model: 'gpt-5.2',
      effort: 'medium',
      prompt: 'Review the plan.',
    });

    expect(launch.command).toBe('codex');
    expect(launch.args).toContain('exec');
    expect(launch.args).toContain('--skip-git-repo-check');
    expect(launch.displayCommand).toContain("Set-Location -LiteralPath 'C:\\Users\\Mini\\Desktop\\Projects\\the-vault'");
    expect(launch.displayCommand).toContain("Get-Content -Raw -LiteralPath 'C:\\tmp\\vault-context.md' | codex exec");
    expect(launch.displayCommand).toContain('--model gpt-5.2');
    expect(launch.displayCommand).toContain('--config model_reasoning_effort=medium');
  });

  it('builds a Claude Code launch spec with stream json output and model when selected', () => {
    const launch = buildLocalWorkbenchLaunch({
      adapterType: 'claude_local',
      workspacePath: 'C:\\Users\\Mini\\Desktop\\Projects\\whisphry',
      contextPackPath: 'C:\\tmp\\vault-context.md',
      model: 'claude-sonnet-4-5',
      effort: '',
      prompt: 'Fix the failing tests.',
    });

    expect(launch.command).toBe('claude');
    expect(launch.args).toEqual(['--print', '-', '--output-format', 'stream-json', '--verbose', '--model', 'claude-sonnet-4-5']);
    expect(launch.displayCommand).toContain("Set-Location -LiteralPath 'C:\\Users\\Mini\\Desktop\\Projects\\whisphry'");
    expect(launch.displayCommand).toContain("Get-Content -Raw -LiteralPath 'C:\\tmp\\vault-context.md' | claude --print - --output-format stream-json --verbose --model claude-sonnet-4-5");
  });

  it('rejects untrusted adapter types', () => {
    expect(() => buildLocalWorkbenchLaunch({
      adapterType: 'api' as never,
      workspacePath: 'C:\\repo',
      contextPackPath: 'C:\\tmp\\pack.md',
      model: '',
      effort: '',
      prompt: 'Nope',
    })).toThrow('Unsupported local adapter type.');
  });
});
```

- [ ] **Step 2: Run the launch spec test and verify it fails**

Run:

```powershell
pnpm test -- packages/core/src/local-workbench-launch.test.ts
```

Expected result: FAIL because the service and types do not exist.

- [ ] **Step 3: Add launch types**

In `packages/core/src/types/index.ts`, add this section after project context pack types:

```ts
// ---------------------------------------------------------------------------
// Local Workbench Launch
// ---------------------------------------------------------------------------
export type LocalWorkbenchAdapterType = 'claude_local' | 'codex_local';

export interface LocalWorkbenchLaunchInput {
  adapterType: LocalWorkbenchAdapterType;
  workspacePath: string;
  contextPackPath: string;
  model?: string;
  effort?: string;
  prompt: string;
}

export interface LocalWorkbenchLaunchSpec {
  adapterType: LocalWorkbenchAdapterType;
  command: string;
  args: string[];
  workspacePath: string;
  contextPackPath: string;
  displayCommand: string;
}
```

- [ ] **Step 4: Implement launch spec builder**

Create `packages/core/src/services/local-workbench-launch.service.ts`:

```ts
import type {
  LocalWorkbenchLaunchInput,
  LocalWorkbenchLaunchSpec,
} from '../types/index.js';

export function buildLocalWorkbenchLaunch(input: LocalWorkbenchLaunchInput): LocalWorkbenchLaunchSpec {
  const adapterType = input.adapterType;
  const workspacePath = input.workspacePath.trim();
  const contextPackPath = input.contextPackPath.trim();
  const model = input.model?.trim() || '';
  const effort = input.effort?.trim() || '';

  if (adapterType !== 'claude_local' && adapterType !== 'codex_local') {
    throw new Error('Unsupported local adapter type.');
  }

  if (!workspacePath) {
    throw new Error('Workspace path is required.');
  }

  if (!contextPackPath) {
    throw new Error('Context pack path is required.');
  }

  const command = adapterType === 'claude_local' ? 'claude' : 'codex';
  const args = adapterType === 'claude_local'
    ? buildClaudeArgs(model)
    : buildCodexArgs(model, effort);

  return {
    adapterType,
    command,
    args,
    workspacePath,
    contextPackPath,
    displayCommand: [
      `Set-Location -LiteralPath ${quotePowerShell(workspacePath)}`,
      `${buildPromptPipe(contextPackPath)} | ${[command, ...args].map(quoteCommandPart).join(' ')}`,
    ].join('; '),
  };
}

function buildClaudeArgs(model: string): string[] {
  const args = ['--print', '-', '--output-format', 'stream-json', '--verbose'];
  if (model) {
    args.push('--model', model);
  }
  return args;
}

function buildCodexArgs(model: string, effort: string): string[] {
  const args = ['exec', '--json', '--skip-git-repo-check', '--color', 'never'];
  if (model) {
    args.push('--model', model);
  }
  if (effort) {
    args.push('--config', `model_reasoning_effort=${effort}`);
  }
  args.push('-');
  return args;
}

function buildPromptPipe(contextPackPath: string): string {
  return `Get-Content -Raw -LiteralPath ${quotePowerShell(contextPackPath)}`;
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function quoteCommandPart(value: string): string {
  return /^[A-Za-z0-9_.:=/-]+$/.test(value) ? value : quotePowerShell(value);
}
```

- [ ] **Step 5: Add Vault wrapper**

In `packages/core/src/vault.ts`, add:

```ts
import { buildLocalWorkbenchLaunch } from './services/local-workbench-launch.service.js';
```

Add imported types:

```ts
  LocalWorkbenchLaunchInput,
  LocalWorkbenchLaunchSpec,
```

Add this method inside `Vault` near the workspace methods:

```ts
  buildLocalWorkbenchLaunch(input: LocalWorkbenchLaunchInput): LocalWorkbenchLaunchSpec {
    return buildLocalWorkbenchLaunch(input);
  }
```

- [ ] **Step 6: Run launch tests**

Run:

```powershell
pnpm test -- packages/core/src/local-workbench-launch.test.ts
```

Expected result: PASS.

- [ ] **Step 7: Commit launch spec builder**

Run:

```powershell
git add packages/core/src/types/index.ts packages/core/src/services/local-workbench-launch.service.ts packages/core/src/local-workbench-launch.test.ts packages/core/src/vault.ts
git commit -m "Add local workbench launch specs"
```

---

## Task 4: Electron IPC and Context Pack Files

**Files:**
- Modify: `packages/desktop/electron/main.ts`
- Modify: `packages/desktop/electron/preload.ts`
- Modify: `packages/desktop/src/types.d.ts`

- [ ] **Step 1: Add renderer-facing types**

In `packages/desktop/src/types.d.ts`, add these interfaces near existing local adapter types:

```ts
  interface ProjectWorkspaceConfig {
    project: string;
    workspacePath: string;
    trusted: boolean;
    gitRootDetected: boolean;
    lastValidatedAt: string;
    notes: string | null;
  }

  interface SetProjectWorkspaceInput {
    project: string;
    workspacePath: string;
    trusted?: boolean;
    notes?: string | null;
  }

  interface WorkspaceValidationResult {
    ok: boolean;
    workspacePath: string;
    exists: boolean;
    isDirectory: boolean;
    gitRootDetected: boolean;
    message: string;
  }

  interface ProjectContextPackSection {
    kind: 'description' | 'recall' | 'latest' | 'activity';
    title: string;
    content: string;
  }

  interface ProjectContextPack {
    project: string;
    queryText: string;
    markdown: string;
    sections: ProjectContextPackSection[];
    generatedAt: string;
  }

  interface PrepareLocalWorkbenchRunInput {
    project: string;
    title: string;
    prompt: string;
    adapterType: LocalAdapterType;
    model?: string;
    effort?: string;
  }

  interface PreparedLocalWorkbenchRun {
    runId: string;
    project: string;
    title: string;
    prompt: string;
    workspace: ProjectWorkspaceConfig;
    contextPack: ProjectContextPack;
    contextPackPath: string;
    launch: {
      adapterType: LocalAdapterType;
      command: string;
      args: string[];
      workspacePath: string;
      contextPackPath: string;
      displayCommand: string;
    };
    createdAt: string;
  }
```

Extend `VaultAPI` in the same file:

```ts
    listProjectWorkspaces: () => Promise<VaultResponse<ProjectWorkspaceConfig[]>>;
    getProjectWorkspace: (project: string) => Promise<VaultResponse<ProjectWorkspaceConfig | null>>;
    setProjectWorkspace: (input: SetProjectWorkspaceInput) => Promise<VaultResponse<ProjectWorkspaceConfig>>;
    removeProjectWorkspace: (project: string) => Promise<VaultResponse<ProjectWorkspaceConfig[]>>;
    validateWorkspacePath: (workspacePath: string) => Promise<VaultResponse<WorkspaceValidationResult>>;
    buildProjectContextPack: (input: ProjectContextPackInput) => Promise<VaultResponse<ProjectContextPack>>;
    prepareLocalWorkbenchRun: (input: PrepareLocalWorkbenchRunInput) => Promise<VaultResponse<PreparedLocalWorkbenchRun>>;
```

If `ProjectContextPackInput` is not yet declared in `types.d.ts`, add:

```ts
  interface ProjectContextPackInput {
    project: string;
    title?: string;
    prompt?: string;
    maxRecall?: number;
    maxLatest?: number;
    maxLogs?: number;
  }
```

- [ ] **Step 2: Add preload methods**

In `packages/desktop/electron/preload.ts`, add these entries to the object passed to `contextBridge.exposeInMainWorld`:

```ts
  listProjectWorkspaces: () => ipcRenderer.invoke('vault:listProjectWorkspaces'),
  getProjectWorkspace: (project: unknown) => ipcRenderer.invoke('vault:getProjectWorkspace', project),
  setProjectWorkspace: (input: unknown) => ipcRenderer.invoke('vault:setProjectWorkspace', input),
  removeProjectWorkspace: (project: unknown) => ipcRenderer.invoke('vault:removeProjectWorkspace', project),
  validateWorkspacePath: (workspacePath: unknown) => ipcRenderer.invoke('vault:validateWorkspacePath', workspacePath),
  buildProjectContextPack: (input: unknown) => ipcRenderer.invoke('vault:buildProjectContextPack', input),
  prepareLocalWorkbenchRun: (input: unknown) => ipcRenderer.invoke('vault:prepareLocalWorkbenchRun', input),
```

- [ ] **Step 3: Add IPC helpers in main process**

In `packages/desktop/electron/main.ts`, add imports near other Node imports:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
```

Add these helper types near existing local adapter stored types:

```ts
type PrepareLocalWorkbenchRunInput = {
  project?: unknown;
  title?: unknown;
  prompt?: unknown;
  adapterType?: unknown;
  model?: unknown;
  effort?: unknown;
};
```

Add this helper near other helper functions:

```ts
async function prepareLocalWorkbenchRun(input: PrepareLocalWorkbenchRunInput) {
  const project = typeof input?.project === 'string' ? input.project.trim() : '';
  const title = typeof input?.title === 'string' ? input.title.trim() : '';
  const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : '';
  const adapterType = input?.adapterType === 'claude_local' || input?.adapterType === 'codex_local'
    ? input.adapterType
    : null;
  const model = typeof input?.model === 'string' ? input.model.trim() : '';
  const effort = typeof input?.effort === 'string' ? input.effort.trim() : '';

  if (!project) {
    throw new Error('Project is required.');
  }
  if (!title) {
    throw new Error('Task title is required.');
  }
  if (!prompt) {
    throw new Error('Task prompt is required.');
  }
  if (!adapterType) {
    throw new Error('Choose Claude Code or Codex CLI.');
  }

  const workspace = vault.getProjectWorkspace(project);
  if (!workspace) {
    throw new Error('Add a workspace path for this project before preparing a local run.');
  }
  if (!workspace.trusted) {
    throw new Error('Mark the workspace as trusted before preparing a local run.');
  }

  const validation = vault.validateWorkspacePath(workspace.workspacePath);
  if (!validation.ok) {
    throw new Error(validation.message);
  }

  const contextPack = await vault.buildProjectContextPack({
    project,
    title,
    prompt,
    maxRecall: 4,
    maxLatest: 4,
    maxLogs: 4,
  });
  const runId = randomUUID();
  const createdAt = new Date().toISOString();
  const workbenchDir = join(vault.getVaultRoot(), '.workbench-runs', runId);
  await mkdir(workbenchDir, { recursive: true });
  const contextPackPath = join(workbenchDir, 'context-pack.md');
  const contextFile = [
    `# ${title}`,
    '',
    `Project: ${project}`,
    `Created: ${createdAt}`,
    '',
    '## User Request',
    '',
    prompt,
    '',
    '## Vault Context',
    '',
    contextPack.markdown || 'No Vault context matched this request.',
  ].join('\n');
  await writeFile(contextPackPath, contextFile, 'utf8');

  const launch = vault.buildLocalWorkbenchLaunch({
    adapterType,
    workspacePath: workspace.workspacePath,
    contextPackPath,
    model,
    effort,
    prompt,
  });

  return {
    runId,
    project,
    title,
    prompt,
    workspace,
    contextPack,
    contextPackPath,
    launch,
    createdAt,
  };
}
```

- [ ] **Step 4: Add IPC handlers**

In `registerIpcHandlers()`, near local adapter handlers, add:

```ts
  ipcMain.handle('vault:listProjectWorkspaces', () => {
    try {
      return { success: true, data: vault.listProjectWorkspaces() };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:getProjectWorkspace', (_, project) => {
    try {
      return { success: true, data: vault.getProjectWorkspace(String(project || '')) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:setProjectWorkspace', (_, input) => {
    try {
      return { success: true, data: vault.setProjectWorkspace(input) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:removeProjectWorkspace', (_, project) => {
    try {
      return { success: true, data: vault.removeProjectWorkspace(String(project || '')) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:validateWorkspacePath', (_, workspacePath) => {
    try {
      return { success: true, data: vault.validateWorkspacePath(String(workspacePath || '')) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:buildProjectContextPack', async (_, input) => {
    try {
      return { success: true, data: await vault.buildProjectContextPack(input) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:prepareLocalWorkbenchRun', async (_, input) => {
    try {
      return { success: true, data: await prepareLocalWorkbenchRun(input) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });
```

- [ ] **Step 5: Type-check desktop IPC**

Run:

```powershell
pnpm --filter @the-vault/desktop exec tsc --noEmit
```

Expected result: PASS.

- [ ] **Step 6: Commit IPC workbench bridge**

Run:

```powershell
git add packages/desktop/electron/main.ts packages/desktop/electron/preload.ts packages/desktop/src/types.d.ts
git commit -m "Add local workbench IPC bridge"
```

---

## Task 5: Agent Workbench UI

**Files:**
- Create: `packages/desktop/src/components/AgentWorkbenchView.tsx`
- Modify: `packages/desktop/src/components/VaultAgentView.tsx`
- Modify: `packages/desktop/src/app.css`

- [ ] **Step 1: Add the new Workbench tab mount**

In `packages/desktop/src/components/VaultAgentView.tsx`, change:

```ts
type VaultAgentSection = 'runtime' | 'queue' | 'activity';
```

to:

```ts
type VaultAgentSection = 'runtime' | 'queue' | 'workbench' | 'activity';
```

Add import:

```ts
import { AgentWorkbenchView } from './AgentWorkbenchView.js';
```

Add a page mode button between Queue and Vault activity:

```tsx
        <button
          type="button"
          className={`page-mode-button ${activeSection === 'workbench' ? 'page-mode-button-active' : ''}`}
          onClick={() => setActiveSection('workbench')}
        >
          <span className="page-mode-icon"><Terminal size={18} /></span>
          <span className="page-mode-copy">
            <span className="page-mode-label">Workbench</span>
            <span className="page-mode-description">Map projects to repos, preview Vault context, and prepare local Codex or Claude launches.</span>
          </span>
        </button>
```

Add this render block before the activity block:

```tsx
      {activeSection === 'workbench' ? (
        <AgentWorkbenchView
          projects={projects.map((project) => project.name)}
          adapterConfig={adapterConfig}
        />
      ) : null}
```

- [ ] **Step 2: Create the Workbench component**

Create `packages/desktop/src/components/AgentWorkbenchView.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clipboard, Database, FolderGit2, Play, RefreshCw, Save, ShieldCheck, Terminal, XCircle } from 'lucide-react';

type Props = {
  projects: string[];
  adapterConfig?: LocalAdapterConfig;
};

export function AgentWorkbenchView({ projects, adapterConfig }: Props) {
  const [workspaces, setWorkspaces] = useState<ProjectWorkspaceConfig[]>([]);
  const [project, setProject] = useState(projects[0] || '');
  const [workspacePath, setWorkspacePath] = useState('');
  const [trusted, setTrusted] = useState(false);
  const [notes, setNotes] = useState('');
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [adapterType, setAdapterType] = useState<LocalAdapterType>(adapterConfig?.type || 'codex_local');
  const [model, setModel] = useState(adapterConfig?.model || '');
  const [effort, setEffort] = useState(adapterConfig?.effort || '');
  const [preparedRun, setPreparedRun] = useState<PreparedLocalWorkbenchRun | null>(null);
  const [resultSummary, setResultSummary] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const currentWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.project === project) || null,
    [project, workspaces],
  );

  useEffect(() => {
    void refreshWorkspaces();
  }, []);

  useEffect(() => {
    if (currentWorkspace) {
      setWorkspacePath(currentWorkspace.workspacePath);
      setTrusted(currentWorkspace.trusted);
      setNotes(currentWorkspace.notes || '');
    } else {
      setWorkspacePath('');
      setTrusted(false);
      setNotes('');
    }
  }, [currentWorkspace]);

  async function refreshWorkspaces() {
    const response = await window.vaultAPI.listProjectWorkspaces();
    if (!response.success || !response.data) {
      setMessage(response.error || 'Failed to load workspaces.');
      return;
    }
    setWorkspaces(response.data);
  }

  async function saveWorkspace() {
    if (!project.trim() || !workspacePath.trim()) {
      setMessage('Choose a project and an absolute workspace path.');
      return;
    }

    setBusy(true);
    try {
      const response = await window.vaultAPI.setProjectWorkspace({
        project,
        workspacePath,
        trusted,
        notes,
      });
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to save workspace.');
      }
      setMessage(`Workspace saved for ${response.data.project}.`);
      await refreshWorkspaces();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save workspace.');
    } finally {
      setBusy(false);
    }
  }

  async function prepareRun() {
    if (!project.trim() || !title.trim() || !prompt.trim()) {
      setMessage('Choose a project, title the task, and write the local-agent request.');
      return;
    }

    setBusy(true);
    try {
      const response = await window.vaultAPI.prepareLocalWorkbenchRun({
        project,
        title,
        prompt,
        adapterType,
        model,
        effort,
      });
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to prepare local run.');
      }
      setPreparedRun(response.data);
      setMessage('Local run prepared.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to prepare local run.');
    } finally {
      setBusy(false);
    }
  }

  async function copyText(value: string, successMessage: string) {
    await navigator.clipboard.writeText(value);
    setMessage(successMessage);
  }

  async function saveResultMemory() {
    if (!preparedRun || !resultSummary.trim()) {
      setMessage('Prepare a run and paste the result summary first.');
      return;
    }

    const response = await window.vaultAPI.saveMemory({
      project: preparedRun.project,
      title: `${preparedRun.title} - local ${adapterType === 'codex_local' ? 'Codex' : 'Claude'} result`,
      memoryType: 'session',
      subject: preparedRun.title,
      summary: resultSummary.trim(),
      content: [
        `Local workbench run: ${preparedRun.runId}`,
        `Workspace: ${preparedRun.workspace.workspacePath}`,
        `Context pack: ${preparedRun.contextPackPath}`,
        '',
        resultSummary.trim(),
      ].join('\n'),
      sourceApp: 'manual',
      keywords: ['local-workbench', adapterType, preparedRun.project],
      relatedFiles: [preparedRun.workspace.workspacePath, preparedRun.contextPackPath],
    });

    if (!response.success || !response.data) {
      setMessage(response.error || 'Failed to save result memory.');
      return;
    }

    setMessage(`Saved result memory ${response.data.item.itemUid}.`);
    setResultSummary('');
  }

  return (
    <div className="agent-workbench-grid">
      <section className="panel agent-workbench-panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Project workspace</div>
            <div className="panel-subtitle">A trusted absolute repo path tells Codex or Claude where to work.</div>
          </div>
          <FolderGit2 size={18} />
        </div>

        <label className="field">
          <span className="field-label">Project</span>
          <select value={project} onChange={(event) => setProject(event.target.value)}>
            {projects.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">Repository path</span>
          <input value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} placeholder="C:\\Users\\Mini\\Desktop\\Projects\\the-vault" />
        </label>

        <label className="checkbox-row">
          <input type="checkbox" checked={trusted} onChange={(event) => setTrusted(event.target.checked)} />
          <span>Trusted workspace</span>
        </label>

        <label className="field">
          <span className="field-label">Notes</span>
          <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Main repo, release branch, or worktree purpose" />
        </label>

        <div className="inline-actions">
          <button type="button" className="header-button" onClick={() => void refreshWorkspaces()} disabled={busy}>
            <RefreshCw size={14} />
            <span>Refresh</span>
          </button>
          <button type="button" className="primary-button" onClick={() => void saveWorkspace()} disabled={busy}>
            <ShieldCheck size={14} />
            <span>Save workspace</span>
          </button>
        </div>
      </section>

      <section className="panel agent-workbench-panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Local run setup</div>
            <div className="panel-subtitle">Prepare one context pack and one command for the selected local client.</div>
          </div>
          <Terminal size={18} />
        </div>

        <label className="field">
          <span className="field-label">Task title</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Plan the local client workbench" />
        </label>

        <label className="field">
          <span className="field-label">Request</span>
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={6} placeholder="Describe the task for Codex or Claude..." />
        </label>

        <div className="form-grid two">
          <label className="field">
            <span className="field-label">Client</span>
            <select value={adapterType} onChange={(event) => setAdapterType(event.target.value as LocalAdapterType)}>
              <option value="codex_local">Codex CLI</option>
              <option value="claude_local">Claude Code</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Model</span>
            <input value={model} onChange={(event) => setModel(event.target.value)} placeholder={adapterType === 'codex_local' ? 'gpt-5.2' : 'claude-sonnet-4-5'} />
          </label>
        </div>

        {adapterType === 'codex_local' ? (
          <label className="field">
            <span className="field-label">Reasoning effort</span>
            <input value={effort} onChange={(event) => setEffort(event.target.value)} placeholder="medium" />
          </label>
        ) : null}

        <button type="button" className="primary-button" onClick={() => void prepareRun()} disabled={busy}>
          <Play size={14} />
          <span>{busy ? 'Preparing...' : 'Prepare local run'}</span>
        </button>
      </section>

      <section className="panel agent-workbench-panel agent-workbench-wide">
        <div className="panel-header">
          <div>
            <div className="panel-title">Prepared context</div>
            <div className="panel-subtitle">Review what Vault will give the local client before launching it.</div>
          </div>
          {preparedRun ? <CheckCircle2 size={18} /> : <Database size={18} />}
        </div>

        {preparedRun ? (
          <>
            <div className="detail-grid">
              <span><span className="detail-label">Run</span><strong>{preparedRun.runId}</strong></span>
              <span><span className="detail-label">Workspace</span><strong>{preparedRun.workspace.workspacePath}</strong></span>
              <span><span className="detail-label">Context file</span><strong>{preparedRun.contextPackPath}</strong></span>
            </div>
            <pre className="agent-workbench-preview">{preparedRun.contextPack.markdown || 'No Vault context matched this request.'}</pre>
            <div className="inline-actions">
              <button type="button" className="header-button" onClick={() => void copyText(preparedRun.contextPack.markdown, 'Context copied.')}>
                <Clipboard size={14} />
                <span>Copy context</span>
              </button>
              <button type="button" className="header-button" onClick={() => void copyText(preparedRun.launch.displayCommand, 'Launch command copied.')}>
                <Terminal size={14} />
                <span>Copy command</span>
              </button>
            </div>
          </>
        ) : (
          <div className="empty-state">Prepare a local run to preview the context pack and command.</div>
        )}
      </section>

      <section className="panel agent-workbench-panel agent-workbench-wide">
        <div className="panel-header">
          <div>
            <div className="panel-title">Capture result</div>
            <div className="panel-subtitle">Paste the local client outcome back into Vault when the terminal run finishes.</div>
          </div>
          <Save size={18} />
        </div>
        <textarea value={resultSummary} onChange={(event) => setResultSummary(event.target.value)} rows={5} placeholder="Paste the completed local-agent result or handoff summary..." />
        <div className="inline-actions">
          <button type="button" className="primary-button" onClick={() => void saveResultMemory()} disabled={!preparedRun || !resultSummary.trim()}>
            <Save size={14} />
            <span>Save result memory</span>
          </button>
        </div>
        {message ? (
          <div className={`status-banner ${message.toLowerCase().includes('failed') || message.toLowerCase().includes('required') ? 'status-banner-error' : 'status-banner-ok'}`}>
            {message.toLowerCase().includes('failed') ? <XCircle size={14} /> : <CheckCircle2 size={14} />}
            <span>{message}</span>
          </div>
        ) : null}
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Add Workbench styles**

In `packages/desktop/src/app.css`, add:

```css
.agent-workbench-grid {
  display: grid;
  grid-template-columns: minmax(280px, 0.9fr) minmax(320px, 1.1fr);
  gap: 16px;
}

.agent-workbench-panel {
  min-width: 0;
}

.agent-workbench-wide {
  grid-column: 1 / -1;
}

.agent-workbench-preview {
  max-height: 360px;
  overflow: auto;
  margin: 14px 0 0;
  padding: 14px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  line-height: 1.55;
}

@media (max-width: 980px) {
  .agent-workbench-grid {
    grid-template-columns: 1fr;
  }

  .agent-workbench-wide {
    grid-column: auto;
  }
}
```

- [ ] **Step 4: Type-check the UI**

Run:

```powershell
pnpm --filter @the-vault/desktop exec tsc --noEmit
```

Expected result: PASS.

- [ ] **Step 5: Build the desktop renderer**

Run:

```powershell
pnpm --filter @the-vault/desktop exec vite build
```

Expected result: PASS.

- [ ] **Step 6: Commit Workbench UI**

Run:

```powershell
git add packages/desktop/src/components/AgentWorkbenchView.tsx packages/desktop/src/components/VaultAgentView.tsx packages/desktop/src/app.css
git commit -m "Add Vault Agent local workbench"
```

---

## Task 6: Manual Result Capture Hardening

**Files:**
- Modify: `packages/desktop/src/components/AgentWorkbenchView.tsx`
- Modify: `packages/desktop/electron/main.ts`
- Modify: `packages/core/src/types/index.ts`

- [ ] **Step 1: Persist recent prepared runs in settings**

In `packages/core/src/types/index.ts`, add:

```ts
export interface LocalWorkbenchRecentRun {
  runId: string;
  project: string;
  title: string;
  adapterType: LocalWorkbenchAdapterType;
  workspacePath: string;
  contextPackPath: string;
  createdAt: string;
}
```

In `packages/desktop/electron/main.ts`, after `const launch = vault.buildLocalWorkbenchLaunch(...)`, add:

```ts
  const recentRuns = Array.isArray(vault.getSetting('local_workbench_recent_runs'))
    ? vault.getSetting('local_workbench_recent_runs') as unknown[]
    : [];
  const nextRecentRuns = [
    {
      runId,
      project,
      title,
      adapterType,
      workspacePath: workspace.workspacePath,
      contextPackPath,
      createdAt,
    },
    ...recentRuns,
  ].slice(0, 20);
  vault.setSetting('local_workbench_recent_runs', nextRecentRuns);
```

- [ ] **Step 2: Add a task metadata note when saving results**

In `AgentWorkbenchView.tsx`, change the `content` passed to `saveMemory` in `saveResultMemory()` to:

```ts
      content: [
        `Local workbench run: ${preparedRun.runId}`,
        `Adapter: ${adapterType}`,
        `Workspace: ${preparedRun.workspace.workspacePath}`,
        `Context pack: ${preparedRun.contextPackPath}`,
        `Launch: ${preparedRun.launch.displayCommand}`,
        '',
        resultSummary.trim(),
      ].join('\n'),
```

Change `keywords` to:

```ts
      keywords: ['local-workbench', adapterType, preparedRun.project, preparedRun.runId],
```

- [ ] **Step 3: Type-check and build**

Run:

```powershell
pnpm --filter @the-vault/desktop exec tsc --noEmit
pnpm --filter @the-vault/desktop exec vite build
```

Expected result: both commands PASS.

- [ ] **Step 4: Commit result capture hardening**

Run:

```powershell
git add packages/core/src/types/index.ts packages/desktop/electron/main.ts packages/desktop/src/components/AgentWorkbenchView.tsx
git commit -m "Track local workbench run results"
```

---

## Task 7: Final Verification

**Files:**
- No new files
- Verify all modified packages

- [ ] **Step 1: Run core and desktop tests**

Run:

```powershell
pnpm test
```

Expected result: all Vitest files PASS.

- [ ] **Step 2: Run lint/type checks**

Run:

```powershell
pnpm lint
```

Expected result: PASS.

- [ ] **Step 3: Build desktop renderer**

Run:

```powershell
pnpm --filter @the-vault/desktop exec vite build
```

Expected result: PASS.

- [ ] **Step 4: Manual Electron smoke test**

Run:

```powershell
pnpm --filter @the-vault/desktop dev
```

Expected manual checks:

- Vault Agent shows four modes: Runtime, Queue, Workbench, Vault activity.
- Workbench lets the user pick a Vault project and save an absolute repo path outside or inside `C:\Users\Mini\Desktop\Projects\the-vault`.
- Untrusted workspace cannot prepare a run.
- Trusted workspace prepares a context pack file under the Vault root `.workbench-runs/<runId>/context-pack.md`.
- Copy command produces a PowerShell command that starts in the configured repo path and pipes the context pack into Codex or Claude.
- Pasted result summary saves a memory with `local-workbench`, adapter type, project, and run id keywords.

- [ ] **Step 5: Save Vault handoff memory**

After verification, save a Vault memory with:

```json
{
  "project": "the-vault",
  "memory_type": "session",
  "routine_type": "implementation",
  "source_app": "codex",
  "title": "Implemented local client workbench",
  "subject": "Vault Agent Workbench for local Codex and Claude launches",
  "summary": "Added project workspace registry, shared project context packs, copy-ready local launch specs, and a Vault Agent Workbench UI for preparing manual Codex CLI or Claude Code runs from trusted repo paths.",
  "keywords": ["AgentWorkbenchView", "project_workspace_registry", "buildProjectContextPack", "local-workbench", "Codex CLI", "Claude Code"],
  "related_files": [
    "packages/core/src/services/workspace-registry.service.ts",
    "packages/core/src/services/project-context-pack.service.ts",
    "packages/core/src/services/local-workbench-launch.service.ts",
    "packages/desktop/src/components/AgentWorkbenchView.tsx",
    "packages/desktop/src/components/VaultAgentView.tsx"
  ],
  "next_steps": [
    "Decide whether managed terminal spawning is worth adding after manual local runs have real usage."
  ]
}
```

- [ ] **Step 6: Final commit if verification changed files**

If verification or smoke testing required fixes, commit them:

```powershell
git status --short
git add packages/core/src/types/index.ts packages/core/src/config/settings.ts packages/core/src/services/workspace-registry.service.ts packages/core/src/services/project-context-pack.service.ts packages/core/src/services/local-workbench-launch.service.ts packages/core/src/workspace-registry.test.ts packages/core/src/project-context-pack.test.ts packages/core/src/local-workbench-launch.test.ts packages/core/src/vault.ts packages/core/src/services/task-executor.ts packages/desktop/electron/main.ts packages/desktop/electron/preload.ts packages/desktop/src/types.d.ts packages/desktop/src/components/AgentWorkbenchView.tsx packages/desktop/src/components/VaultAgentView.tsx packages/desktop/src/app.css
git commit -m "Fix local workbench verification issues"
```

Do not commit unrelated files.

---

## Phase 2 Decision Gate

Start a separate plan for managed local runs only after the manual Workbench has been used on real tasks.

Promote to a managed runner only if at least two of these are true:

- The user repeatedly copies launch commands for the same project.
- The user wants live status in Vault more than native terminal control.
- Result capture feels too manual after several runs.
- Local runs need queue-style history, cancellation, or run locks.

If Phase 2 is justified, the next plan should add run records and process supervision with explicit kill controls. It should not add multi-agent orchestration until single-run history and cancellation are reliable.

## Self-Review Notes

- Spec coverage: The plan covers external repo paths, local Codex/Claude usage, context injection, UI usefulness, and avoids a complex terminal layer in Phase 1.
- Placeholder scan: No task relies on an unspecified handler, type, or command. Every new type and function referenced by later tasks is introduced earlier.
- Type consistency: Renderer `LocalAdapterType` remains compatible with core `LocalWorkbenchAdapterType` values: `claude_local` and `codex_local`.
- Risk control: Managed process execution is intentionally excluded from this implementation plan, so the first release can validate the user workflow without adding terminal lifecycle complexity.
