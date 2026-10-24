import test from 'node:test';
import assert from 'node:assert/strict';
import {hostedTestPayment} from './hosted-test-payment.js';

test('hosted test invoice accepts only the exact Epoint HTTPS invoice route',()=>{
 const url='https://epoint.az/az/inv/p/Fixture123';
 assert.deepEqual(hostedTestPayment(url),{url,amountMinor:100,currency:'AZN',verification:'manual'});
 for(const raw of ['', 'bad', 'http://epoint.az/az/inv/p/Fixture123','https://epoint.az.evil.example/az/inv/p/Fixture123','https://attacker@epoint.az/az/inv/p/Fixture123','https://epoint.az:8443/az/inv/p/Fixture123','https://epoint.az/az/inv/p/Fixture123?amount=2','https://epoint.az/az/inv/p/Fixture123#paid','https://epoint.az/az/profile','https://epoint.az/az/inv/p/Fixture123/next'])assert.equal(hostedTestPayment(raw),null,raw);
});
