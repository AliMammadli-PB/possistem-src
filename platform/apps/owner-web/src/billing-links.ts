export function billingNoticePath(notice:{kind?:string;payload?:{orderId?:unknown;url?:unknown}}):string|null{
 const id=notice.payload?.orderId;
 if(notice.kind==='billing_invoice'&&typeof id==='string'&&/^[a-f0-9-]{36}$/i.test(id))return '/faturalar/'+id;
 const url=notice.payload?.url;
 if(typeof url!=='string')return null;
 if(/^\/pos\/app\/faturalar\/[a-f0-9-]{36}$/i.test(url))return url.slice('/pos/app'.length);
 if(url==='/pos/app/abunelik')return '/abunelik';
 if(url==='/pos/app/sifarisler')return '/sifarisler';
 return null;
}
