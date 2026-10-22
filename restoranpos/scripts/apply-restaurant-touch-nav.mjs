#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Armchair,Undo2,ChefHat,LayoutDashboard,Boxes,Truck,ShoppingBasket,ClipboardCheck,HandCoins} from 'lucide-react';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const assets=path.join(root,'assets/nav');fs.mkdirSync(assets,{recursive:true});
const icons={tables:Armchair,refund:Undo2,kds:ChefHat,admin:LayoutDashboard,stock:Boxes,goods:ShoppingBasket,delivery:Truck,stocktake:ClipboardCheck,sales:HandCoins};
for(const [name,Icon] of Object.entries(icons)){
 const svg=renderToStaticMarkup(React.createElement(Icon,{width:72,height:72,color:'#1760c9',strokeWidth:1.9}));
 await sharp(Buffer.from(svg)).resize(144,144).png().toFile(path.join(assets,`${name}.png`));
}
const file=path.join(root,'index-DAmHwBc4.js');let s=fs.readFileSync(file,'utf8');
function once(a,b){const n=s.split(a).length-1;if(n!==1)throw Error(`touch-nav anchor ${n}: ${a.slice(0,70)}`);s=s.replace(a,b);}
if(!s.includes('/* POS_TOUCH_NAV_v1 */')){
 once('className: "relative z-20 flex w-16 shrink-0 flex-col','className: "ps-touch-sidebar relative z-20 flex w-16 shrink-0 flex-col');
 once('jsxRuntimeExports.jsx(Icon2, { className: "h-[18px] w-[18px] text-gold-dim transition group-hover:text-gold", strokeWidth: 1.6 })','jsxRuntimeExports.jsx(PsTouchNavIcon, { to, Icon: Icon2 })');
 once('jsxRuntimeExports.jsx("span", { className: "hidden truncate 2xl:block", children: label })','jsxRuntimeExports.jsx("span", { className: "ps-touch-nav-label", children: label })');
 once('const container = document.getElementById("root");',`/* POS_TOUCH_NAV_v1 */
function PsTouchNavIcon({to,Icon}){const key=to.startsWith('/operations')?new URLSearchParams(to.split('?')[1]).get('tab'):to.slice(1);return ['tables','refund','kds','admin','stock','goods','delivery','stocktake','sales'].includes(key)?jsxRuntimeExports.jsx('img',{src:'./assets/nav/'+key+'.png',alt:'',className:'ps-touch-nav-icon',draggable:false}):jsxRuntimeExports.jsx(Icon,{className:'ps-touch-nav-icon',strokeWidth:1.9});}
const container = document.getElementById("root");`);
 once('}, "🛵 Çatdırılma")','}, h("img",{src:"./assets/nav/delivery.png",alt:"",draggable:false}),h("span",null,psAdminText("Çatdırılma","Teslimat","Delivery")))');
 // Put delivery after hall selection in DOM and visual order.
 const a='          jsxRuntimeExports.jsx(PsDeliveryStartButton, {}),\n';once(a,'');
 const start=s.indexOf('function PsOriginalTablesPage()');const end=s.indexOf('function ',start+30);let part=s.slice(start,end);
 const anchor='          }) })\n        ]';
 if(!part.includes(anchor))throw Error('floor areas anchor missing');
 part=part.replace(anchor,'          }) }),\n          jsxRuntimeExports.jsx(PsDeliveryStartButton, {})\n        ]');s=s.slice(0,start)+part+s.slice(end);
 fs.writeFileSync(file,s);
}
console.log('Touch sidebar and delivery ready');
