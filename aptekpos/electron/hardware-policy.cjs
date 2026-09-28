'use strict';

/**
 * Which payment-terminal and fiscal providers a till may use.
 *
 * The mock terminal approves every card payment and the mock fiscal provider
 * invents receipt numbers. That is fine on a developer machine and ruinous in a
 * shop, so a packaged build refuses both unless MARKET_POS_ALLOW_MOCK_HARDWARE=1
 * is set on purpose (demo stands, QA). Without an integrated provider a card
 * payment is recorded from the bank terminal's reference (manual mode), and
 * fiscal jobs stay queued until a real fiscal provider is configured.
 */
function mockHardwareAllowed({ isPackaged, env = process.env } = {}) {
  return !isPackaged || env.MARKET_POS_ALLOW_MOCK_HARDWARE === '1';
}

/** Returns 'mock_integrated' only when allowed, otherwise 'manual'. */
function resolveTerminalMode(requested, allowMock) {
  return requested === 'mock_integrated' && allowMock ? 'mock_integrated' : 'manual';
}

module.exports = { mockHardwareAllowed, resolveTerminalMode };
