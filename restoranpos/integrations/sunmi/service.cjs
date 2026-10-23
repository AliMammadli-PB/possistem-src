'use strict';
const fs=require('node:fs'),path=require('node:path');
const {SunmiClient,SunmiError,endpoint,documentUuid,DOCUMENTS,VAT_TYPES,READ_ONLY}=require('./protocol.cjs');
const {buildReceipt}=require('./receipt.cjs');
const {createJournalStore}=require('./journal.cjs');
function atomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.tmp';const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,file);}
function read(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw new SunmiError('SUNMI_STORAGE','SUNMI faylı oxunmadı. Faylı silməyin; ehtiyat nüsxədən bərpa edin.');}}
function serial(info){return String(info.cashregister_factory_number||info.cashbox_factory_number||'');}
function createSunmiService({getRoot,secretBox,source,clientFactory=c=>new SunmiClient(c),clock=Date.now,beforeSave=async()=>{}}){
 let running=null,processing=null,processingRoot=null;
 const scope=()=>path.join(getRoot(),'sunmi');
 const config=()=>read(path.join(scope(),'config.json'),{enabled:false,endpoint:'',username:'',vatType:null,printLocalCopy:false,openCashDrawer:false,activatedAt:0});
 const journal=(root=scope())=>createJournalStore(root,{read,atomic});
 const putJournal=j=>j.flush();
 const credentials=c=>{if(!c.secret)throw new SunmiError('SUNMI_CONFIG','SUNMI şifrəsi saxlanmayıb.');return {...c,password:secretBox.decrypt(c.secret)};};
 const publicConfig=c=>{const {secret,...safe}=c;return {...safe,hasPassword:!!secret};};
 const client=c=>clientFactory(credentials(c));
 const exclusive=fn=>{const requestedRoot=scope();const result=(running||Promise.resolve()).catch(()=>{}).then(()=>{if(requestedRoot!==scope())throw new SunmiError('SUNMI_SCOPE','Filial dəyişdi. Əməliyyatı həmin filialda yenidən açın.');return fn();});running=result;result.finally(()=>{if(running===result)running=null;}).catch(()=>{});return result;};
 const save=async input=>exclusive(async()=>{
  const c=config(),next={...c};
  if(typeof input.endpoint==='string')next.endpoint=endpoint(input.endpoint);
  if(typeof input.username==='string')next.username=input.username.trim().slice(0,160);
  if(input.password){if(!secretBox.available())throw new SunmiError('SUNMI_SECRET','Əməliyyat sisteminin qorunan şifrə yaddaşı əlçatan deyil.');next.secret=secretBox.encrypt(String(input.password));}
  if(input.vatType!==undefined){if(!VAT_TYPES.includes(Number(input.vatType)))throw new SunmiError('SUNMI_CONFIG','Vergi növünü seçin.');next.vatType=Number(input.vatType);}
  if(input.vatOverrides!==undefined){
   if(!input.vatOverrides||typeof input.vatOverrides!=='object'||Array.isArray(input.vatOverrides)||Object.keys(input.vatOverrides).length>5000)throw new SunmiError('SUNMI_CONFIG','Məhsul üzrə vergi siyahısı düzgün deyil.');
   const entries=Object.entries(input.vatOverrides);for(const[code,vat]of entries)if(!code.trim()||code.length>100||['__proto__','constructor','prototype'].includes(code)||!VAT_TYPES.includes(vat))throw new SunmiError('SUNMI_CONFIG','Məhsul kodunu və vergi növünü yoxlayın.');next.vatOverrides=Object.fromEntries(entries);
  }
  next.printLocalCopy=input.printLocalCopy===true;
  if(input.openCashDrawer!==undefined)next.openCashDrawer=input.openCashDrawer===true;
  const identityChanged=next.endpoint!==c.endpoint||next.username!==c.username||Boolean(input.password);
  if(identityChanged){next.enabled=false;next.verifiedAt=0;}
  if(input.enabled===true){
   if(!next.verifiedAt||!next.deviceId||identityChanged)throw new SunmiError('SUNMI_CONFIG','Əvvəl saxlayın və bağlantını yoxlayın.');
   if(!VAT_TYPES.includes(next.vatType))throw new SunmiError('SUNMI_CONFIG','Vergi növünü seçin.');
   if(c.activatedAt&&next.deviceId!==c.deviceId)throw new SunmiError('SUNMI_DEVICE','Gözləyən sənədlər başqa SUNMI-yə avtomatik köçürülmür.');
   next.enabled=true;if(!next.activatedAt)next.activatedAt=clock();
  }else if(input.enabled===false)next.enabled=false;
  try{await beforeSave(publicConfig(next));atomic(path.join(scope(),'config.json'),next);}catch(error){await beforeSave(publicConfig(c)).catch(()=>{});throw error;}return publicConfig(next);
 });
 const connect=()=>exclusive(async()=>{
  const root=scope(),c=config(),api=client(c);await api.call('toLogin');const info=(await api.call('getInfo')).data;
  const id=serial(info);if(!id)throw new SunmiError('SUNMI_DEVICE','Cihaz seriya nömrəsini qaytarmadı.');
  if(c.activatedAt&&c.deviceId&&id!==c.deviceId)throw new SunmiError('SUNMI_DEVICE','Bu IP-də əvvəl bağlanmış SUNMI deyil. Seriya nömrəsini yoxlayın.');
  if(root!==scope())throw new SunmiError('SUNMI_SCOPE','Hesab dəyişdi. Bağlantını yenidən yoxlayın.');
  const next={...c,deviceId:id,verifiedAt:clock(),info,connectionBlocked:false,lastConnectionError:null};
  await api.call('isConnectedPrinter');const shift=(await api.call('getShiftStatus')).data;atomic(path.join(root,'config.json'),next);return {config:publicConfig(next),info,shift};
 });
 const safeError=error=>({code:error?.code||'SUNMI_ERROR',message:error instanceof SunmiError?error.message:'SUNMI əməliyyatı saxlanmadı. Bağlantını və yerli yaddaşı yoxlayın.',uncertain:!!error?.uncertain});
 function resultOf(out,totalMinor,info){
  const d=out.data;if(!d?.document_id)throw new SunmiError('SUNMI_UNKNOWN','Fiskal ID alınmadı.',{uncertain:true});
  if(totalMinor!==undefined&&Math.round(Number(d.totalSum)*100)!==totalMinor)throw new SunmiError('SUNMI_TOTAL','Cihazdakı yekun POS məbləğindən fərqlidir. Çeki yoxlayın.',{uncertain:true});
  const prefix=String(info?.qr_code_url||'');let qrData='';
  try{if(/^https:\/\/monitoring\.e-kassa\.gov\.az\//i.test(prefix))qrData=prefix+encodeURIComponent(d.document_id);}catch{/* QR is optional, a fiscal ID is not. */}
  return {fiscalReceiptId:String(d.document_id),documentNumber:d.document_number??'',shortDocumentId:d.short_document_id??'',qrData,totalMinor,duplicate:out.duplicate===true,bankReference:d.rrn||'',approvalCode:d.approval_code||''};
 }
 function ensureRefundLimit(snapshot,request,j){
  if(snapshot.kind!=='refund')return;
  const parent=j.jobs[snapshot.parentId];
  const accumulated=new Map();
  for(const item of request.items){
   const previous=accumulated.get(item.parentItemUuid)||{qty:0,amount:0};
   previous.qty+=Math.round(item.quantity*1000);previous.amount+=Math.round(item.sum*100);accumulated.set(item.parentItemUuid,previous);
   const original=parent.request.items.find(x=>x.itemUuid===item.parentItemUuid);
   let qty=0,amount=0;
   for(const job of j.children(snapshot.parentId))if(job.id!==snapshot.id&&job.parentId===snapshot.parentId&&job.state!=='rejected')for(const line of job.request?.items||[])if(line.parentItemUuid===item.parentItemUuid){qty+=Math.round(line.quantity*1000);amount+=Math.round(line.sum*100);}
   if(qty+previous.qty>Math.round(original.quantity*1000)||amount+previous.amount>Math.round(original.sum*100))throw new SunmiError('SUNMI_REFUND_LIMIT','Bu məhsul üzrə qaytarma ilkin fiskal miqdarı və ya məbləği keçir.');
  }
 }
 const process=()=>{const requestedRoot=scope();if(processing&&processingRoot===requestedRoot)return processing;processingRoot=requestedRoot;const result=exclusive(async()=>{
  const root=scope(),c=config();if(!c.enabled)return {enabled:false,results:[]};
  if(c.connectionBlocked)throw new SunmiError('SUNMI_CONNECTION_BLOCKED',c.lastConnectionError?.message||'SUNMI bağlantısını yenidən yoxlayın.');
  const rows=await source.pending(c.activatedAt),results=[];if(!rows.length)return {enabled:true,results};
  const api=client(c);let info;try{info=(await api.call('getInfo')).data;const shift=(await api.call('getShiftStatus')).data;if(shift.shift_open!==true)throw new SunmiError('SUNMI_503','SUNMI növbəsi bağlıdır. Əvvəl növbəni açın.');}catch(error){if(['SUNMI_401','SUNMI_403','SUNMI_404','SUNMI_405'].includes(error.code))atomic(path.join(root,'config.json'),{...c,connectionBlocked:true,lastConnectionError:safeError(error)});throw error;}if(serial(info)!==c.deviceId)throw new SunmiError('SUNMI_DEVICE','SUNMI seriya nömrəsi dəyişib. Göndəriş dayandırıldı.');
  for(const snapshot of rows){
   if(root!==scope())break;
   const j=journal(root);let job=j.jobs[snapshot.id];
   if(job?.state==='done'){await source.finish(snapshot.id,'success',job.result);results.push({id:snapshot.id,state:'done'});continue;}
   // Deterministic refusals and fiscal-success warnings require operator review, never a retry loop.
   if(job&&['rejected','review'].includes(job.state)){results.push({id:job.id,state:job.state,error:job.error});continue;}
   try{
    if(!job?.request){const built=buildReceipt(snapshot,c,j.jobs[snapshot.parentId]);ensureRefundLimit(snapshot,built.data,j);job={id:snapshot.id,parentId:snapshot.parentId,deviceId:c.deviceId,operation:built.operation,request:built.data,totalMinor:built.totalMinor,state:'ready',createdAt:clock(),attempts:0};j.jobs[job.id]=job;putJournal(j,root);}
    if(job.deviceId!==c.deviceId)throw new SunmiError('SUNMI_DEVICE','Bu qaimə başqa SUNMI cihazına bağlıdır.');
    // Frozen request and UUID are fsynced before the first byte can reach a fiscal device.
    job.state='sending';job.attempts++;job.updatedAt=clock();putJournal(j,root);
    const out=await api.call(job.operation,job.request);
    job.result=resultOf(out,job.totalMinor,info);job.state='done';delete job.error;putJournal(j,root);
    if(c.openCashDrawer&&job.request.cashPayment>0){job.drawerAttempted=true;putJournal(j,root);try{await api.call('openCashbox');}catch{job.drawerWarning='Fiskal çek qeydə alındı, pul qutusu açılmadı. Bağlantını yoxlayın.';putJournal(j,root);}}
    if(root!==scope())break;await source.finish(job.id,'success',job.result);results.push({id:job.id,state:job.state});
   }catch(error){
    if(root!==scope())break;
    // Never undo a recorded fiscal success because the local acknowledgement failed.
    if(job?.state==='done')throw error;
    if(!job){job={id:snapshot.id,parentId:snapshot.parentId,deviceId:c.deviceId,operation:snapshot.kind==='refund'?'moneyBack':'sale',createdAt:clock(),state:'rejected',attempts:0};j.jobs[job.id]=job;}
    job.state=error?.uncertain?'unknown':error?.retryable?'retry':'rejected';if(['SUNMI_1205','SUNMI_TOTAL'].includes(error?.code))job.state='review';job.error=safeError(error);putJournal(j,root);
    await source.finish(snapshot.id,job.state==='unknown'?'unknown':job.state==='rejected'||job.state==='review'?'blocked':'failed',job.error).catch(()=>{});results.push({id:snapshot.id,state:job.state,error:job.error});
    if(error?.retryable||error?.uncertain||['SUNMI_401','SUNMI_403','SUNMI_404','SUNMI_405','SUNMI_DEVICE','SUNMI_503','SUNMI_504'].includes(error?.code))break;
   }
  }
  return {enabled:true,results};
 });processing=result;result.finally(()=>{if(processing===result){processing=null;processingRoot=null;}}).catch(()=>{});return result;};
 const retry=id=>exclusive(async()=>{const j=journal(),job=j.jobs[id];if(!job)throw new SunmiError('SUNMI_NOT_FOUND','Sənəd tapılmadı.');if(job.state==='done')return job.result;if(job.state==='review')throw new SunmiError('SUNMI_REVIEW','Əvvəl cihazdakı fiskal sənədi Caspos ilə yoxlayın.');if(!job.request||job.state==='rejected'){delete j.jobs[id];}else{job.state='ready';delete job.error;}putJournal(j);await source.finish(id,'pending',{retry:true});return {ready:true};});
 const command=(operation,data={},key)=>exclusive(async()=>{
  const root=scope(),c=config();if(!c.verifiedAt)throw new SunmiError('SUNMI_CONFIG','Əvvəl bağlantını yoxlayın.');
  const api=client(c),info=(await api.call('getInfo')).data;if(serial(info)!==c.deviceId)throw new SunmiError('SUNMI_DEVICE','Cihazın seriya nömrəsi uyğun deyil.');
  if(READ_ONLY.has(operation))return api.call(operation,data);
  if(!key||!/^[-a-zA-Z0-9:]{8,100}$/.test(key))throw new SunmiError('SUNMI_KEY','Əməliyyat açarı tələb olunur.');
  const j=journal(root),id='command:'+key;let job=j.jobs[id];
  const payload={...data};if(DOCUMENTS.has(operation))payload.documentUUID=documentUuid(c.deviceId+':'+id);
  if(job&&(job.operation!==operation||JSON.stringify(job.request)!==JSON.stringify(payload)))throw new SunmiError('SUNMI_KEY','Eyni əməliyyat açarı dəyişmiş məlumatla istifadə edilə bilməz.');
  if(job?.state==='done')return job.result;
  if(job&&['unknown','sending','review'].includes(job.state)&&!DOCUMENTS.has(operation))throw new SunmiError('SUNMI_REVIEW','Nəticə qeyri-müəyyəndir. Əvvəl cihazın vəziyyətini yoxlayın.');
  job??={id,deviceId:c.deviceId,operation,request:payload,createdAt:clock()};j.jobs[id]=job;job.state='sending';putJournal(j,root);
  try{const out=await api.call(operation,job.request);job.state='done';job.result=DOCUMENTS.has(operation)?resultOf(out,undefined,info):out;if(operation==='closeShift')job.result.report={currencies:out.data?.currencies,createdAtUtc:out.data?.createdAtUtc,shiftOpenAtUtc:out.data?.shiftOpenAtUtc,reportNumber:out.data?.reportNumber,firstDocNumber:out.data?.firstDocNumber,lastDocNumber:out.data?.lastDocNumber,docCountToSend:out.data?.docCountToSend};putJournal(j,root);return job.result;}
  catch(error){job.state=error?.uncertain?'unknown':'rejected';job.error=safeError(error);putJournal(j,root);throw error;}
 });
 const repeatCommand=async id=>{const job=journal().jobs[id];if(!job||!id.startsWith('command:'))throw new SunmiError('SUNMI_NOT_FOUND','Əməliyyat tapılmadı.');return command(job.operation,job.request,id.slice(8));};
 return {documentStatus:id=>journal().jobs[id],get:()=>publicConfig(config()),save,connect,process,retry,command,repeatCommand,history:()=>Object.values(journal().jobs).map(({request,...job})=>job).sort((a,b)=>b.createdAt-a.createdAt).slice(0,100),hasPending:()=>journal().unresolved().some(j=>['sale','moneyBack'].includes(j.operation)&&j.state!=='done')};
}
module.exports={createSunmiService,atomic};
