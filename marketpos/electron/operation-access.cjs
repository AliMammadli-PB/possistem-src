'use strict';

// The section grants are independent from document create/edit/delete grants.
const SECTION_KEYS = ['GOODS','STOCK','TRANSFERS','PURCHASES','STOCKTAKE','CATEGORIES','PARTNERS','SALES','CASH','EXPENSES','SALARY','DOCUMENTS','PROFIT','EXPORT','USERS'].map(k => 'OPS_' + k);
function catalogueKeys(response) {
  if (!response?.success) throw new Error('Səlahiyyət kataloqu yüklənmədi');
  return [...new Set(Object.values(response.data?.groups || {}).flatMap(rows => Array.isArray(rows) ? rows.map(row => String(row.permission || '')).filter(Boolean) : []))];
}
function isDestructive(method, payload = {}) {
  if (['cart.approve','sale.removeItem','sale.voidLine','sale.discardDraft','sale.setQuantity'].includes(method) || /^(return\.(create|partial)|inventory\.waste)$/.test(method)) return true;
  if (method === 'business.call') {
    const action = String(payload.action || '');
    return action === 'correct' && payload.cancel === true || action === 'market.sale.correct' && payload.cancel === true || /\.(delete|cancel|recall|revoke)$/.test(action);
  }
  return /\.(delete|deleteReturn|deactivate|cancel|cancelHeld|removeCost|writeOff)$/.test(method)
    || method === 'sale.correct' && payload.cancel === true
    || payload.active === false || payload.product?.active === false || payload.ingredient?.active === false
    || /^(cancelled|canceled|void)$/.test(String(payload.status || ''));
}
function operationRights(method, payload = {}) {
  const action = String(payload.action || '');
  if (method === 'business.call') {
    if (action.startsWith('transfer.')) return [['OPS_TRANSFERS'], /\.(list|get|targets)$/.test(action) ? [] : ['TRANSFER_STOCK']];
    if (action.startsWith('waste.')) return [['OPS_STOCK'], /\.(list|get)$/.test(action) ? [] : ['STOCK_ADJUSTMENT','EDIT_STOCK']];
    if (['documents','document.get'].includes(action)) return [['OPS_DOCUMENTS','OPS_PARTNERS','OPS_SALARY','OPS_EXPENSES','OPS_PROFIT','OPS_PURCHASES','OPS_SALES'], ['DOCS_VIEW']];
    if (action === 'correct') return [['OPS_DOCUMENTS','OPS_PARTNERS','OPS_SALARY','OPS_EXPENSES','OPS_PROFIT'], [payload.cancel ? 'DOCS_DELETE':'DOCS_EDIT']];
    if (action.startsWith('market.')) return [['OPS_PARTNERS','OPS_SALES'], [action.endsWith('.history') ? 'DOCS_VIEW' : payload.cancel ? 'DOCS_DELETE' : 'DOCS_EDIT']];
    if (action.startsWith('staff.')) return [['OPS_USERS'], ['MANAGE_USERS']];
    return [];
  }
  const [group, op] = method.split('.');
  const read = /^(list|get|levels|movements|ledger|moves|returns|lowStock|valuation|expiry|suppliers|stockLoss)$/.test(op);
  const views = {
    goods:['OPS_GOODS','OPS_STOCK','OPS_PURCHASES','OPS_TRANSFERS','OPS_STOCKTAKE','OPS_SALES'],
    ingredients:['OPS_GOODS','OPS_STOCK','OPS_PURCHASES','OPS_TRANSFERS','OPS_STOCKTAKE'],
    categories:['OPS_CATEGORIES','OPS_GOODS','OPS_PURCHASES'],
    inventory:['OPS_STOCK','OPS_GOODS','OPS_STOCKTAKE'],
    warehouses:SECTION_KEYS, locations:SECTION_KEYS,
    purchases:['OPS_PURCHASES'], suppliers:['OPS_PARTNERS','OPS_PURCHASES'],
    customers:['OPS_PARTNERS','OPS_DOCUMENTS','OPS_SALES'],
    sales:['OPS_SALES','OPS_PARTNERS'], income:['OPS_PROFIT'],
    salary:['OPS_SALARY'], users:['OPS_USERS','OPS_SALARY'],
    cash:['OPS_EXPENSES','OPS_CASH'], cashAccounts:['OPS_CASH','OPS_EXPENSES','OPS_SALARY','OPS_PARTNERS','OPS_PURCHASES','OPS_DOCUMENTS','OPS_PROFIT'],
    stocktake:['OPS_STOCKTAKE'], reports:['OPS_EXPORT','OPS_PROFIT','OPS_STOCK'],
  };
  if (!views[group]) return [];
  if (read) return [views[group]];
  const writeViews = {goods:['OPS_GOODS'],ingredients:['OPS_GOODS'],categories:['OPS_CATEGORIES'],inventory:['OPS_STOCK'],suppliers:['OPS_PARTNERS'],customers:['OPS_PARTNERS'],cashAccounts:['OPS_CASH']};
  const writes = {
    goods:['EDIT_PRODUCT','CREATE_PRODUCT','EDIT_PRICE'], ingredients:[payload.id ? 'EDIT_PRODUCT':'CREATE_PRODUCT'],
    categories:['EDIT_PRODUCT','CREATE_PRODUCT'], inventory:['STOCK_ADJUSTMENT','EDIT_STOCK'],
    purchases:[/^(delete|deleteReturn)$/.test(op) ? 'DOCS_DELETE' : /^(update|addCost|removeCost)$/.test(op) || op==='save'&&payload.id ? 'DOCS_EDIT' : /^(save|return)$/.test(op) ? 'DOCS_CREATE' : 'RECEIVE_PURCHASE'], suppliers:[op === 'pay' ? 'CASH_OUT':'RECEIVE_PURCHASE'],
    customers:[op === 'payDebt' ? 'DOCS_CREATE':'DOCS_EDIT','RECEIVE_PURCHASE'],
    sales:[op === 'delete' ? 'DOCS_DELETE':'DOCS_EDIT'], income:['DOCS_CREATE','DOCS_EDIT'],
    salary:['MANAGE_USERS'], users:['MANAGE_USERS'], cash:[payload.kind === 'in' ? 'CASH_IN':'CASH_OUT'],
    cashAccounts:['CASH_IN','CASH_OUT','SAFE_DROP'], stocktake:['STOCK_ADJUSTMENT'],
  };
  return [writeViews[group] || views[group], writes[group] || []];
}
async function allowsOperation(method, payload, can) {
  for (const anyOf of operationRights(method, payload)) {
    if (anyOf.length && !(await Promise.all(anyOf.map(can))).some(Boolean)) return false;
  }
  return true;
}
module.exports = { SECTION_KEYS, catalogueKeys, isDestructive, operationRights, allowsOperation };
