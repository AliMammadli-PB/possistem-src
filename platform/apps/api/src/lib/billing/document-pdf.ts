import PDFDocument from 'pdfkit';
import {fileURLToPath} from 'node:url';
import type {BillingDocument} from './documents.js';

export type DocumentKind='invoice'|'agreement'|'evidence';
const font=(name:string)=>fileURLToPath(new URL('../../../assets/fonts/'+name,import.meta.url));
const date=(x:string|Date|null)=>x?new Date(x).toLocaleString('az-AZ',{timeZone:'Asia/Baku',hour12:false}):'Qeyd yoxdur';
const money=(x:string|number)=>new Intl.NumberFormat('az-AZ',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(x)/100)+' AZN';
const productNames:Record<string,string>={restaurant:'Restoran POS',market:'Market POS',geyim:'Geyim POS',aptek:'Aptek POS',topdan:'Topdan POS'};
const statusNames:Record<string,string>={paid:'Ödənilib',refunded:'Geri qaytarılıb',refund_pending:'Geri qaytarma gözlənilir',paid_review:'Ödəniş yoxlanılır',failed:'Uğursuz',awaiting_payment:'Ödəniş gözlənilir',processing:'Emal olunur',unknown:'Nəticə qeyri-müəyyəndir',expired:'Vaxtı bitib'};

