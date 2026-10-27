// Expected values derived from CONTRACT.md by hand / Python Decimal at 80 digits.
import { describe, it, expect } from "vitest";
import { ev, show, shapeProblems } from "./_helpers.ts";

type Row = [expr: string, expected: string, angle?: "deg" | "rad"];
function table(name: string, rows: Row[]) {
  describe(name, () => {
    for (const [expr, expected, angle] of rows) {
      it(`${JSON.stringify(expr)}${angle ? " [" + angle + "]" : ""} -> ${expected}`, () => {
        const r = ev(expr, angle);
        expect(shapeProblems(r)).toEqual([]);
        expect(show(r)).toBe(expected);
      });
    }
  });
}

table("associativity", [
  ["2 - 3 - 4", "-5"],
  ["100 / 10 / 5", "2"],
  ["8 ÷ 2 × 4", "16"],
  ["2 ^ 2 ^ 3", "256"],
  ["(2 ^ 2) ^ 3", "64"],
  ["2 ^ 3 ^ 0", "2"],
  ["1 - 1 + 1", "1"],
]);

table("precedence", [
  ["2 + 3 × 4 ^ 2", "50"],
  ["2 × 3 ^ 2", "18"],
  ["10 - 2 × 3", "4"],
  ["2 × 3 + 4 × 5", "26"],
  ["-3 ^ 2", "-9"],
  ["(-3) ^ 2", "9"],
  ["-2 ^ -2", "-0.25"],
  ["2 ^ -2 ^ 2", "0.0625"],
  ["2 ^ -1", "0.5"],
  ["2 ^ 3!", "64"],
  ["-3!", "-6"],
  ["-0!", "-1"],
  ["2 × -3 ^ 2", "-18"],
  ["-2 × -2", "4"],
]);

table("postfix % and !", [
  ["50%%", "0.005"],
  ["5!%", "1.2"],
  ["200%!", "2"],
  ["10% ^ 2", "0.01"],
  ["2 ^ 50%", "1.4142135623730950488"],
  ["-50%", "-0.5"],
  ["50% × 2", "1"],
  ["100 + 10%", "100.1"],
  ["(2 + 1)!", "6"],
  ["sqrt(16)!", "24"],
  ["3!!", "720"],
  ["3.0!", "6"],
  ["0.5!", "ERR:DOMAIN"],
  ["(-3)!", "ERR:DOMAIN"],
  ["(-0)!", "1"],
  ["170!", "7.2574156153079989674e+306"],
  ["449!", "3.8519305180280725763e+997"],
  ["450!", "ERR:OVERFLOW"],
  ["1000!", "ERR:OVERFLOW"],
  ["1001!", "ERR:OVERFLOW"],
  ["100000!", "ERR:OVERFLOW"],
  ["50%!", "ERR:DOMAIN"],
]);

table("unary minus / plus and unicode minus", [
  ["5 − 3", "2"],
  ["−5", "-5"],
  ["2 × −3", "-6"],
  ["−(−2)", "2"],
  ["2 - -3", "5"],
  ["2--3", "5"],
  ["2 + +3", "5"],
  ["+5", "5"],
  ["--5", "5"],
  ["---5", "-5"],
  ["5 – 3", "ERR:SYNTAX"], // en dash is not an operator
  ["5 — 3", "ERR:SYNTAX"], // em dash
  ["5 ‐ 3", "ERR:SYNTAX"], // unicode hyphen U+2010
  ["5 x 3", "ERR:SYNTAX"],
]);

table("whitespace", [
  ["  2+3  ", "5"],
  ["2+3", "5"],
  ["\t2\t+\t3\t", "5"],
  ["2\n+\n3", "5"],
  [" ( 2 + 3 ) × 4 ", "20"],
  ["sqrt ( 16 )", "4"],
  ["5 !", "120"],
  ["50 %", "0.5"],
  ["- 5", "-5"],
  ["1 2", "ERR:SYNTAX"],
  ["\t\n ", "ERR:EMPTY"],
]);

