import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { evaluate, MAX_DEPTH, parse, tokenize } from "../src/index.ts";
import type { AngleUnit, CalcErrorCode } from "../../../contract/types.ts";

const ok = (expr: string, angle?: AngleUnit) => {
  const r = evaluate(expr, angle ? { angle } : undefined);
  if (!r.ok) throw new Error(`${expr} -> ${r.error.code}: ${r.error.message}`);
  return r.result;
};
const err = (expr: string, angle?: AngleUnit): CalcErrorCode => {
  const r = evaluate(expr, angle ? { angle } : undefined);
  if (r.ok) throw new Error(`${expr} -> unexpectedly ok: ${r.result}`);
  return r.error.code;
};

describe("precedence and associativity", () => {
  it.each([
    ["1 + 2 × 3 - 4", "3"],
    ["10 - 4 - 3", "3"],
    ["100 ÷ 10 ÷ 5", "2"],
    ["2 × 3 ^ 2", "18"],
    ["(2 × 3) ^ 2", "36"],
    ["2 ^ 2 ^ 3", "256"],
    ["(2 ^ 2) ^ 3", "64"],
    ["-3 ^ 2", "-9"],
    ["(-3) ^ 2", "9"],
    ["2 ^ -1", "0.5"],
    ["2 ^ -1 ^ 2", "0.5"], // 2^(-(1^2))
    ["-2 × 3", "-6"],
    ["3!^2", "36"], // postfix binds tighter than ^
    ["2^3!", "64"],
    ["-3!", "-6"],
    ["50%^2", "0.25"],
    ["10 - 50%", "9.5"],
    ["5%%", "0.0005"],
    ["3!!", "720"],
    ["8 / 2 × 4", "16"],
    ["2 + 3 × 4 ^ 2 / 8 - 1", "7"],
  ])("%s = %s", (expr, expected) => {
    expect(ok(expr)).toBe(expected);
  });
});

describe("unary operators", () => {
  it.each([
    ["--5", "5"],
    ["---5", "-5"],
    ["+5", "5"],
    ["+-+-5", "5"],
    ["2 ++ 3", "5"],
    ["2 - -3", "5"],
    ["2 −−3", "5"],
    ["-(-(-(1)))", "-1"],
    ["-0 × 5", "0"],
    ["0 × -1", "0"],
    ["-0.0000", "0"],
    ["-" .repeat(1001) + "1", "-1"],
    ["-" .repeat(1000) + "1", "1"],
  ])("%s = %s", (expr, expected) => {
    expect(ok(expr)).toBe(expected);
  });
});

describe("implicit multiplication", () => {
  it.each([
    ["2(3)", "6"],
    ["2 (3 + 1)", "8"],
    ["(2)(3)", "6"],
    ["(1 + 1)(2 + 2)(3)", "24"],
    ["2pi", "6.2831853071795864769"],
    ["2 π", "6.2831853071795864769"],
    ["2e", "5.4365636569180904707"],
    ["2sqrt(9)", "6"],
    ["3sin(30)", "1.5"],
    ["2(3)^2", "18"],
    ["2^3(2)", "16"],
    ["-2(3)", "-6"],
    ["6 ÷ 2(3)", "9"], // same precedence as ×, left to right
  ])("%s = %s", (expr, expected) => {
    expect(ok(expr)).toBe(expected);
  });

  it.each(["2 3", "pi(2)", "(2)3", "(2)pi", "pi pi", "e e", "3!(2)", "sin(30)2", "1e3", "2e3"])(
    "%s is SYNTAX (no implicit × in this position)",
    (expr) => {
      expect(err(expr)).toBe("SYNTAX");
    },
  );
});

describe("whitespace and unicode", () => {
  it.each([
    ["  1+2  ", "3"],
    ["\t1\n+\r2", "3"],
    ["1 + 2", "3"],
    ["6 × 7", "42"],
    ["6 * 7", "42"],
    ["7 ÷ 2", "3.5"],
    ["7 / 2", "3.5"],
    ["7 − 2", "5"],
    ["π", "3.1415926535897932385"],
    [".5 + 5.", "5.5"],
    ["007", "7"],
    ["1.50", "1.5"],
  ])("%j = %s", (expr, expected) => {
    expect(ok(expr)).toBe(expected);
  });
});

