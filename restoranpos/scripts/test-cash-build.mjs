import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {patchRegisterLinking} from '../market-ops/register-linking.mjs';
import {patchMarket1535} from '../market-ops/workflows1535.mjs';
import {transform} from 'esbuild';
const source=fs.readFileSync(new URL('../index-DAmHwBc4.js',import.meta.url),'utf8');
test('shared cash cards retain Market immutable register identity and shift action',async()=>{
 const linked=patchRegisterLinking(source),market=patchMarket1535(linked);
 assert.match(linked,/value: form\.terminalId, disabled: Boolean\(form\.id\) && String\(form\.terminalId \|\| ""\)\.startsWith\("market-"\)/);
 assert.match(market,/h\(PsCashAccountsGrid,\{onRegisterOpen:/);
 assert.match(market,/market:register-open/);
 assert.equal(patchRegisterLinking(linked),linked,'Register patch converges');
 assert.equal(patchMarket1535(market),market,'Workflow patch converges');
 await transform(market,{loader:'js',target:'es2022'});
});
