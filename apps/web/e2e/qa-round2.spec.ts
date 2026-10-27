// Regression tests for QA round 2 findings N1–N6 (qa/e2e/bugs/findings-round2.json).
import { expect, test, type Page } from "@playwright/test";
import { expression, result } from "./helpers";

async function fresh(page: Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

const stored = (page: Page) =>
  page.evaluate(() =>
    (JSON.parse(localStorage.getItem("calc.history.v1") ?? "[]") as { expression: string; result: string; label: string | null }[]).map(
      (r) => `${r.expression}=${r.result} [${r.label}]`,
    ),
  );

test.describe("N1: label editing hands the keyboard back to the calculator", () => {
  test("mouse-saving a label, then 2+3 Enter, saves 5", async ({ page }) => {
    await fresh(page);
    for (const k of ["1", "+", "1", "Enter"]) await page.keyboard.press(k);
    await page.getByRole("button", { name: "Add label to 1 + 1" }).click();
    await page.keyboard.type("groceries");
    await page.getByRole("button", { name: "Save label", exact: true }).click();
    await expect(page.locator("#calc-expression")).toBeFocused();
    for (const k of ["2", "+", "3", "Enter", "*", "2", "Enter"]) await page.keyboard.press(k);
    await expect(result(page)).toHaveText("10");
    await expect(page.getByRole("textbox", { name: /Label for/ })).toHaveCount(0);
    expect(await stored(page)).toEqual(["5 × 2=10 [null]", "2 + 3=5 [null]", "1 + 1=2 [groceries]"]);
  });

  test("cancelling with the mouse or Escape also returns focus", async ({ page }) => {
    await fresh(page);
    await page.keyboard.type("4=");
    await page.getByRole("button", { name: "Add label to 4" }).click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.locator("#calc-expression")).toBeFocused();
    await page.getByRole("button", { name: "Add label to 4" }).click();
    await page.keyboard.press("Escape");
    await expect(page.locator("#calc-expression")).toBeFocused();
    await page.keyboard.type("6*7");
    await page.keyboard.press("Enter");
    await expect(result(page)).toHaveText("42");
  });
});

test.describe("N2: pasting e-notation keeps the value", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });
  for (const [text, value] of [["1e+24", "1e+24"], ["2.5e-8", "2.5e-8"], ["1e3", "1000"], ["7.2574156153079989674e+306", "7.2574156153079989674e+306"]]) {
    test(`${text} pastes as ${value}`, async ({ page }) => {
      await fresh(page);
      await page.evaluate((t) => navigator.clipboard.writeText(t), text);
      await page.keyboard.press("ControlOrMeta+V");
      await page.keyboard.press("Enter");
      await expect(result(page)).toHaveText(value);
    });
  }

  test("a copied result can be pasted back into a calculation", async ({ page }) => {
    await fresh(page);
    await page.keyboard.type("1000000^4=");
    await expect(result(page)).toHaveText("1e+24");
    await page.evaluate(() => navigator.clipboard.writeText("1e+24"));
    await page.keyboard.press("Escape");
    await page.keyboard.type("2*");
    await page.keyboard.press("ControlOrMeta+V");
    await page.keyboard.press("Enter");
    await expect(result(page)).toHaveText("2e+24");
  });
});

test.describe("N3: blocked storage never blanks the page", () => {
  const variants: Record<string, () => void> = {
    "localStorage getter throws": () =>
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new DOMException("denied", "SecurityError");
        },
      }),
    "getItem throws": () => {
      Storage.prototype.getItem = function () {
        throw new DOMException("denied", "SecurityError");
      };
    },
    "setItem throws": () => {
      Storage.prototype.setItem = function () {
        throw new DOMException("quota", "QuotaExceededError");
      };
    },
    "crypto.randomUUID missing": () => Object.defineProperty(Crypto.prototype, "randomUUID", { value: undefined }),
  };
  for (const [name, fn] of Object.entries(variants)) {
    test(name, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(fn);
      await page.goto("/");
      await expect(result(page)).toHaveText("0");
      for (const k of ["3", "+", "4", "Enter", "5", "+", "5", "Enter"]) await page.keyboard.press(k);
      await expect(result(page)).toHaveText("10");
      await expect(page.getByTestId("history-item")).toHaveCount(2);
      await expect(page.getByText("Something went wrong")).toHaveCount(0);
      await page.getByTestId("theme-toggle").click();
      expect(errors).toEqual([]);
    });
  }

  test("shows a note that history is session-only", async ({ page }) => {
    await page.addInitScript(variants["localStorage getter throws"]);
    await page.goto("/");
    await expect(page.getByText("Storage is blocked, so history lasts until you close this tab")).toBeVisible();
  });
});

