import test from "node:test";
import assert from "node:assert/strict";

import { buildCorsHeaders } from "../apps/edge/src/sse.ts";

test("cors echoes loopback origins during local development", () => {
  const headers = buildCorsHeaders(
    new Request("http://localhost:8787/ask", {
      headers: {
        Origin: "http://127.0.0.1:3000"
      }
    }),
    {
      SITE_ORIGIN: "http://localhost:3000"
    }
  );

  assert.equal(headers["Access-Control-Allow-Origin"], "http://127.0.0.1:3000");
});

test("cors stays strict for non-loopback origins", () => {
  const headers = buildCorsHeaders(
    new Request("https://api.example.com/ask", {
      headers: {
        Origin: "https://evil.example.com"
      }
    }),
    {
      SITE_ORIGIN: "https://site.example.com"
    }
  );

  assert.equal(headers["Access-Control-Allow-Origin"], "https://site.example.com");
});
