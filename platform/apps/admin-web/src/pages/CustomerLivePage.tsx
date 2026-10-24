import { useLiveEffect } from '../lib/live';
import {useProduct} from '../lib/product';
import {useSearchParams} from 'react-router-dom';
import {CustomerPosLicenses} from '../components/CustomerPosLicenses';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { ModuleGates } from '../components/ModuleGates';
import { RolePolicyEditor, roleLabel, type StaffRow } from '../components/RolePolicyEditor';
import { useI18n } from '../i18n';

type LiveSnapshot = {
  customer: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    contactPerson: string | null;
    active: boolean;
  };
  license: { status: string; plan: string; validUntil: string | null } | null;
  connection: {
    connected: boolean;
    everConnected: boolean;
    lastSeenAt: string | null;
    appVersion: string | null;
    deviceId: string | null;
    hostname: string | null;
    restaurantName: string | null;
    lastError: string | null;
  };
  mysql: boolean;
  floor: {
    openTables: number;
    openTotalMinor: number;
    todaySalesMinor: number;
    todayPaidMinor: number;
    paymentCount: number;
    businessDate: string | null;
    businessDayStatus: string | null;
    updatedAt: string | null;
    allTablesCount: number;
    tables: Array<{
      id: string;
      label: string;
      areaName: string | null;
      status: string;
      orderId: string | null;
      guestCount: number;
      itemCount: number;
      totalMinor: number;
      paidMinor: number;
      dueMinor: number;
      waiterName: string | null;
      openedAt: string | null;
      updatedAt: string | null;
    }>;
  };
  sales: {
    grossMinor: number;
    netMinor: number;
    orderCount: number;
    paymentCount: number;
    cashMinor: number;
    cardMinor: number;
    updatedAt: string | null;
  } | null;
  notifications: Array<{ id: string; kind: string; title: string; body: string; createdAt: string }>;
  events: Array<{ id: string; action: string; entityType: string; meta: unknown; createdAt: string }>;
  commands: Array<{
    id: string;
    command: string;
    status: string;
    error: string | null;
    createdAt: string | null;
    doneAt: string | null;
  }>;
  fetchedAt: string;
};

function money(minor: number): string {
  return `${(minor / 100).toFixed(2)} ₼`;
}

