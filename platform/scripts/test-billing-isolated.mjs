// Run on the control host. Creates and drops a dedicated test database; the
// production connection is read only to discover the DB owner/port, never used
// by the billing tests. Gateway requests use an in-process fixture transport.
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(root,'apps/api/package.json'));
const parsed=require('dotenv').parse(readFileSync('/var/lib/possistem-pos-control/.env'));
const original=new URL(parsed.DATABASE_URL), name='possistem_billing_test_'+randomBytes(6).toString('hex');
if(!['127.0.0.1','localhost'].includes(original.hostname))throw new Error('Test runner requires a local PostgreSQL instance.');
const quoted=s=>'"'+s.replaceAll('"','""')+'"';
const psql=query=>{
  const r=spawnSync('runuser',['-u','postgres','--','psql','-p',original.port||'5432','-d','postgres','-v','ON_ERROR_STOP=1','-c',query],{encoding:'utf8'});
  if(r.status!==0)throw new Error('Isolated test database operation failed: '+r.stderr);
};
psql('CREATE DATABASE '+quoted(name)+' OWNER '+quoted(decodeURIComponent(original.username)));
try{
  const testUrl=new URL(original);testUrl.pathname='/'+name;
  const result=spawnSync(path.join(root,'apps/api/node_modules/.bin/tsx'),['--test','apps/api/src/lib/request-budget.test.ts','apps/api/src/lib/billing/domain.test.ts','apps/api/src/lib/billing/hosted-test-payment.test.ts','apps/api/src/lib/billing/integration.test.ts'],{cwd:root,stdio:'inherit',env:{...process.env,NODE_ENV:'development',BILLING_TEST_DATABASE_URL:testUrl.toString()}});
  process.exitCode=result.status??1;
}finally{psql('DROP DATABASE '+quoted(name)+' WITH (FORCE)');}
