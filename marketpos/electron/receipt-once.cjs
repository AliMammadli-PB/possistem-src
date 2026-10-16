'use strict';
/** Coalesce repeated automatic receipts; preserve in-flight jobs until settled. */
function createReceiptOnce(limit = 2000) {
  const jobs = new Map();
  return function receiptOnce(receipt, print) {
    const key = JSON.stringify([receipt.saleId || '', receipt.storeName || '', receipt.receiptNo || '', receipt.createdAt || '', receipt.registerId || '']);
    if (!receipt.saleId && !receipt.receiptNo) return Promise.reject(new Error('Receipt identity missing'));
    if (jobs.has(key)) return jobs.get(key).promise;
    const entry = { settled: false, promise: Promise.resolve().then(print) };
    jobs.set(key, entry);
    entry.promise.then(() => {
      entry.settled = true;
      for (const [oldKey, old] of jobs) {
        if (jobs.size <= limit) break;
        if (old.settled) jobs.delete(oldKey);
      }
    }, () => { jobs.delete(key); });
    return entry.promise;
  };
}
module.exports = { createReceiptOnce };
