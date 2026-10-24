import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  integer,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('admin'),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    csrfToken: text('csrf_token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

/**
 * Bayi (reseller) — kendi giriş linki (`/pos/bayi/<slug>`) olan satış paneli.
 *
 * `keysUsed < keyQuota` koşulu key üretiminin tek kapısı; artırım aktivasyon
 * anahtarlarındaki `redeem_count` claim'i gibi tek atomik UPDATE ile yapılır.
 */
export const resellers = pgTable('resellers', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Panel linkindeki segment: /pos/bayi/<slug> */
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  phone: text('phone'),
  /** Super adminin verdiği toplam key hakkı. */
  keyQuota: integer('key_quota').notNull().default(0),
  /** Üretilmiş key sayısı = satılan müşteri sayısı. */
  keysUsed: integer('keys_used').notNull().default(0),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  notes: text('notes'),
  /** Argon2id hash — null until tenant credentials are provisioned. */
  passwordHash: text('password_hash'),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  /** First POS PC fingerprint; further POS logins must match. */
  boundHwid: text('bound_hwid'),
  /** Where X/Z and owner alerts are emailed (defaults to login email). */
  notifyEmail: text('notify_email'),
  /** Restoranın açıq ünvanı. */
  address: text('address'),
  /** Vergi ödəyicisinin eyniləşdirmə nömrəsi (istəyə bağlı). */
  voen: text('voen'),
  /** Müqavilə / əlaqə üçün məsul şəxs. */
  contactPerson: text('contact_person'),
  /** Browser portal registration/legal metadata. */
  termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  registrationSource: text('registration_source').notNull().default('staff'),
  /** Public chat avatar under uploads (optional). */
  chatAvatarPath: text('chat_avatar_path'),
  /** When set, customer is banned from public chat. */
  chatBannedAt: timestamp('chat_banned_at', { withTimezone: true }),
  /** Satışı yapan bayi; NULL => super adminin doğrudan satışı. */
  resellerId: uuid('reseller_id').references(() => resellers.id, { onDelete: 'set null' }),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const branches = pgTable(
  'branches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    address: text('address'),
    timezone: text('timezone').notNull().default('UTC'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('branches_customer_code_uidx').on(t.customerId, t.code)],
);

export const subscriptionPlans = pgTable('subscription_plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  nameAz: text('name_az').notNull(),
  descriptionAz: text('description_az'),
  features: jsonb('features').$type<unknown[]>().notNull().default([]),
  monthlyPriceMinor: integer('monthly_price_minor').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const licenses = pgTable('licenses', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
  plan: text('plan').notNull(),
  /** Abunəlik planı (standart / biznes / premium); market lisenziyalarında NULL. */
  planId: text('plan_id').references(() => subscriptionPlans.id),
  seats: integer('seats').notNull().default(1),
  features: jsonb('features').$type<Record<string, unknown>>().notNull().default({}),
  validFrom: timestamp('valid_from', { withTimezone: true }).notNull().defaultNow(),
  validUntil: timestamp('valid_until', { withTimezone: true }),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const activationKeys = pgTable(
  'activation_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    licenseId: uuid('license_id')
      .notNull()
      .references(() => licenses.id, { onDelete: 'cascade' }),
    keyHmac: text('key_hmac').notNull().unique(),
    label: text('label'),
    /** restaurant = restoran POS, market = Market POS. */
    product: text('product').notNull().default('restaurant'),
    /** Anahtarı üreten bayi; NULL => super admin. */
    resellerId: uuid('reseller_id').references(() => resellers.id, { onDelete: 'set null' }),
    maxDevices: integer('max_devices').notNull().default(1),
    redeemCount: integer('redeem_count').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('activation_keys_license_id_idx').on(t.licenseId)],
);

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    licenseId: uuid('license_id')
      .notNull()
      .references(() => licenses.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    activationKeyId: uuid('activation_key_id').references(() => activationKeys.id, {
      onDelete: 'set null',
    }),
    deviceFingerprint: text('device_fingerprint').notNull(),
    /** Becomes true after the first fingerprint-authenticated heartbeat. */
    heartbeatAuthRequired: boolean('heartbeat_auth_required').notNull().default(false),
    devicePublicKey: text('device_public_key'),
    lastHeartbeatNonce: text('last_heartbeat_nonce'),
    lastHeartbeatSignedAt: timestamp('last_heartbeat_signed_at', { withTimezone: true }),
    hostname: text('hostname'),
    appVersion: text('app_version'),
    status: text('status').notNull().default('active'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('devices_fingerprint_license_uidx').on(t.licenseId, t.deviceFingerprint),
    index('devices_license_id_idx').on(t.licenseId),
  ],
);

export const releases = pgTable(
  'releases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channel: text('channel').notNull().default('stable'),
    version: text('version').notNull(),
    notes: text('notes'),
    artifactUrl: text('artifact_url'),
    checksumSha256: text('checksum_sha256'),
    published: boolean('published').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('releases_channel_version_uidx').on(t.channel, t.version)],
);

export const featureFlags = pgTable(
  'feature_flags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Unique on key so upserts can use onConflictDoUpdate({ target: featureFlags.key })
    key: text('key').notNull().unique(),
    description: text('description'),
    enabled: boolean('enabled').notNull().default(false),
    scope: text('scope').notNull().default('global'),
    scopeId: uuid('scope_id'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('feature_flags_key_scope_uidx').on(t.key, t.scope, t.scopeId)],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorCustomerId: uuid('actor_customer_id').references(() => customers.id, {
      onDelete: 'set null',
    }),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_created_at_idx').on(t.createdAt),
    index('audit_logs_actor_customer_idx').on(t.actorCustomerId, t.createdAt),
  ],
);

export const customerSessions = pgTable(
  'customer_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    csrfToken: text('csrf_token').notNull(),
    rememberMe: boolean('remember_me').notNull().default(false),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('customer_sessions_customer_idx').on(t.customerId, t.expiresAt),
    index('customer_sessions_expiry_idx').on(t.expiresAt),
  ],
);

