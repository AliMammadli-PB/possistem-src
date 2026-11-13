#!/usr/bin/env node
/**
 * İşçilər → Yeni işçi can add a courier. A courier does not sign in to the till, so the PIN field becomes the phone
 * and the record goes to the delivery couriers (delivery.saveCourier), the same list Çatdırılma → Yeni kuryer fills.
 */
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const file=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','index-DAmHwBc4.js');
let s=fs.readFileSync(file,'utf8');
const MARK='/* STAFF_COURIER_1110 */';
const once=(a,b)=>{if(s.split(a).length!==2)throw Error('staff-courier: anchor changed: '+a.slice(0,90));s=s.replace(a,b);};
if(!s.includes(MARK)){
 once('  const [editingUser, setEditingUser] = reactExports.useState(null);','  const [editingUser, setEditingUser] = reactExports.useState(null);\n  '+MARK+' const [psPhone, setPsPhone] = reactExports.useState("");');
 once('    if (!fullName.trim() || pin.length < 4 || busy) return;',`    if (role === "courier") {
      if (fullName.trim().length < 2 || busy || typeof window.pos.delivery?.saveCourier !== "function") return;
      setBusy(true);
      const res = await window.pos.delivery.saveCourier({ name: fullName.trim(), phone: psPhone.trim() });
      setBusy(false);
      if (!res.success) { toast(res.error.message, "danger"); return; }
      toast("Kuryer əlavə olundu. Çatdırılmada seçmək olar.", "success");
      setFullName(""); setPsPhone(""); setRole("waiter");
      return;
    }
    if (!fullName.trim() || pin.length < 4 || busy) return;`);
 once('children: t.staff.pin }),','children: role === "courier" ? "Telefon" : t.staff.pin }),');
 once(`                  type: "password",
                  inputMode: "numeric",
                  pattern: "[0-9]*",
                  maxLength: 4,
                  value: pin,
                  onChange: (e) => setPin(e.target.value.replace(/\\D/g, "").slice(0, 4)),`,`                  ...(role === "courier" ? { type: "tel", inputMode: "tel", maxLength: 40, value: psPhone, onChange: (e) => setPsPhone(e.target.value.slice(0, 40)) } : {
                  type: "password",
                  inputMode: "numeric",
                  pattern: "[0-9]*",
                  maxLength: 4,
                  value: pin,
                  onChange: (e) => setPin(e.target.value.replace(/\\D/g, "").slice(0, 4)) }),`);
 once('children: (roles.length ? roles : ["waiter", "cashier", "kitchen", "storekeeper", "supervisor", "manager"]).map(','children: [...(roles.length ? roles : ["waiter", "cashier", "kitchen", "storekeeper", "supervisor", "manager"]).filter((name) => name !== "courier"), ...(useAuthStore.getState().hasPermission("delivery.manage") ? ["courier"] : [])].map(');
 once('"Vəzifənin icazələri «Səlahiyyətlər» vərəqində təyin olunur." })','role === "courier" ? "Kuryer kassaya daxil olmur: PIN lazım deyil, çatdırılma sifarişində seçilir. Siyahı: İdarə → Çatdırılma." : "Vəzifənin icazələri «Səlahiyyətlər» vərəqində təyin olunur." })');
 once('disabled: busy || fullName.trim().length < 2 || pin.length < 4,','disabled: busy || fullName.trim().length < 2 || role !== "courier" && pin.length < 4,');
 fs.writeFileSync(file,s);
}
