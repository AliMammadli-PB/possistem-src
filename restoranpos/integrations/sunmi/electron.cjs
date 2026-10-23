'use strict';
const path=require('node:path');
const {createSunmiService}=require('./service.cjs');
const {SunmiError}=require('./protocol.cjs');
function registerSunmi({ipcMain,app,safeStorage,assertTrusted,actor,invoke,getDbPath,setLocalCopy,notify}){
 const core=async(method,payload)=>{const r=await invoke(method,payload);if(!r?.success)throw new SunmiError(r?.error?.code||'SUNMI_CORE',r?.error?.message||'Yerli baza cavab vermədi.');return r.data;};
 const service=createSunmiService({getRoot:()=>path.dirname(getDbPath()),secretBox:{available:()=>safeStorage.isEncryptionAvailable()&&safeStorage.getSelectedStorageBackend?.()!=='basic_text',encrypt:value=>safeStorage.encryptString(value).toString('base64'),decrypt:value=>safeStorage.decryptString(Buffer.from(value,'base64'))},beforeSave:cfg=>setLocalCopy?setLocalCopy(cfg.enabled&&!cfg.printLocalCopy,cfg):Promise.resolve(),source:{pending:since=>core('sunmi.pending',{since}),finish:(id,status,result)=>core('sunmi.finish',{id,status,result})}});
 const manager=user=>user?.superAdmin||['manager','administrator','admin','owner','super_admin','superadmin'].includes(user?.role);
 let lastStatus='';
 const announce=(state,message)=>{const signature=getDbPath()+state+message;if(signature===lastStatus)return;lastStatus=signature;try{if(notify)notify({state,message});else for(const w of require('electron').BrowserWindow.getAllWindows())if(!w.isDestroyed())w.webContents.send('possistem:sunmi-status',{state,message});}catch{/* A closed window cannot affect fiscal registration. */}};
 const process=async()=>{actor();try{const result=await service.process();if(result.enabled){if(service.hasPending())announce('pending','SUNMI: fiskal çeki tamamlanmamış qaimə var. Parametrlər → SUNMI bölməsində səbəbi yoxlayın. Eyni satışı yenidən yaratmayın.');else if(result.results.length)announce('done','SUNMI: fiskal çek qeydə alındı.');}return result;}catch(error){announce('error',error instanceof SunmiError?error.message:'SUNMI: fiskal qeydiyyatı yoxlayın.');throw error;}};
 ipcMain.handle('possistem:sunmi',async(event,input={})=>{
  assertTrusted(event);const user=actor();if(!user)throw new Error('Giriş tələb olunur.');
  const action=String(input.action||'');
  if(['save','connect','retry','command'].includes(action)&&!manager(user))throw new Error('SUNMI ayarları və fiskal əməliyyatlar üçün müdir icazəsi tələb olunur.');
  try{
   if(action==='get')return {ok:true,data:{config:service.get(),jobs:service.history(),canManage:!!manager(user)}};
   if(action==='save')return {ok:true,data:await service.save(input.data||{})};
   if(action==='connect')return {ok:true,data:await service.connect()};
   if(action==='process')return {ok:true,data:await process()};
   if(action==='retry'){if(String(input.id||'').startsWith('command:'))return {ok:true,data:await service.repeatCommand(input.id)};await service.retry(String(input.id||''));return {ok:true,data:await process()};}
   if(action==='command'){
    const commands=new Set(['getInfo','getShiftStatus','openShift','closeShift','deposit','withDraw','getXReport','printLastCheque','getPeriodicZReport','getControlTape','isConnectedPrinter','openCashbox','toLogout']);
    if(!commands.has(input.operation))throw new SunmiError('SUNMI_ACTION','Satış və qaytarma POS-un öz qaiməsindən aparılmalıdır.');
    const data={...input.data};data.cashierName=user.name||user.fullName||'Kassir';
    if(['deposit','withDraw'].includes(input.operation)&&!(data.sum>0))throw new SunmiError('SUNMI_VALIDATION','Məbləğ sıfırdan böyük olmalıdır.');
    // A Z report must never overtake paid receipts waiting for registration.
    if(input.operation==='closeShift'){
     const sent=await process();if(service.hasPending()||sent.results.some(x=>x.state!=='done'))throw new SunmiError('SUNMI_PENDING','Əvvəl gözləyən fiskal çekləri həll edin.');
    }
    return {ok:true,data:await service.command(String(input.operation||''),data,String(input.key||''))};
   }
   throw new SunmiError('SUNMI_ACTION','Əməliyyat tanınmır.');
  }catch(error){return {ok:false,error:{code:error.code||'SUNMI_ERROR',message:error instanceof SunmiError?error.message:'SUNMI əməliyyatı tamamlanmadı.',uncertain:!!error.uncertain}};}
 });
 // Re-scan the transactional native outbox after a crash/restart; never depend on a renderer callback.
 const timer=setInterval(()=>{try{actor();if(service.get().enabled)void process().catch(()=>{});}catch{/* Signed out or changing branch. */}},15000);timer.unref?.();app.once('before-quit',()=>clearInterval(timer));
 return {service,process};
}
module.exports={registerSunmi};
