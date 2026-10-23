# SUNMI / Caspos Mobile — Possistem quraşdırılması

Bu inteqrasiya SUNMI-də işləyən **Caspos Mobile Integration API App 1.0.7.0, Doc 1.0.13.0** üçündür. Adi SUNMI printer SDK-sı deyil. Mənbə istifadəçinin verdiyi 46 səhifəlik API sənədidir. Windows Restaurant POS **1.9.10** və Market POS **1.5.63** üçün hazırlanıb; yeni funksiyanın standart vəziyyəti **söndürülmüşdür**.

## Siz fiziki olaraq nə etməlisiniz?

1. **Caspos xidmətindən cihazı hazırlatdırın.** Fiskal qeydiyyat, VÖEN/obyekt, vaxt, kağız, tətbiq/firmware uyğunluğu və bank terminalı ayarlarını onlar təsdiqləməlidir. API istifadəçi adı və şifrəsini onlardan alın. Bu, Possistem hesabınızın email/parolu və işçi PIN-i deyil.
2. **PC ilə SUNMI-ni eyni yerli şəbəkəyə qoşun.** PC kabeldə, SUNMI Wi-Fi-da ola bilər. Guest Wi-Fi və cihazlararası bloklama işləməməlidir. Routerdə SUNMI üçün sabit DHCP rezervasiyası ayırın. Yalnız hər iki cihazın interneti olması kifayət deyil; PC cihazın IP-sinə çata bilməlidir. `5544` portunu internetə açmayın.
3. **SUNMI-də Integration Service-i açın.** PDF-in 1-ci səhifəsinə görə Caspos Mobile-da `CashierUserName` kassirinə keçilir, inteqrasiya xidməti aktiv edilir. İlk aktivləşdirmə şifrəsi sənəddə `password` + seriyanın son 4 rəqəmi kimi göstərilir; provayder dəyişibsə onun verdiyi şifrəni istifadə edin. Kiosk-dan çıxmaq tələb olunarsa bunu Caspos texniki əməkdaşına etdirin. Xidmət ekranındakı IP-ni qeyd edin; tətbiq işlək qalsın.
4. **Uyğun Possistem paketini quraşdırın.** Mövcud istifadəçi məlumatlarını saxlayın, əvvəl ehtiyat nüsxə çıxarın. Həmin filialın hesabına və müdir istifadəçisinə daxil olun. Sınaq paketləri Windows x64 üçündür. Sertifikat verilmədiyindən bu paketlər imzasızdır; Windows bunu göstərə bilər.
5. **Parametrlər → SUNMI açın.** Məsələn `192.168.1.50:5544`, Caspos API giriş adı və şifrəsini yazın. Vergi sinfini Caspos/mühasibin təsdiqlədiyi kimi seçin. Fərqli vergi sinifli mallar üçün barkod/kataloq kodu üzrə istisnaları əlavə edin. ƏDV-dən azad ilə 0% ƏDV ayrı seçimlərdir. Ticarət əlavəsi vergisində həqiqi alış qiyməti lazımdır.
6. **Əvvəl “Bağlantını yoxla”.** Bu, giriş, cihaz məlumatı, printer bağlantısı və növbə vəziyyətini soruşur; satış çeki yaratmır. Ekrandakı seriya nömrəsi, obyekt və VÖEN fiziki cihazla uyğun olmalıdır. Sonra “Yeni satışları SUNMI-yə avtomatik göndər” seçimini aktiv edib saxlayın. IP və giriş məlumatları dəyişəndə yenidən yoxlama tələb olunur.
7. **SUNMI fiskal növbəsini açın.** SUNMI bölməsində açılış məbləği ilə “Növbəni aç” istifadə olunur. Possistem-in yerli kassa növbəsi ayrıca uçotdur; onu da adi kassa ekranından açın. SUNMI mədaxil/məxaric düymələri yalnız fiskal cihaz üçündür, yerli Kassalar əməliyyatını əvəz etmir.
8. **Aşağıdakı fiziki qəbul sınaqlarını Caspos əməkdaşı ilə bitirin.** Cihazda təsdiqlənmədən bu inteqrasiyanı istehsalatda problemsiz hesab etməyin. Mənbə və Windows paketləri hazırlanıb, lakin bu hazırlanma zamanı real SUNMI-yə çıxış olmayıb.

## Fiziki qəbul siyahısı

Caspos-un təlim/sınaq cihazında, yaxud provayderin müəyyən etdiyi qaydada yoxlayın. Hər sınaqda Possistem məbləği, SUNMI kağızı və cihazdakı fiskal sənədin eyniliyini müqayisə edin.

