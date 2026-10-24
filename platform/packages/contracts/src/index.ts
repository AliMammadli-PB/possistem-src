import { z } from 'zod/v3';

export const RoleSchema = z.enum(['superadmin', 'admin']);
export type Role = z.infer<typeof RoleSchema>;

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12),
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

/** Bayi panel linkindeki segment: /pos/bayi/<slug> */
export const ResellerSlugSchema = z
  .string()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, 'yalnız kiçik hərf, rəqəm və tire');

export const ResellerCreateSchema = z.object({
  name: z.string().min(1).max(200),
  slug: ResellerSlugSchema,
  email: z.string().email(),
  password: z.string().min(8).max(128),
  phone: z.string().max(50).nullable().optional(),
  keyQuota: z.number().int().min(0).max(100_000).default(0),
});
export type ResellerCreate = z.infer<typeof ResellerCreateSchema>;

/** Super adminin bayi üzerinde yapabildiği tek mutasyon seti. */
export const ResellerUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  phone: z.string().max(50).nullable().optional(),
  /** Mutlak yeni kota (mevcut + artış değil). */
  keyQuota: z.number().int().min(0).max(100_000).optional(),
  /** Kotaya eklenecek miktar — keyQuota ile birlikte gönderilmez. */
  addQuota: z.number().int().min(1).max(100_000).optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).max(128).optional(),
});
export type ResellerUpdate = z.infer<typeof ResellerUpdateSchema>;

export const ResellerLoginSchema = z.object({
  slug: ResellerSlugSchema,
  email: z.string().email(),
  password: z.string().min(1),
});
export type ResellerLogin = z.infer<typeof ResellerLoginSchema>;

/* geyim-product */ export const PosProductSchema = z.enum(['restaurant', 'market', 'geyim', 'aptek', 'topdan']); /* aptek-product */ /* topdan-product: enum */
export type PosProduct = z.infer<typeof PosProductSchema>;

/** Boş string gönderilen istəyə bağlı sahələri NULL sayır. */
const optionalTrimmed = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => {
      const trimmed = v?.trim();
      return trimmed ? trimmed : null;
    });

/** Bayinin (ve super adminin doğrudan satışının) müşteri + açar üretme gövdesi. */
export const SaleCreateSchema = z.object({
  monthlyAmountMinor: z.number().int().min(1).max(100_000_000).optional(),
  /** Restoran POS və Market POS lisenziyaları ayrı tutulur. */
  product: PosProductSchema.default('restaurant'),
  name: z.string().min(1).max(200),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  /** Restoranın açıq ünvanı. */
  address: z.string().min(1).max(500),
  phone: optionalTrimmed(50),
  /** Vergi nömrəsi — istəyə bağlı. */
  voen: optionalTrimmed(20),
  /** Əlaqədar şəxs — istəyə bağlı. */
  contactPerson: optionalTrimmed(200),
  notes: optionalTrimmed(2000),
  /** Açarın kaç gün geçerli olacağı. */
  days: z.number().int().min(1).max(3650).default(30),
  seats: z.number().int().min(1).max(50).default(1),
  maxDevices: z.number().int().min(1).max(50).default(1),
  plan: z.enum(['standart', 'biznes', 'premium', 'standard', 'market']).default('standart'),
  label: optionalTrimmed(200),
});
export type SaleCreate = z.infer<typeof SaleCreateSchema>;

/** Super admin: satış e-poçtunu düzəlt və ya sil (boş = null). */
export const CustomerEmailUpdateSchema = z.object({
  email: z
    .union([z.string().email(), z.literal('')])
    .nullable()
    .transform((v) => {
      if (v == null) return null;
      const trimmed = v.trim().toLowerCase();
      return trimmed.length === 0 ? null : trimmed;
    }),
});
export type CustomerEmailUpdate = z.infer<typeof CustomerEmailUpdateSchema>;

export const PaymentUrlSchema = z.object({
  url: z.string().url().max(500),
});
export type PaymentUrlInput = z.infer<typeof PaymentUrlSchema>;

const optionalLeadText = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((value) => value?.trim() || null);

