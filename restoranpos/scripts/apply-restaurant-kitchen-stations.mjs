#!/usr/bin/env node
/**
 * Settings → Printer, reduced to one flow: name a printer ("Kassa", "Kababçı"),
 * Search, confirm it by its test page, then say where it belongs - Kitchen,
 * Till or Warehouse. The first kitchen printer is the main kitchen; any other
 * one ("Kababçı") gets dishes chosen one by one in the dish editor, whose
 * Printer field this script also adds. The old role cards, manual target and
 * test buttons are no longer rendered.
 *
 * The venue names a station, picks its printer and the menu categories that
 * print there. The list is stored as JSON in the `kitchen.stations` setting
 * (settings.set), which the core reads when an order is sent to the kitchen:
 * those categories go to the station's printer on their own ticket, everything
 * else stays on the main kitchen printer. See native/core/include/pos/printing/
 * KitchenStations.hpp.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_KITCHEN_STATIONS_v4 */';

function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

let s = fs.readFileSync(BUNDLE, 'utf8');
if (s.includes(MARK)) {
  console.log('bundle already applied');
  process.exit(0);
}

const COMPONENT = `${MARK}
/** Kitchen printers a dish can be sent to besides the main kitchen (kitchen.stations). */
function psExtraKitchenPrinters(list) {
  return (Array.isArray(list) ? list : []).filter((s) => psPrinterKind(s) === "kitchen" && !psIsMainKitchen(s));
}
function psPrinterKind(s) {
  if (s.kind) return s.kind;
  const roles = s.roles || [];
  return roles.includes("receipt") ? "receipt" : roles.includes("warehouse") ? "warehouse" : "kitchen";
}
function psIsMainKitchen(s) { return s.main === true || (s.roles || []).includes("kitchen"); }

function PsKitchenStations() {
  const L = psAdminText;
  const h = (tag, props, ...children) => {
    const { key, ...rest } = props || {};
    const kids = children.flat().filter((c) => c !== null && c !== undefined && c !== false);
    return kids.length > 1
      ? jsxRuntimeExports.jsxs(tag, { ...rest, children: kids }, key)
      : jsxRuntimeExports.jsx(tag, { ...rest, children: kids[0] }, key);
  };
  const KINDS = [
    ["kitchen", L("Mətbəx", "Mutfak", "Kitchen")],
    ["receipt", L("Kassa", "Kasa", "Till")],
    ["warehouse", L("Anbar", "Depo", "Warehouse")],
  ];
  const ROLE_OF = { receipt: "receipt", warehouse: "warehouse" };
  const [stations, setStations] = reactExports.useState([]);
  // The printer being set up: { id, name, printer, kind, main, itemIds, categoryIds, step: "name" | "search" | "kind" }.
  const [draft, setDraft] = reactExports.useState(null);
  const [list, setList] = reactExports.useState([]);
  const [at, setAt] = reactExports.useState(-1);
  const [printed, setPrinted] = reactExports.useState(false);
  const [manual, setManual] = reactExports.useState(false);
  const [address, setAddress] = reactExports.useState("");
  const [note, setNote] = reactExports.useState("");
  const [busy, setBusy] = reactExports.useState(false);
  const [found, setFound] = reactExports.useState(null);

  reactExports.useEffect(() => {
    let off = false;
    void (async () => {
      const all = await window.pos.settings.getAll();
      let saved = [];
      if (all.success) {
        try { const v = JSON.parse(all.data.settings["kitchen.stations"] || "[]"); saved = Array.isArray(v) ? v : []; } catch { saved = []; }
      }
      const current = await window.pos.print.printers().catch(() => null);
      if (off) return;
      // Printers set up before this screen keep showing, under their role.
      if (current?.success) {
        const names = { receipt: L("Kassa", "Kasa", "Till"), kitchen: L("Mətbəx", "Mutfak", "Kitchen"), warehouse: L("Anbar", "Depo", "Warehouse") };
        for (const role of ["receipt", "kitchen", "warehouse"]) {
          const target = current.data[role];
          if (!target || target === "auto" || /^virtual\\b/i.test(target)) continue;
          if (saved.some((s) => (role === "kitchen" ? psPrinterKind(s) === "kitchen" && psIsMainKitchen(s) : psPrinterKind(s) === role))) continue;
          saved.push({ id: "st-" + role, name: names[role], printer: target, kind: role, main: role === "kitchen", roles: [role], itemIds: [], categoryIds: [] });
        }
      }
      setStations(saved);
      if (saved.length === 0) startNew();
    })();
    return () => { off = true; };
  }, []);

  const resetSearch = () => { setList([]); setAt(-1); setPrinted(false); setManual(false); setAddress(""); setNote(""); setFound(null); };
  const startNew = () => { resetSearch(); setDraft({ id: "st-" + Date.now().toString(36), name: "", printer: "", kind: "", main: false, itemIds: [], categoryIds: [], step: "name" }); };
  const label = () => (draft?.name || "").trim();

  const persist = async (next) => {
    setBusy(true);
    const res = await window.pos.settings.set("kitchen.stations", JSON.stringify(next));
    setBusy(false);
    if (!res.success) { toast(res.error.message, "danger"); return false; }
    setStations(next);
    return true;
  };
  /** One test page to exactly this device; true when it left the till. */
  const testPage = async (target) => {
    let res;
    try {
      res = await window.pos.print.enqueue({ kind: "test_page", printer: target, exactTarget: true },
        { idempotencyKey: crypto.randomUUID(), timeoutMs: 6e4 });
    } catch (error) { setNote(error.message || String(error)); return false; }
    if (!res.success) { setNote(res.error.message); return false; }
    if (res.data.status !== "completed") { setNote(L("Yoxlama vərəqi göndərilmədi: ", "Test sayfası gönderilemedi: ", "Test page not sent: ") + (res.data.lastError || "")); return false; }
    return true;
  };
  const probe = async (candidates, index) => {
    if (index >= candidates.length) {
      setAt(candidates.length);
      setNote(L("Bütün cihazlar yoxlanıldı. Printer şəbəkədədirsə, ünvanı əl ilə yazın.", "Tüm cihazlar denendi. Yazıcı ağdaysa adresini elle yazın.", "Every device was tried. If the printer is on the network, type its address."));
      return;
    }
    setAt(index); setNote(""); setPrinted(false); setBusy(true);
    const ok = await testPage(candidates[index].name);
    setBusy(false); setPrinted(ok);
  };
  /** only: "usb" or "network" when the first search found nothing and the cable was just plugged in. */
  const search = async (only) => {
    if (!label()) { toast(L("Əvvəlcə printerin adını yazın", "Önce yazıcının adını yazın", "Type the printer's name first"), "danger"); return; }
    resetSearch(); setDraft((d) => ({ ...d, name: d.name.trim(), step: "search" })); setBusy(true);
    let res;
    try { res = await window.pos.print.detect({ probe: false }); }
    catch (error) { setBusy(false); setNote(error.message || String(error)); setFound([]); return; }
    setBusy(false);
    if (!res.success) { setNote(res.error?.message || ""); setFound([]); return; }
    const used = new Set(stations.filter((s) => s.id !== draft.id).map((s) => s.printer));
    const all = (res.data?.candidates ?? []).filter((p) => p.connection !== "virtual" && !used.has(p.name));
    const candidates = only ? all.filter((p) => (only === "network" ? p.connection === "network" : p.connection !== "network")) : all;
    setList(candidates); setFound(candidates);
    if (candidates.length === 0) {
      setAt(0);
      setNote(only === "usb" ? L("USB-də printer tapılmadı.", "USB'de yazıcı bulunamadı.", "No USB printer found.")
        : only === "network" ? L("Şəbəkədə (LAN) printer tapılmadı.", "Ağda (LAN) yazıcı bulunamadı.", "No network printer found.")
        : L("Printer tapılmadı. Kabeli taxın və USB və ya LAN ilə yenidən axtarın, ya da ünvanı əl ilə yazın.", "Yazıcı bulunamadı. Kabloyu takıp USB veya LAN ile yeniden arayın ya da adresi elle yazın.", "No printer found. Plug the cable in and search USB or LAN again, or type the address."));
      return;
    }
    await probe(candidates, 0);
  };
  const keep = (target) => { setDraft((d) => ({ ...d, printer: target, step: "kind" })); setNote(""); };
  const save = async () => {
    const kind = draft.kind;
    if (!kind) { toast(L("Printerin haraya aid olduğunu seçin", "Yazıcının nereye ait olduğunu seçin", "Choose where the printer belongs"), "danger"); return; }
    // The first kitchen printer is the main kitchen; later ones (Kababçı) get dishes in the dish editor.
    const mainTaken = stations.some((s) => s.id !== draft.id && psPrinterKind(s) === "kitchen" && psIsMainKitchen(s));
    const main = kind === "kitchen" && (draft.main || !mainTaken);
    const role = kind === "kitchen" ? (main ? "kitchen" : "") : ROLE_OF[kind];
    if (role) {
      const res = await window.pos.print.setPrinter(role, draft.printer);
      if (!res.success) { toast(res.error.message, "danger"); return; }
    }
    // A till role moved here leaves the printer that had it.
    const others = stations.filter((s) => s.id !== draft.id).map((s) => ({ ...s, roles: (s.roles || []).filter((r) => r !== role) }));
    const row = { id: draft.id, name: label(), printer: draft.printer, kind, main, roles: role ? [role] : [],
      itemIds: kind === "kitchen" && !main ? draft.itemIds || [] : [], categoryIds: kind === "kitchen" && !main ? draft.categoryIds || [] : [] };
    const next = others.some((s) => s.id === row.id) ? others.map((s) => (s.id === row.id ? row : s)) : [...others, row];
    if (!(await persist(next))) return;
    toast(row.name + L(" printeri yadda saxlanıldı", " yazıcısı kaydedildi", " printer saved"), "success");
    startNew();
  };
  const remove = async (row) => {
    if (!window.confirm(L(\`"\${row.name}" printeri silinsin?\`, \`"\${row.name}" yazıcısı silinsin mi?\`, \`Remove "\${row.name}"?\`))) return;
    for (const role of row.roles || []) await window.pos.print.setPrinter(role, "auto");
    await persist(stations.filter((s) => s.id !== row.id));
  };
  const edit = (row) => { resetSearch(); setDraft({ ...row, kind: psPrinterKind(row), main: psIsMainKitchen(row), step: "name" }); };
  const kindLabel = (row) => {
    const kind = psPrinterKind(row);
    if (kind === "kitchen") {
      if (psIsMainKitchen(row)) return L("Mətbəx — əsas (bütün yeməklər)", "Mutfak — ana", "Kitchen — main");
      const n = (row.itemIds || []).length;
      return L("Mətbəx — ", "Mutfak — ", "Kitchen — ") + (n ? n + L(" yemək", " yemek", " dishes") : L("yeməkləri Menyuda seçin", "yemekleri Menüde seçin", "pick its dishes in the Menu"));
    }
    return (KINDS.find((k) => k[0] === kind) || [kind, kind])[1];
  };

  const primary = "touch-target rounded-xl bg-gold/25 px-4 py-2.5 text-sm font-medium text-gold hover:bg-gold/35 disabled:opacity-50";
  const quiet = "touch-target rounded-xl border border-hairline px-4 py-2 text-sm text-muted hover:text-cream disabled:opacity-40";
  const yes = "touch-target rounded-xl border border-success/60 bg-success/15 px-4 py-2 text-sm text-success disabled:opacity-40";
  const field = "mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-2 text-sm text-cream";

  const saved = stations.map((row) => h("div", { key: row.id, className: "ps-printer-role" },
    h("div", { className: "flex flex-wrap items-center gap-3" },
      h("div", { className: "min-w-0 flex-1" },
        h("p", { className: "ps-printer-role-title" }, row.name, L(" printeri", " yazıcısı", " printer")),
        h("p", { className: "ps-printer-role-status is-ready" }, row.printer),
        h("p", { className: "mt-1 text-xs text-muted" }, kindLabel(row))),
      h("button", { type: "button", disabled: busy, className: "ps-printer-find-button", onClick: () => edit(row) }, L("Dəyişdir", "Değiştir", "Change")),
      h("button", { type: "button", disabled: busy, className: quiet, onClick: () => void remove(row) }, L("Sil", "Sil", "Remove")))));

  let wizard = null;
  if (draft) {
    const name = label();
    const stepName = h("div", { className: "flex flex-wrap items-end gap-3" },
      h("label", { className: "min-w-0 flex-1 text-sm" },
        h("span", { className: "text-xs uppercase tracking-wide text-faint" }, L("Printerin adı", "Yazıcının adı", "Printer name")),
        h("input", { type: "text", value: draft.name, placeholder: L("məs. Kassa, Mətbəx, Kababçı, Bar", "ör. Kasa, Mutfak, Kebapçı, Bar", "e.g. Till, Kitchen, Grill, Bar"),
          onChange: (e) => setDraft((d) => ({ ...d, name: e.target.value })),
          onKeyDown: (e) => { if (e.key === "Enter") void search(); }, className: field })),
      h("button", { type: "button", disabled: busy || !name, className: "ps-printer-find-button", onClick: () => void search() },
        busy && draft.step === "search" ? L("Axtarılır…", "Aranıyor…", "Searching…") : L("Axtar", "Ara", "Search")));

    const nothing = Array.isArray(found) && found.length === 0;
    const candidate = draft.step === "search" && !manual && at >= 0 && at < list.length ? list[at] : null;
    const okLabel = [L("OK — bu ", "Tamam — bu ", "OK — this is the "), name, L(" printeridir", " yazıcısı", " printer")];
    const stepSearch = draft.step === "search" ? h("div", { className: "space-y-3 border-t border-hairline pt-3" },
      busy && found === null ? h("p", { className: "text-sm text-muted" }, L("Axtarılır…", "Aranıyor…", "Searching…")) : null,
      note ? h("p", { className: "text-sm text-warning" }, note) : null,
      nothing && !manual ? h("div", { className: "flex flex-wrap gap-2" },
        h("button", { type: "button", disabled: busy, className: primary, onClick: () => void search("usb") }, L("USB-də yenidən axtar", "USB'de yeniden ara", "Search USB again")),
        h("button", { type: "button", disabled: busy, className: primary, onClick: () => void search("network") }, L("LAN-da yenidən axtar", "LAN'da yeniden ara", "Search LAN again")),
        h("button", { type: "button", className: quiet, onClick: () => { setManual(true); setNote(""); } }, L("Əl ilə yaz", "Elle yaz", "Type it"))) : null,
      !nothing && !manual && Array.isArray(found) && at >= found.length ? h("button", { type: "button", className: quiet, onClick: () => { setManual(true); setNote(""); } }, L("Əl ilə yaz", "Elle yaz", "Type it")) : null,
      candidate ? h("div", { className: "rounded-xl border border-hairline bg-elevated px-4 py-3" },
        h("p", { className: "text-xs text-faint" }, at + 1, " / ", list.length),
        h("p", { className: "mt-1 truncate text-sm font-medium text-cream" }, candidate.displayName || candidate.name),
        h("p", { className: "mt-0.5 truncate font-mono text-xs text-faint" }, candidate.name),
        h("p", { className: "mt-2 text-sm text-cream" }, L("Bu cihaza yoxlama vərəqi göndərildi. ", "Bu cihaza test sayfası gönderildi. ", "A test page was sent to this device. "), name, L(" printerindən kağız çıxdı?", " yazıcısından kağıt çıktı mı?", " printer printed it?")),
        h("div", { className: "mt-2 flex flex-wrap gap-2" },
          h("button", { type: "button", disabled: busy || !printed, className: yes, onClick: () => keep(candidate.name) }, ...okLabel),
          h("button", { type: "button", disabled: busy, className: quiet, onClick: () => void probe(list, at + 1) }, L("Yox — növbətini yoxla", "Hayır — sonrakini dene", "No — try the next")))) : null,
      manual ? h("div", { className: "rounded-xl border border-hairline bg-elevated px-4 py-3" },
        h("p", { className: "text-xs uppercase tracking-wide text-faint" }, L("Printerin ünvanı", "Yazıcının adresi", "Printer address")),
        h("input", { type: "text", value: address, placeholder: "tcp:192.168.1.51:9100", onChange: (e) => setAddress(e.target.value), className: field + " font-mono" }),
        h("p", { className: "mt-1 text-xs text-faint" }, "Şəbəkə printeri: tcp:IP:9100 · Windows növbəsi: adını yazın"),
        h("div", { className: "mt-2 flex flex-wrap gap-2" },
          h("button", { type: "button", disabled: busy || !address.trim(), className: "touch-target rounded-xl border border-gold/40 px-4 py-2 text-sm text-gold disabled:opacity-40",
            onClick: async () => { setBusy(true); const ok = await testPage(address.trim()); setBusy(false); if (ok) toast(L("Yoxlama vərəqi göndərildi", "Test sayfası gönderildi", "Test page sent"), "success"); } }, busy ? "…" : "Test çap"),
          h("button", { type: "button", disabled: !address.trim(), className: yes, onClick: () => keep(address.trim()) }, ...okLabel))) : null) : null;

    const stepKind = draft.step === "kind" ? h("div", { className: "space-y-3 border-t border-hairline pt-3" },
      h("p", { className: "ps-printer-role-status is-ready" }, name, ": ", draft.printer),
      h("p", { className: "text-sm text-cream" }, name, L(" printeri haraya aiddir?", " yazıcısı nereye ait?", " printer belongs to?")),
      h("div", { className: "flex flex-wrap gap-2" }, KINDS.map(([id, text]) => h("button", { key: id, type: "button", onClick: () => setDraft((d) => ({ ...d, kind: id })),
        className: \`touch-target rounded-xl px-5 py-3 text-sm \${draft.kind === id ? "bg-gold/15 text-gold" : "border border-hairline text-muted hover:text-cream"}\` },
        (draft.kind === id ? "✓ " : "") + text))),
      draft.kind === "kitchen" && stations.some((s) => s.id !== draft.id && psPrinterKind(s) === "kitchen" && psIsMainKitchen(s)) && !draft.main
        ? h("p", { className: "text-xs text-muted" }, L("Əsas mətbəx printeri artıq var. Bu printerdən çıxacaq yeməkləri Menyuda yemək açıb «Printer» sahəsindən seçin.", "Ana mutfak yazıcısı zaten var. Bu yazıcıdan çıkacak yemekleri Menüde yemeği açıp «Yazıcı» alanından seçin.", "There is already a main kitchen printer. Choose the dishes for this one in the Menu, in each dish's Printer field."))
        : null,
      h("div", { className: "flex flex-wrap gap-2" },
        h("button", { type: "button", disabled: busy || !draft.kind, className: yes, onClick: () => void save() }, L("Yadda saxla", "Kaydet", "Save")),
        h("button", { type: "button", disabled: busy, className: quiet, onClick: () => setDraft((d) => ({ ...d, step: "search" })) }, L("Geri", "Geri", "Back")))) : null;

    wizard = h("div", { className: "ps-printer-role is-open" },
      h("p", { className: "ps-printer-role-title" }, stations.some((s) => s.id === draft.id) ? L("Printeri dəyişdir", "Yazıcıyı değiştir", "Change printer") : L("Yeni printer", "Yeni yazıcı", "New printer")),
      h("div", { className: "mt-3 space-y-3" }, stepName, stepSearch, stepKind),
      stations.length ? h("button", { type: "button", disabled: busy, className: quiet + " mt-3", onClick: () => { setDraft(null); resetSearch(); } }, L("Bağla", "Kapat", "Close")) : null);
  }

  return h("section", { className: "ps-printer-section space-y-4" },
    h("h2", { className: "font-display text-lg text-cream" }, L("Printerlər", "Yazıcılar", "Printers")),
    h("p", { className: "text-sm text-muted" }, L("Printerin adını yazın və Axtar basın.", "Yazıcının adını yazıp Ara'ya basın.", "Type the printer's name and press Search.")),
    h("div", { className: "ps-printer-setup space-y-2" }, saved, wizard,
      !draft ? h("button", { type: "button", className: primary, onClick: () => startNew() }, L("+ Printer əlavə et", "+ Yazıcı ekle", "+ Add printer")) : null));
}
`;

