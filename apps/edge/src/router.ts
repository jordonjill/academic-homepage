import type { CanonicalQuestion } from "@academic-homepage/shared";

import type { Env } from "./env.ts";

export const SEMANTIC_THRESHOLD = 0.6;

export interface ResolvedRoute {
  question: CanonicalQuestion;
  score: number;
  source: "vectorize" | "fallback";
}

function normalizeText(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(input: string) {
  return new Set(normalizeText(input).split(" ").filter(Boolean));
}

function lexicalScore(message: string, candidate: string) {
  const messageNorm = normalizeText(message);
  const candidateNorm = normalizeText(candidate);

  if (messageNorm === candidateNorm) {
    return 1;
  }

  const messageTokens = tokenize(message);
  const candidateTokens = tokenize(candidate);
  const intersection = [...messageTokens].filter((token) => candidateTokens.has(token));
  const union = new Set([...messageTokens, ...candidateTokens]);
  const jaccard = union.size === 0 ? 0 : intersection.length / union.size;
  const coverage =
    messageTokens.size === 0 ? 0 : intersection.length / messageTokens.size;
  const phraseBonus =
    candidateNorm.includes(messageNorm) || messageNorm.includes(candidateNorm) ? 0.2 : 0;

  return Math.min(1, jaccard * 0.45 + coverage * 0.4 + phraseBonus);
}

async function getCanonicalQuestions(env: Env): Promise<CanonicalQuestion[]> {
  if (!env.PROFILE_KV) {
    throw new Error("routing unavailable. canonical question store is unavailable.");
  }

  const questions = await env.PROFILE_KV.get<CanonicalQuestion[]>(
    "canonical_questions:list",
    "json"
  );

  if (!questions || questions.length === 0) {
    throw new Error("routing unavailable. canonical question store is empty.");
  }

  return questions;
}

function fallbackRoute(
  message: string,
  canonicalQuestions: CanonicalQuestion[]
): ResolvedRoute {
  const [topMatch] = [...canonicalQuestions]
    .map((question) => ({
      question,
      score: lexicalScore(message, question.question)
    }))
    .sort((left, right) => right.score - left.score);

  return {
    question: topMatch.question,
    score: topMatch.score,
    source: "fallback"
  };
}

function extractEmbeddingVector(output: unknown): number[] {
  if (!output || typeof output !== "object") {
    throw new Error("Embedding output is empty.");
  }

  const candidate = output as Record<string, unknown>;
  if (Array.isArray(candidate.data) && candidate.data.every((value) => typeof value === "number")) {
    return candidate.data.map((value) => Number(value));
  }

  const nested =
    candidate.data ??
    candidate.result ??
    candidate.embeddings ??
    candidate.output ??
    candidate.response;

  const list =
    Array.isArray(nested) && nested.length > 0
      ? nested[0]
      : Array.isArray(candidate.data)
        ? candidate.data[0]
        : nested;

  if (Array.isArray(list)) {
    return list.map((value) => Number(value));
  }

  if (list && typeof list === "object") {
    const objectList = list as Record<string, unknown>;
    const direct =
      objectList.embedding ??
      objectList.vector ??
      objectList.data ??
      objectList.values;
    if (Array.isArray(direct)) {
      return direct.map((value) => Number(value));
    }
  }

  throw new Error("Unable to extract embedding vector.");
}

export async function resolveSemanticRoute(
  message: string,
  env: Env
): Promise<ResolvedRoute> {
  const canonicalQuestions = await getCanonicalQuestions(env);
  const fallback = fallbackRoute(message, canonicalQuestions);

  if (!env.AI || !env.CANONICAL_INDEX) {
    return fallback;
  }

  try {
    const output = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
      text: [message]
    });
    const embedding = extractEmbeddingVector(output);
    const result = await env.CANONICAL_INDEX.query(embedding, {
      topK: 1,
      returnMetadata: "all"
    });

    const topMatch = result.matches?.[0];
    const metadataId = topMatch?.metadata?.id;
    const questionId =
      typeof metadataId === "string"
        ? metadataId
        : typeof topMatch?.id === "string"
          ? topMatch.id
          : null;

    if (!questionId) {
      return fallback;
    }

    const canonicalQuestion = canonicalQuestions.find(
      (question) => question.id === questionId
    );

    if (!canonicalQuestion) {
      return fallback;
    }

    return {
      question: canonicalQuestion,
      score: Number(topMatch?.score ?? 0),
      source: "vectorize"
    };
  } catch {
    return fallback;
  }
}
