import {createHash,randomBytes} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {query} from './billing/store.js';
import {QrError} from './qr-menu.js';
export const QR_VISIT_MS=30*60*1000;
export const QR_VISITS_DDL=`CREATE TABLE IF NOT EXISTS restaurant_qr_visits (
 token_hash text PRIMARY KEY, menu_id uuid NOT NULL REFERENCES restaurant_qr_menus(id) ON DELETE CASCADE,
 table_token_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT (now()+interval '30 minutes'))`;
export const qrVisitHash=(token:string)=>createHash('sha256').update(token).digest('hex');
export function qrVisitToken(value:unknown){if(typeof value!=='string'||!/^[a-f0-9]{48}$/.test(value))throw new QrError('Sifariş sessiyası yoxdur və ya etibarsızdır. Masadakı QR koddan istifadə edin.',403);return value;}
type DB=Parameters<typeof query>[0];
export async function readQrVisit(db:DB,menuId:string,tableToken:string,raw:unknown){
 const token=qrVisitToken(raw),hash=qrVisitHash(token);
 const [row]=await query<{expires_at:Date|string;server_now:Date|string;active:boolean}>(db,sql`SELECT expires_at,clock_timestamp() AS server_now,expires_at>clock_timestamp() AS active FROM restaurant_qr_visits WHERE token_hash=${hash} AND menu_id=${menuId}::uuid AND table_token_hash=${qrVisitHash(tableToken)}`);
 if(!row)throw new QrError('Bu sifariş linki etibarsızdır. Masadakı QR koddan istifadə edin.',403);
 return {token,hash,expiresAt:new Date(row.expires_at).toISOString(),serverNow:new Date(row.server_now).toISOString(),active:row.active};
}
export async function openQrVisit(db:DB,menuId:string,tableToken:string,existing?:unknown){
 // Reopening an expired personal link never issues a fresh credential.
 if(existing!==undefined)return readQrVisit(db,menuId,tableToken,existing);
 const token=randomBytes(24).toString('hex');
 await db.execute(sql`INSERT INTO restaurant_qr_visits(token_hash,menu_id,table_token_hash) VALUES(${qrVisitHash(token)},${menuId}::uuid,${qrVisitHash(tableToken)})`);
 return readQrVisit(db,menuId,tableToken,token);
}
export function requireQrVisitActive(visit:{active:boolean}){if(!visit.active)throw new QrError('Sifariş linkinin 30 dəqiqəlik vaxtı bitdi. Yeni sifariş üçün masadakı QR koddan istifadə edin.',410);}
