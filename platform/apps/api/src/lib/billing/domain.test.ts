import test from 'node:test';
import assert from 'node:assert/strict';
import { amount, minor, nextMonth, subscriptionState } from './domain.js';
import { Epoint, sign, verifyCallback, encryptCard, decryptCard, safeGatewayResponse, GatewayUncertain } from './epoint.js';

test('AZN is parsed exactly, including small decimals; invalid prices never round silently',()=>{
  assert.equal(minor('2.48'),248);assert.equal(minor('8.00'),800);assert.equal(amount(80),'0.80');
  for(const value of ['1.234','1e3',-1,'NaN',null,1000001])assert.throws(()=>minor(value));
});
test('calendar renewal preserves Jan 31 anchor, leap year and Baku local time',()=>{
  const start=new Date('2028-01-30T23:30:00Z'); // Jan 31 in Azerbaijan
  const feb=nextMonth(start,31),march=nextMonth(feb,31);
  assert.equal(feb.toISOString(),'2028-02-28T23:30:00.000Z');
  assert.equal(march.toISOString(),'2028-03-30T23:30:00.000Z');
  assert.equal(subscriptionState(true,'2026-10-24T10:00:00Z',Date.parse('2026-10-24T10:00:00Z')),'expired');
  assert.equal(subscriptionState(true,null),'awaiting_payment');
});
test('callback tampering and malformed inputs are rejected; only bank tokens are encrypted',()=>{
  const data=Buffer.from(JSON.stringify({order_id:'PAY-test',status:'success',amount:'10.00'})).toString('base64');
  assert.equal(verifyCallback(data,sign(data,'fixture-secret'),'fixture-secret').status,'success');
  assert.throws(()=>verifyCallback(data,sign(data,'wrong-secret'),'fixture-secret'));
  assert.throws(()=>verifyCallback(data+'A',sign(data,'fixture-secret'),'fixture-secret'));
  const key=Buffer.alloc(32,7),encrypted=encryptCard('fixture-card-token',key);
  assert(!encrypted.includes('fixture-card-token'));assert.equal(decryptCard(encrypted,key),'fixture-card-token');
  assert.throws(()=>decryptCard(encrypted,Buffer.alloc(32,8)));
  assert.deepEqual(safeGatewayResponse({status:'success',card_id:'never-log',pan:'never-log',cvv:'never-log',card_mask:'411111******1111'}),{status:'success',card_mask:'411111******1111'});
});
test('gateway form is UTF-8 signed and a network failure is uncertain, not declined',async()=>{
  const config={publicKey:'fixture-public',privateKey:'fixture-secret',tokenKey:Buffer.alloc(32),baseUrl:'https://epoint.az/api/1/',origin:'https://possistem.az',liveVerified:true};
  let sends=0;
  const gateway=new Epoint(config,async(url,init)=>{
    sends++;assert.equal(url,'https://epoint.az/api/1/request');
    const form=init!.body as URLSearchParams,data=form.get('data')!;
    assert.equal(form.get('signature'),sign(data,config.privateKey));
    assert.equal(JSON.parse(Buffer.from(data,'base64').toString()).description,'Müştəri ödənişi');
    return new Response(JSON.stringify({status:'success',redirect_url:'https://epoint.az/pay/fixture'}));
  });
  await gateway.call('request',{amount:'1.00',description:'Müştəri ödənişi'});assert.equal(sends,1);
  const broken=new Epoint(config,async()=>{throw new Error('network closed after send');});
  await assert.rejects(broken.call('execute-pay',{}),GatewayUncertain);
});