table("implicit multiplication", [
  ["2pi", "6.2831853071795864769"],
  ["2π", "6.2831853071795864769"],
  ["2e", "5.4365636569180904707"],
  ["2 (3)", "6"],
  ["(1+2)(3+4)", "21"],
  ["2(3)(4)", "24"],
  ["2sqrt(16)", "8"],
  ["3sin(30)", "1.5"],
  ["2(3 + 1)!", "48"],
]);

table("number formatting", [
  ["100", "100"],
  ["10 × 10", "100"],
  ["1000000", "1000000"],
  ["1.000", "1"],
  ["0.50", "0.5"],
  ["1.10 + 2.20", "3.3"],
  ["0.000001", "0.000001"],
  ["0.0000001", "1e-7"],
  ["10 ^ 20", "100000000000000000000"],
  ["10 ^ 21", "1e+21"],
  ["-10 ^ 21", "-1e+21"],
  ["10 ^ -6", "0.000001"],
  ["10 ^ -7", "1e-7"],
  ["123456789012345678901234", "1.234567890123456789e+23"],
  ["99999999999999999999.5", "100000000000000000000"],
  ["0.123456789012345678905", "0.12345678901234567891"],
  ["-0.123456789012345678905", "-0.12345678901234567891"],
  ["1 ÷ 7", "0.14285714285714285714"],
  ["100 ÷ 3", "33.333333333333333333"],
  ["-2 ÷ 3", "-0.66666666666666666667"],
  ["sin(45)", "0.7071067811865475244"],
  ["sqrt(2) × sqrt(2)", "2"],
  ["sqrt(2) ^ 2", "2"],
  ["10 ^ 999", "1e+999"],
  ["9.99 × 10 ^ 999", "9.99e+999"],
  ["10 ^ 1000", "ERR:OVERFLOW"],
  ["-10 ^ 1000", "ERR:OVERFLOW"],
  ["0.1 ^ 2000", "1e-2000"],
]);

table("never -0", [
  ["0 × -1", "0"],
  ["-0 × 5", "0"],
  ["-(0)", "0"],
  ["0 ÷ -5", "0"],
  ["-sin(180)", "0"],
  ["sin(-180)", "0"],
  ["-cos(90)", "0"],
  ["tan(-180)", "0"],
  ["-0%", "0"],
  ["-0 ^ 3", "0"],
  ["sqrt(-0)", "0"],
  ["-sin(pi)", "0", "rad"],
  ["-1 × 0", "0"],
  ["(0 - 0) × -1", "0"],
  ["-ln(1)", "0"],
  ["-log(1)", "0"],
]);

table("functions, constants, trig", [
  ["sin(150)", "0.5"],
  ["sin(210)", "-0.5"],
  ["sin(-30)", "-0.5"],
  ["cos(60)", "0.5"],
  ["cos(120)", "-0.5"],
  ["cos(180)", "-1"],
  ["sin(360)", "0"],
  ["cos(270)", "0"],
  ["sin(36000030)", "0.5"],
  ["sin(90)", "1"],
  ["sin(90)", "0.89399666360055789052", "rad"],
  ["sin(1)", "0.84147098480789650665", "rad"],
  ["sin(pi ÷ 6)", "0.5", "rad"],
  ["cos(pi)", "-1", "rad"],
  ["tan(270)", "ERR:DOMAIN"],
  ["tan(-90)", "ERR:DOMAIN"],
  ["tan(450)", "ERR:DOMAIN"],
  ["tan(90 + 360 × 1000)", "ERR:DOMAIN"],
  ["tan(pi ÷ 2)", "ERR:DOMAIN", "rad"],
  ["tan(3pi ÷ 2)", "ERR:DOMAIN", "rad"],
  ["tan(-pi ÷ 2)", "ERR:DOMAIN", "rad"],
  ["tan(180)", "0"],
  ["log(0.001)", "-3"],
  ["log(10)", "1"],
  ["ln(1)", "0"],
  ["ln(2)", "0.69314718055994530942"],
  ["log(2)", "0.30102999566398119521"],
  ["log(-1)", "ERR:DOMAIN"],
  ["log(0)", "ERR:DOMAIN"],
  ["ln(-0)", "ERR:DOMAIN"],
  ["sqrt(0)", "0"],
  ["sqrt(0.25)", "0.5"],
  ["sqrt(3)", "1.7320508075688772935"],
  ["sqrt(-0.0001)", "ERR:DOMAIN"],
  ["e", "2.7182818284590452354"],
  ["π", "3.1415926535897932385"],
  ["ln(e ^ 2)", "2"],
  ["sqrt(sqrt(16))", "2"],
]);

