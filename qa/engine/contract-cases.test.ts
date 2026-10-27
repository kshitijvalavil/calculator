import { describe, it, expect } from "vitest";
import cases from "../../contract/test-cases.json" with { type: "json" };
import { ev, show, shapeProblems } from "./_helpers.ts";

describe("canonical contract cases (independent run)", () => {
  for (const c of (cases as any).cases) {
    it(`${JSON.stringify(c.expression)}${c.angle ? " [" + c.angle + "]" : ""}`, () => {
      const r = ev(c.expression, c.angle);
      expect(shapeProblems(r)).toEqual([]);
      expect(show(r)).toBe(c.result ?? `ERR:${c.error}`);
    });
  }
});
