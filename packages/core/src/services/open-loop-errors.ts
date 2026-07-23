export const OPEN_LOOP_REASON_CODES = [
  'PROJECT_NOT_FOUND',
  'PROJECT_UID_REQUIRED',
  'PROJECT_TYPE_REQUIRED',
  'PROJECT_ALREADY_CLASSIFIED',
  'PROJECT_NOT_CLASSIFIED',
  'PROJECT_TYPE_UNCHANGED',
  'WORK_PROJECT_FIELDS_REQUIRED',
  'BRAIN_CONTEXT_FIELDS_REQUIRED',
  'BRAIN_CONTEXT_LOOPS_FORBIDDEN',
  'BRAIN_CONTEXT_NEXT_STEPS_FORBIDDEN',
  'ACTIVE_LOOPS_PREVENT_BRAIN_CONVERSION',
  'LOOPS_PREVENT_BRAIN_CONVERSION',
  'AUTHORIZATION_POLICY_NOT_FOUND',
  'AUTHORIZATION_ACTION_NOT_ALLOWED',
  'AUTHORIZATION_DENIED',
  'APPROVAL_REQUEST_NOT_FOUND',
  'APPROVAL_REQUEST_MISMATCH',
  'APPROVAL_REQUEST_EXPIRED',
  'APPROVAL_ALREADY_RECORDED',
  'QUORUM_NOT_SATISFIED',
  'VERSION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'DUPLICATE_OPEN_LOOP',
  'LOOP_NOT_FOUND',
  'ILLEGAL_STATE_TRANSITION',
  'LOOP_ALREADY_RESOLVED',
  'LOOP_NOT_RESOLVED',
  'INVALID_SNOOZE',
  'SNOOZE_NOT_APPROVED',
  'INSUFFICIENT_EVIDENCE',
  'EVIDENCE_POLICY_NOT_FOUND',
  'EVIDENCE_REFERENCE_REJECTED',
  'TRANSACTION_FAILED',
] as const;

export type OpenLoopReasonCode = (typeof OPEN_LOOP_REASON_CODES)[number];

export class OpenLoopServiceError extends Error {
  readonly code: OpenLoopReasonCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: OpenLoopReasonCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'OpenLoopServiceError';
    this.code = code;
    this.details = details;
  }
}

export function isOpenLoopServiceError(error: unknown): error is OpenLoopServiceError {
  return error instanceof OpenLoopServiceError;
}
