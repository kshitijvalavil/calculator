import { expect, test } from "@playwright/test";
import { expression, key, result } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("history: save, label, reuse and delete persist across reloads (local mode)", async ({ page }) => {
  await page.keyboard.type("2+3=");
  await page.keyboard.type("10/4=");
  const items = page.getByTestId("history-item");
  await expect(items).toHaveCount(2);
  // Newest first, printed like a receipt.
  await expect(items.nth(0).getByTestId("history-result")).toHaveText("= 2.5");
  await expect(items.nth(1).getByTestId("history-result")).toHaveText("= 5");
  await expect(page.getByText("Saved on this device")).toBeVisible();

  // Label
  await page.getByRole("button", { name: "Add label to 2 + 3" }).click();
  await page.getByRole("textbox", { name: "Label for 2 + 3" }).fill("Coffee run");
  await page.keyboard.press("Enter");
  await expect(items.nth(1).getByTestId("history-label")).toHaveText("Coffee run");

  await page.reload();
  await expect(items).toHaveCount(2);
  await expect(items.nth(1).getByTestId("history-label")).toHaveText("Coffee run");

  // Edit the label
  await page.getByRole("button", { name: "Edit label for 2 + 3" }).click();
  await page.getByRole("textbox", { name: "Label for 2 + 3" }).fill("Coffee for the team");
  await page.getByRole("button", { name: "Save label" }).click();
  await expect(items.nth(1).getByTestId("history-label")).toHaveText("Coffee for the team");

  // Reuse the result inside a new expression
  await page.keyboard.type("4*");
  await page.getByRole("button", { name: "Reuse result 5" }).click();
  await expect(expression(page)).toHaveText("4 × 5");
  await expect(result(page)).toHaveText("20");

  // Reuse the expression
  await page.getByRole("button", { name: "Reuse expression 10 ÷ 4" }).click();
  await expect(expression(page)).toHaveText("10 ÷ 4");
  await key(page, "equals").click();
  await expect(items).toHaveCount(3);

  // Delete
  await page.getByRole("button", { name: "Delete 2 + 3" }).click();
  await expect(items).toHaveCount(2);
  await expect(page.getByText("Coffee for the team")).toHaveCount(0);

  await page.reload();
  await expect(items).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Delete 2 + 3" })).toHaveCount(0);
});

test("scientific entries remember their angle unit", async ({ page }) => {
  await page.getByRole("button", { name: "Scientific", exact: true }).click();
  await key(page, "radians").click();
  await key(page, "cosine").click();
  await key(page, "0").click();
  await key(page, "equals").click();
  const item = page.getByTestId("history-item").first();
  await expect(item).toContainText("RAD");
  await expect(item.getByTestId("history-result")).toHaveText("= 1");

  // Reusing it in degree mode switches back to radians.
  await key(page, "degrees").click();
  await page.getByRole("button", { name: "Standard", exact: true }).click();
  await page.getByRole("button", { name: "Reuse expression cos(0)" }).click();
  await expect(key(page, "radians")).toHaveAttribute("aria-pressed", "true");
});
