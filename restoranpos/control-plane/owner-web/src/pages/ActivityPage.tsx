import { useCallback,useEffect, useMemo, useState } from 'react';
import {usePolling} from '../hooks/usePolling';
import {useAuth} from '../auth/AuthContext';
import {ownerProductLabels} from '../api';
import { activity, markNotificationRead, type NotificationItem } from '../api';
import { Icon } from '../ui/Icon';
import { PageHeader, Pagination } from '../ui/navigation';
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from '../ui/primitives';
import { useToast } from '../ui/overlays';

const PAGE_SIZE = 10;

export default function ActivityPage() {
  const {selectedProduct}=useAuth();
  const fetchActivity=useCallback(()=>activity(),[selectedProduct]);
  const state=usePolling(fetchActivity,15000);
  const [data,setData]=useState<Awaited<ReturnType<typeof activity>>|null>(null);
  useEffect(()=>{setData(state.data);},[state.data]);
  const [tab,setTab]=useState<'notifications'|'events'>('notifications');
  const [filter,setFilter]=useState<'all'|'unread'>('all');
  const [page,setPage]=useState(1);
  const {show}=useToast();
  const loading=state.loading,error=state.error?.message;
  const load=()=>state.reload();
  useEffect(() => setPage(1), [filter, tab]);

  const notifications = useMemo(
    () => (data?.notifications ?? []).filter((item) => filter === 'all' || !item.readAt),
    [data?.notifications, filter],
  );
  const source = tab === 'notifications' ? notifications : (data?.events ?? []);
  const pages = Math.max(1, Math.ceil(source.length / PAGE_SIZE));
  const visible = source.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const unread = data?.notifications.filter((item) => !item.readAt).length ?? 0;

  if (loading) return <ActivitySkeleton />;
  if (error || !data) {
    return <ErrorState title="Fəaliyyət yüklənmədi" description={error || 'Yenidən cəhd edin.'} action={<Button icon="refresh" onClick={() => void load()}>Yenidən yoxla</Button>} />;
  }

  const markRead = async (item: NotificationItem) => {
    if (item.readAt) return;
    try {
      await markNotificationRead(item.id);
      setData((current) => current ? {
        ...current,
        notifications: current.notifications.map((row) =>
          row.id === item.id ? { ...row, readAt: new Date().toISOString() } : row,
        ),
      } : current);
    } catch (cause) {
      show({ tone: 'danger', title: 'Bildiriş yenilənmədi', message: cause instanceof Error ? cause.message : undefined });
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={selectedProduct?ownerProductLabels[selectedProduct]+' · Tarixçə':'Tarixçə'}
        title="Fəaliyyət və bildirişlər"
        description="Hesab bildirişləri və sistem tarixçəsi. Ümumi hesab hadisələri bütün POS-lar üçün ortaqdır; filial əməliyyatları seçilmiş POS-un qaimələrində açılır."
        actions={unread ? <Button variant="secondary" icon="check" onClick={() => {
          void markNotificationRead().then(() => {
            setData((current) => current ? { ...current, notifications: current.notifications.map((row) => ({ ...row, readAt: row.readAt || new Date().toISOString() })) } : current);
          }).catch(cause=>show({tone:'danger',title:'Bildirişlər yenilənmədi',message:cause instanceof Error?cause.message:undefined}));
        }}>Hamısını oxunmuş et</Button> : undefined}
      />

      <div className="activity-toolbar">
        <div className="segmented" role="tablist" aria-label="Fəaliyyət növü">
          <button type="button" role="tab" aria-selected={tab === 'notifications'} onClick={() => setTab('notifications')}>
            Bildirişlər {unread ? <span>{unread}</span> : null}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'events'} onClick={() => setTab('events')}>Sistem hadisələri</button>
        </div>
        {tab === 'notifications' ? (
          <div className="filter-buttons" aria-label="Bildiriş filtri">
            <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Hamısı</button>
            <button type="button" className={filter === 'unread' ? 'active' : ''} onClick={() => setFilter('unread')}>Oxunmamış</button>
          </div>
        ) : null}
      </div>

      <Card className="activity-page-card">
        {visible.length === 0 ? (
          <EmptyState
            title={tab === 'notifications' ? 'Bildiriş tapılmadı' : 'Sistem hadisəsi yoxdur'}
            description={filter === 'unread' ? 'Bütün bildirişləri oxumusunuz.' : 'Yeni fəaliyyət burada tarix sırası ilə görünəcək.'}
          />
        ) : tab === 'notifications' ? (
          <div className="notification-list" role="tabpanel">
            {(visible as NotificationItem[]).map((item) => (
              <button
                key={item.id}
                type="button"
                className={`notification-row ${item.readAt ? '' : 'unread'}`}
                onClick={() => void markRead(item)}
              >
                <span className={`activity-icon ${toneForKind(item.kind)}`}><Icon name={iconForKind(item.kind)} size={19} /></span>
                <span className="notification-copy"><strong>{item.title}</strong><small>{item.body || 'Əlavə məlumat yoxdur'}</small></span>
                <span className="notification-meta"><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('az-AZ')}</time>{item.readAt ? <Badge>Oxunub</Badge> : <Badge tone="info">Yeni</Badge>}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="event-list" role="tabpanel">
            {(visible as Awaited<ReturnType<typeof activity>>['events']).map((event) => (
              <div className="event-row" key={event.id}>
                <span className="event-dot" />
                <div><strong>{eventLabel(event.action)}</strong><small>{event.entityType ? `${event.entityType} · ` : ''}{new Date(event.createdAt).toLocaleString('az-AZ')}</small></div>

              </div>
            ))}
          </div>
        )}
        <Pagination page={page} pages={pages} onChange={setPage} />
      </Card>
    </div>
  );
}

function toneForKind(kind: string) {
  if (kind.includes('z_') || kind.includes('offline')) return 'activity-warning';
  if (kind.includes('error')) return 'activity-danger';
  return 'activity-info';
}

function iconForKind(kind: string): 'warning' | 'wifi-off' | 'activity' | 'bell' {
  if (kind.includes('offline')) return 'wifi-off';
  if (kind.includes('error')) return 'warning';
  if (kind.includes('report')) return 'activity';
  return 'bell';
}

function eventLabel(action: string) {
  const labels: Record<string, string> = {
    'customer.register': 'Müştəri hesabı yaradıldı',
    'customer.login': 'Hesaba giriş edildi',
    'customer.profile_update': 'Biznes məlumatları yeniləndi',
    'customer.setup_download': 'Quraşdırma faylı yükləndi',
    'customer.setup_verified': 'POS bağlantısı təsdiqləndi',
    'customer.password_change': 'Şifrə dəyişdirildi',
    'customer.password_reset': 'Şifrə bərpa edildi',
    'customer.support_upload': 'Diaqnostika faylı göndərildi',
  };
  return labels[action] || 'Hesab əməliyyatı';
}

function ActivitySkeleton() {
  return (
    <div className="page-stack" aria-busy="true">
      <Skeleton width={180} /><Skeleton width="60%" height={42} />
      <Skeleton width="100%" height={54} />
      <Skeleton width="100%" height={520} />
    </div>
  );
}
