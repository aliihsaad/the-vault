const MEMORY_UID_PATTERN = /\bvm_[A-Za-z0-9_-]+\b/g;

export function extractMemoryUidTokens(...values: Array<string | string[] | null | undefined>): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const parts = Array.isArray(value) ? value : [value];
    for (const part of parts) {
      if (!part) continue;
      const matches = part.match(MEMORY_UID_PATTERN) || [];
      for (const match of matches) {
        const key = match.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        tokens.push(match);
      }
    }
  }

  return tokens;
}