export const customerPasswordResets = pgTable(
  'customer_password_resets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    requestedIp: text('requested_ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('customer_password_resets_customer_idx').on(t.customerId, t.createdAt),
    index('customer_password_resets_expiry_idx').on(t.expiresAt),
  ],
);

export const customerOnboarding = pgTable('customer_onboarding', {
  customerId: uuid('customer_id')
    .primaryKey()
    .references(() => customers.id, { onDelete: 'cascade' }),
  currentStep: integer('current_step').notNull().default(1),
  completedSteps: jsonb('completed_steps').$type<number[]>().notNull().default([]),
  installationStatus: text('installation_status').notNull().default('not_started'),
  downloadedVersion: text('downloaded_version'),
  installedVersion: text('installed_version'),
  lastDownloadAt: timestamp('last_download_at', { withTimezone: true }),
  lastCheckAt: timestamp('last_check_at', { withTimezone: true }),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  lastError: text('last_error'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const customerSupportUploads = pgTable(
  'customer_support_uploads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    originalName: text('original_name').notNull(),
    storedName: text('stored_name').notNull().unique(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    status: text('status').notNull().default('received'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    ticketId: uuid('ticket_id').references(() => supportTickets.id, { onDelete: 'set null' }),
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
    source: text('source').notNull().default('owner_portal'),
  },
  (t) => [
    index('customer_support_uploads_customer_idx').on(t.customerId, t.createdAt),
    index('customer_support_uploads_ticket_idx').on(t.ticketId, t.createdAt),
  ],
);

export const supportTickets = pgTable(
  'support_tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
    kind: text('kind').notNull().default('chat'),
    status: text('status').notNull().default('open'),
    priority: text('priority').notNull().default('normal'),
    subject: text('subject'),
    claimedBy: uuid('claimed_by').references(() => users.id, { onDelete: 'set null' }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
    lastCustomerAt: timestamp('last_customer_at', { withTimezone: true }),
    deviceActions: jsonb('device_actions').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('support_tickets_chat_status_idx').on(t.status, t.lastMessageAt),
    index('support_tickets_customer_idx').on(t.customerId, t.updatedAt),
  ],
);

export const supportMessages = pgTable(
  'support_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => supportTickets.id, { onDelete: 'cascade' }),
    authorKind: text('author_kind').notNull(),
    authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('support_messages_ticket_created_idx').on(t.ticketId, t.createdAt)],
);

export const supportAttachments = pgTable(
  'support_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => supportTickets.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id').references(() => supportMessages.id, { onDelete: 'set null' }),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('support_attachments_ticket_idx').on(t.ticketId, t.createdAt)],
);

export const backupRecords = pgTable('backup_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  filename: text('filename').notNull(),
  sizeBytes: integer('size_bytes'),
  status: text('status').notNull().default('completed'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  notes: text('notes'),
});

export const emailOtpCodes = pgTable(
  'email_otp_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    purpose: text('purpose').notNull(),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    attemptCount: integer('attempt_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('email_otp_active_idx').on(t.email, t.purpose, t.expiresAt)],
);

