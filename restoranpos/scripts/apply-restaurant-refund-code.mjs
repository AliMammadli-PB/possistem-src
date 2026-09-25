#!/usr/bin/env node
/**
 * Refunding a guest who has already left, from the code on their receipt.
 *
 * The refund engine itself has been complete for a long time: per-line amounts
 * priced from the order's own snapshot so a menu change cannot alter what goes
 * back, manager approval, idempotency so a double press never pays twice, and a
 * cash_movements row so the drawer's log matches the drawer. None of that was
 * reachable from the counter. `payments.refund` takes a paymentId, and the only
 * screen that knows one is the payment panel of an order still open on a table.
 * Once the table is cleared - which is to say, once the guest has left - there
 * was no way back to that sale at all.
 *
 * What the guest has is the printed receipt. It already carried a number and
 * the time it was paid; the core now labels that number as the refund code and
 * can look a sale up by it. This is the screen that asks for it.
 *
 * Shape of the screen follows the counter, not the database: type the code,
 * see what was sold and what is still returnable, tick the dish being disputed
 * (or type an amount), say why, manager PIN, done - then the slip prints.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const PRELOAD = path.join(ROOT, 'out/preload/index.js');
const MARK = '/* POS_REFUND_CODE_v1 */';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function replaceOnce(src, find, repl, label) {
  const hits = src.split(find).length - 1;
  must(hits === 1, `${label}: expected 1 match, found ${hits}`);
  return src.replace(find, repl);
}

// --- the bridge -----------------------------------------------------------
{
  let preload = fs.readFileSync(PRELOAD, 'utf8');
  if (preload.includes('lookupByCode')) {
    console.log('preload already applied');
  } else {
    preload = replaceOnce(
      preload,
      '    get: (receiptId) => call("receipts.get", { receiptId })',
      `    get: (receiptId) => call("receipts.get", { receiptId }),
    /**
     * The sale behind the code printed on a guest's receipt.
     *
     * Answers what is still refundable per payment and per line, so the
     * counter can decide without a second round trip.
     */
    lookupByCode: (code) => call("receipts.lookupByCode", { code })`,
      'receipts bridge',
    );
    fs.writeFileSync(PRELOAD, preload);
    console.log('  + preload: receipts.lookupByCode');
  }
  const finalPreload = fs.readFileSync(PRELOAD, 'utf8');
  must(finalPreload.includes('receipts.lookupByCode'), 'the bridge did not land');
}

// --- the screen -----------------------------------------------------------
let s = fs.readFileSync(BUNDLE, 'utf8');
if (s.includes(MARK)) {
  console.log('bundle already applied');
  process.exit(0);
}

// Helpers this screen leans on. A missing one is a ReferenceError at render
// that no syntax check would catch, so each is checked the way it is written.
for (const helper of ['function OpsField(', 'function OpsButton(', 'function useOpsAction(',
                      'function formatMoney(', 'function psAdminText(',
                      'function toast(', 'const useAuthStore']) {
  must(s.includes(helper), `${helper} is not in the bundle`);
}

