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

export function generateProjectUid(): string {
  return `vpr_${nanoid(16)}`;
}

export function generateLoopUid(): string {
  return `vl_${nanoid(16)}`;
}

export function generateLoopEventUid(): string {
  return `vle_${nanoid(16)}`;
}

export function generateEvidenceUid(): string {
  return `ve_${nanoid(16)}`;
}

export function generateProjectEventUid(): string {
  return `vpe_${nanoid(16)}`;
}

export function generateApprovalRequestUid(): string {
  return `var_${nanoid(16)}`;
}

export function generateApprovalUid(): string {
  return `va_${nanoid(16)}`;
}

export function generateGateEventUid(): string {
  return `vge_${nanoid(16)}`;
}

export function generateInstallationActorUid(): string {
  return `actor_${nanoid(20)}`;
}
