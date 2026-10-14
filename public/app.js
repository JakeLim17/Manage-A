import { buildArchitecture, languageColor, fitLabel } from "./graph.js";
import {
  analyzeImpact,
  summarizeHealth,
  productionSummary,
  attentionItems,
  fresh,
} from "./insights.js";
import { helpTopics, searchHelp } from "./help.js";
let helpQuery = "",
  helpFocus = "";
const $ = (s) => document.querySelector(s);
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const paths = {
  home: "M3 10 12 3l9 7v11h-6v-7H9v7H3z",
  folder: "M3 5h6l2 3h10v12H3z",
  flow: "M12 3v5M5 16v-5h14v5M3 16h4v5H3zM17 16h4v5h-4zM10 3h4v5h-4z",
  chart: "M4 20V10h3v10M10 20V4h3v16M16 20v-7h3v7",
  ai: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z",
  log: "M6 3h12v18H6zM9 8h6M9 12h6M9 16h4",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2",
  lock: "M7 11V7a5 5 0 0 1 10 0v4M5 11h14v11H5zM12 15v3",
  refresh: "M20 8a8 8 0 1 0 0 8M20 3v5h-5",
  arrow: "m9 5 7 7-7 7",
  plus: "M12 4v16M4 12h16",
  db: "M4 6c0-5 16-5 16 0s-16 5-16 0v12c0 5 16 5 16 0V6M4 12c0 5 16 5 16 0",
  screen: "M3 4h18v13H3zM12 17v4M8 21h8",
  cloud: "M6 19a5 5 0 0 1-1-10 7 7 0 0 1 13-2 6 6 0 0 1 0 12z",
  code: "m8 5-6 7 6 7M16 5l6 7-6 7M14 2l-4 20",
  check: "m5 12 4 4L19 6",
  close: "m5 5 14 14M19 5 5 19",
  search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14m5 12 6 6",
  users:
    "M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M2 21v-3a7 7 0 0 1 14 0v3M17 4a4 4 0 0 1 0 8M19 15a5 5 0 0 1 3 5",
  pause: "M8 5v14M16 5v14",
  play: "m7 3 14 9-14 9z",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
};
const icon = (n, cls = "") =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[n] || paths.folder}"/></svg>`;
let data,
  view = "overview",
  selected = "",
  query = "",
  paused = false,
  speed = 1,
  days = 28,
  stats = null,
  demo = false,
  requestId = 0,
  mapPage = 0,
  flowMode = "architecture",
  routeFile = "",
  projectFilter = "all";
let impactFile = "",
  impactInspect = "",
  impactQuery = "",
  impactChangedOnly = false;
const labels = {
  unknown: "상태 미확인",
  development: "개발 중",
  running: "운영 중",
  paused: "보류",
};
const nav = [
  ["overview", "home", "개요"],
  ["projects", "folder", "프로젝트"],
  ["flow", "flow", "시스템 흐름"],
  ["health", "check", "상태 점검"],
  ["impact", "code", "변경 영향"],
  ["analytics", "chart", "방문·검색"],
  ["usage", "ai", "AI 사용량"],
  ["activity", "log", "운영 기록"],
  ["settings", "settings", "설정"],
  ["help", "log", "사용설명서"],
];
const usageSource = (u) =>
  u?.source === "claude_cli"
    ? "Claude 공식 CLI 자동 조회"
    : u?.source === "claude_statusline"
      ? "Claude 공식 상태줄 자동 수신"
      : u?.source === "codex_cli"
        ? "Codex 공식 CLI 자동 조회"
        : u?.source === "codex_app"
          ? "Codex 공식 조회 스냅샷"
          : "직접 입력";
