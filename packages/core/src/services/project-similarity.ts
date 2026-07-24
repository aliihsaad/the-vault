export interface ProjectSimilarityMemory {
  itemUid: string;
  title: string;
  subject: string;
  summary: string;
  keywords: string[];
  tags: string[];
  relatedFiles: string[];
  memoryType: string;
  promoted: boolean;
  updatedAt: string;
}

export interface ProjectSimilarityDocument {
  name: string;
  description: string | null;
  projectType: string | null;
  canonicalRoot: string | null;
  repositoryUrl: string | null;
  memories: ProjectSimilarityMemory[];
}

export interface ProjectSimilarityResult {
  isCandidate: boolean;
  score: number;
  confidence: number;
  signals: string[];
  sharedTerms: string[];
  evidenceItemUids: string[];
}

const TOKEN_LIMIT = 48;
const EVIDENCE_PER_PROJECT = 2;
const NAME_NOISE = new Set([
  'app',
  'application',
  'build',
  'desktop',
  'project',
  'test',
  'version',
]);
const PROFILE_STOP_WORDS = new Set([
  'about', 'active', 'after', 'again', 'agent', 'also', 'and', 'app', 'application',
  'artifact', 'based', 'been', 'before', 'being', 'build', 'code', 'complete', 'completed',
  'current', 'decision', 'delegated', 'description', 'does', 'file', 'fixed', 'from', 'handoff',
  'have', 'implementation', 'implemented', 'include', 'includes', 'into', 'item', 'memory',
  'next', 'only', 'plan', 'project', 'reference', 'review', 'session', 'should', 'status',
  'summary', 'system', 'task', 'test', 'testing', 'that', 'their', 'then', 'this', 'through',
  'using', 'verified', 'were', 'when', 'where', 'which', 'with', 'work', 'working',
]);

export function scoreProjectSimilarity(
  left: ProjectSimilarityDocument,
  right: ProjectSimilarityDocument,
  smallProjectLimit: number,
): ProjectSimilarityResult {
  if (hasIncompatibleDeclaredTypes(left.projectType, right.projectType)) {
    return emptyResult('declared project types differ');
  }

  const repositoryMatch = locationsMatch(left.repositoryUrl, right.repositoryUrl);
  const canonicalRootMatch = locationsMatch(left.canonicalRoot, right.canonicalRoot);
  const nameScore = scoreProjectNames(left.name, right.name);
  const descriptionScore = tokenSetSimilarity(
    tokenize(left.description || ''),
    tokenize(right.description || ''),
  );
  const leftProfile = buildMemoryProfile(left.memories);
  const rightProfile = buildMemoryProfile(right.memories);
  const memoryScore = cosineSimilarity(leftProfile, rightProfile);
  const sharedTerms = getSharedTerms(leftProfile, rightProfile);
  const fileScore = containmentSimilarity(
    collectRelatedFiles(left.memories),
    collectRelatedFiles(right.memories),
  );
  const smallSide = Math.min(left.memories.length, right.memories.length) <= smallProjectLimit;

  const identityMatch = repositoryMatch || canonicalRootMatch;
  const nameCandidate = nameScore >= 0.86 && (smallSide || memoryScore >= 0.28 || descriptionScore >= 0.35);
  const semanticCandidate = memoryScore >= 0.7 && descriptionScore >= 0.42;
  const strongSemanticCandidate = memoryScore >= 0.82 && sharedTerms.length >= 6;
  const fileCandidate = fileScore >= 0.5 && memoryScore >= 0.42;
  const isCandidate = identityMatch || nameCandidate || semanticCandidate || strongSemanticCandidate || fileCandidate;

  const blendedScore = Math.max(
    nameScore * 0.5 + Math.max(descriptionScore, memoryScore) * 0.35 + fileScore * 0.15,
    memoryScore * 0.55 + descriptionScore * 0.3 + fileScore * 0.15,
    fileScore * 0.55 + memoryScore * 0.35 + nameScore * 0.1,
  );
  const effectiveScore = identityMatch
    ? 0.99
    : Math.max(
      blendedScore,
      nameCandidate ? nameScore * 0.92 : 0,
      semanticCandidate ? (memoryScore * 0.62 + descriptionScore * 0.38) : 0,
      strongSemanticCandidate ? memoryScore * 0.92 : 0,
      fileCandidate ? fileScore * 0.72 + memoryScore * 0.28 : 0,
    );
  const score = Number(clampRatio(effectiveScore).toFixed(3));
  const confidence = isCandidate ? Math.round(65 + score * 33) : 0;
  const signals: string[] = [];

  if (repositoryMatch) signals.push('same repository URL');
  if (canonicalRootMatch) signals.push('same canonical root');
  if (nameScore >= 0.55) signals.push(`name similarity ${formatPercent(nameScore)}`);
  if (descriptionScore >= 0.35) signals.push(`description overlap ${formatPercent(descriptionScore)}`);
  if (memoryScore >= 0.35) {
    const terms = sharedTerms.slice(0, 5).join(', ');
    signals.push(`memory-topic overlap ${formatPercent(memoryScore)}${terms ? ` (${terms})` : ''}`);
  }
  if (fileScore > 0) signals.push(`shared file evidence ${formatPercent(fileScore)}`);

  return {
    isCandidate,
    score,
    confidence,
    signals,
    sharedTerms,
    evidenceItemUids: isCandidate
      ? selectEvidenceItemUids(left.memories, right.memories, sharedTerms)
      : [],
  };
}

