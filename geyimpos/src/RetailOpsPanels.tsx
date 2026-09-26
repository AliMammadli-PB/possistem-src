import { useEffect, useState } from 'react';
import {
  Check, CircleDollarSign, ClipboardList, Download, KeyRound, LockKeyhole,
  PackageSearch, Plus, Printer, ReceiptText, RefreshCw, Store, Users, WalletCards,
} from 'lucide-react';
import { marketCoreClient } from './core/client';
import { ManagerApprovalModal } from './ManagerApprovalModal';
import { parseMoneyInput } from './domain';
import { tr } from './i18n';
import type { Lang, PersistedState, Register, SessionUser, StaffProfile } from './types';

const money = (minor: number, lang: Lang) =>
  new Intl.NumberFormat(lang === 'ru' ? 'ru-RU' : lang === 'en' ? 'en-GB' : 'az-AZ', {
    style: 'currency', currency: 'AZN', minimumFractionDigits: 2,
  }).format(minor / 100);

type Notify = (text: string) => void;

export function RegistersOpsPage({
  state, staff, session, lang, coreReady, onAdd, onToggle, onRefresh, notify,
}: {
  state: PersistedState;
  staff: StaffProfile[];
  session: SessionUser;
  lang: Lang;
  coreReady: boolean;
  onAdd: () => void;
  onToggle: (register: Register) => void;
  onRefresh: () => Promise<unknown>;
  notify: Notify;
}) {
  const [selectedId, setSelectedId] = useState(state.settings.defaultRegisterId);
  const [amount, setAmount] = useState('10.00');
  const [reason, setReason] = useState('');
  const [xReport, setXReport] = useState<Record<string, unknown> | null>(null);
  const [zCount, setZCount] = useState('');
  const [approval, setApproval] = useState<null | { permission: string; run: (managerPin: string) => Promise<void> }>(null);
  const selected = state.registers.find((r) => r.id === selectedId) ?? state.registers[0];
  const openCount = state.registers.filter((r) => r.status === 'open').length;

  // Who is acting is added by main from the session; only business data is sent.
  const cashPayload = () => ({
    registerId: selected?.id,
    amountMinor: parseMoneyInput(amount),
    reason,
  });

  const runCash = async (kind: 'cashIn' | 'cashOut' | 'safeDrop') => {
    if (!selected || !coreReady) return;
    const permission = kind === 'cashIn' ? 'CASH_IN' : kind === 'cashOut' ? 'CASH_OUT' : 'SAFE_DROP';
    const label = kind === 'cashIn' ? 'Nağd daxil' : kind === 'cashOut' ? 'Nağd çıxış' : 'Seyfə atma';
    const allowed = await marketCoreClient.auth.checkPermission(session.role, permission).catch(() => ({ allowed: false }));
    const exec = async (managerPin?: string) => {
      const payload = cashPayload();
      const options = managerPin ? { managerPin } : undefined;
      if (kind === 'cashIn') await marketCoreClient.cash.cashIn(payload, options);
      else if (kind === 'cashOut') await marketCoreClient.cash.cashOut(payload, options);
      else await marketCoreClient.cash.safeDrop(payload, options);
      await onRefresh();
      notify(`${label} · ${money(parseMoneyInput(amount), lang)}`);
      setApproval(null);
    };
    if (!allowed.allowed) {
      setApproval({ permission, run: (id) => exec(id) });
      return;
    }
    try { await exec(); } catch (e) { notify(e instanceof Error ? e.message : String(e)); }
  };

  const loadX = async () => {
    if (!selected || !coreReady) return;
    try {
      const report = await marketCoreClient.cash.xReport(selected.id) as Record<string, unknown>;
      setXReport(report);
    } catch (e) { notify(e instanceof Error ? e.message : String(e)); }
  };

  const runZ = async () => {
    if (!selected || !coreReady) return;
    const allowed = await marketCoreClient.auth.checkPermission(session.role, 'CLOSE_SHIFT').catch(() => ({ allowed: false }));
    const exec = async (managerPin?: string) => {
      const report = await marketCoreClient.cash.zClose({
        registerId: selected.id,
        actualCashMinor: parseMoneyInput(zCount),
      }, managerPin ? { managerPin } : undefined) as Record<string, unknown>;
      setXReport(report);
      await onRefresh();
      notify(`Z bağlanış · fərq ${money(Number(report.differenceMinor || 0), lang)}`);
      setApproval(null);
    };
    if (!allowed.allowed) {
      setApproval({ permission: 'CLOSE_SHIFT', run: (id) => exec(id) });
      return;
    }
    try { await exec(); } catch (e) { notify(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div className="module-page registers-ops">
      <section className="page-intro">
        <div>
          <h2>{tr(lang, 'registers')}</h2>
          <span>{openCount} {tr(lang, 'openRegisters').toLowerCase()} · X/Z · nağd hərəkət</span>
        </div>
        <button className="primary-action" type="button" onClick={onAdd}><Plus />{tr(lang, 'addRegister')}</button>
      </section>

      <div className="register-grid">
        {state.registers.map((register) => {
          const operator = staff.find((u) => u.id === register.operatorId);
          const revenue = state.sales.filter((s) => s.registerId === register.id && !s.refunded)
            .reduce((sum, s) => sum + s.totalMinor, 0);
          const isSelected = selected?.id === register.id;
          return (
            <article
              className={`register-card ${register.status}${isSelected ? ' selected' : ''}`}
              key={register.id}
              onClick={() => setSelectedId(register.id)}
              aria-pressed={isSelected}
            >
              <header>
                <span className="register-icon" aria-hidden="true"><Store /></span>
                <div className="register-copy">
                  <small>{register.code}</small>
                  <h3>{register.name}</h3>
                  <p>{register.location}</p>
                </div>
                <em className={register.status === 'open' ? 'pill ok' : 'pill'}>
                  {register.status === 'open' ? tr(lang, 'active') : 'Bağlı'}
                </em>
              </header>
              <div className="register-operator">
                <span className="avatar">{operator?.name[0] ?? '?'}</span>
                <div>
                  <small>{tr(lang, 'cashier')}</small>
                  <b>{operator?.name ?? 'Təyin edilməyib'}</b>
                </div>
              </div>
              <div className="register-money">
                <span>
                  <small>{tr(lang, 'openingCash')}</small>
                  <b>{money(register.openingFloatMinor, lang)}</b>
                </span>
                <span>
                  <small>{tr(lang, 'todaySales')}</small>
                  <b>{money(revenue, lang)}</b>
                </span>
              </div>
              <footer className="register-actions">
                <button
                  type="button"
                  className={register.status === 'open' ? 'register-toggle danger' : 'register-toggle'}
                  onClick={(e) => { e.stopPropagation(); onToggle(register); }}
                >
                  {register.status === 'open' ? <LockKeyhole /> : <KeyRound />}
                  {register.status === 'open' ? tr(lang, 'closeRegister') : tr(lang, 'openRegister')}
                </button>
              </footer>
            </article>
          );
        })}
      </div>

      {selected?.status === 'open' && coreReady ? (
        <section className="panel-card cash-ops-panel">
          <div className="panel-title">
            <div>
              <h3>{selected.name} · nağd əməliyyat</h3>
            </div>
            <WalletCards />
          </div>

          <div className="cash-ops-form">
            <label className="field">
              <span>Məbləğ (AZN)</span>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
            </label>
            <label className="field">
              <span>Səbəb</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Məs: dəyişiklik, inkassasiya" />
            </label>
          </div>

          <div className="cash-ops-toolbar">
            <div className="cash-ops-moves">
              <button type="button" className="ops-chip" onClick={() => void runCash('cashIn')}>
                <CircleDollarSign />Nağd daxil
              </button>
              <button type="button" className="ops-chip" onClick={() => void runCash('cashOut')}>
                <Download />Nağd çıxış
              </button>
              <button type="button" className="ops-chip" onClick={() => void runCash('safeDrop')}>
                <WalletCards />Seyfə atma
              </button>
              <button type="button" className="ops-chip" onClick={() => void loadX()}>
                <ReceiptText />X hesabat
              </button>
            </div>
            <div className="cash-ops-z">
              <label className="field">
                <span>Z sayım · faktiki nağd</span>
                <input value={zCount} onChange={(e) => setZCount(e.target.value)} inputMode="decimal" placeholder="0.00" />
              </label>
              <button type="button" className="primary-action" onClick={() => void runZ()}>
                <KeyRound />Z bağla
              </button>
            </div>
          </div>

          {xReport && (
            <div className="cash-ops-report">
              <div><small>Gözlənilən</small><b>{money(Number(xReport.expectedCashMinor || 0), lang)}</b></div>
              <div><small>Nağd satış</small><b>{money(Number(xReport.cashSalesMinor || 0), lang)}</b></div>
              <div><small>Kart satış</small><b>{money(Number(xReport.cardSalesMinor || 0), lang)}</b></div>
              <div><small>Daxil / çıxış / seyf</small><b>
                {money(Number(xReport.cashInMinor || 0), lang)} · {money(Number(xReport.cashOutMinor || 0), lang)} · {money(Number(xReport.safeDropMinor || 0), lang)}
              </b></div>
              {xReport.differenceMinor != null && (
                <div className={Number(xReport.differenceMinor) === 0 ? 'ok' : 'warn'}>
                  <small>Fərq</small>
                  <b>{money(Number(xReport.differenceMinor), lang)}</b>
                </div>
              )}
            </div>
          )}
        </section>
      ) : selected ? (
        <section className="panel-card cash-ops-empty">
          <Store />
          <div>
            <strong>{selected.name} bağlıdır</strong>
            <span>Nağd əməliyyat və X/Z üçün əvvəl növbəni açın.</span>
          </div>
        </section>
      ) : null}

      {approval && (
        <ManagerApprovalModal
          title={`${approval.permission} təsdiqi`}
          onClose={() => setApproval(null)}
          onApproved={(managerPin) => approval.run(managerPin)}
        />
      )}
    </div>
  );
}

export function ReportsOpsPage({ state, staff, lang, coreReady }: {
  state: PersistedState; staff: StaffProfile[]; lang: Lang; coreReady: boolean;
}) {
  const active = state.sales.filter((s) => !s.refunded);
  const products = new Map(state.products.map((p) => [p.id, p]));
  const revenue = active.reduce((sum, s) => sum + s.totalMinor, 0);
  const cost = active.reduce((sum, s) => sum + s.items.reduce((lineSum, line) =>
    lineSum + (products.get(line.productId)?.costMinor ?? 0) * line.qty, 0), 0);
  const counts = new Map<string, number>();
  active.flatMap((s) => s.items).forEach((line) => counts.set(line.productId, (counts.get(line.productId) ?? 0) + line.qty));
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const [profitRows, setProfitRows] = useState<Array<Record<string, unknown>>>([]);
  const [valuation, setValuation] = useState<{
    costValueMinor: number;
    retailValueMinor: number;
    potentialMarginMinor: number;
  } | null>(null);
  const [xSnapshot, setXSnapshot] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (!coreReady || !marketCoreClient.available()) return;
    void marketCoreClient.reports.profit().then((p) => {
      setProfitRows(Array.isArray(p) ? p as Array<Record<string, unknown>> : []);
    }).catch(() => undefined);
    void marketCoreClient.inventory.valuation().then((v) => {
      const row = v as Record<string, unknown>;
      setValuation({
        costValueMinor: Number(row.costValueMinor || 0),
        retailValueMinor: Number(row.retailValueMinor || 0),
        potentialMarginMinor: Number(row.potentialMarginMinor || 0),
      });
    }).catch(() => undefined);
    const reg = state.settings.defaultRegisterId;
    void marketCoreClient.cash.xReport(reg).then((x) => setXSnapshot(x as Record<string, unknown>)).catch(() => undefined);
  }, [coreReady, state.sales.length, state.settings.defaultRegisterId]);

  const hourBuckets = Array.from({ length: 12 }, (_, i) => {
    const hour = i + 9;
    const sum = active.filter((s) => new Date(s.createdAt).getHours() === hour)
      .reduce((acc, s) => acc + s.totalMinor, 0);
    return { hour, sum };
  });
  const maxBucket = Math.max(1, ...hourBuckets.map((b) => b.sum));

  const profitRevenue = profitRows.reduce((sum, row) => sum + Number(row.revenueMinor || 0), 0);
  const profitCogs = profitRows.reduce((sum, row) => sum + Number(row.cogsMinor || 0), 0);
  const profitNet = profitRevenue - profitCogs;
  const marginMinor = valuation?.potentialMarginMinor ?? 0;

  return (
    <div className="module-page">
      <section className="kpi-grid four">
        <article className="kpi green"><span><CircleDollarSign /></span><div><small>{tr(lang, 'todaySales')}</small><strong>{money(revenue, lang)}</strong><em>{active.length} çek</em></div></article>
        <article className="kpi blue"><span><ReceiptText /></span><div><small>{tr(lang, 'transactions')}</small><strong>{String(active.length)}</strong><em>{state.registers.length} kassa</em></div></article>
        <article className="kpi amber"><span><WalletCards /></span><div><small>{tr(lang, 'margin')}</small><strong>{money(revenue - cost, lang)}</strong><em>{revenue ? Math.round((revenue - cost) / revenue * 100) : 0}%</em></div></article>
        <article className="kpi violet"><span><Store /></span><div><small>X gözlənilən</small><strong>{money(Number(xSnapshot?.expectedCashMinor || 0), lang)}</strong><em>cari növbə</em></div></article>
      </section>
      <section className="report-grid">
        <article className="panel-card chart-card">
          <div className="panel-title"><div><h3>{tr(lang, 'todaySales')}</h3></div></div>
          <div className="bar-chart">
            {hourBuckets.map((b) => (
              <span key={b.hour} style={{ height: `${Math.max(4, (b.sum / maxBucket) * 100)}%` }}><i>{b.hour}</i></span>
            ))}
          </div>
        </article>
        <article className="panel-card top-card">
          <div className="panel-title"><div><h3>{tr(lang, 'topProducts')}</h3></div></div>
          {top.map(([id, qty], index) => (
            <div className="rank" key={id}>
              <b>{index + 1}</b>
              <div><strong>{products.get(id)?.name[lang]}</strong><small>{qty}</small></div>
              <em>{money((products.get(id)?.priceMinor ?? 0) * qty, lang)}</em>
            </div>
          ))}
        </article>
      </section>
      {(valuation || profitRows.length > 0) && (
        <section className="panel-card valuation-card">
          <div className="panel-title"><div><h3>Maya / qiymətləndirmə</h3></div></div>
          <div className="cash-ops-report">
            {valuation && (
              <>
                <div><small>Maya dəyəri</small><b>{money(valuation.costValueMinor, lang)}</b></div>
                <div><small>Pərakəndə dəyər</small><b>{money(valuation.retailValueMinor, lang)}</b></div>
                <div className={marginMinor < 0 ? 'warn' : 'ok'}>
                  <small>Potensial marja</small>
                  <b>{money(marginMinor, lang)}</b>
                </div>
              </>
            )}
            {profitRows.length > 0 && (
              <>
                <div><small>Satış gəliri (COGS dövrü)</small><b>{money(profitRevenue, lang)}</b></div>
                <div><small>Maya (COGS)</small><b>{money(profitCogs, lang)}</b></div>
                <div className={profitNet < 0 ? 'warn' : 'ok'}><small>Xalis mənfəət</small><b>{money(profitNet, lang)}</b></div>
              </>
            )}
          </div>
        </section>
      )}
      <section className="panel-card cashier-report">
        <div className="panel-title"><div><h3>Kassir üzrə satış</h3></div></div>
        {staff.filter((u) => u.role === 'cashier' || u.role === 'head_cashier').map((user) => {
          const sales = active.filter((s) => s.cashierId === user.id);
          return (
            <div key={user.id}>
              <span className="avatar">{user.name[0]}</span>
              <p><b>{user.name}</b><small>{user.role}</small></p>
              <strong>{sales.length} çek</strong>
              <em>{money(sales.reduce((sum, s) => sum + s.totalMinor, 0), lang)}</em>
            </div>
          );
        })}
      </section>
    </div>
  );
}

