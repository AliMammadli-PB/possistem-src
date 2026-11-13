"use strict";
const ALLOWED_ACTIONS = new Set(["hold", "apply", "release"]);
// No private native method is exported by preload. These methods run only in
// main, where the signed cloud command has already passed signature checking.
module.exports = function ({ invoke, identity, owner, isTerminal, admin }) {
  async function context() {
    const login = owner(),
      device = await identity();
    if (
      isTerminal() ||
      !login?.token ||
      !login?.customerId ||
      !device?.deviceId
    )
      throw Error("QR ödənişi restoran hesabına bağlı əsas kassada açın.");
    return { login, device };
  }
  async function cloud(path, payload, scope) {
    const now = await context();
    if (
      now.login.customerId !== scope.login.customerId ||
      now.device.deviceId !== scope.device.deviceId
    )
      throw Error("Hesab dəyişib. Əməliyyatı yenidən açın.");
    const response = await fetch(
      scope.device.baseUrl.replace(/\/+$/, "") + "/qr/device/payments/" + path,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer " + scope.login.token,
        },
        body: JSON.stringify({ ...payload, deviceId: scope.device.deviceId }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    const data = await response.json();
    if (!response.ok)
      throw Error(data.error || "QR ödəniş xidməti cavab vermədi.");
    return data;
  }
  async function native(method, payload, actor) {
    const r = await invoke(method, payload, {
      timeoutMs: 20_000,
      ...(actor ? { actor: { userId: actor } } : {}),
    });
    if (!r?.success) {
      const e = Error(r?.error?.message || "Kassa cavab vermədi.");
      e.code = r?.error?.code;
      throw e;
    }
    return r.data;
  }
  async function handle(method, payload = {}) {
    try {
      const scope = await context();
      if (method === "qr.payments.ready")
        return { success: true, data: await cloud("ready", {}, scope) };
      if (method === "qr.payments.open") {
        const ready = await cloud("ready", {}, scope);
        if (!ready.available)
          throw Error(ready.reason || "Restoranın Epoint hesabını qoşun.");
        const opened = await native("qrPay.begin", {
          orderId: payload.orderId,
        });
        // A network failure may have happened after the server created the bill.
        // Keep the native lock and reopen with the same session; never silently
        // unlock a bill that a guest might already be paying.
        const result = await cloud("open", opened, scope);
        return {
          success: true,
          data: {
            ...result,
            sessionId: opened.sessionId,
            tableLabel: opened.snapshot.tableLabel,
          },
        };
      }
      if (method === "qr.payments.stop") {
        const sessionId =
          payload.sessionId ||
          (await native("qrPay.inspect", { orderId: payload.orderId }))
            .sessionId;
        if (!sessionId) return { success: true, data: { stopped: true } };
        await cloud("stop", { sessionId }, scope);
        return {
          success: true,
          data: await native("qrPay.stop", { sessionId }),
        };
      }
      if (method === "qr.payments.status")
        return {
          success: true,
          data: await cloud("status", { sessionId: payload.sessionId }, scope),
        };
      throw Error("QR ödəniş əməliyyatı tanınmadı.");
    } catch (e) {
      return {
        success: false,
        error: {
          code: e.code || "E_QR_PAYMENT",
          message: e.message || "QR ödənişi açılmadı.",
          retryable: false,
        },
      };
    }
  }
  async function run(command, args) {
    try {
      const scope = await context();
      if (
        args.customerId !== scope.login.customerId ||
        args.deviceId !== scope.device.deviceId ||
        !Number.isFinite(args.cloudExpiresAt) ||
        args.cloudExpiresAt < Date.now()
      )
        throw Error("Ödəniş sorğusunun kassası və ya vaxtı uyğun deyil.");
      if (!ALLOWED_ACTIONS.has(args.action))
        throw Error("Bu QR əməliyyatı qadağandır.");
      const actor = await admin();
      const result = await native(
        "qrPay." + args.action,
        args.payload,
        actor?.id,
      );
      return { commandId: command.id, ok: true, result };
    } catch (e) {
      return {
        commandId: command.id,
        ok: false,
        error: e.message || "QR ödənişi tətbiq edilmədi.",
        errorCode: e.code || "E_QR_PAYMENT",
      };
    }
  }
  return { handle, run };
};