const fmt = (n) => Number(n || 0).toLocaleString("ko-KR");
const date = (v) =>
  v
    ? new Date(v).toLocaleString("ko-KR", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const badge = (text, kind = "gray") =>
  `<span class="badge ${kind}"><i></i>${esc(text)}</span>`;
const card = (title, content, action = "") =>
  `<section class="card"><div class="card-head"><h2>${title}</h2>${action}</div>${content}</section>`;
const empty = (title, text, button = "") =>
  `<div class="empty">${icon("chart")}<h3>${title}</h3><p>${text}</p>${button}</div>`;
async function api(url, opts = {}) {
  const r = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts.headers },
  });
  const b = await r.json();
  if (!r.ok) {
    if (r.status === 401 && url !== "/api/login") {
      data = null;
      boot();
    }
    throw new Error(b.error || "요청에 실패했어요");
  }
  return b;
}
function toast(s) {
  $("#toast").textContent = s;
  $("#toast").classList.add("show");
  setTimeout(() => $("#toast").classList.remove("show"), 4000);
}
function project() {
  return data.projects.find((p) => p.id === selected) || data.projects[0];
}
async function load() {
  data = await api("/api/dashboard");
  if (!data.projects.some((p) => p.id === selected)) {
    selected = sessionStorage.getItem("selectedProject");
    if (!data.projects.some((p) => p.id === selected))
      selected =
        data.projects.find((p) => p.id === "Manage-A")?.id ||
        data.projects[0]?.id ||
        "";
    stats = null;
    demo = false;
    requestId++;
  }
  render();
}
function selector() {
  return `<select id="project-select" aria-label="프로젝트 선택">${data.projects.map((p) => `<option value="${esc(p.id)}" ${p.id === selected ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>`;
}
function render() {
  const displayName = data.profile?.displayName || "사용자";
  const title = {
    overview: `좋은 하루예요, ${displayName}님!`,
    projects: "프로젝트",
    flow: "시스템 흐름",
    health: "프로젝트 상태 점검",
    impact: "변경 영향 지도",
    analytics: "방문·검색 통계",
    usage: "AI 사용량",
    activity: "운영 기록",
    settings: "설정",
    help: "Manage-A 사용설명서",
  }[view];
  const sub = {
    overview: "프로젝트 구조, 운영 상태, AI 사용량을 관리하는 대시보드입니다.",
    projects: "로컬에서 발견한 프로젝트와 직접 정리한 정보를 함께 봅니다.",
    flow: "연결선을 따라 기능의 처리 과정을 살펴보세요.",
    health: "운영 사이트와 내 컴퓨터의 개발 서버는 별도로 확인합니다.",
    impact: "파일을 선택하면 이를 참조하는 화면과 API를 찾습니다.",
    analytics: "방문과 검색 성과를 프로젝트별로 확인하세요.",
    usage: "구독 한도와 API 사용량을 함께 확인하세요.",
    activity: "Git 변경 기록과 대시보드에서 관리한 작업 내역입니다.",
    settings: "로컬 기본 실행. 필요한 데이터만 직접 연결하세요.",
    help: "처음에는 개요·운영 사이트·AI 사용량부터 보세요. 필요한 내용만 찾아 읽으면 됩니다.",
  }[view];
  $("#app").innerHTML =
    `<aside class="sidebar"><a class="brand" href="#overview"><img class="manage-logo" src="/logo.svg" alt="">Manage-A</a><div class="workspace"><span class="avatar">${esc(Array.from(displayName)[0] || "M")}</span><div>${esc(displayName)}의 워크스페이스<small>프로젝트 관리</small></div></div><nav>${nav.map(([id, i, l]) => `<button data-nav="${id}" class="nav-item ${view === id ? "active" : ""}" aria-label="${l}" title="${l}">${icon(i)}<span>${l}</span>${id === "projects" ? `<span class="nav-count">${data.projects.length}</span>` : ""}</button>`).join("")}</nav><div class="side-bottom"><span class="live-dot"></span> ${data.mode === "local" ? "로컬 전용" : "인증된 웹 접근"}<p>${data.mode === "local" ? "이 기기에서 안전하게 관리합니다." : "로그인한 사용자만 접근할 수 있습니다."}</p><div class="version">Manage-A <span>v1.4</span></div></div></aside><main><header class="topbar"><div>워크스페이스 <span>/</span> ${nav.find((n) => n[0] === view)[2]}</div><div class="top-actions"><button class="button" data-guide="${view === "help" ? "" : view}">${icon("log")}${view === "help" ? "전체 설명서" : "이 화면 사용법"}</button>${badge(data.mode === "local" ? "로컬 모드" : "인증된 웹", "green")}<button class="button" data-nav="settings">${icon("lock")} 웹 접근 설정</button>${data.mode === "web" ? '<button class="button" id="logout">로그아웃</button>' : ""}</div></header><div class="content"><div class="page-heading"><div><h1>${esc(title)}</h1><p>${sub}</p></div><button class="button" id="refresh">${icon("refresh")} 새로고침</button></div>${view === "overview" ? overview() : view === "projects" ? projectsView() : view === "flow" ? flowView() : view === "health" ? healthView() : view === "impact" ? impactView() : view === "analytics" ? analyticsView() : view === "usage" ? usageView() : view === "activity" ? activityView() : view === "help" ? helpView() : settingsView()}<footer><span id="connection-health">${icon("lock")} 연결 키와 민감한 값은 브라우저에 전송하지 않습니다.</span><span>프로젝트 확인 ${date(data.scannedAt)}</span></footer></div></main>`;
  bind();
  fitSvgText();
  document.fonts?.ready.then(fitSvgText);
}
function fitSvgText() {
  document.querySelectorAll("svg text[data-fit-width]").forEach((el) => {
    const text = el.dataset.fullText ?? el.textContent;
    el.dataset.fullText = text;
    const width = Number(el.dataset.fitWidth);
    try {
      el.textContent = fitLabel(
        text,
        (candidate) => {
          el.textContent = candidate;
          return el.getComputedTextLength();
        },
        width,
      );
    } catch {}
  });
}
function runtimeBadge(p) {
  const h = summarizeHealth(p);
  if (["ok", "error", "review"].includes(h.state))
    return badge(
      h.label,
      h.state === "ok" ? "green" : h.state === "error" ? "red" : "amber",
    );
  return badge(
    p.localPorts?.some((v) => v.reachable && v.owned !== false)
      ? "로컬 포트 응답"
      : h.label,
    p.localPorts?.some((v) => v.reachable && v.owned !== false)
      ? "green"
      : "gray",
  );
}
function metrics(items) {
  return `<div class="metrics">${items.map(([label, value, detail, i]) => `<div class="metric"><span class="metric-icon">${icon(i)}</span><div><p>${label}</p><strong>${value}</strong><small>${detail}</small></div></div>`).join("")}</div>`;
}
function isStale(u) {
  return (
    !!u &&
    (Date.now() - Date.parse(u.updatedAt) >
      (["codex_cli", "claude_statusline", "claude_cli"].includes(u.source)
        ? 600000
        : 86400000) ||
      (u.resetAt && Date.parse(u.resetAt) < Date.now()))
  );
}
function subscriptionLabel(name) {
  const sub = data.subscriptions?.[name];
  if (!sub) return "";
  return `${sub.plan || "플랜 미기록"}${sub.historical ? " 사용 이력" : ""} · ${{ active: "사용 중", paused: "유료 일시 중단", free: "무료 사용", unknown: "상태 미확인" }[sub.status]}`;
}
function providerState(name) {
  const status = { ...(data.integrationStatus?.[name] || {}) };
  if (name === "Codex" && status.state === "connected" && !status.reason)
    status.reason =
      "공식 CLI 한도 조회가 정상 응답했습니다. 서버 실행 중 5분마다 갱신됩니다.";
  if (data.subscriptions?.[name]?.status === "paused")
    return {
      state: "paused",
      label: "유료 일시 중단",
      reason:
        "사용자가 기록한 구독 상태입니다. 이전 플랜과 사용량 기록은 유지합니다.",
    };
  return {
    ...status,
    label:
      {
        connected: "연결됨",
        stale: "이전 수신값",
        login_required: "로그인 필요",
        setup_required: "수집기 설정 필요",
        waiting: "한도 수신 대기",
        interactive_setup_required: "CLI 초기 설정 필요",
        unavailable: "CLI 확인 필요",
        imported: "CSV 기록 있음",
        manual: "직접 기록 / CSV",
        error: "조회 실패",
      }[status.state] || "연결 확인 전",
  };
}
function usageCards() {
  return ["Claude", "Codex", "Cursor"]
    .map((name, i) => {
      const state = providerState(name),
        u = state.state === "paused" ? null : data.usage[name];
      return `<div class="usage-row"><div class="provider p${i}">${name[0]}</div><div class="usage-main"><div class="between"><strong>${name}</strong><b class="${u ? "teal" : "muted"}">${u ? `${Math.round(u.remaining)}% 남음${isStale(u) ? " · 재확인" : ""}` : esc(state.label)}</b></div>${u ? `<div class="meter"><span style="width:${u.remaining}%"></span></div>` : ""}<small>${esc(subscriptionLabel(name))}</small><small>${u ? `${usageSource(u)} · ${esc(u.window)} · ${date(u.updatedAt)}` : esc(state.reason || "AI 사용량에서 연결 방법을 확인하세요.")}</small></div><button class="icon-button" data-nav="usage" aria-label="${name} 연결 상태 보기">${icon("arrow")}</button></div>`;
    })
    .join("");
}
function overview() {
  const dirty = data.projects.filter((p) => p.changes);
  return (
    metrics([
      ["프로젝트", data.projects.length, "로컬 폴더에서 자동 발견", "folder"],
      [
        "로컬 포트 열림",
        data.projects.filter((p) =>
          p.localPorts?.some((v) => v.reachable && v.owned !== false),
        ).length,
        "응답 포트 발견 / 정상 여부 별도",
        "cloud",
      ],
      ["변경된 프로젝트", dirty.length, "커밋하지 않은 변경 있음", "code"],
      [
        "연결된 통계",
        data.projects.filter((p) => p.gaProperty || p.searchSite).length,
        "통계 속성 ID 등록 기준",
        "chart",
      ],
    ]) +
    `<div class="overview-grid"><div>${card("프로젝트와 데이터 흐름", overviewMap(), `<button class="text-button" data-nav="flow">상세 보기 ${icon("arrow")}</button>`)}${card("프로젝트", projectTable([...data.projects].sort((a, b) => (Date.parse(b.commits[0]?.date) || 0) - (Date.parse(a.commits[0]?.date) || 0)).slice(0, 5)), `<button class="text-button" data-nav="projects">전체 ${data.projects.length}개 ${icon("arrow")}</button>`)}</div><div>${card("AI 사용량", usageCards(), badge("출처·시각 표시", "gray"))}${card("지금 확인할 일", attentionPanel())}${overviewAnalytics()}</div></div>`
  );
}
function overviewMap() {
  if (!data.projects.length)
    return empty("프로젝트가 없어요", "설정의 PROJECT_ROOT 경로를 확인하세요.");
  const ordered = [...data.projects].sort(
    (a, b) =>
      Number(b.id === "Manage-A") - Number(a.id === "Manage-A") ||
      (Date.parse(b.commits[0]?.date) || 0) -
        (Date.parse(a.commits[0]?.date) || 0),
  );
  const ps = ordered.slice(mapPage * 3, mapPage * 3 + 3);
  return `<div class="map-toolbar">${badge("로컬 스캔", "green")}<span class="muted">${mapPage * 3 + 1}–${Math.min(mapPage * 3 + 3, data.projects.length)} / ${data.projects.length}개</span><button class="icon-button" id="map-prev" aria-label="이전 프로젝트" ${mapPage === 0 ? "disabled" : ""}>${icon("arrow", "flip")}</button><button class="icon-button" id="map-next" aria-label="다음 프로젝트" ${(mapPage + 1) * 3 >= data.projects.length ? "disabled" : ""}>${icon("arrow")}</button><button id="pause" class="icon-button" aria-label="흐름 ${paused ? "재생" : "일시정지"}">${icon(paused ? "play" : "pause")}</button></div><div class="overview-map ${paused ? "paused" : ""}"><div class="root-node"><img class="manage-logo" src="/logo.svg" alt=""><div>Manage-A<small>프로젝트 관리 대시보드</small></div></div><div class="map-trunk"></div><div class="project-nodes">${ps.map((p) => `<button class="map-project" data-project="${esc(p.id)}">${icon("folder")}<strong>${esc(p.name)}</strong>${p.website ? siteBadge(p) : ""}${runtimeBadge(p)}<small class="management-state">관리: ${esc(labels[p.status])}</small><small>${esc(p.stack.slice(0, 3).join(" / ") || "스택 미확인")}</small></button>`).join("")}</div><p class="map-caption">${icon("flow")} 프로젝트를 누르면 기능과 연결 구조를 볼 수 있어요.</p></div>`;
}
function languageBar(p) {
  const langs = p.inventory?.languages || [],
    total = langs.reduce((v, l) => v + l.count, 0) || 1;
  return `<div class="language-bar" aria-label="언어별 소스 파일 비율">${langs.map((l) => `<span title="${esc(l.name)} ${l.count}개 파일" style="width:${(l.count / total) * 100}%;background:${languageColor(l.name)}"></span>`).join("")}</div><div class="language-legend">${langs
    .slice(0, 5)
    .map(
      (l) =>
        `<span><i style="background:${languageColor(l.name)}"></i>${esc(l.name)} <b>${l.count}</b></span>`,
    )
    .join("")}</div>`;
}
function portLabel(p) {
  const ports = p.localPorts || [];
  return ports.some((v) => v.reachable && v.owned === true)
    ? "프로세스 확인"
    : ports.some((v) => v.reachable && v.owned !== false)
      ? "포트 응답"
      : ports.some((v) => v.owned === false)
        ? "다른 프로젝트 포트"
        : ports.length
          ? "응답 없음"
          : "주소 미확인";
}
function siteBadge(p) {
  const s = productionSummary(p);
  return badge(s.label, s.kind);
}
function deploymentBadge(p) {
  const d = p.deployment;
  return d
    ? badge(
        d.state === "READY"
          ? "배포 준비 완료"
          : d.state === "UNAVAILABLE"
            ? "배포 정보 조회 필요"
            : d.state,
        d.state === "READY" ? "green" : "amber",
      )
    : badge(p.vercel ? "연결 파일 발견" : "미연결");
}
function projectTable(ps) {
  return `<div class="table-wrap"><table><thead><tr><th>프로젝트 / 목적</th><th>개발 언어</th><th>로컬 실행</th><th>운영 사이트 / 배포 정보</th><th>변경</th><th></th></tr></thead><tbody>${ps
    .map(
      (p) =>
        `<tr><td><button class="project-name" data-project="${esc(p.id)}">${icon("folder")}<span>${esc(p.name)}<small>${esc(p.description)}</small></span></button>${p.website ? siteBadge(p) : ""}${runtimeBadge(p)}<small class="management-state">관리: ${esc(labels[p.status])}</small></td><td class="language-cell">${languageBar(p) || "소스 미확인"}</td><td>${badge(portLabel(p), p.localPorts?.some((v) => v.reachable && v.owned !== false) ? "green" : "gray")}<small>${
          p.localPorts
            ?.filter((v) => v.reachable)
            .map((v) => ":" + v.port)
            .join(" ") || ""
        }</small></td><td>${p.website ? siteBadge(p) : ""}${deploymentBadge(p)}</td><td><strong>${p.changes}</strong><small>파일 변경</small></td><td><button class="icon-button" data-edit="${esc(p.id)}" aria-label="${esc(p.name)} 편집">${icon("settings")}</button></td></tr>`,
    )
    .join("")}</tbody></table></div>`;
}
function projectsView() {
  const filtered = data.projects
    .filter((p) =>
      (
        p.name +
        " " +
        p.description +
        " " +
        p.stack.join(" ") +
        " " +
        (p.inventory?.languages || []).map((l) => l.name).join(" ")
      )
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .filter(
      (p) =>
        projectFilter === "all" ||
        (projectFilter === "active" &&
          p.localPorts.some((v) => v.reachable && v.owned !== false)) ||
        (projectFilter === "changed" && p.changes) ||
        (projectFilter === "deployment" && p.vercel),
    );
  return `<div class="section-toolbar"><label class="search-box">${icon("search")}<input id="search" placeholder="프로젝트, 언어, 기술 검색" value="${esc(query)}"></label><div class="filter-tabs">${[
    ["all", "전체"],
    ["active", "포트 응답"],
    ["changed", "변경 있음"],
    ["deployment", "배포 연결"],
  ]
    .map(
      ([id, label]) =>
        `<button data-filter="${id}" class="${projectFilter === id ? "active" : ""}">${label}</button>`,
    )
    .join(
      "",
    )}</div><span class="muted">${filtered.length}개 프로젝트</span></div>${card("프로젝트 목록", filtered.length ? projectTable(filtered) : empty("검색 결과가 없어요", "다른 이름이나 필터를 선택하세요."))}`;
}
function overviewAnalytics() {
  const rows = data.analyticsSummaries || [];
  return card(
    "방문·검색 연결",
    rows.length
      ? `<div class="summary-list">${rows.map((r) => `<button data-analytics-project="${esc(r.project)}"><strong>${esc(r.project)}</strong><span>${r.ga ? fmt(r.ga.totals[0]) + "명 방문" : "GA4 미연결"} / ${r.search ? fmt(r.search.totals.clicks) + "회 검색 클릭" : "검색 미연결"}</span><small>${r.days}일 · ${date(r.updatedAt)}</small></button>`).join("")}</div>`
      : empty(
          "아직 연결된 통계가 없어요",
          "Google 인증 파일을 연결한 후 프로젝트별 속성을 선택하세요.",
          `<button class="button" data-nav="settings">연결 설정 열기</button>`,
        ),
  );
}
function defaultFlow(p) {
  const nodes = [
    { id: "user", label: "사용자", detail: "기능 시작" },
    {
      id: "screen",
      label: "화면",
      detail: p?.stack.includes("react")
        ? "React 기반 화면"
        : "입력과 결과 표시",
    },
    {
      id: "api",
      label: "처리 로직",
      detail: p?.inventory?.routes.length
        ? `API 경로 ${p.inventory.routes.length}개 발견`
        : "실제 구조를 편집해 주세요",
    },
    {
      id: "db",
      label: "저장소",
      detail: p?.inventory?.db.length
        ? p.inventory.db.join(", ").slice(0, 35)
        : "연결 확인 필요",
    },
    { id: "response", label: "완료 응답", detail: "처리 결과 표시" },
  ];
  return {
    nodes,
    edges: [
      { from: "user", to: "screen", label: "입력" },
      { from: "screen", to: "api", label: "요청" },
      { from: "api", to: "db", label: "쓰기" },
      { from: "db", to: "response", label: "결과" },
      { from: "response", to: "screen", label: "응답" },
    ],
  };
}
let activeNode = "";
function flowView() {
  const p = project();
  if (!p) return empty("프로젝트가 없어요", "프로젝트 폴더를 확인해 주세요.");
  const f =
    flowMode === "custom"
      ? p.flow || defaultFlow(p)
      : buildArchitecture(p, routeFile);
  if (!f.nodes.some((n) => n.id === activeNode)) activeNode = f.nodes[0].id;
  const n = f.nodes.find((n) => n.id === activeNode),
    inv = p.inventory || {},
    r = inv.routeDetails?.find((r) => (r.key || r.file) === routeFile);
  return `<div class="section-toolbar flow-toolbar">${selector()}<div class="filter-tabs"><button data-flow-mode="architecture" class="${flowMode === "architecture" ? "active" : ""}">코드 연결 구조</button><button data-flow-mode="custom" class="${flowMode === "custom" ? "active" : ""}">직접 정의한 흐름</button></div><div class="flow-controls"><button class="button" id="pause">${icon(paused ? "play" : "pause")}${paused ? "재생" : "일시정지"}</button><select id="speed" aria-label="재생 속도">${[0.5, 1, 2].map((v) => `<option value="${v}" ${v === speed ? "selected" : ""}>${v}×</option>`).join("")}</select><button class="button" id="edit-flow">${icon("settings")} 구조 편집</button></div></div>
 <div class="project-ribbon"><div><strong>${esc(p.name)}</strong><span>${esc(p.description)}</span></div>${badge(labels[p.status], p.status === "development" ? "amber" : "gray")}<span class="ribbon-stat">${inv.sourceCount || 0}개 소스</span><span class="ribbon-stat">${inv.pageCount || 0}개 페이지</span><span class="ribbon-stat">${inv.routeCount || 0}개 API</span></div>
 <div class="flow-layout">${card("구조와 처리 경로", `<div class="flow-subtoolbar"><label>기능별 연결 보기<select id="route-select" aria-label="기능별 API 선택"><option value="">프로젝트 전체 구조</option>${(inv.routeDetails || []).map((v) => `<option value="${esc(v.key || v.file)}" ${(v.key || v.file) === routeFile ? "selected" : ""}>${esc(v.methods.join("/") || "API")} ${esc(v.endpoint)}</option>`).join("")}</select></label><div class="graph-legend"><span><i class="solid-line"></i>코드 import</span><span><i class="dashed-line"></i>추정 / 설정 연결</span></div></div><div class="flow-notice">${badge(flowMode === "custom" ? "직접 정의" : "소스 기반 분석", flowMode === "custom" ? "green" : "gray")}<span>${esc(f.caption || "직접 정리한 설명용 처리 순서입니다.")}</span></div>${flowSvg(f)}<div class="steps">${f.nodes.map((v) => `<button data-node="${esc(v.id)}" class="${activeNode === v.id ? "active" : ""}">${icon(v.kind || "flow")}${esc(v.label)}</button>`).join("")}</div><p class="card-note">이동하는 점은 경로 설명용입니다. 실제 요청량·호출 순서를 측정한 화면이 아닙니다.</p>`)}<div>${card(
   "선택한 구성 요소",
   `<div class="inspector node-inspector">${icon(n.kind || "flow")}<h3>${esc(n.label)}</h3><p>${esc(n.detail || "설명을 추가하세요.")}</p>${n.language ? badge(n.language, "green") : ""}<h4>확인 근거</h4><div class="evidence-list">${(n.evidence || ["직접 입력한 단계"]).map((v) => `<code>${esc(v)}</code>`).join("")}</div><h4>다음 연결</h4><div class="next-links">${
     f.edges
       .filter((e) => e.from === n.id)
       .map(
         (e) =>
           `<button data-node="${esc(e.to)}">${icon("arrow")} ${esc(f.nodes.find((v) => v.id === e.to)?.label)}<small>${esc(e.label)}</small></button>`,
       )
       .join("") || "<p>추가 연결 없음</p>"
   }</div></div>`,
 )}${card("배포 연결", `<div class="inspector">${deploymentBadge(p)}<p>${esc(p.deployment?.error || p.deployment?.source || "배포 상태를 조회하지 않았어요.")}</p>${p.deployment?.url ? `<a class="button" target="_blank" rel="noopener noreferrer" href="${esc(p.deployment.url)}">배포 화면 열기</a>` : ""}<p class="muted">${date(p.deployment?.updatedAt)}</p>${p.vercel ? `<button class="button" id="fetch-deployment">${icon("refresh")} 배포 상태 조회</button>` : ""}</div>`)}</div></div>
 <div class="detail-grid">${card("개발 언어와 기술", `<div class="settings-body">${languageBar(p)}<div class="tags">${p.stack.map((t) => `<span>${esc(t)}</span>`).join("")}</div><p class="muted">소스 파일 수 기준입니다. ${inv.bounded ? "탐색 상한에 도달해 일부 파일만 포함합니다." : "생성 산출물과 의존성 폴더는 제외합니다."}</p><div class="code-facts"><div><strong>${inv.sourceCount || 0}</strong><span>소스 파일</span></div><div><strong>${inv.pageCount || 0}</strong><span>페이지</span></div><div><strong>${inv.routeCount || 0}</strong><span>API</span></div></div></div>`)}${card(
   r ? "선택한 API의 코드 연결" : "기능과 운영 방법",
   `<div class="settings-body">${
     r
       ? `<div class="method-tags">${r.methods.map((m) => `<span>${esc(m)}</span>`).join("")}<code>${esc(r.endpoint)}</code></div><h4>파일</h4><code class="code-block">${esc(r.file)}</code><h4>연결된 내부 모듈</h4><div class="evidence-list">${r.links.map((v) => `<code>${esc(v)}</code>`).join("") || "<p>해석 가능한 로컬 import가 없어요.</p>"}</div><h4>직접 import</h4><div class="tags">${r.imports.map((v) => `<span>${esc(v)}</span>`).join("")}</div><h4>소스 연결 트레이스</h4><div class="import-trace">${
           (r.importTrace || [])
             .slice(0, 18)
             .map(
               (t) =>
                 `<div><code>${esc(t.from)}</code><span>${icon("arrow")}${esc(t.kind)}</span><code>${esc(t.to)}</code></div>`,
             )
             .join("") || "<p>추적 가능한 import 연결이 없어요.</p>"
         }</div>${r.dependencyBounded ? '<p class="muted">깊이·파일 수 제한으로 일부 연결은 생략했습니다.</p>' : ""}`
       : `<div class="feature-list">${
           p.features
             .slice(0, 8)
             .map((v) => `<div>${icon("check")}<span>${esc(v)}</span></div>`)
             .join("") || "<p>주요 기능을 프로젝트 편집에서 정리하세요.</p>"
         }</div><p class="muted">기능 출처: ${esc(p.featureSource || "직접 입력")}</p><h4>실행 방법</h4><div class="evidence-list">${(inv.scriptCommands || []).map((v) => `<code>${esc(v.file)} → npm run ${esc(v.name)}</code>`).join("") || "<p>package.json 실행 명령 없음</p>"}</div><div class="local-links">${(p.localPorts || []).map((v) => `<a href="${esc(v.url)}" target="_blank" rel="noopener noreferrer">${badge(v.owned === false ? "다른 프로젝트 포트" : v.owned === true ? "실행 프로세스 확인" : v.reachable ? "포트 열림" : "응답 없음", v.reachable ? "green" : "gray")} ${esc(v.url)}${v.ownerProject ? ` <small>${esc(v.ownerProject)} · PID ${v.pid}</small>` : ""}</a>`).join("")}</div><button class="button" data-edit="${esc(p.id)}">프로젝트 정보 편집</button>`
   }</div>`,
 )}</div>`;
}
function flowSvg(f) {
  const positions = f.nodes.map((node, i) => {
    if (Number.isFinite(node.x) && Number.isFinite(node.y))
      return { x: node.x, y: node.y };
    if (f.nodes.length <= 6) {
      return i < 3
        ? { x: 35 + i * 250, y: 65 }
        : { x: 535 - (i - 3) * 250, y: 325 };
    }
    return { x: 35 + (i % 3) * 250, y: 35 + Math.floor(i / 3) * 180 };
  });
  const height = Math.max(...positions.map((p) => p.y + 125), 350);
  return `<div class="flow-canvas ${paused ? "paused" : ""}" style="--speed:${4 / speed}s"><svg viewBox="0 0 780 ${height}" role="img" aria-label="설명용 프로젝트 처리 흐름"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="#079a94"/></marker></defs>${f.edges
    .map((e, i) => {
      const a = positions[f.nodes.findIndex((n) => n.id === e.from)],
        b = positions[f.nodes.findIndex((n) => n.id === e.to)];
      const ax = a.x + 90,
        ay = a.y + 50,
        bx = b.x + 90,
        by = b.y + 50;
      let d;
      if (a.y === b.y)
        d =
          ax < bx
            ? `M${a.x + 180},${ay} H${b.x}`
            : `M${a.x},${ay} H${b.x + 180}`;
      else if (a.x === b.x)
        d = `M${ax},${a.y < b.y ? a.y + 100 : a.y} V${a.y < b.y ? b.y : b.y + 100}`;
      else {
        const fromX = a.x < b.x ? a.x + 180 : a.x,
          toX = a.x < b.x ? b.x : b.x + 180,
          lane = (fromX + toX) / 2;
        d = `M${fromX},${ay} H${lane} V${by} H${toX}`;
      }
      return `<path id="edge${i}" d="${d}" fill="none" stroke="#87c9c5" stroke-width="2" stroke-dasharray="${e.confirmed ? "" : "5 5"}" opacity="${e.from === activeNode || e.to === activeNode ? 1 : 0.55}" marker-end="url(#arrow)"/><text x="${a.x === b.x ? ax + 9 : (ax + bx) / 2}" y="${a.y === b.y ? ay - 12 : (ay + by) / 2 - 10}" text-anchor="${a.x === b.x ? "start" : "middle"}" class="edge-label">${esc(e.label)}</text><circle r="4" fill="#07b8ac" class="packet"><animateMotion dur="${4 / speed}s" begin="-${i * 0.7}s" repeatCount="indefinite"><mpath href="#edge${i}"/></animateMotion></circle>`;
    })
    .join(
      "",
    )}${f.nodes.map((n, i) => `<g class="flow-node ${activeNode === n.id ? "selected" : ""}" data-node="${esc(n.id)}" role="button" tabindex="0" aria-label="${esc(n.label)}"><title>${esc(n.label)} — ${esc(n.detail)}</title><rect x="${positions[i].x}" y="${positions[i].y}" width="180" height="100" rx="12"/><defs><clipPath id="flow-clip-${i}"><rect x="${positions[i].x + 16}" y="${positions[i].y + 8}" width="148" height="82"/></clipPath></defs><g clip-path="url(#flow-clip-${i})"><text data-fit-width="144" x="${positions[i].x + 18}" y="${positions[i].y + 27}" class="node-number">${esc(n.language || n.kind || String(i + 1))}</text><text data-fit-width="144" x="${positions[i].x + 18}" y="${positions[i].y + 53}" class="node-title">${esc(n.label)}</text><text data-fit-width="144" x="${positions[i].x + 18}" y="${positions[i].y + 78}" class="node-detail">${esc(n.detail || "설명 추가")}</text></g></g>`).join("")}</svg></div>`;
}
function usageView() {
  const local = data.claudeActivity;
  return `<div class="section-toolbar"><div class="info-banner compact">${icon("ai")}구독 잔여량과 API 비용을 한눈에 확인하세요.</div><button class="button primary" id="sync-usage">${icon("refresh")} 사용량 새로고침</button></div><div class="usage-grid">${[
    "Claude",
    "Codex",
    "Cursor",
  ]
    .map((name, i) => {
      const state = providerState(name),
        archived = data.usage[name],
        u = state.state === "paused" ? null : archived;
      return card(
        `<span class="provider p${i}">${name[0]}</span> ${name}`,
        `<div class="usage-detail"><div class="between">${badge(state.label, state.state === "connected" ? "green" : "gray")}${u && isStale(u) ? badge("재확인 필요", "amber") : ""}</div><p class="subscription-label">${esc(subscriptionLabel(name) || "구독 플랜 미기록")}</p><strong>${u ? `${Math.round(u.remaining)}<small>% 남음</small>` : state.state === "paused" ? '<small class="paused-title">유료 일시 중단</small>' : "—"}</strong>${u ? `<div class="meter"><span style="width:${u.remaining}%"></span></div><p>${esc(u.window)} · ${usageSource(u)}</p>` : ""}${startupBenefit(name)}${compactApiUsage(name)}<details class="usage-disclosure"><summary>자세히 보기 <span>연결 상태 · 관리</span></summary><div class="usage-expanded">${u?.windows?.length ? `<div class="quota-windows">${u.windows.map((w) => `<div><strong>${esc(w.label)}</strong><span>${Math.round(w.remaining)}% 남음</span><small>${w.resetAt ? date(w.resetAt) + " 초기화" : esc(w.resetLabel || "초기화 시각 미제공")}</small></div>`).join("")}</div>` : ""}<div class="provider-diagnosis"><strong>연결 진단</strong>${name === "Claude" && data.integrationStatus?.Claude?.accountEmail ? `<p>로그인 계정: ${esc(data.integrationStatus.Claude.accountEmail)} · ${esc(data.integrationStatus.Claude.subscriptionType || "플랜 미확인")}</p>` : ""}<p>${esc(state.reason || state.error || "연결 상태를 갱신해 주세요.")}</p>${name === "Claude" && state.state === "login_required" ? '<code class="code-block">claude auth login</code>' : ""}${name === "Claude" && state.state === "setup_required" ? '<code class="code-block">npm run connect:claude</code>' : ""}${name === "Claude" && data.integrationStatus?.Claude?.collectionMethod !== "claude_cli" ? `<small>${data.integrationStatus?.Claude?.collectorConfigured ? "한도 수집기 연결됨" : "한도 수집기 미설정"} · 새 응답 이후 수신 · API 키 계정은 구독 한도와 별도</small>` : ""}</div><dl><dt>한도 확인 시각</dt><dd>${date(u?.updatedAt)}</dd><dt>진단 시각</dt><dd>${date(data.integrationStatus?.[name]?.checkedAt)}</dd><dt>갱신 방식</dt><dd>${name === "Codex" ? "5분마다 공식 CLI 조회" : name === "Claude" ? (data.integrationStatus?.Claude?.collectionMethod === "claude_cli" ? "5분마다 공식 CLI 조회" : "새 응답 수신 · 5분마다 반영") : "개인 계정 CSV / 직접 기록"}</dd></dl>${state.state === "paused" && archived ? `<p class="muted">이전 한도 기록 ${date(archived.updatedAt)} · 현재 잔여량으로 표시하지 않습니다.</p>` : ""}<div class="provider-actions"><button class="button" data-subscription="${name}">구독 상태 편집</button><button class="button" data-usage="${name}">한도 직접 기록</button>${name !== "Codex" ? `<a class="button" href="${name === "Claude" ? "https://claude.ai/settings/usage" : "https://cursor.com/dashboard/usage"}" target="_blank" rel="noopener noreferrer">공식 사용량 화면</a>` : ""}</div></div></details></div>`,
      );
    })
    .join(
      "",
    )}</div><details class="usage-records"><summary>상세 사용 기록 <span>Cursor CSV · Claude 로컬 토큰</span></summary>${cursorUsagePanel()}${card("Claude Code · 최근 7일 로컬 토큰 기록", local?.projects.length ? `<div class="table-wrap"><table><thead><tr><th>프로젝트</th><th>입력</th><th>출력</th><th>캐시 읽기</th><th>캐시 생성</th><th>메시지</th></tr></thead><tbody>${local.projects.map((p) => `<tr><td>${esc(p.project)}</td><td>${fmt(p.input)}</td><td>${fmt(p.output)}</td><td>${fmt(p.cacheRead)}</td><td>${fmt(p.cacheWrite)}</td><td>${fmt(p.messages)}</td></tr>`).join("")}</tbody></table></div>` : empty(local?.available ? "집계 가능한 최근 사용 기록이 없어요" : "로컬 사용 기록 미연결", "Claude Code 로그의 토큰 메타데이터만 집계합니다. 계정 잔여 한도와 별도입니다."), `<span class="muted">${date(local?.updatedAt)}</span>`)}</details><p class="card-note">대화 내용·인증 토큰은 수집기에 저장하지 않습니다. 구독 상태는 직접 입력한 관리 정보이며 실제 결제를 변경하지 않습니다.</p>`;
}
function cursorUsagePanel() {
  const value = data.cursorActivity;
  return card(
    "Cursor 개인 계정 · 사용량 기록",
    `<div class="settings-body"><div class="between"><p>공식 사용량 화면에서 내보낸 이벤트 CSV를 가져옵니다. 원본·이메일·대화 ID는 보관하지 않고 모델별 수치만 집계합니다.</p><label class="button">CSV 가져오기<input class="csv-input" id="cursor-csv" type="file" accept=".csv,text/csv" aria-label="Cursor 사용량 CSV 가져오기"></label></div>${value ? `<p>${date(value.period.start)} — ${date(value.period.end)} · ${fmt(value.events)}개 이벤트 · ${date(value.updatedAt)} 가져옴</p><div class="table-wrap"><table><thead><tr><th>모델</th><th>이벤트</th><th>토큰</th><th>CSV 기재 비용</th></tr></thead><tbody>${value.models.map((v) => `<tr><td>${esc(v.model)}</td><td>${fmt(v.events)}</td><td>${v.tokenRows ? fmt(v.tokens) : "미제공"}</td><td>${v.costRows ? "$" + v.costUsd.toFixed(4) : "미제공"}</td></tr>`).join("")}</tbody></table></div><p class="muted">${esc(value.scope)} · 제외한 행 ${value.skipped}개 · 원본 CSV를 다시 가져오면 기존 집계를 대체합니다.</p>` : empty("아직 가져온 사용량 CSV가 없어요", "Ultra를 사용하던 기간의 기록도 가져올 수 있어요. CSV로 잔여 한도를 추정하지 않습니다.")}</div>`,
  );
}
function activityItems() {
  return [
    ...data.activity.map((a) => ({ ...a, kind: "관리 기록" })),
    ...data.projects.flatMap((p) => [
      ...(p.deployment?.updatedAt
        ? [
            {
              date: p.deployment.updatedAt,
              text: `배포 조회 · ${p.deployment.state}`,
              project: p.name,
              kind: "배포 조회",
            },
          ]
        : []),
      ...(p.health?.http?.checkedAt
        ? [
            {
              date: p.health.http.checkedAt,
              text: `로컬 HTTP 점검 · ${p.health.http.results.length}개 포트`,
              project: p.name,
              kind: "HTTP 점검",
            },
          ]
        : []),
    ]),
    ...data.projects.flatMap((p) =>
      p.commits.map((c) => ({
        date: c.date,
        text: c.subject,
        project: p.name,
        hash: c.hash,
        kind: "Git 커밋",
      })),
    ),
  ].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}
function activityView() {
  return card(
    "최근 작업 내역",
    `<div class="activity-list">${
      activityItems()
        .slice(0, 70)
        .map(
          (a) =>
            `<article><span class="timeline-dot"></span><div><strong>${esc(a.text)}</strong><p>${esc(a.project || "Manage-A")} ${a.hash ? `<code>${esc(a.hash)}</code>` : ""} ${badge(a.kind)}</p></div><time>${date(a.date)}</time></article>`,
        )
        .join("") ||
      empty(
        "아직 기록이 없어요",
        "프로젝트 정보를 편집하거나 Git 커밋이 생기면 표시됩니다.",
      )
    }</div>`,
  );
}
function mockStats() {
  return {
    demo: true,
    updatedAt: new Date().toISOString(),
    days,
    ga: {
      totals: [12480, 24860, 16840],
      series: Array.from({ length: days }, (_, i) => ({
        dimensionValues: [{ value: `${i + 1}일` }],
        metricValues: [
          { value: String(Math.round(260 + i * 7 + Math.sin(i * 1.5) * 90)) },
        ],
      })),
      channels: [
        ["Organic Search", 540],
        ["Direct", 260],
        ["Referral", 200],
      ].map(([v, n]) => ({
        dimensionValues: [{ value: v }],
        metricValues: [{ value: n }],
      })),
      pages: [
        ["/", 5240],
        ["/features", 2180],
        ["/guide", 1460],
      ].map(([v, n]) => ({
        dimensionValues: [{ value: v }],
        metricValues: [{ value: n }],
      })),
    },
    search: {
      totals: { clicks: 1326, impressions: 42800, ctr: 0.031, position: 12.4 },
      queries: [
        { keys: ["프로젝트 관리"], clicks: 426, impressions: 12400 },
        { keys: ["운영 기록"], clicks: 312, impressions: 8600 },
        { keys: ["개발 대시보드"], clicks: 188, impressions: 5200 },
      ],
    },
    errors: [],
  };
}
function lineChart(rows) {
  if (!rows.length)
    return empty(
      "표시할 방문 데이터가 없어요",
      "선택한 기간에 수집된 데이터가 없습니다.",
    );
  const vals = rows.map((r) => Number(r.metricValues[0].value));
  const max = Math.max(...vals, 1) * 1.15;
  const coords = vals
    .map(
      (v, i) =>
        `${45 + (i * 650) / Math.max(vals.length - 1, 1)},${210 - (v / max) * 170}`,
    )
    .join(" ");
  return `<svg class="line-chart" viewBox="0 0 740 250" role="img" aria-label="기간별 방문자 추이">${[0, 1, 2, 3].map((i) => `<line x1="45" x2="695" y1="${210 - i * 55}" y2="${210 - i * 55}" stroke="#e8eef0"/><text x="0" y="${214 - i * 55}">${fmt(Math.round((max * i) / 3))}</text>`).join("")}<polygon points="45,210 ${coords} 695,210" fill="#e2f4f1"/><polyline points="${coords}" fill="none" stroke="#069c93" stroke-width="3"/>${vals
    .filter((_, i) => i % Math.max(1, Math.floor(vals.length / 8)) === 0)
    .map((v, i) => "")
    .join(
      "",
    )}<text x="45" y="242">${esc(rows[0].dimensionValues[0].value)}</text><text x="620" y="242">${esc(rows.at(-1).dimensionValues[0].value)}</text></svg>`;
}
function analyticsView() {
  const p = project();
  const s = demo ? mockStats() : stats;
  return `<div class="section-toolbar">${selector()}${!data.googleConnected ? '<button class="button" id="connect-google">Google로 연결</button>' : '<button class="button" id="google-assets">통계 속성 찾기</button>'}<select id="days" aria-label="통계 기간">${[7, 28, 90].map((d) => `<option value="${d}" ${days === d ? "selected" : ""}>지난 ${d}일</option>`).join("")}</select><button class="button primary" id="fetch-stats">${icon("refresh")} 통계 가져오기</button><label class="demo-toggle"><input type="checkbox" id="demo" ${demo ? "checked" : ""}> 예시 데이터 보기</label>${demo ? badge("예시 데이터 · 실제 수치 아님", "amber") : ""}</div>${s?.errors?.length ? `<div class="warning">${s.errors.map(esc).join("<br>")}</div>` : ""}${
    !s
      ? card(
          "방문과 검색 데이터",
          empty(
            data.googleConnected
              ? "통계 데이터를 가져와 주세요"
              : p?.gaProperty || p?.searchSite
                ? "Google 읽기 권한을 연결해 주세요"
                : "통계를 연결해 주세요",
            data.googleConnected
              ? "통계 가져오기를 눌러 실제 데이터 수신을 확인하세요. 필요한 Google API가 활성화되어 있어야 합니다."
              : "Google로 연결에서 통계 읽기 권한을 승인하고, 프로젝트의 속성을 선택한 뒤 통계 가져오기를 누르세요.",
            `<button class="button" data-edit="${esc(p?.id || "")}">프로젝트 통계 연결</button>`,
          ),
        )
      : metrics([
          [
            "방문자",
            s.ga ? fmt(s.ga.totals[0]) : "—",
            "GA4 활성 사용자",
            "users",
          ],
          [
            "조회 수",
            s.ga ? fmt(s.ga.totals[1]) : "—",
            "GA4 페이지 / 화면 조회",
            "screen",
          ],
          [
            "검색 클릭",
            s.search ? fmt(s.search.totals.clicks) : "—",
            "Search Console",
            "search",
          ],
          [
            "검색 노출",
            s.search ? fmt(s.search.totals.impressions) : "—",
            "Search Console",
            "chart",
          ],
        ]) +
        `<div class="analytics-grid">${card("방문자 추이", s.ga ? lineChart(s.ga.series) : empty("GA4 미연결", "프로젝트에 GA4 속성 ID를 등록하세요."))}${card(
          "유입 경로",
          s.ga
            ? `<div class="channel-list">${s.ga.channels
                .map((r) => {
                  const total = s.ga.channels.reduce(
                    (a, r) => a + Number(r.metricValues[0].value),
                    0,
                  );
                  const n = Number(r.metricValues[0].value),
                    percent = Math.round((n / (total || 1)) * 100);
                  return `<div><div class="between"><span>${esc(r.dimensionValues[0].value)}</span><strong>${percent}%</strong></div><div class="meter"><span style="width:${percent}%"></span></div><small>${fmt(n)} 세션 · 상위 경로 내 비중</small></div>`;
                })
                .join("")}</div>`
            : empty(
                "유입 데이터 없음",
                "GA4를 연결하면 유입 경로를 볼 수 있어요.",
              ),
        )}</div><div class="analytics-grid">${card("검색어 성과", s.search ? `<div class="table-wrap"><table><thead><tr><th>검색어</th><th>클릭</th><th>노출</th></tr></thead><tbody>${s.search.queries.map((r) => `<tr><td>${esc(r.keys[0])}</td><td>${fmt(r.clicks)}</td><td>${fmt(r.impressions)}</td></tr>`).join("") || '<tr><td colspan="3">선택한 기간의 검색어 데이터가 없어요.</td></tr>'}</tbody></table></div><p class="card-note">클릭률 ${(s.search.totals.ctr * 100).toFixed(1)}% · 평균 게재순위 ${s.search.totals.impressions > 0 ? Number(s.search.totals.position).toFixed(1) : "—"}<br>검색어는 Google이 제공하는 상위 항목이며 전체 합계와 다를 수 있어요.</p>` : empty("Search Console 미연결", "사이트 속성을 등록하세요."))}${card("인기 페이지", s.ga ? `<div class="table-wrap"><table><thead><tr><th>페이지</th><th>조회 수</th></tr></thead><tbody>${s.ga.pages.map((r) => `<tr><td>${esc(r.dimensionValues[0].value)}</td><td>${fmt(r.metricValues[0].value)}</td></tr>`).join("")}</tbody></table></div>` : empty("페이지 데이터 없음", "GA4 연결이 필요해요."))}</div><p class="muted">${demo ? "예시 데이터" : `마지막 조회 ${date(s.updatedAt)}`} · 검색 데이터는 지연을 고려해 3일 전까지 조회합니다.</p>`
  }${analyticsConnectionPanel(p)}${seoPanel(p)}`;
}
function seoPanel(p) {
  const seo = p?.inventory?.seo;
  const row = (label, files) =>
    `<div class="seo-check"><div><strong>${label}</strong><small>${files?.length ? files.map(esc).join(", ") : "탐색 범위 내 미발견"}</small></div>${badge(files?.length ? "파일 발견" : "확인 필요", files?.length ? "green" : "amber")}</div>`;
  return card(
    "SEO 코드 점검",
    `<div class="seo-grid"><div><h3>검색 파일</h3>${row("사이트맵", seo?.sitemap)}${row("robots", seo?.robots)}</div><div><h3>페이지 메타 정보</h3>${seo?.indexFile ? `<p>${esc(seo.indexFile)} 정적 HTML 기준</p><div class="seo-check"><span>페이지 제목</span>${badge(seo.title ? "태그 발견" : "확인 필요", seo.title ? "green" : "amber")}</div><div class="seo-check"><span>메타 설명</span>${badge(seo.description ? "태그 발견" : "확인 필요", seo.description ? "green" : "amber")}</div>` : `${row("레이아웃 / head 파일", seo?.metaFiles)}<p>동적 메타 정보는 코드 검토가 필요해요.</p>`}<p>${p?.inventory?.bounded ? "탐색 상한에 도달해 일부 파일이 포함되지 않을 수 있어요. " : ""}${seo?.noindex ? "이 페이지에는 noindex가 설정되어 있습니다. " : ""}파일 발견은 배포·색인 정상 여부를 의미하지 않습니다. 검색 색인과 성능은 아직 자동 진단하지 않아요.</p></div><div><h3>통계 연결</h3><p>${esc(p?.gaProperty ? `GA4 ${p.gaProperty}` : "GA4 미등록")}<br>${esc(p?.searchSite || "Search Console 미등록")}</p><button class="button" data-edit="${esc(p?.id || "")}">연결 정보 편집</button></div></div>`,
  );
}
function settingsView() {
  return `${profileCard()}${connectionCenter()}${analyticsMatrix()}<div class="settings-grid">${card("실행과 접근", `<div class="settings-body">${badge(data.mode === "local" ? "로컬 전용으로 실행 중" : "인증된 웹 모드", "green")}<h3>기본은 내 컴퓨터에서만</h3><p>현재 로컬 서버는 기본적으로 127.0.0.1에만 열립니다. 계정 정보와 관리 데이터는 이 기기에 보관됩니다.</p><h3>다른 기기에서 보고 싶을 때</h3><p>가장 간단한 방법은 SSH 터널입니다. 원격 모드에는 16자 이상의 비밀번호와 접속 주소 설정이 필요하며 HTTPS 프록시와 함께 사용하세요.</p><code class="code-block">ssh -L 4310:127.0.0.1:4310 사용자@내컴퓨터</code><p class="muted">외부 공개는 자동으로 켜지지 않습니다. 상세 설정은 README를 확인하세요.</p></div>`)}${card("Google 통계 연결", `<div class="settings-body">${badge(data.googleConnected ? (data.googleAuthStatus?.method === "oauth" ? "Google 로그인 완료" : "인증 파일 등록") : "Google 미연결", data.googleConnected ? "green" : "gray")}<ol><li>Google Cloud에서 Analytics Data API, Analytics Admin API, Search Console API를 활성화하세요.</li><li>‘Google로 연결’에서 OAuth 클라이언트 JSON 경로를 지정하고 통계 읽기 권한을 승인하세요.</li><li>방문·검색에서 프로젝트를 고른 뒤 ‘통계 속성 찾기’로 해당 프로젝트의 속성을 선택하세요.</li><li>‘통계 가져오기’를 눌러 실제 수신을 확인하세요. 로그인 완료와 데이터 수신은 별도로 표시됩니다.</li></ol><p class="muted">기존 서비스 계정은 연결 창의 ‘서비스 계정 파일로 연결’에서 설정할 수 있어요. 인증 토큰과 키 내용은 브라우저로 보내지 않습니다.</p><button class="button primary" id="connect-google">${data.googleConnected ? "Google 연결 변경" : "Google로 연결"}</button> <button class="button" data-nav="analytics">방문·검색 열기</button></div>`)}${card("프로젝트 수집", `<div class="settings-body"><h3>자동으로 읽는 정보</h3><p>프로젝트 폴더, package.json, README, Git 브랜치와 최근 커밋, 변경 파일 수를 읽습니다. .env와 비밀 키는 수집하지 않습니다.</p><h3>직접 관리하는 정보</h3><p>운영 상태, 주요 기능, 설명, 연결 구조와 통계 속성 ID는 프로젝트 편집에서 관리하세요.</p><button class="button" id="refresh">${icon("refresh")} 프로젝트 다시 읽기</button></div>`)}${card("비용과 데이터", `<div class="settings-body"><h3>로컬 실행에 호스팅 비용이 들지 않아요</h3><p>별도 패키지 설치 없이 Node.js로 실행합니다. 외부 API와 원격 호스팅의 요금·할당량은 해당 계정의 조건을 따릅니다.</p><h3>로컬 보관</h3><p>직접 입력한 데이터는 .local/settings.json에 저장되며 Git에서 제외됩니다. 백업은 해당 파일을 안전한 위치에 복사하세요.</p><button class="button" id="export">${icon("download")} 관리 정보 JSON 내보내기</button></div>`)}</div>`;
}
function bind() {
  $("#google-assets")?.addEventListener("click", selectGoogleAssets);
  document
    .querySelectorAll("[data-api-connect]")
    .forEach(
      (button) =>
        (button.onclick = () => connectApiUsage(button.dataset.apiConnect)),
    );
  document.querySelectorAll("[data-guide]").forEach(
    (el) =>
      (el.onclick = () => {
        helpFocus = el.dataset.guide || "";
        helpQuery = "";
        navigate("help");
      }),
  );
  $("#help-search")?.addEventListener("input", (event) => {
    helpQuery = event.target.value;
    const pos = event.target.selectionStart;
    render();
    $("#help-search").focus();
    $("#help-search").setSelectionRange(pos, pos);
  });
  document
    .querySelectorAll("[data-subscription]")
    .forEach(
      (el) => (el.onclick = () => editSubscription(el.dataset.subscription)),
    );
  $("#cursor-csv")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.disabled = true;
    try {
      if (file.size > 768 * 1024)
        throw new Error("CSV는 768KiB 이하로 가져오세요.");
      await api("/api/cursor/import", {
        method: "POST",
        body: JSON.stringify({ csv: await file.text() }),
      });
      await load();
      toast("Cursor CSV를 집계했어요. 잔여 한도와 별도인 기록입니다.");
    } catch (error) {
      toast(error.message);
      event.target.disabled = false;
      event.target.value = "";
    }
  });
  document.querySelectorAll("[data-attention-view]").forEach(
    (el) =>
      (el.onclick = () => {
        if (el.dataset.attentionProject) {
          selected = el.dataset.attentionProject;
          sessionStorage.setItem("selectedProject", selected);
          impactFile = "";
          impactInspect = "";
          routeFile = "";
          stats = null;
        }
        navigate(el.dataset.attentionView);
      }),
  );
  document.querySelectorAll("[data-health-project]").forEach(
    (el) =>
      (el.onclick = () => {
        selected = el.dataset.healthProject;
        sessionStorage.setItem("selectedProject", selected);
        render();
      }),
  );
  document.querySelectorAll("[data-impact-source]").forEach(
    (el) =>
      (el.onclick = () => {
        impactFile = el.dataset.impactSource;
        impactInspect = "";
        render();
      }),
  );
  document.querySelectorAll("[data-impact-inspect]").forEach((el) => {
    el.onclick = () => {
      impactInspect = el.dataset.impactInspect;
      render();
    };
    if (el.tagName.toLowerCase() === "g")
      el.onkeydown = (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          el.onclick();
        }
      };
  });
  document.querySelectorAll("[data-impact-route]").forEach(
    (el) =>
      (el.onclick = () => {
        routeFile = el.dataset.impactRoute;
        flowMode = "architecture";
        activeNode = "api";
        navigate("flow");
      }),
  );
  $("#impact-search")?.addEventListener("input", (event) => {
    impactQuery = event.target.value;
    const pos = event.target.selectionStart;
    render();
    $("#impact-search").focus();
    $("#impact-search").setSelectionRange(pos, pos);
  });
  $("#impact-changed")?.addEventListener("change", (event) => {
    impactChangedOnly = event.target.checked;
    render();
  });
  $("#impact-file-select")?.addEventListener("change", (event) => {
    impactFile = event.target.value;
    impactInspect = "";
    render();
  });
  document
    .querySelectorAll("[data-verification]")
    .forEach(
      (el) => (el.onclick = () => recordVerification(el.dataset.verification)),
    );
  $("#check-health")?.addEventListener("click", async (event) => {
    const btn = event.currentTarget;
    btn.disabled = true;
    btn.textContent = "HTTP 점검 중…";
    try {
      const result = await api(
        `/api/projects/${encodeURIComponent(selected)}/health`,
        { method: "POST", body: "{}" },
      );
      await load();
      toast(
        result.results.length
          ? "로컬 HTTP 응답을 확인했어요"
          : "점검 가능한 로컬 주소가 없어요",
      );
    } catch (error) {
      toast(error.message);
      btn.disabled = false;
      btn.textContent = "다시 점검";
    }
  });
  $("#check-open")?.addEventListener("click", async (event) => {
    const btn = event.currentTarget;
    const targets = data.projects.filter((p) =>
      p.localPorts?.some((v) => v.reachable && v.owned !== false),
    );
    if (!targets.length) return toast("응답 중인 로컬 프로젝트가 없어요");
    btn.disabled = true;
    try {
      for (let i = 0; i < targets.length; i++) {
        btn.textContent = `HTTP 점검 ${i + 1}/${targets.length}`;
        await api(`/api/projects/${encodeURIComponent(targets[i].id)}/health`, {
          method: "POST",
          body: "{}",
        });
      }
      await load();
      toast(`${targets.length}개 프로젝트 HTTP 점검을 마쳤어요`);
    } catch (error) {
      toast(error.message);
      btn.disabled = false;
      btn.textContent = "열린 로컬 서버 점검";
    }
  });
  $("#logout")?.addEventListener("click", async () => {
    try {
      await api("/api/logout", { method: "POST", body: "{}" });
      data = null;
      boot();
    } catch (e) {
      toast(e.message);
    }
  });
  document.querySelectorAll("[data-filter]").forEach(
    (el) =>
      (el.onclick = () => {
        projectFilter = el.dataset.filter;
        render();
      }),
  );
  document.querySelectorAll("[data-flow-mode]").forEach(
    (el) =>
      (el.onclick = () => {
        flowMode = el.dataset.flowMode;
        activeNode = "";
        render();
      }),
  );
  document.querySelectorAll("[data-analytics-project]").forEach(
    (el) =>
      (el.onclick = () => {
        selected = el.dataset.analyticsProject;
        sessionStorage.setItem("selectedProject", selected);
        stats = null;
        demo = false;
        navigate("analytics");
      }),
  );
  $("#route-select")?.addEventListener("change", (e) => {
    routeFile = e.target.value;
    flowMode = "architecture";
    activeNode = routeFile ? "api" : "";
    render();
  });
  $("#sync-usage")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = "공식 한도 조회 중…";
    try {
      const result = await api("/api/usage/sync", {
        method: "POST",
        body: "{}",
      });
      await load();
      toast("서비스별 연결 진단과 수신 기록을 갱신했어요");
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
      btn.textContent = "실제 사용량 갱신";
    }
  });
  $("#fetch-deployment")?.addEventListener("click", async (e) => {
    const button = e.currentTarget;
    button.disabled = true;
    try {
      await api(`/api/projects/${encodeURIComponent(selected)}/deployment`, {
        method: "POST",
        body: "{}",
      });
      await load();
      toast("Vercel 배포 상태를 갱신했어요");
    } catch (err) {
      toast(err.message);
      button.disabled = false;
    }
  });
  $("#connect-google")?.addEventListener("click", connectGoogle);
  $("#profile-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const button = e.target.querySelector("button");
    button.disabled = true;
    try {
      await api("/api/profile", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(e.target))),
      });
      await load();
      toast("사용자명을 저장했어요");
    } catch (err) {
      toast(err.message);
      button.disabled = false;
    }
  });

  $("#map-prev")?.addEventListener("click", () => {
    mapPage--;
    render();
  });
  $("#map-next")?.addEventListener("click", () => {
    mapPage++;
    render();
  });
  document
    .querySelectorAll("[data-nav]")
    .forEach((el) => (el.onclick = () => navigate(el.dataset.nav)));
  document.querySelectorAll("[data-project]").forEach(
    (el) =>
      (el.onclick = () => {
        selected = el.dataset.project;
        sessionStorage.setItem("selectedProject", selected);
        routeFile = "";
        activeNode = "";
        stats = null;
        demo = false;
        requestId++;
        navigate("flow");
      }),
  );
  document
    .querySelectorAll("[data-edit]")
    .forEach((el) => (el.onclick = () => editProject(el.dataset.edit)));
  document
    .querySelectorAll("[data-usage]")
    .forEach((el) => (el.onclick = () => editUsage(el.dataset.usage)));
  document.querySelectorAll("[data-node]").forEach((el) => {
    el.onclick = () => {
      activeNode = el.dataset.node;
      render();
    };
    el.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        el.click();
      }
    };
  });
  document.querySelectorAll("#refresh").forEach(
    (el) =>
      (el.onclick = async () => {
        el.disabled = true;
        try {
          await api("/api/refresh", { method: "POST", body: "{}" });
          await load();
          toast("프로젝트 현황을 다시 읽었어요");
        } catch (e) {
          toast(e.message);
          el.disabled = false;
        }
      }),
  );
  $("#project-select")?.addEventListener("change", (e) => {
    selected = e.target.value;
    sessionStorage.setItem("selectedProject", selected);
    routeFile = "";
    impactFile = "";
    impactInspect = "";
    impactQuery = "";
    stats = null;
    demo = false;
    requestId++;
    render();
    if (view === "analytics") loadCachedStats();
  });
  $("#search")?.addEventListener("input", (e) => {
    query = e.target.value;
    const pos = e.target.selectionStart;
    render();
    $("#search").focus();
    $("#search").setSelectionRange(pos, pos);
  });
  $("#pause")?.addEventListener("click", () => {
    paused = !paused;
    render();
  });
  $("#speed")?.addEventListener("change", (e) => {
    speed = Number(e.target.value);
    render();
  });
  document
    .querySelectorAll("#edit-flow")
    .forEach((el) => (el.onclick = editFlow));
  $("#days")?.addEventListener("change", (e) => {
    days = Number(e.target.value);
    stats = null;
    requestId++;
    render();
    if (!demo) loadCachedStats();
  });
  $("#demo")?.addEventListener("change", (e) => {
    demo = e.target.checked;
    render();
  });
  $("#fetch-stats")?.addEventListener("click", fetchStats);
  $("#export")?.addEventListener("click", () => {
    const payload = {
      projects: data.projects.map(
        ({
          id,
          name,
          description,
          status,
          website,
          features,
          flow,
          gaProperty,
          searchSite,
        }) => ({
          id,
          name,
          description,
          status,
          website,
          features,
          flow,
          gaProperty,
          searchSite,
        }),
      ),
      usage: data.usage,
      activity: data.activity,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "manage-a-management.json";
    a.click();
    URL.revokeObjectURL(url);
    toast("관리 정보를 내보냈어요. 파일을 안전하게 보관하세요");
  });
  if (paused || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.querySelector(".flow-canvas svg")?.pauseAnimations();
  }
}
function navigate(v) {
  view = nav.some((n) => n[0] === v) ? v : "overview";
  location.hash = view;
  render();
  if (v === "analytics" && !stats && !demo) loadCachedStats();
  window.scrollTo(0, 0);
}
function recordVerification(kind) {
  const p = project();
  showModal(
    `${kind === "build" ? "빌드" : "테스트"} 결과 기록`,
    `<form id="verification-form"><p class="muted">${esc(p.name)}에서 직접 확인한 결과를 기록합니다. Manage-A가 명령을 실행하거나 결과를 자동 검증하지는 않습니다.</p><label class="field">결과<select name="result"><option value="passed">통과</option><option value="failed">실패</option></select></label>${field("검증한 시각", "checkedAt", localTime(new Date().toISOString()), "", "datetime-local")}<label class="field">검증 메모<textarea name="note" maxlength="300" rows="3" placeholder="실행한 명령과 확인한 범위를 적어 주세요."></textarea></label><p class="form-error" role="alert"></p><div class="modal-actions"><button class="button primary">결과 기록 저장</button></div></form>`,
  );
  $("#verification-form").onsubmit = async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.target));
    body.kind = kind;
    body.checkedAt = body.checkedAt
      ? new Date(body.checkedAt).toISOString()
      : "";
    await saveForm(
      event.target,
      `/api/projects/${encodeURIComponent(p.id)}/verification`,
      body,
    );
  };
}
function editSubscription(provider) {
  const s = data.subscriptions?.[provider] || {
    status: "unknown",
    plan: "",
    note: "",
    historical: false,
  };
  showModal(
    `${provider} 구독 상태`,
    `<form id="subscription-form"><p class="muted">대시보드 표시용 관리 정보입니다. 결제·해지·플랜 변경은 실행하지 않습니다.</p>${field("플랜 이름", "plan", s.plan, "예: Ultra, Max, Pro")}<label class="field">구독 상태<select name="status">${Object.entries(
      {
        active: "사용 중",
        paused: "유료 일시 중단",
        free: "무료 사용",
        unknown: "상태 미확인",
      },
    )
      .map(
        ([key, value]) =>
          `<option value="${key}" ${s.status === key ? "selected" : ""}>${value}</option>`,
      )
      .join(
        "",
      )}</select></label><label class="demo-toggle"><input name="historical" type="checkbox" ${s.historical ? "checked" : ""}>플랜 이름을 과거 사용 이력으로 표시</label>${provider === "Claude" ? `<label class="field">스타트업 Team 혜택<select name="startupBenefit"><option value="none" ${s.startupBenefit !== "claimed" ? "selected" : ""}>미기록</option><option value="claimed" ${s.startupBenefit === "claimed" ? "selected" : ""}>수령 · 12개월 · 월 최대 $625 할인</option></select></label>` : ""}${field("메모", "note", s.note)}<p class="form-error" role="alert"></p><div class="modal-actions"><button class="button primary">구독 상태 저장</button></div></form>`,
  );
  $("#subscription-form").onsubmit = async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.target));
    values.provider = provider;
    values.historical = event.target.elements.historical.checked;
    await saveForm(event.target, "/api/subscriptions", values);
  };
}
function showModal(title, content) {
  const d = $("#modal");
  d.innerHTML = `<div class="modal-head"><h2>${title}</h2><button class="icon-button" id="close-modal" aria-label="닫기">${icon("close")}</button></div>${content}`;
  d.showModal();
  $("#close-modal").onclick = () => d.close();
}
const field = (label, name, value = "", placeholder = "", type = "text") =>
  `<label class="field">${label}<input name="${name}" type="${type}" value="${esc(value)}" placeholder="${placeholder}"></label>`;
function editProject(id) {
  const p = data.projects.find((p) => p.id === id);
  if (!p) return;
  showModal(
    "프로젝트 정보",
    `<form id="project-form">${field("프로젝트 이름", "name", p.name)}<label class="field">설명<textarea name="description" rows="2">${esc(p.description)}</textarea></label><div class="form-grid"><label class="field">운영 상태<select name="status">${Object.entries(
      labels,
    )
      .map(
        ([v, l]) =>
          `<option value="${v}" ${p.status === v ? "selected" : ""}>${l}</option>`,
      )
      .join(
        "",
      )}</select></label>${field("운영 사이트 주소", "website", p.website, "https://example.com", "url")}</div><h3>운영 사이트 확인 기록</h3><p class="muted">직접 확인한 상태입니다. 로컬 응답·Vercel 조회와 별도로 기록합니다.</p><label class="field">운영 사이트 상태<select name="siteState">${Object.entries(
      {
        unknown: "미확인",
        available: "직접 확인 · 운영 중",
        unavailable: "직접 확인 · 확인 필요",
      },
    )
      .map(
        ([key, label]) =>
          `<option value="${key}" ${(p.site?.state || "unknown") === key ? "selected" : ""}>${label}</option>`,
      )
      .join(
        "",
      )}</select></label>${field("운영 확인 메모", "siteNote", p.site?.note || "", "확인한 범위를 적어 주세요.")}<label class="field">주요 기능 · 한 줄에 하나<textarea name="features" rows="3">${esc(p.features.join("\n"))}</textarea></label><h3>방문·검색 통계 연결</h3><div class="form-grid">${field("GA4 속성 ID", "gaProperty", p.gaProperty, "예: 123456789")}${field("Search Console 속성", "searchSite", p.searchSite, "sc-domain:example.com")}</div><p class="muted">연결한 Google 계정에 해당 속성의 읽기 권한이 있어야 실제 조회됩니다.</p><p class="form-error" role="alert"></p><div class="modal-actions"><button type="button" class="button" id="cancel">취소</button><button class="button primary">저장</button></div></form>`,
  );
  $("#cancel").onclick = () => $("#modal").close();
  $("#project-form").onsubmit = async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target));
    b.features = b.features
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    await saveForm(e.target, `/api/projects/${encodeURIComponent(id)}`, b);
  };
}
function editUsage(name) {
  const u = data.usage[name];
  showModal(
    `${name} 사용량 기록`,
    `<form id="usage-form"><p class="muted">서비스의 사용량 화면에서 직접 확인한 값을 입력하세요. 자동 조회 수치로 표시되지 않습니다.</p>${field("남은 사용량 (%)", "remaining", u?.remaining ?? "", "0~100", "number")}${field("한도 구간 / 메모", "window", u?.window || "", "예: 주간 한도 또는 5시간 한도")}${field("초기화 예정 시각 · 선택", "resetAt", u?.resetAt ? localTime(u.resetAt) : "", "", "datetime-local")}<p class="form-error" role="alert"></p><div class="modal-actions"><button class="button primary">기록 저장</button></div></form>`,
  );
  $("#usage-form").onsubmit = async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target));
    b.provider = name;
    b.resetAt = b.resetAt ? new Date(b.resetAt).toISOString() : "";
    await saveForm(e.target, "/api/usage", b);
  };
}
function localTime(s) {
  const d = new Date(s);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
function editFlow() {
  const p = project();
  let draft = structuredClone(p.flow || defaultFlow(p));
  const capture = () => {
    document.querySelectorAll("[data-edit-node]").forEach((el) => {
      const n = draft.nodes[Number(el.dataset.editNode)];
      if (n) n[el.dataset.field] = el.value;
    });
    document.querySelectorAll("[data-edit-edge]").forEach((el) => {
      const e = draft.edges[Number(el.dataset.editEdge)];
      if (e) e[el.dataset.field] = el.value;
    });
  };
  const draw = () => {
    showModal(
      "흐름 단계와 연결 편집",
      `<form id="flow-form"><p class="muted">이름과 설명을 적고, 어디서 어디로 이어지는지 선택하세요. 저장 전에는 기존 구조가 유지됩니다.</p><div class="editor-toolbar"><strong>단계 ${draft.nodes.length}/12</strong><button type="button" class="button" id="add-flow-node">${icon("plus")} 단계 추가</button></div><div class="flow-edit-nodes">${draft.nodes.map((n, i) => `<div class="flow-edit-row"><input aria-label="${i + 1}단계 이름" data-edit-node="${i}" data-field="label" value="${esc(n.label)}" maxlength="80" required><input aria-label="${i + 1}단계 설명" data-edit-node="${i}" data-field="detail" value="${esc(n.detail || "")}" placeholder="이 단계에서 하는 일" maxlength="200"><button class="icon-button" type="button" data-remove-node="${i}" aria-label="${i + 1}단계 삭제">${icon("close")}</button></div>`).join("")}</div><div class="editor-toolbar"><strong>연결 ${draft.edges.length}/24</strong><button type="button" class="button" id="add-flow-edge">${icon("plus")} 연결 추가</button></div>${draft.edges.map((e, i) => `<div class="flow-edge-row">${["from", "to"].map((key) => `<select aria-label="연결 ${i + 1} ${key === "from" ? "시작" : "도착"}" data-edit-edge="${i}" data-field="${key}">${draft.nodes.map((n) => `<option value="${esc(n.id)}" ${n.id === e[key] ? "selected" : ""}>${esc(n.label)}</option>`).join("")}</select>`).join("")}<input aria-label="연결 ${i + 1} 설명" data-edit-edge="${i}" data-field="label" value="${esc(e.label)}" placeholder="요청, 저장 등" maxlength="80"><button type="button" class="icon-button" data-remove-edge="${i}" aria-label="연결 ${i + 1} 삭제">${icon("close")}</button></div>`).join("")}<p class="form-error" role="alert"></p><div class="modal-actions"><button type="button" class="button" id="cancel-flow">취소</button><button type="submit" class="button primary">구조 저장</button></div></form>`,
    );
    $("#cancel-flow").onclick = () => $("#modal").close();
    $("#add-flow-node").onclick = () => {
      capture();
      if (draft.nodes.length >= 12)
        return toast("최대 12개 단계까지 추가할 수 있어요");
      draft.nodes.push({
        id: "step_" + Date.now(),
        label: "새 단계",
        detail: "",
      });
      draw();
    };
    $("#add-flow-edge").onclick = () => {
      capture();
      if (draft.edges.length >= 24 || draft.nodes.length < 2)
        return toast("단계 2개 이상, 연결은 최대 24개까지 가능해요");
      draft.edges.push({
        from: draft.nodes[0].id,
        to: draft.nodes[1].id,
        label: "연결",
      });
      draw();
    };
    document.querySelectorAll("[data-remove-node]").forEach(
      (el) =>
        (el.onclick = () => {
          capture();
          if (draft.nodes.length < 2) return toast("최소 한 단계가 필요해요");
          const n = draft.nodes.splice(Number(el.dataset.removeNode), 1)[0];
          draft.edges = draft.edges.filter(
            (e) => e.from !== n.id && e.to !== n.id,
          );
          draw();
        }),
    );
    document.querySelectorAll("[data-remove-edge]").forEach(
      (el) =>
        (el.onclick = () => {
          capture();
          draft.edges.splice(Number(el.dataset.removeEdge), 1);
          draw();
        }),
    );
    $("#flow-form").onsubmit = async (e) => {
      e.preventDefault();
      capture();
      flowMode = "custom";
      activeNode = "";
      await saveForm(e.target, `/api/projects/${encodeURIComponent(p.id)}`, {
        flow: draft,
      });
    };
  };
  draw();
}
async function saveForm(form, url, b) {
  const button = form.querySelector('button[type="submit"],button.primary');
  button.disabled = true;
  try {
    await api(url, { method: "POST", body: JSON.stringify(b) });
    $("#modal").close();
    if ("gaProperty" in b || "searchSite" in b) {
      stats = null;
      demo = false;
      requestId++;
    }
    await load();
    if (view === "analytics" && !stats && !demo) loadCachedStats();
    toast("저장했어요");
  } catch (e) {
    form.querySelector(".form-error").textContent = e.message;
  } finally {
    button.disabled = false;
  }
}
async function fetchStats() {
  const p = project();
  if (!p) return;
  const id = ++requestId,
    projectId = selected,
    period = days;
  const btn = $("#fetch-stats");
  btn.disabled = true;
  btn.textContent = "가져오는 중…";
  try {
    const result = await api(
      `/api/projects/${encodeURIComponent(projectId)}/analytics?days=${period}`,
    );
    if (id !== requestId) return;
    stats = result;
    demo = false;
    data = await api("/api/dashboard");
    if (id !== requestId) return;
    render();
    toast(
      result.errors.length
        ? "일부 데이터를 가져오지 못했어요"
        : "통계 조회를 완료했어요",
    );
  } catch (e) {
    toast(e.message);
  } finally {
    if (document.contains(btn)) {
      btn.disabled = false;
      btn.textContent = "통계 가져오기";
    }
  }
}
async function boot() {
  try {
    const session = await api("/api/session");
    if (!session.authenticated) {
      $("#app").innerHTML =
        `<div class="login"><img class="manage-logo" src="/logo.svg" alt=""><h1>Manage-A</h1><p>프로젝트 관제에 로그인하세요.</p><form id="login-form"><label class="field">비밀번호<input name="password" type="password" required autocomplete="current-password"></label><p class="form-error" role="alert"></p><button class="button primary">로그인</button></form></div>`;
      $("#login-form").onsubmit = async (e) => {
        e.preventDefault();
        try {
          await api("/api/login", {
            method: "POST",
            body: JSON.stringify(Object.fromEntries(new FormData(e.target))),
          });
          await load();
        } catch (err) {
          e.target.querySelector(".form-error").textContent = err.message;
        }
      };
      return;
    }
    view = location.hash.slice(1) || "overview";
    if (!nav.some((n) => n[0] === view)) view = "overview";
    await load();
    if (view === "analytics") loadCachedStats();
  } catch (e) {
    $("#app").innerHTML =
      `<div class="loading"><h2>대시보드를 불러오지 못했어요</h2><p>${esc(e.message)}</p><button class="button" id="retry">다시 시도</button></div>`;
    $("#retry").onclick = boot;
  }
}
setInterval(async () => {
  if (
    !data ||
    document.hidden ||
    $("#modal").open ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)
  )
    return;
  try {
    data = await api("/api/dashboard");
    render();
  } catch {}
}, 60000);
window.addEventListener("hashchange", () => {
  if (data) {
    const v = location.hash.slice(1);
    if (nav.some((n) => n[0] === v) && v !== view) {
      view = v;
      render();
    }
  }
});
boot();

async function loadCachedStats() {
  const id = ++requestId,
    p = selected,
    period = days;
  try {
    const result = await api(
      `/api/projects/${encodeURIComponent(p)}/analytics?days=${period}&cached=1`,
    );
    if (id === requestId && !demo) {
      stats = result;
      render();
    }
  } catch {}
}
function connectGoogle() {
  showModal(
    "Google 통계 연결",
    `<form id="oauth-form"><p>Google 계정으로 Analytics·Search Console 읽기 권한을 연결합니다. 인증 토큰은 이 컴퓨터에만 보관합니다.</p>${field("OAuth 클라이언트 JSON 절대 경로", "clientPath", "", "/Users/사용자/Downloads/client_secret.json")}<p class="form-error" role="alert"></p><div class="modal-actions"><button class="button primary">Google 로그인 열기</button></div></form><details><summary>서비스 계정 파일로 연결</summary><button class="button" id="google-service">기존 서비스 계정 연결</button></details>`,
  );
  $("#google-service").onclick = connectGoogleService;
  $("#oauth-form").onsubmit = async (e) => {
    e.preventDefault();
    const button = e.target.querySelector("button");
    button.disabled = true;
    try {
      const result = await api("/api/connections/google/oauth/start", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(e.target))),
      });
      showModal(
        "Google 권한 승인",
        `<p>공식 Google 화면에서 통계 읽기 권한을 승인하세요.</p><a class="button primary" href="${esc(result.authorizationUrl)}" target="_blank" rel="noopener noreferrer">Google 승인 화면 열기</a><button class="button" id="google-confirm">연결 확인</button>`,
      );
      $("#google-confirm").onclick = async () => {
        const status = await api("/api/connections/google/status");
        if (status.state !== "connected") {
          toast(status.reason || "Google 승인을 기다리고 있어요.");
          return;
        }
        $("#modal").close();
        await load();
        await selectGoogleAssets();
      };
    } catch (error) {
      e.target.querySelector(".form-error").textContent = error.message;
      button.disabled = false;
    }
  };
}
function connectGoogleService() {
  showModal(
    "Google 통계 연결",
    `<form id="google-form"><p class="muted">이 컴퓨터에 보관한 서비스 계정 JSON 파일의 경로를 입력하세요. 파일 내용과 키는 브라우저로 전송하지 않습니다.</p>${field("인증 파일 절대 경로", "credentialPath", "", "/Users/사용자/private/service-account.json")}<p class="form-error" role="alert"></p><div class="modal-actions"><button class="button primary">인증 파일 연결</button></div></form>`,
  );
  $("#google-form").onsubmit = async (e) => {
    e.preventDefault();
    await saveForm(
      e.target,
      "/api/connections/google",
      Object.fromEntries(new FormData(e.target)),
    );
  };
}

function attentionPanel() {
  const items = attentionItems(data);
  return `<div class="tasks">${
    items
      .slice(0, 6)
      .map(
        (item) =>
          `<button data-attention-view="${item.view}" data-attention-project="${esc(item.project || "")}"><span class="task-dot ${item.priority === 0 ? "red" : item.priority === 1 ? "amber" : "blue"}"></span><div><strong>${esc(item.title)}</strong><small>${esc(item.detail)}</small></div>${icon("arrow")}</button>`,
      )
      .join("") ||
    '<p class="card-note">현재 수집된 정보에서 확인할 항목이 없어요.</p>'
  }</div>${items.length > 6 ? `<p class="card-note">추가 ${items.length - 6}개 항목은 상태 점검과 변경 영향에서 확인하세요.</p>` : ""}`;
}

function verificationBadge(p, kind) {
  const v = p.health?.verification?.[kind];
  if (!v) return badge("결과 미등록");
  const current =
    v.workspaceStamp === p.workspaceStamp &&
    fresh(v.checkedAt, Date.now(), 86400000);
  return badge(
    `${v.result === "passed" ? "통과 기록" : "실패 기록"}${current ? "" : " · 재확인"}`,
    current ? (v.result === "passed" ? "green" : "red") : "gray",
  );
}

function healthView() {
  const p = project();
  if (!p) return empty("프로젝트가 없어요", "프로젝트 폴더를 확인하세요.");
  const http = p.health?.http;
  const statuses = data.projects.map((v) => summarizeHealth(v));
  return `${data.healthAutoError ? `<div class="warning">${esc(data.healthAutoError)}</div>` : ""}${data.storage && data.storage.freeBytes < 512 * 1024 * 1024 ? `<div class="warning">디스크 여유 공간이 ${Math.round(data.storage.freeBytes / 1024 / 1024)}MB입니다. 기록을 저장하지 못할 수 있으니 공간을 확인하세요.</div>` : ""}<div class="section-toolbar">${selector()}<button class="button primary" id="check-health">${icon("refresh")} 이 프로젝트 로컬 점검</button><button class="button" id="check-open">열린 로컬 서버 점검</button></div>
    <p class="muted">자동 점검: ${data.healthAutoEnabled ? "5분마다 소유 프로젝트가 확인된 열린 포트" : "꺼짐"} · 마지막 실행 ${date(data.healthSweep?.checkedAt)} (${data.healthSweep?.projectsChecked ?? 0}개).<br>수동 점검은 발견한 로컬 포트의 <code>GET /</code> 응답만 확인합니다. 다른 프로젝트의 포트와 외부 URL은 제외하며 리디렉션을 따라가지 않습니다.</p>
    ${metrics([
      [
        "로컬 HTTP 응답 확인",
        statuses.filter((v) => v.state === "ok").length,
        "최근 15분 점검 기준",
        "check",
      ],
      [
        "로컬 응답 문제",
        statuses.filter((v) => v.state === "error").length,
        "운영 사이트 장애 판정과 별개",
        "log",
      ],
      [
        "로컬 응답 검토",
        statuses.filter((v) => v.state === "review").length,
        "인증 · 리디렉션 응답",
        "lock",
      ],
      [
        "미점검 · 재점검",
        statuses.filter((v) => v.state === "unknown").length,
        "미실행 앱도 포함됩니다",
        "refresh",
      ],
    ])}
    ${card("운영 사이트", `<div class="production-panel"><div>${siteBadge(p)}<h3>${esc(p.website || "운영 주소를 등록해 주세요")}</h3><p>${esc(p.site?.note || "운영 확인 기록은 직접 입력합니다. 아래 로컬 개발 서버 결과로 운영 사이트의 장애를 판단하지 않습니다.")}</p><small>직접 기록 ${date(p.site?.updatedAt)} · 자동 운영 점검 아님</small></div><div class="provider-actions">${p.website ? `<a class="button primary" href="${esc(p.website)}" target="_blank" rel="noopener noreferrer">운영 사이트 열기</a>` : ""}<button class="button" data-edit="${esc(p.id)}">운영 주소·확인 기록 편집</button></div></div>`)}
    <div class="info-banner">${icon("screen")}아래 HTTP 결과는 내 컴퓨터의 개발 서버입니다. 운영 사이트·Vercel 조회·빌드·테스트 결과와 각각 구분해 보세요.</div>
    ${card(
      `${esc(p.name)} 로컬 점검과 검증 기록`,
      `<div class="health-evidence"><section><h3>로컬 HTTP</h3>${http?.results?.length ? http.results.map((v) => `<div class="probe-result">${badge(v.status ? `HTTP ${v.status}` : v.state === "timeout" ? "시간 초과" : "연결 실패", fresh(v.checkedAt) ? (v.state === "ok" ? "green" : ["protected", "redirect", "route_missing"].includes(v.state) ? "amber" : "red") : "gray")}<span>:${v.port} / · ${v.latencyMs}ms</span>${v.reason ? `<small>${esc(v.reason)}</small>` : ""}${v.state === "route_missing" ? "<small>루트 페이지가 없어요. API·앱 기능은 별도 확인하세요.</small>" : ""}<small>${date(v.checkedAt)}${fresh(v.checkedAt) ? "" : " · 재점검 필요"}</small></div>`).join("") : `<p>${http ? "점검 가능한 로컬 주소가 없어요." : "HTTP 응답을 아직 확인하지 않았어요."}</p>`}<p class="muted">${http?.mode === "automatic_open_ports" ? "자동 · 열린 소유 포트만 확인. " : ""}페이지 응답 확인만으로 DB 연결이나 모든 기능의 정상 동작을 보장하지 않습니다.</p>${http?.excluded?.length ? `<p class="muted">제외: ${http.excluded.map((v) => `:${v.port} ${esc(v.ownerProject || "다른 프로젝트")}`).join(", ")}</p>` : ""}</section>
    <section><h3>Vercel 배포 정보 조회</h3>${deploymentBadge(p)}<p>${esc(p.deployment?.error || p.deployment?.source || "배포 정보 조회 기록 없음")}</p><small>${date(p.deployment?.updatedAt)}${p.deployment?.updatedAt && !fresh(p.deployment.updatedAt, Date.now(), 86400000) ? " · 이전 기록" : ""}</small>${p.deployment?.url ? `<a class="text-button" href="${esc(p.deployment.url)}" target="_blank" rel="noopener noreferrer">배포 열기</a>` : ""}</section>
    ${["build", "test"]
      .map((kind) => {
        const v = p.health?.verification?.[kind];
        return `<section><h3>${kind === "build" ? "빌드" : "테스트"}</h3>${verificationBadge(p, kind)}<p>${v ? esc(v.note || "메모 없음") : "최근 결과를 직접 기록할 수 있어요."}</p><small>${v ? `${date(v.checkedAt)} · 직접 입력` : "프로젝트 명령은 자동 실행하지 않습니다."}</small>${v && v.workspaceStamp !== p.workspaceStamp ? '<p class="muted">기록한 이후 코드 또는 작업 상태가 달라졌어요.</p>' : ""}<button class="text-button" data-verification="${kind}">결과 기록</button></section>`;
      })
      .join("")}</div>`,
    )}
    ${card(
      "전체 프로젝트 상태",
      `<div class="table-wrap"><table class="health-table"><thead><tr><th>프로젝트</th><th>운영 사이트</th><th>로컬 HTTP 점검</th><th>배포 정보 조회</th><th>빌드</th><th>테스트</th><th>최근 HTTP 점검</th></tr></thead><tbody>${data.projects
        .map((v) => {
          const h = summarizeHealth(v);
          return `<tr class="${v.id === selected ? "selected-row" : ""}"><td><button class="project-name" data-health-project="${esc(v.id)}">${esc(v.name)}</button></td><td>${siteBadge(v)}</td><td>${badge(h.label, h.state === "ok" ? "green" : h.state === "error" ? "red" : h.state === "review" ? "amber" : "gray")}</td><td>${deploymentBadge(v)}</td><td>${verificationBadge(v, "build")}</td><td>${verificationBadge(v, "test")}</td><td>${date(v.health?.http?.checkedAt)}</td></tr>`;
        })
        .join("")}</tbody></table></div>`,
    )} `;
}

function impactView() {
  const p = project();
  if (!p) return empty("프로젝트가 없어요", "프로젝트 폴더를 확인하세요.");
  const index = p.inventory?.impact || {
    files: [],
    edges: [],
    coverage: { analyzed: 0, total: 0 },
  };
  const changed = new Set(
    (p.changedFiles || []).flatMap((v) => [v.file, v.previous].filter(Boolean)),
  );
  const files = [...index.files];
  for (const name of changed)
    if (!files.some((v) => v.path === name))
      files.push({ path: name, language: "파일", analyzed: false });
  if (!files.length)
    return `${selector()}${card("변경 영향", empty("분석할 소스 파일이 없어요", "지원하는 소스 파일이 발견되면 코드 참조를 추적합니다."))}`;
  if (!files.some((v) => v.path === impactFile)) {
    const scores = new Map();
    for (const e of index.edges) scores.set(e.to, (scores.get(e.to) || 0) + 1);
    const candidates = files.filter((v) => changed.has(v.path) && v.analyzed);
    impactFile = [...(candidates.length ? candidates : files)].sort(
      (a, b) => (scores.get(b.path) || 0) - (scores.get(a.path) || 0),
    )[0].path;
    impactInspect = "";
  }
  const impact = analyzeImpact(p.inventory, impactFile);
  const inspected = impact.dependents.find((v) => v.path === impactInspect);
  const filtered = files.filter(
    (f) =>
      (!impactChangedOnly || changed.has(f.path)) &&
      f.path.toLowerCase().includes(impactQuery.toLowerCase()),
  );
  return `<div class="section-toolbar">${selector()}${badge(`${p.changes}개 Git 변경`, p.changes ? "amber" : "gray")}<button class="button" data-attention-view="flow" data-attention-project="${esc(p.id)}">전체 구조 보기</button></div>
    <div class="impact-layout"><aside class="impact-files"><div class="impact-file-head"><h2>기준 파일</h2><label class="search">${icon("search")}<input id="impact-search" aria-label="소스 파일 검색" placeholder="파일 이름 검색" value="${esc(impactQuery)}"></label><label class="demo-toggle"><input id="impact-changed" type="checkbox" ${impactChangedOnly ? "checked" : ""}>Git 변경 파일만</label><p>${filtered.length}개 표시 · ${index.coverage.analyzed}/${index.coverage.total}개 JS·TS 계열 분석${p.changes > p.changedFiles.length ? `<br>Git 변경 목록은 ${p.changedFiles.length}/${p.changes}개 포함` : ""}</p><select class="impact-file-select" id="impact-file-select" aria-label="기준 소스 파일 선택"><option value="${esc(impactFile)}" selected>${esc(impactFile)}</option>${filtered
      .filter((f) => f.path !== impactFile)
      .map(
        (f) =>
          `<option value="${esc(f.path)}">${esc(f.path)}${changed.has(f.path) ? " · 변경" : ""}</option>`,
      )
      .join("")}</select></div><div class="impact-file-list">${
      filtered
        .slice(0, 180)
        .map(
          (f) =>
            `<button data-impact-source="${esc(f.path)}" class="${f.path === impactFile ? "active" : ""}" title="${esc(f.path)}"><span>${icon(f.kind === "page" ? "screen" : f.kind === "api" ? "code" : "folder")}${esc(f.path)}</span><small>${esc(f.language)}${changed.has(f.path) ? " · 변경" : ""}${f.analyzed ? "" : " · 미분석"}</small></button>`,
        )
        .join("") || '<p class="card-note">조건에 맞는 파일이 없어요.</p>'
    }${filtered.length > 180 ? '<p class="card-note">이름 검색으로 범위를 좁혀 주세요.</p>' : ""}</div></aside>
    <div class="impact-main">${card("이 파일을 바꾸면 확인할 곳", `<div class="impact-selected"><code>${esc(impactFile)}</code>${badge(changed.has(impactFile) ? "Git 변경" : "선택 파일", changed.has(impactFile) ? "amber" : "gray")}</div><div class="impact-counts"><div><strong>${impact.direct.length}</strong><span>직접 참조</span></div><div><strong>${impact.dependents.length - impact.direct.length}</strong><span>간접 참조</span></div><div><strong>${impact.pages.length}</strong><span>연결된 화면</span></div><div><strong>${impact.routes.length}</strong><span>연결된 API</span></div></div>${impactSvg(impact)}<p class="card-note">화살표는 변경 영향의 탐색 방향입니다. 실제 import 방향의 역순이며, 실행 중 호출이나 오류 발생을 의미하지 않습니다.</p>${impact.bounded ? '<div class="warning">탐색 상한에 도달해 일부 연결이 빠질 수 있어요.</div>' : ""}${!impact.selected.analyzed ? '<div class="warning">기준 파일은 미분석 상태입니다. 삭제·지원하지 않는 언어·파일 크기 제한 등을 확인하세요. 다른 파일에서 발견한 참조만 표시할 수 있어요.</div>' : ""}`)}
    <div class="impact-details">${card("영향을 검토할 화면과 API", `<div class="settings-body">${impact.pages.map((v) => `<div class="impact-endpoint">${icon("screen")}<code>${esc(v)}</code></div>`).join("")}${impact.routes.map((r) => `<button class="impact-endpoint" data-impact-route="${esc(r.key || r.file)}">${badge(r.methods.join("/") || "API", "green")}<code>${esc(r.endpoint)}</code>${icon("arrow")}</button>`).join("")}${!impact.pages.length && !impact.routes.length ? '<p class="muted">탐색 범위에서 연결된 화면이나 API를 찾지 못했어요. 영향이 없다고 단정할 수는 없습니다.</p>' : ""}</div>`)}
    ${card(
      "참조 경로",
      `<div class="settings-body">${inspected ? `<h3>${esc(inspected.path)}</h3><ol class="impact-chain">${inspected.chain.map((path) => `<li><code>${esc(path)}</code></li>`).join("")}</ol><p class="muted">아래 파일이 바로 위 파일을 참조합니다. 최단 경로 한 개를 표시합니다.</p>` : '<p class="muted">아래 참조 파일을 누르면 기준 파일까지의 경로를 볼 수 있어요.</p>'}<div class="impact-consumers">${
        impact.dependents
          .slice(0, 100)
          .map(
            (v) =>
              `<button data-impact-inspect="${esc(v.path)}" class="${v.path === impactInspect ? "active" : ""}"><code>${esc(v.path)}</code><span>${v.distance === 1 ? "직접" : `${v.distance}단계 간접`}</span></button>`,
          )
          .join("") || "<p>발견한 참조 파일이 없어요.</p>"
      }</div>${impact.dependents.length > 100 ? `<p class="muted">상위 100개 표시 / 총 ${impact.dependents.length}개</p>` : ""}<details><summary>기준 파일이 직접 참조하는 파일 ${impact.dependencies.length}개</summary>${impact.dependencies.map((v) => `<code class="code-block">${esc(v)}</code>`).join("")}</details></div>`,
    )}</div></div></div>
    <p class="muted">JS·TS·Vue·Svelte의 정적 import/require와 상대 경로·@/ 별칭을 분석합니다. 동적 로딩, 사용자 정의 별칭, 네트워크 호출, Python·Swift 연결은 포함하지 않습니다. 코드 참조는 변경 영향의 검토 근거이며 확정된 실행 순서가 아닙니다.</p>`;
}

function impactSvg(impact) {
  const direct = impact.direct.slice(0, 4),
    indirect = impact.dependents.filter((v) => v.distance > 1).slice(0, 4);
  const nodes = [
    { path: impactFile, x: 20, y: 145, source: true },
    ...direct.map((v, i) => ({ ...v, x: 295, y: 55 + i * 83 })),
    ...indirect.map((v, i) => ({ ...v, x: 570, y: 55 + i * 83 })),
  ];
  const box = (n, i) => {
    const label = n.path.split("/").at(-1);
    const parentPath =
      n.path.split("/").slice(0, -1).join("/") || "프로젝트 루트";
    return `<g role="button" tabindex="0" data-impact-inspect="${esc(n.path)}" aria-label="참조 경로 ${esc(n.path)}" class="impact-graph-node ${n.source ? "source" : ""} ${n.path === impactInspect ? "selected" : ""}"><title>${esc(n.path)}</title><rect x="${n.x}" y="${n.y}" width="190" height="58" rx="8"/><defs><clipPath id="impact-clip-${i}"><rect x="${n.x + 11}" y="${n.y + 6}" width="168" height="47"/></clipPath></defs><g clip-path="url(#impact-clip-${i})"><text data-fit-width="166" x="${n.x + 12}" y="${n.y + 23}">${esc(label)}</text><text data-fit-width="166" class="impact-path" x="${n.x + 12}" y="${n.y + 43}">${n.source ? "기준 파일" : esc(parentPath)}</text></g></g>`;
  };
  return `<div class="impact-graph"><svg viewBox="0 0 780 405" role="img" aria-label="선택 파일을 참조하는 파일의 변경 영향 지도"><defs><marker id="impact-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 10 5 0 10z" fill="#598e96"/></marker></defs><text class="impact-lane" x="20" y="24">변경 기준</text><text class="impact-lane" x="295" y="24">직접 참조 ${impact.direct.length}개</text><text class="impact-lane" x="570" y="24">간접 참조 ${impact.dependents.length - impact.direct.length}개</text>${nodes
    .filter((n) => !n.source)
    .map((n) => {
      const parent = nodes.find((v) => v.path === n.chain?.at(-2)) || nodes[0];
      return `<path d="M${parent.x + 190} ${parent.y + 29} C${parent.x + 230} ${parent.y + 29},${n.x - 40} ${n.y + 29},${n.x} ${n.y + 29}" stroke="#95b9bf" stroke-width="1.5" fill="none" ${n.distance > 1 ? 'stroke-dasharray="5 5"' : ""} marker-end="url(#impact-arrow)"/>`;
    })
    .join(
      "",
    )}${nodes.map(box).join("")}${!impact.dependents.length ? '<text class="impact-lane" x="295" y="174">탐색 범위에서 참조하는 파일 미발견</text>' : ""}<text class="impact-lane" x="20" y="392">각 열 최대 4개 · 점선은 간접 참조 경로 요약 · 전체 목록은 아래에서 확인</text></svg></div>`;
}

function analyticsConnectionPanel(p) {
  if (!p) return "";
  const last = data.analyticsAttempts?.[p.id],
    snapshot = data.analyticsSummaries?.find((v) => v.project === p.id);
  return card(
    "실데이터 연결 확인",
    `<div class="connection-steps"><div>${badge(data.googleConnected ? (data.googleAuthStatus?.method === "oauth" ? "Google 로그인 완료" : "인증 파일 등록") : data.googleAuthStatus?.state === "waiting" ? "승인 대기" : "미연결", data.googleConnected ? "green" : "gray")}<strong>Google 계정 인증</strong><p>속성 권한은 실제 조회 시 확인합니다.</p><button class="text-button" data-nav="settings">인증 설정</button></div><div>${badge(p.gaProperty || p.searchSite ? "속성 등록" : "미등록", p.gaProperty || p.searchSite ? "green" : "gray")}<strong>프로젝트 속성</strong><p>${esc(p.gaProperty ? `GA4 ${p.gaProperty}` : "GA4 미등록")}<br>${esc(p.searchSite || "Search Console 미등록")}</p><button class="text-button" data-edit="${esc(p.id)}">속성 편집</button></div><div>${badge(last?.ga || last?.search ? "최근 조회 수신" : last ? "수신 없음" : "미조회", last?.ga || last?.search ? "green" : "gray")}<strong>실제 데이터 수신</strong><p>${last ? `최근 시도 ${date(last.checkedAt)}` : "통계 가져오기를 눌러 권한과 수신을 확인하세요."}${snapshot ? `<br>마지막 수신 ${date(snapshot.updatedAt)}` : ""}</p>${last?.errors?.length ? `<p class="connection-error">${last.errors.map(esc).join("<br>")}</p>` : ""}</div></div><p class="card-note">인증 경로와 속성 등록만으로 연결 성공으로 표시하지 않습니다. 예시 데이터는 이 연결 상태에 반영하지 않습니다.</p>`,
  );
}

function analyticsMatrix() {
  return card(
    "프로젝트별 통계 연결",
    `<div class="table-wrap"><table><thead><tr><th>프로젝트</th><th>GA4 속성</th><th>검색 속성</th><th>최근 수신</th><th></th></tr></thead><tbody>${data.projects
      .map((p) => {
        const v = data.analyticsAttempts?.[p.id];
        return `<tr><td>${esc(p.name)}</td><td>${p.gaProperty ? esc(p.gaProperty) : badge("미등록")}</td><td>${p.searchSite ? esc(p.searchSite) : badge("미등록")}</td><td>${v ? `${v.ga ? "GA4 수신" : "GA4 없음"} / ${v.search ? "검색 수신" : "검색 없음"}<small class="block-muted">${date(v.checkedAt)}</small>` : "미조회"}</td><td><button class="text-button" data-analytics-project="${esc(p.id)}">연결 확인</button></td></tr>`;
      })
      .join("")}</tbody></table></div>`,
  );
}

function connectionCenter() {
  const status = data.integrationStatus || {},
    verified = data.projects.filter(
      (p) => p.deployment?.state === "READY",
    ).length,
    blocked = data.projects.filter(
      (p) => p.deployment?.state === "UNAVAILABLE",
    ).length;
  return card(
    "데이터 연결 현황",
    `<div class="connection-grid">${[
      [
        "Codex",
        status.Codex?.state === "connected"
          ? "자동 조회 연결"
          : "연결 확인 필요",
        "로그인된 CLI · 5분마다 한도 갱신",
        status.Codex?.state === "connected",
      ],
      [
        "Claude",
        providerState("Claude").label,
        providerState("Claude").reason || "공식 상태줄에서 한도 수신",
        providerState("Claude").state === "connected",
      ],
      [
        "Cursor",
        providerState("Cursor").label,
        subscriptionLabel("Cursor") || "개인 계정 CSV / 직접 기록",
        false,
      ],
      [
        "Google",
        data.googleConnected
          ? data.googleAuthStatus?.method === "oauth"
            ? "Google 로그인 연결"
            : "인증 파일 등록"
          : data.googleAuthStatus?.state === "waiting"
            ? "Google 승인 대기"
            : "Google 미연결",
        "프로젝트별 GA4 · Search Console 권한 필요",
        data.googleConnected,
      ],
      [
        "Vercel",
        `${verified}개 조회 / ${blocked}개 확인 필요`,
        data.vercelTokenConfigured
          ? "API 토큰 설정됨 / 버튼으로 갱신"
          : "공식 스냅샷 보관 / 자동 API 토큰 미설정",
        verified > 0,
      ],
    ]
      .map(
        ([name, label, detail, connected]) =>
          `<div><strong>${name}</strong>${badge(label, connected ? "green" : "gray")}<p>${detail}</p></div>`,
      )
      .join("")}</div>`,
  );
}

function profileCard() {
  return card(
    "내 워크스페이스",
    `<form id="profile-form" class="profile-form"><label class="field">사용자명<input name="displayName" aria-label="사용자명" value="${esc(data.profile?.displayName || "사용자")}" maxlength="40" required autocomplete="nickname"></label><button class="button primary" type="submit">저장</button><p>첫 화면 인사와 워크스페이스 이름에 사용합니다.</p></form>`,
  );
}
function helpView() {
  const result = searchHelp(helpQuery),
    focused = helpTopics.find((v) => v.id === helpFocus);
  const article = (v, open = false) =>
    `<details class="help-topic" ${open ? "open" : ""}><summary><span><small>${esc(v.category)}</small><strong>${esc(v.title)}</strong><span>${esc(v.summary)}</span></span>${icon("arrow")}</summary><div class="help-topic-body"><ol>${v.steps.map((step) => `<li>${esc(step)}</li>`).join("")}</ol><button class="button" data-nav="${v.action}">${esc(v.actionLabel)}</button></div></details>`;
  return `<div class="help-intro"><h2>개발 용어를 모두 알 필요는 없어요.</h2><p>Manage-A는 프로젝트 정보를 모아 보여주는 관리 화면입니다. 매일은 아래 세 곳만 보고, 구조와 변경 영향은 개발 작업을 검토할 때 열어 보세요.</p><div class="help-shortcuts"><button data-nav="overview">${icon("home")}<strong>전체 현황</strong><span>개요에서 오늘 확인할 일 찾기</span></button><button data-nav="health">${icon("cloud")}<strong>운영 사이트</strong><span>실제 서비스 주소와 로컬 서버 구분하기</span></button><button data-nav="usage">${icon("ai")}<strong>AI 사용량</strong><span>구독·한도·연결 상태 확인하기</span></button></div></div>${focused && !helpQuery ? card("방금 보던 화면 읽는 법", article(focused, true)) : ""}<div class="help-search-row"><label class="search-box">${icon("search")}<input id="help-search" aria-label="사용설명서 검색" placeholder="예: 운영 사이트, 500, Claude, 미연결" value="${esc(helpQuery)}"></label><span class="muted">설명 ${result.topics.length}개 · 질문 ${result.faqs.length}개 · 용어 ${result.terms.length}개</span></div>${card("화면별 사용법", result.topics.length ? result.topics.map((v) => article(v, !!helpQuery || (!helpFocus && v.id === "start"))).join("") : empty("찾는 설명이 없어요", "다른 단어나 메뉴 이름으로 검색해 보세요."))}${card("자주 헷갈리는 표시", `<div class="help-faqs">${result.faqs.map(([q, a]) => `<details ${helpQuery ? "open" : ""}><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("") || '<p class="card-note">검색에 맞는 질문이 없어요.</p>'}</div>`)}${card("필요할 때 찾아보는 용어", `<dl class="help-terms">${result.terms.map(([term, meaning]) => `<div><dt>${esc(term)}</dt><dd>${esc(meaning)}</dd></div>`).join("") || '<p class="card-note">검색에 맞는 용어가 없어요.</p>'}</dl>`)}`;
}

function apiUsagePanel() {
  return ["Claude", "OpenAI"]
    .map((provider) => {
      const value = data.apiUsage?.[provider],
        url =
          provider === "Claude"
            ? "https://platform.claude.com/settings/admin-keys"
            : "https://platform.openai.com/settings/organization/admin-keys";
      return card(
        `${provider} API · 구독과 별도`,
        `<div class="settings-body"><p>${provider === "OpenAI" ? "Codex 구독 잔여 한도는 위 카드에서 자동 조회합니다. 이 영역은 별도 OpenAI API 조직 보고서입니다." : "Claude 구독과 별도인 API 조직 보고서입니다."}</p>${value?.state === "connected" ? `<p>${esc(value.scope)}</p><div class="quota-windows"><div><strong>API 비용</strong><span>$${value.costUsd.toFixed(4)}</span></div><div><strong>입력 / 출력 토큰</strong><span>${fmt(value.input)} / ${fmt(value.output)}</span></div><div><strong>캐시 읽기</strong><span>${fmt(value.cacheRead)}</span></div></div><p>${date(value.period.start)} — ${date(value.period.end)}</p>` : `<p>${esc(value?.reason || "API 사용량 미연결 · 0으로 표시하지 않습니다.")}</p>`}<p class="muted">${date(value?.checkedAt)} 조회 · 연결 후 5분마다 자동 갱신 · 개인 이메일별 집계가 아닙니다.</p><button class="button primary" data-api-connect="${provider}">${value?.state === "connected" ? "연결 키 변경" : "API 자동 연동"}</button> <a class="button" href="${url}" target="_blank" rel="noopener noreferrer">공식 Admin 키 설정</a></div>`,
      );
    })
    .join("");
}
function connectApiUsage(provider) {
  showModal(
    `${provider} API 자동 연동`,
    `<form id="api-connect-form"><p>조직 사용량 조회용 Admin 키를 입력하세요. 해당 서비스의 공식 보고서 API로 검증한 후 이 컴퓨터에만 저장합니다. 일반 모델 호출 키와 구독 로그인은 별도입니다.</p><label>Admin 키<input name="key" type="password" autocomplete="off" required maxlength="4096"></label><p class="muted">로컬 파일 .local/api-credentials.json에 소유자 전용 권한으로 저장합니다. 원격 모드에서는 연결할 수 없습니다.</p><p class="form-error" role="alert"></p><div class="modal-actions"><button class="button primary">검증하고 자동 연동</button></div></form>`,
  );
  $("#api-connect-form").onsubmit = async (e) => {
    e.preventDefault();
    await saveForm(e.target, "/api/connections/api-usage", {
      provider,
      key: new FormData(e.target).get("key"),
    });
  };
}

function compactApiUsage(name) {
  const provider = name === "Codex" ? "OpenAI" : name,
    value = data.apiUsage?.[provider];
  if (name === "Cursor")
    return `<div class="api-inline"><div class="between"><strong>추가 사용 비용</strong><span class="muted">CSV 기록</span></div><p class="api-inline-empty">${data.cursorActivity ? `${fmt(data.cursorActivity.events)}개 사용 기록 · 상세 기록에서 확인` : "사용량 CSV를 가져오면 확인할 수 있어요"}</p></div>`;
  return `<div class="api-inline"><div class="between"><strong>API 사용량${name === "Codex" ? " · OpenAI" : ""}</strong>${badge(value?.state === "connected" ? "자동 연동" : value?.state === "error" ? "연결 확인 필요" : "미연결", value?.state === "connected" ? "green" : "gray")}</div>${value?.state === "connected" ? `<div class="api-inline-metrics"><div><span>최근 7일 비용</span><strong>$${value.costUsd.toFixed(2)}</strong></div><div><span>입력 / 출력 토큰</span><strong>${fmt(value.input)} / ${fmt(value.output)}</strong></div></div><p class="muted">완료된 UTC 7일 · 조직 전체</p>` : `<div class="api-inline-empty"><span>비용·토큰 확인</span><button class="button" data-api-connect="${provider}">API 연결</button></div>`}<details class="api-context"><summary>API 집계 안내${value?.state === "connected" ? " · 연결 관리" : ""}</summary><p>${esc(value?.reason || value?.scope || "구독 한도와 별도로 집계하는 조직 API 보고서입니다.")}</p>${value?.state === "connected" ? `<p>${date(value.checkedAt)} 조회 · 5분마다 갱신</p><button class="button" data-api-connect="${provider}">연결 키 변경</button>` : ""}</details></div>`;
}

function startupBenefit(name) {
  if (
    name !== "Claude" ||
    data.subscriptions?.Claude?.startupBenefit !== "claimed"
  )
    return "";
  return `<div class="startup-benefit"><div class="between"><strong>스타트업 Team 혜택</strong>${badge("수령 완료", "green")}</div><p>월 최대 <b>$625 할인</b> · 12개월</p><details><summary>혜택 안내</summary><p>사용자가 제공한 프로그램 화면 기준으로 기록했습니다. 최소 2석 조건이며 시작일·종료일은 미확인입니다. API 잔액이 아닙니다.</p><p>API 크레딧의 신청·지급 상태는 계정별로 다릅니다. 구독 할인과 구분해서 API 연결과 공식 콘솔에서 확인하세요.</p></details></div>`;
}

async function selectGoogleAssets() {
  try {
    const value = await api("/api/connections/google/assets");
    const p = project();
    showModal(
      "프로젝트 통계 속성",
      `<form id="google-assets-form"><p>${esc(p.name)}에 연결할 속성을 선택하세요.</p>${value.errors.map((e) => `<p class="warning">${esc(e)}</p>`).join("")}<label class="field">GA4 속성<select name="gaProperty"><option value="">연결 안함</option>${p.gaProperty && !value.properties.some((v) => v.id === p.gaProperty) ? `<option value="${esc(p.gaProperty)}" selected>등록된 속성 ${esc(p.gaProperty)}</option>` : ""}${value.properties.map((v) => `<option value="${esc(v.id)}" ${p.gaProperty === v.id ? "selected" : ""}>${esc(v.name)} · ${esc(v.id)}</option>`).join("")}</select></label><label class="field">Search Console<select name="searchSite"><option value="">연결 안함</option>${p.searchSite && !value.sites.some((v) => v.url === p.searchSite) ? `<option value="${esc(p.searchSite)}" selected>등록된 속성 ${esc(p.searchSite)}</option>` : ""}${value.sites.map((v) => `<option value="${esc(v.url)}" ${p.searchSite === v.url ? "selected" : ""}>${esc(v.url)}</option>`).join("")}</select></label><p class="form-error" role="alert"></p><div class="modal-actions"><button class="button primary">프로젝트에 연결</button></div></form>`,
    );
    $("#google-assets-form").onsubmit = async (e) => {
      e.preventDefault();
      await saveForm(
        e.target,
        `/api/projects/${encodeURIComponent(p.id)}`,
        Object.fromEntries(new FormData(e.target)),
      );
    };
  } catch (e) {
    toast(e.message);
  }
}
