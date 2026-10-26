// Contract-only helpers for black-box engine tests (no builder source consulted).
import { evaluate } from "../../packages/calc-engine/src/index.ts";
import type { EvaluateResult, CalcErrorCode } from "../../contract/types.ts";

export { evaluate };
export const CODES: CalcErrorCode[] = ["EMPTY", "SYNTAX", "DIVIDE_BY_ZERO", "DOMAIN", "OVERFLOW"];

/** Plain: no exponent, exponent in [-7, 20]; Exp: decimal.js style when exponent >= 21 or <= -7. */
const PLAIN = /^-?(0|[1-9]\d*)(\.\d*[1-9])?$/;
const EXP = /^-?[1-9](\.\d*[1-9])?e[+-][1-9]\d*$/;

/** Returns a list of contract violations in a result (empty = well-formed). */
export function shapeProblems(r: unknown): string[] {
  const p: string[] = [];
  if (!r || typeof r !== "object") return ["result is not an object"];
  const o = r as Record<string, unknown>;
  if (o.ok === true) {
    const s = o.result;
    if (typeof s !== "string") return ["ok result is not a string"];
    if (s === "-0") p.push("result is -0");
    if (/nan|infinity/i.test(s)) p.push(`result contains NaN/Infinity: ${s}`);
    if (!PLAIN.test(s) && !EXP.test(s)) p.push(`bad number format: ${s}`);
    const digits = s.replace(/^-/, "").replace(/e.*$/, "").replace(".", "").replace(/^0+/, "");
    if (digits.length > 20 && !/^\d+$/.test(s.replace(/^-/, ""))) p.push(`more than 20 significant digits: ${s}`);
    if (PLAIN.test(s)) {
      const intPart = s.replace(/^-/, "").split(".")[0];
      const sig = s.replace(/^-/, "").replace(".", "").replace(/^0+/, "").replace(/0+$/, "");
      if (intPart.length > 21) p.push(`plain notation used for exponent >= 21: ${s}`);
      if (sig.length > 20) p.push(`more than 20 significant digits: ${s}`);
      const m = s.match(/^-?0\.(0*)/);
      if (m && m[1].length >= 6) p.push(`plain notation used for exponent <= -7: ${s}`);
    }
    if (EXP.test(s)) {
      const ex = Number(s.split("e")[1]);
      if (ex < 21 && ex > -7) p.push(`exponential notation for exponent ${ex}: ${s}`);
      if (ex >= 1000) p.push(`|result| >= 1e1000 not reported as OVERFLOW: ${s}`);
    }
  } else if (o.ok === false) {
    const e = o.error as Record<string, unknown> | undefined;
    if (!e || typeof e !== "object") return ["error missing"];
    if (!CODES.includes(e.code as CalcErrorCode)) p.push(`unknown error code ${String(e.code)}`);
    if (typeof e.message !== "string" || e.message.trim() === "") p.push("error message empty");
  } else p.push("ok is not boolean");
  return p;
}

export function ev(expr: string, angle?: "deg" | "rad"): EvaluateResult {
  return angle ? evaluate(expr, { angle }) : evaluate(expr);
}
export function show(r: EvaluateResult): string {
  return r.ok ? r.result : `ERR:${r.error.code}`;
}
