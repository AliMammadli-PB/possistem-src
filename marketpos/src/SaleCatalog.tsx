import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, ScanBarcode, Search, Scale, Wheat } from 'lucide-react';
import { BarcodeKeypad } from './BarcodeKeypad';
import { CatalogAisleNav } from './CatalogAisleNav';
import { SaleProductGrid } from './SaleProductGrid';
import { useBarcodeScanner } from './useBarcodeScanner';
import { tr } from './i18n';
import { money } from './format';
import type { Lang, Product, Sale } from './types';

/** Search/scanner input never rerenders the basket or the app shell. */
export const SaleCatalog = memo(function SaleCatalog({ products, sales=[], quickKey="default", lang, warehouseId, showImages = false, cloudConnected, scannerEnabled, onAdd, onScan, onNewSale }: {
  products: Product[]; sales?: Sale[]; quickKey?:string; lang: Lang; warehouseId: string; showImages?: boolean; cloudConnected: boolean; scannerEnabled: boolean;
  onAdd: (product: Product) => void; onScan: (value: string, inputValue?: string) => void; onNewSale: () => boolean;
}) {
  const [categoriesHidden,setCategoriesHidden]=useState(false);
  const [pinned,setPinned]=useState<string[]>(()=>{try{const value=JSON.parse(localStorage.getItem('market-quick-'+quickKey)||'[]');return Array.isArray(value)?value.filter(x=>typeof x==='string').slice(0,12):[];}catch{return [];}});
  useEffect(()=>{try{localStorage.setItem('market-quick-'+quickKey,JSON.stringify(pinned));}catch{}},[pinned,quickKey]);
  const quickProducts=useMemo(()=>{
    const scores=new Map<string,number>();
    for(const sale of sales.filter(s=>!s.refunded))for(const line of sale.items)scores.set(line.productId,(scores.get(line.productId)||0)+(line.qtyMilli?line.qtyMilli/1000:line.qty));
    const common=products.filter(p=>/salafan|selofan|kilok|paket|po[sş]et/i.test(Object.values(p.name).join(' '))).map(p=>p.id);
    const ids=[...pinned,...common,...[...scores].sort((a,b)=>b[1]-a[1]).map(x=>x[0])];
    return [...new Set(ids)].map(id=>products.find(p=>p.id===id)).filter((p):p is Product=>Boolean(p)).slice(0,12);
  },[pinned,products,sales]);
  const [query, setQuery] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [keypadOpen, setKeypadOpen] = useState(false);
  const [category, setCategory] = useState('all');
  const [quick, setQuick] = useState<'bread' | 'weighted' | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Do not rebuild the catalog for every character of a USB scanner burst.
  // The input itself is immediate; only the expensive search waits for a pause.
  useEffect(() => {
    if (!query) { setSearchQuery(''); return; }
    const timer = window.setTimeout(() => setSearchQuery(query), 100);
    return () => window.clearTimeout(timer);
  }, [query]);
  // Əməliyyatlar → Kateqoriyalar: a new category shows here at once, even before it has goods.
  const [warehouseCategories, setWarehouseCategories] = useState<string[]>([]);
  useEffect(() => {
    const load = () => void window.marketOps?.categories?.().then((rows) => setWarehouseCategories(Array.isArray(rows) ? rows : [])).catch(() => undefined);
    load();
    const timer = window.setInterval(load, 10000);
    return () => window.clearInterval(timer);
  }, []);
  const categories = useMemo(() => [...new Set([...warehouseCategories, ...products.map((product) => product.category)])], [products, warehouseCategories]);
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const product of products) counts.set(product.category, (counts.get(product.category) ?? 0) + 1);
    return counts;
  }, [products]);
  const searchIndex = useMemo(() => new Map(products.map((product) => [product.id,
    [product.barcode, product.sku, ...Object.values(product.name)].join('\n').toLocaleLowerCase(),
  ])), [products]);
  const filtered = useMemo(() => {
    const needle = searchQuery.trim().toLocaleLowerCase();
    if (!needle && !quick && category === 'all') return products;
    return products.filter((product) => {
      const matches = quick === 'bread' ? product.category === 'Çörək' : quick === 'weighted' ? product.unit === 'kq' : category === 'all' || product.category === category;
      return matches && (!needle || searchIndex.get(product.id)?.includes(needle));
    });
  }, [products, searchIndex, searchQuery, category, quick]);
  const chooseCategory = useCallback((next: string) => { setCategory(next); setQuick(null); }, []);
  const scan = useCallback((value: string, inputValue?: string) => {
    if (!scannerEnabled) return;
    setQuery(''); setSearchQuery(''); onScan(value, inputValue);
  }, [scannerEnabled, onScan]);
  // Keep recognizing bursts in payment: consume the scanner's Enter so it
  // cannot activate the focused Pay button. scan() decides whether to add.
  useBarcodeScanner({ onScan: scan });
  const add = useCallback((product: Product) => { onAdd(product); setQuery(''); setSearchQuery(''); }, [onAdd]);
  return <>
      <aside className="catalog-aisles" hidden={categoriesHidden}>
        <h2>{tr(lang, 'catalogAisles')}</h2>
        <CatalogAisleNav
          lang={lang}
          categories={categories}
          counts={categoryCounts}
          total={products.length}
          value={quick ? '' : category}
          onChange={chooseCategory}
          layout="rail"
        />
      </aside>
      <section className="catalog-pane">
        <div className="sale-toolbar"><button type="button" className="catalog-aisles-toggle" aria-pressed={categoriesHidden} onClick={()=>setCategoriesHidden(x=>!x)}>{categoriesHidden?'Kateqoriyaları göstər':'Kateqoriyaları gizlət'}</button>
          <label className="search-box">
            <Search />
            <input ref={inputRef} data-scanner="allow" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.defaultPrevented) { event.preventDefault(); scan(event.currentTarget.value); } }} placeholder={tr(lang, 'search')} />
          </label>
          <button className="scan-button" aria-expanded={keypadOpen} aria-haspopup="dialog" onClick={() => setKeypadOpen((open) => !open)}><ScanBarcode /><span>{tr(lang, 'barcode')}</span><small>{tr(lang, 'scanReady')}</small></button>
          {keypadOpen && <BarcodeKeypad lang={lang} initial={/^\d+$/.test(query.trim()) ? query.trim() : ''} onSubmit={(code) => { scan(code); setQuery(''); }} onClose={() => { setKeypadOpen(false); inputRef.current?.focus(); }} />}
          <button className="new-sale-button" onClick={() => { if (onNewSale()) { setQuery(''); inputRef.current?.focus(); } }}><Plus />{tr(lang, 'newSale')}</button>
        </div>
        <div className="sale-live-row">
          <div className="scan-status">
            <span className="pulse-dot" />
            <b>{tr(lang, 'scanReady')}</b>
            <small>EAN-13 · CODE128 · USB HID</small>
            <em className={cloudConnected ? 'ok' : ''}>{cloudConnected ? tr(lang, 'online') : tr(lang, 'offline')}</em>
          </div>
          <div className="cashier-quick">
            <button className={quick === 'bread' ? 'active' : ''} aria-pressed={quick === 'bread'} onClick={() => setQuick(quick === 'bread' ? null : 'bread')}><Wheat /><span>Çörək</span></button>
            <button className={quick === 'weighted' ? 'active' : ''} aria-pressed={quick === 'weighted'} onClick={() => setQuick(quick === 'weighted' ? null : 'weighted')}><Scale /><span>Kilo məhsul</span></button>
          </div>
        </div>
        <section className="quick-products" aria-label="Sürətli məhsullar"><header><span>Sürətli satış · bir toxunuşla əlavə et</span><select aria-label="Sürətli satışa məhsul əlavə et" value="" onChange={e=>{const id=e.target.value;if(id)setPinned(old=>[id,...old.filter(x=>x!==id)].slice(0,12));}}><option value="">+ Məhsulu bərkid</option>{products.map(p=><option key={p.id} value={p.id}>{p.name[lang]}</option>)}</select></header><div className="quick-product-list">{quickProducts.map(p=><div className="quick-product-tile" key={p.id}><button type="button" disabled={!scannerEnabled} onClick={()=>add(p)}><strong>{p.name[lang]}</strong><span>{money(p.priceMinor,lang)} · +1</span></button>{pinned.includes(p.id)&&<button type="button" className="quick-pin-remove" aria-label={`${p.name[lang]} bərkitməsini götür`} onClick={()=>setPinned(old=>old.filter(id=>id!==p.id))}>×</button>}</div>)}</div>{!quickProducts.length&&<small>Salafan və tez satılan malları yuxarıdakı siyahıdan bərkidin.</small>}</section>
        <SaleProductGrid showImages={showImages} products={filtered} lang={lang} warehouseId={warehouseId} money={money} onAdd={add} />
      </section>
  </>;
});
