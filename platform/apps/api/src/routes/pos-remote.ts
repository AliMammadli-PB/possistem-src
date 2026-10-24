import {registerWarehousePortal} from './warehouse-portal.js';
import {cloudBranchRoutes} from './cloud-branches.js';
import { inflateRawSync } from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v3';
import { eq } from 'drizzle-orm';
import { ownerFloorSnapshots } from '@milioner/database';
import { requireCustomer } from '../plugins/customer-auth.js';
import { parseBody, clientIp } from '../lib/validate.js';
import { writeAudit } from '../lib/audit.js';
import { areaAllowed } from '../lib/access-areas.js';
import { notePortalRpc, runOnTill } from '../lib/bot/queue.js';
import { surfaceAccess } from './access.js';
import { branchSnapshots } from './inventory.js';

/**
 * Restaurant management from the portal (Restoran POS 1.8.0).
 *
 * The portal runs the till's own Əməliyyatlar screens (sales, stock,
 * purchases, costing, partners, branches, kassas, salaries, expenses,
 * delivery, export); every core call they make comes here, goes to the
 * restaurant's till as one signed `core.batch` command and the till's answer
 * comes back. What is added here is added on the till.
 *
 * Only these core methods may be called (the till checks the same list).
 * 'r' needs the portal area "restoran", 'w' also "restoran.write".
 */
const REMOTE_METHODS: Record<string, 'r' | 'w'> = {
  'business.call': 'r', 'orders.get': 'r', 'print.enqueue': 'w',
  'cash.list': 'r', 'cash.movement': 'w',
  'cashAccounts.list': 'r', 'cashAccounts.moves': 'r', 'cashAccounts.save': 'w', 'cashAccounts.deactivate': 'w',
  'cashAccounts.transfer': 'w', 'cashObjects.save': 'w',
  'couriers.list': 'r', 'couriers.save': 'w',
  'customers.list': 'r', 'customers.ledger': 'r', 'customers.save': 'w', 'customers.charge': 'w',
  'customers.deactivate': 'w', 'customers.payDebt': 'w', 'loyalty.redeem': 'w',
  'delivery.list': 'r', 'delivery.courierReport': 'r', 'delivery.assign': 'w', 'delivery.setStatus': 'w', 'delivery.settle': 'w',
  'ingredients.list': 'r', 'ingredients.save': 'w', 'ingredients.deactivate': 'w',
  'inventory.levels': 'r', 'inventory.lowStock': 'r', 'inventory.movements': 'r', 'inventory.valuation': 'r',
  'inventory.adjust': 'w', 'inventory.waste': 'w', 'inventory.costingMethod': 'w',
  'warehouses.list': 'r',
  'locations.list': 'r', 'locations.save': 'w',
  'lots.list': 'r', 'lots.relocate': 'w', 'lots.writeOff': 'w', 'lots.extend': 'w',
  'payments.refund': 'w',
  'purchases.list': 'r', 'purchases.get': 'r', 'purchases.returns': 'r',
  'purchases.save': 'w', 'purchases.confirm': 'w', 'purchases.receive': 'w', 'purchases.inspect': 'w',
  'purchases.invoice': 'w', 'purchases.addCost': 'w', 'purchases.removeCost': 'w', 'purchases.update': 'w',
  'purchases.delete': 'w', 'purchases.return': 'w', 'purchases.deleteReturn': 'w',
  'recipes.get': 'r', 'recipes.save': 'w',
  'replenish.suggestions': 'r', 'replenish.run': 'w', 'replenish.createDraft': 'w',
  'reports.costing': 'r', 'reports.expiry': 'r', 'reports.stockLoss': 'r', 'reports.suppliers': 'r', 'reports.export': 'r',
  'salary.list': 'r', 'salary.pay': 'w',
  'sales.list': 'r', 'sales.get': 'r', 'sales.update': 'w', 'sales.delete': 'w',
  'settings.getAll': 'r', 'settings.set': 'w',
  'stockRules.list': 'r', 'stockRules.save': 'w',
  'supplierItems.list': 'r', 'supplierItems.save': 'w',
  'suppliers.list': 'r', 'suppliers.ledger': 'r', 'suppliers.save': 'w', 'suppliers.pay': 'w',
  'tables.list': 'r', 'users.list': 'r',
  // 1.9.0: Mallar, Kateqoriyalar, İnventarizasiya (also from a phone), Qazanc.
  'categories.list': 'r', 'categories.save': 'w', 'categories.delete': 'w',
  'goods.list': 'r', 'goods.prices': 'w', 'goods.import': 'w',
  'stocktake.list': 'r', 'stocktake.get': 'r', 'stocktake.create': 'w', 'stocktake.count': 'w',
  'stocktake.post': 'w', 'stocktake.import': 'w', 'stocktake.update': 'w', 'stocktake.cancel': 'w',
  'income.list': 'r', 'income.save': 'w', 'income.delete': 'w',
};

