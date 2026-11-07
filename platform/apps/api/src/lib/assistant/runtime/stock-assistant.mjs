export const normalize=value=>String(value??'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').replace(/ə/g,'e').replace(/ş/g,'s').replace(/ç/g,'c').replace(/ğ/g,'g').replace(/ö/g,'o').replace(/ü/g,'u').replace(/[^a-z0-9]+/g,' ').trim();
const aliases=value=>normalize(value).replace(/coca/g,'koka').replace(/cola/g,'kola');
const distance=(a,b)=>{if(Math.abs(a.length-b.length)>2)return 3;let row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+(a[i-1]===b[j-1]?0:1));row=next;}return row[b.length];};
export function rankProducts(products,query){
 const q=aliases(query);if(!q)return products.slice(0,8).map(product=>({product,fuzzy:false}));
 const queryVariants=[q,...q.split(' ').filter(word=>word.length>1),q.replace(/(?:nin|nun|ni|nu|dan|den|daki|deki|ini|unu|i|u)$/,'')].filter(Boolean);
 return products.map(product=>{const name=aliases(product.name),tokens=name.split(' '),ids=[normalize(product.sku),normalize(product.barcode)].filter(Boolean);let score=99;
  for(const value of queryVariants){if(name===value||ids.includes(value))score=Math.min(score,0);else if(name.startsWith(value)||tokens.some(token=>token.startsWith(value)))score=Math.min(score,1);else if(name.includes(value))score=Math.min(score,2);else if(value.length>=4&&tokens.some(token=>distance(token,value)<= (value.length>5?2:1)))score=Math.min(score,4);}
  return{product,score,fuzzy:score===4,nameExact:[q,q.replace(/(?:nin|nun|ni|nu|dan|den|daki|deki|ini|unu|i|u)$/,'')].includes(name)};
 }).filter(row=>row.score<99).sort((a,b)=>a.score-b.score||a.product.name.localeCompare(b.product.name,'az')).slice(0,8);
}
export function interpret(input){
 const text=normalize(input);
 if(/^(legv( et)?|imtina|dayan|vaz kec|cancel|iptal)$/.test(text))return{intent:'cancel',query:''};
 if(/^(tesdiq( et|le|leyirem)?|beli|he|onayla|evet|confirm|yes)$/.test(text))return{intent:'confirm',query:''};
 if(/^(salam|sa|slm|salamlar|selam|merhaba|hello|hi|hey|sabahiniz xeyir|axsaminiz xeyir)( necesen| necesiz| nasilsin| how are you)?$/.test(text)||/^(necesen|necesiz|yaxsiyam|ela|normalam|sag ol|sagol|cox sag ol|tesekkur\w*|thanks|thank you|helelik|bye|how are you|nasilsin)$/.test(text))return{intent:'social',query:''};
 if(/ne bacar|ne ede bil|ne is gor|nece komek|what can you do|ne yapabil/.test(text))return{intent:'capabilities',query:''};
 if(/\b(abone\w*|abune\w*|abonman\w*|subscription|lisenz\w*|lisenziy\w*)\b/.test(text))return{intent:'subscription',query:'',pay:/odenis|odemek|odey|kart.*bagla|pay/.test(text)};
 if(/\b(masa\w*|stol\w*|tables?)\b/.test(text)&&!/deyis|kocur|yarat|birlesdir|transfer/.test(text))return{intent:'tables',query:''};
 const recipeWord=/kalkul\w*|kalqul\w*|resept\w*|recipe|terkib/;
 if(recipeWord.test(text)&&/yarat|yig|hazirla|elave|qur|isteyirem/.test(text)){
  const named=text.match(/(?:kalkul\w*|resept\w*) (?:yarat\w* )?(.+?) adinda/)?.[1]||text.match(/^(.+?) (?:ucun )?(?:kalkul\w*|resept\w*)/)?.[1]||'';
  return{intent:'recipe_create',name:named.replace(/\s+ucun$/,'').trim(),query:''};
 }
 if(/(?:yeni (?:mehsul|mal|xammal|yemek)|(?:mehsul|mal|xammal|yemek) yarat)/.test(text)&&/yarat|elave|isteyirem/.test(text))return{intent:'product_create',query:''};
 if(/problem|islemir|acilmir|gorunmur|xeta|printer|cap et|internet|sifre|giris|demo|paket|lisenziya/.test(text))return{intent:'help',query:''};
 if(/\b(plan|plani)\b/.test(text))return{intent:'plan',query:'',stock:/anbar|alis|stok|mehsul/.test(text)};
 // Parse the requested number before generic search; preserve decimals and a minus sign.
 const numeric=normalize(String(input).replace(/(\d)[,.](?=\d)/g,'$1xdecimalx').replace(/-(?=\d)/g,'xminusx')).replace(/xdecimalx/g,'.').replace(/xminusx/g,'-').replace(/\s+(?:zehmet olmasa|please|lutfen)$/,'');
 const mutation=/^(.*?)\s*(-?\d+(?:\.\d{1,3})?)\s*(eded|dene|kq|kg|qram|g|l|ml)?\s+(artir|arttir|elave et|azalt|cix|cixar|et|ele|olsun|qoy)$/.exec(numeric);
 if(mutation&&!/qiymet|price|ad(?:ini|in)|rename|name/.test(mutation[1])){
  const query=mutation[1].replace(/\s+-?\d+(?:\.\d+)?\s*(?:dir|di)\s+(?:onu|bunu)\s*$/,'').split(' ').filter(w=>!/^(salam|anbar\w*|bunun|onun|bunu|onu|bu|men|mene|mal(?:i|in)?|mehsul(?:u|un)?|qal\w*|stok\w*|miqdar\w*|sayini|ededini)$/.test(w)).join(' ');
  const operation=/artir|arttir|elave/.test(mutation[4])?'increase':/azalt|cix/.test(mutation[4])?'decrease':'set';
  return{intent:'edit',query,field:'quantity',quantityUnit:mutation[3]||null,quantity:{operation,value:mutation[2]}};
 }
 const edit=/deyis|deis|duzelt|redakt|change|rename|qiymet.*(?:et|qoy)|adini.*(?:et|qoy)|(?:qalig|qaliq|miqdar|stok).*\d.*(?:et|olsun)/.test(text);
 const period=/dunen|yesterday/.test(text)?'yesterday':/hefte|week/.test(text)?'week':/bu ay|month/.test(text)?'month':'today';
 if(!edit&&/kassa.*(?:balans|pul|qaliq|bax)|kassalarim|cash balance/.test(text))return{intent:'cash',query:''};
 if(!edit&&/satis.*(?:bu gun|bugun|dunen|hefte|bu ay|ne qeder)|(?:bu gun|bugun|dunen|hefte|bu ay).*satis|sales.*(?:today|yesterday|week|month)/.test(text))return{intent:'sales',period,query:''};
 if(!edit&&(/(?:ne var|neler var|hansi mallar|hansi mehsullar)/.test(text)&&/anbar\w*|stok\w*|mallar\w*|mehsullar\w*/.test(text)||/az (?:olan|qalan)|minimum\w* (?:asagi|az)|bitmek uzre|tukenen|qurtaran/.test(text)))return{intent:'overview',low:/az (?:olan|qalan)|minimum|bitmek|tukenen|qurtaran/.test(text),query:''};
 if(!edit&&/(?:anbar(?:im|ima|imda|a|i|da)?|stok)(?:i|in)? (?:ne var|nece mehsul|bax|goster|yoxla|siyahi)|(?:mehsullarim|mallarim)(?:i|in)?(?: siyahi\w*)?$|^(?:salam )?(?:anbar|anbarim|inventory)$|az qalan|biten mehsul|low stock/.test(text))return{intent:'overview',low:/az qalan|biten|low stock/.test(text),query:''};
 const lookup=/qal(?:ib|iq|an)|stok|ne qeder|necedi|qiymet|nece dene|nece eded/.test(text);
 const query=text.split(' ').filter(word=>! /^(bunun|onun|bunu|onu|bu|bes|salam|anbar(?:da|imda|in)?|mehsul(?:u|un|lar)?|mal(?:i|in)?|ne|nece|qeder.*|den[eə]|eded|stok\w*|qal.*|miqdar\w*|qiymet.*|satis|alis|adini?|deyis.*|deis.*|duzelt.*|redakt.*|et(?:mek)?|qoy|olsun|isteyirem|men|mene|bir|zehmet|olmasa|bilmek|haqqinda|melumat|ver|bax|goster|change|rename|price|name|stock|set|to|\d+)$/.test(word)).join(' ');
 return{intent:edit?'edit':lookup?'lookup':'unknown',query,field:/qiymet|price/.test(text)?'price':/ad(?:ini|in)|rename|name/.test(text)?'name':/qaliq|qalig|stok|miqdar/.test(text)&&edit?'quantity':null};
}
export function parseDecimal(value,places){
 const input=String(value).trim().replace(',','.');if(!new RegExp('^\\d+(?:\\.\\d{1,'+places+'})?$').test(input))return null;
 const [whole,fraction='']=input.split('.'),result=Number(whole)*10**places+Number(fraction.padEnd(places,'0'));
 return Number.isSafeInteger(result)&&result<=1000000000?result:null;
}
export function parseQuantity(value){const raw=String(value).trim(),sign=raw.startsWith('-')?-1:1,amount=parseDecimal(sign<0?raw.slice(1):raw,3);return amount===null?null:sign*amount;}
export function quantityInStockUnit(value,inputUnit,stockUnit){
 const amount=parseQuantity(value);if(amount===null||!inputUnit)return amount;
 const unit=s=>normalize(s).replace(/^kq$/,'kg').replace(/^qram$/,'g').replace(/^q$/,'g').replace(/^dene$/,'eded');
 const units={kg:['mass',1000],g:['mass',1],l:['volume',1000],ml:['volume',1],eded:['count',1]};
 const from=unit(inputUnit),to=unit(stockUnit);if(from===to)return amount;
 if(!units[from]||!units[to]||units[from][0]!==units[to][0])return null;
 const result=amount*units[from][1]/units[to][1];return Number.isSafeInteger(result)?result:null;
}
export function compactHelp(reply){
 const body=typeof reply?.body==='string'?reply.body.trim():'';
 if(!body||body==='text'||/32 yoxlama|1\. Yoxlama|Canlı hesab məlumatlarını görə|əməliyyatları dəyişə bilmirəm/.test(body))return 'Başa düşmək üçün bir az dəqiqləşdirək: nə etmək istəyirsiniz, yaxud hansı bölmədə problem yaranıb?';
 if(body.length>850)return body.split('\n\n').find(part=>part.length>30&&part.length<=600)||'Hansı addımda qaldığınızı deyin, birlikdə davam edək.';
 return body;
}
