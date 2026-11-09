// Groq turns a sentence the rules did not understand into the assistant's own command phrases.
// It never acts: every phrase goes back through interpret(), the same plans and the same confirmation.
// Only the person's own recent messages are sent; answers with sales or stock figures never leave the server.
import {MAP_TEXT} from './runtime/app-map.mjs';
export const COMMANDS=[
 ['anbarda nə var','the whole warehouse list'],
 ['anbarda mənfi olanları göstər','only negative stock'],
 ['anbarda az qalan mallar','low or finished stock'],
 ['<MAL> qalığı nə qədərdir','stock of one item'],
 ['<MAL> <SAY> <ədəd|kq|litr> artır','add stock'],
 ['<MAL> <SAY> <ədəd|kq|litr> azalt','reduce stock'],
 ['<MAL> qalığını <SAY> et','set stock to an exact amount'],
 ['<MAL> <SAY> <ədəd|kq|litr> silinmə, səbəb: <SƏBƏB>','write off spoiled or lost stock'],
 ['<MAL> <SAY> <ədəd|kq|litr> aldım <MƏBLƏĞ> manatdan','goods receipt from a supplier at a unit price'],
 ['<MAL> satış qiymətini <MƏBLƏĞ> et','change a sale price'],
 ['<MAL> adını “<YENİ AD>” et','rename an item'],
 ['<MAL> maya <MƏBLƏĞ> manat','set the cost price of an item'],
 ['anbara <MAL> əlavə et','add a new or existing item to stock'],
 ['yeni məhsul yarat','create a new item'],
 ['bugünkü satış','sales today'],
 ['dünənki satış','sales yesterday'],
 ['bu həftənin satışı','sales this week'],
 ['bu ayın satışı','sales this month'],
 ['keçən həftənin satışı','sales last week'],
 ['keçən ayın satışı','sales last month'],
 ['kassada nə qədər pul var','cash balances'],
 ['açıq masalar nə qədər işləyib','open bills on tables'],
 ['masa <NÖMRƏ> nə qədər işləyib','one table’s bill'],
 ['neçə masa var','count tables'],
 ['masaları göstər','list tables with open bills'],
 ['masa <AD> sil','delete one table'],
 ['masalardan <SAY> ədəd sil','delete a number of free tables'],
 ['boş masaları sil','delete all free tables'],
 ['<AD> masasının adını <YENİ AD> et','rename a table'],
 ['<AD> masasını <SAY> nəfərlik et','change seats'],
 ['<AD> adında masa yarat','create a table'],
 ['<AD> zalına <SAY> masa əlavə et','add several tables to an area'],
 ['<SAY> masa əlavə et','add several tables'],
 ['<AD> adında zal yarat','create an area'],
 ['<YEMƏK> kalkulyasiyasını göstər','show a dish’s recipe'],
 ['kalkulyasiyaları göstər','list which dishes have recipes'],
 ['<YEMƏK> içinə <XAMMAL>, <XAMMAL> qoy kalkulyasiya yarat','create a recipe with these ingredients'],
 ['<YEMƏK> kalkulyasiya yarat','create a recipe'],
 ['printeri test et','print a test receipt'],
 ['X hesabatı çıxar','X report'],
 ['Z hesabatı çıxar','Z report, closes the day'],
 ['ən çox satılan mallar','best sellers'],
 ['qaimələri göstər','purchase invoices'],
 ['bugünkü kuryer hesabatı','courier report today'],
 ['bu ayın kuryer hesabatı','courier report this month'],
 ['anbarın dəyəri','stock value'],
 ['abunəliyimə bax','subscription status'],
 ['abunəliyimi ödəmək istəyirəm','pay the subscription'],
 ['indicə nə dedim','repeat the last question'],
 ['sən kimsən','who the assistant is, who made it'],
 ['restoranımın adı nədir','the restaurant\'s own name'],
 ['masa <NÖMRƏ> masasında nə var','the items on one table\'s open bill'],
 ['qaimələri PDF ver','purchase invoices as a downloadable PDF'],
 ['<DÖVR> satışını PDF ver','sales of a period (bu gün, dünən, son 4 gün, bu ay, keçən ay) as a PDF; also "nə qədər qazanmışam" in a PDF'],
 ['<DÖVR> ödənişlərini PDF ver','payments of a period as a PDF'],
 ['SUAL: <SUAL>','a question about the restaurant\'s own figures or records that no other form answers, in the person\'s words (e.g. SUAL: ən az satılan yeməklər)'],
 ['<BÖLMƏ> bölməsini aç','open a screen of the program (anbar, işçilər, printer, çek loqosu, hesabatlar, xərclər, qaytarma, ehtiyat nüsxə…)'],
];
const fold=x=>String(x).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').replace(/ə/g,'e').replace(/[“”"«»]/g,'').replace(/\s+/g,' ').trim();
const FORMS=COMMANDS.map(([form])=>new RegExp('^'+fold(form).split(/(<[^>]+>)/).map(part=>/^<.+>$/.test(part)?(part.includes('|')?'(?:'+part.slice(1,-1).split('|').map(fold).join('|')+')':part==='<xammal>'?'[^;:!?\\n]{1,120}?':'[^;:,!?\\n]{1,60}?'):part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('')+'$'));
/** Only phrases in one of the listed forms are accepted from the AI. */
export const isCommand=text=>typeof text==='string'&&text.length<=200&&!/\b(?:hamisi\w*|butun|hepsi\w*|all)\b/.test(fold(text))&&FORMS.some(re=>re.test(fold(text)));
// Kept short on purpose: Groq's free tier allows 8000 tokens a minute for everyone together.
const SYSTEM=`Map a restaurant owner's chat message (Azerbaijani/Turkish, informal, misspelt, often without ə ş ç ğ ı ö ü) to POS assistant commands. JSON only.
kind: "commands" (asks for forms below), "answer" (only when the assistant just asked a question and the message answers it: a name, number, choice or reason), "data_question" (a question about the restaurant's own figures or records that no form answers, e.g. which waiter sold most last week, average bill per table, sales after 20:00 yesterday, what a customer owes), "app_question" (how Possistem Restoran POS works), "off_topic" (news, people, general knowledge).
commands: each request in order, exactly in one of these forms; fill <...> with the person's own names, fix spelling only:
${COMMANDS.map(([form])=>form).join('\n')}
In a message with several requests, a data question becomes a "SUAL: …" command and an off-topic part (weather, news, jokes, people) goes to ignored (a few of the person's words). unsupported is only for restaurant work none of the forms covers. Every part of the message goes into exactly one of commands, unsupported or ignored; never drop a part. "sən kimsən" → sən kimsən; "restoranımın adı" → restoranımın adı nədir; "keçən ay nə qədər qazanmışam" → keçən ayın satışı; "anbarın dəyəri" → anbarın dəyəri; "1 masada nə var / nə yeyiblər" → masa 1 masasında nə var; weather, pets, health → ignored.
Use a form only if it means what was asked; never invent numbers, prices or names. Not a form: "sayım"/"inventarizasiya" (hand stock count), printer settings, staff, shifts, suppliers, discounts → put in unsupported (a few Azerbaijani words, the person's own if possible). Examples: "anbardakı mallarımı göstər" → anbarda nə var; "kalkulyasiyada nələr var" → kalkulyasiyaları göstər; "masa 2-dəki vəziyyət" → masa 2 nə qədər işləyib; "masaların vəziyyəti" → masaları göstər; "ödəniş etmək istəyirəm" → abunəliyimi ödəmək istəyirəm; "doneri 24 et, mənfidə olmasın" → doner qalığını 24 et; "un töküldü / xarab oldu / atdıq" → silinmə form, never azalt; "unun kilosu 3 manat" → un maya 3 manat (cost, not sale price); "un aldım" → aldım form; "satmışıq/qazandıq/dövriyyə" → sales; "çatdırılma/kuryer statistikası" → bugünkü kuryer hesabatı (or bu ayın …), not sales; "sayım lazımdır" → unsupported; "printer işləmir / printerin problemini tap" → printeri test et; "acılı dönəri artır" with no number → anbara acılı dönər əlavə et (the assistant asks how many).
reply: only for app_question, max 3 short Azerbaijani sentences from these facts only; never name a screen not in the facts, never say a feature is missing; if unsure say so and suggest the "Əməkdaş" tab. Else "".
Facts: Windows till for restaurants/cafes/bars; works offline (assistant needs internet); areas and tables; orders to kitchen/bar printers; open and split bills, cash/card, deposits; menu, sub-categories, set menus, recipes (kalkulyasiya) with cost; stock and goods receipts (Təchizat → Mal qəbulu); staff with PIN, shifts, X/Z reports, cash accounts, expenses; İdarə → Maliyyə has cash, invoices (qaimələr), reports; delivery and couriers (Partnyorlar, kuryer qaimələri; collected cash is owed until handed over); guest QR menu ordering; owner portal; cloud backup; monthly card subscription. Screens: ${MAP_TEXT}.`;
const SCHEMA={type:'object',properties:{kind:{type:'string',enum:['commands','answer','data_question','app_question','off_topic']},commands:{type:'array',items:{type:'string'}},unsupported:{type:'array',items:{type:'string'}},ignored:{type:'array',items:{type:'string'}},reply:{type:'string'}},required:['kind','commands','unsupported','ignored','reply'],additionalProperties:false};
// Baku day, week (Monday) and month boundaries as epoch ms, so the query never does date arithmetic of its own.
export function periodBounds(nowMs){const offset=4*3600000,day=86400000,local=new Date(nowMs+offset),todayStart=Math.floor((nowMs+offset)/day)*day-offset;
 const weekStart=todayStart-((local.getUTCDay()+6)%7)*day,monthStart=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),1)-offset,lastMonthStart=Date.UTC(local.getUTCFullYear(),local.getUTCMonth()-1,1)-offset;
 return{now:nowMs,day,todayStart,weekStart,monthStart,lastMonthStart,date:local.toISOString().slice(0,10)};}
