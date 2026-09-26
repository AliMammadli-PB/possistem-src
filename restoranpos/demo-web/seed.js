/**
 * Demo data for the possistem.az live demo, written through the core's own API
 * on every page load so the dashboard's "today" is always today.
 *
 * `call(method, payload)` returns the core's { success, data, error } frame.
 * Staff PINs are printed on the site next to the demo: Admin 1234,
 * Elvin 2222, Nigar 3333.
 */
export const DEMO_STAFF = [
  { name: 'Admin', pin: '1234', role: 'administrator' },
  { name: 'Elvin', pin: '2222', role: 'waiter' },
  { name: 'Nigar', pin: '3333', role: 'waiter' },
];

const AREAS = [
  { id: 'area-main', nameAz: 'Əsas zal', nameTr: 'Ana salon', nameEn: 'Main hall' },
  { id: 'area-terrace', nameAz: 'Teras', nameTr: 'Teras', nameEn: 'Terrace' },
  { id: 'area-vip', nameAz: 'VIP', nameTr: 'VIP', nameEn: 'VIP' },
];
const SEATS = [4, 4, 4, 6, 4, 6, 4, 4, 4, 2, 4, 8, 6, 8];

// [waiter, table, [productId, qty]...] — bills still open on the floor
const OPEN = [
  ['Elvin', 2, ['itm-ff-02', 2], ['itm-sa-01', 1], ['itm-si-01', 2]],
  ['Nigar', 5, ['itm-ty-01', 2], ['itm-qn-01', 2], ['itm-si-02', 2]],
  ['Elvin', 9, ['itm-et-02', 2], ['itm-sa-03', 1], ['itm-pv-02', 3]],
  ['Nigar', 13, ['itm-et-03', 2], ['itm-ql-01', 1], ['itm-ii-03', 1]],
];
// bills already paid today, so reports and the dashboard have takings
const PAID = [
  ['Elvin', 1, 'cash', ['itm-ff-01', 2], ['itm-si-01', 2]],
  ['Nigar', 4, 'card', ['itm-ty-03', 1], ['itm-sa-02', 2], ['itm-si-03', 4]],
  ['Elvin', 7, 'cash', ['itm-ff-03', 3], ['itm-si-02', 3]],
  ['Nigar', 10, 'card', ['itm-et-01', 1], ['itm-mz-02', 1]],
  ['Elvin', 12, 'card', ['itm-ql-03', 1], ['itm-ii-02', 2]],
];

export async function seedDemo(call) {
  const must = async (method, payload) => {
    const res = await call(method, payload);
    if (!res.success) throw new Error(`${method}: ${res.error?.code} ${res.error?.message}`);
    return res.data;
  };
  const signIn = (pin) => must('auth.login', { userId: '', pin });

  // 9001 is the shipped PIN and must be replaced on first sign-in
  await must('auth.login', { userId: '', pin: '9001', newPin: DEMO_STAFF[0].pin });
  for (const [key, value] of [
    ['restaurant.name', 'Demo Restoran'],
    ['printer.receipt', 'virtual'],
    ['printer.kitchen', 'virtual'],
  ]) {
    await must('settings.set', { key, value });
  }
  for (const staff of DEMO_STAFF.slice(1)) {
    await must('users.create', { fullName: staff.name, pin: staff.pin, role: staff.role });
  }
  for (const [i, area] of AREAS.entries()) await must('tables.upsertArea', { ...area, sortOrder: i + 1 });
  for (const [i, seats] of SEATS.entries()) {
    const n = i + 1;
    await must('tables.upsertTable', {
      id: `tbl-${n}`,
      areaId: n <= 8 ? 'area-main' : n <= 12 ? 'area-terrace' : 'area-vip',
      label: String(n),
      seats,
      sortOrder: n,
    });
  }
  await must('businessDay.open', { openingFloatMinor: 20000 });
  await must('shifts.open', { openingFloatMinor: 20000 });

  const pinOf = (name) => DEMO_STAFF.find((s) => s.name === name).pin;
  const bill = async ([waiter, table, ...lines]) => {
    await signIn(pinOf(waiter));
    const order = await must('orders.create', { tableId: `tbl-${table}`, guestCount: 2 });
    for (const [productId, quantity] of lines) {
      await must('orders.addItem', { orderId: order.id, productId, quantity, modifiers: [] });
    }
    await must('orders.submit', { orderId: order.id });
    return must('orders.get', { orderId: order.id });
  };

  for (const [waiter, table, method, ...lines] of PAID) {
    const order = await bill([waiter, table, ...lines]);
    const amountMinor = order.totalMinor;
    if (method === 'cash') {
      await must('payments.createCash', { orderId: order.id, amountMinor, tenderedMinor: amountMinor });
    } else {
      await must('payments.createCard', { orderId: order.id, amountMinor });
    }
  }
  for (const entry of OPEN) await bill(entry);

  await call('auth.logout', {});
}
