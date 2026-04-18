export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1StatementLike;
}

export interface KVNamespaceLike {
  get<T = unknown>(key: string, type: "json"): Promise<T | null>;
  get(key: string, type?: "text"): Promise<string | null>;
}

export interface VectorizeQueryMatch {
  id?: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

export interface VectorizeIndexLike {
  query(
    vector: number[],
    options?: Record<string, unknown>
  ): Promise<{ matches?: VectorizeQueryMatch[] }>;
}

export interface AiBindingLike {
  run(model: string, payload: Record<string, unknown>): Promise<unknown>;
}

export interface Env {
  DB: D1DatabaseLike;
  PROFILE_KV?: KVNamespaceLike;
  CANONICAL_INDEX?: VectorizeIndexLike;
  AI?: AiBindingLike;
  IP_HASH_SALT: string;
  LLM_API_KEY?: string;
  LLM_BASE_URL?: string;
  LLM_MODEL?: string;
  SITE_ORIGIN?: string;
  LLM_MOCK_MODE?: string;
  LLM_STREAM_DELAY_MS?: string;
}
