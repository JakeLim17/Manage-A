import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { readClaudeCliUsage } from "./claude-cli-usage.mjs";
const exec = promisify(execFile);

export function normalizeClaudeLimits(
  payload,
  updatedAt = new Date().toISOString(),
) {
  const windows = [];
  for (const [id, label, duration] of [
    ["five_hour", "5시간", 300],
    ["seven_day", "주간", 10080],
    ["spend_limit", "지출 한도", null],
  ]) {
    const value = payload?.rate_limits?.[id];
    if (
      !value ||
      typeof value.used_percentage !== "number" ||
      !Number.isFinite(value.used_percentage) ||
      value.used_percentage < 0 ||
      !Number.isFinite(value.resets_at) ||
      value.resets_at <= 0
    )
      continue;
    windows.push({
      id: `claude:${id}`,
      label: `Claude · ${label}`,
      usedPercent: value.used_percentage,
      remaining: Math.max(0, 100 - value.used_percentage),
      resetAt: new Date(value.resets_at * 1000).toISOString(),
      windowDurationMins: duration,
    });
  }
  if (!windows.length) return null;
  const main = windows.reduce((a, b) => (a.remaining <= b.remaining ? a : b));
  return {
    remaining: main.remaining,
    resetAt: main.resetAt,
    window: main.label,
    windows,
    source: "claude_statusline",
    updatedAt,
  };
}

export async function readClaudeConnection(
  dataDir,
  {
    binary = process.env.CLAUDE_BIN || "claude",
    settingsFile = path.join(os.homedir(), ".claude/settings.json"),
    run = exec,
    readCliUsage = readClaudeCliUsage,
  } = {},
) {
  let auth,
    configured = false,
    received = null,
    usage = null;
  try {
    const result = await run(binary, ["auth", "status", "--json"], {
      timeout: 5000,
      maxBuffer: 32768,
    });
    auth = JSON.parse(result.stdout);
  } catch (error) {
    // auth status may exit non-zero when signed out. Never forward raw output.
    try {
      auth = JSON.parse(error.stdout);
    } catch {}
    if (!auth)
      return {
        state: "unavailable",
        reason:
          "Claude CLI를 확인할 수 없어요. 설치 경로와 CLAUDE_BIN을 확인하세요.",
      };
  }
  try {
    const s = JSON.parse(await fs.readFile(settingsFile, "utf8"));
    configured = !!s.statusLine?.command?.includes(
      fileURLToPath(
        new URL("../scripts/claude-statusline.mjs", import.meta.url),
      ),
    );
  } catch {}
  try {
    received = JSON.parse(
      await fs.readFile(path.join(dataDir, "claude-collector.json"), "utf8"),
    );
  } catch {}
  try {
    const saved = JSON.parse(
      await fs.readFile(path.join(dataDir, "claude-limits.json"), "utf8"),
    );
    const limits = Object.fromEntries(
      (saved.windows || [])
        .filter((w) => Date.parse(w.resetAt) > Date.now())
        .map((w) => [
          w.id.replace("claude:", ""),
          {
            used_percentage: w.usedPercent,
            resets_at: Date.parse(w.resetAt) / 1000,
          },
        ]),
    );
    if (Number.isFinite(Date.parse(saved.updatedAt)))
      usage = normalizeClaudeLimits({ rate_limits: limits }, saved.updatedAt);
  } catch {}
  const extra = {
    accountEmail:
      auth.loggedIn && typeof auth.email === "string"
        ? auth.email.slice(0, 254)
        : null,
    subscriptionType: auth.subscriptionType || null,
    collectorConfigured: configured,
    lastReceivedAt: received?.updatedAt || null,
    usage,
  };
  if (!auth.loggedIn)
    return {
      ...extra,
      state: "login_required",
      reason:
        "Claude CLI 로그인이 없어요. 터미널에서 claude auth login을 실행하세요.",
    };
  if (
    auth.subscriptionType === "team" ||
    auth.subscriptionType === "enterprise"
  ) {
    const direct = await readCliUsage(binary);
    return {
      ...extra,
      ...direct,
      usage: direct.usage || null,
      lastReceivedAt: direct.usage?.updatedAt || extra.lastReceivedAt,
      collectionMethod: "claude_cli",
    };
  }
  if (!configured)
    return {
      ...extra,
      state: "setup_required",
      reason: "Claude 한도 수집기를 설정하세요: npm run connect:claude",
    };
  if (!usage)
    return {
      ...extra,
      state: "waiting",
      reason:
        "수집기 준비 완료. " +
        (received?.updatedAt
          ? "상태줄은 수신됐지만 한도 필드가 제공되지 않았어요. "
          : "아직 상태줄 호출이 한 번도 수신되지 않았어요. Claude Code를 재시작한 뒤 응답을 확인하세요. ") +
        "Team 계정은 구독·좌석에 따라 한도 데이터가 없을 수 있어요. API 사용량은 별도입니다.",
    };
  return {
    ...extra,
    state:
      Date.now() - Date.parse(usage.updatedAt) > 600000 ? "stale" : "connected",
    reason:
      "Claude Code 공식 상태줄에서 수신한 마지막 한도입니다. 새 응답이 오면 갱신됩니다.",
  };
}