// Defined at module level, next to the floor plan helpers.
s = replaceOnce(s, 'const ICONS = {', `${COMPONENT}\nconst ICONS = {`, 'component anchor');

// The old printer section (role cards, manual target, test buttons) is no
// longer rendered; this component is the whole Printer screen.
s = replaceOnce(
  s,
  `      /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "ps-printer-section space-y-4", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "font-display text-lg text-cream", children: psAdminText("Printer qoşulması",`,
  `      false && /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "ps-printer-section space-y-4", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "font-display text-lg text-cream", children: psAdminText("Printer qoşulması",`,
  'old printer section',
);

// Rendered inside the Printer accordion.
s = replaceOnce(
  s,
  `        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-printer-legacy-hint", children: t.settings.testPrintHint }),
      ] }),
`,
  `        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-printer-legacy-hint", children: t.settings.testPrintHint }),
      ] }),
      hasPermission("settings.manage") ? jsxRuntimeExports.jsx(PsKitchenStations, {}) : null,
`,
  'printer accordion',
);

// Dish editor: which printer the dish prints on when sent to the kitchen.
s = replaceOnce(
  s,
  `  const [editorOpen, setEditorOpen] = reactExports.useState(false);
`,
  `  const [editorOpen, setEditorOpen] = reactExports.useState(false);
  const [printerStation, setPrinterStation] = reactExports.useState("");
  const [kitchenPrinters, setKitchenPrinters] = reactExports.useState([]);
  reactExports.useEffect(() => {
    void window.pos.settings.getAll().then((all) => {
      if (!all.success) return;
      try { const v = JSON.parse(all.data.settings["kitchen.stations"] || "[]"); setKitchenPrinters(Array.isArray(v) ? v : []); } catch { setKitchenPrinters([]); }
    });
  }, [editorOpen]);
`,
  'dish editor state',
);
s = replaceOnce(
  s,
  `      setStation(row.station || "kitchen");
`,
  `      setStation(row.station || "kitchen");
      setPrinterStation((psExtraKitchenPrinters(kitchenPrinters).find((p) => (p.itemIds || []).includes(row.id)) || {}).id || "");
`,
  'dish editor load',
);
s = replaceOnce(
  s,
  `    setStation("kitchen");
    setCourse("main");
    setPublished(false);`,
  `    setStation("kitchen");
    setPrinterStation("");
    setCourse("main");
    setPublished(false);`,
  'dish editor reset',
);
s = replaceOnce(
  s,
  `      image: imageUrl,
      station,
      course,`,
  `      image: imageUrl,
      station,
      printerStationId: printerStation,
      course,`,
  'dish editor payload',
);

s = replaceOnce(
  s,
  `            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "Menyuda yayımla" })
          ] }),
`,
  `            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "Menyuda yayımla" })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "block text-sm", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-faint", children: "Printer — mətbəxə göndəriləndə haradan çıxsın" }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("select", { value: printerStation, onChange: (e) => setPrinterStation(e.target.value), className: "mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-2.5 text-cream", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: "", children: "Mətbəx (əsas)" }),
              ...psExtraKitchenPrinters(kitchenPrinters).map((p) => /* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: p.id, children: p.name }, p.id))
            ] })
          ] }),
`,
  'dish editor printer select',
);

fs.writeFileSync(BUNDLE, s);
console.log('kitchen stations applied');
