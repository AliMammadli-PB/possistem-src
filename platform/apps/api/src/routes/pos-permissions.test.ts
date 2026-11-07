import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {allKeysFor, catalogueFor, clampToEntitlements} from './pos-permissions.js';

test('restaurant business permissions survive the device entitlement filter',()=>{
  const keys=['cash.accounts','salary.manage','sales.view','sales.edit','sales.delete','purchases.edit','purchases.delete'];
  assert.deepEqual(clampToEntitlements('restaurant',[{name:'manager',permissions:keys}],null)[0]!.permissions.filter(key=>keys.includes(key)),keys);
  const restricted=clampToEntitlements('restaurant',[{name:'cashier',permissions:keys}],['sales.view'])[0]!.permissions;
  assert.equal(restricted.includes('sales.view'),true);
  assert.equal(restricted.includes('cash.accounts'),false);
  assert.equal(restricted.includes('salary.manage'),false);
  assert.equal(allKeysFor('restaurant').includes('system.reset'),false);
  assert.equal(allKeysFor('market').includes('salary.manage'),false);
  assert.equal(new Set(allKeysFor('restaurant')).size,allKeysFor('restaurant').length);
});
test('all native business keys are available in the admin permission catalogue',()=>{
  const native=readFileSync(new URL('../../../../../restoranpos/native/core/src/database/Migrator.cpp',import.meta.url),'utf8');
  const keys=[...native.matchAll(/'perm-[^']+'\s*,\s*'([a-zA-Z][A-Za-z]+\.[A-Za-z.]+)'/g)].map(match=>match[1]!);
  const missing=[...new Set(keys)].filter(key=>key!=='system.reset'&&!allKeysFor('restaurant').includes(key));
  assert.deepEqual(missing,[]);
  assert.ok(catalogueFor('restaurant').every(group=>group.permissions.every(permission=>permission.label.trim().length>0)));
});