export function periods(nowMs){const {day,todayStart,weekStart,monthStart,lastMonthStart}=periodBounds(nowMs),local=new Date(nowMs+4*3600000);
 return `Today in Baku: ${local.toISOString().slice(0,10)}. NOW=${nowMs} TODAY_START=${todayStart} YESTERDAY_START=${todayStart-day} WEEK_START=${weekStart} LAST_WEEK_START=${weekStart-7*day} MONTH_START=${monthStart} LAST_MONTH_START=${lastMonthStart} (epoch ms; a period ends where the next one starts).`;}
/**
 * @param {{apiKey?:string,model?:string,fetchImpl?:typeof fetch,timeoutMs?:number,now?:()=>number,log?:(event:string)=>void}} [options]
 * @returns {null | ((text:string, earlier?:string[], asked?:string) => Promise<{kind:string,commands:string[],unsupported:string[],understood:string,reply:string}|null>)}
 */
export function createUnderstand({apiKey,model='openai/gpt-oss-120b',fetchImpl=fetch,timeoutMs=8000,now=Date.now,log=_event=>{}}={}){
 if(!apiKey)return null;
 let pausedUntil=0;
 return async(text,earlier=[],asked='')=>{
  if(now()<pausedUntil)return null;
  const context=earlier.filter(Boolean).slice(-3).map(m=>String(m).slice(0,300));
  try{
   const response=await fetchImpl('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{authorization:'Bearer '+apiKey,'content-type':'application/json'},signal:AbortSignal.timeout(timeoutMs),
    body:JSON.stringify({model,temperature:0,max_completion_tokens:900,...(model.startsWith('openai/gpt-oss')?{reasoning_effort:'low'}:{}),response_format:{type:'json_schema',json_schema:{name:'pos_commands',strict:true,schema:SCHEMA}},
     messages:[{role:'system',content:SYSTEM},...(context.length?[{role:'user',content:'Earlier messages, for context only:\n'+context.join('\n')}]:[]),...(asked?[{role:'user',content:'The assistant just asked: '+String(asked).slice(0,200)}]:[]),{role:'user',content:String(text).slice(0,1000)}]})});
   if(response.status===429){pausedUntil=now()+Math.min(3600,Math.max(10,Number(response.headers.get('retry-after'))||60))*1000;log('groq_rate_limited');return null;}
   if(!response.ok){log('groq_http_'+response.status);return null;}
   const data=await response.json(),out=JSON.parse(data?.choices?.[0]?.message?.content||'null');
   if(!out||!Array.isArray(out.commands))return null;
   log('groq_ok');
   return{kind:['commands','answer','data_question','app_question','off_topic'].includes(out.kind)?out.kind:'commands',commands:out.commands.filter(c=>typeof c==='string'&&c.trim()).map(c=>c.trim().slice(0,200)).filter(isCommand).slice(0,6),unsupported:Array.isArray(out.unsupported)?out.unsupported.filter(u=>typeof u==='string'&&u.trim()).map(u=>u.trim().slice(0,80)).slice(0,4):[],ignored:Array.isArray(out.ignored)?out.ignored.filter(u=>typeof u==='string'&&u.trim()).map(u=>u.trim().slice(0,60)).slice(0,3):[],understood:typeof out.understood==='string'?out.understood.slice(0,300):'',reply:out.kind==='app_question'&&typeof out.reply==='string'?out.reply.trim().slice(0,700):''};
  }catch(error){log('groq_failed:'+(error?.name||'error'));return null;}
 };
}

