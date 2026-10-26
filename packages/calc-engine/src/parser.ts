import { fail, MESSAGES } from "./errors.ts";
import type { ConstantName, FunctionName, PostfixOp, Token } from "./tokenizer.ts";

/** One step of the reverse-Polish program that the evaluator runs on a value stack. */
export type Instruction =
  | { type: "number"; value: string }
  | { type: "const"; name: ConstantName }
  | { type: "binary"; op: "+" | "-" | "*" | "/" | "^" }
  | { type: "negate" }
  | { type: "postfix"; op: PostfixOp }
  | { type: "call"; name: FunctionName };

export type Program = Instruction[];

/** Maximum nesting of brackets and function calls. Parsing is iterative, so this is a sanity limit, not a stack guard. */
export const MAX_DEPTH = 1000;

type StackOp =
  | { type: "binary"; op: "+" | "-" | "*" | "/" | "^" }
  | { type: "negate" }
  | { type: "lparen" }
  | { type: "func"; name: FunctionName };

/** Binding power, loosest to tightest: + - < × ÷ < unary minus < ^ (postfix % ! is applied immediately). */
const PRECEDENCE = { "+": 1, "-": 1, "*": 2, "/": 2, negate: 3, "^": 4 } as const;

const precedenceOf = (op: StackOp): number =>
  op.type === "binary" ? PRECEDENCE[op.op] : op.type === "negate" ? PRECEDENCE.negate : -1;

/**
 * Iterative shunting-yard parser (no recursion, so deep nesting and long
 * chains can't overflow the call stack). Produces a reverse-Polish program.
 *
 * Rules:
 * - `^` is right-associative; its exponent may carry a sign (`2 ^ -1`).
 * - Unary minus binds looser than `^` (`-2 ^ 2 = -4`), tighter than × ÷.
 * - Postfix `%` and `!` bind tightest.
 * - Implicit multiplication only between a number and "(", a constant or a
 *   function, and between ")" and "(".
 * - Functions must be followed by "(".
 */
export function parse(tokens: Token[]): Program {
  const out: Program = [];
  const ops: StackOp[] = [];
  let depth = 0;
  let expectOperand = true;

  const pushBinary = (op: "+" | "-" | "*" | "/" | "^") => {
    const p = PRECEDENCE[op];
    const rightAssoc = op === "^";
    for (;;) {
      const top = ops[ops.length - 1];
      if (!top || top.type === "lparen" || top.type === "func") break;
      const tp = precedenceOf(top);
      if (tp > p || (tp === p && !rightAssoc)) {
        ops.pop();
        out.push(top.type === "negate" ? { type: "negate" } : { type: "binary", op: top.op });
      } else break;
    }
    ops.push({ type: "binary", op });
  };

  /** Pops operators down to the nearest "(" (exclusive). Returns false if there is none. */
  const popToParen = (): boolean => {
    for (;;) {
      const top = ops.pop();
      if (!top) return false;
      if (top.type === "lparen") return true;
      if (top.type === "func") return false; // unreachable: a func is always directly below its "("
      out.push(top.type === "negate" ? { type: "negate" } : { type: "binary", op: top.op });
    }
  };

  const openParen = () => {
    if (++depth > MAX_DEPTH) fail("SYNTAX", MESSAGES.tooDeep);
    ops.push({ type: "lparen" });
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;

    if (expectOperand) {
      switch (t.type) {
        case "op": {
          if (t.value !== "+" && t.value !== "-") return fail("SYNTAX", MESSAGES.syntax);
          // Collapse a run of signs into at most one negation.
          let negative = false;
          let j = i;
          for (; j < tokens.length; j++) {
            const s = tokens[j]!;
            if (s.type === "op" && (s.value === "+" || s.value === "-")) {
              if (s.value === "-") negative = !negative;
            } else break;
          }
          i = j - 1;
          if (negative) ops.push({ type: "negate" });
          break;
        }
        case "number":
          out.push({ type: "number", value: t.value });
          expectOperand = false;
          break;
        case "const":
          out.push({ type: "const", name: t.name });
          expectOperand = false;
          break;
        case "func": {
          const next = tokens[i + 1];
          if (next?.type !== "lparen") {
            return fail("SYNTAX", next ? `Use brackets after ${t.name}, like ${t.name}(2)` : MESSAGES.incomplete);
          }
          ops.push({ type: "func", name: t.name });
          openParen();
          i++; // consume "("
          break;
        }
        case "lparen":
          openParen();
          break;
        case "rparen":
          return fail("SYNTAX", MESSAGES.brackets);
        case "postfix":
          return fail("SYNTAX", MESSAGES.syntax);
      }
      continue;
    }

    // Expecting an operator.
    switch (t.type) {
      case "op":
        pushBinary(t.value);
        expectOperand = true;
        break;
      case "postfix":
        // Tightest binding: applies straight to the operand just completed.
        out.push({ type: "postfix", op: t.value });
        break;
      case "rparen": {
        if (!popToParen()) return fail("SYNTAX", MESSAGES.brackets);
        depth--;
        const top = ops[ops.length - 1];
        if (top?.type === "func") {
          ops.pop();
          out.push({ type: "call", name: top.name });
        }
        break;
      }
      case "lparen":
      case "const":
      case "func": {
        const prev = tokens[i - 1]!;
        const implicit = prev.type === "number" || (prev.type === "rparen" && t.type === "lparen");
        if (!implicit) return fail("SYNTAX", MESSAGES.syntax);
        pushBinary("*");
        expectOperand = true;
        i--; // re-read this token as an operand
        break;
      }
      case "number":
        return fail("SYNTAX", MESSAGES.syntax);
    }
  }

  if (expectOperand) {
    // Running out after "(" with nothing inside is still a bracket problem.
    return fail("SYNTAX", tokens[tokens.length - 1]?.type === "lparen" ? MESSAGES.brackets : MESSAGES.incomplete);
  }
  for (let k = ops.length - 1; k >= 0; k--) {
    const top = ops[k]!;
    if (top.type === "lparen" || top.type === "func") return fail("SYNTAX", MESSAGES.brackets);
    out.push(top.type === "negate" ? { type: "negate" } : { type: "binary", op: top.op });
  }
  return out;
}