test("N4: an 80-emoji label is kept whole", async ({ page }) => {
  await fresh(page);
  await page.keyboard.type("7=");
  await page.getByRole("button", { name: "Add label to 7" }).click();
  const input = page.getByRole("textbox", { name: "Label for 7" });
  await input.fill("🧾".repeat(80));
  await expect(page.getByText("80/80")).toBeVisible();
  await input.press("Enter");
  await expect(page.getByTestId("history-label")).toHaveText("🧾".repeat(80));
  await page.reload();
  await expect(page.getByTestId("history-label")).toHaveText("🧾".repeat(80));
  // Typing past 80 code points is capped, not cut in half a surrogate pair.
  await page.getByRole("button", { name: "Edit label for 7" }).click();
  await page.getByRole("textbox", { name: "Label for 7" }).press("End");
  await page.keyboard.type("🧾🧾");
  await expect(page.getByText("80/80")).toBeVisible();
});

test.describe("N5 & N6: paste limits and full-width input", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("an 801-character paste is rejected with a message, not truncated", async ({ page }) => {
    await fresh(page);
    await page.evaluate(() => navigator.clipboard.writeText("1+".repeat(400) + "1"));
    await page.keyboard.press("ControlOrMeta+V");
    await expect(page.getByRole("alert")).toHaveText(/That's too long to paste, max 500 characters/);
    await expect(expression(page)).toHaveText(/^\s*$/);
    await expect(result(page)).toHaveText("0");
    // The next key press clears the message.
    await page.keyboard.type("2");
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("full-width digits and operators are converted", async ({ page }) => {
    await fresh(page);
    await page.evaluate(() => navigator.clipboard.writeText("１２＋３×４－６÷２"));
    await page.keyboard.press("ControlOrMeta+V");
    await expect(expression(page)).toHaveText("12 + 3 × 4 − 6 ÷ 2");
    await page.keyboard.press("Enter");
    await expect(result(page)).toHaveText("21");
  });
});

for (const scheme of ["light", "dark"] as const) {
  test(`N6: label placeholder contrast is at least 4.5:1 (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await fresh(page);
    await page.keyboard.type("7=");
    await page.getByRole("button", { name: "Add label to 7" }).click();
    const ratio = await page.evaluate(() => {
      const toRGBA = (c: string) => {
        const cv = document.createElement("canvas");
        cv.width = cv.height = 1;
        const x = cv.getContext("2d")!;
        x.fillStyle = c;
        x.fillRect(0, 0, 1, 1);
        return [...x.getImageData(0, 0, 1, 1).data];
      };
      const inp = document.querySelector<HTMLInputElement>('input[aria-label^="Label for"]')!;
      let n: HTMLElement | null = inp;
      let bg: number[] = [255, 255, 255, 255];
      while (n) {
        const c = toRGBA(getComputedStyle(n).backgroundColor);
        if (c[3] === 255) {
          bg = c;
          break;
        }
        n = n.parentElement;
      }
      const ph = getComputedStyle(inp, "::placeholder");
      const cv = document.createElement("canvas");
      cv.width = cv.height = 1;
      const x = cv.getContext("2d")!;
      x.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
      x.fillRect(0, 0, 1, 1);
      x.globalAlpha = Number(ph.opacity || 1);
      x.fillStyle = ph.color;
      x.fillRect(0, 0, 1, 1);
      const fg = [...x.getImageData(0, 0, 1, 1).data];
      const lum = ([r, g, b]: number[]) => {
        const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const [l1, l2] = [lum(fg), lum(bg)];
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
}

test("N6: the error boundary takes focus and Try again recovers", async ({ page }) => {
  await fresh(page);
  await page.keyboard.type("6*7=");
  // Make history timestamp formatting throw during render, once.
  await page.addInitScript(() => {
    const w = window as unknown as { __boom: boolean };
    w.__boom = sessionStorage.getItem("boom") !== "off";
    const desc = Object.getOwnPropertyDescriptor(Intl.DateTimeFormat.prototype, "format")!;
    Object.defineProperty(Intl.DateTimeFormat.prototype, "format", {
      configurable: true,
      get() {
        if (w.__boom) throw new Error("forced render failure");
        return desc.get!.call(this);
      },
    });
  });
  await page.reload();
  const heading = page.getByRole("heading", { name: "Something went wrong" });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await page.evaluate(() => {
    (window as unknown as { __boom: boolean }).__boom = false;
  });
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("history-result")).toHaveText(["= 42"]);
});
