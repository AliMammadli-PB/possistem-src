/**
 * Turning a date and two clock times into the millisecond window the core is
 * asked about.
 *
 * This lives in `shared/` rather than beside the dashboard because the same
 * question now arrives from two directions: an operator picking times on the
 * till's screen, and a WhatsApp message relayed to this till by the control
 * server. The relay carries the wall clock the owner typed — never a
 * timestamp — because the server's timezone is not necessarily the
 * restaurant's, and resolving the range there would shift every figure by the
 * offset between them.
 *
 * Everything below is local time on purpose: "how much did we take between
 * 10:00 and 12:00" is a question about the clock on the wall, and the core
 * buckets in local time to match.
 */

/** `2026-08-07` — the date input's format, and the key the day buckets use. */
export function toDateInput(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, '0');
  const day = String(at.getDate()).padStart(2, '0');
  return `${at.getFullYear()}-${month}-${day}`;
}

function parseDateInput(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  // Built from parts rather than Date.parse: `new Date('2026-08-07')` is parsed
  // as UTC midnight, which lands on the previous day west of Greenwich.
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

function parseTimeInput(value: string): { hour: number; minute: number } {
  const [hour, minute] = value.split(':').map(Number);
  return { hour: hour ?? 0, minute: minute ?? 0 };
}

/**
 * The half-open range `[from, to)` for a date and a start/end time.
 *
 * An end earlier than the start rolls into the next day: a bar asked for
 * "22:00 to 02:00" means one continuous night, not a negative four hours.
 */
export function rangeFor(date: string, start: string, end: string): { from: number; to: number } {
  const base = parseDateInput(date);
  const s = parseTimeInput(start);
  const e = parseTimeInput(end);

  const from = new Date(base);
  from.setHours(s.hour, s.minute, 0, 0);

  const to = new Date(base);
  to.setHours(e.hour, e.minute, 0, 0);
  if (to.getTime() <= from.getTime()) to.setDate(to.getDate() + 1);

  return { from: from.getTime(), to: to.getTime() - 1 };
}

/** Local midnight to one millisecond before the next — a whole calendar day. */
export function dayRange(date: string): { from: number; to: number } {
  const from = parseDateInput(date);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from: from.getTime(), to: to.getTime() - 1 };
}

/** The last `days` calendar days, ending with `date`. */
export function trailingDays(date: string, days: number): { from: number; to: number } {
  const end = dayRange(date);
  const from = new Date(end.from);
  from.setDate(from.getDate() - (days - 1));
  from.setHours(0, 0, 0, 0);
  return { from: from.getTime(), to: end.to };
}

/** True when the times describe a plain calendar day rather than a window. */
export function isWholeDay(start: string, end: string): boolean {
  return start === '00:00' && end === '00:00';
}

function hourKey(at: Date): string {
  return `${toDateInput(at)} ${String(at.getHours()).padStart(2, '0')}`;
}

/**
 * Every `YYYY-MM-DD HH` the range touches, in order.
 *
 * A window like 12:00 to 04:00 spans two dates, so the keys cannot be derived
 * from one date the way a calendar day's could. The cursor steps by calendar
 * hour rather than by 3 600 000 ms so a clock change would not duplicate or
 * skip an hour.
 */
export function hourKeys(from: number, to: number): string[] {
  const keys: string[] = [];
  const cursor = new Date(from);
  cursor.setMinutes(0, 0, 0);
  // A month of hours is more than any report needs; the cap is here so a
  // mistyped range cannot ask the renderer to build a million rows.
  const limit = 24 * 62;
  while (cursor.getTime() <= to && keys.length < limit) {
    keys.push(hourKey(cursor));
    cursor.setHours(cursor.getHours() + 1);
  }
  return keys;
}