const PAGE = String.raw`function RefundByCodePage() {
  const [code, setCode] = reactExports.useState("");
  const [found, setFound] = reactExports.useState(null);
  const [paymentId, setPaymentId] = reactExports.useState("");
  const [picked, setPicked] = reactExports.useState({});
  const [amountInput, setAmountInput] = reactExports.useState("");
  const [reason, setReason] = reactExports.useState("");
  const [pin, setPin] = reactExports.useState("");
  const [busy, setBusy] = reactExports.useState(false);
  // Held for as long as one refund is being filled in. A refund that reached
  // the core but lost its reply must replay on the next press rather than pay
  // the guest a second time; the core recognises the repeated key.
  const idemRef = reactExports.useRef("");

  const reset = () => {
    setFound(null); setPaymentId(""); setPicked({});
    setAmountInput(""); setReason(""); setPin(""); idemRef.current = "";
  };

  const lookup = async () => {
    const typed = code.trim();
    if (typed.length < 4) { toast("Qəbz kodunu daxil edin", "warning"); return; }
    setBusy(true);
    try {
      const res = await window.pos.receipts.lookupByCode(typed);
      if (!res.success) {
        toast(res.error?.message || "Çek tapılmadı", "danger");
        setFound(null);
        return;
      }
      const data = res.data;
      setFound(data);
      setPicked({});
      setReason("");
      setPin("");
      idemRef.current = "refund-" + data.receiptId + "-" + Date.now();
      // One tender is the ordinary case; preselecting it removes a step that
      // would only ever have one answer. A split bill still asks.
      const open = (data.payments ?? []).filter((p) => (p.remainingRefundableMinor ?? 0) > 0);
      setPaymentId(open.length === 1 ? open[0].id : "");
      setAmountInput("");
    } finally {
      setBusy(false);
    }
  };

  const payments = found?.payments ?? [];
  const payment = payments.find((p) => p.id === paymentId) ?? null;
  const remaining = payment?.remainingRefundableMinor ?? 0;

  const items = (found?.items ?? []).filter((i) => (i.refundableQuantity ?? 0) > 0);
  const pickedTotalMinor = items.reduce((sum, item) => {
    const qty = picked[item.id] ?? 0;
    if (qty <= 0) return sum;
    // Same rounding the core uses, so the figure on screen is the figure paid.
    const unit = Math.round((item.lineTotalMinor ?? 0) / Math.max(1, item.quantity ?? 1));
    return sum + unit * qty;
  }, 0);

  const typedAmountMinor = Math.round((parseFloat(String(amountInput).replace(",", ".")) || 0) * 100);
  const usingLines = pickedTotalMinor > 0;
  const refundMinor = usingLines ? pickedTotalMinor : typedAmountMinor;

  const setQty = (item, next) => {
    const capped = Math.max(0, Math.min(next, item.refundableQuantity ?? 0));
    setPicked((prev) => ({ ...prev, [item.id]: capped }));
    if (capped > 0) setAmountInput("");
  };

  const submit = async () => {
    if (!payment) { toast("Ödənişi seçin", "warning"); return; }
    if (refundMinor <= 0) { toast("Qaytarılacaq məbləği seçin", "warning"); return; }
    if (refundMinor > remaining) { toast("Qalan qaytarıla bilən məbləğdən çoxdur", "warning"); return; }
    if (!reason.trim()) { toast("Səbəb tələb olunur", "warning"); return; }

    setBusy(true);
    try {
      const input = {
        paymentId: payment.id,
        reason: reason.trim(),
        managerPin: pin || void 0
      };
      if (usingLines) {
        input.items = items
          .filter((item) => (picked[item.id] ?? 0) > 0)
          .map((item) => ({ orderItemId: item.id, quantity: picked[item.id] }));
      } else {
        input.amountMinor = refundMinor;
      }

      const res = await window.pos.payments.refund(input, { idempotencyKey: idemRef.current });
      if (!res.success) { toast(res.error?.message || "Qaytarma alınmadı", "danger"); return; }

      toast("Qaytarıldı: " + formatMoney(refundMinor), "success");

      // The guest leaves with paper saying the money went back. Failing to
      // print must not read as a failed refund - the money has already moved.
      const refundId = res.data?.refundId;
      if (refundId) {
        const printed = await window.pos.print.enqueue({
          kind: "refund_receipt",
          orderId: found.orderId,
          options: { refundId }
        });
        if (!printed.success) toast("Qaytarma qəbzi çap olunmadı", "warning");
      }

      // Re-read rather than patch: a second refund on the same sale has to see
      // what the first one left behind.
      const again = await window.pos.receipts.lookupByCode(found.number);
      if (again.success) {
        setFound(again.data);
        setPicked({}); setAmountInput(""); setReason(""); setPin("");
        idemRef.current = "refund-" + again.data.receiptId + "-" + Date.now();
      } else {
        reset();
      }
    } finally {
      setBusy(false);
    }
  };

  const stamp = (ms) => {
    if (!ms) return "—";
    const d = new Date(Number(ms));
    const pad = (n) => String(n).padStart(2, "0");
    return pad(d.getDate()) + "." + pad(d.getMonth() + 1) + "." + d.getFullYear()
      + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  };

  const methodLabel = (m) => m === "cash" ? "Nağd" : m === "card" ? "Kart" : m;

  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "mx-auto w-full max-w-3xl space-y-5 p-4", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "text-xl font-semibold text-cream", children: "Geri qaytarma" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-1 text-sm text-muted", children: "Müştərinin çekindəki geri qaytarma kodunu daxil edin." })
    ] }),

    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "rounded-2xl border border-hairline bg-elevated p-4", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-end gap-3", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "min-w-[220px] flex-1", children:
          /* @__PURE__ */ jsxRuntimeExports.jsx(OpsField, {
            label: "Qəbz kodu",
            value: code,
            placeholder: "R-ABC23XYZ",
            onChange: (v) => setCode(v.toUpperCase())
          })
        }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, { onClick: () => void lookup(), disabled: busy, children: busy ? "Axtarılır…" : "Tap" }),
        found ? /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: reset, children: "Təmizlə" }) : null
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-2 text-[11px] text-faint", children: "Kod çekin altında «GERİ QAYTARMA KODU» sətrindədir. Böyük/kiçik hərf və tire fərq etmir." })
    ] }),

    found ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-4", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "rounded-2xl border border-hairline bg-elevated p-4", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-baseline justify-between gap-2", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-lg font-semibold text-cream", children: found.number }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm text-muted", children: stamp(found.printedAt) })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-[10px] uppercase tracking-wide text-faint", children: "Sifariş" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-cream", children: found.order?.orderNumber || "—" })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-[10px] uppercase tracking-wide text-faint", children: "Masa" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-cream", children: found.order?.tableLabel || "Paket" })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-[10px] uppercase tracking-wide text-faint", children: "Çek məbləği" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-cream", children: formatMoney(found.totalMinor ?? 0) })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-[10px] uppercase tracking-wide text-faint", children: "Qaytarıla bilər" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "font-semibold text-cream", children: formatMoney(found.refundableTotalMinor ?? 0) })
          ] })
        ] })
      ] }),

      (found.refunds ?? []).length ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "rounded-2xl border border-warning/40 bg-warning/10 p-4", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs font-semibold uppercase tracking-wide text-cream", children: "Bu çek üzrə əvvəlki qaytarmalar" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "mt-2 space-y-1", children: (found.refunds ?? []).map((r) =>
          /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "text-sm text-cream", children: [
            stamp(r.createdAt), " · ", formatMoney(r.amountMinor ?? 0), " · ", r.reason || "—",
            r.actorName ? " · " + r.actorName : ""
          ] }, r.id)
        ) })
      ] }) : null,

      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "rounded-2xl border border-hairline bg-elevated p-4", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs font-semibold uppercase tracking-wide text-faint", children: "Hansı ödənişdən qaytarılsın" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "mt-2 flex flex-wrap gap-2", children: payments.map((p) => {
          const left = p.remainingRefundableMinor ?? 0;
          const active = p.id === paymentId;
          return /* @__PURE__ */ jsxRuntimeExports.jsxs("button", {
            type: "button",
            disabled: left <= 0,
            onClick: () => { setPaymentId(p.id); setPicked({}); setAmountInput(""); },
            className: "touch-target rounded-xl border px-3 py-2 text-left text-sm disabled:opacity-40 "
              + (active ? "border-gold/60 bg-gold/15 text-cream" : "border-hairline text-muted"),
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "block font-medium", children: methodLabel(p.method) + " · " + formatMoney(p.amountMinor ?? 0) }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "block text-[11px]", children: left > 0 ? "Qalan: " + formatMoney(left) : "Tam qaytarılıb" })
            ]
          }, p.id);
        }) })
      ] }),

      items.length ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "rounded-2xl border border-hairline bg-elevated p-4", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs font-semibold uppercase tracking-wide text-faint", children: "Səhv vurulan məhsulu seçin" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "mt-2 divide-y divide-hairline", children: items.map((item) => {
          const qty = picked[item.id] ?? 0;
          const unit = Math.round((item.lineTotalMinor ?? 0) / Math.max(1, item.quantity ?? 1));
          return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between gap-3 py-2", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "min-w-0", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "truncate text-sm text-cream", children: item.name }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-[11px] text-faint", children: formatMoney(unit) + " × " + (item.refundableQuantity ?? 0) + " qaytarıla bilər" })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "touch-target rounded-lg border border-hairline px-3 text-cream", onClick: () => setQty(item, qty - 1), children: "−" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "w-6 text-center text-sm text-cream", children: String(qty) }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "touch-target rounded-lg border border-hairline px-3 text-cream", onClick: () => setQty(item, qty + 1), children: "+" })
            ] })
          ] }, item.id);
        }) })
      ] }) : null,

      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "rounded-2xl border border-hairline bg-elevated p-4 space-y-3", children: [
        usingLines ? null : /* @__PURE__ */ jsxRuntimeExports.jsx(OpsField, {
          label: "Və ya məbləğ (məhsul seçilməyibsə)",
          value: amountInput,
          type: "text",
          placeholder: (remaining / 100).toFixed(2),
          onChange: setAmountInput
        }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex flex-wrap gap-2", children:
          ["Səhv vurulub", "Müştəri imtina etdi", "Keyfiyyət problemi", "Sifariş gecikdi"].map((preset) =>
            /* @__PURE__ */ jsxRuntimeExports.jsx("button", {
              type: "button",
              onClick: () => setReason(preset),
              className: "touch-target rounded-xl border px-3 py-1.5 text-xs "
                + (reason === preset ? "border-gold/60 bg-gold/15 text-cream" : "border-hairline text-muted"),
              children: preset
            }, preset)
          )
        }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(OpsField, { label: "Səbəb *", value: reason, onChange: setReason, placeholder: "Nə üçün qaytarılır" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(OpsField, { label: "Müdir PIN-i", value: pin, type: "password", onChange: setPin, placeholder: "Tələb olunarsa" }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-center justify-between gap-3 pt-1", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "text-sm text-muted", children: [
            "Qaytarılacaq: ",
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-base font-semibold text-cream", children: formatMoney(refundMinor) })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, {
            onClick: () => void submit(),
            disabled: busy || !payment || refundMinor <= 0 || !reason.trim(),
            children: busy ? "Göndərilir…" : "Geri qaytar"
          })
        ] })
      ] })
    ] }) : null
  ] });
}
`;

