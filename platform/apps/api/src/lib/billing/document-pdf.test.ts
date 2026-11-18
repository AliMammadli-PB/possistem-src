import test from 'node:test';
import assert from 'node:assert/strict';
import {billingDocumentPdf} from './document-pdf.js';
import type {BillingDocument} from './documents.js';

const fixture:BillingDocument={order:{id:'11111111-1111-4111-8111-111111111111',order_no:'AB-FIXTURE',kind:'subscription',product:'restaurant',status:'paid',amount_minor:5000,refunded_minor:0,currency:'AZN',created_at:'2026-11-07T12:24:26Z',paid_at:'2026-11-07T12:25:43Z',period_start:null,period_end:null,delivery_fee_minor:0,recipient_name:null,delivery_address:null,note:null,payment_mode:'automatic',terms_version:'v1'},items:[],invoice:{buyer:{name:'Fixture',email:'fixture@example.invalid',contactPerson:'Sınaq Ödəyici',phone:'',address:'',voen:'',snapshotAt:'2026-11-07T12:24:26Z',snapshotSource:'checkout'},seller:{name:'Fixture seller',address:'Bakı',voen:'1234567890',phone:''},sellerSource:'accepted_terms',payment:null,payments:[],consent:null,terms:null,events:[],dataSha256:'a'.repeat(64),generatedAt:'2026-11-18T12:00:00Z'}};
test('PDF footers stay on their existing pages, without adding blank overflow pages',async()=>{
 for(const [kind,limit]of [['invoice',2],['agreement',2],['evidence',5]]as const){
  const pdf=await billingDocumentPdf(fixture,kind);
  assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
  const count=[...pdf.toString('latin1').matchAll(/\/Type \/Page\b/g)].length;
  assert.ok(count>0&&count<=limit,`${kind}: unexpected ${count} pages`);
  assert.ok(!pdf.includes(Buffer.from('/JavaScript')));
 }
});
