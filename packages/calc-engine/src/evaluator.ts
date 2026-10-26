import { D, E, PI, PI_T, PRECISION, T, type Dec } from "./decimal.ts";
import { fail, MESSAGES } from "./errors.ts";
import type { Node } from "./parser.ts";
import type { AngleUnit } from "../../../contract/types.ts";

/** Trig results smaller than this in magnitude snap to exactly 0. */
const TRIG_SNAP = new D("1e-25");
/**
 * Intermediate values at or above this are rejected straight away. The final
 * OVERFLOW limit (1e1000) is checked on the result only, so e.g. 1000! / 999!
 * still works, but nothing can grow without bound (which would make later
 * steps such as an exact `mod 360` arbitrarily slow).
 */
const INTERMEDIATE_LIMIT = new D("1e10000");
/** decimal.js can only reduce radian arguments this large (its pi is ~1025 digits). */
const RADIAN_LIMIT = new D("1e900");
const MAX_FACTORIAL = 1000;

function checked(x: Dec): Dec {
  if (x.isNaN()) return fail("DOMAIN", MESSAGES.notReal);
  if (!x.isFinite() || x.abs().gte(INTERMEDIATE_LIMIT)) return fail("OVERFLOW", MESSAGES.overflow);
  return x;
}

const snap = (x: Dec): Dec => (x.abs().lt(TRIG_SNAP) ? new D(0) : x);
const fromTrig = (x: InstanceType<typeof T>): Dec => new D(x).toSignificantDigits(PRECISION);

function toRadians(x: Dec, angle: AngleUnit): InstanceType<typeof T> {
  if (angle === "deg") {
    // Exact reduction first, so huge degree inputs stay cheap and exact.
    const reduced = x.mod(360);
    return new T(reduced).times(PI_T).div(180);
  }
  if (x.abs().gte(RADIAN_LIMIT)) return fail("DOMAIN", MESSAGES.angleTooLarge);
  return new T(x);
}

function trig(name: "sin" | "cos" | "tan", x: Dec, angle: AngleUnit): Dec {
  if (name === "tan" && angle === "deg" && x.mod(180).abs().eq(90)) {
    return fail("DOMAIN", MESSAGES.tanUndefined);
  }
  const r = toRadians(x, angle);
  if (name === "sin") return snap(fromTrig(r.sin()));
  const c = r.cos();
  if (name === "cos") return snap(fromTrig(c));
  // tan: undefined wherever cos snaps to zero (odd multiples of 90° or π/2).
  if (c.abs().lt(TRIG_SNAP)) return fail("DOMAIN", MESSAGES.tanUndefined);
  return snap(fromTrig(r.sin().div(c)));
}

function factorial(x: Dec): Dec {
  if (!x.isInteger() || x.isNegative()) return fail("DOMAIN", MESSAGES.factorialDomain);
  if (x.gt(MAX_FACTORIAL)) return fail("OVERFLOW", MESSAGES.factorialOverflow);
  const n = x.toNumber();
  let acc = new D(1);
  for (let i = 2; i <= n; i++) acc = acc.times(i);
  return acc;
}

function power(base: Dec, exponent: Dec): Dec {
  if (base.isZero() && exponent.isNegative()) return fail("DIVIDE_BY_ZERO", MESSAGES.divideByZero);
  if (base.isNegative() && !exponent.isInteger()) return fail("DOMAIN", MESSAGES.notReal);
  return base.pow(exponent);
}

/** Evaluates a parsed expression tree with decimal.js at 34 significant digits. */
export function evaluateNode(node: Node, angle: AngleUnit): Dec {
  switch (node.type) {
    case "number":
      return checked(new D(node.value));
    case "const":
      return node.name === "pi" ? PI : E;
    case "negate":
      return evaluateNode(node.arg, angle).negated();
    case "postfix": {
      const v = evaluateNode(node.arg, angle);
      return checked(node.op === "%" ? v.div(100) : factorial(v));
    }
    case "power":
      return checked(power(evaluateNode(node.base, angle), evaluateNode(node.exponent, angle)));
    case "chain": {
      let acc = evaluateNode(node.first, angle);
      for (const { op, operand } of node.rest) {
        const v = evaluateNode(operand, angle);
        switch (op) {
          case "+":
            acc = acc.plus(v);
            break;
          case "-":
            acc = acc.minus(v);
            break;
          case "*":
            acc = acc.times(v);
            break;
          case "/":
            if (v.isZero()) return fail("DIVIDE_BY_ZERO", MESSAGES.divideByZero);
            acc = acc.div(v);
            break;
        }
        acc = checked(acc);
      }
      return acc;
    }
    case "call": {
      const v = evaluateNode(node.arg, angle);
      switch (node.name) {
        case "sqrt":
          if (v.isNegative() && !v.isZero()) return fail("DOMAIN", MESSAGES.sqrtNegative);
          return v.abs().sqrt();
        case "ln":
          if (v.lte(0)) return fail("DOMAIN", MESSAGES.logNonPositive);
          return checked(v.ln());
        case "log":
          if (v.lte(0)) return fail("DOMAIN", MESSAGES.logNonPositive);
          return checked(v.log(10));
        case "sin":
        case "cos":
        case "tan":
          return checked(trig(node.name, v, angle));
      }
    }
  }
}
