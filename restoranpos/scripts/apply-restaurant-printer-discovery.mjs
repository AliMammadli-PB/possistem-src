#!/usr/bin/env node
/** Keep touch printer setup readable and safe in the recovered renderer bundle. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {transform} from 'esbuild';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const file=path.join(root,'index-DAmHwBc4.js');
let bundle=fs.readFileSync(file,'utf8');
const marker='/* POS_PRINTER_DISCOVERY_v1 */';
let page;

function once(oldText,newText,label){
  const index=page.indexOf(oldText);
  if(index<0||page.indexOf(oldText,index+oldText.length)>=0)throw Error(`Printer setup changed: ${label}`);
  page=page.slice(0,index)+newText+page.slice(index+oldText.length);
}
function onceInTest(oldText,newText,label){
  const start=page.indexOf('  const runTestPrint = async (target) => {');
  const end=page.indexOf('  const applyDisplay =',start);
  const index=page.indexOf(oldText,start);
  if(start<0||end<0||index<start||index>=end||page.indexOf(oldText,index+oldText.length)<end&&page.indexOf(oldText,index+oldText.length)>=0)throw Error(`Printer test changed: ${label}`);
  page=page.slice(0,index)+newText+page.slice(index+oldText.length);
}

if(!bundle.includes(marker)){
  const start=bundle.indexOf('function SettingsPage()');
  const end=bundle.indexOf('\nconst ICONS =',start);
  if(start<0||end<0)throw Error('SettingsPage not found');
  page=bundle.slice(start,end);

  once('  const [wizardBusy, setWizardBusy] = reactExports.useState(false);',
    '  const [wizardBusy, setWizardBusy] = reactExports.useState(false);\n  const [wizardPrinted, setWizardPrinted] = reactExports.useState(false);','printed state');
  once('    if (!target) { toast(t.settings.printerTargetInvalid, "danger"); return; }\n    setAssigningRole(role + ":" + target);',
    '    if (!target) { toast(t.settings.printerTargetInvalid, "danger"); return false; }\n    setAssigningRole(role + ":" + target);','invalid assignment');
  once('    const res = await window.pos.print.setPrinter(role, target);\n    setAssigningRole("");',
    '    let res;\n    try { res = await window.pos.print.setPrinter(role, target); }\n    catch (error) { setAssigningRole(""); toast(error.message || String(error), "danger"); return false; }\n    setAssigningRole("");','assignment transport failure');
  once('    if (!res.success) { toast(res.error.message, "danger"); return; }\n    setRoleTargets((prev) => ({ ...prev, [role]: target }));',
    '    if (!res.success) { toast(res.error.message, "danger"); return false; }\n    setRoleTargets((prev) => ({ ...prev, [role]: target }));','failed assignment');
  once('    toast(label + " printeri yadda saxlanıldı", "success");\n  };',
    '    toast(label + " printeri yadda saxlanıldı", "success");\n    return true;\n  };','assignment success');
  once('    setWizardManual(false); setWizardAddress(""); setWizardNote("");',
    '    setWizardManual(false); setWizardAddress(""); setWizardNote(""); setWizardPrinted(false);','close wizard');
  once('    setWizardManual(false); setWizardNote("");\n    // Prefill',
    '    setWizardManual(false); setWizardNote(""); setWizardPrinted(false);\n    // Prefill','open wizard');
  once('    const res = await window.pos.print.detect({ probe: false });\n    setWizardBusy(false);\n    if (!res.success) { toast(res.error.message, "danger"); return; }\n    const found = (res.data.candidates ?? []).filter((p) => p.connection !== "virtual");\n    setDetectedPrinters(res.data.candidates ?? []);',
    '    let res;\n    try { res = await window.pos.print.detect({ probe: false }); }\n    catch (error) { setWizardBusy(false); setWizardNote(error.message || String(error)); return; }\n    setWizardBusy(false);\n    if (!res.success) { setWizardNote(res.error?.message || t.settings.printerDetectFail); return; }\n    const found = (res.data?.candidates ?? []).filter((p) => p.connection !== "virtual");\n    setDetectedPrinters(res.data?.candidates ?? []);','discovery transport failure');
  once('    setWizardAt(index);\n    setWizardNote("");\n    setWizardBusy(true);\n    await runTestPrint(list[index].name);\n    setWizardBusy(false);',
    '    setWizardAt(index);\n    setWizardNote("");\n    setWizardPrinted(false);\n    setWizardBusy(true);\n    const printed = await runTestPrint(list[index].name);\n    setWizardBusy(false);\n    setWizardPrinted(printed === true);\n    if (!printed) setWizardNote(psAdminText("Yoxlama çeki göndərilmədi. Bağlantını yoxlayın və növbəti cihazı sınayın.", "Test fişi gönderilemedi. Bağlantıyı kontrol edip sonraki cihazı deneyin.", "Test receipt could not be sent. Check the connection and try the next printer."));','candidate probe');
  once('    await assignPrinterRole(setupRole, target);\n    closeWizard();',
    '    if (!wizardManual && !wizardPrinted) return;\n    if (await assignPrinterRole(setupRole, target)) closeWizard();','keep selected printer');
  once('    if(testPrintLock.current)return;', '    if(testPrintLock.current)return false;','duplicate test');
  once('      toast(t.settings.printerTargetInvalid, "danger");\n      return;\n    }\n    let options;',
    '      toast(t.settings.printerTargetInvalid, "danger");\n      return false;\n    }\n    let options;','test target');
  once('    let options;try{options=printDraft();}catch(error){toast(error.message,"danger");return;}',
    '    let options;try{options=printDraft();}catch(error){toast(error.message,"danger");return false;}','test options');
  once('    }catch(error){toast(error.message,"danger");return;}finally{testPrintLock.current=false;setTestingPrint(false);}',
    '    }catch(error){toast(error.message,"danger");return false;}finally{testPrintLock.current=false;setTestingPrint(false);}','test transport failure');
  onceInTest('    if (!res.success) {\n      toast(res.error.message, "danger");\n      return;\n    }\n    const data = res.data;',
    '    if (!res.success) {\n      toast(res.error.message, "danger");\n      return false;\n    }\n    const data = res.data;','test queue failure');
  once('        "danger"\n      );\n      return;\n    }\n    toast(fill$1(t.settings.testPrintOk',
    '        "danger"\n      );\n      return false;\n    }\n    toast(fill$1(t.settings.testPrintOk','test incomplete');
  once('    const printers = await window.pos.print.printers();\n    if (printers.success && printers.data && typeof printers.data === "object") {',
    '    const printers = await window.pos.print.printers().catch(() => null);\n    if (printers?.success && printers.data && typeof printers.data === "object") {','refresh printer state');
  once('        setSelectedTarget(receipt);\n      }\n    }\n  };\n  const applyDisplay',
    '        setSelectedTarget(receipt);\n      }\n    }\n    return true;\n  };\n  const applyDisplay','test success');

  const sectionStart=page.indexOf('SettingsAccordion, { id: "printer"');
  const sectionEnd=page.indexOf('SettingsAccordion, { id: "system"',sectionStart);
  if(sectionStart<0||sectionEnd<0)throw Error('Printer settings section changed');
  let section=page.slice(sectionStart,sectionEnd);
  const replaceSection=(oldText,newText,label)=>{
    const i=section.indexOf(oldText);
    if(i<0||section.indexOf(oldText,i+oldText.length)>=0)throw Error(`Printer section changed: ${label}`);
    section=section.slice(0,i)+newText+section.slice(i+oldText.length);
  };
  replaceSection('className: "space-y-3", children: [\n        /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "font-display text-lg text-cream", children: t.settings.printer }),',
    'className: "ps-printer-section space-y-4", children: [\n        /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "font-display text-lg text-cream", children: psAdminText("Printer qoşulması", "Yazıcı kurulumu", "Printer setup") }),','section header');
  replaceSection('className: "rounded-2xl border border-hairline bg-elevated p-4", children: [\n          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs uppercase tracking-wide text-faint", children: "Printerləri tənzimlə" }),',
    'className: "ps-printer-setup", children: [\n          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-printer-eyebrow", children: psAdminText("1. Printerin yerini seçin və axtarın", "1. Yazıcının yerini seçip arayın", "1. Choose where the printer is used, then search") }),','setup panel');
  replaceSection('            const known = target && target !== "auto";',
    '            const virtual = /^virtual\\b/i.test(target || "");\n            const known = target && target !== "auto" && !virtual;','virtual status');
  replaceSection('className: `rounded-xl border px-4 py-3 ${open ? "border-gold/50 bg-gold/5" : "border-hairline"}`',
    'className: `ps-printer-role ${open ? "is-open" : ""}`','role card');
  replaceSection('className: "text-sm font-medium text-cream", children: [role.label, " printeri"]',
    'className: "ps-printer-role-title", children: [role.label, " printeri"]','role title');
  replaceSection('className: `mt-0.5 truncate text-xs ${known ? "text-muted" : "text-warning"}`, children: known ? (listed ? printerLabel(listed) : target) : "Seçilməyib"',
    'className: `ps-printer-role-status ${known ? "is-ready" : "is-missing"}`, children: known ? (listed ? printerLabel(listed) : target) : virtual ? psAdminText("Virtual printer — kağız çap etmir", "Sanal yazıcı — kağıt basmaz", "Virtual printer — no paper output") : psAdminText("Printer seçilməyib", "Yazıcı seçilmedi", "No printer selected")','role status');
  replaceSection('onClick: () => open ? closeWizard() : openWizard(role.id),\n                  className: "touch-target shrink-0 rounded-xl border border-gold/40 bg-gold/10 px-4 py-2 text-sm text-gold hover:bg-gold/20",\n                  children: open ? "Bağla" : (known ? "Dəyiş" : "Təyin et")',
    'disabled: wizardBusy || assigningRole !== "",\n                  onClick: () => { if (open) closeWizard(); else { openWizard(role.id); void wizardFind(); } },\n                  className: "ps-printer-find-button",\n                  children: open ? psAdminText("Bağla", "Kapat", "Close") : known ? psAdminText("Dəyişdir", "Değiştir", "Change") : psAdminText("Printeri tap", "Yazıcı bul", "Find printer")','primary discovery button');
  replaceSection('children: wizardBusy && !wizardManual ? "Yoxlanılır…" : "Printeri tap"',
    'children: wizardBusy && !wizardManual ? psAdminText("Axtarılır…", "Aranıyor…", "Searching…") : psAdminText("Yenidən axtar", "Yeniden ara", "Search again")','retry label');
  replaceSection('disabled: wizardBusy || assigningRole !== "",\n                      onClick: () => void wizardKeep(wizardList[wizardAt].name)',
    'disabled: wizardBusy || assigningRole !== "" || !wizardPrinted,\n                      onClick: () => void wizardKeep(wizardList[wizardAt].name)','confirm after successful test');
  const tagBefore=(term,oldClass,newClass,label)=>{
    const at=section.indexOf(term);
    const classAt=section.lastIndexOf(`className: "${oldClass}"`,at);
    if(at<0||classAt<0||at-classAt>420)throw Error(`Printer section changed: ${label}`);
    section=section.slice(0,classAt)+section.slice(classAt).replace(`className: "${oldClass}"`,`className: "${newClass}"`);
  };
  tagBefore('onClick: () => setManualOpen((open) => !open)','rounded-xl border border-hairline','ps-printer-legacy-manual','old manual input');
  tagBefore('t.settings.printerTarget,','rounded-xl border border-hairline bg-elevated px-4 py-2 font-mono text-xs text-faint','ps-printer-legacy-target','old target label');
  tagBefore('onClick: () => void savePrinterTarget()','flex flex-wrap gap-2','ps-printer-legacy-actions','old save action');
  replaceSection('className: "text-xs text-muted", children: t.settings.testPrintHint',
    'className: "ps-printer-legacy-hint", children: t.settings.testPrintHint','old test hint');
  page=page.slice(0,sectionStart)+section+page.slice(sectionEnd);
  bundle=marker+'\n'+bundle.slice(0,start)+page+bundle.slice(end);
}
await transform(bundle,{loader:'js',target:'es2022'});
fs.writeFileSync(file,bundle);
console.log('Printer discovery refreshed');
