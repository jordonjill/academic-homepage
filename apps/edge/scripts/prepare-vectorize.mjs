import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadCanonicalQuestions } from "@academic-homepage/shared/local-data";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDirectory = path.resolve(__dirname, "../.seed");
const devVarsPath = path.resolve(__dirname, "../.dev.vars");
const embeddingModel = "@cf/baai/bge-base-en-v1.5";
const outputPath = path.join(outputDirectory, "vectorize-upsert.ndjson");
const batchSize = 32;
const expectedDimensions = 768;

function parseEnvFile(contents) {
  const values = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

async function loadScriptEnv() {
  const localValues = existsSync(devVarsPath)
    ? parseEnvFile(await readFile(devVarsPath, "utf8"))
    : {};

  return {
    ...localValues,
    ...process.env
  };
}

function getRequiredEnv(env, names) {
  for (const name of names) {
    const value = env[name];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  throw new Error(`Missing required environment variable. Tried: ${names.join(", ")}`);
}

function chunk(items, size) {
  const batches = [];

  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }

  return batches;
}

function extractEmbeddingRows(payload) {
  const rows = payload?.result?.data;

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Workers AI embedding response is empty.");
  }

  if (!rows.every((row) => Array.isArray(row))) {
    throw new Error("Workers AI embedding response shape is invalid.");
  }

  return rows;
}

async function fetchEmbeddings({ accountId, apiToken, texts }) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${embeddingModel}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text: texts,
        pooling: "mean"
      })
    }
  );

  if (!response.ok) {
    throw new Error(
      `Workers AI embedding request failed with ${response.status} ${response.statusText}.`
    );
  }

  const payload = await response.json();
  const rows = extractEmbeddingRows(payload);

  if (rows.length !== texts.length) {
    throw new Error(
      `Workers AI returned ${rows.length} embeddings for ${texts.length} texts.`
    );
  }

  return rows.map((row) => {
    if (row.length !== expectedDimensions) {
      throw new Error(
        `Expected ${expectedDimensions} embedding dimensions, received ${row.length}.`
      );
    }

    return row.map((value) => Number(value));
  });
}

const env = await loadScriptEnv();
const accountId = getRequiredEnv(env, ["CLOUDFLARE_ACCOUNT_ID", "CF_ACCOUNT_ID"]);
const apiToken = getRequiredEnv(env, ["CLOUDFLARE_API_TOKEN", "CF_API_TOKEN"]);
const canonicalQuestions = loadCanonicalQuestions();

if (canonicalQuestions.length === 0) {
  throw new Error("No canonical questions found. Nothing to embed.");
}

const records = [];

for (const batch of chunk(canonicalQuestions, batchSize)) {
  const embeddings = await fetchEmbeddings({
    accountId,
    apiToken,
    texts: batch.map((question) => question.question)
  });

  batch.forEach((question, index) => {
    records.push(
      JSON.stringify({
        id: question.id,
        values: embeddings[index],
        metadata: {
          id: question.id,
          intent: question.intent,
          question: question.question
        }
      })
    );
  });
}

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, `${records.join("\n")}\n`);

console.log(
  `Wrote ${records.length} vector records to ${outputPath} using ${embeddingModel}.`
);
