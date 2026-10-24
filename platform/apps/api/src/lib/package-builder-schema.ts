import { z } from 'zod/v3';
const text=(max:number)=>z.string().trim().max(max);
const Lang=(max:number)=>z.object({az:text(max),ru:text(max).default(''),en:text(max).default('')});
export const PackageBuilderItemSchema=z.object({
  id:z.string().regex(/^[a-z0-9-]{1,40}$/),
  kind:z.enum(['base','toggle','quantity','printers']),
  // Existing saved items retain their monthly terms until the admin changes them.
  billing:z.enum(['monthly','one_time']).default('monthly'),
  name:Lang(60).refine(v=>v.az.length>0,{message:'Ad (AZ) boş ola bilməz'}),
  description:Lang(240).default({az:'',ru:'',en:''}),
  unit:Lang(24).default({az:'',ru:'',en:''}),
  priceMinor:z.number().int().min(0).max(100_000_000),
  min:z.number().int().min(0).max(100).default(0),
  max:z.number().int().min(0).max(100).default(20),
  defaultOn:z.boolean().default(false),
  defaultQty:z.number().int().min(0).max(100).default(0),
  active:z.boolean().default(true),
});
export const PackageBuilderContentSchema=z.object({
  items:z.array(PackageBuilderItemSchema).max(40).refine(items=>new Set(items.map(i=>i.id)).size===items.length,{message:'Funksiya kodları təkrarlanır'}),
  printerTargets:z.array(Lang(40)).max(12),
  whatsappPhone:z.string().regex(/^\d{9,15}$/),
  note:Lang(400).default({az:'',ru:'',en:''}),
});
export type PackageBuilderContent=z.infer<typeof PackageBuilderContentSchema>;
