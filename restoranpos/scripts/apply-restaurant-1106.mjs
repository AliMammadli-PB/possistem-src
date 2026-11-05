import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const bundle = fileURLToPath(new URL('../index-DAmHwBc4.js', import.meta.url));
let source = fs.readFileSync(bundle, 'utf8');
if (source.includes('/* POS_HOME_WAREHOUSE_1106 */')) process.exit(0);

// The stock screen opens on the warehouse this till sells from.
const old = 'setWarehouseId((prev) => prev || list[0]?.id || "");';
if (source.split(old).length !== 2) throw Error('Stock screen anchor changed');
source = source.replace(old, () => '/* POS_HOME_WAREHOUSE_1106 */ setWarehouseId((prev) => prev || whRes.data.homeWarehouseId || list[0]?.id || "");');
fs.writeFileSync(bundle, source);
