import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const base='https://jakelim17.github.io/Manage-A/';
export function validatePublicSeo({ko,en,sitemap,image,localIndex}) {
 const errors=[];
 for (const [html,lang,url] of [[ko,'ko',base],[en,'en',base+'en/']]) {
  const check=(ok,message)=>{if(!ok)errors.push(`${lang}: ${message}`)};
  check(html.includes(`<html lang="${lang}">`),'문서 언어');
  const title=html.match(/<title>(.*?)<\/title>/s)?.[1]||'';
  check(title.includes('Manage-A')&&/프로젝트|Project/.test(title),'제품·주제를 설명하는 제목');
  check(/<meta name="description" content="[^"]{40,}"/.test(html),'설명');
  check(!/noindex|nofollow/i.test(html),'공개 페이지 색인 차단 없음');
  check(html.includes(`<link rel="canonical" href="${url}">`),'자기 언어 canonical');
  for(const [l,u] of [['ko',base],['en',base+'en/'],['x-default',base+'en/']])check(html.includes(`hreflang="${l}" href="${u}"`),'상호 언어 대체 URL '+l);
  check(html.includes(`property="og:image" content="${base}social.png"`),'PNG 공유 이미지');
  check(html.includes('name="twitter:card" content="summary_large_image"'),'큰 공유 카드');
  check(html.includes('id="questions"'),'서버 응답에 포함된 제품 설명');
  check(/name="google-site-verification" content="[^"]+"/.test(html),'소유 확인 태그 보존');
  try {
   const schema=JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)?.[1]||'');
   const graph=schema['@graph']||[];
   for(const type of ['WebSite','WebPage','SoftwareApplication'])check(graph.some(n=>n['@type']===type),'구조화 데이터 '+type);
   const page=graph.find(n=>n['@type']==='WebPage');check(page?.url===url&&page?.inLanguage===lang,'구조화 페이지 URL·언어');
   const app=graph.find(n=>n['@type']==='SoftwareApplication');check(app?.license?.endsWith('/LICENSE')&&app?.offers?.price==='0','라이선스·무료 가격');
   check(!app?.aggregateRating&&!app?.review,'검증하지 않은 평점·리뷰 없음');
  } catch {errors.push(`${lang}: 구조화 JSON 구문`)}
  check(sitemap.includes(`<loc>${url}</loc>`),'사이트맵 canonical URL');
 }
 if(!image||image.length<24||image.readUInt32BE(0)!==0x89504e47||image.readUInt32BE(16)!==1200||image.readUInt32BE(20)!==630)errors.push('공유 PNG 1200×630');
 if(!localIndex.includes('noindex,nofollow'))errors.push('로컬 관리 화면 검색 차단 유지');
 return errors;
}
export async function checkPublicSeo() {
 const root=new URL('../website/',import.meta.url);
 const [ko,en,sitemap,image,localIndex]=await Promise.all([readFile(new URL('index.html',root),'utf8'),readFile(new URL('en/index.html',root),'utf8'),readFile(new URL('sitemap.xml',root),'utf8'),readFile(new URL('social.png',root)),readFile(new URL('../public/index.html',import.meta.url),'utf8')]);
 const errors=validatePublicSeo({ko,en,sitemap,image,localIndex});
 if(errors.length)throw Error(errors.join('\n'));
 console.log('공개 한영 SEO·공유 이미지·로컬 검색 차단 검사 통과');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await checkPublicSeo();
