import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import { t as translateText, ui as localize } from '../public/i18n.js';
const root = new URL('../website/',import.meta.url);
const read = p => readFile(new URL(p,root),'utf8');
test('공개 페이지는 한영 경로와 검색 메타 정보를 제공하고 로컬 API를 호출하지 않는다',async()=>{
 for(const [file,lang] of [['index.html','ko'],['en/index.html','en']]){
  const html=await read(file);
  assert.ok(html.includes(`<html lang="${lang}">`));
  for(const marker of ['rel="canonical"','hreflang="ko"','hreflang="en"','application/ld+json','aria-live="polite"']) assert.ok(html.includes(marker));
  assert.ok(!html.includes('noindex'));
  assert.ok(!/hjlim|dlsoft0024|\/Users\/jake|\.local\//.test(html));
 }
 const js=await read('site.js');
 assert.ok(!/fetch\s*\(|XMLHttpRequest|\/api\/|localStorage|document.cookie/.test(js));
});
test('예시 지도 선택과 키보드 버튼의 상태가 설명 및 정지 상태를 갱신한다',async()=>{
 const html=await read('en/index.html');
 const copy=JSON.parse(html.match(/<script id="copy" type="application\/json">(.*?)<\/script>/s)[1]);
 const make=()=>({textContent:'',attrs:{},handlers:{},setAttribute(k,v){this.attrs[k]=v},addEventListener(k,f){this.handlers[k]=f}});
 const nodes=Array.from({length:4},(_,i)=>({...make(),dataset:{node:String(i)}}));
 const els=Object.fromEntries(['role','meaning','detail','evidence','motion'].map(k=>[k,make()]));
 els.copy={textContent:JSON.stringify(copy)};
 let paused;
 vm.runInNewContext(await read('site.js'),{document:{getElementById:k=>els[k],querySelectorAll:()=>nodes,body:{classList:{toggle:(k,v)=>paused=v}}},matchMedia:()=>({matches:true})});
 nodes[2].handlers.click();
 assert.equal(els.meaning.textContent,copy.labels[2]);
 assert.equal(nodes[2].attrs['aria-pressed'],'true');
 assert.equal(nodes[0].attrs['aria-pressed'],'false');
 assert.equal(paused,true);
 els.motion.handlers.click(); assert.equal(paused,false);
});
test('연결 폼은 미정의 변수를 참조하지 않고 기존 계정 ID와 별칭을 보존한다',async()=>{
 const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 const forms={};let sent;
 const context={translateText,localize,data:{mode:'local',serviceAccountRegistry:[{id:'account-1',label:'기존'}]},serviceNames:{vercel:'Vercel'},showModal:()=>{},toast:()=>{},esc:String,field:()=>'', $:s=>forms[s] ||= {},FormData:class {get(k){return {key:'synthetic-test-token',label:'테스트 계정'}[k] ?? null}},saveForm:async(form,url,value)=>sent={url,value}};
 vm.runInNewContext(app.slice(app.indexOf('function connectApiUsage('),app.indexOf('function compactApiUsage(')),context);
 context.connectApiUsage('Claude');await forms['#api-connect-form'].onsubmit({preventDefault(){},target:{}});
 assert.equal(sent.url,'/api/connections/api-usage');assert.equal(sent.value.provider,'Claude');
 vm.runInNewContext(app.slice(app.indexOf('function connectService('),app.indexOf('function showConnectionPrompt(')),context);
 context.connectService('vercel','account-1');await forms['#service-token-form'].onsubmit({preventDefault(){},target:{}});
 assert.equal(sent.value.id,'account-1');assert.equal(sent.value.label,'테스트 계정');
 context.connectService('vercel');await forms['#service-token-form'].onsubmit({preventDefault(){},target:{}});
 assert.equal('id' in sent.value,false);
});
