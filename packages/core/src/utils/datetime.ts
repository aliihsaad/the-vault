// ============================================================================
// Vault — Utility: Date/Time Helpers
// ============================================================================

/**
 * Get the current ISO 8601 timestamp.
 */
export function now(): string {
  return new Date().toISOString();
}

/**
 * Check if a date string is within the last N days.
 */
export function isWithinDays(dateStr: string, days: number): boolean {
  const date = new Date(dateStr);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return date >= cutoff;
}

/**
 * Format a date string for display.
 */
export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}
