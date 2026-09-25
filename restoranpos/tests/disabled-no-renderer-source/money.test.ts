import { describe, expect, it } from 'vitest';

import {
  formatMoney,
  formatMoneyReceipt,
  parseMoneyInput,
} from '../../apps/desktop/src/renderer/lib/money';

describe('formatMoney', () => {
  it('defaults to Latin digits with the manat symbol', () => {
    expect(formatMoney(14500)).toBe('145.00 ₼');
    expect(formatMoney(150)).toBe('1.50 ₼');
    expect(formatMoney(-200)).toBe('−2.00 ₼');
  });

  it('supports code and none display modes', () => {
    expect(formatMoney(3200, { display: 'code' })).toBe('32.00 AZN');
    expect(formatMoney(3200, { display: 'none' })).toBe('32.00');
    expect(formatMoney(3200, { display: 'symbol' })).toBe('32.00 ₼');
  });
});

describe('parseMoneyInput', () => {
  it('reads both decimal separators the keypad can produce', () => {
    expect(parseMoneyInput('12.34')).toBe(1234);
    expect(parseMoneyInput('12,34')).toBe(1234);
    expect(parseMoneyInput(' 12,34 ₼ ')).toBe(1234);
  });

  it('keeps whole and fractional parts exact', () => {
    // Every one of these loses a qəpik through `Math.round(value * 100)`.
    expect(parseMoneyInput('8.29')).toBe(829);
    expect(parseMoneyInput('1.005')).toBe(101);
    expect(parseMoneyInput('1000000.07')).toBe(100000007);
  });

  it('accepts the shorthand forms a cashier types', () => {
    expect(parseMoneyInput('5')).toBe(500);
    expect(parseMoneyInput('5.')).toBe(500);
    expect(parseMoneyInput('.5')).toBe(50);
    expect(parseMoneyInput('5.5')).toBe(550);
  });

  it('rejects input that is not an amount', () => {
    expect(parseMoneyInput('')).toBeNull();
    expect(parseMoneyInput('   ')).toBeNull();
    expect(parseMoneyInput('-')).toBeNull();
    expect(parseMoneyInput('.')).toBeNull();
    expect(parseMoneyInput('1-2')).toBeNull();
    expect(parseMoneyInput('abc')).toBeNull();
  });

  it('carries a negative sign through for refunds', () => {
    expect(parseMoneyInput('-2,50')).toBe(-250);
  });
});

describe('formatMoneyReceipt', () => {
  it('matches the thermal printer money column', () => {
    expect(formatMoneyReceipt(0)).toBe('0.00 AZN');
    expect(formatMoneyReceipt(500)).toBe('5.00 AZN');
    expect(formatMoneyReceipt(3200)).toBe('32.00 AZN');
    expect(formatMoneyReceipt(15600)).toBe('156.00 AZN');
    expect(formatMoneyReceipt(20249)).toBe('202.49 AZN');
  });
});
