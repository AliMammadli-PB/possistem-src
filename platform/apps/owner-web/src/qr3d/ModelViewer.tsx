import{createElement,useEffect,useRef,useState}from'react';
import'./model-viewer.css';
const words={
 az:{loading:'3D model yüklənir…',preparing:'iPhone üçün AR hazırlanır…',opening:'Kamera görünüşü açılır…',ar:'Masamda göstər',failed:'3D görünüş açıla bilmədi. Menyu və sifariş işləməyə davam edir.',back:'Şəklə qayıt',hint:'Fırlatmaq üçün sürüşdürün. AR-də iki barmaqla böyüdüb kiçildə bilərsiniz.',iosHint:'Açılan Apple pəncərəsində AR seçin. Kameranı masaya yönəldin. Ölçünü iki barmaqla böyüdüb kiçildin.',arFailed:'AR açıla bilmədi. Safari və ya Chrome ilə yoxlayın; adi 3D görünüş qalır.',retry:'AR-ni yenidən hazırla'},
 tr:{loading:'3D model yükleniyor…',preparing:'iPhone için AR hazırlanıyor…',opening:'Kamera görünümü açılıyor…',ar:'Masamda göster',failed:'3D görünüm açılamadı. Menü ve sipariş çalışmaya devam eder.',back:'Resme dön',hint:'Döndürmek için sürükleyin. AR’de iki parmakla boyutu değiştirebilirsiniz.',iosHint:'Açılan Apple penceresinde AR seçin. Kamerayı masaya doğrultun. İki parmakla boyutu değiştirin.',arFailed:'AR açılamadı. Safari veya Chrome ile deneyin; 3D görünümü kullanabilirsiniz.',retry:'AR’yi yeniden hazırla'},
 en:{loading:'Loading 3D model…',preparing:'Preparing AR for iPhone…',opening:'Opening camera view…',ar:'View on my table',failed:'The 3D view could not open. The menu and ordering still work.',back:'Back to photo',hint:'Drag to rotate. Pinch with two fingers to resize in AR.',iosHint:'Choose AR in the Apple viewer. Point the camera at your table. Pinch with two fingers to resize.',arFailed:'AR could not open. Try Safari or Chrome, or continue with the 3D view.',retry:'Prepare AR again'}
};
let script:Promise<void>|null=null;
function loadViewer(url:string){if(customElements.get('model-viewer'))return Promise.resolve();if(script)return script;script=new Promise((resolve,reject)=>{const tag=document.createElement('script');tag.type='module';tag.src=url;tag.onload=()=>customElements.whenDefined('model-viewer').then(()=>{const C=customElements.get('model-viewer') as any;if(C)C.modelCacheSize=0;resolve();});tag.onerror=()=>{script=null;tag.remove();reject(Error('viewer'));};document.head.appendChild(tag);});return script;}
function appleDevice(){return /iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);}
export default function ModelViewer({url,label,poster='',language='az',owner=false,onBack,beforeAr}:{url:string;label:string;poster?:string;language?:'az'|'tr'|'en';owner?:boolean;onBack:()=>void;beforeAr?:()=>void}){
 const ref=useRef<any>(null),[ready,setReady]=useState(false),[loaded,setLoaded]=useState(false),[failed,setFailed]=useState(false),[canAr,setCanAr]=useState(false),[arError,setArError]=useState(false),[starting,setStarting]=useState(false),[ios,setIos]=useState(false),[preparing,setPreparing]=useState(false),[retry,setRetry]=useState(0);const copy=words[language];
 useEffect(()=>{let active=true;setIos(appleDevice());document.documentElement.dataset.food3dActive='true';document.dispatchEvent(new CustomEvent('possistem:qr3d-active',{detail:true}));void loadViewer(owner?'/pos/app/vendor/model-viewer-4.4.0.min.js':'/assets/vendor/model-viewer-4.4.0.min.js').then(()=>{if(active)setReady(true);}).catch(()=>{if(active)setFailed(true);});return()=>{active=false;delete document.documentElement.dataset.food3dActive;document.dispatchEvent(new CustomEvent('possistem:qr3d-active',{detail:false}));};},[owner]);
 useEffect(()=>{
  if(!ready||!ref.current)return;const v=ref.current,apple=appleDevice();let active=true,usdz='',converting=false;
  setLoaded(false);setFailed(false);setCanAr(false);setArError(false);setPreparing(false);
  const timer=setTimeout(()=>{if(active)setFailed(true);},30000);
  const load=()=>{
   clearTimeout(timer);if(!active)return;setLoaded(true);
   if(!apple){setCanAr(Boolean(v.canActivateAR));return;}
   if(converting||usdz)return;converting=true;setPreparing(true);
   // Prepare before the tap: Quick Look then opens in the original user gesture.
   // Keep this blob alive until the viewer closes; it contains only this model.
   void v.prepareUSDZ().then((blobUrl:string)=>{if(!active){URL.revokeObjectURL(blobUrl);return;}if(!blobUrl.startsWith('blob:'))throw Error('USDZ conversion failed');usdz=blobUrl;v.iosSrc=blobUrl;setCanAr(Boolean(v.canActivateAR));}).catch(()=>{if(active)setArError(true);}).finally(()=>{if(active)setPreparing(false);});
  };
  const error=()=>{clearTimeout(timer);if(active)setFailed(true);};
  const status=(e:any)=>{if(e.detail?.status==='failed'&&active){setArError(true);setStarting(false);}};
  const arTimer=setInterval(()=>{if(active)setCanAr(Boolean(v.canActivateAR)&&(!apple||!!usdz));},500);
  v.addEventListener('load',load);v.addEventListener('error',error);v.addEventListener('ar-status',status);v.setAttribute('src',url);
  return()=>{active=false;clearTimeout(timer);clearInterval(arTimer);v.removeEventListener('load',load);v.removeEventListener('error',error);v.removeEventListener('ar-status',status);v.pause?.();v.removeAttribute('src');v.iosSrc=null;if(usdz)URL.revokeObjectURL(usdz);};
 },[ready,url,retry]);
 async function ar(){if(!ref.current||starting||!canAr)return;setStarting(true);setArError(false);try{beforeAr?.();if(ios&&ref.current.iosSrc?.startsWith('blob:')){const a=document.createElement('a'),u=new URL(ref.current.iosSrc);u.hash='allowsContentScaling=1';a.rel='ar';a.href=u.href;a.download='possistem-food.usdz';a.style.display='none';a.appendChild(document.createElement('img'));document.body.appendChild(a);a.click();setTimeout(()=>a.remove(),1000);}else await ref.current.activateAR();}catch{setArError(true);}finally{setStarting(false);}}
 return <section className="ps-food-3d" aria-label={label}>{failed?<div role="alert" className="ps-food-3d-fallback">{poster&&<img src={poster} alt={label}/>}<p>{copy.failed}</p><button type="button" onClick={onBack}>{copy.back}</button></div>:<>
  {!loaded&&<p role="status" className="ps-food-3d-loading">{copy.loading}</p>}
  {ready&&createElement('model-viewer',{ref,alt:label,'camera-controls':'','touch-action':'pan-y',ar:true,'ar-modes':ios?'quick-look':'webxr scene-viewer quick-look','ar-placement':'floor','ar-scale':'auto','ar-usdz-max-texture-size':'2048','shadow-intensity':'1','interaction-prompt':'none',loading:'eager',poster,exposure:'1'},createElement('button',{slot:'ar-button',hidden:true,type:'button','aria-hidden':true}))}
  <div className="ps-food-3d-actions"><button type="button" className="ps-food-3d-ar" disabled={!loaded||!canAr||starting||preparing} onClick={()=>void ar()}>{preparing?copy.preparing:starting?copy.opening:copy.ar}</button><button type="button" onClick={onBack}>{copy.back}</button></div>
  {preparing&&<p role="status" className="ps-food-3d-hint"><span className="ps-food-3d-spinner" aria-hidden="true"/> {copy.preparing}</p>}
  <p className="ps-food-3d-hint">{ios?copy.iosHint:copy.hint}</p>{arError&&<p role="alert" className="ps-food-3d-hint">{copy.arFailed} <button type="button" onClick={()=>setRetry(n=>n+1)}>{copy.retry}</button></p>}
 </>}</section>;
}
