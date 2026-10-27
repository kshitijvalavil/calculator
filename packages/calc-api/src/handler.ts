import type { AngleUnit, Evaluate, Mode } from "../../../contract/types.ts";
import { RepoError, type CalculationsRepo, type RepoFactory } from "./repo.ts";

export interface HandlerDeps {
  /** The engine's `evaluate`. The server always recomputes results with it. */
  evaluate: Evaluate;
  /** Builds the caller-scoped repository from the bearer token. */
  repoFor: RepoFactory;
  /** Value for Access-Control-Allow-Origin. Default "*". */
  corsOrigin?: string;
  /** Called with unexpected errors (500s). Default: console.error. */
  onError?: (error: unknown) => void;
}

export const LIMITS = {
  expressionMax: 500,
  labelMax: 80,
  historyDefault: 50,
  historyMin: 1,
  historyMax: 200,
  bodyBytesMax: 16 * 1024,
} as const;

const MODES: readonly Mode[] = ["standard", "scientific"];
const ANGLES: readonly AngleUnit[] = ["deg", "rad"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_METHODS = "GET, POST, PATCH, DELETE, OPTIONS";
const ALLOWED_HEADERS = "authorization, x-client-info, apikey, content-type";

/** Length in Unicode code points, matching Postgres char_length(). */
const charLength = (s: string) => [...s].length;

type Route =
  | { name: "calculate"; methods: readonly ["POST"] }
  | { name: "history"; methods: readonly ["GET"] }
  | { name: "item"; id: string; methods: readonly ["PATCH", "DELETE"] };

/**
 * Accepts the paths as the Edge runtime delivers them (`/calculate`,
 * `/calculate/history/:id`), with the full `/functions/v1/...` prefix, or bare
 * (`/history`), so the same handler works in Deno, behind a proxy and in tests.
 *   POST   /calculate  (or the function root)
 *   GET    /history
 *   PATCH  /history/:id
 *   DELETE /history/:id
 */
export function matchRoute(pathname: string): Route | null {
  let p = pathname.replace(/\/+$/, "");
  p = p.replace(/^\/functions\/v1(?=\/|$)/, "");
  p = p.replace(/^\/calculate(?=\/|$)/, "");
  if (p === "" || p === "/calculate") return { name: "calculate", methods: ["POST"] };
  if (p === "/history") return { name: "history", methods: ["GET"] };
  const m = /^\/history\/([^/]+)$/.exec(p);
  if (m) {
    let id: string;
    try {
      id = decodeURIComponent(m[1]!);
    } catch {
      id = m[1]!; // malformed percent-encoding: keep raw, it will fail the uuid check (404)
    }
    return { name: "item", id, methods: ["PATCH", "DELETE"] };
  }
  return null;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const badRequest = (message: string) => new HttpError(400, "BAD_REQUEST", message);
const notFound = () => new HttpError(404, "NOT_FOUND", "Calculation not found");

function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  const m = header ? /^Bearer\s+(\S+)\s*$/i.exec(header) : null;
  return m ? m[1]! : null;
}

async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (new TextEncoder().encode(text).length > LIMITS.bodyBytesMax) throw badRequest("Request body is too large");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw badRequest("Body must be valid JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw badRequest("Body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

function parseCalculateBody(body: Record<string, unknown>): { expression: string; mode: Mode; angle: AngleUnit } {
  const { expression, mode, angle } = body;
  if (typeof expression !== "string") throw badRequest("expression must be a string");
  // "" is allowed through so the engine can answer 422 EMPTY; it is never saved.
  if (charLength(expression) > LIMITS.expressionMax) {
    throw badRequest(`expression must be at most ${LIMITS.expressionMax} characters`);
  }
  if (typeof mode !== "string" || !MODES.includes(mode as Mode)) {
    throw badRequest('mode must be "standard" or "scientific"');
  }
  if (angle !== undefined && (typeof angle !== "string" || !ANGLES.includes(angle as AngleUnit))) {
    throw badRequest('angle must be "deg" or "rad"');
  }
  return { expression, mode: mode as Mode, angle: (angle as AngleUnit | undefined) ?? "deg" };
}

/** "" and whitespace-only labels become null (the DB itself accepts ""). */
function parseLabelBody(body: Record<string, unknown>): string | null {
  if (!Object.prototype.hasOwnProperty.call(body, "label")) throw badRequest("label is required (use null to clear)");
  const { label } = body;
  if (label === null) return null;
  if (typeof label !== "string") throw badRequest("label must be a string or null");
  if (label.includes("\u0000")) throw badRequest("label must not contain NUL characters");
  const trimmed = label.trim();
  if (trimmed === "") return null;
  if (charLength(trimmed) > LIMITS.labelMax) throw badRequest(`label must be at most ${LIMITS.labelMax} characters`);
  return trimmed;
}

function parseLimit(url: URL): number {
  const raw = url.searchParams.get("limit");
  if (raw === null || raw === "") return LIMITS.historyDefault;
  if (!/^\d+$/.test(raw)) throw badRequest(`limit must be a whole number from ${LIMITS.historyMin} to ${LIMITS.historyMax}`);
  const n = Number(raw);
  if (n < LIMITS.historyMin || n > LIMITS.historyMax) {
    throw badRequest(`limit must be a whole number from ${LIMITS.historyMin} to ${LIMITS.historyMax}`);
  }
  return n;
}

/**
 * Builds the API as a web-standard fetch handler, so it runs unchanged in
 * Deno (`Deno.serve`), Node 18+ and tests.
 */
export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  const origin = deps.corsOrigin ?? "*";
  const onError = deps.onError ?? ((e: unknown) => console.error(e));

  const corsHeaders = (): Record<string, string> => ({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Max-Age": "86400",
    ...(origin === "*" ? {} : { Vary: "Origin" }),
  });

  const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8", ...extra },
    });

  const errorResponse = (status: number, code: string, message: string, extra?: Record<string, string>) =>
    json(status, { error: { code, message } }, extra);

  async function handle(req: Request): Promise<Response> {
    const method = req.method.toUpperCase();
    if (method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });

    // Auth comes before any routing or parsing, so a request without a token is always 401.
    const token = bearerToken(req);
    if (!token) return errorResponse(401, "UNAUTHORIZED", "Sign in required");

    const url = new URL(req.url);
    const route = matchRoute(url.pathname);
    if (!route) return errorResponse(404, "NOT_FOUND", "Not found");
    if (!(route.methods as readonly string[]).includes(method)) {
      return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed", {
        Allow: [...route.methods, "OPTIONS"].join(", "),
      });
    }

    const repo: CalculationsRepo = await deps.repoFor(token);

    switch (route.name) {
      case "calculate": {
        const input = parseCalculateBody(await readJsonObject(req));
        // Any client-sent "result" is ignored: the server always recomputes.
        const outcome = deps.evaluate(input.expression, { angle: input.angle });
        if (!outcome.ok) return json(422, { error: outcome.error });
        // Postgres text can't hold NUL. The engine already rejects it (422 SYNTAX), so this
        // is defence in depth: it only fires if the engine ever accepts one.
        if (input.expression.includes("\u0000")) throw badRequest("expression must not contain NUL characters");
        const calculation = await repo.insert({ ...input, result: outcome.result });
        return json(201, { calculation });
      }
      case "history": {
        const limit = parseLimit(url);
        return json(200, { calculations: await repo.list(limit) });
      }
      case "item": {
        if (!UUID_RE.test(route.id)) throw notFound();
        if (method === "DELETE") {
          if (!(await repo.delete(route.id))) throw notFound();
          return new Response(null, { status: 204, headers: corsHeaders() });
        }
        const label = parseLabelBody(await readJsonObject(req));
        const calculation = await repo.updateLabel(route.id, label);
        if (!calculation) throw notFound();
        return json(200, { calculation });
      }
    }
  }

  return async (req: Request): Promise<Response> => {
    try {
      return await handle(req);
    } catch (err) {
      if (err instanceof HttpError) return errorResponse(err.status, err.code, err.message);
      if (err instanceof RepoError && err.kind === "unauthorized") {
        return errorResponse(401, "UNAUTHORIZED", "Sign in required");
      }
      onError(err);
      return errorResponse(500, "INTERNAL", "Something went wrong");
    }
  };
}
