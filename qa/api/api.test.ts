// Black-box tests of the @calc/api handler against contract/types.ts + CONTRACT.md.
// Only the wiring (createHandler deps, InMemoryCalculationsStore) was adapted to the landed exports.
import { describe, it, expect, beforeEach } from "vitest";
import { createHandler, InMemoryCalculationsStore, RepoError } from "../../packages/calc-api/src/index.ts";
import { evaluate } from "../../packages/calc-engine/src/index.ts";

const BASE = "http://localhost/functions/v1/calculate";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKENS: Record<string, string> = { tokA: "11111111-1111-4111-8111-111111111111", tokB: "22222222-2222-4222-8222-222222222222" };

let store: InMemoryCalculationsStore;
let handle: (r: Request) => Promise<Response>;
let errors: unknown[];
beforeEach(() => {
  store = new InMemoryCalculationsStore({ resolveUser: (t) => TOKENS[t] ?? null });
  errors = [];
  handle = createHandler({ evaluate, repoFor: store.repoFor, onError: (e) => errors.push(e) });
});

type Opts = { method?: string; token?: string | null; body?: unknown; raw?: BodyInit; headers?: Record<string, string> };
async function call(path: string, o: Opts = {}) {
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.token !== null) headers["authorization"] ??= `Bearer ${o.token ?? "tokA"}`;
  let body: BodyInit | undefined = o.raw;
  if (o.body !== undefined) { body = JSON.stringify(o.body); headers["content-type"] ??= "application/json"; }
  const res = await handle(new Request(BASE + path, { method: o.method ?? "GET", headers, body }));
  const text = await res.text();
  let json: any = undefined;
  try { json = text ? JSON.parse(text) : undefined; } catch { /* not json */ }
  return { res, status: res.status, json, text };
}
const post = (body: unknown, o: Opts = {}) => call("", { method: "POST", body, ...o });
async function saved(expression = "1 + 1", token = "tokA") {
  const r = await post({ expression, mode: "standard" }, { token });
  expect(r.status).toBe(201);
  return r.json.calculation;
}
function noLeak(text: string) {
  expect(text).not.toMatch(/user_id|at .*\.ts:\d+|stack/i);
}

describe("POST /calculate happy path", () => {
  it("201 with a full Calculation, recomputed server-side", async () => {
    const r = await post({ expression: "0.1 + 0.2", mode: "standard" });
    expect(r.status).toBe(201);
    const c = r.json.calculation;
    expect(c).toMatchObject({ expression: "0.1 + 0.2", result: "0.3", mode: "standard", angle: "deg", label: null });
    expect(c.id).toMatch(UUID);
    expect(new Date(c.created_at).toISOString()).toBe(c.created_at.replace(/\+00:00$/, "Z").replace(/(\.\d{3})\d*/, "$1"));
    expect(Object.keys(c).sort()).toEqual(["angle", "created_at", "expression", "id", "label", "mode", "result"]);
    expect(r.res.headers.get("content-type") ?? "").toMatch(/application\/json/);
  });
  it("angle rad is honoured", async () => {
    const r = await post({ expression: "sin(pi)", mode: "scientific", angle: "rad" });
    expect(r.status).toBe(201);
    expect(r.json.calculation).toMatchObject({ result: "0", angle: "rad", mode: "scientific" });
  });
  it("client-sent result / id / user_id / created_at / label are ignored", async () => {
    const r = await post({ expression: "2 + 2", mode: "standard", result: "5", id: "00000000-0000-4000-8000-000000000000",
      user_id: TOKENS.tokB, created_at: "2000-01-01T00:00:00Z", label: "injected" });
    expect(r.status).toBe(201);
    const c = r.json.calculation;
    expect(c.result).toBe("4");
    expect(c.id).not.toBe("00000000-0000-4000-8000-000000000000");
    expect(c.created_at.startsWith("2000")).toBe(false);
    expect(c.label).toBeNull();
    const rows = store.allRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(TOKENS.tokA);
    expect(rows[0].result).toBe("4");
  });
  it("expression is stored as typed (not normalised)", async () => {
    const r = await post({ expression: "  2×−3 ", mode: "standard" });
    expect(r.status).toBe(201);
    expect(r.json.calculation.result).toBe("-6");
  });
  it("prototype-pollution keys in body are harmless", async () => {
    const r = await call("", { method: "POST", raw: '{"expression":"1+1","mode":"standard","__proto__":{"polluted":1},"constructor":{"prototype":{"x":1}}}',
      headers: { "content-type": "application/json" } });
    expect(r.status).toBe(201);
    expect(({} as any).polluted).toBeUndefined();
  });
});

