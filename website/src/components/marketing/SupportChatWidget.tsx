 'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useCustomerSession } from '@/components/providers/CustomerSessionProvider';
import { useI18n } from '@/components/providers/I18nProvider';
import { getConversationReply, type ConversationReply } from '@/lib/support-conversation';
import { SupportReport } from './SupportReport';
import { Close, ArrowRight } from './DesignIcons';
import './support-chat.css';
import { SupportMascot, useMascotMotion, useMascotGesture } from './SupportMascot';
type Message = { id: string; authorKind: string; body: string; createdAt: string; meta?: { attachment?: { id?: string; fileName?: string; mimeType?: string } } };
type Ticket = { id: string; status: string };
type LocalMessage = { id: number; author: 'me' | 'helper'; body: string; reply?: ConversationReply; createdAt?:string; file?: { url: string; name: string } };
const CHAT_KEY = (id?: string | null) => `possistem.support.chat.${id || 'guest'}`;
const readChat = (key: string) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw) as { local?: LocalMessage[]; mode?: 'assistant' | 'agent'; startedAt?: string };
    return { local: (data.local ?? []).slice(-80).map((m) => ({ ...m, file: undefined })), mode: data.mode === 'agent' ? 'agent' as const : 'assistant' as const, startedAt: data.startedAt };
  } catch { return null; }
};
const writeChat = (key: string, data: { local: LocalMessage[]; mode: 'assistant' | 'agent'; startedAt: string }) => {
  try { localStorage.setItem(key, JSON.stringify({ ...data, local: data.local.slice(-80).map(({ file: _file, ...m }) => m) })); } catch { /* storage full */ }
};
const OPEN_EVENT = 'possistem:open-support';
const SEEN_KEY = 'possistem.support.seenAdmin';
export function openSupportChat() { window.dispatchEvent(new Event(OPEN_EVENT)); }
const COPY = {
  az: { open: 'Canlı dəstək', title: 'Canlı dəstək', close: 'Bağla', email: 'E-poçt', password: 'Şifrə', login: 'Daxil ol', loginHint: 'Dəstəyə yazmaq üçün müştəri hesabınıza daxil olun.',
    register: 'Hesabınız yoxdur? Qeydiyyatdan keçin', wrong: 'E-poçt və ya şifrə yanlışdır.', placeholder: 'Probleminizi yazın…', send: 'Göndər', you: 'Siz', support: 'Dəstək',
    empty: 'Probleminizi yazın. Göndərilən sorğu dəstək siyahısında saxlanılır.', waiting: 'Sorğunuz göndərildi. Dəstək əməkdaşı gözlənilir…', claimed: 'Əməkdaş sorğunu qəbul edib. Cavabı bu pəncərədə görünəcək.',
    resolved: 'Sorğu bağlanıb. Yeni mesaj yeni sorğu açacaq.', offline: 'Bağlantı yoxdur. Yenidən yoxlanılır…', phone: 'Telefon: 051 333 35 55', loading: 'Yüklənir…' },
  en: { open: 'Live support', title: 'Live support', close: 'Close', email: 'Email', password: 'Password', login: 'Sign in', loginHint: 'Sign in to your customer account to write to support.',
    register: 'No account? Register', wrong: 'Incorrect email or password.', placeholder: 'Describe the problem…', send: 'Send', you: 'You', support: 'Support',
    empty: 'Describe the problem. Your sent request is saved in the support inbox.', waiting: 'Request sent. Waiting for a support agent…', claimed: 'An agent accepted your request. Their reply will appear here.',
    resolved: 'Request closed. A new message opens a new request.', offline: 'No connection. Retrying…', phone: 'Phone: 051 333 35 55', loading: 'Loading…' },
  ru: { open: 'Онлайн-поддержка', title: 'Онлайн-поддержка', close: 'Закрыть', email: 'Email', password: 'Пароль', login: 'Войти', loginHint: 'Войдите в аккаунт клиента, чтобы написать в поддержку.',
    register: 'Нет аккаунта? Зарегистрируйтесь', wrong: 'Неверный email или пароль.', placeholder: 'Опишите проблему…', send: 'Отправить', you: 'Вы', support: 'Поддержка',
    empty: 'Опишите проблему. Отправленное обращение сохраняется в списке поддержки.', waiting: 'Запрос отправлен. Ожидаем специалиста…', claimed: 'Специалист принял обращение. Ответ появится здесь.',
    resolved: 'Запрос закрыт. Новое сообщение откроет новый запрос.', offline: 'Нет связи. Повторяем…', phone: 'Телефон: 051 333 35 55', loading: 'Загрузка…' },
};

