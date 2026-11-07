// Copy visible chat content only, without action labels or any hidden account data.
export function chatTranscript(messages,language='az',withAuthors=true){
 const t=(az,tr,en)=>language==='tr'?tr:language==='en'?en:az;
 return messages.map(m=>{
  const author=m.author==='me'||m.authorKind==='customer'?t('Siz','Siz','You'):m.authorKind==='admin'?t('Əməkdaş','Temsilci','Agent'):t('Köməkçi','Yardımcı','Assistant');
  const file=m.meta?.attachment?.fileName;
  const body=String(m.body??'')+(file?'\n'+t('Əlavə fayl','Ek dosya','Attachment')+': '+file:'');
  return withAuthors?author+':\n'+body:body;
 }).join('\n\n');
}
export async function copyChatText(text){
 if(typeof text!=='string'||!text)throw Error('Nothing to copy');
 try{if(typeof navigator.clipboard?.writeText==='function'){await navigator.clipboard.writeText(text);return;}}catch{/* File URLs or a blocked clipboard may require the local fallback. */}
 const focus=document.activeElement,selection=window.getSelection();
 const ranges=selection?Array.from({length:selection.rangeCount},(_,i)=>selection.getRangeAt(i).cloneRange()):[];
 const field=document.createElement('textarea');field.value=text;field.readOnly=true;field.tabIndex=-1;field.setAttribute('aria-hidden','true');field.style.cssText='position:fixed;left:-9999px;top:0;opacity:0;user-select:text';document.body.appendChild(field);
 try{field.focus({preventScroll:true});field.select();field.setSelectionRange(0,text.length);if(!document.execCommand('copy'))throw Error('Clipboard unavailable');}
 finally{field.remove();focus?.focus?.({preventScroll:true});if(selection){selection.removeAllRanges();for(const range of ranges)selection.addRange(range);}}
}