export const ContactLeadCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  businessName: z.string().trim().min(2).max(200),
  phone: z
    .string()
    .trim()
    .min(7)
    .max(32)
    .regex(/^[+\d()\s-]+$/, 'telefon formatı düzgün deyil'),
  city: optionalLeadText(120),
  message: optionalLeadText(2000),
  /* topdan-product: lead */ product: z.enum(['restaurant', 'market', 'geyim', 'aptek', 'topdan']).optional(),
  source: z.string().trim().min(1).max(120).default('website'),
  /** Botlar üçün görünməyən honeypot sahəsi; real istifadəçidə boş qalır. */
  website: z.string().max(200).optional().default(''),
});
export type ContactLeadCreate = z.infer<typeof ContactLeadCreateSchema>;

export const ContactLeadStatusSchema = z.object({
  status: z.enum(['new', 'contacted', 'qualified', 'closed']),
});
export type ContactLeadStatusUpdate = z.infer<typeof ContactLeadStatusSchema>;

export const ActivationRedeemSchema = z.object({
  activationKey: z.string().min(16),
  deviceFingerprint: z.string().min(8).max(256),
  hostname: z.string().max(200).optional(),
  appVersion: z.string().max(64).optional(),
  devicePublicKey: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
  /** Omitted by legacy restaurant POS clients. Market POS must send market. */
  product: PosProductSchema.optional(),
});
export type ActivationRedeem = z.infer<typeof ActivationRedeemSchema>;

export const TenantLoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  /** pos = bind/enforce HWID; owner = phone web app (no HWID). */
  client: z.enum(['pos', 'owner']).optional(),
  hwid: z.string().min(8).max(256).optional(),
  /** Market POS login requires its own activation key before binding HWID. */
  activationKey: z.string().min(16).max(160).optional(),
  /** Omitted by legacy restaurant POS clients. Market POS should send market. */
  product: PosProductSchema.optional(),
});
export type TenantLoginRequest = z.infer<typeof TenantLoginRequestSchema>;

const customerEmail = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());

const customerPassword = z
  .string()
  .min(12, 'Şifrə ən azı 12 simvol olmalıdır')
  .max(128, 'Şifrə ən çoxu 128 simvol ola bilər');

export const CustomerForgotPasswordSchema = z.object({
  email: customerEmail,
});
export type CustomerForgotPassword = z.infer<typeof CustomerForgotPasswordSchema>;

export const CustomerCheckEmailSchema = z.object({
  email: customerEmail,
});
export type CustomerCheckEmail = z.infer<typeof CustomerCheckEmailSchema>;

export const CustomerOtpSendSchema = z.object({
  email: customerEmail,
  purpose: z.enum(['login', 'register', 'reset']),
});
export type CustomerOtpSend = z.infer<typeof CustomerOtpSendSchema>;

export const CustomerLoginOtpSchema = z.object({
  email: customerEmail,
  code: z.string().regex(/^\d{6}$/, '6 rəqəmli kod yazın'),
  rememberMe: z.boolean().default(false),
});
export type CustomerLoginOtp = z.infer<typeof CustomerLoginOtpSchema>;

export const otpCodeField = z.string().regex(/^\d{6}$/, '6 rəqəmli kod yazın');

export const CustomerRegisterSchema = z.object({
  name: z.string().trim().min(2).max(120),
  businessName: z.string().trim().min(2).max(200),
  email: customerEmail,
  password: customerPassword,
  termsAccepted: z.literal(true),
  otpCode: otpCodeField,
});
export type CustomerRegister = z.infer<typeof CustomerRegisterSchema>;

export const CustomerLoginSchema = z.object({
  email: customerEmail,
  password: z.string().min(1).max(128),
  rememberMe: z.boolean().default(false),
});
export type CustomerLogin = z.infer<typeof CustomerLoginSchema>;

export const CustomerResetPasswordSchema = z.object({
  token: z.string().min(32).max(256),
  password: customerPassword,
});
export type CustomerResetPassword = z.infer<typeof CustomerResetPasswordSchema>;

export const CustomerChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: customerPassword,
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: 'Yeni şifrə əvvəlki şifrədən fərqli olmalıdır',
    path: ['newPassword'],
  });
