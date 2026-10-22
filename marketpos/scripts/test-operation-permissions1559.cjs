'use strict';
const assert=require('node:assert/strict');
const {catalogueKeys,allowsOperation,isDestructive,SECTION_KEYS}=require('../electron/operation-access.cjs');
const {authorizeCorePayload}=require('../electron/core-payload.cjs');
(async()=>{
 // Exercise the native catalogue's real envelope: the old reader returned [].
 assert.deepEqual(catalogueKeys({success:true,data:{groups:{emeliyyat:[{permission:'OPS_PURCHASES',label:'Alışlar'}],anbar:[{permission:'DOCS_VIEW'}]}}}),['OPS_PURCHASES','DOCS_VIEW']);
 assert.throws(()=>catalogueKeys({success:false}));
 const can=keys=>async k=>keys.includes(k);
 assert.equal(await allowsOperation('purchases.list',{},can(['OPS_PURCHASES'])),true);
 assert.equal(await allowsOperation('purchases.save',{},can(['OPS_PURCHASES'])),false,'A view grant cannot receive goods');
 assert.equal(await allowsOperation('purchases.save',{},can(['OPS_PURCHASES','DOCS_CREATE'])),true);
 assert.equal(await allowsOperation('purchases.update',{id:'p'},can(['OPS_PURCHASES','DOCS_EDIT'])),true);
 assert.equal(await allowsOperation('purchases.receive',{},can(['OPS_PURCHASES','RECEIVE_PURCHASE'])),true);
 assert.equal(await allowsOperation('salary.list',{},can(['OPS_PURCHASES','MANAGE_USERS'])),false,'Unrelated employee rights do not open payroll');
 assert.equal(await allowsOperation('business.call',{action:'correct',cancel:true},can(['OPS_DOCUMENTS','DOCS_EDIT'])),false);
 assert.equal(await allowsOperation('business.call',{action:'correct',cancel:true},can(['OPS_DOCUMENTS','DOCS_DELETE'])),true);
 assert.equal(await allowsOperation('business.call',{action:'transfer.dispatch'},can(['OPS_TRANSFERS'])),false);
 assert.equal(await allowsOperation('business.call',{action:'transfer.dispatch'},can(['OPS_TRANSFERS','TRANSFER_STOCK'])),true);
 for(const [method,payload]of [['purchases.delete',{}],['ingredients.deactivate',{}],['customers.deactivate',{}],['cashAccounts.deactivate',{}],['business.call',{action:'correct',cancel:true}],['business.call',{action:'market.sale.correct',cancel:true}],['business.call',{action:'transfer.revoke'}],['cart.approve',{}],['sale.cancelHeld',{}],['return.partial',{}]])assert.equal(isDestructive(method,payload),true,method);
 for(const [method,payload]of [['purchases.list',{}],['business.call',{action:'correct',cancel:false}],['business.call',{action:'transfer.list'}],['cart.sync',{}]])assert.equal(isDestructive(method,payload),false,method);
 const payload=authorizeCorePayload({role:'manager',actorId:'possistem-admin',superAdmin:true,superAdminPin:'credential',superAdminApproved:true,_marketScope:{role:'manager'}},()=>({id:'ordinary',role:'cashier'}));
 assert.equal(payload.actorId,'ordinary');assert.equal(payload.role,'cashier');for(const key of ['superAdmin','superAdminPin','superAdminApproved','_marketScope'])assert.ok(!(key in payload));
 assert.equal(SECTION_KEYS.length,15);
 console.log('PASS 1.5.59: native catalogue envelope, independent section/action grants, payroll isolation, document/transfer denial, protected cancellation surfaces, forged identity stripping');
})().catch(e=>{console.error(e);process.exitCode=1});
