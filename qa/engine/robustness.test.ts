// Fuzzing and invariants: evaluate never throws, always returns a well-formed {ok} quickly.
import { describe, it, expect } from "vitest";
import { evaluate, ev, show, shapeProblems } from "./_helpers.ts";

// Deterministic PRNG so failures are reproducible.
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const TOKENS = ["0", "1", "2", "9", "0.5", ".", "00", "123456789", "+", "-", "−", "*", "×", "/", "÷", "^", "%", "!",
  "(", ")", " ", "\t", "sqrt", "sin", "cos", "tan", "ln", "log", "pi", "π", "e", "E", "1e", "x", ",", "=", "∞",
  "\u0000", "😀", "​", "٣", "１", "NaN", "Infinity", "__proto__", "constructor", "toString", "999999999999"];

function check(expr: string, angle: "deg" | "rad" = "deg", budgetMs = 50) {
  let r: unknown;
  const t0 = performance.now();
  try {
    r = evaluate(expr, { angle });
  } catch (err) {
    throw new Error(`evaluate threw on ${JSON.stringify(expr)}: ${String(err)}`);
  }
  const dt = performance.now() - t0;
  const problems = shapeProblems(r);
  if (dt > budgetMs) problems.push(`took ${dt.toFixed(1)} ms (> ${budgetMs})`);
  return { r, problems };
}

describe("fuzz: token soup", () => {
  it("5000 random token expressions are well-formed and < 50 ms each", () => {
    const rand = rng(1234);
    const bad: string[] = [];
    for (let i = 0; i < 5000; i++) {
      const n = 1 + Math.floor(rand() * 25);
      let s = "";
      for (let j = 0; j < n; j++) s += TOKENS[Math.floor(rand() * TOKENS.length)];
      const { problems } = check(s, rand() < 0.5 ? "deg" : "rad");
      if (problems.length) bad.push(`${JSON.stringify(s)}: ${problems.join("; ")}`);
    }
    expect(bad.slice(0, 15)).toEqual([]);
  });
});

describe("fuzz: random unicode garbage", () => {
  it("3000 random code-point strings never throw", () => {
    const rand = rng(99);
    const bad: string[] = [];
    for (let i = 0; i < 3000; i++) {
      const n = Math.floor(rand() * 40);
      let s = "";
      for (let j = 0; j < n; j++) {
        const pick = rand();
        const cp = pick < 0.6 ? 32 + Math.floor(rand() * 95) : pick < 0.9 ? Math.floor(rand() * 0x3000) : Math.floor(rand() * 0x10ffff);
        if (cp >= 0xd800 && cp <= 0xdfff) s += String.fromCharCode(cp); // lone surrogates on purpose
        else s += String.fromCodePoint(cp);
      }
      const { problems } = check(s);
      if (problems.length) bad.push(`${JSON.stringify(s)}: ${problems.join("; ")}`);
    }
    expect(bad.slice(0, 15)).toEqual([]);
  });
});

describe("fuzz: grammatical expressions", () => {
  // Generates syntactically valid expressions; any error must be a math error, never SYNTAX.
  function gen(rand: () => number, depth: number): string {
    const r = rand();
    if (depth <= 0 || r < 0.3) {
      const atoms = ["0", "1", "2", "3", "7", "0.1", "2.5", "10", "pi", "e", "100"];
      return atoms[Math.floor(rand() * atoms.length)];
    }
    if (r < 0.6) {
      const ops = ["+", "-", "×", "÷", "*", "/", "−", "^"];
      return `${gen(rand, depth - 1)} ${ops[Math.floor(rand() * ops.length)]} ${gen(rand, depth - 1)}`;
    }
    if (r < 0.7) return `(${gen(rand, depth - 1)})`;
    if (r < 0.8) return `-${gen(rand, depth - 1)}`;
    if (r < 0.9) return `${["sqrt", "sin", "cos", "tan", "ln", "log"][Math.floor(rand() * 6)]}(${gen(rand, depth - 1)})`;
    return `(${gen(rand, depth - 1)})${rand() < 0.5 ? "%" : "!"}`;
  }
  it("3000 valid expressions never return SYNTAX and are well-formed", () => {
    const rand = rng(7);
    const bad: string[] = [];
    for (let i = 0; i < 3000; i++) {
      const s = gen(rand, 5);
      const { r, problems } = check(s, rand() < 0.5 ? "deg" : "rad", 100);
      if ((r as any)?.ok === false && (r as any).error.code === "SYNTAX") problems.push("SYNTAX on a valid expression");
      if (problems.length) bad.push(`${JSON.stringify(s)}: ${problems.join("; ")} => ${JSON.stringify(r)}`);
    }
    expect(bad.slice(0, 15)).toEqual([]);
  });
});

