import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  normalizeClaudeCliUsage,
  parseClaudeReset,
  readClaudeCliUsage,
} from "../lib/claude-cli-usage.mjs";
import { readClaudeConnection } from "../lib/provider-usage.mjs";
const now = new Date("2026-10-13T20:30:00Z");
test("Team CLI quotas are independent, bounded and never use context percent", () => {
  const result = normalizeClaudeCliUsage(
    {
      state: "connected",
      windows: [
        {
          label: "Current session",
          usedPercent: 4,
          resetLabel: "Resets 8:20am (Asia/Seoul)",
        },
        {
          label: "Current week (all models)",
          usedPercent: 40,
          resetLabel: "Resets Oct 20, 8:20am (Asia/Seoul)",
        },
        {
          label: "Context window",
          usedPercent: 90,
          resetLabel: "Resets 8:20am (Asia/Seoul)",
        },
      ],
    },
    now,
  );
  assert.equal(result.remaining, 60);
  assert.equal(result.windows.length, 2);
  assert.equal(result.source, "claude_cli");
  assert.equal(result.windows[0].resetAt, "2026-10-13T23:20:00.000Z");
  assert.equal(result.windows[1].resetAt, null);
  assert.equal(
    normalizeClaudeCliUsage(
      {
        state: "connected",
        windows: [
          {
            label: "Current session",
            usedPercent: 101,
            resetLabel: "Resets 8:20am (Asia/Seoul)",
          },
        ],
      },
      now,
    ),
    null,
  );
  assert.equal(parseClaudeReset("Resets 13:20am (Asia/Seoul)", now), null);
});
test("Team account uses official CLI rather than waiting for unsupported statusline", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "manage-team-"));
  try {
    let called = false;
    const result = await readClaudeConnection(dir, {
      settingsFile: path.join(dir, "settings.json"),
      run: async () => ({
        stdout: JSON.stringify({
          loggedIn: true,
          subscriptionType: "team",
          email: "team@example.test",
        }),
      }),
      readCliUsage: async () => {
        called = true;
        return {
          state: "connected",
          usage: { remaining: 96, source: "claude_cli" },
        };
      },
    });
    assert.ok(called);
    assert.equal(result.state, "connected");
    assert.equal(result.usage.remaining, 96);
    assert.equal(result.collectionMethod, "claude_cli");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("failed CLI does not invent data and only allowed command is run", async () => {
  const result = await readClaudeCliUsage("claude", {
    capture: async (_binary, workspace) => {
      assert.ok(workspace.includes("manage-a-claude-quota-check"));
      return { state: "setup_required" };
    },
  });
  assert.equal(result.state, "interactive_setup_required");
  assert.equal(result.usage, undefined);
});
