const test = require("node:test"),
  assert = require("node:assert/strict"),
  create = require("./runtime.cjs");
const fake = () => {
  const calls = [],
    scope = {
      login: { customerId: "owner", token: "private-login" },
      device: { deviceId: "till", baseUrl: "https://possistem.az/pos/api" },
    };
  const api = create({
    identity: async () => scope.device,
    owner: () => scope.login,
    isTerminal: () => false,
    admin: async () => ({ id: "admin" }),
    invoke: async (method, payload, opts) => {
      calls.push({ method, payload, opts });
      return {
        success: true,
        data:
          method === "qrPay.begin"
            ? {
                sessionId: "session",
                secret: "do-not-return-secret",
                snapshot: { tableLabel: "Masa 1" },
              }
            : { applied: true },
      };
    },
  });
  return { api, calls, scope };
};
test("private session secret reaches only backend; renderer receives QR and public id", async () => {
  const f = fake(),
    old = global.fetch;
  global.fetch = async (url, init) => {
    const b = JSON.parse(init.body);
    if (url.endsWith("/ready")) return new Response('{"available":true}');
    assert.equal(b.secret, "do-not-return-secret");
    assert.equal(init.headers.authorization, "Bearer private-login");
    return new Response(
      '{"url":"https://possistem.az/qr/hesab/public/","billId":"id","qr":"data:image/png;base64,test"}',
    );
  };
  try {
    const r = await f.api.handle("qr.payments.open", { orderId: "order" });
    assert.equal(r.success, true);
    assert.equal(JSON.stringify(r).includes("do-not-return-secret"), false);
    assert.equal(r.data.sessionId, "session");
    assert.equal(f.calls.length, 1);
  } finally {
    global.fetch = old;
  }
});
test("disabled merchant does not lock a native bill", async () => {
  const f = fake(),
    old = global.fetch;
  global.fetch = async () =>
    new Response('{"available":false,"reason":"not configured"}');
  try {
    assert.equal(
      (await f.api.handle("qr.payments.open", { orderId: "order" })).success,
      false,
    );
    assert.equal(f.calls.length, 0);
  } finally {
    global.fetch = old;
  }
});
test("network failure after server open never unlocks a potentially payable bill", async () => {
  const f = fake(),
    old = global.fetch;
  global.fetch = async (url) => {
    if (url.endsWith("/ready")) return new Response('{"available":true}');
    throw Error("network");
  };
  try {
    assert.equal(
      (await f.api.handle("qr.payments.open", { orderId: "order" })).success,
      false,
    );
    assert.deepEqual(
      f.calls.map((c) => c.method),
      ["qrPay.begin"],
    );
  } finally {
    global.fetch = old;
  }
});
test("signed command is scoped and allowlisted; arbitrary SQL and IPC cannot execute", async () => {
  const f = fake(),
    cmd = { id: "command" },
    base = {
      customerId: "owner",
      deviceId: "till",
      cloudExpiresAt: Date.now() + 20000,
      action: "hold",
      payload: { intentId: "intent" },
    };
  for (const patch of [
    { customerId: "other" },
    { deviceId: "other" },
    { cloudExpiresAt: 0 },
    { action: "settings.set" },
    { action: "sql" },
  ])
    assert.equal((await f.api.run(cmd, { ...base, ...patch })).ok, false);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.api.run(cmd, base)).ok, true);
  assert.equal(f.calls[0].method, "qrPay.hold");
});
test("failed server stop leaves native hold in place", async () => {
  const f = fake(),
    old = global.fetch;
  global.fetch = async () =>
    new Response('{"error":"pending bank"}', { status: 409 });
  try {
    assert.equal(
      (await f.api.handle("qr.payments.stop", { sessionId: "session" }))
        .success,
      false,
    );
    assert.equal(f.calls.length, 0);
  } finally {
    global.fetch = old;
  }
});

test("saving the restaurant's Epoint keys needs settings.manage and never echoes the private key", async () => {
  const f = fake(),
    old = global.fetch,
    sent = [];
  global.fetch = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body) });
    return new Response('{"id":"m1","callbackUrl":"https://possistem.az/pos/api/billing/table/epoint/callback/m1"}');
  };
  try {
    const r = await f.api.handle("qr.payments.saveMerchant", { publicKey: " i123456 ", privateKey: "secret-key", managerPin: "1234" });
    assert.equal(r.success, true);
    assert.equal(JSON.stringify(r).includes("secret-key"), false);
    assert.deepEqual(f.calls[0].method, "auth.verifyManagerPin");
    assert.equal(f.calls[0].payload.permission, "settings.manage");
    assert.ok(sent[0].url.endsWith("/qr/device/payments/merchant/save"));
    assert.deepEqual(sent[0].body, { publicKey: "i123456", active: true, privateKey: "secret-key", deviceId: "till" });
  } finally {
    global.fetch = old;
  }
});
test("a refused manager check sends nothing to the server", async () => {
  const f = fake(),
    old = global.fetch;
  let fetched = 0;
  global.fetch = async () => { fetched++; return new Response("{}"); };
  const api = require("./runtime.cjs")({
    identity: async () => f.scope.device, owner: () => f.scope.login, isTerminal: () => false, admin: async () => null,
    invoke: async () => ({ success: false, error: { code: "E_MANAGER_APPROVAL_REQUIRED", message: "Menecer təsdiqi lazımdır" } }),
  });
  try {
    const r = await api.handle("qr.payments.saveMerchant", { publicKey: "i123456", privateKey: "k" });
    assert.equal(r.success, false);
    assert.equal(fetched, 0);
  } finally {
    global.fetch = old;
  }
});
