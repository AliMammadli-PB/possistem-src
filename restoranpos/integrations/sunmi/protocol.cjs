'use strict';
// Caspos Mobile SUNMI 1.0.7.0 / integration document 1.0.13.0, pages 1–46.
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { createHash } = require('node:crypto');
const VAT_TYPES = [1,2,3,5,6,7];
const OPERATIONS = Object.freeze(['toLogin','toLogout','getInfo','getShiftStatus','openShift','closeShift','deposit','withDraw','sale','credit','prepayment','prepaymentProducts','moneyBack','correction','rollBack','getXReport','printLastCheque','getPeriodicZReport','getControlTape','isConnectedPrinter','openCashbox']);
const READ_ONLY = new Set(['getInfo','getShiftStatus','getPeriodicZReport','getControlTape','isConnectedPrinter']);
const DOCUMENTS = new Set(['closeShift','deposit','withDraw','sale','credit','prepayment','prepaymentProducts','moneyBack','correction','rollBack']);
const MONEY = new Set(['sum','salePrice','purchasePrice','discountAmount','cashPayment','cardPayment','creditPayment','depositPayment','bonusPayment','realPrice','residue','parentDocumentSum','vatSum','clientTotalBonus','clientEarnedBonus']);
const ERROR_AZ = {1:'Bu sənəd artıq icra olunub. Əvvəlki nəticə yoxlanılır.',401:'SUNMI sessiyası bitib. Bağlantını yenidən yoxlayın.',403:'SUNMI-də kassir rolunu və inteqrasiya rejimini yoxlayın.',404:'SUNMI giriş məlumatları yanlışdır. Təkrar cəhd etməzdən əvvəl yoxlayın.',405:'SUNMI PIN-i kilidlənib. Caspos dəstəyinə müraciət edin.',503:'SUNMI növbəsi bağlıdır. Əvvəl növbəni açın.',504:'SUNMI növbəsi 24 saatı keçib. Z hesabatı ilə bağlayın.',604:'SUNMI-nin internet bağlantısını bərpa edib gözləyən sənədləri göndərin.',607:'Çekin yekun məbləği uyğun gəlmir.',611:'Məhsulların məbləği çekin yekununa uyğun deyil.',612:'Məhsulun barkod növü yanlışdır.',616:'Vergi növünü yoxlayın.',629:'Qaytarılan qalığın hesablanmasını və SUNMI versiyasını yoxlayın.',646:'Bank RRN nömrəsi yanlışdır.',1205:'Fiskal sənəd yaranıb, lakin məhsul adlarında problem var. Cihazdakı çeki yoxlayın; yeni UUID ilə təkrarlamayın.'};
class SunmiError extends Error { constructor(code,message,{uncertain=false,retryable=false,data}={}){super(message);this.code=code;this.uncertain=uncertain;this.retryable=retryable;if(data)this.data=data;} }
const fail=(message)=>{throw new SunmiError('SUNMI_VALIDATION',message);};
function endpoint(value){
 const raw=String(value||'').trim();let url;try{url=new URL(raw.includes('://')?raw:`http://${raw}`);}catch{fail('SUNMI IP ünvanını daxil edin.');}
 const host=url.hostname;
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||net.isIP(host)!==4)fail('Yalnız yerli SUNMI cihazının IPv4 ünvanından istifadə edin.');
 const [a,b]=host.split('.').map(Number);
 if(!(a===10||a===192&&b===168||a===172&&b>=16&&b<=31||a===169&&b===254||a===127))fail('SUNMI ünvanı yerli şəbəkədə olmalıdır.');
 if(!url.port)url.port='5544';return url.toString();
}
function documentUuid(key){const h=createHash('sha256').update('possistem.sunmi.v1:'+key).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
function serialize(value,key=''){
 if(typeof value==='number'){if(!Number.isFinite(value))fail('Rəqəm düzgün deyil.');if(key==='quantity')return value.toFixed(3);if(MONEY.has(key))return value.toFixed(2);return JSON.stringify(value);}
 if(Array.isArray(value))return '['+value.map(v=>serialize(v)).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.entries(value).filter(([,v])=>v!==undefined).map(([k,v])=>JSON.stringify(k)+':'+serialize(v,k)).join(',')+'}';
 return JSON.stringify(value);
}
function validate(operation,data={}){
 if(!OPERATIONS.includes(operation))fail('Bu SUNMI əməliyyatı dəstəklənmir.');
 if(DOCUMENTS.has(operation)&&!/^[-a-zA-Z0-9]{8,80}$/.test(data.documentUUID||''))fail('Sənədin sabit UUID-si olmalıdır.');
 for(const key of MONEY)if(data[key]!==undefined&&(!Number.isFinite(data[key])||data[key]<0))fail(`Məbləğ düzgün deyil: ${key}`);
 if(data.currency&&data.currency!=='AZN')fail('SUNMI üçün valyuta AZN olmalıdır.');
 if(data.vatType!==undefined&&!VAT_TYPES.includes(data.vatType))fail('Vergi növünü seçin.');
 if(['sale','moneyBack','credit','prepaymentProducts'].includes(operation)){
  if(!Array.isArray(data.items)||!data.items.length)fail('Çekdə məhsul olmalıdır.');
  for(const item of data.items){
   if(!String(item.name||'').trim()||!String(item.code||'').trim())fail('Məhsulun adı və kodu olmalıdır.');
   if(!Number.isFinite(item.quantity)||item.quantity<=0||Math.abs(item.quantity*1000-Math.round(item.quantity*1000))>1e-6)fail('Miqdar müsbət və ən çox üç onluq rəqəmli olmalıdır.');
   if(![0,1,2,3,4,5].includes(item.quantityType)||![0,1,2,3].includes(item.codeType)||!VAT_TYPES.includes(item.vatType))fail('Məhsulun vahid, barkod və ya vergi növü yanlışdır.');
   for(const key of ['salePrice','purchasePrice','discountAmount','sum'])if(item[key]!==undefined&&(!Number.isFinite(item[key])||item[key]<0))fail('Məhsul məbləği yanlışdır.');
   if(item.vatType===2&&item.purchasePrice===undefined)fail('Ticarət əlavəsi vergisi üçün alış qiyməti tələb olunur.');
  }
 }
 if(['moneyBack','rollBack','credit'].includes(operation)&&!String(data.parentDocumentId||'').trim())fail('İlkin fiskal çekin ID-si tələb olunur.');
 if(operation==='moneyBack'&&![0,6,7].includes(data.moneyBackType))fail('Qaytarma növü düzgün deyil.');
 if(data.isManual===true)fail('Yoxlamasız qaytarma avtomatik inteqrasiyada bağlıdır.');
 if(data.rrn&&(!/^\d{12}$/.test(data.rrn)||!(data.cardPayment>0)))fail('RRN yalnız kart ödənişində 12 rəqəm olmalıdır.');
 if(operation==='correction'){
  const a=Date.parse(data.firstOperationAtUtc),b=Date.parse(data.lastOperationAtUtc);if(!Number.isFinite(a)||!Number.isFinite(b)||a>b)fail('Düzəlişin başlanğıc və son tarixini yoxlayın.');
 }
 return data;
}
function post(url,body,timeoutMs=30000){return new Promise((resolve,reject)=>{
 const address=new URL(url),bytes=Buffer.from(body,'utf8');let sent=false,settled=false,deadline;
 const done=(err,out)=>{if(settled)return;settled=true;clearTimeout(deadline);err?reject(err):resolve(out);};
 const req=(address.protocol==='https:'?https:http).request(address,{method:'POST',headers:{'Content-Type':'application/json; charset=utf-8',Accept:'application/json','Content-Length':bytes.length}},res=>{
  let chunks=[],size=0;res.on('data',b=>{size+=b.length;if(size>2*1024*1024){req.destroy();done(new SunmiError('SUNMI_RESPONSE','SUNMI cavabı həddindən böyükdür.',{uncertain:sent}));}else chunks.push(b);});
  res.on('end',()=>{try{if(res.statusCode<200||res.statusCode>=300)throw new Error('HTTP '+res.statusCode);done(null,JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{done(new SunmiError('SUNMI_RESPONSE','SUNMI etibarlı JSON cavabı qaytarmadı.',{uncertain:sent}));}});res.on('error',()=>done(new SunmiError('SUNMI_NETWORK','SUNMI cavabı yarımçıq qaldı.',{uncertain:sent,retryable:true})));
 });
 deadline=setTimeout(()=>req.destroy(new Error('timeout')),timeoutMs);req.setTimeout(timeoutMs,()=>req.destroy(new Error('timeout')));req.on('error',()=>done(new SunmiError('SUNMI_NETWORK','SUNMI-yə bağlantı alınmadı. Cihazdakı çeki yoxlayın; təkrar cəhd eyni UUID ilə aparılacaq.',{uncertain:sent,retryable:true})));req.on('finish',()=>{sent=true;});req.end(bytes);
 });}
class SunmiClient {
 constructor(config,{transport=post}={}){this.config=config;this.url=endpoint(config.endpoint);this.transport=transport;}
 async call(operation,data={}){
  validate(operation,data);
  if(!this.config.username||!this.config.password)fail('Caspos giriş adı və şifrəsini daxil edin.');
  const request={operation,username:this.config.username,password:this.config.password};
  // The PDF places these two commands' cashier name at the root, not in data.
  const payload={...data};if(['openShift','correction','rollBack'].includes(operation)&&payload.cashierName){request.cashierName=payload.cashierName;delete payload.cashierName;}
  if(operation==='rollBack'&&payload.currency){request.currency=payload.currency;delete payload.currency;}
  if(Object.keys(payload).length)request.data=payload;
  const raw=await this.transport(this.url,serialize(request),this.config.timeoutMs||30000);
  if(!raw||typeof raw!=='object'||raw.code===undefined)throw new SunmiError('SUNMI_RESPONSE','SUNMI cavabında əməliyyat kodu yoxdur.',{uncertain:!READ_ONLY.has(operation)});
  const code=String(raw.code),out=raw.data&&typeof raw.data==='object'?raw.data:{};
  if(!['0','1'].includes(code))throw new SunmiError('SUNMI_'+code,ERROR_AZ[code]||`SUNMI əməliyyatı qəbul etmədi (kod ${code}).`,{uncertain:code==='1205'||DOCUMENTS.has(operation)&&(code==='999'||!!out.document_id),data:out.document_id?out:undefined});
  if(DOCUMENTS.has(operation)&&!out.document_id)throw new SunmiError('SUNMI_UNKNOWN','SUNMI fiskal sənəd ID-si qaytarmadı. Cihazdakı sənədi yoxlayın.',{uncertain:true});
  if(operation==='toLogin')return {loggedIn:true};
  return {data:out,duplicate:code==='1'};
 }
}
module.exports={SunmiClient,SunmiError,VAT_TYPES,OPERATIONS,READ_ONLY,DOCUMENTS,ERROR_AZ,endpoint,documentUuid,serialize,validate};
