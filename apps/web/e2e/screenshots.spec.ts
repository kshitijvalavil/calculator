import { test, type Page } from "@playwright/test";
import { key, setMode } from "./helpers";

// Run with SCREENSHOTS=1 to refresh the design screenshots in apps/web/screenshots/.
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to capture");

async function stage(page: Page, mobile = false) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.keyboard.type("1280*0.15=");
  if (mobile) await page.getByRole("button", { name: /Open history/ }).click();
  await page.getByRole("button", { name: "Add label to 1280 × 0.15" }).click();
  await page.getByRole("textbox", { name: "Label for 1280 × 0.15" }).fill("Tip for the team");
  await page.keyboard.press("Enter");
  if (mobile) await page.getByRole("button", { name: "Close history" }).click();
  await page.keyboard.type("2^10=");
  await page.keyboard.type("1/3=");
  await page.keyboard.press("Escape");
}

for (const scheme of ["light", "dark"] as const) {
  test(`desktop ${scheme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await stage(page);
    await setMode(page, "Scientific");
    await key(page, "square root").click();
    await page.keyboard.type("2+");
    await key(page, "pi").click();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(300); // let the key-press flash settle
    await page.screenshot({ path: `screenshots/desktop-${scheme}.png`, fullPage: true });
  });
}

test("mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await stage(page, true);
  await page.keyboard.type("1234.5*12-");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(300);
  await page.screenshot({ path: "screenshots/mobile.png", fullPage: true });
});

test("mobile history sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await stage(page, true);
  await page.getByRole("button", { name: /Open history/ }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "screenshots/mobile-history-dark.png" });
});