describe("functions", () => {
  it.each([
    ["sqrt(sqrt(16))", "2"],
    ["sqrt(0)", "0"],
    ["sqrt(-0)", "0"],
    ["sin(cos(0) × 30)", "0.5"],
    ["log(sqrt(100))", "1"],
    ["ln(e^2)", "2"],
    ["ln(1)", "0"],
    ["log(0.001)", "-3"],
    ["sin(-30)", "-0.5"],
    ["sin(390)", "0.5"],
    ["cos(60)", "0.5"],
    ["cos(180)", "-1"],
    ["sin(180)", "0"],
    ["sin(360)", "0"],
    ["cos(270)", "0"],
        ["tan(-45)", "-1"],
    ["tan(135)", "-1"],
    ["tan(180)", "0"],
    ["sin(36000000000000000000000000000030)", "0.5"],
    ["sin(pi ÷ 2)", "1"],
    ["sin(pi ÷ 6)", "0.5"],
    ["cos(pi ÷ 2)", "0"],
    ["cos(pi)", "-1"],
    ["tan(pi ÷ 4)", "1"],
    ["sin(1)", "0.84147098480789650665"],
  ])("%s = %s", (expr, expected) => {
    const angle: AngleUnit | undefined = /pi|^sin\(1\)$/.test(expr) ? "rad" : undefined;
    expect(ok(expr, angle)).toBe(expected);
  });

  it("sin(1) differs by angle unit", () => {
    expect(ok("sin(1)")).toBe("0.017452406437283512819");
  });

  it("defaults to degrees and honours rad", () => {
    expect(ok("sin(90)")).toBe("1");
    expect(ok("sin(90)", "deg")).toBe("1");
    expect(ok("sin(90)", "rad")).toBe("0.89399666360055789052");
  });

  it.each([
    ["tan(90)", undefined],
    ["tan(270)", undefined],
    ["tan(-90)", undefined],
    ["tan(450)", undefined],
    ["tan(pi ÷ 2)", "rad"],
    ["tan(3pi ÷ 2)", "rad"],
    ["tan(-pi ÷ 2)", "rad"],
    ["sqrt(-0.0001)", undefined],
    ["ln(-1)", undefined],
    ["log(0)", undefined],
    ["log(-10)", undefined],
    ["(-8) ^ (1 ÷ 3)", undefined],
    ["(-1) ^ 0.5", undefined],
    ["(-1)!", undefined],
    ["0.5!", undefined],
    ["sin(10^950)", "rad"],
  ] as const)("%s is DOMAIN", (expr, angle) => {
    expect(err(expr, angle)).toBe("DOMAIN");
  });

  it("works with huge degree inputs via exact reduction", () => {
    // 10^999 mod 360 = 280
    expect(ok("sin(10^999)")).toBe("-0.98480775301220805937");
    expect(ok("sin(10^999 + 30)")).toBe(ok("sin(280)")); // +30 is lost at 34 digits
  });

  it("requires brackets after a function name", () => {
    expect(err("sqrt 4")).toBe("SYNTAX");
    expect(err("sin")).toBe("SYNTAX");
    expect(err("sin()")).toBe("SYNTAX");
  });
});

describe("nested functions and brackets", () => {
  it("handles deep but bounded nesting", () => {
    const n = 100;
    expect(ok("(".repeat(n) + "1+2" + ")".repeat(n))).toBe("3");
    expect(ok("sqrt(".repeat(5) + "4294967296" + ")".repeat(5))).toBe("2");
  });

  it("rejects nesting beyond MAX_DEPTH with an accurate SYNTAX message", () => {
    expect(MAX_DEPTH).toBeGreaterThanOrEqual(1000);
    const n = MAX_DEPTH + 1;
    for (const expr of ["(".repeat(n) + "1" + ")".repeat(n), "(".repeat(100000) + "1" + ")".repeat(100000), "sqrt(".repeat(n) + "1" + ")".repeat(n)]) {
      expect(evaluate(expr)).toEqual({ ok: false, error: { code: "SYNTAX", message: "Expression is too deeply nested" } });
    }
  });

  it.each(["(", ")", "()", "(2+3))", ")2(", "2+(3", "((2)", "2)"])("%s is SYNTAX", (expr) => {
    expect(err(expr)).toBe("SYNTAX");
  });
});

describe("syntax errors", () => {
  it.each(["2 +", "×2", "2 ×", "2 ^", "^2", "%", "!", "2 ** 3", "1..2", "1.2.3", ".", "2 $ 3", "foo(2)", "x", "2 // 2", "sin(30", "2 + * 3", "abc"])(
    "%j is SYNTAX",
    (expr) => {
      expect(err(expr)).toBe("SYNTAX");
    },
  );

  it("is case sensitive for names", () => {
    expect(err("PI")).toBe("SYNTAX");
    expect(err("Sin(30)")).toBe("SYNTAX");
  });

  it("gives friendly messages", () => {
    const r = evaluate("(2 + 3");
    expect(r).toEqual({ ok: false, error: { code: "SYNTAX", message: "Check the brackets" } });
    const d = evaluate("1 ÷ 0");
    expect(d).toEqual({ ok: false, error: { code: "DIVIDE_BY_ZERO", message: "Can't divide by zero" } });
    const u = evaluate("2 & 3");
    expect(u.ok === false && u.error.message).toBe('Unknown symbol "&"');
  });

  it("treats empty and whitespace-only input as EMPTY", () => {
    expect(err("")).toBe("EMPTY");
    expect(err(" \t\n ")).toBe("EMPTY");
  });
});

