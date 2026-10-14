import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/webmasters.readonly",
];
export async function readGoogleClient(file) {
  if (typeof file !== "string" || !path.isAbsolute(file))
    throw new Error("OAuth 클라이언트 JSON 파일의 절대 경로를 입력하세요.");
  try {
    if ((await fs.stat(file)).size > 65536) throw new Error();
    const json = JSON.parse(await fs.readFile(file, "utf8")),
      value = json.installed || json.web;
    if (
      !value ||
      typeof value.client_id !== "string" ||
      !value.client_id.endsWith(".apps.googleusercontent.com") ||
      typeof value.client_secret !== "string"
    )
      throw new Error();
    let redirect = null;
    if (json.web) {
      redirect = (value.redirect_uris || []).find((uri) => {
        try {
          const u = new URL(uri);
          return (
            u.protocol === "http:" &&
            ["localhost", "127.0.0.1"].includes(u.hostname) &&
            Number(u.port) >= 1024 &&
            Number(u.port) <= 65535 &&
            !u.search &&
            !u.hash &&
            !u.username &&
            !u.password
          );
        } catch {
          return false;
        }
      });
      if (!redirect) throw new Error();
    }
    return {
      clientId: value.client_id,
      clientSecret: value.client_secret,
      redirect,
    };
  } catch {
    throw new Error(
      "Google OAuth 클라이언트 JSON과 등록된 로컬 콜백 주소를 확인하세요.",
    );
  }
}
export function createGoogleOAuth({
  dataDir,
  dashboardOrigin,
  request = fetch,
  onConnected = async () => {},
}) {
  const file = path.join(dataDir, "google-oauth.json");
  let pending = null,
    receiver = null,
    expiry = null,
    cached = null,
    last = { state: "disconnected" };
  const read = async () => {
    try {
      return JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      return null;
    }
  };
  const stop = () => {
    clearTimeout(expiry);
    receiver?.close();
    receiver = null;
    pending = null;
  };
  const write = async (value) => {
    await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
    const temp = file + "." + randomBytes(6).toString("hex") + ".tmp";
    await fs.writeFile(temp, JSON.stringify(value), { mode: 0o600 });
    await fs.rename(temp, file);
  };
  async function tokenRequest(body) {
    const r = await request("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams(body),
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok)
      throw new Error(
        `Google 인증 실패 (${r.status}). 계정 승인과 OAuth 앱 설정을 확인하세요.`,
      );
    return r.json();
  }
  return {
    async status() {
      const saved = await read();
      return {
        state: pending
          ? "waiting"
          : saved?.refreshToken
            ? "connected"
            : last.state,
        reason: last.reason || null,
        updatedAt: saved?.updatedAt || null,
        method: saved?.refreshToken ? "oauth" : null,
      };
    },
    async token() {
      if (cached && cached.expires > Date.now()) return cached.token;
      const saved = await read();
      if (!saved?.refreshToken)
        throw new Error(
          "Google 계정이 연결되지 않았어요. Google로 연결을 눌러 읽기 권한을 승인하세요.",
        );
      const result = await tokenRequest({
        grant_type: "refresh_token",
        client_id: saved.clientId,
        client_secret: saved.clientSecret,
        refresh_token: saved.refreshToken,
      });
      if (!result.access_token || !Number.isFinite(Number(result.expires_in)))
        throw new Error("Google 토큰 응답을 확인하세요.");
      cached = {
        token: result.access_token,
        expires: Date.now() + (Number(result.expires_in) - 60) * 1000,
      };
      return cached.token;
    },
    async start(clientFile) {
      if (pending) return { authorizationUrl: pending.authorizationUrl };
      const client = await readGoogleClient(clientFile),
        state = randomBytes(32).toString("base64url"),
        verifier = randomBytes(48).toString("base64url");
      let redirect = client.redirect;
      receiver = http.createServer(async (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
        );
        const callback = new URL(redirect),
          url = new URL(req.url, redirect);
        if (
          req.method !== "GET" ||
          url.pathname !== callback.pathname ||
          ![callback.host, "127.0.0.1:" + callback.port].includes(
            req.headers.host,
          ) ||
          !pending
        ) {
          res.writeHead(404);
          res.end();
          return;
        }
        const incoming = url.searchParams.get("state") || "";
        if (
          Buffer.byteLength(incoming) !== Buffer.byteLength(state) ||
          !timingSafeEqual(Buffer.from(incoming), Buffer.from(state))
        ) {
          res.writeHead(400);
          res.end("Invalid OAuth state");
          return;
        }
        try {
          if (url.searchParams.get("error"))
            throw new Error("Google 연결 승인이 취소됐습니다.");
          const code = url.searchParams.get("code");
          if (!code || code.length > 8192)
            throw new Error("Google 인증 코드가 없습니다.");
          // Consume the state before the network exchange; prevent callback replay.
          pending = null;
          const result = await tokenRequest({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirect,
            client_id: client.clientId,
            client_secret: client.clientSecret,
            code_verifier: verifier,
          });
          if (
            !GOOGLE_SCOPES.every((scope) =>
              (result.scope || "").split(" ").includes(scope),
            )
          )
            throw new Error(
              "Analytics와 Search Console의 읽기 권한을 모두 승인하세요.",
            );
          if (!result.refresh_token)
            throw new Error(
              "지속 조회용 Google 승인을 받지 못했습니다. 다시 연결하세요.",
            );
          await write({
            clientId: client.clientId,
            clientSecret: client.clientSecret,
            refreshToken: result.refresh_token,
            scopes: GOOGLE_SCOPES,
            updatedAt: new Date().toISOString(),
          });
          cached = null;
          last = { state: "connected" };
          await onConnected();
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(
            `<html lang="ko"><meta charset="utf-8"><title>Manage-A Google 연결 완료</title><body><h1>Google 읽기 권한 연결 완료</h1><p>Manage-A에서 프로젝트 속성을 선택하고 통계를 가져오세요.</p><a href="${dashboardOrigin}/#analytics">Manage-A로 돌아가기</a></body></html>`,
          );
        } catch (e) {
          last = { state: "error", reason: e.message };
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end(
            "Google 연결을 완료하지 못했습니다. Manage-A에서 연결 상태를 확인하세요.",
          );
        } finally {
          stop();
        }
      });
      try {
        await new Promise((resolve, reject) => {
          receiver.once("error", reject);
          receiver.listen(
            redirect ? Number(new URL(redirect).port) : 0,
            "127.0.0.1",
            resolve,
          );
        });
      } catch {
        stop();
        throw new Error(
          "Google 로컬 콜백 포트를 사용할 수 없어요. 실행 중인 앱은 종료하지 않았습니다. Desktop OAuth 클라이언트를 사용하세요.",
        );
      }
      if (!redirect) redirect = `http://127.0.0.1:${receiver.address().port}/`;
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.search = new URLSearchParams({
        client_id: client.clientId,
        redirect_uri: redirect,
        response_type: "code",
        scope: GOOGLE_SCOPES.join(" "),
        state,
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        code_challenge_method: "S256",
        access_type: "offline",
        prompt: "consent",
      }).toString();
      pending = { authorizationUrl: url.href };
      last = { state: "waiting" };
      expiry = setTimeout(() => {
        last = {
          state: "error",
          reason: "Google 승인 시간이 만료됐습니다. 다시 연결하세요.",
        };
        stop();
      }, 600000);
      expiry.unref();
      return { authorizationUrl: url.href };
    },
    close: stop,
  };
}
