'use client';
import { useRef, useState } from 'react';
import type { SupportLanguage } from '@/lib/support-assistant';
import type { ConversationMessage } from '@/lib/support-conversation';

const C={
 az:{question:'Bu cavab faydalı oldu?',up:'Bəyəndim',down:'Bəyənmədim',thanks:'Təşəkkür edirik.',button:'Report et',title:'Söhbəti bildirin',notice:'Göndərdikdə bu cavaba qədər olan sual və cavablar admin panelinə ötürüləcək.',reason:'Səbəb',wrong:'Cavab yanlışdır',understood:'Sualımı başa düşmədi',technical:'Chat işləmir',other:'Digər',comment:'Əlavə qeyd',send:'Söhbəti göndər',sending:'Göndərilir…',sent:'Göndərildi. Söhbət yoxlanılmaq üçün saxlanıldı.',error:'Göndərilmədi. Yenidən yoxlayın.'},
 en:{question:'Was this answer helpful?',up:'Helpful',down:'Not helpful',thanks:'Thank you.',button:'Report',title:'Report this conversation',notice:'Sending shares the questions and replies up to this answer with the admin team.',reason:'Reason',wrong:'Incorrect answer',understood:'Misunderstood my question',technical:'Chat malfunction',other:'Other',comment:'Additional comment',send:'Send conversation',sending:'Sending…',sent:'Sent. The conversation was saved for review.',error:'Not sent. Please retry.'},
 ru:{question:'Ответ был полезен?',up:'Полезно',down:'Не помогло',thanks:'Спасибо.',button:'Сообщить',title:'Сообщить о проблеме',notice:'Администраторам будут отправлены вопросы и ответы до этого сообщения.',reason:'Причина',wrong:'Неверный ответ',understood:'Не понял вопрос',technical:'Сбой чата',other:'Другое',comment:'Комментарий',send:'Отправить беседу',sending:'Отправляется…',sent:'Отправлено на проверку.',error:'Не отправлено. Повторите.'},
};
type ReportReason='wrong_answer'|'not_understood'|'technical'|'other';
type ReportProps={messages:ConversationMessage[];language:SupportLanguage;requestKey:string;send:(body:unknown)=>Promise<unknown>;embedded?:boolean;initialReason?:ReportReason};

export function SupportReport({messages,language,requestKey,send,embedded=false,initialReason='wrong_answer'}:ReportProps){
 const c=C[language],busy=useRef(false),[state,setState]=useState<'idle'|'sending'|'sent'|'error'>('idle'),[reason,setReason]=useState<ReportReason>(initialReason),[comment,setComment]=useState('');
 const submit=()=>{if(busy.current)return;busy.current=true;setState('sending');void send({requestKey,language,reason,comment,transcript:messages.map(m=>({author:m.author,body:m.body,createdAt:m.createdAt,topic:m.reply?.id}))}).then(()=>setState('sent')).catch(()=>setState('error')).finally(()=>{busy.current=false;});};
 const form=<><strong>{c.title}</strong><p>{c.notice}</p><label>{c.reason}<select value={reason} onChange={e=>setReason(e.target.value as ReportReason)}><option value="wrong_answer">{c.wrong}</option><option value="not_understood">{c.understood}</option><option value="technical">{c.technical}</option><option value="other">{c.other}</option></select></label><label>{c.comment}<textarea maxLength={2000} value={comment} onChange={e=>setComment(e.target.value)}/></label><button type="button" disabled={state==='sending'||state==='sent'} onClick={submit}>{state==='sending'?c.sending:c.send}</button>{state==='sent'&&<p role="status">{c.sent}</p>}{state==='error'&&<p role="alert">{c.error}</p>}</>;
 return embedded?<div className="support-report is-embedded">{form}</div>:<details className="support-report"><summary>{c.button}</summary>{form}</details>;
}

export function SupportMessageFeedback({vote,onVote,messages,language,requestKey,send}:{vote?:'up'|'down';onVote:(vote:'up'|'down')=>void;messages:ConversationMessage[];language:SupportLanguage;requestKey:string;send:(body:unknown)=>Promise<unknown>}){
 const c=C[language],[report,setReport]=useState(false);
 return <div className="support-feedback"><span>{vote==='up'?c.thanks:c.question}</span><div className="support-feedback-actions"><button type="button" aria-pressed={vote==='up'} onClick={()=>{onVote('up');setReport(false);}}>✓ {c.up}</button><button type="button" aria-pressed={vote==='down'} onClick={()=>{onVote('down');setReport(true);}}>✕ {c.down}</button><button type="button" aria-expanded={report} onClick={()=>setReport(value=>!value)}>⚑ {c.button}</button></div>{report&&<SupportReport embedded initialReason={vote==='down'?'not_understood':'wrong_answer'} messages={messages} language={language} requestKey={requestKey} send={send}/>}</div>;
}
