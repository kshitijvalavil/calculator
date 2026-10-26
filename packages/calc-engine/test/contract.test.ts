import { describe, expect, it } from "vitest";
import { evaluate } from "../src/index.ts";
import contract from "../../../contract/test-cases.json";
import type { AngleUnit, CalcErrorCode } from "../../../contract/types.ts";

interface ContractCase {
  expression: string;
  angle?: AngleUnit;
  result?: string;
  error?: CalcErrorCode;
}

const cases = contract.cases as ContractCase[];

describe("contract/test-cases.json", () => {
  it("has cases", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases.map((c) => [JSON.stringify(c.expression) + (c.angle ? ` (${c.angle})` : ""), c] as const))(
    "%s",
    (_name, c) => {
      const out = evaluate(c.expression, c.angle ? { angle: c.angle } : undefined);
      if (c.error !== undefined) {
        expect(out.ok).toBe(false);
        if (!out.ok) {
          expect(out.error.code).toBe(c.error);
          expect(out.error.message.length).toBeGreaterThan(0);
        }
      } else {
        expect(out).toEqual({ ok: true, result: c.result });
      }
    },
  );
});
