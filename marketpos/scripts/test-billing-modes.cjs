const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('the actual desktop handoff validates the selected mode and carries only a trusted payment URL',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../electron/main.cjs'),'utf8'),start=source.indexOf("  ipcMain.handle('market:billing:open'"),end=source.indexOf("  ipcMain.handle('market:staff:list'",start);
 assert.ok(start>0&&end>start);let handler,calls=0,opened=[];
 vm.runInNewContext(source.slice(start,end),{ipcMain:{handle(_channel,fn){handler=fn;}},assertTrusted(event){if(!event.trusted)throw Error('Untrusted');},loadSecureState:()=>({tenant:{token:'fixture-token'}}),controlApi:p=>'https://fixture.invalid'+p,fetch:async(_url,options)=>{calls++;assert.equal(JSON.parse(options.body).product,'market');return {ok:true,json:async()=>({url:'https://possistem.az/odenis/davam?handoff=fixture'})};},AbortSignal,URL,billingPolicy:require('../electron/billing.cjs'),shell:{openExternal:async url=>opened.push(url)},Error});
 await handler({trusted:true},'automatic');await handler({trusted:true},'manual');assert.equal(new URL(opened[0]).searchParams.get('mode'),'automatic');assert.equal(new URL(opened[1]).searchParams.get('mode'),'manual');assert.equal(new URL(opened[0]).searchParams.get('handoff'),'fixture');
 await assert.rejects(()=>handler({trusted:true},'free'));await assert.rejects(()=>handler({trusted:false},'manual'));assert.equal(calls,2);
});
test('both payment choices have exactly the same strict paid-period boundary',()=>{
 const policy=require('../electron/billing.cjs'),now=Date.now();
 for(const mode of ['manual','automatic']){assert.equal(policy.paid({mode:'active',validUntil:now,paymentMode:mode},now),false);assert.equal(policy.paid({mode:'active',validUntil:now+1,paymentMode:mode},now),true);assert.equal(policy.canInvoke({mode:'expired',validUntil:now-1,paymentMode:mode},'sale.complete',{}),false);}
});
