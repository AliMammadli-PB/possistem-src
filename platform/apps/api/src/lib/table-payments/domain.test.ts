import test from "node:test";
import assert from "node:assert/strict";
import {
  distribute,
  quote,
  providerAmount,
  type BillSnapshot,
  type Hold,
} from "./domain.js";
const bill: BillSnapshot = {
  orderId: "order",
  orderNumber: "A1",
  tableId: "table",
  tableLabel: "Masa 1",
  revision: "v1",
  totalMinor: 1001,
  paidMinor: 0,
  lines: [
    { id: "pizza", name: "Pizza", quantityMilli: 2000, amountMinor: 800 },
    { id: "cola", name: "Cola", quantityMilli: 1000, amountMinor: 200 },
  ],
};
const held = (
  selection: any,
  rows: Hold[] = [],
  status: Hold["status"] = "pending",
): Hold => ({
  id: String(rows.length),
  selection,
  ...quote(bill, selection, rows),
  status,
});
test("integer split and order adjustments conserve every qəpik", () => {
  assert.deepEqual(distribute(1001, [1, 1, 1]), [334, 334, 333]);
  const q = quote(bill, { mode: "all" });
  assert.equal(q.amountMinor, 1001);
  assert.equal(
    q.allocations.reduce((n, a) => n + a.amountMinor, 0),
    1001,
  );
});
test("equal shares stay fixed after the first payment", () => {
  const rows: Hold[] = [];
  for (let part = 0; part < 3; part++)
    rows.push(held({ mode: "equal", parts: 3, part }, rows, "applied"));
  assert.deepEqual(
    rows.map((r) => r.amountMinor),
    [334, 334, 333],
  );
  assert.throws(() => quote(bill, { mode: "all" }, rows));
});
test("two phones cannot reserve the same share or change the split", () => {
  const one = held({ mode: "equal", parts: 2, part: 0 });
  assert.throws(() => quote(bill, { mode: "equal", parts: 2, part: 0 }, [one]));
  assert.throws(() => quote(bill, { mode: "equal", parts: 3, part: 1 }, [one]));
  assert.equal(quote(bill, { mode: "all" }, [one]).amountMinor, 500);
});
test("item quantities, discounts and remainder cents stay consistent", () => {
  const rows = [
    held({ mode: "items", items: [{ lineId: "pizza", quantityMilli: 1000 }] }),
  ];
  assert.equal(rows[0].amountMinor, 400);
  rows.push(
    held(
      { mode: "items", items: [{ lineId: "pizza", quantityMilli: 1000 }] },
      rows,
    ),
  );
  assert.equal(rows[1].amountMinor, 401);
  rows.push(
    held(
      { mode: "items", items: [{ lineId: "cola", quantityMilli: 1000 }] },
      rows,
    ),
  );
  assert.equal(
    rows.reduce((n, r) => n + r.amountMinor, 0),
    1001,
  );
  assert.throws(() =>
    quote(
      bill,
      { mode: "items", items: [{ lineId: "pizza", quantityMilli: 1 }] },
      rows,
    ),
  );
});
test("uncertain bank attempts keep reservations; definitive failures release them", () => {
  const q = held({ mode: "all" }, [], "unknown");
  assert.throws(() => quote(bill, { mode: "all" }, [q]));
  q.status = "failed";
  assert.equal(quote(bill, { mode: "all" }, [q]).amountMinor, 1001);
});
test("malformed/duplicate/foreign line and unsafe numeric input rejected", () => {
  for (const items of [
    [{ lineId: "foreign", quantityMilli: 1000 }],
    [{ lineId: "pizza", quantityMilli: 3000 }],
    [{ lineId: "pizza", quantityMilli: 0.5 }],
    [
      { lineId: "pizza", quantityMilli: 1000 },
      { lineId: "pizza", quantityMilli: 1000 },
    ],
  ])
    assert.throws(() => quote(bill, { mode: "items", items }));
  assert.throws(() => distribute(Number.MAX_SAFE_INTEGER + 1, [1]));
  assert.throws(() => quote({ ...bill, paidMinor: 1002 }, { mode: "all" }));
});
test("prior deposits reduce payable shares and hostile provider amounts rejected", () => {
  assert.equal(
    quote({ ...bill, paidMinor: 201 }, { mode: "all" }).amountMinor,
    800,
  );
  assert.equal(providerAmount("10.01"), 1001);
  for (const v of ["1e2", "0.001", "-1", "NaN", null])
    assert.equal(providerAmount(v), null);
});
