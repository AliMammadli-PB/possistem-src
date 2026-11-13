import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import Fastify from "fastify";
import { createDb } from "@milioner/database";
import { sql } from "drizzle-orm";
import { TablePayments, seal, unseal } from "../lib/table-payments/service.js";
import { sign } from "../lib/billing/epoint.js";
import { tablePaymentRoutes } from "./table-payments.js";
import { env } from "../env.js";
const url = process.env.TABLE_PAYMENT_TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.includes("qr_test"))
  throw Error("Use an isolated qr_test database");
const db = createDb(url),
  app = Fastify(),
  owner = randomUUID(),
  other = randomUUID(),
  device = randomUUID(),
  license = randomUUID(),
  admin = randomUUID();
const key = "isolated-merchant-private-key",
  publicKey = "i123456789",
  merchant = randomUUID();
let enabled = true,
  offline = false,
  uncertain = false,
  declined = false,
  applies = 0,
  requests = 0,
  lastRequest: any,
  statusResult: any = null,
  denied = false;
const attempted: string[] = [];
const sessions = new Map<string, string>(),
  holds = new Map<string, { amount: number; applied: boolean; txn?: string }>();
const payments = new TablePayments(
  db,
  async (cid, did, action, p) => {
    assert.equal(cid, owner);
    assert.equal(did, device);
    attempted.push(String(p.intentId));
    if (offline) throw Error("offline");
    if (denied)
      throw Object.assign(Error("native rejected"), { definitive: true });
    const secret = sessions.get(String(p.sessionId));
    assert.ok(secret);
    assert.equal(
      p.signature,
      createHmac("sha256", Buffer.from(secret, "hex"))
        .update(
          [
            action,
            p.sessionId,
            p.intentId,
            p.amountMinor,
            p.transaction,
            p.rrn,
            p.expiresAt,
          ].join("|"),
        )
        .digest("hex"),
    );
    const id = String(p.intentId),
      h = holds.get(id);
    if (action === "hold") {
      if (h) assert.equal(h.amount, p.amountMinor);
      else holds.set(id, { amount: Number(p.amountMinor), applied: false });
      return { held: true };
    }
    if (action === "release") {
      assert.ok(!h?.applied);
      holds.delete(id);
      return { released: true };
    }
    if (action === "apply") {
      assert.ok(h);
      if (!h.applied) {
        h.applied = true;
        h.txn = String(p.transaction);
        applies++;
      } else assert.equal(h.txn, p.transaction);
      return { applied: true, paymentId: "native-" + id };
    }
    throw Error("bad action");
  },
  {
    enabled: () => enabled,
    transport: async (url: any, init: any) => {
      const form = new URLSearchParams(String(init.body)),
        data = form.get("data")!;
      assert.equal(form.get("signature"), sign(data, key));
      const b = JSON.parse(Buffer.from(data, "base64").toString());
      assert.equal(b.public_key, publicKey);
      if (String(url).endsWith("/get-status"))
        return new Response(
          JSON.stringify(
            statusResult ?? { status: "new", transaction: b.transaction },
          ),
          { status: 200 },
        );
      requests++;
      lastRequest = b;
      if (uncertain) throw Error("provider network lost");
      return new Response(
        JSON.stringify(
          declined
            ? { status: "error", message: "declined" }
            : {
                status: "success",
                transaction: "tx-" + randomUUID(),
                redirect_url: "https://epoint.az/pay/" + randomUUID(),
              },
        ),
        { status: 200 },
      );
    },
  },
);
app.decorate("db", db);
app.decorateRequest("user", null);
app.addHook("preHandler", async (req) => {
  if (req.headers["x-admin"] === "superadmin")
    req.user = {
      id: admin,
      email: "admin@example.invalid",
      role: "superadmin",
      mustChangePassword: false,
      active: true,
    };
  else if (req.headers["x-admin"] === "operator")
    req.user = {
      id: admin,
      email: "op@example.invalid",
      role: "admin",
      mustChangePassword: false,
      active: true,
    } as any;
});
before(async () => {
  await db.$client.unsafe(
    "CREATE TABLE customers(id uuid PRIMARY KEY,name text,active boolean DEFAULT true);CREATE TABLE licenses(id uuid PRIMARY KEY,customer_id uuid REFERENCES customers(id),status text DEFAULT 'active',plan text DEFAULT 'standard',features jsonb DEFAULT '{}',valid_until timestamptz DEFAULT now()+interval '1 day');CREATE TABLE devices(id uuid PRIMARY KEY,license_id uuid REFERENCES licenses(id),status text DEFAULT 'active');",
  );
  await db.$client.unsafe(
    readFileSync(
      new URL(
        "../../../../migrations/0061_restaurant_table_payments.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await app.register(tablePaymentRoutes, {
    payments,
    worker: false,
    audit: async () => {},
  });
});
beforeEach(async () => {
  await db.$client.unsafe("TRUNCATE customers CASCADE");
  await db.$client`INSERT INTO customers(id,name) VALUES(${owner},'Restaurant A'),(${other},'Restaurant B')`;
  await db.$client`INSERT INTO licenses(id,customer_id) VALUES(${license},${owner})`;
  await db.$client`INSERT INTO devices(id,license_id) VALUES(${device},${license})`;
  await db.$client`INSERT INTO restaurant_payment_merchants(id,customer_id,public_key,private_cipher,verified,created_by) VALUES(${merchant},${owner},${publicKey},${seal(key, owner, "merchant")},true,${admin})`;
  enabled = true;
  offline = uncertain = declined = denied = false;
  applies = requests = 0;
  lastRequest = statusResult = null;
  attempted.length = 0;
  sessions.clear();
  holds.clear();
});
after(async () => {
  await app.close();
  await db.$client.end();
});
function token(cid = owner, client = "restaurant") {
  const body = Buffer.from(
    JSON.stringify({
      customerId: cid,
      email: "qa@example.invalid",
      client,
      exp: Date.now() + 60_000,
      iat: Date.now(),
      jti: randomUUID(),
    }),
  ).toString("base64url");
  return (
    "t1." +
    body +
    "." +
    createHmac("sha256", env.sessionSecret).update(body).digest("base64url")
  );
}
const api = (method: any, path: string, body?: any, headers: any = {}) =>
  app.inject({
    method,
    url: path,
    ...(body !== undefined ? { payload: body } : {}),
    headers,
  });
async function open(total = 1001) {
  const sid = randomUUID(),
    secret = randomBytes(32).toString("hex");
  sessions.set(sid, secret);
  const snapshot = {
    orderId: randomUUID(),
    orderNumber: "0001",
    tableId: "table-1",
    tableLabel: "Masa 1",
    revision: "a".repeat(64),
    totalMinor: total,
    paidMinor: 0,
    lines: [
      { id: "pizza", name: "Pizza", quantityMilli: 2000, amountMinor: 801 },
      { id: "cola", name: "Kola", quantityMilli: 1000, amountMinor: 200 },
    ],
  };
  const r = await api(
    "POST",
    "/qr/device/payments/open",
    { deviceId: device, sessionId: sid, secret, snapshot },
    { authorization: "Bearer " + token() },
  );
  assert.equal(r.statusCode, 200, r.body);
  assert.match(r.json().qr, /^data:image\/png;base64,/);
  assert.equal(r.body.includes(secret), false);
  return {
    token: new URL(r.json().url).pathname.split("/")[3]!,
    id: r.json().billId,
    sid,
    secret,
    snapshot,
  };
}
async function checkout(b: any, selection: any, requestId = randomUUID()) {
  const q = await payments.preview(b.token, selection);
  const r = await api("POST", "/billing/table/" + b.token + "/checkout", {
    requestId,
    selection,
    expectedAmountMinor: q.amountMinor,
  });
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
async function callback(b: any, p: any, patch: any = {}, secret = key) {
  const row = (
    await db.$client`SELECT * FROM restaurant_table_payments WHERE id=${p.id}`
  )[0];
  const result = {
    order_id: row.provider_order_id,
    transaction: row.provider_transaction || "late-" + p.id,
    status: "success",
    amount: (Number(row.amount_minor) / 100).toFixed(2),
    currency: "AZN",
    operation_code: "100",
    ...patch,
  };
  const data = Buffer.from(JSON.stringify(result)).toString("base64");
  return api("POST", "/billing/table/epoint/callback/" + merchant, {
    data,
    signature: sign(data, secret),
  });
}

test("only superadmin configures encrypted per-restaurant keys, secrets never returned", async () => {
  for (const h of [{}, { "x-admin": "operator" }])
    assert.ok(
      [401, 403].includes(
        (
          await api(
            "POST",
            "/admin/restaurant-payments/" + owner,
            { publicKey, privateKey: key },
            h,
          )
        ).statusCode,
      ),
    );
  const r = await api(
    "POST",
    "/admin/restaurant-payments/" + owner,
    { publicKey, privateKey: key, verified: false },
    { "x-admin": "superadmin" },
  );
  assert.equal(r.statusCode, 200, r.body);
  const row = (
    await db.$client`SELECT * FROM restaurant_payment_merchants WHERE id=${r.json().id}`
  )[0];
  assert.notEqual(row.private_cipher, key);
  assert.equal(unseal(row.private_cipher, owner, "merchant"), key);
  assert.throws(() => unseal(row.private_cipher, other, "merchant"));
  const get = await api(
    "GET",
    "/admin/restaurant-payments/" + owner,
    undefined,
    { "x-admin": "superadmin" },
  );
  assert.equal(get.body.includes(key), false);
  assert.equal(get.body.includes(row.private_cipher), false);
});
test("device bearer, customer, active license and feature gate required before opening", async () => {
  for (const who of [other])
    assert.equal(
      (
        await api(
          "POST",
          "/qr/device/payments/ready",
          { deviceId: device },
          { authorization: "Bearer " + token(who) },
        )
      ).statusCode,
      403,
    );
  assert.equal(
    (await api("POST", "/qr/device/payments/ready", { deviceId: device }))
      .statusCode,
    401,
  );
  assert.equal(
    (
      await api(
        "POST",
        "/qr/device/payments/ready",
        { deviceId: device },
        { authorization: "Bearer " + token(owner, "billing") },
      )
    ).statusCode,
    401,
  );
  await db.$client`UPDATE licenses SET status='revoked'`;
  assert.equal(
    (
      await api(
        "POST",
        "/qr/device/payments/ready",
        { deviceId: device },
        { authorization: "Bearer " + token() },
      )
    ).statusCode,
    403,
  );
  await db.$client`UPDATE licenses SET status='active'`;
  enabled = false;
  await assert.rejects(() => open());
  assert.equal(requests, 0);
});
test("all three diners pay fixed shares concurrently; callback replay applies once", async () => {
  const b = await open();
  const ps = await Promise.all(
    [0, 1, 2].map((part) => checkout(b, { mode: "equal", parts: 3, part })),
  );
  assert.equal(
    ps.reduce((n, p) => n + p.amountMinor, 0),
    1001,
  );
  assert.equal(requests, 3);
  for (const p of ps) {
    assert.equal((await callback(b, p)).statusCode, 200);
    await payments.advance(p.id);
  }
  for (const p of ps) {
    assert.equal((await callback(b, p)).statusCode, 200);
    await payments.advance(p.id);
  }
  assert.equal(applies, 3);
  assert.equal((await payments.view(b.token)).state, "closed");
  assert.equal((await payments.view(b.token)).paidMinor, 1001);
});
test("concurrent same share is reserved once and repeated request creates one bank transaction", async () => {
  const b = await open(),
    s = { mode: "equal", parts: 2, part: 0 } as const,
    q = await payments.preview(b.token, s),
    rids = [randomUUID(), randomUUID()];
  const rs = await Promise.all(
    rids.map((requestId) =>
      api("POST", "/billing/table/" + b.token + "/checkout", {
        requestId,
        selection: s,
        expectedAmountMinor: q.amountMinor,
      }),
    ),
  );
  assert.deepEqual(rs.map((r) => r.statusCode).sort(), [200, 409]);
  assert.equal(requests, 1);
  const winner = rs.findIndex((r) => r.statusCode === 200);
  const replay = await api("POST", "/billing/table/" + b.token + "/checkout", {
    requestId: rids[winner],
    selection: s,
    expectedAmountMinor: q.amountMinor,
  });
  assert.equal(replay.json().id, rs[winner].json().id);
  assert.equal(requests, 1);
});
test("item allocation cannot be bought twice or moved to another table", async () => {
  const b = await open(),
    a = await checkout(b, {
      mode: "items",
      items: [{ lineId: "pizza", quantityMilli: 1000 }],
    });
  assert.equal(a.amountMinor, 400);
  const c = await checkout(b, {
    mode: "items",
    items: [{ lineId: "pizza", quantityMilli: 1000 }],
  });
  assert.equal(c.amountMinor, 401);
  await assert.rejects(() =>
    payments.preview(b.token, {
      mode: "items",
      items: [{ lineId: "pizza", quantityMilli: 1000 }],
    }),
  );
  const foreign = await open();
  assert.equal(
    (await api("GET", "/billing/table/" + foreign.token + "/payments/" + a.id))
      .statusCode,
    404,
  );
});
test("forged callback, wrong amount, transaction, operation, currency and merchant rejected", async () => {
  const b = await open(),
    p = await checkout(b, { mode: "all" });
  for (const patch of [
    { amount: "9.99" },
    { currency: "USD" },
    { transaction: "foreign" },
    { operation_code: "001" },
  ])
    assert.equal((await callback(b, p, patch)).statusCode, 400);
  assert.equal((await callback(b, p, {}, "wrong-key")).statusCode, 400);
  const fake = b.token.slice(0, -1) + (b.token.endsWith("A") ? "B" : "A");
  assert.equal((await api("GET", "/billing/table/" + fake)).statusCode, 404);
  assert.equal(applies, 0);
});
test("provider uncertainty is never recharged, late success is reconciled after POS reconnect", async () => {
  const b = await open();
  uncertain = true;
  const id = randomUUID(),
    q = await payments.preview(b.token, { mode: "all" });
  const p = await payments.checkout(
    b.token,
    id,
    { mode: "all" },
    q.amountMinor,
  );
  assert.equal(p.status, "unknown");
  uncertain = false;
  await payments.checkout(b.token, id, { mode: "all" }, q.amountMinor);
  assert.equal(requests, 1);
  await assert.rejects(() => payments.preview(b.token, { mode: "all" }));
  offline = true;
  assert.equal((await callback(b, p)).statusCode, 200);
  await payments.advance(p.id);
  assert.equal((await payments.intentView(b.token, p.id)).status, "paid");
  offline = false;
  await new TablePayments(db, payments.till, payments.options).advance(p.id);
  assert.equal(applies, 1);
  assert.equal((await payments.intentView(b.token, p.id)).status, "applied");
});
test("known transaction status recovers without callbacks; no automatic retry charge", async () => {
  const b = await open(),
    p = await checkout(b, { mode: "all" }),
    r = await payments.record(p.id);
  statusResult = {
    status: "success",
    transaction: r.provider_transaction,
    order_id: r.provider_order_id,
    amount: "10.01",
    currency: "AZN",
    operation_code: "100",
  };
  await payments.reconcile(p.id);
  assert.equal((await payments.intentView(b.token, p.id)).status, "applied");
  assert.equal(applies, 1);
  assert.equal(requests, 1);
});
test("failed gateway request releases native hold; stop or expiry never releases uncertain money", async () => {
  const b = await open();
  declined = true;
  const p = await checkout(b, { mode: "all" });
  await payments.advance(p.id);
  assert.equal(p.status, "failed");
  assert.equal(holds.size, 0);
  declined = false;
  uncertain = true;
  await checkout(b, { mode: "all" });
  await assert.rejects(() => payments.stop(owner, device, b.sid));
  await db.$client`UPDATE restaurant_payment_bills SET expires_at=now()-interval '1 minute' WHERE id=${b.id}`;
  await payments.sweep();
  assert.equal(holds.size, 1);
  assert.equal(
    (await api("POST", "/billing/table/" + b.token + "/quote", { mode: "all" }))
      .statusCode,
    410,
  );
});
test("restaurant key rotation rejects new checkout on old bill but verifies old callback", async () => {
  const b = await open(),
    p = await checkout(b, { mode: "equal", parts: 2, part: 0 });
  await api(
    "POST",
    "/admin/restaurant-payments/" + owner,
    { publicKey, privateKey: "rotated-private-key", verified: true },
    { "x-admin": "superadmin" },
  );
  const q = await payments.preview(b.token, { mode: "all" });
  assert.equal(
    (
      await api("POST", "/billing/table/" + b.token + "/checkout", {
        requestId: randomUUID(),
        selection: { mode: "all" },
        expectedAmountMinor: q.amountMinor,
      })
    ).statusCode,
    409,
  );
  assert.equal((await callback(b, p)).statusCode, 200);
  await payments.advance(p.id);
  assert.equal(applies, 1);
});
test("native refusal never starts bank call; changed preview amount requires new consent", async () => {
  const b = await open();
  denied = true;
  const p = await checkout(b, { mode: "all" });
  assert.equal((await payments.intentView(b.token, p.id)).status, "failed");
  assert.equal(requests, 0);
  denied = false;
  assert.equal(
    (
      await api("POST", "/billing/table/" + b.token + "/checkout", {
        requestId: randomUUID(),
        selection: { mode: "all" },
        expectedAmountMinor: 1,
      })
    ).statusCode,
    409,
  );
  assert.equal(requests, 0);
});
test("new bill and status responses contain no credential or local secret", async () => {
  const b = await open(),
    view = await api("GET", "/billing/table/" + b.token);
  for (const secret of [key, b.secret])
    assert.equal(view.body.includes(secret), false);
  assert.match(String(view.headers["cache-control"]), /no-store/);
  const p = await checkout(b, { mode: "all" });
  assert.equal(lastRequest.public_key, publicKey);
  assert.match(lastRequest.result_url, new RegExp(merchant));
  assert.equal(
    (
      await api("GET", "/billing/table/" + b.token + "/payments/" + p.id)
    ).body.includes(key),
    false,
  );
});

test("offline settlement rotates fairly instead of starving later diners", async () => {
  const b = await open();
  offline = true;
  for (let i = 0; i < 24; i++) {
    const id = randomUUID();
    await db.$client`INSERT INTO restaurant_table_payments(id,bill_id,request_id,fingerprint,selection,allocations,amount_minor,status,provider_order_id,provider_transaction,updated_at) VALUES(${id},${b.id},${randomUUID()},'qa','{"mode":"all"}','[]',1,'paid',${"qa-" + id},${"tx-" + id},now()-interval '1 day')`;
  }
  await payments.sweep();
  await payments.sweep();
  assert.equal(new Set(attempted).size, 16);
});
