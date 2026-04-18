import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildSiteSnapshot } from "./seed-data.ts";
import type {
  CanonicalQuestion,
  ProfileData,
  SiteContentData,
  SiteSnapshot
} from "./types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.resolve(__dirname, "../../../data");

function readJsonWithExampleFallback<T>(localName: string, exampleName: string): T {
  const localPath = path.join(dataDirectory, localName);
  const examplePath = path.join(dataDirectory, exampleName);
  const selectedPath = existsSync(localPath) ? localPath : examplePath;

  return JSON.parse(readFileSync(selectedPath, "utf8")) as T;
}

export function loadSiteContent(): SiteContentData {
  return readJsonWithExampleFallback<SiteContentData>(
    "site.local.json",
    "site.example.json"
  );
}

export function loadKnowledgeData(): ProfileData {
  return readJsonWithExampleFallback<ProfileData>(
    "knowledge.local.json",
    "knowledge.example.json"
  );
}

export function loadCanonicalQuestions(): CanonicalQuestion[] {
  return readJsonWithExampleFallback<CanonicalQuestion[]>(
    "canonical-questions.local.json",
    "canonical-questions.example.json"
  );
}

export function loadSiteSnapshot(): SiteSnapshot {
  return buildSiteSnapshot(loadSiteContent());
}
