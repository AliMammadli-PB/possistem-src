import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createOnlineConversation} from './online.mjs';
import {advance,newDocument} from '../../platform/apps/api/src/lib/assistant/central-engine.mjs';
import {interpret} from './conversation.mjs';

function fixture({printers=['Xprinter USB'],receipt='Xprinter USB',status='completed'}={}){
 const rights=new Set(['printer.manage','receipt.print']);let writes=0,doc;
 const payloads=[],source={printers,receipt};
 const api={print:{printers:async()=>({success:true,data:structuredClone(source)}),enqueue:async p=>{writes++;payloads.push(p);return{success:true,data:{id:'job-test',status,printer:p.printer,lastError:status==='failed'?'Kağız yoxdur':''}};}}};
 const transport=async p=>{
  if(p.action==='create'){doc=newDocument({surface:'restaurant',tools:p.tools,permissions:p.permissions});return{success:true,data:{sessionId:randomUUID(),secret:'fixture'}};}
  const out=await advance(JSON.parse(JSON.stringify(doc)),p.action==='message'?{type:'message',requestId:p.requestId,text:p.text}:{type:'result',requestId:p.requestId,taskId:p.taskId,outcome:p.outcome},{revision:1,help:async()=>({id:'catalogue',body:'WRONG PRINTER CATALOGUE'})});doc=JSON.parse(JSON.stringify(out.document));return{success:true,data:out.result};
 };
 const chat=createOnlineConversation({api,has:p=>rights.has(p),transport});return{chat,api,source,rights,payloads,get writes(){return writes;}};
}
test('reported test commands route before printer sales catalogue',()=>{
 for(const q of ['printeri test et','printer modellerini istemedim kontrol et printerimden cek cixar'])assert.equal(interpret(q).intent,'printer_test');
 assert.notEqual(interpret('printer modelleri hansilardir').intent,'printer_test');
});
test('real central continuation asks approval and enqueues only one fixed test page',async()=>{
 const f=fixture();const r=await f.chat.send('printeri test et');assert.match(r.body,/1 sınaq çeki/);assert.equal(f.writes,0);
 assert.match((await f.chat.send('Təsdiq et')).body,/Kağızın çıxmasını yoxlayın/);assert.equal(f.writes,1);assert.equal(f.payloads[0].kind,'test_page');assert.equal(f.payloads[0].exactTarget,true);assert.ok(f.payloads[0].idempotencyKey);assert.equal(f.payloads[0].orderId,undefined);
 await f.chat.send('confirm');assert.equal(f.writes,1);
});
test('queue/error results do not pretend physical print was confirmed',async()=>{
 for(const status of ['queued','failed']){const f=fixture({status});await f.chat.send('printeri test et');const r=await f.chat.send('confirm');assert.match(r.body,status==='queued'?/Fiziki çap hələ təsdiqlənməyib/:/Kağız yoxdur/);assert.equal(f.writes,1);}
});
test('missing or virtual printer never causes catalogue fallback or test output',async()=>{
 const f=fixture({printers:['virtual','Microsoft Print to PDF'],receipt:'auto'});assert.match((await f.chat.send('printeri test et')).body,/Qoşulmuş printer tapılmadı/);await f.chat.send('confirm');assert.equal(f.writes,0);
});
test('multiple printers require a current choice; removed target, cancellation and revoked role block print',async()=>{
 const f=fixture({printers:['USB one','USB two'],receipt:'auto'});let r=await f.chat.send('printeri test et');assert.equal(r.choices.filter(c=>c.value.startsWith('printer:target:')).length,2);
 await f.chat.send('printer:target:forged');assert.equal(f.writes,0);await f.chat.send('printeri test et');await f.chat.send('printer:target:USB%20one');f.source.printers=['USB two'];await f.chat.send('confirm');assert.equal(f.writes,0);
 await f.chat.send('cancel');await f.chat.send('confirm');assert.equal(f.writes,0);
 await f.chat.send('printeri test et');f.rights.delete('printer.manage');assert.match((await f.chat.send('confirm')).body,/icazəsi/);assert.equal(f.writes,0);
});
