import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('@shared/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { createJourneyRouter } from './journey.routes.js';

describe('createJourneyRouter', () => {
  it('creates a router with POST / route', () => {
    const mockController = {
      executeJourney: vi.fn(),
    };
    const router = createJourneyRouter(mockController as never);
    expect(router).toBeDefined();
    // The router should have at least one layer (the POST route)
    expect(router.stack?.length).toBeGreaterThan(0);
  });

  it('POST / invokes the controller when the body is valid', async () => {
    const executeJourney = vi
      .fn()
      .mockImplementation((_req: express.Request, res: express.Response) => {
        res.status(200).json({ success: true });
        return Promise.resolve();
      });

    const app = express();
    app.use(express.json());
    app.use('/journey', createJourneyRouter({ executeJourney } as never));

    const res = await request(app)
      .post('/journey')
      .send({
        pages: [{ url: 'https://example.com', actions: [{ type: 'scan' }] }],
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(executeJourney).toHaveBeenCalledTimes(1);
  });

  it('POST / returns 400 without calling the controller when body is invalid', async () => {
    const executeJourney = vi.fn();

    const app = express();
    app.use(express.json());
    app.use('/journey', createJourneyRouter({ executeJourney } as never));

    const res = await request(app).post('/journey').send({ journey: [] });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(executeJourney).not.toHaveBeenCalled();
  });
});
