/**
 * Command recognition is the part of the bot a user hits first and hardest:
 * phone keyboards produce no Azerbaijani letters, random case and missing
 * spaces. These lock in what must keep working.
 *
 *   npx tsx --test src/lib/bot/bot.test.ts
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { fold, normalizeDate, parseCommand, parseMoney } from './parser.js';
import { money, since, summary } from './format.js';
import {
  alreadySeen,
  getLidMap,
  getPhoneForLid,
  identifySender,
  rememberLid,
  seedLidMap,
} from '../whatsapp.js';

test('report commands survive a phone keyboard', () => {
  for (const input of ['x hesabat', 'X HESABAT', 'xhesabat', 'X Hesabat', 'x rapor', 'X']) {
    assert.equal(parseCommand(input).kind, 'xReport', input);
  }
  for (const input of ['z hesabat', 'Z HESABAT', 'zhesabat', 'hesabat z', 'Z']) {
    assert.equal(parseCommand(input).kind, 'zReport', input);
  }
});

test('a leading slash is punctuation, not part of the command', () => {
  assert.equal(parseCommand('/x').kind, 'xReport');
  assert.equal(parseCommand('/X').kind, 'xReport');
  assert.equal(parseCommand('/x hesabat').kind, 'xReport');
  assert.equal(parseCommand('/z hesabat').kind, 'zReport');
  assert.equal(parseCommand('/masalar').kind, 'tables');
  assert.equal(parseCommand('/kömək').kind, 'help');
});

test('azerbaijani letters fold to their plain forms', () => {
  assert.equal(fold('MƏHSUL Çay'), 'mehsul cay');
  assert.equal(fold('Növbə'), 'novbe');
  assert.equal(parseCommand('MƏHSUL çay').kind, 'product');
  assert.equal(parseCommand('KÖMƏK').kind, 'help');
  assert.equal(parseCommand('ÇOX SATILAN').kind, 'top');
});

test('the summary command answers to what people actually type', () => {
  for (const input of ['umumi', 'ÜMUMİ', 'Ümumi', 'yekun', 'toplam', 'cəmi', 'hamısı']) {
    assert.equal(parseCommand(input).kind, 'summary', input);
  }
  // "ümumi satış" is the summary, not the sales breakdown.
  assert.equal(parseCommand('ümumi satış').kind, 'summary');
  assert.equal(parseCommand('satış').kind, 'sales');
});

test('the summary adds takings to what is still on the tables', () => {
  const text = summary(
    { business_date: '2026-08-06', cash_minor: 12000, card_minor: 34000, updated_at: new Date() } as never,
    [{ due_minor: 45200 } as never, { due_minor: 1000 } as never],
  );
  assert.match(text, /Nağd: \*120,00 AZN\*/);
  assert.match(text, /Kart: \*340,00 AZN\*/);
  assert.match(text, /Gözləyən: \*462,00 AZN\* \(2 masa\)/);
  // 120 + 340 + 462
  assert.match(text, /Gözlənilən yekun: 922,00 AZN/);
});

test('read commands map to their handlers', () => {
  assert.equal(parseCommand('masalar').kind, 'tables');
  assert.equal(parseCommand('satış').kind, 'sales');
  assert.equal(parseCommand('status').kind, 'status');
  assert.equal(parseCommand('növbə').kind, 'staff');
  assert.equal(parseCommand('son hesabat').kind, 'lastReport');
});

test('a table lookup keeps its argument', () => {
  const parsed = parseCommand('masa 5');
  assert.equal(parsed.kind, 'table');
  assert.equal(parsed.kind === 'table' && parsed.needle, '5');
  assert.equal(parsed.kind === 'table' && parsed.area, undefined);
});

test('a table lookup accepts hall/area after the number', () => {
  const parsed = parseCommand('masa 1 zal');
  assert.equal(parsed.kind, 'table');
  if (parsed.kind !== 'table') return;
  assert.equal(parsed.needle, '1');
  assert.equal(parsed.area, 'zal');

  const flipped = parseCommand('masa kabinet 2');
  assert.equal(flipped.kind, 'table');
  if (flipped.kind !== 'table') return;
  assert.equal(flipped.needle, '2');
  assert.equal(flipped.area, 'kabinet');
});

test('price changes carry the product and the amount', () => {
  const parsed = parseCommand('qiymet espresso 3.50');
  assert.equal(parsed.kind, 'price');
  if (parsed.kind !== 'price') return;
  assert.equal(parsed.needle, 'espresso');
  assert.equal(parsed.priceMinor, 350);

  const comma = parseCommand('QİYMƏT az çay 2,80');
  assert.equal(comma.kind, 'price');
  if (comma.kind !== 'price') return;
  assert.equal(comma.needle, 'az cay');
  assert.equal(comma.priceMinor, 280);
});

test('a price command with no amount is a lookup, not a change', () => {
  const parsed = parseCommand('qiymet espresso');
  assert.equal(parsed.kind, 'product');
});

