import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'artifacts/admin-destinations');
fs.mkdirSync(out, {recursive:true});
const bundle = fs.readFileSync(path.join(root,'index-DAmHwBc4.js'),'utf8');
const settings = bundle.slice(bundle.indexOf('function SettingsPage()'),bundle.indexOf('\nconst ICONS =',bundle.indexOf('function SettingsPage()')));
assert.ok(settings.includes('POS_DESTINATION_SETTINGS_TOP_v1'));
assert.ok(!settings.includes('saveVisibleSettings'));
assert.ok(!settings.includes('sticky-save show'));
assert.ok(bundle.includes('"/admin/tables": t.nav.adminTables'));
const cardRoutes=['/dashboard','/admin/catalog','/admin/staff','/operations?tab=roster','/admin/tables','/admin/gifts','/operations?tab=stock','/operations?tab=suppliers','/operations?tab=vendors','/operations?tab=guests','/operations?tab=reservations','/operations?tab=delivery','/admin/cash','/admin/reports','/reconcile','/audit','/settings','/admin/backup','/settings/license','/diagnostics'];
for(const destination of cardRoutes){
  const [route,query]=destination.split('?');
  assert.ok(bundle.includes(`path: "${route}"`),`Missing registered page: ${destination}`);
  if(query)assert.ok(bundle.includes(`id: "${query.slice(4)}"`),`Missing operations tab: ${destination}`);
}

