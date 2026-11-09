// "masa 3-ü", "3-cü masanı", "3 nömrəli masa" all name table 3.
const strip=value=>value.replace(/\b(\d{1,4}) (?:cu|ci|nci|ncu|nomreli|nolu)\b/g,'$1').replace(/\s+masa\w*$/,'').replace(/^(?:(?:mene|zehmet olmasa|masa(?:ni|nin|lar\w*)?|table)(?:\s+|$))+/,'').replace(/\s+(?:i|ni|in|nin|u|nu|un|nun)$/,'').trim();
export function interpretTableAction(raw,text){
 const table=/\b(?:masa\w*|tables?|stol\w*)\b/.test(text),deletion=/\b(?:sil|silin|silinsin|silim|silmek|silmey\w*|silmey\w*|delete|remove|kaldir)\b/.test(text);
 if(!table&&/^(?:(?:onu|bunu|he|beli) )?(?:silm\w*|sil) (?:isteyirem|isteyir\w*|zehmet olmasa)$/.test(text))return{intent:'table_delete',followup:true,query:''};
 if(table&&deletion){const empty=/\b(?:bos|empty)\b/.test(text);
  // "masalardan 3 ədəd sil" is a count; "masa 3-ü sil", "3-cü masa" stay names. A bare "3 masa sil" can be either.
  // "ikisini sil", "üç ədəd": number words count like digits (not "bir", which is also "a").
  const words={iki:2,uc:3,dord:4,bes:5,alti:6,yeddi:7,sekkiz:8,doqquz:9};text=text.replace(/\b(iki|uc|dord|bes|alti|yeddi|sekkiz|doqquz)(?:si|su|sin|sun|sini|sunu|ni|nu|ini|unu|i|u)?\b(?=\s+(?:eded|dene|tane|masa\w*|sil\w*))/g,(_m,w)=>words[w]+(/^(?:si|su|sin|sun|sini|sunu|ni|nu|ini|unu|i|u)$/.test(_m.slice(w.length))?' eded':''));
  const counted=text.match(/\b(\d{1,3})\s*(?:eded|dene|tane|adet)\b/)||text.match(/\bmasalardan\s+(\d{1,3})\b/),bare=!counted&&text.match(/(?:^|\s)(\d{1,3})\s+masa(?:ni|lari|lar)?\b/);
  if((counted||bare)&&Number((counted||bare)[1])>0)return{intent:'table_delete',count:Number((counted||bare)[1]),ambiguous:!counted,query:''};
  // Words around the request ("deyirəm", "göstərmə", "artıq") are not a table's name.
  const query=strip(text.replace(/\b(?:sil|silin|silinsin|silim|silmek|silmey\w*|delete|remove|kaldir|isteyirem|deyirem|deyirem ki|gosterme|gostermeyin|goster|artiq|zehmet|olmasa|lutfen|please|hamisini|butun|hamisi\w*|hepsi\w*|all|bos|empty)\b/g,' ').replace(/\s+/g,' ').trim());
  // "masalarımı sil" with no name left means all of them.
  const all=/\b(?:butun|hamisi\w*|hepsi\w*|all)\b/.test(text)||/\bmasalar\w*\b/.test(text)&&!query;
  return{intent:'table_delete',all:all||empty,empty,query};}
 // "pandanın içinə 5 ədəd masa əlavə et", "10 masa aç": several new tables, optionally into a named area.
 if(table&&!deletion&&/\b(?:elave|yarat\w*|ac|qoy|artir)\b/.test(text)){
  const nums={bir:1,iki:2,uc:3,dord:4,bes:5,alti:6,yeddi:7,sekkiz:8,doqquz:9,on:10};
  const n=text.match(/\b(\d{1,3})\s*(?:eded|dene|tane)?\s*(?:yeni\s+)?masa\w*/)?.[1]??text.match(/\b(bir|iki|uc|dord|bes|alti|yeddi|sekkiz|doqquz|on)\s*(?:eded|dene|tane)?\s*(?:yeni\s+)?masa\w*/)?.[1];
  const count=n===undefined?0:Number(nums[n]??n);
  const area=text.match(/^(?:(?:mene|indi|bir de|birde|zehmet olmasa)\s+)*(.+?)\s+(?:zal\w*\s+)?(?:icine|icerisine|ichine)\b/)?.[1]||text.match(/(?:^|\s)(\S+(?:\s\S+)?)\s+zal(?:ina|ına|a|inda|ında)\b/)?.[1]||'';
  if(count>=1&&!/\badinda\b/.test(text))return{intent:'tables_add',count,area:area.replace(/^(?:yeni\s+)/,'').trim(),query:''};
 }
 if(/\bzal\w*\b/.test(text)&&/yarat|elave et|create/.test(text)&&!table){const name=String(raw).match(/ad[ıi]\s+(.+?)(?:\s+olsun|$)/i)?.[1]||text.match(/\badi (.+?)(?: olsun|$)/)?.[1]||text.match(/(.+?) adinda zal/)?.[1]?.replace(/^(?:mene |yeni )/,'')||'';return{intent:'area_create',name,query:''};}
 if(table&&/adin\w*|rename/.test(text)&&/deyis|et|qoy|olsun|rename/.test(text)){const parts=text.split(/\badin\w*\b/);return{intent:'table_edit',field:'name',query:strip(parts[0]),value:String(raw).match(/ad[ıi]n[ıi]\s+(.+?)(?:\s+(?:et|dəyiş|deyis|qoy|olsun))?$/i)?.[1]||parts[1]?.replace(/\s+(?:et|deyis|qoy|olsun)(?: mene)?$/,'').trim()||''};}
 if(table&&/neferlik|yer say|yerlik|seats/.test(text)){const n=text.match(/(\d{1,3})\s*(?:neferlik|yerlik|seats)/);return{intent:'table_edit',field:'seats',query:strip(n?text.slice(0,n.index):text.replace(/yer say\w*.*$/,'')),value:n?Number(n[1]):null};}
 if(table&&/zal\w*|yerini/.test(text)&&/kecir|deyis|move/.test(text))return{intent:'table_edit',field:'area',query:text.match(/\bmasa\s+(\d+)\b/)?.[1]||'',value:null};
 if(table&&/deyis|redakte|duzelt|edit/.test(text))return{intent:'table_edit',field:null,query:strip(text.replace(/\b(?:deyis|redakte|duzelt|edit)\b/g,'')),value:null};
 return null;
}