export type CustomerChangePassword = z.infer<typeof CustomerChangePasswordSchema>;

export const CustomerBusinessProfileSchema = z.object({
  businessName: z.string().trim().min(2).max(200),
  contactPerson: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(7).max(32).regex(/^[+\d()\s-]+$/),
  address: z.string().trim().min(3).max(500),
  voen: z
    .string()
    .trim()
    .max(20)
    .optional()
    .transform((value) => value || null),
  notifyEmail: customerEmail,
});
export type CustomerBusinessProfile = z.infer<typeof CustomerBusinessProfileSchema>;

export const CustomerOnboardingProgressSchema = z.object({
  completedStep: z.number().int().min(1).max(5),
});
export type CustomerOnboardingProgress = z.infer<typeof CustomerOnboardingProgressSchema>;

const optionalText = z.string().nullish().transform((v) => v ?? undefined);
const optionalNonNegInt = z
  .number()
  .int()
  .nonnegative()
  .nullish()
  .transform((v) => (v == null ? undefined : v));

export const OwnerFloorIngestSchema = z.object({
  deviceId: z.string().uuid(),
  deviceFingerprint: z.string().min(8).max(256),
  /** Signed-in POS account — live rows follow this login, not a leftover licence. */
  customerId: z.string().uuid().optional(),
  tenantEmail: z.string().max(320).optional(),
  tables: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        status: z.string(),
        areaName: optionalText,
        orderId: z.string().nullish().transform((v) => v ?? null),
        totalMinor: z.coerce.number().int().nonnegative().default(0),
        paidMinor: z.coerce.number().int().nonnegative().default(0),
        guestCount: optionalNonNegInt,
      }),
    )
    .default([]),
  todaySalesMinor: z.coerce.number().int().nonnegative().default(0),
  /** Approved payments total for current business day (minor units). */
  todayPaidMinor: optionalNonNegInt,
  paymentCount: optionalNonNegInt,
  businessDate: optionalText,
  connected: z.boolean().optional(),
  appVersion: optionalText,
  restaurantName: optionalText,
});
export type OwnerFloorIngest = z.infer<typeof OwnerFloorIngestSchema>;

export const OwnerConnectIngestSchema = z.object({
  deviceId: z.string().uuid(),
  deviceFingerprint: z.string().min(8).max(256),
  customerId: z.string().uuid().optional(),
  tenantEmail: z.string().max(320).optional(),
  connected: z.boolean(),
  appVersion: optionalText,
  restaurantName: optionalText,
  lastError: optionalText,
});
export type OwnerConnectIngest = z.infer<typeof OwnerConnectIngestSchema>;

export const OwnerReportIngestSchema = z.object({
  deviceId: z.string().uuid(),
  deviceFingerprint: z.string().min(8).max(256),
  customerId: z.string().uuid().optional(),
  tenantEmail: z.string().max(320).optional(),
  kind: z.enum(['x', 'z']),
  totals: z.record(z.unknown()).optional(),
  canonical: z.record(z.unknown()).optional(),
  businessDate: z.string().max(32).optional(),
  sequenceNo: z.number().int().optional(),
});
export type OwnerReportIngest = z.infer<typeof OwnerReportIngestSchema>;

export const OwnerSettingsSchema = z.object({
  notifyEmail: z.string().email(),
});
export type OwnerSettings = z.infer<typeof OwnerSettingsSchema>;

/** Extra phone numbers allowed to command the bot, beside the recipient. */
const allowedNumbers = z.array(z.string().min(8).max(32)).max(10).optional();

/**
 * Which command families the bot will honour.
 *
 * Catalog writes move money, so they stay off until the owner turns them on
 * from the till.
 */
const botPermissions = z
  .object({
    read: z.boolean().default(true),
    reports: z.boolean().default(true),
    catalog: z.boolean().default(false),
    alerts: z.boolean().default(true),
  })
  .partial()
  .optional();

