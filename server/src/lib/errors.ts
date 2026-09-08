/** Typed application error → JSON error envelope. */
export type ErrorCode =
  | 'AUTH_REQUIRED'
  | 'INVALID_TOKEN'
  | 'BAD_CREDENTIALS'
  | 'EMAIL_TAKEN'
  | 'REVISION_CONFLICT'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'SERVER';

const STATUS: Record<ErrorCode, number> = {
  AUTH_REQUIRED: 401,
  INVALID_TOKEN: 401,
  BAD_CREDENTIALS: 401,
  EMAIL_TAKEN: 409,
  REVISION_CONFLICT: 409,
  VALIDATION: 422,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  SERVER: 500
};

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly extra?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
  }

  get status(): number {
    return STATUS[this.code];
  }
}

/** Hono error handler body: {error:{code,message,serverRevision?}} */
export function errorBody(e: AppError): { error: { code: ErrorCode; message: string } & Record<string, unknown> } {
  return { error: { code: e.code, message: e.message, ...(e.extra ?? {}) } };
}
