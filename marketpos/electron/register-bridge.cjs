'use strict';

const checked = (result) => {
  if (!result?.success) throw new Error(result?.error?.message || 'Kassa əlaqəsi qurulmadı');
  return result.data;
};

/** Keep cash registers and warehouse till accounts linked by immutable identity. */
async function syncRegisters(engine) {
  const snapshot = checked(await engine.market.invoke('cash.bridgeSnapshot', { actorId: 'system' }, 60000));
  const listed = checked(await engine.invoke('cashAccounts.list', {}));
  const accounts = listed.accounts || [];
  const registers = snapshot.registers || [];
  const byId = new Map(registers.map(r => [r.id, r]));
  const lastNames = engine.settings().cashNames || {};
  const terminalOf = id => `market-${id}`;
  const accountByTerminal = new Map(accounts.filter(a => a.kind === 'till' && a.terminalId).map(a => [a.terminalId, a]));
  // A till created in the warehouse becomes a closed sale register. Bank and
  // treasury accounts are financial destinations, never physical sale registers.
  for (const account of accounts) {
    if (account.kind !== 'till' || account.terminalId) continue;
    const sameName = registers.filter(r => r.name === account.name && !accountByTerminal.has(terminalOf(r.id)) && !r.accountId);
    let register = sameName.length === 1 ? sameName[0] : null;
    if (!register) {
      const id = `ops-cash-${account.id}`;
      register = byId.get(id);
      if (!register) {
        register = { id, code: `A-${account.id}`, name: account.name, firstOpeningMinor: 0 };
        checked(await engine.market.invoke('cash.bridgeRegister', { ...register, actorId: 'system' }));
        registers.push(register); byId.set(id, register);
      }
    }
    register.accountId = account.id;
    accountByTerminal.set(terminalOf(register.id), account);
  }
  for (const register of registers) {
    const account = accountByTerminal.get(terminalOf(register.id));
    if (account && account.name !== register.name) {
      // First link uses the user's existing warehouse label. Afterwards detect
      // which side changed since the last successful reconciliation.
      const marketChanged = lastNames[register.id] === account.name;
      if (!marketChanged) {
        register.name = account.name;
        checked(await engine.market.invoke('cash.bridgeRegister', { id: register.id, name: register.name, actorId: 'system' }));
      }
    }
  }
  const movementKey = JSON.stringify([snapshot.movements || [], accounts.map(a => [a.id, a.terminalId, a.createdAt])]);
  const movements = movementKey === engine.cashMovementKey ? [] : snapshot.movements || [];
  // An unused installation has no physical tills or ledger to reconcile.
  if (registers.length || movements.length) checked(await engine.invoke('cashAccounts.syncMarket', { registers, movements }, { timeoutMs: 60000 }));
  engine.cashMovementKey = movementKey;
  engine.cashCurrentRegisterId = snapshot.defaultRegisterId || null;
  engine.registers.clear();
  for (const r of registers) engine.registers.set(String(r.id), String(r.name || r.code || r.id));
  await engine.syncOwnerObject?.();
  const cashNames = Object.fromEntries(registers.map(r => [r.id, r.name]));
  if (JSON.stringify(lastNames) !== JSON.stringify(cashNames)) engine.saveSettings({ cashNames });
}

/** Apply the final warehouse ledger after pending sales/returns have been booked. */
async function syncWarehouseLedger(engine) {
  if (engine.registers?.size === 0) return;
  const result = checked(await engine.invoke('cashAccounts.syncMarket', { registers: [], movements: [] }, { timeoutMs: 60000 }));
  const movements = result.movements || [], balances = result.balances || [];
  const key = JSON.stringify([movements, balances]);
  if (key !== engine.cashWarehouseKey && (movements.length || balances.length)) {
    checked(await engine.market.invoke('cash.bridgeWarehouseMoves', { movements, balances, actorId: 'system' }, 60000));
  }
  engine.cashWarehouseKey = key;
}

/** Allocate returns by the original tenders; cumulative rounding preserves cents. */
function refundTenders(money, amount, refundedBefore = 0, paidTotal = 0) {
  const total = Math.max(paidTotal, money.cash + money.card + money.credit);
  if (total <= 0) return { cashMinor: 0, cardMinor: 0, creditMinor: 0 };
  const allocation = value => {
    const capped = Math.max(0, Math.min(total, value));
    const cash = Math.round(capped * money.cash / total);
    const nonCash = capped - cash;
    const card = total - money.cash > 0 ? Math.round(nonCash * money.card / (total - money.cash)) : 0;
    const credit = total - money.cash - money.card > 0 ? Math.round((nonCash - card) * money.credit / (total - money.cash - money.card)) : 0;
    return { cash, card, credit };
  };
  const before = allocation(refundedBefore), after = allocation(refundedBefore + amount);
  return { cashMinor: after.cash - before.cash, cardMinor: after.card - before.card, creditMinor: after.credit - before.credit };
}

module.exports = { syncRegisters, syncWarehouseLedger, refundTenders };
