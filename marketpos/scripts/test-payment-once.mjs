import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{createReceiptOnce}=require('../electron/receipt-once.cjs');
let sends=0,release;const wait=new Promise(r=>release=r),once=createReceiptOnce(2),receipt={saleId:'sale-1',receiptNo:'M-K1-1',registerId:'K1'};
const print=async()=>{sends++;await wait;return{ok:true}};
const jobs=Array.from({length:5},()=>once(receipt,print));await Promise.resolve();assert.equal(sends,1);release();await Promise.all(jobs);await once(receipt,print);assert.equal(sends,1);
let failures=0;const failed={saleId:'sale-failed'};await assert.rejects(once(failed,async()=>{failures++;throw Error('offline')}));await once(failed,async()=>{failures++;return{ok:true}});assert.equal(failures,2,'A known failed print can be retried');
let unblock;const pending=new Promise(r=>unblock=r),small=createReceiptOnce(1);let pendingCount=0;
const a=small({saleId:'pending'},async()=>{pendingCount++;await pending});await small({saleId:'other'},async()=>({ok:true}));const b=small({saleId:'pending'},async()=>{pendingCount++});assert.equal(a,b);unblock();await a;assert.equal(pendingCount,1,'Eviction must not drop an in-flight physical print');
console.log('PASS receipt IPC: five simultaneous submissions, later duplicate, failed-print retry, bounded cache preserving in-flight jobs.');
