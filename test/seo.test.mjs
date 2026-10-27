import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validatePublicSeo} from '../scripts/check-public-seo.mjs';
async function fixture() {
 const root=new URL('../website/',import.meta.url);
 const [ko,en,sitemap,image,localIndex]=await Promise.all([readFile(new URL('index.html',root),'utf8'),readFile(new URL('en/index.html',root),'utf8'),readFile(new URL('sitemap.xml',root),'utf8'),readFile(new URL('social.png',root)),readFile(new URL('../public/index.html',import.meta.url),'utf8')]);
 return {ko,en,sitemap,image,localIndex};
}
test('공개 한영 검색 정보·실제 공유 자산은 유효하고 로컬 화면은 비공개다',async()=>{
 assert.deepEqual(validatePublicSeo(await fixture()),[]);
});
test('잘못된 canonical·색인 차단·SVG 공유 이미지 회귀를 거부한다',async()=>{
 const v=await fixture();
 for(const patch of [
  {en:v.en.replace('rel="canonical" href="https://jakelim17.github.io/Manage-A/en/"','rel="canonical" href="https://jakelim17.github.io/Manage-A/"')},
  {ko:v.ko.replace('index,follow,max-image-preview:large','noindex,nofollow')},
  {ko:v.ko.replace('property="og:image" content="https://jakelim17.github.io/Manage-A/social.png"','property="og:image" content="https://jakelim17.github.io/Manage-A/social.svg"')},
  {localIndex:v.localIndex.replace('noindex,nofollow','index,follow')},
  {image:Buffer.alloc(0)},
  {ko:v.ko.replace('name="google-site-verification"','name="removed-verification"')}
 ])assert.ok(validatePublicSeo({...v,...patch}).length>0);
});