export function validateSubscription(body) {
  if (
    !["Claude", "Codex", "Cursor"].includes(body.provider) ||
    !["active", "paused", "free", "unknown"].includes(body.status)
  )
    throw new Error("서비스와 구독 상태를 확인하세요.");
  for (const [key, max] of [
    ["plan", 50],
    ["note", 250],
  ])
    if (
      typeof body[key] !== "string" ||
      body[key].length > max ||
      /[\x00-\x1f]/.test(body[key])
    )
      throw new Error("플랜과 메모 형식을 확인하세요.");
  if (typeof body.historical !== "boolean")
    throw new Error("플랜 사용 이력 여부를 확인하세요.");
  if (
    body.startupBenefit !== undefined &&
    (body.provider !== "Claude" ||
      !["claimed", "none"].includes(body.startupBenefit))
  )
    throw new Error("스타트업 혜택 상태를 확인하세요.");
  return {
    ...(body.startupBenefit !== undefined
      ? { startupBenefit: body.startupBenefit }
      : {}),
    plan: body.plan.trim(),
    status: body.status,
    historical: body.historical,
    note: body.note.trim(),
    source: "manual",
    updatedAt: new Date().toISOString(),
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === "," || c === "\n")) {
      row.push(field.trim());
      field = "";
      if (c === "\n") {
        if (row.some(Boolean)) rows.push(row);
        row = [];
      }
    } else if (c !== "\r") field += c;
    if (rows.length > 10000 || field.length > 8192)
      throw new Error("CSV는 10,000행 이하로 가져오세요.");
  }
  if (quoted) throw new Error("CSV 따옴표 형식을 확인하세요.");
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
export function importCursorCsv(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > 768 * 1024)
    throw new Error("Cursor 사용량 CSV는 768KiB 이하로 가져오세요.");
  const [header, ...rows] = parseCsv(text.replace(/^\uFEFF/, ""));
  if (!header || !rows.length)
    throw new Error("사용량 행이 있는 CSV 파일을 선택하세요.");
  const names = header.map((v) => v.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const column = (...values) => names.findIndex((v) => values.includes(v));
  const dateCol = column("date", "timestamp", "createdat"),
    modelCol = column("model"),
    costCol = column("cost", "costusd", "totalcost", "totalcostusd"),
    tokenCol = column("totaltokens", "tokens");
  const inputCol = column("inputtokens", "inputtokenswocachewrite"),
    outputCol = column("outputtokens"),
    cacheCol = column("cachereadtokens"),
    cacheWriteCol = column(
      "cachewritetokens",
      "inputtokenswithcachewrite",
      "inputtokenswcachewrite",
    );
  if (
    dateCol < 0 ||
    (costCol < 0 && tokenCol < 0 && inputCol < 0 && outputCol < 0)
  )
    throw new Error(
      "Cursor 이벤트 CSV의 Date와 Cost 또는 Tokens 열이 필요해요. 지원하지 않는 열 형식은 변환 후 가져오세요.",
    );
  const number = (v) => {
    const s = String(v ?? "").replace(/[$,\s]/g, "");
    return s && /^\d+(?:\.\d+)?$/.test(s) && Number.isFinite(Number(s))
      ? Number(s)
      : null;
  };
  const models = new Map(),
    dates = [];
  let skipped = 0,
    costRows = 0,
    tokenRows = 0;
  for (const row of rows) {
    const timestamp = Date.parse(row[dateCol]);
    if (!Number.isFinite(timestamp)) {
      skipped++;
      continue;
    }
    const cost = number(row[costCol]);
    const parts = [inputCol, outputCol, cacheCol, cacheWriteCol]
      .filter((i) => i >= 0)
      .map((i) => number(row[i]));
    const tokens =
      tokenCol >= 0
        ? number(row[tokenCol])
        : parts.some((v) => v !== null)
          ? parts.reduce((a, b) => a + (b || 0), 0)
          : null;
    if (cost === null && tokens === null) {
      skipped++;
      continue;
    }
    const model = String(row[modelCol] || "미제공")
      .replace(/[\x00-\x1f]/g, "")
      .slice(0, 100);
    const value = models.get(model) || {
      model,
      events: 0,
      tokens: 0,
      costUsd: 0,
      costRows: 0,
      tokenRows: 0,
    };
    value.events++;
    if (cost !== null) {
      value.costUsd += cost;
      value.costRows++;
      costRows++;
    }
    if (tokens !== null) {
      value.tokens += tokens;
      value.tokenRows++;
      tokenRows++;
    }
    models.set(model, value);
    dates.push(timestamp);
  }
  if (!dates.length)
    throw new Error(
      "집계 가능한 사용량 행이 없어요. 날짜와 숫자 열을 확인하세요.",
    );
  return {
    source: "cursor_csv",
    updatedAt: new Date().toISOString(),
    events: dates.length,
    skipped,
    costRows,
    tokenRows,
    costUsd: [...models.values()].reduce((s, v) => s + v.costUsd, 0),
    tokens: [...models.values()].reduce((s, v) => s + v.tokens, 0),
    models: [...models.values()]
      .sort((a, b) => b.events - a.events)
      .slice(0, 50),
    period: {
      start: new Date(Math.min(...dates)).toISOString(),
      end: new Date(Math.max(...dates)).toISOString(),
    },
    scope: "가져온 CSV 범위 · 잔여 한도나 청구서 합계 아님",
  };
}
