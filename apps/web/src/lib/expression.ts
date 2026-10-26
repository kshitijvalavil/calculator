// Token model for the expression being typed.
// Tokens are stored in the engine's own syntax (×, ÷, −, π, sqrt(), so the
// joined string can be passed straight to `evaluate` and saved to history.

export type FuncToken = "sin(" | "cos(" | "tan(" | "ln(" | "log(" | "sqrt(";
export type BinaryOp = "+" | "−" | "×" | "÷" | "^";
export type Token =
  | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "."
  | BinaryOp
  | "%" | "!"
  | "(" | ")"
  | "π" | "e"
  | FuncToken;

export const FUNCS: readonly FuncToken[] = ["sin(", "cos(", "tan(", "ln(", "log(", "sqrt("];
const BINARY: readonly string[] = ["+", "−", "×", "÷", "^"];

export const isDigit = (t: Token | undefined): boolean => !!t && /^[0-9.]$/.test(t);
export const isBinary = (t: Token | undefined): t is BinaryOp => !!t && BINARY.includes(t);
export const isFunc = (t: Token | undefined): t is FuncToken => !!t && (FUNCS as readonly string[]).includes(t);
export const isConst = (t: Token | undefined): boolean => t === "π" || t === "e";
export const isPostfix = (t: Token | undefined): boolean => t === "%" || t === "!";
export const opensGroup = (t: Token | undefined): boolean => t === "(" || isFunc(t);

/** True when a value has just ended, so an operator or postfix can follow. */
export const endsValue = (t: Token | undefined): boolean =>
  isDigit(t) || isConst(t) || isPostfix(t) || t === ")";

/** True when a "−" at position i is a unary minus (sign), not subtraction. */
export function isUnaryAt(tokens: readonly Token[], i: number): boolean {
  if (tokens[i] !== "−" && tokens[i] !== "+") return false;
  const prev = tokens[i - 1];
  return prev === undefined || isBinary(prev) || opensGroup(prev);
}

export function openCount(tokens: readonly Token[]): number {
  let n = 0;
  for (const t of tokens) {
    if (opensGroup(t)) n++;
    else if (t === ")") n = Math.max(0, n - 1);
  }
  return n;
}

export function autoClose(tokens: readonly Token[]): Token[] {
  return [...tokens, ...Array<Token>(openCount(tokens)).fill(")")];
}

/** Drops trailing binary operators and empty groups, for the live preview. */
export function trimIncomplete(tokens: readonly Token[]): Token[] {
  const out = [...tokens];
  while (out.length && (isBinary(out[out.length - 1]) || opensGroup(out[out.length - 1]))) out.pop();
  return out;
}

/** Joins tokens into a readable, engine-compatible expression string. */
export function toExpression(tokens: readonly Token[]): string {
  let s = "";
  tokens.forEach((t, i) => {
    if (isBinary(t) && !isUnaryAt(tokens, i)) s += ` ${t} `;
    else s += t;
  });
  return s.trim();
}

export interface Segment {
  text: string;
  kind: "number" | "op" | "func" | "paren" | "const" | "postfix";
}

const FUNC_LABEL: Record<FuncToken, string> = {
  "sin(": "sin(", "cos(": "cos(", "tan(": "tan(", "ln(": "ln(", "log(": "log(", "sqrt(": "√(",
};

/** Groups tokens into display segments (number runs merged) for highlighting. */
export function toSegments(tokens: readonly Token[]): Segment[] {
  const segs: Segment[] = [];
  tokens.forEach((t, i) => {
    const last = segs[segs.length - 1];
    if (isDigit(t)) {
      if (last?.kind === "number" && isDigit(tokens[i - 1])) last.text += t;
      else segs.push({ text: t, kind: "number" });
    } else if (isBinary(t)) {
      segs.push({ text: isUnaryAt(tokens, i) ? t : ` ${t} `, kind: "op" });
    } else if (isFunc(t)) segs.push({ text: FUNC_LABEL[t], kind: "func" });
    else if (t === "(" || t === ")") segs.push({ text: t, kind: "paren" });
    else if (isConst(t)) segs.push({ text: t, kind: "const" });
    else segs.push({ text: t, kind: "postfix" });
  });
  return segs;
}

/** Index of the first token of the trailing number run, or -1. */
function lastNumberStart(tokens: readonly Token[]): number {
  let i = tokens.length - 1;
  if (!isDigit(tokens[i])) return -1;
  while (i > 0 && isDigit(tokens[i - 1])) i--;
  return i;
}

