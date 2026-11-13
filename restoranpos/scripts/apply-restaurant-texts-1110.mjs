#!/usr/bin/env node
/** Spelling found in the 2026-11-10 audit: a receipt is "çek"; "çək" is "weight". ("çəkili" for weighted goods stays.) */
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const file=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','index-DAmHwBc4.js');
let s=fs.readFileSync(file,'utf8');
for(const [a,b] of [['xSuccess: "X hesabat hazırlandı və çək göndərildi"','xSuccess: "X hesabat hazırlandı və çek göndərildi"'],['aralıq hesabat. Avtomatik çək çıxır:','aralıq hesabat. Avtomatik çek çıxır:']]){
 if(s.includes(b))continue;if(s.split(a).length!==2)throw Error('texts-1110: anchor changed: '+a);s=s.replace(a,b);}
fs.writeFileSync(file,s);
