import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseRepoFactory, RepoError } from "../src/index.ts";

interface Captured {
  method: string;
  url: URL;
  headers: Headers;
  body: unknown;
}

/** Wires supabase-js to a fake fetch so we can check what goes over the wire to PostgREST. */
function setup(respond: (req: Captured) => { status: number; body?: unknown }) {
  const calls: Captured[] = [];
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    const text = await req.text();
    const captured: Captured = {
      method: req.method,
      url: new URL(req.url),
      headers: req.headers,
      body: text ? JSON.parse(text) : undefined,
    };
    calls.push(captured);
    const { status, body } = respond(captured);
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  const repoFor = createSupabaseRepoFactory({
    url: "https://proj.supabase.co",
    anonKey: "anon-key",
    createClient: (url, key, options) =>
      createClient(url, key, { ...options, global: { ...options?.global, fetch: fakeFetch } }),
  });
  return { calls, repo: repoFor("user-jwt") };
}

const row = {
  id: "11111111-1111-4111-8111-111111111111",
  expression: "1+1",
  result: "2",
  mode: "standard",
  angle: "deg",
  label: null,
  created_at: "2026-10-26T12:00:00.000000+00:00",
};

describe("Supabase repo", () => {
  it("inserts only the granted columns with the caller's JWT", async () => {
    const { calls, repo } = setup(() => ({ status: 201, body: row }));
    const saved = await repo.insert({ expression: "1+1", result: "2", mode: "standard", angle: "deg" });
    expect(saved).toEqual(row);
    const c = calls[0]!;
    expect(c.method).toBe("POST");
    expect(c.url.pathname).toBe("/rest/v1/calculations");
    expect(c.headers.get("authorization")).toBe("Bearer user-jwt");
    expect(c.headers.get("apikey")).toBe("anon-key");
    expect(c.body).toEqual({ expression: "1+1", result: "2", mode: "standard", angle: "deg" });
    expect(c.url.searchParams.get("select")).not.toContain("user_id");
  });

  it("lists newest first with a limit", async () => {
    const { calls, repo } = setup(() => ({ status: 200, body: [row] }));
    expect(await repo.list(7)).toEqual([row]);
    const c = calls[0]!;
    expect(c.method).toBe("GET");
    expect(c.url.searchParams.get("order")).toBe("created_at.desc,id.desc");
    expect(c.url.searchParams.get("limit")).toBe("7");
  });

  it("updates only label and returns null when RLS hides the row", async () => {
    const { calls, repo } = setup(() => ({ status: 200, body: [] }));
    expect(await repo.updateLabel(row.id, "x")).toBeNull();
    const c = calls[0]!;
    expect(c.method).toBe("PATCH");
    expect(c.body).toEqual({ label: "x" });
    expect(c.url.searchParams.get("id")).toBe(`eq.${row.id}`);
  });

  it("returns the updated row", async () => {
    const { repo } = setup(() => ({ status: 200, body: [{ ...row, label: "hi" }] }));
    expect(await repo.updateLabel(row.id, "hi")).toEqual({ ...row, label: "hi" });
  });

  it("reports whether a delete removed a row", async () => {
    const hit = setup(() => ({ status: 200, body: [{ id: row.id }] }));
    expect(await hit.repo.delete(row.id)).toBe(true);
    expect(hit.calls[0]!.method).toBe("DELETE");
    const miss = setup(() => ({ status: 200, body: [] }));
    expect(await miss.repo.delete(row.id)).toBe(false);
  });

  it("maps JWT and permission errors to unauthorized, others to failed", async () => {
    const jwt = setup(() => ({ status: 401, body: { code: "PGRST301", message: "JWT expired" } }));
    await expect(jwt.repo.list(5)).rejects.toMatchObject({ kind: "unauthorized" });
    const perm = setup(() => ({ status: 403, body: { code: "42501", message: "permission denied" } }));
    await expect(perm.repo.list(5)).rejects.toMatchObject({ kind: "unauthorized" });
    const other = setup(() => ({ status: 400, body: { code: "23514", message: "check violation" } }));
    const e = await other.repo.list(5).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(RepoError);
    expect((e as RepoError).kind).toBe("failed");
  });
});
