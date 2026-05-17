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
const CONTEXT_SUMMARY_CHARS = 320;

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
  const summary = item.summary ? truncate(item.summary, CONTEXT_SUMMARY_CHARS) : '';
  const relatedFiles = item.relatedFiles.length > 0
    ? ` Files: ${item.relatedFiles.slice(0, 3).join(', ')}.`
    : '';
  const nextSteps = item.nextSteps.length > 0
    ? ` Next: ${item.nextSteps.slice(0, 2).join(' | ')}.`
    : '';

  return `- ${item.itemUid} | ${item.title} | ${summary}${relatedFiles}${nextSteps}`;
}

function formatLogLine(log: ActivityLogEntry): string {
  const timestamp = log.timestamp ? `${log.timestamp} ` : '';
  const message = log.message || `${log.actionType} event`;
  return `- ${timestamp}${log.sourceClient}/${log.actionType}: ${truncate(message, 160)}`;
}

function clampPositive(value: number | undefined, fallback: number): number {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallback;
  }
  return Math.max(1, Math.floor(numericValue));
}

function truncate(text: string, max: number): string {
  if (!text) {
    return '';
  }

  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}...` : compact;
}
