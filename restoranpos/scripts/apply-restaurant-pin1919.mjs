import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const file=path.join(root,'index-DAmHwBc4.js');let source=fs.readFileSync(file,'utf8');
const marker='/* POSSISTEM_SINGLE_PIN_1919 */';
if(!source.includes(marker)){
 const a=source.indexOf('function LoginPage()'),b=source.indexOf('\nclass PosApiError',a);if(a<0||b<0)throw Error('PIN page not found');let s=source.slice(a,b);
 const once=(from,to)=>{if(s.split(from).length!==2)throw Error('PIN1919 anchor: '+from.slice(0,90));s=s.replace(from,to);};
 once('const [pinMode,setPinMode]=reactExports.useState("auto");',marker);
 once('  const pinLength=pinChange?4:pinMode==="platform"||pin.length>4?10:4;','  const pinLength=pinChange?4:10;');
 once('if (pin.length !== (pinChange?4:pinMode==="platform"?10:4) || busy || submittingRef.current) return;','if ((pinChange ? pin.length!==4 : ![4,10].includes(pin.length)) || busy || submittingRef.current) return;');
 once('  }, [selected, pin, busy, navigate, t, setSession, pinChange, pinMode]);','  }, [selected, pin, busy, navigate, t, setSession, pinChange]);');
 const detectStart=s.indexOf('  loginLatest.current={pin,submit,pinChange,pinMode};'),detectEnd=s.indexOf('  const resetSelection',detectStart);if(detectStart<0||detectEnd<0)throw Error('PIN detection not found');
 s=s.slice(0,detectStart)+`  loginLatest.current={pin,submit,pinChange,busy};
  // A prefix check may identify a long PIN, but never blocks full-length entry.
  reactExports.useEffect(()=>{
    if(pinChange||pin.length!==4||busy){setPrefixChecking(false);return;}
    let live=true;
    const timer=window.setTimeout(async()=>{
      setPrefixChecking(true);
      try{
        const result=await window.pos.auth.adminPrefix?.(pin);
        if(live&&result?.success&&result.data?.available!==false&&!result.data?.extended&&loginLatest.current.pin===pin&&!loginLatest.current.busy)void loginLatest.current.submit();
      }catch{/* Keep typing; only an actual login attempt reports an error. */}
      finally{if(live)setPrefixChecking(false);}
    },400);
    return()=>{live=false;window.clearTimeout(timer);};
  },[pin,Boolean(pinChange),busy]);
  reactExports.useEffect(()=>{
    if((pinChange&&pin.length===4)||(!pinChange&&pin.length===10))void submit();
  },[pin,submit,Boolean(pinChange)]);
`+s.slice(detectEnd);
 once('      if (/^\\d$/.test(event.key)) setPin((current) => current.length < (pinChange||pinMode==="staff"?4:10) ? current + event.key : current);',`      if(event.target instanceof HTMLElement&&event.target.matches('input,textarea,[contenteditable="true"]'))return;
      if (/^\\d$/.test(event.key)) {event.preventDefault();setPin((current) => current.length < (pinChange?4:10) ? current + event.key : current);}`);
 once('setPinChange(null); setPinMode("auto");','setPinChange(null);');
 once('  }, [selected, busy, resetSelection, pinChange, pinMode]);','  }, [selected, busy, resetSelection, pinChange, submit]);');
 once('      else if (event.key === "Backspace") setPin((current) => current.slice(0, -1));',`      else if (event.key === "Backspace") {event.preventDefault();setPin((current) => current.slice(0, -1));}
      else if(event.key === "Enter") {event.preventDefault();void submit();}`);
 const fieldStart=s.indexOf('                        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-2 text-xs leading-5 text-muted", children: psAdminText("PIN kodunuzu yazın"'),fieldEnd=s.indexOf('                        /* @__PURE__ */ jsxRuntimeExports.jsx(PinPad,',fieldStart);if(fieldStart<0||fieldEnd<0)throw Error('PIN input anchor missing');
 s=s.slice(0,fieldStart)+`                        jsxRuntimeExports.jsx("input", {
                          className:"ps-pin-input",type:"password",inputMode:"numeric",pattern:"[0-9]*",autoComplete:"off",autoFocus:true,
                          "aria-label":psAdminText("PIN kodu","PIN kodu","PIN code"),maxLength:pinLength,value:pin,disabled:busy,
                          "aria-invalid":pinPhase==="err",onChange:event=>{setPin(event.target.value.replace(/[^0-9]/g,"").slice(0,pinLength));setError(null);setPinPhase("idle");},
                          onKeyDown:event=>{if(event.key==="Enter"){event.preventDefault();void submit();}else if(event.key==="Escape"){event.preventDefault();setPin("");setError(null);setPinChange(null);setPinPhase("idle");}}
                        }),
`+s.slice(fieldEnd);
 once('maxLength: pinChange||pinMode==="staff"?4:10, disabled: busy, onChange: setPin, onSubmit: () => {if(pinMode!=="auto")void submit();}', 'maxLength: pinLength, disabled: busy, onChange: value=>{setPin(value);setError(null);setPinPhase("idle");}');
 if(/pinMode|ps-pin-mode-switch|ps-first-login-hint|10 rəqəmli PIN/.test(s))throw Error('Old PIN mode remains');
 fs.writeFileSync(file,source.slice(0,a)+s+source.slice(b));
}
const cssFile=path.join(root,'possistem-system.css');let css=fs.readFileSync(cssFile,'utf8');if(!css.includes(marker)){css+='\n'+marker+`\nhtml body .ps-rest-staff .ps-pin-input{display:block;box-sizing:border-box;width:100%;max-width:440px;min-height:58px;margin:22px 0 20px;padding:12px 18px;border:1px solid #6c83a3;border-radius:14px;background:#0c1728;color:#f4f7ff;font:600 26px/1.2 sans-serif;letter-spacing:.3em;text-align:center;outline:none;caret-color:#8dbaff}html body .ps-rest-staff .ps-pin-input:focus{border-color:#84b9ff;box-shadow:0 0 0 3px #5a9ff026}html body .ps-rest-staff .ps-pin-input[aria-invalid="true"]{border-color:#db8189}html body .ps-rest-staff .ps-pin-input:disabled{opacity:.65}@media(max-width:480px){html body .ps-rest-staff .ps-pin-input{min-height:52px;font-size:24px;margin:16px 0}}\n`;fs.writeFileSync(cssFile,css);}
console.log('PIN 1919: one masked input, automatic full ten-digit login, no mode buttons or PIN hints');
