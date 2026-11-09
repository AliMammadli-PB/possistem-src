import test from 'node:test';import assert from 'node:assert/strict';
import {createUnderstand,COMMANDS} from './understand.mjs';
import {interpret} from './runtime/stock-assistant.mjs';
const reply=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers});
test('no key: the AI layer is off',()=>{assert.equal(createUnderstand({apiKey:''}),null);});
test('asks Groq for strict JSON with only the person’s own words, and returns the commands',async()=>{let sent;
 const understand=createUnderstand({apiKey:'k',fetchImpl:async(url,init)=>{sent={url,...init,body:JSON.parse(init.body)};return reply({choices:[{message:{content:JSON.stringify({kind:'commands',commands:['bugünkü satış',' doner qalığı nə qədərdir ',''],understood:'Satış və doner qalığı',reply:'ignored for commands'})}}]});}});
 const out=await understand('bugun ne qazandiq bide doner nece qalib',['anbarda ne var']);
 assert.equal(sent.url,'https://api.groq.com/openai/v1/chat/completions');assert.equal(sent.headers.authorization,'Bearer k');assert.equal(sent.body.model,'openai/gpt-oss-120b');
 assert.equal(sent.body.response_format.json_schema.strict,true);assert.equal(sent.body.messages.at(-1).content,'bugun ne qazandiq bide doner nece qalib');assert.match(sent.body.messages[1].content,/anbarda ne var/);
 assert.deepEqual(out,{kind:'commands',commands:['bugünkü satış','doner qalığı nə qədərdir'],unsupported:[],ignored:[],understood:'Satış və doner qalığı',reply:''});assert.deepEqual(sent.body.response_format.json_schema.schema.required,['kind','commands','unsupported','ignored','reply']);assert.equal(sent.body.reasoning_effort,'low');});
test('429 pauses the AI for retry-after seconds; errors and bad JSON fall back to the rules',async()=>{let calls=0,clock=0;
 const understand=createUnderstand({apiKey:'k',now:()=>clock,fetchImpl:async()=>{calls++;return reply({},429,{'retry-after':'30'});}});
 assert.equal(await understand('x'),null);assert.equal(await understand('x'),null);assert.equal(calls,1);clock=31000;await understand('x');assert.equal(calls,2);
 assert.equal(await createUnderstand({apiKey:'k',fetchImpl:async()=>{throw new TypeError('fetch failed');}})('x'),null);
 assert.equal(await createUnderstand({apiKey:'k',fetchImpl:async()=>reply({choices:[{message:{content:'not json'}}]})})('x'),null);
 assert.equal(await createUnderstand({apiKey:'k',fetchImpl:async()=>reply({error:'x'},500)})('x'),null);});
test('every command form the AI is told to use is one the rules understand',()=>{
 const fill=f=>f.replace('<MAL>','doner').replace('<SAY> <ədəd|kq|litr>','5 ədəd').replace('<MƏBLƏĞ>','6').replace('“<YENİ AD>”','“XL”').replace('<YENİ AD>','VIP').replace('<NÖMRƏ>','1').replace('<SAY>','3').replace(/<AD>/g,'panda').replace('<YEMƏK>','lahmacun').replace('<XAMMAL>, <XAMMAL>','un, qiymə');
 for(const [form] of COMMANDS)assert.ok(!['unknown','help','social'].includes(interpret(fill(form)).intent),fill(form));});
test('phrases outside the listed forms, or sweeping ones, are dropped before they reach the conversation',async()=>{
 const understand=createUnderstand({apiKey:'k',fetchImpl:async()=>reply({choices:[{message:{content:JSON.stringify({commands:['masa panda sil; masalarin hamisini sil','DROP TABLE orders','bütün masaları sil','masa panda sil'],understood:'x'})}}]})});
 assert.deepEqual((await understand('x')).commands,['masa panda sil']);});
