import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import {t,ui,setLocale,getLocale,diagnostic,quotaLabel,accountAlias} from '../public/i18n.js';
import {english} from '../public/locale-en.js';
import {buildArchitecture} from '../public/graph.js';
import {connectionPrompt} from '../public/connection-prompts.js';
afterEach(()=>setLocale('ko'));
test('번역 사전은 비어 있거나 혼합 언어인 영어 문구를 허용하지 않는다',()=>{
 setLocale('en');assert.ok(Object.keys(english).length>900);
 for(const [source,translation] of Object.entries(english)){
  assert.ok(translation.trim(),source);assert.ok(!/[가-힣]/.test(translation),source);assert.equal(t(source),translation,source);
 }
});
test('사용자 이름·메모·경로는 보간 시 번역하거나 HTML로 다시 처리하지 않는다',()=>{
 setLocale('en');const user='설정 프로젝트 <script>alert(1)</script>';
 assert.equal(ui`<p>프로젝트 이름: ${user}</p>`,`<p>Project name: ${user}</p>`);
 assert.equal(t('설정'),'Settings');setLocale('ko');assert.equal(t('설정'),'설정');
});
test('서비스 지도는 두 언어에서 같은 노드·근거·확인 수준을 유지한다',()=>{
 const p={stack:['react','typescript','next'],inventory:{pageCount:1,routeCount:1,pages:['화면.tsx'],routes:['app/api/route.ts'],languages:[{name:'TypeScript'}],db:['@supabase/supabase-js']},vercel:'v'};
 const ko=buildArchitecture(p);setLocale('en');const en=buildArchitecture(p);
 assert.deepEqual(en.nodes.map(n=>n.id),ko.nodes.map(n=>n.id));
 assert.deepEqual(en.edges.map(({from,to,confirmed})=>({from,to,confirmed})),ko.edges.map(({from,to,confirmed})=>({from,to,confirmed})));
 for(let i=0;i<ko.nodes.length;i++)assert.deepEqual(en.nodes[i].evidence,ko.nodes[i].evidence);
 assert.ok(en.caption.includes('execution order'));assert.ok(!/[가-힣]/.test(en.caption));assert.equal(en.nodes[0].label,'Web interface');
});
test('영문 AI 연동 요청은 개인정보·권한 경계를 유지하고 프로젝트 이름은 원문이다',()=>{
 setLocale('en');const name='설정 프로젝트';const value=connectionPrompt('accounts',name);
 assert.ok(value.includes(name));assert.ok(value.includes('read-only'));assert.ok(value.includes('service_role'));assert.ok(value.includes('Do not read or copy'));
 assert.ok(!/[가-힣]/.test(value.replace(name,'')));assert.ok(!/[가-힣]/.test(connectionPrompt('usage')));
});
test('알 수 없는 서버 오류는 영어 안내와 원문 진단을 함께 제공한다',()=>{
 setLocale('en');assert.equal(diagnostic('비밀번호가 맞지 않아요'),'Incorrect password.');
 assert.ok(diagnostic('새로운 제공자 오류').startsWith('Check the connection'));assert.ok(diagnostic('새로운 제공자 오류').includes('새로운 제공자 오류'));
});
async function browserModule({language='ko-KR',saved,requested,blocked=false}={}){
 const source=(await fs.readFile(new URL('../public/i18n.js',import.meta.url),'utf8')).replace("import { english } from './locale-en.js';",'').replaceAll('export ','');
 const assigned=[];const localStorage={getItem:()=>{if(blocked)throw Error('blocked');return saved},setItem:(k,v)=>{if(blocked)throw Error('blocked');saved=v}};
 const document={documentElement:{},querySelector:()=>null};
 const context={english,document,localStorage,navigator:{language},location:{href:'http://127.0.0.1:4310/?'+(requested?'lang='+requested:'')+'#flow',assign:v=>assigned.push(v)},URL};
 vm.runInNewContext(source,context);return {context,assigned,document};
}
test('언어 우선순위는 유효한 URL·저장된 선택·브라우저 순서이며 경로를 유지한다',async()=>{
 const a=await browserModule({language:'en-US'});assert.equal(a.context.getLocale(),'en');
 const b=await browserModule({language:'en-US',saved:'ko'});assert.equal(b.context.getLocale(),'ko');
 const c=await browserModule({language:'ko-KR',saved:'ko',requested:'en'});assert.equal(c.context.getLocale(),'en');
 c.context.setLocale('ko');assert.ok(c.assigned[0].endsWith('?lang=ko#flow'));assert.throws(()=>c.context.setLocale('invalid'));
 const d=await browserModule({language:'fr-FR',blocked:true});assert.equal(d.context.getLocale(),'en');d.context.setLocale('ko');assert.ok(d.assigned[0].includes('lang=ko'));
});

test('자동 한도와 CLI 별칭은 번역하고 직접 적은 값은 유지한다',()=>{
 setLocale('en');assert.equal(quotaLabel('5시간','claude_cli'),'5 hours');assert.equal(quotaLabel('5시간','manual'),'5시간');
 assert.equal(accountAlias({kind:'token',label:'설정'}),'설정');assert.equal(accountAlias({kind:'cli',label:'현재 CLI 로그인'}),'Current CLI sign-in');
});

test('미저장 입력이 있는 언어 전환은 취소할 수 있고 입력을 저장하지 않는다',async()=>{
 const app=await fs.readFile(new URL('../public/app.js',import.meta.url),'utf8');
 const code=app.slice(app.indexOf('function bindLanguage()'),app.indexOf('function settingsView()'));
 let handler,changed;const el={value:'ko',addEventListener:(event,fn)=>handler=fn};
 const ctx={document:{querySelectorAll:()=>[el]},formDirty:true,window:{confirm:()=>false},getLocale:()=> 'en',setLocale:v=>changed=v};
 vm.runInNewContext(code,ctx);ctx.bindLanguage();handler({target:el});assert.equal(changed,undefined);assert.equal(el.value,'en');assert.equal(ctx.formDirty,true);
 ctx.window.confirm=()=>true;el.value='ko';handler({target:el});assert.equal(changed,'ko');assert.equal(ctx.formDirty,false);
});
