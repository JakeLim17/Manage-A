import fs from "node:fs/promises";
import path from "node:path";
const ignored = new Set([
  "node_modules",
  "vendor",
  "dist",
  "build",
  "coverage",
  "__pycache__",
  "Pods",
  "DerivedData",
  "output",
  "data",
  "uploads",
  "exports",
]);
const priority = [
  "src",
  "app",
  "apps",
  "pages",
  "api",
  "server",
  "lib",
  "components",
  "prisma",
  "supabase",
];
const languages = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".swift": "Swift",
  ".py": "Python",
  ".go": "Go",
  ".rs": "Rust",
  ".css": "CSS",
  ".scss": "SCSS",
  ".html": "HTML",
  ".sql": "SQL",
  ".prisma": "Prisma",
  ".vue": "Vue",
  ".svelte": "Svelte",
};
const safeRead = async (file) => {
  try {
    const st = await fs.stat(file);
    return st.size <= 128 * 1024 ? await fs.readFile(file, "utf8") : "";
  } catch {
    return "";
  }
};
export async function sourceInventory(dir, dep = {}) {
  const found = [];
  let visited = 0,
    truncated = false;
  async function walk(base, depth = 0) {
    if (depth > 8) {
      truncated = true;
      return;
    }
    let entries;
    try {
      entries = await fs.readdir(base, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => {
      const pa = priority.indexOf(a.name),
        pb = priority.indexOf(b.name);
      return (
        (pa < 0 ? 999 : pa) - (pb < 0 ? 999 : pb) ||
        a.name.localeCompare(b.name)
      );
    });
    for (const e of entries) {
      if (e.name.startsWith(".") || ignored.has(e.name) || e.isSymbolicLink())
        continue;
      if (++visited > 3000) {
        truncated = true;
        return;
      }
      const full = path.join(base, e.name);
      if (e.isDirectory()) await walk(full, depth + 1);
      else if (!/lock|credential|secret|service.account/i.test(e.name))
        found.push(path.relative(dir, full));
    }
  }
  await walk(dir);
  const manifests = found
      .filter((f) => f.endsWith("package.json"))
      .slice(0, 12),
    scriptCommands = [];
  for (const file of manifests) {
    try {
      const p = JSON.parse(await safeRead(path.join(dir, file)));
      Object.assign(dep, p.dependencies, p.devDependencies);
      for (const [name, command] of Object.entries(p.scripts || {}))
        if (
          ["dev", "start", "serve"].includes(name) &&
          typeof command === "string"
        )
          scriptCommands.push({ file, name, command: command.slice(0, 180) });
    } catch {}
  }
  const routesAll = found.filter(
    (f) =>
      /(?:^|\/)app\/(?:.*\/)?route\.[jt]s$/.test(f) ||
      /(?:^|\/)pages\/api\/.*\.[jt]s$/.test(f) ||
      /^api\/.*\.[jt]s$/.test(f),
  );
  const pagesAll = found.filter(
    (f) =>
      /(?:^|\/)index\.html$/.test(f) ||
      /(?:^|\/)app\/.*page\.[jt]sx?$/.test(f) ||
      (/(?:^|\/)pages\/.*\.[jt]sx?$/.test(f) && !/(?:^|\/)api\//.test(f)),
  );
  const db = Object.keys(dep).filter((k) =>
    /supabase|prisma|drizzle|mongoose|^pg$|firebase|sqlite/.test(k),
  );
  const ai = Object.keys(dep).filter((k) =>
    /anthropic|openai|^ai$|@ai-sdk|generative-ai|@google\/genai/.test(k),
  );
  const counts = {};
  for (const f of found) {
    const lang = languages[path.extname(f)];
    if (lang) counts[lang] = (counts[lang] || 0) + 1;
  }
  const languageCounts = Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  const sourceFiles = found.filter((f) => languages[path.extname(f)]),
    fileSet = new Set(found);
  function codeImports(code, file) {
    const imports = [
      ...code.matchAll(
        /(?:from\s*|import\s*|require\s*\()\s*['"]([^'"\n]+)['"]/g,
      ),
    ].map((m) => m[1]);
    const links = [];
    for (const spec of imports.slice(0, 30)) {
      const targets = [];
      if (spec.startsWith("."))
        targets.push(
          path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)),
        );
      if (spec.startsWith("@/")) {
        const pkgBase = file.includes("/src/")
          ? file.split("/src/")[0] + "/"
          : file.includes("/app/")
            ? file.split("/app/")[0] + "/"
            : "";
        targets.push(
          pkgBase + "src/" + spec.slice(2),
          pkgBase + spec.slice(2),
          "src/" + spec.slice(2),
          spec.slice(2),
        );
      }
      const resolved = targets
        .flatMap((t) => [
          t,
          ...[
            ".ts",
            ".tsx",
            ".js",
            ".mjs",
            ".jsx",
            "/index.ts",
            "/index.js",
          ].map((e) => t + e),
        ])
        .find((t) => fileSet.has(t));
      if (resolved && !links.includes(resolved)) links.push(resolved);
    }
    return { imports: imports.slice(0, 16), links };
  }
  const routeDetails = [];
  for (const file of routesAll.slice(0, 50)) {
    const code = await safeRead(path.join(dir, file));
    const methods = [
      ...new Set(
        [
          ...code.matchAll(
            /export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g,
          ),
        ].map((m) => m[1]),
      ),
    ];
    const { imports, links } = codeImports(code, file);
    let endpoint = file
      .replace(/^.*?(?:src\/)?app\//, "/")
      .replace(/\/route\.[jt]s$/, "")
      .replace(/\/\([^/]+\)/g, "");
    if (file.includes("pages/"))
      endpoint =
        "/" +
        file
          .split("pages/")[1]
          .replace(/\.[jt]s$/, "")
          .replace(/\/index$/, "");
    routeDetails.push({
      file,
      endpoint: endpoint || "/",
      methods,
      imports: imports.slice(0, 16),
      links,
      language: languages[path.extname(file)] || "미확인",
    });
  }
  const frameworkEvidence = [];
  for (const file of sourceFiles
    .filter((f) => f.endsWith(".swift"))
    .slice(0, 100)) {
    const code = await safeRead(path.join(dir, file));
    for (const match of code.matchAll(
      /^import\s+(SwiftData|CoreData|HealthKit|WatchConnectivity)\b/gm,
    )) {
      frameworkEvidence.push({ name: match[1], file });
      if (
        ["SwiftData", "CoreData"].includes(match[1]) &&
        !db.includes(match[1])
      )
        db.push(match[1]);
    }
  }
  for (const file of sourceFiles
    .filter(
      (f) =>
        /\.(?:[cm]?[jt]s|py)$/.test(f) &&
        !/(?:^|\/)(?:tests?|__tests__|scripts)\//.test(f) &&
        !routesAll.includes(f),
    )
    .slice(0, 100)) {
    const code = await safeRead(path.join(dir, file));
    const candidates = [];
    for (const m of code.matchAll(
      /(?:app|router)\.(get|post|put|patch|delete|head|options)\(\s*['"]([^'"\n]+)['"]/g,
    ))
      candidates.push({ endpoint: m[2], methods: [m[1].toUpperCase()] });
    for (const m of code.matchAll(
      /url\.pathname\s*===\s*['"](\/api\/[^'"\n]+)['"]/g,
    )) {
      const tail = code.slice(m.index, m.index + 180),
        method = tail.match(/req\.method\s*===\s*['"]([A-Z]+)['"]/);
      candidates.push({ endpoint: m[1], methods: method ? [method[1]] : [] });
    }
    const { imports, links } = codeImports(code, file);
    for (const item of candidates)
      if (
        !routeDetails.some(
          (r) =>
            r.endpoint === item.endpoint &&
            r.methods.join() === item.methods.join(),
        )
      )
        routeDetails.push({
          file,
          ...item,
          imports,
          links,
          language: languages[path.extname(file)] || "미확인",
        });
  }
  const importCache = new Map();
  async function cachedImports(file) {
    if (importCache.has(file)) return importCache.get(file);
    if (importCache.size >= 160) return null;
    const imports = codeImports(await safeRead(path.join(dir, file)), file);
    importCache.set(file, imports);
    return imports;
  }
  for (const route of routeDetails.slice(0, 80)) {
    const visitedFiles = new Set(),
      trace = [],
      dbUsed = new Set(),
      aiUsed = new Set();
    let dependencyBounded = false;
    async function follow(file, depth = 0) {
      if (depth > 3 || visitedFiles.size >= 25) {
        dependencyBounded = true;
        return;
      }
      if (visitedFiles.has(file)) return;
      visitedFiles.add(file);
      const v = await cachedImports(file);
      if (!v) {
        dependencyBounded = true;
        return;
      }
      for (const spec of v.imports) {
        if (db.includes(spec)) {
          dbUsed.add(spec);
          trace.push({ from: file, to: spec, kind: "DB SDK" });
        }
        if (ai.includes(spec)) {
          aiUsed.add(spec);
          trace.push({ from: file, to: spec, kind: "AI SDK" });
        }
      }
      for (const target of v.links) {
        if (trace.length >= 40) {
          dependencyBounded = true;
          break;
        }
        trace.push({ from: file, to: target, kind: "내부 import" });
        await follow(target, depth + 1);
      }
    }
    await follow(route.file);
    route.importTrace = trace.slice(0, 40);
    route.dbUsed = [...dbUsed];
    route.aiUsed = [...aiUsed];
    route.dependencyBounded = dependencyBounded;
  }
  const supported = sourceFiles.filter((f) =>
    /\.(?:[cm]?[jt]sx?|vue|svelte)$/.test(f),
  );
  const impactEdges = [],
    analyzedFiles = new Set();
  let impactBytes = 0,
    impactBounded = false;
  // Index imports across pages AND shared modules to support reverse impact lookup.
  for (const file of supported.slice(0, 800)) {
    const code = await safeRead(path.join(dir, file));
    impactBytes += Buffer.byteLength(code);
    if (impactBytes > 24 * 1024 * 1024 || impactEdges.length >= 6000) {
      impactBounded = true;
      break;
    }
    if (!code) continue;
    analyzedFiles.add(file);
    for (const target of codeImports(code, file).links)
      impactEdges.push({ from: file, to: target });
  }
  const impact = {
    files: sourceFiles.map((file) => ({
      path: file,
      language: languages[path.extname(file)],
      kind:
        routesAll.includes(file) || routeDetails.some((r) => r.file === file)
          ? "api"
          : pagesAll.includes(file)
            ? "page"
            : "module",
      analyzed: analyzedFiles.has(file),
    })),
    edges: impactEdges.slice(0, 6000),
    bounded: truncated || impactBounded || supported.length > 800,
    coverage: { analyzed: analyzedFiles.size, total: supported.length },
  };
  const sitemap = found.filter((f) =>
      /(?:^|\/)sitemap(?:\.[jt]s|\.xml)$/.test(f),
    ),
    robots = found.filter((f) => /(?:^|\/)robots(?:\.[jt]s|\.txt)$/.test(f)),
    metaFiles = found.filter((f) =>
      /(?:^|\/)(?:layout|head)\.[jt]sx?$/.test(f),
    );
  const indexFile = found.find(
    (f) => f === "index.html" || f === "public/index.html",
  );
  let title = null,
    description = null,
    noindex = null;
  if (indexFile) {
    const html = await safeRead(path.join(dir, indexFile));
    title = /<title[^>]*>\s*[^<]+\s*<\/title>/i.test(html);
    description = /<meta\b[^>]*name\s*=\s*["']description["'][^>]*>/i.test(
      html,
    );
    noindex =
      /<meta[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html);
  }
  return {
    impact,
    routes: [...new Set(routeDetails.map((r) => r.file))].slice(0, 50),
    pages: pagesAll.slice(0, 50),
    routeDetails: routeDetails.slice(0, 80).map((r) => ({
      ...r,
      key: r.file + "#" + r.methods.join("+") + r.endpoint,
    })),
    routeCount: routeDetails.length,
    frameworkEvidence,
    pageCount: pagesAll.length,
    languages: languageCounts,
    sourceCount: sourceFiles.length,
    scriptCommands,
    db,
    ai,
    deploy: found.includes("vercel.json") ? ["Vercel 설정"] : [],
    detectedStack: Object.keys(dep)
      .filter((k) =>
        [
          "next",
          "react",
          "vue",
          "vite",
          "express",
          "typescript",
          "tailwindcss",
          "svelte",
          "astro",
        ].includes(k),
      )
      .concat(["Swift", "Python", "Go", "Rust"].filter((k) => counts[k])),
    seo: {
      sitemap,
      robots,
      metaFiles,
      indexFile: indexFile || null,
      title,
      description,
      noindex,
    },
    bounded: truncated,
  };
}
