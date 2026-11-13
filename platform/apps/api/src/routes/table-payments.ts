import QRCode from "qrcode";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod/v3";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { currentUser, requireSuperadmin } from "../plugins/auth.js";
import { resolveTenantToken } from "./tenant.js";
import { writeAudit } from "../lib/audit.js";
import { runOnTill, notePortalRpc } from "../lib/bot/queue.js";
import { query } from "../lib/billing/store.js";
import { BillingError } from "../lib/billing/domain.js";
import { TablePayments, seal, unseal } from "../lib/table-payments/service.js";
import { TablePaymentError } from "../lib/table-payments/domain.js";

const uuid = z.string().uuid();
const selection = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("all") }).strict(),
  z
    .object({
      mode: z.literal("equal"),
      parts: z.number().int().min(2).max(20),
      part: z.number().int().min(0).max(19),
    })
    .strict(),
  z
    .object({
      mode: z.literal("items"),
      items: z
        .array(
          z
            .object({
              lineId: z.string().min(1).max(100),
              quantityMilli: z.number().int().positive().max(1_000_000_000),
            })
            .strict(),
        )
        .min(1)
        .max(300),
    })
    .strict(),
]);
const snapshot = z
  .object({
    orderId: z.string().min(1).max(100),
    orderNumber: z.string().max(100),
    tableId: z.string().min(1).max(100),
    tableLabel: z.string().max(200),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    totalMinor: z.number().int().positive().max(100_000_000),
    paidMinor: z.number().int().nonnegative(),
    lines: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            name: z.string().min(1).max(300),
            quantityMilli: z.number().int().positive().max(1_000_000_000),
            amountMinor: z.number().int().nonnegative().max(100_000_000),
          })
          .strict(),
      )
      .min(1)
      .max(300),
  })
  .strict();

