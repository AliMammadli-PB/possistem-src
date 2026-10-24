import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** control/ root (apps/api/src -> ../../../) */
export const CONTROL_ROOT = path.resolve(__dirname, '../../..');

const isProduction = (process.env.NODE_ENV ?? 'development') === 'production';

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

/**
 * A secret that must never fall back to a published default.
 *
 * `required()` with a fallback can never throw, so a production deploy that
 * forgot these ran happily on values printed in this repository - and those
 * same values sign the tenant bearer tokens. Development still gets a working
 * default so nothing needs configuring to run locally.
 */
function requiredSecret(name: string, devFallback: string): string {
  const supplied = process.env[name];
  if (supplied) return supplied;
  if (isProduction) {
    throw new Error(`Missing env ${name} - refusing to start with a development secret`);
  }
  return devFallback;
}

export const env = {
  imapHost: process.env.IMAP_HOST ?? '',
  imapPort: Number(process.env.IMAP_PORT ?? 993),
  imapSecure: process.env.IMAP_SECURE !== 'false',
  imapUser: process.env.IMAP_USER ?? '',
  imapPass: process.env.IMAP_PASS ?? '',
  mailSyncIntervalSec: Number(process.env.MAIL_SYNC_INTERVAL_SEC ?? 60),
  mailViewPasswordAli: process.env.MAIL_VIEW_PASSWORD_ALI ?? '',
  mailViewPasswordTarlan: process.env.MAIL_VIEW_PASSWORD_TARLAN ?? '',

  host: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? 3210),
  databaseUrl: required(
    'DATABASE_URL',
    'postgresql://milioner:milioner@127.0.0.1:5433/milioner_control',
  ),
  cookieSecure: (process.env.COOKIE_SECURE ?? 'false').toLowerCase() === 'true',
  cookieName: process.env.COOKIE_NAME ?? 'milioner_session',
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 12),
  sessionSecret: requiredSecret('SESSION_SECRET', 'dev-session-secret-change-me'),
  activationPepper: requiredSecret('ACTIVATION_PEPPER', 'dev-activation-pepper-change-me'),
  /**
   * Origins allowed to make credentialed cross-origin requests.
   *
   * Comma separated; empty means "same-origin plus the local dev servers".
   */
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  ed25519PrivateKeyPath: process.env.ED25519_PRIVATE_KEY_PATH,
  ed25519PublicKeyPath: process.env.ED25519_PUBLIC_KEY_PATH,
  nodeEnv: process.env.NODE_ENV ?? 'development',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  insecureTransport: (process.env.COOKIE_SECURE ?? 'false').toLowerCase() !== 'true',
  version: '0.1.1',
  defaultPaymentUrl: process.env.PAYMENT_URL ?? 'https://possistem.az/#elaqe',
  updateFeedUrl: process.env.UPDATE_FEED_URL ?? 'https://possistem.az/pos-updates',
  customerPortalUrl:
    process.env.CUSTOMER_PORTAL_URL ?? 'https://possistem.az/pos/app',
  adminPanelUrl:
    process.env.ADMIN_PANEL_URL ?? 'https://possistem.az/m-43dcc89574d90d1b1983a32c/',
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpSecure: (process.env.SMTP_SECURE ?? 'false').toLowerCase() === 'true',
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPass: process.env.SMTP_PASS ?? '',
  smtpFrom: process.env.SMTP_FROM ?? 'possistem <support@possistem.az>',
  /** Resend.com API — preferred when set (no hosting SMTP needed). */
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  emailFrom:
    process.env.RESEND_FROM?.trim() ||
    process.env.SMTP_FROM?.trim() ||
    'possistem Dəstək <support@possistem.az>',
  emailSupport: process.env.EMAIL_SUPPORT ?? 'support@possistem.az',
  emailInfo: process.env.EMAIL_INFO ?? 'info@possistem.az',
  emailAdmin: process.env.EMAIL_ADMIN ?? 'admin@possistem.az',
  emailTarlan: process.env.EMAIL_TARLAN ?? 'tarlan.naghiyev@possistem.az',
  emailAli: process.env.EMAIL_ALI ?? 'Ali.Mammadli@possistem.az',
  /** Inbox for marketing / contact form leads (comma-separated). */
  smtpLeadTo: (process.env.SMTP_LEAD_TO ?? process.env.LEAD_NOTIFY_EMAIL ?? '').trim(),
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? '',
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? '',
  vapidSubject: process.env.VAPID_SUBJECT ?? 'mailto:admin@possistem.az',
  /** MariaDB/MySQL live floor + device status (owner app). */
  mysqlUrl: process.env.MYSQL_URL ?? '',
  /** Baileys multi-file auth root (per-customer subdirs). */
  whatsappAuthDir:
    process.env.WHATSAPP_AUTH_DIR ??
    path.resolve(CONTROL_ROOT, '.data', 'whatsapp'),
  supportUploadDir:
    process.env.SUPPORT_UPLOAD_DIR ??
    path.resolve(CONTROL_ROOT, '.data', 'support-uploads'),
  chatAvatarDir:
    process.env.CHAT_AVATAR_DIR ??
    path.resolve(CONTROL_ROOT, '.data', 'chat-avatars'),
  /** Hardware catalog scraped into products.json (admin + public site). */
  productCatalogPath:
    process.env.PRODUCT_CATALOG_PATH ??
    (isProduction
      ? '/var/lib/possistem-pos-control/products.json'
      : path.resolve(CONTROL_ROOT, '.data', 'products.json')),
  productOverridesPath:
    process.env.PRODUCT_OVERRIDES_PATH ??
    (isProduction
      ? '/var/lib/possistem-pos-control/product-overrides.json'
      : path.resolve(CONTROL_ROOT, '.data', 'product-overrides.json')),
  productImageDir:
    process.env.PRODUCT_IMAGE_DIR ??
    (isProduction
      ? '/var/lib/possistem-pos-control/product-images'
      : path.resolve(CONTROL_ROOT, '.data', 'product-images')),
  /** Shared secret used only by the local GameCenter ping scanner. */
  gamecenterMonitorToken: process.env.GAMECENTER_MONITOR_TOKEN ?? '',
  /** Atomic JSON snapshot; public responses never expose the local IP addresses. */
  gamecenterStatusPath:
    process.env.GAMECENTER_STATUS_PATH ??
    path.resolve(CONTROL_ROOT, '.data', 'gamecenter-pcs.json'),
  /** Monitor installers plus monitor-latest.json, served to agents that auto-update. */
  gamecenterDownloadDir:
    process.env.GAMECENTER_DOWNLOAD_DIR ??
    (isProduction
      ? '/var/lib/milioner-pos-control/downloads'
      : path.resolve(CONTROL_ROOT, '.data', 'downloads')),
  /**
   * Public hub visibility for the POS product.
   * `true` — show the POS card on offlinegame.az
   * `hidden` — hide it (and related marketing routes return 404)
   */
  milionerSite: (() => {
    const raw = (process.env.MILLIONER_SITE ?? 'true').trim().toLowerCase();
    if (raw === 'hidden' || raw === 'false' || raw === '0' || raw === 'off') {
      return 'hidden' as const;
    }
    return 'true' as const;
  })(),
  /**
   * Customer emails that may log into any POS without HWID bind/mismatch checks
   * (comma-separated, lowercased). Intended for internal admin test accounts.
   */
  posHwidBypassEmails: new Set(
    (process.env.POS_HWID_BYPASS_EMAILS ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  ),
};
