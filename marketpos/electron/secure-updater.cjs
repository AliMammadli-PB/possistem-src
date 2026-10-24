'use strict';
const crypto=require('node:crypto'),fs=require('node:fs');
const PUBLIC_KEY=require('./update-public-key.cjs');
function verifyRelease(info,envelope,app,key=PUBLIC_KEY){
 const p=envelope?.payload;
 if(!p||!/^\d+\.\d+\.\d+$/.test(p.version)||p.app!==app||p.version!==info.version||!Number.isSafeInteger(p.size)||p.size<=0||!/^[-\w.]+\.exe$/.test(p.file)||! /^[A-Za-z0-9+/]{86}==$/.test(p.sha512))throw Error('Yeniləmə manifesti uyğun deyil.');
 if(typeof envelope.signature!=='string'||!crypto.verify(null,Buffer.from(JSON.stringify(p)),key,Buffer.from(envelope.signature,'base64')))throw Error('Yeniləmənin imzası təsdiqlənmədi.');
 const files=info.files||[];
 if(files.length!==1||files[0].sha512!==p.sha512||Number(files[0].size)!==p.size)throw Error('Yeniləmə faylı imzalı buraxılışla uyğun deyil.');
 const url=new URL(String(files[0].url),'https://possistem.az/');
 if(url.protocol!=='https:'||url.hostname!=='possistem.az'||url.username||url.password||url.search||url.hash||decodeURIComponent(url.pathname).split('/').at(-1)!==p.file)throw Error('Yeniləmə ünvanı uyğun deyil.');
 return p;
}
function attach(updater,{app,feed,publicKey=PUBLIC_KEY,onError=e=>{if(updater.listenerCount('error'))updater.emit('error',e);}}){
 if(updater.__possistemSignedUpdates)return;updater.__possistemSignedUpdates=true;
 const base=new URL(feed);if(base.protocol!=='https:'||base.hostname!=='possistem.az')throw Error('Yeniləmə serveri etibarlı deyil.');
 Object.defineProperty(updater,'autoDownload',{configurable:false,get:()=>false,set:()=>{}});
 Object.defineProperty(updater,'autoInstallOnAppQuit',{configurable:false,get:()=>false,set:()=>{}});let verified=null,installed=false,inflight='';
 const originalDownload=updater.downloadUpdate.bind(updater),originalInstall=updater.quitAndInstall.bind(updater);
 updater.downloadUpdate=async(...args)=>{if(!verified)throw Error('Əvvəlcə yeniləmə imzası yoxlanılmalıdır.');return originalDownload(...args);};
 updater.quitAndInstall=(...args)=>{if(!installed)throw Error('Yeniləmə faylının yoxlanılması tamamlanmayıb.');return originalInstall(...args);};
 const fail=e=>{verified=null;installed=false;updater.autoInstallOnAppQuit=false;onError(e);};
 updater.on('update-available',async info=>{
  if(inflight===info.version)return;inflight=info.version;verified=null;installed=false;updater.autoInstallOnAppQuit=false;
  try{
   if(!/^\d+\.\d+\.\d+$/.test(info.version))throw Error('Yeniləmə versiyası düzgün deyil.');
   const url=new URL(base.href.replace(/\/?$/,'/')+'v/'+info.version+'/signed.json');
   const response=await fetch(url,{signal:AbortSignal.timeout(15000),redirect:'error',headers:{'cache-control':'no-cache','user-agent':'Mozilla/5.0 Possistem-Signed-Updater/'+app}});
   if(!response.ok||Number(response.headers.get('content-length')||0)>65536)throw Error('İmzalı yeniləmə manifesti alınmadı.');
   const reader=response.body.getReader();let size=0,chunks=[];
   while(true){const{done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();throw Error('Yeniləmə manifesti çox böyükdür.');}chunks.push(Buffer.from(value));}
   const payload=verifyRelease(info,JSON.parse(Buffer.concat(chunks).toString('utf8')),app,publicKey);verified=payload;
   await originalDownload();
  }catch(e){fail(e);}finally{inflight='';}
 });
 updater.on('update-downloaded',async info=>{
  try{
   const p=verified;if(!p||info.version!==p.version||typeof info.downloadedFile!=='string')throw Error('Yeniləmə təsdiqlənməyib.');
   const stat=await fs.promises.stat(info.downloadedFile);if(stat.size!==p.size)throw Error('Yeniləmə ölçüsü uyğun deyil.');
   const hash=crypto.createHash('sha512');for await(const chunk of fs.createReadStream(info.downloadedFile))hash.update(chunk);
   if(hash.digest('base64')!==p.sha512)throw Error('Yeniləmə bütövlüyü təsdiqlənmədi.');
   if(verified!==p)throw Error('Yeniləmə vəziyyəti dəyişib.');installed=true;updater.autoInstallOnAppQuit=true;
  }catch(e){fail(e);}
 });
}
module.exports={verifyRelease,attach};
