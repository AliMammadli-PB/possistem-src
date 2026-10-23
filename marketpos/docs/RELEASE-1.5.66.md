# Market POS 1.5.66

## Buraxılış qeydləri (latest.yml → releaseNotes)

- Z bağlanışında Z çeki avtomatik çap olunur. Çekdə kassa adı, endirim, qaytarma, kassa hərəkətləri, maya dəyəri və qazanc var. Printer təyin olunmayıbsa, bu açıq yazılır. Bağlanışdan sonra hesabat dərhal sayta göndərilir.
- Saytdakı gündəlik satış və qazanc düzəldildi: çəkili mal çəkisi ilə (0.310 kq, 1 kq deyil), qismən qaytarma və çek endirimi çıxılmaqla hesablanır.
- Çekdə çəkili mal "0.310 kq x 8.00" kimi çap olunur.
- "Bu kassa anbar kompüteri deyil": filialda yeganə kassa saytdan sorğu alanda anbar rolunu özü geri götürür. Dayanmış anbar nüvəsi sorğudan əvvəl işə salınır. Anbar işləmirsə, "səlahiyyətiniz yoxdur" əvəzinə həqiqi səbəb göstərilir.
- Texniki dəstək: sahibkar girişindən əvvəl də xəta çıxmır. Aktiv kassa cihaz kanalı ilə yazır. Aktiv olmayan kassada aydın bildiriş göstərilir. Dəstəyin şəkilləri sahibkar hesabı ilə yüklənir.

## Canlı yoxlama (23.10.2026, test hesabı)

- Sahibkar girişi, superadmin PIN-i, filial seçimi, Əməliyyatlar: işləyir.
- Dəstək çatı: canlı mesajlar və dəstəyin JPG şəkilləri çatda göründü və böyüdü.
- Uzaq filial (Nermanov): server "filial xidməti cavab vermir" qaytardı, o kassa sorğuya cavab vermir.
