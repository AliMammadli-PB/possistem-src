/**
 * Which printer is the kitchen, which is the till, which is the store room.
 *
 * The screen half of the three-printer change. What would rot here: a chip
 * offering a role the core does not accept (a rejected write with nothing on
 * screen to explain it), a role the screen writes but never reads back (the
 * operator cannot see what they assigned and presses Test again), and the
 * instruction line - without it three chips read as a filter rather than the
 * "identify by paper, then label" workflow they are.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bundle = fs.readFileSync(path.join(ROOT, 'index-DAmHwBc4.js'), 'utf8');
const preload = fs.readFileSync(path.join(ROOT, 'out/preload/index.js'), 'utf8');
const protocol = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'shared/contracts/protocol.json'), 'utf8'),
);

describe('printer roles', () => {
  it('offers exactly the roles the core accepts', () => {
    for (const role of ['receipt', 'kitchen', 'warehouse']) {
      expect(bundle, `${role} chip`).toContain(`id: "${role}"`);
    }
    expect(bundle).toContain('window.pos.print.setPrinter(role, target)');
    expect(preload).toContain('call("print.setPrinter", { target, printerName, settings })');
  });

  it('reads all three back, so the screen shows what was assigned', () => {
    expect(bundle).toContain('warehouse: data.warehouse ?? "auto"');
    expect(bundle).toContain('kitchen: data.kitchen ?? "auto"');
    // An unassigned role has to look different from an assigned one, or a
    // half-configured till looks finished.
    expect(bundle).toContain('const known = target && target !== "auto" && !virtual;');
    expect(bundle).toContain('Virtual printer — kağız çap etmir');
  });

  it('is one short wizard per printer, not one crowded panel', () => {
    // Three lines, each saying where it points and offering one button. The
    // list, the test button and the role chips only exist while one printer is
    // being set up - which happens about twice in the life of a restaurant.
    expect(bundle).toContain('openWizard(role.id); void wizardFind();');
    expect(bundle).toContain('children: open ? psAdminText("Bağla"');
    expect(bundle).toContain('disabled: wizardBusy || assigningRole !== "" || !wizardPrinted');
    expect(bundle).not.toContain('children: "Bura"');
  });

  it('walks the candidates one at a time and asks about each', () => {
    // The operator has to walk to the machine and look, so asking about all of
    // them at once is asking them to remember which was which.
    expect(bundle).toContain('const wizardProbe = async (list, index)');
    expect(bundle).toContain('printerindən kağız çıxdı?');
    expect(bundle).toContain('children: "Yox — növbətini yoxla"');
  });

  it('does not let the core pick for the operator', () => {
    // probe:true makes the core choose a winner and save it, which is the
    // opposite of a screen whose whole point is that a person decides.
    expect(bundle).toContain('window.pos.print.detect({ probe: false })');
  });

  it('offers a typed address as a first-class path, per role', () => {
    // A wired restaurant knows its printer's IP; this used to be hidden behind
    // a "+" and could only ever write the till's role.
    expect(bundle).toContain('children: "Əl ilə yaz"');
    expect(bundle).toContain('const wizardManualTest');
    expect(bundle).toContain('onClick: () => void wizardKeep(wizardAddress.trim())');
  });

  it('keeps the address already in use when changing it', () => {
    expect(bundle).toContain('setWizardAddress(current && current !== "auto" ? current : "")');
  });

  it('hides the file-writing printer from the candidate walk', () => {
    // It accepts every job and produces no paper, so offering it as an answer
    // to "which one printed?" is offering a trap.
    expect(bundle).toContain('.filter((p) => p.connection !== "virtual")');
  });

  it('warns when a printer that prints nothing is chosen anyway', () => {
    expect(bundle).toContain('virtual printerdir, kağız çıxarmır');
  });

  it('no longer calls the whole section the till printer', () => {
    expect(bundle).toContain('printer: "Printerlər"');
    expect(bundle).not.toContain('printer: "Kassə printeri"');
  });
});

describe('the delivery note', () => {
  it('is a print kind the contract knows', () => {
    expect(protocol.enums.PrintJobKind).toContain('warehouse_slip');
  });

  it('is sent on receipt and can be sent again', () => {
    expect(bundle).toContain('async function opsPrintWarehouseSlip(purchaseId)');
    expect(bundle).toContain('kind: "warehouse_slip"');
    expect(bundle).toContain('children: "Qəbzi çap et"');
  });

  it('is not printed for a delivery that failed to record', () => {
    expect(bundle).toContain('if (received) await opsPrintWarehouseSlip(p.id);');
  });

  it('does not call a failed print a failed delivery', () => {
    // The stock is in and the supplier is owed by the time the paper is asked
    // for; a printer that is off is a missing sheet, not a missing delivery.
    expect(bundle).toContain('toast("Mal qəbulu çap olunmadı — qəbul özü yazılıb", "warning")');
  });
});