export const OwnerWhatsappSettingsSchema = z.object({
  enabled: z.boolean().optional().default(true),
  recipientPhone: z.string().min(8).max(32),
  adminName: z.string().min(1).max(80),
  messageTemplate: z.string().min(1).max(1000),
  botEnabled: z.boolean().optional(),
  allowedNumbers,
  botPermissions,
});
export type OwnerWhatsappSettingsInput = z.infer<typeof OwnerWhatsappSettingsSchema>;

/** Phone-portal chat → same bot engine as WhatsApp. */
export const OwnerBotMessageSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  clientMessageId: z.string().min(8).max(64).optional(),
});
export type OwnerBotMessage = z.infer<typeof OwnerBotMessageSchema>;

/**
 * Credentials the POS terminal presents for owner endpoints it drives itself.
 *
 * The till has no tenant password and its bearer token expires after twelve
 * hours, so WhatsApp pairing from inside the app authenticates the same way
 * the floor/report ingest does: the activated device plus its fingerprint.
 */
export const OwnerDeviceAuthSchema = z.object({
  deviceId: z.string().uuid(),
  deviceFingerprint: z.string().min(8).max(256),
  /**
   * Customer UUID from the signed-in POS account. May be a leftover from a
   * retired control host; `tenantEmail` is the durable identity.
   */
  customerId: z.string().uuid().optional(),
  /** Email of the restaurant login used on the till. Live data follows this. */
  tenantEmail: z.string().max(320).optional(),
});
export type OwnerDeviceAuth = z.infer<typeof OwnerDeviceAuthSchema>;

export const OwnerDeviceWhatsappSaveSchema = OwnerDeviceAuthSchema.extend({
  enabled: z.boolean().optional().default(true),
  recipientPhone: z.string().min(8).max(32),
  adminName: z.string().min(1).max(80),
  messageTemplate: z.string().min(1).max(1000),
  botEnabled: z.boolean().optional(),
  allowedNumbers,
  botPermissions,
});
export type OwnerDeviceWhatsappSave = z.infer<typeof OwnerDeviceWhatsappSaveSchema>;

export const OwnerDeviceWhatsappTestSchema = OwnerDeviceAuthSchema.extend({
  phone: z.string().max(32).optional(),
});
export type OwnerDeviceWhatsappTest = z.infer<typeof OwnerDeviceWhatsappTestSchema>;

// ---------------------------------------------------------------------------
// Live mirror: the till streams its floor into the control database so the
// WhatsApp bot can answer questions without ever waking the POS.
// ---------------------------------------------------------------------------

export const OwnerLiveTableSchema = z.object({
  id: z.string().max(64),
  label: z.string().max(120),
  status: z.string().max(32),
  areaName: optionalText,
  orderId: z.string().nullish().transform((v) => v ?? null),
  guestCount: optionalNonNegInt,
  itemCount: optionalNonNegInt,
  totalMinor: z.coerce.number().int().default(0),
  paidMinor: z.coerce.number().int().default(0),
  waiterName: optionalText,
  openedAt: optionalText,
  // What is on the table; tills before 1.7.16 send none.
  items: z
    .array(
      z.object({
        name: z.string().max(120),
        quantity: z.coerce.number().min(0).default(0),
        status: z.string().max(32).default(''),
        totalMinor: optionalNonNegInt,
        note: z.string().max(120).nullish().transform((v) => v ?? undefined),
      }),
    )
    .max(60)
    .optional(),
});
export type OwnerLiveTable = z.infer<typeof OwnerLiveTableSchema>;

/** One row per staff member the till knows about; `loggedIn` marks the active session. */
export const OwnerLiveStaffSchema = z.object({
  userId: z.string().max(64),
  code: optionalText,
  fullName: z.string().max(160),
  role: optionalText,
  shiftId: z.string().nullish().transform((v) => v ?? null),
  loggedIn: z.boolean().default(false),
  loggedInAt: optionalNonNegInt,
});
export type OwnerLiveStaff = z.infer<typeof OwnerLiveStaffSchema>;

export const OwnerLiveProductSchema = z.object({
  id: z.string().max(64),
  name: z.string().max(200),
  categoryName: optionalText,
  priceMinor: z.coerce.number().int().default(0),
  soldOut: z.boolean().default(false),
  available: z.boolean().default(true),
  qtyToday: z.coerce.number().int().default(0),
  revenueTodayMinor: z.coerce.number().int().default(0),
});
export type OwnerLiveProduct = z.infer<typeof OwnerLiveProductSchema>;

