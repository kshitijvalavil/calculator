import { fail, MESSAGES } from "./errors.ts";

export const FUNCTIONS = ["sqrt", "sin", "cos", "tan", "ln", "log"] as const;
export const CONSTANTS = ["pi", "e"] as const;
export type FunctionName = (typeof FUNCTIONS)[number];
export type ConstantName = (typeof CONSTANTS)[number];
export type BinaryOp = "+" | "-" | "*" | "/" | "^";
export type PostfixOp = "%" | "!";

export type Token =
  | { type: "number"; value: string; pos: number }
  | { type: "op"; value: BinaryOp; pos: number }
  | { type: "postfix"; value: PostfixOp; pos: number }
  | { type: "lparen"; pos: number }
  | { type: "rparen"; pos: number }
  | { type: "func"; name: FunctionName; pos: number }
  | { type: "const"; name: ConstantName; pos: number };

/** Unicode and ASCII spellings of each operator. */
const OPERATORS: Record<string, BinaryOp> = {
  "+": "+",
  "-": "-",
  "−": "-", // − minus sign
  "*": "*",
  "×": "*", // ×
  "/": "/",
  "÷": "/", // ÷
  "^": "^",
};

const isDigit = (c: string) => c >= "0" && c <= "9";
const isLetter = (c: string) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
const isSpace = (c: string) => /\s/u.test(c);

/**
 * Hand-written tokenizer. Numbers are plain decimals (`12`, `1.5`, `.5`, `5.`);
 * scientific notation is deliberately not supported because `e` is a constant.
 */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i]!;
    if (isSpace(c)) {
      i++;
      continue;
    }
    if (isDigit(c) || c === ".") {
      const start = i;
      let seenDot = false;
      let digits = 0;
      while (i < input.length && (isDigit(input[i]!) || input[i] === ".")) {
        if (input[i] === ".") {
          if (seenDot) fail("SYNTAX", MESSAGES.syntax);
          seenDot = true;
        } else digits++;
        i++;
      }
      if (digits === 0) fail("SYNTAX", MESSAGES.syntax);
      let text = input.slice(start, i);
      if (text.startsWith(".")) text = "0" + text;
      if (text.endsWith(".")) text = text.slice(0, -1);
      tokens.push({ type: "number", value: text, pos: start });
      continue;
    }
    if (isLetter(c)) {
      const start = i;
      while (i < input.length && isLetter(input[i]!)) i++;
      const word = input.slice(start, i);
      if ((FUNCTIONS as readonly string[]).includes(word)) {
        tokens.push({ type: "func", name: word as FunctionName, pos: start });
      } else if ((CONSTANTS as readonly string[]).includes(word)) {
        tokens.push({ type: "const", name: word as ConstantName, pos: start });
      } else {
        fail("SYNTAX", `Unknown name "${word.length > 12 ? word.slice(0, 12) + "…" : word}"`);
      }
      continue;
    }
    if (c === "π") {
      tokens.push({ type: "const", name: "pi", pos: i });
      i++;
      continue;
    }
    const op = OPERATORS[c];
    if (op) {
      tokens.push({ type: "op", value: op, pos: i });
      i++;
      continue;
    }
    if (c === "%" || c === "!") {
      tokens.push({ type: "postfix", value: c, pos: i });
      i++;
      continue;
    }
    if (c === "(") {
      tokens.push({ type: "lparen", pos: i });
      i++;
      continue;
    }
    if (c === ")") {
      tokens.push({ type: "rparen", pos: i });
      i++;
      continue;
    }
    const symbol = String.fromCodePoint(input.codePointAt(i)!);
    fail("SYNTAX", `Unknown symbol "${symbol}"`);
  }
  return tokens;
}
