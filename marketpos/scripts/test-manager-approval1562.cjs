'use strict';
const assert=require('node:assert/strict');
const {approveOperation}=require('../electron/operation-approval.cjs');
const {newPinCredential,createAttemptLimiter}=require('../electron/staff-auth.cjs');
(async()=>{
 const staff=[{id:'m',role:'manager',active:true,...newPinCredential('6842')},{id:'m8',role:'manager',active:true,...newPinCredential('68426842')},{id:'c',role:'cashier',active:true,...newPinCredential('7258')},{id:'off',role:'manager',active:false,...newPinCredential('9286')}];
 const audits=[];
 const args={staff,superAdmin:{},superIdentity:{id:'signed-admin',role:'manager'},verifySuperPin:(_,p)=>p==='6942873105',limiter:createAttemptLimiter({max:20}),record:async a=>{audits.push(a.id);return{success:true}}};
 for(const [pin,id]of [['6842','m'],['68426842','m8'],['6942873105','signed-admin']]){const r=await approveOperation({...args,pin});assert.equal(r.success,true);assert.equal(r.approver.id,id);}
 for(const pin of ['','7258','9286','wrong','123456789'])assert.equal((await approveOperation({...args,pin})).success,false);
 assert.deepEqual(audits,['m','m8','signed-admin'],'Refused PINs never approve or write successful audit');
 assert.equal((await approveOperation({...args,pin:'6842',superOnly:true})).success,false,'A manager cannot edit central permissions');
 assert.equal((await approveOperation({...args,pin:'6942873105',superOnly:true})).success,true);
 assert.equal((await approveOperation({...args,pin:'6842',record:async()=>({success:false})})).error.code,'E_APPROVAL_AUDIT','Audit failure stops the operation');
 const limiter=createAttemptLimiter({max:1});await approveOperation({...args,pin:'bad',limiter});await assert.rejects(()=>approveOperation({...args,pin:'6842',limiter}),/gözləyin/);
 console.log('PASS manager approval: active 4/8-digit manager, signed 10-digit admin, wrong/inactive/cashier rejection, policy isolation, audit failure, throttling.');
})().catch(e=>{console.error(e);process.exitCode=1});