export function HardwareSettingsCard({ session, lang, notify }: { session: SessionUser; lang: Lang; notify: Notify }) {
  const [health, setHealth] = useState<{ online: boolean; provider: string; configured?: boolean; target?: string } | null>(null);
  const [printers, setPrinters] = useState<Array<{ id: string; name: string; connection?: string; status?: string; isCurrent?: boolean; confirmed?: boolean }>>([]);
  const [detecting, setDetecting] = useState(false);
  const [widthMm, setWidthMm] = useState(80);
  const [terminalMode, setTerminalMode] = useState<'manual' | 'mock_integrated'>(
    () => (localStorage.getItem('geyimpos.terminalMode') === 'mock_integrated' ? 'mock_integrated' : 'manual'),
  );
  const [fiscalPending, setFiscalPending] = useState(0);

  const refresh = async () => {
    const h = await window.marketSystem?.printer?.health();
    if (h) setHealth(h);
    // Local links only, so opening settings does not wait on a LAN sweep.
    const list = await window.marketSystem?.printer?.list().catch(() => []);
    if (list) setPrinters(list);
    if (marketCoreClient.available()) {
      const pending = await marketCoreClient.fiscal.listPending().catch(() => []) as unknown[];
      setFiscalPending(Array.isArray(pending) ? pending.length : 0);
    }
  };

  useEffect(() => { void refresh(); }, []);

  return (
    <section className="panel-card settings-card hardware-settings">
      <div className="panel-title"><h3>Printer · pul qutusu · fiskal · terminal</h3><Printer /></div>
      <p className="hint">
        {/* "No printer chosen" and "chosen but unreachable" are different
            problems for the operator, so the line says which one this is. */}
        {!health?.configured
          ? 'Printer seçilməyib'
          : `${health.target} · ${health.online ? 'hazır' : 'cavab vermir'}`}
        {fiscalPending ? ` · ${fiscalPending} fiskal növbədə` : ''}
      </p>
      <div className="hardware-controls">
        <label className="field">
          <span>Printer</span>
          <select
            value={health?.target ?? ''}
            onChange={(e) => void window.marketSystem?.printer
              ?.setTarget(session.sessionToken, e.target.value)
              .then(() => { notify('Printer seçildi'); void refresh(); })
              .catch((err: Error) => notify(err.message))}
          >
            <option value="">— seçilməyib —</option>
            {printers.map((printer) => (
              <option key={printer.id} value={printer.id}>
                {printer.name}
                {printer.connection ? ` · ${printer.connection}` : ''}
                {printer.confirmed ? ' ✓' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Çap eni</span>
          <select value={widthMm} onChange={(e) => setWidthMm(Number(e.target.value))}>
            <option value={58}>58 mm</option>
            <option value={80}>80 mm</option>
          </select>
        </label>
        <label className="field">
          <span>Terminal rejimi</span>
          <select value={terminalMode} onChange={(e) => setTerminalMode(e.target.value as 'manual' | 'mock_integrated')}>
            <option value="manual">Manual referans</option>
            <option value="mock_integrated">Mock (yalnız test — satışda bloklanır)</option>
          </select>
        </label>
      </div>
      <div className="button-row hardware-actions">
        <button type="button" disabled={detecting} onClick={() => {
          // The sweep can take most of a minute and prints a page to each
          // candidate; the operator picks whichever one came out of the
          // printer, so the button says what is happening while it runs.
          setDetecting(true);
          void window.marketSystem?.printer?.detect(session.sessionToken)
            .then((result) => {
              notify(result.chosen
                ? `Printer tapıldı: ${result.chosen}`
                : `Printer tapılmadı (${result.printers.length} namizəd yoxlandı)`);
              return refresh();
            })
            .catch((e: Error) => notify(e.message))
            .finally(() => setDetecting(false));
        }}>
          <Printer />{detecting ? 'Axtarılır…' : 'Printeri tap'}
        </button>
        <button type="button" onClick={() => void window.marketSystem?.printer?.test(session.sessionToken, widthMm).then(() => notify('Test çap')).catch((e: Error) => notify(e.message))}>
          <Printer />Test çap
        </button>
        <button type="button" onClick={() => void window.marketSystem?.drawer?.open(session.sessionToken, { reason: 'settings' }).then(() => notify('Çekmece açıldı')).catch((e: Error) => notify(e.message))}>
          <KeyRound />Çekmece
        </button>
        <button type="button" onClick={() => void window.marketSystem?.fiscal?.processPending(session.sessionToken).then(() => { notify('Fiscal növbə işləndi'); void refresh(); }).catch((e: Error) => notify(e.message))}>
          <RefreshCw />Fiscal işlət
        </button>
        <button type="button" className="primary-action" onClick={() => {
          localStorage.setItem('geyimpos.terminalMode', terminalMode);
          notify(`Terminal: ${terminalMode}`);
        }}>{tr(lang, 'save')}</button>
      </div>
    </section>
  );
}

export function StocktakePage({ state, session, coreReady, notify, onRefresh }: {
  state: PersistedState; session: SessionUser; coreReady: boolean; notify: Notify; onRefresh: () => Promise<unknown>;
}) {
  const [list, setList] = useState<Array<Record<string, unknown>>>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);

  const reload = async () => {
    if (!coreReady) return;
    const rows = await marketCoreClient.stocktake.list() as Array<Record<string, unknown>>;
    setList(rows);
  };

  useEffect(() => { void reload(); }, [coreReady]);

  const create = async () => {
    const doc = await marketCoreClient.stocktake.create({
      warehouseId: state.settings.defaultWarehouseId,
      actorId: session.id,
      role: session.role,
      note: 'UI stocktake',
    }) as Record<string, unknown>;
    notify(`Stocktake ${String(doc.id)}`);
    await reload();
  };

  const open = async (id: string) => {
    setActiveId(id);
    const doc = await marketCoreClient.stocktake.get(id) as Record<string, unknown>;
    setDetail(doc);
  };

  const post = async () => {
    if (!activeId) return;
    await marketCoreClient.stocktake.post(activeId, session.id, session.role);
    notify('Stocktake posted');
    await onRefresh();
    await reload();
    setDetail(null);
  };

  return (
    <div className="module-page retail-list-page">
      <section className="page-intro">
        <div>
          <h2>Inventarizasiya</h2>
          <span>{list.length} sənəd · STOCKTAKE hərəkətləri</span>
        </div>
        <button className="primary-action" type="button" disabled={!coreReady} onClick={() => void create().catch((e) => notify(e.message))}>
          <ClipboardList />Yeni sayım
        </button>
      </section>
      {!list.length ? (
        <section className="panel-card cash-ops-empty">
          <ClipboardList />
          <div><strong>Sayım sənədi yoxdur</strong><span>Yeni inventarizasiya yaradın.</span></div>
        </section>
      ) : (
        <div className="receipt-list">
          {list.map((row) => (
            <article key={String(row.id)} className={activeId === row.id ? 'selected' : ''}>
              <div className="receipt-badge"><ClipboardList /></div>
              <div className="receipt-main">
                <small>{String(row.status)}</small>
                <h3>{String(row.id)}</h3>
              </div>
              <button type="button" onClick={() => void open(String(row.id))}><PackageSearch />Aç</button>
              {activeId === row.id && row.status !== 'posted' && (
                <button type="button" className="primary-action" onClick={() => void post().catch((e) => notify(e.message))}><Check />Post</button>
              )}
            </article>
          ))}
        </div>
      )}
      {detail && (
        <section className="panel-card retail-detail">
          <div className="panel-title"><div><h3>Sənəd detalları</h3></div></div>
          <pre className="retail-pre">{JSON.stringify(detail, null, 2).slice(0, 2000)}</pre>
        </section>
      )}
    </div>
  );
}

export function CustomersPage({ session, lang, coreReady, notify }: {
  session: SessionUser; lang: Lang; coreReady: boolean; notify: Notify;
}) {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [ledger, setLedger] = useState<unknown>(null);

  const reload = async () => {
    if (!coreReady) return;
    setRows(await marketCoreClient.customers.list() as Array<Record<string, unknown>>);
  };
  useEffect(() => { void reload(); }, [coreReady]);

  return (
    <div className="module-page retail-list-page">
      <section className="page-intro">
        <div>
          <h2>Müştərilər</h2>
          <span>{rows.length} qeyd · nisyə / loyalty</span>
        </div>
      </section>
      <section className="panel-card customer-create">
        <div className="panel-title"><div><h3>Yeni müştəri</h3></div><Users /></div>
        <div className="cash-ops-form">
          <label className="field"><span>Ad</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field"><span>Telefon</span><input value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
        </div>
        <div className="button-row">
          <button type="button" className="primary-action" disabled={!coreReady || !name} onClick={() => void marketCoreClient.customers.create({
            name, phone, actorId: session.id, creditAllowed: true, creditLimitMinor: 100000,
          }).then(() => { setName(''); setPhone(''); notify('Müştəri əlavə olundu'); return reload(); }).catch((e: Error) => notify(e.message))}>
            <Users />Əlavə et
          </button>
        </div>
      </section>
      <div className="receipt-list">
        {rows.map((c) => (
          <article key={String(c.id)}>
            <div className="receipt-badge"><Users /></div>
            <div className="receipt-main"><h3>{String(c.name)}</h3><p>{String(c.phone || '')}</p></div>
            <button type="button" onClick={() => void marketCoreClient.customers.ledger(String(c.id)).then(setLedger)}>{tr(lang, 'details')}</button>
          </article>
        ))}
      </div>
      {ledger != null && (
        <section className="panel-card retail-detail">
          <div className="panel-title"><div><h3>Ledger</h3></div></div>
          <pre className="retail-pre">{JSON.stringify(ledger, null, 2).slice(0, 1500)}</pre>
        </section>
      )}
    </div>
  );
}

export function ImportCsvPage({ session, coreReady, notify }: {
  session: SessionUser; coreReady: boolean; notify: Notify;
}) {
  const [text, setText] = useState('sku,barcode,name,priceMinor\nDEMO-1,2000000000012,Demo məhsul,199');
  const [preview, setPreview] = useState<unknown>(null);

  const parse = () => {
    const lines = text.trim().split(/\n+/);
    const header = lines[0]?.split(',') ?? [];
    return lines.slice(1).filter(Boolean).map((line) => {
      const cols = line.split(',');
      const obj: Record<string, unknown> = {};
      header.forEach((h, i) => {
        const key = h.trim();
        const val = cols[i]?.trim() ?? '';
        obj[key] = key === 'priceMinor' || key === 'costMinor' || key === 'minStock' ? Number(val) : val;
      });
      return obj;
    });
  };

  return (
    <div className="module-page retail-list-page">
      <section className="page-intro">
        <div>
          <h2>CSV import</h2>
          <span>Dry-run və commit · sku, barcode, name, priceMinor</span>
        </div>
      </section>
      <section className="panel-card import-panel">
        <label className="field wide">
          <span>CSV mətn</span>
          <textarea className="retail-textarea" value={text} onChange={(e) => setText(e.target.value)} rows={8} />
        </label>
        <div className="button-row hardware-actions">
          <button type="button" disabled={!coreReady} onClick={() => void marketCoreClient.products.importPreview(parse()).then(setPreview).catch((e: Error) => notify(e.message))}>Önizləmə</button>
          <button type="button" disabled={!coreReady} onClick={() => void marketCoreClient.products.importCommit(parse(), session.id, session.role, true).then((r) => { setPreview(r); notify('Dry-run OK'); }).catch((e: Error) => notify(e.message))}>Dry-run</button>
          <button type="button" className="primary-action" disabled={!coreReady} onClick={() => void marketCoreClient.products.importCommit(parse(), session.id, session.role, false).then(() => notify('Import tamamlandı')).catch((e: Error) => notify(e.message))}>Commit</button>
        </div>
      </section>
      {preview != null && (
        <section className="panel-card retail-detail">
          <div className="panel-title"><div><h3>Nəticə</h3></div></div>
          <pre className="retail-pre">{JSON.stringify(preview, null, 2).slice(0, 2000)}</pre>
        </section>
      )}
    </div>
  );
}

export function PlatformStubsPage({ coreReady, notify }: { coreReady: boolean; notify: Notify }) {
  const [sync, setSync] = useState<Record<string, unknown> | null>(null);
  const [eqaime, setEqaime] = useState<Record<string, unknown> | null>(null);
  const [aggregator, setAggregator] = useState<Record<string, unknown> | null>(null);
  const [scopeCount, setScopeCount] = useState(0);
  const [showRaw, setShowRaw] = useState(false);
  const [raw, setRaw] = useState<unknown>(null);

  useEffect(() => {
    if (!coreReady) return;
    void Promise.all([
      marketCoreClient.platform.syncStatus().catch(() => ({ status: 'stub' })),
      marketCoreClient.platform.priceScopes().catch(() => []),
      marketCoreClient.platform.eqaimeStatus().catch(() => ({ status: 'stub' })),
      marketCoreClient.platform.aggregatorStatus().catch(() => ({ status: 'stub' })),
    ]).then(([syncRow, scopes, eqaimeRow, aggregatorRow]) => {
      setSync(syncRow as Record<string, unknown>);
      setScopeCount(Array.isArray(scopes) ? scopes.length : 0);
      setEqaime(eqaimeRow as Record<string, unknown>);
      setAggregator(aggregatorRow as Record<string, unknown>);
      setRaw({ sync: syncRow, scopes, eqaime: eqaimeRow, aggregator: aggregatorRow });
    });
  }, [coreReady]);

  const badge = (status: unknown) => {
    const s = String(status || 'unknown');
    if (s === 'local_only' || s === 'not_configured' || s === 'stub') return 'pill';
    if (s === 'active' || s === 'ok') return 'pill ok';
    return 'pill warn';
  };

  return (
    <div className="module-page retail-list-page">
      <section className="page-intro">
        <div>
          <h2>Platforma</h2>
          <span>Multi-branch · e-qaimə · aggregator</span>
        </div>
        <button type="button" className="primary-action" onClick={() => notify('Bax: geyimpos/docs/INTEGRATIONS.md')}>İnteqrasiya sənədi</button>
      </section>
      <div className="platform-status-grid">
        <article className="panel-card">
          <div className="panel-title"><div><h3>Sinxron</h3></div><em className={badge(sync?.status)}>{String(sync?.status ?? '—')}</em></div>
          <p className="hint">{String(sync?.note ?? 'Multi-branch sync hazırlanır')}</p>
          <div className="cash-ops-report">
            <div><small>Gözləyən entity</small><b>{Number(sync?.pendingEntities ?? 0)}</b></div>
            <div><small>Qiymət əhatəsi</small><b>{scopeCount}</b></div>
          </div>
        </article>
        <article className="panel-card">
          <div className="panel-title"><div><h3>E-qaimə</h3></div><em className={badge(eqaime?.status)}>{String(eqaime?.status ?? '—')}</em></div>
          <p className="hint">Provider: {String(eqaime?.provider ?? 'stub')} · real operator sənədi lazımdır</p>
        </article>
        <article className="panel-card">
          <div className="panel-title"><div><h3>Aggregator</h3></div><em className={badge(aggregator?.status)}>{String(aggregator?.status ?? '—')}</em></div>
          <p className="hint">Provider: {String(aggregator?.provider ?? 'stub')}</p>
          <div className="permission-pills" style={{ marginTop: 10 }}>
            {(Array.isArray(aggregator?.supported) ? aggregator!.supported as string[] : []).map((name) => (
              <span key={name}>{name}</span>
            ))}
          </div>
        </article>
      </div>
      <section className="panel-card retail-detail">
        <div className="panel-title">
          <div><h3>Detallar</h3></div>
          <button type="button" onClick={() => setShowRaw((v) => !v)}>{showRaw ? 'Gizlət' : 'JSON göstər'}</button>
        </div>
        {showRaw && <pre className="retail-pre">{JSON.stringify(raw, null, 2)}</pre>}
      </section>
    </div>
  );
}

export function FiscalBadge({ coreReady }: { coreReady: boolean }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!coreReady) return;
    const tick = () => void marketCoreClient.fiscal.listPending().then((rows) => setN(Array.isArray(rows) ? rows.length : 0)).catch(() => undefined);
    tick();
    const id = window.setInterval(tick, 8000);
    return () => window.clearInterval(id);
  }, [coreReady]);
  if (!n) return null;
  return <em className="pill" title="Fiskal çeklər növbədə">{n} fiskal</em>;
}
