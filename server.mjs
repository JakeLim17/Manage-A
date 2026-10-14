import http from "node:http";
import { createGoogleOAuth } from "./lib/google-oauth.mjs";
import net from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  randomBytes,
  timingSafeEqual,
  createSign,
  createPrivateKey,
  createHash,
} from "node:crypto";
import { checkProjectHttp, validateVerification } from "./lib/health.mjs";
import {
  readClaudeConnection,
  validateSubscription,
  importCursorCsv,
} from "./lib/provider-usage.mjs";
import { sourceInventory } from "./lib/project-analysis.mjs";
export { sourceInventory } from "./lib/project-analysis.mjs";
import {
  readCodexLimits,
  readClaudeActivity,
  readVercelProject,
} from "./lib/integrations.mjs";
import { readAnthropicApiUsage, readOpenAiApiUsage } from "./lib/api-usage.mjs";
const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.PROJECT_ROOT || path.join(here, ".."));
const dataDir = path.resolve(process.env.DATA_DIR || path.join(here, ".local"));
const host = process.env.HOST || "127.0.0.1";
const remote = !["127.0.0.1", "localhost", "::1"].includes(host);
const password = process.env.DASHBOARD_PASSWORD || "";
if (remote && (password.length < 16 || !process.env.PUBLIC_ORIGIN))
  throw new Error(
    "Remote mode requires DASHBOARD_PASSWORD (16+ characters) and PUBLIC_ORIGIN.",
  );
const sessions = new Map(),
  attempts = new Map();
let cache = null,
  cacheTime = 0;
const safeRead = async (p) => {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return "";
  }
};
export async function readStore() {
  try {
    return JSON.parse(
      await fs.readFile(path.join(dataDir, "settings.json"), "utf8"),
    );
  } catch (e) {
    if (e.code === "ENOENT") return { projects: {}, usage: {}, activity: [] };
    throw new Error(
      "관리 데이터 파일을 읽을 수 없어요. .local/settings.json을 확인하세요.",
    );
  }
}
async function writeStore(v) {
  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dataDir, "settings.tmp");
  await fs.writeFile(tmp, JSON.stringify(v, null, 2), { mode: 0o600 });
  await fs.rename(tmp, path.join(dataDir, "settings.json"));
}
let writeQueue = Promise.resolve();
function mutate(fn) {
  const task = writeQueue.then(async () => {
    const s = await readStore();
    await fn(s);
    await writeStore(s);
  });
  writeQueue = task.catch(() => {});
  return task;
}
const git = async (dir, args) => {
  try {
    const output = (
      await exec("git", ["-C", dir, ...args], {
        timeout: 5000,
        maxBuffer: 1024 * 1024,
      })
    ).stdout;
    return args.includes("-z") ? output : output.trim();
  } catch {
    return "";
  }
};
async function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (v) => {
      socket.destroy();
      resolve(v);
    };
    socket.setTimeout(350);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}