/** Server-generated PDF with embedded Azerbaijani glyphs. It is a record extract, not a fabricated bank certificate/signature. */
export async function billingDocumentPdf(data:BillingDocument,kind:DocumentKind='invoice'):Promise<Buffer>{
 const {order:o,invoice:i,items}=data;
 const doc=new PDFDocument({size:'A4',margins:{top:44,left:44,right:44,bottom:48},bufferPages:true,font:font('FiraSans-Regular.ttf'),info:{Title:`Possistem — ${o.order_no}`,Author:i.seller.name||'Possistem',Subject:'Ödəniş və elektron razılıq qeydləri',CreationDate:new Date(i.generatedAt)}});
 doc.registerFont('regular',font('FiraSans-Regular.ttf')).registerFont('bold',font('FiraSans-SemiBold.ttf'));
 const chunks:Buffer[]=[];
 const done=new Promise<Buffer>((resolve,reject)=>{doc.on('data',chunk=>chunks.push(Buffer.from(chunk)));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 const left=44,width=507,bottom=774;
 let y=44;
 const space=(height:number)=>{if(y+height>bottom){doc.addPage();y=44;}};
 const text=(value:string,size=10,bold=false,color='#20364e')=>{doc.font(bold?'bold':'regular').fontSize(size).fillColor(color);const h=doc.heightOfString(value,{width,lineGap:3});space(h+8);doc.text(value,left,y,{width,lineGap:3});y+=h+8;};
 const section=(title:string)=>{space(85);y+=8;text(title,11,true,'#155bc7');};
 const row=(label:string,value:unknown)=>{
  const v=value===null||value===undefined||value===''?'Qeyd yoxdur':String(value);
  doc.font('regular').fontSize(9);
  const h=Math.max(doc.heightOfString(label,{width:164}),doc.heightOfString(v,{width:331}))+13;
  space(h);doc.fillColor('#5d6e83').text(label,left,y,{width:164});doc.fillColor('#172f4b').text(v,left+176,y,{width:331});
  y+=h;doc.strokeColor('#e6edf5').lineWidth(.4).moveTo(left,y-5).lineTo(left+width,y-5).stroke();
 };
 const header=(title:string)=>{text('possistem',22,true,'#155bc7');text(title,18,true);text(o.order_no,9,false,'#5d6e83');};
 const identity=()=>{
  section('Tərəflər');row('Satıcı',i.seller.name);row('Satıcının VÖEN-i',i.seller.voen);row('Satıcının ünvanı / əlaqə',[i.seller.address,i.seller.phone].filter(Boolean).join(' · '));
  row('Müştəri hesabı / obyekt',i.buyer.name);row('Əlaqəli şəxs',i.buyer.contactPerson);row('Hesabın e-poçtu',i.buyer.email);row('Telefon',i.buyer.phone);row('Müştəri ünvanı / VÖEN',[i.buyer.address,i.buyer.voen].filter(Boolean).join(' · '));
 };
 const provenance=()=>{
  section('Məlumatın mənbəyi');
  text('Əlaqəli şəxsin adı hesab profilindən götürülüb. Bank cavabı kart sahibinin adını təsdiqləmir. Bu PDF Possistem qeydlərindən çıxarışdır; bankın imzalı çıxarışı və ya tərəflərin imzaladığı müqavilə deyil.',9,false,'#5d6e83');
  if(i.buyer.snapshotSource==='reconstructed')text('Tarixi ödəniş üçün şəxs məlumatları '+date(i.buyer.snapshotAt)+' tarixində mövcud profildən bərpa edilib; ödəniş anının ayrıca profil arxivi mövcud deyil.',9,false,'#5d6e83');
  row('Sənədin hazırlanma vaxtı',date(i.generatedAt)+' (Bakı)');row('Məlumat SHA-256',i.dataSha256);
  text('SHA-256 çıxarış məlumatlarının müqayisəsi üçündür, elektron imza deyil. Bütün tarixlər Bakı vaxtı (UTC+04:00) ilə göstərilir.',8,false,'#5d6e83');
 };
 if(kind==='invoice'||kind==='evidence'){
  header('Faktura və ödəniş qəbzi');row('Sənədin vəziyyəti',statusNames[o.status]??o.status);identity();
  section('Xidmət / məhsul');
  if(o.kind==='subscription')row(productNames[o.product??'']??o.product??'POS',`1 ay · ${money(o.amount_minor)}`);
  else if(items.length)for(const item of items)row(item.name,`${item.qty} × ${money(item.unit_price_minor)} = ${money(Number(item.unit_price_minor)*item.qty)}`);
  else row(o.note||'Birdəfəlik ödəniş',money(o.amount_minor));
  if(Number(o.delivery_fee_minor)>0)row('Çatdırılma',money(o.delivery_fee_minor));
  row('Yekun məbləğ',money(o.amount_minor));
  if(Number(o.refunded_minor)>0)row('Geri qaytarılmış məbləğ',money(o.refunded_minor));
  if(o.period_start)row('Ödənilmiş istifadə dövrü',date(o.period_start)+' — '+date(o.period_end));
  section('Bank əməliyyatı');row('Sifarişin yaradılması',date(o.created_at));row('Ödənişin təsdiqi',date(o.paid_at));row('Ödənişi başladan hesab',i.buyer.email);
  row('Epoint əməliyyat nömrəsi',i.payment?.transaction_id);row('Bank RRN',i.payment?.rrn);row('Maskalanmış kart',i.payment?.card_mask);row('Provayder sifariş nömrəsi',i.payment?.provider_order_id);row('Bank nəticəsi / kodu',[i.payment?.message,i.payment?.code].filter(Boolean).join(' · '));
  if(i.payment?.card_name)row('Bank səhifəsində yazılan ad',i.payment.card_name+' (istifadəçinin yazdığı ad)');
  provenance();
 }
 if(kind==='agreement'||kind==='evidence'){
  if(kind==='evidence'){doc.addPage();y=44;}
  header('Elektron razılıq və abunə şərtləri');identity();
  section('Razılıq qeydi');
  if(i.consent){
   row('Elektron qəbul qeydi',i.consent.id);row('Qəbul edən hesab',i.buyer.email);row('Razılıq verilən məbləğ',money(i.consent.amount_minor)+' / ay');row('Qəbul vaxtı',date(i.consent.accepted_at));row('Qəbul edilmiş şərtlər',i.consent.terms_version);
   row('Razılığın geri götürülməsi',i.consent.withdrawn_at?date(i.consent.withdrawn_at):'Geri götürülmə qeydi yoxdur');
   text('Qeyd bu hesabdan abunəlik şərtlərinin elektron qaydada qəbulunu göstərir. Sonradan razılığın geri götürülməsi əvvəlki ödənişin baş verməsi faktını dəyişmir; ödənişin cari vəziyyəti qəbzdə ayrıca göstərilir.',9);
  }else text('Bu ödənişə dəqiq əlaqələndirilmiş elektron razılıq qeydi tapılmadı. Müştərinin qəbul etdiyi və ya imzaladığı iddia edilmir.',10,true);
  if(i.terms){
   section('Qəbul zamanı saxlanılmış şərtlər · '+o.terms_version);
   const parts=o.kind==='subscription'?[['subscriptionTerms','Abunəlik və avtomatik ödəniş'],['refundTerms','Geri qaytarma'],['privacyPolicy','Məxfilik']]:[['deliveryTerms','Çatdırılma və təhvil'],['refundTerms','Geri qaytarma'],['privacyPolicy','Məxfilik']];
   for(const [key,title] of parts)if(i.terms[key]){section(title);text(i.terms[key],10);}
   if(!i.consent)text('Mətnin arxivdə olması ayrıca imza və ya qəbul sübutu sayılmır.',9);
  }else text('Sifariş vaxtındakı şərtlərin arxiv nüsxəsi yoxdur. Cari şərtlər keçmişdə qəbul edilmiş mətn kimi təqdim edilmir.',10);
  provenance();
 }
 if(kind==='evidence'){
  doc.addPage();y=44;header('Əməliyyat və audit çıxarışı');
  section('Ödənişin qeydləri');for(const p of i.payments){row('Əməliyyat',`${p.kind} · ${p.status}`);row('Epoint / RRN',[p.transaction_id,p.rrn].filter(Boolean).join(' · '));row('Tarix',date(p.updated_at));}
  section('Serverdə təsdiq mənbəyi');for(const e of i.events)row(date(e.created_at),[e.action,e.source,e.transaction].filter(Boolean).join(' · '));
  if(i.consent?.ip_hash)row('Razılıq mənbəsinin IP heşi',i.consent.ip_hash);
  provenance();
 }
 const range=doc.bufferedPageRange();
 for(let n=range.start;n<range.start+range.count;n++){
  doc.switchToPage(n);
  // The footer is outside the body margin; do not let PDFKit flow it onto a new page.
  const margin=doc.page.margins.bottom;doc.page.margins.bottom=0;
  doc.font('regular').fontSize(8).fillColor('#6b7e93').text(`Possistem · ${o.id} · ${n+1} / ${range.count}`,44,806,{width:507,lineBreak:false});
  doc.page.margins.bottom=margin;
 }
 doc.end();return done;
}
