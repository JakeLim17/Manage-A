import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createServiceAccounts,
  detectServiceBindings,
  githubRepository,
  validateServiceBindings,
  serviceRows,
  bindingKey,
} from "../lib/service-accounts.mjs";
import { connectionPrompt } from "../public/connection-prompts.js";
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "manage-a-services-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
function response(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("service evidence strips remote credentials and rejects paths or secrets in identity fields", () => {
  assert.equal(
    githubRepository(
      "https://user:private-token@github.com/acme/app.git?secret=hidden",
    ),
    "acme/app",
  );
  assert.equal(githubRepository("git@github.com:acme/app.git"), "acme/app");
  assert.equal(
    githubRepository("ssh://git@github.com/acme/app.git"),
    "acme/app",
  );
  assert.equal(githubRepository("https://evil.test/acme/app"), "");
  assert.equal(githubRepository("https://github.com/acme/.."), "");
  for (const value of [
    { cloudflare: { accountId: "../../etc" } },
    { vercel: { projectId: "https://evil.test" } },
    { github: { repository: "acme/app", token: "private" } },
    { github: { accountLabel: "ghp_this_is_a_secret" } },
    { supabase: { projectRef: "abc\n" } },
  ])
    assert.throws(() => validateServiceBindings(value));
});

test("discovery reads allowlisted linkage files, skips symlinks and never uses env credentials", async (t) => {
  const dir = await fixture(t);
  await fs.mkdir(path.join(dir, ".vercel"));
  await fs.mkdir(path.join(dir, "supabase", ".temp"), { recursive: true });
  await fs.writeFile(
    path.join(dir, ".vercel", "project.json"),
    JSON.stringify({
      projectId: "prj_demo",
      orgId: "team_real",
      secret: "never-return",
    }),
  );
  await fs.writeFile(
    path.join(dir, "supabase", ".temp", "project-ref"),
    "abcdefghijklmnopqrst",
  );
  await fs.writeFile(
    path.join(dir, "wrangler.toml"),
    'account_id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"\nsecret = "never-return"',
  );
  await fs.writeFile(
    path.join(dir, ".env"),
    "SUPABASE_URL=https://wrongproject.supabase.co\nSECRET=never-return",
  );
  const found = await detectServiceBindings(dir);
  assert.equal(found.vercel.projectId, "prj_demo");
  assert.equal(found.supabase.projectRef, "abcdefghijklmnopqrst");
  assert.equal(found.cloudflare.accountId, "a".repeat(32));
  assert.ok(!JSON.stringify(found).includes("never-return"));
  await fs.rm(path.join(dir, "supabase"), { recursive: true });
  await fs.mkdir(path.join(dir, "outside", ".temp"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "outside", ".temp", "project-ref"),
    "wrongprojectabcdefgh",
  );
  await fs.symlink(path.join(dir, "outside"), path.join(dir, "supabase"));
  assert.equal(
    (await detectServiceBindings(dir)).supabase.projectRef,
    undefined,
  );
  const manual = await detectServiceBindings(dir, {
    vercel: { projectId: "prj_manual" },
  });
  assert.equal(manual.vercel.projectId, "prj_manual");
  assert.equal(manual.vercel.source, "직접 지정");
});

test("GitHub identifies repository owner separately from authenticated viewer and returns no token", async (t) => {
  const dir = await fixture(t);
  const calls = [];
  const client = createServiceAccounts({
    dataDir: dir,
    env: {},
    run: async (binary, args) => {
      calls.push([binary, args]);
      return {
        stdout: JSON.stringify(
          args[1] === "/user"
            ? { login: "viewer" }
            : { full_name: "acme/app", owner: { id: 45, login: "acme" } },
        ),
      };
    },
  });
  const value = await client.verify("github", {
    repository: "acme/app",
    source: "Git origin",
  });
  assert.equal(value.state, "connected");
  assert.equal(value.accountName, "acme");
  assert.equal(value.actor, "viewer");
  assert.deepEqual(
    calls.map((c) => c[1][0]),
    ["api", "api"],
  );
  const failure = createServiceAccounts({
    dataDir: dir,
    env: {},
    run: async () => ({
      stdout: JSON.stringify({
        login: "viewer",
        full_name: "wrong/app",
        owner: { login: "wrong" },
      }),
    }),
  });
  assert.equal(
    (await failure.verify("github", { repository: "acme/app" })).state,
    "error",
  );
});

test("Vercel team must match project account, and token connection is read-only and private", async (t) => {
  const dir = await fixture(t);
  const key = "test-read-token-account";
  const calls = [];
  const client = createServiceAccounts({
    dataDir: dir,
    env: {},
    fetchImpl: async (url, options) => {
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.Authorization, `Bearer ${key}`);
      calls.push(url);
      if (url.endsWith("/v2/user"))
        return response({
          user: { uid: "viewer_id", email: "viewer@example.test" },
        });
      if (url.includes("/v9/projects/"))
        return response({
          id: "prj_demo",
          accountId: "team_acme",
          name: "app",
          secret: key,
        });
      return response({ id: "team_acme", name: "Acme" });
    },
  });
  assert.deepEqual(await client.connect("vercel", key), {
    provider: "vercel",
    configured: true,
  });
  assert.equal(
    (await fs.stat(path.join(dir, "service-credentials.json"))).mode & 0o777,
    0o600,
  );
  const value = await client.verify("vercel", {
    projectId: "prj_demo",
    orgId: "team_acme",
  });
  assert.equal(value.state, "connected");
  assert.equal(value.accountName, "Acme");
  assert.equal(value.actor, "viewer@example.test");
  assert.ok(calls.some((u) => u.endsWith("?teamId=team_acme")));
  assert.ok(!JSON.stringify(value).includes(key));
  const mismatch = await client.verify("vercel", {
    projectId: "prj_demo",
    orgId: "team_other",
  });
  assert.equal(mismatch.state, "error");
  assert.equal(mismatch.accountName, undefined);
  assert.deepEqual(await client.configured(), {
    github: false,
    vercel: true,
    supabase: false,
    cloudflare: false,
  });
});

