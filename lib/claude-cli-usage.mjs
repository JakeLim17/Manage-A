import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
const exec = promisify(execFile);
async function captureClaudeQuotaScreen(binary, workspace) {
  const result = await exec(
    process.env.PYTHON_BIN || "python3",
    [
      fileURLToPath(
        new URL("../scripts/read-claude-usage.py", import.meta.url),
      ),
      binary,
      workspace,
    ],
    { timeout: 27000, maxBuffer: 16384 },
  );
  return JSON.parse(result.stdout);
}
// The CLI sometimes exposes only a reset time; don't invent a date for other labels.
export function parseClaudeReset(label, now = new Date()) {
  const match = /^Resets (\d{1,2}):(\d{2})(am|pm) \(([^)]+)\)$/.exec(label);
  if (!match) return null;
  const hour = (Number(match[1]) % 12) + (match[3] === "pm" ? 12 : 0),
    minute = Number(match[2]);
  if (Number(match[1]) < 1 || Number(match[1]) > 12 || minute > 59) return null;
  try {
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: match[4],
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    // Search upcoming minute boundaries. DST and the IANA zone are handled by Intl.
    const base = Math.floor(now.getTime() / 60000) * 60000;
    for (let offset = 0; offset <= 24 * 60; offset++) {
      const value = new Date(base + offset * 60000);
      const parts = Object.fromEntries(
        formatter.formatToParts(value).map((p) => [p.type, p.value]),
      );
      if (
        Number(parts.hour) === hour &&
        Number(parts.minute) === minute &&
        value.getTime() > now.getTime()
      )
        return value.toISOString();
    }
  } catch {}
  return null;
}
export function normalizeClaudeCliUsage(value, now = new Date()) {
  if (value?.state !== "connected" || !Array.isArray(value.windows))
    return null;
  const names = {
    "Current session": ["five_hour", "5시간", 300],
    "Current week (all models)": ["seven_day", "주간", 10080],
    "Current week (Sonnet only)": ["seven_day_sonnet", "Sonnet 주간", 10080],
    "Current week (Opus only)": ["seven_day_opus", "Opus 주간", 10080],
  };
  const windows = value.windows.flatMap((w) => {
    const definition = names[w.label];
    if (
      !definition ||
      typeof w.usedPercent !== "number" ||
      !Number.isFinite(w.usedPercent) ||
      w.usedPercent < 0 ||
      w.usedPercent > 100 ||
      typeof w.resetLabel !== "string" ||
      !/^Resets [\w\s,:/().+-]{1,110}$/.test(w.resetLabel)
    )
      return [];
    return [
      {
        id: `claude:${definition[0]}`,
        label: `Claude · ${definition[1]}`,
        usedPercent: w.usedPercent,
        remaining: 100 - w.usedPercent,
        resetLabel: w.resetLabel,
        resetAt:
          definition[0] === "five_hour"
            ? parseClaudeReset(w.resetLabel, now)
            : null,
        windowDurationMins: definition[2],
      },
    ];
  });
  if (!windows.length) return null;
  const main = windows.reduce((a, b) => (a.remaining <= b.remaining ? a : b));
  return {
    remaining: main.remaining,
    resetAt: main.resetAt,
    window: main.label,
    windows,
    source: "claude_cli",
    updatedAt: now.toISOString(),
  };
}
export async function readClaudeCliUsage(
  binary,
  { capture = captureClaudeQuotaScreen, now = new Date() } = {},
) {
  const workspace =
    process.env.CLAUDE_USAGE_WORKDIR ||
    (process.platform === "darwin"
      ? "/private/tmp/manage-a-claude-quota-check"
      : path.join(os.tmpdir(), "manage-a-claude-quota-check"));
  try {
    const value = await capture(binary, workspace),
      usage = normalizeClaudeCliUsage(value, now);
    return usage
      ? {
          state: "connected",
          usage,
          reason:
            "공식 Claude Code /usage에서 조회한 Team 구독 한도입니다. 5분마다 갱신하며 모델 요청은 보내지 않습니다.",
        }
      : {
          state:
            value.state === "setup_required"
              ? "interactive_setup_required"
              : "unavailable",
          reason:
            value.state === "setup_required"
              ? "Claude CLI 초기 설정 또는 격리된 한도 조회 폴더의 신뢰 확인이 필요합니다."
              : "공식 CLI 사용량 화면에서 한도를 읽지 못했습니다. 계정 로그인과 Claude CLI 버전을 확인하세요.",
        };
  } catch {
    return {
      state: "unavailable",
      reason:
        "Claude 공식 CLI 한도 조회가 완료되지 않았습니다. Claude 설치 경로와 인증을 확인하세요.",
    };
  }
}
