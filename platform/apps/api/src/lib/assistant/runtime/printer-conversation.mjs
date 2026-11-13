import {normalize} from './stock-assistant.mjs';
// Printing is a reviewed action; queued work is never described as paper confirmation.
export function createPrinterConversation({tools,makeKey}){
 let flow=null,last=null;
 const choice=(label,value)=>({label,value});
 const reply=(body,choices=[])=>last={body,choices:[...choices,choice('Ləğv et','cancel')]};
 // A Windows device path means nothing at the till: say what kind of printer it is.
 const nameOf=target=>{const t=String(target||''),usb=t.match(/vid_([0-9a-f]{4}).*?pid_([0-9a-f]{4})/i),ip=t.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);return /^usb/i.test(t)?'USB çek printeri'+(usb?` (USB ${usb[1].toUpperCase()}:${usb[2].toUpperCase()})`:''):ip?`Şəbəkə printeri (${ip[1]})`:t;};
 const why=(error,target)=>{const e=String(error||'');
  if(/usb|kod 2|code 2|acila bilmedi|açıla bilmədi|not found|tapılmadı/i.test(e))return`Səbəb: kompüter USB printeri hazırda görmür (USB bağlantısı açılmadı).
Yoxlayın:
1. USB kabeli həm printerə, həm kompüterə tam taxılıb?
2. Printerin enerjisi açıqdır, işığı yanır?
3. Kağız rulonu var və qapaq bağlıdır?
4. Kabeli başqa USB girişinə taxmısınızsa, Parametrlər → Printer bölməsində printeri yenidən seçin.`;
  if(/timeout|refused|unreachable|network|şəbəkə|9100|connect/i.test(e)||/^Şəbəkə/.test(nameOf(target)))return`Səbəb: printer şəbəkədə cavab vermir.
Yoxlayın:
1. Printer açıqdır və kabeli routerə/switchə taxılıb?
2. Kompüter ilə printer eyni şəbəkədədir?
3. Printerin IP ünvanı dəyişməyib? Parametrlər → Printer bölməsində yenidən axtarın.`;
  if(/paper|kağız|cover|qapaq/i.test(e))return`Səbəb: printerdə kağız bitib və ya qapaq açıqdır (printerin cavabı: “${e}”). Yeni rulonu taxın, qapağı bağlayın; növbədəki çek özü çıxacaq.`;
  return e?`Printerin cavabı: ${e}`:'';};
 const preview=()=>{flow.stage='confirm';return reply(`Printer: ${nameOf(flow.target)}\nBu printerə 1 sınaq çeki göndərəcəyəm: bu, nümunə çekdir: restoranın adı, tarix, iki nümunə məhsul, yekun məbləğ və “R-PREVIEW” kodu. Azərbaycan hərflərinin və ₼ işarəsinin düz çıxdığını da buradan görəcəksiniz. Satış, ödəniş və printer ayarları dəyişməyəcək, kassaya heç nə yazılmayacaq.\nTəsdiq edirsiniz?`,[choice('Təsdiq et','confirm')]);};
 const settingsDoor=choice('↗ Printer ayarları','nav:/settings?section=printer');
 const choose=data=>{flow.stage='pick';flow.targets=data.printers;
  // Nothing installed: offer to look on the network ourselves rather than ending the conversation.
  if(!data.printers.length){flow.stage='none';return reply(tools.printerPermissions?.().discover?'Kassa heç bir printer görmür. USB printer Windows-da quraşdırılmalıdır (sürücüsü ilə), sonra burada görünür.\nŞəbəkəyə (kabel və ya Wi-Fi) qoşulmuş Xprinter-i özüm axtarım?':'Kassa heç bir printer görmür. USB printer Windows-da quraşdırılmalıdır (sürücüsü ilə); şəbəkə printerini Parametrlər → Printer bölməsində axtarıb seçin.',[...(tools.printerPermissions?.().discover?[choice('Şəbəkədə axtar','printer:discover')]:[]),settingsDoor]);}
  return reply('Hansı printeri yoxlayaq?',data.printers.map(p=>choice(nameOf(p.name),'printer:target:'+encodeURIComponent(p.target))));};
 async function discover(valid){
  const found=await tools.printerDiscover();if(!valid())throw Error('Hesab dəyişib.');
  if(!found.printers.length){flow.stage='none';return reply('Şəbəkədə printer tapılmadı.\nYoxlayın: printer açıqdır, kabeli routerə taxılıb və ya eyni Wi-Fi-dadır; kompüterin firewall-u axtarışa icazə verir. USB printerdirsə, Windows-da quraşdırın.\nYenidən axtarım?',[choice('Yenidən axtar','printer:discover'),settingsDoor]);}
  flow.found=true;flow.targets=found.printers;
  if(found.printers.length===1){flow.target=found.printers[0].target;const r=preview();return{...r,body:`Şəbəkədə 1 printer tapdım.\n`+r.body};}
  flow.stage='pick';return reply(`Şəbəkədə ${found.printers.length} printer tapdım. Hansını yoxlayaq?`,found.printers.map(p=>choice(nameOf(p.name),'printer:target:'+encodeURIComponent(p.target))));
 }
 async function start(valid){
  const caps=tools.printerPermissions?.();
  if(!caps?.enabled)return{body:'Siz printerdən sınaq çeki istəyirsiniz. Mağazanın model siyahısı bu əmri yerinə yetirmir. Bu imkan üçün NEWEST-i tam bağlayıb yenidən açın; Parametrlər → Printer → Sınaq çeki bölməsindən də istifadə edə bilərsiniz.',choices:[]};
  if(!caps.print)throw Error('Printer sınağı üçün çap icazəniz yoxdur.');
  const data=await tools.printerList();if(!valid())throw Error('Hesab dəyişib.');
  flow={stage:'pick',key:makeKey(),targets:data.printers};
  const current=data.printers.find(p=>p.target===data.current);
  if(current||data.printers.length===1){flow.target=(current||data.printers[0]).target;return preview();}
  return choose(data);
 }
 async function send(raw,valid){
  if(!flow)return{body:'Yeni printer sınağı istəyin.',choices:[]};
  if(raw==='printer:discover'||flow.stage==='none'&&/^(?:ozun tap|ozun axtar|tap|axtar\w*|he|hə|beli|bəli|ok|olar|yenidən axtar|yeniden axtar)$/.test(normalize(raw)))return discover(valid);
  // A found network printer becomes the receipt printer only after its own confirmation.
  if(flow.stage==='use'&&(raw==='printer:use'||/^(confirm|tesdiq( et|le|leyirem)?|beli|he|yes)$/.test(normalize(raw)))){const target=flow.target;await tools.printerUse(target,flow.key);if(!valid())throw Error('Hesab dəyişib.');flow=null;return{body:`${nameOf(target)} indi çek printeridir. X, Z və müştəri çekləri bu printerə gedəcək. Dəyişmək üçün Parametrlər → Printer bölməsinə keçin.`,choices:[]};}
  if(raw.startsWith('printer:target:')){
   if(!last?.choices.some(c=>c.value===raw))return last;
   const row=flow.targets.find(p=>'printer:target:'+encodeURIComponent(p.target)===raw);if(!row)return last;
   flow.target=row.target;return preview();
  }
  if(flow.stage!=='confirm'||!/^(confirm|tesdiq( et|le|leyirem)?|beli|he|yes)$/.test(normalize(raw)))return last;
  const current=await tools.printerList();if(!valid())throw Error('Hesab dəyişib.');
  if(!flow.found&&!current.printers.some(p=>p.target===flow.target)){flow.key=makeKey();delete flow.target;return choose(current);}
  const target=flow.target,found=flow.found,job=await tools.printerTest({target},flow.key,valid);flow=null;job.printer=job.printer||target;
  const name=nameOf(job.printer||flow?.target),reason=why(job.lastError,job.printer);
  const body=['failed','cancelled','error'].includes(job.status)?`Sınaq çeki ${name} printerinə göndərilə bilmədi.\n${reason}\nDüzəltdikdən sonra “printeri test et” yazın, yenidən yoxlayaq.`
   :job.status==='completed'?`Sınaq çeki ${name} printerinə göndərildi və printer qəbul etdi. Kağızın çıxmasını yoxlayın.\nKağız çıxdısa, printer işləyir. Çıxmadısa: kağız rulonunun düz taxıldığını, qapağın bağlı olduğunu və printerin işığını yoxlayın, sonra yenidən sınayaq.`
   :`Printer hazırda cavab vermir, ona görə sınaq çeki növbəyə alındı. Fiziki çap hələ təsdiqlənməyib. Printer qoşulan kimi avtomatik çap olunacaq; yenidən göndərməyə ehtiyac yoxdur.\n${reason}\nSatış və ödənişlər bundan asılı deyil: müştəri çekləri də növbədə gözləyir və printer qayıdanda çıxır.`;
  // A printer found on the network is offered as the receipt printer once its test page went through.
  if(found&&job.status==='completed'){flow={stage:'use',target,key:makeKey()};return reply(body+`\n\nBu printeri çek printeri edim? X, Z və müştəri çekləri ona gedəcək.`,[choice('Çek printeri et','printer:use')]);}
  return{body,choices:[]};
 }
 return{start,send,get active(){return!!flow;},cancel(){flow=null;last=null;},snapshot:()=>({flow,last}),restore:s=>{flow=s?.flow||null;last=s?.last||null;},get searching(){return flow?.stage==='none';},approval:()=>flow?.stage==='confirm'?{name:'printerTest',args:[{target:flow.target},flow.key]}:flow?.stage==='use'?{name:'printerUse',args:[flow.target,flow.key]}:null,async recheck(valid){const answer=await start(valid);return{...answer,body:'Planı yenidən yoxlayın.\n'+answer.body};}};
}
