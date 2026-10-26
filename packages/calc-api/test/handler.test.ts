import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluate } from "@calc/engine";
import contract from "../../../contract/test-cases.json";
import type { Calculation, CalcErrorCode } from "../../../contract/types.ts";
import { createHandler, InMemoryCalculationsStore, matchRoute, RepoError, type CalculationsRepo } from "../src/index.ts";

const BASE = "http://localhost/functions/v1/calculate";
const ALICE = "token-alice";
const BOB = "token-bob";

let store: InMemoryCalculationsStore;
let handler: (req: Request) => Promise<Response>;

beforeEach(() => {
  let tick = Date.UTC(2026, 9, 26, 12, 0, 0);
  store = new InMemoryCalculationsStore({
    resolveUser: (t) => ({ [ALICE]: "user-alice", [BOB]: "user-bob" })[t] ?? null,
    now: () => new Date((tick += 1000)),
  });
  handler = createHandler({ evaluate, repoFor: store.repoFor, onError: () => {} });
});

interface CallOptions {
  method?: string;
  token?: string | null;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
}

async function call(path: string, { method = "GET", token = ALICE, body, rawBody, headers = {} }: CallOptions = {}) {
  const h = new Headers(headers);
  if (token) h.set("Authorization", `Bearer ${token}`);
  if (body !== undefined || rawBody !== undefined) h.set("Content-Type", "application/json");
  const res = await handler(
    new Request(BASE + path, {
      method,
      headers: h,
      body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
    }),
  );
  const text = await res.text();
  return { res, status: res.status, json: text ? JSON.parse(text) : null };
}

const calculate = (body: unknown, token: string | null = ALICE) => call("", { method: "POST", body, token });

async function save(expression: string, token = ALICE): Promise<Calculation> {
  const { status, json } = await calculate({ expression, mode: "standard" }, token);
  expect(status).toBe(201);
  return json.calculation;
}

describe("POST /calculate", () => {
  it("evaluates, saves and returns 201 with the calculation", async () => {
    const { status, json, res } = await calculate({ expression: "0.1 + 0.2", mode: "standard" });
    expect(status).toBe(201);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(json.calculation).toMatchObject({
      expression: "0.1 + 0.2",
      result: "0.3",
      mode: "standard",
      angle: "deg",
      label: null,
    });
    expect(json.calculation.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(json.calculation.created_at).toISOString()).toBe(json.calculation.created_at);
    expect(json.calculation).not.toHaveProperty("user_id");
    expect(store.allRows()).toHaveLength(1);
    expect(store.allRows()[0]!.user_id).toBe("user-alice");
  });

  it("uses the requested angle unit", async () => {
    const deg = await calculate({ expression: "sin(90)", mode: "scientific", angle: "deg" });
    const rad = await calculate({ expression: "sin(90)", mode: "scientific", angle: "rad" });
    expect(deg.json.calculation.result).toBe("1");
    expect(rad.json.calculation).toMatchObject({ result: "0.89399666360055789052", angle: "rad", mode: "scientific" });
  });

  it("never trusts a client-sent result", async () => {
    const { json } = await calculate({ expression: "2 + 2", mode: "standard", result: "5" });
    expect(json.calculation.result).toBe("4");
    expect(store.allRows()[0]!.result).toBe("4");
  });

  it("works on every routing variant of the path", async () => {
    for (const path of [
      "http://x/calculate",
      "http://x/calculate/",
      "http://x/calculate/calculate",
      "http://x/functions/v1/calculate",
      "http://x/functions/v1/calculate/calculate",
    ]) {
      const res = await handler(
        new Request(path, {
          method: "POST",
          headers: { Authorization: `Bearer ${ALICE}` },
          body: JSON.stringify({ expression: "1+1", mode: "standard" }),
        }),
      );
      expect(res.status, path).toBe(201);
    }
  });

  it("accepts a 500-character expression (counted in code points)", async () => {
    const expr = "1+".repeat(249) + "11"; // 500 chars
    expect(expr.length).toBe(500);
    expect((await calculate({ expression: expr, mode: "standard" })).status).toBe(201);
    const pis = "π".repeat(500);
    expect((await calculate({ expression: pis, mode: "standard" })).status).toBe(422); // SYNTAX, but body is valid
  });

  const errorCases: [CalcErrorCode, string][] = [
    ["EMPTY", "   "],
    ["SYNTAX", "(2 + 3"],
    ["DIVIDE_BY_ZERO", "1 ÷ 0"],
    ["DOMAIN", "sqrt(-1)"],
    ["OVERFLOW", "10 ^ 100000"],
  ];
  it.each(errorCases)("returns 422 with the engine error for %s and saves nothing", async (code, expression) => {
    const { status, json } = await calculate({ expression, mode: "standard" });
    expect(status).toBe(422);
    expect(json.error.code).toBe(code);
    expect(typeof json.error.message).toBe("string");
    expect(store.allRows()).toHaveLength(0);
  });

  it("agrees with every contract case", async () => {
    for (const c of contract.cases as { expression: string; angle?: "deg" | "rad"; result?: string; error?: string }[]) {
      if (c.expression.length === 0) continue; // empty string is a 400 (body rule), checked below
      const { status, json } = await calculate({ expression: c.expression, mode: "scientific", angle: c.angle });
      if (c.error) {
        expect(status, c.expression).toBe(422);
        expect(json.error.code, c.expression).toBe(c.error);
      } else {
        expect(status, c.expression).toBe(201);
        expect(json.calculation.result, c.expression).toBe(c.result);
      }
    }
  });

  const badBodies: [string, string | undefined, unknown][] = [
    ["invalid JSON", "{nope", undefined],
    ["empty body", "", undefined],
    ["a JSON array", undefined, [1, 2]],
    ["a JSON string", undefined, "2+2"],
    ["null", undefined, null],
    ["missing expression", undefined, { mode: "standard" }],
    ["non-string expression", undefined, { expression: 42, mode: "standard" }],
    ["empty expression", undefined, { expression: "", mode: "standard" }],
    ["501-char expression", undefined, { expression: "1".repeat(501), mode: "standard" }],
    ["missing mode", undefined, { expression: "1+1" }],
    ["bad mode", undefined, { expression: "1+1", mode: "graphing" }],
    ["bad angle", undefined, { expression: "1+1", mode: "standard", angle: "grad" }],
    ["null angle", undefined, { expression: "1+1", mode: "standard", angle: null }],
  ];
  it.each(badBodies)("returns 400 for %s", async (_name, rawBody, body) => {
    const { status, json } = await call("", { method: "POST", rawBody, body: rawBody === undefined ? body : undefined });
    expect(status).toBe(400);
    expect(json.error.code).toBe("BAD_REQUEST");
    expect(store.allRows()).toHaveLength(0);
  });

  it("returns 400 for an oversized body", async () => {
    const { status } = await call("", {
      method: "POST",
      body: { expression: "1+1", mode: "standard", padding: "x".repeat(20000) },
    });
    expect(status).toBe(400);
  });
});

