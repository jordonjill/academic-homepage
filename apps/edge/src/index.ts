import type { AskRequest } from "@academic-homepage/shared";

import { buildRouteInput, normalizeConversationHistory } from "./conversation.ts";
import type { Env } from "./env.ts";
import { generateAnswer } from "./llm.ts";
import { resolveSemanticRoute, SEMANTIC_THRESHOLD } from "./router.ts";
import {
  addAbuseStrike,
  consumeAskQuota,
  detectAbuseReason,
  getDailyUsage,
  getReputation,
  getUtcDay,
  hashIp,
  isEnglishFirstInput,
  isLoopbackIp,
  logRequest,
  pruneDatabase
} from "./security.ts";
import { buildCorsHeaders, buildSseHeaders, createSseStream } from "./sse.ts";

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(init?.headers ?? {})
    }
  });
}

function extractClientIp(request: Request) {
  return (
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "127.0.0.1"
  );
}

async function handleAsk(request: Request, env: Env) {
  const requestId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const clientIp = extractClientIp(request);
  const ipHash = await hashIp(clientIp, env.IP_HASH_SALT);
  const shouldBypassQuota = env.LLM_MOCK_MODE === "true" && isLoopbackIp(clientIp);

  let payload: AskRequest | null = null;
  try {
    payload = (await request.json()) as AskRequest;
  } catch {
    payload = null;
  }

  const stream = createSseStream(async (writer) => {
    const message = payload?.message?.trim() ?? "";
    const history = normalizeConversationHistory(payload?.history);
    if (!message) {
      writer.meta({
        requestId,
        matchedIntent: null,
        remainingDailyQuota: 5,
        semanticScore: null
      });
      writer.error({
        code: "bad_request",
        message: "input required. submit a non-empty message."
      });
      writer.done(requestId);
      return;
    }

    const reputation = await getReputation(env, ipHash);
    if (reputation.bannedAt) {
      writer.meta({
        requestId,
        matchedIntent: null,
        remainingDailyQuota: 0,
        semanticScore: null
      });
      writer.error({
        code: "banned",
        message: `access denied. ip banned. reason: ${reputation.banReason ?? "abuse policy triggered"}.`
      });
      await logRequest(env, {
        id: requestId,
        ipHash,
        createdAt,
        outcome: "banned",
        abuseReason: reputation.banReason
      });
      writer.done(requestId);
      return;
    }

    const dayUtc = getUtcDay(new Date(createdAt));
    const usage = shouldBypassQuota
      ? {
          askCount: 0,
          lastSeenAt: ""
        }
      : await getDailyUsage(env, ipHash, dayUtc);
    const remainingDailyQuota = Math.max(0, 5 - usage.askCount);

    const abuseReason = detectAbuseReason(message);
    if (abuseReason) {
      const updatedReputation = await addAbuseStrike(
        env,
        ipHash,
        createdAt,
        abuseReason
      );
      writer.meta({
        requestId,
        matchedIntent: null,
        remainingDailyQuota,
        semanticScore: null
      });
      writer.error({
        code: "abuse_blocked",
        message:
          updatedReputation.abuseStrikes >= 3
            ? `request blocked. abuse detected: ${abuseReason}. strike ${updatedReputation.abuseStrikes}/3. ip banned.`
            : `request blocked. abuse detected: ${abuseReason}. strike ${updatedReputation.abuseStrikes}/3.`
      });
      await logRequest(env, {
        id: requestId,
        ipHash,
        createdAt,
        outcome: "abuse_blocked",
        abuseReason
      });
      writer.done(requestId);
      return;
    }

    if (!isEnglishFirstInput(message)) {
      writer.meta({
        requestId,
        matchedIntent: null,
        remainingDailyQuota,
        semanticScore: null
      });
      writer.error({
        code: "unsupported_language",
        message: "english-first routing enabled. rephrase in english."
      });
      await logRequest(env, {
        id: requestId,
        ipHash,
        createdAt,
        outcome: "unsupported_language"
      });
      writer.done(requestId);
      return;
    }

    let directRoute;
    try {
      directRoute = await resolveSemanticRoute(message, env);
    } catch (error) {
      writer.meta({
        requestId,
        matchedIntent: null,
        remainingDailyQuota,
        semanticScore: null
      });
      writer.error({
        code: "llm_error",
        message:
          error instanceof Error
            ? `llm error. ${error.message}`
            : "llm error. routing failed."
      });
      await logRequest(env, {
        id: requestId,
        ipHash,
        createdAt,
        outcome: "llm_error"
      });
      writer.done(requestId);
      return;
    }

    const route =
      directRoute.score < SEMANTIC_THRESHOLD && history.length > 0
        ? await (async () => {
            const historyRoute = await resolveSemanticRoute(
              buildRouteInput(message, history),
              env
            );
            return historyRoute.score > directRoute.score ? historyRoute : directRoute;
          })()
        : directRoute;

    if (route.score < SEMANTIC_THRESHOLD) {
      writer.meta({
        requestId,
        matchedIntent: route.question.intent,
        remainingDailyQuota,
        semanticScore: route.score
      });
      writer.error({
        code: "semantic_reject",
        message:
          "route rejected. ask about background, education, work, projects, publications, awards, skills, or contact."
      });
      await logRequest(env, {
        id: requestId,
        ipHash,
        createdAt,
        outcome: "semantic_reject",
        semanticScore: route.score,
        matchedIntent: route.question.intent
      });
      writer.done(requestId);
      return;
    }

    if (!shouldBypassQuota && usage.askCount >= 5) {
      writer.meta({
        requestId,
        matchedIntent: route.question.intent,
        remainingDailyQuota,
        semanticScore: route.score
      });
      writer.error({
        code: "rate_limited",
        message: "quota exhausted. routed llm limit reached. retry after 00:00 UTC."
      });
      await logRequest(env, {
        id: requestId,
        ipHash,
        createdAt,
        outcome: "rate_limited",
        semanticScore: route.score,
        matchedIntent: route.question.intent
      });
      writer.done(requestId);
      return;
    }

    if (!shouldBypassQuota) {
      await consumeAskQuota(env, ipHash, dayUtc, createdAt);
    }

    const remainingAfterConsume = shouldBypassQuota
      ? 5
      : Math.max(0, 5 - (usage.askCount + 1));
    writer.meta({
      requestId,
      matchedIntent: route.question.intent,
      remainingDailyQuota: remainingAfterConsume,
      semanticScore: route.score
    });

    try {
      await generateAnswer({
        env,
        history,
        userMessage: message,
        route,
        onTool: (payload) => writer.tool(payload),
        onToken: (text) => writer.token(text)
      });
      await logRequest(env, {
        id: requestId,
        ipHash,
        createdAt,
        outcome: "success",
        semanticScore: route.score,
        matchedIntent: route.question.intent
      });
    } catch (error) {
      writer.error({
        code: "llm_error",
        message:
          error instanceof Error
            ? `llm error. ${error.message}`
            : "llm error. generation failed."
      });
      await logRequest(env, {
        id: requestId,
        ipHash,
        createdAt,
        outcome: "llm_error",
        semanticScore: route.score,
        matchedIntent: route.question.intent
      });
    }

    writer.done(requestId);
  });

  return new Response(stream, {
    status: 200,
    headers: buildSseHeaders(request, env)
  });
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: buildCorsHeaders(request, env)
      });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse(
        {
          ok: true,
          service: "academic-homepage-api"
        },
        {
          headers: buildCorsHeaders(request, env)
        }
      );
    }

    if (request.method === "POST" && url.pathname === "/ask") {
      return handleAsk(request, env);
    }

    return jsonResponse(
      {
        ok: false,
        message: "Not found."
      },
      {
        status: 404,
        headers: buildCorsHeaders(request, env)
      }
    );
  },
  async scheduled(_event: unknown, env: Env, _ctx: unknown) {
    const cutoffs = await pruneDatabase(env);
    console.log(
      `[cron:prune] request_log<${cutoffs.requestLogCutoff} daily_usage<${cutoffs.dailyUsageCutoff} ip_reputation<${cutoffs.ipReputationCutoff}`
    );
  }
};