- Nağd, kart və qarışıq satış; qəpiklər, endirim, çəkili məhsul, böyük yekun, AZ hərfləri və xidməthaqqı.
- Kartda **əvvəl bank terminalında təsdiq**, sonra bank çekinin **12 rəqəmli RRN** nömrəsi. Possistem-dəki RRN pəncərəsi bankdan pul çəkmir. Caspos-un həmin RRN ilə ikinci bank əməliyyatı başlatmadığını provayder təsdiqləməlidir. Bank artıq pul çəkibsə eyni ödənişi yenidən etməyin.
- Tam/qismən nisyə satışda fiskal çekin `creditPayment` məbləği. Sonrakı borc ödənişi üçün aşağıdakı əhatə məhdudiyyətini oxuyun.
- İlkin fiskal sənədə bağlı tam və məhsul üzrə qismən qaytarma. Kart qaytarmasında bank geri ödənişi ayrıca edilir, onun RRN-i yazılır. Fiskal qaytarma bankdan pulun müştəriyə qayıtması demək deyil.
- API cavabı gəlməyəndə eyni qaiməni yenidən yoxlama; ikinci fiskal çek yaranmamalıdır. Təkrar satış yaratmayın.
- Kağız bitməsi, SUNMI Wi-Fi kəsilməsi, tətbiq/PC yenidən açılması; gözləyən sənədin eyni UUID ilə bərpası.
- X hesabatı növbəni bağlamır; Z bağlayır. Gözləyən fiskal qaimə varsa Z dayandırılır. 24 saat qaydasını Caspos ilə yoxlayın.
- Pul qutusu dəstəklənirsə nağd fiskal çekdən sonra açılması. Qutu açılmasa artıq yaranmış çek yenidən yaradılmır.
- Yerli əlavə çek surəti istəyə bağlıdır. **Fiskal çek SUNMI-dən çıxandır**; yerli logo/QR/etiket dizayneri SUNMI fiskal şablonunu dəyişmir. Fiskal çek dizaynı Caspos imkanlarına tabedir.

## Nəticə gözləyirsə

“Satış saxlanıldı” ilə “Fiskallaşıb” eyni status deyil. Fiskal ID alındıqdan sonra SUNMI tarixçəsində “Fiskallaşıb” görünür. Tamamlanmamış qeyd barədə ekranda bildiriş çıxır.

- **Bağlantı gözlənilir / nəticə yoxlanmalıdır:** cihazdakı kağızı yoxlayın; SUNMI bölməsində eyni sənədlə təkrar yoxlayın. Tətbiq UUID-ni və göndərilmiş məzmunu dəyişmir.
- **Qəbul edilməyib:** səbəbi düzəldin; yalnız cihazın rədd etdiyi sənəd yenidən hazırlanır.
- **Cihazda yoxlayın:** `1205` və ya fərqli məbləğ kimi hallarda Caspos dəstəyi faktiki fiskal sənədi araşdırmalıdır. Avtomatik “yeni çek” yaratmaq bağlıdır.
- Giriş/PIN xətasında proqram fasiləsiz şifrə sınamır. Məlumatları yoxlayıb açıq şəkildə bağlantı sınağı edin.
- Artıq fiskallaşmış satışın məzmunu yerində dəyişdirilmir: əlaqəli məhsul qaytarması və lazım olduqda yeni satış edin.
- `sunmi/` qovluğunu, qaimə tarixçəsini və bazanı silməyin. Şifrə OS-in qorunan yaddaşına bağlıdır; konfiqurasiyanı başqa PC-yə köçürmək əvəzinə həmin PC-də yenidən bağlayın.

## Əhatə və hazırkı sərhədlər

Avtomatik axın: yeni adi/qarışıq/nisyə satış, bağlı tam və məhsul üzrə qismən qaytarma, davamlı növbə, real fiskal ID, cihazın verdiyi rəsmi QR prefiksi ilə nəticə, dublikatdan qorunma. Müdir ekranı: bağlantı/printer, növbə açılışı, X/Z, fiskal mədaxil/məxaric, son çekin surəti, nəzarət lenti, dövr üzrə Z, pul qutusu.

API kitabxanasında sənəddəki **21 əməliyyat** var. Lakin bunların hamısı mövcud POS qaimələri ilə avtomatik əlaqələndirilmir: sonrakı **borc ödənişi (`credit`)**, **avans/avans məhsulları və avansın bağlanması**, **korreksiya/rollBack**, xaricdə çap edilmiş köhnə sənədin yoxlamasız qaytarılması üçün ayrıca biznes əlaqələndirməsi tələb olunur. Bu yollar üçün saxta ilkin fiskal ID və ya təxmini məhsul bölgüsü yaradılmır. Bu əməliyyatları işlədən müəssisə provayderlə həmin axınların qəbulunu tamamlamadan yalnız bu paketi tam fiskal həll saymamalıdır. Restaurant-da məbləğlə qismən qaytarmanın məhsul bölgüsü yoxdursa, məhsul üzrə qaytarma seçin; proqram özü miqdar uydurmur.

Hər PC/tenant öz cihaz konfiqurasiyasını saxlayır. Bir SUNMI-ni eyni anda iki müstəqil POS-un ortaq fiskal növbəsi kimi qoşmayın; çoxkassalı/LAN yerləşdirməni Caspos ilə ayrıca yoxlayın. Bu versiya SUNMI-ni internet üzərindən idarə edən cloud tuneli yaratmır.

## Yoxlanılan mühit

Node-un yerli HTTP SUNMI imitatoru, Linux native nüvə sınaqları, MinGW ilə Windows x64 yığımı və Wine-də Windows nüvə sınaqları. 360/390/768/1366/1920 px-də real ayar komponentinin yerləşməsi, təkrar toxunma, saxlanmamış mətnin qorunması və RRN forması Chromium ilə yoxlanıb. Faktiki nəticələr `VERIFICATION.md`-dədir. **Fiziki SUNMI/kağız/bank/RRN qəbul sınağı keçirilməyib.**