describe("authentication", () => {
  const requests: [string, string, unknown?][] = [
    ["POST", ""],
    ["GET", "/history"],
    ["PATCH", "/history/00000000-0000-4000-8000-000000000000", { label: "x" }],
    ["DELETE", "/history/00000000-0000-4000-8000-000000000000"],
  ];

  it.each(requests)("%s %s without a bearer token is 401", async (method, path, body) => {
    const { status, json } = await call(path, { method, token: null, body: body ?? (method === "POST" ? { expression: "1", mode: "standard" } : undefined) });
    expect(status).toBe(401);
    expect(json.error.code).toBe("UNAUTHORIZED");
  });

  it.each(["Basic abc", "Bearer", "Bearer ", "token-alice", "Bearer a b"])("rejects Authorization: %j", async (value) => {
    const { status } = await call("/history", { token: null, headers: { Authorization: value } });
    expect(status).toBe(401);
  });

  it("returns 401 when the repo rejects the token", async () => {
    const { status, json } = await call("/history", { token: "token-mallory" });
    expect(status).toBe(401);
    expect(json.error.code).toBe("UNAUTHORIZED");
  });

  it("checks auth before validating the body", async () => {
    const { status } = await call("", { method: "POST", rawBody: "{nope", token: null });
    expect(status).toBe(401);
  });

  it("accepts a lower-case bearer scheme", async () => {
    const { status } = await call("/history", { token: null, headers: { Authorization: `bearer ${ALICE}` } });
    expect(status).toBe(200);
  });
});