// A data question becomes one read-only SQLite query. The till runs it on a read-only connection that admits only
// business tables and refuses secrets (see AssistantQuery.hpp), so a wrong query can fail but never change or leak.
const SCHEMA_TEXT=`Restaurant till, SQLite. Money columns *_minor are qəpik (divide by 100.0 for manat). Quantities *_milli are thousandths (divide by 1000.0). Times are epoch milliseconds; Baku local time = datetime(x/1000,'unixepoch','+4 hours').
orders(id, order_number, table_id→restaurant_tables.id, user_id→users.id waiter, status: 'open','submitted','paid','closed','voided', guest_count, subtotal_minor, discount_minor, service_minor, total_minor, paid_minor, tip_minor, customer_id→customers.id, opened_at, closed_at, deleted_at, business_day_id)
  A sale = orders with status IN ('paid','closed') AND deleted_at IS NULL; use closed_at for its time.
order_items(order_id, product_id→menu_items.id, name_snapshot, quantity (whole count, not milli), unit_price_minor, line_total_minor, status ('voided' = not sold), complimentary, is_gift)
payments(order_id, method: 'cash','card','account','mixed', status: settled = 'approved','refunded', amount_minor, tip_minor, user_id, created_at, is_deposit)
refunds(order_id, amount_minor, reason, status 'completed', created_at)
menu_items(id, category_id→menu_categories.id, name_az, price_minor, cost_minor, active, archived)
menu_categories(id, name_az, parent_id)
ingredients(id, name, unit, cost_minor, sale_price_minor, min_qty_milli, active)
stock_levels(ingredient_id, warehouse_id→warehouses.id, qty_milli)
stock_movements(ingredient_id, warehouse_id, kind, qty_delta_milli, reason, created_at)
warehouses(id, name)
restaurant_tables(id, area_id→restaurant_areas.id, label, seats, active)
restaurant_areas(id, name_az)
users(id, full_name, primary_role_id, active) staff
business_days(id, business_date, status, opened_at, closed_at, opening_float_minor, counted_cash_minor)
delivery_orders(order_id, courier_id→couriers.id, customer_name, address, fee_minor, status, delivered_at)
couriers(id, name)
purchase_orders(id, number, supplier_id→suppliers.id, total_minor, due_minor = what we still owe the supplier, stage ('cancelled' = ignore), created_at, received_at)
suppliers(id, name)
cash_movements(kind, amount_minor, reason, created_at, deleted_at; expenses/xərclər are kind='expense' AND deleted_at IS NULL, there is no expenses table)
customers(id, name, phone, debt_minor, loyalty_points)
shifts(user_id, opened_at, closed_at, expected_cash_minor, closing_cash_minor)`;
const SQL_SYSTEM=`Write one SQLite SELECT that answers the restaurant owner's question from this schema. JSON only.
${SCHEMA_TEXT}
Rules: one SELECT or WITH…SELECT, no other statements and no trailing text; list columns explicitly (never *); give every column a short, human Azerbaijani alias in double quotes (money ones end with " (₼)"); never return id columns, show names instead; money in manat with ROUND(x/100.0,2), *_milli with ROUND(x/1000.0,3).
Periods: compare the epoch-ms columns with the numbers given in the question (for example o.closed_at >= TODAY_START); never use 'now' or 'localtime'. Filter by a period ONLY when the question names one (bu gün, dünən, bu həftə, keçən həftə, bu ay, keçən ay, a date or hour); questions like "hansı masada orta çek ən böyükdür" or "ən çox hansı saatlarda satış olur" name none and cover all time. Say the period in explain. Hour of day = strftime('%H', x/1000, 'unixepoch', '+4 hours').
At most 50 rows with an ORDER BY that answers the question. If the schema cannot answer it, sql = "".
explain: one short Azerbaijani sentence saying what the query counts.`;
const SQL_JSON={type:'object',properties:{sql:{type:'string'},explain:{type:'string'}},required:['sql','explain'],additionalProperties:false};
/**
 * @param {{apiKey?:string,model?:string,fetchImpl?:typeof fetch,timeoutMs?:number,now?:()=>number,log?:(event:string)=>void}} [options]
 * @returns {null | ((question:string, today?:string) => Promise<{sql:string,explain:string}|null>)}
 */
