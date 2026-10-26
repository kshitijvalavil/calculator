import type { AngleUnit, CalcError, EvaluateResult, Mode } from "../../../../contract/types";
import {
  applyKey,
  autoClose,
  backspace,
  endsValue,
  expandExponent,
  isBinary,
  opensGroup,
  toExpression,
  toggleSign,
  tokenize,
  trimIncomplete,
  type Token,
} from "./expression";

export interface Evaluated {
  expression: string;
  result?: string;
  error?: CalcError;
}

export interface CalcState {
  tokens: Token[];
  mode: Mode;
  angle: AngleUnit;
  /** Set right after "=", until the next edit. */
  evaluated: Evaluated | null;
}

export type CalcAction =
  | { type: "key"; key: Token }
  | { type: "sign" }
  | { type: "back" }
  | { type: "clear" }
  | { type: "evaluated"; tokens: Token[]; evaluated: Evaluated }
  | { type: "serverResult"; expression: string; result: string }
  | { type: "loadExpression"; expression: string }
  | { type: "insertValue"; value: string }
  | { type: "paste"; tokens: Token[] }
  | { type: "mode"; mode: Mode }
  | { type: "angle"; angle: AngleUnit };

export const initialState = (partial: Partial<CalcState> = {}): CalcState => ({
  tokens: [],
  mode: "standard",
  angle: "deg",
  evaluated: null,
  ...partial,
});

const valueTokens = (value: string): Token[] => tokenize(expandExponent(value)) ?? [];

/** Keys that begin a new value; after "=" they start a fresh expression. */
const startsFresh = (key: Token) => !isBinary(key) && key !== "%" && key !== "!" && key !== ")";

/** Tokens to keep editing after "=": the result if there is one, otherwise the expression. */
function continueFrom(state: CalcState, key?: Token): Token[] {
  const ev = state.evaluated;
  if (!ev) return state.tokens;
  if (key && startsFresh(key)) return [];
  return ev.result !== undefined ? valueTokens(ev.result) : state.tokens;
}

export function calcReducer(state: CalcState, action: CalcAction): CalcState {
  switch (action.type) {
    case "key":
      return { ...state, evaluated: null, tokens: applyKey(continueFrom(state, action.key), action.key) };
    case "sign":
      return { ...state, evaluated: null, tokens: toggleSign(continueFrom(state)) };
    case "back":
      // After "=", Backspace returns to editing the expression without losing it.
      if (state.evaluated) return { ...state, evaluated: null };
      return { ...state, tokens: backspace(state.tokens) };
    case "clear":
      return { ...state, tokens: [], evaluated: null };
    case "evaluated":
      return { ...state, tokens: action.tokens, evaluated: action.evaluated };
    case "serverResult":
      if (state.evaluated?.expression !== action.expression) return state;
      return { ...state, evaluated: { expression: action.expression, result: action.result } };
    case "loadExpression": {
      const tokens = tokenize(action.expression);
      return tokens ? { ...state, tokens, evaluated: null } : state;
    }
    case "insertValue": {
      const value = valueTokens(action.value);
      if (!value.length) return state;
      const base = state.evaluated ? [] : state.tokens;
      const last = base[base.length - 1];
      // Append after an operator or "(", otherwise replace what's there.
      if (base.length && (isBinary(last) || opensGroup(last))) {
        return { ...state, evaluated: null, tokens: [...base, ...value] };
      }
      return { ...state, evaluated: null, tokens: value };
    }
    case "paste": {
      if (!action.tokens.length) return state;
      // Each pasted token goes through the same rules as a key press.
      const tokens = action.tokens.reduce(applyKey, continueFrom(state, action.tokens[0]));
      return { ...state, evaluated: null, tokens };
    }
    case "mode":
      return { ...state, mode: action.mode };
    case "angle":
      return { ...state, angle: action.angle };
  }
}

/** The closed expression that "=" will evaluate and save. */
export function expressionToEvaluate(tokens: readonly Token[]): { tokens: Token[]; expression: string } {
  const closed = autoClose(tokens);
  return { tokens: closed, expression: toExpression(closed) };
}

export type Preview =
  | { kind: "none" }
  | { kind: "value"; text: string }
  | { kind: "error"; error: CalcError };

/** Live preview of the expression being typed. Incomplete input shows nothing. */
export function computePreview(
  tokens: readonly Token[],
  angle: AngleUnit,
  evaluate: (expr: string, angle: AngleUnit) => EvaluateResult,
): Preview {
  const trimmed = trimIncomplete(tokens);
  if (!trimmed.length || !endsValue(trimmed[trimmed.length - 1])) return { kind: "none" };
  const res = evaluate(toExpression(autoClose(trimmed)), angle);
  if (res.ok) return { kind: "value", text: res.result };
  if (res.error.code === "SYNTAX" || res.error.code === "EMPTY") return { kind: "none" };
  return { kind: "error", error: res.error };
}