/** Applies one key press to the token list using calculator-friendly rules. */
export function applyKey(tokens: readonly Token[], key: Token): Token[] {
  const out = [...tokens];
  const last = out[out.length - 1];
  const needsTimes = endsValue(last) && !isDigit(last);

  if (isDigit(key)) {
    if (key === ".") {
      const start = lastNumberStart(out);
      if (start >= 0) {
        if (out.slice(start).includes(".")) return out;
        return [...out, "."];
      }
      if (needsTimes) out.push("×");
      return [...out, "0", "."];
    }
    if (needsTimes) out.push("×");
    // Replace a lone leading zero ("0" → "5"), but keep "0." and "10".
    const start = lastNumberStart(out);
    if (start >= 0 && out.length - start === 1 && out[start] === "0") {
      out[start] = key;
      return out;
    }
    return [...out, key];
  }

  if (isBinary(key)) {
    if (key === "−") {
      if (last === "−") return out;
      if (last === "+") { out[out.length - 1] = "−"; return out; }
      return [...out, "−"];
    }
    if (out.length === 0 || opensGroup(last)) return out;
    // Replace any trailing operator chain ("2 × −" then "+" → "2 +").
    while (isBinary(out[out.length - 1])) out.pop();
    if (out.length === 0 || opensGroup(out[out.length - 1])) return out;
    return [...out, key];
  }

  if (isPostfix(key)) return endsValue(last) ? [...out, key] : out;

  if (key === ")") return openCount(out) > 0 && endsValue(last) ? [...out, ")"] : out;

  // "(", functions and constants: an explicit × after a finished value.
  if (endsValue(last)) out.push("×");
  return [...out, key];
}

export function backspace(tokens: readonly Token[]): Token[] {
  return tokens.slice(0, -1);
}

/** ± : toggles a unary minus in front of the trailing number or constant. */
export function toggleSign(tokens: readonly Token[]): Token[] {
  const out = [...tokens];
  let start = lastNumberStart(out);
  if (start < 0 && isConst(out[out.length - 1])) start = out.length - 1;
  if (start < 0) {
    if (out.length === 0 || isBinary(out[out.length - 1]) || opensGroup(out[out.length - 1])) {
      return applyKey(out, "−");
    }
    return out;
  }
  if (out[start - 1] === "−" && isUnaryAt(out, start - 1)) {
    out.splice(start - 1, 1);
    return out;
  }
  out.splice(start, 0, "−");
  return out;
}

/** Converts decimal.js exponent notation to plain digits so a result can be typed on. */
export function expandExponent(value: string): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/i.exec(value.trim());
  if (!m) return value;
  const [, sign, int, frac = "", expStr] = m;
  const exp = Number(expStr);
  const digits = int + frac;
  const point = int.length + exp;
  let plain: string;
  if (point <= 0) plain = "0." + "0".repeat(-point) + digits;
  else if (point >= digits.length) plain = digits + "0".repeat(point - digits.length);
  else plain = digits.slice(0, point) + "." + digits.slice(point);
  plain = plain.replace(/^0+(?=\d)/, "");
  if (plain.includes(".")) plain = plain.replace(/\.?0+$/, "");
  return sign + plain;
}

/** Parses a saved expression (or result) back into tokens. Returns null if it can't. */
export function tokenize(input: string): Token[] | null {
  const out: Token[] = [];
  let s = input.replace(/\s+/g, "");
  while (s.length) {
    const fn = /^(sqrt|sin|cos|tan|ln|log)\(/.exec(s);
    if (fn) { out.push(`${fn[1]}(` as FuncToken); s = s.slice(fn[0].length); continue; }
    if (s.startsWith("√(")) { out.push("sqrt("); s = s.slice(2); continue; }
    if (s.startsWith("pi")) { out.push("π"); s = s.slice(2); continue; }
    const c = s[0];
    s = s.slice(1);
    if (/[0-9.]/.test(c)) out.push(c as Token);
    else if (c === "+" || c === "^" || c === "%" || c === "!" || c === "(" || c === ")" || c === "π" || c === "e") out.push(c);
    else if (c === "-" || c === "−") out.push("−");
    else if (c === "*" || c === "×") out.push("×");
    else if (c === "/" || c === "÷") out.push("÷");
    else return null;
  }
  return out;
}

const PASTE_PART = /[a-zπ√]+|[0-9.,]|[+\-−*×÷/^%!()]/g;
const PASTE_WORDS: Record<string, string> = {
  sqrt: "sqrt(", "√": "sqrt(", sin: "sin(", cos: "cos(", tan: "tan(", ln: "ln(", log: "log(",
  pi: "π", "π": "π", e: "e",
};

/**
 * Turns pasted plain text into tokens: markup is stripped, only calculator symbols,
 * function names and constants survive (other words are dropped whole), capped at 500 chars.
 */
export function sanitizePaste(text: string): Token[] {
  const plain = text
    .slice(0, 5000)
    .replace(/<(script|style)\b[^]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .toLowerCase();
  const kept = (plain.match(PASTE_PART) ?? [])
    .map((t) => (t === "," ? "." : /^[a-zπ√]/.test(t) ? (PASTE_WORDS[t] ?? "") : t))
    .join("")
    // a function name already followed by "(" shouldn't open two groups
    .replace(/(sqrt|sin|cos|tan|ln|log)\(\(/g, "$1(")
    .slice(0, 500);
  return tokenize(kept) ?? [];
}
