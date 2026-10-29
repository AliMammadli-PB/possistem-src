/** Point the existing Linux desktop shortcut at this tested source/runtime. */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const desktop=path.join(os.homedir(),'Desktop'),launcher=path.join(desktop,'Possistem-Newest'),current=path.join(launcher,'current');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
for(const file of ['out/main/index.js','out/preload/index.js','out/renderer/index.html','native/build/restaurant-pos-core','native/build/restaurant-pos-core.exe'])if(!fs.existsSync(path.join(root,file)))throw Error('Build before installing shortcut: '+file);
fs.mkdirSync(launcher,{recursive:true});
if(fs.existsSync(current)&&!fs.lstatSync(current).isSymbolicLink())throw Error('Refusing to replace non-symlink current directory');
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
for(const file of [path.join(launcher,'launch.sh'),path.join(desktop,'Possistem-Newest.desktop')])if(fs.existsSync(file))fs.copyFileSync(file,file+'.before-'+stamp);
try{fs.unlinkSync(current)}catch(e){if(e.code!=='ENOENT')throw e;}
fs.symlinkSync(root,current,'dir');
fs.writeFileSync(path.join(launcher,'launch.sh'),`#!/usr/bin/env bash\nset -euo pipefail\nHERE="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"\nexport POS_REBUILD_ON_LAUNCH=0\nexec "$HERE/current/scripts/launch-linux.sh" "$@"\n`,{mode:0o755});
fs.writeFileSync(path.join(launcher,'version.txt'),pkg.version+'\n');
fs.writeFileSync(path.join(desktop,'Possistem-Newest.desktop'),`[Desktop Entry]\nVersion=1.0\nType=Application\nName=possistem NEWEST\nComment=Restoran POS ${pkg.version}\nExec="${path.join(launcher,'launch.sh')}"\nIcon=${path.join(current,'packaged-renderer/assets/brands/logo.png')}\nTerminal=false\nCategories=Office;Finance;\nStartupNotify=true\n`,{mode:0o755});
console.log('possistem NEWEST now opens Restaurant POS '+pkg.version);
