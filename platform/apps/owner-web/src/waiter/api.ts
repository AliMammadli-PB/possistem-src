export type WaiterAccount={id:string;email:string;fullName:string;companyName?:string;deviceId:string;active:boolean;connected:boolean};
export type FloorTable={id:string;label:string;areaId:string;areaName:string;orderId?:string|null;totalMinor:number;paidMinor:number};
export type Dish={id:string;name:string;categoryId:string;priceMinor:number;available:boolean;image:string};
export type Option={id:string;name?:string;nameAz?:string;priceDeltaMinor:number;available?:boolean};
export type Group={id:string;name?:string;nameAz?:string;minSelect?:number;maxSelect?:number;required?:boolean;modifiers?:Option[];options?:Option[]};
export type Workspace={tables:FloorTable[];categories:{id:string;name:string;parentId?:string}[];products:Dish[];checkedAt:string};
export type CartLine={productId:string;name:string;qty:number;unitPriceMinor:number;modifierPriceMinor:number;modifiers:string[];note:string;optionsText:string};
export type Submission={requestId:string;tableId:string;note:string;lines:Omit<CartLine,'name'|'optionsText'>[]};
export type OrderResult={state:'processing'|'done'|'accepted'|'uncertain'|'failed';requestId:string;accepted?:boolean;kitchenSent?:boolean;canEdit?:boolean;orderId?:string;error?:string};
let csrf='';
export async function waiterFetch<T>(path:string,init:RequestInit={}):Promise<T>{
 const response=await fetch('/pos/api/waiter/'+path,{...init,credentials:'same-origin',headers:{'content-type':'application/json',...(csrf?{'x-csrf-token':csrf}:{}),...init.headers}});
 const data=await response.json().catch(()=>({error:'Kassa cavabı alınmadı.'}));if(!response.ok)throw Object.assign(Error(data.error||'Sorğu tamamlanmadı.'),{status:response.status});if(data.csrfToken)csrf=data.csrfToken;return data;
}
export const waiterLogin=(email:string,password:string)=>waiterFetch<{account:WaiterAccount}>('login',{method:'POST',body:JSON.stringify({email,password})});
export const money=(n:number)=>(n/100).toLocaleString('az-AZ',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₼';
