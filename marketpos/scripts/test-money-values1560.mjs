/** Money consistency: real branch merger, scale wire protocol, and a loopback scale. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {build} from '../../restoranpos/node_modules/esbuild/lib/main.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'market-money-'));
const require=createRequire(import.meta.url);
try {
 await build({stdin:{contents:"export {mergeBranchStock,roundStockMilli,latestPerBranch} from './src/BranchStockView.tsx'",resolveDir:root},bundle:true,platform:'node',format:'cjs',outfile:path.join(dir,'stock.cjs'),loader:{'.css':'empty'},logLevel:'silent'});
 const {mergeBranchStock,roundStockMilli,latestPerBranch}=require(path.join(dir,'stock.cjs'));
 const snapshot=(branchId,lines,updatedAt=1)=>({branchId,deviceId:branchId,branchName:branchId,updatedAt,online:false,warehouses:[{id:'w1',name:'1'},{id:'w2',name:'2'}],lines});
 const line=(qtyMilli,warehouseId='w1',salePriceMinor=800,costMinor=347)=>({goodId:'g',name:'Tərəzi malı',barcode:'4760000000017',unit:'kq',qtyMilli,warehouseId,salePriceMinor,costMinor});
 let r=mergeBranchStock([snapshot('Gənclik',[line(310)])])[0];
 assert.equal(r.saleValueMinor,248);assert.equal(r.costValueMinor,108);assert.equal(r.saleValueMinor-r.costValueMinor,140);
 r=mergeBranchStock([snapshot('Gənclik',[line(5,'w1',100,100),line(5,'w2',100,100)])])[0];
 assert.equal(r.saleValueMinor,1,'Round after combining this product across warehouses, not 1+1');
 r=mergeBranchStock([snapshot('Gənclik',[line(-5,'w1',100,100)])])[0];assert.equal(r.saleValueMinor,-1,'Negative half-cent rounds symmetrically');
 r=mergeBranchStock([snapshot('Gənclik',[line(1000)]),snapshot('Nərimanov',[line(2000,'w1',900,400)])])[0];
 assert.equal(r.qtyMilli,3000);assert.equal(r.costValueMinor,1147);assert.equal(r.saleValueMinor,2600,'Keep each branch’s own prices');
 const copies=latestPerBranch([snapshot('b',[line(1000)],1),snapshot('b',[line(310)],2)]);
 assert.equal(copies.length,1);assert.equal(mergeBranchStock(copies)[0].saleValueMinor,248,'Do not sum stale copies');
 assert.equal(roundStockMilli(499n),0);assert.equal(roundStockMilli(500n),1);assert.equal(roundStockMilli(-500n),-1);
 assert.throws(()=>roundStockMilli(BigInt(Number.MAX_SAFE_INTEGER)*1000n+1000n));
 const {refundQtyMilli,receiptDocument}=require('../electron/ops-engine.cjs');
 assert.equal(refundQtyMilli({saleItemId:3,productId:'p',qty:1},[{saleItemId:3,productId:'p',qty:1,qtyMilli:5,unitPriceMinor:100,lineTotalMinor:1}]),5,'Rounded money must not double the original 5 gram weight');
 assert.equal(refundQtyMilli({saleItemId:1,productId:'p',qty:1},[{saleItemId:1,productId:'p',qty:1,unitPriceMinor:800,lineTotalMinor:248}]),310,'Restore 310 grams, not one kilogram');
 assert.equal(refundQtyMilli({saleItemId:2,productId:'p',qty:1},[{saleItemId:1,productId:'p',qty:1,unitPriceMinor:800,lineTotalMinor:248},{saleItemId:2,productId:'p',qty:1,unitPriceMinor:800,lineTotalMinor:400}]),500,'Duplicate products keep their original sale-item weight');
 const doc=receiptDocument({receiptNo:'M-K1-261022-0042',items:[],totalMinor:0});assert.equal(doc.returnLookupCode,'0042');assert.equal(doc.receiptNumber,'M-K1-261022-0042');
 const {pluLine,scaleLines,sendLines,PORT}=require('../electron/scale-lan.cjs');
 const command=pluLine({plu:1,name:'Pomidor',priceMinor:800},'20');
 assert.equal(command.slice(15,21),'000800','8.00 AZN must remain 800 minor units on the wire');
 for(const priceMinor of [-1,1.5,NaN,Infinity,1000000])assert.throws(()=>pluLine({plu:1,name:'Bad',priceMinor},'20'));
 const selected=scaleLines([{weighted:1,plu:1,name:'Good',salePriceMinor:800},{weighted:1,plu:2,name:'Bad',salePriceMinor:1000000},{weighted:0,plu:3,name:'Piece',salePriceMinor:500}],'20');
 assert.equal(selected.lines.length,1);assert.equal(selected.skipped.length,1);assert.match(selected.skipped[0],/9999.99/);
 let received='';const server=net.createServer(socket=>{let frame='';socket.on('data',chunk=>{frame+=chunk.toString('latin1');if(frame.endsWith('\r\n\x03')){received=frame;socket.write('0v0001a0');}});});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(PORT,'127.0.0.1',resolve)});
 try{const result=await sendLines('127.0.0.1',[command],{timeoutMs:1000,settleMs:20});assert.equal(result.accepted,1);assert.equal(received,command+'\r\n\x03');}finally{await new Promise(resolve=>server.close(resolve))}
 console.log('PASS: signed/fractional branch values, warehouse/branch aggregation, newest snapshot, safe bounds, exact 800-qəpik wire price, invalid-price rejection, complete TCP framing/ack. No physical scale used.');
}finally{await fs.rm(dir,{recursive:true,force:true});}
