import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
export function publishBrowserAssets(out, version) {
 const publish=(name,content)=>{const ext=path.extname(name),file=path.basename(name,ext)+'-'+createHash('sha256').update(content).digest('hex').slice(0,10)+ext;fs.writeFileSync(path.join(out,file),content);return file;};
 const css=publish('demo-viewport.css',fs.readFileSync(path.join(here,'viewport.css')));
 const js=publish('demo-viewport.js',fs.readFileSync(path.join(here,'viewport.js'),'utf8').replace("'./viewport.css'",`'./${css}'`));
 for(const name of ['remote','remote-market'])fs.rmSync(path.join(out,'cloud-branches',name),{recursive:true,force:true});
 const file=path.join(out,'index.html');let html=fs.readFileSync(file,'utf8');
 html=html.replace(/,?\s*maximum-scale=1(?:\.0)?/g,'').replace(/,?\s*user-scalable=no/g,'');
 html=html.replace('</head>',`<link rel="stylesheet" href="./${css}" /><script type="module" src="./${js}"></script></head>`);
 fs.writeFileSync(file,html);
 // A public demo has no persistent store. The till's SW would precache an
 // obsolete renderer and delete other products' caches on this shared origin.
 if(fs.existsSync(path.join(out,'sw.js')))fs.writeFileSync(path.join(out,'sw.js'),"self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',event=>event.waitUntil(self.registration.unregister()));\n");
 fs.writeFileSync(path.join(out,'demo-build.json'),JSON.stringify({appVersion:version,builtAt:new Date().toISOString(),renderer:'desktop',database:'in-memory',responsive:true},null,2));
}
