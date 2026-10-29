 'use client';
/*
 * Website support chat. Answers come from the server assistant (POST /pos/api/customer/assistant/reply,
 * source: /opt/possistem-pos-control/.security-build-20261024/apps/api/src/lib/assistant + routes/assistant.ts).
 * lib/support-conversation.ts is only the offline fallback. Contact order: bot → live agent → WhatsApp after 5 min.
 * Edit THIS file in place — rebuilding from an older copy drops the server assistant, the agent hand-over and ratings.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useCustomerSession } from '@/components/providers/CustomerSessionProvider';
import { useI18n } from '@/components/providers/I18nProvider';
import { getConversationReply, type ConversationReply } from '@/lib/support-conversation';
import { whatsappSupportUrl } from '@/lib/whatsapp';
import { SupportMessageFeedback, SupportReport } from './SupportReport';
import { Close, ArrowRight } from './DesignIcons';
import './support-chat.css';
import { SupportMascot, MascotMotionMenu, useMascotMotion, useMascotGesture } from './SupportMascot';
type Message = { id: string; authorKind: string; body: string; createdAt: string; meta?: { attachment?: { id?: string; fileName?: string; mimeType?: string } } };
type Ticket = { id: string; status: string; createdAt?: string };
type AssistantLink = { href: string; label: string };
type AssistantChip = { label: string; send: string };
type AssistantConfirm = { token: string; summary: string; done?: boolean };
type ServerReply = { id: string; text: string; links?: AssistantLink[]; chips?: AssistantChip[]; confirm?: AssistantConfirm; needLogin?: boolean; handoff?: boolean };
type AssistantContext = { last?: string; turn?: number; offered?: boolean };
type Rating = 'bad' | 'fine' | 'good';
type LocalMessage = { id: number; author: 'me' | 'helper'; body: string; reply?: ConversationReply; createdAt?:string; file?: { url: string; name: string }; links?: AssistantLink[]; chips?: AssistantChip[]; confirm?: AssistantConfirm; needLogin?: boolean; replyId?: string; rating?: Rating; rateNote?: 'open' | 'sent'; feedback?: 'up' | 'down' };
const CHAT_KEY = (id?: string | null) => `possistem.support.chat.${id || 'guest'}`;
const readChat = (key: string) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw) as { local?: LocalMessage[]; mode?: 'assistant' | 'agent'; startedAt?: string; sessionKey?: string };
    return { local: (data.local ?? []).slice(-80).map((m) => ({ ...m, file: undefined })), mode: data.mode === 'agent' ? 'agent' as const : 'assistant' as const, startedAt: data.startedAt, sessionKey: data.sessionKey };
  } catch { return null; }
};
const writeChat = (key: string, data: { local: LocalMessage[]; mode: 'assistant' | 'agent'; startedAt: string; sessionKey: string }) => {
  try { localStorage.setItem(key, JSON.stringify({ ...data, local: data.local.slice(-80).map(({ file: _file, confirm: _confirm, ...m }) => m) })); } catch { /* storage full */ }
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
 az: { thinking:'Cavab hazırlanır…',launcherLabel:'Dəstək',launcherHint:'Sualınız var?',clear:'Yeni söhbət',open:'Texniki dəstək',title:'Possistem köməkçisi',subtitle:'Proqram, quraşdırma və hesabınız üzrə kömək',helper:'Avtomatik köməkçi',assistant:'Köməkçi',agent:'Əməkdaşa yaz',back:'Köməkçiyə qayıt',intro:'Salam, sizə necə kömək edə bilərəm?',notice:'Bilik bazası ilə cavab verir. Daxil olsanız, öz satış və anbar rəqəmlərinizi göstərir; dəyişikliyi yalnız sizin təsdiqinizlə edir.',placeholder:'Sualınızı yazın…',more:'Təlimatı aç',handoff:'Yazışmanı nəzərdən keçirin və göndərin. Yalnız göndərdikdən sonra dəstək sorğusu yaranacaq.',context:'Köməkçi ilə söhbətdən:',safe:'Şifrə və PIN göndərməyin.',questions:['Proqramı necə quraşdırım?','Printer çek çap etmir','Bugünkü satışım','Sən nə edə bilirsən?'],sent:'Mesaj göndərildi.',limit:'Söhbət uzanıb. Davam etmək üçün əməkdaşa yazın və ya Yeni söhbət seçin.',confirmLabel:'Hesab şifrəsi',confirm:'Təsdiqlə',cancel:'Ləğv et',cancelled:'Ləğv edildi. Heç nə dəyişmədi.',rateLabel:'Cavab necə idi?',rate:{bad:'Pis',fine:'Normal',good:'Yaxşı'},rateIcon:{bad:'👎',fine:'😐',good:'👍'},rateThanks:'Təşəkkürlər!',rateThanksBad:'Təşəkkürlər, qeyd etdik — komandamız bu cavaba baxacaq.',rateNotePh:'Nə səhv idi? (istəyə bağlı)',rateNoteSend:'Göndər',busy:'Hazırda bütün əməkdaşlarımız məşğuldur. Zəhmət olmasa WhatsApp nömrəmiz ilə əlaqə saxlayın: 051 333 35 55. Sorğunuz burada da qalır — əməkdaş boşalan kimi cavab verəcək.',busyLink:'WhatsApp-a yaz' },
 en: { thinking:'Preparing a reply…',launcherLabel:'Support',launcherHint:'Need a hand?',clear:'New conversation',open:'Technical support',title:'Possistem assistant',subtitle:'Help with the software, setup and your account',helper:'Automated assistant',assistant:'Assistant',agent:'Contact an agent',back:'Back to assistant',intro:'Hello! How can I help?',notice:'Answers from the knowledge base. When you sign in it shows your own sales and stock; it changes data only after you confirm.',placeholder:'Ask a question…',more:'Open guide',handoff:'Review the conversation and send it. A support ticket is created only after you send.',context:'From the assistant conversation:',safe:'Do not send passwords or PINs.',questions:['How do I install the app?','My printer does not print','Today’s sales','What can you do?'],sent:'Message sent.',limit:'This conversation is long. Contact an agent or choose New conversation to continue.',confirmLabel:'Account password',confirm:'Confirm',cancel:'Cancel',cancelled:'Cancelled. Nothing changed.',rateLabel:'How was this answer?',rate:{bad:'Bad',fine:'Fine',good:'Good'},rateIcon:{bad:'👎',fine:'😐',good:'👍'},rateThanks:'Thanks!',rateThanksBad:'Thanks, noted — our team will review this answer.',rateNotePh:'What was wrong? (optional)',rateNoteSend:'Send',busy:'All our agents are busy right now. Please contact us on WhatsApp: 051 333 35 55. Your request stays here too — an agent will reply as soon as one is free.',busyLink:'Message on WhatsApp' },
 ru: { thinking:'Готовлю ответ…',launcherLabel:'Поддержка',launcherHint:'Есть вопрос?',clear:'Новая беседа',open:'Техническая поддержка',title:'Помощник Possistem',subtitle:'Помощь по программе, установке и аккаунту',helper:'Автоматический помощник',assistant:'Помощник',agent:'Написать специалисту',back:'Вернуться к помощнику',intro:'Здравствуйте! Чем помочь?',notice:'Отвечает по базе знаний. После входа показывает ваши продажи и склад; меняет данные только с вашим подтверждением.',placeholder:'Задайте вопрос…',more:'Открыть инструкцию',handoff:'Проверьте переписку и отправьте. Обращение создаётся только после отправки.',context:'Из переписки с помощником:',safe:'Не отправляйте пароли и PIN.',questions:['Как установить приложение?','Принтер не печатает','Продажи сегодня','Что ты умеешь?'],sent:'Сообщение отправлено.',limit:'Переписка слишком длинная. Напишите специалисту или начните новую беседу.',confirmLabel:'Пароль аккаунта',confirm:'Подтвердить',cancel:'Отмена',cancelled:'Отменено. Ничего не изменено.',rateLabel:'Как вам ответ?',rate:{bad:'Плохо',fine:'Нормально',good:'Хорошо'},rateIcon:{bad:'👎',fine:'😐',good:'👍'},rateThanks:'Спасибо!',rateThanksBad:'Спасибо, отметили — команда проверит этот ответ.',rateNotePh:'Что было не так? (необязательно)',rateNoteSend:'Отправить',busy:'Сейчас все специалисты заняты. Пожалуйста, свяжитесь с нами в WhatsApp: 051 333 35 55. Запрос остаётся и здесь — специалист ответит, как только освободится.',busyLink:'Написать в WhatsApp' },
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
 const [now,setNow]=useState(()=>Date.now());
 const newKey=()=>globalThis.crypto?.randomUUID?.()??'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,ch=>{const r=Math.random()*16|0;return(ch==='x'?r:(r&3)|8).toString(16);});
 const reportKeys=useRef<Record<string,string>>({}),startedAt=useRef(new Date().toISOString()),sessionKey=useRef(newKey());
 useEffect(()=>{let alive=true;const pull=()=>void fetch('/pos/api/public/support/availability',{cache:'no-store'}).then(r=>r.ok?r.json():undefined).then(v=>{if(alive&&v)setAvailability(v);}).catch(()=>{});if(open){pull();const timer=setInterval(pull,60000);return()=>{alive=false;clearInterval(timer);};}return()=>{alive=false;};},[open]);
 const pendingReply=useRef<ReturnType<typeof setTimeout>|null>(null),answering=useRef(false);
 useEffect(()=>()=>{if(pendingReply.current)clearTimeout(pendingReply.current);},[]);
 const clearConversation=()=>{if(pendingReply.current)clearTimeout(pendingReply.current);pendingReply.current=null;answering.current=false;setThinking(false);setPendingHandoff(false);setLocal([]);setDraft('');assistantCtx.current={};pendingAsk.current=null;setConfirmPwd('');setRateNote('');sessionKey.current=newKey();startedAt.current=new Date().toISOString();input.current?.focus();};
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
 useEffect(()=>{const key=CHAT_KEY(session.customerId);if(hydrated.current!==key)return;writeChat(key,{local,mode,startedAt:startedAt.current,sessionKey:sessionKey.current});},[local,mode,session.customerId]);
 useEffect(()=>{
  const key=CHAT_KEY(session.customerId);
  if(hydrated.current===key)return;
  if(identity.current!==session.customerId){const previous=identity.current;identity.current=session.customerId;setTicket(null);setMessages([]);setUnread(false);setError('');if(previous){setAgentDraft('');setPendingHandoff(false);}}
  const saved=readChat(key);
  if(saved){setLocal(saved.local);setMode(saved.mode);sequence.current=saved.local.reduce((max,m)=>Math.max(max,m.id),0);if(saved.startedAt)startedAt.current=saved.startedAt;if(saved.sessionKey)sessionKey.current=saved.sessionKey;}
  else setLocal([]);
  hydrated.current=key;
 },[session.customerId]);
 useEffect(()=>{
  if(!humanOpen||!session.authenticated)return;
  let alive=true;
  const refresh=()=>{setNow(Date.now());if(document.visibilityState==='visible')void load().then(()=>{if(alive)setUnread(false);}).catch(()=>{if(alive)setError(c.offline);});};
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
 const assistantCtx=useRef<AssistantContext>({}),pendingAsk=useRef<string|null>(null);
 const [confirmPwd,setConfirmPwd]=useState('');
 const helperSays=(body:string,extra:Partial<LocalMessage>={})=>setLocal(old=>[...old,{id:++sequence.current,author:'helper',body,createdAt:new Date().toISOString(),...extra}]);
 const ask=(text:string,label?:string)=>{
  const body=text.trim().slice(0,1000);if(!body||local.length>=100||answering.current)return;
  const plain=body.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/ə/g,'e').replace(/ı/g,'i').toLowerCase();
  if(/^(live\s*agent|canli\s*(destek|emekdas)|operator)$/i.test(plain)){setLocal(old=>[...old,{id:++sequence.current,author:'me',body,createdAt:new Date().toISOString()}]);setDraft('');handoff();return;}
  answering.current=true;setThinking(true);setDraft('');
  setLocal(old=>[...old,{id:++sequence.current,author:'me',body:label||body,createdAt:new Date().toISOString()}]);
  const history=local;
  void (async()=>{
   try{
    const res=await fetch('/pos/api/customer/assistant/reply',{method:'POST',credentials:'include',headers:{Accept:'application/json','Content-Type':'application/json',...(session.csrfToken?{'x-csrf-token':session.csrfToken}:{})},body:JSON.stringify({text:body,language,context:assistantCtx.current})});
    if(!res.ok)throw new Error(String(res.status));
    const data=await res.json() as {reply:ServerReply;context?:AssistantContext};
    assistantCtx.current=data.context??{};
    const r=data.reply;
    if(r.handoff){handoff();return;}
    if(r.needLogin)pendingAsk.current=body;
    helperSays(r.text,{links:r.links,chips:r.chips,confirm:r.confirm,needLogin:r.needLogin,replyId:r.id});
   }catch{
    // Server unreachable: the bundled rules still answer the common questions.
    const reply=getConversationReply(body,language,history);
    helperSays(reply.id==='account'?'Hesab məlumatını indi oxuya bilmədim. Bir az sonra yenidən yazın.':reply.body,{reply});
   }finally{answering.current=false;setThinking(false);}
  })();
 };
 const [rateNote,setRateNote]=useState('');
 // Every answer can be rated; "bad" sends the whole conversation to the admin's complaint list.
 const rate=async(message:LocalMessage,rating:Rating,comment='')=>{
  const updated=local.map(m=>m.id===message.id?{...m,rating,feedback:rating==='good'?'up' as const:rating==='bad'?'down' as const:m.feedback}:m);
  setLocal(updated);if(comment)setRateNote('');
  const index=updated.findIndex(m=>m.id===message.id);
  const question=[...updated.slice(0,index)].reverse().find(m=>m.author==='me')?.body??'';
  const transcript=[{author:'helper' as const,body:h.intro,createdAt:startedAt.current},...updated.map(m=>({author:m.author,body:m.body,createdAt:m.createdAt,topic:m.replyId,rating:m.rating,key:String(m.id)})),...messages.map(m=>({author:m.authorKind==='customer'?'me' as const:'helper' as const,body:m.body,createdAt:m.createdAt}))].slice(-300);
  try{await fetch('/pos/api/customer/assistant/feedback',{method:'POST',credentials:'include',headers:{Accept:'application/json','Content-Type':'application/json',...(session.csrfToken?{'x-csrf-token':session.csrfToken}:{})},body:JSON.stringify({sessionKey:sessionKey.current,messageKey:String(message.id),rating,replyId:message.replyId??'',question,answer:message.body,comment,language,transcript:rating==='bad'?transcript:[]})});}catch{/* rating is best effort */}
 };
 const confirmAction=async(message:LocalMessage,approve:boolean)=>{
  const token=message.confirm?.token;if(!token||answering.current)return;
  const done=()=>setLocal(old=>old.map(m=>m.id===message.id&&m.confirm?{...m,confirm:{...m.confirm,done:true}}:m));
  if(!approve){done();setConfirmPwd('');helperSays(h.cancelled);return;}
  if(!confirmPwd)return;
  answering.current=true;setThinking(true);
  try{
   const res=await fetch('/pos/api/customer/assistant/confirm',{method:'POST',credentials:'include',headers:{Accept:'application/json','Content-Type':'application/json',...(session.csrfToken?{'x-csrf-token':session.csrfToken}:{})},body:JSON.stringify({token,password:confirmPwd,language})});
   const data=await res.json().catch(()=>({})) as {text?:string;error?:string};
   setConfirmPwd('');
   if(res.ok)done();
   helperSays(data.text||data.error||c.offline);
  }catch{helperSays(c.offline);}finally{answering.current=false;setThinking(false);}
 };
 // After an inline sign-in, answer the question that asked for it.
 useEffect(()=>{if(session.authenticated&&pendingAsk.current&&mode==='assistant'&&!answering.current){const q=pendingAsk.current;pendingAsk.current=null;ask(q);}},[session.authenticated,session.csrfToken]);
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
 const reportKey=(scope:string)=>{if(!reportKeys.current[scope])reportKeys.current[scope]=globalThis.crypto?.randomUUID?.()??'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:(r&3)|8).toString(16);});return reportKeys.current[scope];};
 reportKey(reportEnd);
 const status=!ticket?c.empty:ticket.status==='claimed'?c.claimed:ticket.status==='resolved'?c.resolved:c.waiting;
 // Order of contact: bot, then a live agent; WhatsApp only when nobody takes the request within 5 minutes.
 const waitingSince=ticket&&ticket.status==='open'&&!messages.some(m=>m.authorKind==='admin')?Date.parse(ticket.createdAt??messages.find(m=>m.authorKind==='customer')?.createdAt??''):NaN;
 const agentsBusy=Number.isFinite(waitingSince)&&now-waitingSince>=5*60_000;
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
 const lastHelper=[...local].reverse().find(m=>m.author==='helper')?.id;
 const external=(href:string)=>/^https?:\/\//.test(href);
 const localBubbles=<>{local.map((m,index)=>{const choices=m.reply?.suggestions?.length?m.reply.suggestions:m.reply?.suggestion?[m.reply.suggestion]:[];const latest=m.id===lastHelper;const transcript=[{author:'helper' as const,body:h.intro,createdAt:startedAt.current},...local.slice(0,index+1)];return <div key={m.id} className={`support-msg is-${m.author==='me'?'me':'helper'}`}><p>{m.body}</p>
  {m.file&&<a className="support-file" href={m.file.url} download={m.file.name}>{m.file.name}</a>}
  {m.reply?.href&&<a href={m.reply.href}>{h.more}<ArrowRight/></a>}
  {m.links?.length?<div className="support-links">{m.links.map(l=><a key={l.href} href={l.href} {...(external(l.href)?{target:'_blank',rel:'noreferrer'}:{})}>{l.label}<ArrowRight/></a>)}</div>:null}
  {m.confirm&&!m.confirm.done&&latest&&<form className="support-confirm" onSubmit={e=>{e.preventDefault();void confirmAction(m,true);}}><strong>{m.confirm.summary}</strong><label>{h.confirmLabel}<input type="password" autoComplete="current-password" value={confirmPwd} onChange={e=>setConfirmPwd(e.target.value)} required/></label><div><button type="submit" disabled={thinking||!confirmPwd}>{h.confirm}</button><button type="button" className="is-ghost" disabled={thinking} onClick={()=>void confirmAction(m,false)}>{h.cancel}</button></div></form>}
  {m.needLogin&&latest&&!session.authenticated&&<form className="support-login support-login-inline" onSubmit={e=>void signIn(e)}><label>{c.email}<input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>{c.password}<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label><button type="submit" disabled={busy}>{busy?'…':c.login}</button>{error&&<p className="support-error" role="alert">{error}</p>}</form>}
  {latest&&m.chips?.map(chip=><button key={chip.send} type="button" className="support-choice" disabled={thinking} onClick={()=>ask(chip.send,chip.label)}>{chip.label}</button>)}
  {choices.map(choice=><button key={choice} type="button" className="support-choice" disabled={thinking} onClick={()=>ask(choice)}>{choice}</button>)}
  {/* 👍/👎 also log the whole conversation for the admin's complaint list; ⚑ opens the detailed report. */}
  {m.author==='helper'&&<SupportMessageFeedback vote={m.feedback} onVote={feedback=>{setLocal(old=>old.map(item=>item.id===m.id?{...item,feedback}:item));if(m.replyId)void rate(m,feedback==='up'?'good':'bad');}} messages={transcript} language={language} requestKey={reportKey(`reply:${m.id}`)} send={payload=>call('/public/chat/assistant-reports',{method:'POST',body:JSON.stringify(payload)})}/>}</div>;})}</>;
 return <>
  {!open&&<button ref={fab} type="button" className="support-fab" onPointerEnter={()=>mascot.hover(true)} onPointerLeave={()=>mascot.hover(false)} onFocus={()=>mascot.hover(true)} onBlur={()=>mascot.hover(false)} onClick={()=>{previousFocus.current=document.activeElement as HTMLElement;setOpen(true);}} aria-label={h.open} aria-haspopup="dialog" aria-controls="possistem-support-panel"><SupportMascot gesture={mascot.gesture} motion={motion.effective} preference={motion.mode}/>{unread&&<i className="support-fab-dot" aria-hidden="true"/>}</button>}
  {open&&<section ref={panel} id="possistem-support-panel" className="support-panel" tabIndex={-1} role="dialog" aria-modal="false" aria-labelledby="possistem-support-title">
   <header className="support-panel-head"><a href="/" id="possistem-support-title">Possistem</a><div className="support-head-actions"><button type="button" aria-label={language==='az'?'Söhbət seçimləri':language==='ru'?'Настройки беседы':'Conversation options'} aria-expanded={tools} aria-controls="support-tools" onClick={()=>setTools(v=>!v)}>•••</button><button type="button" onClick={()=>setOpen(false)} aria-label={c.close}><Close/></button></div></header>
   {tools&&<div className="support-tools" id="support-tools"><MascotMotionMenu mode={motion.mode} onChange={motion.change}/><button type="button" onClick={()=>{clearConversation();setMode('assistant');setTools(false);}}>{h.clear}</button>{local.length>0&&<SupportReport key={reportEnd} messages={[{author:'helper',body:h.intro,createdAt:startedAt.current},...local,...messages.map(m=>({author:m.authorKind==='customer'?'me' as const:'helper' as const,body:m.body,createdAt:m.createdAt}))]} language={language} requestKey={reportKey(reportEnd)} send={body=>call('/public/chat/assistant-reports',{method:'POST',body:JSON.stringify(body)})}/>}</div>}
   <div className="support-list" ref={list} role="log" aria-label={c.title} aria-live="polite" aria-relevant="additions">
    <div className="support-msg is-helper"><p>{h.intro}</p>{local.length===0&&mode==='assistant'&&h.questions.map(q=><button key={q} type="button" className="support-choice" disabled={thinking} onClick={()=>ask(q)}>{q}</button>)}</div>
    {localBubbles}
    {thinking&&<div className="support-thinking" role="status"><span aria-hidden="true"><i/><i/><i/></span>{h.thinking}</div>}
    {mode==='agent'&&<>
     {availability&&!availability.isOpen&&<p className="support-conversation-status" role="status">{language==='az'?`İş saatları ${availability.start}–${availability.end} (Bakı). Mesajınızı göndərə bilərsiniz; əməkdaşlara bildiriş növbəti iş vaxtında çatdırılacaq.`:language==='ru'?`Часы работы ${availability.start}–${availability.end} (Баку). Сообщение сохранится; специалист получит уведомление в рабочее время.`:`Support hours ${availability.start}–${availability.end} (Baku). Your message will be saved and staff notified during working hours.`}</p>}
     {session.loading?<p className="support-conversation-status">{c.loading}</p>:!session.authenticated?<form className="support-login" onSubmit={e=>void signIn(e)}>
      <p>{c.loginHint}</p><label>{c.email}<input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>{c.password}<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label><button type="submit" disabled={busy}>{busy?'…':c.login}</button><a href="/pos/app/login">{c.register}</a>
     </form>:<><p className="support-conversation-status" role="status">{status}</p>{messages.map(m=>{const file=m.meta?.attachment;const href=file?.id?`/pos/api/customer/support/attachments/${file.id}`:'';const image=Boolean(file&&((file.mimeType??'').startsWith('image/')||/\.(png|jpe?g|gif|webp)$/i.test(file.fileName??'')));const caption=file&&m.body.trim()===`📎 ${file.fileName}`?'':m.body;return <div key={m.id} className={`support-msg is-${m.authorKind==='customer'?'me':m.authorKind==='admin'?'agent':'system'}`}><small>{m.authorKind==='admin'?c.support+' · ':''}{time(m.createdAt)}</small>{caption?<p>{caption}</p>:null}{href?<a className="support-file" href={href} target="_blank" rel="noreferrer">{image?<img src={href} alt={file?.fileName??'Şəkil'}/>:(file?.fileName??'Faylı aç')}</a>:null}</div>;})}{agentsBusy&&<div className="support-msg is-helper" role="status"><p>{h.busy}</p><div className="support-links"><a href={whatsappSupportUrl(language)} target="_blank" rel="noreferrer">{h.busyLink}<ArrowRight/></a></div></div>}</>}
    </>}
   </div>
   {error&&<p className="support-error" role="alert">{error}</p>}
   {(mode==='assistant'||session.authenticated)&&compose(mode==='assistant')}
  </section>}
 </>;
}
