import fs from'node:fs';import path from'node:path';import{fileURLToPath}from'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
// Share one viewer implementation across React 18 owner-web and React 19 Next.
for(const f of ['ModelViewer.tsx','model-viewer.css'])fs.copyFileSync(path.join(root,'platform/apps/owner-web/src/qr3d',f),path.join(root,'website/src/components/qr',f));
const vendor=path.join(root,'platform/apps/owner-web/node_modules/@google/model-viewer/dist/model-viewer.min.js');
for(const p of ['website/public/assets/vendor/model-viewer-4.4.0.min.js','platform/apps/owner-web/public/vendor/model-viewer-4.4.0.min.js']){fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true});fs.copyFileSync(vendor,path.join(root,p));}
