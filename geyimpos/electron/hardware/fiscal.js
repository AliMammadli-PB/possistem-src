'use strict';

/**
 * Fiscal provider interface + mock (no invented government endpoints).
 */
class MockFiscalProvider {
  constructor() {
    this.name = 'mock';
  }
  async healthCheck() {
    return { ok: true, provider: this.name };
  }
  async registerSale(request) {
    const fiscalReceiptId = `MOCK-F-${Date.now()}`;
    return {
      status: 'success',
      fiscalReceiptId,
      qrData: `mock://fiscal/${fiscalReceiptId}`,
      response: { echo: request, provider: this.name },
    };
  }
  async registerRefund(request) {
    return this.registerSale({ ...request, kind: 'refund' });
  }
  async getReceiptStatus(fiscalReceiptId) {
    return { status: 'success', fiscalReceiptId };
  }
  async closeShift() {
    return { ok: true };
  }
}

module.exports = { MockFiscalProvider };