function hasIncompatibleDeclaredTypes(left: string | null, right: string | null): boolean {
  const declaredLeft = left && left !== 'unclassified' ? left : null;
  const declaredRight = right && right !== 'unclassified' ? right : null;
  return Boolean(declaredLeft && declaredRight && declaredLeft !== declaredRight);
}

function scoreProjectNames(left: string, right: string): number {
  const leftTokens = tokenizeName(left);
  const rightTokens = tokenizeName(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;

  const leftCompact = leftTokens.join('');
  const rightCompact = rightTokens.join('');
  if (leftCompact === rightCompact) return 1;

  const tokenScore = tokenSetSimilarity(leftTokens, rightTokens, false);
  const longestLength = Math.max(leftCompact.length, rightCompact.length, 1);
  const editScore = 1 - levenshtein(leftCompact, rightCompact) / longestLength;
  const containmentScore = leftCompact.includes(rightCompact) || rightCompact.includes(leftCompact)
    ? Math.min(leftCompact.length, rightCompact.length) / longestLength
    : 0;
  return clampRatio(Math.max(tokenScore, editScore, containmentScore));
}

function tokenizeName(value: string): string[] {
  const tokens = tokenize(value).filter((token) => !NAME_NOISE.has(token) && !/^v?\d+$/.test(token));
  return tokens.length > 0 ? tokens : tokenize(value);
}

function buildMemoryProfile(memories: ProjectSimilarityMemory[]): Map<string, number> {
  const weights = new Map<string, number>();

  for (const memory of memories) {
    const importance = memory.promoted || ['decision', 'plan', 'reference'].includes(memory.memoryType) ? 1.35 : 1;
    addWeightedTokens(weights, memory.title, 3 * importance);
    addWeightedTokens(weights, memory.subject, 3 * importance);
    addWeightedTokens(weights, memory.summary, 1 * importance);
    addWeightedTokens(weights, memory.tags.join(' '), 4 * importance);
    addWeightedTokens(weights, memory.keywords.join(' '), 4 * importance);
  }

  return new Map(
    [...weights.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, TOKEN_LIMIT),
  );
}

function addWeightedTokens(target: Map<string, number>, value: string, weight: number): void {
  for (const token of tokenize(value)) {
    if (PROFILE_STOP_WORDS.has(token)) continue;
    target.set(token, Math.min((target.get(token) || 0) + weight, 24));
  }
}

function tokenize(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .map(normalizeToken)
    .filter((token) => token.length >= 3 && !/^\d+$/.test(token));
}

function normalizeToken(token: string): string {
  if (token.length > 5 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

function cosineSimilarity(left: Map<string, number>, right: Map<string, number>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (const [token, weight] of left) {
    leftMagnitude += weight * weight;
    dot += weight * (right.get(token) || 0);
  }
  for (const weight of right.values()) rightMagnitude += weight * weight;

  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return clampRatio(dot / Math.sqrt(leftMagnitude * rightMagnitude));
}

function tokenSetSimilarity(left: string[], right: string[], excludeProfileStopWords = true): number {
  const leftSet = new Set(left.filter((token) => !excludeProfileStopWords || !PROFILE_STOP_WORDS.has(token)));
  const rightSet = new Set(right.filter((token) => !excludeProfileStopWords || !PROFILE_STOP_WORDS.has(token)));
  if (leftSet.size === 0 || rightSet.size === 0) return 0;
  const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return union > 0 ? intersection / union : 0;
}

function getSharedTerms(left: Map<string, number>, right: Map<string, number>): string[] {
  return [...left.keys()]
    .filter((token) => right.has(token))
    .sort((a, b) => Math.min(right.get(b) || 0, left.get(b) || 0)
      - Math.min(right.get(a) || 0, left.get(a) || 0));
}

function collectRelatedFiles(memories: ProjectSimilarityMemory[]): Set<string> {
  const files = new Set<string>();
  for (const memory of memories) {
    for (const file of memory.relatedFiles) {
      const normalized = normalizeLocation(file);
      if (!normalized || normalized.includes('/vault/projects/')) continue;
      files.add(normalized);
    }
  }
  return files;
}

function containmentSimilarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  const intersection = [...left].filter((value) => right.has(value)).length;
  return intersection / Math.min(left.size, right.size);
}

function locationsMatch(left: string | null, right: string | null): boolean {
  const normalizedLeft = normalizeLocation(left || '');
  const normalizedRight = normalizeLocation(right || '');
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function normalizeLocation(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase();
}

function selectEvidenceItemUids(
  left: ProjectSimilarityMemory[],
  right: ProjectSimilarityMemory[],
  sharedTerms: string[],
): string[] {
  const shared = new Set(sharedTerms);
  return [
    ...rankEvidence(left, shared).slice(0, EVIDENCE_PER_PROJECT),
    ...rankEvidence(right, shared).slice(0, EVIDENCE_PER_PROJECT),
  ].map((memory) => memory.itemUid);
}

function rankEvidence(memories: ProjectSimilarityMemory[], sharedTerms: Set<string>): ProjectSimilarityMemory[] {
  return [...memories].sort((left, right) => {
    const scoreDelta = scoreEvidence(right, sharedTerms) - scoreEvidence(left, sharedTerms);
    if (scoreDelta !== 0) return scoreDelta;
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  });
}

function scoreEvidence(memory: ProjectSimilarityMemory, sharedTerms: Set<string>): number {
  const tokens = new Set(tokenize([
    memory.title,
    memory.subject,
    memory.summary,
    memory.tags.join(' '),
    memory.keywords.join(' '),
  ].join(' ')));
  const overlap = [...tokens].filter((token) => sharedTerms.has(token)).length;
  const importance = memory.promoted || ['decision', 'plan', 'reference'].includes(memory.memoryType) ? 3 : 0;
  return overlap * 4 + importance;
}

function levenshtein(left: string, right: string): number {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1);

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const substitution = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + substitution);
    }
    for (let j = 0; j <= right.length; j += 1) previous[j] = current[j];
  }

  return previous[right.length];
}

function emptyResult(reason: string): ProjectSimilarityResult {
  return {
    isCandidate: false,
    score: 0,
    confidence: 0,
    signals: [reason],
    sharedTerms: [],
    evidenceItemUids: [],
  };
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function formatPercent(value: number): string {
  return `${Math.round(clampRatio(value) * 100)}%`;
}
