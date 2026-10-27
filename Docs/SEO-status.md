# Manage-A 검색 노출 상태

확인일: 2026-10-28 (한국 시간). 대상은 공개 소개 페이지뿐이다. 로컬 대시보드·실제 프로젝트·계정 정보는 검색 대상이 아니다.

## 반영한 내용

- 한국어·영어별 검색 제목·설명과 자기 언어 canonical, 상호 hreflang.
- 정적 HTML에 포함된 제품 역할·설치·연동 제약 설명. 검색어를 나열하는 숨김 콘텐츠·도어웨이 페이지 없음.
- WebSite·WebPage·SoftwareApplication 구조화 데이터. 실제 1.5.0·MIT·무료 소프트웨어 가격만 표시하고 확인하지 않은 평점은 만들지 않음. 검색 특수 결과 노출 자격을 보장하지 않음.
- 언어별 Open Graph·큰 공유 카드·실제 1200×630 PNG. 원본 SVG를 번들 sharp로 변환했으며 새 패키지 다운로드 없음.
- 기존 sitemap.xml에 공개 한영 canonical 2개 포함. 호스트 루트 /robots.txt 404, 프로젝트 하위 robots는 200. 하위 robots가 호스트 전체를 제어한다고 주장하지 않음.
- GitHub 홈페이지 링크와 vibe-coding·architecture-diagram·open-source 토픽 추가. 기존 토픽 유지.
- README.en의 한국어 UI만 지원한다는 오래된 문장을 실제 한영 지원으로 수정.
- 공개 소개 배포 workflow에서 SEO 검사를 통과해야 배포. 잘못된 canonical·noindex·SVG 공유 경로·소유 태그 누락·깨진 PNG·로컬 검색 차단 제거를 거부.

## 검증과 배포

- 소스 bf8979cd2a7a65e0dca3af470dad8462ce778cc8, main에 fast-forward 통합·origin/main 푸시.
- 전체 회귀 81개 통과. 마지막 공유 이미지 문구 변경 후 관련 공개·SEO 5개 재검사 통과.
- GitHub Pages [40575723141](https://github.com/JakeLim17/Manage-A/actions/runs/40575723141) 성공. 실제 양언어 HTML·PNG·sitemap·하위 robots 5개 HTTP 200·로컬과 바이트 일치.
- 배포 한국어 HTML SHA-256: 2fa2de8ca9d533a89f94369ac4a3cfcd9d87fe274bd8467d507af5b73094f078
- 배포 영어 HTML SHA-256: 6489db236dff5eb67afe1ffa984eaf727e5116103ebf3cd336b1702c544326e2
- 배포 공유 PNG SHA-256: 62f6c8e50c2059385db9271c2aeff536f986b8b9f9ac890f075cd8b4367bf3fe

## Google Search Console

- 사용자가 지정한 현재 Google 계정에 공개 URL 접두어 속성 등록 승인.
- HTML 메타태그로 소유권 확인 성공. 양언어 HTML 소스와 배포 검사에서 태그 유지. 이는 공개 확인 토큰이며 비밀번호·OAuth 비밀이 아니다.
- 정확한 사이트맵 https://jakelim17.github.io/Manage-A/sitemap.xml 제출 접수 확인.
- 최초 보고 상태는 ‘가져올 수 없음 / 사이트맵을 읽을 수 없음’. 로컬 XML 파싱·URL 2개·일반 UA 및 Googlebot UA의 공개 GET 200 확인. UA 이름만 바꾼 요청은 실제 Google 크롤러의 성공 증거가 아니다. 오류 원인은 아직 확정하지 않음.
- 최초 홈페이지 URL 검사: Google에 아직 알려지지 않은 URL·미색인. 색인 생성 요청의 라이브 테스트 진행. 결과는 아래 후속 기록에 남김.
- 소유 확인·제출 접수·사이트맵 처리 성공·색인·검색 노출을 구분한다. 위 작업만으로 검색 노출 완료라고 하지 않는다.

## 네이버·Bing

- 네이버 서치어드바이저: 로그인 필요. 등록·소유 확인·사이트맵 제출 미완료.
- Bing Webmaster Tools: 미로그인 안내 화면 확인. 등록·소유 확인·사이트맵 제출 미완료.
- 계정 생성·약관 동의·Google 계정을 다른 서비스에 연결·호스트 루트나 다른 저장소 변경은 임의로 하지 않음.

## 다음에 확인할 것

- Google 사이트맵 보고서의 성공 여부와 발견 URL 수. 실제 URL 검사에서 공개 페이지·사이트맵 가져오기가 되는지 확인 후 필요하면 같은 URL로 재제출한다. 오류를 숨기려고 무의미한 URL·파일 이름을 추가하지 않는다.
- 한국어·영어 URL의 색인 상태와 실적(노출·클릭). 아직 자료가 없으므로 0으로 단정하지 않음. 순위·반영 기한 보장 없음.
- 네이버·Bing은 사용할 계정과 권한 범위 확인 후 등록. 호스트 단위 소유가 필요한 경우 Manage-A 하위 경로만으로 가능한지 먼저 확인한다.

근거: [Google SEO 기본 가이드](https://developers.google.com/search/docs/fundamentals/seo-starter-guide), [사이트맵 제출·오류 공식 도움말](https://support.google.com/webmasters/answer/7451001?hl=ko), [네이버 사이트 추가 안내](https://help.naver.com/service/30010/contents/17584?lang=ko&osType=PC), [Bing 사이트 추가·소유 확인](https://www.bing.com/webmasters/help/add-and-verify-site-12184f8b).

공통 룰 보완은 로컬 Codex·Claude 공통 설정과 기존 SEO 원본에 저장했다. 공개 저장소에는 개인 설정 파일을 업로드하지 않았다. 새 유료 호출·알림·빌드/dd 폴더 없음.

## 후속 확인

- 한국어 홈페이지: 실제 URL 검사 후 “색인 생성 요청됨 / 우선순위 크롤링 대기열에 추가” 접수 확인. 색인 완료와 구분.
- sitemap.xml: Google 검사 도구 스마트폰 실시간 테스트에서 크롤링 허용 예·페이지 가져오기 성공·색인 생성 허용 예 확인. 사이트맵 보고서의 파싱 성공을 대신하는 증거는 아님. 같은 사이트맵 주소로 한 번 재제출해 처리 상태를 확인한다.
- 공개 브라우저: 한글·영문 링크 전환, 새 제목·언어·canonical·실제 FAQ 표시 확인.

- 영문 홈페이지도 실제 URL 검사 후 “색인 생성 요청됨” 접수 확인. 한국어·영어 모두 크롤링 대기이며 실제 색인은 아직 미확인.
- Google 실시간 접근 성공 확인 후 동일 sitemap.xml을 1회 재제출해 접수 확인. 직후 보고서의 “가져올 수 없음”은 남아 있어 처리 성공을 선언하지 않음. 반복 제출·무의미한 대체 사이트맵 추가는 하지 않음.
