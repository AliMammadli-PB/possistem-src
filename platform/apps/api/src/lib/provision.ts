import { attachManagedLicense } from './billing/store.js';
import { createHash, createHmac } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '@milioner/database';
import { activationKeys, customers, licenses, resellers } from '@milioner/database';
import {
  generateActivationKeyPlaintext,
  hashPassword,
  hmacActivationKey,
} from '@milioner/security';
import { env } from '../env.js';
import { provisionCustomerLive } from './mysql.js';

const DEFAULT_FEATURES: Record<string, unknown> = {
  pos: true,
  catalog: true,
  reports: true,
  gifts: true,
  backup: true,
  kds: true,
};

/* geyim-product: type */ export type ActivationProduct = 'restaurant' | 'market' | 'geyim' | 'aptek' | 'topdan'; /* topdan-product: type */ /* aptek-product: type */

export function activationProductFromSale(input: {
  plan?: string | null;
  label?: string | null;
}): ActivationProduct {
  const raw = `${input.plan ?? ''} ${input.label ?? ''}`.toLowerCase();
  return /\b(market|mpos|retail|supermarket|ma[gğ]aza)\b/.test(raw) ? 'market' : 'restaurant';
}

export type SaleInput = {
  // Set only by the authenticated superadmin attach-license route.
  existingCustomerId?: string;
  requestId?: string;
  branchId?: string;
  branchName?: string;
  name: string;
  email: string;
  password: string;
  address: string;
  phone?: string | null;
  voen?: string | null;
  contactPerson?: string | null;
  notes?: string | null;
  days: number;
  monthlyAmountMinor?: number;
  seats: number;
  maxDevices: number;
  plan?: string | null;
  product?: ActivationProduct;
  label?: string | null;
  /** Satışı yapan bayi; NULL => super adminin doğrudan satışı. */
  resellerId: string | null;
};

export type SaleResult =
  | { ok: true; customerId: string; licenseId: string; keyId: string;
      activationKey: string; expiresAt: Date; days: number }
  | { ok: false; reason: 'email_taken' | 'quota_exhausted' };

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
  const validUntil = new Date(Date.now() + input.days * 24 * 3600_000);
  const passwordHash = input.existingCustomerId ? null : await hashPassword(input.password);
  const requestHash = input.existingCustomerId && input.requestId ? createHash('sha256').update(JSON.stringify([input.existingCustomerId,input.requestId,input.product,input.days,input.seats,input.maxDevices,input.plan,input.branchId||'',input.branchName||''])).digest('hex') : null;
  // Stable admin operation keys make retrying the same request safe. Only their HMAC is stored.
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const plaintext = requestHash ? [...createHmac('sha256',env.activationPepper).update('owner-license-key-v1:'+input.existingCustomerId+':'+input.requestId).digest().subarray(0,20)].map(n=>alphabet[n&31]).join('') : generateActivationKeyPlaintext();
  const keyHmac = hmacActivationKey(env.activationPepper, plaintext);
  const product = input.product ?? activationProductFromSale(input);
  // Restaurant abunəlik: standart/biznes/premium. Market lisenziyası ayrıca.
  const rawPlan = input.plan?.trim() || '';
  const normalizedPlan =
    rawPlan === 'standard' ? 'standart' : rawPlan;
  const marketFamily = product === 'market' || product === 'geyim' || product === 'aptek' || product === 'topdan'; /* topdan-product: family */ /* aptek-product: family */ /* geyim-product: plan */
  const plan =
    marketFamily
      ? 'market'
      : normalizedPlan && ['standart', 'biznes', 'premium'].includes(normalizedPlan)
        ? normalizedPlan
        : 'standart';
  const planId = marketFamily ? null : plan; /* geyim-product: planId */

  const features: Record<string, unknown> = {
    ...DEFAULT_FEATURES,
    trialDays: input.days,
    subscriptionPlan: planId,
    ...(requestHash?{provisionHash:requestHash}:{}),
  };
  if (planId === 'biznes' || planId === 'premium') {
    features.chat = true;
  }
  if (planId === 'premium') {
    features.cloudBackup = true;
  }
  if (marketFamily) {
    features.product = 'market';
    features.market = true;
    features.kds = false;
    // The till, the portal and /market-pos/* see a market licence; the key and
    // the installer say Geyim POS. /* geyim-product: features */
    if (product === 'geyim' || product === 'aptek' || product === 'topdan') features.vertical = product; /* topdan-product: vertical */ /* aptek-product: vertical */
  } else {
    features.product = 'restaurant';
  }

  try {
    const result = await db.transaction(async (tx) => {
      if(input.existingCustomerId){if(input.resellerId||!input.requestId)throw Error('Invalid owner license request');await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.existingCustomerId}))`);}
      if (input.resellerId) {
        // Kota tahsisi: satır dönmezse kota bitmiş ya da bayi pasif.
        const claimed = await tx.execute(sql`
          UPDATE resellers
          SET keys_used = keys_used + 1, updated_at = now()
          WHERE id = ${input.resellerId}
            AND active = true
            AND keys_used < key_quota
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
      if (existing && existing.id!==input.existingCustomerId)throw new EmailTakenError();
      if(input.existingCustomerId&&(!existing||!existing.active))throw Error('Sahibkar hesabı tapılmadı və ya deaktivdir');
      if(input.existingCustomerId){
        const [prior]=await tx.select().from(licenses).where(eq(licenses.id,input.requestId!)).limit(1);
        if(prior){
          if(prior.customerId!==existing!.id||prior.features?.provisionHash!==requestHash)throw Error('Bu əməliyyat açarı fərqli məlumatlarla istifadə olunub');
          const [key]=await tx.select().from(activationKeys).where(eq(activationKeys.licenseId,prior.id)).limit(1);
          if(!key||key.revokedAt||key.keyHmac!==keyHmac)throw Error('Əvvəlki əməliyyatın açarı dəyişdirilib və ya artıq aktiv deyil');
          return {ok:true as const,customerId:existing!.id,licenseId:prior.id,keyId:key.id,activationKey:plaintext,expiresAt:prior.validUntil!,days:input.days};
        }
      }
      let branchId=input.branchId;
      if(input.existingCustomerId){
        const found=await tx.execute(branchId?sql`SELECT id FROM branches WHERE id=${branchId}::uuid AND customer_id=${existing!.id}::uuid AND active=true`:sql`SELECT id FROM branches WHERE customer_id=${existing!.id}::uuid AND active=true AND lower(trim(name))=lower(${input.branchName||''}) LIMIT 1`);
        if(found.length)branchId=String(found[0]!.id);
        else if(branchId)throw Error('Filial bu sahibkara aid deyil və ya deaktivdir');
        else if(input.branchName){const made=await tx.execute(sql`INSERT INTO branches(customer_id,name,code) VALUES(${existing!.id}::uuid,${input.branchName},${'BR-'+input.requestId!.slice(0,8)}) RETURNING id`);branchId=String(made[0]!.id);}
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
          ...(input.existingCustomerId?{id:input.requestId}:{}),
          customerId: customer.id,
          branchId: branchId??null,
          plan,
          planId,
          seats: input.seats,
          features,
          validFrom: new Date(),
          validUntil,
          status: 'active',
        })
        .returning();

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

      await attachManagedLicense(tx,{customerId:customer.id,licenseId:license.id,product,monthlyAmountMinor:input.monthlyAmountMinor,newCustomer:!input.existingCustomerId});
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
