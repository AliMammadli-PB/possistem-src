import {z} from 'zod/v3';
const id=z.string().min(1).max(120),text=z.string().trim().max(150),minor=z.number().int().min(0).max(10000000);
const picture=z.string().max(1800).default('').refine(s=>!s||s.startsWith('https://'),'Şəkil üçün HTTPS ünvanı yazın.');
export const QrDocument=z.object({
 name:text.min(1),description:z.string().max(400).default(''),logo:picture,
 accent:z.enum(['blue','green','burgundy','amber']).default('blue'),layout:z.enum(['cards','list']).default('cards'),
 categories:z.array(z.object({id,name:text,nameTr:text.default(''),nameEn:text.default('')})).max(100),
 tables:z.array(z.object({id,label:text})).min(1).max(300),
 items:z.array(z.object({id,categoryId:id,name:text.min(1),nameTr:text.default(''),nameEn:text.default(''),description:z.string().max(500).default(''),image:picture,
 priceMinor:minor,available:z.boolean(),hidden:z.boolean().default(false),
 groups:z.array(z.object({id,name:text,min:z.number().int().min(0).max(20),max:z.number().int().min(1).max(20),
 options:z.array(z.object({id,name:text,priceDeltaMinor:z.number().int().min(-100000).max(100000)})).max(40)})).max(12)
 })).min(1).max(500)
}).superRefine((d,c)=>{for(const key of ['items','categories','tables'] as const)if(new Set(d[key].map(x=>x.id)).size!==d[key].length)c.addIssue({code:'custom',message:'Təkrarlanan identifikator: '+key});for(const item of d.items)if(item.groups.some(g=>g.min>g.max))c.addIssue({code:'custom',message:'Seçim hədləri düzgün deyil.'});});
export type QrMenuDocument=z.infer<typeof QrDocument>;
export const QrCart=z.object({requestId:z.string().uuid(),revision:z.number().int().positive(),note:z.string().trim().max(300).default(''),
 lines:z.array(z.object({productId:id,qty:z.number().int().min(1).max(20),modifiers:z.array(id).max(30).default([]),note:z.string().trim().max(200).default('')})).min(1).max(40)});
export class QrError extends Error{constructor(message:string,public statusCode=400){super(message);}}
export function priceQrCart(document:QrMenuDocument,cart:z.infer<typeof QrCart>){
 let subtotal=0;
 const lines=cart.lines.map(line=>{
  const product=document.items.find(p=>p.id===line.productId&&!p.hidden&&p.available);if(!product)throw new QrError('Məhsul artıq mövcud deyil. Menyunu yeniləyin.',409);
  if(new Set(line.modifiers).size!==line.modifiers.length)throw new QrError('Eyni seçim iki dəfə göndərilə bilməz.');
  let delta=0;const found=new Set<string>(),selected:{id:string;name:string;priceDeltaMinor:number}[]=[];
  for(const group of product.groups){let count=0;for(const option of group.options)if(line.modifiers.includes(option.id)){count++;delta+=option.priceDeltaMinor;found.add(option.id);selected.push(option);}
   if(count<group.min||count>group.max)throw new QrError(product.name+': '+group.name+' seçimini tamamlayın.');}
  if(found.size!==line.modifiers.length)throw new QrError('Məhsula aid olmayan seçim göndərilib.');
  const unit=product.priceMinor+delta;if(unit<0)throw new QrError('Qiymət düzgün deyil.');subtotal+=unit*line.qty;
  return {...line,name:product.name,unitPriceMinor:product.priceMinor,modifierPriceMinor:delta,lineTotalMinor:unit*line.qty,selected};
 });if(subtotal>1000000)throw new QrError('Sifariş limiti keçildi. Kassaya müraciət edin.');return {lines,subtotal};
}
