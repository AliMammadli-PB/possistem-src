'use strict';
// Shared by the POS and API. Contains no credentials or customer-specific paths.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib'),{promisify}=require('node:util'),{execFile}=require('node:child_process');
const gzip=promisify(zlib.gzip),gunzip=promisify(zlib.gunzip);
// nginx takes 64m per request (client_max_body_size) and the multipart wrapper needs a little of that.
const MAX_BUNDLE=60*1024*1024,MAX_RAW=200*1024*1024,MAX_DB=90*1024*1024,MAX_IMAGES=36*1024*1024,MAX_FILES=1000,FORMAT='possistem-restaurant-backup-v1';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const assetName=/^[a-f0-9]{64}\.png$/;
function sqliteHeader(db){if(!Buffer.isBuffer(db)||db.length<512||db.length>MAX_RAW||db.subarray(0,16).toString()!=='SQLite format 3\0')throw Error('SQLITE_INVALID');}
// Compressed off the main thread: this runs on a till in the middle of a sale. Same content gives the same bytes, so an unchanged till is one stored copy.
async function pack(db,assets,meta={}){
 sqliteHeader(db);
 const raw=Buffer.from(JSON.stringify({format:FORMAT,meta,database:{sha256:sha(db),base64:db.toString('base64')},assets:assets.map(a=>({name:a.name,sha256:sha(a.bytes),base64:a.bytes.toString('base64')}))}));
 if(raw.length>MAX_RAW)throw Error('BACKUP_TOO_LARGE');
 const packed=await gzip(raw);
 if(packed.length>MAX_BUNDLE)throw Error('BACKUP_TOO_LARGE');
 return packed;
}
async function decode(packed){
 if(!Buffer.isBuffer(packed)||packed.length>MAX_BUNDLE)throw Error('BACKUP_TOO_LARGE');
 const raw=await gunzip(packed,{maxOutputLength:MAX_RAW}),x=JSON.parse(raw.toString('utf8'));
 if(x?.format!==FORMAT||!x.database||!Array.isArray(x.assets)||x.assets.length>MAX_FILES)throw Error('BACKUP_FORMAT_INVALID');
 const db=Buffer.from(String(x.database.base64),'base64');
 sqliteHeader(db);
 if(sha(db)!==x.database.sha256)throw Error('BACKUP_CHECKSUM_INVALID');
 let total=db.length;const names=new Set();
 const assets=x.assets.map(a=>{
  if(!assetName.test(a.name)||names.has(a.name))throw Error('BACKUP_ASSET_INVALID');
  names.add(a.name);
  const bytes=Buffer.from(String(a.base64),'base64'),hash=sha(bytes);total+=bytes.length;
  if(bytes.length>15*1024*1024||hash!==a.sha256||a.name!==hash+'.png'||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('BACKUP_ASSET_INVALID');
  return{name:a.name,bytes};
 });
 if(total>MAX_RAW)throw Error('BACKUP_TOO_LARGE');
 return{database:db,assets,meta:{customerId:x.meta?.customerId,deviceId:x.meta?.deviceId,appVersion:String(x.meta?.appVersion||'').slice(0,40)},sha256:sha(packed)};
}
// ponytail: photos past MAX_IMAGES stay out and show up as missingAssets, because sales matter more than pictures. Upload each picture once by its hash if shops hit this.
async function make(dbPath,assetsDir,meta){
 if((await fs.stat(dbPath)).size>MAX_DB)throw Error('BACKUP_TOO_LARGE');
 const db=await fs.readFile(dbPath),assets=[];let images=0;
 const entries=await fs.readdir(assetsDir,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return[];throw e});
 for(const name of entries.filter(e=>e.isFile()&&assetName.test(e.name)).map(e=>e.name).sort()){
  const file=path.join(assetsDir,name),size=(await fs.stat(file)).size;
  if(assets.length>=MAX_FILES||size>15*1024*1024||images+size>MAX_IMAGES)continue;
  images+=size;assets.push({name,bytes:await fs.readFile(file)});
 }
 return pack(db,assets,meta);
}
async function unpack(packed,dbPath,assetsDir){
 const value=await decode(packed);
 await fs.mkdir(assetsDir,{recursive:true,mode:0o700});
 for(const asset of value.assets){
  const target=path.join(assetsDir,asset.name);
  try{await fs.writeFile(target,asset.bytes,{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST'||sha(await fs.readFile(target))!==sha(asset.bytes))throw e;}
 }
 await fs.writeFile(dbPath,value.database,{flag:'wx',mode:0o600});
 return value;
}
// Run SQLite outside the API process. Read-only, bounded runtime, no user SQL.
// A picture the till no longer has must not cost the shop its whole backup, so it is counted, not refused.
async function verifyDatabase(file,assetNames){
 const program=`import sqlite3,json,sys
c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)
c.execute('PRAGMA query_only=ON')
if c.execute('PRAGMA quick_check').fetchall()!=[('ok',)]: raise Exception('SQLITE_INTEGRITY_FAILED')
tables={r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
required={'menu_items','orders','payments','backup_manifests','users','app_settings','stock_levels','cash_accounts','customers'}
if not required.issubset(tables): raise Exception('NOT_RESTAURANT_DATABASE')
counts={t:c.execute('SELECT count(*) FROM "'+t+'"').fetchone()[0] for t in sorted(required|({'menu_categories','ingredients','menu_item_ingredients','salary_payments','customer_ledger'}&tables))}
refs=[r[0].split('/')[-1] for r in c.execute("SELECT image FROM menu_items WHERE image LIKE 'app://local/user-assets/%'")]
print(json.dumps({'tables':counts,'assetRefs':refs,'schemaVersion':c.execute('PRAGMA user_version').fetchone()[0]}))
`;
 const {stdout}=await promisify(execFile)('python3',['-c',program,path.resolve(file)],{timeout:20000,maxBuffer:4*1024*1024});
 const {assetRefs,...info}=JSON.parse(stdout),available=new Set(assetNames);
 return{...info,missingAssets:new Set(assetRefs.filter(n=>!available.has(n))).size};
}
// ponytail: the key sits beside the files, so this protects a copied .enc, not a taken server. Keep a copy of master.key off the server: losing it loses every backup.
async function masterKey(dir){await fs.mkdir(dir,{recursive:true,mode:0o700});await fs.chmod(dir,0o700);const file=path.join(dir,'master.key');try{const k=await fs.readFile(file);if(k.length!==32)throw Error('BACKUP_KEY_INVALID');return k;}catch(e){if(e.code!=='ENOENT')throw e;const existing=await fs.readdir(dir);if(existing.some(n=>n.endsWith('.enc')))throw Error('BACKUP_KEY_MISSING');const key=crypto.randomBytes(32);try{await fs.writeFile(file,key,{mode:0o600,flag:'wx'});return key;}catch(x){if(x.code==='EEXIST')return fs.readFile(file);throw x;}}}
function encrypt(bytes,key,aad){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(aad));return Buffer.concat([Buffer.from('PSB1'),iv,cipher.update(bytes),cipher.final(),cipher.getAuthTag()]);}
function decrypt(bytes,key,aad){if(bytes.subarray(0,4).toString()!=='PSB1')throw Error('BACKUP_ENCRYPTION_FORMAT');const decipher=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(4,16));decipher.setAAD(Buffer.from(aad));decipher.setAuthTag(bytes.subarray(-16));return Buffer.concat([decipher.update(bytes.subarray(16,-16)),decipher.final()]);}
module.exports={FORMAT,MAX_BUNDLE,MAX_RAW,MAX_IMAGES,sha,pack,decode,make,unpack,verifyDatabase,masterKey,encrypt,decrypt};