const ownerCache = new Map();
async function runtimePort(port, dir) {
  let pending = ownerCache.get(port);
  if (!pending || Date.now() - pending.time > 30000) {
    pending = {
      time: Date.now(),
      value: (async () => {
        const reachable = await portOpen(port);
        if (!reachable)
          return { reachable: false, ownerProject: null, pid: null };
        try {
          const command =
            process.platform === "darwin" ? "/usr/sbin/lsof" : "lsof";
          const output = (
            await exec(
              command,
              ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fp"],
              { timeout: 1500, maxBuffer: 32768 },
            )
          ).stdout;
          const pid = output.match(/^p(\d+)$/m)?.[1];
          if (!pid) return { reachable: true, ownerProject: null, pid: null };
          const cwdOutput = (
            await exec(command, ["-a", "-p", pid, "-d", "cwd", "-Fn"], {
              timeout: 1500,
              maxBuffer: 32768,
            })
          ).stdout;
          const cwd = cwdOutput.match(/^n(.+)$/m)?.[1],
            relative = cwd ? path.relative(root, cwd) : "";
          const ownerProject =
            relative && !relative.startsWith("..") && !path.isAbsolute(relative)
              ? relative.split(path.sep)[0]
              : null;
          return { reachable: true, ownerProject, pid: Number(pid) };
        } catch {
          return { reachable: true, ownerProject: null, pid: null };
        }
      })(),
    };
    ownerCache.set(port, pending);
  }
  const value = await pending.value;
  return {
    ...value,
    owned: value.ownerProject
      ? value.ownerProject === path.basename(dir)
      : null,
  };
}
export async function scanProjects() {
  const store = await readStore();
  let deploymentSnapshots = {};
  try {
    deploymentSnapshots = JSON.parse(
      await fs.readFile(path.join(dataDir, "deployments.json"), "utf8"),
    );
  } catch {}
  const dirs = await fs.readdir(root, { withFileTypes: true });
  const projects = await Promise.all(
    dirs
      .filter(
        (d) =>
          d.isDirectory() &&
          !d.name.startsWith(".") &&
          !["node_modules", "backups", "wts", "_automation"].includes(d.name),
      )
      .map(async (d) => {
        const dir = path.join(root, d.name);
        let pkg = {};
        try {
          pkg = JSON.parse(await safeRead(path.join(dir, "package.json")));
        } catch {}
        const readme = (await safeRead(path.join(dir, "README.md"))).slice(
          0,
          16000,
        );
        const dep = { ...pkg.dependencies, ...pkg.devDependencies };
        const [branch, log, status, files] = await Promise.all([
          git(dir, ["branch", "--show-current"]),
          git(dir, ["log", "-5", "--format=%h%x09%aI%x09%s"]),
          git(dir, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
          fs.readdir(dir),
        ]);
        const gitPresent = !!(await git(dir, ["rev-parse", "--git-dir"]));
        const changedFiles = parseGitStatus(status);
        const revision = await git(dir, ["rev-parse", "HEAD"]);
        const stamps = await Promise.all(
          changedFiles.slice(0, 100).map(async (v) => {
            const relative = path.normalize(v.file);
            if (path.isAbsolute(relative) || relative.startsWith(".."))
              return "";
            try {
              const st = await fs.lstat(path.join(dir, relative));
              return `${v.file}:${st.size}:${st.mtimeMs}`;
            } catch {
              return `${v.file}:missing`;
            }
          }),
        );
        const stack = Object.keys(dep).filter((k) =>
          [
            "next",
            "react",
            "vue",
            "vite",
            "express",
            "@supabase/supabase-js",
            "prisma",
            "typescript",
            "tailwindcss",
            "svelte",
            "astro",
            "firebase",
            "@anthropic-ai/sdk",
            "openai",
          ].includes(k),
        );
        if (pkg.engines?.node || files.includes("server.mjs"))
          stack.push("Node.js");
        if (
          files.includes("pyproject.toml") ||
          files.includes("requirements.txt")
        )
          stack.push("Python");
        if (files.includes("Cargo.toml")) stack.push("Rust");
        const inventory = await sourceInventory(dir, dep);
        const sourceStamps = await Promise.all(
          inventory.impact.files.map(async (v) => {
            try {
              const st = await fs.lstat(path.join(dir, v.path));
              return `${v.path}:${st.size}:${st.mtimeMs}`;
            } catch {
              return `${v.path}:missing`;
            }
          }),
        );
        const workspaceStamp = createHash("sha256")
          .update(
            revision + status + stamps.join("\n") + sourceStamps.join("\n"),
          )
          .digest("hex")
          .slice(0, 24);
        for (const k of inventory.detectedStack)
          if (!stack.includes(k)) stack.push(k);
        const custom = store.projects[d.name] || {};
        let vercel = null;
        try {
          const v = JSON.parse(
            await safeRead(path.join(dir, ".vercel/project.json")),
          );
          if (v.projectId) vercel = { projectId: v.projectId, orgId: v.orgId };
        } catch {}
        const detectedPorts = inventory.scriptCommands
          .flatMap((v) =>
            [...v.command.matchAll(/(?:--port(?:=|\s)|-p\s)(\d{2,5})/g)].map(
              (m) => Number(m[1]),
            ),
          )
          .filter((p) => p > 0 && p <= 65535);
        const featureMatch = readme.match(
          /##+ (?:핵심 특징|주요 기능|현재 들어 있는 기능|실제로 동작하는 것|제공 기능)([\s\S]*?)(?=\n## |$)/,
        );
        const docFeatures = featureMatch
          ? featureMatch[1]
              .split("\n")
              .filter((l) => /^- /.test(l))
              .slice(0, 12)
              .map((l) =>
                l.replace(/^- /, "").replace(/[*`]/g, "").slice(0, 180),
              )
          : [];
        inventory.scriptCommands = inventory.scriptCommands.map(
          ({ file, name }) => ({ file, name }),
        );
        const localUrls = [
          ...new Set([
            ...(readme.match(/http:\/\/(?:localhost|127\.0\.0\.1):\d+/g) || []),
            ...detectedPorts.map((p) => `http://127.0.0.1:${p}`),
          ]),
        ]
          .filter(
            (u) =>
              Number(u.split(":").at(-1)) > 0 &&
              Number(u.split(":").at(-1)) <= 65535,
          )
          .filter(
            (url, index, all) =>
              all.findIndex((v) => new URL(v).port === new URL(url).port) ===
              index,
          )
          .slice(0, 5);
        const localPorts = await Promise.all(
          localUrls.map(async (url) => ({
            url,
            port: Number(new URL(url).port),
            ...(await runtimePort(Number(new URL(url).port), dir)),
          })),
        );
        const summary =
          pkg.description ||
          readme
            .split("\n")
            .find(
              (l) =>
                l.trim() &&
                !l.startsWith("#") &&
                !l.startsWith("!") &&
                !l.startsWith("[") &&
                !l.startsWith("<") &&
                !l.startsWith("```"),
            ) ||
          "프로젝트 설명을 추가해 주세요";
        return {
          inventory,
          vercel,
          deployment: deploymentSnapshots[d.name] || null,
          localUrls,
          localPorts,
          descriptionSource: custom.description
            ? "직접 입력"
            : pkg.description
              ? "package.json"
              : "README",
          id: d.name,
          name: custom.name || d.name,
          description:
            custom.description ||
            (summary.includes("bootstrapped")
              ? `${d.name} · ${inventory.routeCount}개 API, ${inventory.pageCount}개 페이지`
              : summary.replace(/[*`]/g, "").slice(0, 180)),
          stack,
          branch: branch || null,
          gitPresent,
          revision: revision || null,
          workspaceStamp,
          health: store.health?.[d.name] || null,
          changes: changedFiles.length,
          changedFiles: changedFiles.slice(0, 100),
          commits: log
            ? log.split("\n").map((l) => {
                const [hash, date, ...s] = l.split("\t");
                return { hash, date, subject: s.join("\t") };
              })
            : [],
          scripts: Object.keys(pkg.scripts || {}),
          featureSource: custom.features
            ? "직접 입력"
            : docFeatures.length
              ? "README"
              : "API 파일",
          hasReadme: !!readme,
          status: custom.status || "unknown",
          website: custom.website || "",
          site: {
            state: custom.siteState || "unknown",
            note: custom.siteNote || "",
            updatedAt: custom.siteUpdatedAt || null,
            source: "manual",
          },
          features:
            custom.features ||
            (docFeatures.length
              ? docFeatures
              : inventory.routeDetails
                  .slice(0, 8)
                  .map((r) => `${r.methods.join("/") || "API"} ${r.endpoint}`)),
          gaProperty: custom.gaProperty || "",
          searchSite: custom.searchSite || "",
          flow: custom.flow || null,
        };
      }),
  );
  return projects.sort((a, b) => a.id.localeCompare(b.id));
}
export function parseGitStatus(status) {
  const chunks = status.split("\0"),
    files = [];
  for (let i = 0; i < chunks.length; i++) {
    const line = chunks[i];
    if (line.length < 4) continue;
    const kind = line.slice(0, 2).trim(),
      file = line.slice(3);
    const previous = /[RC]/.test(line.slice(0, 2)) ? chunks[++i] : null;
    files.push({ status: kind, file, ...(previous ? { previous } : {}) });
  }
  return files;
}
export function validateProject(body) {
  const out = {};
  for (const k of [
    "name",
    "description",
    "website",
    "gaProperty",
    "searchSite",
    "status",
    "siteState",
    "siteNote",
  ])
    if (k in body) {
      if (typeof body[k] !== "string" || body[k].length > 1000)
        throw new Error("입력 형식을 확인하세요");
      out[k] = body[k].trim();
    }
  if (out.website) {
    const u = new URL(out.website);
    if (!["https:", "http:"].includes(u.protocol))
      throw new Error("웹 주소는 http/https 형식이어야 해요");
  }
  if (
    "siteState" in out &&
    !["available", "unavailable", "unknown"].includes(out.siteState)
  )
    throw new Error("운영 사이트 확인 상태를 확인하세요.");
  if (out.siteNote?.length > 250)
    throw new Error("운영 사이트 메모는 250자 이하로 입력하세요.");
  if (out.gaProperty && !/^\d+$/.test(out.gaProperty))
    throw new Error("GA4 속성 ID는 숫자로 입력하세요");
  if (
    out.status &&
    !["unknown", "development", "running", "paused"].includes(out.status)
  )
    throw new Error("상태가 올바르지 않아요");
  if ("features" in body) {
    if (
      !Array.isArray(body.features) ||
      body.features.length > 30 ||
      body.features.some((f) => typeof f !== "string" || f.length > 200)
    )
      throw new Error("기능은 30개 이하로 입력하세요");
    out.features = body.features;
  }
  if ("flow" in body) {
    if (body.flow !== null) {
      const f = body.flow;
      if (
        !Array.isArray(f.nodes) ||
        !Array.isArray(f.edges) ||
        f.nodes.length < 1 ||
        f.nodes.length > 12 ||
        f.edges.length > 24 ||
        f.nodes.some(
          (n) =>
            typeof n.id !== "string" ||
            !/^[-a-zA-Z0-9_]{1,40}$/.test(n.id) ||
            typeof n.label !== "string" ||
            !n.label.trim() ||
            n.label.length > 80 ||
            (n.detail !== undefined &&
              (typeof n.detail !== "string" || n.detail.length > 200)),
        ) ||
        new Set(f.nodes.map((n) => n.id)).size !== f.nodes.length ||
        f.edges.some(
          (e) =>
            !f.nodes.some((n) => n.id === e.from) ||
            !f.nodes.some((n) => n.id === e.to) ||
            typeof e.label !== "string" ||
            e.label.length > 80,
        )
      )
        throw new Error("흐름 노드와 연결을 확인하세요");
    }
    out.flow = body.flow;
  }
  return out;
}
export function validateUsage(b) {
  if (!["Claude", "Codex", "Cursor"].includes(b.provider))
    throw new Error("서비스를 확인하세요");
  const remaining = Number(b.remaining);
  if (
    b.remaining === "" ||
    b.remaining == null ||
    !["number", "string"].includes(typeof b.remaining) ||
    !Number.isFinite(remaining) ||
    remaining < 0 ||
    remaining > 100
  )
    throw new Error("남은 사용량은 0~100 사이로 입력하세요");
  if (
    typeof b.resetAt !== "string" ||
    (b.resetAt && !Number.isFinite(Date.parse(b.resetAt)))
  )
    throw new Error("초기화 시각을 확인하세요");
  return {
    remaining,
    resetAt: b.resetAt,
    window: String(b.window || "직접 확인").slice(0, 80),
    source: "manual",
    updatedAt: new Date().toISOString(),
  };
}
let tokenCache;
const googleOAuth = createGoogleOAuth({
  dataDir,
  dashboardOrigin: `http://127.0.0.1:${process.env.PORT || 4310}`,
  onConnected: async () => {
    tokenCache = null;
    await mutate((s) => {
      s.connections ||= {};
      s.connections.googleAuthMethod = "oauth";
    });
  },
});
async function googleToken() {
  if (tokenCache && tokenCache.expires > Date.now()) return tokenCache.token;
  const credentialPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    (await readStore()).connections?.googleCredentialPath;
  if (!credentialPath) return googleOAuth.token();
  let key;
  try {
    key = JSON.parse(await fs.readFile(credentialPath, "utf8"));
  } catch {
    throw new Error(
      "Google 인증 파일을 읽을 수 없어요. 파일 형식과 경로를 확인하세요.",
    );
  }
  const now = Math.floor(Date.now() / 1000);
  const enc = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const unsigned =
    enc({ alg: "RS256", typ: "JWT" }) +
    "." +
    enc({
      iss: key.client_email,
      scope:
        "https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    });
  const jwt =
    unsigned +
    "." +
    createSign("RSA-SHA256")
      .update(unsigned)
      .sign(key.private_key, "base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const v = await res.json();
  if (!res.ok)
    throw new Error(
      "Google 인증에 실패했어요. 서비스 계정과 API 설정을 확인하세요.",
    );
  tokenCache = {
    token: v.access_token,
    expires: Date.now() + (v.expires_in - 60) * 1000,
  };
  return v.access_token;
}
async function googlePost(url, body) {
  const token = await googleToken();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    let failure;
    try {
      failure = await res.json();
    } catch {}
    const reason = failure?.error?.details?.find((v) => v.reason)?.reason;
    if (reason === "SERVICE_DISABLED")
      throw new Error(
        `${url.includes("analyticsdata.googleapis.com") ? "Google Analytics Data API" : "Google Search Console API"}가 OAuth 프로젝트에서 비활성화되어 있습니다. Google Cloud에서 사용 설정 후 다시 조회하세요.`,
      );
    if (reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT")
      throw new Error(
        "Google 통계 읽기 권한이 부족합니다. Google로 다시 연결하여 두 읽기 권한을 승인하세요.",
      );
    throw new Error(
      `Google 조회 실패 (${res.status}). 해당 속성의 읽기 권한과 API 활성화를 확인하세요.`,
    );
  }
  return res.json();
}
export async function analytics(project, days) {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 3);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days + 1);
  const date = (d) => d.toISOString().slice(0, 10);
  const result = {
    updatedAt: new Date().toISOString(),
    days,
    ga: null,
    search: null,
    errors: [],
  };
  await Promise.all([
    (async () => {
      if (!project.gaProperty) return;
      try {
        const base = `https://analyticsdata.googleapis.com/v1beta/properties/${project.gaProperty}:runReport`;
        const common = {
          dateRanges: [{ startDate: `${days}daysAgo`, endDate: "yesterday" }],
        };
        const [series, channels, pages, totals] = await Promise.all([
          googlePost(base, {
            ...common,
            dimensions: [{ name: "date" }],
            metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }],
            orderBys: [{ dimension: { dimensionName: "date" } }],
          }),
          googlePost(base, {
            ...common,
            dimensions: [{ name: "sessionDefaultChannelGroup" }],
            metrics: [{ name: "sessions" }],
            limit: 8,
          }),
          googlePost(base, {
            ...common,
            dimensions: [{ name: "pagePath" }],
            metrics: [{ name: "screenPageViews" }],
            orderBys: [
              { metric: { metricName: "screenPageViews" }, desc: true },
            ],
            limit: 6,
          }),
          googlePost(base, {
            ...common,
            metrics: [
              { name: "activeUsers" },
              { name: "screenPageViews" },
              { name: "sessions" },
            ],
          }),
        ]);
        result.ga = {
          series: series.rows || [],
          channels: channels.rows || [],
          pages: pages.rows || [],
          totals: totals.rows?.[0]?.metricValues.map((v) =>
            Number(v.value),
          ) || [0, 0, 0],
          source: "Google Analytics Data API",
          range: common.dateRanges[0],
        };
      } catch (e) {
        result.errors.push(e.message);
      }
    })(),
    (async () => {
      if (!project.searchSite) return;
      try {
        const base = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(project.searchSite)}/searchAnalytics/query`;
        const common = { startDate: date(start), endDate: date(end) };
        const [queries, series, totals] = await Promise.all([
          googlePost(base, { ...common, dimensions: ["query"], rowLimit: 8 }),
          googlePost(base, { ...common, dimensions: ["date"], rowLimit: days }),
          googlePost(base, common),
        ]);
        result.search = {
          queries: queries.rows || [],
          series: series.rows || [],
          totals: totals.rows?.[0] || {
            clicks: 0,
            impressions: 0,
            ctr: 0,
            position: 0,
          },
          range: common,
          source: "Google Search Console",
        };
      } catch (e) {
        result.errors.push(e.message);
      }
    })(),
  ]);
  return result;
}
let localActivity = null,
  syncInFlight = null,
  lastSync = 0;
let healthInFlight = null,
  healthAutoError = null;
async function syncHealth() {
  if (healthInFlight) return healthInFlight;
  healthInFlight = (async () => {
    const projects = await scanProjects();
    const targets = projects.filter((p) =>
      p.localPorts.some((v) => v.reachable && v.owned === true),
    );
    const checked = await Promise.all(
      targets.map(async (p) => ({
        id: p.id,
        http: {
          ...(await checkProjectHttp({
            ...p,
            localPorts: p.localPorts.filter(
              (v) => v.reachable && v.owned === true,
            ),
          })),
          mode: "automatic_open_ports",
        },
      })),
    );
    await mutate((s) => {
      s.health ||= {};
      for (const v of checked) {
        s.health[v.id] ||= {};
        s.health[v.id].http = v.http;
      }
      s.healthSweep = {
        checkedAt: new Date().toISOString(),
        projectsChecked: checked.length,
        scope: "열린 포트의 소유 프로젝트 확인 후 GET /",
      };
    });
    cache = null;
    healthAutoError = null;
  })()
    .catch((error) => {
      healthAutoError = ["ENOSPC", "EDQUOT"].includes(error.code)
        ? "디스크 공간이 부족해 자동 점검 결과를 저장하지 못했어요."
        : "자동 HTTP 점검을 완료하지 못했어요. 수동 점검과 실행 상태를 확인하세요.";
      throw error;
    })
    .finally(() => {
      healthInFlight = null;
    });
  return healthInFlight;
}
async function apiCredential(provider) {
  try {
    return JSON.parse(
      await fs.readFile(path.join(dataDir, "api-credentials.json"), "utf8"),
    )[provider];
  } catch {
    return undefined;
  }
}
export async function syncIntegrations() {
  if (syncInFlight) return syncInFlight;
  if (Date.now() - lastSync < 60000) return;
  syncInFlight = (async () => {
    const results = await Promise.allSettled([
      readCodexLimits(),
      readClaudeConnection(dataDir),
      readClaudeActivity(root),
      readAnthropicApiUsage({
        key: (await apiCredential("Claude")) || process.env.ANTHROPIC_ADMIN_KEY,
      }),
      readOpenAiApiUsage({
        key: (await apiCredential("OpenAI")) || process.env.OPENAI_ADMIN_KEY,
      }),
    ]);
    const now = new Date().toISOString();
    if (results[2].status === "fulfilled") localActivity = results[2].value;
    await mutate((s) => {
      s.integrationStatus ||= {};
      if (results[3].status === "fulfilled")
        s.apiUsage = { ...s.apiUsage, Claude: results[3].value };
      if (results[4].status === "fulfilled")
        s.apiUsage = { ...s.apiUsage, OpenAI: results[4].value };
      for (const [i, name] of ["Codex", "Claude"].entries()) {
        const r = results[i];
        s.integrationStatus[name] = {
          state: r.status === "fulfilled" ? "connected" : "error",
          checkedAt: now,
          error: r.status === "rejected" ? r.reason.message : null,
        };
        if (i === 0 && r.status === "fulfilled") s.usage.Codex = r.value;
        if (i === 1 && r.status === "fulfilled") {
          const { usage, ...status } = r.value;
          s.integrationStatus.Claude = { ...status, checkedAt: now };
          if (usage) s.usage.Claude = usage;
        }
      }
      s.integrationStatus.Cursor = {
        state:
          s.subscriptions?.Cursor?.status === "paused"
            ? "paused"
            : s.cursorActivity
              ? "imported"
              : "manual",
        reason:
          s.subscriptions?.Cursor?.status === "paused"
            ? "유료 구독 일시 중단으로 기록되어 있어요. 잔여 한도를 0%로 추정하지 않습니다. 이전 사용량은 CSV로 가져올 수 있어요."
            : "개인 계정의 사용량 CSV 가져오기와 잔여 한도 직접 기록을 지원합니다. CSV는 자동 조회나 계정 전체 잔여 한도가 아닙니다.",
        checkedAt: now,
      };
    });
    lastSync = Date.now();
  })().finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}
const json = (res, status, data) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
};
async function body(req, limit = 65536) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > limit) throw new Error("요청이 너무 커요");
  }
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new Error("요청 JSON 형식을 확인하세요.");
  }
}
const equal = (a, b) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
function session(req) {
  const id = req.headers.cookie?.match(/(?:^|; )cc_session=([a-f0-9]+)/)?.[1];
  const expiry = sessions.get(id);
  if (expiry > Date.now()) return true;
  if (id) sessions.delete(id);
  return false;
}
const port = Number(process.env.PORT || 4310);
export const server = http.createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  try {
    const allowedHost = new Set([
      `127.0.0.1:${port}`,
      `localhost:${port}`,
      `[::1]:${port}`,
    ]);
    if (process.env.PUBLIC_ORIGIN)
      allowedHost.add(new URL(process.env.PUBLIC_ORIGIN).host);
    if (!allowedHost.has(req.headers.host))
      return json(res, 403, { error: "허용되지 않은 호스트입니다" });
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (
      !["GET", "HEAD"].includes(req.method) &&
      req.headers.origin !== `http://${req.headers.host}` &&
      (!process.env.PUBLIC_ORIGIN ||
        req.headers.origin !== process.env.PUBLIC_ORIGIN)
    )
      return json(res, 403, { error: "같은 대시보드에서만 변경할 수 있어요" });
    if (url.pathname === "/api/session" && req.method === "GET")
      return json(res, 200, { authenticated: !remote || session(req), remote });
    if (url.pathname === "/api/login" && req.method === "POST") {
      const ip = req.socket.remoteAddress;
      const a = attempts.get(ip) || { count: 0, time: Date.now() };
      if (Date.now() - a.time > 60000) {
        a.count = 0;
        a.time = Date.now();
      }
      if (a.count >= 5)
        return json(res, 429, { error: "잠시 후 다시 시도하세요" });
      a.count++;
      attempts.set(ip, a);
      const b = await body(req);
      if (!remote || equal(String(b.password || ""), password)) {
        const id = randomBytes(32).toString("hex");
        sessions.set(id, Date.now() + 8 * 3600000);
        res.setHeader(
          "Set-Cookie",
          `cc_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.COOKIE_SECURE === "true" ? "; Secure" : ""}`,
        );
        return json(res, 200, { ok: true });
      }
      return json(res, 401, { error: "비밀번호가 맞지 않아요" });
    }
    if (url.pathname.startsWith("/api/") && remote && !session(req))
      return json(res, 401, { error: "로그인이 필요해요" });
    if (url.pathname === "/api/dashboard" && req.method === "GET") {
      if (!cache || Date.now() - cacheTime > 30000) {
        cache = await scanProjects();
        cacheTime = Date.now();
      }
      const s = await readStore();
      let storage = null;
      try {
        const disk = await fs.statfs(here);
        storage = {
          freeBytes: disk.bavail * disk.bsize,
          checkedAt: new Date().toISOString(),
        };
      } catch {}
      return json(res, 200, {
        storage,
        projects: cache,
        profile: { displayName: s.profile?.displayName || "사용자" },
        usage: s.usage,
        activity: s.activity.slice(0, 30),
        scannedAt: new Date(cacheTime).toISOString(),
        mode: remote ? "web" : "local",
        googleConnected: !!(
          process.env.GOOGLE_APPLICATION_CREDENTIALS ||
          s.connections?.googleCredentialPath ||
          (await googleOAuth.status()).method
        ),
        googleAuthStatus: await googleOAuth.status(),
        integrationStatus: s.integrationStatus || {},
        claudeActivity: localActivity,
        apiUsage: s.apiUsage || {},
        subscriptions: s.subscriptions || {},
        cursorActivity: s.cursorActivity || null,
        healthSweep: s.healthSweep || null,
        healthAutoEnabled: process.env.DISABLE_BACKGROUND_SYNC !== "1",
        healthAutoError,
        vercelTokenConfigured: !!process.env.VERCEL_TOKEN,
        analyticsAttempts: s.analyticsAttempts || {},
        analyticsSummaries: Object.entries(s.analytics || {})
          .map(([id, periods]) => ({
            project: id,
            ...(periods[28] || Object.values(periods)[0]),
          }))
          .map((v) => ({
            project: v.project,
            updatedAt: v.updatedAt,
            days: v.days,
            ga: v.ga ? { totals: v.ga.totals } : null,
            search: v.search ? { totals: v.search.totals } : null,
          })),
      });
    }
    if (
      url.pathname === "/api/connections/api-usage" &&
      req.method === "POST"
    ) {
      if (
        remote ||
        !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
          req.socket.remoteAddress,
        )
      )
        return json(res, 403, {
          error: "API 인증은 이 컴퓨터의 로컬 모드에서 연결하세요.",
        });
      const b = await body(req, 8192);
      if (
        !["Claude", "OpenAI"].includes(b.provider) ||
        typeof b.key !== "string" ||
        b.key.length < 20 ||
        b.key.length > 4096 ||
        /\s/.test(b.key)
      )
        return json(res, 400, {
          error: "서비스와 Admin 키 형식을 확인하세요.",
        });
      const result = await (
        b.provider === "Claude" ? readAnthropicApiUsage : readOpenAiApiUsage
      )({ key: b.key });
      if (result.state !== "connected")
        return json(res, 400, { error: result.reason });
      let keys = {};
      try {
        keys = JSON.parse(
          await fs.readFile(path.join(dataDir, "api-credentials.json"), "utf8"),
        );
      } catch {}
      keys[b.provider] = b.key;
      await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
      const target = path.join(dataDir, "api-credentials.json"),
        temp = target + ".tmp";
      await fs.writeFile(temp, JSON.stringify(keys), { mode: 0o600 });
      await fs.rename(temp, target);
      await mutate((s) => {
        s.apiUsage ||= {};
        s.apiUsage[b.provider] = result;
      });
      return json(res, 200, { ok: true });
    }
    if (url.pathname === "/api/profile" && req.method === "POST") {
      const b = await body(req);
      if (
        typeof b.displayName !== "string" ||
        !b.displayName.trim() ||
        b.displayName.trim().length > 40 ||
        /[\x00-\x1f\x7f]/.test(b.displayName)
      )
        throw new Error("사용자명은 1~40자로 입력하세요.");
      await mutate((s) => {
        s.profile = { displayName: b.displayName.trim() };
      });
      return json(res, 200, { ok: true });
    }
    if (url.pathname === "/api/usage/sync" && req.method === "POST") {
      await syncIntegrations();
      return json(res, 200, {
        ok: true,
        status: (await readStore()).integrationStatus,
      });
    }
    if (url.pathname === "/api/subscriptions" && req.method === "POST") {
      const b = await body(req),
        value = validateSubscription(b);
      await mutate((s) => {
        s.subscriptions ||= {};
        s.subscriptions[b.provider] = value;
        s.activity.unshift({
          date: new Date().toISOString(),
          text: `${b.provider} 구독 상태 직접 기록`,
        });
      });
      lastSync = 0;
      return json(res, 200, { ok: true });
    }
    if (url.pathname === "/api/cursor/import" && req.method === "POST") {
      const b = await body(req, 1024 * 1024),
        value = importCursorCsv(b.csv);
      await mutate((s) => {
        s.cursorActivity = value;
        s.activity.unshift({
          date: new Date().toISOString(),
          text: "Cursor 사용량 CSV 집계 가져오기 (원본·계정 식별자 미보관)",
        });
      });
      lastSync = 0;
      return json(res, 200, value);
    }
    if (url.pathname === "/api/logout" && req.method === "POST") {
      const id = req.headers.cookie?.match(
        /(?:^|; )cc_session=([a-f0-9]+)/,
      )?.[1];
      sessions.delete(id);
      res.setHeader(
        "Set-Cookie",
        "cc_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
      );
      return json(res, 200, { ok: true });
    }
    if (
      url.pathname === "/api/connections/google/oauth/start" &&
      req.method === "POST"
    ) {
      if (
        remote ||
        !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
          req.socket.remoteAddress,
        )
      )
        return json(res, 403, {
          error: "Google 인증은 로컬 모드에서 연결하세요.",
        });
      const value = await body(req);
      return json(res, 200, await googleOAuth.start(value.clientPath));
    }
    if (
      url.pathname === "/api/connections/google/status" &&
      req.method === "GET"
    )
      return json(res, 200, await googleOAuth.status());
    if (
      url.pathname === "/api/connections/google/assets" &&
      req.method === "GET"
    ) {
      const token = await googleToken(),
        result = { properties: [], sites: [], errors: [] };
      await Promise.all([
        (async () => {
          try {
            const r = await fetch(
              "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200",
              {
                headers: { Authorization: `Bearer ${token}` },
                signal: AbortSignal.timeout(15000),
              },
            );
            if (!r.ok)
              throw new Error(
                `GA4 속성 목록 조회 실패 (${r.status}). Google Analytics Admin API 활성화를 확인하세요.`,
              );
            const value = await r.json();
            result.properties = (value.accountSummaries || []).flatMap((a) =>
              (a.propertySummaries || []).map((p) => ({
                id: p.property.replace("properties/", ""),
                name: p.displayName,
                account: a.displayName,
              })),
            );
            if (value.nextPageToken)
              result.errors.push(
                "GA4 속성 목록은 처음 200개 계정만 포함합니다.",
              );
          } catch (e) {
            result.errors.push(e.message);
          }
        })(),
        (async () => {
          try {
            const r = await fetch(
              "https://www.googleapis.com/webmasters/v3/sites",
              {
                headers: { Authorization: `Bearer ${token}` },
                signal: AbortSignal.timeout(15000),
              },
            );
            if (!r.ok)
              throw new Error(
                `Search Console 속성 조회 실패 (${r.status}). Search Console API 활성화를 확인하세요.`,
              );
            const value = await r.json();
            result.sites = (value.siteEntry || [])
              .filter((s) => s.permissionLevel !== "siteUnverifiedUser")
              .map((s) => ({ url: s.siteUrl, permission: s.permissionLevel }));
          } catch (e) {
            result.errors.push(e.message);
          }
        })(),
      ]);
      return json(res, 200, result);
    }
    if (url.pathname === "/api/connections/google" && req.method === "POST") {
      const b = await body(req);
      if (
        typeof b.credentialPath !== "string" ||
        !path.isAbsolute(b.credentialPath)
      )
        throw new Error("인증 파일의 절대 경로를 입력하세요.");
      if (remote)
        throw new Error("인증 파일 연결은 로컬 모드에서만 변경할 수 있어요.");
      try {
        const stat = await fs.stat(b.credentialPath);
        if (stat.size > 65536) throw new Error();
        const key = JSON.parse(await fs.readFile(b.credentialPath, "utf8"));
        if (
          key.type !== "service_account" ||
          typeof key.client_email !== "string" ||
          !key.private_key
        )
          throw new Error();
        createPrivateKey(key.private_key);
      } catch {
        throw new Error(
          "유효한 Google 서비스 계정 JSON 파일인지 확인하세요. 파일 내용은 화면에 표시하지 않습니다.",
        );
      }
      await mutate((s) => {
        s.connections ||= {};
        s.connections.googleCredentialPath = b.credentialPath;
        s.activity.unshift({
          date: new Date().toISOString(),
          text: "Google 인증 파일 연결 (속성 권한은 조회 시 확인)",
        });
      });
      tokenCache = null;
      return json(res, 200, { ok: true });
    }
    if (url.pathname === "/api/refresh" && req.method === "POST") {
      cache = null;
      return json(res, 200, { ok: true });
    }
    if (url.pathname === "/api/usage" && req.method === "POST") {
      const b = await body(req),
        v = validateUsage(b);
      await mutate((s) => {
        s.usage[b.provider] = v;
        s.activity.unshift({
          date: new Date().toISOString(),
          text: `${b.provider} 사용량 직접 갱신`,
        });
      });
      return json(res, 200, { ok: true });
    }
    const match = url.pathname.match(
      /^\/api\/projects\/([^/]+)(?:\/(analytics|deployment|health|verification))?$/,
    );
    if (match) {
      const id = decodeURIComponent(match[1]);
      if (
        !cache ||
        Date.now() - cacheTime > 30000 ||
        match[2] === "verification"
      ) {
        cache = await scanProjects();
        cacheTime = Date.now();
      }
      const p = cache.find((p) => p.id === id);
      if (!p) return json(res, 404, { error: "프로젝트가 없어요" });
      if (match[2] === "health" && req.method === "POST") {
        const previous = (await readStore()).health?.[id]?.http;
        if (previous && Date.now() - Date.parse(previous.checkedAt) < 5000)
          return json(res, 200, previous);
        const http = {
          ...(await checkProjectHttp(p)),
          mode: "manual_local_ports",
        };
        await mutate((s) => {
          s.health ||= {};
          s.health[id] ||= {};
          s.health[id].http = http;
        });
        p.health = { ...p.health, http };
        return json(res, 200, http);
      }
      if (match[2] === "verification" && req.method === "POST") {
        const verification = validateVerification(
          await body(req),
          p.workspaceStamp,
        );
        await mutate((s) => {
          s.health ||= {};
          s.health[id] ||= {};
          s.health[id].verification ||= {};
          s.health[id].verification[verification.kind] = verification;
          s.activity.unshift({
            date: new Date().toISOString(),
            project: id,
            text: `${p.name} ${verification.kind === "test" ? "테스트" : "빌드"} ${verification.result === "passed" ? "통과" : "실패"} 결과 직접 기록`,
          });
        });
        cache = null;
        return json(res, 200, { ok: true });
      }
      if (match[2] === "deployment" && req.method === "POST") {
        const deployment = await readVercelProject(p.vercel);
        let snapshots = {};
        try {
          snapshots = JSON.parse(
            await fs.readFile(path.join(dataDir, "deployments.json"), "utf8"),
          );
        } catch {}
        snapshots[id] = deployment;
        await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
        await fs.writeFile(
          path.join(dataDir, "deployments.json"),
          JSON.stringify(snapshots, null, 2),
          { mode: 0o600 },
        );
        cache = null;
        return json(res, 200, deployment);
      }
      if (match[2] === "analytics" && req.method === "GET") {
        const days = Number(url.searchParams.get("days") || 28);
        if (![7, 28, 90].includes(days)) throw new Error("기간을 확인하세요");
        if (url.searchParams.get("cached") === "1")
          return json(
            res,
            200,
            (await readStore()).analytics?.[id]?.[days] || null,
          );
        const result = await analytics(p, days);
        await mutate((s) => {
          s.analyticsAttempts ||= {};
          s.analyticsAttempts[id] = {
            checkedAt: result.updatedAt,
            ga: !!result.ga,
            search: !!result.search,
            errors: result.errors,
          };
          if (result.ga || result.search) {
            s.analytics ||= {};
            s.analytics[id] ||= {};
            s.analytics[id][days] = result;
          }
        });
        return json(res, 200, result);
      }
      if (!match[2] && req.method === "POST") {
        const v = validateProject(await body(req));
        await mutate((s) => {
          if (
            ("gaProperty" in v && v.gaProperty !== p.gaProperty) ||
            ("searchSite" in v && v.searchSite !== p.searchSite)
          ) {
            if (s.analytics) delete s.analytics[id];
            if (s.analyticsAttempts) delete s.analyticsAttempts[id];
          }
          s.projects[id] = { ...s.projects[id], ...v };
          if ("website" in v && v.website !== p.website && !("siteState" in v))
            Object.assign(s.projects[id], {
              siteState: "unknown",
              siteNote: "",
              siteUpdatedAt: null,
            });
          if ("siteState" in v)
            s.projects[id].siteUpdatedAt = new Date().toISOString();
          s.activity.unshift({
            date: new Date().toISOString(),
            text: `${id} 프로젝트 정보 수정`,
          });
        });
        cache = null;
        return json(res, 200, { ok: true });
      }
    }
    if (url.pathname.startsWith("/api/"))
      return json(res, 404, { error: "없는 API입니다" });
    if (!["GET", "HEAD"].includes(req.method))
      return json(res, 405, { error: "허용되지 않은 메서드입니다" });
    const assets = {
      "/": "index.html",
      "/app.js": "app.js",
      "/graph.js": "graph.js",
      "/insights.js": "insights.js",
      "/help.js": "help.js",
      "/logo.svg": "logo.svg",
      "/styles.css": "styles.css",
    };
    const file = assets[url.pathname];
    if (!file) {
      res.writeHead(404);
      return res.end("Not found");
    }
    const content = await fs.readFile(path.join(here, "public", file));
    res.setHeader(
      "Content-Type",
      file.endsWith(".svg")
        ? "image/svg+xml"
        : file.endsWith(".html")
          ? "text/html; charset=utf-8"
          : file.endsWith(".js")
            ? "text/javascript; charset=utf-8"
            : "text/css; charset=utf-8",
    );
    res.end(content);
  } catch (e) {
    json(res, 400, {
      error: ["ENOSPC", "EDQUOT"].includes(e.code)
        ? "디스크 공간이 부족해 저장하지 못했어요. 공간을 확보한 뒤 다시 시도하세요."
        : e.message.includes("ENOENT")
          ? "설정 파일을 찾을 수 없어요"
          : e.message,
    });
  }
});
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  server.listen(port, host, () => {
    if (process.env.DISABLE_BACKGROUND_SYNC !== "1") {
      setTimeout(() => syncIntegrations().catch(() => {}), 1000).unref();
      setInterval(() => syncIntegrations().catch(() => {}), 300000).unref();
      setTimeout(() => syncHealth().catch(() => {}), 6000).unref();
      setInterval(() => syncHealth().catch(() => {}), 300000).unref();
    }
    console.log(
      `Manage-A: http://${host}:${port} (${remote ? "authenticated web" : "local only"})`,
    );
  });
}
