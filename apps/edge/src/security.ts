import type { Env } from "./env.ts";

const ABUSE_RULES: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\b(ignore|reveal|print|dump)\b.{0,40}\b(system|developer)\b.{0,40}\b(prompt|instruction)s?\b/i,
    reason: "prompt-injection attempt"
  },
  {
    pattern: /\b(api[_ -]?key|secret|token|credential|password)\b/i,
    reason: "credential extraction attempt"
  },
  {
    pattern: /(<script\b|javascript:|onerror=|onload=|document\.cookie)/i,
    reason: "script injection attempt"
  },
  {
    pattern: /\b(select\s+\*|union\s+select|drop\s+table|insert\s+into|delete\s+from)\b/i,
    reason: "SQL injection attempt"
  },
  {
    pattern: /\b(ddos|flood|spam)\b/i,
    reason: "explicit abuse language"
  }
];

export function detectAbuseReason(message: string): string | null {
  for (const rule of ABUSE_RULES) {
    if (rule.pattern.test(message)) {
      return rule.reason;
    }
  }

  return null;
}

export function isEnglishFirstInput(message: string): boolean {
  const cjkMatches = message.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/g) ?? [];
  const latinMatches = message.match(/[A-Za-z]/g) ?? [];

  if (latinMatches.length === 0 && cjkMatches.length > 0) {
    return false;
  }

  return latinMatches.length >= cjkMatches.length;
}

export function isLoopbackIp(ip: string): boolean {
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "localhost" ||
    /^::ffff:127\./.test(ip)
  );
}

export async function hashIp(ip: string, salt: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const array = Array.from(new Uint8Array(digest));
  return array.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function getUtcDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export async function getDailyUsage(env: Env, ipHash: string, dayUtc: string) {
  return (
    (await env.DB.prepare(
      `SELECT ask_count AS askCount, last_seen_at AS lastSeenAt
       FROM daily_usage
       WHERE ip_hash = ? AND day_utc = ?`
    )
      .bind(ipHash, dayUtc)
      .first<{
        askCount: number;
        lastSeenAt: string;
      }>()) ?? {
      askCount: 0,
      lastSeenAt: ""
    }
  );
}

export async function consumeAskQuota(
  env: Env,
  ipHash: string,
  dayUtc: string,
  nowIso: string
) {
  await env.DB.prepare(
    `INSERT INTO daily_usage (ip_hash, day_utc, ask_count, last_seen_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(ip_hash, day_utc)
     DO UPDATE SET
       ask_count = daily_usage.ask_count + 1,
       last_seen_at = excluded.last_seen_at`
  )
    .bind(ipHash, dayUtc, nowIso)
    .run();
}

export async function getReputation(env: Env, ipHash: string) {
  return (
    (await env.DB.prepare(
      `SELECT abuse_strikes AS abuseStrikes, banned_at AS bannedAt, ban_reason AS banReason
       FROM ip_reputation
       WHERE ip_hash = ?`
    )
      .bind(ipHash)
      .first<{
        abuseStrikes: number;
        bannedAt: string | null;
        banReason: string | null;
      }>()) ?? {
      abuseStrikes: 0,
      bannedAt: null,
      banReason: null
    }
  );
}

export async function addAbuseStrike(
  env: Env,
  ipHash: string,
  nowIso: string,
  reason: string
) {
  const current = await getReputation(env, ipHash);
  const nextStrikes = current.abuseStrikes + 1;
  const bannedAt = nextStrikes >= 3 ? nowIso : null;
  const banReason = nextStrikes >= 3 ? reason : current.banReason;

  await env.DB.prepare(
    `INSERT INTO ip_reputation (ip_hash, abuse_strikes, banned_at, ban_reason, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(ip_hash)
     DO UPDATE SET
       abuse_strikes = excluded.abuse_strikes,
       banned_at = excluded.banned_at,
       ban_reason = excluded.ban_reason,
       updated_at = excluded.updated_at`
  )
    .bind(ipHash, nextStrikes, bannedAt, banReason, nowIso)
    .run();

  return {
    abuseStrikes: nextStrikes,
    bannedAt,
    banReason
  };
}

export async function logRequest(
  env: Env,
  payload: {
    id: string;
    ipHash: string;
    createdAt: string;
    outcome: string;
    semanticScore?: number | null;
    matchedIntent?: string | null;
    abuseReason?: string | null;
  }
) {
  await env.DB.prepare(
    `INSERT INTO request_log (id, ip_hash, created_at, outcome, semantic_score, matched_intent, abuse_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      payload.id,
      payload.ipHash,
      payload.createdAt,
      payload.outcome,
      payload.semanticScore ?? null,
      payload.matchedIntent ?? null,
      payload.abuseReason ?? null
    )
    .run();
}
