import { Card } from './primitives';

type Row = [label: string, minimum: string, recommended: string];

const ROWS: Row[] = [
  [
    'Əməliyyat sistemi',
    'Windows 10 64-bit (22H2 və ya daha yeni) və ya Windows 11 64-bit',
    'Windows 11 64-bit',
  ],
  [
    'Prosessor (CPU)',
    '2 nüvə, təxminən 2.0 GHz — Intel Celeron / Pentium Gold, AMD Athlon',
    '4 nüvə — Intel Core i3 / AMD Ryzen 3 və ya daha güclü',
  ],
  [
    'Yaddaş (RAM)',
    '4 GB (kassadan başqa ağır proqram açıq olmamalıdır)',
    '8 GB (kassa + ofis eyni kompüterdədirsə 16 GB)',
  ],
  [
    'Disk',
    'Ən azı 2 GB boş yer; HDD işləyir, amma yavaşdır',
    'SSD 128 GB və ya daha böyük',
  ],
  [
    'Qrafika (GPU)',
    'Intel UHD / AMD Radeon inteqrasiya olunmuş qrafika kifayətdir',
    'Yenə də inteqrasiya olunmuş kifayətdir',
  ],
  [
    'NVIDIA',
    'Lazım deyil — oyun və ya CUDA kartı kassanı sürətləndirmir',
    'Varsa GeForce overlay / Game Mode söndürün',
  ],
  [
    'Ekran',
    '1366×768 və ya daha yüksək; toxunma dəstəklənir',
    '1920×1080, 15–22 düym toxunma və ya monitor',
  ],
  [
    'USB / printer',
    'ESC/POS kassə printeri üçün 1× USB və ya şəbəkə printer',
    'Eyni + UPS (elektrik kəsiləndə baza korlanmasın)',
  ],
  [
    'Şəbəkə',
    'Offline işləyir; aktivasiya, yeniləmə və sync üçün internet',
    'Sabit internet; avtomatik yeniləmə yalnız Windows till-dədir',
  ],
];

export function WindowsRequirements({ compact = false }: { compact?: boolean }) {
  return (
    <Card className={compact ? 'hw-req-card hw-req-card-compact' : 'hw-req-card'}>
      <div className="card-heading">
        <div>
          <span className="section-eyebrow">Windows kassa</span>
          <h2>Tam sistem tələbləri</h2>
        </div>
      </div>
      <p className="muted-copy hw-req-lead">
        possistem Electron + Chromium interfeysi və yerli SQLite nüvəsidir. 3D oyun, CUDA və ya ayrıca NVIDIA kartı tələb olunmur.
        Təxmini RAM: interfeys 250–500 MB, nüvə 50–150 MB — rahat iş üçün 4 GB minimum, 8 GB tövsiyə.
      </p>

      <div className="hw-req-table-wrap">
        <table className="hw-req-table">
          <thead>
            <tr>
              <th>Komponent</th>
              <th>Minimum</th>
              <th>Tövsiyə olunan</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([label, minimum, recommended]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>{minimum}</td>
                <td>{recommended}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <aside className="hw-nvidia" aria-label="NVIDIA haqqında">
        <strong>NVIDIA lazım deyil.</strong>
        <p>
          Kassanın UI-si 2D-dir (masa planı, menyu, çek). Intel və ya AMD inteqrasiya olunmuş qrafika kifayətdir.
          NVIDIA kartı varsa, GeForce Experience overlay və Windows Game Mode-u söndürmək daha sabitdir — bəzən Chromium-u yavaşladır.
        </p>
      </aside>
    </Card>
  );
}
