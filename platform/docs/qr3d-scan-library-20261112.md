# Adla model yaratmaq və 20 saniyəlik çəkiliş

Sahibkar `https://possistem.az/pos/app/qr-3d?tab=scan` ünvanında menyu/məhsul seçmədən **Model adı**, real en/diametr və emal razılığı ilə çəkiliş yaradır. Bu axın üçün əvvəl POS menyusunu yayımlamaq lazım deyil. 3D modellər tabındakı **Mənim modellərim** bölməsində qaralama saxlanır; sonradan restoran, yemək və uyğun ölçüyə bağlanır. Bağlama avtomatik yayım etmir. İctimai QR menyuya yalnız ayrıca yayımlanmış, etibarlı bağlı model çıxır.

- `0059_qr_scan_library.sql` əvvəlki bağlı modelləri saxlayır; scan/model `menu_id`, `product_id` NULL ola bilər. Yeni `name` sütunları var. DB səviyyəsində yayımlanmış modelin menyu/məhsul bağlantısı tələb olunur.
- `/customer/qr3d/scans` GET/POST hesab üzrə çəkilişləri qaytarır/yaradır. Köhnə `/:menu/scans` çağırışları işləyir.
- `/customer/qr3d/library` yalnız həmin hesabın bağlanmamış qaralamalarını qaytarır. `POST /models/:id/bind` sahibkarı, menyunu, məhsulu və santimetr/variant uyğunluğunu yoxlayır; atomik və təkrar sorğuya dözümlüdür.
- Kamera **20 saniyə çək** düyməsindən sonra ən çox 40 kadrı 500 ms fasilə ilə telefon yaddaşına götürür. Şəbəkə çəkilişin tempini dayandırmır. Çəkiliş bitəndə kamera bağlanır və göndərmə ayrıca göstərilir. Telefondakı göndərilməmiş şəkil keşi maksimum64 MiB-dir; xəta olsa qalan şəkilləri istifadəçi yenidən göndərə bilər. Səs yazılmır. Pəncərəni bağlayanda göndərilməmiş foto itə bilər; brauzer xəbərdarlığı və görünən məlumat var. Səhifə fon olduqda çəkiliş dayandırılır.
- **20 saniyə modelin emal vaxtı deyil.** Emal foto sayından/keyfiyyətindən və kompüterdən asılıdır. Bu kompüterdə real istifadəçi çəkilişi 4 dəqiqə 53 saniyədə hazır olub. Daha güclü kompüterin səth/şəffaflıq problemini həll etdiyi iddia edilmir.
- Şəffaf şüşə/güzgü səthi seçilərsə foto skanı açılmır və alternativ göstərilir. Nümunə üçün mat fincan və ya yemək uyğundur. Şəffaf stəkanın həqiqi həndəsəsini adi foto uyğunlaşdırması ilə etibarlı almaq mümkün olmaya bilər.
- Mövcud NVIDIA RTX 3050/Meshroom xidməti saxlanır. İstifadəçi AMD/CPU variantını davam etdirməməyi seçdiyi üçün Windows emal EXE-si və yeni operator seçimi hazırlanmayıb. Tədqiq üçün endirilən COLMAP/OpenMVS proqramları işə salınmayıb.

## Yoxlamalar

- API üçün ayrı PostgreSQL bazalarında 8 skan +10 mövcud model testi keçdi. Yeni ssenari: menyusuz adla yaratma →24 foto →işin götürülməsi →adlı unbound qaralama →başqa sahibkarın görə bilməməsi →bağlanmadan yayımın bloklanması →yad menyunun rəddi →səhv variantın rəddi →uyğun bağlama/təkrar sorğu →ayrıca yayım.
- Chromium158.0.8127.18,390/768/1536px. Menyusu olmayan hesab, adla yaratma, şüşə xəbərdarlığı, kamera icazəsi/retry, stream cleanup, URL tab keçidi. Real vaxtda ölçülən 20 saniyəlik çəkiliş+mock göndərmə 20,533 ms çəkdi (39 avtomatik kadr; əvvəlki2 şəkillə41).
- Ayrı brauzer ssenarisi: adlı qaralamaya faktiki GLB ilə 3D baxış, mobil genişlik, bağlama formundan 28sm seçimi və bağlı modelin qaralama qalması.
- Fiziki iPhone çəkilişi və masada AR yerləşdirməsi ayrıca yoxlanmalıdır. Saxta performans rəqəmləri və real cihaz yoxlaması iddia edilmir.
