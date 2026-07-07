/**
 * Zod ↔ OpenAPI bootstrap.
 *
 * Calling `extendZodWithOpenApi(z)` adds the `.openapi()` method to Zod schemas.
 * It MUST run before any schema that relies on `.openapi()` is defined, so this
 * module is imported first by `schemas.ts` (where the schemas are created) and
 * by `openapi.ts` (where they are registered). Importing it has the side effect
 * of patching the shared Zod instance; there is nothing to export.
 */
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);
