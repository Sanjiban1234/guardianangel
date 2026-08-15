/**
 * Application-level error with a typed error code.
 * Use instead of (err as any).code = '...' pattern.
 */
export class AppError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    // Restore prototype chain (required when extending built-ins in TS)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
