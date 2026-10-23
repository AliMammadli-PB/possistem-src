import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '@possistem/database';
import { activationKeys, customers, licenses, resellers } from '@possistem/database';
import {
  generateActivationKeyPlaintext,
  hashPassword,
  hmacActivationKey,
} from '@possistem/security';
import { env } from '../env.js';
import { provisionCustomerLive } from './mysql.js';
import { renewedUntil } from './reseller-terms.js';

const DEFAULT_FEATURES: Record<string, unknown> = {
  pos: true,
  catalog: true,
  reports: true,
  gifts: true,
  backup: true,
  kds: true,
};

export function activationProductFromSale(
  input: Pick<SaleInput, 'product' | 'plan' | 'label'>,
): 'restaurant' | 'market' {
  if (input.product) return input.product;
  const raw = `${input.plan ?? ''} ${input.label ?? ''}`.toLowerCase();
  return /\b(market|mpos|retail|supermarket|ma[gğ]aza)\b/.test(raw)
    ? 'market'
    : 'restaurant';
}

export type SaleInput = {
  name: string;
  email: string;
  password: string;
  address: string;
  phone?: string | null;
  voen?: string | null;
  contactPerson?: string | null;
  notes?: string | null;
  days: number;
  seats: number;
  maxDevices: number;
  plan: string;
  product?: 'restaurant' | 'market';
  label?: string | null;
  /** Satışı yapan bayi; NULL => super adminin doğrudan satışı. */
  resellerId: string | null;
  /**
   * Bayi satışında silinən ay krediti. Sınaqda 0-dır — onu `trial` sayı
   * məhdudlaşdırır. Göndərilməyəndə köhnə davranış: 1.
   */
  credits?: number;
  /** Pulsuz 7 günlük sınaq (bayinin aylıq `trial_limit`-i ilə). */
  trial?: boolean;
  /** Bayinin seçdiyi ay sayı; sınaqda 0. */
  termMonths?: number | null;
  /** Hazır hesablanmış bitmə tarixi (təqvim ayı); yoxdursa `days`-dən. */
  validUntil?: Date;
};

export type SaleResult =
  | { ok: true; customerId: string; licenseId: string; keyId: string;
      activationKey: string; expiresAt: Date; days: number }
  | { ok: false; reason: 'email_taken' | 'quota_exhausted' | 'trial_limit' };

/**
 * Müşteri + lisans + aktivasyon anahtarını tek transaction'da üretir.
 *
 * Bayi satışında kota da aynı transaction içinde tek atomik UPDATE ile tahsis
 * edilir (aktivasyon anahtarlarındaki `redeem_count` claim'i ile aynı kalıp),
 * böylece eşzamanlı iki istek kotayı aşamaz.
 *
 * Plaintext anahtar yalnızca burada döner ve bir daha okunamaz — veritabanında
 * sadece HMAC'i saklanır.
 */
