import type { CalcError } from "../../../../contract/types";

/** Friendly, plain-language copy for each engine error code. */
export function friendlyError(error: Pick<CalcError, "code">): string {
  switch (error.code) {
    case "DIVIDE_BY_ZERO":
      return "Can't divide by zero";
    case "DOMAIN":
      return "That's outside this function's range";
    case "OVERFLOW":
      return "Too large to calculate";
    case "EMPTY":
      return "Enter a calculation first";
    case "SYNTAX":
    default:
      return "That expression isn't finished";
  }
}
