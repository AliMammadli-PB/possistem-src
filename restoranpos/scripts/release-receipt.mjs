import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export function writeReleaseReceipt({release,app,version,installer,config}) {
 const electronVersion=/^electronVersion:\s*([^\s]+)/m.exec(fs.readFileSync(config,'utf8'))?.[1];
 if(!electronVersion)throw Error('Explicit Electron version missing from build config');
 const sha512=crypto.createHash('sha512').update(fs.readFileSync(installer)).digest('base64');
 fs.writeFileSync(path.join(release,'build-security.json'),JSON.stringify({app,version,electronVersion,sha512},null,2)+'\n');
}
