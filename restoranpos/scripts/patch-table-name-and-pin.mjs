#!/usr/bin/env node
/**
 * Patch packaged renderer/main/preload:
 * 1) Table admin: editable table name input (was a read-only "Masa N" label)
 * 2) Staff / parameters: change PIN (default 9001) via users.changePin
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RENDERER = path.join(root, 'out/renderer/assets/index-BsrHjfOR.js');
const MAIN = path.join(root, 'out/main/index.js');
const PRELOAD = path.join(root, 'out/preload/index.js');
const LINUX_ASAR = path.join(root, '../linux/Possistem-Linux/resources/app.asar');

function mustInclude(file, needle, label) {
  if (!file.includes(needle)) {
    throw new Error(`Marker not found (${label}): ${needle.slice(0, 80)}`);
  }
}

function replaceOnce(file, from, to, label) {
  mustInclude(file, from, label);
  if (file.includes(to.slice(0, Math.min(60, to.length))) && to.length > 40) {
    // already patched with same content — allow idempotent re-run for some blocks
  }
  const count = file.split(from).length - 1;
  if (count !== 1) throw new Error(`Expected 1 match for ${label}, got ${count}`);
  return file.replace(from, to);
}

function patchRenderer(src) {
  let s = src;

  if (!s.includes('const [tableLabel, setTableLabel]')) {
    s = replaceOnce(
      s,
      `const [tableSeats, setTableSeats] = reactExports.useState("4");
  const [editTableId, setEditTableId] = reactExports.useState(null);
  const [pendingDelete, setPendingDelete] = reactExports.useState(null);`,
      `const [tableSeats, setTableSeats] = reactExports.useState("4");
  const [tableLabel, setTableLabel] = reactExports.useState("");
  const [editTableId, setEditTableId] = reactExports.useState(null);
  const [pendingDelete, setPendingDelete] = reactExports.useState(null);`,
      'tableLabel state',
    );
  }

  if (!s.includes('const nextTableName = () =>')) {
    s = replaceOnce(
      s,
      `  const areaTables = reactExports.useMemo(
    () => tables2.filter((tbl) => tbl.areaId === areaId),
    [tables2, areaId]
  );`,
      `  const areaTables = reactExports.useMemo(
    () => tables2.filter((tbl) => tbl.areaId === areaId),
    [tables2, areaId]
  );
  const nextTableName = () => \`Masa \${Math.max(0, ...areaTables.map((table) => table.sortOrder ?? 0)) + 1}\`;
  reactExports.useEffect(() => {
    if (!editTableId) setTableLabel(nextTableName());
  }, [areaId, areaTables.length, editTableId]);`,
      'nextTableName helper',
    );
  }

  if (s.includes('label: `Masa ${sortOrder}`')) {
    s = replaceOnce(
      s,
      `  const saveTable = async () => {
    if (!areaId) {
      toast(t.adminTables.areaRequired, "danger");
      return;
    }
    const seats = Math.max(1, Number.parseInt(tableSeats, 10) || 2);
    const current = editTableId ? areaTables.find((table) => table.id === editTableId) : null;
    const sortOrder = current?.sortOrder ?? Math.max(0, ...areaTables.map((table) => table.sortOrder ?? 0)) + 1;
    setBusy(true);
    const payload = {
      label: \`Masa \${sortOrder}\`,
      areaId,
      seats,
      sortOrder,
      shape: current?.shape || "square"
    };
    if (editTableId) payload.id = editTableId;
    const res = await window.pos.tables.upsertTable(payload, {
      idempotencyKey: newIdempotencyKey()
    });
    setBusy(false);
    if (!res.success) {
      toast(res.error.message, "danger");
      return;
    }
    toast(t.common.save, "success");
    setTableSeats("4");
    setEditTableId(null);
    await load();
  };`,
      `  const saveTable = async () => {
    if (!areaId) {
      toast(t.adminTables.areaRequired, "danger");
      return;
    }
    const label = tableLabel.trim();
    if (!label) {
      toast(t.adminTables.nameRequired, "danger");
      return;
    }
    const seats = Math.max(1, Number.parseInt(tableSeats, 10) || 2);
    const current = editTableId ? areaTables.find((table) => table.id === editTableId) : null;
    const sortOrder = current?.sortOrder ?? Math.max(0, ...areaTables.map((table) => table.sortOrder ?? 0)) + 1;
    setBusy(true);
    const payload = {
      label,
      areaId,
      seats,
      sortOrder,
      shape: current?.shape || "square"
    };
    if (editTableId) payload.id = editTableId;
    const res = await window.pos.tables.upsertTable(payload, {
      idempotencyKey: newIdempotencyKey()
    });
    setBusy(false);
    if (!res.success) {
      toast(res.error.message, "danger");
      return;
    }
    toast(t.common.save, "success");
    setTableSeats("4");
    setEditTableId(null);
    setTableLabel("");
    await load();
  };`,
      'saveTable uses typed label',
    );
  }

  if (s.includes('editTableId ? areaTables.find((table) => table.id === editTableId)?.label : `Masa ${Math.max(0, ...areaTables.map((table) => table.sortOrder ?? 0)) + 1}`')) {
    s = replaceOnce(
      s,
      `        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid gap-2 sm:grid-cols-[1fr_6rem_auto]", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex items-center rounded-xl border border-hairline bg-elevated px-3 py-3 text-cream", children: editTableId ? areaTables.find((table) => table.id === editTableId)?.label : \`Masa \${Math.max(0, ...areaTables.map((table) => table.sortOrder ?? 0)) + 1}\` }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "input",
            {
              value: tableSeats,
              onChange: (e) => setTableSeats(e.target.value),
              inputMode: "numeric",
              placeholder: t.adminTables.seats,
              className: "rounded-xl border border-hairline bg-elevated px-3 py-3 text-cream outline-none focus:border-gold/50"
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "button",
            {
              type: "button",
              disabled: busy,
              onClick: () => void saveTable(),
              className: "touch-target rounded-xl bg-gold/20 px-4 py-3 text-sm text-gold hover:bg-gold/30 disabled:opacity-50",
              children: editTableId ? t.common.save : t.adminTables.addTable
            }
          )
        ] }),`,
      `        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid gap-2 sm:grid-cols-[1fr_6rem_auto]", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "input",
            {
              value: tableLabel,
              onChange: (e) => setTableLabel(e.target.value),
              placeholder: t.adminTables.tableName || "Masa adı",
              className: "rounded-xl border border-hairline bg-elevated px-3 py-3 text-cream outline-none focus:border-gold/50",
              onKeyDown: (e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void saveTable();
                }
              }
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "input",
            {
              value: tableSeats,
              onChange: (e) => setTableSeats(e.target.value),
              inputMode: "numeric",
              placeholder: t.adminTables.seats,
              className: "rounded-xl border border-hairline bg-elevated px-3 py-3 text-cream outline-none focus:border-gold/50"
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "button",
            {
              type: "button",
              disabled: busy || !tableLabel.trim(),
              onClick: () => void saveTable(),
              className: "touch-target rounded-xl bg-gold/20 px-4 py-3 text-sm text-gold hover:bg-gold/30 disabled:opacity-50",
              children: editTableId ? t.common.save : t.adminTables.addTable
            }
          )
        ] }),`,
      'table name input UI',
    );
  }

  if (s.includes('setEditTableId(table.id);\n                setTableSeats(String(table.seats));\n                setAreaId(table.areaId);')) {
    s = replaceOnce(
      s,
      `setEditTableId(table.id);
                setTableSeats(String(table.seats));
                setAreaId(table.areaId);`,
      `setEditTableId(table.id);
                setTableLabel(table.label || "");
                setTableSeats(String(table.seats));
                setAreaId(table.areaId);`,
      'edit fills tableLabel',
    );
  }

  // i18n: tableName in az/en/tr adminTables blocks
  if (!s.includes('tableName: "Masa adı"')) {
    s = replaceOnce(
      s,
      `addTable: "Masa əlavə et",
    emptyTables: "Bu zalda masa yoxdur",`,
      `addTable: "Masa əlavə et",
    tableName: "Masa adı",
    emptyTables: "Bu zalda masa yoxdur",`,
      'az tableName i18n',
    );
    s = replaceOnce(
      s,
      `addTable: "Add table",
    emptyTables: "No tables in this area",`,
      `addTable: "Add table",
    tableName: "Table name",
    emptyTables: "No tables in this area",`,
      'en tableName i18n',
    );
    s = replaceOnce(
      s,
      `addTable: "Masa ekle",
    emptyTables: "Bu salonda masa yok",`,
      `addTable: "Masa ekle",
    tableName: "Masa adı",
    emptyTables: "Bu salonda masa yok",`,
      'tr tableName i18n',
    );
  }

  // PIN change UI on AdminStaffPage
  if (!s.includes('changePinCurrent')) {
    s = replaceOnce(
      s,
      `function AdminStaffPage() {
  const { t } = useI18n();
  const [confirm, confirmDialog] = useConfirm();
  const [users, setUsers] = reactExports.useState([]);
  const [fullName, setFullName] = reactExports.useState("");
  const [pin, setPin] = reactExports.useState("");
  const [busy, setBusy] = reactExports.useState(false);`,
      `function AdminStaffPage() {
  const { t } = useI18n();
  const [confirm, confirmDialog] = useConfirm();
  const [users, setUsers] = reactExports.useState([]);
  const [fullName, setFullName] = reactExports.useState("");
  const [pin, setPin] = reactExports.useState("");
  const [busy, setBusy] = reactExports.useState(false);
  const [changePinCurrent, setChangePinCurrent] = reactExports.useState("");
  const [changePinNew, setChangePinNew] = reactExports.useState("");
  const [changePinConfirm, setChangePinConfirm] = reactExports.useState("");
  const [pinBusy, setPinBusy] = reactExports.useState(false);`,
      'pin change state',
    );

    s = replaceOnce(
      s,
      `  const deactivate = async (user) => {
    if (user.id === "usr-admin" || user.role === "administrator") return;`,
      `  const changeOwnPin = async () => {
    if (pinBusy) return;
    if (changePinNew.length < 4 || changePinNew !== changePinConfirm) {
      toast(t.staff.pinMismatch || "Yeni PIN eyni deyil / 4-8 rəqəm", "danger");
      return;
    }
    setPinBusy(true);
    const res = await window.pos.users.changePin({
      currentPin: changePinCurrent,
      newPin: changePinNew
    });
    setPinBusy(false);
    if (!res.success) {
      toast(res.error.message, "danger");
      return;
    }
    toast(t.staff.pinChanged || "PIN dəyişdirildi", "success");
    setChangePinCurrent("");
    setChangePinNew("");
    setChangePinConfirm("");
  };
  const deactivate = async (user) => {
    if (user.id === "usr-admin" || user.role === "administrator") return;`,
      'changeOwnPin handler',
    );

    // Insert PIN change card after the create form closing, before the staff list card
    const listCard = `      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "glass rounded-2xl p-5", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "font-display text-lg text-cream", children: t.staff.list }),`;

    mustInclude(s, listCard, 'staff list card');
    const pinCard = `      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "glass rounded-2xl p-5 md:col-span-2", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "font-display text-lg text-cream", children: t.staff.changePinTitle || "PIN dəyiş" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-1 text-sm text-muted", children: t.staff.changePinHint || "Giriş PIN-ini (məs. 9001) buradan dəyişin. Parametrlər → Personal." }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "mt-4 grid gap-3 sm:grid-cols-3", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "block text-sm", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-faint", children: t.staff.currentPin || "Cari PIN" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("input", { type: "password", inputMode: "numeric", maxLength: 8, value: changePinCurrent, onChange: (e) => setChangePinCurrent(e.target.value.replace(/\\D/g, "").slice(0, 8)), className: "mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-3 text-cream outline-none focus:border-gold/50" })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "block text-sm", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-faint", children: t.staff.newPin || "Yeni PIN" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("input", { type: "password", inputMode: "numeric", maxLength: 8, value: changePinNew, onChange: (e) => setChangePinNew(e.target.value.replace(/\\D/g, "").slice(0, 8)), className: "mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-3 text-cream outline-none focus:border-gold/50" })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "block text-sm", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-faint", children: t.staff.confirmPin || "Yeni PIN (təkrar)" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("input", { type: "password", inputMode: "numeric", maxLength: 8, value: changePinConfirm, onChange: (e) => setChangePinConfirm(e.target.value.replace(/\\D/g, "").slice(0, 8)), className: "mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-3 text-cream outline-none focus:border-gold/50" })
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", disabled: pinBusy || changePinCurrent.length < 4 || changePinNew.length < 4 || changePinNew !== changePinConfirm, onClick: () => void changeOwnPin(), className: "btn-gold mt-4 disabled:opacity-40", children: t.staff.changePinSave || "PIN-i yadda saxla" })
      ] }),
` + listCard;

    s = s.replace(listCard, pinCard);
  }

  // staff i18n strings (az block around pin:)
  if (!s.includes('changePinTitle: "PIN dəyiş"')) {
    s = replaceOnce(
      s,
      `pin: "PIN (4-8 rəqəm)",`,
      `pin: "PIN (4-8 rəqəm)",
    changePinTitle: "PIN dəyiş",
    changePinHint: "Giriş PIN-ini (məs. 9001) özünüz dəyişə bilərsiniz.",
    currentPin: "Cari PIN",
    newPin: "Yeni PIN",
    confirmPin: "Yeni PIN (təkrar)",
    changePinSave: "PIN-i yadda saxla",
    pinChanged: "PIN dəyişdirildi",
    pinMismatch: "Yeni PIN eyni deyil və ya qısadır",`,
      'az staff pin i18n',
    );
  }

  return s;
}

function patchMain(src) {
  let s = src;

  if (!s.includes('"users.changePin"')) {
    s = replaceOnce(
      s,
      `"users.create":{auth:!0,perm:"users.manage",timeout:3e3,idempotent:!0},"users.deactivate":{auth:!0,perm:"users.manage",timeout:3e3,idempotent:!0},"users.list":{auth:!0,perm:"users.manage",timeout:3e3,idempotent:!1},`,
      `"users.create":{auth:!0,perm:"users.manage",timeout:3e3,idempotent:!0},"users.deactivate":{auth:!0,perm:"users.manage",timeout:3e3,idempotent:!0},"users.list":{auth:!0,perm:"users.manage",timeout:3e3,idempotent:!1},"users.changePin":{auth:!0,perm:"users.manage",timeout:8e3,idempotent:!1},`,
      'Cn protocol users.changePin',
    );
  }

  if (!s.includes('async function _psChangePin')) {
    const helper = `
async function _psVerifyPinHash(pin, stored){if(typeof stored!="string"||!stored.startsWith("pbkdf2$"))return!1;const p=stored.split("$");if(p.length!==5)return!1;const iter=Number(p[2]),salt=Buffer.from(p[3],"hex"),want=p[4];if(!Number.isFinite(iter)||iter<1e3||salt.length<8||want.length!==64)return!1;const got=await new Promise((resolve,reject)=>W.pbkdf2(String(pin),salt,iter,32,"sha256",(err,key)=>err?reject(err):resolve(key.toString("hex"))));return got===want}
async function _psHashPin(pin){const salt=W.randomBytes(16),iter=12e4,digest=await new Promise((resolve,reject)=>W.pbkdf2(String(pin),salt,iter,32,"sha256",(err,key)=>err?reject(err):resolve(key.toString("hex"))));return ["pbkdf2","sha256",String(iter),salt.toString("hex"),digest].join("$")}
async function _psChangePin(t){const session=ce();if(!session)return d("E_UNAUTHORIZED","Əvvəlcə daxil olun");if(!session.permissions?.includes("users.manage")&&!session.permissions?.includes("settings.manage"))return d("E_FORBIDDEN","PIN dəyişmək üçün icazə yoxdur");const currentPin=String(t?.currentPin??""),newPin=String(t?.newPin??""),userId=String(t?.userId??session.userId??"");if(!/^\\d{4,8}$/.test(currentPin)||!/^\\d{4,8}$/.test(newPin))return d("E_VALIDATION","PIN 4-8 rəqəm olmalıdır");if(currentPin===newPin)return d("E_VALIDATION","Yeni PIN cari PIN-lə eyni ola bilməz");if(!userId)return d("E_VALIDATION","İstifadəçi tapılmadı");try{const{DatabaseSync}=await import("node:sqlite");const db=new DatabaseSync(Me());const row=db.prepare("SELECT id, pin_hash, active FROM users WHERE id = ?").get(userId);if(!row||Number(row.active)!==1){db.close();return d("E_NOT_FOUND","İstifadəçi tapılmadı")}const ok=await _psVerifyPinHash(currentPin,String(row.pin_hash??""));if(!ok){db.close();return d("E_UNAUTHORIZED","Cari PIN yanlışdır")}const hash=await _psHashPin(newPin);const now=Date.now();db.prepare("UPDATE users SET pin_hash = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?").run(hash,now,userId);db.close();return y({ok:!0,userId})}catch(err){return d("E_INTERNAL",err instanceof Error?err.message:String(err))}}
`;
    s = s.replace(
      'async function Is(e,t){switch(e){',
      helper + 'async function Is(e,t){switch(e){',
    );
  }

  if (!s.includes('case"users.changePin"')) {
    s = replaceOnce(
      s,
      'case"receiptLogo.apply":return _psReceiptLogoApply(t);case"receiptLogo.clear":return _psReceiptLogoClear();case"receiptLogo.normalizeBranding":return _psNormalizeBranding();default:return null}',
      'case"receiptLogo.apply":return _psReceiptLogoApply(t);case"receiptLogo.clear":return _psReceiptLogoClear();case"receiptLogo.normalizeBranding":return _psNormalizeBranding();case"users.changePin":return _psChangePin(t);default:return null}',
      'Is users.changePin case',
    );
  }

  return s;
}

function patchPreload(src) {
  let s = src;
  if (s.includes('changePin:')) return s;
  return replaceOnce(
    s,
    `  users: {
    list: () => call("users.list"),
    create: (payload, options) => call("users.create", payload, options),
    deactivate: (userId, options) => call("users.deactivate", { userId }, options)
  },`,
    `  users: {
    list: () => call("users.list"),
    create: (payload, options) => call("users.create", payload, options),
    deactivate: (userId, options) => call("users.deactivate", { userId }, options),
    changePin: (payload) => call("users.changePin", payload)
  },`,
    'preload users.changePin',
  );
}

function packLinuxAsar() {
  if (!fs.existsSync(LINUX_ASAR)) {
    console.warn('Linux asar not found, skip pack:', LINUX_ASAR);
    return;
  }
  const tmp = path.join(root, '.tmp-asar-pack');
  fs.rmSync(tmp, { recursive: true, force: true });
  execFileSync('npx', ['--yes', 'asar', 'extract', LINUX_ASAR, tmp], { stdio: 'inherit' });

  const copyPairs = [
    [RENDERER, path.join(tmp, 'out/renderer/assets/index-BsrHjfOR.js')],
    [MAIN, path.join(tmp, 'out/main/index.js')],
    [PRELOAD, path.join(tmp, 'out/preload/index.js')],
  ];
  for (const [from, to] of copyPairs) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    console.log('asar <-', path.relative(root, from));
  }

  const bak = LINUX_ASAR + '.bak-pin-tables';
  if (!fs.existsSync(bak)) fs.copyFileSync(LINUX_ASAR, bak);
  execFileSync('npx', ['--yes', 'asar', 'pack', tmp, LINUX_ASAR], { stdio: 'inherit' });
  console.log('Updated', LINUX_ASAR);
}

function main() {
  for (const f of [RENDERER, MAIN, PRELOAD]) {
    if (!fs.existsSync(f)) throw new Error('Missing ' + f);
  }

  const renderer = patchRenderer(fs.readFileSync(RENDERER, 'utf8'));
  fs.writeFileSync(RENDERER, renderer);
  console.log('patched renderer');

  const mainJs = patchMain(fs.readFileSync(MAIN, 'utf8'));
  fs.writeFileSync(MAIN, mainJs);
  console.log('patched main');

  const preload = patchPreload(fs.readFileSync(PRELOAD, 'utf8'));
  fs.writeFileSync(PRELOAD, preload);
  console.log('patched preload');

  packLinuxAsar();
  console.log('OK');
}

main();