// The component goes in front of the app shell, which is where the other
// page components in this bundle sit.
s = replaceOnce(s, 'function AppShell() {', PAGE + 'function AppShell() {', 'page placement');

// --- the route ------------------------------------------------------------
s = replaceOnce(
  s,
  `/* @__PURE__ */ jsxRuntimeExports.jsx(Route, { element: /* @__PURE__ */ jsxRuntimeExports.jsx(RequirePermission, { permission: "payment.reconcile" }), children: /* @__PURE__ */ jsxRuntimeExports.jsx(Route, { path: "/reconcile", element: /* @__PURE__ */ jsxRuntimeExports.jsx(ReconcilePage, {}) }) }),`,
  `/* @__PURE__ */ jsxRuntimeExports.jsx(Route, { element: /* @__PURE__ */ jsxRuntimeExports.jsx(RequirePermission, { permission: "payment.reconcile" }), children: /* @__PURE__ */ jsxRuntimeExports.jsx(Route, { path: "/reconcile", element: /* @__PURE__ */ jsxRuntimeExports.jsx(ReconcilePage, {}) }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(Route, { element: /* @__PURE__ */ jsxRuntimeExports.jsx(RequirePermission, { permission: "payment.refund" }), children: /* @__PURE__ */ jsxRuntimeExports.jsx(Route, { path: "/refund", element: /* @__PURE__ */ jsxRuntimeExports.jsx(RefundByCodePage, {}) }) }),`,
  'route',
);

