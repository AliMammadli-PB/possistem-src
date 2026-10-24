import type { HelpTopic, SupportLanguage } from './support-assistant';
type Trio = [string, string, string];
type Area = { id: string; href: string; test: RegExp; ask: Trio; title: Trio; items: Trio[] };
const pick = (c: Trio, l: SupportLanguage) => c[l === 'ru' ? 2 : l === 'en' ? 1 : 0];
const lines = (az: string, en: string, ru: string): Trio[] => {
  const a = az.trim().split('\n'), b = en.trim().split('\n'), c = ru.trim().split('\n');
  if (a.length !== b.length || a.length !== c.length || a.length < 31) throw new Error(`checklist ${a.length}/${b.length}/${c.length}`);
  return a.map((row, i) => [row, b[i], c[i]]);
};
const area = (id: string, href: string, test: RegExp, ask: Trio, title: Trio, az: string, en: string, ru: string): Area => ({ id, href, test, ask, title, items: lines(az, en, ru) });

const AREAS: Area[] = [
 area('stock','/melumatlar/#filiallar',/anbar|qaliq|stok|mallar/,['Anbar və qalıq','Stock and inventory','Склад и остатки'],['Anbar: 32 yoxlama və alternativ','Stock: 32 checks and alternatives','Склад: 32 проверки и альтернативы'],
`Yoxlama: açıq proqramın Market POS, Restoran POS və ya sayt paneli olduğunu görün. Alternativ: pəncərə başlığındakı ada baxın.
Yoxlama: seçilmiş filialı oxuyun. Alternativ: siyahını bağlayıb eyni filialı yenidən seçin.
Yoxlama: iki filialın qalığını qarışdırmayın. Alternativ: eyni barkodu hər filialda ayrıca axtarın.
Yoxlama: axtarış sətrini təmizləyin. Alternativ: səhifəni bir dəfə yeniləyin.
Yoxlama: kateqoriya filtrini sıfırlayın. Alternativ: «hamısı» seçimini açın.
Yoxlama: anbar filtrini sıfırlayın. Alternativ: əsas anbarı siyahıdan açıq seçin.
Yoxlama: məhsulu adla yox, barkodla axtarın. Alternativ: məhsul kodu ilə axtarın.
Yoxlama: eyni adlı iki kartı müqayisə edin. Alternativ: köhnə kartı satışa bağlayın, silməyin.
Yoxlama: barkoddakı boşluq və artıq sıfırları yoxlayın. Alternativ: kartı skanerlə yenidən oxudun.
Yoxlama: vahidi müqayisə edin, ədəd, kq və ya qutu. Alternativ: alış vahidi ilə satış vahidini yana qoyun.
Yoxlama: alış qaiməsinin saxlandığını görün. Alternativ: qaralamalar siyahısını açın.
Yoxlama: qaimənin təsdiqləndiyini görün. Alternativ: təsdiqsiz sənədi ikinci dəfə yaratmayın.
Yoxlama: qaimə miqdarını ekrandakı qalıqla tutuşdurun. Alternativ: sənəd nömrəsini qeyd edin.
Yoxlama: yerdəyişmə qaralamadadırsa qalıq artmır. Alternativ: göndərən filialda qalığın azalıb-azalmadığına baxın.
Yoxlama: qəbul təsdiqlənməyibsə satış qalığı artmır. Alternativ: qəbul edən filialda həmin qaiməni açın.
Yoxlama: qismən qəbulda yalnız qəbul edilən miqdar düşür. Alternativ: rədd səbəbini oxuyun.
Yoxlama: satışdan sonra qalıq düşmürsə, satışın tarixçədə tamamlandığını görün. Alternativ: həmin çeki təkrarlamayın.
Yoxlama: qaytarmanı yeni stok artırma ilə əvəz etməyin. Alternativ: qaytarma sənədinin bağlandığını yoxlayın.
Yoxlama: sayt ilə kassa fərqlidirsə, son sinxron vaxtını oxuyun. Alternativ: kassanı qoşulu saxlayıb bir dəfə yeniləyin.
Yoxlama: gecikməyə görə eyni qaiməni yenidən yazmayın. Alternativ: bir neçə dəqiqə sonra eyni sənəd nömrəsini axtarın.
Yoxlama: ekran «Yüklənir»də qalırsa versiyanı və xəta mətnini yazın. Alternativ: proqramı bir dəfə bağlayıb açın, bazanı silməyin.
Yoxlama: mənfi qalıq varsa son satışı və silinməni oxuyun. Alternativ: əl ilə miqdar əlavə etməklə düzəltməyin.
Yoxlama: qiymət dəyişməsinin qalığı dəyişmədiyini bilin. Alternativ: miqdar üçün yalnız hərəkət sənədinə baxın.
Yoxlama: endirim filtrinin məhsulu gizlətmədiyini yoxlayın. Alternativ: bütün filtrləri söndürün.
Yoxlama: istifadəçi anbarı görmürsə roluna baxın. Alternativ: rəhbər hesabla eyni məhsulu açın.
Yoxlama: başqa kompüterin bazasını kopyalamayın. Alternativ: ehtiyat nüsxəni həmin filialın öz faylından bərpa edin.
Yoxlama: demo qalığını real qalıq sanmayın. Alternativ: /demo səhifəsini kassa proqramından ayırın.
Yoxlama: anbarda var, satışda yoxdursa, məhsulun satışa açıq olduğunu görün. Alternativ: dayandırılmış işarəsini yoxlayın.
Yoxlama: barkod səhv məhsul açırsa kartları müqayisə edin. Alternativ: təkrar barkodlu ikinci kartı satışdan çıxarın.
Yoxlama: qutu və ədəd çevrilməsini oxuyun. Alternativ: 1 qutunun neçə ədəd olduğunu kartın üzərindən yoxlayın.
Yoxlama: son hərəkətin növünü oxuyun: alış, satış, yerdəyişmə və ya qaytarma. Alternativ: sənədi açmadan rəqəmi düzəltməyin.
Yoxlama: heç biri uyğun gəlmirsə filialı, barkodu, gözlənilən və ekrandakı miqdarı yazın. Alternativ: live agent yazın, şifrə göndərməyin.`,
`Check: see whether Market POS, Restaurant POS or the website portal is open. Alternative: read the window title.
Check: read the selected branch. Alternative: close the list and select the same branch again.
Check: do not mix two branches’ quantities. Alternative: search the same barcode in each branch.
Check: clear the search box. Alternative: refresh the page once.
Check: reset the category filter. Alternative: choose All.
Check: reset the warehouse filter. Alternative: explicitly select the main warehouse.
Check: search by barcode, not only by name. Alternative: search by product code.
Check: compare two cards with the same name. Alternative: stop selling the old card, do not delete it.
Check: look for spaces and extra zeros in the barcode. Alternative: scan the card again.
Check: compare the unit, piece, kilogram or box. Alternative: put the purchase unit next to the sale unit.
Check: see that the purchase document was saved. Alternative: open the drafts list.
Check: see that the document was confirmed. Alternative: do not create the unconfirmed document a second time.
Check: match the document quantity with the quantity on screen. Alternative: write down the document number.
Check: a draft transfer does not increase stock. Alternative: see whether the sender’s quantity decreased.
Check: stock does not increase before acceptance. Alternative: open that document at the receiving branch.
Check: a partial acceptance adds only the accepted quantity. Alternative: read the rejection reason.
Check: if stock does not fall after a sale, see that the sale is complete in history. Alternative: do not repeat that receipt.
Check: do not replace a return with a new stock increase. Alternative: see that the return document is closed.
Check: if the site and the till differ, read the last sync time. Alternative: keep the till online and refresh once.
Check: do not write the same document again because of a delay. Alternative: search the same document number a few minutes later.
Check: if the screen stays on Loading, write the version and the error. Alternative: close and open the program once, do not delete the database.
Check: if the quantity is negative, read the last sale and deletion. Alternative: do not fix it by typing a quantity by hand.
Check: a price change does not change the quantity. Alternative: look only at a movement document for quantity.
Check: a discount filter is not hiding the product. Alternative: turn all filters off.
Check: if the user cannot see stock, look at the role. Alternative: open the same product with a manager account.
Check: do not copy another computer’s database. Alternative: restore the backup that belongs to this branch.
Check: do not treat demo stock as real stock. Alternative: keep /demo separate from the till program.
Check: if it is in stock but not for sale, see that the product is open for sale. Alternative: look for a stopped flag.
Check: if the barcode opens the wrong product, compare the cards. Alternative: remove the second card with the duplicate barcode from sale.
Check: read the box-to-piece conversion. Alternative: see on the card how many pieces are in one box.
Check: read the type of the last movement: purchase, sale, transfer or return. Alternative: do not change the number without opening the document.
Check: if none of this fits, write the branch, barcode, expected quantity and the quantity on screen. Alternative: type live agent and do not send a password.`,
`Проверка: откройте Market POS, Restaurant POS или панель сайта. Альтернатива: прочитайте заголовок окна.
Проверка: прочитайте выбранный филиал. Альтернатива: закройте список и выберите тот же филиал снова.
Проверка: не смешивайте остатки двух филиалов. Альтернатива: найдите тот же штрихкод в каждом филиале.
Проверка: очистите строку поиска. Альтернатива: обновите страницу один раз.
Проверка: сбросьте фильтр категории. Альтернатива: выберите «все».
Проверка: сбросьте фильтр склада. Альтернатива: явно выберите основной склад.
Проверка: ищите по штрихкоду, а не только по названию. Альтернатива: ищите по коду товара.
Проверка: сравните две карточки с одним названием. Альтернатива: закройте старую карточку для продажи, не удаляйте её.
Проверка: найдите пробелы и лишние нули в штрихкоде. Альтернатива: считайте карточку сканером ещё раз.
Проверка: сравните единицу, штуку, кг или коробку. Альтернатива: поставьте единицу закупки рядом с единицей продажи.
Проверка: убедитесь, что приход сохранён. Альтернатива: откройте список черновиков.
Проверка: убедитесь, что документ подтверждён. Альтернатива: не создавайте неподтверждённый документ второй раз.
Проверка: сверьте количество в документе с количеством на экране. Альтернатива: запишите номер документа.
Проверка: черновик перемещения не увеличивает остаток. Альтернатива: посмотрите, уменьшился ли остаток у отправителя.
Проверка: остаток не растёт до подтверждения приёмки. Альтернатива: откройте этот документ у получателя.
Проверка: при частичной приёмке добавляется только принятое количество. Альтернатива: прочитайте причину отказа.
Проверка: если после продажи остаток не уменьшился, проверьте завершение продажи в истории. Альтернатива: не повторяйте этот чек.
Проверка: не заменяйте возврат новым увеличением остатка. Альтернатива: проверьте, что документ возврата закрыт.
Проверка: если сайт и касса расходятся, прочитайте время синхронизации. Альтернатива: оставьте кассу онлайн и обновите один раз.
Проверка: не пишите тот же документ снова из-за задержки. Альтернатива: через несколько минут найдите тот же номер.
Проверка: если экран остаётся на «Загрузка», запишите версию и ошибку. Альтернатива: закройте и откройте программу, базу не удаляйте.
Проверка: при отрицательном остатке прочитайте последнюю продажу и удаление. Альтернатива: не исправляйте это ручным вводом количества.
Проверка: смена цены не меняет количество. Альтернатива: для количества смотрите только документ движения.
Проверка: фильтр скидки не прячет товар. Альтернатива: выключите все фильтры.
Проверка: если пользователь не видит склад, смотрите роль. Альтернатива: откройте тот же товар учётной записью руководителя.
Проверка: не копируйте базу другого компьютера. Альтернатива: восстановите копию именно этого филиала.
Проверка: не считайте остаток демо настоящим. Альтернатива: держите /demo отдельно от кассовой программы.
Проверка: если товар на складе, но не продаётся, проверьте, что он открыт для продажи. Альтернатива: найдите признак остановки.
Проверка: если штрихкод открывает не тот товар, сравните карточки. Альтернатива: уберите из продажи вторую карточку с тем же штрихкодом.
Проверка: прочитайте перевод коробки в штуки. Альтернатива: посмотрите на карточке, сколько штук в одной коробке.
Проверка: прочитайте тип последнего движения: закупка, продажа, перемещение или возврат. Альтернатива: не меняйте цифру, не открыв документ.
Проверка: если ничего не подошло, напишите филиал, штрихкод, ожидаемое и экранное количество. Альтернатива: напишите live agent и не отправляйте пароль.`),
 area('printer','/qurasdirma/',/printer|(^|\s)cek(\s|$)|qebz|(^|\s)cap(\s|$)/,['Printer və çek','Printer and receipt','Принтер и чек'],['Printer: 32 yoxlama və alternativ','Printer: 32 checks and alternatives','Принтер: 32 проверки и альтернативы'],
`Yoxlama: printerin işığını və elektrikini görün. Alternativ: başqa rozetkaya taxın.
Yoxlama: kağızın istiqamətini və qapağı yoxlayın. Alternativ: lent və ya kağız xəta işığını söndürün.
Yoxlama: USB kabelini çıxarıb yenidən taxın. Alternativ: başqa USB girişini yoxlayın.
Yoxlama: şəbəkə printerində IP-nin açıldığını yoxlayın. Alternativ: eyni şəbəkədəki başqa kompüterdən ping edin.
Yoxlama: Parametrlər, Printer bölməsində siyahını yeniləyin. Alternativ: proqramı bir dəfə bağlayıb açın.
Yoxlama: kassaya təyin olunan printerin adını oxuyun. Alternativ: səhv təyinatı silib düzgün cihazı seçin.
Yoxlama: virtual printerin kağıza çap etmədiyini bilin. Alternativ: fiziki modeli seçin.
Yoxlama: kassa printerini mətbəx printeri ilə qarışdırmayın. Alternativ: hər təyinatı ayrıca adlandırın.
Yoxlama: yalnız bir test çapı göndərin. Alternativ: növbədə ilişən işləri Windows-da dayandırın.
Yoxlama: Windows-da printerin oflayn olmadığını görün. Alternativ: növbəni davam etdirin.
Yoxlama: istehsalçının sürücüsünü modelə görə yoxlayın. Alternativ: ümumi sürücü test vermirsə model sürücüsünü qurun.
Yoxlama: test çıxır, satış çeki çıxmırsa, satışın tarixçədə bitdiyini görün. Alternativ: ödənişi ikinci dəfə etməyin.
Yoxlama: mövcud sənədin təkrar çapından istifadə edin. Alternativ: yeni satış açmayın.
Yoxlama: kağız enini printerin real eni ilə tutuşdurun. Alternativ: 80 mm və 58 mm şablonunu dəyişin.
Yoxlama: önizləməni fiziki testin əvəzi sanmayın. Alternativ: bir kağız test saxlayın.
Yoxlama: loqo çeki kəsirsə, şəkli kiçildin. Alternativ: loqosuz bir test edin.
Yoxlama: QR boşdursa, çek ayarında linkin dolu olduğunu görün. Alternativ: linki brauzerdə açın.
Yoxlama: QR oxunmursa, ətrafındakı ağ boşluğu saxlayın. Alternativ: kontrastı artırın.
Yoxlama: çap yarımçıq qalırsa, kağız rulonunu dəyişin. Alternativ: başlığı təmizləyin.
Yoxlama: hər satışda iki çek çıxırsa, təkrar printer təyinatını silin. Alternativ: test növbəsinə baxın.
Yoxlama: heç bir səs yoxdursa, cihazın seçilmədiyini yoxlayın. Alternativ: standart Windows printerini müvəqqəti seçin.
Yoxlama: kəsici işləmirsə, avtomatik kəsməni söndürüb əl ilə kəsin. Alternativ: kəsici xətasını sürücü panelindən sıfırlayın.
Yoxlama: simvollar qarışıqdırsa, kodlaşdırmanı dəyişin. Alternativ: sadə mətnlə bir test edin.
Yoxlama: çek çox uzundursa, satır sayını azaldın. Alternativ: loqo və alt yazını müvəqqəti bağlayın.
Yoxlama: şəbəkə kəsilibsə, USB ilə bir test edin. Alternativ: kabeli birbaşa kompüterə taxın.
Yoxlama: başqa proqram printeri tutursa, onu bağlayın. Alternativ: kompüteri bir dəfə yenidən başladın.
Yoxlama: sürücü xəta verirsə, modeli və Windows versiyasını yazın. Alternativ: köhnə sürücünü silib yenidən qurun.
Yoxlama: pul qutusu açılmırsa, printerin DK portunu yoxlayın. Alternativ: qutunu əl ilə açın, satışı təkrarlamayın.
Yoxlama: mətbəx çeki gecikirsə, mətbəx təyinatının aktiv olduğunu görün. Alternativ: kassa çekindən ayrıca test göndərin.
Yoxlama: kağız boş çıxırsa, lentin isti tərəfini çevirin. Alternativ: başqa rulon taxın.
Yoxlama: satış bitməyibsə çek gözləməyin. Alternativ: əvvəl ödənişin tarixçədə göründüyünü yoxlayın.
Yoxlama: heç biri uyğun gəlmirsə modeli, USB və ya şəbəkəni və testin nəticəsini yazın. Alternativ: live agent yazın, şifrə göndərməyin.`,
`Check: look at the printer light and power. Alternative: try another socket.
Check: check the paper direction and the lid. Alternative: clear the paper or ribbon error light.
Check: unplug the USB cable and plug it back. Alternative: try another USB port.
Check: for a network printer, see that the IP opens. Alternative: ping it from another computer on the same network.
Check: in Settings, Printer, refresh the list. Alternative: close and open the program once.
Check: read the printer name assigned to the till. Alternative: remove the wrong assignment and select the right device.
Check: a virtual printer does not print on paper. Alternative: select the physical model.
Check: do not mix the till printer with the kitchen printer. Alternative: name each assignment separately.
Check: send only one test print. Alternative: clear stuck jobs in the Windows queue.
Check: see that Windows does not show the printer offline. Alternative: resume the queue.
Check: check the manufacturer driver for the model. Alternative: if a generic driver fails the test, install the model driver.
Check: if the test prints but the sale receipt does not, see that the sale finished in history. Alternative: do not take payment a second time.
Check: reprint the existing document. Alternative: do not open a new sale.
Check: match the paper width with the printer’s real width. Alternative: switch the 80 mm and 58 mm template.
Check: do not treat the preview as a paper test. Alternative: keep one printed test.
Check: if the logo cuts the receipt, shrink the image. Alternative: run one test without the logo.
Check: if the QR is empty, see that the receipt link is filled in. Alternative: open the link in a browser.
Check: if the QR will not scan, keep the white margin. Alternative: increase the contrast.
Check: if printing stops halfway, change the paper roll. Alternative: clean the head.
Check: if every sale prints two receipts, remove the duplicate assignment. Alternative: look at the test queue.
Check: if there is no sound at all, see that a device is selected. Alternative: temporarily select the Windows default printer.
Check: if the cutter fails, turn off auto-cut and tear by hand. Alternative: reset the cutter error in the driver.
Check: if characters are scrambled, change the encoding. Alternative: print one plain-text test.
Check: if the receipt is too long, reduce the line count. Alternative: temporarily turn off the logo and footer.
Check: if the network is down, run one USB test. Alternative: plug the cable straight into the computer.
Check: if another program holds the printer, close it. Alternative: restart the computer once.
Check: if the driver errors, write the model and Windows version. Alternative: remove the old driver and install it again.
Check: if the cash drawer does not open, check the printer DK port. Alternative: open the drawer by hand and do not repeat the sale.
Check: if the kitchen ticket is late, see that the kitchen assignment is active. Alternative: send a separate test from the till receipt.
Check: if the paper comes out blank, flip the thermal side. Alternative: load another roll.
Check: do not wait for a receipt if the sale did not finish. Alternative: first see that the payment appears in history.
Check: if none of this fits, write the model, USB or network, and the test result. Alternative: type live agent and do not send a password.`,
`Проверка: посмотрите индикатор и питание принтера. Альтернатива: попробуйте другую розетку.
Проверка: проверьте направление бумаги и крышку. Альтернатива: снимите индикатор ошибки бумаги или ленты.
Проверка: выньте USB и вставьте снова. Альтернатива: попробуйте другой порт USB.
Проверка: у сетевого принтера проверьте, что IP открывается. Альтернатива: выполните ping с другого компьютера в той же сети.
Проверка: в «Параметры, Принтер» обновите список. Альтернатива: закройте и откройте программу один раз.
Проверка: прочитайте имя принтера, назначенного кассе. Альтернатива: уберите неверное назначение и выберите нужное устройство.
Проверка: виртуальный принтер не печатает на бумагу. Альтернатива: выберите физическую модель.
Проверка: не путайте принтер кассы с кухонным. Альтернатива: назовите каждое назначение отдельно.
Проверка: отправьте только одну пробную печать. Альтернатива: уберите застрявшие задания в очереди Windows.
Проверка: убедитесь, что Windows не показывает принтер как офлайн. Альтернатива: возобновите очередь.
Проверка: проверьте драйвер производителя для модели. Альтернатива: если общий драйвер не печатает пробу, поставьте драйвер модели.
Проверка: если проба есть, а чек продажи нет, проверьте завершение продажи в истории. Альтернатива: не проводите оплату второй раз.
Проверка: печатайте существующий документ повторно. Альтернатива: не открывайте новую продажу.
Проверка: сверьте ширину бумаги с реальной шириной принтера. Альтернатива: переключите шаблон 80 мм и 58 мм.
Проверка: не заменяйте предпросмотр бумажной пробой. Альтернатива: сохраните одну напечатанную пробу.
Проверка: если логотип обрезает чек, уменьшите изображение. Альтернатива: сделайте одну пробу без логотипа.
Проверка: если QR пустой, проверьте, что ссылка чека заполнена. Альтернатива: откройте ссылку в браузере.
Проверка: если QR не считывается, сохраните белое поле. Альтернатива: увеличьте контраст.
Проверка: если печать обрывается, смените рулон. Альтернатива: очистите головку.
Проверка: если каждая продажа печатает два чека, удалите повторное назначение. Альтернатива: посмотрите очередь пробы.
Проверка: если звука нет совсем, проверьте, что устройство выбрано. Альтернатива: временно выберите принтер Windows по умолчанию.
Проверка: если резак не работает, выключите автоотрезание и оторвите вручную. Альтернатива: сбросьте ошибку резака в драйвере.
Проверка: если символы перемешаны, смените кодировку. Альтернатива: напечатайте одну пробу простым текстом.
Проверка: если чек слишком длинный, уменьшите число строк. Альтернатива: временно выключите логотип и нижний текст.
Проверка: если сеть пропала, сделайте одну пробу по USB. Альтернатива: вставьте кабель прямо в компьютер.
Проверка: если другую программу держит принтер, закройте её. Альтернатива: перезагрузите компьютер один раз.
Проверка: если драйвер выдаёт ошибку, запишите модель и версию Windows. Альтернатива: удалите старый драйвер и поставьте снова.
Проверка: если денежный ящик не открывается, проверьте порт DK принтера. Альтернатива: откройте ящик вручную и не повторяйте продажу.
Проверка: если кухонный чек задерживается, проверьте, что кухонное назначение активно. Альтернатива: отправьте отдельную пробу с кассового чека.
Проверка: если бумага выходит пустой, переверните термосторону. Альтернатива: поставьте другой рулон.
Проверка: не ждите чек, если продажа не завершилась. Альтернатива: сначала проверьте, что оплата видна в истории.
Проверка: если ничего не подошло, напишите модель, USB или сеть и результат пробы. Альтернатива: напишите live agent и не отправляйте пароль.`),
 area('scale','/qurasdirma/',/terezi|etiket|plu/,['Tərəzi və etiket','Scale and label','Весы и этикетка'],['Tərəzi: 32 yoxlama və alternativ','Scale: 32 checks and alternatives','Весы: 32 проверки и альтернативы'],
`Yoxlama: tərəzinin modelini oxuyun. Alternativ: altındakı stikerə baxın.
Yoxlama: etiket ölçüsünü şablonla tutuşdurun. Alternativ: 45 × 25 mm üçün həmin ölçünü seçin.
Yoxlama: tərəzinin öz çapını ayrıca etiket printerindən ayırın. Alternativ: X-printer axınını tərəzi axını ilə qarışdırmayın.
Yoxlama: məhsulun PLU nömrəsini kartla müqayisə edin. Alternativ: PLU-nu tərəzidə yenidən seçin.
Yoxlama: kq satış qiymətini kartla tutuşdurun. Alternativ: ədəd qiymətini kq qiymətinin yerinə yazmayın.
Yoxlama: 8.00 manatın 800 qəpik olduğunu bilin. Alternativ: etiketdə 800 görünürsə onluq formatı yoxlayın, qiyməti 100 dəfə azaltmayın.
Yoxlama: vahidin kq olduğunu görün. Alternativ: qram və kiloqramı qarışdırmayın.
Yoxlama: barkodun çəki kodunu oxuyun. Alternativ: rəqəmləri kağızdan yazın.
Yoxlama: barkod market kartındakı satış barkodu ilə eyni olmaya bilər. Alternativ: iki barkodu yana qoyun.
Yoxlama: kiçik çəkidə bir sınaq edin. Alternativ: çəki ilə kq qiymətini vurub yekunla müqayisə edin.
Yoxlama: ad, qiymət, çəki və barkodun kağıza sığdığını görün. Alternativ: şrifti bir pillə kiçildin.
Yoxlama: barkod oxunmursa, ağ boşluğu saxlayın. Alternativ: çap sıxlığını artırın.
Yoxlama: başqa məhsul çıxırsa, PLU təyinatını yoxlayın. Alternativ: həmin PLU-nu başqa kartdan götürün.
Yoxlama: protokolun modelə uyğun olduğunu bilin. Alternativ: başqa modelin şablonunu zorla tətbiq etməyin.
Yoxlama: etiket printerinin sürücüsünü ayrıca yoxlayın. Alternativ: birbaşa tərəzidən bir etiket çıxarın.
Yoxlama: qiymət güncəldisə, tərəziyə yenidən göndərin. Alternativ: köhnə etiketi satışda istifadə etməyin.
Yoxlama: çəki sıfırda qalırsa, tərəzini boşaldın. Alternativ: tara funksiyasını sıfırlayın.
Yoxlama: çəki tullanırsa, tərəzini düz yerə qoyun. Alternativ: yükü götürüb yenidən qoyun.
Yoxlama: etiket çıxmırsa, rulonu və başlığı yoxlayın. Alternativ: bir boş etiket buraxın.
Yoxlama: etiket yapışırsa, temperaturu azaldın. Alternativ: başqa etiket partiyasını taxın.
Yoxlama: tarix və ya ad kəsilibsə, sahənin uzunluğunu azaldın. Alternativ: qısa məhsul adı yazın.
Yoxlama: barkod prefiksini market ayarı ilə tutuşdurun. Alternativ: prefiksi bir sınaqda dəyişmədən əvvəl yazın.
Yoxlama: yekun məbləğ çəkidən fərqlidirsə, yuvarlaqlaşmanı yoxlayın. Alternativ: eyni çəkini ikinci dəfə vurun.
Yoxlama: endirimli qiymət etiketə düşmürsə, hansı qiymətin göndərildiyini görün. Alternativ: əsas kq qiyməti ilə sınaq edin.
Yoxlama: bir neçə tərəzi varsa, düzgün şöbəni seçin. Alternativ: hər tərəzinin PLU siyahısını ayrı saxlayın.
Yoxlama: göndəriş bitməyibsə, yeni qiymət etiketə düşmür. Alternativ: göndərişi təkrarlamazdan əvvəl statusa baxın.
Yoxlama: kabel və ya şəbəkə kəsilibsə, tərəzi oflayn qalır. Alternativ: birbaşa kabel ilə bir sınaq edin.
Yoxlama: market satışında çəki barkodu tapılmırsa, kodlama qaydasını yazın. Alternativ: rəqəmləri əl ilə axtarışa yazın.
Yoxlama: əl ilə qiymət yazmaq etiket qaydasını pozursa, onu dayandırın. Alternativ: kartın kq qiymətinə qayıdın.
Yoxlama: etiketdə köhnə ad qalırsa, PLU-nun başqa məhsula bağlı olduğunu yoxlayın. Alternativ: yeni PLU verin.
Yoxlama: sınaq etiketini saxlayın. Alternativ: fotosunu çəkib modeli ilə birlikdə yazın.
Yoxlama: heç biri uyğun gəlmirsə modeli, ölçünü, qiyməti və çəkini yazın. Alternativ: live agent yazın, şifrə göndərməyin.`,
`Check: read the scale model. Alternative: look at the sticker underneath.
Check: match the label size with the template. Alternative: for 45 × 25 mm, select that size.
Check: separate the scale’s own print from a separate label printer. Alternative: do not mix an X-printer flow with the scale flow.
Check: compare the product PLU with the card. Alternative: select the PLU on the scale again.
Check: match the price per kilogram with the card. Alternative: do not type a piece price in the kilogram field.
Check: 8.00 manat is 800 minor units. Alternative: if the label shows 800, check the decimal format and do not divide the price by 100.
Check: see that the unit is kilogram. Alternative: do not mix grams and kilograms.
Check: read the weight code in the barcode. Alternative: write the digits from the paper.
Check: the barcode may differ from the sales barcode on the market card. Alternative: put the two barcodes side by side.
Check: run one small-weight test. Alternative: multiply weight by price per kilogram and compare the total.
Check: see that name, price, weight and barcode fit the paper. Alternative: reduce the font by one step.
Check: if the barcode will not scan, keep the white margin. Alternative: increase the print density.
Check: if another product appears, check the PLU assignment. Alternative: take that PLU off the other card.
Check: the protocol must match the model. Alternative: do not force another model’s template.
Check: check the label printer driver separately. Alternative: print one label directly from the scale.
Check: if the price changed, send it to the scale again. Alternative: do not sell with the old label.
Check: if the weight stays at zero, empty the scale. Alternative: reset the tare.
Check: if the weight jumps, put the scale on a flat surface. Alternative: remove the load and put it back.
Check: if no label comes out, check the roll and the head. Alternative: feed one blank label.
Check: if the label sticks, lower the temperature. Alternative: load another batch of labels.
Check: if the date or name is cut off, shorten the field. Alternative: use a short product name.
Check: match the barcode prefix with the market setting. Alternative: write the prefix down before changing it in a test.
Check: if the total differs from the weight, check rounding. Alternative: weigh the same item a second time.
Check: if a discounted price does not reach the label, see which price was sent. Alternative: test with the base price per kilogram.
Check: if there are several scales, select the right department. Alternative: keep each scale’s PLU list separate.
Check: a new price does not print until the send finishes. Alternative: read the status before sending again.
Check: if the cable or network is down, the scale stays offline. Alternative: run one test with a direct cable.
Check: if Market does not find the weight barcode, write the encoding rule. Alternative: type the digits into search by hand.
Check: if typing a price by hand breaks the label rule, stop doing it. Alternative: return to the card’s price per kilogram.
Check: if the label keeps an old name, see whether the PLU belongs to another product. Alternative: assign a new PLU.
Check: keep the test label. Alternative: photograph it and write the model with it.
Check: if none of this fits, write the model, size, price and weight. Alternative: type live agent and do not send a password.`,
`Проверка: прочитайте модель весов. Альтернатива: посмотрите наклейку снизу.
Проверка: сверьте размер этикетки с шаблоном. Альтернатива: для 45 × 25 мм выберите этот размер.
Проверка: отделите печать самих весов от отдельного принтера этикеток. Альтернатива: не смешивайте поток X-printer с потоком весов.
Проверка: сравните PLU товара с карточкой. Альтернатива: выберите PLU на весах снова.
Проверка: сверьте цену за килограмм с карточкой. Альтернатива: не пишите цену за штуку в поле килограмма.
Проверка: 8.00 маната — это 800 копеек. Альтернатива: если на этикетке 800, проверьте десятичный формат и не делите цену на 100.
Проверка: убедитесь, что единица — килограмм. Альтернатива: не путайте граммы и килограммы.
Проверка: прочитайте весовой код в штрихкоде. Альтернатива: перепишите цифры с бумаги.
Проверка: штрихкод может отличаться от продажного штрихкода карточки маркета. Альтернатива: положите два штрихкода рядом.
Проверка: сделайте одну пробу с небольшим весом. Альтернатива: умножьте вес на цену за кг и сравните итог.
Проверка: убедитесь, что имя, цена, вес и штрихкод помещаются. Альтернатива: уменьшите шрифт на шаг.
Проверка: если штрихкод не считывается, сохраните белое поле. Альтернатива: увеличьте плотность печати.
Проверка: если выходит другой товар, проверьте назначение PLU. Альтернатива: снимите этот PLU с другой карточки.
Проверка: протокол должен соответствовать модели. Альтернатива: не навязывайте шаблон другой модели.
Проверка: драйвер принтера этикеток проверьте отдельно. Альтернатива: напечатайте одну этикетку прямо с весов.
Проверка: если цена изменилась, отправьте её на весы снова. Альтернатива: не продавайте по старой этикетке.
Проверка: если вес остаётся на нуле, освободите весы. Альтернатива: сбросьте тару.
Проверка: если вес скачет, поставьте весы на ровную поверхность. Альтернатива: снимите груз и положите снова.
Проверка: если этикетка не выходит, проверьте рулон и головку. Альтернатива: протяните одну пустую этикетку.
Проверка: если этикетка липнет, снизьте температуру. Альтернатива: поставьте другую партию этикеток.
Проверка: если дата или имя обрезаны, сократите поле. Альтернатива: напишите короткое имя товара.
Проверка: сверьте префикс штрихкода с настройкой маркета. Альтернатива: запишите префикс, прежде чем менять его в пробе.
Проверка: если итог не сходится с весом, проверьте округление. Альтернатива: взвесьте тот же товар второй раз.
Проверка: если цена со скидкой не попадает на этикетку, посмотрите, какая цена отправлена. Альтернатива: проверьте базовую цену за кг.
Проверка: если весов несколько, выберите нужный отдел. Альтернатива: храните список PLU каждых весов отдельно.
Проверка: новая цена не печатается, пока отправка не закончилась. Альтернатива: прочитайте статус, прежде чем отправлять снова.
Проверка: если кабель или сеть пропали, весы остаются офлайн. Альтернатива: сделайте одну пробу прямым кабелем.
Проверка: если Маркет не находит весовой штрихкод, запишите правило кодирования. Альтернатива: введите цифры в поиск вручную.
Проверка: если ручная цена ломает правило этикетки, прекратите это. Альтернатива: вернитесь к цене за кг в карточке.
Проверка: если на этикетке старое имя, проверьте, не принадлежит ли PLU другому товару. Альтернатива: задайте новый PLU.
Проверка: сохраните пробную этикетку. Альтернатива: сфотографируйте её и напишите модель.
Проверка: если ничего не подошло, напишите модель, размер, цену и вес. Альтернатива: напишите live agent и не отправляйте пароль.`),
 area('barcode','/demo/?system=market',/barkod/,['Barkod','Barcode','Штрихкод'],['Barkod: 32 yoxlama və alternativ','Barcode: 32 checks and alternatives','Штрихкод: 32 проверки и альтернативы'],
`Yoxlama: skanerin işığını yandırın. Alternativ: düyməli skanerdə tətiyi bir dəfə basın.
Yoxlama: kursorun axtarış sətrində olduğunu görün. Alternativ: sətrin içinə bir dəfə toxunun.
Yoxlama: skaner heç bir rəqəm düşürmürsə, problem məhsulda deyil. Alternativ: bir rəqəmi klaviatura ilə yazın.
Yoxlama: skaneri Notepad-da sınayın. Alternativ: orada da rəqəm yoxdursa, skaner və ya kabel xətasıdır.
Yoxlama: USB skanerini başqa porta taxın. Alternativ: başqa kabel yoxlayın.
Yoxlama: simsiz skanerin bazasının qoşulu olduğunu görün. Alternativ: skaneri bazaya qoyub cütləşdirin.
Yoxlama: prefiks və şəkilçənin Enter göndərdiyini yoxlayın. Alternativ: Enter yoxdursa, axtarış özü bitməz.
Yoxlama: klaviatura dilinin rəqəm sırasını pozmadığını görün. Alternativ: İngilis qrafasına keçin.
Yoxlama: oxunan rəqəmi məhsul kartı ilə tutuşdurun. Alternativ: kartı açmadan satışa keçməyin.
Yoxlama: barkoddakı boşluğu silin. Alternativ: kartı skanerlə yenidən yazın.
Yoxlama: əvvəldəki sıfırın itib-itmədiyini yoxlayın. Alternativ: sıfırı əl ilə əlavə edib axtarın.
Yoxlama: eyni barkodlu iki kartı tapın. Alternativ: ikincini satışa bağlayın.
Yoxlama: böyük və kiçik hərf fərqini yoxlayın. Alternativ: kartı olduğu kimi kopyalayın.
Yoxlama: QR və xətti barkodu qarışdırmayın. Alternativ: skaner tipinin hər ikisini oxuduğunu görün.
Yoxlama: çəki barkodunu satış barkodundan ayırın. Alternativ: tərəzi etiketini ayrıca yoxlayın.
Yoxlama: qutu barkodunu ədəd barkodundan ayırın. Alternativ: hansı vahidin səbətə düşdüyünü oxuyun.
Yoxlama: səbətə səhv məhsul düşürsə, son oxunan rəqəmi yazın. Alternativ: həmin rəqəmi axtarışa əl ilə yapışdırın.
Yoxlama: məhsul tapılmırsa, kartın satışa açıq olduğunu görün. Alternativ: dayandırılmış məhsulu axtarışda ayrıca yoxlayın.
Yoxlama: başqa filialın kartı bu filialda olmaya bilər. Alternativ: filialı dəyişib yenidən skan edin.
Yoxlama: işıq zəifdirsə, barkodu yaxınlaşdırın. Alternativ: etiketi silin və ya yenisini çap edin.
Yoxlama: əzilmiş barkodu oxutmayın. Alternativ: kartdakı rəqəmi əl ilə yazın.
Yoxlama: skaner fasiləsiz oxuyursa, tətiyi buraxın. Alternativ: davamlı rejimi söndürün.
Yoxlama: iki dəfə düşürsə, şəkilçədə iki Enter olduğunu yoxlayın. Alternativ: bir Enter saxlayın.
Yoxlama: market axtarışı qısadırsa, tam rəqəmi gözləyin. Alternativ: Enter-i özünüz basın.
Yoxlama: restoran menyusunda barkod məhsula bağlıdır. Alternativ: menyu elementini açın.
Yoxlama: demo barkodu real kassa barkodu deyil. Alternativ: real proqramda eyni rəqəmi sınayın.
Yoxlama: kamera skaneri işləmirsə, USB skanerə keçin. Alternativ: icazəni brauzerdə yoxlayın.
Yoxlama: səs yoxdursa, skanerin səsini açın. Alternativ: səssiz də rəqəm düşə bilər, sətrə baxın.
Yoxlama: yavaş oxuyursa, linzanı silin. Alternativ: barkodu düz tutun.
Yoxlama: yeni məhsulda barkod boşdursa, kartı saxlamazdan əvvəl yazın. Alternativ: skanerlə sahəyə oxudun.
Yoxlama: köhnə etiketi yeni kartla qarışdırmayın. Alternativ: yeni etiketi çap edin.
Yoxlama: heç biri uyğun gəlmirsə oxunan rəqəmi və kartdakı rəqəmi yazın. Alternativ: live agent yazın, şifrə göndərməyin.`,
`Check: turn on the scanner light. Alternative: on a trigger scanner, press the trigger once.
Check: see that the cursor is in the search field. Alternative: click inside the field once.
Check: if the scanner types no digits, the fault is not the product. Alternative: type one digit from the keyboard.
Check: test the scanner in Notepad. Alternative: if no digits appear there either, the scanner or cable is at fault.
Check: move a USB scanner to another port. Alternative: try another cable.
Check: see that a wireless scanner’s base is connected. Alternative: put the scanner on the base and pair it.
Check: see that the suffix sends Enter. Alternative: without Enter, the search does not finish by itself.
Check: see that the keyboard layout is not changing the digits. Alternative: switch to the English layout.
Check: match the scanned digits with the product card. Alternative: do not continue the sale before opening the card.
Check: remove a space in the barcode. Alternative: write the card again with the scanner.
Check: see whether a leading zero was dropped. Alternative: add the zero by hand and search.
Check: find two cards with the same barcode. Alternative: close the second one for sale.
Check: check the letter case. Alternative: copy the card exactly.
Check: do not mix a QR code with a linear barcode. Alternative: see that the scanner type reads both.
Check: separate a weight barcode from a sales barcode. Alternative: check the scale label on its own.
Check: separate a box barcode from a piece barcode. Alternative: read which unit landed in the basket.
Check: if the wrong product lands in the basket, write the last scanned digits. Alternative: paste those digits into search by hand.
Check: if the product is not found, see that the card is open for sale. Alternative: search a stopped product separately.
Check: another branch’s card may not exist in this branch. Alternative: change the branch and scan again.
Check: if the light is weak, move closer to the barcode. Alternative: wipe the label or print a new one.
Check: do not force a crushed barcode. Alternative: type the digits from the card by hand.
Check: if the scanner reads continuously, release the trigger. Alternative: turn off continuous mode.
Check: if the code lands twice, see that the suffix has two Enters. Alternative: keep one Enter.
Check: if Market search is short, wait for the full digits. Alternative: press Enter yourself.
Check: in a restaurant menu the barcode is tied to the item. Alternative: open the menu item.
Check: a demo barcode is not the till barcode. Alternative: try the same digits in the real program.
Check: if the camera scanner fails, switch to a USB scanner. Alternative: check the browser permission.
Check: if there is no beep, turn the scanner sound on. Alternative: digits can still appear, so look at the field.
Check: if reading is slow, wipe the lens. Alternative: hold the barcode flat.
Check: if a new product has an empty barcode, write it before saving the card. Alternative: scan into the field.
Check: do not mix an old label with a new card. Alternative: print a new label.
Check: if none of this fits, write the scanned digits and the digits on the card. Alternative: type live agent and do not send a password.`,
`Проверка: включите подсветку сканера. Альтернатива: на сканере с кнопкой нажмите курок один раз.
Проверка: убедитесь, что курсор в строке поиска. Альтернатива: нажмите внутрь строки один раз.
Проверка: если сканер не вводит цифры, дело не в товаре. Альтернатива: введите одну цифру с клавиатуры.
Проверка: проверьте сканер в Блокноте. Альтернатива: если и там нет цифр, неисправны сканер или кабель.
Проверка: переставьте USB-сканер в другой порт. Альтернатива: попробуйте другой кабель.
Проверка: убедитесь, что база беспроводного сканера подключена. Альтернатива: поставьте сканер на базу и выполните сопряжение.
Проверка: проверьте, что суффикс отправляет Enter. Альтернатива: без Enter поиск сам не заканчивается.
Проверка: убедитесь, что раскладка не портит цифры. Альтернатива: переключитесь на английскую раскладку.
Проверка: сверьте считанные цифры с карточкой товара. Альтернатива: не продолжайте продажу, не открыв карточку.
Проверка: уберите пробел в штрихкоде. Альтернатива: запишите карточку сканером заново.
Проверка: проверьте, не пропал ли начальный ноль. Альтернатива: добавьте ноль вручную и найдите.
Проверка: найдите две карточки с одним штрихкодом. Альтернатива: закройте вторую для продажи.
Проверка: проверьте регистр букв. Альтернатива: скопируйте карточку как есть.
Проверка: не путайте QR и линейный штрихкод. Альтернатива: убедитесь, что тип сканера читает оба.
Проверка: отделите весовой штрихкод от продажного. Альтернатива: проверьте этикетку весов отдельно.
Проверка: отделите штрихкод коробки от штрихкода штуки. Альтернатива: прочитайте, какая единица попала в корзину.
Проверка: если в корзину падает не тот товар, запишите последние считанные цифры. Альтернатива: вставьте эти цифры в поиск вручную.
Проверка: если товар не найден, проверьте, что карточка открыта для продажи. Альтернатива: отдельно найдите остановленный товар.
Проверка: карточки другого филиала может не быть в этом филиале. Альтернатива: смените филиал и сканируйте снова.
Проверка: если свет слабый, приблизьте штрихкод. Альтернатива: протрите этикетку или напечатайте новую.
Проверка: не заставляйте читать смятый штрихкод. Альтернатива: введите цифры с карточки вручную.
Проверка: если сканер читает непрерывно, отпустите курок. Альтернатива: выключите непрерывный режим.
Проверка: если код попадает дважды, проверьте два Enter в суффиксе. Альтернатива: оставьте один Enter.
Проверка: если поиск Маркета короткий, дождитесь всех цифр. Альтернатива: нажмите Enter сами.
Проверка: в меню ресторана штрихкод привязан к блюду. Альтернатива: откройте элемент меню.
Проверка: штрихкод демо — не штрихкод кассы. Альтернатива: проверьте те же цифры в настоящей программе.
Проверка: если камера не сканирует, перейдите на USB-сканер. Альтернатива: проверьте разрешение браузера.
Проверка: если нет звука, включите звук сканера. Альтернатива: цифры всё равно могут появиться, смотрите строку.
Проверка: если чтение медленное, протрите линзу. Альтернатива: держите штрихкод ровно.
Проверка: если у нового товара штрихкод пустой, запишите его до сохранения карточки. Альтернатива: сканируйте в поле.
Проверка: не смешивайте старую этикетку с новой карточкой. Альтернатива: напечатайте новую этикетку.
Проверка: если ничего не подошло, напишите считанные цифры и цифры на карточке. Альтернатива: напишите live agent и не отправляйте пароль.`),
 area('market','/demo/?system=market',/market|magaza/,['Market POS','Market POS','Маркет POS'],['Market: 32 yoxlama və alternativ','Market: 32 checks and alternatives','Маркет: 32 проверки и альтернативы'],
`Yoxlama: açıq pəncərənin Market POS olduğunu görün. Alternativ: Restoran pəncərəsini bağlayın.
Yoxlama: proqram açılmırsa, onu bir dəfə bağlayıb yenidən açın. Alternativ: Windows-da ilişən prosesi bağlayın, bazanı silməyin.
Yoxlama: açılışda xəta varsa, mətni olduğu kimi yazın. Alternativ: proqramı silib quraşdırmayın.
Yoxlama: filialın seçildiyini görün. Alternativ: siyahıdan filialı yenidən seçin.
Yoxlama: kassirin və ya PIN mərhələsinin keçdiyini görün. Alternativ: PIN-i çata yazmayın, rolu yoxlayın.
Yoxlama: satış sətrinin aktiv olduğunu görün. Alternativ: yeni satış açın.
Yoxlama: barkod sətrinə kursor qoyun. Alternativ: məhsulu adla axtarın.
Yoxlama: məhsul tapılmırsa, kartın bu filialda olduğunu yoxlayın. Alternativ: başqa filialı müvəqqəti açın.
Yoxlama: məhsul satışa bağlıdırsa, onu açın. Alternativ: dayandırma səbəbini oxuyun.
Yoxlama: qiymət sıfırdırsa, kartın satış qiymətini yazın. Alternativ: köhnə qiymət siyahısını müqayisə edin.
Yoxlama: miqdarı səbətə düşəndən sonra dəyişin. Alternativ: sətri silib yenidən əlavə edin.
Yoxlama: çəki məhsulunda kq vahidini seçin. Alternativ: ədəd kimi satmayın.
Yoxlama: endirim icazəsi yoxdursa, roluna baxın. Alternativ: endirimsiz bir satış sınayın.
Yoxlama: stok yoxdur yazılırsa, bu printer xətası deyil. Alternativ: həmin filialın qalığına baxın.
Yoxlama: ödənişə keç düyməsi passivdirsə, səbətin boş olmadığını görün. Alternativ: bir məhsul əlavə edin.
Yoxlama: ödəniş bitmirsə, xəta mətnini oxuyun. Alternativ: eyni satışı ikinci dəfə təsdiqləməyin.
Yoxlama: tarixçədə satış varsa, yeni satış açmayın. Alternativ: həmin çeki təkrar çap edin.
Yoxlama: nağd və kart məbləğini ayrı yazın. Alternativ: yekunun səbətə bərabər olduğunu görün.
Yoxlama: qalıq pulu ekranda yoxlayın. Alternativ: kassiri məbləği ucadan təkrarlasın.
Yoxlama: müştəri borcu lazımdırsa, müştərini seçin. Alternativ: müştərisiz natamam ödəniş bitməz.
Yoxlama: kassa seçilməyibsə, kassanı seçin. Alternativ: başqa kassa ilə bir sınaq edin.
Yoxlama: növbə açıq deyilsə, növbəni açın. Alternativ: köhnə növbənin bağlandığını görün.
Yoxlama: internet kəsilsə, adi satışın davam etdiyini yoxlayın. Alternativ: portalın gecikməsini satışın dayanması sanmayın.
Yoxlama: portal ilə kassa fərqlidirsə, sinxron vaxtını oxuyun. Alternativ: bir dəfə yeniləyin.
Yoxlama: çek çıxmırsa, satışı yenidən etməyin. Alternativ: printer yoxlamasına keçin.
Yoxlama: tərəzi barkodu düşmürsə, rəqəmləri yazın. Alternativ: məhsulu adla əlavə edin.
Yoxlama: səbət donursa, proqramı bir dəfə yenidən açın. Alternativ: bazanı silməyin.
Yoxlama: istifadəçi satışı görmürsə, rolunu yoxlayın. Alternativ: rəhbər hesabla eyni ekranı açın.
Yoxlama: demo satışını real kassa sanmayın. Alternativ: /demo/?system=market ünvanını real proqramdan ayırın.
Yoxlama: versiya köhnədirsə, yeniləmədən əvvəl ehtiyat nüsxəyə baxın. Alternativ: xəta mətnini yazın.
Yoxlama: iki dəfə əlavə olunan sətri birinə endirin. Alternativ: miqdarı əl ilə düzəldin.
Yoxlama: heç biri uyğun gəlmirsə ekrandakı yazını, filialı və məhsul barkodunu yazın. Alternativ: live agent yazın, şifrə göndərməyin.`,
`Check: see that the open window is Market POS. Alternative: close the Restaurant window.
Check: if the program will not open, close it once and open it again. Alternative: end a stuck Windows process and do not delete the database.
Check: if startup shows an error, write the text as it is. Alternative: do not uninstall and reinstall.
Check: see that a branch is selected. Alternative: select the branch from the list again.
Check: see that the cashier or PIN step has passed. Alternative: do not type the PIN here, check the role.
Check: see that the sale line is active. Alternative: open a new sale.
Check: put the cursor in the barcode field. Alternative: search the product by name.
Check: if the product is not found, see that the card exists in this branch. Alternative: open another branch temporarily.
Check: if the product is closed for sale, open it. Alternative: read why it was stopped.
Check: if the price is zero, write the selling price on the card. Alternative: compare the old price list.
Check: change the quantity after it lands in the basket. Alternative: delete the line and add it again.
Check: for a weighed product, select the kilogram unit. Alternative: do not sell it as a piece.
Check: if there is no discount permission, look at the role. Alternative: try one sale without a discount.
Check: if it says no stock, that is not a printer error. Alternative: look at that branch’s quantity.
Check: if Proceed to payment is inactive, see that the basket is not empty. Alternative: add one product.
Check: if payment does not finish, read the error. Alternative: do not confirm the same sale a second time.
Check: if the sale is already in history, do not open a new sale. Alternative: reprint that receipt.
Check: enter cash and card amounts separately. Alternative: see that the total equals the basket.
Check: check the change on the screen. Alternative: have the cashier repeat the amount aloud.
Check: if you need customer debt, select the customer. Alternative: an incomplete payment without a customer does not finish.
Check: if no cash account is selected, select one. Alternative: try another cash account.
Check: if the shift is not open, open the shift. Alternative: see that the old shift was closed.
Check: if the internet drops, see that a normal sale still continues. Alternative: do not treat a late portal as a stopped sale.
Check: if the portal and the till differ, read the sync time. Alternative: refresh once.
Check: if the receipt does not print, do not repeat the sale. Alternative: go to the printer checks.
Check: if a scale barcode does not land, write the digits. Alternative: add the product by name.
Check: if the basket freezes, open the program once more. Alternative: do not delete the database.
Check: if the user cannot see sales, check the role. Alternative: open the same screen with a manager account.
Check: do not treat a demo sale as the real till. Alternative: keep /demo/?system=market separate from the real program.
Check: if the version is old, look at the backup before updating. Alternative: write the error text.
Check: reduce a line that was added twice to one line. Alternative: correct the quantity by hand.
Check: if none of this fits, write the text on the screen, the branch and the product barcode. Alternative: type live agent and do not send a password.`,
`Проверка: убедитесь, что открыто окно Маркет POS. Альтернатива: закройте окно Ресторана.
Проверка: если программа не открывается, закройте её и откройте снова. Альтернатива: завершите зависший процесс Windows и не удаляйте базу.
Проверка: если при запуске есть ошибка, перепишите текст как есть. Альтернатива: не удаляйте и не ставьте программу заново.
Проверка: убедитесь, что филиал выбран. Альтернатива: выберите филиал из списка снова.
Проверка: убедитесь, что шаг кассира или PIN пройден. Альтернатива: не пишите PIN сюда, проверьте роль.
Проверка: убедитесь, что строка продажи активна. Альтернатива: откройте новую продажу.
Проверка: поставьте курсор в поле штрихкода. Альтернатива: найдите товар по названию.
Проверка: если товар не найден, проверьте, что карточка есть в этом филиале. Альтернатива: временно откройте другой филиал.
Проверка: если товар закрыт для продажи, откройте его. Альтернатива: прочитайте причину остановки.
Проверка: если цена ноль, запишите цену продажи в карточке. Альтернатива: сравните старый прайс.
Проверка: измените количество после попадания в корзину. Альтернатива: удалите строку и добавьте снова.
Проверка: для весового товара выберите единицу кг. Альтернатива: не продавайте его как штуку.
Проверка: если нет права на скидку, смотрите роль. Альтернатива: сделайте одну продажу без скидки.
Проверка: если пишет «нет остатка», это не ошибка принтера. Альтернатива: посмотрите остаток этого филиала.
Проверка: если кнопка перехода к оплате неактивна, проверьте, что корзина не пуста. Альтернатива: добавьте один товар.
Проверка: если оплата не заканчивается, прочитайте ошибку. Альтернатива: не подтверждайте ту же продажу второй раз.
Проверка: если продажа уже в истории, не открывайте новую. Альтернатива: напечатайте этот чек повторно.
Проверка: введите наличные и карту отдельно. Альтернатива: проверьте, что итог равен корзине.
Проверка: проверьте сдачу на экране. Альтернатива: пусть кассир повторит сумму вслух.
Проверка: если нужен долг клиента, выберите клиента. Альтернатива: неполная оплата без клиента не завершается.
Проверка: если касса не выбрана, выберите кассу. Альтернатива: попробуйте другую кассу.
Проверка: если смена не открыта, откройте смену. Альтернатива: проверьте, что старая смена закрыта.
Проверка: если интернет пропал, проверьте, что обычная продажа продолжается. Альтернатива: не считайте задержку портала остановкой продажи.
Проверка: если портал и касса расходятся, прочитайте время синхронизации. Альтернатива: обновите один раз.
Проверка: если чек не печатается, не повторяйте продажу. Альтернатива: перейдите к проверкам принтера.
Проверка: если весовой штрихкод не попадает, запишите цифры. Альтернатива: добавьте товар по названию.
Проверка: если корзина зависла, откройте программу ещё раз. Альтернатива: базу не удаляйте.
Проверка: если пользователь не видит продажи, проверьте роль. Альтернатива: откройте тот же экран учётной записью руководителя.
Проверка: не считайте демо-продажу настоящей кассой. Альтернатива: держите /demo/?system=market отдельно от настоящей программы.
Проверка: если версия старая, перед обновлением посмотрите резервную копию. Альтернатива: запишите текст ошибки.
Проверка: строку, добавленную дважды, сведите к одной. Альтернатива: исправьте количество вручную.
Проверка: если ничего не подошло, напишите текст на экране, филиал и штрихкод товара. Альтернатива: напишите live agent и не отправляйте пароль.`),
];
export type WideReply = HelpTopic & { suggestions?: string[] };
export function wideReply(text: string, language: SupportLanguage): WideReply | undefined {
 if (/(alacam|almag istey|almaq istey|satin al|abune ol|lisenziya al)/.test(text) || (/(nece alim|nece ala bil|haradan al)/.test(text) && /(pos|proqram|paket|lisenziya)/.test(text))) return;
 if (/(kimle|kiminle|elaqe saxla|hansi pos|poslar var|poslarim|mende .{0,20}pos)/.test(text)) return;
 if (/(restoran|masa)/.test(text) && /sifaris/.test(text) && /(bilmir|vura bil|olmur|ede bilm)/.test(text)) return;
 if (/possistem.{0,24}(nedir|haqqinda)|umumi melumat|kimsiniz|(siz|sen) nesiniz/.test(text)) return;
 const clauses = text.split(/\s+ve\s+|\s+hem\s+|\s+ayrica\s+|,\s+/).map(s => s.trim()).filter(Boolean);
 const inChunk = (chunk: string) => AREAS.filter(a => a.test.test(chunk));
 const groups = (clauses.length ? clauses : [text]).map(inChunk);
 const unique = AREAS.filter(a => a.test.test(text));
 if (!unique.length) return;
 const render = (a: Area) => `${pick(a.title, language)}\n\n${a.items.map((item, i) => `${i + 1}. ${pick(item, language)}`).join('\n')}`;
 if (unique.length === 1) return { id: unique[0].id, matched: true, href: unique[0].href, title: pick(unique[0].title, language), body: render(unique[0]) };
 if (clauses.length >= 2 && groups.every(g => g.length === 1)) {
  const chosen = groups.map(g => g[0]);
  return { id: 'multi', matched: true, href: '', title: pick(['Bir neçə sorğu', 'Several requests', 'Несколько запросов'], language), body: `${pick(['Hər sorğunu ayrı yoxlayın.', 'Check each request separately.', 'Проверьте каждый запрос отдельно.'], language)}\n\n${chosen.map(render).join('\n\n')}` };
 }
 return { id: 'clarify', matched: true, href: '', title: pick(['Bunu mu demək istəyirdiniz?', 'Did you mean this?', 'Вы это имели в виду?'], language), body: pick(['Qarışıq görünür. Bunu mu demək istəyirdiniz? Birini seçin, həmin mövzunun yoxlamalarını açıram.', 'This looks mixed. Did you mean one of these? Choose one and I will open that checklist.', 'Похоже на смесь тем. Вы это имели в виду? Выберите одно, и я открою проверки этой темы.'], language), suggestions: unique.map(a => pick(a.ask, language)) };
}
