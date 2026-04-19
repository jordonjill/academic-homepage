import test from "node:test";
import assert from "node:assert/strict";

import worker from "../apps/edge/src/index.ts";
import { getUtcDay, hashIp, pruneDatabase } from "../apps/edge/src/security.ts";

import {
  createMockEnv,
  getAskCount,
  seedAskCount
} from "./support/mock-env.mjs";

function createAskRequest(message, ip = "203.0.113.10", extras = {}) {
  return new Request("http://example.com/ask", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": ip
    },
    body: JSON.stringify({ message, ...extras })
  });
}

async function readSseEvents(response) {
  const raw = await response.text();

  return raw
    .trim()
    .split("\n\n")
    .filter(Boolean)
    .map((chunk) => {
      let event = "message";
      const data = [];

      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        }

        if (line.startsWith("data:")) {
          data.push(line.slice(5).trim());
        }
      }

      return {
        event,
        data: JSON.parse(data.join("\n"))
      };
    });
}

function findEvent(events, eventName) {
  return events.find((event) => event.event === eventName);
}

function createChatCompletionResponse(content = "ok") {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            role: "assistant",
            content
          }
        }
      ]
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}

async function withStubbedUpstream(handler, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;

  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function getUsageKeyParts(env, ip) {
  return {
    ipHash: await hashIp(ip, env.IP_HASH_SALT),
    dayUtc: getUtcDay()
  };
}

test("unsupported-language input does not consume the daily LLM quota", async () => {
  const { env, state } = createMockEnv();
  const ip = "203.0.113.10";

  const response = await worker.fetch(createAskRequest("你好", ip), env);
  const events = await readSseEvents(response);

  assert.equal(findEvent(events, "error")?.data.code, "unsupported_language");

  const { ipHash, dayUtc } = await getUsageKeyParts(env, ip);
  assert.equal(getAskCount(state, ipHash, dayUtc), 0);
});

test("semantic reject does not consume the daily LLM quota", async () => {
  const { env, state } = createMockEnv();
  const ip = "203.0.113.11";

  const response = await worker.fetch(
    createAskRequest("What is the capital of France?", ip),
    env
  );
  const events = await readSseEvents(response);

  assert.equal(findEvent(events, "error")?.data.code, "semantic_reject");

  const { ipHash, dayUtc } = await getUsageKeyParts(env, ip);
  assert.equal(getAskCount(state, ipHash, dayUtc), 0);
});

test("a routed profile question consumes one daily LLM ask", async () => {
  const { env, state } = createMockEnv();
  const ip = "203.0.113.12";

  const events = await withStubbedUpstream(
    async () => createChatCompletionResponse("name: Test User"),
    async () => {
      const response = await worker.fetch(createAskRequest("Who are you?", ip), env);
      return readSseEvents(response);
    }
  );

  assert.equal(findEvent(events, "done")?.event, "done");
  assert.equal(findEvent(events, "error"), undefined);

  const meta = findEvent(events, "meta");
  assert.equal(meta?.data.matchedIntent, "profile");
  assert.equal(meta?.data.remainingDailyQuota, 4);

  const { ipHash, dayUtc } = await getUsageKeyParts(env, ip);
  assert.equal(getAskCount(state, ipHash, dayUtc), 1);
});

test("the sixth routed question is blocked by the daily LLM quota", async () => {
  const { env, state } = createMockEnv();
  const ip = "203.0.113.13";
  const { ipHash, dayUtc } = await getUsageKeyParts(env, ip);

  seedAskCount(state, ipHash, dayUtc, 5);

  const response = await worker.fetch(createAskRequest("Who are you?", ip), env);
  const events = await readSseEvents(response);

  assert.equal(findEvent(events, "error")?.data.code, "rate_limited");
  assert.equal(findEvent(events, "meta")?.data.remainingDailyQuota, 0);
  assert.equal(getAskCount(state, ipHash, dayUtc), 5);
});

test("loopback requests bypass the daily LLM quota when mock mode disables the upstream", async () => {
  const { env, state } = createMockEnv();
  const ip = "127.0.0.1";
  const { ipHash, dayUtc } = await getUsageKeyParts(env, ip);

  seedAskCount(state, ipHash, dayUtc, 5);

  const response = await worker.fetch(
    createAskRequest("Who are you?", ip),
    {
      ...env,
      LLM_MOCK_MODE: "true"
    }
  );
  const events = await readSseEvents(response);

  assert.equal(findEvent(events, "error")?.data.code, "llm_error");
  assert.equal(findEvent(events, "meta")?.data.matchedIntent, "profile");
  assert.equal(findEvent(events, "meta")?.data.remainingDailyQuota, 5);
  assert.equal(getAskCount(state, ipHash, dayUtc), 5);
});

test("routing still prefers the current question when it is already clear", async () => {
  const { env } = createMockEnv();
  const ip = "203.0.113.14";

  const events = await withStubbedUpstream(
    async () => createChatCompletionResponse("awards: Test Award"),
    async () => {
      const response = await worker.fetch(
        createAskRequest("What awards have you received?", ip, {
          history: [
            {
              user: "Tell me about Academic Copilot.",
              assistant: "Academic Copilot is a multi-agent research assistant."
            }
          ]
        }),
        env
      );
      return readSseEvents(response);
    }
  );

  assert.equal(findEvent(events, "error"), undefined);
  assert.equal(findEvent(events, "meta")?.data.matchedIntent, "awards");
});

test("missing PROFILE_KV does not silently fall back", async () => {
  const { env } = createMockEnv({
    PROFILE_KV: undefined
  });
  const ip = "203.0.113.15";

  const toolCallResponse = new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "tool-1",
                type: "function",
                function: {
                  name: "get_profile",
                  arguments: "{}"
                }
              }
            ]
          }
        }
      ]
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }
  );

  const events = await withStubbedUpstream(
    async () => toolCallResponse.clone(),
    async () => {
      const response = await worker.fetch(createAskRequest("Who are you?", ip), env);
      return readSseEvents(response);
    }
  );

  assert.equal(findEvent(events, "error")?.data.code, "llm_error");
});

