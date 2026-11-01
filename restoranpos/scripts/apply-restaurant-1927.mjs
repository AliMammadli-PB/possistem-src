import fs from'node:fs';import path from'node:path';import ts from'typescript';import{fileURLToPath}from'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),file=root+'/index-DAmHwBc4.js';let s=fs.readFileSync(file,'utf8');const ast=ts.createSourceFile('app.js',s,99,true),fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='AppShell');if(!fn)throw Error('1927 AppShell missing');let text=fn.getText(ast);
if(!text.includes('/* QR_SIDEBAR_1927 */')){
 const old='jsxRuntimeExports.jsx(PsQrInbox, {}),';if(text.split(old).length!==2)throw Error('1927 expected one old QR inbox mount');text=text.replace(old,'/* QR_SIDEBAR_1927 */');
 const a=ts.createSourceFile('shell.js',text,99,true);let target;function visit(n){if(ts.isPropertyAssignment(n)&&n.name.getText(a)==='children'&&ts.isCallExpression(n.initializer)&&n.initializer.expression.getText(a)==='links.map')target=n.initializer;ts.forEachChild(n,visit)}visit(a);if(!target)throw Error('1927 sidebar link list missing');text=text.slice(0,target.getStart(a))+'['+target.getText(a)+',jsxRuntimeExports.jsx(PsQrInbox,{})]'+text.slice(target.end);
}
s=s.slice(0,fn.getStart(ast))+text+s.slice(fn.end);fs.writeFileSync(file,s.trimEnd()+'\n');console.log('1927: one QR inbox in the collapsible rail; its dialog portals outside the rail');
