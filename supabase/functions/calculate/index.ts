// Supabase Edge Function "calculate": a thin Deno entry around @calc/api.
//
// How it's wired:
// - deno.json (next to this file) is the import map. It points the bare
//   workspace specifiers `@calc/api` and `@calc/engine` at their TypeScript
//   sources in packages/, and maps the npm dependencies those sources import
//   (`decimal.js`, `@supabase/supabase-js`) to exact `npm:` versions that match
//   package-lock.json. The packages use explicit `.ts` relative imports and
//   only web-standard APIs (Request, Response, URL, crypto), so Deno runs them
//   unchanged. `supabase functions deploy calculate` bundles everything the
//   import map reaches, including ../../../packages and ../../../contract.
// - SUPABASE_URL and SUPABASE_ANON_KEY are injected by the Supabase runtime.
//   Each request builds a supabase-js client that sends the CALLER's JWT (from
//   the Authorization header), never the service-role key, so Postgres RLS
//   scopes every query to auth.uid().
// - The gateway's default verify_jwt check rejects bad tokens before this
//   code runs; the handler still returns 401 when no bearer token is present.
// - Routes (paths as seen by the function): POST /calculate (the function
//   root), GET /calculate/history?limit=, PATCH|DELETE /calculate/history/:id.
//   OPTIONS preflights are answered with CORS headers.
//
// Local run: `supabase functions serve calculate` (Deno is not installed in
// this repo's CI; the handler itself is tested under Node with vitest).
import { createHandler, createSupabaseRepoFactory } from "@calc/api";
import { evaluate } from "@calc/engine";

const url = Deno.env.get("SUPABASE_URL");
const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
if (!url || !anonKey) throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be set");

Deno.serve(
  createHandler({
    evaluate,
    repoFor: createSupabaseRepoFactory({ url, anonKey }),
    corsOrigin: Deno.env.get("CORS_ORIGIN") ?? "*",
  }),
);