const HELP_COPY = {
 az: { thinking:'Cavab hazırlanır…',launcherLabel:'Dəstək',launcherHint:'Sualınız var?',clear:'Yeni söhbət',open:'Texniki dəstək',title:'Possistem köməkçisi',subtitle:'Hazır cavablarla texniki kömək',helper:'Avtomatik köməkçi',assistant:'Köməkçi',agent:'Əməkdaşa yaz',back:'Köməkçiyə qayıt',intro:'Salam, sizə necə kömək edə bilərəm?',notice:'Hazır cavablarla işləyir. Hesabınıza baxmır və dəyişiklik etmir.',placeholder:'Sualınızı yazın…',more:'Təlimatı aç',handoff:'Yazışmanı nəzərdən keçirin və göndərin. Yalnız göndərdikdən sonra dəstək sorğusu yaranacaq.',context:'Köməkçi ilə söhbətdən:',safe:'Şifrə və PIN göndərməyin.',questions:['Proqramı necə quraşdırım?','Printer çek çap etmir','Anbar qalığını necə görüm?','Paketlərin qiyməti nədir?'],sent:'Mesaj göndərildi.',limit:'Söhbət uzanıb. Davam etmək üçün əməkdaşa yazın və ya Yeni söhbət seçin.' },
 en: { thinking:'Preparing a reply…',launcherLabel:'Support',launcherHint:'Need a hand?',clear:'New conversation',open:'Technical support',title:'Possistem assistant',subtitle:'Technical help with prepared answers',helper:'Automated assistant',assistant:'Assistant',agent:'Contact an agent',back:'Back to assistant',intro:'Hello! How can I help?',notice:'Uses prepared answers. Cannot access or change your account.',placeholder:'Ask a question…',more:'Open guide',handoff:'Review the conversation and send it. A support ticket is created only after you send.',context:'From the assistant conversation:',safe:'Do not send passwords or PINs.',questions:['How do I install the app?','My printer does not print','How do I check stock?','What are the plan prices?'],sent:'Message sent.',limit:'This conversation is long. Contact an agent or choose New conversation to continue.' },
 ru: { thinking:'Готовлю ответ…',launcherLabel:'Поддержка',launcherHint:'Есть вопрос?',clear:'Новая беседа',open:'Техническая поддержка',title:'Помощник Possistem',subtitle:'Техническая помощь по готовым ответам',helper:'Автоматический помощник',assistant:'Помощник',agent:'Написать специалисту',back:'Вернуться к помощнику',intro:'Здравствуйте! Чем помочь?',notice:'Использует готовые ответы. Не видит и не меняет ваш аккаунт.',placeholder:'Задайте вопрос…',more:'Открыть инструкцию',handoff:'Проверьте переписку и отправьте. Обращение создаётся только после отправки.',context:'Из переписки с помощником:',safe:'Не отправляйте пароли и PIN.',questions:['Как установить приложение?','Принтер не печатает','Как проверить остатки?','Какие цены на пакеты?'],sent:'Сообщение отправлено.',limit:'Переписка слишком длинная. Напишите специалисту или начните новую беседу.' },
};
const lastAdminAt = (list: Message[]) => list.filter(m => m.authorKind === 'admin').map(m => m.createdAt).sort().at(-1) ?? '';
const readSeen = () => { try { return localStorage.getItem(SEEN_KEY) ?? ''; } catch { return ''; } };
const writeSeen = (value: string) => { try { localStorage.setItem(SEEN_KEY, value); } catch { /* storage blocked */ } };

