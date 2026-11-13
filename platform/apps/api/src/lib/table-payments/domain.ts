/** All money is integer qəpik. Quotes never trust an amount supplied by a phone. */
export class TablePaymentError extends Error {
  constructor(
    message: string,
    readonly statusCode = 409,
  ) {
    super(message);
  }
}
export type BillLine = {
  id: string;
  name: string;
  quantityMilli: number;
  amountMinor: number;
};
export type BillSnapshot = {
  orderId: string;
  orderNumber: string;
  tableId: string;
  tableLabel: string;
  revision: string;
  totalMinor: number;
  paidMinor: number;
  lines: BillLine[];
};
export type Selection =
  | { mode: "all" }
  | { mode: "equal"; parts: number; part: number }
  | { mode: "items"; items: { lineId: string; quantityMilli: number }[] };
export type Allocation = {
  lineId: string;
  quantityMilli: number;
  amountMinor: number;
};
export type Hold = {
  id: string;
  selection: Selection;
  amountMinor: number;
  allocations: Allocation[];
  status: "reserving" | "pending" | "unknown" | "paid" | "applied" | "failed";
};
const fail = (s: string): never => {
  throw new TablePaymentError(s);
};
const integer = (n: number, min = 0) => Number.isSafeInteger(n) && n >= min;
export function distribute(total: number, weights: number[]): number[] {
  if (!integer(total) || weights.some((n) => !integer(n)))
    fail("Məbləğ düzgün deyil.");
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!integer(sum) || (!sum && total))
    fail("Hesab məbləği məhsullara bölünə bilmir.");
  if (!sum) return weights.map(() => 0);
  const T = BigInt(total),
    S = BigInt(sum),
    raw = weights.map((w, i) => ({
      i,
      whole: Number((T * BigInt(w)) / S),
      fraction: (T * BigInt(w)) % S,
    }));
  let extra = total - raw.reduce((n, r) => n + r.whole, 0);
  for (const r of [...raw].sort((a, b) =>
    a.fraction === b.fraction ? a.i - b.i : a.fraction > b.fraction ? -1 : 1,
  )) {
    if (extra-- <= 0) break;
    r.whole++;
  }
  return raw.map((r) => r.whole);
}
export function validateBill(b: BillSnapshot): BillSnapshot {
  if (
    !b.orderId ||
    !b.tableId ||
    !b.revision ||
    !integer(b.totalMinor, 1) ||
    b.totalMinor > 100_000_000 ||
    !integer(b.paidMinor) ||
    b.paidMinor >= b.totalMinor ||
    !b.lines.length ||
    b.lines.length > 300
  )
    fail("Ödəniş üçün açıq masa hesabı yoxdur.");
  const ids = new Set<string>();
  for (const l of b.lines) {
    if (
      !l.id ||
      ids.has(l.id) ||
      !l.name ||
      !integer(l.quantityMilli, 1) ||
      !integer(l.amountMinor)
    )
      fail("Hesab sətirləri düzgün deyil.");
    ids.add(l.id);
  }
  return b;
}
export function payableLines(b: BillSnapshot): BillLine[] {
  validateBill(b);
  const amounts = distribute(
    b.totalMinor - b.paidMinor,
    b.lines.map((l) => l.amountMinor),
  );
  return b.lines.map((l, i) => ({ ...l, amountMinor: amounts[i] }));
}
export function quote(
  b: BillSnapshot,
  selection: Selection,
  holds: Hold[] = [],
) {
  const lines = payableLines(b),
    active = holds.filter((h) => h.status !== "failed"),
    remaining =
      b.totalMinor -
      b.paidMinor -
      active.reduce((n, h) => n + h.amountMinor, 0);
  if (remaining <= 0)
    fail("Hesab ödənilib və ya başqa qonağın ödənişi gözlənilir.");
  const prior = active.find((h) => h.selection.mode !== "all")?.selection;
  if (selection.mode !== "all" && prior && prior.mode !== selection.mode)
    fail(
      "Bu masa üçün bölüşdürmə üsulu artıq seçilib. Qalan hesabın hamısını ödəyə bilərsiniz.",
    );
  const free = lines.map((l) => {
    const used = active
      .flatMap((h) => h.allocations)
      .filter((a) => a.lineId === l.id);
    return {
      ...l,
      quantityMilli:
        l.quantityMilli - used.reduce((n, a) => n + a.quantityMilli, 0),
      amountMinor: l.amountMinor - used.reduce((n, a) => n + a.amountMinor, 0),
    };
  });
  if (free.some((l) => l.amountMinor < 0 || l.quantityMilli < 0))
    fail("Hesab bölgüsü yenidən yoxlanmalıdır.");
  let amount = 0,
    allocations: Allocation[] = [];
  if (selection.mode === "equal") {
    if (
      !integer(selection.parts, 2) ||
      selection.parts > 20 ||
      !integer(selection.part) ||
      selection.part >= selection.parts
    )
      fail("Adam sayını və payınızı seçin.");
    if (prior?.mode === "equal" && prior.parts !== selection.parts)
      fail("Bu hesab üçün adam sayı artıq müəyyən edilib.");
    if (
      active.some(
        (h) =>
          h.selection.mode === "equal" && h.selection.part === selection.part,
      )
    )
      fail("Bu pay ödənilib və ya ödənişi gözlənilir.");
    const shares = distribute(
      b.totalMinor - b.paidMinor,
      Array(selection.parts).fill(1),
    );
    amount = shares[selection.part];
    // Equal amounts use the same immutable bill; line quantities are attributed
    // only for item mode. Financial allocations still sum exactly to the share.
    const costs = distribute(
      amount,
      free.map((l) => l.amountMinor),
    );
    allocations = free
      .map((l, i) => ({
        lineId: l.id,
        quantityMilli: 0,
        amountMinor: costs[i],
      }))
      .filter((a) => a.amountMinor > 0);
  } else if (selection.mode === "items") {
    const ids = new Set<string>();
    if (!selection.items.length || selection.items.length > 300)
      fail("Ödəyəcəyiniz yeməkləri seçin.");
    allocations = selection.items.map((i) => {
      if (ids.has(i.lineId)) fail("Eyni məhsul iki dəfə seçilib.");
      ids.add(i.lineId);
      const line = free.find((l) => l.id === i.lineId);
      if (!line) return fail("Seçilmiş yemək tapılmadı.");
      if (!integer(i.quantityMilli, 1) || i.quantityMilli > line.quantityMilli)
        fail("Seçilmiş yemək başqa qonaq tərəfindən ödənilir.");
      const amountMinor =
        i.quantityMilli === line.quantityMilli
          ? line.amountMinor
          : Number(
              (BigInt(line.amountMinor) * BigInt(i.quantityMilli)) /
                BigInt(line.quantityMilli),
            );
      return { lineId: line.id, quantityMilli: i.quantityMilli, amountMinor };
    });
    amount = allocations.reduce((n, a) => n + a.amountMinor, 0);
  } else if (selection.mode === "all") {
    // Pending bank operations are never included in a second checkout.
    allocations = free
      .filter((l) => l.amountMinor > 0)
      .map((l) => ({
        lineId: l.id,
        quantityMilli: l.quantityMilli,
        amountMinor: l.amountMinor,
      }));
    amount = remaining;
  } else fail("Ödəniş üsulunu seçin.");
  if (
    !integer(amount, 1) ||
    amount > remaining ||
    allocations.reduce((n, a) => n + a.amountMinor, 0) !== amount
  )
    fail("Ödəniləcək məbləği yenidən yoxlayın.");
  return {
    amountMinor: amount,
    allocations,
    remainingAfterMinor: remaining - amount,
  };
}
export function providerAmount(value: unknown): number | null {
  const s = String(value ?? "");
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(s)) return null;
  const [a, b = ""] = s.split(".");
  return Number(a) * 100 + Number(b.padEnd(2, "0"));
}
