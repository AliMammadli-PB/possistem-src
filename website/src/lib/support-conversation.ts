import { faultReply, getSupportReply, normalizeHelpText, type HelpTopic, type SupportLanguage } from './support-assistant';
import { wideReply } from './support-wide';
import { lookupKnownIssue } from './support-troubleshooting';
export type ConversationMessage={author:'me'|'helper';body:string;reply?:ConversationReply;createdAt?:string};
export type ConversationReply=HelpTopic&{suggestion?:string;suggestions?:string[];contextTopic?:string;contextQuestion?:string};
const copy=(l:SupportLanguage,az:string,en:string,ru:string)=>l==='ru'?ru:l==='en'?en:az;
const social=new Set(['greeting','thanks','wellbeing','farewell','unknown','clarify','resolved','intake','about','identity','invite','bundle','multi','deliver','account']);
const topics:Record<string,string[]>={stock:['anbar','stok','qalıq','məhsul','mallar'],printer:['printer','çek','qəbz','çap'],scale:['tərəzi','etiket','çəki','plu'],transfer:['yerdəyişmə','göndərən','qəbul','transfer'],payment:['ödəniş','satış','kassa','borc'],access:['şifrə','parol','giriş','icazə','səlahiyyət'],reports:['hesabat','qazanc','xərc','maliyyə'],offline:['internet','sinxronizasiya','filial','bağlantı'],install:['quraşdırma','setup','yükləmə'],mobile:['android','apk','telefon'],backup:['ehtiyat','bərpa'],update:['yeniləmə','versiya'],support:['əməkdaş','dəstək','operator']};
const vocabulary=[...Object.values(topics).flat(),'problem','işləmir','açılmır','görünmür','alınmadı','salam','necəsən','sağol','təşəkkür','kömək'];
// Bounded Damerau-Levenshtein: handles a missing/extra/swapped key without fuzzy-matching numbers.
export function typoDistance(a:string,b:string):number {
 if(Math.abs(a.length-b.length)>2)return 3;
 const d=Array.from({length:a.length+1},(_,i)=>Array.from({length:b.length+1},(_,j)=>i?j?0:i:j));
 for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++){
  d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
  if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])d[i][j]=Math.min(d[i][j],d[i-2][j-2]+1);
 }return d[a.length][b.length];
}
function corrected(text:string){
 const fixes:{from:string;to:string}[]=[];
 const result=text.split(' ').map(word=>{
  if(word.length<4||/\d/.test(word)||vocabulary.some(v=>{const n=normalizeHelpText(v);return n===word||(n.length>=4&&word.startsWith(n));}))return word;
  const ranked=vocabulary.map(v=>({v,n:normalizeHelpText(v),d:typoDistance(word,normalizeHelpText(v))})).filter(x=>x.d<=(word.length>=7?2:1)).sort((a,b)=>a.d-b.d);
  if(!ranked.length||ranked[1]?.d===ranked[0].d)return word;
  const best=ranked[0];fixes.push({from:word,to:best.v});return best.n;
 }).join(' ');return {text:result,fixes};
}
function priorIssue(history:ConversationMessage[]){
 const candidates:{id:string;question:string;body:string;problem:boolean}[]=[];
 for(let i=history.length-1;i>=0;i--){const m=history[i];if(m.author==='helper'&&m.reply&&!social.has(m.reply.id)){
  const question=m.reply.contextQuestion||[...history.slice(0,i)].reverse().find(x=>x.author==='me')?.body||'';
  candidates.push({id:m.reply.id,question,body:m.body,problem:/problem|islemi|gorunmu|acilmi|xeta|olmur|alinmi|error|не работ|ошиб/i.test(normalizeHelpText(question))});
 }}
 return candidates.find(c=>c.problem)||candidates[0];
}
function conversationReply(input:string,language:SupportLanguage='az',history:ConversationMessage[]=[]):ConversationReply {
 const original=normalizeHelpText(input),fixed=corrected(original),text=fixed.text;
 const result=(id:string,title:string,body:string,extra:Partial<ConversationReply>={}):ConversationReply=>({id,title,body,matched:true,href:'',...extra});
 const last=history.at(-1)?.reply;
 if(last?.suggestion&&/^(he|beli|duzdur|yes|да)$/.test(text))return getConversationReply(last.suggestion,language,history.slice(0,-1));
 if(last?.suggestion&&/^(yox|xeyr|no|нет)$/.test(text))return result('clarify',copy(language,'Sualınızı yenidən yaza bilərsiniz','Please rephrase','Уточните вопрос'),copy(language,'Başa düşdüm, təxminim düzgün deyil. Hansı bölmədə nə baş verdiyini öz sözlərinizlə yenidən yazın.','My suggestion was not correct. Describe the section and what happened in your own words.','Моя догадка неверна. Опишите раздел и проблему своими словами.'));
 if(/hell (oldu|olundu)|duzeldi|indi isleyir|problem yoxdu|it works|fixed|решено|заработало/.test(text))return result('resolved',copy(language,'Sevindim!','Glad to hear it!','Рад, что получилось!'),copy(language,'Problemin həll olunmasına sevindim! Başqa sualınız varsa, yaza bilərsiniz.','Glad the issue is resolved! Let me know if you have another question.','Рад, что проблема решена! Если есть другой вопрос, напишите.'));
 if(/^(yaxsiyam|yaxsiyiq|ela|normalam|normal|fine|хорошо)( cox sag ol| sagol| tesekkur| thanks)?$/.test(text))return result('wellbeing',copy(language,'Çox gözəl!','Great!','Отлично!'),copy(language,'Çox gözəl! Sizə hansı mövzuda kömək edə bilərəm?','Great! What can I help you with?','Отлично! Чем могу помочь?'));

 const greeting=/^(sa|s a|salam|salam aleykum|salam eleykum|salamaleykum|salameleykum|salam alekum|salam aleikum|slm|selam|salamlar|aleykum salam|eleykum salam|hello|hi|hey|sabahin xeyir|axsamin xeyir|привет|здравствуйте)( necesen| necesiz| ne var ne yox)?$/;
 if(greeting.test(text))return result('greeting',copy(language,'Salam','Hello','Здравствуйте'),copy(language,'Salam, buyurun, sizə necə kömək edə bilərəm?','Hello, how can I help?','Здравствуйте, чем могу помочь?'));
 if(/^(sen |siz |bes siz |bes sen )?(necesen|necesiz|necesiniz|necese[nm]|netersen|ne var ne yox|how are you|как дела)( sen| siz)?$/.test(text)||(['necesen','necesiz'].some(w=>original.length>=6&&original.length<=9&&typoDistance(original,w)<=1)))return result('wellbeing',copy(language,'Çox sağ olun!','Thank you!','Спасибо!'),copy(language,'Çox sağ olun, yaxşıyam! Siz necəsiniz? POS proqramı və ya saytla bağlı sualınız varsa, buradayam.','Thank you, I’m well! How are you? I’m here for your POS or website questions.','Спасибо, всё хорошо! А как вы? Я здесь, чтобы помочь с POS или сайтом.'));
 if(/^(cox )?(sag ol(un)?|sagol(un)?|tesekkur(ler)?( edirem)?|minnetdaram|thanks|thank you|спасибо|благодарю)( cox| size| siz| qardas)?$/.test(text))return result('thanks',copy(language,'Buyurun!','You’re welcome!','Пожалуйста!'),copy(language,'Siz sağ olun! Başqa sualınız olsa, yazın. Əvvəlki problem hələ həll olunmayıbsa, hansı addımda qaldığınızı deyin, həmin mövzudan davam edək.','You’re welcome! Ask another question any time. If the earlier issue remains, tell me which step stopped you and we can continue from there.','Пожалуйста! Если прежняя проблема осталась, напишите, на каком шаге остановились, и продолжим с того места.'));
 if(/^(sag olun|sagol|helelik|gorus(erik|enedek)|bye|goodbye|до свидания|пока)$/.test(text))return result('farewell',copy(language,'Görüşənədək!','Goodbye!','До свидания!'),copy(language,'Görüşənədək! Yenə sualınız olsa, dəstək pəncərəsini aça bilərsiniz.','Goodbye! Open support whenever you need help.','До свидания! При необходимости снова откройте поддержку.'));
 const prior=priorIssue(history.slice(-100));
 const follow=/hell.*(olma|ed[eai] bilm|edem|alinma)|duzelme|yene.*(olmur|eyni|problem)|alinmadi|eyni xeta|davam et|basa dusmedim|problemi|bu problem|hansi addim|hardan|harada|nece edim|not solved|still|did not work|не помог|не реш|та же/.test(text);
 const explicit=Object.entries(topics).find(([,terms])=>terms.some(t=>text.split(' ').some(w=>w.startsWith(normalizeHelpText(t)))));
 if(prior&&follow&&(!explicit||explicit[0]===prior.id)){
  const detail=prior.question.replace(/\s+/g,' ').slice(0,400);
  const questions:Record<string,string>={stock:'Düzgün filial və anbar seçiləndə də qalıq görünmür, yoxsa məhsulun özü siyahıda yoxdur? Məhsulun adını/barkodunu, gözlədiyiniz miqdarı və ekrandakı miqdarı yazın. Qalığı yenidən artırmayın; əvvəlki qəbul qaiməsinin təsdiqlənib-təsdiqlənmədiyini yoxlayaq.',printer:'Printer siyahıda görünür? Test çapı işləyir, amma satış çeki çıxmır, yoxsa kağız ümumiyyətlə çıxmır? Printer modelini, qoşulma növünü və xəta mətnini yazın. Eyni satışı yenidən tamamlamayın.',scale:'Etiketdə səhv olan vahid qiymətdir, yekun məbləğdir, yoxsa barkodun oxunmasıdır? Yazdığınız qiyməti, çəkini və etiketdə çıxan rəqəmləri yazın; məhsul qiymətini yüz dəfə dəyişməyin.',payment:'Ödəniş alınmır, kassa qalığı dəyişmir, yoxsa borc düzgün yazılmır? Sənəd nömrəsini, yekunu və ödənilən məbləği yazın; eyni ödənişi təkrar yaratmayın.',transfer:'Qaimə qaralamadır, göndərilib, yoxsa qəbul təsdiqlənib? Hər iki filialı, göndərilən miqdarı və qaimə nömrəsini yazın. Təkrar yerdəyişmə yaratmayaq.',offline:'Hansı iki filial arasında məlumat çatmır? Son sinxronizasiya vaxtını və xəta mətnini yazın; bazanı silməyin və başqa filialın bazası ilə əvəz etməyin.',access:'Xəta parol/PIN yazılan anda çıxır, yoxsa girişdən sonra bölmə açılmır? Xəta mətnini və seçilmiş filialı yazın. Parolunuzu və PIN-i bu çata göndərməyin.'};
  const next=questions[prior.id]||'Hansı addımı etdiniz və nəticədə ekranda nə dəyişdi? Bölməni və xəta mətnini yazın. Əvvəlki əməliyyatı təkrar yaradıb məlumatları dəyişməyək.';
  return result(prior.id,copy(language,'Əvvəlki problemdən davam edək','Let’s continue the earlier issue','Продолжим прежнюю проблему'),copy(language,`Əvvəl yazdığınız məsələni nəzərə alıram: «${detail}».\n\nTəklif olunan addımlar kömək etməyibsə, eyni cavabı təkrarlamaq əvəzinə səbəbi daraldaq.\n\n${next}\n\nİstəsəniz, “Əməkdaşa yaz” seçimi ilə söhbəti dəstəyə ötürə bilərsiniz.`, `I’m following your earlier issue: “${detail}”.\n\nWhich suggested step did you try, and what happened? Send the exact error, selected branch and affected product/document. Do not repeat financial or stock operations. You can also contact an agent.`, `Продолжаю прежнюю проблему: «${detail}».\n\nКакой шаг вы выполнили и что произошло? Укажите точную ошибку, филиал и товар/документ. Не повторяйте операции с деньгами и остатками. Можно передать разговор специалисту.`),{href:'/destek/',contextTopic:prior.id,contextQuestion:prior.question});
 }
 const topicOf=(value:string)=>Object.entries(topics).find(([,terms])=>terms.some(t=>{const n=normalizeHelpText(t);return value.split(' ').some(w=>w===n||(n.length>=4&&w.startsWith(n)));}))?.[0];
 const vague=/problem|islemi|islemir|calismir|xeta|sehv|pozul/.test(text)&&!/gorunm|acilm|yuklen|donur|donub|gecik|alinm|olmur|olmadi|cap etm|cixm|oxunm|tapilm|yavas|artm|azalm|dusm|ferq|fark|tekrar|kesil|sifir|eksi|qaime|barkod|yanlis|duzgun deyil|stok yox/.test(text)&&text.split(' ').filter(Boolean).length<=10;
 const intakeAsk:Record<string,string>={
  stock:copy(language,'Anbardakı problemi qısaca yazın. Məsələn: məhsul görünmür, qalıq səhvdir, mal qəbulu düşmür, yoxsa bölmə açılmır?','Briefly describe the stock problem: a product is missing, the quantity is wrong, a receipt did not update stock, or the section will not open.','Кратко опишите проблему склада: товар не виден, остаток неверный, приход не увеличил остаток или раздел не открывается.'),
  printer:copy(language,'Printerdə nə baş verir? Çek çıxmır, test çap işləmir, yoxsa kağız kəsilir? Modeli də yaza bilərsiniz.','What happens with the printer? No receipt, the test print fails, or the paper is cut off? You can add the model.','Что с принтером? Чек не выходит, проба не печатается или бумага обрезается? Можно указать модель.'),
  scale:copy(language,'Tərəzidə problemi qısaca yazın: etiket səhvdir, qiymət fərqlidir, yoxsa barkod oxunmur?','Briefly describe the scale problem: the label is wrong, the price differs, or the barcode will not scan.','Кратко опишите проблему весов: этикетка неверная, цена отличается или штрихкод не считывается.'),
  transfer:copy(language,'Yerdəyişmədə problemi qısaca yazın: qaimə göndərilməyib, qəbul düşməyib, yoxsa miqdar fərqlidir?','Briefly describe the transfer: it was not sent, not accepted, or the quantity differs.','Кратко опишите перемещение: не отправилось, не принялось или количество отличается.'),
  payment:copy(language,'Ödənişdə problemi qısaca yazın: satış tamamlanmır, borc səhv düşür, yoxsa kassa qalığı dəyişmir?','Briefly describe the payment problem: the sale will not finish, the debt is wrong, or the cash balance does not change.','Кратко опишите оплату: продажа не завершается, долг неверный или остаток кассы не меняется.'),
  access:copy(language,'Girişdə problemi qısaca yazın: şifrə qəbul olunmur, PIN xətasıdır, yoxsa bölmə açılmır? Şifrə və PIN göndərməyin.','Briefly describe the sign-in problem: the password is rejected, the PIN fails, or a section will not open. Do not send the password or PIN.','Кратко опишите вход: пароль не принимается, ошибка PIN или раздел не открывается. Пароль и PIN не отправляйте.'),
  reports:copy(language,'Hesabatda nə uyğun gəlmir? Tarixi, filialı və hansı rəqəmin fərqli göründüyünü qısaca yazın.','What does not match in the report? Briefly write the date, branch and which figure looks wrong.','Что не сходится в отчёте? Кратко напишите дату, филиал и какая цифра отличается.'),
  offline:copy(language,'Bağlantı problemini qısaca yazın: internet ümumiyyətlə yoxdur, yoxsa satış var, amma portala düşmür?','Briefly describe the connection problem: there is no internet, or sales exist but do not reach the portal.','Кратко опишите связь: интернета нет или продажи есть, но в портал не попадают.'),
  install:copy(language,'Quraşdırmada problemi qısaca yazın: fayl açılmır, quraşdırma yarımçıq qalır, yoxsa proqram açılmır?','Briefly describe the installation problem: the file will not open, setup stops, or the application will not start.','Кратко опишите установку: файл не открывается, установка обрывается или программа не запускается.'),
  mobile:copy(language,'Telefonda problemi qısaca yazın: tətbiq quraşdırmır, açılmır, yoxsa hesaba girmir?','Briefly describe the phone problem: the app will not install, will not open, or will not sign in.','Кратко опишите проблему на телефоне: приложение не ставится, не открывается или не входит в аккаунт.'),
  backup:copy(language,'Ehtiyat nüsxədə problemi qısaca yazın: nüsxə alınmır, yoxsa bərpa xəta verir?','Briefly describe the backup problem: the copy fails, or restore reports an error.','Кратко опишите копию: она не создаётся или восстановление выдаёт ошибку.'),
  update:copy(language,'Yeniləmədə problemi qısaca yazın: versiya görünmür, yeniləmə dayanır, yoxsa proqram açılmır?','Briefly describe the update problem: the version is missing, the update stops, or the application will not open.','Кратко опишите обновление: версия не видна, обновление останавливается или программа не открывается.'),
  support:copy(language,'Dəstəklə bağlı nə baş verib? Qısaca yazın. İnsanla danışmaq üçün «live agent» yaza bilərsiniz.','What happened with support? Write it briefly. Type “live agent” to talk to a person.','Что произошло с поддержкой? Напишите кратко. Чтобы перейти к человеку, напишите «live agent».'),
 };
 const askIntake=(topic?:string)=>result('intake',copy(language,'Problemi qısaca yazın','Briefly describe the problem','Кратко опишите проблему'),topic&&intakeAsk[topic]?intakeAsk[topic]:copy(language,'Problemi qısaca yazın: hansı bölmədə nə baş verir? Anbar, printer, satış, ödəniş, giriş və ya başqa.','Briefly describe the problem: which section, and what happens? Stock, printer, sales, payment, sign-in, or something else.','Кратко опишите проблему: в каком разделе и что происходит? Склад, принтер, продажи, оплата, вход или другое.'),{contextTopic:topic||'',contextQuestion:input});
 if(/^(komek( lazimdi| lazimdir| edin| ele)?|sualim var|bir sualim var|sual var)$/.test(text))return result('invite',copy(language,'Buyurun','Go ahead','Слушаю'),copy(language,'Buyurun. Sualı və ya problemi qısaca yazın: anbar, printer, satış, ödəniş, giriş və ya Possistem haqqında.','Go ahead. Briefly write the question or problem: stock, printer, sales, payment, sign-in, or about Possistem.','Слушаю. Кратко напишите вопрос или проблему: склад, принтер, продажи, оплата, вход или о Possistem.'));
 const stop=new Set(['anbar','anbarda','anbarimda','anbarinda','var','varmi','eded','ededlerin','mene','bax','nece','qaliq','mali','malim','de','filial','market','pos','butun','hamisi','hamisina','qeder','pul','bugun','dunen','dunenki']);
 const productWord=text.split(' ').filter(w=>w.length>=3&&!stop.has(w)&&!/^\d+$/.test(w));
 const earn=/qazanc|qazanm|qazand|pul qazan|ne qeder pul|menfeet|dunenki qazanc|bugunku satis/.test(text);
 const adjust=text.match(/(.+?)\s+(?:qaligini|qaligi|ededini|miqdarini)\s+(\d+)\b/);
 const stockLook=/anbar|qaliq|eded|varmi/.test(text)&&productWord.length>0&&!/problem|islemi|xeta|yoxlama/.test(text);
 if((last?.id==='account'||last?.id==='deliver')&&/^pdf$/.test(text))return result('account','Hesabat','pdf',{suggestion:'pdf',contextQuestion:last.contextQuestion||'earn:today'});
 if(adjust&&adjust[2]){
  const name=(adjust[1]??'').split(' ').filter(w=>w.length>=3&&!stop.has(w)).pop();
  if(name)return result('account','Düzəliş','text',{suggestion:'text',contextQuestion:`adjust:${name}:${adjust[2]}`});
 }
 if(earn){
  const day=/dunen/.test(text)?'earn:yesterday':'earn:today';
  return result('account','Hesabat','text',{suggestion:'text',contextQuestion:day});
 }
 if(stockLook)return result('account','Anbar','text',{suggestion:'text',contextQuestion:`product:${productWord[0]}`});
 if(!fixed.fixes.length){const wide=wideReply(text,language);if(wide)return wide;}
 if(last?.id==='intake'){
  const during=faultReply(text,language);if(during)return during;
  const nextTopic=topicOf(text);
  if(vague)return askIntake(nextTopic||last.contextTopic||undefined);
  const looked=lookupKnownIssue(text,language,last.contextTopic||undefined);
  if(looked){
   const many=looked.topics.length>1;
   const lead=many
    ?copy(language,'Baxdım: burada bir neçə ayrı hal var. Hər birini öz sırası ilə yoxlayın.','I checked: there is more than one separate case. Work through each in order.','Проверил: здесь несколько отдельных случаев. Пройдите каждый по порядку.')
    :looked.known
    ?copy(language,'Baxdım: bu təsvir bilik bazasındakı tanış hala düşür.','I checked the known cases: this description matches one.','Сверил с известными случаями: описание совпадает.')
    :copy(language,'Baxdım: bu cümləyə uyğun ayrıca qəribəlik yoxdur. Bu bölmə üçün standart yoxlama belədir.','I checked: there is no separate known fault for this wording. Here is the standard check for this area.','Проверил: отдельной известной неисправности по этой фразе нет. Стандартная проверка этого раздела такая.');
   const body=looked.topics.map(t=>many?`${t.title}\n\n${t.body}`:t.body).join('\n\n');
   return result(looked.topic.id,looked.topic.title,`${lead}\n\n${body}`,{href:looked.topic.href,contextTopic:looked.topic.id,contextQuestion:input});
  }
  const other=getSupportReply(text,language);
  if(other.matched&&other.id!=='unknown')return other;
  return result('intake',copy(language,'Tanış problem yoxdur','No known case','Нет известного случая'),copy(language,'Baxdım: bu təsvirə uyğun tanış problem yoxdur. Ekranda nə yazıldığını, hansı filialda olduğunuzu və məhsul, çek və ya qaimə nömrəsini bir cümlə ilə yazın.','I checked: nothing in the known cases matches this description. In one sentence, write what is on the screen, which branch you are in, and the product, receipt or document number.','Проверил: известного случая под это описание нет. Одним предложением напишите, что на экране, какой филиал и номер товара, чека или документа.'),{contextTopic:last.contextTopic||'',contextQuestion:input});
 }
 const fault=faultReply(text,language);if(fault)return fault;
 if(vague)return askIntake(topicOf(text));
 const reply=getSupportReply(text,language,follow?prior?.id:undefined);
 if(fixed.fixes.length){
  const proposed=input.split(/\s+/).map(w=>{const f=fixed.fixes.find(f=>f.from===normalizeHelpText(w));return f?.to||w;}).join(' ');
  // Never silently change a user's technical word or their intent.
  if(reply.matched)return result('clarify',copy(language,'Bunu nəzərdə tuturdunuz?','Did you mean this?','Вы имели в виду это?'),copy(language,`Yazıda kiçik səhv ola bilər. “${proposed}” demək istəyirdiniz? Aşağıdakı düymə ilə təsdiqləyin və həmin sualı cavablandırım.`,`There may be a typo. Did you mean “${proposed}”? Confirm below so I can answer that question.`,`Возможно, в тексте опечатка. Вы имели в виду «${proposed}»? Подтвердите ниже.`),{suggestion:proposed,contextTopic:prior?.id});
 }
 return reply;
}

/** One consistent handoff phrase; local help never presents a fake live operator. */
export function getConversationReply(input:string,language:SupportLanguage='az',history:ConversationMessage[]=[]):ConversationReply {
 const reply=conversationReply(input,language,history);
 if(['greeting','thanks','wellbeing','farewell','clarify','resolved','intake','about','identity','invite','deliver','account'].includes(reply.id))return reply;
 const body=reply.body
  .replace(/İstəsəniz, “Əməkdaşa yaz” seçimi ilə söhbəti dəstəyə ötürə bilərsiniz\./g,'')
  .replace(/Əməkdaşa yaz/g,'live agent')
  .replace(/You can also contact an agent\./g,'')
  .replace(/Можно передать разговор специалисту\./g,'');
 const handoff=copy(language,'Köməyim toxunmadısa, sizi əməkdaşa yönləndirə bilərəm. Zəhmət olmasa, live agent yazın.','If this did not help, I can connect you with a support agent. Please type live agent.','Если помощь не помогла, я могу передать разговор специалисту. Напишите live agent.');
 return {...reply,body:body.trim().endsWith(handoff)?body.trim():body.trim()+'\n\n'+handoff};
}
