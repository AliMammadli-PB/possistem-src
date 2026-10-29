import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api, getAdminSessionToken, getCsrfToken } from '../lib/api';
import { useI18n } from '../i18n';

type AdminProduct = {
  id: string;
  name: string;
  sku: string;
  brand: string;
  category: string;
  parentCategory: string;
  shortDescription: string;
  image: string;
  price: number;
  partnerPrice?: number | null;
  originalPrice: number;
  inStock: boolean;
  stockQuantity: number;
  hasAdminPrice?: boolean;
  hidden: boolean;
};

type ProductsResponse = {
  count: number;
  parents: string[];
  categories: string[];
  products: AdminProduct[];
};

export function ProductsPage() {
  const t = useI18n();
  const [data, setData] = useState<ProductsResponse | null>(null);
  const [q, setQ] = useState('');
  const [parent, setParent] = useState('Ticarət avadanlıqları');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [draftPrices, setDraftPrices] = useState<Record<string, string>>({});
  const [draftPartnerPrices,setDraftPartnerPrices]=useState<Record<string,string>>({});
  const [draftStocks, setDraftStocks] = useState<Record<string, string>>({});
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (parent) params.set('parent', parent);
      const qs = params.toString();
      const res = await api<ProductsResponse>(`/admin/products${qs ? `?${qs}` : ''}`);
      setData(res);
      const nextPrices: Record<string, string> = {};
      const nextPartnerPrices:Record<string,string>={};
      const nextStocks: Record<string, string> = {};
      for (const p of res.products) {
        nextPrices[p.id] = String(p.price ?? '');
        nextPartnerPrices[p.id]=p.partnerPrice==null?'':String(p.partnerPrice);
        nextStocks[p.id] = String(p.stockQuantity ?? 0);
      }
      setDraftPrices(nextPrices);
      setDraftPartnerPrices(nextPartnerPrices);
      setDraftStocks(nextStocks);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.error);
    } finally {
      setLoading(false);
    }
  }, [parent, q, t.common.error]);

  useEffect(() => {
    void load();
    // Axtarış Enter və Saxla özü load() çağırır. Hər simvolda və ya taymerlə yeniləməyin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parent]);

  const parents = useMemo(() => {
    const list = data?.parents?.length ? data.parents : ['Ticarət avadanlıqları'];
    return list;
  }, [data]);

  async function savePrice(product: AdminProduct) {
    // Empty takes the product off sale; otherwise a positive amount with at most two decimals.
    const raw = (draftPrices[product.id] ?? '').trim().replace(',', '.');
    const price = raw === '' ? null : Number(raw);
    if (price !== null && (!/^\d+(\.\d{1,2})?$/.test(raw) || !Number.isFinite(price) || price <= 0 || price > 1_000_000)) {
      setError(t.products.invalidPrice);
      return;
    }
    setSavingId(product.id);
    setError(null);
    try {
      await api(`/admin/products/${product.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ price }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.error);
    } finally {
      setSavingId(null);
    }
  }

  async function savePartnerPrice(product:AdminProduct){
    const raw=(draftPartnerPrices[product.id]??'').trim().replace(',','.');
    const price=raw===''?null:Number(raw);
    if(price!==null&&(!/^\d+(?:\.\d{1,2})?$/.test(raw)||!Number.isFinite(price)||price<=0||price>1_000_000)){setError('Düzgün partnyor qiyməti yazın. Boş saxlayın ki, xüsusi qiymət silinsin.');return;}
    setSavingId(product.id);setError(null);
    try{await api(`/admin/products/${product.id}`,{method:'PATCH',body:JSON.stringify({partnerPrice:price})});await load();}
    catch(err){setError(err instanceof ApiError?err.message:'Qiymət saxlanmadı.');}finally{setSavingId(null);}
  }

  async function saveStock(product: AdminProduct, nextQty: number) {
    const stockQuantity = Math.max(0, Math.trunc(nextQty));
    if (!Number.isFinite(stockQuantity) || stockQuantity < 0) {
      setError(t.products.invalidStock);
      return;
    }
    setSavingId(product.id);
    setError(null);
    try {
      const updated = await api<AdminProduct>(`/admin/products/${product.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ stockQuantity }),
      });
      setData((prev) =>
        prev
          ? {
              ...prev,
              products: prev.products.map((item) =>
                item.id === product.id ? { ...item, ...updated } : item,
              ),
            }
          : prev,
      );
      setDraftStocks((prev) => ({ ...prev, [product.id]: String(updated.stockQuantity ?? stockQuantity) }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.error);
    } finally {
      setSavingId(null);
    }
  }

  async function saveStockFromDraft(product: AdminProduct) {
    const raw = (draftStocks[product.id] ?? '').trim();
    const n = Number(raw);
    if (!raw || !Number.isInteger(n) || n < 0) {
      setError(t.products.invalidStock);
      setDraftStocks((prev) => ({ ...prev, [product.id]: String(product.stockQuantity ?? 0) }));
      return;
    }
    if (n === (product.stockQuantity ?? 0)) return;
    await saveStock(product, n);
  }

  async function uploadImage(product: AdminProduct, file: File | null) {
    if (!file) return;
    setSavingId(product.id);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const headers: Record<string, string> = { Accept: 'application/json' };
      const session = getAdminSessionToken();
      if (session) headers['x-admin-session'] = session;
      const csrf = getCsrfToken();
      if (csrf) headers['x-csrf-token'] = csrf;

      const res = await fetch(`/pos/api/admin/products/${product.id}/image`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: form,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new ApiError(res.status, body?.error || res.statusText, body);
      }
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.error);
    } finally {
      setSavingId(null);
    }
  }

  async function toggleHidden(product: AdminProduct) {
    setSavingId(product.id);
    setError(null);
    try {
      await api(`/admin/products/${product.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ hidden: !product.hidden }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.error);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="page commerce-products-admin">
      <header className="page-head">
        <div>
          <h1>{t.products.title}</h1>
          <p className="muted">Qiyməti və stoku təyin edin. Qiymətsiz məhsul saytda “Hələ satışda deyil” görünür.</p>
        </div>
      </header>

      <div className="toolbar products-toolbar">
        <label className="field">
          <span>{t.products.search}</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t.products.searchPh}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void load();
            }}
          />
        </label>
        <label className="field">
          <span>{t.products.parent}</span>
          <select value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">{t.products.allParents}</option>
            {parents.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn" onClick={() => void load()}>
          {t.products.refresh}
        </button>
      </div>

      {error ? (
        <div className="banner-error" role="alert">
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="muted">{t.loading}</p>
      ) : !data?.products.length ? (
        <p className="muted">{t.products.empty}</p>
      ) : (
        <div className="products-grid">
          {data.products.map((product) => (
            <article key={product.id} className={`product-admin-card${product.hidden ? ' is-hidden' : ''}`}>
              <div className="product-admin-media">
                {product.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={product.image} alt={product.name} loading="lazy" />
                ) : (
                  <div className="product-admin-placeholder">{t.products.noImage}</div>
                )}
              </div>
              <div className="product-admin-body">
                <h3>{product.name}</h3>
                <p className="muted small">
                  {product.category}
                  {product.brand ? ` · ${product.brand}` : ''}
                  {product.sku ? ` · ${product.sku}` : ''}
                </p>
                {product.shortDescription ? (
                  <p className="small product-admin-desc">{product.shortDescription}</p>
                ) : null}

                <label className="field commerce-sale-editor">
                  <span>{t.products.price}</span>
                  <div className="product-price-row">
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="Qiymət yoxdur"
                      aria-label={product.name + ' satış qiyməti'}
                      value={draftPrices[product.id] ?? ''}
                      onChange={(e) =>
                        setDraftPrices((prev) => ({ ...prev, [product.id]: e.target.value }))
                      }
                    />
                    <span className="muted">₼</span>
                    <button
                      type="button"
                      className="btn"
                      disabled={savingId === product.id}
                      onClick={() => void savePrice(product)}
                    >
                      {t.products.savePrice}
                    </button>
                  </div>
                  <small className={product.hasAdminPrice ? 'product-price-live' : 'muted'}>
                    {product.hasAdminPrice ? 'Qiymət təsdiqlənib · saytda görünür' : 'Hələ satışda deyil · qiymət təyin edin'}
                  </small>
                </label>

                <details className="commerce-partner-details">
                <summary>Partnyor qiymətini idarə et</summary>
                <label className="field partner-price-editor">
                  <span>Partnyor qiyməti</span>
                  <div className="product-price-row">
                    <input type="text" inputMode="decimal" aria-label="Partnyor qiyməti" value={draftPartnerPrices[product.id]??''} placeholder="Xüsusi qiymət yoxdur" onChange={e=>setDraftPartnerPrices(prev=>({...prev,[product.id]:e.target.value}))}/>
                    <span className="muted">₼</span>
                    <button type="button" className="btn" disabled={savingId===product.id} onClick={()=>void savePartnerPrice(product)}>Saxla</button>
                  </div>
                  <small className="muted">Yalnız daxil olmuş partnyorlar görür. Boş saxlayıb saxlasanız, adi qiymət tətbiq olunur.</small>
                </label>
                </details>

                <label className="field commerce-stock-editor">
                  <span>{t.products.stock}</span>
                  <div className="product-stock-row">
                    <button
                      type="button"
                      className="btn ghost stock-step"
                      disabled={savingId === product.id || (product.stockQuantity ?? 0) <= 0}
                      aria-label={t.products.stockDecrease}
                      onClick={() => void saveStock(product, (product.stockQuantity ?? 0) - 1)}
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      value={draftStocks[product.id] ?? String(product.stockQuantity ?? 0)}
                      onChange={(e) =>
                        setDraftStocks((prev) => ({ ...prev, [product.id]: e.target.value }))
                      }
                      onBlur={() => void saveStockFromDraft(product)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void saveStockFromDraft(product);
                      }}
                    />
                    <button
                      type="button"
                      className="btn ghost stock-step"
                      disabled={savingId === product.id}
                      aria-label={t.products.stockIncrease}
                      onClick={() => void saveStock(product, (product.stockQuantity ?? 0) + 1)}
                    >
                      +
                    </button>
                  </div>
                </label>

                <div className="product-admin-actions">
                  <input
                    ref={(el) => {
                      fileRefs.current[product.id] = el;
                    }}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      void uploadImage(product, file);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={savingId === product.id}
                    onClick={() => fileRefs.current[product.id]?.click()}
                  >
                    {t.products.uploadImage}
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={savingId === product.id}
                    onClick={() => void toggleHidden(product)}
                  >
                    {product.hidden ? t.products.show : t.products.hide}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
