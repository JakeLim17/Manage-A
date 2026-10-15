import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
export const serviceProviders = ["github", "vercel", "supabase", "cloudflare"];
const envNames = {
  github: "GITHUB_TOKEN",
  vercel: "VERCEL_TOKEN",
  supabase: "SUPABASE_ACCESS_TOKEN",
  cloudflare: "CLOUDFLARE_API_TOKEN",
};
const hosts = {
  github: "https://api.github.com",
  vercel: "https://api.vercel.com",
  supabase: "https://api.supabase.com",
  cloudflare: "https://api.cloudflare.com/client/v4",
};
const text = (v) =>
  typeof v === "string" ? v.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 180) : "";
export function githubRepository(remote) {
  let value = String(remote || "").trim();
  const ssh = value.match(
    /^(?:git@github\.com:|ssh:\/\/git@github\.com\/)([^?#]+)$/i,
  );
  if (ssh) value = ssh[1];
  else {
    try {
      const u = new URL(value);
      if (u.hostname.toLowerCase() !== "github.com" || u.protocol !== "https:")
        return "";
      value = u.pathname.slice(1);
    } catch {
      return "";
    }
  }
  value = value.replace(/\.git$/, "").replace(/\/$/, "");
  return /^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9_.-]{1,100}$/i.test(value) &&
    ![".", ".."].includes(value.split("/")[1])
    ? value
    : "";
}
export function validateServiceBindings(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !serviceProviders.includes(k))
  )
    throw new Error("서비스 연결 형식을 확인하세요.");
  const rules = {
    github: { repository: /^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9_.-]{1,100}$/i },
    vercel: {
      projectId: /^prj_[a-z0-9]{1,100}$/i,
      orgId: /^[a-z0-9_-]{1,100}$/i,
    },
    supabase: { projectRef: /^[a-z0-9]{8,40}$/ },
    cloudflare: { accountId: /^[a-f0-9]{32}$/i },
  };
  const out = {};
  for (const [provider, fields] of Object.entries(input)) {
    if (
      !fields ||
      typeof fields !== "object" ||
      Array.isArray(fields) ||
      Object.keys(fields).some(
        (k) => !(k in rules[provider]) && k !== "accountLabel",
      )
    )
      throw new Error("서비스 연결 항목을 확인하세요.");
    out[provider] = {};
    for (const [key, value] of Object.entries(fields)) {
      if (
        typeof value !== "string" ||
        value.length > 180 ||
        /[\x00-\x1f\x7f]/.test(value)
      )
        throw new Error("서비스 연결 값이 올바르지 않아요.");
      const v = value.trim();
      if (key !== "accountLabel" && v && !rules[provider][key].test(v))
        throw new Error("프로젝트 ID 또는 계정 ID 형식을 확인하세요.");
      if (
        provider === "github" &&
        key === "repository" &&
        v &&
        githubRepository("https://github.com/" + v) !== v
      )
        throw new Error("GitHub 저장소 형식을 확인하세요.");
      if (
        key === "accountLabel" &&
        /(?:gh[pousr]_|github_pat_|sbp_|sk-ant-|Bearer\s)/i.test(v)
      )
        throw new Error("계정 메모에는 인증 키를 입력하지 마세요.");
      out[provider][key] = v;
    }
  }
  return out;
}
async function metadata(dir, relative) {
  try {
    const parts = relative.split("/");
    let target = dir;
    for (const part of parts) {
      target = path.join(target, part);
      const s = await fs.lstat(target);
      if (s.isSymbolicLink()) return "";
    }
    const st = await fs.stat(target);
    if (!st.isFile() || st.size > 65536) return "";
    return await fs.readFile(target, "utf8");
  } catch {
    return "";
  }
}
export async function detectServiceBindings(dir, custom = {}) {
  let remote = "";
  try {
    remote = (
      await exec("git", ["-C", dir, "remote", "get-url", "origin"], {
        timeout: 3000,
        maxBuffer: 65536,
      })
    ).stdout;
  } catch {}
  let vercel = {};
  try {
    const v = JSON.parse(await metadata(dir, ".vercel/project.json"));
    vercel = { projectId: v.projectId, orgId: v.orgId };
  } catch {}
  const ref = (await metadata(dir, "supabase/.temp/project-ref")).trim();
  let cloud = "";
  let cloudSource = "";
  for (const file of ["wrangler.toml", "wrangler.json", "wrangler.jsonc"]) {
    const content = await metadata(dir, file);
    const match = content.match(
      /^\s*(?:"account_id"|account_id)\s*[:=]\s*["']([a-f0-9]{32})["']/im,
    );
    if (match) {
      cloud = match[1];
      cloudSource = file;
      break;
    }
  }
  const candidates = {
    github: { repository: githubRepository(remote) },
    vercel,
    supabase: { projectRef: ref },
    cloudflare: { accountId: cloud },
  };
  const sources = {
    github: "Git origin",
    vercel: ".vercel/project.json",
    supabase: "supabase/.temp/project-ref",
    cloudflare: cloudSource,
  };
  const result = {};
  for (const p of serviceProviders) {
    const manual = Object.hasOwn(custom, p);
    let binding = {};
    if (manual) binding = validateServiceBindings({ [p]: custom[p] })[p];
    else
      for (const [k, v] of Object.entries(candidates[p])) {
        try {
          if (v)
            binding = {
              ...binding,
              ...validateServiceBindings({ [p]: { [k]: v } })[p],
            };
        } catch {}
      }
    result[p] = {
      ...binding,
      source: manual ? "직접 지정" : sources[p] || "연결 정보 없음",
    };
  }
  return result;
}
export function bindingKey(binding) {
  return JSON.stringify(binding);
}
export function serviceRows(bindings, snapshots = {}, now = Date.now()) {
  return Object.fromEntries(
    serviceProviders.map((provider) => {
      const binding = bindings[provider];
      const previous = snapshots[provider];
      const target =
        binding.repository ||
        binding.projectId ||
        binding.projectRef ||
        binding.accountId ||
        "";
      const valid = previous?.bindingKey === bindingKey(binding);
      const snapshot = valid ? previous : null;
      const expired =
        snapshot?.state === "connected" &&
        now - Date.parse(snapshot.checkedAt) > 15 * 60000;
      const { bindingKey: unused, ...safe } = snapshot || {};
      return [
        provider,
        {
          provider,
          binding,
          target,
          ...safe,
          state: expired
            ? "stale"
            : snapshot?.state || (target ? "unverified" : "unlinked"),
        },
      ];
    }),
  );
}
export function createServiceAccounts({
  dataDir,
  env = process.env,
  fetchImpl = fetch,
  run = exec,
}) {
  const file = path.join(dataDir, "service-credentials.json");
  let queue = Promise.resolve();
  async function keys() {
    try {
      return JSON.parse(await fs.readFile(file, "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return {};
      throw new Error("서비스 인증 파일을 읽지 못했어요.");
    }
  }
  async function token(provider) {
    return (await keys())[provider] || env[envNames[provider]] || "";
  }
  async function request(provider, endpoint, key) {
    const response = await fetchImpl(hosts[provider] + endpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        "User-Agent": "Manage-A",
      },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok)
      throw new Error(
        `공식 API 조회 실패 (${response.status}). 해당 계정·프로젝트의 읽기 권한을 확인하세요.`,
      );
    const raw = await response.text();
    if (raw.length > 2 * 1024 * 1024)
      throw new Error("응답 크기 제한을 초과했어요.");
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error("공식 API 응답을 해석하지 못했어요.");
    }
    if (provider === "cloudflare" && value.success !== true)
      throw new Error("Cloudflare 계정 읽기 응답을 확인하세요.");
    return value;
  }
  async function gh(endpoint, key) {
    if (key) return request("github", endpoint, key);
    try {
      const value = await run(env.GH_BIN || "gh", ["api", endpoint], {
        timeout: 12000,
        maxBuffer: 1024 * 1024,
        env: { ...env, GH_PROMPT_DISABLED: "1" },
      });
      return JSON.parse(value.stdout);
    } catch {
      throw new Error("GitHub CLI 로그인 또는 읽기 토큰을 연결하세요.");
    }
  }
  async function configured() {
    const saved = await keys();
    return Object.fromEntries(
      serviceProviders.map((p) => [p, !!(saved[p] || env[envNames[p]])]),
    );
  }
  async function connect(provider, key) {
    if (
      !serviceProviders.includes(provider) ||
      typeof key !== "string" ||
      !/^[-A-Za-z0-9._=]{12,4096}$/.test(key)
    )
      throw new Error("서비스와 읽기 토큰 형식을 확인하세요.");
    const endpoint = {
      github: "/user",
      vercel: "/v2/user",
      supabase: "/v1/organizations",
      cloudflare: "/accounts?per_page=1",
    }[provider];
    const value = await request(provider, endpoint, key);
    if (
      (provider === "github" && !value.login) ||
      (provider === "vercel" && !(value.user?.id || value.user?.uid)) ||
      (provider === "supabase" && !Array.isArray(value)) ||
      (provider === "cloudflare" && !Array.isArray(value.result))
    )
      throw new Error("계정 읽기 응답이 올바르지 않아요.");
    const task = queue.then(async () => {
      const all = await keys();
      all[provider] = key;
      await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
      const temp = file + ".tmp";
      await fs.writeFile(temp, JSON.stringify(all), { mode: 0o600 });
      await fs.chmod(temp, 0o600);
      await fs.rename(temp, file);
    });
    queue = task.catch(() => {});
    await task;
    return { provider, configured: true };
  }
  async function verify(provider, binding) {
    const result = {
      provider,
      checkedAt: new Date().toISOString(),
      bindingKey: bindingKey(binding),
    };
    try {
      validateServiceBindings({
        [provider]: Object.fromEntries(
          Object.entries(binding).filter(([k]) => k !== "source"),
        ),
      });
      const key = await token(provider);
      if (!["github", "supabase"].includes(provider) && !key)
        throw new Error("읽기 토큰을 연결한 뒤 계정을 확인하세요.");
      const target =
        binding.repository ||
        binding.projectId ||
        binding.projectRef ||
        binding.accountId;
      if (!target) throw new Error("프로젝트별 연결 ID를 먼저 지정하세요.");
      const clean = (v) => {
        return key && typeof v === "string" && v.includes(key)
          ? "표시 제외"
          : text(v);
      };
      let accountId = "",
        accountName = "",
        actor = "",
        resourceName = "",
        resourceUrl = "";
      if (provider === "github") {
        const [u, r] = await Promise.all([
          gh("/user", key),
          gh("/repos/" + binding.repository, key),
        ]);
        if (
          String(r.full_name).toLowerCase() !==
            binding.repository.toLowerCase() ||
          !u.login ||
          !r.owner?.login
        )
          throw new Error("저장소와 조회 계정 응답이 일치하지 않아요.");
        accountId = String(r.owner.id || "");
        accountName = r.owner.login;
        actor = u.login;
        resourceName = r.full_name;
        resourceUrl = "https://github.com/" + r.full_name;
      } else if (provider === "vercel") {
        const query = binding.orgId?.startsWith("team_")
          ? "?teamId=" + encodeURIComponent(binding.orgId)
          : "";
        const r = await request(
          provider,
          "/v9/projects/" + encodeURIComponent(binding.projectId) + query,
          key,
        );
        if (
          r.id !== binding.projectId ||
          !r.accountId ||
          (binding.orgId && binding.orgId !== r.accountId)
        )
          throw new Error("Vercel 프로젝트와 소속 계정 ID가 일치하지 않아요.");
        accountId = r.accountId;
        resourceName = r.name;
        if (accountId.startsWith("team_")) {
          const t = await request(
            provider,
            "/v2/teams/" + encodeURIComponent(accountId),
            key,
          );
          if (t.id !== accountId)
            throw new Error("Vercel 팀 응답이 일치하지 않아요.");
          accountName = t.name || t.slug;
        } else accountName = accountId;
        try {
          const u = (await request(provider, "/v2/user", key)).user;
          actor = u?.email || u?.username;
          if ((u?.id || u?.uid) === accountId)
            accountName = u.name || u.username || u.email;
        } catch {}
        resourceUrl = "https://vercel.com/dashboard";
      } else if (provider === "supabase") {
        const supabaseList = async (kind) => {
          if (key)
            return request(
              provider,
              kind === "projects" ? "/v1/projects" : "/v1/organizations",
              key,
            );
          try {
            return JSON.parse(
              (
                await run(
                  env.SUPABASE_BIN || "supabase",
                  [kind, "list", "--output", "json"],
                  { timeout: 15000, maxBuffer: 1024 * 1024, env },
                )
              ).stdout,
            );
          } catch {
            throw new Error(
              "Supabase CLI 로그인 또는 Management 읽기 토큰을 연결하세요.",
            );
          }
        };
        const projects = await supabaseList("projects");
        if (!Array.isArray(projects))
          throw new Error("Supabase 프로젝트 목록 응답을 확인하세요.");
        const r = projects.find((p) => (p.ref || p.id) === binding.projectRef);
        if (!r?.organization_id)
          throw new Error(
            "이 토큰에서 지정한 Supabase 프로젝트를 찾지 못했어요.",
          );
        const orgs = await supabaseList("orgs");
        const org =
          Array.isArray(orgs) &&
          orgs.find(
            (o) =>
              o.id === r.organization_id ||
              (r.organization_slug && o.slug === r.organization_slug),
          );
        if (!org)
          throw new Error("프로젝트의 Supabase 조직을 확인하지 못했어요.");
        accountId = r.organization_id;
        accountName = org.name || org.slug || org.id;
        resourceName = r.name;
        resourceUrl =
          "https://supabase.com/dashboard/project/" + binding.projectRef;
      } else {
        const value = await request(
          provider,
          "/accounts/" + binding.accountId,
          key,
        );
        const a = value.result;
        if (a?.id !== binding.accountId || !a.name)
          throw new Error("Cloudflare 계정 ID 응답이 일치하지 않아요.");
        accountId = a.id;
        accountName = a.name;
        resourceName = "구성에 지정한 계정 접근 확인";
        resourceUrl = "https://dash.cloudflare.com/" + binding.accountId;
      }
      return {
        ...result,
        state: "connected",
        accountId: clean(accountId),
        accountName: clean(accountName),
        actor: clean(actor),
        resourceName: clean(resourceName),
        resourceUrl,
        source:
          provider === "github" && !key
            ? "GitHub 공식 CLI / API"
            : provider === "supabase" && !key
              ? "Supabase 공식 CLI / API"
              : "공식 읽기 API",
      };
    } catch (e) {
      return {
        ...result,
        state: "error",
        reason:
          e.message?.startsWith("공식 API 조회 실패") ||
          /^(GitHub CLI|읽기 토큰|프로젝트별|저장소와|Vercel |프로젝트의 Supabase|Supabase |이 토큰에서|Cloudflare )/.test(
            e.message,
          )
            ? e.message
            : "계정 조회가 완료되지 않았어요. 네트워크와 읽기 권한을 확인하세요.",
      };
    }
  }
  async function projects() {
    const key = await token("supabase");
    const list = async (kind) => {
      if (key)
        return request(
          "supabase",
          kind === "projects" ? "/v1/projects" : "/v1/organizations",
          key,
        );
      try {
        return JSON.parse(
          (
            await run(
              env.SUPABASE_BIN || "supabase",
              [kind, "list", "--output", "json"],
              { timeout: 15000, maxBuffer: 1024 * 1024, env },
            )
          ).stdout,
        );
      } catch {
        throw new Error(
          "Supabase CLI 로그인 또는 Management 읽기 토큰을 연결하세요.",
        );
      }
    };
    const [resources, organizations] = await Promise.all([
      list("projects"),
      list("orgs"),
    ]);
    if (!Array.isArray(resources) || !Array.isArray(organizations))
      throw new Error("Supabase 목록 응답을 확인하세요.");
    return resources.slice(0, 200).flatMap((p) => {
      const ref = p.ref || p.id;
      if (!/^[a-z0-9]{8,40}$/.test(ref || "")) return [];
      const org = organizations.find(
        (o) =>
          o.id === p.organization_id ||
          (p.organization_slug && o.slug === p.organization_slug),
      );
      return [
        {
          projectRef: ref,
          name: text(p.name),
          organization: text(org?.name || p.organization_id),
        },
      ];
    });
  }
  return { configured, connect, verify, projects };
}
