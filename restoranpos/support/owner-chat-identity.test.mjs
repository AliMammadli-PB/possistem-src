// Who the assistant is, the restaurant's name, a named table's bill, a missing table and a stock item asked as a recipe.
import test from 'node:test';import assert from 'node:assert/strict';
import {chat} from './owner-chat-harness.mjs';
const unknown=async()=>({id:'unknown',body:'x',links:[],chips:[]});
test('"sən kimsən" introduces the assistant; the restaurant name comes from the account',async()=>{
 assert.match((await chat({help:unknown}).send('sen kimsen')).body,/Possistem Restoran POS-un köməkçisiyəm/);
 assert.match((await chat({help:unknown,profile:{name:'Panda Kafe'}}).send('menim restoranimin adi nedir')).body,/Restoranınız: Panda Kafe/);
 assert.match((await chat({help:unknown}).send('menim restoranimin adi nedir')).body,/hesab məlumatından ala bilmədim/);});
test('"1 masada nə var" shows that bill’s items, not every table',async()=>{const r=await chat({help:unknown}).send('1 masada ne var ne yeyibler');
 assert.match(r.body,/Masa 1 · açıq hesab 25/);assert.match(r.body,/doner × 2/);assert.doesNotMatch(r.body,/Masa 2/);});
test('deleting a table that does not exist says so instead of listing tables silently',async()=>{
 assert.match((await chat({help:unknown}).send('masa 99 u sil')).body,/masa tapılmadı/);});
test('a stock good asked as a recipe explains it is not a dish and offers to create one',async()=>{const r=await chat({help:unknown}).send('un kalkulyasiyasini goster');
 assert.match(r.body,/anbarda mal kimi var, amma menyuda yemək kimi yoxdur/);assert.ok(r.choices.some(c=>/kalkulyasiya yarat$/.test(c.value)));});