type Options = {
  payments?: TablePayments;
  worker?: boolean;
  audit?: typeof writeAudit;
  deviceAuth?: (req: FastifyRequest) => Promise<string>;
};
export async function tablePaymentRoutes(
  app: FastifyInstance,
  opts: Options = {},
) {
  const audit = opts.audit ?? writeAudit;
  const payments =
    opts.payments ??
    new TablePayments(app.db, async (customerId, deviceId, action, payload) => {
      notePortalRpc(customerId);
      const out = await runOnTill({
        customerId,
        deviceId,
        command: "qr.payment",
        args: {
          customerId,
          deviceId,
          action,
          payload,
          cloudExpiresAt: Date.now() + 20_000,
        },
        requestedBy: "table-payment",
        timeoutMs: 20_000,
      });
      if (!out.ok) {
        const error = new TablePaymentError(
          out.error || "Kassa ilə bağlantı alınmadı.",
          out.timedOut ? 504 : 409,
        );
        Object.assign(error, { definitive: !out.timedOut && !!out.errorCode });
        throw error;
      }
      return out.result;
    });
  const wrap =
    (handler: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      reply.header("cache-control", "private, no-store");
      try {
        return await handler(req, reply);
      } catch (e) {
        if (e instanceof TablePaymentError)
          return reply.code(e.statusCode).send({ error: e.message });
        if (e instanceof BillingError)
          return reply.code(e.httpStatus).send({ error: e.message });
        if (e instanceof z.ZodError)
          return reply
            .code(400)
            .send({ error: "Sorğunun məlumatlarını yoxlayın." });
        if ((e as any)?.code === "23505")
          return reply
            .code(409)
            .send({
              error:
                "Bu əməliyyat artıq qeydə alınıb. Nəticəni yenidən yoxlayın.",
            });
        req.log.error(
          { code: (e as any)?.code || "TABLE_PAYMENT_FAILURE" },
          "Table payment failed",
        );
        return reply
          .code(500)
          .send({
            error:
              "Ödəniş yoxlanılmadı. Təkrar ödəniş etməzdən əvvəl nəticəni yoxlayın.",
          });
      }
    };
  async function deviceAuth(req: FastifyRequest) {
    if (opts.deviceAuth) return opts.deviceAuth(req);
    const who = resolveTenantToken(
      req.headers.authorization?.replace(/^Bearer\s+/i, ""),
    );
    if (!who)
      throw new TablePaymentError("Yenidən hesabınıza daxil olun.", 401);
    const deviceId = uuid.parse((req.body as any)?.deviceId);
    const [d] = await query<any>(
      app.db,
      sql`SELECT d.id FROM devices d JOIN licenses l ON l.id=d.license_id JOIN customers c ON c.id=l.customer_id WHERE d.id=${deviceId}::uuid AND l.customer_id=${who.customerId}::uuid AND c.active AND d.status='active' AND l.status='active' AND COALESCE(l.features->>'product',CASE WHEN l.plan='market' THEN 'market' ELSE 'restaurant' END)='restaurant' AND l.valid_until>now()`,
    );
    if (!d)
      throw new TablePaymentError("Bu kassa üçün ödəniş icazəsi yoxdur.", 403);
    return who.customerId;
  }
  app.get(
    "/admin/restaurant-payments/:customer",
    wrap(async (req, reply) => {
      if (!requireSuperadmin(req, reply)) return;
      const customer = uuid.parse((req.params as any).customer);
      const merchants = await query<any>(
        app.db,
        sql`SELECT id,device_id,public_key,active,verified,created_at FROM restaurant_payment_merchants WHERE customer_id=${customer}::uuid ORDER BY created_at DESC`,
      );
      const reviews = await query<any>(
        app.db,
        sql`SELECT i.id,i.status,i.amount_minor,i.provider_transaction,i.error,i.created_at,b.device_id,b.snapshot->>'tableLabel' AS table_label FROM restaurant_table_payments i JOIN restaurant_payment_bills b ON b.id=i.bill_id WHERE b.customer_id=${customer}::uuid AND i.status IN('review','unknown','paid','creating') ORDER BY i.created_at DESC LIMIT 100`,
      );
      return {
        globallyEnabled: payments.enabled(),
        merchants: merchants.map((m) => ({
          ...m,
          hasPrivateKey: true,
          callbackUrl:
            "https://possistem.az/pos/api/billing/table/epoint/callback/" +
            m.id,
        })),
        reviews,
      };
    }),
  );
  app.post(
    "/admin/restaurant-payments/:customer",
    wrap(async (req, reply) => {
      if (!requireSuperadmin(req, reply)) return;
      const customer = uuid.parse((req.params as any).customer),
        actor = currentUser(req);
      const body = z
        .object({
          deviceId: uuid.nullable().default(null),
          publicKey: z.string().regex(/^i\d{4,30}$/),
          privateKey: z.string().min(8).max(4000).optional(),
          active: z.boolean().default(true),
          verified: z.boolean().default(false),
        })
        .strict()
        .parse(req.body);
      const [c] = await query<any>(
        app.db,
        sql`SELECT id FROM customers WHERE id=${customer}::uuid`,
      );
      if (!c) throw new TablePaymentError("Müştəri tapılmadı.", 404);
      if (body.deviceId) {
        const [d] = await query<any>(
          app.db,
          sql`SELECT d.id FROM devices d JOIN licenses l ON l.id=d.license_id WHERE d.id=${body.deviceId}::uuid AND l.customer_id=${customer}::uuid AND COALESCE(l.features->>'product',CASE WHEN l.plan='market' THEN 'market' ELSE 'restaurant' END)='restaurant'`,
        );
        if (!d)
          throw new TablePaymentError("Kassa bu restorana aid deyil.", 404);
      }
      const id = await app.db.transaction(async (tx: any) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${customer}))`,
        );
        const [old] = await query<any>(
          tx,
          sql`SELECT * FROM restaurant_payment_merchants WHERE customer_id=${customer}::uuid AND device_id IS NOT DISTINCT FROM ${body.deviceId}::uuid AND active FOR UPDATE`,
        );
        const key =
          body.privateKey ??
          (old?.public_key === body.publicKey
            ? unseal(old.private_cipher, customer, "merchant")
            : null);
        if (!key)
          throw new TablePaymentError(
            "Restoranın private açarını daxil edin.",
            400,
          );
        await tx.execute(
          sql`UPDATE restaurant_payment_merchants SET active=false WHERE customer_id=${customer}::uuid AND device_id IS NOT DISTINCT FROM ${body.deviceId}::uuid AND active`,
        );
        const id = randomUUID();
        await tx.execute(
          sql`INSERT INTO restaurant_payment_merchants(id,customer_id,device_id,public_key,private_cipher,active,verified,created_by) VALUES(${id}::uuid,${customer}::uuid,${body.deviceId}::uuid,${body.publicKey},${seal(key, customer, "merchant")},${body.active},${body.verified},${actor.id}::uuid)`,
        );
        return id;
      });
      await audit(app, {
        actorUserId: actor.id,
        action: "restaurant.payment.configure",
        entityType: "customer",
        entityId: customer,
        meta: {
          merchantId: id,
          deviceId: body.deviceId,
          publicKey: body.publicKey,
          verified: body.verified,
          active: body.active,
        },
        ip: req.ip,
      });
      return {
        id,
        callbackUrl:
          "https://possistem.az/pos/api/billing/table/epoint/callback/" + id,
      };
    }),
  );
  app.post(
    "/admin/restaurant-payments/:customer/payments/:id/check",
    wrap(async (req, reply) => {
      if (!requireSuperadmin(req, reply)) return;
      const customer = uuid.parse((req.params as any).customer),
        id = uuid.parse((req.params as any).id),
        b = z
          .object({ transaction: z.string().max(120).optional() })
          .strict()
          .parse(req.body);
      const result = await payments.adminCheck(customer, id, b.transaction);
      await audit(app, {
        actorUserId: currentUser(req).id,
        action: "restaurant.payment.reconcile",
        entityType: "table_payment",
        entityId: id,
        meta: { customerId: customer },
        ip: req.ip,
      });
      return result;
    }),
  );
  app.post(
    "/qr/device/payments/ready",
    wrap(async (req) => {
      const cid = await deviceAuth(req);
      return payments.ready(cid, uuid.parse((req.body as any).deviceId));
    }),
  );
  app.post(
    "/qr/device/payments/open",
    wrap(async (req) => {
      const cid = await deviceAuth(req);
      const b = z
        .object({
          deviceId: uuid,
          sessionId: uuid,
          secret: z.string().regex(/^[a-f0-9]{64}$/),
          snapshot,
        })
        .strict()
        .parse(req.body);
      const opened = await payments.open(cid, b.deviceId, b);
      return {
        ...opened,
        qr: await QRCode.toDataURL(opened.url, {
          width: 320,
          margin: 3,
          errorCorrectionLevel: "M",
        }),
      };
    }),
  );
  app.post(
    "/qr/device/payments/stop",
    wrap(async (req) => {
      const cid = await deviceAuth(req);
      const b = z
        .object({ deviceId: uuid, sessionId: uuid })
        .strict()
        .parse(req.body);
      return payments.stop(cid, b.deviceId, b.sessionId);
    }),
  );
  app.post(
    "/qr/device/payments/status",
    wrap(async (req) => {
      const cid = await deviceAuth(req),
        b = z
          .object({ deviceId: uuid, sessionId: uuid })
          .strict()
          .parse(req.body);
      return payments.posView(cid, b.deviceId, b.sessionId);
    }),
  );
  app.get(
    "/billing/table/:token",
    wrap(async (req) =>
      payments.view(
        z
          .string()
          .max(150)
          .parse((req.params as any).token),
      ),
    ),
  );
  app.post(
    "/billing/table/:token/quote",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    wrap(async (req) =>
      payments.preview(
        z
          .string()
          .max(150)
          .parse((req.params as any).token),
        selection.parse(req.body),
      ),
    ),
  );
  app.post(
    "/billing/table/:token/checkout",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    wrap(async (req) => {
      const b = z
        .object({
          requestId: uuid,
          selection,
          expectedAmountMinor: z.number().int().positive().max(100_000_000),
        })
        .strict()
        .parse(req.body);
      return payments.checkout(
        z
          .string()
          .max(150)
          .parse((req.params as any).token),
        b.requestId,
        b.selection,
        b.expectedAmountMinor,
      );
    }),
  );
  app.get(
    "/billing/table/:token/payments/:id",
    wrap(async (req) =>
      payments.intentView(
        z
          .string()
          .max(150)
          .parse((req.params as any).token),
        uuid.parse((req.params as any).id),
      ),
    ),
  );
  if (!app.hasContentTypeParser("application/x-www-form-urlencoded"))
    app.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "string" },
      (_req, body, done) =>
        done(null, Object.fromEntries(new URLSearchParams(String(body)))),
    );
  app.post(
    "/billing/table/epoint/callback/:merchant",
    { config: { rateLimit: { max: 600, timeWindow: "1 minute" } } },
    wrap(async (req) => {
      const b = z
        .object({ data: z.string(), signature: z.string() })
        .passthrough()
        .parse(req.body);
      return payments.callback(
        uuid.parse((req.params as any).merchant),
        b.data,
        b.signature,
      );
    }),
  );
  if (opts.worker !== false) {
    let busy = false;
    const timer = setInterval(() => {
      if (busy) return;
      busy = true;
      void payments
        .sweep()
        .catch(() => {})
        .finally(() => {
          busy = false;
        });
    }, 15_000);
    timer.unref();
    app.addHook("onClose", async () => clearInterval(timer));
  }
}
