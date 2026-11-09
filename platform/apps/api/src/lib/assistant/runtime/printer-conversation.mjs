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
 const preview=()=>{flow.stage='confirm';return reply(`Printer: ${nameOf(flow.target)}\nBu printerə 1 sınaq çeki göndərəcəyəm: üzərində restoranın adı, tarix və “Sınaq çeki” yazısı olacaq. Satış, ödəniş və printer ayarları dəyişməyəcək, kassaya heç nə yazılmayacaq.\nTəsdiq edirsiniz?`,[choice('Təsdiq et','confirm')]);};
 const choose=data=>{flow.stage='pick';flow.targets=data.printers;return reply(data.printers.length?'Hansı qoşulmuş printeri yoxlayaq?':'Qoşulmuş printer tapılmadı. Parametrlər → Printer bölməsində printeri qoşub seçin. Bu, mağazadakı model siyahısı deyil.',data.printers.map(p=>choice(nameOf(p.name),'printer:target:'+encodeURIComponent(p.target))));};
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
  if(raw.startsWith('printer:target:')){
   if(!last?.choices.some(c=>c.value===raw))return last;
   const row=flow.targets.find(p=>'printer:target:'+encodeURIComponent(p.target)===raw);if(!row)return last;
   flow.target=row.target;return preview();
  }
  if(flow.stage!=='confirm'||!/^(confirm|tesdiq( et|le|leyirem)?|beli|he|yes)$/.test(normalize(raw)))return last;
  const current=await tools.printerList();if(!valid())throw Error('Hesab dəyişib.');
  if(!current.printers.some(p=>p.target===flow.target)){flow.key=makeKey();delete flow.target;return choose(current);}
  const target=flow.target,job=await tools.printerTest({target},flow.key,valid);flow=null;job.printer=job.printer||target;
  const name=nameOf(job.printer||flow?.target),reason=why(job.lastError,job.printer);
  const body=['failed','cancelled','error'].includes(job.status)?`Sınaq çeki ${name} printerinə göndərilə bilmədi.\n${reason}\nDüzəltdikdən sonra “printeri test et” yazın, yenidən yoxlayaq.`
   :job.status==='completed'?`Sınaq çeki ${name} printerinə göndərildi və printer qəbul etdi. Kağızın çıxmasını yoxlayın.\nKağız çıxdısa, printer işləyir. Çıxmadısa: kağız rulonunun düz taxıldığını, qapağın bağlı olduğunu və printerin işığını yoxlayın, sonra yenidən sınayaq.`
   :`Printer hazırda cavab vermir, ona görə sınaq çeki növbəyə alındı. Fiziki çap hələ təsdiqlənməyib. Printer qoşulan kimi avtomatik çap olunacaq; yenidən göndərməyə ehtiyac yoxdur.\n${reason}\nSatış və ödənişlər bundan asılı deyil: müştəri çekləri də növbədə gözləyir və printer qayıdanda çıxır.`;
  return{body,choices:[]};
 }
 return{start,send,get active(){return!!flow;},cancel(){flow=null;last=null;},snapshot:()=>({flow,last}),restore:s=>{flow=s?.flow||null;last=s?.last||null;},approval:()=>flow?.stage==='confirm'?{name:'printerTest',args:[{target:flow.target},flow.key]}:null,async recheck(valid){const answer=await start(valid);return{...answer,body:'Planı yenidən yoxlayın.\n'+answer.body};}};
}
