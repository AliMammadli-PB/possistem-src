// A fixed, permission-checked floor-plan adapter. No remote method names are accepted.
export function createTableTools(api,has,{normalize}){
 const need=()=>{if(!has('tables.layout'))throw Error('Masa planını dəyişmək üçün icazəniz yoxdur.');};
 const data=r=>{if(!r?.success)throw Error(r?.error?.message||'Masa məlumatı alınmadı.');return r.data;};
 const layout=async()=>{need();const value=data(await api.tables.list());if(!Array.isArray(value?.tables)||!Array.isArray(value?.areas))throw Error('Masa siyahısı alınmadı.');return{version:Number(value.assistantLayoutVersion)||0,supported:typeof api.tables.assistantArchive==='function'&&typeof api.tables.assistantUpdate==='function',areas:value.areas.filter(a=>a.id!=='area-delivery').map(a=>({id:a.id,name:a.nameAz||a.name})),tables:value.tables.filter(t=>t.areaId!=='area-delivery').map(t=>({id:t.id,label:t.label,areaId:t.areaId,seats:t.seats,shape:t.shape,sortOrder:t.sortOrder,updatedAt:t.updatedAt,busy:!!t.orderId}))};};
 const fields=['id','label','areaId','seats','shape','sortOrder','updatedAt'];
 const expected=t=>Object.fromEntries(fields.map(k=>[k,t[k]]));
 const same=(a,b)=>fields.every(k=>a?.[k]===b?.[k]);
 const apply=async(draft,key,valid=()=>true)=>{
  need();const current=await layout();if(current.version<1||!current.supported)throw Error('Bu əməliyyat üçün NEWEST-i yenidən açın.');
  if(!Array.isArray(draft.rows)||!draft.rows.length||draft.rows.length>200||new Set(draft.rows.map(r=>r.id)).size!==draft.rows.length)throw Error('Masa planı düzgün deyil.');
  for(const row of draft.rows){const fresh=current.tables.find(t=>t.id===row.id);if(!fresh||fresh.busy||!same(fresh,row))throw Error('Masa dəyişib və ya açıq hesabı var. Yeni plan qurun.');}
  if(!valid())throw Error('Hesab dəyişib.');let result;
  if(draft.kind==='delete')result=data(await api.tables.assistantArchive({assistantExpectedTables:draft.rows.map(expected),idempotencyKey:key},{idempotencyKey:key}));
  else if(draft.kind==='edit'&&draft.rows.length===1){const row=draft.rows[0],wanted={...row};if(draft.field==='name'){if(typeof draft.value!=='string'||!draft.value.trim()||draft.value.length>100)throw Error('Masa adı düzgün deyil.');wanted.label=draft.value.trim();}else if(draft.field==='seats'){if(!Number.isInteger(draft.value)||draft.value<1||draft.value>100)throw Error('Yer sayı 1–100 olmalıdır.');wanted.seats=draft.value;}else if(draft.field==='area'){if(!current.areas.some(a=>a.id===draft.value))throw Error('Zal artıq mövcud deyil.');wanted.areaId=draft.value;}else throw Error('Dəyişiklik növü düzgün deyil.');
   if(current.tables.some(t=>t.id!==row.id&&t.areaId===wanted.areaId&&normalize(t.label)===normalize(wanted.label)))throw Error('Bu zalda eyni adlı masa var.');
   if(!valid())throw Error('Hesab dəyişib.');result=data(await api.tables.assistantUpdate({id:row.id,label:wanted.label,areaId:wanted.areaId,seats:wanted.seats,shape:row.shape,sortOrder:row.sortOrder,assistantExpected:expected(row),idempotencyKey:key},{idempotencyKey:key}));
  }else throw Error('Masa əməliyyatı düzgün deyil.');
  const checked=await layout();if(draft.kind==='delete'){if(draft.rows.some(r=>checked.tables.some(t=>t.id===r.id)))throw Error('Silinmə nəticəsini Masa idarəsindən yoxlayın. Əməliyyat avtomatik təkrarlanmayacaq.');}else{const now=checked.tables.find(t=>t.id===draft.rows[0].id),field={name:'label',seats:'seats',area:'areaId'}[draft.field];if(now?.[field]!==draft.value)throw Error('Dəyişiklik nəticəsini Masa idarəsindən yoxlayın.');}return result;
 };
 const createArea=async(draft,key,valid=()=>true)=>{need();const current=await layout();if(current.version<1||!current.supported)throw Error('NEWEST-i yenidən açın.');if(typeof draft.name!=='string'||!draft.name.trim()||draft.name.length>100)throw Error('Zal adı düzgün deyil.');const old=current.areas.find(a=>a.id===draft.id);if(old){if(old.name!==draft.name)throw Error('Zal planı dəyişib.');return{id:old.id,replayed:true};}if(current.areas.some(a=>normalize(a.name)===normalize(draft.name)))throw Error('Bu adda zal artıq var.');if(!valid())throw Error('Hesab dəyişib.');const result=data(await api.tables.upsertArea({id:draft.id,nameAz:draft.name,nameTr:draft.name,nameEn:draft.name,idempotencyKey:key},{idempotencyKey:key}));const check=await layout();if(!check.areas.some(a=>a.id===draft.id&&a.name===draft.name))throw Error('Zalın yaradılmasını təsdiqləmək alınmadı. Masa idarəsindən yoxlayın.');return result;};
 // Several new tables in one area under one approval. Every row carries its own id and key, so a retried call never makes a second copy.
 const createMany=async(draft,valid=()=>true)=>{need();const current=await layout();
  if(!Array.isArray(draft?.rows)||!draft.rows.length||draft.rows.length>50||new Set(draft.rows.map(r=>r.id)).size!==draft.rows.length)throw Error('Masa planı düzgün deyil.');
  if(!current.areas.some(a=>a.id===draft.areaId))throw Error('Zal artıq mövcud deyil. Yeni plan qurun.');
  for(const row of draft.rows){
   if(typeof row.id!=='string'||typeof row.key!=='string'||typeof row.label!=='string'||!row.label.trim()||row.label.length>100||!Number.isInteger(row.seats)||row.seats<1||row.seats>100)throw Error('Masa planı düzgün deyil.');
   const mine=current.tables.find(t=>t.id===row.id);if(mine){if(mine.label!==row.label||mine.areaId!==draft.areaId)throw Error('Masa planı dəyişib. Yeni plan qurun.');continue;}
   if(current.tables.some(t=>t.areaId===draft.areaId&&normalize(t.label)===normalize(row.label)))throw Error(`“${row.label}” adlı masa bu zalda artıq var. Yeni plan qurun.`);
  }
  if(!valid())throw Error('Hesab dəyişib.');
  for(const row of draft.rows){if(current.tables.some(t=>t.id===row.id))continue;data(await api.tables.upsertTable({id:row.id,areaId:draft.areaId,label:row.label,seats:row.seats,shape:'square',idempotencyKey:row.key},{idempotencyKey:row.key}));}
  const checked=await layout(),missing=draft.rows.filter(r=>!checked.tables.some(t=>t.id===r.id));
  if(missing.length)throw Error(`${draft.rows.length-missing.length} masa yaradıldı, ${missing.length} yaradılmadı. Masa idarəsindən yoxlayın; əməliyyat avtomatik təkrarlanmayacaq.`);
  return{created:draft.rows.length};
 };
 return{tablePermissions:()=>({write:has('tables.layout'),enabled:typeof api.tables?.assistantArchive==='function'&&typeof api.tables?.assistantUpdate==='function',many:typeof api.tables?.upsertTable==='function'}),tableLayout:layout,tableApply:apply,tableCreateArea:createArea,tableCreateMany:createMany};
}