export function createSqlWriter({apiKey,model='openai/gpt-oss-120b',fetchImpl=fetch,timeoutMs=10000,now=Date.now,log=_event=>{}}={}){
 if(!apiKey)return null;
 return async(question,today)=>{
  try{
   const response=await fetchImpl('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{authorization:'Bearer '+apiKey,'content-type':'application/json'},signal:AbortSignal.timeout(timeoutMs),
    body:JSON.stringify({model,temperature:0,max_completion_tokens:900,...(model.startsWith('openai/gpt-oss')?{reasoning_effort:'low'}:{}),response_format:{type:'json_schema',json_schema:{name:'pos_sql',strict:true,schema:SQL_JSON}},
     messages:[{role:'system',content:SQL_SYSTEM},{role:'user',content:`${periods(now())}\nQuestion: ${String(question).slice(0,600)}`}]})});
   if(!response.ok){log('groq_sql_http_'+response.status);return null;}
   const out=JSON.parse((await response.json())?.choices?.[0]?.message?.content||'null');
   if(!out||typeof out.sql!=='string')return null;
   const sql=out.sql.trim().split(';')[0].trim();
   // The till enforces the real limits; this only drops obvious non-queries before a round trip.
   if(sql&&!/^(?:select|with)\b/i.test(sql))return{sql:'',explain:''};
   log('groq_sql_ok');return{sql:sql.slice(0,4000),explain:typeof out.explain==='string'?out.explain.slice(0,300):''};
  }catch(error){log('groq_sql_failed:'+(error?.name||'error'));return null;}
 };
}