function relativeTime(value: string | null): string {
  if (!value) return '—';
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.round(diff / 60_000));
  if (minutes < 1) return 'İndicə';
  if (minutes < 60) return `${minutes} dəq əvvəl`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} saat əvvəl`;
  return new Date(value).toLocaleString('az-AZ');
}

function statusLabel(status: string): string {
  switch (status) {
    case 'occupied':
      return 'Dolu';
    case 'billing':
      return 'Hesab gözləyir';
    case 'available':
      return 'Boş';
    case 'ordering':
      return 'Sifariş';
    case 'preparing':
      return 'Hazırlanır';
    case 'ready':
      return 'Hazırdır';
    case 'payment':
      return 'Ödəniş';
    default:
      return status;
  }
}

function connectionLabel(data: LiveSnapshot['connection']): string {
  if (data.connected) return 'Onlayn';
  if (data.everConnected) return 'Oflayn';
  return 'Heç qoşulmayıb';
}

function licenseLabel(license: LiveSnapshot['license']): string {
  if (!license) return 'Lisenziya yoxdur';
  const parts = [license.plan, license.status, license.validUntil ? `bitmə: ${new Date(license.validUntil).toLocaleDateString('az-AZ')}` : null];
  return parts.filter(Boolean).join(' · ');
}

type StaffItem = StaffRow & { branchId: string; branchName: string };
type StaffData = {
  staff: StaffItem[];
  counts: Record<string, number>;
  branches: Array<{ id: string; name: string }>;
  branchCounts: Record<string, Record<string, number>>;
};
type StaffSave = { id?: string; name: string; role: string; branchId?: string; active?: boolean; pin?: string };
const STAFF_ROLES = ['manager', 'head_cashier', 'cashier', 'warehouse'];
const pinDigits = (value: string) => value.replace(/\D/g, '').slice(0, 4);

/** 4-digit PIN typed twice; checks match before anything is sent. */
function PinPair({ pin, setPin, again, setAgain }: { pin: string; setPin: (v: string) => void; again: string; setAgain: (v: string) => void }) {
  return (
    <>
      <label>
        PIN (4 rəqəm)
        <input type="password" inputMode="numeric" autoComplete="new-password" value={pin}
          onChange={(e) => setPin(pinDigits(e.target.value))} minLength={4} maxLength={4} required />
      </label>
      <label>
        PIN təkrar
        <input type="password" inputMode="numeric" autoComplete="new-password" value={again}
          onChange={(e) => setAgain(pinDigits(e.target.value))} minLength={4} maxLength={4} required />
      </label>
    </>
  );
}

function pinProblem(pin: string, again: string): string | null {
  if (!/^\d{4}$/.test(pin)) return 'PIN düz 4 rəqəm olmalıdır';
  if (pin !== again) return 'PIN-lər eyni deyil';
  return null;
}

/** The customer's Market workers by filial: add, PIN, filial, (de)activate; rights open in the editor below. */
function MarketStaffCard({ data, save, onRights, onManager }: {
  data: StaffData | null;
  save: (input: StaffSave) => Promise<void>;
  onRights: (id: string) => void;
  onManager: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', role: 'cashier', branchId: '' });
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [pinFor, setPinFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = async (input: StaffSave, done: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await save(input);
      setPin('');
      setAgain('');
      setMessage(`${done} — kassalar ~30 saniyəyə yeniləyir`);
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Saxlanmadı');
      return false;
    } finally {
      setBusy(false);
    }
  };
  const edit = (person: StaffItem, change: Partial<StaffSave>) =>
    ({ id: person.id, name: person.name, role: person.role, branchId: person.branchId, active: person.active, ...change });

  const onAdd = async (e: FormEvent) => {
    e.preventDefault();
    const problem = pinProblem(pin, again);
    if (problem) return setError(problem);
    if (await run({ ...form, name: form.name.trim(), pin }, 'İşçi əlavə edildi')) {
      setAdding(false);
      setForm({ name: '', role: 'cashier', branchId: '' });
    }
  };
  const onPin = async (e: FormEvent, person: StaffItem) => {
    e.preventDefault();
    const problem = pinProblem(pin, again);
    if (problem) return setError(problem);
    if (await run(edit(person, { pin }), `${person.name}: PIN dəyişdi`)) setPinFor(null);
  };

  const branches = data?.branches ?? [];
  const branchName = (id: string) => (id === '' ? 'Bütün filiallar' : branches.find((b) => b.id === id)?.name ?? 'Bağlanmış filial');
  const groupIds = [...new Set(['', ...branches.map((b) => b.id), ...(data?.staff ?? []).map((p) => p.branchId)])]
    .filter((id) => (data?.staff ?? []).some((p) => p.branchId === id));
  const roleCounts = (counts: Record<string, number> | undefined) =>
    Object.entries(counts ?? {}).map(([role, n]) => `${roleLabel(role)}: ${n}`).join(' · ') || '—';
  const branchSelect = (value: string, onChange: (id: string) => void, label = 'Filial') => (
    <select aria-label={label} value={value} disabled={busy} onChange={(e) => onChange(e.target.value)}>
      <option value="">Bütün filiallar</option>
      {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      {value && !branches.some((b) => b.id === value) && <option value={value}>Bağlanmış filial</option>}
    </select>
  );

  return (
    <section className="card" id="staff" style={{ marginBottom: '1.2rem' }}>
      <div className="section-heading">
        <h2>İşçilər</h2>
        <small className="muted">{data ? roleCounts(data.counts) : '…'}</small>
      </div>
      <div className="gate-row" style={{ margin: '0 0 1rem' }}>
        <div className="gate-copy">
          <strong>Müdür icazələri</strong>
          <p className="muted" style={{ margin: 0 }}>Mağaza müdürünün kassada nə edə biləcəyini seçin (satış, kassa, məhsul, anbar, hesabat, sistem).</p>
        </div>
        <button type="button" className="btn primary" onClick={onManager}>Müdür icazələri</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {message && <p className="ok-line" role="status">{message}</p>}
      {adding ? (
        <form className="form-grid" onSubmit={(e) => void onAdd(e)} autoComplete="off" style={{ marginBottom: '1rem' }}>
          <label>
            Ad
            <input value={form.name} maxLength={80} required onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            Rol
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {STAFF_ROLES.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
            </select>
          </label>
          <label>
            Filial
            {branchSelect(form.branchId, (branchId) => setForm({ ...form, branchId }))}
          </label>
          <PinPair pin={pin} setPin={setPin} again={again} setAgain={setAgain} />
          <div className="role-chip-row">
            <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Saxlanır…' : 'Əlavə et'}</button>
            <button type="button" className="btn ghost" onClick={() => { setAdding(false); setError(null); }}>Ləğv et</button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn" style={{ marginBottom: '1rem' }}
          onClick={() => { setAdding(true); setPinFor(null); setPin(''); setAgain(''); setError(null); setMessage(null); }}>+ Yeni işçi</button>
      )}
      {!data ? null : !data.staff.length ? (
        <p className="muted">Hələ işçi yoxdur. "+ Yeni işçi" ilə əlavə edin və ya kassalar siyahını göndərsin (Market POS 1.5.32+).</p>
      ) : groupIds.map((groupId) => (
        <div key={groupId || 'all'} style={{ marginBottom: '1rem' }}>
          <div className="section-heading">
            <h3>{branchName(groupId)}</h3>
            <small className="muted">{roleCounts(data.branchCounts[groupId])}</small>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Ad</th><th>Rol</th><th>Status</th><th>Filial</th><th></th></tr>
              </thead>
              <tbody>
                {data.staff.filter((p) => p.branchId === groupId).map((person) => (
                  <tr key={person.id}>
                    <td>{person.name}</td>
                    <td>{roleLabel(person.role)}</td>
                    <td>{person.active ? 'Aktiv' : 'Passiv'}</td>
                    <td>{branchSelect(person.branchId, (branchId) => void run(edit(person, { branchId }), `${person.name}: filial dəyişdi`), `${person.name} filialı`)}</td>
                    <td>
                      {pinFor === person.id ? (
                        <form className="form-grid" onSubmit={(e) => void onPin(e, person)} autoComplete="off">
                          <PinPair pin={pin} setPin={setPin} again={again} setAgain={setAgain} />
                          <div className="role-chip-row">
                            <button type="submit" className="btn primary" disabled={busy}>Saxla</button>
                            <button type="button" className="btn ghost" onClick={() => setPinFor(null)}>Ləğv et</button>
                          </div>
                        </form>
                      ) : (
                        <div className="role-chip-row">
                          <button type="button" className="btn ghost" disabled={busy}
                            onClick={() => { setPinFor(person.id); setAdding(false); setPin(''); setAgain(''); setError(null); setMessage(null); }}>PIN dəyiş</button>
                          <button type="button" className="btn ghost" disabled={busy}
                            onClick={() => void run(edit(person, { active: !person.active }), `${person.name}: ${person.active ? 'deaktiv edildi' : 'aktiv edildi'}`)}>
                            {person.active ? 'Deaktiv et' : 'Aktiv et'}
                          </button>
                          <button type="button" className="btn ghost" onClick={() => onRights(person.id)}>Səlahiyyətlər</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  );
}

export function CustomerLivePage() {
  const t = useI18n();
  const {product:contextProduct,setProduct}=useProduct();
  const [search]=useSearchParams(),queryProduct=search.get('product'),selectedProduct=queryProduct==='market'||queryProduct==='restaurant'?queryProduct:contextProduct;
  useEffect(()=>{if((queryProduct==='market'||queryProduct==='restaurant')&&queryProduct!==contextProduct)setProduct(queryProduct);},[queryProduct]);
  const { customerId = '' } = useParams();
  const [data, setData] = useState<LiveSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!customerId) return;
    try {
      const snapshot = await api<LiveSnapshot>(`/customers/${customerId}/live?product=${selectedProduct}`);
      setData(snapshot);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.error);
    } finally {
      setLoading(false);
    }
  }, [customerId,selectedProduct,t.common.error]);

  useLiveEffect(() => { void load(); }, [load]);

  // Market workers as the customer's PCs synced them; a click opens that worker's rights below.
  const [staff, setStaff] = useState<StaffData | null>(null);
  const [pickWorker, setPickWorker] = useState<{ id: string; at: number } | null>(null);
  const [pickRole, setPickRole] = useState<{ name: string; at: number } | null>(null);
  const isMarket = selectedProduct==='market';
  const loadStaff = useCallback(async () => {
    setStaff(await api<StaffData>(`/customers/${customerId}/pos/staff?product=market`));
  }, [customerId]);
  useLiveEffect(() => {
    if (!customerId || !isMarket) return;
    loadStaff().catch(() => setStaff(null));
  }, [customerId, isMarket, loadStaff]);
  const saveStaff = async (input: StaffSave) => {
    await api(`/customers/${customerId}/pos/staff`, { method: 'POST', body: JSON.stringify(input) });
    await loadStaff().catch(() => undefined);
  };

  if (loading && !data) {
    return <div className="page muted">{t.loading}</div>;
  }

  if (error && !data) {
    return (
      <div className="page">
        <p className="error">{error}</p>
        <Link to="/sales" className="btn">
          ← {t.nav.sales}
        </Link>
      </div>
    );
  }

  if (!data) return null;

  const activeTables = data.floor.tables.filter(
    (table) => table.orderId || table.status === 'occupied' || table.status === 'billing',
  );

  return (
    <div className="page">
      <header className="page-header customer-live-hero">
        <div>
          <p className="eyebrow">
            <Link to="/sales">← {t.nav.sales}</Link>
          </p>
          <h1>{data.customer.name}</h1>
          <p className="muted">
            {[data.customer.email, data.customer.phone, data.customer.contactPerson]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <p className="muted compact-copy">{licenseLabel(data.license)}</p>
        </div>
        <div className="live-status-pill" data-online={data.connection.connected ? '1' : '0'}>
          <span className="health-pulse" />
          <strong>{connectionLabel(data.connection)}</strong>
          <small>{relativeTime(data.connection.lastSeenAt)}</small>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <nav className="detail-jump-nav" aria-label="Müştəri bölmələri">
        <a href="#status">Vəziyyət</a>
        <a href="#catalogue">Kataloq</a>
        {!isMarket&&<a href="#tables">Masalar</a>}
        <a href="#activity">Tarixçə</a>
      </nav>

      <section className="stat-grid live-stat-grid" id="status">
        <div className="stat">
          <span className="stat-label">{isMarket?'Satış sayı':t.live.openTables}</span>
          <div className="stat-value">{isMarket?(data.sales?.orderCount??'—'):data.floor.openTables}</div>
        </div>
        <div className="stat">
          <span className="stat-label">{isMarket?'Nağd ödənişlər':t.live.openTotal}</span>
          <div className="stat-value">{isMarket?(data.sales?money(data.sales.cashMinor):'—'):money(data.floor.openTotalMinor)}</div>
        </div>
        <div className="stat">
          <span className="stat-label">{t.live.todaySales}</span>
          <div className="stat-value">{money(data.floor.todaySalesMinor)}</div>
        </div>
        <div className="stat">
          <span className="stat-label">{isMarket?'Kart ödənişləri':t.live.tableCount}</span>
          <div className="stat-value">{isMarket?(data.sales?money(data.sales.cardMinor):'—'):(data.floor.allTablesCount || data.floor.tables.length)}</div>
        </div>
      </section>

      <div className="customer-live-grid" style={{ marginTop: '1.2rem' }}>
        <section className="card">
          <h2>{t.live.connection}</h2>
          <dl className="kv">
            <dt>{t.live.status}</dt>
            <dd>{connectionLabel(data.connection)}</dd>
            <dt>{t.live.lastSeen}</dt>
            <dd>{relativeTime(data.connection.lastSeenAt)}</dd>
            <dt>{t.live.version}</dt>
            <dd className="mono">{data.connection.appVersion ?? '—'}</dd>
            <dt>{isMarket?'Market':t.live.restaurant}</dt>
            <dd>{data.connection.restaurantName ?? data.customer.name}</dd>
            <dt>{t.live.businessDate}</dt>
            <dd>{data.floor.businessDate ?? '—'}</dd>

            {data.connection.lastError && (
              <>
                <dt>{t.live.lastError}</dt>
                <dd className="wrap-cell">{data.connection.lastError}</dd>
              </>
            )}
          </dl>
          {!data.connection.connected && (
            <p className="muted" style={{ marginTop: '.8rem' }}>
              {t.live.offlineHint}
            </p>
          )}
        </section>

        <section className="card">
          <h2>{t.live.salesBreakdown}</h2>
          {data.sales ? (
            <dl className="kv">
              <dt>{t.live.gross}</dt>
              <dd>{money(data.sales.grossMinor)}</dd>
              <dt>{t.live.net}</dt>
              <dd>{money(data.sales.netMinor)}</dd>
              <dt>{t.live.orders}</dt>
              <dd>
                {data.sales.orderCount} · {data.sales.paymentCount} ödəniş
              </dd>
              <dt>{t.live.cashCard}</dt>
              <dd>
                {money(data.sales.cashMinor)} / {money(data.sales.cardMinor)}
              </dd>
            </dl>
          ) : (
            <p className="muted">{t.live.noSales}</p>
          )}
        </section>
      </div>



      {isMarket && (
        <MarketStaffCard
          data={staff}
          save={saveStaff}
          onRights={(id) => {
            setPickWorker({ id, at: Date.now() });
            document.getElementById('catalogue')?.scrollIntoView({ behavior: 'smooth' });
          }}
          onManager={() => {
            setPickRole({ name: 'manager', at: Date.now() });
            document.getElementById('catalogue')?.scrollIntoView({ behavior: 'smooth' });
          }}
        />
      )}

      <section className="customer-catalogue" id="catalogue">
        <div className="section-heading catalogue-heading">
          <div>
            <p className="eyebrow">Kataloq</p>
            <h2>Müştəri paneli və kassa icazələri</h2>
            <p className="muted compact-copy">Əvvəl sayt və kassa bölmələrini açıb bağlayın, sonra işçi rollarını tənzimləyin.</p>
          </div>
        </div>
        <div className="catalogue-stack">
          <CustomerPosLicenses customerId={customerId} />
      <ModuleGates customerId={customerId} />
          <RolePolicyEditor
            subtitle={data.customer.name}
            load={(product) =>
              api(`/customers/${data.customer.id}/pos/roles?product=${product}`)
            }
            save={(roles, product, users) =>
              api(`/customers/${data.customer.id}/pos/roles?product=${product}`, {
                method: 'PUT',
                body: JSON.stringify(users ? { roles, users } : { roles }),
              })
            }
            pickWorker={pickWorker}
            pickRole={pickRole}
            loadStaff={async () =>
              (await api<{ staff: StaffRow[] }>(`/customers/${data.customer.id}/pos/staff?product=market`)).staff
            }
            saveEntitlements={(input, product) =>
              api(`/customers/${data.customer.id}/pos/entitlements?product=${product}`, {
                method: 'PUT',
                body: JSON.stringify(input),
              })
            }
          />
        </div>
      </section>

      {!isMarket&&<section className="card" id="tables" style={{ marginTop: '1.2rem' }}>
        <div className="section-heading">
          <h2>{t.live.tablesTitle}</h2>
          <small className="muted">
            {activeTables.length} {t.live.activeOf} {data.floor.tables.length}
          </small>
        </div>
        {data.floor.tables.length === 0 ? (
          <p className="muted">{data.connection.connected ? t.live.noTablesYet : t.live.noSnapshot}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t.live.colTable}</th>
                  <th>{t.live.colArea}</th>
                  <th>{t.live.colStatus}</th>
                  <th>{t.live.colGuests}</th>
                  <th>{t.live.colTotal}</th>
                  <th>{t.live.colDue}</th>
                  <th>{t.live.colWaiter}</th>
                </tr>
              </thead>
              <tbody>
                {data.floor.tables.map((table) => (
                  <tr key={table.id}>
                    <td>{table.label}</td>
                    <td>{table.areaName ?? '—'}</td>
                    <td>{statusLabel(table.status)}</td>
                    <td>{table.guestCount || '—'}</td>
                    <td>{money(table.totalMinor)}</td>
                    <td>{table.dueMinor > 0 ? money(table.dueMinor) : '—'}</td>
                    <td>{table.waiterName ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>}

      <div className="split" id="activity" style={{ marginTop: '1.2rem' }}>
        <section className="card">
          <h2>{t.live.notifications}</h2>
          {data.notifications.length === 0 ? (
            <p className="muted">{t.live.emptyNotifications}</p>
          ) : (
            <ul className="live-feed">
              {data.notifications.map((row) => (
                <li key={row.id}>
                  <strong>{row.title}</strong>
                  <span>{row.body}</span>
                  <small>{relativeTime(row.createdAt)}</small>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2>{t.live.events}</h2>
          {data.events.length === 0 ? (
            <p className="muted">{t.live.emptyEvents}</p>
          ) : (
            <ul className="live-feed">
              {data.events.map((row) => (
                <li key={row.id}>
                  <strong className="mono">{row.action}</strong>
                  <small>{relativeTime(row.createdAt)}</small>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <p className="muted" style={{ marginTop: '1rem' }}>
        {t.live.refreshed}: {new Date(data.fetchedAt).toLocaleTimeString('az-AZ')}
      </p>
    </div>
  );
}