export async function createSale(db: Db, input: SaleInput): Promise<SaleResult> {
  const email = input.email.toLowerCase().trim();
  const validUntil = input.validUntil ?? new Date(Date.now() + input.days * 24 * 3600_000);
  const passwordHash = await hashPassword(input.password);
  const plaintext = generateActivationKeyPlaintext();
  const keyHmac = hmacActivationKey(env.activationPepper, plaintext);
  const product = input.product ?? activationProductFromSale(input);
  const plan = input.plan?.trim() || (product === 'market' ? 'market' : 'standard');

  // Only a trial (or an admin's own sale, as before) is tagged with trial days;
  // a paid partner sale is not a trial.
  const features: Record<string, unknown> = {
    ...DEFAULT_FEATURES,
    ...(input.resellerId == null || input.trial ? { trialDays: input.days } : {}),
  };
  if (product === 'market') {
    features.product = 'market';
    features.market = true;
    features.kds = false;
  } else {
    features.product = 'restaurant';
  }

  try {
    const result = await db.transaction(async (tx) => {
      if (input.resellerId && input.trial) {
        // A trial costs no credit but is capped per calendar month; the row
        // lock keeps two simultaneous trials from both passing the count.
        const [owner] = (await tx.execute(sql`
          SELECT trial_limit FROM resellers
          WHERE id = ${input.resellerId} AND active = true
          FOR UPDATE
        `)) as unknown as Array<{ trial_limit: number }>;
        if (!owner) return { ok: false as const, reason: 'quota_exhausted' as const };
        const [used] = (await tx.execute(sql`
          SELECT count(*)::int AS n FROM reseller_credit_ledger
          WHERE reseller_id = ${input.resellerId} AND reason = 'sale' AND months = 0
            AND created_at >= date_trunc('month', now())
        `)) as unknown as Array<{ n: number }>;
        if ((used?.n ?? 0) >= owner.trial_limit) {
          return { ok: false as const, reason: 'trial_limit' as const };
        }
      } else if (input.resellerId) {
        // Kredit tahsisi: satır dönmezse kredit yetmir ya da bayi pasif.
        const credits = input.credits ?? 1;
        const claimed = await tx.execute(sql`
          UPDATE resellers
          SET keys_used = keys_used + ${credits}, updated_at = now()
          WHERE id = ${input.resellerId}
            AND active = true
            AND keys_used + ${credits} <= key_quota
          RETURNING id
        `);
        if (claimed.length === 0) {
          return { ok: false as const, reason: 'quota_exhausted' as const };
        }
      }

      const [existing] = await tx
        .select()
        .from(customers)
        .where(sql`lower(${customers.email}) = ${email}`)
        .limit(1);
      if (existing) {
        const [sameProduct] = await tx
          .select({ id: licenses.id })
          .from(licenses)
          .innerJoin(activationKeys, eq(activationKeys.licenseId, licenses.id))
          .where(
            and(
              eq(licenses.customerId, existing.id),
              eq(activationKeys.product, product),
            ),
          )
          .limit(1);
        if (sameProduct) throw new EmailTakenError();

        await tx
          .update(customers)
          .set({ passwordHash, active: true, updatedAt: new Date() })
          .where(eq(customers.id, existing.id));
      }

      const customer = existing ?? (await tx
        .insert(customers)
        .values({
          name: input.name,
          email,
          phone: input.phone ?? null,
          address: input.address,
          voen: input.voen ?? null,
          contactPerson: input.contactPerson ?? null,
          notes: input.notes ?? null,
          passwordHash,
          mustChangePassword: false,
          resellerId: input.resellerId,
          active: true,
        })
        .returning())[0]!;

      const [license] = await tx
        .insert(licenses)
        .values({
          customerId: customer.id,
          plan,
          seats: input.seats,
          features,
          validFrom: new Date(),
          validUntil,
          status: 'active',
        })
        .returning();

      if (input.termMonths != null || input.trial) {
        await tx.execute(sql`
          UPDATE licenses SET term_months = ${input.termMonths ?? 0}, is_trial = ${Boolean(input.trial)}
          WHERE id = ${license.id}
        `);
      }
      if (input.resellerId) {
        await tx.execute(sql`
          INSERT INTO reseller_credit_ledger (reseller_id, delta, reason, customer_id, license_id, months)
          VALUES (${input.resellerId}, ${-(input.trial ? 0 : input.credits ?? 1)}, 'sale',
                  ${customer.id}, ${license.id}, ${input.trial ? 0 : input.termMonths ?? null})
        `);
      }

      const [keyRow] = await tx
        .insert(activationKeys)
        .values({
          licenseId: license.id,
          keyHmac,
          label: input.label ?? `${input.days}g`,
          product,
          resellerId: input.resellerId,
          maxDevices: input.maxDevices,
          expiresAt: validUntil,
        })
        .returning();

      return {
        ok: true as const,
        customerId: customer.id,
        licenseId: license.id,
        keyId: keyRow.id,
        activationKey: plaintext,
        expiresAt: validUntil,
        days: input.days,
      };
    });

    // The restaurant's place in the live database is opened here, not on its
    // first sync: the WhatsApp bot and the owner app can then read a real row
    // for a customer that has been sold but never switched on.
    if (result.ok && product === 'restaurant') {
      void provisionCustomerLive({
        customerId: result.customerId,
        name: input.name,
        phone: input.phone ?? null,
        notifyEmail: email,
      }).catch(() => undefined);
    }

    return result;
  } catch (err) {
    if (err instanceof EmailTakenError) {
      return { ok: false, reason: 'email_taken' };
    }
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('customers_email_uidx') || message.includes('unique')) {
      return { ok: false, reason: 'email_taken' };
    }
    throw err;
  }
}

class EmailTakenError extends Error {
  constructor() {
    super('customer email already exists');
  }
}

