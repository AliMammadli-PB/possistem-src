import type { FastifyInstance } from 'fastify';
import { resolveSetupInfo } from '../lib/setup-feed.js';
import { isPosProduct } from '../lib/pos-product.js';
import { requireSuperadmin } from '../plugins/auth.js';

export async function downloadRoutes(app: FastifyInstance) {
  /** Latest Windows setup for superadmin download UI. */
  app.get('/downloads/setup', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;

    // ?product=market returns the MarketPos feed; default stays restaurant so
    // existing callers are unaffected.
    const { product } = req.query as { product?: string };
    const result = await resolveSetupInfo(isPosProduct(product) || product === 'geyim' || product === 'aptek' /* aptek-product */ || product === 'topdan' /* topdan-product */ ? product : 'restaurant'); /* geyim-product */
    if (!result.ok) return reply.code(502).send(result.error);
    return result.info;
  });
}
