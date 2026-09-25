import { describe, expect, it } from 'vitest';

import {
  bucketLabel,
  bucketLabelWithDate,
  dayRange,
  describeRange,
  fillRangeHours,
  hourKeys,
  isWholeDay,
  rangeFor,
  toDateInput,
  trailingDays,
  type PeriodBucket,
} from '../../apps/desktop/src/renderer/lib/period';

/**
 * These turn "08:00 to 09:00" into the window the core is asked about, so an
 * off-by-one here is money quietly attributed to the wrong hour — the kind of
 * mistake nobody notices until a shift handover does not add up.
 *
 * Everything is local time on purpose: the question is about the clock on the
 * wall, and the core buckets in local time to match.
 */
describe('rangeFor', () => {
  it('covers the hour asked for, and stops before the next one starts', () => {
    const { from, to } = rangeFor('2026-08-07', '08:00', '09:00');
    const start = new Date(from);
    const end = new Date(to);

    expect(start.getHours()).toBe(8);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);
    // Half-open: 08:59:59.999, so a payment at exactly 09:00 belongs to the
    // next hour and can never be counted twice.
    expect(end.getHours()).toBe(8);
    expect(end.getMinutes()).toBe(59);
    expect(to - from).toBe(3_600_000 - 1);
  });

  it('rolls an end earlier than the start into the next day', () => {
    // A bar asking for "22:00 to 02:00" means one night, not minus four hours.
    const { from, to } = rangeFor('2026-08-07', '22:00', '02:00');
    expect(to).toBeGreaterThan(from);
    expect(to - from).toBe(4 * 3_600_000 - 1);
    expect(new Date(from).getDate()).toBe(7);
    expect(new Date(to).getDate()).toBe(8);
  });

  it('treats an end equal to the start as a full day, not an empty range', () => {
    const { from, to } = rangeFor('2026-08-07', '12:00', '12:00');
    expect(to - from).toBe(24 * 3_600_000 - 1);
  });
});

describe('dayRange', () => {
  it('runs from local midnight to the last millisecond of the day', () => {
    const { from, to } = dayRange('2026-08-07');
    const start = new Date(from);
    expect(start.getHours()).toBe(0);
    expect(start.getDate()).toBe(7);
    expect(new Date(to).getDate()).toBe(7);
    expect(new Date(to).getHours()).toBe(23);
    expect(to - from).toBe(24 * 3_600_000 - 1);
  });

  it('is built from date parts, not Date.parse', () => {
    // `new Date('2026-08-07')` is UTC midnight, which is the 6th in any zone
    // west of Greenwich — a whole day of takings attributed to the wrong date.
    expect(new Date(dayRange('2026-08-07').from).getDate()).toBe(7);
  });
});

describe('trailingDays', () => {
  it('ends on the chosen day and reaches back the full count', () => {
    const { from, to } = trailingDays('2026-08-07', 14);
    expect(new Date(to).getDate()).toBe(7);
    // 7 August minus 13 days = 25 July.
    expect(new Date(from).getDate()).toBe(25);
    expect(new Date(from).getMonth()).toBe(6);
    expect(new Date(from).getHours()).toBe(0);
  });
});

describe('hourKeys', () => {
  it('covers a calendar day as 24 keys', () => {
    const { from, to } = dayRange('2026-08-07');
    const keys = hourKeys(from, to);
    expect(keys).toHaveLength(24);
    expect(keys[0]).toBe('2026-08-07 00');
    expect(keys[23]).toBe('2026-08-07 23');
  });

  it('carries on into the next date when the window passes midnight', () => {
    // 12:00 to 04:00 is sixteen hours over two dates. Deriving the keys from a
    // single date, as the old day-only filler did, dropped the hours after
    // midnight — the busiest ones for a bar.
    const { from, to } = rangeFor('2026-08-05', '12:00', '04:00');
    const keys = hourKeys(from, to);
    expect(keys).toHaveLength(16);
    expect(keys[0]).toBe('2026-08-05 12');
    expect(keys[11]).toBe('2026-08-05 23');
    expect(keys[12]).toBe('2026-08-06 00');
    expect(keys[15]).toBe('2026-08-06 03');
  });

  it('gives a sub-hour window the one hour it falls in', () => {
    const { from, to } = rangeFor('2026-08-07', '10:15', '10:45');
    expect(hourKeys(from, to)).toEqual(['2026-08-07 10']);
  });
});

describe('fillRangeHours', () => {
  it('gives every hour a row so a quiet spell is zero, not a gap', () => {
    const supplied: PeriodBucket[] = [
      {
        bucket: '2026-08-07 14',
        paymentCount: 2,
        totalMinor: 4500,
        cashMinor: 4500,
        cardMinor: 0,
        orderCount: 2,
      },
    ];
    const { from, to } = dayRange('2026-08-07');
    const filled = fillRangeHours(from, to, supplied);

    expect(filled).toHaveLength(24);
    expect(filled[14]?.totalMinor).toBe(4500);
    expect(filled[3]?.totalMinor).toBe(0);
    expect(filled[0]?.bucket).toBe('2026-08-07 00');
    expect(filled[23]?.bucket).toBe('2026-08-07 23');
  });

  it('keeps the takings from after midnight in an overnight window', () => {
    const supplied: PeriodBucket[] = [
      {
        bucket: '2026-08-06 01',
        paymentCount: 1,
        totalMinor: 9900,
        cashMinor: 0,
        cardMinor: 9900,
        orderCount: 1,
      },
    ];
    const { from, to } = rangeFor('2026-08-05', '12:00', '04:00');
    const filled = fillRangeHours(from, to, supplied);

    expect(filled).toHaveLength(16);
    expect(filled.find((b) => b.bucket === '2026-08-06 01')?.totalMinor).toBe(9900);
    expect(filled.reduce((sum, b) => sum + b.totalMinor, 0)).toBe(9900);
  });
});

describe('isWholeDay', () => {
  it('is true only for the midnight-to-midnight default', () => {
    expect(isWholeDay('00:00', '00:00')).toBe(true);
    expect(isWholeDay('12:00', '12:00')).toBe(false);
    expect(isWholeDay('10:00', '12:00')).toBe(false);
  });
});

describe('describeRange', () => {
  it('names one date when the window stays inside it', () => {
    const { from, to } = rangeFor('2026-08-05', '10:00', '12:00');
    expect(describeRange(from, to)).toBe('05.08.2026 10:00 → 12:00');
  });

  it('names both dates when the window passes midnight', () => {
    const { from, to } = rangeFor('2026-08-05', '12:00', '04:00');
    expect(describeRange(from, to)).toBe('05.08.2026 12:00 → 06.08.2026 04:00');
  });
});

describe('bucketLabel', () => {
  it('reads as a clock for hours and a date for days', () => {
    expect(bucketLabel('2026-08-07 14')).toBe('14:00');
    expect(bucketLabel('2026-08-07 00')).toBe('00:00');
    expect(bucketLabel('2026-08-07')).toBe('07.08');
  });

  it('adds the date when two 01:00 rows would otherwise look identical', () => {
    expect(bucketLabelWithDate('2026-08-06 01')).toBe('06.08 01:00');
    expect(bucketLabelWithDate('2026-08-07')).toBe('07.08');
  });
});

describe('toDateInput', () => {
  it('pads so the value is a valid date input and matches the day buckets', () => {
    expect(toDateInput(new Date(2026, 7, 7))).toBe('2026-08-07');
    expect(toDateInput(new Date(2026, 0, 1))).toBe('2026-01-01');
  });
});
