import {interpretTableAction} from './table-intent.mjs';
export const normalize=value=>String(value??'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').replace(/ə/g,'e').replace(/ş/g,'s').replace(/ç/g,'c').replace(/ğ/g,'g').replace(/ö/g,'o').replace(/ü/g,'u').replace(/[^a-z0-9]+/g,' ').trim();
const aliases=value=>normalize(value).replace(/coca/g,'koka').replace(/cola/g,'kola');
export const distance=(a,b)=>{if(Math.abs(a.length-b.length)>2)return 3;let row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+(a[i-1]===b[j-1]?0:1));row=next;}return row[b.length];};
export function rankProducts(products,query){
 const q=aliases(query);if(!q)return products.slice(0,8).map(product=>({product,fuzzy:false}));
 const queryVariants=[q,...q.split(' ').filter(word=>word.length>1),q.replace(/(?:nin|nun|ni|nu|dan|den|daki|deki|ini|unu|i|u)$/,'')].filter(Boolean);
 const dative=new Set(['ya','ye','na','ne','a','e'].filter(suffix=>q.endsWith(suffix)&&q.length-suffix.length>=3).map(suffix=>q.slice(0,-suffix.length)));
 return products.map(product=>{const name=aliases(product.name),tokens=name.split(' '),ids=[normalize(product.sku),normalize(product.barcode)].filter(Boolean);let score=dative.has(name)?0:99;
  for(const value of queryVariants){if(name===value||ids.includes(value))score=Math.min(score,0);else if(name.startsWith(value)||tokens.some(token=>token.startsWith(value)))score=Math.min(score,1);else if(name.includes(value))score=Math.min(score,2);else if(value.length>=4&&tokens.some(token=>distance(token,value)<= (value.length>5?2:1)))score=Math.min(score,4);}
  return{product,score,fuzzy:score===4,nameExact:dative.has(name)||[q,q.replace(/(?:nin|nun|ni|nu|dan|den|daki|deki|ini|unu|i|u)$/,'')].includes(name)};
 }).filter(row=>row.score<99).sort((a,b)=>a.score-b.score||a.product.name.localeCompare(b.product.name,'az')).slice(0,8);
}
export function interpret(input){
 const text=normalize(input);
 if(/^sual\s*:/i.test(String(input).trim()))return{intent:'data_question',question:String(input).trim().replace(/^sual\s*:\s*/i,'').slice(0,600),query:''};
 if(/^(legv( et)?|imtina|dayan|vaz kec|cancel|iptal)$/.test(text))return{intent:'cancel',query:''};
 if(/^(tesdiq( et|le|leyirem)?|beli|he|onayla|evet|confirm|yes)$/.test(text))return{intent:'confirm',query:''};
 if(/^(salam|sa|sea|seaa|slm|salamlar|selam|merhaba|hello|hi|hey|sabahiniz xeyir|axsaminiz xeyir)( necesen| necesiz| nasilsin| nasilsiniz| how are you)?$/.test(text)||/^(necesen|necesiz|yaxsiyam|ela|normalam|sag ol|sagol|cox sag ol|tesekkur\w*|thanks|thank you|helelik|bye|how are you|nasilsin|nasilsiniz)$/.test(text))return{intent:'social',query:''};
 if(/\b(?:sen kimsen|kimsen|sen nesen|seni kim (?:yarad|duzelt|qur)\w*|adin nedir|sen robot\w*|sen insan\w*)\b/.test(text))return{intent:'identity',query:''};
 if(/\b(?:restoran\w*|kafe\w*|obyekt\w*|biznes\w*|sirket\w*)\b.*\bad(?:i|in|imiz)?\b|\badimiz nedir\b/.test(text))return{intent:'profile',query:''};
 if(/ne bacar|ne ede bil|neler ede bil|neler edirsen|neler bacar|ne is gor|nece komek|what can you do|ne yapabil|^(?:senin |komekcinin )?imkanlar\w*(?: de| nedir| goster)?$/.test(text))return{intent:'capabilities',query:''};
 if(/\b(abone\w*|abune\w*|abonman\w*|subscription|lisenz\w*|lisenziy\w*)\b/.test(text))return{intent:'subscription',query:'',pay:/odenis|odemek|odey|\bode\b|kart.*bagla|pay/.test(text)};
 if(/^(?:men |indi )?(?:odenis (?:etmek|elemek|edim|edecem)|odemek|pul odemek|ode\w* etmek)(?: isteyirem| lazimdir| isterem)?$|^odenis et$/.test(text))return{intent:'subscription',query:'',pay:true};
 if(/\bprinter\w*\b/.test(text)&&/test|kontrol|yoxla|sin(?:a|aq)|cek cixar|cek cap|cap et/.test(text))return{intent:'printer_test',query:''};
 // "doner 2 ədəd xarab olub", "un 25 kq aldım 3 manatdan": a write-off or a goods receipt, planned and confirmed.
 const wasteWord=text.match(/\b(xarab\w*|zay\w*|itki\w*|tokul\w*|dagil\w*|yan(?:di|ib|mis)\w*|atil\w*|silinme\w*|spisat\w*|vaxti kec\w*|son istifade\w*)\b/);
 const bought=/\b(?:aldim|aldiq|almisiq|almisam|alindi|alinib|geldi|gelib|qebul et\w*|mal qebul\w*|alis yaz\w*)\b/.test(text);
 if((wasteWord||bought)&&!/\bmasa\w*/.test(text)){
  const priceM=text.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:manat|azn|m)(?:dan|lik|a)?\b/),rest=priceM?text.replace(priceM[0],' '):text;
  const qtyM=rest.match(/(\d+(?:[.,]\d{1,3})?)\s*(eded|dene|kq|kg|kilo\w*|qram|q|gr|l|litr|ml)?\b/);
  const stop=/^(?:xarab\w*|zay\w*|itki\w*|tokul\w*|dagil\w*|yan\w*|atil\w*|silinme\w*|spisat\w*|vaxti|kec\w*|son|istifade\w*|oldu|olub|olmus\w*|atdi\w*|atmis\w*|yere|yer|dus\w*|onu|bunu|cix\w*|verdim|verdik|sil\w*|et|ele|cunki|sebeb\w*|mene|anbar\w*|aldim|aldiq|almisiq|almisam|alindi|alinib|geldi|gelib|qebul|mal|alis|yaz\w*|manat\w*|azn|eded|dene|kq|kg|kilo\w*|qram|q|gr|l|litr|ml|ve|bir|de|da|indi|bu|gun|bugun|dunen|ucun|tedarukcu\w*|\d+(?:[.,]\d+)?)$/;
  // The item is named before the reason ("səbəb: …", "çünki …"), never inside it.
  const name=String(input).split(/\s(?:səbəb|sebeb|çünki|cunki)\b/i)[0].trim().split(/\s+/).filter(w=>{const n=normalize(w);return n&&!stop.test(n)&&!/^\d/.test(n);}).join(' ').replace(/[,.:;]+$/,'');
  const reasonText=String(input).match(/(?:səbəb|sebeb|çünki|cunki)\s*:?\s*(.+)$/i)?.[1]?.trim()||'';
  const reasons={xarab:'Xarab olub',zay:'Zay çıxıb',itki:'İtki',tokul:'Tökülüb',dagil:'Dağılıb',yan:'Yanıb',atil:'Atılıb',vaxti:'Vaxtı keçib',son:'Vaxtı keçib'};
  const qty=qtyM?.[1]?.replace(',','.')??null,unit=qtyM?.[2]?.replace(/^kilo\w*$/,'kq')||null;
  // Two items ("un və qiymə aldım") are for Groq to split; the rules alone read one.
  const multi=/\b(?:ve|hem de)\b|,/.test(text.replace(/sebeb.*$/,''));
  if(wasteWord)return{intent:'waste',multi,name,qty,unit,reason:reasonText||reasons[Object.keys(reasons).find(k=>wasteWord[1].startsWith(k))]||'',query:''};
  if(qtyM||priceM)return{intent:'receive',multi,name,qty,unit,price:priceM?.[1]?.replace(',','.')??null,query:''};
 }
 // "printer bölməsini aç", "çek loqosunu harda dəyişim", "işçilər səhifəsinə keç".
 if(/\b(?:bolme\w*|ekran\w*|sehife\w*|ayarlar\w*|parametr\w*)\b.*\b(?:ac|goster|apar|kec)\b|\bharda\b.*\b(?:deyis\w*|qoy\w*|ayarla\w*|tapim|tapa bilerem)\b|\b(?:loqo\w*|logo\w*)\b/.test(text))return{intent:'open_screen',query:''};
 // Reports the till already keeps. The X report records a snapshot and prints, so it is planned and confirmed like a change.
 const per=/kecen ay|evvelki ay|last month/.test(text)?'lastmonth':/kecen hefte|evvelki hefte|last week/.test(text)?'lastweek':/dunen|yesterday/.test(text)?'yesterday':/hefte|week/.test(text)?'week':/bu ay|ayliq|aylik|month/.test(text)?'month':'today';
 // "qaimələri PDF ver", "son 4 günün ödənişlərini pdf ver", "keçən ayın satışını pdf et", "bunu pdf ver".
 if(/\bpdf\w*/.test(text))return{intent:'pdf_report',kind:/qaime\w*/.test(text)?'purchases':/odenis\w*|odeme\w*/.test(text)?'payments':/satis\w*|satdi\w*|satmis\w*|qazan\w*|gelir\w*|dovriyye\w*|ciro\w*/.test(text)?'sales':'last',days:Number(text.match(/(\d{1,3})\s*gun/)?.[1]||0),period:/kecen ay|evvelki ay|bu ay|kecen hefte|bu hefte|dunen|bugun|bu gun/.test(text)?per:'',query:''};
 if(/(?:^|\s)x\s*(?:hesabat\w*|report\w*)\b|\bhesabat\w*\s+x\b/.test(text))return{intent:'x_report',query:''};
 if(/(?:^|\s)z\s*(?:hesabat\w*|report\w*)\b|\bhesabat\w*\s+z\b|\bgun(?:u|un)?\s+bagla\w*|\bgun sonu\b|\bkassa gunu\w*\s+bagla\w*/.test(text))return{intent:'z_report',query:''};
 if(/\b(?:en\s+)?cox\s+satil\w*|\bcox\s+satan\w*|\btop\s+(?:mal\w*|mehsul\w*|satis\w*|yemek\w*)|\bpopulyar\w*/.test(text))return{intent:'top_products',query:''};
 if(/\bkuryer\w*/.test(text)&&/hesabat\w*|statistik\w*|ne qeder|nece|pul\w*|isleyib|catdir\w*|qazan\w*/.test(text)||/\bcatdirilma\w*\s+(?:\w+\s+){0,2}(?:hesabat\w*|statistik\w*)/.test(text))return{intent:'courier_report',period:per,query:''};
 if(/\bqaime\w*/.test(text)&&!/\bkuryer\w*/.test(text)&&!/\b(?:yarat|sil|deyis|duzelt|legv)\b/.test(text))return{intent:'purchases',query:''};
 if(/\b(?:anbar\w*|stok\w*|mallar\w*)\s+(?:umumi\s+)?(?:deyer\w*|maya deyer\w*)|\bdeyer\w*\s+(?:anbar|stok)|\banbarda ne qeder pul|\bmallarin (?:umumi )?(?:deyeri|maya)/.test(text))return{intent:'stock_value',query:''};
 if(/\b(?:anbarda|anbarim|anbarimda)\b/.test(text)&&/^(?:anbarda|anbarim(?:da)?(?: nedir| nedi)?)$/.test(text))return{intent:'overview',query:'',low:false};
 if(/kalkul\w*|resept\w*/.test(text)&&/menyu.*(?:istemi|istemir|lazim deyil)|(?:yemek|mehsul).*yaratmaq istem/.test(text))return{intent:'recipe_context',query:''};
 const tableAction=interpretTableAction(input,text);if(tableAction)return tableAction;
 if(/\b(masa\w*|stol\w*|tables?)\b/.test(text)&&/yarat|elave et/.test(text))return{intent:'table_create',name:String(input).match(/(?:^|\s)(.+?)\s+ad[ıi]nda\s+masa/i)?.[1]?.replace(/^(?:m[eə]n[eə]\s+)?(?:yeni\s+)?/i,'').trim()||'',query:''};
 if(/\b(masa\w*|stol\w*|tables?)\b/.test(text)&&!/deyis|kocur|yarat|birlesdir|transfer/.test(text)){
  // "1. masa nə qədər işləyib" asks for money, not for how many tables there are.
  const money=/isle\w*|qazan\w*|satib|satis\w*|hesab\w*|mebleg\w*|pul\w*|gelir\w*|cem\w*|odenis\w*|borc\w*/.test(text);
  return{intent:'tables',query:'',money,table:text.match(/\b(\d{1,4})\s+(?:ci |cu |nomreli |nolu )?masa\w*|\bmasa (\d{1,4})\b/)?.slice(1).find(Boolean)||'',count:!money&&/ne qeder|nece|say|how many|kac/.test(text),all:/butun|hamisi|all|bos/.test(text)};
 }
 const recipeWord=/kalkul\w*|kalqul\w*|resept\w*|recipe|terkib/;
 // "donerin kalkulyasiyasını göstər": read a dish's recipe, never a write.
 if(recipeWord.test(text)&&/\b(?:goster\w*|nedir|nedi|bax|var|yaz|de|nece|hansi\w*|gor\w*)\b/.test(text)&&!/\b(?:yarat\w*|elave|qur|hazirla|yig|qoy|isteyirem|deyis\w*|sil\w*)\b/.test(text))
  return{intent:'recipe_show',name:(text.match(/^(.+?)\s+(?:kalkul\w*|kalqul\w*|resept\w*|terkib\w*)\b/)?.[1]||'').replace(/^(?:(?:salam|slm|sa|merhaba|mene|bize|indi|bir de|birde|bide|zehmet olmasa|menim)\s+)+/,'').replace(/^(?:salam|slm|sa|merhaba)$/,'').replace(/\s+(?:yemeyinin|yemeyin|yemeginin)$/,'').trim(),query:''};
 // "lahmacunun içinə un qoy, kalkulyasiya yarat": the dish, its named ingredients, and a cost wish ("unun kilosu 3 manat").
 const into=text.replace(/^(?:(?:indi|bir de|birde|sonra|mene|bize|zehmet olmasa)\s+)+/,'').match(/^(.+?)\s+(?:icine|icerisine|terkibine)\s+(.+?)\s+(?:qoy\w*|elave et\w*|at|vur|daxil et)\b/);
 const cost=text.match(/(?:^|\s)([a-z]+)\s+(?:kilosu\w*|kq\w*|kg|litri\w*|litresi\w*|ededi\w*|tanesi\w*|maya\w*|alis qiymeti\w*)\s+(?:da\s+|de\s+)?(\d+(?:[.,]\d{1,2})?)\s*(?:manat|azn|m)\b/);
 if(into&&(recipeWord.test(text)||/\b(?:qoy|elave et)\b/.test(text)))return{intent:'recipe_create',name:into[1],ingredients:into[2].split(/\s+(?:ve|hem de)\s+|\s*,\s*/).map(w=>w.trim()).filter(Boolean),cost:cost?{name:cost[1],value:cost[2].replace(',','.')}:null,query:''};
 if(recipeWord.test(text)&&/yarat|yig|hazirla|elave|qur|isteyirem/.test(text)){
  // An explicit name wins over location words before the recipe request.
  const explicit=text.match(/\b(?:adi|adini|ismi)\s+(.+?)(?:\s+olsun(?:\s+(?:mene|zehmet olmasa))?|$)/)?.[1];
  const suffix=text.match(/^(.+?)\s+adinda\b/)?.[1]?.replace(/^.*?(?:kalkul\w*|kalqul\w*|resept\w*|recipe)\s+(?:(?:yarat\w*|hazirla|yig|elave et)\s+)?/,'');
  const prefix=text.match(/^(.+?)\s+(?:kalkul\w*|kalqul\w*|resept\w*|recipe)\b/)?.[1];
  const name=(explicit||suffix||(prefix||'').replace(/^(?:(?:anbarda|anbarimda|anbara|menyuda|menyuma|mene|menim ucun)(?:\s+|$))+/,'').replace(/\s+ucun(?:\s+yeni)?$/,'')).trim();
  return{intent:'recipe_create',name:!explicit&&!suffix&&/^(?:(?:yeni|bir|mene|menim ucun|anbarda|anbarimda|menyuda)\s*)+$/.test(name)?'':name.replace(/^(?:(?:indi|bir de|birde|sonra|zehmet olmasa)\s+)+/,''),cost:cost?{name:cost[1],value:cost[2].replace(',','.')}:null,query:''};
 }
 if(cost)return{intent:'cost',name:cost[1],value:cost[2].replace(',','.'),query:''};
 if(/(?:yeni (?:mehsul|mal|xammal|yemek)|(?:mehsul|mal|xammal|yemek) yarat)/.test(text)&&/yarat|elave|isteyirem/.test(text))return{intent:'product_create',query:''};
 // "anbara cola əlavə et": stock in for a known item, a new card for an unknown one. Numbers go to the edit rule below.
 if(/\b(?:anbar\w*|stok\w*)\b/.test(text)&&/\b(?:elave et\w*|elave ele|daxil et|qoy)\b/.test(text)&&!/\d/.test(text)){const skip=/^(?:anbar\w*|stok\w*|elave|et|ele|etmek|daxil|qoy|isteyirem|mene|zehmet|olmasa|yeni|mal|mali|mehsul\w*|bir|bu|da|de)$/;return{intent:'stock_add',name:String(input).trim().split(/\s+/).filter(w=>normalize(w)&&!skip.test(normalize(w))).join(' '),query:''};}
 // "acılı dönəri artır" with no number: the item to add to; how many is asked next.
 if(/\b(?:artir|arttir|coxalt|artirin)\b/.test(text)&&!/\d/.test(text)&&!/\b(?:qiymet\w*|masa\w*)\b/.test(text)){const skip=/^(?:artir|arttir|coxalt|artirin|indi\w*|onu|bunu|var|anbar\w*|stok\w*|qaliq\w*|qalig\w*|mene|bir|de|da|ve|zehmet|olmasa)$/;const name=String(input).trim().split(/\s+/).filter(w=>normalize(w)&&!skip.test(normalize(w))).join(' ');if(name)return{intent:'stock_add',name,query:''};}
 if(/\b(?:menfi\w*|negativ\w*|minusda\w*)\b/.test(text)&&!/\b(?:sil|deyis|duzelt)\b/.test(text)&&!(/\d/.test(text)&&/\b(?:et|ele|olsun|qoy|artir|azalt)\b/.test(text)))return{intent:'overview',negative:true,low:false,query:''};
 if(/(?:indi(?:ce)?|az once|bayaq|evvel|son) (?:ne )?(?:dedim|yazdim|sorusdum|sorus(?:dum|mus)dum)|ne (?:dedim|yazdim|sorusdum)/.test(text))return{intent:'recall',query:''};
 const lowStock=/az (?:olan|qalan)|minimum|bitmek|tukenen|qurtaran|biten|low stock/.test(text);
 const inventoryDomain=/\b(?:anbar\w*|stok\w*|inventory|mallar\w*|mehsullar\w*|xammallar\w*)\b/.test(text);
 if(inventoryDomain&&/problem|xeta|sehv/.test(text)&&/kontrol|yoxla|bax/.test(text))return{intent:'overview',low:true,diagnostic:true,query:''};
 if(inventoryDomain&&(/\b(?:siyahi\w*|liste\w*|list)\b/.test(text)||/\b(?:mallar\w*|mehsullar\w*|xammallar\w*)\b/.test(text)&&/\b(?:goster|yaz|sadala|ver)\b/.test(text))&&!/\b(?:sil|silin|silinsin|delete|remove|deyis|yarat)\b/.test(text)&&!/problem|islemir|gorunmur|xeta/.test(text))return{intent:'overview',low:lowStock,query:''};
 if(/problem|islemir|acilmir|gorunmur|xeta|printer|cap et|internet|sifre|giris|demo|paket|lisenziya/.test(text))return{intent:'help',query:''};
 if(/\b(plan|plani)\b/.test(text))return{intent:'plan',query:'',stock:/anbar|alis|stok|mehsul/.test(text)};
 // Parse the requested number before generic search; preserve decimals and a minus sign.
 const numeric=normalize(String(input).replace(/(\d)[,.](?=\d)/g,'$1xdecimalx').replace(/-(?=\d)/g,'xminusx')).replace(/xdecimalx/g,'.').replace(/xminusx/g,'-').replace(/\s+(?:zehmet olmasa|please|lutfen)$/,'').replace(/\s+(?:ki\s+)?(?:menfi\w*|minus\w*)\s+olmasin$/,'');
 const mutation=/^(.*?)\s*(-?\d+(?:\.\d{1,3})?)\s*(eded|dene|kq|kg|qram|g|l|ml)?\s+(artir|arttir|elave et|azalt|cix|cixar|et|ele|olsun|qoy)$/.exec(numeric);
 if(mutation&&!/qiymet|price|ad(?:ini|in)|rename|name/.test(mutation[1])){
  const query=mutation[1].replace(/\s+-?\d+(?:\.\d+)?\s*(?:dir|di)\s+(?:onu|bunu)\s*$/,'').split(' ').filter(w=>!/^(salam|anbar\w*|bunun|onun|bunu|onu|bu|men|mene|mal(?:i|in)?|mehsul(?:u|un)?|qal\w*|stok\w*|miqdar\w*|sayini|ededini)$/.test(w)).join(' ');
  const operation=/artir|arttir|elave/.test(mutation[4])?'increase':/azalt|cix/.test(mutation[4])?'decrease':'set';
  return{intent:'edit',query,field:'quantity',quantityUnit:mutation[3]||null,quantity:{operation,value:mutation[2]}};
 }
 const edit=/deyis|deis|duzelt|redakt|change|rename|qiymet.*(?:\bet|qoy|\bele)\b|adini.*(?:\bet|qoy|\bele)\b|(?:qalig|qaliq|miqdar|stok).*\d.*(?:et|olsun)/.test(text);
 const period=/kecen ay|evvelki ay|last month/.test(text)?'lastmonth':/kecen hefte|evvelki hefte|last week/.test(text)?'lastweek':/dunen|yesterday/.test(text)?'yesterday':/hefte|week/.test(text)?'week':/bu ay|month/.test(text)?'month':'today';
 if(!edit&&/kassa.*(?:balans|pul|qaliq|bax)|pul\w*.*kassa|kassalarim|cash balance/.test(text))return{intent:'cash',query:''};
 // "bugün nə qədər satmışıq / qazandıq" ask for sales as much as "bugünkü satış" does.
 const sold='(?:satis\\w*|satdi\\w*|satmis\\w*|satilib|satilan\\w*|qazandi\\w*|qazanmis\\w*|gelir\\w*|ciro\\w*)';
 // A breakdown (by waiter, table, dish, hour, customer…) is a data question, not the plain total.
 const breakdown=/\b(?:ofisiant\w*|isci\w*|kassir\w*|yemek\w*|mehsul\w*|saat\w*|kateqoriya\w*|musteri\w*|kuryer\w*|en az|gunlere gore|aylara gore)\b/.test(text);
 if(!edit&&!breakdown&&(new RegExp(sold+'.*(?:bu gun|bugun|dunen|hefte|bu ay|ne qeder)').test(text)||new RegExp('(?:bu gun|bugun|dunen|hefte|bu ay|kecen ay|ne qeder|nece).*'+sold).test(text)||/sales.*(?:today|yesterday|week|month)/.test(text)))return{intent:'sales',period,query:''};
 if(!edit&&(/(?:ne var|neler var|hansi mallar|hansi mehsullar)/.test(text)&&/anbar\w*|stok\w*|mallar\w*|mehsullar\w*/.test(text)||/az (?:olan|qalan)|minimum\w* (?:asagi|az)|bitmek uzre|tukenen|qurtaran/.test(text)))return{intent:'overview',low:/az (?:olan|qalan)|minimum|bitmek|tukenen|qurtaran/.test(text),query:''};
 if(!edit&&/(?:anbar(?:im|ima|imda|a|i|da)?|stok)(?:i|in)? (?:ne var|nece mehsul|bax|goster|yoxla|siyahi)|(?:mehsullarim|mallarim)(?:i|in)?(?: siyahi\w*)?$|^(?:salam )?(?:anbar|anbarim|inventory)$|az qalan|biten mehsul|low stock/.test(text))return{intent:'overview',low:/az qalan|biten|low stock/.test(text),query:''};
 const lookup=/qal(?:ib|iq|ig|an)|stok|ne qeder|necedi|qiymet|nece dene|nece eded/.test(text);
 const query=text.split(' ').filter(word=>! /^(bunun|onun|bunu|onu|bu|bes|salam|anbar(?:da|imda|in)?|mehsul(?:u|un|lar)?|mal(?:i|in)?|ne|nece|qeder.*|den[eə]|eded|stok\w*|qal.*|miqdar\w*|qiymet.*|satis|alis|adini?|deyis.*|deis.*|duzelt.*|redakt.*|et(?:mek)?|qoy|olsun|isteyirem|men|mene|bir|zehmet|olmasa|bilmek|haqqinda|melumat|ver|bax|goster|change|rename|price|name|stock|set|to|manat|azn|ele|\d+)$/.test(word)).join(' ');
 return{intent:edit?'edit':lookup?'lookup':'unknown',query,field:/qiymet|price/.test(text)?'price':/ad(?:ini|in)|rename|name/.test(text)?'name':/qaliq|qalig|stok|miqdar/.test(text)&&edit?'quantity':null};
}
export function parseDecimal(value,places){
 const input=String(value).trim().replace(',','.');if(!new RegExp('^\\d+(?:\\.\\d{1,'+places+'})?$').test(input))return null;
 const [whole,fraction='']=input.split('.'),result=Number(whole)*10**places+Number(fraction.padEnd(places,'0'));
 return Number.isSafeInteger(result)&&result<=1000000000?result:null;
}
export function parseQuantity(value){const raw=String(value).trim(),sign=raw.startsWith('-')?-1:1,amount=parseDecimal(sign<0?raw.slice(1):raw,3);return amount===null?null:sign*amount;}
export function quantityInStockUnit(value,inputUnit,stockUnit){
 const amount=parseQuantity(value);if(amount===null||!inputUnit)return amount;
 const unit=s=>normalize(s).replace(/^kq$/,'kg').replace(/^qram$/,'g').replace(/^q$/,'g').replace(/^dene$/,'eded');
 const units={kg:['mass',1000],g:['mass',1],l:['volume',1000],ml:['volume',1],eded:['count',1]};
 const from=unit(inputUnit),to=unit(stockUnit);if(from===to)return amount;
 if(!units[from]||!units[to]||units[from][0]!==units[to][0])return null;
 const result=amount*units[from][1]/units[to][1];return Number.isSafeInteger(result)?result:null;
}
export function compactHelp(reply){
 const body=typeof reply?.body==='string'?reply.body.trim():'';
 if(!body||body==='text'||/32 yoxlama|1\. Yoxlama|Canlı hesab məlumatlarını görə|əməliyyatları dəyişə bilmirəm/.test(body))return 'Başa düşmək üçün bir az dəqiqləşdirək: nə etmək istəyirsiniz, yaxud hansı bölmədə problem yaranıb?';
 if(body.length>850)return body.split('\n\n').find(part=>part.length>30&&part.length<=600)||'Hansı addımda qaldığınızı deyin, birlikdə davam edək.';
 return body;
}

