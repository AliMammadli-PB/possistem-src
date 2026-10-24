import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '@milioner/database';
import { BillingError } from './domain.js';

export type Executor = Pick<Db, 'execute'>;
export async function query<T = Record<string, unknown>>(db: Executor, statement: SQL): Promise<T[]> {
  const result: unknown = await db.execute(statement);
  return (Array.isArray(result) ? result : (result as {rows?: unknown})?.rows ?? []) as T[];
}
export async function event(db: Executor, actor: string, action: string, entityId: string, detail: Record<string, unknown> = {}, key: string | null = null): Promise<void> {
  await db.execute(sql`INSERT INTO billing_events(event_key,entity_id,actor_id,action,detail) VALUES(${key},${entityId},${actor},${action},${JSON.stringify(detail)}::jsonb) ON CONFLICT(event_key) DO NOTHING`);
}
export type Subscription = {
  id: string; customer_id: string; product: string; monthly_amount_minor: string | number; enabled: boolean;
  paid_until: string | Date | null; anchor_day: number | null; price_version: number; auto_renew: boolean;
  consent_version: number | null; card_ciphertext: string | null; card_mask: string | null;
  retry_stage: number; last_attempt_at: string | Date | null;
};

export async function attachManagedLicense(db: Executor, input: {customerId:string; licenseId:string; product:string; monthlyAmountMinor?:number; newCustomer:boolean}): Promise<void> {
  const {customerId,licenseId,product,monthlyAmountMinor} = input;
  if (monthlyAmountMinor !== undefined && (!Number.isSafeInteger(monthlyAmountMinor) || monthlyAmountMinor < 1 || monthlyAmountMinor > 100000000)) throw new BillingError('invalid_amount','Aylıq məbləği düzgün daxil edin.',400);
  // A single program subscription is shared by its explicitly linked tills.
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'billing:'+customerId+':'+product}))`);
  if (monthlyAmountMinor !== undefined) await db.execute(sql`
    INSERT INTO billing_subscriptions(customer_id,product,monthly_amount_minor)
    VALUES(${customerId}::uuid,${product},${monthlyAmountMinor}) ON CONFLICT(customer_id,product) DO NOTHING`);
  const [sub] = await query<Subscription>(db, sql`SELECT * FROM billing_subscriptions WHERE customer_id=${customerId}::uuid AND product=${product} AND enabled=true FOR UPDATE`);
  if (!sub) return; // legacy licences are not enrolled implicitly
  if (monthlyAmountMinor !== undefined && Number(sub.monthly_amount_minor) !== monthlyAmountMinor) throw new BillingError('amount_conflict','Bu proqramın mövcud aylıq haqqını Abunəliklər bölməsindən dəyişin.');
  await db.execute(sql`INSERT INTO billing_license_links(subscription_id,license_id) VALUES(${sub.id}::uuid,${licenseId}::uuid) ON CONFLICT DO NOTHING`);
  await db.execute(sql`UPDATE licenses SET features=COALESCE(features,'{}'::jsonb)||'{"billingManaged":true,"offlineGraceDays":0}'::jsonb,status=CASE WHEN ${sub.paid_until ? new Date(sub.paid_until).toISOString() : null}::timestamptz>now() THEN 'active' ELSE 'billing_pending' END, valid_until=COALESCE(${sub.paid_until ? new Date(sub.paid_until).toISOString() : null}::timestamptz,now()), updated_at=now() WHERE id=${licenseId}::uuid`);
  await db.execute(sql`UPDATE activation_keys SET expires_at=COALESCE(${sub.paid_until ? new Date(sub.paid_until).toISOString() : null}::timestamptz,now()) WHERE license_id=${licenseId}::uuid`);
  await event(db,'admin','subscription.license.link',sub.id,{licenseId,newCustomer:input.newCustomer});
}

// Financial records survive account removal. A pending/unknown bank request
// must still be reconciled; revoking access must never erase its order.
export async function archiveBillingCustomer(db:Executor,customerId:string):Promise<boolean>{
  const [row]=await query<{exists:boolean}>(db,sql`SELECT EXISTS(SELECT 1 FROM billing_subscriptions WHERE customer_id=${customerId}::uuid UNION ALL SELECT 1 FROM billing_orders WHERE customer_id=${customerId}::uuid) AS exists`);
  await db.execute(sql`DELETE FROM billing_handoffs WHERE customer_id=${customerId}::uuid`);
  await db.execute(sql`DELETE FROM billing_quotes WHERE customer_id=${customerId}::uuid`);
  if(!row?.exists)return false;
  await db.execute(sql`UPDATE billing_subscriptions SET auto_renew=false,enabled=false,updated_at=now() WHERE customer_id=${customerId}::uuid`);
  await db.execute(sql`UPDATE billing_consents SET withdrawn_at=now() WHERE subscription_id IN (SELECT id FROM billing_subscriptions WHERE customer_id=${customerId}::uuid) AND withdrawn_at IS NULL`);
  await db.execute(sql`UPDATE customers SET active=false WHERE id=${customerId}::uuid`);
  await db.execute(sql`UPDATE licenses SET status='revoked',updated_at=now() WHERE customer_id=${customerId}::uuid`);
  await db.execute(sql`UPDATE activation_keys SET revoked_at=now() WHERE license_id IN (SELECT id FROM licenses WHERE customer_id=${customerId}::uuid) AND revoked_at IS NULL`);
  await event(db,'admin','customer.billing.archive',customerId);
  return true;
}
