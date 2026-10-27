import { describe, expect, it } from "vitest";
import { createLocalStore, isCalculation, LOCAL_KEY, MAX_LOCAL } from "./history";

const good = {
  id: "a",
  expression: "2 + 3",
  result: "5",
  mode: "standard",
  angle: "deg",
  label: null,
  created_at: "2026-10-26T10:00:00.000Z",
};

describe("local history store", () => {
  it.each([["[null]"], ["[{}]"], ["[1]"], ['"oops"'], ["{not json"], ['{"a":1}']])(
    "survives corrupted storage %s",
    async (raw) => {
      localStorage.setItem(LOCAL_KEY, raw);
      expect(await createLocalStore().list()).toEqual([]);
    },
  );

  it("drops invalid entries and keeps valid ones", async () => {
    const bad = [null, 1, "x", {}, { ...good, id: 5 }, { ...good, mode: "turbo" }, { ...good, label: 3 }, { ...good, result: "" }];
    localStorage.setItem(LOCAL_KEY, JSON.stringify([...bad, good]));
    expect(await createLocalStore().list()).toEqual([good]);
    expect(isCalculation(good)).toBe(true);
  });

  it(`keeps only the newest ${MAX_LOCAL} entries`, async () => {
    const many = Array.from({ length: 5000 }, (_, i) => ({ ...good, id: String(i) }));
    localStorage.setItem(LOCAL_KEY, JSON.stringify(many));
    const store = createLocalStore();
    expect(await store.list()).toHaveLength(MAX_LOCAL);
    const out = await store.save({ expression: "2 + 3", mode: "standard", angle: "deg" });
    expect(out.ok).toBe(true);
    const rows = await store.list();
    expect(rows).toHaveLength(MAX_LOCAL);
    expect(rows[0].id).toBe(out.ok ? out.calculation.id : "");
    expect(JSON.parse(localStorage.getItem(LOCAL_KEY)!)).toHaveLength(MAX_LOCAL);
  });

  it("returns engine errors without saving", async () => {
    const store = createLocalStore();
    expect(await store.save({ expression: "1 ÷ 0", mode: "standard", angle: "deg" })).toMatchObject({
      ok: false,
      error: { code: "DIVIDE_BY_ZERO" },
    });
    expect(await store.list()).toEqual([]);
  });
});