// --- the way in -----------------------------------------------------------
// A cashier's job, so it sits with the service links rather than under İdarə.
s = replaceOnce(
  s,
  `    { to: "/kds", label: t.nav.kds, icon: Soup, show: hasPermission("kds.operate") || hasPermission("kds.view") },`,
  `    { to: "/kds", label: t.nav.kds, icon: Soup, show: hasPermission("kds.operate") || hasPermission("kds.view") },
    { to: "/refund", label: "Geri qaytarma", icon: ReceiptText, show: hasPermission("payment.refund") },`,
  'sidebar link',
);

// Deliberately not added to PsAdminFrame's page-title map: psAdminRoute does
// not match /refund, so the frame never wraps it. This is a cashier screen in
// the plain shell, and it draws its own heading.

must(s.includes('function RefundByCodePage()'), 'page missing');
must(s.includes('path: "/refund"'), 'route missing');
must(s.includes('label: "Geri qaytarma", icon: ReceiptText'), 'sidebar link missing');
// The icon has to exist in the bundle or the sidebar throws on render.
must(/\bconst ReceiptText\s*=\s*createLucideIcon\(/.test(s), 'ReceiptText icon is not in the bundle');
// The refund must never be able to fire without a reason: the core requires
// one and a silent rejection at the counter looks like a broken button.
must(s.includes('disabled: busy || !payment || refundMinor <= 0 || !reason.trim()'),
     'the submit button is not guarded');

s = MARK + '\n' + s;
fs.writeFileSync(BUNDLE, s);
console.log('patched', path.basename(BUNDLE));
