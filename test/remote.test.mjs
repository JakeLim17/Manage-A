import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
test("remote server enforces password, session and origin", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "chronocode-remote-"));
  const base = "http://127.0.0.1:4320";
  const proc = spawn(process.execPath, ["server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: "0.0.0.0",
      PORT: "4320",
      DASHBOARD_PASSWORD: "test-only-password-123456",
      PUBLIC_ORIGIN: base,
      PROJECT_ROOT: dir,
      DATA_DIR: path.join(dir, "data"),
      COOKIE_SECURE: "false",
      DISABLE_BACKGROUND_SYNC: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("server startup timed out")),
        5000,
      );
      proc.stdout.once("data", () => {
        clearTimeout(timer);
        resolve();
      });
      proc.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`server stopped ${code}`));
      });
    });
    assert.equal((await fetch(base + "/api/dashboard")).status, 401);
    const login = (p) =>
      fetch(base + "/api/login", {
        method: "POST",
        headers: { Origin: base, "Content-Type": "application/json" },
        body: JSON.stringify({ password: p }),
      });
    assert.equal((await login("wrong")).status, 401);
    const ok = await login("test-only-password-123456");
    assert.equal(ok.status, 200);
    const cookie = ok.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.equal(
      (
        await fetch(base + "/api/dashboard", {
          headers: { Cookie: cookie.split(";")[0] },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(base + "/api/refresh", {
          method: "POST",
          headers: {
            Cookie: cookie.split(";")[0],
            "Content-Type": "application/json",
          },
          body: "{}",
        })
      ).status,
      403,
    );
    const logout = await fetch(base + "/api/logout", {
      method: "POST",
      headers: {
        Origin: base,
        Cookie: cookie.split(";")[0],
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(logout.status, 200);
    assert.equal(
      (
        await fetch(base + "/api/dashboard", {
          headers: { Cookie: cookie.split(";")[0] },
        })
      ).status,
      401,
    );
  } finally {
    proc.kill();
    await new Promise((r) => proc.once("exit", r));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
