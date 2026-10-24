import path from 'node:path';import {build} from 'esbuild';
const root=path.resolve(import.meta.dirname,'../..'),api=path.join(root,'possistem-control-sync/apps/api');
const stubs={
 '../plugins/auth.js':`export function requireSuperadmin(req,reply){if(req.headers['x-test-admin']!=='yes'){reply.code(403).send({error:'Denied'});return false;}return true;}export const currentUser=()=>({id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'});`,
 '../lib/validate.js':`export const clientIp=()=> '127.0.0.1';export function parseBody(schema,body,reply){const result=schema.safeParse(body);if(result.success)return result.data;reply.code(400).send({error:'Invalid request'});return null;}`,
 '../lib/audit.js':`export const writeAudit=async(_app,row)=>globalThis.capacityTest.audits.push(row);`,
};
await build({entryPoints:[path.join(root,'restoranpos/control-plane/api/market-register-capacity.ts')],outfile:path.join(root,'artifacts/market-empty-install-pc/capacity-api-test.cjs'),bundle:true,platform:'node',format:'cjs',nodePaths:[path.join(api,'node_modules')],plugins:[{name:'fixture-auth',setup(b){b.onResolve({filter:/.*/},args=>stubs[args.path]?{path:args.path,namespace:'fixture'}:args.path==='@milioner/database'?{path:path.join(root,'possistem-control-sync/packages/database/src/index.ts')}:null);b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path],loader:'js'}));}}]});
