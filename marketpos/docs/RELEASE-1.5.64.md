# Market POS 1.5.64

## Buraxılış qeydləri (latest.yml → releaseNotes)

- Texniki dəstək çatı: dəstəyin göndərdiyi şəkil (JPG, PNG, WEBP, GIF, BMP) çatda görünür, toxunanda böyüyür. Hər fayl "Aç" ilə öz proqramında açılır. Əvvəl belə mesaj yalnız "📎 fayl adı" mətni kimi qalırdı.
- Sahibkar girişi (email və parol): telefon nömrəsi çıxarıldı, PIN ekranındakı kimi tək "Texniki dəstək" düyməsi qaldı. "Parolu göstər" indi parol sahəsinin içində göz ikonudur.

## Qeyd

- Fayl kassanın cihaz imzası ilə `/market-pos/support/attachment` vasitəsilə yüklənir və `userData/support` qovluğunda saxlanılır. Faylı əməliyyat sistemi açır, proqram onu özü işə salmır.
- Kassadan dəstəyə şəkil göndərmək üçün serverdə müştəri tərəfli yükləmə marşrutu yoxdur (`/customer/support/...`). Bu, server dəyişikliyi tələb edir.
