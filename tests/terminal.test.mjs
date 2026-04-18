import test from "node:test";
import assert from "node:assert/strict";

import { loadSiteSnapshot } from "@academic-homepage/shared/local-data";

import { BOOT_MESSAGE, buildBootEntries, runCommand } from "../apps/site/lib/terminal.ts";

const siteSnapshot = loadSiteSnapshot();

test("boot entries keep the terminal intro minimal", () => {
  const entries = buildBootEntries(siteSnapshot);

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.kind, "system");
  assert.equal(entries[0]?.text, BOOT_MESSAGE);
  assert.equal(typeof entries[0]?.id, "string");
});

test("help command only exposes the agreed local commands", () => {
  const result = runCommand("/help", siteSnapshot);

  assert.equal(result.type, "local");
  assert.deepEqual(result.lines, [
    "local",
    "/help           show local commands",
    "/about          show brief profile",
    "/contact        show public contact",
    "/clear          clear terminal",
    "",
    "query",
    "plain text      ask about profile, work, projects, papers, awards, or skills"
  ]);
});

test("about and contact commands use the shared content snapshot", () => {
  assert.deepEqual(runCommand("/about", siteSnapshot), {
    type: "local",
    lines: siteSnapshot.aboutLines
  });

  assert.deepEqual(runCommand("/contact", siteSnapshot), {
    type: "local",
    lines: siteSnapshot.contactLines
  });
});

test("plain text is routed as a remote question and clear resets the terminal", () => {
  assert.deepEqual(runCommand("Who are you?", siteSnapshot), {
    type: "ask",
    question: "Who are you?"
  });

  assert.deepEqual(runCommand("/clear", siteSnapshot), {
    type: "clear"
  });
});

test("unknown commands return a terse terminal hint", () => {
  assert.deepEqual(runCommand("/unknown", siteSnapshot), {
    type: "local",
    lines: ["command not found: /unknown", "hint: run /help"]
  });
});

test("shared contact snapshot uses local contact content instead of example placeholders", () => {
  assert.notDeepEqual(siteSnapshot.contactLines, [
    "email: you@example.com",
    "github: https://github.com/your-handle"
  ]);
  assert.match(siteSnapshot.contactLines[0] ?? "", /^email:\s.+@.+$/);
  assert.match(siteSnapshot.contactLines[1] ?? "", /^github:\shttps:\/\/github\.com\//);
});
