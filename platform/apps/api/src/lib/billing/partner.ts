import { createHmac, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { env } from '../../env.js';
import { query,type Executor } from './store.js';
import { listPartnerPrices } from '../product-catalog.js';
import { BillingError } from './domain.js';

export function partnerCheckoutProof(customerId:string,partnerId:string){
  const data=Buffer.from(JSON.stringify({customerId,partnerId,expires:Date.now()+600000})).toString('base64url');
  return data+'.'+createHmac('sha256',env.sessionSecret).update('partner-checkout:'+data).digest('base64url');
}
export async function trustedPartnerPrices(db:Executor,customerId:string,proof?:string):Promise<Record<string,number>>{
  if(!proof)return {};
  const invalid=()=>{throw new BillingError('partner_proof_expired','Partnyor hesabını yeniləyib qiymət təklifini yenidən alın.');};
  const [data,signature,...extra]=proof.split('.');if(!data||!signature||extra.length)return invalid();
  const expected=createHmac('sha256',env.sessionSecret).update('partner-checkout:'+data).digest('base64url');
  if(signature.length!==expected.length||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))return invalid();
  let payload:{customerId:string;partnerId:string;expires:number};try{payload=JSON.parse(Buffer.from(data,'base64url').toString('utf8'));}catch{return invalid();}
  if(payload.customerId!==customerId||payload.expires<=Date.now()||!/^[a-f0-9-]{36}$/i.test(payload.partnerId))return invalid();
  const [active]=await query(db,sql`SELECT id FROM site_partners WHERE id=${payload.partnerId}::uuid AND active=true`);if(!active)return invalid();
  return listPartnerPrices();
}