test("database pruning removes stale logs and usage while preserving bans", async () => {
  const { env, state } = createMockEnv();
  const nowMs = Date.parse("2026-04-19T03:17:00.000Z");

  state.requestLog.push(
    {
      id: "old-log",
      ipHash: "ip-a",
      createdAt: "2025-12-01T00:00:00.000Z",
      outcome: "ok",
      semanticScore: null,
      matchedIntent: null,
      abuseReason: null
    },
    {
      id: "fresh-log",
      ipHash: "ip-a",
      createdAt: "2026-04-01T00:00:00.000Z",
      outcome: "ok",
      semanticScore: null,
      matchedIntent: null,
      abuseReason: null
    }
  );

  seedAskCount(state, "ip-a", "2026-04-17", 2);
  seedAskCount(state, "ip-a", "2026-04-19", 1);
  state.reputation.set("stale-clean", {
    abuseStrikes: 1,
    bannedAt: null,
    banReason: null,
    updatedAt: "2025-01-01T00:00:00.000Z"
  });
  state.reputation.set("banned", {
    abuseStrikes: 3,
    bannedAt: "2025-01-01T00:00:00.000Z",
    banReason: "abuse",
    updatedAt: "2025-01-01T00:00:00.000Z"
  });

  const cutoffs = await pruneDatabase(env, nowMs);

  assert.equal(cutoffs.dailyUsageCutoff, "2026-04-18");
  assert.deepEqual(state.requestLog.map((row) => row.id), ["fresh-log"]);
  assert.equal(getAskCount(state, "ip-a", "2026-04-17"), 0);
  assert.equal(getAskCount(state, "ip-a", "2026-04-19"), 1);
  assert.equal(state.reputation.has("stale-clean"), false);
  assert.equal(state.reputation.has("banned"), true);
});