describe("POST /calculate errors", () => {
  const calcErrors: [string, string][] = [["1 ÷ 0", "DIVIDE_BY_ZERO"], ["sqrt(-1)", "DOMAIN"], ["2 +", "SYNTAX"], ["10 ^ 100000", "OVERFLOW"], ["", "EMPTY"], ["   ", "EMPTY"], ["1+1\u0000", "SYNTAX"]];
  for (const [expr, code] of calcErrors) {
    it(`422 ${code} for ${JSON.stringify(expr)} and nothing saved`, async () => {
      const r = await post({ expression: expr, mode: "standard" });
      expect(r.status).toBe(422);
      expect(r.json.error.code).toBe(code);
      expect(typeof r.json.error.message).toBe("string");
      expect(store.allRows()).toHaveLength(0);
    });
  }
  const bad: [string, Opts][] = [
    ["malformed JSON", { raw: '{"expression": "1+1", ', headers: { "content-type": "application/json" } }],
    ["empty body", { raw: "", headers: { "content-type": "application/json" } }],
    ["no body", { headers: { "content-type": "application/json" } }],
    ["JSON null", { body: null }],
    ["JSON array", { body: [{ expression: "1+1", mode: "standard" }] }],
    ["JSON string", { body: "1+1" }],
    ["JSON number", { body: 42 }],
    ["missing expression", { body: { mode: "standard" } }],
    ["expression number", { body: { expression: 2, mode: "standard" } }],
    ["expression null", { body: { expression: null, mode: "standard" } }],
    ["expression object", { body: { expression: { toString: "1+1" }, mode: "standard" } }],
    ["missing mode", { body: { expression: "1+1" } }],
    ["mode wrong case", { body: { expression: "1+1", mode: "Standard" } }],
    ["mode garbage", { body: { expression: "1+1", mode: "hacker" } }],
    ["angle grad", { body: { expression: "1+1", mode: "standard", angle: "grad" } }],
    ["angle null", { body: { expression: "1+1", mode: "standard", angle: null } }],
    ["expression 501 chars", { body: { expression: "1" + "+0".repeat(250), mode: "standard" } }],
    ["expression 100k chars", { body: { expression: "1+".repeat(50000) + "1", mode: "standard" } }],
    ["BOM-prefixed JSON", { raw: '﻿{"expression":"1+1","mode":"standard"}', headers: { "content-type": "application/json" } }],
  ];
  for (const [name, o] of bad) {
    it(`400 BAD_REQUEST: ${name}`, async () => {
      const r = await call("", { method: "POST", ...o });
      if (name === "BOM-prefixed JSON") { expect([201, 400]).toContain(r.status); return; }
      expect(r.status).toBe(400);
      expect(r.json?.error?.code).toBe("BAD_REQUEST");
      expect(store.allRows()).toHaveLength(0);
      noLeak(r.text);
    });
  }
  it("expression of exactly 500 chars is accepted", async () => {
    const expr = "1" + "+0".repeat(249) + " "; // 500 chars
    expect(expr.length).toBe(500);
    const r = await post({ expression: expr, mode: "standard" });
    expect(r.status).toBe(201);
  });
  it("10 MB body is refused without a 500", async () => {
    const r = await call("", { method: "POST", raw: JSON.stringify({ expression: "1", mode: "standard", pad: "x".repeat(10_000_000) }),
      headers: { "content-type": "application/json" } });
    expect(r.status).toBeLessThan(500);
    expect([201, 400, 413]).toContain(r.status);
  });
  it("10 MB body that is not JSON is refused with 4xx", async () => {
    const r = await call("", { method: "POST", raw: "{".repeat(10_000_000), headers: { "content-type": "application/json" } });
    expect([400, 413]).toContain(r.status);
  });
  for (const ct of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", ""]) {
    it(`content-type ${JSON.stringify(ct)} with JSON body: not a 500`, async () => {
      const r = await call("", { method: "POST", raw: '{"expression":"1+1","mode":"standard"}', headers: ct ? { "content-type": ct } : {} });
      expect([201, 400, 415]).toContain(r.status);
    });
  }
  it("form-encoded body is a 4xx", async () => {
    const r = await call("", { method: "POST", raw: "expression=1%2B1&mode=standard", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect([400, 415]).toContain(r.status);
  });
});

describe("auth", () => {
  const cases: [string, Record<string, string> | null][] = [
    ["no Authorization header", null],
    ["empty header", { authorization: "" }],
    ["Bearer with no token", { authorization: "Bearer " }],
    ["Bearer only", { authorization: "Bearer" }],
    ["Basic scheme", { authorization: "Basic dG9rQTp4" }],
    ["garbage token", { authorization: "Bearer not-a-real-token" }],
    ["token with trailing junk", { authorization: "Bearer tokA extra" }],
    ["raw token without scheme", { authorization: "tokA" }],
  ];
  for (const [name, h] of cases) {
    for (const [method, path, body] of [["POST", "", { expression: "1+1", mode: "standard" }], ["GET", "/history", undefined],
      ["PATCH", "/history/33333333-3333-4333-8333-333333333333", { label: "x" }], ["DELETE", "/history/33333333-3333-4333-8333-333333333333", undefined]] as const) {
      it(`401 UNAUTHORIZED: ${name} on ${method} ${path || "/"}`, async () => {
        const r = await call(path, { method, token: null, headers: h ?? {}, body });
        expect(r.status).toBe(401);
        expect(r.json?.error?.code).toBe("UNAUTHORIZED");
        expect(r.res.headers.get("access-control-allow-origin")).toBeTruthy();
        expect(store.allRows()).toHaveLength(0);
      });
    }
  }
  it("401 is returned before body validation (unauthenticated malformed JSON)", async () => {
    const r = await call("", { method: "POST", token: null, raw: "{oops", headers: { "content-type": "application/json" } });
    expect(r.status).toBe(401);
  });
  it("lowercase 'bearer' scheme is accepted (RFC 7235: scheme is case-insensitive)", async () => {
    const r = await call("/history", { token: null, headers: { authorization: "bearer tokA" } });
    expect(r.status).toBe(200);
  });
  it("repo factory throwing RepoError('unauthorized') maps to 401", async () => {
    const h = createHandler({ evaluate, repoFor: () => { throw new RepoError("unauthorized", "expired"); }, onError: () => {} });
    const res = await h(new Request(BASE + "/history", { headers: { authorization: "Bearer x" } }));
    expect(res.status).toBe(401);
  });
  it("unexpected repo failure is a JSON 500 with CORS and no stack/internal leak", async () => {
    const h = createHandler({ evaluate, repoFor: () => ({
      insert: async () => { throw new Error("connection to db.internal:5432 refused SECRET"); },
      list: async () => { throw new Error("boom"); }, updateLabel: async () => null, delete: async () => false,
    }), onError: () => {} });
    const res = await h(new Request(BASE, { method: "POST", headers: { authorization: "Bearer x", "content-type": "application/json" },
      body: JSON.stringify({ expression: "1+1", mode: "standard" }) }));
    expect(res.status).toBe(500);
    expect(res.headers.get("access-control-allow-origin")).toBeTruthy();
    const t = await res.text();
    expect(t).not.toMatch(/SECRET|db\.internal|at .*\.ts/);
    expect(JSON.parse(t).error).toBeTruthy();
  });
});

describe("CORS", () => {
  it("OPTIONS preflight without auth succeeds with the right headers", async () => {
    const res = await handle(new Request(BASE + "/history/abc", { method: "OPTIONS", headers: {
      origin: "https://app.example", "access-control-request-method": "PATCH", "access-control-request-headers": "authorization, content-type" } }));
    expect([200, 204]).toContain(res.status);
    expect(res.headers.get("access-control-allow-origin")).toBeTruthy();
    const methods = (res.headers.get("access-control-allow-methods") ?? "").toUpperCase();
    for (const m of ["POST", "GET", "PATCH", "DELETE"]) expect(methods).toContain(m);
    const hdrs = (res.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    expect(hdrs).toContain("authorization");
    expect(hdrs).toContain("content-type");
  });
  it("Supabase client headers (apikey, x-client-info) are allowed in preflight", async () => {
    const res = await handle(new Request(BASE, { method: "OPTIONS" }));
    const hdrs = (res.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    expect(hdrs).toContain("apikey");
    expect(hdrs).toContain("x-client-info");
  });
  it("CORS header on 201, 400, 404, 405, 422 responses", async () => {
    const rs = [
      await post({ expression: "1+1", mode: "standard" }),
      await call("", { method: "POST", raw: "{", headers: { "content-type": "application/json" } }),
      await call("/history/33333333-3333-4333-8333-333333333333", { method: "DELETE" }),
      await call("", { method: "GET" }),
      await post({ expression: "1/0", mode: "standard" }),
    ];
    for (const r of rs) expect(r.res.headers.get("access-control-allow-origin"), String(r.status)).toBeTruthy();
  });
});

describe("routing / methods", () => {
  const m: [string, string][] = [["GET", ""], ["PUT", ""], ["DELETE", ""], ["POST", "/history"], ["PUT", "/history"], ["DELETE", "/history"],
    ["PATCH", "/history"], ["GET", "/history/33333333-3333-4333-8333-333333333333"], ["PUT", "/history/33333333-3333-4333-8333-333333333333"],
    ["POST", "/history/33333333-3333-4333-8333-333333333333"]];
  for (const [method, path] of m) {
    it(`405 for ${method} ${path || "/"}`, async () => {
      const r = await call(path, { method, body: method === "GET" ? undefined : {} });
      expect(r.status).toBe(405);
    });
  }
  it("HEAD is not a 500", async () => {
    const res = await handle(new Request(BASE + "/history", { method: "HEAD", headers: { authorization: "Bearer tokA" } }));
    expect(res.status).toBeLessThan(500);
  });
  it("unknown path is 404", async () => {
    for (const p of ["/nope", "/history/a/b", "/../../etc/passwd", "/historyX"]) {
      const r = await call(p, { method: "GET" });
      expect([404, 405], p).toContain(r.status);
    }
  });
  it("trailing slash and query string on /history work", async () => {
    await saved();
    expect((await call("/history/")).status).toBe(200);
    expect((await call("/history?limit=5&x=1")).json.calculations).toHaveLength(1);
  });
});

describe("GET /history", () => {
  it("newest first, default limit 50, max 200", async () => {
    for (let i = 0; i < 205; i++) await saved(`${i} + 0`);
    const d = await call("/history");
    expect(d.status).toBe(200);
    expect(d.json.calculations).toHaveLength(50);
    expect(d.json.calculations[0].expression).toBe("204 + 0");
    expect(d.json.calculations[49].expression).toBe("155 + 0");
    const all = await call("/history?limit=200");
    expect(all.json.calculations).toHaveLength(200);
    const one = await call("/history?limit=1");
    expect(one.json.calculations).toHaveLength(1);
    for (const c of all.json.calculations) expect(c).not.toHaveProperty("user_id");
  });
  for (const lim of ["0", "201", "-1", "abc", "1.5", "", "1e2", "999999999999999999999", "50abc", " 5"]) {
    it(`limit=${JSON.stringify(lim)} is 400 or clamped to 1..200, never 500`, async () => {
      for (let i = 0; i < 3; i++) await saved();
      const r = await call(`/history?limit=${encodeURIComponent(lim)}`);
      expect([200, 400]).toContain(r.status);
      if (r.status === 200) { expect(r.json.calculations.length).toBeGreaterThanOrEqual(1); expect(r.json.calculations.length).toBeLessThanOrEqual(200); }
      else expect(r.json.error.code).toBe("BAD_REQUEST");
    });
  }
  it("users only see their own rows", async () => {
    await saved("1+1", "tokA"); await saved("2+2", "tokB");
    const a = await call("/history", { token: "tokA" });
    const b = await call("/history", { token: "tokB" });
    expect(a.json.calculations.map((c: any) => c.expression)).toEqual(["1+1"]);
    expect(b.json.calculations.map((c: any) => c.expression)).toEqual(["2+2"]);
  });
});

describe("PATCH /history/:id", () => {
  it("sets, then clears with \"\" and null", async () => {
    const c = await saved();
    let r = await call(`/history/${c.id}`, { method: "PATCH", body: { label: "groceries" } });
    expect(r.status).toBe(200);
    expect(r.json.calculation).toMatchObject({ id: c.id, label: "groceries", expression: c.expression, result: c.result });
    r = await call(`/history/${c.id}`, { method: "PATCH", body: { label: "" } });
    expect(r.json.calculation.label).toBeNull();
    await call(`/history/${c.id}`, { method: "PATCH", body: { label: "x" } });
    r = await call(`/history/${c.id}`, { method: "PATCH", body: { label: null } });
    expect(r.json.calculation.label).toBeNull();
  });
  it("only label changes even if other fields are sent", async () => {
    const c = await saved("2 + 2");
    const r = await call(`/history/${c.id}`, { method: "PATCH", body: { label: "x", expression: "9", result: "9", id: "x", created_at: "2000-01-01" } });
    expect(r.status).toBe(200);
    expect(r.json.calculation).toMatchObject({ id: c.id, expression: "2 + 2", result: "4", created_at: c.created_at, label: "x" });
  });
  it("80 single-codepoint emoji are accepted (DB counts 80 chars, not 160 UTF-16 units)", async () => {
    const c = await saved();
    const r = await call(`/history/${c.id}`, { method: "PATCH", body: { label: "😀".repeat(80) } });
    expect(r.status).toBe(200);
  });
  it("41 emoji (82 UTF-16 units, 41 chars) are accepted", async () => {
    const c = await saved();
    const r = await call(`/history/${c.id}`, { method: "PATCH", body: { label: "😀".repeat(41) } });
    expect(r.status).toBe(200);
  });
  const badLabels: [string, unknown][] = [["81 ascii chars", "a".repeat(81)], ["81 emoji", "😀".repeat(81)], ["number", 5], ["object", { a: 1 }],
    ["array", ["x"]], ["boolean", true], ["NUL byte (Postgres text rejects it)", "a\u0000b"]];
  for (const [name, label] of badLabels) {
    it(`400 for label ${name}`, async () => {
      const c = await saved();
      const r = await call(`/history/${c.id}`, { method: "PATCH", body: { label } });
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe("BAD_REQUEST");
    });
  }
  it("400 when label key is missing / body malformed", async () => {
    const c = await saved();
    expect((await call(`/history/${c.id}`, { method: "PATCH", body: {} })).status).toBe(400);
    expect((await call(`/history/${c.id}`, { method: "PATCH", raw: "{", headers: { "content-type": "application/json" } })).status).toBe(400);
    expect((await call(`/history/${c.id}`, { method: "PATCH", body: null })).status).toBe(400);
  });
  it("404 on another user's row, and their row is untouched", async () => {
    const c = await saved("1+1", "tokB");
    const r = await call(`/history/${c.id}`, { method: "PATCH", token: "tokA", body: { label: "pwned" } });
    expect(r.status).toBe(404);
    expect(store.allRows()[0].label).toBeNull();
  });
});

describe("DELETE /history/:id", () => {
  it("204 with empty body, then 404 on repeat", async () => {
    const c = await saved();
    const r = await call(`/history/${c.id}`, { method: "DELETE" });
    expect(r.status).toBe(204);
    expect(r.text).toBe("");
    expect((await call(`/history/${c.id}`, { method: "DELETE" })).status).toBe(404);
  });
  it("404 on another user's row, row survives", async () => {
    const c = await saved("1+1", "tokB");
    expect((await call(`/history/${c.id}`, { method: "DELETE", token: "tokA" })).status).toBe(404);
    expect(store.allRows()).toHaveLength(1);
  });
});

describe("hostile ids", () => {
  it("malformed percent-encoding without auth is 401/404, not 500", async () => {
    const r = await call("/history/%E0%A4%A", { method: "DELETE", token: null });
    expect([401, 404]).toContain(r.status);
  });
  const ids = ["not-a-uuid", "..%2F..%2Fetc%2Fpasswd", "%2e%2e", "' or 1=1--", "%E0%A4%A", "%", "%00", "*", "x".repeat(10000),
    "11111111-1111-4111-8111-111111111111%2F..", "00000000-0000-0000-0000-000000000000"];
  for (const id of ids) {
    for (const method of ["PATCH", "DELETE"]) {
      it(`${method} /history/${id.slice(0, 40)} -> 400/404, never 500`, async () => {
        await saved();
        const r = await call(`/history/${id}`, { method, body: method === "PATCH" ? { label: "x" } : undefined });
        // WHATWG URL turns %2e%2e into a real ".." segment, so that one legitimately lands on the POST route (405).
        expect(id === "%2e%2e" ? [400, 404, 405] : [400, 404]).toContain(r.status);
        expect(errors).toEqual([]);
        noLeak(r.text);
        expect(store.allRows()).toHaveLength(1);
        expect(store.allRows()[0].label).toBeNull();
      });
    }
  }
});
