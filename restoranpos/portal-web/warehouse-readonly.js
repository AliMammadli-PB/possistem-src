// Portal-only presentation guard. The authenticated API remains authoritative for every write.
if (window.parent?.cloudBranches?.readOnly) {
 const mutation=/(^|[+\s])(yeni|sil|düzəliş|kopyala|saxla|təsdiqlə|göndər|qəbul|ödə|ləğv|import|yarat|new|delete|edit|copy|save|confirm|dispatch|receive|pay|cancel|создать|изменить|удалить|сохранить|подтвердить|отправить|принять|оплатить|отменить)(?=\s|$|[.!…])/u;
 const forbidden=el=>el instanceof HTMLButtonElement&&mutation.test([el.textContent,el.title,el.getAttribute('aria-label')].filter(Boolean).join(' ').toLocaleLowerCase());
 const apply=()=>{for(const button of document.querySelectorAll('button'))if(forbidden(button)&&!button.disabled){button.disabled=true;button.setAttribute('aria-disabled','true');button.title='Yalnız baxış — dəyişiklik icazəniz yoxdur';}};
 const start=()=>{apply();new MutationObserver(apply).observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['disabled','aria-label','title']});};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
 document.addEventListener('click',event=>{const button=event.target instanceof Element?event.target.closest('button'):null;if(button&&forbidden(button)){event.preventDefault();event.stopImmediatePropagation();}},true);
}
