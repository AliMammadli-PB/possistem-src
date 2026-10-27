import Link from 'next/link';
import { LeadForm } from '@/components/marketing/LeadForm';
import { MarketingLayout } from '@/components/marketing/MarketingLayout';
import './legal-contact-pages.css';

function ContactIcon({ name }: { name: 'phone' | 'mail' | 'map' }) {
  const common = {
    viewBox: '0 0 24 24',
    width: 22,
    height: 22,
    'aria-hidden': true,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (name === 'phone') return <svg {...common}><path d="M6.5 4.5h2.6l1.2 3-1.7 1a11 11 0 0 0 5.9 5.9l1-1.7 3 1.2v2.6a1.5 1.5 0 0 1-1.6 1.5A13.5 13.5 0 0 1 5 6.1a1.5 1.5 0 0 1 1.5-1.6Z" /></svg>;
  if (name === 'mail') return <svg {...common}><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m4 7 8 6 8-6" /></svg>;
  return <svg {...common}><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></svg>;
}

export function ContactPage() {
  return (
    <MarketingLayout solidHeader currentNav="information">
      <div className="policy-page contact-page">
        <section className="policy-hero">
          <div className="marketing-container">
            <nav className="breadcrumbs" aria-label="Səhifə yolu"><Link href="/">Ana səhifə</Link><span>/</span><span>Əlaqə</span></nav>
            <div className="policy-hero-grid">
              <div>
                <p className="policy-kicker">POSSİSTEM / ƏLAQƏ</p>
                <h1>Bizimlə rahat əlaqə saxlayın</h1>
              </div>
              <p>Satış, quraşdırma, məhsul seçimi və hesabla bağlı müraciətinizi uyğun kanaldan göndərin. Texniki problem üçün birbaşa dəstək bölməsindən də yaza bilərsiniz.</p>
            </div>
          </div>
        </section>

        <section className="marketing-container contact-directory" aria-label="Əlaqə məlumatları">
          <a className="contact-method" href="tel:+994513333555">
            <span className="contact-method-icon"><ContactIcon name="phone" /></span>
            <span><small>Telefon</small><strong>+994 51 3333 555</strong><em>Zəng etmək üçün toxunun</em></span>
          </a>
          <a className="contact-method" href="mailto:support@possistem.az">
            <span className="contact-method-icon"><ContactIcon name="mail" /></span>
            <span><small>E-poçt</small><strong>support@possistem.az</strong><em>Müraciətinizi yazılı göndərin</em></span>
          </a>
          <div className="contact-method">
            <span className="contact-method-icon"><ContactIcon name="map" /></span>
            <span><small>Ünvan</small><strong>Ziya Bünyadov Pr. 5/7</strong><em>Bakı, Azərbaycan</em></span>
          </div>
        </section>

        <section className="marketing-container contact-workspace">
          <aside className="contact-guide">
            <p className="policy-kicker">DÜZGÜN KANALI SEÇİN</p>
            <h2>Müraciətiniz daha tez doğru yerə çatsın</h2>
            <ul>
              <li><span>01</span><div><strong>Texniki problem</strong><p>POS, anbar, printer, giriş və yeniləmə problemlərini dəstəyə yazın.</p></div></li>
              <li><span>02</span><div><strong>Məhsul və quraşdırma</strong><p>Formada biznes növünüzü və ehtiyacınızı qeyd edin.</p></div></li>
              <li><span>03</span><div><strong>Hesab və sifariş</strong><p>Müştəri panelində ödəniş və sifariş tarixçənizi izləyin.</p></div></li>
            </ul>
            <div className="contact-guide-actions">
              <Link className="policy-action primary" href="/destek/">Texniki dəstək</Link>
              <Link className="policy-action" href="/pos/app/login/">Müştəri girişi</Link>
            </div>
            <p className="contact-data-note">Formanı göndərməklə müraciətə cavab vermək üçün daxil etdiyiniz məlumatların işlənməsini qəbul edirsiniz. <Link href="/mexfilik/">Məxfilik siyasətinə baxın</Link>.</p>
          </aside>
          <div className="contact-form-shell">
            <LeadForm />
          </div>
        </section>
      </div>
    </MarketingLayout>
  );
}
