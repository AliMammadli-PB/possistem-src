const {test}=require('node:test');const assert=require('node:assert/strict');const create=require('./runtime.cjs');
function fixture(){const calls=[],order={id:'external',tableId:'t1',lines:[],note:''};let coreCode='',ackLost=false;const runtime=create({isTerminal:()=>false,identity:async()=>({deviceId:'device',baseUrl:'https://example.invalid'}),owner:()=>({token:'tenant-token'}),native:async(method)=>{calls.push(method);if(method==='qr.access')return {success:true};if(coreCode)return {success:false,error:{code:coreCode,message:'Core failed'}};return {success:true,data:{orderId:'local',tableId:'t1'}};}});return {calls,runtime,core(code){coreCode=code},loseAck(){ackLost=true},fetch:async(url,opt)=>{const p=JSON.parse(opt.body);calls.push(p.action||'inbox');if(p.action==='claim')return {ok:true,json:async()=>({claimToken:'claim',order})};if(p.action==='complete'&&ackLost)throw Error('Disconnected');return {ok:true,json:async()=>({ok:true})};}};}
test('cashier approval imports locally before acknowledging cloud',async()=>{const f=fixture();const old=global.fetch;global.fetch=f.fetch;try{const r=await f.runtime('qr.decision',{action:'accept',id:'external'});assert.equal(r.success,true);assert.deepEqual(f.calls,['qr.access','claim','qr.accept','complete']);}finally{global.fetch=old}});
test('unknown native timeout keeps claim recoverable instead of allowing rejection',async()=>{const f=fixture();f.core('E_TIMEOUT');const old=global.fetch;global.fetch=f.fetch;try{assert.equal((await f.runtime('qr.decision',{action:'accept',id:'external'})).success,false);assert.ok(!f.calls.includes('release'));assert.ok(!f.calls.includes('complete'));}finally{global.fetch=old}});
test('definitive validation rollback releases claim for cashier correction',async()=>{const f=fixture();f.core('E_VALIDATION');const old=global.fetch;global.fetch=f.fetch;try{assert.equal((await f.runtime('qr.decision',{action:'accept',id:'external'})).success,false);assert.ok(f.calls.includes('release'));}finally{global.fetch=old}});
test('lost cloud acknowledgement explains recovery without submitting a second local order',async()=>{const f=fixture();f.loseAck();const old=global.fetch;global.fetch=f.fetch;try{const r=await f.runtime('qr.decision',{action:'accept',id:'external'});assert.equal(r.success,false);assert.match(r.error.message,/təkrarlanmayacaq/);assert.equal(f.calls.filter(x=>x==='qr.accept').length,1);assert.ok(!f.calls.includes('release'));}finally{global.fetch=old}});
test('refresh keeps published restaurant artwork while taking fresh POS product prices',async()=>{
 const old=global.fetch;
 const document={name:'Restoran',description:'Menyu',logo:'data:image/webp;base64,UklGRg==',cover:'https://example.invalid/cover.webp',accent:'green',layout:'cards',items:[{id:'p',image:'https://example.invalid/p.webp',description:'Sousla',hidden:true}]};
 global.fetch=async()=>({ok:true,json:async()=>({menu:{document},tables:[]})});
 const runtime=create({isTerminal:()=>false,identity:async()=>({deviceId:'device',baseUrl:'https://example.invalid'}),owner:()=>({token:'test'}),native:async method=>({success:true,data:method==='qr.catalog'?{name:'POS name',items:[{id:'p',priceMinor:900,image:'',description:''}]}:{}})});
 try{const result=await runtime('qr.config',{action:'get'});assert.equal(result.success,true);assert.equal(result.data.document.logo,document.logo);assert.equal(result.data.document.cover,document.cover);assert.equal(result.data.document.items[0].priceMinor,900);assert.equal(result.data.document.items[0].hidden,true);}finally{global.fetch=old}
});
test('a published menu follows the till by itself and keeps the owner\'s words, pictures and hidden dishes',async()=>{
 const old=global.fetch,posts=[];
 const item=(id,price,extra={})=>({id,categoryId:'c',name:'Dönər',nameTr:'',nameEn:'',description:'',image:'',priceMinor:price,available:true,groups:[],...extra});
 let saved={enabled:true,revision:4,document:{name:'Pizza Ev',description:'Ev menyusu',logo:'',cover:'',accent:'green',layout:'cards',categories:[{id:'c',name:'Yemək'}],tables:[{id:'t1',label:'Zal · 1'}],items:[item('old',700,{description:'Sahibin sözü',image:'https://example.invalid/d.webp',hidden:false}),item('tea',200,{hidden:true})]}};
 let catalog;
 global.fetch=async(url,init)=>{const body=JSON.parse(init.body);posts.push(body.action);if(body.action==='publish'){saved={...saved,revision:saved.revision+1,document:body.document};}return {ok:true,json:async()=>({menu:saved,tables:[]})};};
 const runtime=create({isTerminal:()=>false,identity:async()=>({deviceId:'device',baseUrl:'https://example.invalid'}),owner:()=>({token:'t'}),native:async()=>({success:true,data:{}})});
 const invoke=async m=>({success:true,data:JSON.parse(JSON.stringify(catalog))});
 try{
  // Same orderable menu: nothing is published, so guests mid-order keep their basket.
  catalog={name:'POS',categories:[{id:'c',name:'Yemək',nameTr:'',nameEn:''}],tables:[{id:'t1',label:'Zal · 1'}],items:[item('old',700),item('tea',200)]};
  assert.equal((await runtime.sync(invoke)).status,'current');assert.deepEqual(posts,['get']);
  // The dish was archived and made again: new id, new price. Published once, owner's choices kept.
  catalog.items=[item('new',750),item('tea',200)];
  assert.equal((await runtime.sync(invoke)).status,'published');assert.deepEqual(posts,['get','get','publish']);
  assert.deepEqual(saved.document.items.map(i=>[i.id,i.priceMinor]),[['new',750],['tea',200]]);
  assert.equal(saved.document.name,'Pizza Ev');assert.equal(saved.document.description,'Ev menyusu');assert.equal(saved.document.items[1].hidden,true);
  assert.equal((await runtime.sync(invoke)).status,'current');
  // Switched off by the owner: never switched back on by the sync.
  saved={...saved,enabled:false};assert.equal((await runtime.sync(invoke)).status,'off');
  assert.equal(posts.filter(p=>p==='publish').length,1);
 }finally{global.fetch=old;}
});
