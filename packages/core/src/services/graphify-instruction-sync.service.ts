import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export const GRAPHIFY_INSTRUCTION_START_MARKER = '<!-- vault-graphify:start -->';
export const GRAPHIFY_INSTRUCTION_END_MARKER = '<!-- vault-graphify:end -->';

export const DEFAULT_GRAPHIFY_INSTRUCTION_BODY = [
  '## Vault Graphify Extension',
  '',
  'For project architecture, code impact, symbol/file relationships, and "what connects X to Y" questions, call Vault Graphify MCP tools before broad search or large file reads.',
  '',
  'Use Vault memory recall for decisions, handoffs, open loops, and historical project context.',
  '',
  'Combine both when planning code changes, reviewing impact, or preparing implementation handoffs.',
].join('\n');

export type GraphifyInstructionTarget = 'claude' | 'codex';
export type GraphifyInstructionSyncOperation = 'apply' | 'remove';

export interface GraphifyInstructionSyncInput {
  projectRoot: string;
  target: GraphifyInstructionTarget;
  instructionPath?: string;
  operation?: GraphifyInstructionSyncOperation;
  sectionContent?: string;
}

export interface BuildGraphifyInstructionSyncPreviewInput extends GraphifyInstructionSyncInput {
  existingContent: string | null;
}

export interface GraphifyInstructionSyncPreview {
  target: GraphifyInstructionTarget;
  operation: GraphifyInstructionSyncOperation;
  path: string;
  exists: boolean;
  willCreate: boolean;
  changed: boolean;
  beforeContent: string;
  afterContent: string;
  diff: string;
}

interface GraphifyInstructionTargetConfig {
  label: string;
  fileName: string;
}

const GRAPHIFY_INSTRUCTION_TARGETS: Record<GraphifyInstructionTarget, GraphifyInstructionTargetConfig> = {
  claude: {
    label: 'Claude',
    fileName: 'CLAUDE.md',
  },
  codex: {
    label: 'Codex',
    fileName: 'AGENTS.md',
  },
};

export async function previewGraphifyInstructionSync(
  input: GraphifyInstructionSyncInput,
): Promise<GraphifyInstructionSyncPreview> {
  const path = resolveGraphifyInstructionTargetPath(input);
  const existingContent = await readInstructionFileIfPresent(path);
  return buildGraphifyInstructionSyncPreview({
    ...input,
    instructionPath: path,
    existingContent,
  });
}

export async function applyGraphifyInstructionSync(
  input: GraphifyInstructionSyncInput,
): Promise<GraphifyInstructionSyncPreview> {
  const preview = await previewGraphifyInstructionSync(input);
  if (!preview.changed) {
    return preview;
  }

  await mkdir(dirname(preview.path), { recursive: true });
  await writeFile(preview.path, preview.afterContent, 'utf8');
  return preview;
}

export function buildGraphifyInstructionSyncPreview(
  input: BuildGraphifyInstructionSyncPreviewInput,
): GraphifyInstructionSyncPreview {
  const operation = input.operation ?? 'apply';
  const path = resolveGraphifyInstructionTargetPath(input);
  const beforeContent = input.existingContent ?? '';
  const afterContent = operation === 'apply'
    ? upsertGraphifyInstructionSection(beforeContent, input.sectionContent)
    : removeGraphifyInstructionSection(beforeContent);
  const changed = beforeContent !== afterContent;

  return {
    target: input.target,
    operation,
    path,
    exists: input.existingContent !== null,
    willCreate: input.existingContent === null && operation === 'apply' && changed,
    changed,
    beforeContent,
    afterContent,
    diff: changed ? buildPreviewDiff(beforeContent, afterContent, path) : '',
  };
}

export function buildGraphifyInstructionSection(
  sectionContent = DEFAULT_GRAPHIFY_INSTRUCTION_BODY,
  newline = '\n',
): string {
  if (sectionContent.includes(GRAPHIFY_INSTRUCTION_START_MARKER)
    || sectionContent.includes(GRAPHIFY_INSTRUCTION_END_MARKER)) {
    throw new Error('Graphify instruction body must not include marker comments.');
  }

  return [
    GRAPHIFY_INSTRUCTION_START_MARKER,
    normalizeInstructionBody(sectionContent, newline),
    GRAPHIFY_INSTRUCTION_END_MARKER,
  ].join(newline);
}

