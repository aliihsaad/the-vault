export const GRAPHIFY_ARTIFACT_PROTOCOL = 'vault-graphify:';

export const GRAPHIFY_ARTIFACT_NAMES = [
  'graphHtml',
  'graphJson',
  'graphReport',
  'graphSvg',
] as const;

export type GraphifyArtifactName = (typeof GRAPHIFY_ARTIFACT_NAMES)[number];

export interface GraphifyArtifactUrlRequest {
  project: string;
  artifact: GraphifyArtifactName;
}

export interface GraphifyArtifactUrlResponse {
  url: string;
  artifactPath?: string | null;
}

export interface GraphifyArtifactUrlApi {
  getGraphifyArtifactUrl(
    input: GraphifyArtifactUrlRequest,
  ): Promise<VaultResponse<GraphifyArtifactUrlResponse>>;
}

export function parseGraphifyArtifactUrlRequest(input: unknown): GraphifyArtifactUrlRequest {
  if (!input || typeof input !== 'object') {
    throw new Error('Graphify artifact request is required.');
  }

  const raw = input as Record<string, unknown>;
  const project = parseProject(raw.project);
  const artifact = parseArtifact(raw.artifact);

  return {
    project,
    artifact,
  };
}

export function buildGraphifyArtifactProtocolUrl(input: unknown): string {
  const request = parseGraphifyArtifactUrlRequest(input);
  const url = new URL('vault-graphify://artifact');
  url.searchParams.set('project', request.project);
  url.searchParams.set('artifact', request.artifact);
  return url.toString();
}

export async function requestGraphifyArtifactUrl(
  api: GraphifyArtifactUrlApi,
  input: unknown,
): Promise<string> {
  const request = parseGraphifyArtifactUrlRequest(input);
  const response = await api.getGraphifyArtifactUrl(request);
  if (!response.success || !response.data?.url) {
    throw new Error(response.error || 'Graphify artifact URL is unavailable.');
  }

  assertControlledGraphifyArtifactUrl(response.data.url);
  return response.data.url;
}

export function assertControlledGraphifyArtifactUrl(urlValue: string): void {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw new Error('Graphify artifact URL is invalid.');
  }

  if (url.protocol !== GRAPHIFY_ARTIFACT_PROTOCOL) {
    throw new Error('Graphify artifacts must use the controlled protocol.');
  }

  parseGraphifyArtifactUrlRequest({
    project: url.searchParams.get('project'),
    artifact: url.searchParams.get('artifact'),
  });
}

function parseProject(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Graphify artifact project is required.');
  }

  const project = value.trim();
  if (!project) {
    throw new Error('Graphify artifact project is required.');
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(project)) {
    throw new Error('Project names cannot be URLs.');
  }

  const normalized = project.replace(/\\/g, '/');
  if (normalized.split('/').includes('..')) {
    throw new Error('Project names cannot contain path traversal.');
  }

  return project;
}

function parseArtifact(value: unknown): GraphifyArtifactName {
  if (typeof value !== 'string') {
    throw new Error('Unsupported Graphify artifact.');
  }

  if (!GRAPHIFY_ARTIFACT_NAMES.includes(value as GraphifyArtifactName)) {
    throw new Error('Unsupported Graphify artifact.');
  }

  return value as GraphifyArtifactName;
}