test('sold-out toggles both ways', () => {
  const off = parseCommand('bitib espresso');
  assert.equal(off.kind, 'soldOut');
  assert.equal(off.kind === 'soldOut' && off.soldOut, true);

  const on = parseCommand('var espresso');
  assert.equal(on.kind, 'soldOut');
  assert.equal(on.kind === 'soldOut' && on.soldOut, false);
});

test('a bare four-digit number is a confirmation, never a command', () => {
  const parsed = parseCommand('4821');
  assert.equal(parsed.kind, 'confirm');
  assert.equal(parsed.kind === 'confirm' && parsed.code, '4821');
});

test('unknown text is reported back verbatim', () => {
  const parsed = parseCommand('salam necesen');
  assert.equal(parsed.kind, 'unknown');
  assert.equal(parsed.kind === 'unknown' && parsed.text, 'salam necesen');
});

test('money parses the way people type it', () => {
  assert.equal(parseMoney('3.50'), 350);
  assert.equal(parseMoney('3,5'), 350);
  assert.equal(parseMoney('12'), 1200);
  assert.equal(parseMoney('0.05'), 5);
  assert.equal(parseMoney('abc'), null);
});

test('money renders as azerbaijani manat', () => {
  assert.equal(money(350), '3,50 AZN');
  assert.equal(money(123456), '1 234,56 AZN');
  assert.equal(money(0), '0,00 AZN');
  assert.equal(money(null), '0,00 AZN');
});

test('dates accept the shapes an owner types', () => {
  const now = new Date('2026-08-06T10:00:00Z');
  assert.equal(normalizeDate('2026-08-01'), '2026-08-01');
  assert.equal(normalizeDate('01.08.2026'), '2026-08-01');
  assert.equal(normalizeDate('1/8/2026'), '2026-08-01');
  assert.equal(normalizeDate('bugun', now), '2026-08-06');
  assert.equal(normalizeDate('dunen', now), '2026-08-05');
  assert.equal(normalizeDate('nonsense'), null);
});

test('history lookups parse their date', () => {
  const parsed = parseCommand('hesabat 01.08.2026');
  assert.equal(parsed.kind, 'history');
  assert.equal(parsed.kind === 'history' && parsed.date, '2026-08-01');
});

/**
 * The owner's own "X hesabat" was answered with "naməlum nömrə bota yazdı"
 * because a lid's digits were read as a phone number. These pin the split.
 */
test('a lid is never mistaken for a phone number', () => {
  const lidOnly = identifySender({
    key: { remoteJid: '54709645742099@lid', fromMe: false, id: 'A' },
  } as never);
  assert.equal(lidOnly.phone, null);
  assert.equal(lidOnly.lid, '54709645742099');

  const phoneOnly = identifySender({
    key: { remoteJid: '994553474687@s.whatsapp.net', fromMe: false, id: 'B' },
  } as never);
  assert.equal(phoneOnly.phone, '994553474687');
  assert.equal(phoneOnly.lid, null);

  const both = identifySender({
    key: {
      remoteJid: '54709645742099@lid',
      remoteJidAlt: '994553474687@s.whatsapp.net',
      fromMe: false,
      id: 'C',
    },
  } as never);
  assert.equal(both.phone, '994553474687');
  assert.equal(both.lid, '54709645742099');
});

test('a learned lid resolves to its owner', () => {
  const customer = 'test-lid-learn';
  assert.equal(getPhoneForLid(customer, '54709645742099'), null);
  assert.equal(rememberLid(customer, '54709645742099@lid', '+994 55 347 46 87'), true);
  assert.equal(getPhoneForLid(customer, '54709645742099'), '994553474687');
  // Same pair again is not a change, so it does not trigger a DB write.
  assert.equal(rememberLid(customer, '54709645742099', '994553474687'), false);
  assert.deepEqual(getLidMap(customer), { '54709645742099': '994553474687' });
});

test('the persisted map is merged once and never overwrites live entries', () => {
  const customer = 'test-lid-seed';
  rememberLid(customer, '111111111111', '994501112233');
  seedLidMap(customer, { '111111111111': '994999999999', '222222222222': '994505556677' });
  assert.equal(getPhoneForLid(customer, '111111111111'), '994501112233');
  assert.equal(getPhoneForLid(customer, '222222222222'), '994505556677');

  seedLidMap(customer, { '333333333333': '994701234567' });
  assert.equal(getPhoneForLid(customer, '333333333333'), null);
});

/**
 * Several customers can hold sessions on one WhatsApp account, and every linked
 * device receives the same message. Keying the seen-set by message id alone let
 * a leftover test tenant swallow the real till's commands.
 */
test('one message reaching two customers is processed by both', () => {
  const id = 'MSG-SHARED-1';
  assert.equal(alreadySeen('customer-a', id), false, 'first sight for A');
  assert.equal(alreadySeen('customer-b', id), false, 'first sight for B');
  assert.equal(alreadySeen('customer-a', id), true, 'A now remembers it');
  assert.equal(alreadySeen('customer-b', id), true, 'B now remembers it');
});

test('staleness reads as words', () => {
  assert.equal(since(new Date()), 'indi');
  assert.equal(since(new Date(Date.now() - 5 * 60_000)), '5 dəqiqə əvvəl');
  assert.equal(since(null), 'məlumat yoxdur');
});
