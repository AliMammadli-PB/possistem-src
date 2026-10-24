export function partnerProductPrice(id:string,publicPrice:number|null|undefined,prices:Record<string,number>){
 if(typeof publicPrice!=='number'||!Number.isFinite(publicPrice)||publicPrice<=0)return null;
 const special=prices[id];return typeof special==='number'&&Number.isFinite(special)&&special>0?special:publicPrice;
}
export function partnerPriceLabel(language:'az'|'en'|'ru'){return {az:'Partnyor qiyməti',en:'Partner price',ru:'Цена партнёра'}[language];}
