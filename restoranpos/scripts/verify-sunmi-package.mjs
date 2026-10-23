#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import * as asar from '@electron/asar';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),repo=path.dirname(root);
const hash=b=>createHash('sha256').update(b).digest('hex');
const results=[];
for(const app of ['restoranpos','marketpos']){
 const dir=path.join(repo,app),version=JSON.parse(fs.readFileSync(path.join(dir,'package.json'))).version;
 const restaurant=app==='restoranpos',release=path.join(dir,restaurant?`release-${version}`:'release'),archive=path.join(release,'win-unpacked/resources/app.asar');
 const members=new Set(asar.listPackage(archive).map(x=>x.replace(/^\//,'')));
 const mainDir=restaurant?'out/main':'electron';
 for(const name of ['electron.cjs','protocol.cjs','receipt.cjs','journal.cjs','service.cjs']){
  const file=`${mainDir}/sunmi/${name}`;if(!members.has(file)||!asar.extractFile(archive,file).equals(fs.readFileSync(path.join(root,'integrations/sunmi',name))))throw Error(`${app}: missing/stale ${file}`);
 }
 const renderer=restaurant?'out/renderer/sunmi-renderer.js':'dist/sunmi-renderer.js';
 if(!asar.extractFile(archive,renderer).equals(fs.readFileSync(path.join(root,'integrations/sunmi/renderer.js'))))throw Error(`${app}: stale renderer`);
 const pre=asar.extractFile(archive,restaurant?'out/preload/index.js':'electron/preload.cjs').toString();
 for(const text of ['possistem:sunmi','_sunmiPreparePayment','_sunmiPrepareRefund','possistem:sunmi-status'])if(!pre.includes(text))throw Error(`${app}: missing preload hook ${text}`);
 const seen=new Set();function dependency(pkg,from){const manifest=createRequire(path.join(from,'noop.cjs')).resolve(pkg+'/package.json'),folder=path.dirname(manifest);if(seen.has(folder))return;seen.add(folder);const rel=path.relative(fs.realpathSync(path.join(dir,'node_modules')),fs.realpathSync(folder)).replaceAll(path.sep,'/');if(!members.has('node_modules/'+rel+'/package.json'))throw Error(`${app}: updater dependency not packaged: ${rel}`);for(const dep of Object.keys(JSON.parse(fs.readFileSync(manifest)).dependencies||{}))dependency(dep,folder);}
 dependency('electron-updater',dir);
 for(const core of restaurant?['restaurant-pos-core']:['market-pos-core','restaurant-pos-core']){const file=path.join(release,'win-unpacked/resources/native/win32-x64',core+'.exe'),source=path.join(repo,core==='market-pos-core'?'marketpos':'restoranpos','native/build',core+'.exe');if(hash(fs.readFileSync(file))!==hash(fs.readFileSync(source)))throw Error(`${app}: stale native ${core}`);}
 const names=restaurant?[`Possistem-Setup-${version}.exe`,`Possistem-Portable-${version}.exe`]:[`MarketPos-Setup-${version}.exe`,`MarketPos-Portable-${version}.exe`];const files=names.map(name=>{const file=path.join(release,name),data=fs.readFileSync(file);if(data.toString('ascii',0,2)!=='MZ'||data.length<1e7)throw Error('Invalid executable: '+name);return {name,size:data.length,sha256:hash(data)};});
 const latest=fs.readFileSync(path.join(release,'latest.yml'),'utf8'),expected=latest.match(/^sha512:\s*(\S+)/m)?.[1],target=latest.match(/^path:\s*(\S+)/m)?.[1];if(target!==names[0]||createHash('sha512').update(fs.readFileSync(path.join(release,target))).digest('base64')!==expected)throw Error(`${app}: update manifest mismatch`);
 results.push({app,version,files,updaterPackages:seen.size,sourceMatchesArchive:true});
}
console.log(JSON.stringify(results,null,2));
