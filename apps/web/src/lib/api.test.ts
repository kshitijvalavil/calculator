import { describe, expect, it, vi } from "vitest";
import type { Calculation } from "../../../../contract/types";
import { ApiError, createApiClient } from "./api";
import { createApiStore, createHistoryStore } from "./history";

const BASE = "https://proj.supabase.co/functions/v1/calculate";

const row = (over: Partial<Calculation> = {}): Calculation => ({
  id: "11111111-1111-4111-8111-111111111111",
  expression: "2 + 3",
  result: "5",
  mode: "standard",
  angle: "deg",
  label: null,
  created_at: "2026-10-26T10:00:00.000Z",
  ...over,
});

const json = (status: number, body: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function setup(...responses: Response[]) {
  const fetchMock = vi.fn<typeof fetch>();
  responses.forEach((r) => fetchMock.mockResolvedValueOnce(r));
  const getToken = vi.fn(async (refresh?: boolean) => (refresh ? "token-2" : "token-1"));
  const client = createApiClient({ baseUrl: BASE + "/", getToken, fetch: fetchMock });
  return { client, fetchMock, getToken };
}

describe("API client", () => {
  it("POSTs a calculation with the bearer token and returns the saved row", async () => {
    const saved = row({ result: "5" });
    const { client, fetchMock } = setup(json(201, { calculation: saved }));
    const out = await client.calculate({ expression: "2 + 3", mode: "standard", angle: "deg" });
    expect(out).toEqual({ ok: true, calculation: saved });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/calculate`);
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer token-1");
    expect(JSON.parse(init?.body as string)).toEqual({ expression: "2 + 3", mode: "standard", angle: "deg" });
  });

  it("returns a CalcError on 422 instead of throwing", async () => {
    const error = { code: "DIVIDE_BY_ZERO", message: "Can't divide by zero" };
    const { client } = setup(json(422, { error }));
    expect(await client.calculate({ expression: "1 ÷ 0", mode: "standard" })).toEqual({ ok: false, error });
  });

  it("retries once with a refreshed token after a 401", async () => {
    const { client, fetchMock, getToken } = setup(
      json(401, { error: { code: "UNAUTHORIZED", message: "no" } }),
      json(200, { calculations: [row()] }),
    );
    expect(await client.history()).toHaveLength(1);
    expect(getToken).toHaveBeenLastCalledWith(true);
    expect((fetchMock.mock.calls[1][1]?.headers as Record<string, string>).Authorization).toBe("Bearer token-2");
  });

  it("GETs history with a limit", async () => {
    const { client, fetchMock } = setup(json(200, { calculations: [row(), row({ id: "2" })] }));
    expect(await client.history(25)).toHaveLength(2);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/history?limit=25`);
  });

  it("PATCHes a label and DELETEs an entry", async () => {
    const { client, fetchMock } = setup(json(200, { calculation: row({ label: "Rent" }) }), new Response(null, { status: 204 }));
    expect((await client.updateLabel("abc", "Rent")).label).toBe("Rent");
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/history/abc`);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("PATCH");
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({ label: "Rent" });
    await client.remove("abc");
    expect(fetchMock.mock.calls[1][1]?.method).toBe("DELETE");
  });

  it("throws ApiError with the server's code on other failures", async () => {
    const { client } = setup(json(404, { error: { code: "NOT_FOUND", message: "Not found" } }));
    await expect(client.remove("nope")).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  it("wraps network failures in ApiError", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));
    const client = createApiClient({ baseUrl: BASE, getToken: async () => "t", fetch: fetchMock });
    await expect(client.history()).rejects.toBeInstanceOf(ApiError);
  });
});

describe("API store", () => {
  it("uses the server's result and normalizes labels", async () => {
    const { client, fetchMock } = setup(
      json(201, { calculation: row({ result: "5.000" }) }),
      json(200, { calculation: row({ label: null }) }),
    );
    const store = createApiStore(client);
    expect(store.kind).toBe("api");
    const out = await store.save({ expression: "2 + 3", mode: "standard", angle: "deg" });
    expect(out.ok && out.calculation.result).toBe("5.000");
    await store.updateLabel("x", "   ");
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({ label: null });
  });
});

describe("createHistoryStore", () => {
  it("falls back to local mode without Supabase env vars", () => {
    expect(createHistoryStore({}).kind).toBe("local");
    expect(createHistoryStore({ VITE_SUPABASE_URL: "https://x.supabase.co" }).kind).toBe("local");
  });

  it("uses API mode when both env vars are set", () => {
    expect(createHistoryStore({ VITE_SUPABASE_URL: "https://x.supabase.co", VITE_SUPABASE_ANON_KEY: "k" }).kind).toBe("api");
  });
});
