"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import "./table-bill-payment.css";
type Line = {
  id: string;
  name: string;
  quantityMilli: number;
  amountMinor: number;
};
type Selection =
  | { mode: "all" }
  | { mode: "equal"; parts: number; part: number }
  | { mode: "items"; items: { lineId: string; quantityMilli: number }[] };
type Intent = {
  id: string;
  status: string;
  amountMinor: number;
  redirectUrl?: string | null;
  error?: string | null;
};
type Bill = {
  restaurantName?: string;
  snapshot: {
    orderNumber: string;
    tableLabel: string;
    totalMinor: number;
    paidMinor: number;
    lines: Line[];
  };
  state: string;
  expiresAt: string;
  expired: boolean;
  paidMinor: number;
  pendingMinor: number;
  availableMinor: number;
  remainingMinor: number;
  available: boolean;
  holds: {
    id: string;
    status: string;
    amountMinor: number;
    selection: Selection;
    allocations: {
      lineId: string;
      quantityMilli: number;
      amountMinor: number;
    }[];
  }[];
};
const money = (n: number) =>
  new Intl.NumberFormat("az-AZ", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n / 100) + " ₼";
const statusText: Record<string, string> = {
  reserving: "Kassada yoxlanılır…",
  creating: "Bank səhifəsi hazırlanır…",
  pending: "Bankdan ödəniş nəticəsi gözlənilir.",
  unknown: "Bank nəticəsi yoxlanılır. Yenidən ödəniş etməyin.",
  review: "Ödəniş kassir tərəfindən yoxlanılmalıdır. Yenidən ödəniş etməyin.",
  paid: "Bank ödənişi təsdiqləyib. Kassaya göndərilir…",
  applied: "Ödənişiniz alındı və kassada qeyd edildi.",
  failed: "Bu ödəniş baş tutmadı.",
};
class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
async function call<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal:
      typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(30_000)
        : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw new ApiError(d.error || "Nəticə alınmadı.", r.status);
  return d;
}
export function TableBillPayment({ token }: { token: string }) {
  const endpoint = "/pos/api/billing/table/" + encodeURIComponent(token),
    storageKey = "ps-table-payment:" + token;
  const [bill, setBill] = useState<Bill | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [mode, setMode] = useState<"all" | "equal" | "items">("all"),
    [parts, setParts] = useState(2),
    [part, setPart] = useState(0),
    [items, setItems] = useState<Record<string, number>>({}),
    [intent, setIntent] = useState<Intent | null>(null),
    [quoted, setQuoted] = useState<{ key: string; amountMinor: number } | null>(
      null,
    ),
    [quoteError, setQuoteError] = useState("");
  const lock = useRef(false),
    attempt = useRef<{
      requestId: string;
      selection: Selection;
      expectedAmountMinor: number;
    } | null>(null);
  const remember = (a: typeof attempt.current, id?: string) => {
    attempt.current = a;
    try {
      if (a || id)
        sessionStorage.setItem(
          storageKey,
          JSON.stringify({ attempt: a, paymentId: id }),
        );
      else sessionStorage.removeItem(storageKey);
    } catch {}
  };
  const load = useCallback(async () => {
    try {
      const b = await call<Bill>(endpoint);
      setBill(b);
      setError("");
      return b;
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "Bağlantı alınmadı. Nəticəni yoxlayın; təkrar ödəniş etməyin.",
      );
    }
  }, [endpoint]);
  const check = useCallback(
    async (id: string) => {
      try {
        const p = await call<Intent>(endpoint + "/payments/" + id);
        setIntent(p);
        if (["failed", "applied"].includes(p.status)) {
          attempt.current = null;
          try {
            sessionStorage.setItem(
              storageKey,
              JSON.stringify({ paymentId: id }),
            );
          } catch {}
        }
        return p;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Ödəniş yoxlanılmadı.");
      }
    },
    [endpoint, storageKey],
  );
  useEffect(() => {
    void load();
    let id = new URLSearchParams(location.search).get("payment");
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null");
      if (saved?.attempt?.requestId && saved.attempt.selection)
        attempt.current = saved.attempt;
      if (!id) id = saved?.paymentId;
    } catch {}
    if (id && /^[0-9a-f-]{36}$/.test(id)) void check(id);
  }, [load, check, storageKey]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void load();
      if (intent?.id && !["failed", "applied"].includes(intent.status))
        void check(intent.id);
    }, 5000);
    return () => clearInterval(timer);
  }, [load, check, intent?.id, intent?.status]);
  const active = bill?.holds.filter((h) => h.status !== "failed") || [],
    prior = active.find((h) => h.selection.mode !== "all")?.selection;
  useEffect(() => {
    if (prior?.mode === "equal") {
      setParts(prior.parts);
      setPart((v) => Math.min(v, prior.parts - 1));
    }
  }, [prior?.mode, prior?.mode === "equal" ? prior.parts : 0]);
  const blocked =
    (!!intent && !["applied", "failed"].includes(intent.status)) ||
    (!!attempt.current && !intent);
  const selection: Selection =
    mode === "all"
      ? { mode }
      : mode === "equal"
        ? { mode, parts, part }
        : {
            mode,
            items: Object.entries(items)
              .filter(([, n]) => n > 0)
              .map(([lineId, quantityMilli]) => ({ lineId, quantityMilli })),
          };
  const selectionKey = JSON.stringify(selection);
  const unavailable =
    !bill ||
    bill.state !== "open" ||
    bill.expired ||
    !bill.available ||
    bill.availableMinor <= 0;
  useEffect(() => {
    let cancelled = false;
    if (unavailable || blocked) return;
    setQuoteError("");
    const timer = setTimeout(() => {
      void call<{ amountMinor: number }>(
        endpoint + "/quote",
        JSON.parse(selectionKey),
      )
        .then((q) => {
          if (!cancelled)
            setQuoted({ key: selectionKey, amountMinor: q.amountMinor });
        })
        .catch((e) => {
          if (!cancelled) {
            setQuoted(null);
            setQuoteError(e instanceof Error ? e.message : "Pay hesablanmadı.");
          }
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    endpoint,
    selectionKey,
    bill?.paidMinor,
    bill?.pendingMinor,
    unavailable,
    blocked,
  ]);
  const selected = quoted?.key === selectionKey ? quoted.amountMinor : null;
  async function pay() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (!attempt.current && selected === null) return;
      const a = attempt.current ?? {
        requestId: crypto.randomUUID(),
        selection,
        expectedAmountMinor: selected!,
      };
      remember(a, intent?.id);
      const p = await call<Intent>(endpoint + "/checkout", a);
      remember(a, p.id);
      setIntent(p);
      if (
        p.status === "pending" &&
        p.redirectUrl &&
        /^https:\/\/(?:[a-z0-9-]+\.)*epoint\.az\//i.test(p.redirectUrl)
      ) {
        location.assign(p.redirectUrl);
        return;
      }
      if (p.status === "failed") remember(null, p.id);
      await load();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "Bağlantı kəsildi. “Nəticəni yoxla” ilə eyni əməliyyatı davam etdirin.",
      );
      if (e instanceof ApiError && [400, 409, 410, 503].includes(e.status))
        remember(null);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const retry = () => {
    if (attempt.current && !intent) void pay();
    else {
      void load();
      if (intent) void check(intent.id);
    }
  };
  return (
    <main className="table-pay">
      <div className="table-pay-shell">
        <header className="table-pay-brand">
          <img
            className="table-pay-symbol"
            src="/assets/brands/logo.png"
            alt="Possistem"
            width="38"
            height="38"
          />
          <span>
            Possistem<span className="table-pay-sub">Masada ödəniş</span>
          </span>
        </header>
        {!bill ? (
          <section className="table-pay-panel">
            <h1>Masa hesabı</h1>
            <p>{error || "Hesab yüklənir…"}</p>
            <button onClick={retry}>Yenidən yoxla</button>
          </section>
        ) : (
          <>
            <section className="table-pay-heading">
              <p className="table-pay-kicker">
                {bill.restaurantName && (
                  <>
                    {bill.restaurantName}
                    <br />
                  </>
                )}
                {bill.snapshot.tableLabel} · #{bill.snapshot.orderNumber}
              </p>
              <h1>Hesabınızı ödəyin</h1>
              <p>Birlikdə ödəyin və ya hər kəs öz payını seçsin.</p>
            </section>
            <section className="table-pay-total" aria-label="Hesabın vəziyyəti">
              <div>
                <span>Qalan hesab</span>
                <strong>{money(Math.max(0, bill.remainingMinor))}</strong>
              </div>
              <dl>
                <div>
                  <dt>Ümumi</dt>
                  <dd>{money(bill.snapshot.totalMinor)}</dd>
                </div>
                <div>
                  <dt>Ödənilib</dt>
                  <dd>{money(bill.paidMinor)}</dd>
                </div>
                {bill.pendingMinor > 0 && (
                  <div>
                    <dt>Bankda gözləyir</dt>
                    <dd>{money(bill.pendingMinor)}</dd>
                  </div>
                )}
              </dl>
            </section>
            {attempt.current && !intent && (
              <section className="table-pay-notice" role="status">
                Əvvəlki əməliyyatın nəticəsi yoxlanılmalıdır. Yeni ödəniş
                yaratmayın.
                <button onClick={retry} disabled={busy}>
                  Nəticəni yoxla
                </button>
              </section>
            )}
            {intent && (
              <section
                className={
                  "table-pay-notice " +
                  (intent.status === "applied" ? "success" : "")
                }
                role="status"
              >
                <strong>
                  {statusText[intent.status] || "Ödəniş yoxlanılır."}
                </strong>
                <p>
                  {money(intent.amountMinor)}
                  {intent.error ? " · " + intent.error : ""}
                </p>
                {intent.status === "pending" &&
                  intent.redirectUrl &&
                  /^https:\/\/(?:[a-z0-9-]+\.)*epoint\.az\//i.test(
                    intent.redirectUrl,
                  ) && (
                    <a href={intent.redirectUrl} rel="noreferrer">
                      Bank səhifəsinə qayıt
                    </a>
                  )}
                <button onClick={retry}>Nəticəni yoxla</button>
              </section>
            )}
            {(bill.expired || bill.state !== "open") && (
              <p className="table-pay-notice">
                {bill.state === "closed"
                  ? "Hesab tam ödənilib. Təşəkkür edirik!"
                  : "Bu QR linki artıq aktiv deyil. Kassirdən yeni QR kod istəyin."}
              </p>
            )}
            {!bill.available && (
              <p className="table-pay-notice">
                Bu restoranda onlayn ödəniş hələ açılmayıb. Kassirə müraciət
                edin.
              </p>
            )}
            <fieldset
              className="table-pay-methods"
              disabled={busy || blocked || unavailable}
            >
              <legend>Necə ödəmək istəyirsiniz?</legend>
              {(
                [
                  ["all", "Hamısını ödə", "Qalan hesabı birlikdə bağlayın."],
                  ["equal", "Bərabər böl", "Adam sayını və öz payınızı seçin."],
                  [
                    "items",
                    "Seçdiyim yeməkləri ödə",
                    "Yalnız seçdiyiniz məhsullar üçün ödəyin.",
                  ],
                ] as const
              ).map(([id, label, hint]) => (
                <label className={mode === id ? "chosen" : ""} key={id}>
                  <input
                    type="radio"
                    name="payment-mode"
                    value={id}
                    checked={mode === id}
                    disabled={id !== "all" && !!prior && prior.mode !== id}
                    onChange={() => setMode(id)}
                  />
                  <span>
                    <b>{label}</b>
                    <small>{hint}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            {mode === "equal" && (
              <fieldset
                className="table-pay-panel"
                disabled={busy || blocked || unavailable}
              >
                <legend>Öz payınızı seçin</legend>
                <label className="table-pay-field">
                  Neçə nəfərsiniz?
                  <select
                    value={parts}
                    disabled={prior?.mode === "equal"}
                    onChange={(e) => {
                      setParts(Number(e.target.value));
                      setPart(0);
                    }}
                  >
                    {Array.from({ length: 19 }, (_, i) => i + 2).map((n) => (
                      <option key={n} value={n}>
                        {n} nəfər
                      </option>
                    ))}
                  </select>
                </label>
                <div className="table-pay-shares">
                  {Array.from({ length: parts }, (_, i) => {
                    const held = active.find(
                      (h) =>
                        h.selection.mode === "equal" && h.selection.part === i,
                    );
                    return (
                      <label key={i} className={part === i ? "chosen" : ""}>
                        <input
                          type="radio"
                          name="share"
                          checked={part === i}
                          disabled={!!held}
                          onChange={() => setPart(i)}
                        />
                        <span>
                          {i + 1}-ci pay
                          <small>
                            {held ? "Ödənilib / gözləyir" : "Seçə bilərsiniz"}
                          </small>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )}
            <section className="table-pay-panel">
              <h2>
                {mode === "items"
                  ? "Yeməklərinizi seçin"
                  : "Hesabdakı yeməklər"}
              </h2>
              <ul className="table-pay-lines">
                {bill.snapshot.lines.map((l) => {
                  const used = active
                      .flatMap((h) => h.allocations)
                      .filter((a) => a.lineId === l.id)
                      .reduce((n, a) => n + a.quantityMilli, 0),
                    max = l.quantityMilli - used;
                  return (
                    <li key={l.id}>
                      <div>
                        <b>{l.name}</b>
                        <small>
                          {l.quantityMilli / 1000} porsiya ·{" "}
                          {money(l.amountMinor)}
                        </small>
                      </div>
                      {mode === "items" ? (
                        <label>
                          <span className="table-pay-sr">{l.name} miqdarı</span>
                          <input
                            aria-label={l.name + " miqdarı"}
                            type="number"
                            min="0"
                            max={Math.max(0, max) / 1000}
                            step="0.001"
                            disabled={
                              busy || blocked || unavailable || max <= 0
                            }
                            value={(items[l.id] || 0) / 1000}
                            onChange={(e) => {
                              const n = Math.round(
                                Number(e.target.value) * 1000,
                              );
                              setItems((v) => ({
                                ...v,
                                [l.id]: Math.max(
                                  0,
                                  Math.min(max, Number.isFinite(n) ? n : 0),
                                ),
                              }));
                            }}
                          />
                        </label>
                      ) : (
                        <span>{used > 0 ? "Pay seçilib" : ""}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className="table-pay-note">
                Endirim, xidmət haqqı və əvvəl ödənilmiş məbləğ seçilən paylara
                hesabın nisbətində bölünür. Dəqiq məbləğ bank səhifəsindən əvvəl
                serverdə yoxlanılır.
              </p>
            </section>
            {quoteError && !blocked && !unavailable && (
              <p role="status" className="table-pay-note">
                {quoteError}
              </p>
            )}
            {error && (
              <div className="table-pay-notice error" role="alert">
                {error}
                <button onClick={retry}>Nəticəni yoxla</button>
              </div>
            )}
            <footer className="table-pay-action">
              <div>
                <small>
                  {selected === null ? "Seçdiyiniz yeməklər" : "Ödəniləcək"}
                </small>
                <strong>
                  {selected === null ? "Pay seçin" : money(selected)}
                </strong>
              </div>
              <button
                className="table-pay-primary"
                onClick={() => void pay()}
                disabled={
                  busy ||
                  blocked ||
                  unavailable ||
                  (selected === null && !attempt.current) ||
                  (selection.mode === "items" && !selection.items.length) ||
                  (mode === "equal" &&
                    active.some(
                      (h) =>
                        h.selection.mode === "equal" &&
                        h.selection.part === part,
                    ))
                }
              >
                {busy
                  ? "Yoxlanılır…"
                  : attempt.current
                    ? "Əməliyyatı davam etdir"
                    : "Kartla ödə"}
              </button>
            </footer>
            <p className="table-pay-note table-pay-privacy">
              Kart məlumatları Epoint/bank səhifəsində daxil edilir. Possistem
              bu səhifədə kart nömrəsi və CVV toplamır.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
