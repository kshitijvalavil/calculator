import { expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface Case {
  expression: string;
  angle?: "deg" | "rad";
  result?: string;
  error?: string;
}
const casesPath = fileURLToPath(new URL("../../../contract/test-cases.json", import.meta.url));
export const cases = (JSON.parse(readFileSync(casesPath, "utf8")) as { cases: Case[] }).cases;

const WORDS: [RegExp, string][] = [
  [/^sqrt\(/, "square root"],
  [/^sin\(/, "sine"],
  [/^cos\(/, "cosine"],
  [/^tan\(/, "tangent"],
  [/^ln\(/, "natural logarithm"],
  [/^log\(/, "logarithm base 10"],
  [/^(pi|π)/, "pi"],
  [/^e/, "Euler's number"],
  [/^[0-9]/, ""],
  [/^\./, "decimal point"],
  [/^\+/, "plus"],
  [/^[-−]/, "minus"],
  [/^[×*]/, "multiply"],
  [/^[÷/]/, "divide"],
  [/^\^/, "power"],
  [/^%/, "percent"],
  [/^!/, "factorial"],
  [/^\(/, "left parenthesis"],
  [/^\)/, "right parenthesis"],
];

const SCI_KEYS = new Set(["square root", "sine", "cosine", "tangent", "natural logarithm", "logarithm base 10", "pi", "Euler's number", "power", "factorial", "left parenthesis", "right parenthesis"]);

/** Turns a contract expression into the accessible names of the keys to click. */
export function keysFor(expression: string): string[] {
  const out: string[] = [];
  let s = expression.replace(/\s+/g, "");
  while (s) {
    const hit = WORDS.find(([re]) => re.test(s));
    if (!hit) throw new Error(`No key for "${s}"`);
    const m = hit[0].exec(s)!;
    out.push(hit[1] || m[0]);
    s = s.slice(m[0].length);
  }
  return out;
}

export const needsScientific = (keys: string[]) => keys.some((k) => SCI_KEYS.has(k));

export const key = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
export const result = (page: Page) => page.getByTestId("result");
export const expression = (page: Page) => page.getByTestId("expression");

export async function setMode(page: Page, mode: "Standard" | "Scientific") {
  const btn = page.getByRole("button", { name: mode, exact: true });
  if ((await btn.getAttribute("aria-pressed")) !== "true") await btn.click();
}

/** Clicks through an expression on the on-screen keys, then "=". */
export async function clickThrough(page: Page, c: Case) {
  const keys = keysFor(c.expression);
  if (needsScientific(keys) || c.angle) {
    await setMode(page, "Scientific");
    await key(page, c.angle === "rad" ? "radians" : "degrees").click();
  }
  await key(page, "all clear").click();
  for (const k of keys) await key(page, k).click();
  await key(page, "equals").click();
}

export async function noHorizontalScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(client);
}
