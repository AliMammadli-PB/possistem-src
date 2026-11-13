import { useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
type Customer = { id: string; name: string; email: string };
type Merchant = {
  id: string;
  device_id: string | null;
  public_key: string;
  active: boolean;
  verified: boolean;
  callbackUrl: string;
};
type Review = {
  id: string;
  status: string;
  amount_minor: number;
  provider_transaction: string | null;
  table_label: string;
  created_at: string;
  error: string | null;
};
type State = {
  globallyEnabled: boolean;
  merchants: Merchant[];
  reviews: Review[];
};
export function RestaurantPaymentSettings() {
  const { user } = useAuth();
  const [q, setQ] = useState(""),
    [customers, setCustomers] = useState<Customer[]>([]),
    [customer, setCustomer] = useState(""),
    [data, setData] = useState<State | null>(null),
    [publicKey, setPublicKey] = useState(""),
    [privateKey, setPrivateKey] = useState(""),
    [active, setActive] = useState(true),
    [verified, setVerified] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [refs, setRefs] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(
      () =>
        void api<{ customers: Customer[] }>(
          "/admin/billing/customers?q=" + encodeURIComponent(q),
        )
          .then((r) => {
            if (alive) setCustomers(r.customers);
          })
          .catch((e) => {
            if (alive) setError(e.message);
          }),
      250,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q]);
  async function load(id = customer) {
    const r = await api<State>("/admin/restaurant-payments/" + id);
    setData(r);
    return r;
  }
  useEffect(() => {
    setData(null);
    setPrivateKey("");
    setPublicKey("");
    setError("");
    setNotice("");
    if (!customer) return;
    let alive = true;
    void api<State>("/admin/restaurant-payments/" + customer)
      .then((r) => {
        if (!alive) return;
        setData(r);
        const m = r.merchants.find((m) => m.active && !m.device_id);
        setPublicKey(m?.public_key || "");
        setActive(m?.active ?? true);
        setVerified(m?.verified ?? false);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [customer]);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/admin/restaurant-payments/" + customer, {
        method: "POST",
        body: JSON.stringify({
          publicKey,
          privateKey: privateKey || undefined,
          active,
          verified,
        }),
      });
      setPrivateKey("");
      await load();
      setNotice(
        "Restoranın Epoint hesabı saxlanıldı. Aşağıdakı yeni callback ünvanını Epoint kabinetinə yazın.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Saxlanılmadı.");
    } finally {
      setBusy(false);
    }
  }
  async function reconcile(row: Review) {
    setBusy(true);
    setError("");
    try {
      await api(
        "/admin/restaurant-payments/" +
          customer +
          "/payments/" +
          row.id +
          "/check",
        {
          method: "POST",
          body: JSON.stringify({ transaction: refs[row.id] || undefined }),
        },
      );
      await load();
      setNotice("Bank nəticəsi yoxlanıldı.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Yoxlanılmadı.");
    } finally {
      setBusy(false);
    }
  }
  if (user?.role !== "superadmin")
    return <p>Bu bölmə yalnız Possistem superadmini üçündür.</p>;
  return (
    <section className="bill-panel">
      <header>
        <h2>Restoranların masa ödənişləri</h2>
      </header>
      <p>
        Müştəri öz Epoint açarlarını sizə təqdim edir. Hər restoranın masa
        ödənişi öz merchant hesabına gedir.
      </p>
      <div className="bill-form">
        <label>
          Müştəri axtar
          <input
            value={q}
            disabled={busy}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Restoran adı və ya email"
          />
        </label>
        <label>
          Restoran
          <select
            disabled={busy}
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
          >
            <option value="">Restoran seçin</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.email}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="bill-alert error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="bill-alert">
          {notice}
        </p>
      )}
      {data && (
        <>
          <p className="bill-alert">
            {data.globallyEnabled
              ? "Serverdə QR ödəniş açıqdır."
              : "Hazırlıq rejimi: canlı QR ödənişləri bağlıdır. Bank və kassa sınağından sonra Possistem tərəfindən aktivləşdiriləcək."}
          </p>
          <form className="bill-form" onSubmit={(e) => void save(e)}>
            <label>
              Restoranın public açarı
              <input
                autoComplete="off"
                value={publicKey}
                disabled={busy}
                onChange={(e) => setPublicKey(e.target.value.trim())}
                required
                pattern="i[0-9]{4,30}"
              />
            </label>
            <label>
              Restoranın private açarı
              <input
                type="password"
                autoComplete="new-password"
                value={privateKey}
                disabled={busy}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder={
                  data.merchants.some((m) => m.active)
                    ? "Dəyişmirsə boş saxlayın"
                    : "Private açarı daxil edin"
                }
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />{" "}
              Bu merchant aktivdir
            </label>
            <label>
              <input
                type="checkbox"
                checked={verified}
                onChange={(e) => setVerified(e.target.checked)}
              />{" "}
              Bu restoran üçün bank və kassa sınağını tamamlamışam
            </label>
            <div className="full">
              <button className="bill-primary" disabled={busy || !publicKey}>
                Restoranın açarlarını saxla
              </button>
            </div>
          </form>
          <div style={{ marginTop: 20 }}>
            {data.merchants
              .filter((m) => m.active)
              .map((m) => (
                <div key={m.id} className="bill-alert">
                  <b>{m.public_key}</b> ·{" "}
                  {m.device_id
                    ? "Kassa: " + m.device_id
                    : "Restoranın bütün kassaları"}{" "}
                  · {m.verified ? "Yoxlanılıb" : "Sınaq gözlənilir"}
                  <br />
                  <span>Callback ünvanı</span>
                  <code
                    style={{
                      display: "block",
                      overflowWrap: "anywhere",
                      whiteSpace: "normal",
                    }}
                  >
                    {m.callbackUrl}
                  </code>
                  <button
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(m.callbackUrl)
                        .then(() => setNotice("Callback ünvanı kopyalandı."))
                        .catch(() =>
                          setError("Ünvanı mətn kimi seçib kopyalayın."),
                        )
                    }
                  >
                    Ünvanı kopyala
                  </button>
                </div>
              ))}
          </div>
          <h3>Araşdırılan masa ödənişləri</h3>
          {!data.reviews.length ? (
            <p>Gözləyən və ya araşdırılan əməliyyat yoxdur.</p>
          ) : (
            <div className="bill-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Masa / tarix</th>
                    <th>Məbləğ</th>
                    <th>Vəziyyət / Epoint</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.reviews.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {r.table_label}
                        <br />
                        {new Date(r.created_at).toLocaleString("az-AZ")}
                      </td>
                      <td>{(Number(r.amount_minor) / 100).toFixed(2)} ₼</td>
                      <td>
                        {r.status}
                        <br />
                        {r.provider_transaction ||
                          "Əməliyyat nömrəsi alınmayıb"}
                        <br />
                        {r.error}
                      </td>
                      <td>
                        {!r.provider_transaction && (
                          <input
                            aria-label="Epoint əməliyyat nömrəsi"
                            value={refs[r.id] || ""}
                            onChange={(e) =>
                              setRefs((v) => ({ ...v, [r.id]: e.target.value }))
                            }
                          />
                        )}
                        <button
                          disabled={busy || r.status === "review"}
                          onClick={() => void reconcile(r)}
                        >
                          Bankdan yoxla
                        </button>
                        {r.status === "review" && (
                          <small>
                            Restoranın Epoint kabinetində ayrıca araşdırın. POS
                            qalığı avtomatik geri çevrilmir.
                          </small>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
