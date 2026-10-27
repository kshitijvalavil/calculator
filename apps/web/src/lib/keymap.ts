import type { Token } from "./expression";

export type KeyCommand =
  | { type: "key"; key: Token }
  | { type: "equals" }
  | { type: "back" }
  | { type: "clear" };

const CHAR_TOKENS: Record<string, Token> = {
  "+": "+",
  "-": "−",
  "−": "−",
  "*": "×",
  "×": "×",
  x: "×",
  X: "×",
  "/": "÷",
  "÷": "÷",
  "^": "^",
  "%": "%",
  "!": "!",
  "(": "(",
  ")": ")",
  ".": ".",
  ",": ".",
  p: "π",
  "π": "π",
  e: "e",
  s: "sin(",
  c: "cos(",
  t: "tan(",
  l: "ln(",
  g: "log(",
  r: "sqrt(",
};

/** Maps a KeyboardEvent.key to a calculator command, or null if it isn't one. */
export function commandForKey(key: string): KeyCommand | null {
  if (/^[0-9]$/.test(key)) return { type: "key", key: key as Token };
  if (key === "Enter" || key === "=") return { type: "equals" };
  if (key === "Backspace") return { type: "back" };
  if (key === "Escape" || key === "Delete") return { type: "clear" };
  const token = CHAR_TOKENS[key];
  return token ? { type: "key", key: token } : null;
}

/** The data-key id of the on-screen key that a command corresponds to, for press feedback. */
export function keyIdFor(cmd: KeyCommand): string {
  return cmd.type === "key" ? cmd.key : cmd.type;
}
