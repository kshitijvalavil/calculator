import type { AngleUnit, Evaluate, EvaluateOptions, EvaluateResult } from "../../../contract/types.ts";
import { D, OUTPUT_DIGITS, resetDecimalConfig, type Dec } from "./decimal.ts";
import { CalcFailure, MESSAGES } from "./errors.ts";
import { run } from "./evaluator.ts";
import { parse } from "./parser.ts";
import { tokenize } from "./tokenizer.ts";

export type {
  AngleUnit,
  CalcError,
  CalcErrorCode,
  Evaluate,
  EvaluateOptions,
  EvaluateResult,
} from "../../../contract/types.ts";
export { tokenize, FUNCTIONS, CONSTANTS, type Token } from "./tokenizer.ts";
export { parse, MAX_DEPTH, type Program, type Instruction } from "./parser.ts";
export { CalcFailure, MESSAGES } from "./errors.ts";

const OVERFLOW_LIMIT = new D("1e1000");

/** Rounds to 20 significant digits half-up and renders per the contract (no -0, `1e+24` style). */
export function formatResult(value: Dec): string {
  const rounded = value.toSignificantDigits(OUTPUT_DIGITS, D.ROUND_HALF_UP);
  if (!rounded.isFinite() || rounded.abs().gte(OVERFLOW_LIMIT)) {
    throw new CalcFailure("OVERFLOW", MESSAGES.overflow);
  }
  if (rounded.isZero()) return "0";
  return rounded.toString();
}

/** Evaluates a calculator expression. Never throws. */
export const evaluate: Evaluate = (expression: string, options?: EvaluateOptions): EvaluateResult => {
  const angle: AngleUnit = options?.angle === "rad" ? "rad" : "deg";
  try {
    if (typeof expression !== "string" || expression.trim() === "") {
      return { ok: false, error: { code: "EMPTY", message: MESSAGES.empty } };
    }
    const program = parse(tokenize(expression));
    return { ok: true, result: formatResult(run(program, angle)) };
  } catch (err) {
    if (err instanceof CalcFailure) return { ok: false, error: err.toCalcError() };
    // Anything else (a decimal.js internal limit, a stack overflow) must not
    // leak out or leave decimal.js misconfigured.
    resetDecimalConfig();
    return { ok: false, error: { code: "SYNTAX", message: MESSAGES.tooComplex } };
  }
};

export default evaluate;
