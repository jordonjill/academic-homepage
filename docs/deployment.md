# Deployment Runbook

This document covers only deployment and release operations. Project overview, local data flow, and local setup live in [README.md](../README.md).

## Required Cloudflare resources

- `1` Pages site
- `1` Worker
- `1` D1 database
- `1` KV namespace
- `1` Vectorize index

Required Worker bindings / vars in `apps/edge/wrangler.toml`:

- `DB`
- `PROFILE_KV`
- `CANONICAL_INDEX`
- `AI`
- `IP_HASH_SALT`
- `LLM_API_KEY`
- `LLM_BASE_URL`
- `LLM_MODEL`
- `SITE_ORIGIN`
- `LLM_MOCK_MODE`
- `LLM_STREAM_DELAY_MS`

## First-time provisioning

1. Create one D1 database:
   - `npm exec --workspace @academic-homepage/edge wrangler d1 create academic-homepage`
2. Create one KV namespace:
   - `npm exec --workspace @academic-homepage/edge wrangler kv namespace create PROFILE_KV`
3. Create one Vectorize index named `academic-homepage-questions`.
4. Copy the returned IDs into [apps/edge/wrangler.toml](/home/jordon/academic-homepage/apps/edge/wrangler.toml:1).
5. Run `npm run db:apply:remote`.
6. Upload the generated KV and Vectorize seed artifacts.

## Runtime limits

Current hard-coded runtime limits:

- daily routed LLM quota:
  - `5` requests per day per IP hash
- abuse ban threshold:
  - `3` strikes => permanent ban
- conversation memory window:
  - last `5` turns kept
- route history assist:
  - last `2` turns used for low-score follow-up routing
- LLM tool loop:
  - up to `3` rounds
- tool list slicing:
  - most `limit` fields are capped at `10`

Current canonical question count is project-managed, not hard-limited by code. The local set can grow beyond the current size as long as routing quality remains clear.

## Release order

1. Create or update your local content files:
   - `data/site.local.json`
   - `data/knowledge.local.json`
   - `data/canonical-questions.local.json`
2. Run `npm run check`
3. Run `npm run build`
4. Run `npm run seed:preview`
5. Sync `kv-bulk.json` to KV with `npm run seed:kv:remote`
6. If canonical questions changed, update Vectorize from `vectorize-manifest.json`
7. If schema changed, apply the D1 schema:
   - local: `npm run db:apply:local`
   - remote: `npm run db:apply:remote`
8. Deploy the Worker
9. Deploy the static site
10. Run production smoke tests

## Production defaults

- `LLM_MOCK_MODE=false`
- strict `SITE_ORIGIN`
- secrets only in Cloudflare
- public contact output limited to email and GitHub
- the frontend assumes same-origin API calls in production
- only routed LLM requests count toward the daily quota
- tracked repo JSON should remain example-only in the public repository
- runtime knowledge comes from KV, not repo JSON

## Smoke-test checklist

- page opens
- first empty `Enter` triggers `/help`
- `/about` returns short profile lines
- `/contact` returns public contact info
- a relevant question streams a response
- an unrelated question gets semantic reject
- unsupported-language input does not consume quota
- rate limit still blocks the 6th request

## Rollback

- Frontend: redeploy the previous static artifact
- Worker: redeploy the previous Worker build
- Content: revert the JSON commit and resync KV
- Vectorize: restore the previous canonical question set if routing changed

## Minimum observability

Track at least:

- request count
- success / error split
- semantic reject rate
- abuse block rate
- p95 latency
- tool usage count
