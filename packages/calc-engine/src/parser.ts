import { fail, MESSAGES } from "./errors.ts";
import type { ConstantName, FunctionName, PostfixOp, Token } from "./tokenizer.ts";

export type Node =
  | { type: "number"; value: string }
  | { type: "const"; name: ConstantName }
  | { type: "call"; name: FunctionName; arg: Node }
  | { type: "negate"; arg: Node }
  | { type: "postfix"; op: PostfixOp; arg: Node }
  | { type: "power"; base: Node; exponent: Node }
  /** Left-associative chain, flattened so long inputs don't recurse deeply. */
  | { type: "chain"; first: Node; rest: { op: "+" | "-" | "*" | "/"; operand: Node }[] };

/** Maximum nesting of brackets, function calls and exponents. */
export const MAX_DEPTH = 256;

/**
 * Recursive-descent parser. Grammar, loosest to tightest:
 *
 *   expr    := term (("+" | "-") term)*
 *   term    := unary (("*" | "/") unary | <implicit ×> unary)*
 *   unary   := ("-" | "+")* power
 *   power   := postfix ("^" unary)?          (right-associative, exponent may be signed)
 *   postfix := primary ("%" | "!")*
 *   primary := number | const | func "(" expr ")" | "(" expr ")"
 *
 * Implicit multiplication applies only between a number and "(", a constant
 * or a function, and between ")" and "(".
 */
export function parse(tokens: Token[]): Node {
  let pos = 0;
  let depth = 0;

  const peek = (): Token | undefined => tokens[pos];

  const enter = () => {
    if (++depth > MAX_DEPTH) fail("SYNTAX", MESSAGES.tooDeep);
  };

  const unexpected = (t: Token | undefined): never => {
    if (!t) return fail("SYNTAX", MESSAGES.incomplete);
    if (t.type === "rparen") return fail("SYNTAX", MESSAGES.brackets);
    return fail("SYNTAX", MESSAGES.syntax);
  };

  function parseExpr(): Node {
    const first = parseTerm();
    const rest: { op: "+" | "-"; operand: Node }[] = [];
    for (;;) {
      const t = peek();
      if (t?.type === "op" && (t.value === "+" || t.value === "-")) {
        pos++;
        rest.push({ op: t.value, operand: parseTerm() });
      } else break;
    }
    return rest.length ? { type: "chain", first, rest } : first;
  }

  function implicitFollows(): boolean {
    const prev = tokens[pos - 1];
    const next = peek();
    if (!prev || !next) return false;
    if (prev.type === "number") {
      return next.type === "lparen" || next.type === "const" || next.type === "func";
    }
    return prev.type === "rparen" && next.type === "lparen";
  }

  function parseTerm(): Node {
    const first = parseUnary();
    const rest: { op: "*" | "/"; operand: Node }[] = [];
    for (;;) {
      const t = peek();
      if (t?.type === "op" && (t.value === "*" || t.value === "/")) {
        pos++;
        rest.push({ op: t.value, operand: parseUnary() });
      } else if (implicitFollows()) {
        rest.push({ op: "*", operand: parseUnary() });
      } else break;
    }
    return rest.length ? { type: "chain", first, rest } : first;
  }

  function parseUnary(): Node {
    let negative = false;
    for (;;) {
      const t = peek();
      if (t?.type === "op" && (t.value === "-" || t.value === "+")) {
        if (t.value === "-") negative = !negative;
        pos++;
      } else break;
    }
    const inner = parsePower();
    return negative ? { type: "negate", arg: inner } : inner;
  }

  function parsePower(): Node {
    const base = parsePostfix();
    const t = peek();
    if (t?.type === "op" && t.value === "^") {
      pos++;
      enter();
      const exponent = parseUnary();
      depth--;
      return { type: "power", base, exponent };
    }
    return base;
  }

  function parsePostfix(): Node {
    let node = parsePrimary();
    for (;;) {
      const t = peek();
      if (t?.type === "postfix") {
        pos++;
        node = { type: "postfix", op: t.value, arg: node };
      } else break;
    }
    return node;
  }

  function parseParenthesised(): Node {
    const open = peek();
    if (open?.type !== "lparen") return unexpected(open);
    pos++;
    enter();
    const inner = parseExpr();
    depth--;
    const close = peek();
    if (close?.type !== "rparen") {
      // Missing ")" (including running off the end) is a bracket problem.
      if (!close) fail("SYNTAX", MESSAGES.brackets);
      return unexpected(close);
    }
    pos++;
    return inner;
  }

  function parsePrimary(): Node {
    const t = peek();
    if (!t) return unexpected(t);
    switch (t.type) {
      case "number":
        pos++;
        return { type: "number", value: t.value };
      case "const":
        pos++;
        return { type: "const", name: t.name };
      case "func": {
        pos++;
        const next = peek();
        if (next?.type !== "lparen") {
          return fail("SYNTAX", next ? `Use brackets after ${t.name}, like ${t.name}(2)` : MESSAGES.incomplete);
        }
        return { type: "call", name: t.name, arg: parseParenthesised() };
      }
      case "lparen":
        return parseParenthesised();
      default:
        return unexpected(t);
    }
  }

  const tree = parseExpr();
  if (pos < tokens.length) unexpected(tokens[pos]);
  return tree;
}