describe("deep nesting and long input", () => {
  const cases: [string, string, string | null][] = [
    ["500 nested parens", "(".repeat(500) + "1" + ")".repeat(500), "1"],
    ["500 nested parens with ops", "(".repeat(500) + "1" + "+1)".repeat(500), "501"],
    ["500 nested sqrt", "sqrt(".repeat(500) + "1" + ")".repeat(500), "1"],
    ["5000 nested parens", "(".repeat(5000) + "1" + ")".repeat(5000), null],
    ["100000 nested parens", "(".repeat(100000) + "1" + ")".repeat(100000), null],
    ["100000 open parens only", "(".repeat(100000), "ERR:SYNTAX"],
    ["10000 unary minus", "-".repeat(10000) + "1", "1"],
    ["100000 unary minus", "-".repeat(100000) + "1", null],
    ["5000-level right-assoc power", "1^".repeat(5000) + "1", "1"],
    ["50000-level right-assoc power", "1^".repeat(50000) + "1", null],
    ["20000 factorials", "0" + "!".repeat(20000), "1"],
    ["20000 percents", "1" + "%".repeat(20000), null],
    ["long sum 1+1+...", Array(20000).fill("1").join("+"), "20000"],
    ["10000-digit number", "9".repeat(10000), "ERR:OVERFLOW"],
    ["1000-digit number", "1" + "0".repeat(999), "1e+999"],
    ["long decimal", "0." + "0".repeat(5000) + "1", "1e-5001"],
  ];
  for (const [name, expr, expected] of cases) {
    it(`${name} does not throw (and is reasonably fast)`, () => {
      const { r, problems } = check(expr, "deg", 2000);
      expect(problems).toEqual([]);
      if (expected) expect(show(r as any)).toBe(expected);
    });
  }
});

describe("non-string and odd inputs (\"never throws\")", () => {
  const odd: [string, unknown, unknown][] = [
    ["undefined", undefined, undefined],
    ["null", null, undefined],
    ["number", 42, undefined],
    ["object", { toString: () => "1+1" }, undefined],
    ["array", ["1+1"], undefined],
    ["angle grad", "sin(30)", { angle: "grad" }],
    ["options null", "1+1", null],
    ["options string", "1+1", "rad"],
  ];
  for (const [name, expr, opts] of odd) {
    it(`${name}: no throw, well-formed`, () => {
      let r: unknown;
      expect(() => { r = (evaluate as any)(expr, opts); }).not.toThrow();
      expect(shapeProblems(r)).toEqual([]);
    });
  }
});

