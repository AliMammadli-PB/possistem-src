# Market POS 1.5.61

## Buraxılış qeydləri (latest.yml → releaseNotes)

- Parametrlər → Tərəzi: tərəzi barkodunun dizaynı. Hazır Dahua formatları (çəki və ya məbləğ), öz dizaynınız (PLU uzunluğu, son rəqəmlər, onluq), prefikslər 20–29, rəngli nümunə barkod və tərəziyə yazılacaq Dahua kodu (məs. B201E500K500A000A000A000).
- Formatı etiketdən avtomatik tapma: tərəzi etiketini oxudun, etiketdəki çəkini və ya məbləği yazın, kassa düzgün formatı seçir.
- Dahua zavod barkodları (son rəqəmlər = məbləğ) artıq düzgün oxunur: çəkili mal kq ilə səbətə düşür. Əvvəl belə etiket "1 ədəd" kimi əlavə olunurdu.
- LAN tərəzi (TM-30F, port 4001): hər PLU ilə etiket formatı nömrəsi göndərilir (0 = tərəzinin öz formatı, 1–9 zavod, 10–39 öz formatınız).
- "0.80 AZN əvəzinə 80" üçün TM-30F Spec təlimatı Tərəzi bölməsindədir.
- Anbar / Mallar: "Satışdan qazanc" və "Satılıb" əlavə olundu. Satış artdıqca qazanc artır, qaytarma və çek endirimi çıxılır. Köhnə "Qazanc" indi "Gözlənilən qazanc" adlanır (qalıq × (satış − alış)).
- Silmə, ləğv və qaytarma: müdirin PIN-i və 10 rəqəmli kod qəbul olunur. Superadmin işçilərə "Müdir" kimi görünür.

## TM-30F araşdırması (qısa)

- Protokol: TCP 4001, `!0V` PLU sətri. Sahələr internetdəki təsvirlə uyğundur: PLU 4, kod 7, qiymət 6 (qəpik), çəki rejimi 1, xüsusi 6, müddət 3, mağaza 2, şöbə 2, rəqəm kodu 13, dara 5, etiket nömrəsi 2, endirim 2, vaxt seqmentləri 24, sonra `B` + ad + `CDE`.
- Qiymət tərəziyə qəpiklə gedir (80 = 0.80 AZN). Nöqtəni tərəzi qoyur. Etiketdə "80" görünürsə, tərəzidə Spec202/203 (onluq) 0-a dəyişdirilib. Lazım olan dəyərlər: 202=2, 203=2, 206=3, 207=1, 100/101=0, 208=3, 209=2.
- Dahua zavod barkodları son 5–6 rəqəmdə məbləğ (T.Price) yazır, çəki yox. Kassa 1.5.60-a qədər hamısını qram kimi oxuyurdu.
- Barkod formatını tərəziyə şəbəkə ilə yazan `!0O` əmri açıq sənəddə yoxdur. Yalnız iki blog nümunəsi var və sahələri açılmayıb. Ona görə kassa onu göndərmir. Format tərəzinin P25 (BAR) menyusunda Tərəzi bölməsindəki kodla yazılır.

## Yoxlanılmayanlar

- Fiziki TM-30F və etiket printeri ilə sınaq aparılmayıb.
- Windows installer bu mühitdə qurulmayıb.
