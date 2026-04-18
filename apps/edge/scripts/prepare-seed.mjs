import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildKvSeedMap
} from "@academic-homepage/shared";
import {
  loadCanonicalQuestions,
  loadKnowledgeData
} from "@academic-homepage/shared/local-data";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDirectory = path.resolve(__dirname, "../.seed");

const knowledge = loadKnowledgeData();
const canonicalQuestions = loadCanonicalQuestions();

const kvBulkPayload = Object.entries(
  buildKvSeedMap(knowledge, canonicalQuestions)
).map(([key, value]) => ({
  key,
  value: JSON.stringify(value)
}));

const vectorizeManifest = canonicalQuestions.map((question) => ({
  id: question.id,
  text: question.question,
  metadata: {
    id: question.id,
    intent: question.intent
  }
}));

await mkdir(outputDirectory, { recursive: true });
await writeFile(
  path.join(outputDirectory, "kv-bulk.json"),
  `${JSON.stringify(kvBulkPayload, null, 2)}\n`
);
await writeFile(
  path.join(outputDirectory, "vectorize-manifest.json"),
  `${JSON.stringify(vectorizeManifest, null, 2)}\n`
);

console.log(`Wrote ${kvBulkPayload.length} KV entries to ${outputDirectory}/kv-bulk.json`);
console.log(
  `Wrote ${vectorizeManifest.length} canonical question records to ${outputDirectory}/vectorize-manifest.json`
);
