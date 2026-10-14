import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  normalizeLimits,
  usageFromRecord,
  readClaudeActivity,
  normalizeDeployment,
} from "../lib/integrations.mjs";
import { sourceInventory } from "../lib/project-analysis.mjs";
import { buildArchitecture } from "../public/graph.js";

test("official quota preserves independent windows and uses limiting Codex window", () => {
  const v = normalizeLimits({
    rateLimitsByLimitId: {
      codex: {
        primary: {
          usedPercent: 0,
          windowDurationMins: 300,
          resetsAt: 1792000000,
        },
        secondary: {
          usedPercent: 75,
          windowDurationMins: 10080,
          resetsAt: 1792200000,
        },
      },
      other: { primary: { usedPercent: 90, windowDurationMins: 60 } },
    },
  });
  assert.equal(v.windows.length, 3);
  assert.equal(v.remaining, 25);
  assert.equal(v.windows[0].remaining, 100);
  assert.equal(v.source, "codex_cli");
  assert.throws(() =>
    normalizeLimits({ rateLimits: { primary: { usedPercent: null } } }),
  );
});
test("Claude aggregation excludes errors, outside time range and conversation content", () => {
  const record = {
    type: "assistant",
    cwd: "/workspace/Project",
    timestamp: new Date().toISOString(),
    message: {
      id: "message1",
      content: "private conversation must not leave reader",
      usage: { input_tokens: 12, output_tokens: 4, cache_read_input_tokens: 9 },
    },
  };
  const value = usageFromRecord(record, "/workspace", Date.now() - 1000);
  assert.equal(value.project, "Project");
  assert.equal(value.input, 12);
  assert.equal(value.cacheRead, 9);
  assert.ok(!JSON.stringify(value).includes("private conversation"));
  assert.equal(
    usageFromRecord({ ...record, isApiErrorMessage: true }, "/workspace", 0),
    null,
  );
  assert.equal(
    usageFromRecord({ ...record, timestamp: "invalid" }, "/workspace", 0),
    null,
  );
});
test("duplicate message snapshots are deduplicated instead of summing streaming chunks", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "manage-a-claude-"));
  try {
    await fs.mkdir(path.join(dir, "project"));
    const base = {
      type: "assistant",
      timestamp: new Date().toISOString(),
      cwd: "/workspace/demo",
      message: { id: "same", usage: { input_tokens: 10, output_tokens: 5 } },
    };
    const next = structuredClone(base);
    next.message.usage.output_tokens = 12;
    await fs.writeFile(
      path.join(dir, "project", "session.jsonl"),
      JSON.stringify(base) + "\n" + JSON.stringify(next) + "\n",
    );
    const v = await readClaudeActivity("/workspace", { directory: dir });
    assert.equal(v.messages, 1);
    assert.equal(v.projects[0].input, 10);
    assert.equal(v.projects[0].output, 12);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("source analysis resolves alias imports, methods and language evidence", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "manage-a-source-"));
  try {
    await fs.mkdir(path.join(dir, "src/app/api/records"), { recursive: true });
    await fs.mkdir(path.join(dir, "src/lib"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "src/app/api/records/route.ts"),
      "import {save} from '@/lib/store'; export async function POST(){} export function GET(){}",
    );
    await fs.writeFile(
      path.join(dir, "src/lib/store.ts"),
      "export const save=()=>{}",
    );
    await fs.writeFile(path.join(dir, "index.html"), "<title>test</title>");
    const v = await sourceInventory(dir);
    assert.equal(v.routeCount, 1);
    assert.equal(v.pageCount, 1);
    assert.equal(v.routeDetails[0].endpoint, "/api/records");
    assert.deepEqual(v.routeDetails[0].links, ["src/lib/store.ts"]);
    assert.deepEqual(v.routeDetails[0].methods, ["POST", "GET"]);
    assert.ok(
      v.languages.some((l) => l.name === "TypeScript" && l.count === 2),
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("Node HTTP endpoints and native persistence frameworks are detected", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "manage-a-node-"));
  try {
    await fs.writeFile(
      path.join(dir, "server.mjs"),
      `if (url.pathname === '/api/health' && req.method === 'GET') {}`,
    );
    await fs.writeFile(
      path.join(dir, "Run.swift"),
      "import SwiftData\nimport HealthKit",
    );
    const v = await sourceInventory(dir);
    assert.equal(v.routeDetails[0].endpoint, "/api/health");
    assert.deepEqual(v.routeDetails[0].methods, ["GET"]);
    assert.ok(v.db.includes("SwiftData"));
    assert.equal(v.frameworkEvidence.length, 2);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("architecture never invents database or AI nodes for a static frontend", () => {
  const p = {
    stack: ["react"],
    inventory: {
      pageCount: 1,
      routeCount: 0,
      pages: ["index.html"],
      db: [],
      ai: [],
      languages: [{ name: "JavaScript", count: 1 }],
      sourceCount: 1,
    },
  };
  const f = buildArchitecture(p);
  assert.deepEqual(
    f.nodes.map((n) => n.id),
    ["screen"],
  );
  assert.deepEqual(f.edges, []);
});
test("route module connection is confirmed only by actual imports", () => {
  const route = {
    key: "route1",
    file: "app/api/a/route.ts",
    endpoint: "/api/a",
    methods: ["POST"],
    links: ["lib/storage.ts"],
    imports: ["@supabase/supabase-js"],
    dbUsed: ["@supabase/supabase-js"],
    aiUsed: [],
    language: "TypeScript",
  };
  const f = buildArchitecture(
    {
      stack: ["next"],
      inventory: {
        pageCount: 1,
        routeCount: 1,
        routeDetails: [route],
        db: ["@supabase/supabase-js"],
        ai: [],
      },
    },
    "route1",
  );
  assert.ok(f.edges.some((e) => e.to === "module" && e.confirmed));
  assert.ok(f.edges.some((e) => e.to === "db" && e.confirmed));
});
test("deployment snapshots distinguish production from latest preview", () => {
  const v = normalizeDeployment({
    id: "prj_test",
    name: "demo",
    targets: {
      production: {
        readyState: "READY",
        url: "demo.vercel.app",
        createdAt: 1792000000000,
      },
    },
    latestDeployments: [{ readyState: "ERROR", url: "preview.vercel.app" }],
  });
  assert.equal(v.state, "READY");
  assert.equal(v.target, "production");
  assert.equal(v.url, "https://demo.vercel.app");
});
test("Codex connector uses only initialization and read-only account methods", async () => {
  const { EventEmitter } = await import("node:events");
  const { PassThrough } = await import("node:stream");
  const { readCodexLimits } = await import("../lib/integrations.mjs");
  const methods = [];
  const fake = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {
      child.emit("exit", 0);
    };
    child.stdin.on("data", (chunk) => {
      const request = JSON.parse(chunk.toString());
      methods.push(request.method);
      if (request.method === "initialize")
        setImmediate(() =>
          child.stdout.write(JSON.stringify({ id: 1, result: {} }) + "\n"),
        );
      if (request.method === "account/rateLimits/read")
        setImmediate(() =>
          child.stdout.write(
            JSON.stringify({
              id: 2,
              result: {
                rateLimits: {
                  primary: { usedPercent: 25, windowDurationMins: 300 },
                },
              },
            }) + "\n",
          ),
        );
    });
    return child;
  };
  const v = await readCodexLimits({ spawnProcess: fake });
  assert.equal(v.remaining, 75);
  assert.deepEqual(methods, [
    "initialize",
    "initialized",
    "account/rateLimits/read",
  ]);
});
