import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),file=path.join(root,'index-DAmHwBc4.js'),mark='/* POS_PLATFORM_PAD_199 */';
function once(s,a,b){if(s.split(a).length!==2)throw Error('platform pad anchor: '+a.slice(0,100));return s.replace(a,b);}
let source=fs.readFileSync(file,'utf8');
if(!source.includes(mark)){
 const a=source.indexOf('function LoginPage()'),b=source.indexOf('\nclass PosApiError',a);if(a<0||b<0)throw Error('LoginPage missing');let s=source.slice(a,b);
 s=once(s,'  const [pin, setPin] = reactExports.useState("");',`  const [pin, setPin] = reactExports.useState("");
  ${mark}
  const [pinMode,setPinMode]=reactExports.useState("auto");
  const [prefixChecking,setPrefixChecking]=reactExports.useState(false);
  const loginLatest=reactExports.useRef(null);`);
 s=once(s,'  const [pinChange, setPinChange] = reactExports.useState(null); /* POS_DEFAULT_PIN_v1 */','  const [pinChange, setPinChange] = reactExports.useState(null); /* POS_DEFAULT_PIN_v1 */\n  const pinLength=pinChange?4:pinMode==="platform"||pin.length>4?10:4;');
 s=once(s,'    if (pin.length < 4 || busy || submittingRef.current) return;', '    if (pin.length !== (pinChange?4:pinMode==="platform"?10:4) || busy || submittingRef.current) return;');
 s=once(s,'  }, [selected, pin, busy, navigate, t, setSession, pinChange]);','  }, [selected, pin, busy, navigate, t, setSession, pinChange, pinMode]);');
 s=once(s,`  reactExports.useEffect(() => {
    if (pin.length === 4) void submit();
  }, [pin, submit]);`,`  loginLatest.current={pin,submit,pinChange,pinMode};
  reactExports.useEffect(()=>{
    if(pinMode!=="auto"||pinChange||pin.length<4){setPrefixChecking(false);return;}
    let live=true;setPrefixChecking(true);
    Promise.resolve(window.pos.auth.adminPrefix?.(pin.slice(0,4))||{success:true,data:{extended:false}}).then(result=>{
      if(!live)return;setPrefixChecking(false);
      if(!result.success){setError(result.error?.message||t.login.wrongPin);return;}
      if(result.data?.extended||loginLatest.current.pin.length>4){setPinMode("platform");setError(null);}
      else void loginLatest.current.submit();
    }).catch(error=>{if(live){setPrefixChecking(false);setError(String(error?.message||error));}});
    return()=>{live=false;};
  },[pin.slice(0,4),pinMode,Boolean(pinChange)]);
  reactExports.useEffect(()=>{
    if((pinChange||pinMode==="staff")&&pin.length===4)void submit();
    else if(!pinChange&&pinMode==="platform"&&pin.length===10)void submit();
  },[pin,submit,pinMode,Boolean(pinChange)]);`);
 s=once(s,'if (/^\\d$/.test(event.key)) setPin((current) => current.length < 4 ? current + event.key : current);','if (/^\\d$/.test(event.key)) setPin((current) => current.length < (pinChange||pinMode==="staff"?4:10) ? current + event.key : current);');
 s=once(s,'setPinPhase("idle"); setPinChange(null); }','setPinPhase("idle"); setPinChange(null); setPinMode("auto"); }');
 s=once(s,'  }, [selected, busy, resetSelection]);','  }, [selected, busy, resetSelection, pinChange, pinMode]);');
 s=once(s,'children: t.login.pinHint })','children: pinMode==="platform"?psAdminText("POSSISTEM Super Admin — saytda təyin etdiyiniz 10 rəqəmli PIN","POSSISTEM Super Admin — sitede belirlediğiniz 10 haneli PIN","POSSISTEM Super Admin — your 10-digit website PIN"):t.login.pinHint })');
 const old='jsxRuntimeExports.jsx("p", {className:"ps-first-login-hint",role:"note",children:psAdminText("İlk quraşdırma: Super Admin PIN-i 1234. Sonra şəxsi PIN təyin edin. PIN dəyişdirilibsə, öz PIN-inizi yazın.","İlk kurulum: Super Admin PIN 1234. Ardından kişisel PIN belirleyin. Değiştirdiyseniz kendi PIN’inizi girin.","First setup: Super Admin PIN is 1234. Then choose your personal PIN. If already changed, use your own PIN.")})';
 s=once(s,old,`jsxRuntimeExports.jsx("p",{className:"ps-first-login-hint",role:"note",children:psAdminText("Yerli administrator PIN-i 4 rəqəmdir (ilk quraşdırmada 1234). Saytdakı POSSISTEM Super Admin girişi 10 rəqəmdir.","Yerel yönetici PIN’i 4 hanelidir (ilk kurulumda 1234). Sitedeki POSSISTEM Super Admin PIN’i 10 hanelidir.","The local administrator uses 4 digits (1234 for first setup). The website POSSISTEM Super Admin uses 10 digits.")}),
                        !pinChange?jsxRuntimeExports.jsx("div",{className:"ps-pin-mode-switch",children:jsxRuntimeExports.jsx("button",{type:"button",disabled:busy,"aria-label":pinMode==="platform"?"4 rəqəmli yerli PIN":"10 rəqəmli POSSISTEM PIN",onClick:()=>{setPin("");setError(null);setPinPhase("idle");setPinMode(pinMode==="platform"?"staff":"platform");},children:pinMode==="platform"?psAdminText("Yerli PIN ilə giriş (4 rəqəm)","Yerel PIN ile giriş (4 hane)","Local PIN sign-in (4 digits)"):psAdminText("POSSISTEM girişi (10 rəqəm)","POSSISTEM girişi (10 hane)","POSSISTEM sign-in (10 digits)")})}):null`);
 s=once(s,'className: `ps-staff-pin-dots my-5 flex items-center${','className: `ps-staff-pin-dots my-5 flex items-center${pinLength===10?" is-platform":""}${');
 s=once(s,'"aria-label": `${pin.length} / 4`','"aria-label": `${pin.length} / ${pinLength}`');
 s=once(s,'Array.from({ length: 4 })','Array.from({ length: pinLength })');
 s=once(s,'                            "/4"','                            "/"+pinLength');
 s=once(s,'value: pin, maxLength: 4, disabled: busy, onChange: setPin, onSubmit: () => void submit()', 'value: pin, maxLength: pinChange||pinMode==="staff"?4:10, disabled: busy, onChange: setPin, onSubmit: () => {if(pinMode!=="auto")void submit();}');
 s=once(s,' : busy ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-staff-pin-busy", children: t.login.verifying })', ' : busy||prefixChecking ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-staff-pin-busy", children: t.login.verifying })');
 source=source.slice(0,a)+s+source.slice(b);fs.writeFileSync(file,source);
}
if(!source.includes('style:{display:pinMode==="platform"?"none":undefined}')){
 source=once(source,'className:"ps-first-login-hint",role:"note",children:psAdminText("Yerli',
 'className:"ps-first-login-hint",role:"note",style:{display:pinMode==="platform"?"none":undefined},children:psAdminText("Yerli');fs.writeFileSync(file,source);
}
const cssFile=path.join(root,'possistem-system.css');let css=fs.readFileSync(cssFile,'utf8');
if(!css.includes(mark)){css+='\n'+mark+'\n.ps-staff-pin-dots.is-platform{width:100%;max-width:100%;gap:5px;flex-wrap:nowrap}.ps-staff-pin-dots.is-platform .ps-staff-pin-cell{flex:1;min-width:0;width:auto;max-width:34px;height:42px}.ps-staff-pin-dots.is-platform .ps-staff-pin-count{flex-shrink:0;font-size:12px}.ps-pin-mode-switch button{min-height:48px;padding:10px 14px;border:1px solid #b8cbe5;border-radius:12px;background:#f0f5ff;color:#24466d;font-size:14px;touch-action:manipulation;max-width:100%;white-space:normal}.ps-pin-mode-switch button:disabled{opacity:.6}\n';fs.writeFileSync(cssFile,css);}
if(!css.includes('/* POS_PLATFORM_TOUCH_199 */')){css+='\n/* POS_PLATFORM_TOUCH_199 */\nhtml body .ps-rest-staff .ps-staff-pin .ps-first-login-hint{background:#162a42!important;color:#e2edff!important;border-color:#3d5778!important;font-size:14px!important;line-height:1.5!important}html body .ps-rest-staff .ps-staff-pin .ps-staff-tenant-out{position:static!important;align-self:flex-end;min-height:48px!important;margin:0 0 12px!important;flex-shrink:0}html body .ps-rest-staff .ps-staff-pin-title{padding-right:0!important}html body .ps-rest-staff .ps-staff-pin{overflow-y:auto!important;justify-content:flex-start!important}html body .ps-rest-staff .ps-staff-pad{flex-shrink:0}\n';fs.writeFileSync(cssFile,css);}
console.log('Restaurant four-digit prefix to ten-digit platform PIN pad ready');
