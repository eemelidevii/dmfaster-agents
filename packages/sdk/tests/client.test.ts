import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_TOOL_POLICIES,
  createDmfasterClient,
  DmfasterHttpError,
  DmfasterProtocolError,
  DmfasterSdkError,
  DmfasterTimeoutError,
} from "../src/index.ts";

function result(tool: keyof typeof AGENT_TOOL_POLICIES) {
  return {
    version: 1,
    tool,
    policy: AGENT_TOOL_POLICIES[tool],
    ok: true,
    generatedAt: "2026-07-29T12:00:00.000Z",
    durationMs: 3,
    evidence: [],
    consistency: { status: "verified", checks: [] },
    data: { answer: 42 },
    artifacts: [],
    error: null,
  };
}

test("posts the direct tool input with bearer authentication", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = createDmfasterClient({
    baseUrl: "https://app.dmfaster.test/",
    token: "secret-token",
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json(result("campaigns.list"));
    },
  });

  const response = await client.invoke("campaigns.list", { status: "Running", limit: 5 });

  assert.equal(response.ok, true);
  assert.equal(calls[0]?.url, "https://app.dmfaster.test/api/v1/agent/tools/campaigns.list");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(new Headers(calls[0]?.init?.headers).get("authorization"), "Bearer secret-token");
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { status: "Running", limit: 5 });
});

test("surfaces an API error without leaking the token", async () => {
  const client = createDmfasterClient({
    baseUrl: "https://app.dmfaster.test",
    token: "do-not-leak",
    fetch: async () => Response.json({ error: { message: "Token is expired." } }, { status: 401 }),
  });

  await assert.rejects(
    client.invoke("workspace.briefing", {}),
    (error: unknown) => {
      assert.ok(error instanceof DmfasterHttpError);
      assert.equal(error.status, 401);
      assert.equal(error.message, "Token is expired.");
      assert.doesNotMatch(error.message, /do-not-leak/);
      return true;
    },
  );
});

test("preserves the server retry contract on typed HTTP errors", async () => {
  const client = createDmfasterClient({
    baseUrl: "https://app.dmfaster.test",
    token: "do-not-leak",
    fetch: async () => Response.json({
      error: {
        code: "rate_limited",
        message: "Too many agent tool requests.",
        retryable: true,
        requestId: "req_rate_limit_123",
        details: { bucket: "workspace" },
      },
    }, {
      status: 429,
      headers: {
        "retry-after": "900",
        "x-request-id": "req_header_fallback",
      },
    }),
  });

  await assert.rejects(
    client.invoke("workspace.briefing", {}),
    (error: unknown) => {
      assert.ok(error instanceof DmfasterHttpError);
      assert.equal(error.code, "rate_limited");
      assert.equal(error.retryable, true);
      assert.equal(error.requestId, "req_rate_limit_123");
      assert.equal(error.retryAfterSeconds, 900);
      assert.deepEqual(error.details, { bucket: "workspace" });
      return true;
    },
  );
});

test("rejects a mismatched result envelope", async () => {
  const client = createDmfasterClient({
    baseUrl: "https://app.dmfaster.test",
    token: "secret-token",
    fetch: async () => Response.json(result("sending.inspect")),
  });

  await assert.rejects(
    client.invoke("campaign.inspect", {}),
    DmfasterProtocolError,
  );
});

test("rejects a server policy that understates an action's effect or approval", async () => {
  const client = createDmfasterClient({
    baseUrl: "https://app.dmfaster.test",
    token: "secret-token",
    fetch: async () => Response.json({
      ...result("campaign.launch"),
      policy: AGENT_TOOL_POLICIES["workspace.briefing"],
    }),
  });

  await assert.rejects(
    client.invoke("campaign.launch", {
      campaignId: "campaign_123",
      idempotencyKey: "launch-001",
      authorizationId: `agent_action_${"a".repeat(32)}`,
    }),
    (error: unknown) => error instanceof DmfasterProtocolError
      && /unsafe result policy/.test(error.message),
  );
});

test("rejects contradictory success and failure envelopes", async () => {
  const client = createDmfasterClient({
    baseUrl: "https://app.dmfaster.test",
    token: "secret-token",
    fetch: async () => Response.json({
      ...result("workspace.briefing"),
      ok: false,
      data: { leaked: true },
      error: null,
    }),
  });

  await assert.rejects(
    client.invoke("workspace.briefing", {}),
    DmfasterProtocolError,
  );
});

test("aborts requests at the configured timeout", async () => {
  const client = createDmfasterClient({
    baseUrl: "https://app.dmfaster.test",
    token: "secret-token",
    timeoutMs: 5,
    fetch: async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
        once: true,
      });
    }),
  });

  await assert.rejects(
    client.invoke("workspace.briefing", {}),
    DmfasterTimeoutError,
  );
});

test("rejects plaintext non-loopback API endpoints", () => {
  assert.throws(
    () => createDmfasterClient({
      baseUrl: "http://api.example.test",
      token: "secret",
    }),
    (error: unknown) => error instanceof DmfasterSdkError && error.code === "invalid_base_url",
  );
});

test("rejects credentials and path-prefixed API base URLs", () => {
  for (const baseUrl of [
    "https://user:password@app.dmfaster.test",
    "https://app.dmfaster.test/api/v1",
  ]) {
    assert.throws(
      () => createDmfasterClient({ baseUrl, token: "secret" }),
      (error: unknown) => error instanceof DmfasterSdkError && error.code === "invalid_base_url",
    );
  }
});

test("allows loopback HTTP and rejects redirect following", async () => {
  let redirectMode = "";
  const client = createDmfasterClient({
    baseUrl: "http://127.0.0.1:3000",
    token: "secret",
    fetch: async (_input, init) => {
      redirectMode = String(init?.redirect || "");
      return new Response(JSON.stringify({
        version: 1,
        tool: "workspace.briefing",
        policy: { effect: "read", approval: "none", exposure: "public_api" },
        ok: true,
        generatedAt: new Date().toISOString(),
        durationMs: 1,
        evidence: [],
        consistency: { status: "verified", checks: [] },
        data: {},
        artifacts: [],
        error: null,
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  await client.invoke("workspace.briefing", {});
  assert.equal(redirectMode, "error");
});
