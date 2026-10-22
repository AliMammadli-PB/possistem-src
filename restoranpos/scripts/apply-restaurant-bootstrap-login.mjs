/** 1.9.8: authoritative PIN checks, visible first-run instructions and admin home. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function once(s,a,b){if(s.split(a).length!==2)throw Error('bootstrap login anchor: '+a.slice(0,100));return s.replace(a,b);}
const mainFile=path.join(root,'index.js');let main=fs.readFileSync(mainFile,'utf8');
if(!main.includes('/* POS_NATIVE_PIN_198 */')){
 const start=main.indexOf('case"auth.login":{const n=t&&typeof t=="object"?t:{};');
 const end=main.indexOf('case"tenant.status":',start);
 if(start<0||end<0)throw Error('PIN IPC adapter not found');
 // Do not look up PINs in Electron or turn PIN-only requests into named
 // requests: that bypassed the terminal's native attempt counter and errors.
 main=main.slice(0,start)+'case"auth.login":/* POS_NATIVE_PIN_198 */return null;'+main.slice(end);
 fs.writeFileSync(mainFile,main);
}
const file=path.join(root,'index-DAmHwBc4.js');let s=fs.readFileSync(file,'utf8');
if(!s.includes('class PsAdminRecoveryBoundary ')){
 s=once(s,'function PsAdminFrame({ children }) {',`class PsAdminRecoveryBoundary extends React.Component {
  constructor(props){super(props);this.state={failed:false,attempt:0};}
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(error,info){console.error("[POS admin page]",error,info.componentStack);}
  componentDidUpdate(previous){if(previous.route!==this.props.route&&this.state.failed)this.setState({failed:false});}
  render(){return this.state.failed?psH("section",{className:"ps-admin-recovery",role:"alert"},
    psH("h2",null,psAdminText("Bölmə açıla bilmədi","Bölüm açılamadı","This section could not open")),
    psH("p",null,psAdminText("Yenidən sınayın və ya idarəetməyə qayıdın. Davam edərsə, Diaqnostika bölməsindəki jurnalı dəstəyə təqdim edin.","Tekrar deneyin veya yönetime dönün. Sorun sürerse Tanılama günlüğünü desteğe iletin.","Retry or return to management. If it continues, provide the Diagnostics log to support.")),
    psH("button",{type:"button",className:"btn solid",onClick:()=>this.setState(s=>({failed:false,attempt:s.attempt+1}))},psAdminText("Yenidən sına","Tekrar dene","Retry")),
    jsxRuntimeExports.jsx(Link,{to:"/admin",className:"btn outline",children:psAdminText("İdarəetməyə qayıt","Yönetime dön","Back to management")})):
    jsxRuntimeExports.jsx(reactExports.Fragment,{children:this.props.children},this.state.attempt);}
}
function PsAdminFrame({ children }) {`);
 s=once(s,'reactExports.createElement("div", { className: "ps-admin-content" }, children)',
 'reactExports.createElement("div", { className: "ps-admin-content" }, jsxRuntimeExports.jsx(PsAdminRecoveryBoundary,{route:pathname+search,children}))');
 fs.writeFileSync(file,s);
}
if(!s.includes('/* POS_BOOTSTRAP_LOGIN_198 */')){
 s=once(s,'  const can = (key) => perms.includes(key);','  const can = (key) => perms.includes(key);\n  /* POS_BOOTSTRAP_LOGIN_198 */\n  if (role === "administrator") return "/admin";');
 const start=s.indexOf('function LoginPage()'),end=s.indexOf('\nfunction ',start+20);
 if(start<0||end<0)throw Error('LoginPage not found');let part=s.slice(start,end);
 part=once(part,'    const res = pinChange ? await window.pos.auth.login(null, pinChange.old, pin) : await window.pos.auth.login(null, pin);',`    let res;
    try { res = pinChange ? await window.pos.auth.login(null, pinChange.old, pin) : await window.pos.auth.login(null, pin); }
    catch (error) {
      submittingRef.current = false; setBusy(false); setPin(""); setPinPhase("err");
      setError(error instanceof Error ? error.message : String(error)); return;
    }`);
 part=once(part,'      if (!res.success) return;','      if (!res.success) { setError(res.error?.message || t.common.error); return; }');
 part=once(part,'    });\n  }, []);','    }).catch(error => { setLoadingUsers(false); setError(String(error?.message || error)); });\n  }, []);');
 const hint='/* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-2 text-xs leading-5 text-muted", children: t.login.pinHint })';
 part=once(part,hint,hint+',\n                        jsxRuntimeExports.jsx("p", {className:"ps-first-login-hint",role:"note",children:psAdminText("İlk quraşdırma: Super Admin PIN-i 1234. Sonra şəxsi PIN təyin edin. PIN dəyişdirilibsə, öz PIN-inizi yazın.","İlk kurulum: Super Admin PIN 1234. Ardından kişisel PIN belirleyin. Değiştirdiyseniz kendi PIN’inizi girin.","First setup: Super Admin PIN is 1234. Then choose your personal PIN. If already changed, use your own PIN.")})');
 s=s.slice(0,start)+part+s.slice(end);fs.writeFileSync(file,s);
}
const cssFile=path.join(root,'possistem-system.css');let css=fs.readFileSync(cssFile,'utf8');
if(!css.includes('/* POS_BOOTSTRAP_LOGIN_198 */')){css+='\n/* POS_BOOTSTRAP_LOGIN_198 */\n.ps-first-login-hint{max-width:32rem;font-size:14px;line-height:1.5;padding:12px 16px;margin:12px 0;border:1px solid #c7d8ef;border-radius:12px;background:#edf4ff;color:#24466d;text-transform:none;letter-spacing:normal}\n';fs.writeFileSync(cssFile,css);}
if(!css.includes('.ps-admin-recovery{')){css+='\n.ps-admin-recovery{background:#fff;border:1px solid #c7d8ef;border-radius:20px;padding:24px;max-width:720px;margin:32px auto;color:#193455}.ps-admin-recovery h2{font-size:22px;font-weight:700;margin-bottom:12px}.ps-admin-recovery p{font-size:16px;line-height:1.6;margin-bottom:20px}.ps-admin-recovery .btn{min-height:48px;margin:4px;padding:12px 18px;display:inline-flex;align-items:center;white-space:normal}\n';fs.writeFileSync(cssFile,css);}
console.log('Restaurant native PIN authority, first-run instructions and Super Admin home ready');
