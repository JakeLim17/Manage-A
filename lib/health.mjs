import http from "node:http";

// Only known loopback ports are probed. Never follow redirects or retain bodies.
export function probeLocalHttp(port, { timeout = 5000 } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("로컬 포트를 확인하세요.");
  return new Promise((resolve) => {
    const started = performance.now();
    let finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      req.destroy();
      resolve({
        port,
        ...result,
        latencyMs: Math.round(performance.now() - started),
        checkedAt: new Date().toISOString(),
      });
    };
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/",
        method: "GET",
        maxHeaderSize: 16384,
        headers: {
          "User-Agent": "Manage-A local health check",
          Connection: "close",
        },
      },
      (res) => {
        const status = res.statusCode;
        finish({
          status,
          state:
            status >= 200 && status < 300
              ? "ok"
              : status >= 300 && status < 400
                ? "redirect"
                : status === 404
                  ? "route_missing"
                  : [401, 403].includes(status)
                    ? "protected"
                    : "error",
        });
        res.destroy();
      },
    );
    const timer = setTimeout(
      () => finish({ state: "timeout", status: null }),
      timeout,
    );
    req.on("error", (error) =>
      finish({
        state: "unreachable",
        status: null,
        reason:
          error.code === "ECONNREFUSED"
            ? "서버 미실행 또는 포트 연결 거부"
            : error.code?.startsWith("HPE_")
              ? "HTTP 응답 형식 확인 필요"
              : "연결 중단 또는 로컬 통신 오류",
      }),
    );
    req.end();
  });
}

export async function checkProjectHttp(project, probe = probeLocalHttp) {
  const targets = (project.localPorts || [])
    .filter((v) => v.owned !== false)
    .slice(0, 5);
  return {
    checkedAt: new Date().toISOString(),
    path: "/",
    excluded: (project.localPorts || [])
      .filter((v) => v.owned === false)
      .map((v) => ({
        port: v.port,
        ownerProject: v.ownerProject || null,
        reason: "다른 프로젝트가 사용하는 포트",
      })),
    results: await Promise.all(targets.map((v) => probe(v.port))),
  };
}

export function validateVerification(body, workspaceStamp) {
  if (
    !["build", "test"].includes(body.kind) ||
    !["passed", "failed"].includes(body.result)
  )
    throw new Error("검증 종류와 결과를 확인하세요.");
  if (
    typeof body.note !== "string" ||
    body.note.length > 300 ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(body.note)
  )
    throw new Error("메모는 300자 이하로 입력하세요.");
  if (
    !Number.isFinite(Date.parse(body.checkedAt)) ||
    Date.parse(body.checkedAt) > Date.now() + 60000 ||
    Date.parse(body.checkedAt) < Date.now() - 366 * 86400000
  )
    throw new Error("지난 1년 이내의 검증 시각을 입력하세요.");
  return {
    kind: body.kind,
    result: body.result,
    note: body.note.trim(),
    checkedAt: new Date(body.checkedAt).toISOString(),
    recordedAt: new Date().toISOString(),
    source: "manual",
    workspaceStamp,
  };
}
