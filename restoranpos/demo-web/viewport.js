// Only browser demos use this adapter; all controls operate on the real renderer.
const labels={az:{cart:'Səbət',back:'Məhsullara qayıt'},en:{cart:'Cart',back:'Back to products'},ru:{cart:'Корзина',back:'Вернуться к товарам'},tr:{cart:'Sepet',back:'Ürünlere dön'}};
const cssURL=new URL('./viewport.css',import.meta.url).href;
const embedded=new WeakSet();
let scheduled=false,button;
const update=()=>{
 scheduled=false;
 const grid=document.querySelector('[class*="grid-cols-[176px"]');
 if(grid&&!grid.classList.contains('demo-order-layout')){
   grid.classList.add('demo-order-layout');
   const [categories,products,cart]=grid.children;
   categories?.classList.add('demo-order-categories');products?.classList.add('demo-order-products');cart?.classList.add('demo-order-cart');
   grid.previousElementSibling?.classList.add('demo-order-header');
 }
 const sale=document.querySelector('.sale-layout,.demo-order-layout');
 if(!sale){document.documentElement.removeAttribute('data-demo-cart');if(button)button.hidden=true;}
 else {
   if(!button){button=document.createElement('button');button.type='button';button.className='demo-phone-cart';button.addEventListener('click',()=>{document.documentElement.dataset.demoCart=document.documentElement.dataset.demoCart==='open'?'closed':'open';update();});document.body.append(button);}
   const lang=window.__psMarketLang||document.documentElement.lang||'az',text=labels[lang]||labels.az;
   const open=document.documentElement.dataset.demoCart==='open';
   button.hidden=false;const count=document.querySelectorAll('.cart-lines .cart-line').length;
   const title=open?text.back:text.cart+(count?' · '+count:'');
   if(button.textContent!==title)button.textContent=title;
   button.setAttribute('aria-expanded',String(open));
   const toolbar=document.querySelector('.sale-toolbar')||document.querySelector('.demo-order-header>div:last-child');
   const target=!open&&toolbar?toolbar:document.body;
   button.classList.toggle('is-catalog',target!==document.body);
   if(button.parentElement!==target)target.append(button);
 }
 // Nested warehouse/settings frames reuse the same browser-only responsive rules.
 for(const frame of document.querySelectorAll('iframe')){
   if(embedded.has(frame))continue;embedded.add(frame);
   const apply=()=>{try{const doc=frame.contentDocument;if(!doc||doc.getElementById('pos-demo-responsive'))return;const link=doc.createElement('link');link.id='pos-demo-responsive';link.rel='stylesheet';link.href=cssURL;doc.head.append(link);}catch{}};
   frame.addEventListener('load',apply);apply();
 }
};
new MutationObserver(()=>{if(!scheduled){scheduled=true;requestAnimationFrame(update);}}).observe(document.body,{childList:true,subtree:true});
window.addEventListener('hashchange',()=>{document.documentElement.removeAttribute('data-demo-cart');update();});update();
