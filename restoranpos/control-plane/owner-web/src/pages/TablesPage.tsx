import { useCallback, useState } from 'react';
import { customerTables, formatMoney, type LiveTable } from '../api';
import { usePolling } from '../hooks/usePolling';
import { Icon } from '../ui/Icon';
import { PageHeader } from '../ui/navigation';
import { Badge, Button, Card, EmptyState, ErrorState, LinkButton, Skeleton } from '../ui/primitives';

/** Live floor: which tables are taken, by whom, and what is on them. The till syncs every ~5 s. */

const isOpen = (t: LiveTable) => Boolean(t.orderId) || t.status === 'occupied' || t.status === 'billing';

function since(value: string | null | undefined) {
  if (!value) return '';
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (Number.isNaN(minutes)) return '';
  if (minutes < 1) return 'indicə';
  if (minutes < 60) return `${minutes} dəq`;
  return `${Math.floor(minutes / 60)} saat ${minutes % 60} dəq`;
}

function clock(value: string | undefined) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit' });
}

function TableCard({ table }: { table: LiveTable }) {
  const open = isOpen(table);
  const billing = table.status === 'billing';
  const due = Math.max(0, table.totalMinor - table.paidMinor);
  return (
    <Card className={`live-table ${open ? (billing ? 'is-billing' : 'is-open') : 'is-free'}`}>
      <div className="live-table-head">
        <div>
          <strong>{table.label || table.id}</strong>
          {table.areaName ? <small>{table.areaName}</small> : null}
        </div>
        {open ? (
          <Badge tone={billing ? 'warning' : 'info'}>{billing ? 'Hesab çap olunub' : 'Dolu'}</Badge>
        ) : (
          <Badge tone="success">Boş</Badge>
        )}
      </div>
      {open ? (
        <>
          <dl className="live-table-facts">
            {table.waiterName ? <div><dt>Ofisiant</dt><dd>{table.waiterName}</dd></div> : null}
            {table.guestCount ? <div><dt>Qonaq</dt><dd>{table.guestCount} nəfər</dd></div> : null}
            {table.openedAt ? <div><dt>Açılıb</dt><dd>{clock(table.openedAt)} · {since(table.openedAt)}</dd></div> : null}
            <div><dt>Məbləğ</dt><dd>{formatMoney(table.totalMinor)}</dd></div>
            {table.paidMinor > 0 ? <div><dt>Qalıq</dt><dd>{formatMoney(due)}</dd></div> : null}
          </dl>
          {table.items?.length ? (
            <ul className="live-table-items">
              {table.items.map((item, index) => (
                <li key={index}>
                  <span>{item.name}</span>
                  <b>×{Number(item.quantity.toFixed(3))}</b>
                </li>
              ))}
            </ul>
          ) : table.itemCount ? (
            <p className="live-table-note">{table.itemCount} məhsul · təfərrüatlar POS-dan gələn son nüsxədə görünür</p>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

export default function TablesPage() {
  const loader = useCallback(() => customerTables(), []);
  const state = usePolling(loader, 5_000);
  const [onlyOpen, setOnlyOpen] = useState(false);

  if (state.loading) {
    return (
      <div className="page-stack">
        <Skeleton width={180} height={36} />
        <Skeleton width="100%" height={260} />
      </div>
    );
  }
  if (!state.data) {
    return (
      <ErrorState
        title="Masalar yüklənmədi"
        description="İnternet bağlantısını yoxlayıb yenidən cəhd edin."
        action={<Button icon="refresh" onClick={() => void state.reload()}>Yenidən yoxla</Button>}
      />
    );
  }

  const data = state.data;
  const tables = onlyOpen ? data.tables.filter(isOpen) : data.tables;
  const openCount = data.tables.filter(isOpen).length;
  const guests = data.tables.filter(isOpen).reduce((sum, t) => sum + (t.guestCount ?? 0), 0);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Canlı zal"
        title="Masalar"
        description={
          data.updatedAt
            ? `${data.connected ? 'Kassa qoşulub' : 'Kassa oflayndır'} · son yenilənmə ${since(data.updatedAt)}${since(data.updatedAt) === 'indicə' ? '' : ' əvvəl'}`
            : 'Kassadan hələ məlumat gəlməyib'
        }
        actions={
          <Button icon="refresh" variant="secondary" onClick={() => void state.reload()} disabled={state.refreshing}>
            Yenilə
          </Button>
        }
      />

      {data.tables.length === 0 ? (
        <EmptyState
          title="Masa məlumatı yoxdur"
          description="Restoran POS qoşulduqdan sonra masalar burada canlı görünəcək."
          action={<LinkButton to="/setup" size="sm">Quraşdırmaya baxın</LinkButton>}
        />
      ) : (
        <>
          <div className="live-table-summary">
            <span><Icon name="table" size={16} /> {openCount} / {data.tables.length} masa dolu</span>
            {guests ? <span>{guests} qonaq</span> : null}
            <span>Açıq hesablar: {formatMoney(data.openTotalMinor)}</span>
            <label>
              <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
              Yalnız dolu masalar
            </label>
          </div>
          <div className="live-table-grid">
            {tables.map((table) => <TableCard key={table.id} table={table} />)}
          </div>
        </>
      )}
    </div>
  );
}