const RpcBody = z.object({
  deviceId: z.string().min(1).max(80).optional(),
  calls: z.array(z.object({
    method: z.string().min(1).max(64),
    payload: z.record(z.unknown()).optional(),
    idempotencyKey: z.string().max(120).optional(),
  })).min(1).max(16),
});

export async function posRemoteRoutes(app: FastifyInstance) {
  await cloudBranchRoutes(app);
  await registerWarehousePortal(app);
  app.get('/customer/pos/branches', async (req, reply) => {
    const customer=requireCustomer(req,reply);if(!customer)return;
    const grants=await surfaceAccess(app,customer.id,'portal');
    if(!areaAllowed(grants,'restoran'))return reply.code(403).send({error:'Restoran idarəetməsinə icazəniz yoxdur'});
    const access=await surfaceAccess(app,customer.id,'restaurant');
    const query=z.object({deviceId:z.string().uuid().optional()}).safeParse(req.query);
    if(!query.success)return reply.code(400).send({error:'Cihaz düzgün seçilməyib'});
    const branches=await branchSnapshots(app,customer.id,query.data.deviceId||'00000000-0000-0000-0000-000000000000',areaAllowed(access,'stock'),areaAllowed(access,'cash'));
    return {branches};
  });
  app.post('/customer/pos/rpc', {
    config: { rateLimit: { max: 300, timeWindow: '1 minute' } },
    bodyLimit: 2 * 1024 * 1024,
  }, async (req, reply) => {
    const customer = requireCustomer(req, reply);
    if (!customer) return;
    const body = parseBody(RpcBody, req.body ?? {}, reply);
    if (!body) return;

    const grants = await surfaceAccess(app, customer.id, 'portal');
    if (!areaAllowed(grants, 'restoran')) return reply.code(403).send({ error: 'Restoran idarəetməsinə icazəniz yoxdur' });
    let writes = 0;
    for (const call of body.calls) {
      if (call.method === '__session') continue;
      const action=String(call.payload?.action ?? '');
      const businessRead=['context','documents','staff'];
      const businessWrite=['correct','delivery.update','staff.save','staff.link','catalog.publish'];
      if(call.method==='business.call' && ![...businessRead,...businessWrite].includes(action)) return reply.code(400).send({error:'Bu əməliyyat saytdan açıq deyil'});
      const kind = call.method==='business.call' ? (businessWrite.includes(action)?'w':'r') : REMOTE_METHODS[call.method];
      if (!kind) return reply.code(400).send({ error: `Bu əməliyyat saytdan açıq deyil: ${call.method}` });
      if (kind === 'w') writes += 1;
    }
    if (writes > 0 && !areaAllowed(grants, 'restoran.write')) {
      return reply.code(403).send({ error: 'Dəyişiklik etməyə icazəniz yoxdur (yalnız baxmaq)' });
    }

    // The restaurant's main till: the one that sends the floor plan.
    let deviceId = body.deviceId;
    if (!deviceId) {
      const [floor] = await app.db
        .select({ deviceId: ownerFloorSnapshots.deviceId })
        .from(ownerFloorSnapshots)
        .where(eq(ownerFloorSnapshots.customerId, customer.id))
        .limit(1);
      deviceId = floor?.deviceId ?? undefined;
    }
    if (!deviceId) return reply.code(409).send({ error: 'Restoran kassası hələ sayta qoşulmayıb' });

    notePortalRpc(customer.id);
    const outcome = await runOnTill({
      customerId: customer.id,
      command: 'core.batch',
      args: { calls: body.calls },
      requestedBy: 'portal',
      timeoutMs: 40_000,
      deviceId,
    });
    if (outcome.timedOut) {
      return reply.code(504).send({ error: 'Kassa cavab vermədi — kassa kompüteri açıq və internetə qoşulu olmalıdır (1.8.0 və ya yeni versiya)' });
    }
    if (!outcome.ok) return reply.code(502).send({ error: outcome.error || 'Kassa əmri yerinə yetirmədi', code: outcome.errorCode });

    let results: unknown = outcome.result?.results;
    const packed = outcome.result?.z;
    if (typeof packed === 'string') {
      results = JSON.parse(inflateRawSync(Buffer.from(packed, 'base64')).toString('utf8'));
    }
    if (writes > 0) {
      await writeAudit(app, {
        actorCustomerId: customer.id,
        action: 'owner.pos.rpc',
        entityType: 'customer',
        entityId: customer.id,
        ip: clientIp(req),
        meta: { deviceId, methods: body.calls.filter((c) => REMOTE_METHODS[c.method] === 'w').map((c) => c.method) },
      });
    }
    return { results, deviceId };
  });
}
