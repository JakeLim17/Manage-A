export const fresh = (time, now = Date.now(), age = 15 * 60000) =>
  Number.isFinite(Date.parse(time)) &&
  now - Date.parse(time) < age &&
  Date.parse(time) <= now + 60000;

export function summarizeHealth(project, now = Date.now()) {
  const http = project.health?.http;
  const verified = (http?.results || []).filter((r) => fresh(r.checkedAt, now));
  const errors = verified.filter((r) =>
    ["error", "unreachable"].includes(r.state),
  );
  if (errors.length)
    return {
      state: "error",
      label: errors[0].status
        ? `로컬 HTTP ${errors[0].status}`
        : "로컬 연결 확인",
      detail:
        "내 컴퓨터의 개발 서버 응답입니다. 운영 사이트 상태와 별도입니다.",
    };
  if (verified.some((r) => r.state === "timeout"))
    return {
      state: "review",
      label: "로컬 응답 지연",
      detail: "점검 제한 시간 초과 · 기능 장애는 별도 확인",
    };
  if (verified.some((r) => r.state === "ok"))
    return {
      state: "ok",
      label: "로컬 응답 확인",
      detail: "루트 페이지 응답 기준",
    };
  if (verified.length)
    return {
      state: "review",
      label: "로컬 응답 검토",
      detail: "인증·리디렉션 또는 루트 페이지 미제공",
    };
  if (!project.localPorts?.length && !http?.results?.length)
    return {
      state: "unknown",
      label: project.inventory?.languages?.some((v) => v.name === "Swift")
        ? "HTTP 대상 없음"
        : "주소 미등록",
      detail: "HTTP로 확인할 로컬 주소가 없어요",
    };
  if (
    project.localPorts?.length &&
    project.localPorts.every((v) => v.owned === false)
  )
    return {
      state: "unknown",
      label: "대상 제외",
      detail: "다른 프로젝트의 포트로 확인되어 제외했어요",
    };
  return {
    state: "unknown",
    label: http?.checkedAt ? "재점검 필요" : "미점검",
    detail: http?.checkedAt
      ? "최근 15분 이내 HTTP 결과 없음"
      : "로컬 HTTP 결과가 아직 없어요",
  };
}
export function productionSummary(project) {
  if (!project.website) return { label: "운영 주소 미등록", kind: "gray" };
  return {
    label:
      project.site?.state === "available"
        ? "운영 확인 · 직접기록"
        : project.site?.state === "unavailable"
          ? "운영 확인 필요 · 직접기록"
          : "운영 상태 미확인",
    kind:
      project.site?.state === "available"
        ? "green"
        : project.site?.state === "unavailable"
          ? "amber"
          : "gray",
  };
}

export function analyzeImpact(inventory, selected) {
  const index = inventory?.impact || { files: [], edges: [] };
  const files = new Map(index.files.map((f) => [f.path, f]));
  const reverse = new Map(),
    forward = new Map();
  for (const edge of index.edges) {
    if (!reverse.has(edge.to)) reverse.set(edge.to, []);
    reverse.get(edge.to).push(edge.from);
    if (!forward.has(edge.from)) forward.set(edge.from, []);
    forward.get(edge.from).push(edge.to);
  }
  const ancestors = new Map(),
    queue = [{ path: selected, chain: [selected] }];
  for (let i = 0; i < queue.length && ancestors.size < 1500; i++) {
    const item = queue[i];
    for (const consumer of reverse.get(item.path) || []) {
      if (consumer === selected || ancestors.has(consumer)) continue;
      const chain = [...item.chain, consumer];
      ancestors.set(consumer, {
        path: consumer,
        distance: chain.length - 1,
        chain,
      });
      queue.push({ path: consumer, chain });
    }
  }
  const dependents = [...ancestors.values()].sort(
    (a, b) => a.distance - b.distance || a.path.localeCompare(b.path),
  );
  const affected = new Set([selected, ...ancestors.keys()]);
  return {
    selected: files.get(selected) || { path: selected, analyzed: false },
    dependents,
    direct: dependents.filter((v) => v.distance === 1),
    dependencies: forward.get(selected) || [],
    pages: index.files
      .filter((f) => f.kind === "page" && affected.has(f.path))
      .map((f) => f.path),
    routes: (inventory?.routeDetails || []).filter((r) => affected.has(r.file)),
    bounded: index.bounded || ancestors.size >= 1500,
    coverage: index.coverage || { analyzed: 0, total: 0 },
  };
}

export function attentionItems(data, now = Date.now()) {
  const items = [];
  if (data.storage && data.storage.freeBytes < 512 * 1024 * 1024)
    items.push({
      priority: 0,
      view: "health",
      title: "디스크 공간 확인",
      detail: `여유 ${Math.round(data.storage.freeBytes / 1024 / 1024)}MB · 관리 기록 저장에 실패할 수 있어요`,
    });
  for (const p of data.projects) {
    const h = summarizeHealth(p, now);
    if (h.state === "error")
      items.push({
        priority: 0,
        project: p.id,
        view: "health",
        title: `${p.name} 로컬 서버 확인`,
        detail: h.detail,
      });
    if (p.deployment?.state === "UNAVAILABLE")
      items.push({
        priority: 1,
        project: p.id,
        view: "health",
        title: `${p.name} 배포 정보 조회 확인`,
        detail:
          "Vercel 조회 권한·연결 ID 확인 · 운영 사이트 장애를 의미하지 않아요",
      });
    if (p.changedFiles?.length)
      items.push({
        priority: 2,
        project: p.id,
        view: "impact",
        title: `${p.name} 변경 영향 검토`,
        detail: `${p.changes}개 변경 · 연결된 화면과 API 확인`,
      });
  }
  if (!data.googleConnected)
    items.push({
      priority: 1,
      view: "settings",
      title: "방문·검색 통계 연결",
      detail: "Google 인증 파일과 프로젝트별 속성을 연결하세요",
    });
  for (const [name, usage] of Object.entries(data.usage || {})) {
    if (data.subscriptions?.[name]?.status === "paused") continue;
    if (usage.remaining <= 20 && fresh(usage.updatedAt, now, 600000))
      items.push({
        priority: 1,
        view: "usage",
        title: `${name} 사용량 확인`,
        detail: `${usage.remaining}% 남음${usage.resetAt ? " · 초기화 일정 확인" : ""}`,
      });
  }
  return items.sort(
    (a, b) => a.priority - b.priority || a.title.localeCompare(b.title),
  );
}
