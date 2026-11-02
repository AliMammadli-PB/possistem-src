/** Restore four masked PIN circles; keep the single real input and native PIN detection. */
import fs from'node:fs';import path from'node:path';import ts from'typescript';import{fileURLToPath}from'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),file=root+'/index-DAmHwBc4.js';let s=fs.readFileSync(file,'utf8');
const ast=ts.createSourceFile('app.js',s,99,true),fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='LoginPage');if(!fn)throw Error('1929 LoginPage missing');let body=fn.getText(ast);
if(!body.includes('/* PIN_CIRCLES_1929 */')){
 const a=ts.createSourceFile('login.js',body,99,true);let input;
 function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(a)==='jsxRuntimeExports.jsx'&&n.arguments[0]?.getText(a)==='"input"'&&n.getText(a).includes('className:"ps-pin-input"'))input=n;ts.forEachChild(n,visit)}visit(a);if(!input)throw Error('1929 expected one PIN password input');
 const field=`/* PIN_CIRCLES_1929 */psH("div",{className:"ps-pin-entry"+(pinPhase==="err"?" is-err":"")+(busy?" is-busy":""),style:{"--pin-slots":pinChange||pin.length<=4?4:10},"data-slots":pinChange||pin.length<=4?4:10},
 psH("div",{className:"ps-pin-circles","aria-hidden":"true"},Array.from({length:pinChange||pin.length<=4?4:10},(_,i)=>psH("span",{key:i,className:"ps-pin-circle"+(i<pin.length?" is-filled":"")},psH("span",null)))),
 ${input.getText(a)})`;
 body=body.slice(0,input.getStart(a))+field+body.slice(input.end);
 s=s.slice(0,fn.getStart(ast))+body+s.slice(fn.end);fs.writeFileSync(file,s.trimEnd()+'\n');
}
const cssFile=root+'/possistem-system.css',marker='/* PIN_CIRCLES_1929 */';let css=fs.readFileSync(cssFile,'utf8');if(!css.includes(marker)){
 css+='\n'+marker+`\n.ps-pin-entry{position:relative;box-sizing:border-box;width:248px;max-width:100%;margin:24px 0;padding:5px;border-radius:12px}.ps-pin-entry[data-slots="10"]{width:440px}.ps-pin-circles{display:grid;grid-template-columns:repeat(var(--pin-slots),minmax(0,1fr));gap:12px;pointer-events:none}.ps-pin-circle{display:grid;place-items:center;width:100%;aspect-ratio:1;border:1.5px solid #63758e;border-radius:50%;background:#ffffff08;transition:background .15s,border-color .15s}.ps-pin-circle>span{display:block;width:11px;height:11px;border-radius:50%;background:transparent}.ps-pin-circle.is-filled{border-color:#60a5fa;background:#16305a}.ps-pin-circle.is-filled>span{background:#eaf2ff}.ps-pin-entry[data-slots="10"] .ps-pin-circles{gap:6px}.ps-pin-entry[data-slots="10"] .ps-pin-circle>span{width:8px;height:8px}.ps-pin-entry:focus-within .ps-pin-circle{border-color:#77abef;box-shadow:0 0 0 3px #3b82f622}.ps-pin-entry.is-err .ps-pin-circle{border-color:#be3646}.ps-pin-entry.is-busy{opacity:.65}html body .ps-rest-staff .ps-pin-entry .ps-pin-input{position:absolute;inset:0;z-index:1;display:block;box-sizing:border-box;width:100%;max-width:none;height:100%;min-height:0;margin:0;padding:0;border:0;border-radius:12px;opacity:0;caret-color:transparent;letter-spacing:normal;cursor:text;font-size:20px}@media(prefers-reduced-motion:reduce){.ps-pin-circle{transition:none}}\n`;
 fs.writeFileSync(cssFile,css);
}
console.log('1929: four PIN circles restored; masked keyboard/touch entry and long PIN detection retained');
