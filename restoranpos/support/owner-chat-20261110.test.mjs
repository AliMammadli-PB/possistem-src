// Owner transcript 2026-11-10: questions typed while the recipe step waited were read as ingredient names.
import test from 'node:test';import assert from 'node:assert/strict';
import {chat} from './owner-chat-harness.mjs';
const unknown=async()=>({id:'unknown',body:'x',links:[],chips:[]});
const reader=async t=>/xerc|qazan|zakaz|sifaris|satis/.test(t.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/ə/g,'e').toLowerCase())?{kind:'data_question',commands:[],unsupported:[],ignored:[],reply:''}:{kind:'answer',commands:[],unsupported:[],ignored:[],reply:''};
test('a question typed during the recipe step is answered, the step waits; "təkrar" asks it again',async()=>{const asked=[];
 const c=chat({help:unknown,understand:reader,writeSql:async q=>{asked.push(q);return{sql:'SELECT 80 AS "Satış (₼)"',explain:'5 gün əvvəlki satış.'};}});
 assert.match((await c.send('doner üçün kalkulyasiya yarat')).body,/tərkib seçin/);
 const r=await c.send('butun qazancima bax hamisini');assert.doesNotMatch(r.body,/xammal anbarda tapılmadı/);assert.match(r.body,/5 gün əvvəlki satış/);assert.ok(r.choices.some(c=>c.value==='setup:resume'));
 assert.match((await c.send('tekrar')).body,/5 gün əvvəlki satış/);assert.equal(asked.length,2);
 assert.match((await c.send('setup:resume')).body,/tərkib seçin/);});
test('a two-word ingredient answer still goes to the step',async()=>{const c=chat({help:unknown,understand:reader});
 await c.send('doner üçün kalkulyasiya yarat');assert.match((await c.send('Un')).body,/miqdarını yazın/);});
test('stock answers carry product cards that open Anbar filtered; the subscription answer opens Lisenziya',async()=>{const c=chat({help:unknown});
 const r=await c.send('anbarda ne var');const card=r.cards.find(x=>x.title==='doner');assert.ok(card);assert.equal(card.value,'nav:/operations?tab=stock&q=doner');assert.equal(card.tone,'out');
 const s=await c.send('abuneliyime bax');assert.deepEqual(s.cards.map(x=>x.value),['nav:/settings/license']);});
