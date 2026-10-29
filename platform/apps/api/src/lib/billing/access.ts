export type AccessSubscription={enabled:boolean;paid_until:string|Date|null;access_mode?:string;trial_until?:string|Date|null;deleted_at?:string|Date|null};
/** Financial state and permission to operate are intentionally separate. */
export function subscriptionAccess(sub:AccessSubscription,now=Date.now()){
 const mode=sub.access_mode??(sub.enabled?'subscription':'free');
 const paid=sub.paid_until?new Date(sub.paid_until).getTime():0;
 const trial=mode==='trial'&&sub.trial_until?new Date(sub.trial_until).getTime():0;
 const until=Math.max(paid,trial);
 const free=mode==='free';
 return {accessMode:mode,hasAccess:free||until>now,accessStatus:free?'free':until>now?(trial>paid?'trial':'active'):'payment_required',accessUntil:free?null:until>0?new Date(until).toISOString():null,trialUntil:sub.trial_until?new Date(sub.trial_until).toISOString():null};
}
