import { evaluate as engineEvaluate } from "@calc/engine";
import type { AngleUnit, EvaluateResult } from "../../../../contract/types";

/** Calls the shared engine. Never throws, even if the engine misbehaves. */
export function evaluate(expression: string, angle: AngleUnit): EvaluateResult {
  try {
    return engineEvaluate(expression, { angle });
  } catch {
    return { ok: false, error: { code: "SYNTAX", message: "Something went wrong" } };
  }
}
