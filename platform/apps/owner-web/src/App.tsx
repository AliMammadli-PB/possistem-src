import {
  Component,
  Suspense,
  lazy,
  useEffect,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { PublicOnly, RequireAuth } from './auth/AuthContext';
import { erpItem } from './erp-menu';
import { AppShell } from './ui/AppShell';
import { Button, ErrorState, Skeleton } from './ui/primitives';
import {
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
} from './pages/AuthPages';

const OrdersPage = lazy(() => import('./pages/OrdersPage'));
const BillingPage = lazy(() => import('./pages/BillingPage'));
const InvoicePage = lazy(() => import('./pages/InvoicePage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const SetupPage = lazy(() => import('./pages/SetupPage'));
const DownloadsPage = lazy(() => import('./pages/DownloadsPage'));
const ActivityPage = lazy(() => import('./pages/ActivityPage'));
const IntegrationsPage = lazy(() => import('./pages/IntegrationsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const SupportPage = lazy(() => import('./pages/SupportPage'));
const ChatPage = lazy(() => import('./pages/ChatPage'));
const TablesPage = lazy(() => import('./pages/TablesPage'));
const InventoryPage = lazy(() => import('./pages/InventoryPage'));
const OperationsPage = lazy(() => import('./pages/OperationsPage'));
const WarehousePage = lazy(() => import('./pages/WarehousePage'));
const OnboardingPage = lazy(() => import('./pages/OnboardingPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

const titles: Record<string, string> = {
  '/': 'Ana səhifə',
  '/login': 'Müştəri girişi',
  '/register': 'Hesab yaradın',
  '/forgot-password': 'Şifrə bərpası',
  '/reset-password': 'Yeni şifrə',
  '/setup': 'Quraşdırma',
  '/downloads': 'Yükləmələr',
  '/activity': 'Fəaliyyət',
  '/masalar': 'Masalar',
  '/chat': 'Chat',
  '/anbar': 'Anbar',
  '/emeliyyat': 'Satış və hesabat',
  '/integrations': 'İnteqrasiyalar',
  '/settings/profile': 'Profil',
  '/settings/security': 'Təhlükəsizlik',
  '/settings/notifications': 'Bildirişlər',
  '/support': 'Dəstək',
  '/abunelik': 'Abunəlik və ödənişlər',
};

function RouteEffects() {
  const location = useLocation();
  useEffect(() => {
    const erp = location.pathname.startsWith('/erp/') ? erpItem(location.pathname.slice(5)) : null;
    const base = erp
      ? erp.label
      : location.pathname.startsWith('/onboarding')
        ? 'Quraşdırma'
        : location.pathname.startsWith('/faturalar/') ? 'Faktura' : titles[location.pathname] || 'Müştəri portalı';
    document.title = `${base} · possistem`;
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('main h1[tabindex="-1"], main h1')?.focus({
        preventScroll: true,
      });
    });
  }, [location.pathname]);
  return null;
}

function ProtectedShell({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <AppShell>{children}</AppShell>
    </RequireAuth>
  );
}

function PageLoader() {
  return (
    <div className="route-loader" aria-busy="true" aria-label="Səhifə yüklənir">
      <Skeleton width={150} />
      <Skeleton width="55%" height={42} />
      <Skeleton width="100%" height={240} />
    </div>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('customer_portal_render_error', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="fatal-error">
          <ErrorState
            title="Səhifə gözlənilmədən dayandı"
            description="Məlumatlarınız dəyişdirilmədi. Səhifəni yeniləyib yenidən cəhd edin."
            action={<Button icon="refresh" variant="primary" onClick={() => window.location.reload()}>Səhifəni yenilə</Button>}
          />
        </main>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <RouteEffects />
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
          <Route path="/register" element={<PublicOnly><Navigate to="/login" replace /></PublicOnly>} />
          <Route path="/forgot-password" element={<PublicOnly><ForgotPasswordPage /></PublicOnly>} />
          <Route path="/reset-password" element={<PublicOnly><ResetPasswordPage /></PublicOnly>} />

          <Route path="/onboarding/:step" element={<RequireAuth><OnboardingPage /></RequireAuth>} />
          <Route path="/" element={<ProtectedShell><DashboardPage /></ProtectedShell>} />
          <Route path="/setup" element={<ProtectedShell><SetupPage /></ProtectedShell>} />
          <Route path="/downloads" element={<ProtectedShell><DownloadsPage /></ProtectedShell>} />
          <Route path="/sifarisler" element={<ProtectedShell><OrdersPage /></ProtectedShell>} />
          <Route path="/abunelik" element={<ProtectedShell><BillingPage /></ProtectedShell>} />
          <Route path="/faturalar/:id" element={<ProtectedShell><InvoicePage /></ProtectedShell>} />
          <Route path="/activity" element={<ProtectedShell><ActivityPage /></ProtectedShell>} />
          <Route path="/masalar" element={<ProtectedShell><TablesPage /></ProtectedShell>} />
          <Route path="/chat" element={<ProtectedShell><ChatPage /></ProtectedShell>} />
          <Route path="/erp/:key" element={<ProtectedShell><WarehousePage /></ProtectedShell>} />
          <Route path="/anbar" element={<ProtectedShell><WarehousePage /></ProtectedShell>} />
          <Route path="/emeliyyat" element={<ProtectedShell><WarehousePage /></ProtectedShell>} />
          <Route path="/notifications" element={<Navigate to="/activity" replace />} />
          <Route path="/integrations" element={<ProtectedShell><IntegrationsPage /></ProtectedShell>} />
          <Route path="/settings/:section" element={<ProtectedShell><SettingsPage /></ProtectedShell>} />
          <Route path="/support" element={<ProtectedShell><SupportPage /></ProtectedShell>} />
          <Route path="*" element={<RequireAuth><NotFoundPage /></RequireAuth>} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
