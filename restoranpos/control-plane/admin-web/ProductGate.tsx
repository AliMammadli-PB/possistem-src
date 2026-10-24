import brandLogo from '../assets/possistem-logo.png';
import { useI18n } from '../i18n';
import { POS_PRODUCTS, useProduct, type PosProduct } from '../lib/product';

/**
 * The question the panel should have been asking all along.
 *
 * Both products are sold from the same panel, and almost every screen means
 * something different depending on which one you are looking at - a licence
 * count, an installer, an open support request. The switch in the topbar was
 * already there, but it defaulted silently to Restaurant, so an operator who
 * came in for Market read restaurant numbers with nothing on screen saying so.
 *
 * Asked once, then remembered. The topbar switch still changes it afterwards;
 * this only makes the first answer deliberate instead of assumed.
 */
const BLURB: Record<PosProduct, { title: string; lines: string[] }> = {
  market: {
    title: 'Market POS',
    lines: ['Marketlər və mağazalar', 'Barkod, çəki, anbar, kassa növbəsi'],
  },
  restaurant: {
    title: 'Restoran POS',
    lines: ['Restoran və kafelər', 'Masa, mətbəx ekranı, ofisiant, çatdırılma'],
  },
};

export function ProductGate() {
  const { setProduct } = useProduct();
  const t = useI18n();

  return (
    <div className="product-gate-page">
      <section className="card product-gate">
        <img className="product-gate-mark" src={brandLogo} alt="possistem" />
        <h1 className="product-gate-title">{t.gate.title}</h1>
        <p className="muted product-gate-hint">{t.gate.hint}</p>

        <div className="product-gate-grid">
          {POS_PRODUCTS.map((value) => (
            <button
              key={value}
              type="button"
              className="product-gate-card"
              onClick={() => setProduct(value)}
            >
              <strong>{BLURB[value].title}</strong>
              {BLURB[value].lines.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </button>
          ))}
        </div>

        <p className="muted product-gate-foot">{t.gate.foot}</p>
      </section>
    </div>
  );
}