const crumb = title => `<div class="ps-admin-breadcrumb"><a href="#">▦ &nbsp; İdarə</a><span>›</span><span>${title}</span></div>`;
const categories = [
  ['Restoran','Hesab və qəbz'],['Ekran və dil','Görünüş və touch'],['Printer','Qəbz və çap'],
  ['Cihaz və sistem','POS və bağlantı'],['Ehtiyat nüsxə','Backup və bərpa'],['Təhlükəli zona','Sıfırla və çıxış']
].map(([title,hint],i)=>`<button class="category ${i===0?'active':''}${i===5?' danger':''}" aria-current="${i===0?'page':'false'}"><span class="ci tone-${['blue','purple','green','gray','amber','red'][i]}">✦</span><b>${title}</b><span>${hint}</span></button>`).join('');
const fields = ['Restoran adı','Alt başlıq','Ünvan','Telefon','VÖEN','İş saatı','Filial adı','Filial kodu','Filial ünvanı','Filial telefonu'].map(label=>`<label><span>${label}</span><input value="" placeholder="${label}"></label>`).join('');
const settingsPage = `<div class="ps-admin-workspace" data-page="/settings">${crumb('Parametrlər')}<div class="ps-admin-content"><div class="ps-settings-page"><main class="settings-shell"><div class="settings-hero"><div><h1>Sistem ayarları</h1><p>Restoran, ekran, printer və cihaz sazlamaları.</p></div></div><nav class="category-bar">${categories}</nav><div class="ps-settings-stack" data-section="restaurant"><div class="space-y-3"><div><h2>Restoran</h2><p>Hesab və qəbz məlumatları</p></div><div class="account-ribbon"><div class="avatar">T</div><div class="meta"><b>test</b><span>test@gmail.com · Bu kassaya bağlı hesab</span></div><span class="badge">Aktiv</span><button class="btn soft">Hesabdan çıx</button></div><div class="card"><div class="cardhead"><div><h2>Restoran məlumatları</h2><p>Qəbzin başlığında çap olunan ad və əlaqə məlumatları.</p></div></div><div class="cardbody"><div class="grid">${fields}</div><div><p>ÇEK LOQOSU</p><p>Şəkil seçin — çekin başında çap olunacaq.</p><div class="ps-logo-row"><span class="ps-logo-thumb">Loqo yoxdur</span><button class="btn outline">Şəkil seç</button><button class="btn outline">Loqonu sil</button></div></div><div class="flex flex-wrap items-center"><button class="btn primary">Yadda saxla</button><button class="btn outline">Çek önizləməsi</button></div></div></div></div></div></main></div></div></div>`;
const tabs = ['Anbar','Təchizat','Təchizatçılar','Müştərilər','Rezervasiya','Çatdırılma','İş qrafiki','İxrac'].map((title,i)=>`<button aria-current="${i===0?'page':'false'}">${title}</button>`).join('');
const operationsPage = `<div class="ps-admin-workspace" data-page="/operations">${crumb('Anbar')}<div class="ps-admin-content"><div class="ps-operations-page"><header><h1>Anbar</h1><p class="ps-page-subtitle">Stok qalığını izləyin, məhsul əlavə edin və hərəkətləri idarə edin.</p></header><nav class="ps-ops-tabs">${tabs}</nav><div class="ps-ops-panel"><div class="space-y-4"><div class="ps-stock-metrics">${['Məhsul sayı','Stokda','Az qalıb','Bitib','Təxmini itki'].map((title,i)=>`<div class="ps-stock-metric"><p>${title}</p><p>${i*14+8}</p><p>Cari vəziyyət</p></div>`).join('')}</div><section><h2>Məhsullar</h2><p>Stok vəziyyətini izləyin.</p><button class="ps-ops-button ps-ops-button--gold">+ Yeni məhsul</button><div class="ps-ops-table"><table><thead><tr>${['Məhsul','Miqdar','Minimum','Maya','Əməliyyat'].map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${Array.from({length:4},(_,i)=>`<tr><td>Məhsul ${i+1}</td><td>12 ədəd</td><td>3 ədəd</td><td>5,00 ₼</td><td><button class="ps-ops-button ps-ops-button--quiet">Düzəlt</button></td></tr>`).join('')}</tbody></table></div></section></div></div></div></div></div>`;
const catalogRows = Array.from({length:5},(_,i)=>`<li class="ps-catalog-row"><div class="ps-catalog-ord"><button class="ps-catalog-shift">↑</button><button class="ps-catalog-shift">↓</button></div><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"><button class="ps-catalog-row-copy"><strong>Məhsul ${i+1}</strong><small>Təsvir və kateqoriya</small></button><span class="ps-catalog-price">14,00 ₼</span><span class="ps-pill">Aktiv</span><button class="ps-kebab">⋮</button></li>`).join('');
const catalogPage = `<div class="ps-admin-workspace" data-page="/admin/catalog">${crumb('Kataloq')}<div class="ps-admin-content"><div class="ps-catalog-page"><div class="border-b"><h1>Kataloq</h1><p class="ps-catalog-hint">Məhsullar, qiymətlər və kateqoriyalar</p></div><div class="ps-catalog-body"><aside class="ps-catalog-cats"><div class="ps-catalog-cats-head">Kateqoriyalar</div><div class="ps-catalog-add"><input placeholder="Yeni kateqoriya"><button>+</button></div><div class="ps-catalog-cat-list">${['Hamısı','Yeməklər','İçkilər','Desertlər'].map(x=>`<div class="ps-catalog-cat"><button class="ps-catalog-cat-main">${x}<span class="ps-catalog-count">12</span></button></div>`).join('')}</div></aside><div class="ps-catalog-main"><div class="ps-catalog-toolbar"><h2>Məhsullar</h2><input class="ps-catalog-search" placeholder="Məhsul axtar"><button class="ps-catalog-new-btn">+ Yeni məhsul</button></div><div class="ps-catalog-thead"><span>Sıra</span><span>Şəkil</span><span>Məhsul</span><span>Qiymət</span><span>Vəziyyət</span><span></span></div><ul class="ps-catalog-list">${catalogRows}</ul></div></div></div></div></div>`;
const pages = {settings:settingsPage,operations:operationsPage,catalog:catalogPage};
const server = http.createServer((req,res)=>{
  if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(fs.readFileSync(path.join(root,'possistem-system.css')));return;}
  const name = new URL(req.url,'http://local').searchParams.get('page') || 'settings';
  res.setHeader('Content-Type','text/html');
  res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><style>html,body{margin:0;width:100%;height:100%;font-family:Arial,sans-serif}.ps-admin-workspace{height:100dvh}.ps-admin-content{min-height:0}</style></head><body>${pages[name]}</body></html>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
try{
  const page = await browser.newPage({hasTouch:true});
  const results=[];
  for(const name of Object.keys(pages))for(const [width,height] of [[360,800],[768,1024],[1024,768],[1366,900],[1920,1080],[3840,2160]]){
    await page.setViewportSize({width,height});
    await page.goto(`http://127.0.0.1:${server.address().port}/?page=${name}`);
    const state=await page.evaluate(()=>({vw:document.documentElement.clientWidth,sw:document.documentElement.scrollWidth,buttons:[...document.querySelectorAll('button')].map(e=>({name:e.textContent.trim(),height:e.getBoundingClientRect().height,width:e.getBoundingClientRect().width})),nav:getComputedStyle(document.querySelector('.category-bar,.ps-ops-tabs,.ps-catalog-cat-list')).display}));
    assert.ok(state.sw<=state.vw+1,`${name} ${width}px overflow: ${JSON.stringify(state)}`);
    assert.ok(state.buttons.every(x=>x.height>=48&&x.width>=48),`${name} ${width}px small button: ${JSON.stringify(state.buttons.filter(x=>x.height<48||x.width<48))}`);
    if(width===360||width===1366)await page.locator('.ps-admin-workspace').screenshot({path:path.join(out,`${name}-${width}.png`)});
    results.push({name,width,overflow:false,buttons:state.buttons.length});
  }
  await page.setViewportSize({width:360,height:800});
  await page.goto(`http://127.0.0.1:${server.address().port}/?page=settings`);
  await page.evaluate(()=>document.documentElement.style.zoom=1.5);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),'Settings overflow at 150% zoom');
  await page.evaluate(()=>document.documentElement.style.zoom=1);
  for(const width of [360,1366]){
    await page.setViewportSize({width,height:800});
    await page.evaluate(()=>{const scroller=document.querySelector('.ps-settings-page');scroller.scrollTop=scroller.scrollHeight;});
    const bottom=await page.evaluate(()=>{const scroller=document.querySelector('.ps-settings-page'),action=document.querySelector('.cardbody .btn.primary');return {moved:scroller.scrollTop>0,visible:action.getBoundingClientRect().bottom<=scroller.getBoundingClientRect().bottom+1};});
    assert.ok(bottom.moved&&bottom.visible,`Settings actions unreachable at ${width}px: ${JSON.stringify(bottom)}`);
    await page.locator('.ps-admin-workspace').screenshot({path:path.join(out,`settings-bottom-${width}.png`)});
  }
  fs.writeFileSync(path.join(out,'qa-results.json'),JSON.stringify({results,cardRoutes,globalSaveRemoved:true,settingsBottomReachable:true},null,2));
  console.log(`PASS ${cardRoutes.length} card routes, ${results.length} destination layouts, 150% zoom, touch targets, reachable settings actions`);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