describe("properties", () => {
  // exact decimal arithmetic via BigInt for reference
  function dec(s: string): [bigint, number] {
    const neg = s.startsWith("-"); const t = neg ? s.slice(1) : s;
    const [i, f = ""] = t.split(".");
    return [BigInt((neg ? "-" : "") + i + f), f.length];
  }
  function toStr(v: bigint, scale: number): string {
    const neg = v < 0n; let s = (neg ? -v : v).toString().padStart(scale + 1, "0");
    let out = scale ? s.slice(0, -scale) + "." + s.slice(-scale) : s;
    if (out.includes(".")) out = out.replace(/0+$/, "").replace(/\.$/, "");
    return out === "0" ? "0" : (neg ? "-" : "") + out;
  }
  function add(a: string, b: string, sign = 1n) {
    const [x, sx] = dec(a), [y, sy] = dec(b); const s = Math.max(sx, sy);
    return toStr(x * 10n ** BigInt(s - sx) + sign * y * 10n ** BigInt(s - sy), s);
  }
  function mul(a: string, b: string) { const [x, sx] = dec(a), [y, sy] = dec(b); return toStr(x * y, sx + sy); }
  const rand = rng(42);
  const num = () => {
    const i = Math.floor(rand() * 1e6); const f = Math.floor(rand() * 1e4);
    return (rand() < 0.3 ? "-" : "") + i + (rand() < 0.7 ? "." + String(f).padStart(4, "0") : "");
  };
  const wrap = (n: string) => (n.startsWith("-") ? `(${n})` : n);

  it("a + b, a - b, a × b are exact for short decimals (500 samples)", () => {
    const bad: string[] = [];
    for (let i = 0; i < 500; i++) {
      const a = num(), b = num();
      const checks: [string, string][] = [
        [`${a} + ${wrap(b)}`, add(a, b)],
        [`${a} - ${wrap(b)}`, add(a, b, -1n)],
        [`${a} × ${wrap(b)}`, mul(a, b)],
      ];
      for (const [e, want] of checks) { const got = show(ev(e)); if (got !== want) bad.push(`${e}: got ${got}, want ${want}`); }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it("commutativity and (a + b) - b = a (300 samples)", () => {
    const bad: string[] = [];
    for (let i = 0; i < 300; i++) {
      const a = num(), b = num();
      if (show(ev(`${a} + ${wrap(b)}`)) !== show(ev(`${b} + ${wrap(a)}`))) bad.push(`+ ${a} ${b}`);
      if (show(ev(`${a} × ${wrap(b)}`)) !== show(ev(`${b} × ${wrap(a)}`))) bad.push(`× ${a} ${b}`);
      if (show(ev(`(${a} + ${wrap(b)}) - ${wrap(b)}`)) !== toStr(...dec(a))) bad.push(`roundtrip ${a} ${b}`);
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it("re-evaluating a plain-notation result returns the same string (idempotence)", () => {
    const exprs = ["1 ÷ 3", "2 ÷ 3", "-7 ÷ 9", "sqrt(2)", "pi", "e", "20!", "0.1 + 0.2", "sin(1)", "100 ÷ 7", "-0.000001 × 3"];
    const bad: string[] = [];
    for (const e of exprs) {
      const r1 = ev(e); if (!r1.ok) { bad.push(`${e} failed`); continue; }
      const r2 = ev(r1.result);
      if (show(r2) !== r1.result) bad.push(`${e} -> ${r1.result} -> ${show(r2)}`);
    }
    expect(bad).toEqual([]);
  });

  it("x - x is exactly 0 and x ÷ x is 1 for awkward x", () => {
    for (const x of ["1 ÷ 3", "sqrt(2)", "pi", "e", "sin(1)", "ln(2)"]) {
      expect(show(ev(`(${x}) - (${x})`))).toBe("0");
      expect(show(ev(`(${x}) ÷ (${x})`))).toBe("1");
    }
  });

  it("deterministic: same input twice gives the same output", () => {
    for (const e of ["1 ÷ 3", "sin(30)", "2 ^ 0.5", "tan(89.9999)"]) expect(show(ev(e))).toBe(show(ev(e)));
  });

  it("whitespace insertion between tokens never changes the result", () => {
    const exprs = ["2+3×4", "(2+3)×4", "-2^2", "2^3^2", "50%", "5!", "sqrt(16)", "2(3+1)", "sin(30)", "10÷4"];
    for (const e of exprs) {
      const spaced = e.replace(/(sqrt|sin|cos|tan|ln|log|pi|\d+(?:\.\d+)?|.)/g, " $1 ").replace(/(sqrt|sin|cos|tan|ln|log) \(/g, "$1(");
      expect(show(ev(spaced)), spaced).toBe(show(ev(e)));
    }
  });

  it("hyphen and unicode minus are interchangeable everywhere", () => {
    const exprs = ["5-3", "-5", "2×-3", "-(2+3)", "-2^2", "10^-2", "2--3", "-0"];
    for (const e of exprs) expect(show(ev(e.replace(/-/g, "−"))), e).toBe(show(ev(e)));
  });
});
