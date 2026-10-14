// Organization reports are separate from Claude.ai subscription allowances.
export async function readAnthropicApiUsage({
  key = process.env.ANTHROPIC_ADMIN_KEY,
  request = fetch,
  now = new Date(),
} = {}) {
  const checkedAt = now.toISOString();
  if (!key)
    return {
      state: "credentials_required",
      checkedAt,
      reason:
        "Claude API 조직 사용량 조회용 Admin 키가 필요합니다. Claude.ai 로그인과 별도입니다.",
    };
  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 7);
  const query = new URLSearchParams({
    starting_at: start.toISOString(),
    ending_at: end.toISOString(),
    bucket_width: "1d",
    limit: "31",
  });
  const headers = {
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
    "User-Agent": "Manage-A/1.4",
  };
  try {
    const reports = await Promise.all(
      ["usage_report/messages", "cost_report"].map(async (route) => {
        const response = await request(
          `https://api.anthropic.com/v1/organizations/${route}?${query}`,
          { headers, redirect: "error", signal: AbortSignal.timeout(12000) },
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const value = await response.json();
        if (
          !Array.isArray(value.data) ||
          value.data.some((bucket) => !Array.isArray(bucket.results)) ||
          value.has_more
        )
          throw new Error("불완전한 보고서");
        return value.data.flatMap((bucket) => bucket.results || []);
      }),
    );
    const number = (value) =>
      Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
    const usage = reports[0].reduce(
      (sum, row) => ({
        input: sum.input + number(row.uncached_input_tokens),
        output: sum.output + number(row.output_tokens),
        cacheRead: sum.cacheRead + number(row.cache_read_input_tokens),
        cacheWrite:
          sum.cacheWrite +
          number(row.cache_creation?.ephemeral_5m_input_tokens) +
          number(row.cache_creation?.ephemeral_1h_input_tokens),
      }),
      { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    );
    if (
      reports[1].some(
        (row) => row.currency && row.currency.toUpperCase() !== "USD",
      )
    )
      throw new Error("지원하지 않는 통화");
    return {
      state: "connected",
      checkedAt,
      source: "anthropic_admin_api",
      scope: "조직 전체 · 완료된 최근 7일 · UTC",
      period: { start: start.toISOString(), end: end.toISOString() },
      ...usage,
      costUsd: reports[1].reduce(
        (sum, row) => sum + number(row.amount) / 100,
        0,
      ),
    };
  } catch (error) {
    return {
      state: "error",
      checkedAt,
      reason: /^HTTP \d+$/.test(error.message)
        ? `조직 보고서 조회 실패: ${error.message}. Admin 권한을 확인하세요.`
        : "조직 보고서를 완전히 가져오지 못했습니다. 연결과 보고서 형식을 확인하세요.",
    };
  }
}

export async function readOpenAiApiUsage({
  key = process.env.OPENAI_ADMIN_KEY,
  request = fetch,
  now = new Date(),
} = {}) {
  const checkedAt = now.toISOString();
  if (!key)
    return {
      state: "credentials_required",
      checkedAt,
      reason:
        "OpenAI API 조직 보고서용 Admin 키를 연결하세요. Codex 구독 로그인과 별도입니다.",
    };
  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 7);
  const query = new URLSearchParams({
    start_time: String(start.getTime() / 1000),
    end_time: String(end.getTime() / 1000),
    bucket_width: "1d",
    limit: "31",
  });
  try {
    const reports = await Promise.all(
      ["usage/completions", "costs"].map(async (route) => {
        const r = await request(
          `https://api.openai.com/v1/organization/${route}?${query}`,
          {
            headers: { Authorization: `Bearer ${key}` },
            redirect: "error",
            signal: AbortSignal.timeout(12000),
          },
        );
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const v = await r.json();
        if (
          !Array.isArray(v.data) ||
          v.has_more ||
          v.data.some((b) => !Array.isArray(b.results))
        )
          throw new Error("incomplete");
        return v.data.flatMap((b) => b.results);
      }),
    );
    const n = (v) => {
      if (!Number.isFinite(Number(v)) || Number(v) < 0)
        throw new Error("invalid");
      return Number(v);
    };
    const tokens = reports[0].reduce(
      (s, r) => ({
        input: s.input + n(r.input_tokens),
        output: s.output + n(r.output_tokens),
        cacheRead: s.cacheRead + n(r.input_cached_tokens || 0),
      }),
      { input: 0, output: 0, cacheRead: 0 },
    );
    const costUsd = reports[1].reduce((s, r) => {
      if (r.amount?.currency !== "usd") throw new Error("currency");
      return s + n(r.amount.value);
    }, 0);
    return {
      state: "connected",
      checkedAt,
      source: "openai_admin_api",
      scope:
        "조직 전체 · 완료된 최근 7일 · UTC · 토큰: 모델 응답 / 비용: 전체 API",
      period: { start: start.toISOString(), end: end.toISOString() },
      ...tokens,
      costUsd,
    };
  } catch (e) {
    return {
      state: "error",
      checkedAt,
      reason: /^HTTP \d+$/.test(e.message)
        ? `OpenAI 조직 조회 실패: ${e.message}. Admin 권한을 확인하세요.`
        : "OpenAI 보고서를 완전히 가져오지 못했습니다.",
    };
  }
}
