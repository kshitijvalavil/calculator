// Regression tests for the QA findings F1–F4 (Sherlock Bugs, qa/e2e/bugs/findings.json).
import { expect, test, type Page } from "@playwright/test";
import { expression, key, result, setMode } from "./helpers";

/** The whole result text must sit inside the result box and the display: nothing clipped. */
async function expectResultFullyVisible(page: Page) {
  const m = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>("[data-testid=result]")!;
    const display = document.querySelector<HTMLElement>(".display")!;
    const range = document.createRange();
    range.selectNodeContents(el);
    const t = range.getBoundingClientRect();
    const c = el.getBoundingClientRect();
    const d = display.getBoundingClientRect();
    return { t, c, d, scrollW: el.scrollWidth, clientW: el.clientWidth, docW: document.documentElement.scrollWidth, vw: innerWidth };
  });
  expect(m.scrollW).toBeLessThanOrEqual(m.clientW);
  expect(m.t.left).toBeGreaterThanOrEqual(m.c.left - 1);
  expect(m.t.right).toBeLessThanOrEqual(m.c.right + 1);
  expect(m.t.left).toBeGreaterThanOrEqual(m.d.left);
  expect(m.t.right).toBeLessThanOrEqual(m.d.right);
  expect(m.docW).toBeLessThanOrEqual(m.vw);
}

async function fresh(page: Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

test.describe("F1: long results are never clipped", () => {
  for (const [w, h] of [[1280, 800], [375, 812], [320, 640]] as const) {
    test(`170! at ${w}px shows every digit`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await fresh(page);
      await setMode(page, "Scientific");
      await page.keyboard.type("170!");
      await page.keyboard.press("Enter");
      await expect(result(page)).toHaveText("7.2574156153079989674e+306");
      await expectResultFullyVisible(page);
    });

    test(`2 ÷ 3 at ${w}px keeps its leading 0.6`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await fresh(page);
      await setMode(page, "Scientific");
      await key(page, "2").click();
      await key(page, "divide").click();
      await key(page, "3").click();
      await key(page, "equals").click();
      await expect(result(page)).toHaveText("0.66666666666666666667");
      await expectResultFullyVisible(page);
    });
  }

  test("a huge result wraps instead of clipping at the minimum size", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await fresh(page);
    await page.keyboard.type("123456789012345678*987654321098765432*-1");
    await page.keyboard.press("Enter");
    await expectResultFullyVisible(page);
  });

  test("a long expression can be scrolled back to its start", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await fresh(page);
    await page.keyboard.type("1111111111+2222222222+3333333333+4444444444");
    const scroll = await expression(page).evaluate((el) => {
      el.scrollLeft = 0;
      const first = el.querySelector(".tok")!.getBoundingClientRect();
      return { firstLeft: first.left, boxLeft: el.getBoundingClientRect().left, overflow: el.scrollWidth > el.clientWidth };
    });
    expect(scroll.overflow).toBe(true);
    expect(scroll.firstLeft).toBeGreaterThanOrEqual(scroll.boxLeft - 1);
  });
});

test.describe("F2: corrupted saved history never white-screens", () => {
  for (const raw of ["[null]", "[{}]", "[1]", "{broken", '"text"', '[{"id":1,"expression":null}]']) {
    test(`calc.history.v1 = ${raw}`, async ({ page }) => {
      await page.goto("/");
      await page.evaluate((v) => {
        localStorage.setItem("calc.history.v1", v);
        localStorage.setItem("calc.mode", "???");
        localStorage.setItem("calc.theme", "{}");
      }, raw);
      await page.reload();
      await expect(key(page, "equals")).toBeVisible();
      await expect(page.getByText("No calculations yet.")).toBeVisible();
      await page.keyboard.type("2+3=");
      await expect(result(page)).toHaveText("5");
      await expect(page.getByTestId("history-item")).toHaveCount(1);
    });
  }

  test("valid entries survive next to invalid ones", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() =>
      localStorage.setItem(
        "calc.history.v1",
        JSON.stringify([null, { id: "ok", expression: "5 × 2", result: "10", mode: "standard", angle: "deg", label: "Kept", created_at: new Date().toISOString() }, 7]),
      ),
    );
    await page.reload();
    await expect(page.getByTestId("history-item")).toHaveCount(1);
    await expect(page.getByTestId("history-label")).toHaveText("Kept");
  });
});

test("F3: 5000 stored entries are capped and '=' stays fast", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const now = new Date().toISOString();
    const rows = Array.from({ length: 5000 }, (_, i) => ({
      id: `id-${i}`, expression: `${i} + 1`, result: String(i + 1), mode: "standard", angle: "deg", label: null, created_at: now,
    }));
    localStorage.setItem("calc.history.v1", JSON.stringify(rows));
  });
  await page.reload();
  await expect(page.getByTestId("history-item")).toHaveCount(100);
  await expect(page.getByRole("button", { name: "Show 100 more of 400" })).toBeVisible();

  await page.keyboard.type("6*7");
  const ms = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const list = document.querySelector("ol.tape__list")!;
        const start = performance.now();
        const obs = new MutationObserver(() => {
          if (list.firstElementChild?.textContent?.includes("6 × 7")) {
            obs.disconnect();
            resolve(performance.now() - start);
          }
        });
        obs.observe(list, { childList: true, subtree: true, characterData: true });
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      }),
  );
  expect(ms).toBeLessThan(500);
  await expect(result(page)).toHaveText("42");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("calc.history.v1")!).length);
  expect(stored).toBe(500);
});

test.describe("F4: paste", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("Ctrl/Cmd+V inserts a sanitized plain-text expression", async ({ page }) => {
    await fresh(page);
    await page.evaluate(() => navigator.clipboard.writeText("<img src=x onerror=alert(1)>12*3 + 4"));
    await page.keyboard.press("ControlOrMeta+V");
    await expect(expression(page)).toHaveText("12 × 3 + 4");
    await expect(result(page)).toHaveText("40");
    await expect(page.locator("img")).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(result(page)).toHaveText("40");
  });

  test("pasting continues the current expression and functions work", async ({ page }) => {
    await fresh(page);
    await page.keyboard.type("2+");
    await page.evaluate(() => navigator.clipboard.writeText("sqrt(16)"));
    await page.keyboard.press("ControlOrMeta+V");
    await expect(expression(page)).toHaveText("2 + √(16)");
    await expect(result(page)).toHaveText("6");
  });
});