export const OwnerLiveSalesSchema = z.object({
  grossMinor: z.coerce.number().int().default(0),
  netMinor: z.coerce.number().int().default(0),
  paidMinor: z.coerce.number().int().default(0),
  discountMinor: z.coerce.number().int().default(0),
  taxMinor: z.coerce.number().int().default(0),
  serviceMinor: z.coerce.number().int().default(0),
  tipsMinor: z.coerce.number().int().default(0),
  refundMinor: z.coerce.number().int().default(0),
  orderCount: z.coerce.number().int().default(0),
  paymentCount: z.coerce.number().int().default(0),
  avgTicketMinor: z.coerce.number().int().default(0),
  cashMinor: z.coerce.number().int().default(0),
  cardMinor: z.coerce.number().int().default(0),
});
export type OwnerLiveSales = z.infer<typeof OwnerLiveSalesSchema>;

/** Report snapshot mirrored right after the till produced an X or Z. */
export const OwnerLiveReportSchema = z.object({
  kind: z.enum(['x', 'z']),
  sequenceNo: optionalNonNegInt,
  businessDate: optionalText,
  totals: z.record(z.unknown()).optional(),
  canonical: z.record(z.unknown()).optional(),
});

export const OwnerDeviceSyncSchema = OwnerDeviceAuthSchema.extend({
  appVersion: optionalText,
  restaurantName: optionalText,
  connected: z.boolean().optional(),
  businessDate: optionalText,
  businessDayId: optionalText,
  businessDayStatus: optionalText,
  /** Absent means "unchanged since the last sync" — only `tables` is sent every tick. */
  tables: z.array(OwnerLiveTableSchema).max(500).optional(),
  staff: z.array(OwnerLiveStaffSchema).max(200).optional(),
  products: z.array(OwnerLiveProductSchema).max(3000).optional(),
  sales: OwnerLiveSalesSchema.optional(),
  report: OwnerLiveReportSchema.optional(),
  /** Who is logged in at the till right now, so the bot can explain refusals. */
  operator: z
    .object({
      userId: z.string().max(64),
      fullName: z.string().max(160),
      role: z.string().max(64),
      permissions: z.array(z.string().max(64)).max(64).default([]),
    })
    .nullish(),
});
export type OwnerDeviceSync = z.infer<typeof OwnerDeviceSyncSchema>;

export const OwnerCommandResultSchema = OwnerDeviceAuthSchema.extend({
  commandId: z.string().min(8).max(64),
  ok: z.boolean(),
  result: z.record(z.unknown()).optional(),
  error: z.string().max(500).optional(),
  errorCode: z.string().max(64).optional(),
});
export type OwnerCommandResult = z.infer<typeof OwnerCommandResultSchema>;

export const OwnerPushSubscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});
export type OwnerPushSubscribe = z.infer<typeof OwnerPushSubscribeSchema>;

export const ActivationLookupSchema = z.object({
  activationKey: z.string().min(16),
});
export type ActivationLookup = z.infer<typeof ActivationLookupSchema>;

export const DeviceHeartbeatSchema = z.object({
  /** Optional for legacy clients; once supplied successfully the server requires it thereafter. */
  deviceFingerprint: z.string().min(8).max(256).optional(),
  appVersion: z.string().max(64).optional(),
  metrics: z.record(z.unknown()).optional(),
});
export type DeviceHeartbeat = z.infer<typeof DeviceHeartbeatSchema>;

export const OfflineSignRequestSchema = z.object({
  payload: z.record(z.unknown()),
});
export type OfflineSignRequest = z.infer<typeof OfflineSignRequestSchema>;

export const HealthResponseSchema = z.object({
  ok: z.boolean(),
  service: z.literal('possistem-control-api'),
  version: z.string(),
  insecureTransport: z.boolean(),
  db: z.enum(['up', 'down']),
  time: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const SessionUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: RoleSchema,
  mustChangePassword: z.boolean(),
});
export type SessionUser = z.infer<typeof SessionUserSchema>;