test("Supabase requires exact project and organization, supports official CLI without token", async (t) => {
  const dir = await fixture(t);
  let orgId = "correct-org";
  const calls = [];
  const client = createServiceAccounts({
    dataDir: dir,
    env: {},
    run: async (binary, args) => {
      calls.push(args);
      return {
        stdout: JSON.stringify(
          args[0] === "projects"
            ? [
                {
                  ref: "abcdefghijklmnopqrst",
                  organization_id: "correct-org",
                  name: "Application",
                  database: { password: "never-return" },
                },
              ]
            : [{ id: orgId, name: "Company" }],
        ),
      };
    },
  });
  const good = await client.verify("supabase", {
    projectRef: "abcdefghijklmnopqrst",
  });
  assert.equal(good.state, "connected");
  assert.equal(good.accountName, "Company");
  assert.equal(good.source, "Supabase 공식 CLI / API");
  assert.ok(!JSON.stringify(good).includes("never-return"));
  assert.deepEqual(calls[0], ["projects", "list", "--output", "json"]);
  assert.deepEqual(await client.projects(), [{ projectRef: "abcdefghijklmnopqrst", name: "Application", organization: "Company" }]);
  orgId = "unrelated-org";
  assert.equal(
    (await client.verify("supabase", { projectRef: "abcdefghijklmnopqrst" }))
      .state,
    "error",
  );
  assert.equal(
    (await client.verify("supabase", { projectRef: "xxxxxxxxxxxxxxxxxxxx" }))
      .state,
    "error",
  );
});

test("Cloudflare account mismatch, permission failure and missing keys cannot be connected", async (t) => {
  const dir = await fixture(t);
  let mode = "ok";
  const key = "test-cloudflare-read-token";
  const client = createServiceAccounts({
    dataDir: dir,
    env: { CLOUDFLARE_API_TOKEN: key },
    fetchImpl: async () =>
      mode === "denied"
        ? response({ message: key }, 403)
        : response({
            success: true,
            result: {
              id: (mode === "wrong" ? "b" : "a").repeat(32),
              name: "Network account",
            },
          }),
  });
  assert.equal(
    (await client.verify("cloudflare", { accountId: "a".repeat(32) }))
      .accountName,
    "Network account",
  );
  mode = "wrong";
  assert.equal(
    (await client.verify("cloudflare", { accountId: "a".repeat(32) })).state,
    "error",
  );
  mode = "denied";
  const denied = await client.verify("cloudflare", {
    accountId: "a".repeat(32),
  });
  assert.equal(denied.state, "error");
  assert.ok(!JSON.stringify(denied).includes(key));
  const empty = createServiceAccounts({ dataDir: dir, env: {} });
  assert.equal(
    (await empty.verify("vercel", { projectId: "prj_demo" })).state,
    "error",
  );
});

test("identity changes invalidate snapshots, old results are stale and manual notes never verify", () => {
  const b = {
    github: { repository: "acme/app", source: "Git origin" },
    vercel: { source: "none" },
    supabase: { source: "none" },
    cloudflare: { source: "none" },
  };
  const now = Date.now();
  const snapshots = {
    github: {
      state: "connected",
      accountName: "Acme",
      bindingKey: bindingKey(b.github),
      checkedAt: new Date(now - 16 * 60000).toISOString(),
    },
  };
  assert.equal(serviceRows(b, snapshots, now).github.state, "stale");
  b.github.repository = "other/app";
  assert.equal(serviceRows(b, snapshots, now).github.accountName, undefined);
  b.github.accountLabel = "my work account";
  assert.equal(serviceRows(b, {}, now).github.state, "unverified");
  assert.equal(serviceRows(b, {}, now).supabase.state, "unlinked");
});

test("AI connection requests explain provider limitations and never claim automatic Cursor quotas", () => {
  const usage = connectionPrompt("usage");
  const services = connectionPrompt("services", "example-app");
  assert.ok(usage.includes("CSV"));
  assert.ok(usage.includes("구독 한도와 별도"));
  assert.ok(usage.includes("토큰·비밀번호"));
  assert.ok(
    services.includes("로그인 계정을 모든 프로젝트의 소유자로 추정하지"),
  );
  assert.ok(services.includes("example-app"));
  assert.ok(services.includes("/api/projects/"));
});