/** Bayi kota durumu — panel kartı ve `POST /reseller/customers` ön kontrolü için. */
export async function resellerQuota(
  db: Db,
  resellerId: string,
): Promise<{ quota: number; used: number; remaining: number } | null> {
  const [row] = await db
    .select({ quota: resellers.keyQuota, used: resellers.keysUsed })
    .from(resellers)
    .where(eq(resellers.id, resellerId))
    .limit(1);
  if (!row) return null;
  return { quota: row.quota, used: row.used, remaining: Math.max(0, row.quota - row.used) };
}

export type RenewResult =
  | { ok: true; licenseId: string; customerId: string; validUntil: Date }
  | { ok: false; reason: 'not_found' | 'quota_exhausted' };

/**
 * Extends a licence and every activation key on it.
 *
 * A partner (`resellerId` set) may only renew their own customers and pays one
 * credit per month; the admin (`resellerId` null) renews for free by days. A
 * lapsed licence restarts from today, a running one continues from its end.
 */
export async function renewLicense(
  db: Db,
  input: {
    licenseId: string;
    resellerId: string | null;
    months?: number;
    days?: number;
    actorUserId?: string | null;
  },
): Promise<RenewResult> {
  return db.transaction(async (tx) => {
    const [row] = (await tx.execute(sql`
      SELECT l.id, l.valid_until, l.customer_id, l.status, c.reseller_id
      FROM licenses l JOIN customers c ON c.id = l.customer_id
      WHERE l.id = ${input.licenseId}
      FOR UPDATE OF l
    `)) as unknown as Array<{ id: string; valid_until: Date | string | null; customer_id: string; status: string; reseller_id: string | null }>;
    if (!row) return { ok: false as const, reason: 'not_found' as const };
    if (input.resellerId && row.reseller_id !== input.resellerId) {
      return { ok: false as const, reason: 'not_found' as const };
    }
    // Only POSSISTEM brings back a licence it stopped; a partner cannot renew it.
    if (input.resellerId && (row.status === 'revoked' || row.status === 'suspended')) {
      return { ok: false as const, reason: 'not_found' as const };
    }

    const months = input.months ?? 0;
    if (input.resellerId) {
      const claimed = await tx.execute(sql`
        UPDATE resellers
        SET keys_used = keys_used + ${months}, updated_at = now()
        WHERE id = ${input.resellerId} AND active = true AND keys_used + ${months} <= key_quota
        RETURNING id
      `);
      if (claimed.length === 0) return { ok: false as const, reason: 'quota_exhausted' as const };
    }

    const now = new Date();
    const current = row.valid_until ? new Date(row.valid_until) : null;
    const validUntil = months > 0
      ? renewedUntil(current, months, now)
      : new Date((current && current > now ? current : now).getTime() + (input.days ?? 0) * 24 * 3600_000);

    await tx.execute(sql`
      UPDATE licenses
      SET valid_until = ${validUntil.toISOString()}::timestamptz, status = 'active', updated_at = now(), is_trial = false,
          term_months = CASE WHEN ${months} > 0 THEN ${months} ELSE term_months END
      WHERE id = ${row.id}
    `);
    // A new PC on the same licence must be able to activate until the new end.
    await tx.execute(sql`UPDATE activation_keys SET expires_at = ${validUntil.toISOString()}::timestamptz WHERE license_id = ${row.id}`);

    if (input.resellerId) {
      await tx.execute(sql`
        INSERT INTO reseller_credit_ledger (reseller_id, delta, reason, customer_id, license_id, months, actor_user_id)
        VALUES (${input.resellerId}, ${-months}, 'renew', ${row.customer_id}, ${row.id}, ${months}, ${input.actorUserId ?? null})
      `);
    }
    return { ok: true as const, licenseId: row.id, customerId: row.customer_id, validUntil };
  });
}

/** Admin: credits a partner bought, recorded with what they paid. */
export async function grantResellerCredits(
  db: Db,
  input: { resellerId: string; months: number; amountMinor?: number | null; note?: string | null; actorUserId: string | null },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const updated = await tx.execute(sql`
      UPDATE resellers SET key_quota = key_quota + ${input.months}, updated_at = now()
      WHERE id = ${input.resellerId}
      RETURNING id
    `);
    if (updated.length === 0) return false;
    await tx.execute(sql`
      INSERT INTO reseller_credit_ledger (reseller_id, delta, reason, months, amount_minor, note, actor_user_id)
      VALUES (${input.resellerId}, ${input.months}, 'grant', ${input.months},
              ${input.amountMinor ?? null}, ${input.note?.trim() || null}, ${input.actorUserId})
    `);
    return true;
  });
}
