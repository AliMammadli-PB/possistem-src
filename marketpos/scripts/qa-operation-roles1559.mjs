import {build,transform} from 'esbuild';
import fs from 'node:fs';import http from 'node:http';import path from 'node:path';import assert from 'node:assert/strict';import {chromium}from'@playwright/test';
const root=path.resolve('artifacts/market-permissions-20261022/role-ui');fs.mkdirSync(root,{recursive:true});
const compiled=await transform(fs.readFileSync('artifacts/market-permissions-20261022/work/pos-permissions.ts','utf8'),{loader:'ts',format:'cjs'});const module={exports:{}};new Function('module','exports',compiled.code)(module,module.exports);const catalogue=module.exports.catalogueFor('market');
const policy={version:7,roles:[{name:'manager',permissions:['OPS_PURCHASES','DOCS_VIEW'],operationPolicyVersion:1}],catalogue,entitlements:{unrestricted:true,allowed:[]}};
const fixture=`import React from'react';import{createRoot}from'react-dom/client';import{RolePermissionsPanel}from'./src/RolePermissionsPanel';import{OperationsWorkspace}from'./src/OperationsWorkspace';
let policy=${JSON.stringify(policy)};window.qa={saves:[]};window.marketSystem={permissions:{get:async()=>policy,save:async(token,role,permissions,expectedVersion)=>{qa.saves.push({role,permissions,expectedVersion});policy={...policy,version:8,roles:[{name:role,permissions}]};return policy;}}};window.marketOps={status:async()=>({host:true,state:'ready'})};
const mode=new URLSearchParams(location.search).get('mode');const session={id:'u1',role:'manager',name:'Müdir',active:true,sessionToken:'test',registerIds:[],warehouseIds:[]};
createRoot(document.getElementById('app')).render(mode==='tabs'?<OperationsWorkspace session={session} lang="az" notify={()=>{}} registers={null} users={null} canUsers={false} can={keys=>keys.some(k=>['OPS_PURCHASES'].includes(k))}/>:<RolePermissionsPanel actorRole="manager" superAdmin sessionToken="test" lang="az"/>);`;
await build({stdin:{contents:fixture,loader:'tsx',sourcefile:'fixture.tsx',resolveDir:path.resolve('marketpos')},bundle:true,outfile:root+'/fixture.js',loader:{'.css':'empty','.woff2':'empty'},jsx:'automatic'});
const server=http.createServer((req,res)=>{if(req.url.startsWith('/ops/')){res.end('<html></html>');return;}if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(root+'/fixture.js'));return;}res.end('<html><body><div id="app"></div><script src="/fixture.js"></script></body></html>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage();await page.goto(base);
 await page.getByRole('heading',{name:'Rollar və səlahiyyətlər'}).waitFor();
 const salary=page.getByLabel('Maaşlar',{exact:false}).first();assert.equal(await salary.isChecked(),false);await salary.check();
 await page.getByRole('button',{name:'İcazələri saxla',exact:true}).click();await page.getByRole('status').filter({hasText:'Saxlanıldı'}).waitFor();
 const saved=await page.evaluate(()=>qa.saves[0]);assert.equal(saved.role,'manager');assert.equal(saved.expectedVersion,7);assert.ok(saved.permissions.includes('OPS_SALARY'));assert.ok(saved.permissions.includes('OPS_PURCHASES'));assert.ok(!saved.permissions.includes('OPS_EXPENSES'));
 await page.goto(base+'/?mode=tabs');await page.getByRole('button',{name:'Alışlar',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Maaşlar',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Kassalar',exact:true}).count(),0);
 console.log('PASS actual React: superadmin edits the ordinary manager, saves selected section grants with version, unrelated sections stay closed, operations tabs follow explicit rights');
}finally{await browser.close();await new Promise(r=>server.close(r));}
