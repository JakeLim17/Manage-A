import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export function normalizeLimits(value, now = new Date().toISOString()) {
  const buckets =
    value.rateLimitsByLimitId ||
    (value.rateLimits
      ? { [value.rateLimits.limitId || "codex"]: value.rateLimits }
      : {});
  const windows = [];
  for (const [id, bucket] of Object.entries(buckets))
    for (const slot of ["primary", "secondary"]) {
      const v = bucket?.[slot];
      if (v?.usedPercent == null || !Number.isFinite(v.usedPercent)) continue;
      const minutes = v.windowDurationMins;
      const duration =
        minutes == null
          ? "기간 미제공"
          : minutes >= 1440
            ? `${minutes / 1440}일`
            : minutes >= 60
              ? `${minutes / 60}시간`
              : `${minutes}분`;
      windows.push({
        id: `${id}:${slot}`,
        label: `${bucket.limitName || id} · ${duration}`,
        remaining: Math.max(0, Math.min(100, 100 - v.usedPercent)),
        usedPercent: v.usedPercent,
        resetAt: Number.isFinite(v.resetsAt)
          ? new Date(v.resetsAt * 1000).toISOString()
          : "",
        windowDurationMins: minutes ?? null,
      });
    }
  if (!windows.length)
    throw new Error(
      "계정 한도 데이터가 제공되지 않았어요. CLI 로그인 방식을 확인하세요.",
    );
  const matching = windows.filter((w) => w.id.startsWith("codex:"));
  const main = (matching.length ? matching : windows).reduce((a, b) =>
    a.remaining <= b.remaining ? a : b,
  );
  return {
    remaining: main.remaining,
    resetAt: main.resetAt,
    window: main.label,
    windows,
    source: "codex_cli",
    updatedAt: now,
  };
}

// Only initializes the account client and reads quotas. Never starts an inference turn.
export function readCodexLimits({
  binary = process.env.CODEX_BIN || "codex",
  timeout = 18000,
  spawnProcess = spawn,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(binary, ["app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, RUST_LOG: "off" },
    });
    let done = false;
    const cleanup = () => {
      clearTimeout(timer);
      lines?.close();
      child.stdin.destroy();
      child.kill();
    };
    const finish = (err, value) => {
      if (done) return;
      done = true;
      cleanup();
      err ? reject(err) : resolve(value);
    };
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            "Codex 조회 시간이 초과됐어요. CLI 로그인과 네트워크를 확인하세요.",
          ),
        ),
      timeout,
    );
    const lines = createInterface({ input: child.stdout });
    child.stderr.resume();
    child.on("error", () =>
      finish(
        new Error(
          "Codex CLI를 실행할 수 없어요. 설치 경로와 CODEX_BIN 설정을 확인하세요.",
        ),
      ),
    );
    child.on("exit", () => {
      if (!done)
        finish(
          new Error(
            "Codex 조회가 종료됐어요. 터미널에서 codex login status를 확인하세요.",
          ),
        );
    });
    child.stdin.on("error", () => {});
    const send = (message) => {
      if (!done) child.stdin.write(JSON.stringify(message) + "\n");
    };
    lines.on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.id === 1) {
        if (message.error)
          return finish(
            new Error("Codex 초기화에 실패했어요. CLI 버전을 확인하세요."),
          );
        send({ method: "initialized", params: {} });
        send({ method: "account/rateLimits/read", id: 2 });
      }
      if (message.id === 2) {
        if (message.error)
          return finish(
            new Error(
              "Codex 한도를 읽지 못했어요. CLI에 ChatGPT 계정으로 로그인했는지 확인하세요.",
            ),
          );
        try {
          finish(null, normalizeLimits(message.result));
        } catch (e) {
          finish(e);
        }
      }
      // Reject unsolicited server requests without granting additional capabilities.
      if (message.method && message.id != null)
        send({
          id: message.id,
          error: { code: -32601, message: "Read-only quota client" },
        });
    });
    send({
      method: "initialize",
      id: 1,
      params: {
        clientInfo: {
          name: "manage_a_dashboard",
          title: "Manage-A usage monitor",
          version: "1.1.0",
        },
      },
    });
  });
}

