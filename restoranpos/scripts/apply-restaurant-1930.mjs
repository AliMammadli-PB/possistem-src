/** Align PIN and keypad; preserve the native masked entry and login lifecycle. */
import fs from'node:fs';import path from'node:path';import ts from'typescript';import{fileURLToPath}from'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),file=root+'/index-DAmHwBc4.js';let s=fs.readFileSync(file,'utf8');const a=ts.createSourceFile('app.js',s,99,true),fn=a.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='LoginPage');if(!fn)throw Error('1930 LoginPage missing');let b=fn.getText(a);
if(!b.includes('/* PIN_LAYOUT_1930 */')){
 const once=(from,to)=>{if(b.split(from).length!==2)throw Error('1930 anchor '+from);b=b.replace(from,to)};
 once('className: "ps-rest-staff"','className: "ps-rest-staff ps-pin-layout-1930"');
 once('className:"ps-pin-entry"','/* PIN_LAYOUT_1930 */className:"ps-pin-entry ps-pin-workbench"');
 once('className:"ps-pin-circles"','className:"ps-pin-slots"');
 once('className:"ps-pin-circle"+(i<pin.length?" is-filled":"")','className:"ps-pin-slot"+(i<pin.length?" is-filled":"")+(i===pin.length?" is-current":"")');
 s=s.slice(0,fn.getStart(a))+b+s.slice(fn.end);fs.writeFileSync(file,s.trimEnd()+'\n');
}
const cssFile=root+'/possistem-system.css',start='/* PIN_LAYOUT_1930_START */',end='/* PIN_LAYOUT_1930_END */',block=start+'\n'+fs.readFileSync(root+'/pin-entry/style.css','utf8')+'\n'+end;let css=fs.readFileSync(cssFile,'utf8');if(css.includes(start)){css=css.slice(0,css.indexOf(start))+block+css.slice(css.indexOf(end)+end.length)}else css+='\n'+block+'\n';fs.writeFileSync(cssFile,css);console.log('1930 aligned PIN slots, title, real access notice and touch keypad');
