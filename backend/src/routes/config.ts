/**
 * Public instance configuration.
 *
 *   GET /api/config -> { demoMode, receiptsEnabled }
 *
 * Mounted WITHOUT requireAuth. The frontend has to know what kind of instance
 * it is talking to before anyone logs in — which tabs to render, whether to
 * disclose that the data is fictional — and the precedent already exists in
 * `GET /api/auth/status`.
 *
 * NOTHING BUT BOOLEANS MAY EVER GO IN THIS RESPONSE. It is unauthenticated by
 * design, so a field added carelessly here is an unauthenticated data leak: no
 * paths, no counts, no version strings, nothing read from the ledger. A test in
 * `tests/config.test.ts` asserts the body has exactly these two boolean fields,
 * and it is meant to fail the moment someone adds a third.
 *
 * `authRequired` deliberately stays where it is rather than being mirrored
 * here: two small public endpoints is a cheaper mistake than two sources of
 * truth for one fact.
 */

import { Router, Request, Response } from 'express';
import { isDemoMode, isReceiptsEnabled } from '../config/instance';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json({
    demoMode: isDemoMode(),
    receiptsEnabled: isReceiptsEnabled(),
  });
});

export default router;
