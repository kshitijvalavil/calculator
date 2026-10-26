import { D, E, PI, PI_T, PRECISION, T, type Dec } from "./decimal.ts";
import { fail, MESSAGES } from "./errors.ts";
import type { Program } from "./parser.ts";
import type { FunctionName } from "./tokenizer.ts";
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
  if (!x.isInteger() || (x.isNegative() && !x.isZero())) return fail("DOMAIN", MESSAGES.factorialDomain);
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

function applyBinary(op: "+" | "-" | "*" | "/" | "^", a: Dec, b: Dec): Dec {
  switch (op) {
    case "+":
      return a.plus(b);
    case "-":
      return a.minus(b);
    case "*":
      return a.times(b);
    case "/":
      if (b.isZero()) return fail("DIVIDE_BY_ZERO", MESSAGES.divideByZero);
      return a.div(b);
    case "^":
      return power(a, b);
  }
}

function applyCall(name: FunctionName, v: Dec, angle: AngleUnit): Dec {
  switch (name) {
    case "sqrt":
      if (v.isNegative() && !v.isZero()) return fail("DOMAIN", MESSAGES.sqrtNegative);
      return v.abs().sqrt();
    case "ln":
      if (v.lte(0)) return fail("DOMAIN", MESSAGES.logNonPositive);
      return v.ln();
    case "log":
      if (v.lte(0)) return fail("DOMAIN", MESSAGES.logNonPositive);
      return v.log(10);
    case "sin":
    case "cos":
    case "tan":
      return trig(name, v, angle);
  }
}

/**
 * Runs a reverse-Polish program on a value stack (iterative, so input depth
 * never touches the call stack), with decimal.js at 34 significant digits.
 */
export function run(program: Program, angle: AngleUnit): Dec {
  const stack: Dec[] = [];
  const pop = (): Dec => {
    const v = stack.pop();
    // Unreachable for programs produced by `parse`.
    return v ?? fail("SYNTAX", MESSAGES.syntax);
  };
  for (const ins of program) {
    switch (ins.type) {
      case "number":
        stack.push(checked(new D(ins.value)));
        break;
      case "const":
        stack.push(ins.name === "pi" ? PI : E);
        break;
      case "negate":
        stack.push(pop().negated());
        break;
      case "postfix": {
        const v = pop();
        stack.push(checked(ins.op === "%" ? v.div(100) : factorial(v)));
        break;
      }
      case "binary": {
        const b = pop();
        const a = pop();
        stack.push(checked(applyBinary(ins.op, a, b)));
        break;
      }
      case "call":
        stack.push(checked(applyCall(ins.name, pop(), angle)));
        break;
    }
  }
  if (stack.length !== 1) return fail("SYNTAX", MESSAGES.syntax);
  return stack[0]!;
}