describe("GET /history", () => {
  it("returns the caller's calculations newest first", async () => {
    await save("1+1");
    await save("2+2");
    await save("3+3");
    await save("9+9", BOB);
    const { status, json } = await call("/history");
    expect(status).toBe(200);
    expect(json.calculations.map((c: Calculation) => c.expression)).toEqual(["3+3", "2+2", "1+1"]);
    const bob = await call("/history", { token: BOB });
    expect(bob.json.calculations.map((c: Calculation) => c.result)).toEqual(["18"]);
  });

  it("returns an empty list for a new user", async () => {
    const { status, json } = await call("/history");
    expect(status).toBe(200);
    expect(json).toEqual({ calculations: [] });
  });

  it("defaults to 50 and honours limit 1..200", async () => {
    for (let i = 0; i < 205; i++) await save(`${i}+0`);
    expect((await call("/history")).json.calculations).toHaveLength(50);
    expect((await call("/history?limit=")).json.calculations).toHaveLength(50);
    expect((await call("/history?limit=1")).json.calculations).toHaveLength(1);
    expect((await call("/history?limit=1")).json.calculations[0].expression).toBe("204+0");
    expect((await call("/history?limit=200")).json.calculations).toHaveLength(200);
  });

  it.each(["0", "201", "-1", "1.5", "abc", "1e2", "50abc"])("returns 400 for limit=%s", async (limit) => {
    const { status, json } = await call(`/history?limit=${limit}`);
    expect(status).toBe(400);
    expect(json.error.code).toBe("BAD_REQUEST");
  });

  it("also works on the bare and edge-runtime paths", async () => {
    for (const url of ["http://x/history", "http://x/calculate/history", "http://x/calculate/history/"]) {
      const res = await handler(new Request(url, { headers: { Authorization: `Bearer ${ALICE}` } }));
      expect(res.status, url).toBe(200);
    }
  });
});

describe("PATCH /history/:id", () => {
  it("sets a label", async () => {
    const saved = await save("6×7");
    const { status, json } = await call(`/history/${saved.id}`, { method: "PATCH", body: { label: "  answer  " } });
    expect(status).toBe(200);
    expect(json.calculation).toEqual({ ...saved, label: "answer" });
    expect((await call("/history")).json.calculations[0].label).toBe("answer");
  });

  it.each([[null], [""], ["   "], ["\t\n"]])("clears the label with %j", async (label) => {
    const saved = await save("1+1");
    await call(`/history/${saved.id}`, { method: "PATCH", body: { label: "temp" } });
    const { status, json } = await call(`/history/${saved.id}`, { method: "PATCH", body: { label } });
    expect(status).toBe(200);
    expect(json.calculation.label).toBeNull();
    expect(store.allRows()[0]!.label).toBeNull();
  });

  it("accepts an 80-character label and rejects 81", async () => {
    const saved = await save("1+1");
    const ok = await call(`/history/${saved.id}`, { method: "PATCH", body: { label: "é".repeat(80) } });
    expect(ok.status).toBe(200);
    const bad = await call(`/history/${saved.id}`, { method: "PATCH", body: { label: "a".repeat(81) } });
    expect(bad.status).toBe(400);
    expect(store.allRows()[0]!.label).toBe("é".repeat(80));
  });

  it.each([
    ["missing label", {}],
    ["numeric label", { label: 5 }],
    ["array body", [1]],
  ])("returns 400 for %s", async (_name, body) => {
    const saved = await save("1+1");
    const { status, json } = await call(`/history/${saved.id}`, { method: "PATCH", body });
    expect(status).toBe(400);
    expect(json.error.code).toBe("BAD_REQUEST");
  });

  it("changes only the label, even if the body has other fields", async () => {
    const saved = await save("1+1");
    const { json } = await call(`/history/${saved.id}`, {
      method: "PATCH",
      body: { label: "x", result: "3", expression: "1+2" },
    });
    expect(json.calculation).toMatchObject({ expression: "1+1", result: "2", label: "x" });
  });

  it("returns 404 for another user's row and leaves it unchanged", async () => {
    const bobs = await save("5+5", BOB);
    const { status, json } = await call(`/history/${bobs.id}`, { method: "PATCH", body: { label: "mine now" } });
    expect(status).toBe(404);
    expect(json.error.code).toBe("NOT_FOUND");
    expect(store.allRows()[0]!.label).toBeNull();
  });

  it("returns 404 for an unknown or malformed id", async () => {
    expect((await call("/history/00000000-0000-4000-8000-000000000000", { method: "PATCH", body: { label: "x" } })).status).toBe(404);
    expect((await call("/history/not-a-uuid", { method: "PATCH", body: { label: "x" } })).status).toBe(404);
  });
});

describe("DELETE /history/:id", () => {
  it("deletes the caller's row with 204 and no body", async () => {
    const saved = await save("1+1");
    const { status, json, res } = await call(`/history/${saved.id}`, { method: "DELETE" });
    expect(status).toBe(204);
    expect(json).toBeNull();
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(store.allRows()).toHaveLength(0);
    expect((await call(`/history/${saved.id}`, { method: "DELETE" })).status).toBe(404);
  });

  it("returns 404 for another user's row and keeps it", async () => {
    const bobs = await save("5+5", BOB);
    const { status } = await call(`/history/${bobs.id}`, { method: "DELETE" });
    expect(status).toBe(404);
    expect(store.allRows()).toHaveLength(1);
  });

  it("returns 404 for a malformed id", async () => {
    expect((await call("/history/abc", { method: "DELETE" })).status).toBe(404);
  });
});

