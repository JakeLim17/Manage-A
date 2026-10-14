import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  normalizeClaudeLimits,
  readClaudeConnection,
  validateSubscription,
  importCursorCsv,
} from "../lib/provider-usage.mjs";
import { collectClaudeStatus } from "../scripts/claude-statusline.mjs";
import { fitLabel } from "../public/graph.js";
const exec = promisify(execFile);

test("Claude quota uses official independent windows and never context percentage", () => {
  const reset = Date.now() / 1000 + 3000;
  const value = normalizeClaudeLimits({
    context_window: { remaining_percentage: 99 },
    rate_limits: {
      five_hour: { used_percentage: 0, resets_at: reset },
      seven_day: { used_percentage: 75.5, resets_at: reset + 1000 },
    },
  });
  assert.equal(value.remaining, 24.5);
  assert.equal(value.windows[0].remaining, 100);
  assert.equal(value.source, "claude_statusline");
  assert.equal(
    normalizeClaudeLimits({ context_window: { remaining_percentage: 99 } }),
    null,
  );
  assert.equal(
    normalizeClaudeLimits({
      rate_limits: { five_hour: { used_percentage: null, resets_at: reset } },
    }),
    null,
  );
});
test("status collector stores only sanitized limits and leaves prior snapshot unchanged when missing", async () => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "manage-claude-receiver-"),
  );
  try {
    await collectClaudeStatus(
      {
        session_id: "private-id",
        transcript_path: "/private/dialogue",
        model: { display_name: "Secret model" },
        rate_limits: {
          five_hour: {
            used_percentage: 20,
            resets_at: Date.now() / 1000 + 3000,
          },
        },
      },
      dir,
    );
    const raw = await fs.readFile(path.join(dir, "claude-limits.json"), "utf8");
    assert.ok(!raw.includes("private"));
    assert.ok(!raw.includes("Secret"));
    assert.equal(JSON.parse(raw).remaining, 80);
    await collectClaudeStatus(
      { context_window: { remaining_percentage: 100 } },
      dir,
    );
    assert.equal(
      await fs.readFile(path.join(dir, "claude-limits.json"), "utf8"),
      raw,
    );
    assert.equal(
      JSON.parse(
        await fs.readFile(path.join(dir, "claude-collector.json"), "utf8"),
      ).hasRateLimits,
      false,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("Claude connection distinguishes login, setup, waiting and expired snapshots without exposing identity", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "manage-claude-state-")),
    settingsFile = path.join(dir, "settings.json");
  try {
    const run = async () => ({
      stdout: JSON.stringify({
        loggedIn: false,
        email: "private@example.test",
      }),
    });
    const result = await readClaudeConnection(dir, { settingsFile, run });
    assert.equal(result.state, "login_required");
    assert.ok(!JSON.stringify(result).includes("private@example"));
    const loggedIn = async () => ({
      stdout: JSON.stringify({ loggedIn: true }),
    });
    assert.equal(
      (await readClaudeConnection(dir, { settingsFile, run: loggedIn })).state,
      "setup_required",
    );
    await fs.writeFile(
      settingsFile,
      JSON.stringify({
        statusLine: {
          command: `node ${path.resolve("scripts/claude-statusline.mjs")}`,
        },
      }),
    );
    assert.equal(
      (await readClaudeConnection(dir, { settingsFile, run: loggedIn })).state,
      "waiting",
    );
    await collectClaudeStatus(
      {
        rate_limits: {
          five_hour: { used_percentage: 50, resets_at: Date.now() / 1000 - 5 },
        },
      },
      dir,
    );
    assert.equal(
      (await readClaudeConnection(dir, { settingsFile, run: loggedIn })).usage,
      null,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("Claude bridge preserves an existing status line and does not contact a model", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "manage-claude-legacy-"));
  try {
    await fs.writeFile(
      path.join(dir, "claude-statusline-previous.json"),
      JSON.stringify({ command: "printf legacy-status" }),
    );
    const child = execFile(
      process.execPath,
      ["scripts/claude-statusline.mjs"],
      { cwd: process.cwd(), env: { ...process.env, MANAGE_A_DATA_DIR: dir } },
    );
    const result = new Promise((resolve, reject) => {
      let stdout = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.on("error", reject);
      child.on("exit", (code) =>
        code === 0 ? resolve(stdout) : reject(new Error("bridge failed")),
      );
    });
    child.stdin.end(
      JSON.stringify({
        rate_limits: {
          seven_day: {
            used_percentage: 30,
            resets_at: Date.now() / 1000 + 1000,
          },
        },
        transcript_path: "private",
      }),
    );
    assert.equal(await result, "legacy-status");
    assert.equal(
      JSON.parse(
        await fs.readFile(path.join(dir, "claude-limits.json"), "utf8"),
      ).remaining,
      70,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("Cursor CSV supports quoted costs, tokens and replaces raw identity with aggregate data", () => {
  const v = importCursorCsv(
    '\uFEFFDate,Model,Cost,Total Tokens,User,Conversation ID\n2026-10-01T12:00:00Z,"Model, X",$0.25,"1,200",private@example.test,secret-id\n2026-10-02T12:00:00Z,"Model, X",$0.75,800,private@example.test,secret-id\ninvalid,other,1,1,email,secret',
  );
  assert.equal(v.events, 2);
  assert.equal(v.skipped, 1);
  assert.equal(v.costUsd, 1);
  assert.equal(v.tokens, 2000);
  assert.equal(v.models.length, 1);
  assert.ok(!JSON.stringify(v).includes("private@example"));
  assert.ok(!JSON.stringify(v).includes("secret-id"));
  assert.equal(v.remaining, undefined);
  assert.throws(() => importCursorCsv("Email,Secret\na,b"));
  assert.throws(() => importCursorCsv('Date,Cost\n2026-10-01,"unfinished'));
  assert.throws(() => importCursorCsv("Date,Cost\n2026-10-01,Included"));
});
test("subscription pause is metadata and preserves the historical Ultra plan", () => {
  const v = validateSubscription({
    provider: "Cursor",
    plan: "Ultra",
    status: "paused",
    historical: true,
    note: "사용자 제공",
  });
  assert.equal(v.status, "paused");
  assert.equal(v.plan, "Ultra");
  assert.equal(v.source, "manual");
  assert.equal(v.remaining, undefined);
  assert.throws(() =>
    validateSubscription({
      provider: "Other",
      plan: "Ultra",
      status: "paused",
      historical: true,
      note: "",
    }),
  );
});
test("graph truncation fits measured width including Unicode and the ellipsis", () => {
  const measure = (value) =>
    [...value].reduce((sum, c) => sum + (/[a-z]/i.test(c) ? 7 : 12), 0);
  for (const value of [
    "src/app/play/[gameId]/stage/very-long-directory",
    "엄청긴프로젝트이름과개발처리경로",
    "👩‍💻longnameeeeeeeeeeeeeeeeeeeeeeeee",
  ]) {
    const label = fitLabel(value, measure, 144);
    assert.ok(measure(label) <= 144);
    assert.ok(label.endsWith("…"));
  }
  assert.equal(fitLabel("short", measure, 144), "short");
});
