import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const bundle = fs.readFileSync(path.resolve(__dirname, '../../index-DAmHwBc4.js'), 'utf8');
function definition(name: string) {
  const start = bundle.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Missing ${name}`);
  const end = bundle.indexOf('\nfunction ', start + 1);
  return bundle.slice(start, end);
}
const parse = new Function(`${definition('psOpsTimestamp')}\nreturn psOpsTimestamp;`)();
const valid = new Function(`${definition('psStockInputValid')}\nreturn psStockInputValid;`)();
describe('inventory input and dates', () => {
  it('accepts decimal comma and rejects malformed, negative or non-finite quantities', () => {
    expect(valid('1,25')).toBe(true);
    expect(valid(' -2.5 ', { negative: true })).toBe(true);
    for (const value of ['-2', 'abc', 'NaN', 'Infinity', '1.2.3', '1,2,3', '', '0.0001']) expect(valid(value), value).toBe(false);
    expect(valid('', { empty: true })).toBe(true);
  });
  it('reads SQLite UTC timestamps and numeric epoch timestamps consistently', () => {
    const epoch = Date.parse('2026-09-21T03:18:57Z');
    expect(parse('2026-09-21 03:18:57')).toBe(epoch);
    expect(parse('2026-09-21T03:18:57Z')).toBe(epoch);
    expect(parse(epoch)).toBe(epoch);
    expect(parse(String(epoch))).toBe(epoch);
    expect(Number.isNaN(parse('bad date'))).toBe(true);
    expect(Number.isNaN(parse(null))).toBe(true);
  });
});
function actionHarness(reload = async () => {}) {
  const states: boolean[] = [], notifications: string[] = [];
  const reactExports = { useState: () => [false, (v:boolean) => states.push(v)], useCallback: (fn: unknown) => fn };
  const code = definition('useOpsAction').split('// ----------------------------------------------------------------- inventory')[0];
  const hook = new Function('reactExports', 'toast', 'psAdminText', `${code}\nreturn useOpsAction;`)(reactExports, (m:string)=>notifications.push(m), (az:string)=>az);
  return { run: hook(reload)[1], states, notifications };
}
describe('operations save lifecycle', () => {
  it('always unlocks a failed transport and keeps the form open', async () => {
    const h = actionHarness();
    expect(await h.run(Promise.reject(new Error('Disconnected')), 'saved')).toBeNull();
    expect(h.states).toEqual([true,false]);
    expect(h.notifications).toEqual(['Disconnected']);
  });
  it('keeps values after a rejected backend save', async () => {
    const h = actionHarness();
    expect(await h.run(Promise.resolve({success:false,error:{message:'Not allowed'}}))).toBeNull();
    expect(h.states.at(-1)).toBe(false);
  });
  it('treats a successful empty payload as success', async () => {
    const h = actionHarness();
    expect(await h.run(Promise.resolve({success:true,data:null}))).toBe(true);
  });
  it('does not misreport a completed write when refreshing fails', async () => {
    const h = actionHarness(async()=>{throw new Error('Refresh failed');});
    expect(await h.run(Promise.resolve({success:true,data:{id:'saved'}}))).toEqual({id:'saved'});
    expect(h.states).toEqual([true,false]);
    expect(h.notifications).toHaveLength(1);
  });
});
