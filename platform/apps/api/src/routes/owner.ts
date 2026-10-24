import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import {
  OwnerBotMessageSchema,
  OwnerCommandResultSchema,
  OwnerConnectIngestSchema,
  OwnerDeviceAuthSchema,
  OwnerDeviceSyncSchema,
  OwnerDeviceWhatsappSaveSchema,
  OwnerDeviceWhatsappTestSchema,
  OwnerFloorIngestSchema,
  OwnerPushSubscribeSchema,
  OwnerReportIngestSchema,
  OwnerSettingsSchema,
  OwnerWhatsappSettingsSchema,
} from '@milioner/contracts';
import {
  customers,
  devices,
  licenses,
  ownerFloorSnapshots,
  ownerNotifications,
  ownerPushSubscriptions,
  ownerWhatsappSettings,
} from '@milioner/database';
import { env } from '../env.js';
import { createOwnerNotification } from '../lib/notify.js';
import {
  getActiveChatTicket,
  getTicketMessages,
  openSupportRequest,
  recordSupportHeartbeatIfDue,
  sendSupportAttachmentForCustomer,
  serializeTicket,
} from '../lib/support.js';
import {
  getDeviceStatus,
  getFloorLive,
  getSalesLive,
  isDeviceOnline,
  mysqlEnabled,
  recentBotCommands,
  replaceProductsLive,
  replaceStaffLive,
  replaceTablesLive,
  takeBotCommands,
  upsertDeviceStatus,
  upsertFloorLive,
  upsertReportLive,
  upsertSalesLive,
} from '../lib/mysql.js';
import { handleBotMessage } from '../lib/bot/commands.js';
import { portalRpcActive, settleCommand } from '../lib/bot/queue.js';
import {
  appendChatMessage,
  ensureChatWelcome,
  listChatMessages,
} from '../lib/owner-chat.js';
import {
  clearWhatsappAuth,
  getWhatsappRuntime,
  normalizePhone,
  sendWhatsappText,
  startWhatsappPairing,
  waitForQr,
} from '../lib/whatsapp.js';
import { parseBody, clientIp } from '../lib/validate.js';
import { writeAudit } from '../lib/audit.js';
import { requireSuperadmin, currentUser } from '../plugins/auth.js';
import { resolveTenantToken } from './tenant.js';

const WHATSAPP_DEFAULT_TEMPLATE = '*{admin}*\n{title}\n{body}';

async function persistWhatsappStatus(
  app: FastifyInstance,
  customerId: string,
  waStatus: string,
  waUser: string | null,
) {
  await app.db
    .insert(ownerWhatsappSettings)
    .values({
      customerId,
      waStatus,
      waUser,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: ownerWhatsappSettings.customerId,
      set: { waStatus, waUser, updatedAt: new Date() },
    });
}

async function loadWhatsappRow(app: FastifyInstance, customerId: string) {
  const [row] = await app.db
    .select()
    .from(ownerWhatsappSettings)
    .where(eq(ownerWhatsappSettings.customerId, customerId))
    .limit(1);
  return row ?? null;
}

/**
 * Tells the owner's phone the bot is live.
 *
 * Sent once per pairing: without it "QR scanned" is a claim only the screen
 * makes, and the first proof the channel works would be a Z report at 2am.
 */
async function announceWhatsappActivation(
  app: FastifyInstance,
  customerId: string,
  row: { enabled: boolean; recipientPhone: string; adminName: string } | null,
) {
  if (!row?.enabled || !row.recipientPhone) return;
  const text = [
    '✅ *POSSISTEM — WhatsApp bot aktivdir*',
    '',
    `Salam, ${row.adminName || 'Admin'}.`,
    'Bu nömrə X/Z hesabat bildirişlərini alacaq.',
    '',
    '_Hörmətlə,_',
    '*POSSISTEM*',
  ].join('\n');
  const result = await sendWhatsappText(customerId, row.recipientPhone, text);
  if (!result.ok) {
    app.log.warn({ customerId, error: result.error }, 'whatsapp_activation_notice_failed');
    return;
  }
  app.log.info({ customerId }, 'whatsapp_activation_notice_sent');
}

/** Stores a live pairing, announcing it the first time the session comes up. */
async function markWhatsappConnected(
  app: FastifyInstance,
  customerId: string,
  waUser: string | null,
) {
  const row = await loadWhatsappRow(app, customerId);
  const wasConnected = row?.waStatus === 'connected';
  await persistWhatsappStatus(app, customerId, 'connected', waUser);
  if (wasConnected) return;
  await announceWhatsappActivation(app, customerId, row).catch((err) => {
    app.log.warn({ err, customerId }, 'whatsapp_activation_notice_error');
  });
}

// ---------------------------------------------------------------------------
// WhatsApp operations, shared by the owner web (tenant token) and the POS app
// (device credentials). Both surfaces must behave identically — a restaurant
// that pairs from the till and one that pairs from the site get one session.
// ---------------------------------------------------------------------------

async function whatsappConfigFor(app: FastifyInstance, customerId: string) {
  const row = await loadWhatsappRow(app, customerId);
  const runtime = getWhatsappRuntime(customerId);
  if (runtime.status === 'open') {
    await markWhatsappConnected(app, customerId, runtime.waUser);
  }
  // The command journal is what makes a remote action reviewable from the
  // till, so it travels with the settings rather than behind another call.
  let commands: {
    id: string;
    command: string;
    status: string;
    requestedBy: string | null;
    createdAt: string;
    error: string | null;
  }[] = [];
  try {
    commands = (await recentBotCommands(customerId, 10)).map((row) => ({
      id: row.id,
      command: row.command,
      status: row.status,
      requestedBy: row.requested_by,
      createdAt: new Date(row.created_at).toISOString(),
      error: row.error,
    }));
  } catch {
    /* the live database is optional; settings must still load */
  }

  // Till diagnostics: without these fields the POS shows
  // "server məlumat vermir — control API-ni yeniləyin".
  const device = mysqlEnabled() ? await getDeviceStatus(customerId).catch(() => null) : null;
  const runtimeAny = runtime as { lastInboundAt?: number | null; lastOutboundAt?: number | null };
  const diagnostics = {
    liveDatabase: mysqlEnabled(),
    deviceRegistered: Boolean(device),
    deviceOnline: Boolean(device && isDeviceOnline(device.last_seen_at, device.connected)),
    deviceLastSeenAt: device?.last_seen_at ? new Date(device.last_seen_at).toISOString() : null,
    lastInboundAt: runtimeAny.lastInboundAt
      ? new Date(runtimeAny.lastInboundAt).toISOString()
      : null,
    lastOutboundAt: runtimeAny.lastOutboundAt
      ? new Date(runtimeAny.lastOutboundAt).toISOString()
      : null,
  };

  return {
    enabled: row?.enabled ?? true,
    recipientPhone: row?.recipientPhone ?? '',
    adminName: row?.adminName ?? 'Admin',
    messageTemplate: row?.messageTemplate ?? WHATSAPP_DEFAULT_TEMPLATE,
    diagnostics,
    botEnabled: row?.botEnabled ?? true,
    allowedNumbers: Array.isArray(row?.allowedNumbers) ? row.allowedNumbers : [],
    botPermissions: {
      read: (row?.botPermissions as Record<string, boolean> | undefined)?.read !== false,
      reports: (row?.botPermissions as Record<string, boolean> | undefined)?.reports !== false,
      catalog: (row?.botPermissions as Record<string, boolean> | undefined)?.catalog === true,
      alerts: (row?.botPermissions as Record<string, boolean> | undefined)?.alerts !== false,
    },
    commands,
    waStatus: runtime.status === 'open' ? 'connected' : (row?.waStatus ?? 'disconnected'),
    waUser: runtime.waUser ?? row?.waUser ?? null,
    runtime: {
      status: runtime.status,
      qrDataUrl: runtime.qrDataUrl,
      lastError: runtime.lastError,
    },
  };
}

