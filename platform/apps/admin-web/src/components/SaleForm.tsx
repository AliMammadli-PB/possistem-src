import { FormEvent, useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useI18n } from "../i18n";
import { useProduct } from "../lib/product";

type SaleResult = {
  customer: { id: string; name: string; email: string };
  product: PosProduct;
  days: number;
  billingRequired?: boolean;
  monthlyAmountMinor?: number;
  expiresAt: string;
  activationKey: string;
};

/* geyim-product: type */ type PosProduct = "restaurant" | "market" | "geyim" | "aptek" | "topdan"; /* topdan-product: type */ /* aptek-product: type */

/**
 * Müştəri + aktivasiya açarı yaradan form.
 *
 * Solda forma, sağda təhvil kartı: yaradılandan sonra müştəriyə veriləcək
 * hər şey (quraşdırıcı linki, giriş məlumatı, açar) tək yerdə görünür və
 * forma yenidən doldurula bilər.
 */
export function SaleForm({ onCreated }: { onCreated?: () => void }) {
  const t = useI18n();
  // Pre-select whatever the topbar switch is on; the radios below still let
  // the operator sell the other product without flipping the whole panel.
  const { product: activeProductMode } = useProduct();
  const [name, setName] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [voen, setVoen] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [product, setProduct] = useState<PosProduct>(activeProductMode);
  const [notes, setNotes] = useState("");
  const [days, setDays] = useState("30");
  const [monthlyFee,setMonthlyFee]=useState("50");
  const monthly = product === "market" || product === "restaurant";
  const [maxDevices, setMaxDevices] = useState("1");
  const [loyaltyRate, setLoyaltyRate] = useState("1.00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SaleResult | null>(null);
  /** Customer + key created, but the bonus rate did not save. Non-fatal. */
  const [configWarning, setConfigWarning] = useState(false);
  /** Müştəriyə veriləcək quraşdırıcı linki. */
  const [setupUrl, setSetupUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState<"key" | "all" | null>(null);
  /** Forma təmizləndiyi üçün göstəriləcək dəyərlər ayrıca saxlanılır. */
  const [issued, setIssued] = useState<{
    email: string;
    password: string;
    address: string;
    voen: string;
    product: PosProduct;
  } | null>(null);

  /** What the handout card is describing: the issued sale, else the form. */
  const activeProduct = issued?.product ?? result?.product ?? product;

  /**
   * Installer link for the handout card, resolved per product from the live
   * update feed. It used to be a constant pinned to MarketPos 1.4.2, so every
   * customer created after that release was handed a stale download.
   */
  useEffect(() => {
    let alive = true;
    void api<{ downloadUrl: string }>(`/downloads/setup?product=${activeProduct}`)
      .then((d) => alive && setSetupUrl(d.downloadUrl))
      .catch(() => alive && setSetupUrl(null));
    return () => {
      alive = false;
    };
  }, [activeProduct]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if(monthly&&(!/^\d+(\.\d{1,2})?$/.test(monthlyFee.replace(",","."))||Number(monthlyFee.replace(",","."))<=0)){setError("Aylıq haqqı düzgün daxil edin.");return;}
    setBusy(true);
    setError(null);
    setResult(null);
    setCopied(null);
    setConfigWarning(false);
    try {
      const data = await api<SaleResult>("/sales", {
        method: "POST",
        body: JSON.stringify({
          name,
          email,
          password,
          address,
          product,
          plan: product === "restaurant" ? "standard" : "market", /* geyim-product: plan */
          phone: phone || null,
          voen: voen || null,
          contactPerson: contactPerson || null,
          notes: notes || null,
          days: Math.max(1, Number(days) || 30),
          ...(monthly?{monthlyAmountMinor:Math.round(Number(monthlyFee.replace(",","."))*100)}:{}),
          maxDevices: Math.max(1, Number(maxDevices) || 1),
          // Seats must track the device allowance, or the first "add a register"
          // in the admin panel silently rewrites seats to maxDevices + 1 (the
          // capacity route keeps the two in lockstep).
          seats: Math.max(1, Number(maxDevices) || 1),
        }),
      });
      // The activation key is returned exactly once and is unrecoverable
      // afterwards, so NOTHING after this point may throw past setResult. The
      // bonus-rate PATCH used to run unguarded here: one failure and the key the
      // customer needs was gone, with the customer already created.
      if (product !== "restaurant") { /* geyim-product: config */
        try {
          await api(`/market-pos/customers/${data.customer.id}/config`, {
            method: "PATCH",
            body: JSON.stringify({
              loyaltyRateBps: Math.max(
                0,
                Math.min(10000, Math.round((Number(loyaltyRate) || 0) * 100)),
              ),
            }),
          });
        } catch {
          setConfigWarning(true);
        }
      }
      setResult(data);
      setIssued({
        email: data.customer.email,
        password,
        address,
        voen,
        product: data.product ?? product,
      });
      setName("");
      setMonthlyFee("");
      setContactPerson("");
      setPhone("");
      setAddress("");
      setVoen("");
      setEmail("");
      setPassword("");
      setNotes("");
      // Reset the rate too. It was the one field left holding its old value, so
      // a one-off 5% typed for one shop silently became the next shop's rate.
      setLoyaltyRate("1.00");
      setMaxDevices("1");
      onCreated?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.error);
    } finally {
      setBusy(false);
    }
  };

  const productLabel = (value: PosProduct) =>
    value === "topdan" ? "Topdan POS" /* topdan-product: label */ : value === "aptek" ? "Aptek POS" /* aptek-product: label */ : value === "geyim" ? "Geyim POS" : value === "market" ? t.sale.productMarket : t.sale.productRestaurant; /* geyim-product: label */
  const selectedSetupUrl = setupUrl;

  const handoutText = () =>
    [
      result?.customer.name,
      issued && `${t.sale.product}: ${productLabel(issued.product)}`,
      issued?.address && `${t.sale.address}: ${issued.address}`,
      selectedSetupUrl && `${t.sale.setupLink}: ${selectedSetupUrl}`,
      issued && `${t.sale.email}: ${issued.email}`,
      issued && `${t.sale.password}: ${issued.password}`,
      result && `Açar: ${result.activationKey}`,
      result && (result.billingRequired?`Aylıq haqq: ${Number(result.monthlyAmountMinor)/100} ₼. Ödənişi müştəri panelinin Abunəliklər bölməsindən idarə edin.`:`${t.sale.days}: ${result.days}`),
    ]
      .filter(Boolean)
      .join("\n");

  return (
    <div className="split">
      <section className="card">
        <h2>{t.sale.submit}</h2>
        <form className="form-grid" onSubmit={(e) => void onSubmit(e)}>
          <p className="form-section">{t.sale.sectionCustomer}</p>
          <fieldset className="span-2 product-choice">
            <legend>{t.sale.product}</legend>
            <label data-active={product === "restaurant" ? "1" : "0"}>
              <input
                type="radio"
                name="product"
                value="restaurant"
                checked={product === "restaurant"}
                onChange={() => setProduct("restaurant")}
              />
              <span>
                <strong>{t.sale.productRestaurant}</strong>
                <small>{t.sale.productRestaurantHint}</small>
              </span>
            </label>
            <label data-active={product === "market" ? "1" : "0"}>
              <input
                type="radio"
                name="product"
                value="market"
                checked={product === "market"}
                onChange={() => setProduct("market")}
              />
              <span>
                <strong>{t.sale.productMarket}</strong>
                <small>{t.sale.productMarketHint}</small>
              </span>
            </label>
            {/* geyim-product: radio */}
            <label data-active={product === "geyim" ? "1" : "0"}>
              <input
                type="radio"
                name="product"
                value="geyim"
                checked={product === "geyim"}
                onChange={() => setProduct("geyim")}
              />
              <span>
                <strong>Geyim POS</strong>
                <small>Geyim, ayaqqabı və aksesuar mağazaları · ölçü/rəng, barkod, etiket</small>
              </span>
            </label>
            {/* aptek-product: radio */}
            <label data-active={product === "aptek" ? "1" : "0"}>
              <input
                type="radio"
                name="product"
                value="aptek"
                checked={product === "aptek"}
                onChange={() => setProduct("aptek")}
              />
              <span>
                <strong>Aptek POS</strong>
                <small>Apteklər · seriya və son istifadə tarixi, resept, qutu/ədəd satışı</small>
              </span>
            </label>
            {/* topdan-product: radio */}
            <label data-active={product === "topdan" ? "1" : "0"}>
              <input
                type="radio"
                name="product"
                value="topdan"
                checked={product === "topdan"}
                onChange={() => setProduct("topdan")}
              />
              <span>
                <strong>Topdan POS</strong>
                <small>Topdan satış və anbar · qaimə, 3 qiymət səviyyəsi, nisyə, yeşik/ədəd</small>
              </span>
            </label>
          </fieldset>
          <label className="span-2">
            {t.sale.name}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
          <label>
            <span>
              {t.sale.contactPerson}{" "}
              <span className="opt">{t.sale.optional}</span>
            </span>
            <input
              value={contactPerson}
              onChange={(e) => setContactPerson(e.target.value)}
              placeholder="Ad, Soyad"
            />
          </label>
          <label>
            <span>
              {t.sale.phone} <span className="opt">{t.sale.optional}</span>
            </span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+994 50 000 00 00"
            />
          </label>
          <label className="span-2">
            {t.sale.address}
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Şəhər, küçə, bina"
              required
            />
          </label>
          <label>
            <span>
              {t.sale.voen} <span className="opt">{t.sale.optional}</span>
            </span>
            <input
              value={voen}
              onChange={(e) => setVoen(e.target.value)}
              inputMode="numeric"
              maxLength={20}
              placeholder="1234567890"
            />
          </label>

          <p className="form-section">{t.sale.sectionLogin}</p>
          <label>
            E-poçt
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="off"
            />
          </label>
          <label>
            {t.sale.password}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </label>

          <p className="form-section">{t.sale.sectionLicense}</p>
          {monthly?<label>Aylıq abunə haqqı · ₼<input type="text" inputMode="decimal" required value={monthlyFee} onChange={e=>setMonthlyFee(e.target.value)} placeholder="Müştəriyə uyğun məbləğ"/><small>İlk ödəniş təsdiqlənəndən sonra POS açılacaq.</small></label>:<label>{t.sale.days}<input type="number" min={1} max={3650} value={days} onChange={e=>setDays(e.target.value)} required/></label>}
          <label>
            {product !== "restaurant" /* geyim-product: registers */ ? t.sale.registerCount : t.sale.maxDevices}
            <input
              type="number"
              min={1}
              max={50}
              value={maxDevices}
              onChange={(e) => setMaxDevices(e.target.value)}
            />
          </label>
          {product !== "restaurant" /* geyim-product: bonus */ && (
            <label>
              Bonus faizi (%)
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={loyaltyRate}
                onChange={(e) => setLoyaltyRate(e.target.value)}
              />
            </label>
          )}
          <label className="span-2">
            <span>
              {t.sale.notes} <span className="opt">{t.sale.optional}</span>
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="Kassa sayı, avadanlıq, razılaşma şərtləri…"
            />
          </label>

          {error && (
            <p className="error span-2" role="alert">
              {error}
            </p>
          )}
          <div className="span-2">
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? t.loading : t.sale.submit}
            </button>
          </div>
        </form>
      </section>

      {result ? (
        <section className="card success-box">
          <h2>{t.sale.success}</h2>
          <p className="muted">{t.sale.handoutHint}</p>
          {configWarning && (
            <p className="muted" role="status">
              ⚠️ Müştəri və açar yaradıldı, amma bonus faizi yadda saxlanmadı.
              Müştəri səhifəsindən bonus faizini təyin edin.
            </p>
          )}
          <dl className="kv">
            <dt>{t.sales.colCustomer}</dt>
            <dd>{result.customer.name}</dd>
            <dt>{t.sale.product}</dt>
            <dd>
              {issued
                ? productLabel(issued.product)
                : productLabel(result.product)}
            </dd>
            <dt>{t.sale.address}</dt>
            <dd>{issued?.address}</dd>
            {issued?.voen && (
              <>
                <dt>{t.sale.voen}</dt>
                <dd className="mono">{issued.voen}</dd>
              </>
            )}
            {selectedSetupUrl && (
              <>
                <dt>{t.sale.setupLink}</dt>
                <dd>
                  <a className="link-value mono" href={selectedSetupUrl}>
                    {selectedSetupUrl}
                  </a>
                </dd>
              </>
            )}
            <dt>{t.sale.email}</dt>
            <dd className="mono">{issued?.email}</dd>
            <dt>{t.sale.password}</dt>
            <dd className="mono">{issued?.password}</dd>
            <dt>Açar</dt>
            <dd className="mono key-value">{result.activationKey}</dd>
            <dt>{t.sale.days}</dt>
            <dd>
              {result.billingRequired?`${Number(result.monthlyAmountMinor)/100} ₼ / ay · ilk ödəniş gözlənilir`:`${result.days} gün · ${new Date(result.expiresAt).toLocaleDateString("az-AZ")}`}
            </dd>
          </dl>
          <p className="muted">{t.sale.keyOnce}</p>
          <div className="download-actions">
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                void navigator.clipboard
                  .writeText(handoutText())
                  .then(() => setCopied("all"));
              }}
            >
              {copied === "all" ? t.sale.copied : t.sale.copyAll}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                void navigator.clipboard
                  .writeText(result.activationKey)
                  .then(() => setCopied("key"));
              }}
            >
              {copied === "key" ? t.sale.copied : t.sale.copyKey}
            </button>
          </div>
        </section>
      ) : (
        <section className="card placeholder-card">
          <h2>{t.sale.waiting}</h2>
          <p className="muted">{t.sale.waitingHint}</p>
        </section>
      )}
    </div>
  );
}
