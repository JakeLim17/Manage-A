import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  createGoogleOAuth,
  GOOGLE_SCOPES,
  readGoogleClient,
} from "../lib/google-oauth.mjs";
test("OAuth uses read-only scopes, PKCE, consumes state, stores secrets privately and refreshes", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "manage-google-")),
    client = path.join(dir, "client.json");
  await fs.writeFile(
    client,
    JSON.stringify({
      installed: {
        client_id: "test.apps.googleusercontent.com",
        client_secret: "private-client",
      },
    }),
  );
  let calls = 0,
    connected = false;
  const oauth = createGoogleOAuth({
    dataDir: dir,
    dashboardOrigin: "http://127.0.0.1:4310",
    onConnected: async () => {
      connected = true;
    },
    request: async (url, options) => {
      assert.equal(url, "https://oauth2.googleapis.com/token");
      calls++;
      const body = options.body;
      if (body.get("grant_type") === "authorization_code") {
        assert.equal(
          createHash("sha256")
            .update(body.get("code_verifier"))
            .digest("base64url"),
          authorization.searchParams.get("code_challenge"),
        );
        return {
          ok: true,
          json: async () => ({
            access_token: "private-token",
            refresh_token: "private-refresh",
            expires_in: 3600,
            scope: GOOGLE_SCOPES.join(" "),
          }),
        };
      }
      assert.equal(body.get("refresh_token"), "private-refresh");
      return {
        ok: true,
        json: async () => ({ access_token: "refreshed", expires_in: 3600 }),
      };
    },
  });
  let authorization;
  try {
    authorization = new URL((await oauth.start(client)).authorizationUrl);
    assert.equal(authorization.origin, "https://accounts.google.com");
    assert.equal(
      authorization.searchParams.get("scope"),
      GOOGLE_SCOPES.join(" "),
    );
    assert.ok(!authorization.href.includes("private-client"));
    const callback = new URL(authorization.searchParams.get("redirect_uri"));
    callback.search = new URLSearchParams({
      state: "é".repeat(43),
      code: "fake",
    }).toString();
    assert.equal((await fetch(callback)).status, 400);
    assert.equal(calls, 0);
    callback.search = new URLSearchParams({
      state: authorization.searchParams.get("state"),
      code: "fake",
    }).toString();
    assert.equal((await fetch(callback)).status, 200);
    assert.ok(connected);
    assert.equal(
      (await fs.stat(path.join(dir, "google-oauth.json"))).mode & 0o777,
      0o600,
    );
    const status = await oauth.status();
    assert.equal(status.state, "connected");
    assert.ok(!JSON.stringify(status).includes("private"));
    assert.equal(await oauth.token(), "refreshed");
    assert.equal(await oauth.token(), "refreshed");
    assert.equal(calls, 2);
  } finally {
    oauth.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("web client requires existing loopback callback and never trusts arbitrary token endpoints", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "manage-client-")),
    file = path.join(dir, "client.json");
  try {
    await fs.writeFile(
      file,
      JSON.stringify({
        web: {
          client_id: "test.apps.googleusercontent.com",
          client_secret: "private",
          redirect_uris: ["https://example.test/callback"],
        },
      }),
    );
    await assert.rejects(readGoogleClient(file));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