type WhatsappSaveInput = {
  enabled?: boolean;
  recipientPhone: string;
  adminName: string;
  messageTemplate: string;
  botEnabled?: boolean;
  allowedNumbers?: string[];
  botPermissions?: Partial<Record<'read' | 'reports' | 'catalog' | 'alerts', boolean>>;
};

async function whatsappSaveFor(
  app: FastifyInstance,
  customerId: string,
  body: WhatsappSaveInput,
): Promise<
  | { ok: true; data: { enabled: boolean; recipientPhone: string; adminName: string; messageTemplate: string } }
  | { ok: false; error: string }
> {
  const phone = normalizePhone(body.recipientPhone);
  if (!phone) return { ok: false, error: 'Telefon nömrəsi yanlışdır' };
  const previous = await loadWhatsappRow(app, customerId);
  const enabled = body.enabled ?? true;
  const adminName = body.adminName.trim();

  // A number the bot cannot parse would silently never be allowed to command
  // it, so the whole save is rejected rather than half-applied.
  const allowedNumbers: string[] = [];
  for (const raw of body.allowedNumbers ?? []) {
    const normalized = normalizePhone(raw);
    if (!normalized) return { ok: false, error: `İcazəli nömrə yanlışdır: ${raw}` };
    if (normalized !== phone && !allowedNumbers.includes(normalized)) {
      allowedNumbers.push(normalized);
    }
  }

  const previousPermissions = (previous?.botPermissions ?? {}) as Record<string, boolean>;
  const botPermissions = {
    read: body.botPermissions?.read ?? previousPermissions.read ?? true,
    reports: body.botPermissions?.reports ?? previousPermissions.reports ?? true,
    catalog: body.botPermissions?.catalog ?? previousPermissions.catalog ?? false,
    alerts: body.botPermissions?.alerts ?? previousPermissions.alerts ?? true,
  };
  const botEnabled = body.botEnabled ?? previous?.botEnabled ?? true;

  const [row] = await app.db
    .insert(ownerWhatsappSettings)
    .values({
      customerId,
      enabled,
      recipientPhone: phone,
      adminName,
      messageTemplate: body.messageTemplate,
      botEnabled,
      allowedNumbers,
      botPermissions,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: ownerWhatsappSettings.customerId,
      set: {
        enabled,
        recipientPhone: phone,
        adminName,
        messageTemplate: body.messageTemplate,
        botEnabled,
        allowedNumbers,
        botPermissions,
        updatedAt: new Date(),
      },
    })
    .returning();

  // Pairing usually happens before the number is known, so the greeting has to
  // follow the number when it arrives — otherwise a live bot never says hello.
  const runtime = getWhatsappRuntime(customerId);
  const phoneChanged = previous?.recipientPhone !== phone;
  if (runtime.status === 'open' && enabled && phoneChanged) {
    await announceWhatsappActivation(app, customerId, {
      enabled,
      recipientPhone: phone,
      adminName,
    }).catch((err) => {
      app.log.warn({ err, customerId }, 'whatsapp_activation_notice_error');
    });
  }

  return {
    ok: true,
    data: {
      enabled: row.enabled,
      recipientPhone: row.recipientPhone,
      adminName: row.adminName,
      messageTemplate: row.messageTemplate,
    },
  };
}

async function whatsappConnectFor(app: FastifyInstance, customerId: string) {
  await startWhatsappPairing(customerId);
  const qr = await waitForQr(customerId, 20_000);
  const runtime = getWhatsappRuntime(customerId);
  if (runtime.status === 'open') {
    await markWhatsappConnected(app, customerId, runtime.waUser);
  }
  return {
    status: runtime.status,
    qrDataUrl: qr ?? runtime.qrDataUrl,
    waUser: runtime.waUser,
    lastError: runtime.lastError,
  };
}

async function whatsappStatusFor(app: FastifyInstance, customerId: string) {
  const runtime = getWhatsappRuntime(customerId);
  if (runtime.status === 'open') {
    await markWhatsappConnected(app, customerId, runtime.waUser);
  }
  return {
    status: runtime.status,
    qrDataUrl: runtime.qrDataUrl,
    waUser: runtime.waUser,
    lastError: runtime.lastError,
  };
}

async function whatsappDisconnectFor(app: FastifyInstance, customerId: string) {
  await clearWhatsappAuth(customerId);
  await persistWhatsappStatus(app, customerId, 'disconnected', null);
  return { ok: true as const };
}

async function whatsappTestFor(
  app: FastifyInstance,
  customerId: string,
  phoneRaw: string | undefined,
): Promise<{ ok: true; phone: string } | { ok: false; error: string }> {
  const row = await loadWhatsappRow(app, customerId);
  const candidate = (phoneRaw && phoneRaw.trim() ? phoneRaw : row?.recipientPhone) || '';
  const phone = normalizePhone(candidate);
  if (!phone) return { ok: false, error: 'Mesaj alacaq telefonu yazın' };

  const runtime = getWhatsappRuntime(customerId);
  if (runtime.status !== 'open') {
    return { ok: false, error: 'Əvvəlcə WhatsApp QR oxudun (status: bağlı olmalıdır)' };
  }
  const text = [
    '✅ *POSSISTEM — test mesajı*',
    '',
    'Bu mesaj test məqsədi ilə göndərilib.',
    'WhatsApp bildiriş kanalı işləyir.',
    '',
    '_Hörmətlə,_',
    '*POSSISTEM Test Bot*',
  ].join('\n');
  const result = await sendWhatsappText(customerId, phone, text);
  if (!result.ok) {
    const map: Record<string, string> = {
      whatsapp_not_connected: 'WhatsApp bağlı deyil — QR oxudun',
      invalid_phone: 'Telefon nömrəsi yanlışdır',
    };
    return { ok: false, error: map[result.error || ''] || result.error || 'Göndərilmədi' };
  }
  return { ok: true, phone };
}

function bearer(req: { headers: { authorization?: string } }): string | null {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return null;
}

function requireTenant(
  req: {
    headers: { authorization?: string };
    customer?: { id: string; email: string } | null;
  },
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
) {
  if (req.customer) {
    return {
      customerId: req.customer.id,
      email: req.customer.email,
      client: 'customer-portal',
    };
  }
  const session = resolveTenantToken(bearer(req) ?? undefined);
  if (!session) {
    reply.code(401).send({ error: 'Unauthorized' });
    return null;
  }
  return session;
}

/** Length-safe constant-time compare; a mismatched length is just a mismatch. */
function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function fingerprintsMatch(stored: string, provided: string): boolean {
  const left = stored.trim().toLowerCase();
  const right = provided.trim().toLowerCase();
  if (!left || left.length !== right.length) return false;
  return secretsMatch(left, right);
}

type DeviceLoginClaim = {
  customerId?: string;
  tenantEmail?: string;
};

type ResolvedOwnerDevice = {
  device: typeof devices.$inferSelect;
  license: typeof licenses.$inferSelect;
  customerId: string;
};

async function activeCustomerId(app: FastifyInstance, id: string): Promise<string | null> {
  const [row] = await app.db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, id), eq(customers.active, true)))
    .limit(1);
  return row?.id ?? null;
}

/**
 * The restaurant the till is signed into — token, then email, then a UUID that
 * actually exists here. A leftover licence UUID from a dead host is ignored.
 */
/**
 * The caller's customer id, and only when they proved it.
 *
 * Unlike `loginCustomerIdFromAuth` this has no email or body fallback: a
 * signed tenant token or nothing. Use it for decisions that change stored
 * identity, never for merely reading.
 */