describe("routing", () => {
  it("returns 404 for unknown paths", async () => {
    expect((await call("/nope")).status).toBe(404);
    expect((await handler(new Request("http://x/other-function"))).status).toBe(404);
  });

  it("returns 405 with Allow for a wrong method", async () => {
    const r1 = await call("/history", { method: "POST", body: {} });
    expect(r1.status).toBe(405);
    expect(r1.res.headers.get("allow")).toBe("GET, OPTIONS");
    const r2 = await call("", { method: "GET" });
    expect(r2.status).toBe(405);
    expect(r2.res.headers.get("allow")).toBe("POST, OPTIONS");
    expect((await call("/history/00000000-0000-4000-8000-000000000000", { method: "GET" })).status).toBe(405);
  });

  it("matchRoute maps paths", () => {
    expect(matchRoute("/calculate")?.name).toBe("calculate");
    expect(matchRoute("/functions/v1/calculate/history")?.name).toBe("history");
    expect(matchRoute("/history/abc")).toMatchObject({ name: "item", id: "abc" });
    expect(matchRoute("/calculatex")).toBeNull();
    expect(matchRoute("/history/a/b")).toBeNull();
  });
});

describe("CORS", () => {
  it("answers the OPTIONS preflight without auth", async () => {
    const res = await handler(
      new Request(BASE + "/history/abc", {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:5173",
          "Access-Control-Request-Method": "PATCH",
          "Access-Control-Request-Headers": "authorization, content-type",
        },
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("PATCH");
    expect(res.headers.get("access-control-allow-methods")).toContain("DELETE");
    expect(res.headers.get("access-control-allow-headers")).toContain("authorization");
    expect(res.headers.get("access-control-allow-headers")).toContain("content-type");
    expect(res.headers.get("access-control-allow-headers")).toContain("apikey");
    expect(res.headers.get("access-control-allow-headers")).toContain("x-client-info");
    expect(await res.text()).toBe("");
  });

  it("adds CORS headers to success and error responses", async () => {
    const responses = [
      (await calculate({ expression: "1+1", mode: "standard" })).res,
      (await calculate({ expression: "1/0", mode: "standard" })).res,
      (await calculate({ expression: 1, mode: "standard" })).res,
      (await call("/history", { token: null })).res,
      (await call("/history")).res,
      (await call("/nope")).res,
    ];
    expect(responses.map((r) => r.status)).toEqual([201, 422, 400, 401, 200, 404]);
    for (const r of responses) expect(r.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("supports a configured origin", async () => {
    const h = createHandler({ evaluate, repoFor: store.repoFor, corsOrigin: "https://calc.example.com" });
    const res = await h(new Request(BASE, { method: "OPTIONS" }));
    expect(res.headers.get("access-control-allow-origin")).toBe("https://calc.example.com");
    expect(res.headers.get("vary")).toBe("Origin");
  });
});

describe("failures", () => {
  it("returns 500 without leaking details when the repo fails", async () => {
    const onError = vi.fn();
    const broken: CalculationsRepo = {
      insert: async () => {
        throw new Error("db exploded: secret detail");
      },
      list: async () => {
        throw new RepoError("failed", "boom");
      },
      updateLabel: async () => null,
      delete: async () => false,
    };
    const h = createHandler({ evaluate, repoFor: () => broken, onError });
    const res = await h(
      new Request(BASE, {
        method: "POST",
        headers: { Authorization: "Bearer t" },
        body: JSON.stringify({ expression: "1+1", mode: "standard" }),
      }),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("INTERNAL");
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const res2 = await h(new Request(BASE + "/history", { headers: { Authorization: "Bearer t" } }));
    expect(res2.status).toBe(500);
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it("maps an unauthorized repo error during a query to 401", async () => {
    const repo: CalculationsRepo = {
      insert: async () => {
        throw new RepoError("unauthorized", "JWT expired");
      },
      list: async () => [],
      updateLabel: async () => null,
      delete: async () => false,
    };
    const h = createHandler({ evaluate, repoFor: () => repo });
    const res = await h(
      new Request(BASE, {
        method: "POST",
        headers: { Authorization: "Bearer t" },
        body: JSON.stringify({ expression: "1+1", mode: "standard" }),
      }),
    );
    expect(res.status).toBe(401);
  });
});
