// ============================================================================
// Vault — Utility: UID Generation
// ============================================================================

import { nanoid } from 'nanoid';

/**
 * Generate a unique memory item UID.
 * Format: "vm_" prefix + 16 character nanoid
 */
export function generateItemUid(): string {
  return `vm_${nanoid(16)}`;
}

/**
 * Generate a short UID for file naming.
 * 8 character nanoid, lowercase.
 */
export function generateShortUid(): string {
  return nanoid(8).toLowerCase();
}

/**
 * Generate a unique project-proposal UID.
 * Format: "vp_" prefix + 16 character nanoid
 */
export function generateProposalUid(): string {
  return `vp_${nanoid(16)}`;
}
