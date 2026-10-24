/**
 * The till's permission catalogue, in Azerbaijani.
 *
 * Duplicated from the POS (scripts/apply-restaurant-perm-az.mjs) rather than
 * fetched: the website has to render the list before any till has ever spoken
 * to it, and the keys are part of the wire contract, not free text. The till
 * ignores a key it does not know, so a stale entry here is harmless - a missing
 * one just means the box is not offered.
 */
export type PermissionGroup = { key: string; label: string; permissions: PermissionEntry[] };
export type PermissionEntry = { key: string; label: string; hint: string };

const GROUP_LABELS: Record<string, string> = {
  "audit": "Audit",
  "backup": "Yedəkləmə",
  "businessDay": "İş günü",
  "cash": "Kassa",
  "catalog": "Menyu və kataloq",
  "customers": "Müştərilər",
  "delivery": "Çatdırılma",
  "discount": "Endirimlər",
  "gifts": "Hədiyyələr",
  "inventory": "Anbar və stok",
  "kds": "Mətbəx ekranı",
  "license": "Lisenziya",
  "order": "Sifarişlər",
  "payment": "Ödəniş və kassa",
  "printer": "Printer",
  "receipt": "Çek",
  "recipes": "Reseptlər",
  "reports": "Hesabatlar",
  "reservations": "Rezervasiyalar",
  "roles": "Rollar və səlahiyyətlər",
  "schedule": "İş qrafiki",
  "settings": "Tənzimləmələr",
  "shift": "Növbə",
  "suppliers": "Təchizatçılar və alış",
  "tables": "Masalar",
  "users": "İstifadəçilər"
};

