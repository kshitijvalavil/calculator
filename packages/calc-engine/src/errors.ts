import type { CalcError, CalcErrorCode } from "../../../contract/types.ts";

/** Internal exception used to unwind the parser/evaluator. Never escapes `evaluate`. */
export class CalcFailure extends Error {
  readonly code: CalcErrorCode;
  constructor(code: CalcErrorCode, message: string) {
    super(message);
    this.name = "CalcFailure";
    this.code = code;
  }
  toCalcError(): CalcError {
    return { code: this.code, message: this.message };
  }
}

export const MESSAGES = {
  empty: "Enter a calculation",
  brackets: "Check the brackets",
  incomplete: "Finish the expression",
  syntax: "Check the expression",
  tooDeep: "Too many nested brackets",
  tooComplex: "That expression is too complex",
  divideByZero: "Can't divide by zero",
  sqrtNegative: "Can't take the square root of a negative number",
  logNonPositive: "Log needs a number above zero",
  tanUndefined: "tan is undefined here",
  factorialDomain: "Factorial needs a whole number, 0 or more",
  notReal: "The result isn't a real number",
  angleTooLarge: "That angle is too large",
  overflow: "Number too large",
  factorialOverflow: "Factorial too large (max 1000!)",
} as const;

export const fail = (code: CalcErrorCode, message: string): never => {
  throw new CalcFailure(code, message);
};
