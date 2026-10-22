'use strict';
const check=r=>{if(!r?.success)throw Error(r?.error?.message||'Müştəri qaiməsi alınmadı');return r.data;};
async function customerAction({action,payload,staff,can,core,ops}){
 const read=()=>core.invoke('customer.history',{customerId:payload.customerId,role:staff.role,actorId:staff.id});
 if(action==='market.sale.correct'){
  if(!await can(payload.cancel?'DOCS_DELETE':'DOCS_EDIT')||!await can('SALE_REFUND'))throw Error('Satış qaiməsini dəyişməyə icazəniz yoxdur');
  const sale=check(await core.invoke('sale.get',{id:payload.saleId,role:staff.role,actorId:staff.id}));
  if(staff.role!=='manager'&&staff.registerIds?.length&&!staff.registerIds.includes(sale.registerId))throw Error('Bu satış kassasına icazəniz yoxdur');
  if(staff.role!=='manager'&&staff.objectId){const a=check(await ops.invoke('cashAccounts.list',{})).accounts.find(a=>a.terminalId==='market-'+sale.registerId);if(!a||a.objectId!==staff.objectId)throw Error('Bu obyektin satışına icazəniz yoxdur');}
  // Reconcile incoming payments BEFORE another operation derives customer balances.
  await ops.flushCatalog({timeoutMs:20000});
  const result=await core.invoke('sale.correct',{saleId:payload.saleId,cancel:Boolean(payload.cancel),reason:payload.reason,replacement:payload.replacement,idempotencyKey:payload.idempotencyKey,role:staff.role,actorId:staff.id},60000);
  if(result.success){ops.scheduleCatalog();try{await ops.flushCatalog({timeoutMs:20000})}catch{return {...result,syncWarning:true}}}
  return result;
 }
 if(!await can('DOCS_VIEW'))throw Error('Müştəri tarixçəsinə baxmağa icazəniz yoxdur');
 await ops.flushCatalog({timeoutMs:20000});
 const [market,ledger,accounts]=await Promise.all([read(),ops.invoke('customers.ledger',{customerId:payload.customerId}),ops.invoke('cashAccounts.list',{})]);
 const data=check(market),partner=check(ledger),cash=check(accounts);
 const events=data.events||[];
 for(const sale of data.sales){const account=cash.accounts.find(a=>a.terminalId==='market-'+sale.registerId);sale.objectName=account?.objectName||cash.objects.find(o=>o.id===account?.objectId)?.name||'';sale.cashierName=ops.staffProfiles?.().find(s=>s.id===sale.cashierId)?.name||sale.cashierId;
  for(const refund of sale.refunds||[])refund.creditMinor=-events.filter(e=>e.kind==='refund'&&e.ref_id===refund.refundId).reduce((n,e)=>n+Number(e.amount_minor||0),0);
 }
 const imported=new Set(events.map(e=>'market-'+e.id));
 const entries=(partner.entries||[]).filter(e=>!e.refType&&!imported.has(e.id));
 return {success:true,data:{...partner,entries,sales:data.sales},error:null};
}
module.exports={customerAction};