const PERMISSIONS: Record<string, [string, string]> = {
  "audit.view": [
    "Audit jurnalına baxmaq",
    "Kimin nə etdiyinin tarixçəsi"
  ],
  "backup.manage": [
    "Yedəkləmə və bərpa",
    "Yerli ehtiyat nüsxə yaratmaq və geri qaytarmaq"
  ],
  "businessDay.manage": [
    "İş gününü açıb-bağlamaq",
    "Gün açılışı, bağlanışı və Z hesabatı"
  ],
  "cash.manage": [
    "Kassa əməliyyatları",
    "Kassaya mədaxil/məxaric və çekmecə"
  ],
  "catalog.import": [
    "Kataloqu idxal/ixrac etmək",
    "Menyunu CSV ilə yükləmək və çıxarmaq"
  ],
  "catalog.manage": [
    "Menyunu idarə etmək",
    "Kateqoriya, məhsul və qiymət dəyişmək"
  ],
  "customers.credit": [
    "Müştəri borcu",
    "Borc yazmaq və borc ödənişi qəbul etmək"
  ],
  "customers.loyalty": [
    "Bonus balları",
    "Bal qazandırmaq və xərcləmək"
  ],
  "customers.manage": [
    "Müştəri yaratmaq və redaktə etmək",
    "Müştəri kartlarını idarə etmək"
  ],
  "customers.view": [
    "Müştərilərə baxmaq",
    "Müştəri, borc və bal məlumatı"
  ],
  "delivery.assign": [
    "Kuryer təyin etmək",
    "Sifarişi kuryerə vermək və statusu irəlilətmək"
  ],
  "delivery.manage": [
    "Çatdırılmanı idarə etmək",
    "Çatdırılma yaratmaq və kuryerləri idarə etmək"
  ],
  "delivery.view": [
    "Çatdırılmaya baxmaq",
    "Çatdırılma sifarişləri və kuryer hesabatları"
  ],
  "discount.manage": [
    "Endirim qaydaları",
    "Endirim qaydalarını təyin etmək"
  ],
  "gifts.manage": [
    "Hədiyyə kampaniyaları",
    "Kampaniyaları qurmaq və dəyişmək"
  ],
  "gifts.override": [
    "Hədiyyəni təsdiqləmək",
    "Yoxlamadan keçirmə icazəsi vermək"
  ],
  "inventory.adjust": [
    "Stok düzəlişi və silinmə",
    "Qalığı düzəltmək, itki və zay yazmaq"
  ],
  "inventory.count": [
    "İnventarizasiya",
    "Sayım aparmaq və yekunlaşdırmaq"
  ],
  "inventory.manage": [
    "Anbar və xammal kartları",
    "Anbar və xammal yaratmaq, redaktə etmək"
  ],
  "inventory.transfer": [
    "Anbarlararası transfer",
    "Malı bir anbardan digərinə köçürmək"
  ],
  "inventory.view": [
    "Stok qalığına baxmaq",
    "Qalıqlar və mal hərəkətləri"
  ],
  "kds.operate": [
    "Mətbəx ekranını idarə etmək",
    "Sifariş statuslarını dəyişmək"
  ],
  "kds.view": [
    "Mətbəx ekranına baxmaq",
    "Hazırlanan sifarişləri görmək"
  ],
  "license.manage": [
    "Lisenziya",
    "Aktivləşdirmə və lisenziya statusu"
  ],
  "order.closeOther": [
    "Başqasının sifarişini bağlamaq",
    "Öz sifarişi olmayanı da bağlamaq"
  ],
  "order.create": [
    "Sifariş yaratmaq",
    "Yeni sifariş açmaq və məhsul əlavə etmək"
  ],
  "order.discount": [
    "Sifarişə endirim tətbiq etmək",
    "Hesaba faiz və ya məbləğlə endirim"
  ],
  "order.priceOverride": [
    "Qiyməti əl ilə dəyişmək",
    "Sifarişdə məhsulun qiymətini dəyişmək"
  ],
  "order.transfer": [
    "Sifarişi köçürmək",
    "Hesabı başqa masaya köçürmək"
  ],
  "order.view": [
    "Sifarişlərə baxmaq",
    "Sifarişlər və onların tarixçəsi"
  ],
  "order.void": [
    "Sifarişi ləğv etmək",
    "Sifarişi və ya içindəki məhsulu ləğv etmək"
  ],
  "payment.reconcile": [
    "Kassa uzlaşdırması",
    "Gün sonu kassanı uzlaşdırmaq"
  ],
  "payment.refund": [
    "Geri qaytarma",
    "Ödənişi müştəriyə qaytarmaq"
  ],
  "payment.split": [
    "Hesabı bölmək",
    "Hesabı bir neçə ödənişə bölmək"
  ],
  "payment.take": [
    "Ödəniş qəbul etmək",
    "Nağd, kart və digər ödəniş növləri"
  ],
  "payment.view": [
    "Ödənişlərə baxmaq",
    "Hesabda alınmış ödənişləri görmək"
  ],
  "printer.manage": [
    "Printer ayarları",
    "Printeri qurmaq, çapı təkrarlamaq və ləğv etmək"
  ],
  "receipt.print": [
    "Çek çap etmək",
    "Çek çapı və təkrar çap"
  ],
  "recipes.manage": [
    "Reseptlər",
    "Məhsulun nədən hazırlandığını təyin etmək"
  ],
  "reports.export": [
    "Hesabatı ixrac etmək",
    "Excel və ya PDF-ə çıxarmaq"
  ],
  "reports.view": [
    "Hesabatlara baxmaq",
    "Satış və əməliyyat hesabatları"
  ],
  "reports.x": [
    "X hesabatı",
    "Gün ərzində aralıq hesabat almaq"
  ],
  "reports.z": [
    "Z hesabatı",
    "Gün sonu hesabatı almaq"
  ],
  "reservations.manage": [
    "Rezervasiyanı idarə etmək",
    "Rezerv yaratmaq, köçürmək, ləğv etmək"
  ],
  "reservations.view": [
    "Rezervasiyalara baxmaq",
    "Masa rezervlərini görmək"
  ],
  "roles.manage": [
    "Rol və səlahiyyətlər",
    "Rol yaratmaq və səlahiyyət vermək"
  ],
  "schedule.clock": [
    "Gəliş-gediş qeydi",
    "İşə giriş və çıxış vurmaq"
  ],
  "schedule.manage": [
    "Qrafiki idarə etmək",
    "Növbə planlamaq və dəyişmək"
  ],
  "schedule.view": [
    "Qrafikə baxmaq",
    "Növbələr və davamiyyət"
  ],
  "settings.manage": [
    "Tənzimləmələr",
    "Sistem və restoran ayarları"
  ],
  "shift.manage": [
    "Növbəni idarə etmək",
    "Növbə açmaq və bağlamaq"
  ],
  "suppliers.manage": [
    "Təchizatçı və alış sifarişi",
    "Təchizatçı yaratmaq, alış sifarişini redaktə etmək"
  ],
  "suppliers.pay": [
    "Təchizatçıya ödəniş",
    "Alış fakturasını ödəmək"
  ],
  "suppliers.receive": [
    "Mal qəbulu",
    "Gələn malı anbara qəbul etmək"
  ],
  "suppliers.view": [
    "Təchizatçılara baxmaq",
    "Təchizatçılar və alışlar"
  ],
  "tables.layout": [
    "Masa sxemi",
    "Zal planını redaktə etmək"
  ],
  "tables.status": [
    "Masa statusu",
    "Masanın vəziyyətini dəyişmək"
  ],
  "users.manage": [
    "İşçiləri idarə etmək",
    "İşçi yaratmaq və deaktiv etmək"
  ]
};

/** Shipped roles, in the order the till seeds them. Names are the wire value. */
export const DEFAULT_ROLES = ['waiter', 'kitchen', 'cashier', 'supervisor', 'manager'];

export const PERMISSION_GROUPS: PermissionGroup[] = Object.entries(
  Object.entries(PERMISSIONS).reduce<Record<string, PermissionEntry[]>>((acc, [key, [label, hint]]) => {
    const group = key.split('.')[0];
    (acc[group] ||= []).push({ key, label, hint });
    return acc;
  }, {}),
)
  .map(([key, permissions]) => ({ key, label: GROUP_LABELS[key] ?? key, permissions }))
  .sort((a, b) => a.label.localeCompare(b.label, 'az'));
