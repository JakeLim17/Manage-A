import { test, after } from "node:test";
import http from "node:http";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "chronocode-test-"));
process.env.PROJECT_ROOT = path.join(temp, "projects");
process.env.DATA_DIR = path.join(temp, "data");
process.env.PORT = "4319";
await fs.mkdir(path.join(process.env.PROJECT_ROOT, "demo"), {
  recursive: true,
});
await fs.writeFile(
  path.join(process.env.PROJECT_ROOT, "demo", "package.json"),
  JSON.stringify({
    description: "Test project",
    dependencies: { react: "1" },
    scripts: { start: "node app.js" },
  }),
);
const { server, scanProjects, validateUsage, validateProject, parseGitStatus } =
  await import("../server.mjs");
await new Promise((r) => server.listen(4319, "127.0.0.1", r));
const base = "http://127.0.0.1:4319";
const post = (url, body, origin = base) =>
  fetch(base + url, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
after(async () => {
  await new Promise((r) => server.close(r));
  await fs.rm(temp, { recursive: true, force: true });
});
test("discovers real project metadata and leaves runtime state unknown", async () => {
  const ps = await scanProjects();
  assert.equal(ps.length, 1);
  assert.equal(ps[0].description, "Test project");
  assert.deepEqual(ps[0].stack, ["react"]);
  assert.equal(ps[0].status, "unknown");
});
test("service accounts protect writes, validate bindings and never verify an unbound project", async () => {
  assert.equal(
    (
      await post("/api/projects/demo", {
        serviceBindings: { github: { repository: "https://evil.test" } },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post("/api/projects/demo", {
        serviceBindings: { github: { accountLabel: "Work account" } },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await post(
        "/api/projects/demo/services",
        { provider: "github" },
        "https://evil.example",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await post(
        "/api/connections/service-accounts",
        { provider: "github", key: "unused-test-value" },
        "https://evil.example",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await post("/api/connections/service-accounts", {
        provider: "other",
        key: "unused-test-value",
      })
    ).status,
    400,
  );
  assert.equal(
    (await post("/api/projects/demo/services", { provider: "other" })).status,
    400,
  );
  const result = await (
    await post("/api/projects/demo/services", { provider: "github" })
  ).json();
  assert.equal(result.state, "error");
  const dashboard = await (await fetch(base + "/api/dashboard")).json();
  const project = dashboard.projects.find((p) => p.id === "demo");
  assert.equal(project.services.github.binding.accountLabel, "Work account");
  assert.equal(project.services.github.state, "error");
  assert.equal(project.services.github.accountName, undefined);
  assert.equal(typeof dashboard.serviceCredentials.github, "boolean");
  assert.equal(
    (await fetch(base + "/.local/service-credentials.json")).status,
    404,
  );
});
test("validates quotas instead of displaying invalid values", () => {
  for (const remaining of [-1, 101, "", NaN])
    assert.throws(() =>
      validateUsage({ provider: "Claude", remaining, resetAt: "" }),
    );
  assert.equal(
    validateUsage({ provider: "Claude", remaining: 0, resetAt: "" }).remaining,
    0,
  );
});
test("Git status keeps spaces, Korean filenames and both sides of renames", () => {
  const v = parseGitStatus(
    " M src/한 글.ts\0R  src/new.ts\0src/old.ts\0?? file.txt\0",
  );
  assert.deepEqual(v, [
    { status: "M", file: "src/한 글.ts" },
    { status: "R", file: "src/new.ts", previous: "src/old.ts" },
    { status: "??", file: "file.txt" },
  ]);
});
test("subscription and Cursor import persist metadata without raw account identity", async () => {
  const input = {
    provider: "Cursor",
    plan: "Ultra",
    status: "paused",
    historical: true,
    note: "사용자 기록",
  };
  assert.equal(
    (await post("/api/subscriptions", input, "https://evil.example")).status,
    403,
  );
  assert.equal((await post("/api/subscriptions", input)).status, 200);
  const csv =
    "Date,Model,Cost,Total Tokens,User\n2026-10-01T00:00:00Z,Test,0.25,500,private@example.test";
  assert.equal((await post("/api/cursor/import", { csv })).status, 200);
  const dashboard = await (await fetch(base + "/api/dashboard")).json();
  assert.equal(dashboard.subscriptions.Cursor.status, "paused");
  assert.equal(dashboard.subscriptions.Cursor.historical, true);
  assert.equal(dashboard.cursorActivity.events, 1);
  assert.ok(
    !JSON.stringify(dashboard.cursorActivity).includes("private@example"),
  );
  const disk = await fs.readFile(
    path.join(process.env.DATA_DIR, "settings.json"),
    "utf8",
  );
  assert.ok(!disk.includes("private@example"));
  assert.equal(
    (await post("/api/cursor/import", { csv: "Email,Secret\na,b" })).status,
    400,
  );
});
test("health and verification API persist evidence, protect writes and detect subsequent code changes", async () => {
  assert.equal(
    (await post("/api/projects/demo/health", {}, "https://evil.example"))
      .status,
    403,
  );
  const health = await post("/api/projects/demo/health", {
    url: "http://external.invalid",
  });
  assert.equal(health.status, 200);
  assert.deepEqual((await health.json()).results, []);
  const record = await post("/api/projects/demo/verification", {
    kind: "test",
    result: "passed",
    note: "fixture verification",
    checkedAt: new Date().toISOString(),
  });
  assert.equal(record.status, 200);
  const before = (await scanProjects())[0];
  assert.equal(before.health.verification.test.source, "manual");
  assert.equal(
    before.health.verification.test.workspaceStamp,
    before.workspaceStamp,
  );
  await fs.writeFile(
    path.join(process.env.PROJECT_ROOT, "demo", "new-source.js"),
    "export const changed=1;",
  );
  const after = (await scanProjects())[0];
  assert.notEqual(after.workspaceStamp, before.workspaceStamp);
  assert.equal(
    after.health.verification.test.workspaceStamp,
    before.workspaceStamp,
  );
  assert.equal((await post("/api/projects/missing/health", {})).status, 404);
});
test("rejects unsafe websites and broken flow references", () => {
  assert.throws(() => validateProject({ website: "javascript:alert(1)" }));
  assert.throws(() =>
    validateProject({
      flow: {
        nodes: [{ id: "a", label: "A" }],
        edges: [{ from: "a", to: "missing", label: "" }],
      },
    }),
  );
});
test("blocks cross-origin edits and DNS rebinding hosts", async () => {
  assert.equal(
    (
      await post(
        "/api/usage",
        { provider: "Claude", remaining: 10, resetAt: "" },
        "https://evil.example",
      )
    ).status,
    403,
  );
  const code = await new Promise((resolve, reject) => {
    http
      .get(
        base + "/api/dashboard",
        { headers: { Host: "evil.example:4319" } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      )
      .on("error", reject);
  });
  assert.equal(code, 403);
});
test("persists project edits and usage, including concurrent writes", async () => {
  const activityCount = (await (await fetch(base + "/api/dashboard")).json())
    .activity.length;
  const results = await Promise.all([
    post("/api/projects/demo", {
      name: "데모",
      status: "development",
      features: ["기록 저장"],
    }),
    post("/api/usage", {
      provider: "Claude",
      remaining: 62,
      resetAt: "",
      window: "주간",
    }),
  ]);
  assert.ok(results.every((r) => r.status === 200));
  const d = await (await fetch(base + "/api/dashboard")).json();
  assert.equal(d.projects[0].name, "데모");
  assert.equal(d.usage.Claude.remaining, 62);
  assert.equal(d.activity.length, activityCount + 2);
});
test("does not expose arbitrary files or secret settings", async () => {
  assert.equal((await fetch(base + "/.env")).status, 404);
  assert.equal((await fetch(base + "/.local/settings.json")).status, 404);
  const r = await fetch(base + "/");
  assert.equal(r.status, 200);
  assert.match(
    r.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
});
test("unconnected analytics returns no invented data", async () => {
  const r = await fetch(base + "/api/projects/demo/analytics?days=28");
  const d = await r.json();
  assert.equal(d.ga, null);
  assert.equal(d.search, null);
  assert.equal(
    (await fetch(base + "/api/projects/demo/analytics?days=100000")).status,
    400,
  );
});
test("source inventory ignores secrets and symlinks, identifies SEO evidence", async () => {
  const dir = path.join(temp, "source");
  await fs.mkdir(path.join(dir, "app", "api", "save"), { recursive: true });
  await fs.mkdir(path.join(dir, "public"));
  await fs.writeFile(
    path.join(dir, "app", "api", "save", "route.ts"),
    "export function POST() {}",
  );
  await fs.writeFile(path.join(dir, "public", "sitemap.xml"), "<urlset/>");
  await fs.writeFile(path.join(dir, "index.html"), "<title>Example</title>");
  await fs.symlink("/etc", path.join(dir, "linked"));
  const { sourceInventory } = await import("../server.mjs");
  const v = await sourceInventory(dir, { "@supabase/supabase-js": "1" });
  assert.deepEqual(v.routes, ["app/api/save/route.ts"]);
  assert.deepEqual(v.seo.sitemap, ["public/sitemap.xml"]);
  assert.equal(v.seo.title, true);
  assert.equal(v.seo.description, false);
  assert.deepEqual(v.db, ["@supabase/supabase-js"]);
});
test("flow editor rejects empty structures and non-text descriptions", () => {
  assert.throws(() => validateProject({ flow: { nodes: [], edges: [] } }));
  assert.throws(() =>
    validateProject({
      flow: {
        nodes: [{ id: "a", label: "A", detail: { bad: true } }],
        edges: [],
      },
    }),
  );
});
test("Google adapter requests period totals and independently maps GA4 and Search Console", async () => {
  const { generateKeyPairSync } = await import("node:crypto");
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const keyfile = path.join(temp, "google-test.json");
  await fs.writeFile(
    keyfile,
    JSON.stringify({
      client_email: "test@example.invalid",
      private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    }),
  );
  process.env.GOOGLE_APPLICATION_CREDENTIALS = keyfile;
  const original = globalThis.fetch,
    calls = [];
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("oauth2"))
      return Response.json({
        access_token: "test-only-token",
        expires_in: 3600,
      });
    const b = JSON.parse(options.body);
    calls.push({ url: String(url), body: b });
    if (String(url).includes("analyticsdata")) {
      if (!b.dimensions)
        return Response.json({
          rows: [
            {
              metricValues: [{ value: "10" }, { value: "20" }, { value: "30" }],
            },
          ],
        });
      return Response.json({ rows: [] });
    }
    if (!b.dimensions)
      return Response.json({
        rows: [{ clicks: 3, impressions: 100, ctr: 0.03, position: 9 }],
      });
    return Response.json({ rows: [] });
  };
  try {
    const { analytics } = await import("../server.mjs");
    const v = await analytics(
      { gaProperty: "123", searchSite: "sc-domain:example.com" },
      7,
    );
    assert.deepEqual(v.ga.totals, [10, 20, 30]);
    assert.equal(v.search.totals.clicks, 3);
    assert.deepEqual(v.errors, []);
    assert.equal(calls.length, 7);
    assert.ok(calls.some((c) => c.url.includes("sc-domain%3Aexample.com")));
    assert.equal(
      calls.find((c) => c.url.includes("analyticsdata")).body.dateRanges[0]
        .startDate,
      "7daysAgo",
    );
  } finally {
    globalThis.fetch = original;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }
});
test("Google connection rejects invalid files without returning their contents", async () => {
  const file = path.join(temp, "not-a-credential.json");
  await fs.writeFile(file, "private-marker-do-not-echo");
  const response = await post("/api/connections/google", {
    credentialPath: file,
  });
  const v = await response.json();
  assert.equal(response.status, 400);
  assert.ok(!JSON.stringify(v).includes("private-marker"));
});
test("analytics cache persists successful results and clears on property change", async () => {
  const original = globalThis.fetch;
  await post("/api/projects/demo", { gaProperty: "123" });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(
    temp,
    "google-test.json",
  );
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith(base)) return original(url, options);
    calls++;
    if (String(url).includes("oauth2"))
      return Response.json({ access_token: "fake", expires_in: 3600 });
    return Response.json({ rows: [] });
  };
  try {
    const live = await original(base + "/api/projects/demo/analytics?days=7");
    assert.equal(live.status, 200);
    const v = await live.json();
    assert.ok(v.ga);
    const prior = calls;
    const cached = await (
      await original(base + "/api/projects/demo/analytics?days=7&cached=1")
    ).json();
    assert.equal(calls, prior);
    assert.deepEqual(cached.ga.totals, [0, 0, 0]);
    await post("/api/projects/demo", { gaProperty: "456" });
    const cleared = await (
      await original(base + "/api/projects/demo/analytics?days=7&cached=1")
    ).json();
    assert.equal(cleared, null);
  } finally {
    globalThis.fetch = original;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }
});

test("API credential connection rejects invalid keys and cross origin without persisting secrets", async () => {
  const invalid = await post("/api/connections/api-usage", {
    provider: "OpenAI",
    key: "invalid",
  });
  assert.equal(invalid.status, 400);
  const foreign = await post(
    "/api/connections/api-usage",
    { provider: "Claude", key: "secret-not-to-be-stored" },
    "https://example.test",
  );
  assert.equal(foreign.status, 403);
  await assert.rejects(
    fs.access(path.join(process.env.DATA_DIR, "api-credentials.json")),
  );
  assert.equal((await fetch(base + "/api-credentials.json")).status, 404);
});
