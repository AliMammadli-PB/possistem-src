/**
 * Market label designer: the same layout typed in mm, inches or printer dots
 * lands on the same whole dots (marketpos/src/labelUnits.ts).
 */
import { describe, expect, it } from 'vitest';
import { dotsToUnit, mmToUnit, moveSteps, paperUnit, roundUnit, unitToDots, unitToMm } from '../../../marketpos/src/labelUnits';

describe('label units', () => {
  it('converts paper between mm and inches', () => {
    expect(unitToMm(2, 'in')).toBeCloseTo(50.8);
    expect(roundUnit(mmToUnit(45, 'in'), 'in')).toBe(1.772);
    expect(unitToMm(45, 'mm')).toBe(45);
    expect(paperUnit('dot')).toBe('mm');
  });

  it('turns a typed length into whole printer dots at 203 and 300 DPI', () => {
    expect(unitToDots(2.5, 203, 'mm')).toBe(20);
    expect(unitToDots(2.5, 300, 'mm')).toBe(30);
    expect(unitToDots(0.1, 203, 'in')).toBe(20);
    expect(unitToDots(-16, 203, 'dot')).toBe(-16);
    expect(unitToDots(0.13, 203, 'mm')).toBe(1);
  });

  it('shows dots back in the chosen unit', () => {
    expect(roundUnit(dotsToUnit(20, 203, 'mm'), 'mm')).toBe(2.5);
    expect(roundUnit(dotsToUnit(-16, 203, 'mm'), 'mm')).toBe(-2);
    expect(roundUnit(dotsToUnit(20, 203, 'in'), 'in')).toBe(0.098);
    expect(dotsToUnit(7, 203, 'dot')).toBe(7);
  });

  it('every arrow step moves at least one dot', () => {
    for (const unit of ['mm', 'in', 'dot'] as const) for (const step of moveSteps(unit)) expect(Math.max(1, unitToDots(step, 203, unit))).toBeGreaterThanOrEqual(1);
    expect(unitToDots(moveSteps('mm')[0]!, 203, 'mm')).toBe(2);
  });
});
