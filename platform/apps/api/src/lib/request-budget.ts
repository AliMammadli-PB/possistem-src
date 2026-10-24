// Bound input work before schema validation; the v3 compatibility API retains
// existing contracts without allowing oversized collections to allocate errors.
export function withinBudget(value:unknown):boolean {
 const stack:[unknown,number][]=[[value,0]];let nodes=0,bytes=0;
 while(stack.length){const[v,depth]=stack.pop()!;if(++nodes>50000||depth>32)return false;
  if(typeof v==='string'){bytes+=v.length*2;if(bytes>2*1024*1024)return false;}
  else if(v&&typeof v==='object'){
   if(Array.isArray(v)){if(v.length>5000)return false;for(const x of v)stack.push([x,depth+1]);}
   else {const keys=Object.keys(v);if(keys.length>5000)return false;for(const k of keys)stack.push([(v as Record<string,unknown>)[k],depth+1]);}
  }
 }
 return true;
}
