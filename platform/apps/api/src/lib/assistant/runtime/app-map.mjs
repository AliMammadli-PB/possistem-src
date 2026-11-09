import {normalize} from './stock-assistant.mjs';
// Where things live in Restoran POS (routes from psManagementModule in the till). A matching request gets an "open" button
// (choice value "nav:<route>", which the till's chat turns into navigation), and Groq's app answers use the same names.
export const SCREENS=[
 {route:'/operations?tab=stock',name:'Anbar qalığı',where:'İdarə → Menyu və anbar → Anbar',words:/\b(?:anbar\w*|qaliq\w*|qalig\w*|stok\w*)\b/},
 {route:'/operations?tab=goods',name:'Mallar',where:'İdarə → Menyu və anbar → Mallar',words:/\b(?:mal kart\w*|mallar\w*|xammal\w*|barkod\w*)\b/},
 {route:'/operations?tab=stocktake',name:'Sayım',where:'İdarə → Menyu və anbar → Sayım',words:/\b(?:sayim\w*|inventarizasiya\w*)\b/},
 {route:'/operations?tab=costing',name:'Kalkulyasiya və maya',where:'İdarə → Menyu və anbar → Kalkulyasiya',words:/\b(?:kalkul\w*|resept\w*|maya\w*)\b/},
 {route:'/admin/catalog',name:'Menyu',where:'İdarə → Menyu və anbar → Menyu',words:/\b(?:menyu\w*|yemek\w*|kateqoriya\w*|set menyu\w*|modifikator\w*)\b/},
 {route:'/operations?tab=sales',name:'Satışlar',where:'İdarə → Ticarət',words:/\b(?:satis\w*|sifaris\w*|cek\w* tarixce\w*)\b/},
 {route:'/operations?tab=purchases',name:'Alış və mal qəbulu',where:'İdarə → Ticarət → Alışlar (Təchizat → Mal qəbulu)',words:/\b(?:alis\w*|mal qebul\w*|qaime\w*|tedaruk\w*|techizat\w*)\b/},
 {route:'/operations?tab=vendors',name:'Partnyorlar (tədarükçü, kuryer)',where:'İdarə → Heyət və xidmət → Partnyorlar',words:/\b(?:partnyor\w*|tedarukcu\w*|techizatci\w*)\b/},
 {route:'/operations?tab=kassa',name:'Kassa',where:'İdarə → Maliyyə → Kassa',words:/\b(?:kassa\w*|nagd\w*|kocurme\w*)\b/},
 {route:'/operations?tab=expenses',name:'Xərclər',where:'İdarə → Maliyyə → Xərclər',words:/\b(?:xerc\w*|maas\w*|icare\w*|kommunal\w*)\b/},
 {route:'/operations?tab=documents',name:'Maliyyə sənədləri (qaimələr)',where:'İdarə → Maliyyə → Sənədlər',words:/\b(?:senedler\w*|qaime\w*|faktura\w*)\b/},
 {route:'/operations?tab=export',name:'İxrac (Excel, PDF)',where:'İdarə → Maliyyə → İxrac',words:/\b(?:ixrac\w*|excel\w*|pdf\w*|yukle\w*)\b/},
 {route:'/operations?tab=delivery',name:'Çatdırılma və kuryerlər',where:'İdarə → Heyət və xidmət → Çatdırılma',words:/\b(?:catdirilma\w*|kuryer\w*)\b/},
 {route:'/admin/staff',name:'İşçilər və rollar',where:'İdarə → Heyət və xidmət → İşçilər',words:/\b(?:isci\w*|heyet\w*|ofisiant\w*|kassir\w*|rol\w*|pin\w*|novbe\w*|maas\w*)\b/},
 {route:'/admin/tables',name:'Masalar və zallar',where:'İdarə → Heyət və xidmət → Masalar',words:/\b(?:masa\w*|zal\w*)\b/},
 {route:'/admin/gifts',name:'Hədiyyə və endirim kampaniyaları',where:'İdarə → Heyət və xidmət → Hədiyyələr',words:/\b(?:endirim\w*|kampaniya\w*|hediyye\w*|aksiya\w*|bonus\w*)\b/},
 {route:'/refund',name:'Geri qaytarma',where:'İdarə → Ticarət → Qaytarma',words:/\b(?:geri qaytar\w*|qaytarma\w*|iade\w*|refund\w*)\b/},
 {route:'/dashboard',name:'Hesabatlar, X və Z',where:'İdarə → Maliyyə → Hesabatlar',words:/\b(?:hesabat\w*|x hesabat\w*|z hesabat\w*|gunu bagla\w*)\b/},
 {route:'/settings?section=printer',name:'Printer ayarları',where:'İdarə → Parametrlər → Printer',words:/\b(?:printer\w*|cap\w*|xprinter\w*)\b/},
 {route:'/settings?section=receipt',name:'Çek: loqo, QR və kağız',where:'İdarə → Parametrlər → Çek',words:/\b(?:loqo\w*|logo\w*|cek\w*|kagiz\w*)\b/},
 {route:'/settings?section=qr-orders',name:'QR menyu sifarişi',where:'İdarə → Parametrlər → QR sifariş',words:/\b(?:qr\w*)\b/},
 {route:'/admin/backup',name:'Ehtiyat nüsxə',where:'İdarə → Parametrlər → Ehtiyat nüsxə',words:/\b(?:ehtiyat\w*|backup\w*|beket\w*)\b/},
 {route:'/settings/license',name:'Lisenziya və abunəlik',where:'İdarə → Parametrlər → Lisenziya',words:/\b(?:lisenz\w*|abune\w*|abone\w*)\b/},
 {route:'/settings?section=updates',name:'Yeniləmə',where:'İdarə → Parametrlər → Yeniləmə',words:/\b(?:yenile\w*|versiya\w*|update\w*)\b/},
];
/** Up to two screens a request is about, most specific first, as "open" buttons. */
export function screensFor(text,label=(s)=>`↗ ${s.name}`){
 const n=normalize(text);return SCREENS.filter(s=>s.words.test(n)).slice(0,2).map(s=>({label:label(s),value:'nav:'+s.route,where:s.where}));
}
export const MAP_TEXT=SCREENS.map(s=>`${s.name}: ${s.where}`).join('; ');