// Words the till understands; a misspelt one ("anbrda", "satislr") is offered back as a question, never acted on silently.
const VOCABULARY=['qalıq','anbar','anbarda','anbarım','anbarımda','anbara','anbarımı','stok','stokda','stokumda','qalıq','qalığı','satış','satışlar','satışı','bugünkü','bugün','dünən','həftə','kassa','kassada','masa','masalar','masaları','masaların','masanı','masalarımı','masalarımın','masalardan','sil','göstər','əlavə','artır','azalt','kalkulyasiya','kalkulyasiyası','resept','printer','printeri','abunəlik','abunəliyim','mənfi','mənfidə','yarat','məhsul','məhsullar','məhsulları','işləyib','qədər','nələr','açıq','boş','dəyiş','qiymət','qiyməti','çek','yoxla','hamısını','bitənlər','bitən','qazanc','nağd','sifariş','menyu','menyuya','xammal'];
const KNOWN=new Map(VOCABULARY.map(w=>[normalize(w),w]));
export function suggestCorrection(raw){
 let changed=false;
 const words=String(raw).trim().split(/\s+/).map(word=>{let n=normalize(word);
  // "xalig", "xaliq": x typed for q.
  if(/^x/.test(n)&&KNOWN.has('q'+n.slice(1).replace(/g$/,'q'))){changed=true;return KNOWN.get('q'+n.slice(1).replace(/g$/,'q'));}if(!n||KNOWN.has(n)||n.length<4||/\d/.test(n))return word;
  const limit=n.length>=7?2:1,hits=[...KNOWN.keys()].map(k=>[k,distance(n,k)]).filter(([,d])=>d<=limit).sort((a,b)=>a[1]-b[1]);
  if(!hits.length||hits.length>1&&hits[1][1]===hits[0][1]&&KNOWN.get(hits[1][0])!==KNOWN.get(hits[0][0]))return word;changed=true;return KNOWN.get(hits[0][0]);});
 return changed?words.join(' '):'';
}
// "anbarda nə var, bugünkü satış və açıq masalar" → three requests. Each piece must read as a request on its own.
const ASKS=/\b(?:ne|nece|neler|nedir|goster\w*|yaz|sil\w*|elave|artir|azalt|deyis\w*|yarat|bax|yoxla|de|ver|var|qeder|hansi\w*|isleyib|satis\w*|test|cixar|ode\w*|balans\w*|qaliq\w*|kalkul\w*)\b/;
export function splitRequests(raw){
 const hello=String(raw).match(/^\s*(salam|slm|merhaba|hello)\b[\s,!.]*/i),rest=hello?String(raw).slice(hello[0].length):String(raw);
 const parts=[...(hello?[hello[1]]:[]),...rest.split(/\s*(?:[;\n?!]|,(?!\d)|(?<!\d)\.(?=\s|$)|\s(?:və|ve|həm də|hem de|həmçinin|hemcinin|sonra da|sonra|bir də|bir de|birde|birdə|bide|bidə|bi de|bi də|ayrıca|ayrica|and|also)\s)\s*/i)].map(p=>p.trim()).filter(p=>normalize(p));
 return parts.length>1&&parts.length<=6&&parts.every(p=>ASKS.test(normalize(p))||/^(?:salam|slm|sa|merhaba|hello)$/.test(normalize(p)))?parts:[];
}

// "lahmacunun", "donerin", "unun": the bare name first, then without the genitive ending.
export const nameVariants=value=>{const n=normalize(value);return[...new Set([n,n.replace(/(?:nin|nun)$/,''),n.replace(/(?:in|un)$/,'')].filter(v=>v.length>=2))];};
export function findByName(products,value){for(const v of nameVariants(value)){const exact=rankProducts(products,v).filter(m=>m.nameExact&&!m.fuzzy);if(exact.length===1)return exact[0].product;}return null;}
