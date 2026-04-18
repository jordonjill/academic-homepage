# Academic Homepage

Retro CRT terminal homepage for personal information display. The product goal is narrow: let a visitor quickly understand who the owner is, what the owner works on, what has been built or published, and how to make contact.

## Workspace

- `apps/site`
  - static Next.js terminal UI
  - slash commands, SSE rendering, CRT styling, Matrix background
- `apps/edge`
  - Cloudflare Worker gateway
  - abuse checks, semantic routing, tool execution, SSE output
- `packages/shared`
  - shared types
  - local/example data loading
  - seed helpers
- `data`
  - public-safe example templates
  - local override files for real content

## Product Shape

- Roles:
  - `visitor`
  - `admin`
- Local commands:
  - `/help`
  - `/about`
  - `/contact`
  - `/clear`
- Public API:
  - `POST /ask`
  - `GET /health`
- Scope:
  - answer only about the owner, background, education, work, projects, publications, awards, skills, and public contact info
  - do not behave like a general-purpose chatbot

## Data Model

Tracked public-safe templates:

- `data/site.example.json`
- `data/knowledge.example.json`
- `data/canonical-questions.example.json`

Local override files:

- `data/site.local.json`
- `data/knowledge.local.json`
- `data/canonical-questions.local.json`

The `.local.json` files are gitignored and should contain the real deployment content.

Current content split:

- `site.local.json`
  - public `/about`
  - public `/contact`
- `knowledge.local.json`
  - `profile`
  - `education`
  - `workExperience`
  - `projects`
  - `publications`
  - `awards`
  - `skills`
  - `contact`
- `canonical-questions.local.json`
  - semantic routing seed questions

## Runtime Model

Frontend:

- renders the terminal shell
- handles local commands
- streams `token`, `error`, and `done`
- keeps a short local conversation history for follow-up questions

Worker:

- blocks banned IPs and explicit abuse
- applies English-first input policy
- routes questions through Vectorize when available
- falls back to lexical routing if AI / Vectorize is unavailable
- calls upstream LLM with internal tools
- reads factual content from KV

Internal tool surface:

- `get_profile`
- `get_education`
- `get_work_experience`
- `get_projects`
- `get_publications`
- `get_awards`
- `get_skills`
- `get_contact`

## Storage Responsibilities

- local `.local.json`
  - authoring source for real content before deployment
- KV
  - deployed knowledge layer
- D1
  - daily quota, abuse reputation, request log
- Vectorize
  - canonical question index for semantic routing

## Local Setup

1. Install dependencies:
   - `npm install`
2. Copy the Worker env file if needed:
   - `apps/edge/.dev.vars.example` -> `apps/edge/.dev.vars`
3. Create your local content files:
   - `data/site.local.json`
   - `data/knowledge.local.json`
   - `data/canonical-questions.local.json`
4. Apply the local database schema:
   - `npm run db:apply:local`
5. Generate seed artifacts:
   - `npm run seed:preview`
6. Push local seed data into local KV:
   - `npm run seed:kv:local`
7. Start the apps:
   - `npm run dev:site`
   - `npm run dev:edge`

Useful checks:

- `npm test`
- `npm run check`
- `npm run build`

Seed preview writes:

- `apps/edge/.seed/kv-bulk.json`
- `apps/edge/.seed/vectorize-manifest.json`

Vectorize embedding workflow:

- `npm run seed:vectorize:preview` generates `apps/edge/.seed/vectorize-upsert.ndjson`
- `npm run seed:vectorize:remote` upserts the generated vectors into `academic-homepage-questions`

This workflow requires `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in `apps/edge/.dev.vars` (or process env). If Vectorize is empty or unavailable, the Worker still falls back to lexical routing.

## Public Data Policy

If this repository is public, anything committed under `data/` should be treated as public.

- keep tracked `*.example.json` files public-safe
- put real content only in `*.local.json`
- do not commit personal notes, private contact details, unpublished work, or secrets
- do not rely on repo-owned JSON as runtime private storage

## Reuse

The intended reuse path is:

1. fork the repository or use it as a template
2. copy the example files to local override files
3. replace the local content with personal data
4. create separate Cloudflare resources
5. seed KV and Vectorize
6. deploy the Worker and static site

## Deployment

Deployment, provisioning, release order, rollback, and smoke tests live in [docs/deployment.md](docs/deployment.md).

Current production shape:

- Pages serves `https://home.jihd.net`
- the Worker serves same-origin `/ask*` and `/health*`
- real site content stays in local `data/*.local.json`
- production site updates use local build output plus `wrangler pages deploy`
- do not rely on Pages Git integration if the real `site.local.json` content is not committed
