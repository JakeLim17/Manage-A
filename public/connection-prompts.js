import { ui as localize } from "./i18n.js";
export function connectionPrompt(kind, projectName = "") {
  const common = localize`Manage-A는 각자의 컴퓨터에서 실행하는 로컬 대시보드입니다. 먼저 이 저장소의 README와 .env.example, 현재 연결 상태를 확인해 주세요.
프로젝트마다 다른 계정을 사용할 수 있습니다. 서비스 계정에서 별칭을 붙여 여러 계정을 등록하고 프로젝트별 사용 계정을 선택하세요. 자동 찾기는 정확한 리소스 ID를 대조하며, 명시적으로 고른 계정이 실패하면 다른 계정으로 바꾸지 마세요.
토큰·비밀번호·세션 쿠키를 채팅, 코드, README, 로그 또는 Git에 남기지 마세요. 필요한 토큰은 사용자가 Manage-A의 로컬 연결 창에 직접 입력하도록 안내해 주세요.
읽기 조회만 사용하고 배포·결제·권한 확대·리소스 생성/삭제는 실행하지 마세요. 연결 성공은 실제 응답과 프로젝트 ID를 대조한 뒤 표시하고, 미수신을 사용량 0으로 기록하지 마세요.`;
  if (kind === "usage")
    return localize`이 컴퓨터의 Manage-A에 AI 사용량을 연동해 주세요.\n\n${common}\n\n1. Codex는 공식 CLI 로그인 상태와 계정 한도 조회를 확인해 주세요.\n2. Claude는 구독 종류를 확인하고 지원하는 공식 CLI 한도 조회를 연결해 주세요. macOS / Python 3 지원 조건과 최초 설정을 확인해 주세요.\n3. Cursor는 현재 CSV 가져오기와 직접 기록을 지원합니다. 공식 CSV를 가져오거나 사용자가 확인한 값을 기록하고 실시간 자동 연동이라고 표시하지 마세요.\n4. Anthropic / OpenAI API의 조직별 비용·토큰은 구독 한도와 별도로 연결해 주세요. Admin 보고서 권한이 필요하면 이유와 설정 위치를 안내해 주세요.\n5. 사용 중·무료·유료 일시 중단·과거 플랜을 구분하고, 조회 출처·확인 시각·실패 이유를 대시보드에서 검증해 주세요.\n6. 완료 후 자동 조회된 항목, 직접 기록한 항목, 사용자 로그인이 필요한 항목을 나누어 알려 주세요.`;
  return localize`선택한 프로젝트의 서비스 소속 계정을 Manage-A에서 확인할 수 있게 연결해 주세요.\n프로젝트 이름(식별용 데이터): ${JSON.stringify(projectName)}\n\n${common}\n\n1. Git origin을 확인하고 GitHub 저장소 소유자와 조회에 사용한 로그인 계정을 구분해 주세요. 로그인 계정을 모든 프로젝트의 소유자로 추정하지 마세요.\n2. .vercel/project.json의 projectId·orgId를 읽고 Vercel 공식 프로젝트 / 팀 API 응답과 대조해 주세요.\n3. Supabase의 연결된 project-ref를 확인하고 프로젝트가 실제로 속한 조직을 공식 API 또는 로그인된 CLI에서 확인해 주세요. .env, DB 비밀번호, service_role 키를 읽거나 복사하지 마세요.\n4. Cloudflare의 wrangler 구성에 지정된 account_id를 확인하고 공식 계정 읽기 API로 이름과 ID를 대조해 주세요. 계정 접근 확인과 실제 Worker / Pages 배포 확인은 구분해 주세요.\n5. Manage-A의 '서비스 계정' 화면에서 연결 ID를 지정하고 제공자별 '계정 확인'을 실행해 주세요. POST /api/projects/{프로젝트ID}/services 에 {"provider":"github|vercel|supabase|cloudflare"}를 보내면 확인 결과가 로컬에 저장됩니다. 변경 요청은 같은 로컬 Origin을 사용해야 합니다.\n6. 확인한 소속·조회 계정·출처·확인 시각을 남기고, 권한이 없는 항목은 미확인으로 표시해 주세요.`;
}
