import { Router } from 'express';
import type { Request, Response } from 'express';

import type { JourneyController } from '@api/controllers/journey.controller.js';
import { validate } from '@api/middlewares/validate.js';
import { journeyRequestSchema } from '@shared/validation/schemas.js';

/**
 * Creates the journey router with the injected controller
 */
export function createJourneyRouter(
  journeyController: JourneyController,
): Router {
  const router = Router();

  /**
   * @openapi
   * /api/v1/journey:
   *   post:
   *     summary: Runs an accessibility journey (v2 — multi-block URL + NL actions)
   */
  router.post(
    '/',
    validate(journeyRequestSchema),
    (req: Request, res: Response) => {
      void journeyController.executeJourney(req, res);
    },
  );

  return router;
}