export function usageFromRecord(record, projectRoot, since) {
  const usage = record?.message?.usage;
  if (
    record.type !== "assistant" ||
    !usage ||
    record.isApiErrorMessage ||
    !record.message.id ||
    !record.timestamp ||
    !Number.isFinite(Date.parse(record.timestamp)) ||
    Date.parse(record.timestamp) < since
  )
    return null;
  const cwd = typeof record.cwd === "string" ? path.resolve(record.cwd) : "";
  const relative = path.relative(projectRoot, cwd);
  const project =
    cwd && relative && !relative.startsWith("..") && !path.isAbsolute(relative)
      ? relative.split(path.sep)[0]
      : "기타 프로젝트";
  const number = (k) =>
    Number.isFinite(usage[k]) && usage[k] >= 0 ? usage[k] : 0;
  return {
    id: record.message.id,
    project,
    date: record.timestamp,
    input: number("input_tokens"),
    output: number("output_tokens"),
    cacheRead: number("cache_read_input_tokens"),
    cacheWrite: number("cache_creation_input_tokens"),
  };
}

export async function readClaudeActivity(
  projectRoot,
  {
    directory = path.join(os.homedir(), ".claude", "projects"),
    days = 7,
    maxBytes = 64 * 1024 * 1024,
  } = {},
) {
  const since = Date.now() - days * 86400000,
    files = [];
  let available = true;
  async function walk(base, depth = 0) {
    let entries;
    try {
      entries = await fs.readdir(base, { withFileTypes: true });
    } catch {
      if (depth === 0) available = false;
      return;
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const full = path.join(base, e.name);
      if (e.isDirectory() && depth < 2) await walk(full, depth + 1);
      else if (e.isFile() && e.name.endsWith(".jsonl")) {
        const stat = await fs.stat(full);
        if (stat.mtimeMs >= since)
          files.push({ full, size: stat.size, mtime: stat.mtimeMs });
      }
    }
  }
  await walk(directory);
  files.sort((a, b) => b.mtime - a.mtime);
  const messages = new Map();
  let readBytes = 0,
    skipped = 0;
  for (const file of files) {
    if (file.size > 16 * 1024 * 1024 || readBytes + file.size > maxBytes) {
      skipped++;
      continue;
    }
    readBytes += file.size;
    const text = await fs.readFile(file.full, "utf8");
    for (const line of text.split("\n")) {
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      const item = usageFromRecord(record, projectRoot, since);
      if (!item) continue;
      const prior = messages.get(item.id);
      if (prior) {
        for (const k of ["input", "output", "cacheRead", "cacheWrite"])
          item[k] = Math.max(item[k], prior[k]);
      }
      messages.set(item.id, item);
    }
  }
  const projects = {};
  for (const item of messages.values()) {
    const v = (projects[item.project] ||= {
      project: item.project,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      messages: 0,
    });
    for (const k of ["input", "output", "cacheRead", "cacheWrite"])
      v[k] += item[k];
    v.messages++;
  }
  return {
    available,
    days,
    updatedAt: new Date().toISOString(),
    projects: Object.values(projects).sort(
      (a, b) => b.input + b.output - (a.input + a.output),
    ),
    messages: messages.size,
    skipped,
    source: "Claude Code 로컬 사용 기록",
    scope: "읽을 수 있는 최근 로그만 집계 · 계정 잔여 한도 아님",
  };
}

export async function readVercelProject(project) {
  if (!process.env.VERCEL_TOKEN)
    throw new Error(
      "Vercel API 토큰이 설정되지 않았어요. .env의 VERCEL_TOKEN을 설정하세요.",
    );
  if (!project?.projectId || !/^prj_[\w-]+$/.test(project.projectId))
    throw new Error("Vercel 프로젝트 연결 정보가 없어요.");
  const url = new URL(
    `https://api.vercel.com/v9/projects/${encodeURIComponent(project.projectId)}`,
  );
  if (project.orgId?.startsWith("team_"))
    url.searchParams.set("teamId", project.orgId);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok)
    throw new Error(
      `Vercel 조회 실패 (${res.status}). 프로젝트 읽기 권한을 확인하세요.`,
    );
  return normalizeDeployment(await res.json());
}
export function normalizeDeployment(value) {
  const deployment = value.targets?.production || value.latestDeployments?.[0];
  return {
    projectId: value.id,
    name: value.name,
    state: deployment?.readyState || deployment?.state || "UNKNOWN",
    url: deployment?.url ? `https://${deployment.url}` : "",
    aliases: (deployment?.alias || [])
      .filter((v) => typeof v === "string")
      .slice(0, 5),
    createdAt: deployment?.createdAt
      ? new Date(deployment.createdAt).toISOString()
      : null,
    source: "Vercel API",
    updatedAt: new Date().toISOString(),
    target: value.targets?.production ? "production" : "latest",
  };
}
