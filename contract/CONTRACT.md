# Calculator pilot contract

Written by the Manager from the approved research brief. All three engineers work from this. Change it only through the Manager.

## Who owns what

| Engineer | Owns | Must not touch |
|---|---|---|
| **Byte Vader** (back-end) | `packages/calc-engine/`, `packages/calc-api/`, `supabase/functions/` | everything else |
| **Tabledore** (database) | `supabase/migrations/`, `supabase/tests/`, `scripts/test-db.sh` | everything else |
| **Sir Pixelot** (front-end) | `apps/web/` | everything else |
| **Manager** | `contract/`, root `package.json`, CI, README | |

Dependencies are already installed. Don't add new ones unless you have to. If you do, install only into your own workspace (`npm install <pkg>@<exact version> -w <workspace>`).

## Engine rules (`@calc/engine`)

- `evaluate(expression, { angle })` from `contract/types.ts`. It never throws; errors come back as `{ ok: false, error }`.
- Arithmetic uses **decimal.js** at 34 significant digits. The output is rounded half-up to **20 significant digits**, with trailing zeros removed. Notation is plain unless the exponent is ≥ 21 or ≤ −7, which gives decimal.js style `1e+24` / `1e-8`. Never output `-0`.
- Operators: `+`, `-` or `−`, `×` or `*`, `÷` or `/`, and `^` (right-associative). Postfix `%` divides by 100. Postfix `!` is a factorial of a non-negative integer up to 1000. Parentheses, unary minus and unary plus are allowed.
- Precedence, from loosest to tightest: `+ -` < `× ÷` < unary minus < `^` < postfix `% !`. So `-2 ^ 2 = -4`.
- Implicit multiplication applies between a number and `(`, a constant or a function, and between `)` and `(`. So `2(3 + 1) = 8` and `2pi` works.
- Functions: `sqrt`, `sin`, `cos`, `tan`, `ln`, `log` (base 10). Constants: `pi` (also `π`) and `e`. Trig uses `angle`, which defaults to `deg`.
- Trig results with an absolute value below 1e-25 snap to `0`. `tan` at an odd multiple of 90° (or π/2) is `DOMAIN`.
- Results with |x| ≥ 1e1000 are `OVERFLOW`. Unmatched parentheses are `SYNTAX` (the UI may auto-close them before evaluating). Scientific input notation such as `1e3` is not supported, because `e` is the constant.
- The canonical cases are in `contract/test-cases.json`. Every engineer's tests must pass all of them.

## Database (`public.calculations`)

| column | type | rule |
|---|---|---|
| id | uuid | pk, default `gen_random_uuid()` |
| user_id | uuid | not null, default `auth.uid()`, references `auth.users(id)` on delete cascade |
| expression | text | not null, 1..500 chars |
| result | text | not null, 1..2000 chars |
| mode | text | not null, `standard` or `scientific` |
| angle | text | not null, default `deg`, `deg` or `rad` |
| label | text | null, ≤ 80 chars |
| created_at | timestamptz | not null, default `now()` |

- RLS is enabled. The `authenticated` role can select, insert, update and delete only rows where `user_id = auth.uid()`. Inserts must have `user_id = auth.uid()`. `anon` gets no access.
- Updates may change only `label`, enforced by column grants or a trigger.
- Index on `(user_id, created_at desc)`.
- Tests run against a local Postgres 16 with a minimal `auth` stub (`auth.users`, and `auth.uid()` reading `request.jwt.claim.sub`), plus `anon` and `authenticated` roles. They must prove that a user can't read, change or delete another user's rows.

## API (`@calc/api` handler, served by the Edge Function)

The endpoints are in `contract/types.ts`. The handler is written as `createHandler(deps) => (req: Request) => Promise<Response>` using web-standard `Request`/`Response`, so it runs in Node tests and in Deno. `deps` holds a calculations repository interface (with a Supabase implementation and an in-memory one for tests) and the engine's `evaluate`. The handler always recomputes the result on the server. It never trusts a result sent by the client. CORS is enabled for browser calls, including the `OPTIONS` preflight.

## Front-end (`apps/web`)

- React + TypeScript + Vite + Tailwind. It uses `@calc/engine` in the browser for the instant preview, and the API for saved history.
- When `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are missing, it runs in **local mode**: history goes to `localStorage`, with the same UI. Tests run in local mode and in a mocked-API mode.
