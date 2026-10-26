import { expect, test } from "@playwright/test";
import { cases, clickThrough, expression, key, result, setMode } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test.describe("contract cases, clicked on the keypad", () => {
  for (const c of cases.filter((c) => c.result !== undefined)) {
    test(`${c.expression}${c.angle ? ` [${c.angle}]` : ""} = ${c.result}`, async ({ page }) => {
      await clickThrough(page, c);
      await expect(result(page)).toHaveText(c.result!);
      await expect(result(page)).toHaveAttribute("data-state", "final");
    });
  }
});

test.describe("errors show friendly text", () => {
  test("1 ÷ 0 shows the divide-by-zero message", async ({ page }) => {
    await key(page, "1").click();
    await key(page, "divide").click();
    await key(page, "0").click();
    await expect(result(page)).toHaveText("Can't divide by zero");
    await key(page, "equals").click();
    await expect(result(page)).toHaveText("Can't divide by zero");
    await expect(result(page)).toHaveAttribute("data-state", "error");
    // Nothing is saved for an error.
    await expect(page.getByTestId("history-item")).toHaveCount(0);
  });

  const friendly: Record<string, string> = {
    DIVIDE_BY_ZERO: "Can't divide by zero",
    DOMAIN: "That's outside this function's range",
    OVERFLOW: "Too large to calculate",
  };
  for (const c of cases.filter((c) => c.error && friendly[c.error])) {
    test(`${c.expression} → ${c.error}`, async ({ page }) => {
      await clickThrough(page, c);
      await expect(result(page)).toHaveText(friendly[c.error!]);
    });
  }

  test("an unfinished expression explains itself on =", async ({ page }) => {
    await page.keyboard.type("2+");
    await page.keyboard.press("Enter");
    await expect(result(page)).toHaveText("That expression isn't finished");
  });
});

test.describe("keyboard only", () => {
  test("types a calculation and evaluates with Enter", async ({ page }) => {
    await page.keyboard.type("12.5*4-(3/2)");
    await expect(expression(page)).toHaveText("12.5 × 4 − (3 ÷ 2)");
    await expect(result(page)).toHaveText("48.5");
    await page.keyboard.press("Enter");
    await expect(result(page)).toHaveText("48.5");
    await expect(result(page)).toHaveAttribute("data-state", "final");
  });

  test("Backspace, Escape, %, ^ and = work", async ({ page }) => {
    await page.keyboard.type("2^10");
    await expect(result(page)).toHaveText("1024");
    await page.keyboard.press("Backspace");
    await expect(result(page)).toHaveText("2");
    await page.keyboard.press("Escape");
    await expect(result(page)).toHaveText("0");
    await page.keyboard.type("200*15%=");
    await expect(result(page)).toHaveText("30");
    await page.keyboard.type("+5=");
    await expect(result(page)).toHaveText("35");
  });

  test("auto-closes parentheses before evaluating", async ({ page }) => {
    await page.keyboard.type("(2+3*(4");
    await page.keyboard.press("Enter");
    await expect(expression(page)).toHaveText("(2 + 3 × (4)) =");
    await expect(result(page)).toHaveText("14");
  });

  test("Tab reaches the keys with a visible focus ring, and Enter presses them", async ({ page }) => {
    const seven = key(page, "7");
    for (let i = 0; i < 40 && !(await seven.evaluate((el) => el === document.activeElement)); i++) {
      await page.keyboard.press("Tab");
    }
    await expect(seven).toBeFocused();
    const outline = await seven.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe("none");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect(expression(page)).toHaveText("77");
    await page.keyboard.type("+3");
    await page.keyboard.press("=");
    await expect(result(page)).toHaveText("80");
  });

  test("Enter evaluates even after a key was clicked with the mouse", async ({ page }) => {
    await key(page, "4").click();
    await key(page, "plus").click();
    await key(page, "4").click();
    await page.keyboard.press("Enter");
    await expect(result(page)).toHaveText("8");
    await expect(result(page)).toHaveAttribute("data-state", "final");
  });
});

test.describe("scientific mode", () => {
  test("toggle reveals the panel, and deg/rad changes trig results", async ({ page }) => {
    await expect(key(page, "sine")).toHaveCount(0);
    await setMode(page, "Scientific");
    await expect(page.getByRole("group", { name: "Scientific functions" })).toBeVisible();
    await expect(key(page, "degrees")).toHaveAttribute("aria-pressed", "true");

    await key(page, "sine").click();
    await key(page, "9").click();
    await key(page, "0").click();
    await key(page, "equals").click();
    await expect(expression(page)).toHaveText("sin(90) =");
    await expect(result(page)).toHaveText("1");

    await key(page, "radians").click();
    await key(page, "all clear").click();
    await key(page, "cosine").click();
    await key(page, "pi").click();
    await key(page, "equals").click();
    await expect(result(page)).toHaveText("-1");

    await setMode(page, "Standard");
    await expect(key(page, "sine")).toHaveCount(0);
    // The choice survives a reload.
    await setMode(page, "Scientific");
    await page.reload();
    await expect(key(page, "sine")).toBeVisible();
  });
});

test.describe("display", () => {
  test("long numbers shrink and never overflow the card", async ({ page }) => {
    await page.keyboard.type("123456789*987654321*123456789=");
    const box = await page.locator(".display").boundingBox();
    const out = await result(page).boundingBox();
    expect(out!.x + out!.width).toBeLessThanOrEqual(box!.x + box!.width);
    await expect(result(page)).toHaveClass(/result--(sm|xs)/);
  });

  test("theme toggle switches and persists", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.getByTestId("theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe("rgb(16, 18, 25)");
  });
});
