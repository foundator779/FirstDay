import type { ErrorCode } from "@firstday/contracts";

export const API_ERROR_STATUS = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  BEE_BRIDGE_UNAVAILABLE: 503,
  BEE_SOURCE_NOT_FOUND: 404,
  CONSENT_REQUIRED: 400,
  SOURCE_NOT_READY: 409,
  NO_CONFIRMED_INSTRUCTIONS: 409,
  STALE_PRACTICE_SET: 409,
  VALIDATION_ERROR: 422,
  RESOURCE_NOT_FOUND: 404,
  REVISION_CONFLICT: 409,
  CONSENT_REVOKED: 409,
  INVALID_STATE: 409,
  INTERNAL_ERROR: 500,
} as const satisfies Record<ErrorCode, number>;

export const API_ERROR_MESSAGE = {
  UNAUTHENTICATED: "A valid FirstDay learner session is required.",
  FORBIDDEN: "This session cannot access the requested source.",
  BEE_BRIDGE_UNAVAILABLE: "The local Bee bridge is not reachable.",
  BEE_SOURCE_NOT_FOUND: "The requested Bee conversation was not found.",
  CONSENT_REQUIRED: "Explicit consent is required before importing this conversation.",
  SOURCE_NOT_READY: "The Bee conversation is not ready to import.",
  NO_CONFIRMED_INSTRUCTIONS: "No confirmed instructions are available for practice.",
  STALE_PRACTICE_SET: "This practice set uses an older instruction revision.",
  VALIDATION_ERROR: "The request is invalid.",
  RESOURCE_NOT_FOUND: "The requested FirstDay resource was not found.",
  REVISION_CONFLICT: "The supplied revision is no longer current.",
  CONSENT_REVOKED: "Consent for this source has been revoked.",
  INVALID_STATE: "The requested transition is not allowed from the current state.",
  INTERNAL_ERROR: "FirstDay could not complete the request.",
} as const satisfies Record<ErrorCode, string>;

export class ApiError extends Error {
  override readonly name = "ApiError";

  constructor(
    public readonly code: ErrorCode,
    message: string = API_ERROR_MESSAGE[code],
  ) {
    super(message);
  }
}

export class InvalidDependencyOutputError extends Error {
  override readonly name = "InvalidDependencyOutputError";

  constructor() {
    super("A dependency returned invalid output.");
  }
}
