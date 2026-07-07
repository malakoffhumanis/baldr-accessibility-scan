/**
 * Generic Zod validation middleware for Express.
 *
 * Validates req.body against a Zod schema and returns a typed 400 error
 * matching the existing API error contract on failure.
 */
import type { Request, Response, NextFunction } from 'express';
import type { ZodType, ZodError } from 'zod';

import type { APIResponse } from '@shared/types/audit-api.types.js';

/**
 * Formats a ZodError into a single readable error message.
 * Returns the first meaningful issue to match existing behavior
 * (one error message per response).
 */
function formatZodError(error: ZodError): string {
  const issue = error.issues[0];
  // ZodError always has at least one issue, but guard defensively (runtime may
  // expose an empty issues array; eslint's tsconfig disables noUncheckedIndexedAccess).

  if (issue == null) return 'Invalid request';

  // For custom issues (superRefine), use message directly
  if (issue.code === 'custom') {
    const pathPrefix = formatPath(issue.path);
    return pathPrefix ? `${pathPrefix}: ${issue.message}` : issue.message;
  }

  // For enum / literal validation, provide allowed values
  if (issue.code === 'invalid_value') {
    const field = formatPath(issue.path);
    const values = issue.values.map((v) => String(v));
    return `"${field}" invalid. Allowed values: ${values.join(', ')}`;
  }

  // For union (discriminated) type errors — use Zod's message with path context
  if (issue.code === 'invalid_union') {
    const field = formatPath(issue.path);
    return field ? `${field}: ${issue.message}` : issue.message;
  }

  // For too_small (min array length, min string, etc.)
  if (issue.code === 'too_small') {
    if (issue.message) {
      const pathPrefix = formatPath(issue.path);
      return pathPrefix ? `${pathPrefix}: ${issue.message}` : issue.message;
    }
  }

  // For too_big (max array length, max string, etc.)
  if (issue.code === 'too_big') {
    if (issue.message) {
      const pathPrefix = formatPath(issue.path);
      return pathPrefix ? `${pathPrefix}: ${issue.message}` : issue.message;
    }
  }

  // For invalid_type (missing fields, wrong types)
  if (issue.code === 'invalid_type') {
    const field = formatPath(issue.path);
    if (issue.input === undefined) {
      return `"${field}" is required`;
    }
    return `"${field}": invalid type (expected: ${issue.expected})`;
  }

  // For invalid_format (url validation, etc.)
  if (issue.code === 'invalid_format') {
    const field = formatPath(issue.path);
    if (issue.format === 'url') {
      return `${field}: invalid url`;
    }
    return `${field}: invalid format`;
  }

  // Default: use Zod's message with path context
  const pathPrefix = formatPath(issue.path);
  return pathPrefix ? `${pathPrefix}: ${issue.message}` : issue.message;
}

/**
 * Formats a Zod path into a readable field reference.
 * Examples: ['pages', 0, 'url'] → 'Page #0 "url"'
 */
function formatPath(path: PropertyKey[]): string {
  if (path.length === 0) return '';

  // Special handling for journey paths: Page #N ...
  if (path[0] === 'pages' && typeof path[1] === 'number') {
    const pageIndex = path[1];
    const rest = path.slice(2);
    if (rest.length === 0) return `Page #${String(pageIndex)}`;
    if (rest[0] === 'actions' && typeof rest[1] === 'number') {
      const actionIndex = rest[1];
      const actionRest = rest.slice(2);
      if (actionRest.length === 0) {
        return `Page #${String(pageIndex)} action #${String(actionIndex)}`;
      }
      return `Page #${String(pageIndex)} action #${String(actionIndex)} "${actionRest.join('.')}"`;
    }
    return `Page #${String(pageIndex)}: "${rest.join('.')}"`;
  }

  return path
    .map((p) => (typeof p === 'number' ? `[${String(p)}]` : String(p)))
    .join('.');
}

/**
 * Creates an Express middleware that validates req.body against a Zod schema.
 *
 * On success: calls next() with validated (but not transformed) body.
 * On failure: returns 400 with the standard error response shape.
 */
export function validate(schema: ZodType) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: formatZodError(result.error),
        },
      } satisfies APIResponse);
      return;
    }

    // Replace body with parsed (validated) data

    req.body = result.data;
    next();
  };
}
