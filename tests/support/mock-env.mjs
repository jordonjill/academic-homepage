import {
  buildKvSeedMap
} from "@academic-homepage/shared";
import {
  loadCanonicalQuestions,
  loadKnowledgeData
} from "@academic-homepage/shared/local-data";

export class MockD1Database {
  constructor(state) {
    this.state = state;
  }

  prepare(query) {
    return new MockD1Statement(this.state, query);
  }
}

class MockD1Statement {
  constructor(state, query) {
    this.state = state;
    this.query = query;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first() {
    if (this.query.includes("FROM daily_usage")) {
      const [ipHash, dayUtc] = this.values;
      const row = this.state.dailyUsage.get(keyFor(ipHash, dayUtc));
      return row
        ? {
            askCount: row.askCount,
            lastSeenAt: row.lastSeenAt
          }
        : null;
    }

    if (this.query.includes("FROM ip_reputation")) {
      const [ipHash] = this.values;
      const row = this.state.reputation.get(ipHash);
      return row
        ? {
            abuseStrikes: row.abuseStrikes,
            bannedAt: row.bannedAt,
            banReason: row.banReason
          }
        : null;
    }

    return null;
  }

  async run() {
    if (this.query.includes("DELETE FROM request_log")) {
      const [cutoff] = this.values;
      this.state.requestLog = this.state.requestLog.filter(
        (row) => row.createdAt >= String(cutoff)
      );
      return {};
    }

    if (this.query.includes("DELETE FROM daily_usage")) {
      const [cutoff] = this.values;
      for (const [key, row] of this.state.dailyUsage.entries()) {
        if (row.dayUtc < String(cutoff)) {
          this.state.dailyUsage.delete(key);
        }
      }
      return {};
    }

    if (this.query.includes("DELETE FROM ip_reputation")) {
      const [cutoff] = this.values;
      for (const [key, row] of this.state.reputation.entries()) {
        if (!row.bannedAt && row.updatedAt < String(cutoff)) {
          this.state.reputation.delete(key);
        }
      }
      return {};
    }

    if (this.query.includes("INSERT INTO daily_usage")) {
      const [ipHash, dayUtc, nowIso] = this.values;
      const key = keyFor(ipHash, dayUtc);
      const current = this.state.dailyUsage.get(key) ?? {
        askCount: 0,
        lastSeenAt: ""
      };

      this.state.dailyUsage.set(key, {
        askCount: current.askCount + 1,
        dayUtc: String(dayUtc),
        lastSeenAt: String(nowIso)
      });
      return {};
    }

    if (this.query.includes("INSERT INTO ip_reputation")) {
      const [ipHash, abuseStrikes, bannedAt, banReason, updatedAt] = this.values;
      this.state.reputation.set(String(ipHash), {
        abuseStrikes: Number(abuseStrikes),
        bannedAt: bannedAt ? String(bannedAt) : null,
        banReason: banReason ? String(banReason) : null,
        updatedAt: String(updatedAt)
      });
      return {};
    }

    if (this.query.includes("INSERT INTO request_log")) {
      const [
        id,
        ipHash,
        createdAt,
        outcome,
        semanticScore,
        matchedIntent,
        abuseReason
      ] = this.values;

      this.state.requestLog.push({
        id: String(id),
        ipHash: String(ipHash),
        createdAt: String(createdAt),
        outcome: String(outcome),
        semanticScore: semanticScore == null ? null : Number(semanticScore),
        matchedIntent: matchedIntent == null ? null : String(matchedIntent),
        abuseReason: abuseReason == null ? null : String(abuseReason)
      });
      return {};
    }

    return {};
  }
}

function keyFor(ipHash, dayUtc) {
  return `${ipHash}:${dayUtc}`;
}

class MockKVNamespace {
  constructor(seed = {}) {
    this.values = new Map(Object.entries(seed));
  }

  async get(key, type = "text") {
    const value = this.values.get(key);
    if (value == null) {
      return null;
    }

    if (type === "json") {
      return JSON.parse(value);
    }

    return value;
  }
}

export function createMockState() {
  const knowledge = loadKnowledgeData();
  const canonicalQuestions = loadCanonicalQuestions();
  const kvSeed = buildKvSeedMap(knowledge, canonicalQuestions);

  return {
    dailyUsage: new Map(),
    reputation: new Map(),
    requestLog: [],
    kv: new MockKVNamespace(
      Object.fromEntries(
        Object.entries(kvSeed).map(([key, value]) => [key, JSON.stringify(value)])
      )
    )
  };
}

export function createMockEnv(overrides = {}) {
  const state = createMockState();
  const env = {
    DB: new MockD1Database(state),
    PROFILE_KV: state.kv,
    IP_HASH_SALT: "test-salt",
    SITE_ORIGIN: "http://localhost:3000",
    LLM_BASE_URL: "https://llm.example.test/v1",
    LLM_MODEL: "test-model",
    LLM_MOCK_MODE: "false",
    LLM_STREAM_DELAY_MS: "0",
    ...overrides
  };

  return { env, state };
}

export function seedAskCount(state, ipHash, dayUtc, askCount) {
  state.dailyUsage.set(keyFor(ipHash, dayUtc), {
    askCount,
    dayUtc,
    lastSeenAt: `${dayUtc}T00:00:00.000Z`
  });
}

export function getAskCount(state, ipHash, dayUtc) {
  return state.dailyUsage.get(keyFor(ipHash, dayUtc))?.askCount ?? 0;
}
