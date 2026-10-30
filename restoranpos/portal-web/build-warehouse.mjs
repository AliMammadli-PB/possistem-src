#!/usr/bin/env node
/** Current application screens for the authenticated owner warehouse; no desktop bundle is modified. */
import {createHash} from 'node:crypto';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';import {build} from 'esbuild';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.dirname(here),out=path.resolve(process.argv[2]||path.join(here,'warehouse-dist'));
if(out===root||out===here||out===path.parse(out).root)throw Error('Refusing to use a source directory as warehouse output');
fs.rmSync(out,{recursive:true,force:true});
const processResult=spawnSync(process.execPath,[path.join(root,'cloud-branches/build.mjs'),out],{stdio:'inherit'});if(processResult.status!==0)process.exit(1);
for(const folder of ['remote','remote-market']){const bridge=path.join(out,folder,'cloud-bridge.js');fs.appendFileSync(bridge,'\n'+fs.readFileSync(path.join(here,'warehouse-readonly.js'),'utf8'));}
await build({entryPoints:[path.join(here,'warehouse-extra.tsx')],bundle:true,format:'esm',platform:'browser',target:'es2022',outdir:path.join(out,'extra'),entryNames:'extra',assetNames:'assets/[name]-[hash]',loader:{'.woff2':'file','.woff':'file','.ttf':'file','.png':'file','.svg':'file','.jpg':'file'},minify:true});
fs.writeFileSync(path.join(out,'extra/index.html'),'<!doctype html><html lang="az"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="./extra.css"><title>Anbar qaimələri · possistem</title></head><body><div id="root"></div><script type="module" src="./extra.js"></script></body></html>');
console.log('Owner warehouse application screens ready:',out);

// A new catalogue release must not reuse yesterday's cached renderer or bridge.
for(const folder of ['remote','remote-market']){
 const dir=path.join(out,folder),index=path.join(dir,'index.html');let html=fs.readFileSync(index,'utf8');
 for(const rel of ['assets/index-BsrHjfOR.js','possistem-system.css','cloud-bridge.js']){
  const file=path.join(dir,rel),hash=createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0,12),p=path.parse(rel),fresh=path.join(p.dir,p.name+'-'+hash+p.ext).replaceAll('\\','/');
  fs.copyFileSync(file,path.join(dir,fresh));html=html.replaceAll('./'+rel,'./'+fresh);
 }
 fs.writeFileSync(index,html);
}