describe("division by zero", () => {
  it.each(["5 / 0", "0 / 0", "5 ÷ (2 - 2)", "1 ÷ 0%", "0 ^ -1", "1 ÷ sin(180)"])(
    "%s is DIVIDE_BY_ZERO",
    (expr) => {
      expect(err(expr)).toBe("DIVIDE_BY_ZERO");
    },
  );

  it("documents the 34-digit working precision: 1 - 1÷3×3 is 1e-34, not 0", () => {
    expect(ok("1 - 1 ÷ 3 × 3")).toBe("1e-34");
  });

  it("SYNTAX wins over a math error elsewhere", () => {
    expect(err("1 ÷ 0 +")).toBe("SYNTAX");
  });
});

describe("huge and tiny numbers", () => {
  it.each([
    ["10 ^ 20", "100000000000000000000"],
    ["10 ^ 21", "1e+21"],
    ["10 ^ -6", "0.000001"],
    ["10 ^ -7", "1e-7"],
    ["-10 ^ 21", "-1e+21"],
    ["123456789012345678901234567890", "1.234567890123456789e+29"],
    ["99999999999999999999.5", "100000000000000000000"],
    ["0.12345678901234567890123", "0.1234567890123456789"],
    ["0.123456789012345678905", "0.12345678901234567891"], // half-up
    ["-0.123456789012345678905", "-0.12345678901234567891"],
    ["10 ^ 999", "1e+999"],
    ["9.9999999999999999999 × 10 ^ 999", "9.9999999999999999999e+999"],
    ["10 ^ -999", "1e-999"],
    ["10 ^ -5000", "1e-5000"],
    ["1000! ÷ 999!", "1000"],
    ["0 × 10 ^ 999", "0"],
  ])("%s = %s", (expr, expected) => {
    expect(ok(expr)).toBe(expected);
  });

  it.each([
    "10 ^ 1000",
    "-(10 ^ 1000)",
    "9.99999999999999999999 × 10 ^ 999", // rounds up to 1e1000
    "10 ^ 999 × 10",
    "2 ^ 999999999999",
    "10 ^ 10 ^ 20",
    "1 ÷ 10 ^ -1000",
    "1000!",
    "1001!",
    "100000!",
    "170! ^ 10",
  ])("%s is OVERFLOW", (expr) => {
    expect(err(expr)).toBe("OVERFLOW");
  });
});

describe("factorial limits", () => {
  it.each([
    ["1!", "1"],
    ["10!", "3628800"],
    ["21!", "51090942171709440000"],
    ["22!", "1.12400072777760768e+21"],
    ["25!", "1.5511210043330985984e+25"],
    ["(2 + 1)!", "6"],
    ["4.0!", "24"],
    ["449!", "3.8519305180280725763e+997"],
  ])("%s = %s", (expr, expected) => {
    expect(ok(expr)).toBe(expected);
  });

  it("450! exceeds the 1e1000 output limit", () => {
    expect(err("450!")).toBe("OVERFLOW");
  });

  it("is DOMAIN for negatives and non-integers, OVERFLOW above 1000", () => {
    expect(err("(-3)!")).toBe("DOMAIN");
    expect(err("(1 ÷ 3)!")).toBe("DOMAIN");
    expect(err("1001!")).toBe("OVERFLOW");
  });
});

describe("long inputs", () => {
  it("evaluates a long left-associative chain without recursion problems", () => {
    expect(ok(Array(10000).fill("1").join("+"))).toBe("10000");
    expect(ok(Array(5000).fill("2").join("×") + " ÷ 2 ^ 4999")).toBe("2");
  });

  it("handles 500-character inputs", () => {
    const expr = ("1+" .repeat(249) + "1").slice(0, 500);
    expect(expr.length).toBeLessThanOrEqual(500);
    expect(ok(expr)).toBe("250");
  });

  it("handles very long literals", () => {
    expect(ok("1" + "0".repeat(400) + " ÷ 1" + "0".repeat(399))).toBe("10");
    expect(ok("0." + "3".repeat(300) + " × 3")).toBe("1");
  });
});

