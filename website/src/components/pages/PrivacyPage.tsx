import Link from 'next/link';
import { MarketingLayout } from '@/components/marketing/MarketingLayout';
import './legal-contact-pages.css';

const SECTIONS = [
  ['scope', 'Siyasətin əhatəsi'],
  ['data', 'Toplanan məlumatlar'],
  ['purpose', 'İstifadə məqsədləri'],
  ['payments', 'Ödənişlər və kartlar'],
  ['sharing', 'Məlumatın paylaşılması'],
  ['storage', 'Saxlanma və təhlükəsizlik'],
  ['rights', 'Hüquqlarınız'],
  ['cookies', 'Yerli yaddaş və kukilər'],
] as const;

export function PrivacyPage() {
  return (
    <MarketingLayout solidHeader>
      <div className="policy-page privacy-page">
        <section className="policy-hero">
          <div className="marketing-container">
            <nav className="breadcrumbs" aria-label="Səhifə yolu"><Link href="/">Ana səhifə</Link><span>/</span><span>Məxfilik siyasəti</span></nav>
            <div className="policy-hero-grid">
              <div>
                <p className="policy-kicker">POSSİSTEM / HÜQUQİ MƏLUMAT</p>
                <h1>Məxfilik siyasəti</h1>
              </div>
              <div className="policy-summary">
                <p>Bu sənəd possistem.az saytı, müştəri paneli, Market POS, Restoran POS və dəstək kanallarından istifadə zamanı məlumatların necə toplandığını və qorunduğunu izah edir.</p>
                <span>Son yenilənmə: 27 oktyabr 2026</span>
              </div>
            </div>
          </div>
        </section>

        <div className="marketing-container policy-layout">
          <aside className="policy-nav">
            <p>Mündəricat</p>
            <nav aria-label="Məxfilik siyasətinin bölmələri">
              {SECTIONS.map(([id, label], index) => <a key={id} href={`#${id}`}><span>{String(index + 1).padStart(2, '0')}</span>{label}</a>)}
            </nav>
            <div className="policy-contact-card">
              <small>Məxfilik sorğusu</small>
              <a href="mailto:support@possistem.az">support@possistem.az</a>
              <a href="tel:+994513333555">+994 51 3333 555</a>
            </div>
          </aside>

          <article className="policy-article">
            <section id="scope">
              <span className="policy-number">01</span>
              <div><h2>Siyasətin əhatəsi</h2><p>Bu siyasət Possistem xidmətlərindən istifadə edən ziyarətçilərə, müştərilərə, onların səlahiyyətli əməkdaşlarına və bizimlə əlaqə saxlayan şəxslərə aiddir. Məlumatların işlənilməsinin məqsədini Possistem müəyyən edir və məxfiliklə bağlı müraciətləri aşağıdakı əlaqə kanalları vasitəsilə qəbul edir.</p><p>Ünvan: Ziya Bünyadov prospekti 5/7, Bakı, Azərbaycan. E-poçt: <a href="mailto:support@possistem.az">support@possistem.az</a>. Telefon: <a href="tel:+994513333555">+994 51 3333 555</a>.</p></div>
            </section>

            <section id="data">
              <span className="policy-number">02</span>
              <div><h2>Hansı məlumatları toplayırıq</h2><ul>
                <li><strong>Əlaqə məlumatları:</strong> ad, biznesin adı, telefon, şəhər, e-poçt və göndərdiyiniz mesaj.</li>
                <li><strong>Hesab məlumatları:</strong> giriş e-poçtu, profil məlumatları, rol və icazələr, filial və cihaz əlaqələri.</li>
                <li><strong>Sifariş və abunəlik:</strong> seçilən məhsullar, say, təhvil məlumatları, sifariş və ödəniş statusu, məbləğ və tarixçə.</li>
                <li><strong>Dəstək məlumatları:</strong> söhbət mətni, problem hesabatı, əlavə etdiyiniz şəkillər və cavab tarixçəsi.</li>
                <li><strong>Texniki məlumatlar:</strong> IP ünvanı, brauzer və cihaz məlumatı, ziyarət edilən səhifə, təhlükəsizlik və xəta jurnalları.</li>
              </ul></div>
            </section>

            <section id="purpose">
              <span className="policy-number">03</span>
              <div><h2>Məlumatlardan nə üçün istifadə edirik</h2><p>Məlumatları müraciətinizə cavab vermək, hesabı və POS xidmətlərini təqdim etmək, sifariş və ödənişləri icra etmək, texniki dəstək göstərmək, təhlükəsizliyi qorumaq, sui-istifadənin qarşısını almaq və qanuni öhdəlikləri yerinə yetirmək üçün işləyirik.</p><p>Məqsəd üçün zəruri olmayan xüsusi kateqoriyalı məlumatları göndərməyin. Marketinq mesajları yalnız ayrıca razılığınız və ya qanunla icazə verilən əsas olduqda göndərilir.</p></div>
            </section>

            <section id="payments">
              <span className="policy-number">04</span>
              <div><h2>Ödəniş və kart məlumatları</h2><p>Kartın tam nömrəsi, CVV kodu və bank autentifikasiya məlumatları Possistem serverində saxlanmır. Kart məlumatları Epoint və ödənişi həyata keçirən bankın qorunan səhifəsində daxil edilir və onlar tərəfindən emal olunur.</p><p>Ödənişin təsdiqi, geri qaytarma və avtomatik yenilənmə üçün biz əməliyyat nömrəsi, məbləğ, status, tarix, kartın maskalanmış görünüşü və Epoint tərəfindən verilən qorunan kart identifikatoru kimi texniki məlumatları saxlaya bilərik. Avtomatik yenilənmə yalnız ayrıca razılıq verdikdə aktiv edilir.</p></div>
            </section>

            <section id="sharing">
              <span className="policy-number">05</span>
              <div><h2>Məlumat kimlərlə paylaşılır</h2><p>Məlumat yalnız xidmətin göstərilməsi üçün zəruri olduqda Epoint və bank, hostinq və e-poçt infrastrukturu, çatdırılma tərəfdaşı və texniki xidmət təminatçıları ilə, onların funksiyası üçün lazım olan həcmdə paylaşılır. Qanuni tələb olduqda məlumat səlahiyyətli dövlət orqanlarına təqdim edilə bilər.</p><p>Fərdi məlumatları satmırıq. Xidmət təminatçıları məlumatı öz məqsədləri üçün istifadə etməməli və uyğun məxfilik və təhlükəsizlik tələblərinə əməl etməlidir.</p></div>
            </section>

            <section id="storage">
              <span className="policy-number">06</span>
              <div><h2>Saxlanma müddəti və təhlükəsizlik</h2><p>Məlumatı xidmətin göstərilməsi, müqavilə və sifariş tarixçəsi, dəstək, mübahisələrin həlli, audit və qanuni öhdəliklər üçün lazım olan müddət ərzində saxlayırıq. Məqsəd və qanuni saxlama ehtiyacı bitdikdə məlumat silinir və ya şəxsiyyəti müəyyən etməyən formaya salınır.</p><p>Giriş nəzarəti, şifrələnmiş bağlantı, təhlükəsizlik jurnalları, ehtiyat nüsxələr və sistem yeniləmələri kimi texniki və təşkilati tədbirlər tətbiq olunur. Heç bir internet sistemi tam risksiz olmadığından şübhəli hesab fəaliyyəti gördükdə dərhal bizə bildirin.</p></div>
            </section>

            <section id="rights">
              <span className="policy-number">07</span>
              <div><h2>Hüquqlarınız və müraciət qaydası</h2><p>Qanunvericiliyin tətbiq etdiyi həddə özünüz haqqında saxlanılan məlumatı ödənişsiz öyrənmək, surətini almaq, səhv məlumatı düzəltdirmək, işlənməyə etiraz etmək, verdiyiniz razılığı geri götürmək, məlumatın silinməsini və ya işlənməsinin dayandırılmasını istəmək hüququnuz var.</p><p>Sorğunu <a href="mailto:support@possistem.az">support@possistem.az</a> ünvanına göndərin. Başqa şəxsin məlumatını açıqlamamaq üçün şəxsiyyətinizi və hesabla əlaqənizi təsdiqləməyinizi istəyə bilərik. Qanunla saxlanması məcburi olan əməliyyat məlumatı dərhal silinməyə bilər; belə halda səbəb sizə izah ediləcək.</p></div>
            </section>

            <section id="cookies">
              <span className="policy-number">08</span>
              <div><h2>Kukilər və yerli yaddaş</h2><p>Sayt giriş sessiyasını qorumaq, təhlükəsizlik yoxlamalarını aparmaq, səbəti saxlamaq, dil və görünüş seçiminizi xatırlamaq üçün zəruri kukilərdən və brauzerin yerli yaddaşından istifadə edə bilər. Bu məlumatları silsəniz, hesabdan çıxış baş verə, səbət və seçimlər sıfırlana bilər.</p><p>Yeni analitika və ya reklam texnologiyası tətbiq edilərsə, bu siyasət yenilənəcək və qanun tələb etdikdə ayrıca seçim təqdim olunacaq.</p></div>
            </section>

            <section className="policy-update">
              <div><h2>Siyasətdə dəyişiklik</h2><p>Xidmətlər və hüquqi tələblər dəyişdikdə siyasəti yeniləyə bilərik. Əhəmiyyətli dəyişikliklər bu səhifədə yeni tarixlə göstəriləcək və uyğun olduqda hesab daxilində bildiriş veriləcək.</p><div className="policy-actions"><Link className="policy-action primary" href="/elaqe/">Bizimlə əlaqə</Link><Link className="policy-action" href="/odenis/sertler/">Ödəniş şərtləri</Link></div></div>
            </section>
          </article>
        </div>
      </div>
    </MarketingLayout>
  );
}
