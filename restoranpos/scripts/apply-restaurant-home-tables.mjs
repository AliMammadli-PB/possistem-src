#!/usr/bin/env node
/**
 * Restoran POS opens on Masalar. The owner asked for the floor to be the first screen after the PIN,
 * administrators included; 1.9.8 had sent administrators to İdarə. Other roles keep their own home
 * (kitchen → KDS, storekeeper → stock), which homeRouteForRole already chooses by permission.
 */
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const file=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','index-DAmHwBc4.js');
let s=fs.readFileSync(file,'utf8');
const MARK='/* POS_HOME_TABLES_1108 */';
if(!s.includes(MARK)){
 const find='  /* POS_BOOTSTRAP_LOGIN_198 */\n  if (role === "administrator") return "/admin";';
 if(s.split(find).length!==2)throw Error('home-tables: administrator home anchor changed');
 s=s.replace(find,'  /* POS_BOOTSTRAP_LOGIN_198 */\n  '+MARK+'\n  if (role === "administrator") return "/tables";');
 fs.writeFileSync(file,s);
}
