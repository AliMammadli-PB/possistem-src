// LAN label scale (1.5.51): Dahua "!0V" lines and the TCP exchange, against a fake scale on 127.0.0.1:4001.
import assert from 'node:assert/strict';
import net from 'node:net';
import { createRequire } from 'node:module';

const lan = createRequire(import.meta.url)('../../marketpos/electron/scale-lan.cjs');

assert.equal(lan.quwei('Ab 1'), '0333' + '0366' + '0101' + '0317');
assert.equal(lan.codes3('AB12'), '065066049050');
assert.equal(lan.codes3('Şə Яа?'), '083101032223224063');
assert.equal(lan.quwei('Şə'), lan.quwei('Se'));
assert.equal(lan.quwei('Яа'), '0733' + '0749');

const line = lan.pluLine({ plu: 42, name: 'Pomidor', priceMinor: 350 }, '21');
assert.equal(line, '!0V0042A0000042000350' + '0000000000' + '21' + '0'.repeat(48) + 'B' + lan.codes3('Pomidor') + 'CDE');
assert.throws(() => lan.pluLine({ plu: 4001, name: 'x', priceMinor: 1 }, '20'), /1–4000/);

const { lines, skipped } = lan.scaleLines([
  { name: 'Pomidor', plu: 42, weighted: 1, salePriceMinor: 350 },
  { name: 'Sabun', plu: 0, weighted: 0, salePriceMinor: 100 },
  { name: 'Böyük', plu: 9000, weighted: 1, salePriceMinor: 100 },
], '20');
assert.equal(lines.length, 1);
assert.deepEqual(skipped, ['Böyük (PLU 9000)']);
assert.equal(lan.testPlu([{ plu: 4000 }, { plu: 3999 }]), 3998);

// Like the TM-30F: answers "0v<plu>a0" CR LF ETX for a line it stores and sends back a line
// whose name digits do not divide by 3; then one that stays silent.
const got = [], stored = [];
let silent = false;
const refuses = (l) => !/^(\d{3})*$/.test(l.slice(82, l.lastIndexOf('CDE')));
const server = net.createServer((socket) => {
  let buf = '';
  socket.on('data', (chunk) => {
    buf += chunk.toString('latin1');
    for (let i; (i = buf.indexOf('\r\n')) >= 0;) {
      const l = buf.slice(0, i); buf = buf.slice(i + 2); got.push(l);
      if (buf.startsWith('\x03')) buf = buf.slice(1);
      if (silent) continue;
      if (refuses(l)) { socket.write(l + '\r\n\x03'); continue; }
      stored.push(l);
      setTimeout(() => socket.write(l[1] + 'v' + l.slice(3, 7)), 20); setTimeout(() => socket.write('a0\r\n\x03'), 120);
    }
  });
  socket.on('error', () => undefined);
});
await new Promise((resolve) => server.listen(lan.PORT, '127.0.0.1', resolve));
const old = lan.pluLine({ plu: 43, name: '', priceMinor: 280, nameField: lan.quwei('Xiyar') }, '21');
const res = await lan.sendLines('127.0.0.1', [line, old]);
assert.equal(res.sent, 2);
assert.equal(res.accepted, 1);
assert.deepEqual(res.rejected, [1]);
assert.match(res.reply, /^!0V0043/);
assert.deepEqual(got, [line, old]);
assert.deepEqual(stored, [line]);
// Diagnostics: six framings on six free PLUs, every exchange logged in ASCII.
const diag = await lan.diagnose({ ip: '127.0.0.1', prefix: '20', goods: [{ plu: 4000 }, { name: 'Pomidor', plu: 42, weighted: 1, salePriceMinor: 350 }], header: ['test run'] });
assert.deepEqual(diag.plus.map((p) => p.split(' ')[3]), ['3999', '3998', '3997', '3996', '3995', '3994', '3993', '3992', '42']);
assert.match(diag.log, /T1 = PLU 3999 should read "ABCDEFGHIJ" \(1\.01 AZN\) -> ACCEPTED/);
assert.match(diag.log, /B128129130131132133134135136137CDE/);
assert.match(diag.log, /R1 = PLU 42 should read "Pomidor" -> ACCEPTED/);
assert.ok(/^[\x09\x0a\x20-\x7e]*$/.test(diag.log), 'log is plain ASCII');
if (process.env.SHOW_LOG) console.log(diag.log);
silent = true;
await assert.rejects(lan.sendLines('127.0.0.1', [line], { timeoutMs: 300 }), /cavab vermədi/);
await assert.rejects(lan.sendLines('not-an-ip', [line]), /IP/);
server.close();
await assert.rejects(lan.sendLines('127.0.0.1', [line]), /ECONNREFUSED/);
console.log('PASS scale-lan: !0V lines, qu-wei names, one line per connection, chunked answers, silence and refusal');
