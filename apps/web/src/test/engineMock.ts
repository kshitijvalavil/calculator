import { vi } from "vitest";
import cases from "../../../../contract/test-cases.json";
import type { CalcErrorCode, EvaluateOptions, EvaluateResult } from "../../../../contract/types";

const norm = (s: string) =>
  s.replace(/\s+/g, "").replace(/−/g, "-").replace(/×/g, "*").replace(/÷/g, "/").replace(/π/g, "pi");

type Row = { expression: string; angle?: string; result?: string; error?: string };

const extra: Row[] = [
  { expression: "2 + 3", result: "5" },
  { expression: "5 + 1", result: "6" },
  { expression: "5 × 2", result: "10" },
  { expression: "12 + 7", result: "19" },
  { expression: "2 × (3 + 4)", result: "14" },
  { expression: "2 × (3", error: "SYNTAX" },
  { expression: "sqrt(9)", result: "3" },
  { expression: "sin(90)", result: "1" },
  { expression: "sin(90)", angle: "rad", result: "0.89399666360055789052" },
  { expression: "5", result: "5" },
  { expression: "7", result: "7" },
  { expression: "12", result: "12" },
  { expression: "1", result: "1" },
  { expression: "-5", result: "-5" },
  { expression: "1 ÷ 0", error: "DIVIDE_BY_ZERO" },
  { expression: "1e+24 + 1", error: "SYNTAX" },
];

const table = new Map<string, Row>();
for (const row of [...(cases.cases as Row[]), ...extra]) {
  table.set(`${norm(row.expression)}|${row.angle ?? "deg"}`, row);
}

export function fakeEvaluate(expression: string, options?: EvaluateOptions): EvaluateResult {
  if (!expression.trim()) return { ok: false, error: { code: "EMPTY", message: "Nothing to evaluate" } };
  const row = table.get(`${norm(expression)}|${options?.angle ?? "deg"}`);
  if (row?.result !== undefined) return { ok: true, result: row.result };
  const code = (row?.error ?? "SYNTAX") as CalcErrorCode;
  return { ok: false, error: { code, message: code } };
}

export const evaluate = vi.fn(fakeEvaluate);
