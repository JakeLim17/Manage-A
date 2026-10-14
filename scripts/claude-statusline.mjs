import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";
import { normalizeClaudeLimits } from "../lib/provider-usage.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
export async function collectClaudeStatus(payload, dataDir) {
  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
  const updatedAt = new Date().toISOString(),
    usage = normalizeClaudeLimits(payload, updatedAt);
  const write = async (name, value) => {
    const target = path.join(dataDir, name),
      temp = `${target}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
    await fs.writeFile(temp, JSON.stringify(value), { mode: 0o600 });
    await fs.rename(temp, target);
  };
  await write("claude-collector.json", { updatedAt, hasRateLimits: !!usage });
  if (usage) await write("claude-limits.json", usage);
  return usage;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  let text = "";
  for await (const chunk of process.stdin) {
    text += chunk;
    if (Buffer.byteLength(text) > 512 * 1024) {
      process.exitCode = 0;
      break;
    }
  }
  try {
    const payload = JSON.parse(text),
      dataDir = path.resolve(
        process.env.MANAGE_A_DATA_DIR || path.join(here, "../.local"),
      );
    let usage;
    try {
      usage = await collectClaudeStatus(payload, dataDir);
    } catch {} // Never disrupt Claude when disk space is exhausted.
    let prior;
    try {
      prior = JSON.parse(
        await fs.readFile(
          path.join(dataDir, "claude-statusline-previous.json"),
          "utf8",
        ),
      );
    } catch {}
    if (prior?.command && !prior.command.includes("claude-statusline.mjs")) {
      await new Promise((resolve) => {
        const child = exec(
          prior.command,
          { timeout: 1500, maxBuffer: 32768 },
          (_err, stdout) => {
            if (stdout) process.stdout.write(stdout);
            resolve();
          },
        );
        child.stdin.on("error", () => {});
        child.stdin.end(text);
      });
    } else
      process.stdout.write(
        usage
          ? usage.windows
              .map((v) => `${v.label}: ${Math.round(v.remaining)}% 남음`)
              .join(" | ")
          : "Claude · Manage-A 한도 수집 대기",
      );
  } catch {} // No raw session, transcript, account or token data is printed or saved.
}