function verifiedCustomerIdFromAuth(req: { headers: { authorization?: string } }): string | null {
  const token = resolveTenantToken(bearer(req) ?? undefined);
  return token?.customerId ?? null;
}

async function loginCustomerIdFromAuth(
  app: FastifyInstance,
  req: { headers: { authorization?: string } },
  body: DeviceLoginClaim,
): Promise<string | null> {
  const token = resolveTenantToken(bearer(req) ?? undefined);
  if (token?.customerId) {
    const id = await activeCustomerId(app, token.customerId);
    if (id) return id;
  }
  const email = (token?.email || body.tenantEmail || '').trim().toLowerCase();
  if (email.includes('@')) {
    const [row] = await app.db
      .select({ id: customers.id })
      .from(customers)
      .where(and(sql`lower(${customers.email}) = ${email}`, eq(customers.active, true)))
      .limit(1);
    if (row) return row.id;
  }
  if (body.customerId) return activeCustomerId(app, body.customerId);
  return null;
}

async function bindDeviceToCustomer(
  app: FastifyInstance,
  deviceId: string,
  fingerprint: string,
  customerId: string,
  existing: typeof devices.$inferSelect | null,
): Promise<ResolvedOwnerDevice | null> {
  const [license] = await app.db
    .select()
    .from(licenses)
    .where(and(eq(licenses.customerId, customerId), eq(licenses.status, 'active')))
    .limit(1);
  if (!license) {
    app.log.warn({ customerId, deviceId }, 'owner_device_bind_no_license');
    return null;
  }

  // Revoked tills must not keep holding a seat: replacing a broken register
  // otherwise consumed capacity forever, and the shop could not bind the
  // replacement even though the admin panel showed a free slot. Same rule the
  // activation endpoint enforces.
  const occupied = await app.db
    .select({ id: devices.id })
    .from(devices)
    .where(
      and(
        eq(devices.licenseId, license.id),
        sql`${devices.status} <> 'revoked'`,
        ...(existing ? [ne(devices.id, existing.id)] : []),
      ),
    );
  const alreadyOnLicense = existing?.licenseId === license.id;
  if (!alreadyOnLicense && occupied.length >= license.seats) {
    app.log.warn(
      { customerId, seats: license.seats, have: occupied.length },
      'owner_device_bind_no_seat',
    );
    return null;
  }

  try {
    if (existing) {
      if (alreadyOnLicense) {
        return { device: existing, license, customerId };
      }
      const [updated] = await app.db
        .update(devices)
        .set({
          licenseId: license.id,
          branchId: license.branchId,
          deviceFingerprint: fingerprint.trim(),
          status: 'active',
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(devices.id, existing.id))
        .returning();
      if (!updated) return null;
      app.log.info(
        { deviceId, fromLicense: existing.licenseId, toLicense: license.id, customerId },
        'owner_device_rebound_to_login',
      );
      return { device: updated, license, customerId };
    }

    const [created] = await app.db
      .insert(devices)
      .values({
        id: deviceId,
        licenseId: license.id,
        branchId: license.branchId,
        deviceFingerprint: fingerprint.trim(),
        status: 'active',
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    if (!created) return null;
    app.log.info({ deviceId, customerId }, 'owner_device_bound_to_login');
    return { device: created, license, customerId };
  } catch (err) {
    app.log.warn({ err, deviceId, customerId }, 'owner_device_bind_failed');
    return null;
  }
}

async function resolveDeviceCustomer(
  app: FastifyInstance,
  deviceId: string,
  fingerprint: string,
  loginCustomerId?: string | null,
  /** Set only from a signed tenant token - see verifiedCustomerIdFromAuth. */
  verifiedCustomerId?: string | null,
): Promise<ResolvedOwnerDevice | null> {
  let [device] = await app.db.select().from(devices).where(eq(devices.id, deviceId)).limit(1);
  if (!device || device.status === 'revoked') {
    const byFp = await app.db
      .select()
      .from(devices)
      .where(eq(devices.deviceFingerprint, fingerprint.trim()))
      .limit(2);
    if (byFp.length === 1 && byFp[0]!.status !== 'revoked') {
      app.log.warn({ deviceId, actualDeviceId: byFp[0]!.id }, 'owner_device_id_stale_fp_matched');
      device = byFp[0]!;
    }
  }
  if (!device || device.status === 'revoked') {
    app.log.warn(
      {
        deviceId,
        loginCustomerId: loginCustomerId ?? null,
        fpLen: fingerprint.length,
        fpPrefix: fingerprint.trim().slice(0, 8),
      },
      'owner_device_unrecognized',
    );
    if (loginCustomerId) {
      return bindDeviceToCustomer(app, deviceId, fingerprint, loginCustomerId, null);
    }
    return null;
  }
  if (!fingerprintsMatch(device.deviceFingerprint, fingerprint)) {
    // Rejected for legacy devices too. `heartbeatAuthRequired` governs whether a
    // signed Ed25519 proof is demanded on top — it was never meant to waive the
    // fingerprint itself. Accepting a mismatch meant the deviceId alone, a UUID
    // that travels in every request and is shown in the admin UI as `hwid`, was
    // enough to push fabricated floor totals and X/Z reports into an owner's
    // dashboard. A legitimate till always sends its own fingerprint; one whose
    // hardware genuinely changed has to be re-bound, exactly as a
    // proof-required device already must.
    app.log.warn(
      {
        deviceId,
        legacy: !device.heartbeatAuthRequired,
        storedLen: device.deviceFingerprint.length,
        providedLen: fingerprint.length,
      },
      'owner_device_fp_mismatch',
    );
    // The owner, proving who they are, may re-bind their own device. This is
    // the documented way back for hardware that genuinely changed; without it
    // a reinstalled till is locked out permanently and its dashboard silently
    // freezes on the last figures that got through.
    if (verifiedCustomerId) {
      const [owned] = await app.db
        .select({ customerId: licenses.customerId })
        .from(licenses)
        .where(eq(licenses.id, device.licenseId))
        .limit(1);
      if (owned && owned.customerId === verifiedCustomerId) {
        const rebound = await bindDeviceToCustomer(
          app,
          deviceId,
          fingerprint,
          verifiedCustomerId,
          device,
        );
        if (rebound) {
          app.log.warn({ deviceId, customerId: verifiedCustomerId }, 'owner_device_fp_rebound');
          return rebound;
        }
      }
    }
    return null;
  }
  const [license] = await app.db
    .select()
    .from(licenses)
    .where(eq(licenses.id, device.licenseId))
    .limit(1);
  if (!license) return null;

  if (loginCustomerId && loginCustomerId !== license.customerId) {
    const rebound = await bindDeviceToCustomer(
      app,
      deviceId,
      fingerprint,
      loginCustomerId,
      device,
    );
    if (rebound) return rebound;
    app.log.warn(
      { deviceId, loginCustomerId, licenseCustomerId: license.customerId },
      'owner_device_login_without_rebind',
    );
    return { device, license, customerId: loginCustomerId };
  }

  return { device, license, customerId: license.customerId };
}

/**
 * Sends the owner's X/Z alert exactly once, whichever route delivered the report.
 *
 * The till both POSTs `/owner/ingest/report` and piggybacks the same report on
 * its next `/owner/device/sync`. Only the first route notified, so a failed POST
 * meant the report reached the live mirror while the owner's phone stayed
 * silent. Both routes call this now, and the guard below stops the ordinary case
 * from sending twice: a report is identified by its business date and sequence
 * number, which the till assigns.
 */
async function notifyReportOnce(
  app: FastifyInstance,
  customerId: string,
  report: {
    kind: 'x' | 'z';
    totals?: Record<string, unknown>;
    canonical?: Record<string, unknown>;
    businessDate?: string | null;
    sequenceNo?: number | null;
  },
): Promise<void> {
  const kind = report.kind === 'z' ? 'z_report' : 'x_report';
  const businessDate = report.businessDate ?? null;
  const sequenceNo = report.sequenceNo ?? null;

  // Only a report that identifies itself can be de-duplicated; one that does
  // not is rare and better sent twice than dropped.
  if (businessDate !== null || sequenceNo !== null) {
    const [existing] = await app.db
      .select({ id: ownerNotifications.id })
      .from(ownerNotifications)
      .where(
        and(
          eq(ownerNotifications.customerId, customerId),
          eq(ownerNotifications.kind, kind),
          sql`${ownerNotifications.payload}->>'businessDate' IS NOT DISTINCT FROM ${businessDate}`,
          sql`${ownerNotifications.payload}->>'sequenceNo' IS NOT DISTINCT FROM ${
            sequenceNo === null ? null : String(sequenceNo)
          }`,
          sql`${ownerNotifications.createdAt} > now() - interval '10 minutes'`,
        ),
      )
      .limit(1);
    if (existing) {
      app.log.info({ customerId, kind, sequenceNo }, 'owner_report_notify_deduped');
      return;
    }
  }

  const totals = report.totals ?? {};
  const canonical = report.canonical ?? {};
  const salesBlock = (totals.sales ?? canonical.sales ?? {}) as Record<string, unknown>;
  const sales =
    typeof salesBlock.grossMinor === 'number'
      ? salesBlock.grossMinor
      : typeof salesBlock.todayMinor === 'number'
        ? salesBlock.todayMinor
        : typeof totals.grossSalesMinor === 'number'
          ? totals.grossSalesMinor
          : typeof canonical.grossSalesMinor === 'number'
            ? canonical.grossSalesMinor
            : 0;

  const kindLabel = report.kind === 'z' ? 'Z hesabat' : 'X hesabat';
  const bodyText = [
    businessDate ? `Tarix: ${businessDate}` : null,
    sales ? `Satış: ${formatMoneyAz(Number(sales))}` : null,
    sequenceNo != null ? `№ ${sequenceNo}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  await createOwnerNotification(app, {
    customerId,
    kind,
    title: `${kindLabel} çıxarıldı`,
    body: bodyText || kindLabel,
    payload: {
      kind: report.kind,
      totals,
      businessDate,
      sequenceNo,
    },
  });
}

function formatMoneyAz(minor: number): string {
  const abs = Math.abs(Math.trunc(minor));
  const manat = Math.floor(abs / 100);
  const qepik = String(abs % 100).padStart(2, '0');
  return `${manat},${qepik} AZN`;
}

import { signDeviceCommand } from '../lib/command-signing.js';
import { effectiveRolePolicy, superAdminGrant } from './pos-roles.js';
import { surfaceAccess } from './access.js';
import { deviceStation } from './device-stations.js';

export async function ownerRoutes(app: FastifyInstance) {
  app.get('/owner/vapid-public-key', async () => ({
    publicKey: env.vapidPublicKey || null,
  }));

  app.get('/owner/overview', async (req, reply) => {
    const session = requireTenant(req, reply);
    if (!session) return;

    const [floorPg] = await app.db
      .select()
      .from(ownerFloorSnapshots)
      .where(eq(ownerFloorSnapshots.customerId, session.customerId))
      .limit(1);

    const [customer] = await app.db
      .select()
      .from(customers)
      .where(eq(customers.id, session.customerId))
      .limit(1);

    const unread = await app.db
      .select({ count: sql<number>`count(*)::int` })
      .from(ownerNotifications)
      .where(
        and(
          eq(ownerNotifications.customerId, session.customerId),
          sql`${ownerNotifications.readAt} IS NULL`,
        ),
      );

    let floor = {
      tables: [] as unknown[],
      openTables: 0,
      openTotalMinor: 0,
      todaySalesMinor: 0,
      todayPaidMinor: 0,
      paymentCount: 0,
      updatedAt: null as string | null,
      businessDate: null as string | null,
      source: 'none' as 'mysql' | 'postgres' | 'none',
    };

    const mysqlFloor = mysqlEnabled() ? await getFloorLive(session.customerId) : null;
    const mysqlUpdated = mysqlFloor?.updated_at
      ? new Date(mysqlFloor.updated_at).getTime()
      : 0;
    const pgUpdated = floorPg?.updatedAt ? floorPg.updatedAt.getTime() : 0;
    // Prefer freshest source so a MySQL write failure still shows live PG data.
    if (mysqlFloor && mysqlUpdated >= pgUpdated) {
      const payload =
        typeof mysqlFloor.payload === 'string'
          ? (JSON.parse(mysqlFloor.payload) as { tables?: unknown[]; businessDate?: string })
          : ((mysqlFloor.payload as { tables?: unknown[]; businessDate?: string } | null) ?? {});
      floor = {
        tables: payload.tables ?? [],
        openTables: Number(mysqlFloor.open_tables) || 0,
        openTotalMinor: Number(mysqlFloor.open_total_minor) || 0,
        todaySalesMinor: Number(mysqlFloor.today_sales_minor) || 0,
        todayPaidMinor: Number(mysqlFloor.today_paid_minor) || 0,
        paymentCount: Number(mysqlFloor.payment_count) || 0,
        updatedAt: mysqlFloor.updated_at
          ? new Date(mysqlFloor.updated_at).toISOString()
          : null,
        businessDate: mysqlFloor.business_date ?? payload.businessDate ?? null,
        source: 'mysql',
      };
    } else if (floorPg) {
      const payload = floorPg.payload as {
        tables?: unknown[];
        businessDate?: string;
        todayPaidMinor?: number;
        paymentCount?: number;
      };
      floor = {
        tables: payload?.tables ?? [],
        openTables: floorPg.openTables,
        openTotalMinor: floorPg.openTotalMinor,
        todaySalesMinor: floorPg.todaySalesMinor,
        todayPaidMinor: Number(payload?.todayPaidMinor) || 0,
        paymentCount: Number(payload?.paymentCount) || 0,
        updatedAt: floorPg.updatedAt?.toISOString() ?? null,
        businessDate: payload?.businessDate ?? null,
        source: 'postgres',
      };
    }

    const device = mysqlEnabled() ? await getDeviceStatus(session.customerId) : null;
    const connected = device
      ? isDeviceOnline(device.last_seen_at, device.connected)
      : Boolean(floor.updatedAt && Date.now() - new Date(floor.updatedAt).getTime() < 90_000);

    return {
      customer: {
        id: customer?.id,
        name: customer?.name,
        email: customer?.email,
        notifyEmail: customer?.notifyEmail ?? customer?.email ?? null,
        boundHwid: customer?.boundHwid ? `${customer.boundHwid.slice(0, 8)}…` : null,
      },
      connection: {
        connected,
        lastSeenAt: device?.last_seen_at
          ? new Date(device.last_seen_at).toISOString()
          : floor.updatedAt,
        appVersion: device?.app_version ?? null,
        source: floor.source,
        mysqlEnabled: mysqlEnabled(),
      },
      floor,
      unreadNotifications: unread[0]?.count ?? 0,
    };
  });

  app.get('/owner/notifications', async (req, reply) => {
    const session = requireTenant(req, reply);
    if (!session) return;
    const rows = await app.db
      .select()
      .from(ownerNotifications)
      .where(eq(ownerNotifications.customerId, session.customerId))
      .orderBy(desc(ownerNotifications.createdAt))
      .limit(50);
    return {
      notifications: rows.map((n) => ({
        id: n.id,
        kind: n.kind,
        title: n.title,
        body: n.body,
        payload: n.payload,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
    };
  });

  app.post('/owner/notifications/read', async (req, reply) => {
    const session = requireTenant(req, reply);
    if (!session) return;
    const body = (req.body ?? {}) as { id?: string };
    if (body.id) {
      await app.db
        .update(ownerNotifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(ownerNotifications.id, body.id),
            eq(ownerNotifications.customerId, session.customerId),
          ),
        );
    } else {
      await app.db
        .update(ownerNotifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(ownerNotifications.customerId, session.customerId),
            sql`${ownerNotifications.readAt} IS NULL`,
          ),
        );
    }
    return { ok: true };
  });

  app.get('/owner/settings', async (req, reply) => {
    const session = requireTenant(req, reply);
    if (!session) return;
    const [customer] = await app.db
      .select()
      .from(customers)
      .where(eq(customers.id, session.customerId))
      .limit(1);
    return {
      notifyEmail: customer?.notifyEmail ?? customer?.email ?? '',
      email: customer?.email ?? '',
      boundHwid: customer?.boundHwid ? `${customer.boundHwid.slice(0, 12)}…` : null,
    };
  });

  app.patch('/owner/settings', async (req, reply) => {
    const session = requireTenant(req, reply);
    if (!session) return;
    const body = parseBody(OwnerSettingsSchema, req.body, reply);
    if (!body) return;
    const [row] = await app.db
      .update(customers)
      .set({ notifyEmail: body.notifyEmail.toLowerCase().trim(), updatedAt: new Date() })
      .where(eq(customers.id, session.customerId))
      .returning();
    await writeAudit(app, {
      action: 'owner.settings',
      entityType: 'customer',
      entityId: session.customerId,
      ip: clientIp(req),
      meta: { notifyEmail: body.notifyEmail },
    });
    return { notifyEmail: row?.notifyEmail ?? body.notifyEmail };
  });

  app.get('/owner/whatsapp', async (req, reply) => {
    const session = requireTenant(req, reply);
    if (!session) return;
    return whatsappConfigFor(app, session.customerId);
  });

  app.patch('/owner/whatsapp', async (req, reply) => {
    const session = requireTenant(req, reply);
    if (!session) return;
    const body = parseBody(OwnerWhatsappSettingsSchema, req.body, reply);
    if (!body) return;
    const saved = await whatsappSaveFor(app, session.customerId, body);
    if (!saved.ok) return reply.code(400).send({ error: saved.error });
    return saved.data;
  });

  app.post('/owner/whatsapp/connect', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const session = requireTenant(req, reply);
    if (!session) return;
    try {
      return await whatsappConnectFor(app, session.customerId);
    } catch (err) {
      app.log.warn({ err }, 'whatsapp_connect_failed');
      return reply.code(500).send({
        error: err instanceof Error ? err.message : 'WhatsApp bağlantısı alınmadı',
      });
    }
  });

  app.get('/owner/whatsapp/status', async (req, reply) => {
    const session = requireTenant(req, reply);
    if (!session) return;
    return whatsappStatusFor(app, session.customerId);
  });

  app.post('/owner/whatsapp/disconnect', async (req, reply) => {
    const session = requireTenant(req, reply);
    if (!session) return;
    return whatsappDisconnectFor(app, session.customerId);
  });

  app.post('/owner/whatsapp/test', {
    config: { rateLimit: { max: 8, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const session = requireTenant(req, reply);
    if (!session) return;
    const body = (req.body ?? {}) as { phone?: string };
    const result = await whatsappTestFor(app, session.customerId, body.phone);
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true, phone: result.phone };
  });

  // -------------------------------------------------------------------------
  // Portal chat — same bot engine as WhatsApp, for the phone web app.
  // -------------------------------------------------------------------------

  app.get('/owner/bot/chat', async (req, reply) => {
    const session = requireTenant(req, reply);
    if (!session) return;
    const query = req.query as { after?: string; limit?: string };
    const row = await loadWhatsappRow(app, session.customerId);
    await ensureChatWelcome(app, session.customerId, row?.adminName ?? 'Admin');
    const messages = await listChatMessages(app, session.customerId, {
      after: query.after ?? null,
      limit: query.limit ? Number(query.limit) : 80,
    });
    const device = mysqlEnabled() ? await getDeviceStatus(session.customerId).catch(() => null) : null;
    return {
      messages,
      quickActions: [
        { label: 'X hesabat', text: 'X HESABAT' },
        { label: 'Z hesabat', text: 'Z HESABAT' },
        { label: 'Masalar', text: 'MASALAR' },
        { label: 'Satış', text: 'SATIŞ' },
        { label: 'Ümumi', text: 'ÜMUMİ' },
        { label: 'Status', text: 'STATUS' },
        { label: 'Son hesabat', text: 'SON HESABAT' },
        { label: 'Kömək', text: 'KÖMƏK' },
      ],
      diagnostics: {
        liveDatabase: mysqlEnabled(),
        deviceRegistered: Boolean(device),
        deviceOnline: Boolean(device && isDeviceOnline(device.last_seen_at, device.connected)),
        deviceLastSeenAt: device?.last_seen_at ? new Date(device.last_seen_at).toISOString() : null,
        botEnabled: row?.botEnabled ?? true,
      },
    };
  });

  app.post('/owner/bot/message', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const session = requireTenant(req, reply);
    if (!session) return;
    const body = parseBody(OwnerBotMessageSchema, req.body, reply);
    if (!body) return;

    const row = await loadWhatsappRow(app, session.customerId);
    const permissions = {
      read: (row?.botPermissions as Record<string, boolean> | undefined)?.read !== false,
      reports: (row?.botPermissions as Record<string, boolean> | undefined)?.reports !== false,
      catalog: (row?.botPermissions as Record<string, boolean> | undefined)?.catalog === true,
      alerts: (row?.botPermissions as Record<string, boolean> | undefined)?.alerts !== false,
    };

    if (row && row.botEnabled === false) {
      return reply.code(403).send({
        error: 'Bot söndürülüb — İnteqrasiyalar bölməsindən yenidən aktivləşdirin',
      });
    }

    const userMsg = await appendChatMessage(app, {
      customerId: session.customerId,
      role: 'user',
      body: body.text,
      clientMessageId: body.clientMessageId ?? null,
      meta: { channel: 'portal' },
    });

    const replies: string[] = [];
    try {
      await handleBotMessage(
        {
          app,
          customerId: session.customerId,
          // Confirmation codes are keyed by sender; portal uses a stable id.
          from: `portal:${session.customerId}`,
          settings: {
            botEnabled: row?.botEnabled ?? true,
            permissions,
            adminName: row?.adminName ?? 'Admin',
          },
          send: async (text) => {
            replies.push(text);
          },
        },
        body.text,
      );
    } catch (err) {
      app.log.warn({ err, customerId: session.customerId }, 'portal_bot_message_failed');
      replies.push(
        err instanceof Error
          ? `⚠️ ${err.message}`
          : '⚠️ Əmr yerinə yetirilmədi. Bir az sonra yenidən cəhd edin.',
      );
    }

    if (replies.length === 0) {
      replies.push('✅ Qəbul olundu.');
    }

    const botMessages = [];
    for (const text of replies) {
      botMessages.push(
        await appendChatMessage(app, {
          customerId: session.customerId,
          role: 'bot',
          body: text,
          meta: { channel: 'portal', inReplyTo: userMsg.id },
        }),
      );
    }

    await writeAudit(app, {
      action: 'owner.bot.message',
      entityType: 'customer',
      entityId: session.customerId,
      ip: clientIp(req),
      meta: { text: body.text.slice(0, 120), replies: botMessages.length },
    });

    return {
      ok: true,
      userMessage: userMsg,
      botMessages,
    };
  });

  // -------------------------------------------------------------------------
  // Device-authenticated WhatsApp pairing — the POS app drives these directly.
  //
  // The till holds no tenant password and its bearer token dies after twelve
  // hours, so an owner pairing from the app authenticates with the activated
  // device the same way floor and report ingest do. Each device can only ever
  // reach its own customer, so every restaurant pairs its own WhatsApp.
  // -------------------------------------------------------------------------

  /** Resolves the customer behind a device body, or answers 401 and returns null. */
  async function deviceCustomer(
    req: { headers: { authorization?: string } },
    body: {
      deviceId: string;
      deviceFingerprint: string;
      customerId?: string;
      tenantEmail?: string;
    },
    reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  ): Promise<string | null> {
    const loginId = await loginCustomerIdFromAuth(app, req, body);
    const resolved = await resolveDeviceCustomer(
      app,
      body.deviceId,
      body.deviceFingerprint,
      loginId,
      verifiedCustomerIdFromAuth(req),
    );
    if (!resolved) {
      reply.code(401).send({ error: 'Device not recognized' });
      return null;
    }
    return resolved.customerId;
  }

  /**
   * The till pulls the role policy its owner set on possistem.az.
   *
   * POST like every other device endpoint here, because device auth is a
   * signed body rather than a header. Cheap enough to ride the heartbeat: the
   * till compares `version` with the one it last applied and does nothing
   * when they match.
   */
  app.post('/owner/device/roles', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = parseBody(OwnerDeviceAuthSchema, req.body, reply);
    if (!body) return;
    const customerId = await deviceCustomer(req, body, reply);
    if (!customerId) return;
    // The product comes from the licence behind this device, never from the
    // caller: the two tills check different permission vocabularies, and a
    // device must not be able to ask for the other one's policy.
    const licensed = (await app.db.execute(sql`
      SELECT
        CASE
          WHEN nullif(l.features ->> 'product', '') IS NOT NULL THEN l.features ->> 'product'
          WHEN l.plan = 'market' THEN 'market'
          ELSE 'restaurant'
        END AS product
      FROM devices d JOIN licenses l ON l.id = d.license_id
      WHERE d.id = ${body.deviceId}::uuid
    `)) as Array<Record<string, unknown>>;
    const product = licensed[0]?.product === 'market' ? 'market' : 'restaurant';
    return { ok: true, ...(await effectiveRolePolicy(app, customerId, product)),
      superAdmin: await superAdminGrant(app, customerId, body.deviceId) };
  });

  app.post('/owner/device/whatsapp', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = parseBody(OwnerDeviceAuthSchema, req.body, reply);
    if (!body) return;
    const customerId = await deviceCustomer(req, body, reply);
    if (!customerId) return;
    return whatsappConfigFor(app, customerId);
  });

  // -------------------------------------------------------------------------
  // Live mirror + command channel.
  //
  // One request every few seconds does both halves of the conversation: the
  // till pushes its floor into the live database (which is what the WhatsApp
  // bot reads) and collects any work the bot has queued for it. A single
  // round trip keeps the till's outbound traffic to one connection.
  // -------------------------------------------------------------------------

  app.post('/owner/device/sync', {
    config: { rateLimit: { max: 180, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const parsed = OwnerDeviceSyncSchema.safeParse(req.body);
    if (!parsed.success) {
      app.log.warn({ issues: parsed.error.issues.slice(0, 8) }, 'owner_sync_zod');
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const body = parsed.data;
    const loginId = await loginCustomerIdFromAuth(app, req, body);
    const resolved = await resolveDeviceCustomer(
      app,
      body.deviceId,
      body.deviceFingerprint,
      loginId,
      verifiedCustomerIdFromAuth(req),
    );
    if (!resolved) return reply.code(401).send({ error: 'Device not recognized' });
    const customerId = resolved.customerId;

    // This tick is the freshest proof the till is alive, so record it on the
    // device row. Presence otherwise fell back to `devices.last_seen_at`, which
    // only the licence heartbeat touched — every 12–24 hours — against a
    // 10-minute freshness window. Every restaurant till therefore read
    // "offline" in the admin panel unless MYSQL_URL was configured, and staff
    // told healthy shops their POS was down.
    void app.db
      .update(devices)
      .set({ lastSeenAt: new Date() })
      .where(eq(devices.id, resolved.device.id))
      .catch((err: unknown) => {
        app.log.warn({ err, deviceId: resolved.device.id }, 'owner_sync_last_seen_failed');
      });

    const tables = body.tables ?? [];
    const openTables = tables.filter(
      (t) => t.orderId || t.status === 'occupied' || t.status === 'billing',
    );
    const openTotalMinor = openTables.reduce(
      (sum, t) => sum + Math.max(0, (t.totalMinor ?? 0) - (t.paidMinor ?? 0)),
      0,
    );

    // A till with nobody signed in cannot read its own takings, so a tick
    // without `sales` must leave the stored figures alone instead of
    // publishing zeros to the owner's phone.
    const previousSales = body.sales ? null : await getSalesLive(customerId);
    const todaySalesMinor = body.sales?.grossMinor ?? Number(previousSales?.gross_minor ?? 0);
    const todayPaidMinor = body.sales?.paidMinor ?? Number(previousSales?.paid_minor ?? 0);
    const paymentCount = body.sales?.paymentCount ?? Number(previousSales?.payment_count ?? 0);
    const floorPayload = {
      tables,
      businessDate: body.businessDate ?? null,
      todayPaidMinor,
      paymentCount,
    };

    // Each write is independent: a single bad column must not cost us the
    // whole snapshot, and the bot degrades to slightly older data instead.
    const writes: Promise<unknown>[] = [
      upsertDeviceStatus({
        customerId,
        deviceId: body.deviceId,
        connected: body.connected !== false,
        appVersion: body.appVersion,
        restaurantName: body.restaurantName,
      }),
      // The owner PWA reads the legacy snapshot, so it is kept in step here
      // rather than costing the till a second request.
      upsertFloorLive({
        customerId,
        deviceId: body.deviceId,
        openTables: openTables.length,
        openTotalMinor,
        todaySalesMinor,
        todayPaidMinor,
        paymentCount,
        businessDate: body.businessDate ?? null,
        payload: floorPayload,
      }),
      app.db
        .insert(ownerFloorSnapshots)
        .values({
          customerId,
          deviceId: body.deviceId,
          payload: floorPayload,
          openTables: openTables.length,
          openTotalMinor,
          todaySalesMinor,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: ownerFloorSnapshots.customerId,
          set: {
            deviceId: body.deviceId,
            payload: floorPayload,
            openTables: openTables.length,
            openTotalMinor,
            todaySalesMinor,
            updatedAt: new Date(),
          },
        }),
      upsertSalesLive({
        customerId,
        businessDate: body.businessDate ?? null,
        businessDayId: body.businessDayId ?? null,
        businessDayStatus: body.businessDayStatus ?? null,
        // Only overwrite open-table counters when this tick actually carried
        // a floor snapshot — otherwise leave the last known numbers alone.
        openTables: body.tables ? openTables.length : undefined,
        openTotalMinor: body.tables ? openTotalMinor : undefined,
        sales: body.sales
          ? {
              grossMinor: body.sales.grossMinor,
              netMinor: body.sales.netMinor,
              paidMinor: body.sales.paidMinor,
              discountMinor: body.sales.discountMinor,
              taxMinor: body.sales.taxMinor,
              serviceMinor: body.sales.serviceMinor,
              tipsMinor: body.sales.tipsMinor,
              refundMinor: body.sales.refundMinor,
              orderCount: body.sales.orderCount,
              paymentCount: body.sales.paymentCount,
              avgTicketMinor: body.sales.avgTicketMinor,
              cashMinor: body.sales.cashMinor,
              cardMinor: body.sales.cardMinor,
            }
          : undefined,
      }),
    ];
    if (body.tables) writes.push(replaceTablesLive(customerId, tables));
    if (body.staff) writes.push(replaceStaffLive(customerId, body.staff));
    if (body.products) writes.push(replaceProductsLive(customerId, body.products));
    if (body.report) {
      const report = body.report;
      writes.push(
        upsertReportLive({
          customerId,
          kind: report.kind,
          sequenceNo: report.sequenceNo,
          businessDate: report.businessDate ?? body.businessDate ?? null,
          totals: report.totals,
          canonical: report.canonical,
        }),
      );
      // The mirror write alone left the owner's phone silent whenever the till's
      // direct POST to /owner/ingest/report had failed. Deduplicated, so the
      // ordinary case — both routes arriving — still sends one message.
      writes.push(
        notifyReportOnce(app, customerId, {
          kind: report.kind,
          totals: report.totals,
          canonical: report.canonical,
          businessDate: report.businessDate ?? body.businessDate ?? null,
          sequenceNo: report.sequenceNo ?? null,
        }),
      );
    }
    for (const result of await Promise.allSettled(writes)) {
      if (result.status === 'rejected') {
        app.log.warn({ err: result.reason, customerId }, 'owner_sync_write_failed');
      }
    }

    let commands: unknown[] = [];
    try {
      commands = (await takeBotCommands(customerId, 5, body.deviceId)).map((row) => ({
        id: row.id,
        command: row.command,
        args: typeof row.args_json === 'string' ? JSON.parse(row.args_json) : (row.args_json ?? {}),
      }));
      // Signed for this till only; it refuses an unsigned or foreign command.
      commands = (commands as Array<{ id: string; command: string; args: unknown }>).map((c) => ({
        ...c,
        signed: signDeviceCommand({ id: c.id, command: c.command, args: c.args, customerId, deviceId: body.deviceId }),
      }));
    } catch (err) {
      app.log.warn({ err, customerId }, 'owner_sync_commands_failed');
    }

    void recordSupportHeartbeatIfDue(app, customerId, body.deviceId, {
      appVersion: body.appVersion ?? null,
      restaurantName: body.restaurantName ?? null,
    }).catch((err) => app.log.warn({ err, customerId }, 'support_heartbeat_failed'));

    return {
      ok: true,
      commands,
      // Someone is managing this restaurant from the portal right now.
      fastPoll: portalRpcActive(customerId),
      mysql: mysqlEnabled(),
      access: await surfaceAccess(app, customerId, 'restaurant').catch(() => null),
      // Read from the raw body: the host announces its LAN address, and the
      // sync schema would strip a field it does not know.
      device: await deviceStation(app, customerId, resolved.device.id,
        (req.body as { lanAddresses?: unknown }).lanAddresses).catch(() => null),
    };
  });

  app.post('/owner/device/support/request', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = parseBody(
      OwnerDeviceAuthSchema.extend({
        message: z.string().max(4000).optional(),
        diagnostics: z.record(z.unknown()).optional(),
      }),
      req.body,
      reply,
    );
    if (!body) return;

    const customerId = await deviceCustomer(req, body, reply);
    if (!customerId) return;

    const { ticket, message, created } = await openSupportRequest(
      app,
      customerId,
      body.deviceId,
      body.message?.trim() || 'Ofis dəstək istəyir — POS parametrlərindən göndərildi.',
      'pos_settings',
      body.diagnostics,
    );

    return reply.code(created ? 201 : 200).send({
      ok: true,
      ticketId: ticket.id,
      messageId: message.id,
      created,
    });
  });

  /**
   * The till reads its own support conversation.
   *
   * The request route above is write-only, so a cashier could ask for help and
   * never see the answer — support replied into a thread the POS had no way to
   * open. Same device auth as the other /owner/device/* routes.
   */
  app.post('/owner/device/support/active', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = parseBody(
      OwnerDeviceAuthSchema.extend({
        after: z.string().datetime().optional(),
      }),
      req.body,
      reply,
    );
    if (!body) return;

    const customerId = await deviceCustomer(req, body, reply);
    if (!customerId) return;

    const ticket = await getActiveChatTicket(app, customerId);
    if (!ticket) return { ok: true, ticket: null, messages: [] };

    const after = body.after ? new Date(body.after) : undefined;
    const messages = await getTicketMessages(
      app,
      ticket.id,
      after && !Number.isNaN(after.getTime()) ? after : undefined,
    );
    return { ok: true, ticket: serializeTicket(ticket), messages };
  });

  /**
   * The till fetches a file support attached to its own ticket.
   *
   * POST rather than GET because device auth here is a signed body, not a
   * header. Scoped to the requesting customer's own ticket so one shop can never
   * pull another's attachment by id.
   */
  app.post('/owner/device/support/attachment', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = parseBody(
      OwnerDeviceAuthSchema.extend({ attachmentId: z.string().uuid() }),
      req.body,
      reply,
    );
    if (!body) return;
    const customerId = await deviceCustomer(req, body, reply);
    if (!customerId) return;
    return sendSupportAttachmentForCustomer(app, reply, body.attachmentId, customerId);
  });

  /**
   * The till's quick check for commands while the owner works in the portal
   * (1.8.0): no snapshot, just whatever is queued for this till, signed.
   */
  app.post('/owner/device/commands', {
    config: { rateLimit: { max: 150, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = parseBody(OwnerDeviceAuthSchema, req.body, reply);
    if (!body) return;
    const customerId = await deviceCustomer(req, body, reply);
    if (!customerId) return;
    if (!portalRpcActive(customerId)) return { ok: true, commands: [], fastPoll: false };
    const rows = await takeBotCommands(customerId, 10, body.deviceId);
    const commands = rows.map((row) => {
      const args = typeof row.args_json === 'string' ? JSON.parse(row.args_json) : (row.args_json ?? {});
      return {
        id: row.id,
        command: row.command,
        args,
        signed: signDeviceCommand({ id: row.id, command: row.command, args, customerId, deviceId: body.deviceId }),
      };
    });
    return { ok: true, commands, fastPoll: true };
  });

  app.post('/owner/device/command-result', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = parseBody(OwnerCommandResultSchema, req.body, reply);
    if (!body) return;
    const customerId = await deviceCustomer(req, body, reply);
    if (!customerId) return;
    const stored = await settleCommand({
      customerId,
      commandId: body.commandId,
      ok: body.ok,
      result: body.result,
      error: body.error,
      errorCode: body.errorCode,
    });
    return { ok: true, stored };
  });

  app.post('/owner/device/whatsapp/save', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = parseBody(OwnerDeviceWhatsappSaveSchema, req.body, reply);
    if (!body) return;
    const customerId = await deviceCustomer(req, body, reply);
    if (!customerId) return;
    const saved = await whatsappSaveFor(app, customerId, body);
    if (!saved.ok) return reply.code(400).send({ error: saved.error });
    await writeAudit(app, {
      action: 'owner.whatsapp.save',
      entityType: 'customer',
      entityId: customerId,
      ip: clientIp(req),
      meta: { deviceId: body.deviceId, enabled: saved.data.enabled },
    });
    return saved.data;
  });

  app.post('/owner/device/whatsapp/connect', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = parseBody(OwnerDeviceAuthSchema, req.body, reply);
    if (!body) return;
    const customerId = await deviceCustomer(req, body, reply);
    if (!customerId) return;
    try {
      const result = await whatsappConnectFor(app, customerId);
      await writeAudit(app, {
        action: 'owner.whatsapp.connect',
        entityType: 'customer',
        entityId: customerId,
        ip: clientIp(req),
        meta: { deviceId: body.deviceId, status: result.status },
      });
      return result;
    } catch (err) {
      app.log.warn({ err }, 'whatsapp_connect_failed');
      return reply.code(500).send({
        error: err instanceof Error ? err.message : 'WhatsApp bağlantısı alınmadı',
      });
    }
  });

  app.post('/owner/device/whatsapp/status', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = parseBody(OwnerDeviceAuthSchema, req.body, reply);
    if (!body) return;
    const customerId = await deviceCustomer(req, body, reply);
    if (!customerId) return;
    return whatsappStatusFor(app, customerId);
  });

  app.post('/owner/device/whatsapp/disconnect', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = parseBody(OwnerDeviceAuthSchema, req.body, reply);
    if (!body) return;
    const customerId = await deviceCustomer(req, body, reply);
    if (!customerId) return;
    const result = await whatsappDisconnectFor(app, customerId);
    await writeAudit(app, {
      action: 'owner.whatsapp.disconnect',
      entityType: 'customer',
      entityId: customerId,
      ip: clientIp(req),
      meta: { deviceId: body.deviceId },
    });
    return result;
  });

  app.post('/owner/device/whatsapp/test', {
    config: { rateLimit: { max: 8, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = parseBody(OwnerDeviceWhatsappTestSchema, req.body, reply);
    if (!body) return;
    const customerId = await deviceCustomer(req, body, reply);
    if (!customerId) return;
    const result = await whatsappTestFor(app, customerId, body.phone);
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true, phone: result.phone };
  });

  app.post('/owner/push/subscribe', async (req, reply) => {
    const session = requireTenant(req, reply);
    if (!session) return;
    const body = parseBody(OwnerPushSubscribeSchema, req.body, reply);
    if (!body) return;
    await app.db
      .insert(ownerPushSubscriptions)
      .values({
        customerId: session.customerId,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      })
      .onConflictDoUpdate({
        target: ownerPushSubscriptions.endpoint,
        set: {
          customerId: session.customerId,
          p256dh: body.keys.p256dh,
          auth: body.keys.auth,
        },
      });
    return { ok: true };
  });

  app.post('/owner/ingest/connect', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = parseBody(OwnerConnectIngestSchema, req.body, reply);
    if (!body) return;
    const loginId = await loginCustomerIdFromAuth(app, req, body);
    const resolved = await resolveDeviceCustomer(
      app,
      body.deviceId,
      body.deviceFingerprint,
      loginId,
      verifiedCustomerIdFromAuth(req),
    );
    if (!resolved) return reply.code(401).send({ error: 'Device not recognized' });

    try {
      await upsertDeviceStatus({
        customerId: resolved.customerId,
        deviceId: body.deviceId,
        connected: body.connected,
        appVersion: body.appVersion,
        restaurantName: body.restaurantName,
        lastError: body.lastError,
      });
    } catch (err) {
      app.log.warn({ err }, 'mysql_device_status_failed');
    }

    return {
      ok: true,
      connected: body.connected,
      mysql: mysqlEnabled(),
      receivedAt: new Date().toISOString(),
    };
  });

  app.post('/owner/ingest/floor', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const parsed = OwnerFloorIngestSchema.safeParse(req.body);
    if (!parsed.success) {
      app.log.warn({ issues: parsed.error.issues.slice(0, 12) }, 'owner_floor_zod');
      return reply.code(400).send({
        error: 'Validation failed',
        details: parsed.error.flatten(),
      });
    }
    const body = parsed.data;
    const loginId = await loginCustomerIdFromAuth(app, req, body);
    const resolved = await resolveDeviceCustomer(
      app,
      body.deviceId,
      body.deviceFingerprint,
      loginId,
      verifiedCustomerIdFromAuth(req),
    );
    if (!resolved) return reply.code(401).send({ error: 'Device not recognized' });

    const tableRows = body.tables ?? [];
    const openTables = tableRows.filter(
      (t) => t.status === 'occupied' || t.status === 'billing' || Boolean(t.orderId),
    );
    const openTotalMinor = openTables.reduce(
      (sum, t) => sum + Math.max(0, (t.totalMinor ?? 0) - (t.paidMinor ?? 0)),
      0,
    );
    const todayPaidMinor =
      body.todayPaidMinor ??
      tableRows.reduce((sum, t) => sum + Math.max(0, t.paidMinor ?? 0), 0);
    const paymentCount = body.paymentCount ?? 0;
    const payload = {
      tables: tableRows,
      businessDate: body.businessDate ?? null,
      todayPaidMinor,
      paymentCount,
    };

    await app.db
      .insert(ownerFloorSnapshots)
      .values({
        customerId: resolved.customerId,
        deviceId: body.deviceId,
        payload,
        openTables: openTables.length,
        openTotalMinor,
        todaySalesMinor: body.todaySalesMinor ?? 0,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: ownerFloorSnapshots.customerId,
        set: {
          deviceId: body.deviceId,
          payload,
          openTables: openTables.length,
          openTotalMinor,
          todaySalesMinor: body.todaySalesMinor ?? 0,
          updatedAt: new Date(),
        },
      });

    try {
      await upsertFloorLive({
        customerId: resolved.customerId,
        deviceId: body.deviceId,
        openTables: openTables.length,
        openTotalMinor,
        todaySalesMinor: body.todaySalesMinor ?? 0,
        todayPaidMinor,
        paymentCount,
        businessDate: body.businessDate ?? null,
        payload,
      });
    } catch (err) {
      app.log.warn({ err }, 'mysql_floor_live_failed');
    }
    try {
      await upsertDeviceStatus({
        customerId: resolved.customerId,
        deviceId: body.deviceId,
        connected: body.connected !== false,
        appVersion: body.appVersion,
        restaurantName: body.restaurantName,
      });
    } catch (err) {
      app.log.warn({ err }, 'mysql_device_status_failed');
    }

    return {
      ok: true,
      openTables: openTables.length,
      openTotalMinor,
      todayPaidMinor,
      mysql: mysqlEnabled(),
    };
  });

  app.post('/owner/ingest/report', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = parseBody(OwnerReportIngestSchema, req.body, reply);
    if (!body) return;
    const loginId = await loginCustomerIdFromAuth(app, req, body);
    const resolved = await resolveDeviceCustomer(
      app,
      body.deviceId,
      body.deviceFingerprint,
      loginId,
      verifiedCustomerIdFromAuth(req),
    );
    if (!resolved) return reply.code(401).send({ error: 'Device not recognized' });

    await notifyReportOnce(app, resolved.customerId, {
      kind: body.kind,
      totals: body.totals,
      canonical: body.canonical,
      businessDate: body.businessDate ?? null,
      sequenceNo: body.sequenceNo ?? null,
    });

    await writeAudit(app, {
      action: `owner.ingest.${body.kind}`,
      entityType: 'customer',
      entityId: resolved.customerId,
      ip: clientIp(req),
      meta: { deviceId: body.deviceId, sequenceNo: body.sequenceNo },
    });

    return { ok: true };
  });

  /** Superadmin: unbind POS HWID so the customer can activate another PC. */
  app.post('/customers/:id/clear-hwid', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const [row] = await app.db
      .update(customers)
      .set({ boundHwid: null, updatedAt: new Date() })
      .where(eq(customers.id, id))
      .returning();
    if (!row) return reply.code(404).send({ error: 'Not found' });
    await app.db.execute(sql`DELETE FROM customer_hwids WHERE customer_id = ${id}::uuid`);
    await writeAudit(app, {
      actorUserId: currentUser(req).id,
      action: 'customer.clearHwid',
      entityType: 'customer',
      entityId: id,
      ip: clientIp(req),
    });
    return { ok: true };
  });
}
