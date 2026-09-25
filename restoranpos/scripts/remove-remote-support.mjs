#!/usr/bin/env node
/** Remove RustDesk / remote access from patched POS out/main/index.js */
import fs from 'node:fs';

const MAIN = process.argv[2] || '/home/panda/Desktop/Projects/possistem/out/main/index.js';
let s = fs.readFileSync(MAIN, 'utf8');

s = s.replace(
  /setImmediate\(\(\)=>\{try\{Dn\(require\("\.\/rustdesk-helper\.js"\)\)\.ensureDaemon\(\)\}catch\(rdErr\)\{Se\.warn\("rustdesk_daemon_failed",\{message:rdErr instanceof Error\?rdErr\.message:String\(rdErr\)\}\)\}\}\);/,
  '',
);

s = s.replace(
  /async function _psDoRemote\(e,t,n\)\{const w=Dn\(require\("\.\/rustdesk-helper\.js"\)\),r=!0,a=Bt\.networkInterfaces\(\),i=\[\];for\(const l of Object\.values\(a\|\|\{\}\)\)for\(const f of l\|\|\[\]\)f\.family==="IPv4"&&!f\.internal&&i\.push\(f\.address\);const h=w\.getStatus\(\),o=h\.id,u=h\.password,l=le\(\{deviceId:e\.deviceId,deviceFingerprint:e\.fingerprint,ticketId:t\.id,actionId:n\.id,approved:r,hostname:Bt\.hostname\(\),platform:process\.platform,ips:i,rustdeskId:o,rustdeskPassword:u\}\);await de\(e\.baseUrl,"\/owner\/device\/support\/remote-info",l\.body,e\.token\)\}/,
  '',
);

s = s.replace(
  /else s\.type==="remoteAccess"&&\(_psHandledActions\.add\(s\.id\),await _psDoRemote\(n,t,s\)\)/,
  '',
);

fs.writeFileSync(MAIN, s);
console.log('patched', MAIN);
