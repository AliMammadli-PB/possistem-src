import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {QrDocument,QrCart,priceQrCart} from './qr-menu.js';
const doc=()=>QrDocument.parse({name:'Sınaq restoran',categories:[{id:'c',name:'Yemək'}],tables:[{id:'t',label:'Masa 1'}],items:[{id:'p',categoryId:'c',name:'Dönər',priceMinor:700,available:true,groups:[{id:'g',name:'Sous',min:1,max:1,options:[{id:'s',name:'Sous',priceDeltaMinor:50}]}]}]});
const cart=()=>QrCart.parse({requestId:randomUUID(),revision:1,lines:[{productId:'p',qty:2,modifiers:['s']}]});
test('QR cart prices come from the published catalogue and modifier choices',()=>{const r=priceQrCart(doc(),cart());assert.equal(r.subtotal,1500);assert.equal(r.lines[0]!.unitPriceMinor,700);});
test('required, foreign and duplicate modifiers are refused',()=>{for(const modifiers of [[],['foreign'],['s','s']])assert.throws(()=>priceQrCart(doc(),{...cart(),lines:[{...cart().lines[0]!,modifiers}]}));});
test('hidden and unavailable products cannot be ordered',()=>{for(const key of ['hidden','available'] as const){const d=doc();d.items[0]![key]=key==='hidden';assert.throws(()=>priceQrCart(d,cart()));}});
test('invalid quantity, duplicate product identifiers and unsafe image URLs are rejected',()=>{assert.equal(QrCart.safeParse({...cart(),lines:[{...cart().lines[0],qty:0}]}).success,false);const d=doc();d.items.push(d.items[0]!);assert.equal(QrDocument.safeParse(d).success,false);assert.equal(QrDocument.safeParse({...doc(),logo:'javascript:alert(1)'}).success,false);});