table("division by zero and pow edge cases", [
  ["1 ÷ (1 - 1)", "ERR:DIVIDE_BY_ZERO"],
  ["5 / 0%", "ERR:DIVIDE_BY_ZERO"],
  ["1 / (0.1 + 0.2 - 0.3)", "ERR:DIVIDE_BY_ZERO"],
  ["0 / 0 + 1", "ERR:DIVIDE_BY_ZERO"],
  ["0 ^ -1", "ERR:DIVIDE_BY_ZERO"],
  ["0 ^ 0", "1"],
  ["(-8) ^ 3", "-512"],
  ["10 ^ 10 ^ 10", "ERR:OVERFLOW"],
  ["2 ^ (10 ^ 10)", "ERR:OVERFLOW"],
]);

table("syntax errors", [
  ["()", "ERR:SYNTAX"],
  [")", "ERR:SYNTAX"],
  ["2)", "ERR:SYNTAX"],
  ["(()", "ERR:SYNTAX"],
  ["sqrt()", "ERR:SYNTAX"],
  ["sin()", "ERR:SYNTAX"],
  ["sqrt(", "ERR:SYNTAX"],
  ["sin(30", "ERR:SYNTAX"],
  ["1.2.3", "ERR:SYNTAX"],
  ["×5", "ERR:SYNTAX"],
  ["5×", "ERR:SYNTAX"],
  ["5 ÷", "ERR:SYNTAX"],
  ["^2", "ERR:SYNTAX"],
  ["!", "ERR:SYNTAX"],
  ["%", "ERR:SYNTAX"],
  ["2 ** 3", "ERR:SYNTAX"],
  ["foo(2)", "ERR:SYNTAX"],
  ["2 $ 3", "ERR:SYNTAX"],
  ["(2)3", "ERR:SYNTAX"],
  ["pi2", "ERR:SYNTAX"],
  ["=", "ERR:SYNTAX"],
  ["2 + 3 =", "ERR:SYNTAX"],
  ["0x10", "ERR:SYNTAX"],
  ["1,000", "ERR:SYNTAX"],
  ["Infinity", "ERR:SYNTAX"],
  ["NaN", "ERR:SYNTAX"],
  ["2 + 3\u0000", "ERR:SYNTAX"],
]);

describe("scientific notation input is not supported", () => {
  it("1e3 is not 1000", () => {
    const r = ev("1e3");
    expect(shapeProblems(r)).toEqual([]);
    expect(show(r)).not.toBe("1000");
  });
  it("1e+24 (the engine's own output) evaluates as 1·e + 24, not 10^24", () => {
    // Documented contract consequence; the UI must not feed exponential results back in verbatim.
    expect(show(ev("1e+24"))).toBe("26.718281828459045235");
  });
});

describe("rounding edge just under the overflow limit", () => {
  it("9.999999999999999999999 × 10 ^ 999 must not print 1e+1000 as a success", () => {
    const r = ev("9.999999999999999999999 × 10 ^ 999");
    expect(shapeProblems(r)).toEqual([]);
  });
});

describe("options", () => {
  it("angle defaults to deg when options omitted or empty", () => {
    expect(show(ev("sin(30)"))).toBe("0.5");
    expect(show((ev as any)("sin(30)", undefined))).toBe("0.5");
  });
  it("angle only affects trig", () => {
    expect(show(ev("2 + 2", "rad"))).toBe("4");
    expect(show(ev("sqrt(16)", "rad"))).toBe("4");
  });
});
