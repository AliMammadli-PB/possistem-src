import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { sql } from "drizzle-orm";
import { env } from "../../env.js";
import { query } from "../billing/store.js";
import {
  Epoint,
  verifyCallback,
  encryptCard,
  decryptCard,
  safeGatewayResponse,
} from "../billing/epoint.js";
import {
  quote,
  validateBill,
  providerAmount,
  TablePaymentError,
  type Selection,
  type BillSnapshot,
  type Hold,
} from "./domain.js";
export type Till = (
  customerId: string,
  deviceId: string,
  action: string,
  payload: Record<string, unknown>,
) => Promise<any>;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const secureEqual = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const rootKey = () =>
  createHmac("sha256", env.sessionSecret)
    .update("possistem:table-payments:v1")
    .digest();
const subKey = (owner: string, purpose: string) =>
  createHmac("sha256", rootKey())
    .update(owner + "|" + purpose)
    .digest();
export const seal = (value: string, owner: string, purpose: string) =>
  encryptCard(value, subKey(owner, purpose));
export const unseal = (value: string, owner: string, purpose: string) =>
  decryptCard(value, subKey(owner, purpose));
export class TablePayments {
  constructor(
    readonly db: any,
    readonly till: Till,
    readonly options: {
      enabled?: () => boolean;
      transport?: typeof fetch;
    } = {},
  ) {}
  enabled() {
    return (
      this.options.enabled?.() ??
      process.env.TABLE_QR_PAYMENTS_ENABLED === "true"
    );
  }
  token(b: any) {
    return (
      b.id +
      "." +
      createHmac("sha256", rootKey())
        .update(b.id + "|" + b.public_nonce)
        .digest("base64url")
    );
  }
  url(b: any) {
    return "https://possistem.az/qr/hesab/" + this.token(b) + "/";
  }
  async merchant(customer: string, device?: string) {
    const [r] = await query<any>(
      this.db,
      sql`SELECT * FROM restaurant_payment_merchants WHERE customer_id=${customer}::uuid AND active=true AND (device_id=${device || null}::uuid OR device_id IS NULL) ORDER BY device_id NULLS LAST LIMIT 1`,
    );
    return r;
  }
  async ready(customer: string, device: string) {
    const m = await this.merchant(customer, device);
    return {
      available: this.enabled() && !!m?.verified,
      reason: !m
        ? "Restoranın Epoint hesabını Possistem admini qoşmalıdır."
        : !this.enabled() || !m.verified
          ? "QR ödənişin bank və kassa yoxlaması hələ tamamlanmayıb."
          : null,
    };
  }
  async open(
    customer: string,
    device: string,
    input: { sessionId: string; secret: string; snapshot: BillSnapshot },
  ) {
    const ready = await this.ready(customer, device);
    if (!ready.available) throw new TablePaymentError(ready.reason!, 503);
    const merchant = await this.merchant(customer, device);
    validateBill(input.snapshot);
    if (!/^[a-f0-9]{64}$/.test(input.secret))
      throw new TablePaymentError("Kassa təsdiqi düzgün deyil.", 400);
    const [old] = await query<any>(
      this.db,
      sql`SELECT * FROM restaurant_payment_bills WHERE device_id=${device}::uuid AND pos_session_id=${input.sessionId}`,
    );
    if (old) {
      if (
        old.state !== "open" ||
        new Date(old.expires_at).getTime() <= Date.now()
      )
        throw new TablePaymentError(
          "Əvvəlki QR linki bağlanıb. QR ödənişi dayandırıb yenidən açın.",
        );
      if (
        old.customer_id !== customer ||
        old.snapshot.revision !== input.snapshot.revision ||
        unseal(old.secret_cipher, customer, "bill") !== input.secret
      )
        throw new TablePaymentError("Masa hesabı dəyişib.");
      return { url: this.url(old), billId: old.id };
    }
    const id = randomUUID(),
      nonce = randomBytes(24).toString("hex");
    const [b] = await query<any>(
      this.db,
      sql`INSERT INTO restaurant_payment_bills(id,customer_id,device_id,merchant_id,pos_session_id,secret_cipher,public_nonce,snapshot,expires_at) VALUES(${id}::uuid,${customer}::uuid,${device}::uuid,${merchant.id}::uuid,${input.sessionId},${seal(input.secret, customer, "bill")},${nonce},${JSON.stringify(input.snapshot)}::jsonb,now()+interval '30 minutes') RETURNING *`,
    );
    return { url: this.url(b), billId: b.id };
  }
  async bill(token: string, db = this.db, lock = false, allowExpired = false) {
    const [id, , ...extra] = token.split(".");
    if (
      extra.length ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/.test(
        token,
      )
    )
      throw new TablePaymentError("Ödəniş linki tapılmadı.", 404);
    const [b] = await query<any>(
      db,
      sql`SELECT * FROM restaurant_payment_bills WHERE id=${id}::uuid ${lock ? sql`FOR UPDATE` : sql``}`,
    );
    if (!b || !secureEqual(this.token(b), token))
      throw new TablePaymentError("Ödəniş linki tapılmadı.", 404);
    if (
      !allowExpired &&
      (b.state !== "open" || new Date(b.expires_at).getTime() <= Date.now())
    )
      throw new TablePaymentError(
        "Bu ödəniş linki bağlanıb. Kassirdən yeni QR kod istəyin.",
        410,
      );
    return b;
  }
  async rows(billId: string, db = this.db) {
    return query<any>(
      db,
      sql`SELECT * FROM restaurant_table_payments WHERE bill_id=${billId}::uuid ORDER BY created_at,id`,
    );
  }
  ledger(rows: any[]): Hold[] {
    return rows.map((r) => ({
      id: r.id,
      selection: r.selection,
      allocations: r.allocations,
      amountMinor: Number(r.amount_minor),
      status:
        r.status === "creating"
          ? "pending"
          : r.status === "review"
            ? "unknown"
            : r.status,
    }));
  }
  async view(token: string) {
    const b = await this.bill(token, this.db, false, true),
      rows = await this.rows(b.id),
      paid = rows
        .filter((r) => ["paid", "applied"].includes(r.status))
        .reduce((n, r) => n + Number(r.amount_minor), 0),
      pending = rows
        .filter((r) => !["paid", "applied", "failed"].includes(r.status))
        .reduce((n, r) => n + Number(r.amount_minor), 0);
    const [restaurant] = await query<{ name: string }>(
      this.db,
      sql`SELECT name FROM customers WHERE id=${b.customer_id}::uuid`,
    );
    return {
      restaurantName: restaurant?.name || "Restoran",
      billId: b.id,
      snapshot: b.snapshot,
      state: b.state,
      expiresAt: b.expires_at,
      expired: new Date(b.expires_at).getTime() <= Date.now(),
      paidMinor: b.snapshot.paidMinor + paid,
      pendingMinor: pending,
      remainingMinor: b.snapshot.totalMinor - b.snapshot.paidMinor - paid,
      availableMinor:
        b.snapshot.totalMinor - b.snapshot.paidMinor - paid - pending,
      holds: rows.map((r) => ({
        id: r.id,
        selection: r.selection,
        allocations: r.allocations,
        amountMinor: Number(r.amount_minor),
        status: r.status,
      })),
      available: this.enabled(),
    };
  }
  async preview(token: string, selection: Selection) {
    const b = await this.bill(token);
    return quote(b.snapshot, selection, this.ledger(await this.rows(b.id)));
  }
  async checkout(
    token: string,
    requestId: string,
    selection: Selection,
    expectedAmountMinor?: number,
  ) {
    const fingerprint = hash(JSON.stringify(selection));
    const intent = await this.db.transaction(async (tx: any) => {
      const b = await this.bill(token, tx, true);
      if (!this.enabled())
        throw new TablePaymentError("QR ödəniş hələ aktiv deyil.", 503);
      const [m] = await query<any>(
        tx,
        sql`SELECT active,verified FROM restaurant_payment_merchants WHERE id=${b.merchant_id}::uuid FOR SHARE`,
      );
      if (!m?.active || !m.verified)
        throw new TablePaymentError(
          "Restoranın Epoint konfiqurasiyası yenilənib. Kassirdən yeni QR kod istəyin.",
          409,
        );
      const rows = await this.rows(b.id, tx),
        old = rows.find((r) => r.request_id === requestId);
      if (old) {
        if (old.fingerprint !== fingerprint)
          throw new TablePaymentError("Təkrar sorğuda ödəniş seçimi dəyişib.");
        return old;
      }
      const q = quote(b.snapshot, selection, this.ledger(rows)),
        id = randomUUID();
      if (
        expectedAmountMinor !== undefined &&
        q.amountMinor !== expectedAmountMinor
      )
        throw new TablePaymentError(
          "Hesabın ödəniləcək məbləği dəyişib. Yeni məbləği yoxlayın.",
        );
      const [i] = await query<any>(
        tx,
        sql`INSERT INTO restaurant_table_payments(id,bill_id,request_id,fingerprint,selection,allocations,amount_minor,status,provider_order_id) VALUES(${id}::uuid,${b.id}::uuid,${requestId}::uuid,${fingerprint},${JSON.stringify(selection)}::jsonb,${JSON.stringify(q.allocations)}::jsonb,${q.amountMinor},'reserving',${"table-" + id}) RETURNING *`,
      );
      return i;
    });
    await this.advance(intent.id);
    return this.intentView(token, intent.id);
  }
  async record(id: string) {
    const [r] = await query<any>(
      this.db,
      sql`SELECT i.*,b.customer_id,b.device_id,b.pos_session_id,b.secret_cipher,b.merchant_id,b.public_nonce,b.snapshot,b.state AS bill_state FROM restaurant_table_payments i JOIN restaurant_payment_bills b ON b.id=i.bill_id WHERE i.id=${id}::uuid`,
    );
    return r;
  }
  proof(r: any, action: string) {
    const expiresAt = Date.now() + 90000,
      transaction = String(r.provider_transaction || ""),
      rrn = /^\d{12}$/.test(String(r.provider_result?.rrn || ""))
        ? String(r.provider_result.rrn)
        : "",
      amountMinor = Number(r.amount_minor),
      sessionId = r.pos_session_id,
      intentId = r.id,
      text = [
        action,
        sessionId,
        intentId,
        amountMinor,
        transaction,
        rrn,
        expiresAt,
      ].join("|"),
      signature = createHmac(
        "sha256",
        Buffer.from(unseal(r.secret_cipher, r.customer_id, "bill"), "hex"),
      )
        .update(text)
        .digest("hex");
    return {
      sessionId,
      intentId,
      amountMinor,
      transaction,
      rrn,
      expiresAt,
      signature,
    };
  }
  async invoke(r: any, action: string) {
    return this.till(r.customer_id, r.device_id, action, this.proof(r, action));
  }
  async gateway(r: any) {
    const [m] = await query<any>(
      this.db,
      sql`SELECT * FROM restaurant_payment_merchants WHERE id=${r.merchant_id}::uuid AND customer_id=${r.customer_id}::uuid`,
    );
    if (!m)
      throw new TablePaymentError(
        "Restoranın ödəniş konfiqurasiyası yoxdur.",
        503,
      );
    return new Epoint(
      {
        publicKey: m.public_key,
        privateKey: unseal(m.private_cipher, m.customer_id, "merchant"),
        tokenKey: rootKey(),
        origin: "https://possistem.az",
        baseUrl: "https://epoint.az/api/1/",
        liveVerified: !!m.verified,
      },
      this.options.transport,
    );
  }
  async advance(id: string) {
    let r = await this.record(id);
    if (!r) return;
    if (r.status === "reserving") {
      let hold;
      try {
        hold = await this.invoke(r, "hold");
      } catch (e) {
        if ((e as any)?.definitive)
          await this.db.execute(
            sql`UPDATE restaurant_table_payments SET status='failed',error='Kassa bu ödənişi rezerv etmədi.',updated_at=now() WHERE id=${id}::uuid AND status='reserving'`,
          );
        return;
      }
      if (!hold?.held) return;
      const [claimed] = await query<any>(
        this.db,
        sql`UPDATE restaurant_table_payments SET status='creating',updated_at=now() WHERE id=${id}::uuid AND status='reserving' RETURNING id`,
      );
      if (!claimed) return;
      try {
        const gateway = await this.gateway(r),
          token = this.token({ id: r.bill_id, public_nonce: r.public_nonce }),
          returnUrl =
            "https://possistem.az/qr/hesab/" + token + "/?payment=" + id;
        const result = await gateway.call("request", {
          amount: (Number(r.amount_minor) / 100).toFixed(2),
          currency: "AZN",
          language: "az",
          order_id: r.provider_order_id,
          description: "Masa hesabı " + r.snapshot.orderNumber,
          success_redirect_url: returnUrl,
          error_redirect_url: returnUrl,
          result_url:
            "https://possistem.az/pos/api/billing/table/epoint/callback/" +
            r.merchant_id,
        });
        if (
          typeof result.transaction === "string" &&
          /^[A-Za-z0-9_-]{1,120}$/.test(result.transaction)
        )
          await this.db.execute(
            sql`UPDATE restaurant_table_payments SET provider_transaction=COALESCE(provider_transaction,${result.transaction}) WHERE id=${id}::uuid AND status='creating'`,
          );
        if (
          result.status === "success" &&
          typeof result.transaction === "string" &&
          result.transaction.length <= 120 &&
          typeof result.redirect_url === "string" &&
          /^https:\/\/(?:[a-z0-9-]+\.)*epoint\.az\//i.test(result.redirect_url)
        )
          await this.db.execute(
            sql`UPDATE restaurant_table_payments SET status='pending',provider_transaction=${result.transaction},redirect_url=${result.redirect_url},updated_at=now() WHERE id=${id}::uuid AND status='creating'`,
          );
        else if (["error", "failed"].includes(String(result.status)))
          await this.db.execute(
            sql`UPDATE restaurant_table_payments SET status='failed',provider_result=${JSON.stringify(safeGatewayResponse(result))}::jsonb,updated_at=now() WHERE id=${id}::uuid AND status='creating'`,
          );
        else
          await this.db.execute(
            sql`UPDATE restaurant_table_payments SET status='unknown',error='Bankın nəticəsi araşdırılır. Təkrar ödəniş etməyin.',updated_at=now() WHERE id=${id}::uuid AND status='creating'`,
          );
      } catch {
        await this.db.execute(
          sql`UPDATE restaurant_table_payments SET status='unknown',error='Bankın nəticəsi araşdırılır. Təkrar ödəniş etməyin.',updated_at=now() WHERE id=${id}::uuid AND status='creating'`,
        );
      }
      r = await this.record(id);
    }
    if (r.status === "paid") {
      try {
        const applied = await this.invoke(r, "apply");
        if (applied?.applied) {
          await this.db.transaction(async (tx: any) => {
            const [b] = await query<any>(
              tx,
              sql`SELECT * FROM restaurant_payment_bills WHERE id=${r.bill_id}::uuid FOR UPDATE`,
            );
            await tx.execute(
              sql`UPDATE restaurant_table_payments SET status='applied',native_payment_id=${String(applied.paymentId)},applied_at=now(),updated_at=now() WHERE id=${id}::uuid AND status='paid'`,
            );
            const [paid] = await query<any>(
              tx,
              sql`SELECT COALESCE(sum(amount_minor),0) AS n FROM restaurant_table_payments WHERE bill_id=${r.bill_id}::uuid AND status='applied'`,
            );
            if (Number(paid.n) + b.snapshot.paidMinor === b.snapshot.totalMinor)
              await tx.execute(
                sql`UPDATE restaurant_payment_bills SET state='closed' WHERE id=${r.bill_id}::uuid`,
              );
          });
        }
      } catch {
        /* Confirmed bank money remains paid until the POS acknowledges it. */
      }
    }
    if (r.status === "failed" && !r.native_released_at) {
      try {
        const released = await this.invoke(r, "release");
        if (released?.released)
          await this.db.execute(
            sql`UPDATE restaurant_table_payments SET native_released_at=now(),updated_at=now() WHERE id=${id}::uuid AND status='failed'`,
          );
      } catch {
        /* Keep retrying the native release; it never changes a bank result. */
      }
    }
  }
  async intentView(token: string, id: string) {
    const b = await this.bill(token, this.db, false, true),
      r = await this.record(id);
    if (!r || r.bill_id !== b.id)
      throw new TablePaymentError("Ödəniş tapılmadı.", 404);
    return {
      id: r.id,
      status: r.status,
      amountMinor: Number(r.amount_minor),
      redirectUrl: r.status === "pending" ? r.redirect_url : null,
      error: r.error,
    };
  }
  async recordResult(
    id: string,
    response: Record<string, unknown>,
    fromStatus = false,
  ) {
    await this.db.transaction(async (tx: any) => {
      const row = (
        await query<any>(
          tx,
          sql`SELECT * FROM restaurant_table_payments WHERE id=${id}::uuid FOR UPDATE`,
        )
      )[0];
      if (!row) throw new TablePaymentError("Ödəniş tapılmadı.", 404);
      if (
        typeof response.transaction !== "string" ||
        (row.provider_transaction &&
          row.provider_transaction !== response.transaction)
      )
        throw new TablePaymentError("Bank əməliyyatı uyğun deyil.", 400);
      if (
        response.order_id !== undefined &&
        response.order_id !== row.provider_order_id
      )
        throw new TablePaymentError("Bank sifarişi uyğun deyil.", 400);
      if (
        (response.currency !== undefined && response.currency !== "AZN") ||
        providerAmount(response.amount) !== Number(row.amount_minor) ||
        (response.operation_code !== undefined &&
          String(response.operation_code) !== "100")
      )
        throw new TablePaymentError(
          "Ödəniş məbləği və ya valyuta uyğun deyil.",
          400,
        );
      const result = String(response.status);
      if (!["success", "failed", "error", "returned"].includes(result)) return;
      // A return or success after released failure needs an operator. Never silently
      // reverse restaurant stock or charge a guest again to repair an ambiguous result.
      let status =
        result === "returned"
          ? "review"
          : result === "success"
            ? row.status === "failed"
              ? "review"
              : "paid"
            : "failed";
      if (
        row.status === "review" ||
        (row.status === "applied" && result !== "returned") ||
        (row.status === "paid" && result !== "returned")
      )
        return;
      await tx.execute(
        sql`UPDATE restaurant_table_payments SET status=${status},provider_transaction=${response.transaction},provider_result=${JSON.stringify(safeGatewayResponse(response))}::jsonb,updated_at=now() WHERE id=${id}::uuid`,
      );
      await tx.execute(
        sql`INSERT INTO restaurant_payment_events(id,payment_id,event,details) VALUES(${randomUUID()}::uuid,${id}::uuid,${fromStatus ? "provider.status" : "provider.callback"},${JSON.stringify({ before: row.status, after: status, transaction: response.transaction })}::jsonb)`,
      );
    });
  }
  async callback(merchantId: string, data: unknown, signature: unknown) {
    const [m] = await query<any>(
      this.db,
      sql`SELECT * FROM restaurant_payment_merchants WHERE id=${merchantId}::uuid`,
    );
    if (!m) throw new TablePaymentError("Ödəniş hesabı tapılmadı.", 404);
    const response = verifyCallback(
      data,
      signature,
      unseal(m.private_cipher, m.customer_id, "merchant"),
    );
    if (
      response.public_key !== undefined &&
      response.public_key !== m.public_key
    )
      throw new TablePaymentError("Merchant uyğun deyil.", 400);
    if (
      typeof response.order_id !== "string" ||
      typeof response.transaction !== "string" ||
      !["success", "failed", "error", "returned"].includes(
        String(response.status),
      )
    )
      throw new TablePaymentError("Ödəniş nəticəsi düzgün deyil.", 400);
    const [r] = await query<any>(
      this.db,
      sql`SELECT i.id FROM restaurant_table_payments i JOIN restaurant_payment_bills b ON b.id=i.bill_id WHERE i.provider_order_id=${response.order_id} AND b.merchant_id=${merchantId}::uuid`,
    );
    if (!r) throw new TablePaymentError("Ödəniş tapılmadı.", 404);
    await this.recordResult(r.id, response);
    void this.advance(r.id).catch(() => {});
    return { ok: true };
  }
  async adminCheck(customerId: string, id: string, transaction?: string) {
    const r = await this.record(id);
    if (!r || r.customer_id !== customerId)
      throw new TablePaymentError("Ödəniş tapılmadı.", 404);
    if (r.status === "review")
      throw new TablePaymentError(
        "Bu nəticəni restoranın Epoint kabinetində ayrıca araşdırın.",
      );
    if (transaction && !r.provider_transaction) {
      if (r.status !== "unknown" || !/^[A-Za-z0-9_-]{1,120}$/.test(transaction))
        throw new TablePaymentError("Bank nömrəsini yoxlayın.", 400);
      const result = await (
        await this.gateway(r)
      ).call("get-status", { transaction });
      // Manually linked references must echo the exact order. Amount alone is
      // insufficient: two diners can pay equal amounts at the same restaurant.
      if (
        result.order_id !== r.provider_order_id ||
        result.transaction !== transaction
      )
        throw new TablePaymentError(
          "Bu bank əməliyyatı həmin sifarişə aid deyil.",
          400,
        );
      await this.recordResult(id, result, true);
    } else await this.reconcile(id);
    await this.advance(id);
    return { ok: true };
  }
  async reconcile(id: string) {
    const r = await this.record(id);
    if (
      !r ||
      !["pending", "unknown"].includes(r.status) ||
      !r.provider_transaction
    )
      return;
    try {
      const gateway = await this.gateway(r),
        result = await gateway.call("get-status", {
          transaction: r.provider_transaction,
        });
      // This response came from the gateway over TLS with our merchant credentials.
      await this.recordResult(
        id,
        {
          ...result,
          transaction: result.transaction ?? r.provider_transaction,
        },
        true,
      );
    } catch {
      /* Keep the reservation. A network failure is not a declined payment. */
    }
    await this.db.execute(
      sql`UPDATE restaurant_table_payments SET updated_at=now() WHERE id=${id}::uuid`,
    );
    await this.advance(id);
  }
  async posView(customerId: string, deviceId: string, sessionId: string) {
    const [b] = await query<any>(
      this.db,
      sql`SELECT * FROM restaurant_payment_bills WHERE customer_id=${customerId}::uuid AND device_id=${deviceId}::uuid AND pos_session_id=${sessionId}`,
    );
    if (!b) throw new TablePaymentError("Masa hesabı tapılmadı.", 404);
    return this.view(this.token(b));
  }
  async stop(customer: string, device: string, sessionId: string) {
    return this.db.transaction(async (tx: any) => {
      const [b] = await query<any>(
        tx,
        sql`SELECT * FROM restaurant_payment_bills WHERE customer_id=${customer}::uuid AND device_id=${device}::uuid AND pos_session_id=${sessionId} FOR UPDATE`,
      );
      if (!b) return { stopped: true };
      const active = (await this.rows(b.id, tx)).some(
        (r) => !["applied", "failed"].includes(r.status),
      );
      if (active)
        throw new TablePaymentError(
          "Bankda gözləyən ödəniş var. Əvvəl nəticəni yoxlayın.",
        );
      await tx.execute(
        sql`UPDATE restaurant_payment_bills SET state='cancelled' WHERE id=${b.id}::uuid AND state='open'`,
      );
      return { stopped: true };
    });
  }
  async sweep() {
    await this.db.execute(
      sql`UPDATE restaurant_table_payments SET status='unknown',error='Bank əməliyyatını araşdırın; təkrar ödəniş yaratmayın.',updated_at=now() WHERE status='creating' AND updated_at<now()-interval '2 minutes'`,
    );
    const rows = await query<any>(
      this.db,
      sql`SELECT id,status FROM restaurant_table_payments WHERE status IN('reserving','paid') OR status='failed' AND native_released_at IS NULL OR status IN('pending','unknown') AND provider_transaction IS NOT NULL AND updated_at<now()-interval '30 seconds' ORDER BY updated_at LIMIT 8`,
    );
    // Rotate unavailable tills as well: one offline restaurant must not starve
    // settlement for other restaurants. Bound concurrent native RPCs to four.
    for (let offset = 0; offset < rows.length; offset += 4) {
      await Promise.allSettled(
        rows.slice(offset, offset + 4).map(async (r) => {
          await this.db.execute(
            sql`UPDATE restaurant_table_payments SET updated_at=now() WHERE id=${r.id}::uuid`,
          );
          if (["pending", "unknown"].includes(r.status))
            await this.reconcile(r.id);
          else await this.advance(r.id);
        }),
      );
    }
  }
}
