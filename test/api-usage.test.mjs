import { test } from "node:test";
import assert from "node:assert/strict";
import { readAnthropicApiUsage } from "../lib/api-usage.mjs";
test("API reports require separate credentials and never mistake missing data for zero", async () => {
  const result = await readAnthropicApiUsage({ key: "" });
  assert.equal(result.state, "credentials_required");
  assert.equal(result.costUsd, undefined);
});
test("API organization totals use cents, separate tokens and no secrets in output", async () => {
  const result = await readAnthropicApiUsage({
    key: "secret",
    request: async (url) => ({
      ok: true,
      json: async () => ({
        data: [
          {
            results: url.includes("cost_report")
              ? [{ amount: "125", currency: "USD" }]
              : [
                  {
                    uncached_input_tokens: 10,
                    output_tokens: 5,
                    cache_read_input_tokens: 3,
                    cache_creation: { ephemeral_5m_input_tokens: 2 },
                  },
                ],
          },
        ],
        has_more: false,
      }),
    }),
  });
  assert.equal(result.costUsd, 1.25);
  assert.equal(result.input, 10);
  assert.equal(result.cacheWrite, 2);
  assert.ok(!JSON.stringify(result).includes("secret"));
});
test("partial reports and denied permissions never display zero usage", async () => {
  for (const response of [
    { ok: false, status: 403 },
    { ok: true, json: async () => ({ data: [], has_more: true }) },
  ]) {
    const result = await readAnthropicApiUsage({
      key: "secret",
      request: async () => response,
    });
    assert.equal(result.state, "error");
    assert.equal(result.costUsd, undefined);
  }
});

test("OpenAI API reports keep USD units and reject partial totals", async () => {
  const { readOpenAiApiUsage } = await import("../lib/api-usage.mjs");
  assert.equal(
    (await readOpenAiApiUsage({ key: "" })).state,
    "credentials_required",
  );
  const result = await readOpenAiApiUsage({
    key: "private",
    request: async (url) => ({
      ok: true,
      json: async () => ({
        data: [
          {
            results: url.includes("/costs")
              ? [{ amount: { value: 1.25, currency: "usd" } }]
              : [
                  {
                    input_tokens: 20,
                    output_tokens: 5,
                    input_cached_tokens: 3,
                  },
                ],
          },
        ],
        has_more: false,
      }),
    }),
  });
  assert.equal(result.costUsd, 1.25);
  assert.equal(result.input, 20);
  assert.equal(result.cacheRead, 3);
  assert.ok(!JSON.stringify(result).includes("private"));
  const failed = await readOpenAiApiUsage({
    key: "private",
    request: async () => ({ ok: false, status: 401 }),
  });
  assert.equal(failed.state, "error");
  assert.equal(failed.costUsd, undefined);
});
