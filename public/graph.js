export function buildArchitecture(project, routeFile = "") {
  const inv = project.inventory || {},
    route = inv.routeDetails?.find((r) => (r.key || r.file) === routeFile);
  const nodes = [],
    edges = [];
  const languages = (inv.languages || []).filter(
    (v) => !["CSS", "SCSS", "SQL", "HTML"].includes(v.name),
  );
  const native = languages[0]?.name === "Swift";
  const ui =
    inv.pageCount > 0 ||
    project.stack?.some((s) =>
      ["react", "vue", "next", "Swift", "vite"].includes(s),
    ) ||
    inv.languages?.some((l) => ["HTML", "Swift"].includes(l.name));
  const backend =
    inv.routeCount > 0 ||
    project.stack?.some((s) =>
      ["Node.js", "express", "Python", "Go"].includes(s),
    );
  const add = (id, label, detail, kind, evidence, x, y, language = "") =>
    nodes.push({ id, label, detail, kind, evidence, x, y, language });
  const edge = (from, to, label, confirmed = false) =>
    edges.push({ from, to, label, confirmed });
  if (ui && !route) {
    add(
      "screen",
      native ? "iPhone / Watch 화면" : "웹 화면",
      native ? "Swift 소스에서 발견" : `${inv.pageCount || 0}개 화면 파일`,
      "screen",
      (inv.pages || []).slice(0, 4),
      35,
      65,
      native
        ? "Swift"
        : project.stack?.includes("typescript")
          ? "TypeScript"
          : languages[0]?.name || "",
    );
  }
  if (backend) {
    add(
      "api",
      route ? route.endpoint : "API · 처리 로직",
      route
        ? `${route.methods.join(" / ") || "메서드 확인 필요"}`
        : `${inv.routeCount || 0}개 API 파일`,
      "code",
      route ? [route.file] : inv.routes?.slice(0, 4) || ["실행 파일 기준"],
      295,
      65,
      route?.language ||
        languages.find((l) =>
          ["TypeScript", "JavaScript", "Python", "Go"].includes(l.name),
        )?.name ||
        "",
    );
    if (ui && !route) edge("screen", "api", "요청 (추정)");
  }
  if (route?.links.length) {
    add(
      "module",
      "연결된 내부 모듈",
      `${route.links.length}개 import 연결`,
      "folder",
      route.links.slice(0, 8),
      555,
      65,
      route.language,
    );
    edge("api", "module", "코드 import", true);
  }
  const routeDb = route ? route.dbUsed || [] : inv.db || [];
  const routeAi = route ? route.aiUsed || [] : inv.ai || [];
  if (routeDb.length) {
    add(
      "db",
      native ? "기기 내 저장" : "데이터 저장",
      routeDb
        .map((k) => k.replace("@supabase/supabase-js", "Supabase"))
        .join(", ")
        .slice(0, 30),
      "db",
      [
        ...routeDb,
        ...(inv.frameworkEvidence || [])
          .filter((v) => ["SwiftData", "CoreData"].includes(v.name))
          .map((v) => v.file),
      ].slice(0, 8),
      555,
      route?.links.length ? 250 : 65,
      "SQL / SDK",
    );
    const direct = route?.imports.some((spec) => routeDb.includes(spec));
    edge(
      route && !direct && route.links.length
        ? "module"
        : backend
          ? "api"
          : ui
            ? "screen"
            : "code",
      "db",
      route ? (direct ? "SDK import" : "간접 import") : "의존성 (추정)",
      !!route,
    );
  }
  if (routeAi.length) {
    add(
      "ai",
      "외부 AI",
      routeAi.join(", ").slice(0, 30),
      "ai",
      routeAi,
      555,
      routeDb.length ? 435 : 250,
      "SDK",
    );
    const direct = route?.imports.some((spec) => routeAi.includes(spec));
    edge(
      route && !direct && route.links.length
        ? "module"
        : backend
          ? "api"
          : ui
            ? "screen"
            : "code",
      "ai",
      route ? (direct ? "SDK import" : "간접 import") : "AI 호출 (추정)",
      !!route,
    );
  }
  if (project.vercel && !route) {
    add(
      "deploy",
      "Vercel 배포",
      "로컬 프로젝트 연결 파일",
      "cloud",
      [".vercel/project.json"],
      295,
      435,
      "배포",
    );
    if (ui || backend) edge(ui ? "screen" : "api", "deploy", "배포 연결");
  }
  if (!ui && !backend) {
    add(
      "code",
      native ? "네이티브 코드" : "프로젝트 코드",
      `${inv.sourceCount || 0}개 소스 파일`,
      "folder",
      ["소스 파일 목록"],
      35,
      65,
      languages[0]?.name || "문서",
    );
  }
  if (route) {
    const api = nodes.find((n) => n.id === "api"),
      module = nodes.find((n) => n.id === "module"),
      db = nodes.find((n) => n.id === "db"),
      ai = nodes.find((n) => n.id === "ai");
    if (api) {
      api.x = 35;
      api.y = 65;
    }
    if (module) {
      module.x = 295;
      module.y = 65;
    }
    if (db) {
      db.x = module ? 555 : 295;
      db.y = 65;
    }
    if (ai) {
      ai.x = module ? 555 : 295;
      ai.y = db ? 250 : 65;
    }
  }
  const ids = new Set(nodes.map((n) => n.id));
  return {
    nodes,
    edges: edges.filter((e) => ids.has(e.from) && ids.has(e.to)),
    caption: route
      ? "실선은 소스의 import, 점선은 의존성으로 추정한 연결입니다."
      : "발견한 페이지·API·패키지로 구성했습니다. 실제 호출 순서는 검토가 필요합니다.",
  };
}
export function languageColor(name) {
  return (
    {
      TypeScript: "#387cc4",
      JavaScript: "#c79e30",
      Swift: "#d97645",
      Python: "#4d9a8e",
      Go: "#43a7b5",
      Rust: "#a4725f",
      CSS: "#8e75bd",
      HTML: "#c87857",
      SQL: "#61959d",
    }[name] || "#8393a3"
  );
}
export function fitLabel(text, measure, width) {
  const chars = Array.from(String(text));
  if (measure(chars.join("")) <= width) return chars.join("");
  let lo = 0,
    hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(chars.slice(0, mid).join("") + "…") <= width) lo = mid;
    else hi = mid - 1;
  }
  return chars.slice(0, lo).join("") + "…";
}
