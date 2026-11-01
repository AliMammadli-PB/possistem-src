import fs from'node:fs';import path from'node:path';import ts from'typescript';import{fileURLToPath}from'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),file=root+'/index-DAmHwBc4.js';let source=fs.readFileSync(file,'utf8');
function edit(name,change){const ast=ts.createSourceFile('ui.js',source,99,true),node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);if(!node)throw Error('1926 missing '+name);source=source.slice(0,node.getStart(ast))+change(node.getText(ast))+source.slice(node.end)}
edit('AppShell',s=>s.includes('"aria-label": label,')?s:s.replace('end: to === "/admin",','end: to === "/admin",\n            "aria-label": label,'));
edit('PsBranchNetwork',s=>s.replace('location.hash="/branches"','location.hash="/operations?tab=stock&branchSwitch=1"'));
fs.writeFileSync(file,source.trimEnd()+'\n');console.log('1926: accessible hover rail and warehouse branch switching');
