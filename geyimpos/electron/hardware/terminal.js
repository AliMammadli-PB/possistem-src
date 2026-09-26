'use strict';

/**
 * Bank terminal providers: manual (cashier enters ref) + mock integrated.
 */
class ManualTerminalProvider {
  constructor() {
    this.name = 'manual';
  }
  async connect() {
    return { ok: true };
  }
  async health() {
    return { ok: true, provider: this.name };
  }
  async startPayment({ amountMinor, reference }) {
    if (!reference) {
      return { status: 'pending_manual', amountMinor };
    }
    return { status: 'approved', amountMinor, reference, authCode: reference.slice(0, 8) };
  }
  async cancelPayment() {
    return { status: 'canceled' };
  }
  async refundPayment({ amountMinor, reference }) {
    return { status: 'approved', amountMinor, reference };
  }
  async getTransactionStatus(reference) {
    return { status: 'approved', reference };
  }
}

class MockTerminalProvider {
  constructor() {
    this.name = 'mock';
    this.failNext = false;
  }
  async connect() {
    return { ok: true };
  }
  async health() {
    return { ok: true, provider: this.name };
  }
  async startPayment({ amountMinor }) {
    if (this.failNext) {
      this.failNext = false;
      return { status: 'declined', amountMinor };
    }
    return {
      status: 'approved',
      amountMinor,
      reference: `MOCK-${Date.now()}`,
      authCode: 'AUTH01',
    };
  }
  async cancelPayment() {
    return { status: 'canceled' };
  }
  async refundPayment({ amountMinor }) {
    return { status: 'approved', amountMinor, reference: `MOCK-R-${Date.now()}` };
  }
  async getTransactionStatus(reference) {
    return { status: 'approved', reference };
  }
}

module.exports = { ManualTerminalProvider, MockTerminalProvider };