export const contactLeads = pgTable(
  'contact_leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    businessName: text('business_name').notNull(),
    phone: text('phone').notNull(),
    city: text('city'),
    message: text('message'),
    product: text('product'), /* topdan-product */
    source: text('source').notNull().default('website'),
    status: text('status').notNull().default('new'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('contact_leads_created_at_idx').on(t.createdAt),
    index('contact_leads_status_idx').on(t.status, t.createdAt),
  ],
);

export const mailInboxMessages = pgTable(
  'mail_inbox_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: text('profile_id').notNull(),
    imapUid: integer('imap_uid'),
    messageId: text('message_id'),
    fromAddress: text('from_address').notNull(),
    fromName: text('from_name'),
    toAddresses: text('to_addresses').notNull(),
    subject: text('subject').notNull().default(''),
    preview: text('preview').notNull().default(''),
    bodyText: text('body_text'),
    bodyHtml: text('body_html'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('mail_inbox_message_id_idx').on(t.messageId),
    uniqueIndex('mail_inbox_profile_uid_idx').on(t.profileId, t.imapUid),
    index('mail_inbox_profile_received_idx').on(t.profileId, t.receivedAt),
    index('mail_inbox_received_idx').on(t.receivedAt),
  ],
);

export const ownerFloorSnapshots = pgTable('owner_floor_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'cascade' })
    .unique(),
  deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  openTables: integer('open_tables').notNull().default(0),
  openTotalMinor: integer('open_total_minor').notNull().default(0),
  todaySalesMinor: integer('today_sales_minor').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ownerNotifications = pgTable(
  'owner_notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('owner_notifications_customer_idx').on(t.customerId, t.createdAt)],
);

export const ownerPushSubscriptions = pgTable(
  'owner_push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('owner_push_customer_idx').on(t.customerId)],
);

export const ownerWhatsappSettings = pgTable('owner_whatsapp_settings', {
  customerId: uuid('customer_id')
    .primaryKey()
    .references(() => customers.id, { onDelete: 'cascade' }),
  enabled: boolean('enabled').notNull().default(true),
  recipientPhone: text('recipient_phone').notNull().default(''),
  adminName: text('admin_name').notNull().default('Admin'),
  messageTemplate: text('message_template')
    .notNull()
    .default('*{admin}*\n{title}\n{body}'),
  waStatus: text('wa_status').notNull().default('disconnected'),
  waUser: text('wa_user'),
  /** Master switch for two-way commands; alerts still flow when it is off. */
  botEnabled: boolean('bot_enabled').notNull().default(true),
  /** Extra numbers, beside recipientPhone, allowed to command the bot. */
  allowedNumbers: jsonb('allowed_numbers').$type<string[]>().notNull().default([]),
  botPermissions: jsonb('bot_permissions')
    .$type<Record<string, boolean>>()
    .notNull()
    .default({ read: true, reports: true, catalog: false, alerts: true }),
  /** Learned `@lid` → phone pairs, so a restart still recognises the owner. */
  lidMap: jsonb('lid_map').$type<Record<string, string>>().notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Phone-portal chat with the same bot engine as WhatsApp. */
export const ownerChatMessages = pgTable(
  'owner_chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    body: text('body').notNull().default(''),
    clientMessageId: text('client_message_id'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('owner_chat_messages_customer_idx').on(t.customerId, t.createdAt),
    uniqueIndex('owner_chat_messages_client_id_uidx').on(t.customerId, t.clientMessageId),
  ],
);

/** Offline Game Center PC occupancy: active 1 = occupied, 0 = available. */
export const gamecenterPcs = pgTable(
  'gamecenter_pcs',
  {
    id: integer('id').primaryKey(),
    name: text('name').notNull(),
    /** Stored for ops only — never returned by the public GameCenter API. */
    ip: text('ip').notNull().default(''),
    /** Learned from the local ARP table after this PC answers ping. */
    mac: text('mac'),
    active: integer('active').notNull().default(0),
    latencyMs: integer('latency_ms'),
    source: text('source').notNull().default('gamecenter-scanner'),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('gamecenter_pcs_checked_at_idx').on(t.checkedAt),
    index('gamecenter_pcs_active_idx').on(t.active, t.id),
  ],
);

export const gamecenterPcCommands = pgTable(
  'gamecenter_pc_commands',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pcId: integer('pc_id')
      .notNull()
      .references(() => gamecenterPcs.id),
    /** wake | shutdown */
    command: text('command').notNull().default('wake'),
    mac: text('mac').notNull(),
    ip: text('ip').notNull(),
    status: text('status').notNull().default('pending'),
    /** self = target PC shuts itself down, remote = main PC uses shutdown /m. */
    mode: text('mode'),
    claimedBy: uuid('claimed_by'),
    requestedBy: text('requested_by').notNull().default('gamecenter-admin'),
    attempts: integer('attempts').notNull().default(0),
    result: text('result'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    index('gamecenter_pc_commands_status_idx').on(t.status, t.createdAt),
    index('gamecenter_pc_commands_pc_idx').on(t.pcId, t.createdAt),
    uniqueIndex('gamecenter_pc_commands_one_pending_idx')
      .on(t.pcId)
      .where(sql`${t.status} = 'pending'`),
  ],
);

export const gamecenterAgents = pgTable(
  'gamecenter_agents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pcId: integer('pc_id').references(() => gamecenterPcs.id),
    hostname: text('hostname').notNull().default(''),
    ip: text('ip').notNull(),
    mac: text('mac'),
    version: text('version').notNull().default(''),
    /** Exactly one agent holds 'main': it scans the LAN and sends magic packets. */
    role: text('role').notNull().default('client'),
    os: text('os'),
    updateStatus: text('update_status'),
    hostConfig: text('host_config'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('gamecenter_agents_ip_idx').on(t.ip),
    index('gamecenter_agents_pc_idx').on(t.pcId),
    index('gamecenter_agents_last_seen_idx').on(t.lastSeenAt),
  ],
);

export const schema = {
  users,
  sessions,
  resellers,
  customers,
  branches,
  subscriptionPlans,
  licenses,
  activationKeys,
  devices,
  releases,
  featureFlags,
  auditLogs,
  customerSessions,
  customerPasswordResets,
  customerOnboarding,
  customerSupportUploads,
  supportTickets,
  supportMessages,
  supportAttachments,
  backupRecords,
  contactLeads,
  mailInboxMessages,
  emailOtpCodes,
  ownerFloorSnapshots,
  ownerNotifications,
  ownerPushSubscriptions,
  ownerWhatsappSettings,
  ownerChatMessages,
  gamecenterPcs,
  gamecenterPcCommands,
  gamecenterAgents,
};

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Reseller = typeof resellers.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Branch = typeof branches.$inferSelect;
export type License = typeof licenses.$inferSelect;
export type ActivationKey = typeof activationKeys.$inferSelect;
export type Device = typeof devices.$inferSelect;
export type Release = typeof releases.$inferSelect;
export type FeatureFlag = typeof featureFlags.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type CustomerSession = typeof customerSessions.$inferSelect;
export type CustomerPasswordReset = typeof customerPasswordResets.$inferSelect;
export type CustomerOnboarding = typeof customerOnboarding.$inferSelect;
export type CustomerSupportUpload = typeof customerSupportUploads.$inferSelect;
export type SupportTicket = typeof supportTickets.$inferSelect;
export type SupportMessage = typeof supportMessages.$inferSelect;
export type SupportAttachment = typeof supportAttachments.$inferSelect;
export type BackupRecord = typeof backupRecords.$inferSelect;
export type ContactLead = typeof contactLeads.$inferSelect;
export type MailInboxMessage = typeof mailInboxMessages.$inferSelect;
export type OwnerFloorSnapshot = typeof ownerFloorSnapshots.$inferSelect;
export type OwnerNotification = typeof ownerNotifications.$inferSelect;
export type OwnerPushSubscription = typeof ownerPushSubscriptions.$inferSelect;
export type OwnerWhatsappSettings = typeof ownerWhatsappSettings.$inferSelect;
export type OwnerChatMessage = typeof ownerChatMessages.$inferSelect;
export type GamecenterPc = typeof gamecenterPcs.$inferSelect;
export type GamecenterPcCommand = typeof gamecenterPcCommands.$inferSelect;
export type GamecenterAgent = typeof gamecenterAgents.$inferSelect;
