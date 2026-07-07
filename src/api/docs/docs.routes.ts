/**
 * Route serving the OpenAPI documentation via the OpenAPI interface.
 *
 * - GET /api/v1/docs       → interactive OpenAPI interface
 * - GET /api/v1/docs/json  → Raw OpenAPI JSON spec
 */
import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';

import { openApiDocument } from './openapi.js';

export function createDocsRouter(): Router {
  const router = Router();

  // Serve raw JSON spec
  router.get('/json', (_req, res) => {
    res.json(openApiDocument);
  });

  // Serve the OpenAPI interface
  router.use(
    '/',
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, {
      customSiteTitle: 'BALDR API — Documentation',
      customCss: '.swagger-ui .topbar { display: none }',
    }),
  );

  return router;
}
