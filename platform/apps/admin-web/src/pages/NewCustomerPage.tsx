import { useI18n } from '../i18n';
import { SaleForm } from '../components/SaleForm';

/** Birbaşa (bayisiz) müştəri satışı — bayilərin panelindəki formun super admin qarşılığı. */
export function NewCustomerPage() {
  const t = useI18n();
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t.brandSub}</p>
          <h1>{t.newCustomer.title}</h1>
        </div>
      </header>
      <p className="muted" style={{ marginBottom: '1.2rem' }}>
        {t.newCustomer.hint}
      </p>

      <SaleForm />
    </div>
  );
}