export function SupportChatWidget() {
 const { language } = useI18n(), c=COPY[language]??COPY.az, h=HELP_COPY[language]??HELP_COPY.az;
 const session=useCustomerSession();
 const [open,setOpen]=useState(false),[mode,setMode]=useState<'assistant'|'agent'>('assistant');
 const [unread,setUnread]=useState(false),[ticket,setTicket]=useState<Ticket|null>(null),[messages,setMessages]=useState<Message[]>([]);
 const [local,setLocal]=useState<LocalMessage[]>([]),[draft,setDraft]=useState(''),[agentDraft,setAgentDraft]=useState('');
 const [thinking,setThinking]=useState(false),[tools,setTools]=useState(false),[pendingHandoff,setPendingHandoff]=useState(false);
 const [availability,setAvailability]=useState<{isOpen:boolean;start:string;end:string;nextOpen:string|null}>();
 const reportKeys=useRef<Record<string,string>>({}),startedAt=useRef(new Date().toISOString());
 useEffect(()=>{let alive=true;const pull=()=>void fetch('/pos/api/public/support/availability',{cache:'no-store'}).then(r=>r.ok?r.json():undefined).then(v=>{if(alive&&v)setAvailability(v);}).catch(()=>{});if(open){pull();const timer=setInterval(pull,60000);return()=>{alive=false;clearInterval(timer);};}return()=>{alive=false;};},[open]);
 const pendingReply=useRef<ReturnType<typeof setTimeout>|null>(null),answering=useRef(false);
 useEffect(()=>()=>{if(pendingReply.current)clearTimeout(pendingReply.current);},[]);
 const clearConversation=()=>{if(pendingReply.current)clearTimeout(pendingReply.current);pendingReply.current=null;answering.current=false;setThinking(false);setPendingHandoff(false);setLocal([]);setDraft('');startedAt.current=new Date().toISOString();input.current?.focus();};
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState('');
 const list=useRef<HTMLDivElement>(null),input=useRef<HTMLTextAreaElement>(null),panel=useRef<HTMLElement>(null),fab=useRef<HTMLButtonElement>(null);
 const previousFocus=useRef<HTMLElement|null>(null),sending=useRef(false),sequence=useRef(0),identity=useRef(session.customerId),hydrated=useRef('');
 const motion=useMascotMotion();
 const mascot=useMascotGesture('idle',motion.effective==='full'&&!open);
 const humanOpen=open&&mode==='agent';
 const call=useCallback(async(path:string,init:RequestInit={})=>{
  const res=await fetch(`/pos/api${path}`,{...init,credentials:'include',headers:{Accept:'application/json','Content-Type':'application/json',...(session.csrfToken?{'x-csrf-token':session.csrfToken}:{})}});
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(res.status===401?c.loginHint:c.offline);
  return data;
 },[session.csrfToken,c.loginHint,c.offline]);
 const load=useCallback(async()=>{
  const customerId=session.customerId;if(!customerId)return;
  const data=await call('/customer/support/active') as {ticket:Ticket|null;messages:Message[]};
  if(identity.current!==customerId)return;
  setTicket(data.ticket);setMessages(data.messages??[]);setError('');writeSeen(lastAdminAt(data.messages??[]));
 },[call,session.customerId]);
 useEffect(()=>{const show=()=>{previousFocus.current=document.activeElement as HTMLElement;setOpen(true);};window.addEventListener(OPEN_EVENT,show);return()=>window.removeEventListener(OPEN_EVENT,show);},[]);
 useEffect(()=>{const key=CHAT_KEY(session.customerId);if(hydrated.current!==key)return;writeChat(key,{local,mode,startedAt:startedAt.current});},[local,mode,session.customerId]);
 useEffect(()=>{
  const key=CHAT_KEY(session.customerId);
  if(hydrated.current===key)return;
  if(identity.current!==session.customerId){const previous=identity.current;identity.current=session.customerId;setTicket(null);setMessages([]);setUnread(false);setError('');if(previous){setAgentDraft('');setPendingHandoff(false);}}
  const saved=readChat(key);
  if(saved){setLocal(saved.local);setMode(saved.mode);sequence.current=saved.local.reduce((max,m)=>Math.max(max,m.id),0);if(saved.startedAt)startedAt.current=saved.startedAt;}
  else setLocal([]);
  hydrated.current=key;
 },[session.customerId]);
 useEffect(()=>{
  if(!humanOpen||!session.authenticated)return;
  let alive=true;
  const refresh=()=>{if(document.visibilityState==='visible')void load().then(()=>{if(alive)setUnread(false);}).catch(()=>{if(alive)setError(c.offline);});};
  refresh();const timer=window.setInterval(refresh,4000);
  return()=>{alive=false;window.clearInterval(timer);};
 },[humanOpen,session.authenticated,load,c.offline]);
 useEffect(()=>{
  if(humanOpen||!session.authenticated)return;
  let alive=true;
  const check=()=>{if(document.visibilityState!=='visible')return;void call('/customer/support/active').then(data=>{if(!alive)return;const latest=lastAdminAt(data.messages??[]);setUnread(Boolean(latest&&latest>readSeen()));}).catch(()=>undefined);};
  check();const timer=window.setInterval(check,30000);return()=>{alive=false;window.clearInterval(timer);};
 },[humanOpen,session.authenticated,call]);
 useEffect(()=>{list.current?.scrollTo({top:list.current.scrollHeight});},[local.length,messages.length,open,mode,thinking]);
 useEffect(()=>{
  if(!open)return;
  // Opening on touch must not summon the keyboard or pan the page.
  const pointerIsCoarse=window.matchMedia?.('(pointer: coarse)').matches??false;
  const focus=window.setTimeout(()=>{if(pointerIsCoarse)panel.current?.focus({preventScroll:true});else input.current?.focus({preventScroll:true});},50);
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();setOpen(false);}};
  const resize=()=>{
   const viewport=window.visualViewport;
   panel.current?.style.setProperty('--support-height',`${viewport?.height??window.innerHeight}px`);
   // Keep the composer above a soft keyboard, including browsers that pan the visual viewport.
   panel.current?.style.setProperty('--support-keyboard-inset',`${Math.max(0,window.innerHeight-(viewport?.height??window.innerHeight)-(viewport?.offsetTop??0))}px`);
  };
  resize();window.visualViewport?.addEventListener('resize',resize);window.visualViewport?.addEventListener('scroll',resize);window.addEventListener('resize',resize);window.addEventListener('keydown',key);
  return()=>{window.clearTimeout(focus);window.removeEventListener('keydown',key);window.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('scroll',resize);
   // The launcher remounts on close; restore focus after React commits it, without scrolling.
   window.setTimeout(()=>{const target=previousFocus.current?.isConnected&&previousFocus.current.tagName!=='BODY'?previousFocus.current:fab.current;target?.focus({preventScroll:true});},0);
  };
 },[open]);
 const ask=(text:string)=>{
  const body=text.trim().slice(0,1000);if(!body||local.length>=100||answering.current)return;
  const plain=body.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ə/g,'e').replace(/ı/g,'i').toLowerCase();
  const pendingConfirm=local.at(-1)?.reply;
  if(pendingConfirm?.id==='confirm'&&/^sifre\b/.test(plain)){
   const password=body.replace(/^\s*sifr[eə]\s*:?\s*/i,'').trim();
   const [query,qty]=String(pendingConfirm.contextQuestion||'').split('|');
   answering.current=true;setThinking(true);setDraft('');
   setLocal(old=>[...old,{id:++sequence.current,author:'me',body:'Şifrə göndərildi',createdAt:new Date().toISOString()}]);
   void (async()=>{
    try{
     const res=await fetch('/pos/api/customer/support/adjust',{method:'POST',credentials:'include',headers:{Accept:'application/json','Content-Type':'application/json',...(session.csrfToken?{'x-csrf-token':session.csrfToken}:{})},body:JSON.stringify({password,query,qty:Number(qty)})});
     const data=await res.json().catch(()=>({})) as {text?:string;error?:string};
     setLocal(old=>[...old,{id:++sequence.current,author:'helper',body:data.text||data.error||'Qalıq dəyişmədi.',createdAt:new Date().toISOString()}]);
    }catch{setLocal(old=>[...old,{id:++sequence.current,author:'helper',body:'Qalıq dəyişmədi. Bir az sonra yenidən yoxlayın.',createdAt:new Date().toISOString()}]);}
    finally{answering.current=false;setThinking(false);}
   })();
   return;
  }
  if(/^(live\s*agent|canli\s*(destek|emekdas)|operator)$/i.test(plain)){setLocal(old=>[...old,{id:++sequence.current,author:'me',body,createdAt:new Date().toISOString()}]);setDraft('');handoff();return;}
  const reply=getConversationReply(body,language,local);
  answering.current=true;setThinking(true);
  setLocal(old=>[...old,{id:++sequence.current,author:'me',body,createdAt:new Date().toISOString()}]);setDraft('');
  if(reply.id==='account'){
   const format=reply.suggestion==='pdf'?'pdf':'text';
   const intent=encodeURIComponent(reply.contextQuestion||'earn:today');
   void (async()=>{
    try{
     const res=await fetch(`/pos/api/customer/support/summary?format=${format}&intent=${intent}`,{credentials:'include',headers:{Accept:format==='pdf'?'application/pdf':'application/json'}});
     if(res.status===401){setLocal(old=>[...old,{id:++sequence.current,author:'helper',body:'Bu rəqəmlər sizin hesabınızdadır. Dəstək pəncərəsində e-poçt və şifrə ilə daxil olun, sonra sualı yenidən yazın.',createdAt:new Date().toISOString()}]);return;}
     if(!res.ok){setLocal(old=>[...old,{id:++sequence.current,author:'helper',body:'Hesab məlumatını indi oxuya bilmədim. Bir az sonra yenidən yazın.',createdAt:new Date().toISOString()}]);return;}
     if(format==='pdf'){const blob=await res.blob();const url=URL.createObjectURL(blob);setLocal(old=>[...old,{id:++sequence.current,author:'helper',body:'PDF hazırdır. Aşağıdakı faylı açın.',file:{url,name:'possistem-hesabat.pdf'},reply:{...reply,contextQuestion:reply.contextQuestion},createdAt:new Date().toISOString()}]);return;}
     const data=await res.json() as {text?:string};
     const confirm=String(reply.contextQuestion||'').startsWith('adjust:');
     const parts=String(reply.contextQuestion||'').split(':');
     setLocal(old=>[...old,{id:++sequence.current,author:'helper',body:data.text||'Məlumat gəlmədi.',reply:confirm?{id:'confirm',title:'Düzəliş',body:data.text||'',matched:true,href:'',contextQuestion:`${parts[1]||''}|${parts[2]||''}`}:reply,createdAt:new Date().toISOString()}]);
    }catch{setLocal(old=>[...old,{id:++sequence.current,author:'helper',body:'Hesab məlumatını indi oxuya bilmədim. Bir az sonra yenidən yazın.',createdAt:new Date().toISOString()}]);}
    finally{answering.current=false;setThinking(false);}
   })();
   return;
  }
  pendingReply.current=setTimeout(()=>{setLocal(old=>[...old,{id:++sequence.current,author:'helper',body:reply.body,reply,createdAt:new Date().toISOString()}]);pendingReply.current=null;answering.current=false;setThinking(false);},850);
 };
 const handoff=()=>{
  if(!agentDraft.trim()){
   const transcript=local.map(m=>`${m.author==='me'?c.you:'Possistem'}: ${m.body}`).join('\n\n');
   setAgentDraft(`${h.context}\n${transcript}\n\nLive agent`.slice(-4000));
  }
  setPendingHandoff(true);setMode('agent');setError('');setTools(false);
 };
 const signIn=async(event:FormEvent)=>{
  event.preventDefault();if(sending.current)return;sending.current=true;setBusy(true);setError('');
  try{const res=await fetch('/pos/api/customer-auth/login',{method:'POST',credentials:'include',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({email:email.trim(),password,rememberMe:true})});
   if(!res.ok){setError(res.status===401?c.wrong:c.offline);return;}setPassword('');await session.refresh();
  }catch{setError(c.offline);}finally{sending.current=false;setBusy(false);}
 };
 const send=async(event?:FormEvent)=>{
  event?.preventDefault();const body=agentDraft.trim();if(!body||sending.current||!session.authenticated)return;
  sending.current=true;setBusy(true);setError('');
  try{await call('/customer/support/request',{method:'POST',body:JSON.stringify({message:body})});
   setAgentDraft('');await load().catch(()=>setError(c.offline));
  }catch{setError(c.offline);}finally{sending.current=false;setBusy(false);}
 };
 useEffect(()=>{if(mode==='agent'&&session.authenticated&&pendingHandoff&&agentDraft.trim()&&!sending.current){setPendingHandoff(false);void send();}},[mode,session.authenticated,pendingHandoff,agentDraft]);
 const reportEnd=`${local.at(-1)?.id??0}:${messages.at(-1)?.id??''}`;
 if(reportEnd&&!reportKeys.current[reportEnd])reportKeys.current[reportEnd]=globalThis.crypto?.randomUUID?.()??'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:(r&3)|8).toString(16);});
 const status=!ticket?c.empty:ticket.status==='claimed'?c.claimed:ticket.status==='resolved'?c.resolved:c.waiting;
 const time=(iso:string)=>new Date(iso).toLocaleTimeString(language==='ru'?'ru-RU':language==='en'?'en-GB':'az-AZ',{hour:'2-digit',minute:'2-digit'});
 const sendFile=async(file:File)=>{
  if(!session.authenticated||sending.current)return;
  sending.current=true;setBusy(true);setError('');
  try{
   let id=ticket?.id;
   if(!id){const opened=await call('/customer/support/request',{method:'POST',body:JSON.stringify({message:'Fayl göndərildi'})}) as {ticket:Ticket};id=opened.ticket.id;setTicket(opened.ticket);}
   const form=new FormData();form.append('file',file);
   const res=await fetch(`/pos/api/customer/support/tickets/${id}/attachments`,{method:'POST',credentials:'include',headers:{Accept:'application/json',...(session.csrfToken?{'x-csrf-token':session.csrfToken}:{})},body:form});
   if(!res.ok){const data=await res.json().catch(()=>({}));throw new Error(typeof data.error==='string'?data.error:c.offline);}
   await load();
  }catch(e){setError(e instanceof Error?e.message:c.offline);}finally{sending.current=false;setBusy(false);}
 };
 const compose=(assistant:boolean)=><form className="support-compose" onSubmit={e=>{e.preventDefault();if(assistant)ask(draft);else void send();}}>
  {!assistant&&<label className="support-file-btn">{busy?'…':'Fayl'}<input type="file" hidden accept="image/*,.pdf,.zip,.txt,.log,.json" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void sendFile(file);}}/></label>}
  <label className="sr-only" htmlFor="possistem-support-input">{h.placeholder}</label>
  <textarea id="possistem-support-input" ref={input} value={assistant?draft:agentDraft} onChange={e=>assistant?setDraft(e.target.value):setAgentDraft(e.target.value)} placeholder={h.placeholder} rows={1} maxLength={assistant?1000:4000} disabled={assistant?thinking:busy}
   onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(assistant)ask(draft);else void send();}}}/>
  <button type="submit" disabled={assistant?thinking||!draft.trim()||local.length>=100:busy||!agentDraft.trim()} aria-label={c.send}>{busy&&!assistant?'…':<ArrowRight/>}</button>
 </form>;
 const localBubbles=<>{local.map(m=>{const choices=m.reply?.suggestions?.length?m.reply.suggestions:m.reply?.suggestion?[m.reply.suggestion]:[];return <div key={m.id} className={`support-msg is-${m.author==='me'?'me':'helper'}`}><p>{m.body}</p>{m.file&&<a className="support-file" href={m.file.url} download={m.file.name}>{m.file.name}</a>}{m.reply?.href&&<a href={m.reply.href}>{h.more}<ArrowRight/></a>}{choices.map(choice=><button key={choice} type="button" className="support-choice" disabled={thinking} onClick={()=>ask(choice)}>{choice}</button>)}</div>;})}</>;
 return <>
  {!open&&<button ref={fab} type="button" className="support-fab" onPointerEnter={()=>mascot.hover(true)} onPointerLeave={()=>mascot.hover(false)} onFocus={()=>mascot.hover(true)} onBlur={()=>mascot.hover(false)} onClick={()=>{previousFocus.current=document.activeElement as HTMLElement;setOpen(true);}} aria-label={h.open} aria-haspopup="dialog" aria-controls="possistem-support-panel"><SupportMascot gesture={mascot.gesture} motion={motion.effective} preference={motion.mode}/>{unread&&<i className="support-fab-dot" aria-hidden="true"/>}</button>}
  {open&&<section ref={panel} id="possistem-support-panel" className="support-panel" tabIndex={-1} role="dialog" aria-modal="false" aria-labelledby="possistem-support-title">
   <header className="support-panel-head"><a href="/" id="possistem-support-title">Possistem</a><div className="support-head-actions"><button type="button" aria-label={language==='az'?'Söhbət seçimləri':language==='ru'?'Настройки беседы':'Conversation options'} aria-expanded={tools} aria-controls="support-tools" onClick={()=>setTools(v=>!v)}>•••</button><button type="button" onClick={()=>setOpen(false)} aria-label={c.close}><Close/></button></div></header>
   {tools&&<div className="support-tools" id="support-tools"><button type="button" onClick={()=>{clearConversation();setMode('assistant');setTools(false);}}>{h.clear}</button>{local.length>0&&<SupportReport key={reportEnd} messages={[{author:'helper',body:h.intro,createdAt:startedAt.current},...local,...messages.map(m=>({author:m.authorKind==='customer'?'me' as const:'helper' as const,body:m.body,createdAt:m.createdAt}))]} language={language} requestKey={reportKeys.current[reportEnd]} send={body=>call('/public/chat/assistant-reports',{method:'POST',body:JSON.stringify(body)})}/>}</div>}
   <div className="support-list" ref={list} role="log" aria-label={c.title} aria-live="polite" aria-relevant="additions">
    <div className="support-msg is-helper"><p>{h.intro}</p></div>
    {localBubbles}
    {thinking&&<div className="support-thinking" role="status"><span aria-hidden="true"><i/><i/><i/></span>{h.thinking}</div>}
    {mode==='agent'&&<>
     {availability&&!availability.isOpen&&<p className="support-conversation-status" role="status">{language==='az'?`İş saatları ${availability.start}–${availability.end} (Bakı). Mesajınızı göndərə bilərsiniz; əməkdaşlara bildiriş növbəti iş vaxtında çatdırılacaq.`:language==='ru'?`Часы работы ${availability.start}–${availability.end} (Баку). Сообщение сохранится; специалист получит уведомление в рабочее время.`:`Support hours ${availability.start}–${availability.end} (Baku). Your message will be saved and staff notified during working hours.`}</p>}
     {session.loading?<p className="support-conversation-status">{c.loading}</p>:!session.authenticated?<form className="support-login" onSubmit={e=>void signIn(e)}>
      <p>{c.loginHint}</p><label>{c.email}<input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>{c.password}<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label><button type="submit" disabled={busy}>{busy?'…':c.login}</button><a href="/pos/app/login">{c.register}</a>
     </form>:<><p className="support-conversation-status" role="status">{status}</p>{messages.map(m=>{const file=m.meta?.attachment;const href=file?.id?`/pos/api/customer/support/attachments/${file.id}`:'';const image=Boolean(file&&((file.mimeType??'').startsWith('image/')||/\.(png|jpe?g|gif|webp)$/i.test(file.fileName??'')));const caption=file&&m.body.trim()===`📎 ${file.fileName}`?'':m.body;return <div key={m.id} className={`support-msg is-${m.authorKind==='customer'?'me':m.authorKind==='admin'?'agent':'system'}`}><small>{m.authorKind==='admin'?c.support+' · ':''}{time(m.createdAt)}</small>{caption?<p>{caption}</p>:null}{href?<a className="support-file" href={href} target="_blank" rel="noreferrer">{image?<img src={href} alt={file?.fileName??'Şəkil'}/>:(file?.fileName??'Faylı aç')}</a>:null}</div>;})}</>}
    </>}
   </div>
   {error&&<p className="support-error" role="alert">{error}</p>}
   {(mode==='assistant'||session.authenticated)&&compose(mode==='assistant')}
  </section>}
 </>;
}
