import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  probeLocalHttp,
  checkProjectHttp,
  validateVerification,
} from "../lib/health.mjs";
import {
  analyzeImpact,
  summarizeHealth,
  attentionItems,
} from "../public/insights.js";
import { sourceInventory } from "../lib/project-analysis.mjs";

test("reverse impact finds pages and API through a shared module and terminates cycles", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "manage-impact-"));
  try {
    for (const folder of ["app/api/save", "lib"])
      await fs.mkdir(path.join(dir, folder), { recursive: true });
    await fs.writeFile(
      path.join(dir, "lib/store.ts"),
      "import { service } from './service'; export const store=1;",
    );
    await fs.writeFile(
      path.join(dir, "lib/service.ts"),
      "import { store } from './store'; export const service=1;",
    );
    await fs.writeFile(
      path.join(dir, "app/page.tsx"),
      "import { service } from '@/lib/service'; export default ()=>null;",
    );
    await fs.writeFile(
      path.join(dir, "app/api/save/route.ts"),
      "import { service } from '@/lib/service'; export function POST(){}",
    );
    await fs.writeFile(
      path.join(dir, "lib/unrelated.ts"),
      "export const unrelated=1;",
    );
    const inventory = await sourceInventory(dir);
    const result = analyzeImpact(inventory, "lib/store.ts");
    assert.deepEqual(
      result.direct.map((v) => v.path),
      ["lib/service.ts"],
    );
    assert.deepEqual(result.pages, ["app/page.tsx"]);
    assert.equal(result.routes[0].endpoint, "/api/save");
    assert.deepEqual(
      result.dependents.find((v) => v.path === "app/page.tsx").chain,
      ["lib/store.ts", "lib/service.ts", "app/page.tsx"],
    );
    assert.ok(!result.dependents.some((v) => v.path.includes("unrelated")));
    assert.equal(result.dependents.length, 3);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("deleted imported file is not invented as analyzed or safe", () => {
  const inventory = {
    impact: {
      files: [{ path: "page.ts", analyzed: true, kind: "page" }],
      edges: [],
      coverage: { analyzed: 1, total: 1 },
    },
  };
  const result = analyzeImpact(inventory, "deleted.ts");
  assert.equal(result.selected.analyzed, false);
  assert.deepEqual(result.routes, []);
});

test("HTTP health uses loopback root and never follows redirects or retains response content", async () => {
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits++;
    assert.equal(req.url, "/");
    res.writeHead(302, { Location: "http://external.invalid/private" });
    res.end("sensitive body");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const result = await probeLocalHttp(server.address().port);
    assert.equal(result.state, "redirect");
    assert.equal(result.status, 302);
    assert.equal(hits, 1);
    assert.ok(!JSON.stringify(result).includes("sensitive"));
    assert.ok(!JSON.stringify(result).includes("external"));
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("health handles protected routes and times out boundedly", async () => {
  let protect = true;
  const server = http.createServer((req, res) => {
    if (protect) {
      res.writeHead(401);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    assert.equal(
      (await probeLocalHttp(server.address().port)).state,
      "protected",
    );
    protect = false;
    assert.equal(
      (await probeLocalHttp(server.address().port, { timeout: 40 })).state,
      "timeout",
    );
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});

test("health skips ports owned by another project and ignores supplied URLs", async () => {
  const ports = [];
  await checkProjectHttp(
    {
      localPorts: [
        { port: 1234, owned: false },
        { port: 3456, owned: true, url: "http://external.invalid" },
      ],
    },
    async (port) => {
      ports.push(port);
      return { port, state: "ok" };
    },
  );
  assert.deepEqual(ports, [3456]);
  assert.throws(() => probeLocalHttp(0));
});

test("stale responses and superseded verification results cannot imply current health", () => {
  const now = Date.now(),
    time = new Date(now).toISOString();
  const p = {
    workspaceStamp: "new",
    health: {
      http: {
        checkedAt: time,
        results: [
          { checkedAt: new Date(now - 16 * 60000).toISOString(), state: "ok" },
        ],
      },
      verification: {
        test: { result: "failed", checkedAt: time, workspaceStamp: "old" },
      },
    },
  };
  assert.equal(summarizeHealth(p, now).state, "unknown");
  p.health.http.results = [{ checkedAt: time, state: "protected" }];
  assert.equal(summarizeHealth(p, now).state, "review");
  p.health.verification.test.workspaceStamp = "new";
  assert.equal(summarizeHealth(p, now).state, "review");
});

test("verification records retain manual provenance and reject invalid or future data", () => {
  const input = {
    kind: "test",
    result: "passed",
    note: "npm test",
    checkedAt: new Date().toISOString(),
  };
  const result = validateVerification(
    { ...input, source: "automatic" },
    "stamp",
  );
  assert.equal(result.source, "manual");
  assert.equal(result.workspaceStamp, "stamp");
  assert.throws(() =>
    validateVerification({ ...input, kind: "shell" }, "stamp"),
  );
  assert.throws(() =>
    validateVerification(
      { ...input, checkedAt: new Date(Date.now() + 86400000).toISOString() },
      "stamp",
    ),
  );
});

test("attention list puts recent errors before changes and links to the affected project", () => {
  const data = {
    googleConnected: true,
    projects: [
      {
        id: "demo",
        name: "Demo",
        changes: 1,
        changedFiles: [{ file: "lib.ts" }],
        health: {
          http: {
            results: [{ state: "error", checkedAt: new Date().toISOString() }],
          },
        },
      },
    ],
  };
  const items = attentionItems(data);
  assert.equal(items[0].view, "health");
  assert.equal(items[0].project, "demo");
  assert.equal(items[1].view, "impact");
});
test("paused providers do not trigger low-quota alarms and root 404 is reviewed separately", () => {
  assert.equal(
    summarizeHealth({
      health: {
        http: {
          results: [{ state: "timeout", checkedAt: new Date().toISOString() }],
        },
      },
    }).label,
    "로컬 응답 지연",
  );
  assert.deepEqual(
    attentionItems({
      projects: [],
      googleConnected: true,
      subscriptions: { Cursor: { status: "paused" } },
      usage: { Cursor: { remaining: 0, updatedAt: new Date().toISOString() } },
    }),
    [],
  );
  assert.equal(
    summarizeHealth({
      health: {
        http: {
          results: [
            {
              state: "route_missing",
              status: 404,
              checkedAt: new Date().toISOString(),
            },
          ],
        },
      },
    }).state,
    "review",
  );
  assert.equal(
    summarizeHealth({ localPorts: [{ port: 10000, owned: false }] }).label,
    "대상 제외",
  );
  assert.equal(summarizeHealth({ localPorts: [] }).label, "주소 미등록");
});
