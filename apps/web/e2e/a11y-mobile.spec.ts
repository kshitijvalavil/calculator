import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { key, noHorizontalScroll, result, setMode } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

async function scan(page: Page) {
  const { violations } = await new AxeBuilder({ page } as unknown as ConstructorParameters<typeof AxeBuilder>[0]).withTags(TAGS).analyze();
  const summary = violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  expect(summary).toEqual([]);
}

async function populate(page: Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.keyboard.type("2+3=");
  await page.getByRole("button", { name: "Add label to 2 + 3" }).click();
  await page.getByRole("textbox", { name: "Label for 2 + 3" }).fill("Groceries");
  await page.keyboard.press("Enter");
  await page.keyboard.type("1/0");
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`axe, ${scheme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    });

    test("standard mode with history and an error has no violations", async ({ page }) => {
      await populate(page);
      await expect(result(page)).toHaveText("Can't divide by zero");
      await scan(page);
    });

    test("scientific mode and label editing have no violations", async ({ page }) => {
      await populate(page);
      await setMode(page, "Scientific");
      await key(page, "sine").click();
      await page.getByRole("button", { name: "Edit label for 2 + 3" }).click();
      await scan(page);
    });

    test("mobile history sheet has no violations", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/");
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await page.keyboard.type("2+3=");
      await page.getByRole("button", { name: /Open history/ }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByRole("button", { name: "Add label to 2 + 3" }).click();
      await page.getByRole("textbox", { name: "Label for 2 + 3" }).fill("Groceries");
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("history-label")).toHaveText("Groceries");
      await scan(page);
    });
  });
}

test("manual theme toggle (light → dark) also passes axe", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await populate(page);
  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await scan(page);
});

test.describe("mobile 390×844", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("no horizontal scroll, large touch targets, history as a sheet", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await noHorizontalScroll(page);

    for (const name of ["7", "equals", "all clear", "divide"]) {
      const box = await key(page, name).boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }

    // A very long result must not push the page sideways.
    await key(page, "9").click();
    for (let i = 0; i < 25; i++) await key(page, "9").click();
    await key(page, "multiply").click();
    for (let i = 0; i < 20; i++) await key(page, "9").click();
    await key(page, "equals").click();
    await noHorizontalScroll(page);

    await setMode(page, "Scientific");
    await expect(key(page, "square root")).toBeVisible();
    const sqrt = await key(page, "square root").boundingBox();
    expect(sqrt!.height).toBeGreaterThanOrEqual(44);
    await noHorizontalScroll(page);

    // History is a sheet on mobile; the side panel is not shown.
    await expect(page.getByRole("complementary", { name: "History panel" })).toHaveCount(0);
    await page.getByRole("button", { name: /Open history/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("history-item")).toHaveCount(1);
    await noHorizontalScroll(page);
    await dialog.getByRole("button", { name: /Reuse result/ }).click();
    await expect(dialog).toHaveCount(0);
  });
});