export function upsertGraphifyInstructionSection(
  content: string,
  sectionContent = DEFAULT_GRAPHIFY_INSTRUCTION_BODY,
): string {
  const newline = detectNewline(content);
  const section = buildGraphifyInstructionSection(sectionContent, newline);
  const existingRange = findGraphifyInstructionMarkerRange(content);

  if (!existingRange) {
    return appendGraphifyInstructionSection(content, section, newline);
  }

  return `${content.slice(0, existingRange.start)}${section}${content.slice(existingRange.end)}`;
}

export function removeGraphifyInstructionSection(content: string): string {
  const existingRange = findGraphifyInstructionMarkerRange(content);
  if (!existingRange) {
    return content;
  }

  const newline = detectNewline(content);
  const before = content.slice(0, existingRange.start);
  let after = content.slice(existingRange.end);
  const doubleNewline = `${newline}${newline}`;
  if (before.endsWith(doubleNewline) && after.startsWith(doubleNewline)) {
    after = after.slice(newline.length);
  }
  return `${before}${after}`;
}

function resolveGraphifyInstructionTargetPath(input: GraphifyInstructionSyncInput): string {
  const config = GRAPHIFY_INSTRUCTION_TARGETS[input.target];
  const projectRoot = resolve(input.projectRoot);
  const expectedPath = resolve(projectRoot, config.fileName);
  const instructionPath = resolve(input.instructionPath ?? expectedPath);
  const relativePath = relative(projectRoot, instructionPath);

  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error('Graphify instruction sync path must stay inside the selected project root.');
  }

  if (!samePath(instructionPath, expectedPath)) {
    throw new Error(`Graphify ${config.label} instruction sync can only target ${config.fileName}.`);
  }

  return instructionPath;
}

async function readInstructionFileIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function appendGraphifyInstructionSection(content: string, section: string, newline: string): string {
  if (content.length === 0) {
    return `${section}${newline}`;
  }

  const separator = content.endsWith(`${newline}${newline}`)
    ? ''
    : content.endsWith(newline)
      ? newline
      : `${newline}${newline}`;
  return `${content}${separator}${section}${newline}`;
}

function findGraphifyInstructionMarkerRange(content: string): { start: number; end: number } | null {
  const start = content.indexOf(GRAPHIFY_INSTRUCTION_START_MARKER);
  const endMarkerStart = content.indexOf(GRAPHIFY_INSTRUCTION_END_MARKER);

  if (start === -1 && endMarkerStart === -1) {
    return null;
  }
  if (start === -1 || endMarkerStart === -1 || endMarkerStart < start) {
    throw new Error('Vault Graphify instruction markers are incomplete or out of order.');
  }

  const nextStart = content.indexOf(GRAPHIFY_INSTRUCTION_START_MARKER, start + GRAPHIFY_INSTRUCTION_START_MARKER.length);
  const nextEnd = content.indexOf(GRAPHIFY_INSTRUCTION_END_MARKER, endMarkerStart + GRAPHIFY_INSTRUCTION_END_MARKER.length);
  if (nextStart !== -1 || nextEnd !== -1) {
    throw new Error('Vault Graphify instruction sync supports exactly one marked section.');
  }

  return {
    start,
    end: endMarkerStart + GRAPHIFY_INSTRUCTION_END_MARKER.length,
  };
}

function buildPreviewDiff(beforeContent: string, afterContent: string, path: string): string {
  const beforeLines = splitDiffLines(beforeContent);
  const afterLines = splitDiffLines(afterContent);
  return [
    `--- ${path} (before)`,
    `+++ ${path} (after)`,
    '@@',
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`),
  ].join('\n');
}

function splitDiffLines(content: string): string[] {
  if (content.length === 0) {
    return [];
  }
  const normalized = content.endsWith('\n') ? content.slice(0, -1) : content;
  return normalized.split(/\r?\n/);
}

function normalizeInstructionBody(sectionContent: string, newline: string): string {
  return sectionContent.trim().replace(/\r?\n/g, newline);
}

function detectNewline(content: string): string {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

function samePath(left: string, right: string): boolean {
  const resolvedLeft = resolve(left);
  const resolvedRight = resolve(right);
  return process.platform === 'win32'
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
