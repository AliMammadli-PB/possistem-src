#!/usr/bin/env node
/**
 * Remote commands (X/Z reports, sold-out toggles, ...) run only when possistem
 * signed them for this till.
 *
 * They arrive in the owner-sync response and used to run on the strength of
 * HTTPS alone. The control plane now signs each one with the licence key
 * (type "pos-command", command id, customer, device, issuedAt, expiresAt); main
 * runs the signed copy only after _psVerifyLicenseEnvelope() accepts it for
 * this device and customer, before it expires, and never twice. A refused
 * command is reported back as failed so it does not stay pending on the site.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = path.join(ROOT, 'index.js');
const MARK = '/* POS_COMMAND_SIGNATURE_v1 */';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  must(n === 1, `${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

const HELPER = `${MARK}const _psSeenCommands=new Set;function _psVerifyCommand(cmd,e){try{const s=cmd&&cmd.signed,p=s&&s.payload;if(!_psVerifyLicenseEnvelope(s,null))return null;if(p.type!=="pos-command"||p.id!==cmd.id||p.deviceId!==e.deviceId||e.customerId&&p.customerId!==e.customerId)return null;if(!(Number(p.expiresAt)>Date.now())||Number(p.issuedAt)>Date.now()+3e5||_psSeenCommands.has(p.id))return null;_psSeenCommands.add(p.id);return{id:p.id,command:p.command,args:p.args&&typeof p.args=="object"?p.args:{}}}catch{return null}}`;

let main = fs.readFileSync(MAIN, 'utf8');
if (!main.includes(MARK)) {
  must(main.includes('/* POS_LICENSE_SIGNATURE_v1 */'), 'run apply-restaurant-license-signature.mjs first');
  main = replaceOnce(main,
    'const u=i.data?.commands??[];u.length>0&&await Ps(u,async l=>{const g=await de(e.baseUrl,"/owner/device/command-result",le({deviceId:e.deviceId,deviceFingerprint:e.fingerprint,...l}).body,an().token);g.ok||v.warn("command_result_failed",{id:l.commandId,error:g.error})})',
    'const report=async l=>{const g=await de(e.baseUrl,"/owner/device/command-result",le({deviceId:e.deviceId,deviceFingerprint:e.fingerprint,...l}).body,an().token);g.ok||v.warn("command_result_failed",{id:l.commandId,error:g.error})};const u=[];for(const cmd of i.data?.commands??[]){const ok=_psVerifyCommand(cmd,e);if(ok){u.push(ok);continue}v.warn("command_refused_unsigned",{id:cmd&&cmd.id});cmd&&cmd.id&&await report({commandId:cmd.id,ok:!1,error:"Əmr imzası etibarsızdır",errorCode:"E_COMMAND_SIGNATURE"}).catch(()=>{})}u.length>0&&await Ps(u,report)',
    'verify commands before running them');
  main = replaceOnce(main, 'async function _psRevokeLicense(', `${HELPER}async function _psRevokeLicense(`, 'helper');
  fs.writeFileSync(MAIN, main);
  console.log('command signature checks applied', MAIN);
} else {
  console.log('command signature checks already applied', MAIN);
}