describe("decimal.js isolation", () => {
  it("does not change the global Decimal configuration", () => {
    const before = { precision: Decimal.precision, rounding: Decimal.rounding };
    ok("1 ÷ 3");
    err("sin(10^950)", "rad");
    expect({ precision: Decimal.precision, rounding: Decimal.rounding }).toEqual(before);
  });

  it("keeps working after an internal error path", () => {
    err("sin(10^950)", "rad");
    expect(ok("1 ÷ 3")).toBe("0.33333333333333333333");
    expect(ok("sqrt(2)")).toBe("1.4142135623730950488");
  });

  it("never throws, even for odd input", () => {
    for (const input of [undefined, null, 42, {}, "\u0000", "😀", "1".repeat(100000)] as unknown[]) {
      expect(() => evaluate(input as string)).not.toThrow();
    }
  });
});

describe("internals", () => {
  it("tokenizes unicode operators to their ASCII form", () => {
    expect(tokenize("2×3÷4−1").map((t) => (t.type === "op" ? t.value : t.type))).toEqual([
      "number", "*", "number", "/", "number", "-", "number",
    ]);
  });

  it("parses -2 ^ 2 as -(2 ^ 2) in reverse-Polish order", () => {
    expect(parse(tokenize("-2^2"))).toEqual([
      { type: "number", value: "2" },
      { type: "number", value: "2" },
      { type: "binary", op: "^" },
      { type: "negate" },
    ]);
  });

  it("parses 2 ^ -3 ^ 2 as 2 ^ (-(3 ^ 2))", () => {
    expect(ok("2 ^ -3 ^ 2")).toBe(ok("1 ÷ 2 ^ 9"));
    expect(ok("2^-3×4")).toBe("0.5");
  });
});

describe("regressions from QA (Sherlock Bugs)", () => {
  // E1: deep nesting must work up to at least 1000 levels without recursion.
  it.each([
    ["500 nested parens", "(".repeat(500) + "1" + ")".repeat(500), "1"],
    ["1000 nested parens", "(".repeat(1000) + "1" + ")".repeat(1000), "1"],
    ["500 nested parens with ops", "(".repeat(500) + "1" + "+1)".repeat(500), "501"],
    ["500 nested sqrt", "sqrt(".repeat(500) + "1" + ")".repeat(500), "1"],
    ["1000 nested sqrt", "sqrt(".repeat(1000) + "1" + ")".repeat(1000), "1"],
    ["5000-level power chain", "1^".repeat(5000) + "1", "1"],
    ["50000-level power chain", "1^".repeat(50000) + "1", "1"],
    ["20000 factorials", "0" + "!".repeat(20000), "1"],
    ["100000 unary minus", "-".repeat(100000) + "1", "1"],
    ["20000 percents", "1" + "%".repeat(20000), "1e-40000"],
  ])("%s", (_name, expr, expected) => {
    expect(ok(expr)).toBe(expected);
  });

  it("E1: 100000 open parens only is SYNTAX", () => {
    expect(err("(".repeat(100000))).toBe("SYNTAX");
  });

  // E2: no "brackets" message for bracket-free input.
  it("E2: long power chains never mention brackets", () => {
    const r = evaluate("2^".repeat(5000) + "2");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("OVERFLOW");
      expect(r.error.message).not.toMatch(/bracket/i);
    }
  });

  // E3: -0 is a non-negative integer.
  it("E3: (-0)! = 1", () => {
    expect(ok("(-0)!")).toBe("1");
    expect(ok("(0 × -1)!")).toBe("1");
    expect(err("(-1)!")).toBe("DOMAIN");
  });
});

describe("property: inverse operations round-trip", () => {
  // Deterministic PRNG so failures are reproducible.
  let seed = 0x5eed;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const shortDecimal = (): string => {
    const intPart = Math.floor(rand() * 10000);
    const decimals = Math.floor(rand() * 5);
    const frac = decimals ? "." + Array.from({ length: decimals }, () => Math.floor(rand() * 10)).join("") : "";
    const sign = rand() < 0.3 ? "-" : "";
    return `${sign}${intPart}${frac}`;
  };
  const canonical = (s: string) => {
    const d = new Decimal(s);
    return d.isZero() ? "0" : d.toString();
  };
  const pairs = Array.from({ length: 500 }, () => [shortDecimal(), shortDecimal()] as const);

  it("a + b - b === a for 500 random pairs", () => {
    for (const [a, b] of pairs) {
      expect(ok(`(${a}) + (${b}) - (${b})`), `${a}, ${b}`).toBe(canonical(a));
    }
  });

  it("(a × b) ÷ b === a for 500 random pairs (b ≠ 0)", () => {
    let checkedCount = 0;
    for (const [a, b] of pairs) {
      if (new Decimal(b).isZero()) continue;
      checkedCount++;
      expect(ok(`((${a}) × (${b})) ÷ (${b})`), `${a}, ${b}`).toBe(canonical(a));
    }
    expect(checkedCount).toBeGreaterThan(490);
  });
});
