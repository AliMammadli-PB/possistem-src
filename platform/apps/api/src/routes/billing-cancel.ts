import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod/v3';
import type { Billing } from '../lib/billing/service.js';
import { requestCancel, decideCancel, ledger, cancelRequests, cancelContext } from '../lib/billing/cancellation.js';
import { chargeSavedCard } from '../lib/billing/charges.js';
import { MAX_MINOR } from '../lib/billing/domain.js';

type Wrap<A extends unknown[]>=(fn:(...args:A)=>Promise<unknown>)=>(req:FastifyRequest,reply:FastifyReply)=>Promise<unknown>;
const uuid=z.string().uuid();
const idOf=(req:FastifyRequest)=>uuid.parse((req.params as {id:string}).id);

/** Payment history for everyone, cancellation requests from customers, cancel/refund decisions by admin. */
export function billingCancelRoutes(app:FastifyInstance,billing:Billing,customer:Wrap<[string,FastifyRequest,FastifyReply]>,admin:Wrap<[string,FastifyRequest,FastifyReply]>){
  app.get('/customer/billing/ledger',customer(async id=>ledger(app.db,id,300)));
  app.get('/customer/billing/cancel-requests',customer(async id=>({requests:await cancelRequests(app.db,id)})));
  app.post('/customer/billing/subscriptions/:id/cancel-request',customer(async(id,req)=>{
    const b=z.object({reason:z.string().trim().min(2).max(200),details:z.string().trim().max(2000).default('')}).parse(req.body);
    return requestCancel(app.db,id,idOf(req),b);
  }));

  app.get('/admin/billing/ledger',admin(async()=>ledger(app.db,null,1000)));
  app.get('/admin/billing/cancel-requests',admin(async()=>({requests:await cancelRequests(app.db,null)})));
  app.get('/admin/billing/subscriptions/:id/cancel-context',admin(async(_actor,req)=>cancelContext(app.db,idOf(req))));
  app.post('/admin/billing/subscriptions/:id/cancel',admin(async(actor,req)=>{
    const b=z.object({requestId:uuid.optional(),action:z.enum(['cancel','reject']),mode:z.enum(['period_end','immediate']).optional(),refundOrderIds:z.array(uuid).max(100).default([]),refundPercent:z.number().int().min(1).max(100).default(100),note:z.string().max(2000).default('')}).parse(req.body);
    return decideCancel(app.db,billing,actor,idOf(req),b);
  }));
  app.post('/admin/billing/subscriptions/:id/charge',admin(async(actor,req)=>{
    const b=z.object({requestId:uuid,amountMinor:z.number().int().min(1).max(MAX_MINOR),description:z.string().trim().min(3).max(300),consent:z.literal(true)}).parse(req.body);
    return chargeSavedCard(app.db,billing,actor,idOf(req),b);
  }));
}
