import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { ProductProvider } from './lib/product';
import { I18nProvider, useI18n } from './i18n';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { DashboardPage } from './pages/DashboardPage';
import { AdminPanelsPage } from './pages/AdminPanelsPage';
import { NewCustomerPage } from './pages/NewCustomerPage';
import { SalesPage } from './pages/SalesPage';
import { CustomerLivePage } from './pages/CustomerLivePage';
import { LeadsPage } from './pages/LeadsPage';
import { SupportServicePage } from './pages/SupportServicePage';
import { SupportPage } from './pages/SupportPage';
import { SetupPage } from './pages/SetupPage';
import { SettingsPage } from './pages/SettingsPage';
import { ProductsPage } from './pages/ProductsPage';
import { PartnersPage } from './pages/PartnersPage';
import { BillingPage } from './pages/BillingPage';


function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const t = useI18n();
  if (loading) return <div className="auth-page muted">{t.loading}</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  const { user, loading } = useAuth();
  const t = useI18n();

  return (
    <Routes>
      <Route
        path="/login"
        element={
          loading ? (
            <div className="auth-page muted">{t.loading}</div>
          ) : user && !user.mustChangePassword ? (
            <Navigate to="/" replace />
          ) : user?.mustChangePassword ? (
            <Navigate to="/change-password" replace />
          ) : (
            <LoginPage />
          )
        }
      />
      <Route
        path="/change-password"
        element={
          loading ? (
            <div className="auth-page muted">{t.loading}</div>
          ) : !user ? (
            <Navigate to="/login" replace />
          ) : (
            <ChangePasswordPage />
          )
        }
      />
      <Route
        element={
          <Protected>
            <AppShell />
          </Protected>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="admins" element={<AdminPanelsPage />} />
        <Route path="new-customer" element={<NewCustomerPage />} />
        <Route path="sales" element={<SalesPage />} />
        <Route path="sales/:customerId" element={<CustomerLivePage />} />
        <Route path="leads" element={<LeadsPage />} />
        <Route path="support" element={<SupportPage />} />
        <Route path="support-service" element={<SupportServicePage />} />
        <Route path="support/:ticketId" element={<SupportPage />} />
        <Route path="setup" element={<SetupPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="partners" element={<PartnersPage />} />
        <Route path="plans" element={<Navigate to="/billing/subscriptions" replace />} />
        <Route path="billing/:section" element={<BillingPage />} />
        <Route path="package-builder" element={<Navigate to="/products" replace />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <ProductProvider>
          <AppRoutes />
        </ProductProvider>
      </AuthProvider>
    </I18nProvider>
  );
}
