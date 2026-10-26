import { describe, expect, it } from "vitest";
import {
  applyKey,
  autoClose,
  expandExponent,
  toExpression,
  toSegments,
  toggleSign,
  tokenize,
  trimIncomplete,
  type Token,
} from "./expression";

const type = (keys: Token[], start: Token[] = []) => keys.reduce(applyKey, start);
const expr = (keys: Token[]) => toExpression(type(keys));

describe("applyKey", () => {
  it("builds a spaced, engine-ready expression", () => {
    expect(expr(["1", "2", "+", "3", "×", "4"])).toBe("12 + 3 × 4");
  });

  it("replaces a lone leading zero but keeps decimals", () => {
    expect(expr(["0", "5"])).toBe("5");
    expect(expr(["0", ".", "5"])).toBe("0.5");
    expect(expr(["1", "0"])).toBe("10");
  });

  it("allows only one decimal point per number and prefixes a bare point with 0", () => {
    expect(expr([".", "5", ".", "2"])).toBe("0.52");
    expect(expr(["1", "+", "."])).toBe("1 + 0.");
  });

  it("replaces a trailing operator instead of stacking them", () => {
    expect(expr(["2", "+", "×", "3"])).toBe("2 × 3");
    expect(expr(["2", "×", "−", "+"])).toBe("2 +");
  });

  it("supports unary minus at the start, after operators and after (", () => {
    expect(expr(["−", "5", "+", "3"])).toBe("−5 + 3");
    expect(expr(["2", "×", "−", "3"])).toBe("2 × −3");
    expect(expr(["(", "−", "2", ")"])).toBe("(−2)");
    expect(expr(["−", "−"])).toBe("−");
  });

  it("ignores binary operators with nothing to the left", () => {
    expect(type(["×"])).toEqual([]);
    expect(expr(["(", "+"])).toBe("(");
  });

  it("only closes parentheses that are open, after a value", () => {
    expect(expr([")"])).toBe("");
    expect(expr(["(", ")"])).toBe("(");
    expect(expr(["(", "2", ")", ")"])).toBe("(2)");
  });

  it("inserts × before groups, functions and constants that follow a value", () => {
    expect(expr(["2", "("])).toBe("2 × (");
    expect(expr(["2", "π"])).toBe("2 × π");
    expect(expr(["π", "3"])).toBe("π × 3");
    expect(expr(["5", "!", "sqrt("])).toBe("5! × sqrt(");
  });

  it("accepts postfix % and ! only after a value", () => {
    expect(expr(["%"])).toBe("");
    expect(expr(["5", "0", "%"])).toBe("50%");
  });
});

describe("helpers", () => {
  it("auto-closes unmatched parentheses", () => {
    expect(toExpression(autoClose(type(["sqrt(", "(", "2"])))).toBe("sqrt((2))");
  });

  it("trims trailing operators and empty groups for the preview", () => {
    expect(toExpression(trimIncomplete(type(["2", "+", "3", "×"])))).toBe("2 + 3");
    expect(toExpression(trimIncomplete(type(["2", "×", "sin("])))).toBe("2");
  });

  it("toggles the sign of the trailing number", () => {
    const t = type(["5", "−", "3"]);
    expect(toExpression(toggleSign(t))).toBe("5 − −3");
    expect(toExpression(toggleSign(toggleSign(t)))).toBe("5 − 3");
    expect(toExpression(toggleSign([]))).toBe("−");
  });

  it("groups digits into one segment and shows sqrt as √", () => {
    const segs = toSegments(type(["1", "2", "+", "sqrt(", "9"]));
    expect(segs.map((s) => s.text)).toEqual(["12", " + ", "√(", "9"]);
  });

  it("expands exponent notation so results can be typed on", () => {
    expect(expandExponent("1e+24")).toBe("1" + "0".repeat(24));
    expect(expandExponent("1e-8")).toBe("0.00000001");
    expect(expandExponent("-1.5e+3")).toBe("-1500");
    expect(expandExponent("42")).toBe("42");
  });

  it("tokenizes saved expressions, including ASCII operators and √", () => {
    expect(tokenize("2 × (3 + 1)")).toEqual(["2", "×", "(", "3", "+", "1", ")"]);
    expect(tokenize("3 * 4 / 2 - 1")).toEqual(["3", "×", "4", "÷", "2", "−", "1"]);
    expect(tokenize("√(16) + pi")).toEqual(["sqrt(", "1", "6", ")", "+", "π"]);
    expect(tokenize("2 $ 3")).toBeNull();
  });
});
