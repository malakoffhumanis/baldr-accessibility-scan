import { Router } from 'express';

import type { HealthController } from '@api/controllers/health.controller.js';

/**
 * Creates the health router with the injected controller
 */
export function createHealthRouter(controller: HealthController): Router {
  const router = Router();

  router.get('/', (req, res, next) => {
    void controller.check(req, res).catch(next);
  });

  router.get('/diagnostic', (req, res, next) => {
    void controller.diagnostic(req, res).catch(next);
  });

  return router;
}
