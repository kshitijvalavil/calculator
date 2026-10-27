# Tally: an exact calculator

A web calculator that gets decimals right (0.1 + 0.2 = 0.3), with a standard and a scientific mode and a history tape you can label, reuse and delete. Built as the pilot for Boss's bot team.

## What's in here

| Path | What it is | Built by |
|---|---|---|
| `contract/` | The shared spec: types, API, database rules, 53 canonical test cases | Manager |
| `packages/calc-engine/` | Exact decimal math engine (decimal.js, 34 digits, iterative parser, never throws) | Byte Vader |
| `packages/calc-api/` | History API handler (web-standard `Request`/`Response`) | Byte Vader |
| `supabase/functions/calculate/` | Supabase Edge Function entry that serves the API | Byte Vader |
| `supabase/migrations/` | `calculations` table with row-level security | Tabledore |
| `apps/web/` | React + TypeScript + Vite + Tailwind app | Sir Pixelot |
| `qa/` | Independent black-box tests and exploratory scripts | Sherlock Bugs |

## Run it

```bash
npm install
npm run dev -w @calc/web
```

Without Supabase settings the app runs in **local mode**: history is saved in the browser. To use the API, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `apps/web/.env.local`, apply `supabase/migrations/`, enable anonymous sign-in, and deploy `supabase/functions/calculate`.

## Test it

```bash
npm run test:engine   # engine unit + contract tests
npm run test:api      # API handler tests
npm run test:db       # migration + RLS tests against Postgres 16 (DATABASE_URL or local socket)
npm run test:web      # web unit tests + Playwright e2e
npx vitest run --root qa && bash qa/db/run.sh   # Sherlock Bugs' independent suites
```

CI runs all of these on every pull request (`.github/workflows/test.yml`).

## Deploy

The app is a static site, so it ships to **GitHub Pages** with `.github/workflows/deploy-pages.yml`. It runs only by hand, after QA sign-off and Boss's approval. One-time setup: in the repo's **Settings → Pages**, set **Source** to **GitHub Actions**.
