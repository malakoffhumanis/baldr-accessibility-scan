import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('swagger-ui-express', () => ({
  default: {
    // Pass-through middlewares so mounting does not interfere with /json
    serve: [
      (
        _req: express.Request,
        _res: express.Response,
        next: express.NextFunction,
      ) => next(),
    ],
    setup: vi
      .fn()
      .mockReturnValue((_req: express.Request, res: express.Response) =>
        res.status(200).send('swagger-ui'),
      ),
  },
}));

vi.mock('./openapi.js', () => ({
  openApiDocument: {
    openapi: '3.0.3',
    info: { title: 'Test', version: '1.0.0' },
    paths: {},
  },
}));

import { createDocsRouter } from './docs.routes.js';

describe('createDocsRouter', () => {
  it('creates a router', () => {
    const router = createDocsRouter();
    expect(router).toBeDefined();
  });

  it('has routes registered', () => {
    const router = createDocsRouter();
    // Router should have route handlers
    expect(router.stack?.length).toBeGreaterThan(0);
  });

  it('GET /json returns the OpenAPI document', async () => {
    const app = express();
    app.use('/docs', createDocsRouter());

    const res = await request(app).get('/docs/json');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      openapi: '3.0.3',
      info: { title: 'Test', version: '1.0.0' },
      paths: {},
    });
  });
});
