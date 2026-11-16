/* QR_PAY_SETTINGS_1116 */
// Parametrlər → QR ödəniş: the restaurant connects its own Epoint merchant. Guests then pay a table bill
// by scanning the QR the till shows (Ödəniş → QR ilə ödə) and paying by card on possistem.az; the money
// goes to the restaurant's Epoint account. The private key goes to the server only and is never shown again.
function PsQrPaySettings(){
 const h=psH,[data,setData]=reactExports.useState(null),[error,setError]=reactExports.useState(""),[busy,setBusy]=reactExports.useState(false);
 const [publicKey,setPublicKey]=reactExports.useState(""),[privateKey,setPrivateKey]=reactExports.useState(""),[active,setActive]=reactExports.useState(true);
 const call=(method,payload)=>window.possistemTablePay?window.possistemTablePay.call(method,payload):Promise.resolve({success:false,error:{message:"Bu kassada QR ödəniş modulu yoxdur."}});
 const load=async()=>{setBusy(true);setError("");try{const r=await call("qr.payments.merchant",{});if(!r.success)throw Error(r.error?.message||"Məlumat alınmadı");setData(r.data);setPublicKey(r.data.merchant?.publicKey||"");setActive(r.data.merchant?!!r.data.merchant.active:true);}catch(e){setError(e.message)}finally{setBusy(false)}};
 reactExports.useEffect(()=>{void load()},[]);
 const saved=data?.merchant||null,keyChanged=!saved||publicKey.trim()!==saved.publicKey;
 const save=async()=>{
  const pk=publicKey.trim();
  if(!/^i\d{4,30}$/.test(pk)){setError("Açıq açar «i» hərfi və rəqəmlərdən ibarətdir (məsələn i000000001). Epoint kabinetindən olduğu kimi köçürün.");return;}
  if(keyChanged&&privateKey.trim().length<8){setError("Yeni açıq açar üçün şəxsi açarı da yazın.");return;}
  setBusy(true);setError("");
  try{const r=await call("qr.payments.saveMerchant",{publicKey:pk,privateKey:privateKey.trim(),active});if(!r.success)throw Error(r.error?.message||"Saxlanmadı");setPrivateKey("");toast("Epoint hesabı saxlandı","success");await load();}
  catch(e){setError(e.message)}finally{setBusy(false)}
 };
 const copy=text=>{void navigator.clipboard?.writeText(text).then(()=>toast("Köçürüldü","success"),()=>{});};
 const ready=data?.ready,status=!data?null:!saved?["Qoşulmayıb","is-off"]:!saved.active?["Söndürülüb","is-off"]:ready?.available?["İşləyir","is-on"]:["Gözləyir","is-wait"];
 return h("section",{className:"ps-qr-settings ps-qr-pay-settings"},
  h("header",{className:"ps-qr-heading"},h("div",null,h("h2",null,"QR ödəniş (Epoint)"),h("p",null,"Qonaq masada QR kodu telefonla oxudur və hesabı saytda bank kartı ilə ödəyir. Proqram yükləmək lazım deyil. Pul birbaşa restoranın Epoint hesabına düşür.")),status?h("span",{className:"ps-qr-pay-status "+status[1]},status[0]):null),
  error?h("p",{role:"alert",className:"ps-qr-error"},error):null,
  data&&!data.globallyEnabled?h("p",{className:"ps-qr-help ps-qr-pay-warn"},"QR ödəniş Possistem serverində hələ açılmayıb. Açarları indi saxlaya bilərsiniz; açılan kimi işləyəcək."):null,
  saved&&saved.active&&ready&&!ready.available&&ready.reason&&data.globallyEnabled?h("p",{className:"ps-qr-help ps-qr-pay-warn"},ready.reason):null,
  h("ol",{className:"ps-qr-pay-steps"},
   h("li",null,"epoint.az kabinetinizdə API açarlarını tapın: açıq açar («i» ilə başlayır) və şəxsi açar."),
   h("li",null,"Hər ikisini aşağıya yazıb «Saxla» düyməsini basın."),
   h("li",null,"Göstərilən nəticə (callback) ünvanını Epoint kabinetində qeyd edin. Ödənişin nəticəsini bank bu ünvana göndərir."),
   h("li",null,"Yoxlamaq üçün 1 ₼-lıq hesab açın: Ödəniş → «QR ilə ödə», telefonla oxudun və ödəyin.")),
  h("div",{className:"ps-qr-design"},
   h("label",{className:"ps-qr-field"},"Açıq açar",h("input",{value:publicKey,autoComplete:"off",spellCheck:false,placeholder:"i000000001",onChange:e=>setPublicKey(e.target.value)})),
   h("label",{className:"ps-qr-field"},"Şəxsi açar",h("input",{type:"password",value:privateKey,autoComplete:"new-password",spellCheck:false,placeholder:saved&&!keyChanged?"Saxlanıb · dəyişmək üçün yenisini yazın":"Epoint kabinetindən",onChange:e=>setPrivateKey(e.target.value)}))),
  h("label",{className:"ps-qr-check"},h("input",{type:"checkbox",checked:active,onChange:e=>setActive(e.target.checked)}),h("strong",null,"QR ilə ödəniş açıqdır")),
  h("div",{className:"ps-qr-actions"},h("button",{type:"button",disabled:busy||!publicKey.trim(),onClick:()=>void save()},busy?"Gözləyin…":"Saxla"),h("button",{type:"button",disabled:busy,onClick:()=>void load()},"Yenilə")),
  saved?h("div",{className:"ps-qr-pay-callback"},h("strong",null,"Nəticə (callback) ünvanı"),h("code",null,saved.callbackUrl),h("button",{type:"button",onClick:()=>copy(saved.callbackUrl)},"Köçür"),h("small",null,"Açarları hər dəyişəndə ünvan da dəyişir; yenisini Epoint kabinetinə yazın.")):null,
  h("p",{className:"ps-qr-help"},"Şəxsi açar yalnız serverdə şifrəli saxlanır, kassada və ya ekranda bir daha göstərilmir. Aktiv SUNMI fiskal kassası olan restoranda QR ödəniş hələ bağlıdır."));
}
