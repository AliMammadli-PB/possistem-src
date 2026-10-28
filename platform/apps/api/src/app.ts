import {qrOrderRoutes} from './routes/qr-orders.js';
import {withinBudget} from './lib/request-budget.js';
import Fastify from 'fastify';
import { billingRoutes } from './routes/billing.js';
import { supportServiceRoutes } from './routes/support-service.js';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { env } from './env.js';
import { createRedactingLoggerOpts } from './lib/redact.js';
import { loadOrCreateSigningKeys } from './lib/keys.js';
import { dbPlugin } from './plugins/db.js';
import { authPlugin } from './plugins/auth.js';
import { customerAuthPlugin } from './plugins/customer-auth.js';
import { authRoutes } from './routes/auth.js';
import { deviceRoutes, activationRoutes } from './routes/devices.js';
import { healthRoutes, dashboardRoutes, settingsRoutes } from './routes/misc.js';
import { tenantRoutes, tenantRequestGuard } from './routes/tenant.js';
import { ownerRoutes } from './routes/owner.js';
import { resellerRoutes, salesRoutes } from './routes/resellers.js';
import { resellerPortalRoutes } from './routes/reseller-portal.js';
import { downloadRoutes } from './routes/downloads.js';
import { contactAdminRoutes, publicContactRoutes } from './routes/contact.js';
import { customerAuthRoutes } from './routes/customer-auth.js';
import { customerRoutes } from './routes/customer.js';
import { customerUploadRoutes } from './routes/customer-uploads.js';
import { gamecenterRoutes } from './routes/gamecenter.js';
import { marketRoutes } from './routes/market.js';
import { inventoryRoutes } from './routes/inventory.js';
import { accessRoutes } from './routes/access.js';
import { deviceStationRoutes } from './routes/device-stations.js';
import { supportAdminRoutes, supportCustomerRoutes } from './routes/support.js';
import { mailAdminRoutes } from './routes/mail.js';
import { subscriptionPlansRoutes } from './routes/subscription-plans.js';
import { packageBuilderRoutes } from './routes/package-builder.js';
import { partnerRoutes } from './routes/partners.js';
import { publicChatRoutes, publicChatSettingsRoutes } from './routes/public-chat.js';
import { adminProductRoutes, publicProductRoutes } from './routes/products.js';
import { publicVisitRoutes } from './routes/public-visits.js';
import { posRoleCustomerRoutes, posRoleAdminRoutes } from './routes/pos-roles.js';
import { posRemoteRoutes } from './routes/pos-remote.js';

export async function buildApp() {
  const app = Fastify({
    logger: createRedactingLoggerOpts(env.logLevel),
    // Only nginx runs in front of the API. It overwrites X-Forwarded-For with
    // a validated client address (including Cloudflare's real-IP ranges).
    trustProxy: ['127.0.0.1', '::1'],
    bodyLimit: 1024*1024,
    maxParamLength: 500,
  });

  // `origin: true` reflected any Origin with credentials attached, so every
  // authenticated GET (/owner/overview, /sales, /dashboard/stats) was readable
  // by any page an admin happened to visit - CSRF only guards the state-changing
  // verbs. Same-origin requests send no Origin header and are unaffected by the
  // allowlist.
  const allowedOrigins =
    env.corsOrigins.length > 0
      ? env.corsOrigins
      : [
          'http://localhost:5173',
          'http://localhost:5174',
          'http://localhost:5175',
          'http://127.0.0.1:5173',
        ];

  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
  });
  await app.register(cookie, {
    secret: env.sessionSecret,
  });
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
  });
  await app.register(multipart, {
    limits: {
      files: 1,
      fileSize: 12 * 1024 * 1024,
      fields: 8,
      parts: 9,
    },
  });
  app.setErrorHandler((error,req,reply)=>{
    const problem=error as Error&{statusCode?:number;code?:string};
    const status=Number(problem.statusCode)||500;
    if(status>=500){req.log.error({err:error},'request_failed');return reply.code(500).send({error:'Sorğu tamamlanmadı.',code:'INTERNAL_ERROR',requestId:req.id});}
    return reply.code(status).send({error:status===413?'Sorğu ölçü limitini keçir.':problem.message,code:problem.code});
  });
  app.addHook('preValidation',async(req,reply)=>{if(!withinBudget(req.body))return reply.code(413).send({error:'Sorğunun ölçüsü və ya dərinliyi limiti keçir.',code:'INPUT_BUDGET_EXCEEDED'});});
  app.addHook('onSend',async(req,reply,payload)=>{
    reply.header('X-Content-Type-Options','nosniff');
    if(req.headers.authorization||req.customer||req.user)reply.header('Cache-Control','private, no-store');
    return payload;
  });
  await app.register(dbPlugin);
  await app.register(authPlugin);
  await app.register(customerAuthPlugin);
  app.addHook('preHandler',async(req,reply)=>tenantRequestGuard(app,req,reply));

  loadOrCreateSigningKeys();

  await app.register(
    async (api) => {
      // Super admin (çerez oturumu)
      await api.register(authRoutes);
      await api.register(resellerRoutes);
      await api.register(salesRoutes);
      await api.register(downloadRoutes);
      await api.register(dashboardRoutes);
      await api.register(settingsRoutes);
      await api.register(publicChatSettingsRoutes);
      await api.register(contactAdminRoutes);
      await api.register(supportAdminRoutes);
      await api.register(supportServiceRoutes);
      await api.register(mailAdminRoutes);
      await api.register(adminProductRoutes);
      await api.register(posRoleAdminRoutes);

      // Bayi paneli (Bearer token — çerez yok, super admin uçlarına erişemez)
      await api.register(resellerPortalRoutes);

      // POS / owner istemcileri
      await api.register(billingRoutes);
      await api.register(qrOrderRoutes);
      await api.register(tenantRoutes);
      await api.register(ownerRoutes);
      await api.register(customerAuthRoutes);
      await api.register(customerRoutes);
      await api.register(posRoleCustomerRoutes);
      await api.register(posRemoteRoutes);
      await api.register(customerUploadRoutes);
      await api.register(supportCustomerRoutes);
      await api.register(activationRoutes);
      await api.register(deviceRoutes);
      await api.register(marketRoutes);
      await api.register(inventoryRoutes);
      await api.register(accessRoutes);
      await api.register(deviceStationRoutes);

      // Marketinq saytı — açıq, sürət limiti olan əlaqə formu.
      await api.register(publicContactRoutes);
      await api.register(publicChatRoutes);
      await api.register(publicProductRoutes);
      await api.register(publicVisitRoutes);
      await api.register(subscriptionPlansRoutes);
      await api.register(packageBuilderRoutes);
      await api.register(partnerRoutes);
      await api.register(gamecenterRoutes);
      await api.register(healthRoutes);
    },
    { prefix: '/pos/api' },
  );

  return app;
}
