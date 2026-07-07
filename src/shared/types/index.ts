/**
 * Common types for the application
 * @module shared/types
 *
 * The standardized API response contract is the discriminated union
 * `APIResponse` (SuccessResponse | ErrorResponse) defined in
 * `audit-api.types.ts`.
 */

/**
 * Application configuration options
 */
export interface AppConfig {
  port: number;
  env: 'development' | 'production' | 'test';
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Re-export of audit types
 */
export type * from './audit.types.js';
