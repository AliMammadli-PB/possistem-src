// A manually created merchant invoice is independent of the API simulator.
// Its status must be reconciled in Epoint; this link never grants a paid period.
export function hostedTestPayment(raw=process.env.EPOINT_PRIVATE_TEST_PAYMENT_URL){
 if(!raw)return null;
 try{
  const url=new URL(raw);
  if(url.protocol!=='https:'||url.hostname!=='epoint.az'||url.port||url.username||url.password||url.search||url.hash||!/^\/az\/inv\/p\/[A-Za-z0-9]+$/.test(url.pathname))return null;
  return {url:url.href,amountMinor:100,currency:'AZN' as const,verification:'manual' as const};
 }catch{return null;}
}
