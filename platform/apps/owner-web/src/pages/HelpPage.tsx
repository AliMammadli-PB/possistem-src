import { Icon } from '../ui/Icon';
import { PageHeader } from '../ui/navigation';
import { Card } from '../ui/primitives';

/**
 * How to run the till, for the restaurant customer's own staff.
 *
 * This page used to describe MarketPos - activation on possistem.az/marketpos,
 * the sales-hall warehouse, stock controls that do not exist here. A restaurant
 * owner reading it found instructions for a product they do not own, which is
 * worse than an empty page: they follow them and nothing matches.
 *
 * The short answers live here; the full manual is a PDF, because that is the
 * thing an owner prints once and leaves by the till for staff who will never
 * open a browser to read it.
 */
const GUIDE_PDF = 'Possistem-Restoran-POS-Istifade-Telimati.pdf';

const sections = [
  {
    title: 'İlk işə salma',
    body: [
      'Possistem Setup faylını yükləyin və restorandakı kompüterə quraşdırın.',
      'Proqramı açın, müştəri email və parolunuzla daxil olun, sonra aktivasiya açarını yazın.',
      'Kassaya ad verin (məsələn Kassa 1). Ad yalnız ilk dəfə soruşulur.',
      'Bundan sonra proqram hər açılışda birbaşa PIN ekranı ilə başlayır.',
    ],
  },
  {
    title: 'Gündəlik başlanğıc',
    body: [
      'Satışa başlamazdan əvvəl növbə açıq olmalıdır: İdarə → Kassa → Növbəni aç.',
      'Kassadakı başlanğıc xırda pulu yazın — gün sonunda fərq bununla hesablanır.',
      'Gün sonunda masaları bağlayın, pulu sayın və Z hesabat çıxarın.',
    ],
  },
  {
    title: 'Səhv vurulmuş məhsulun pulunu qaytarmaq',
    body: [
      'Müştəriyə verilən hər çekin altında GERİ QAYTARMA KODU yazılır (məsələn R-ABC23XYZ).',
      'Kassada soldakı menyudan «Geri qaytarma» bölməsini açın və həmin kodu yazın.',
      'Satış açılır: səhv vurulan məhsulu seçin və ya məbləği yazın, səbəbi göstərin.',
      'Təsdiqdən sonra pul qaytarılır və müştəriyə geri qaytarma qəbzi çap olunur.',
      'Eyni məhsul iki dəfə qaytarıla bilməz — ekranda nə qədərinin qaldığı yazılır.',
    ],
  },
  {
    title: 'Printer',
    body: [
      'Printeri USB və ya şəbəkə (LAN) kabeli ilə qoşun.',
      'Parametrlər → Printer → «Printeri tap» düyməsini basın.',
      'Proqram USB, Windows növbələri, COM/LPT və şəbəkədəki printerləri özü axtarır.',
      'Tapılan hər namizədə test səhifəsi göndərilir — kağız çıxan printer yadda saxlanılır.',
    ],
  },
  {
    title: 'İşçi səlahiyyətləri',
    body: [
      'Bu saytdakı «İşçi rolları» səhifəsində hər rola nəyin icazə veriləcəyini seçirsiniz.',
      'Dəyişiklik 2 dəqiqə ərzində kassaya özü düşür; işçi növbəti girişində yeni səlahiyyətlə işləyir.',
      'Sönük görünən səlahiyyət paketinizə daxil deyil — lazımdırsa çatdan bizə yazın.',
      'Müdirin səlahiyyəti həmişə tamdır: səhvi geri qaytarmağın yeganə yolu budur.',
    ],
  },
  {
    title: 'Kassa oflayn görünürsə',
    body: [
      'Kassa internetsiz də işləyir — satış dayanmır.',
      'Saytdakı rəqəmlər kassadan gələn son məlumatdır, yəni əlaqə kəsilən andakı mənzərədir.',
      'İnternet qayıdan kimi özü yenilənir; heç nə etmək lazım deyil.',
    ],
  },
];

export default function HelpPage() {
  return (
    <div className="page-stack help-page">
      <PageHeader
        title="Təlimat"
        description="Kassanı gündəlik necə işlətməli — qısa cavablar və tam təlimat."
      />

      <Card>
        <div
          style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'center',
            justifyContent: 'space-between', gap: '1rem',
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Tam istifadə təlimatı (PDF)</h2>
            <p className="muted" style={{ margin: '0.35rem 0 0' }}>
              Masadan ödənişə, anbardan hesabatlara qədər hər bölmə addım-addım izah olunur.
              Çap edib kassanın yanında saxlaya bilərsiniz.
            </p>
          </div>
          {/* An anchor rather than a Button: the file sits next to this page,
              and an owner on a phone should get the browser's own PDF viewer
              instead of a download this app has to manage. */}
          <a className="button button-primary button-md" href={GUIDE_PDF} target="_blank" rel="noreferrer">
            <Icon name="download" size={18} />
            PDF-i aç
          </a>
        </div>
      </Card>

      {sections.map((section) => (
        <article key={section.title} className="help-article">
          <h2>{section.title}</h2>
          {section.body.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </article>
      ))}

      <Card>
        <p className="muted" style={{ margin: 0 }}>
          <Icon name="chat" size={16} /> Cavabını tapmadınız? Soldakı <b>Çat</b> bölməsindən
          yazın — sualınız birbaşa bizə gəlir.
        </p>
      </Card>
    </div>
  );
}
