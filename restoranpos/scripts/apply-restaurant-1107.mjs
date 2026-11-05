import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const bundle = fileURLToPath(new URL('../index-DAmHwBc4.js', import.meta.url));
let source = fs.readFileSync(bundle, 'utf8');
if (source.includes('/* DELIVERY_NAMES_1107 */')) process.exit(0);
function replace(old, next) {
  if (source.split(old).length !== 2) throw Error('Delivery anchor changed: ' + old.slice(0, 90));
  source = source.replace(old, () => next);
}

// A delivery tile and its order screen show the guest's name, not "1", "2".
replace('function tableNumber(table) {\n', '/* DELIVERY_NAMES_1107 */ function tableNumber(table) {\n  if (table.deliveryName) return table.deliveryName;\n');
replace('className: `table-tile__num ${compact ? "text-[2rem]" : "text-[2.75rem]"}`, children: number }',
  'className: table.deliveryName ? "table-tile__num table-tile__name" : `table-tile__num ${compact ? "text-[2rem]" : "text-[2.75rem]"}`, children: number }');
replace('children: table?.label ?? order?.tableLabel ?? t.order.title }', 'children: table?.deliveryName || (table?.label ?? order?.tableLabel ?? t.order.title) }');
// The "Çatdırılma" button stands left, beside the area tabs, not in the top right corner.
replace('          }) }),\n          jsxRuntimeExports.jsx(PsDeliveryStartButton, {})\n',
  '          }), jsxRuntimeExports.jsx(PsDeliveryStartButton, {}, "ps-delivery-start")] }),\n');
replace('"flex flex-wrap justify-end gap-2", children: areas.map(', '"flex flex-wrap items-center gap-2", children: [...areas.map(');
replace('"relative z-[1] flex items-center justify-between gap-4 border-b border-white/12 bg-white/6 px-5 py-3.5 backdrop-blur-[2px]"',
  '"relative z-[1] flex flex-wrap items-center gap-4 border-b border-white/12 bg-white/6 px-5 py-3.5 backdrop-blur-[2px]"');
fs.writeFileSync(bundle, source);
