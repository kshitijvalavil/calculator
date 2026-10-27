import { expect, test, type Route } from "@playwright/test";
import type { Calculation } from "../../../contract/types";
import { API_PORT, MOCK_SUPABASE } from "../playwright.config";
import { key, result } from "./helpers";

test.use({ baseURL: `http://localhost:${API_PORT}` });

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const USER_ID = "8f0f6c1e-2b7a-4c55-9d63-6a1f2f0c9e11";
const now = () => Math.floor(Date.now() / 1000);
const TOKEN = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: USER_ID, role: "authenticated", is_anonymous: true, exp: now() + 3600 })}.sig`;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

const json = (route: Route, status: number, body?: unknown) =>
  route.fulfill({
    status,
    headers: { ...cors, "Content-Type": "application/json" },
    body: body === undefined ? "" : JSON.stringify(body),
  });

/** Mocks Supabase auth and the "calculate" Edge Function with an in-memory table. */
async function mockBackend(page: import("@playwright/test").Page) {
  const rows: Calculation[] = [
    {
      id: "0b8e5f3c-1111-4a2b-8c3d-000000000001",
      expression: "7 × 6",
      result: "42",
      mode: "standard",
      angle: "deg",
      label: "From the server",
      created_at: new Date(Date.now() - 60_000).toISOString(),
    },
  ];
  const calls: { method: string; path: string; auth: string | null; body: unknown }[] = [];

  await page.route(`${MOCK_SUPABASE}/auth/v1/**`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const user = {
      id: USER_ID,
      aud: "authenticated",
      role: "authenticated",
      is_anonymous: true,
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString(),
    };
    if (new URL(req.url()).pathname.endsWith("/user")) return json(route, 200, user);
    return json(route, 200, {
      access_token: TOKEN,
      token_type: "bearer",
      expires_in: 3600,
      expires_at: now() + 3600,
      refresh_token: "refresh-token",
      user,
    });
  });

  await page.route(`${MOCK_SUPABASE}/functions/v1/calculate/**`, async (route) => {
    const req = route.request();
    const method = req.method();
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const url = new URL(req.url());
    const path = url.pathname.replace("/functions/v1/calculate", "");
    const body = req.postData() ? JSON.parse(req.postData()!) : undefined;
    calls.push({ method, path, auth: await req.headerValue("authorization"), body });

    if ((await req.headerValue("authorization")) !== `Bearer ${TOKEN}`) {
      return json(route, 401, { error: { code: "UNAUTHORIZED", message: "Missing token" } });
    }
    if (method === "POST" && path === "/calculate") {
      if (body.expression === "1 ÷ 0") {
        return json(route, 422, { error: { code: "DIVIDE_BY_ZERO", message: "Can't divide by zero" } });
      }
      // The server is the source of truth: it answers with its own result string.
      const serverResult = body.expression === "2 + 3" ? "5" : body.expression === "1 ÷ 3" ? "0.33333333333333333333" : "SERVER";
      const row: Calculation = {
        id: `0b8e5f3c-1111-4a2b-8c3d-${String(rows.length + 1).padStart(12, "0")}`,
        expression: body.expression,
        result: serverResult,
        mode: body.mode,
        angle: body.angle ?? "deg",
        label: null,
        created_at: new Date().toISOString(),
      };
      rows.unshift(row);
      return json(route, 201, { calculation: row });
    }
    if (method === "GET" && path === "/history") return json(route, 200, { calculations: rows });
    const m = /^\/history\/(.+)$/.exec(path);
    const idx = m ? rows.findIndex((r) => r.id === m[1]) : -1;
    if (m && idx < 0) return json(route, 404, { error: { code: "NOT_FOUND", message: "Not found" } });
    if (method === "PATCH" && m) {
      rows[idx] = { ...rows[idx], label: body.label || null };
      return json(route, 200, { calculation: rows[idx] });
    }
    if (method === "DELETE" && m) {
      rows.splice(idx, 1);
      return route.fulfill({ status: 204, headers: cors });
    }
    return json(route, 404, { error: { code: "NOT_FOUND", message: "Not found" } });
  });

  return { rows, calls };
}

test("API mode signs in anonymously and uses the Edge Function for history", async ({ page }) => {
  const backend = await mockBackend(page);
  await page.goto("/");

  // Server history loads with the bearer token.
  const items = page.getByTestId("history-item");
  await expect(items).toHaveCount(1);
  await expect(items.first().getByTestId("history-label")).toHaveText("From the server");
  await expect(page.getByText("Synced to your account")).toBeVisible();
  expect(backend.calls[0]).toMatchObject({ method: "GET", path: "/history", auth: `Bearer ${TOKEN}` });

  // Saving posts the expression; the saved result is the server's.
  await page.keyboard.type("2+3=");
  await expect(items).toHaveCount(2);
  await expect(items.first().getByTestId("history-result")).toHaveText("= 5");
  expect(backend.calls.find((c) => c.method === "POST")?.body).toEqual({ expression: "2 + 3", mode: "standard", angle: "deg" });

  // A server result that differs from the local preview wins.
  await page.keyboard.type("9-1=");
  await expect(items.first().getByTestId("history-result")).toHaveText("= SERVER");
  await expect(result(page)).toHaveText("SERVER");

  // Label → PATCH
  await page.getByRole("button", { name: "Add label to 2 + 3" }).click();
  await page.getByRole("textbox", { name: "Label for 2 + 3" }).fill("Synced label");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Synced label")).toBeVisible();
  expect(backend.calls.find((c) => c.method === "PATCH")?.body).toEqual({ label: "Synced label" });

  // Delete → DELETE
  await page.getByRole("button", { name: "Delete 7 × 6" }).click();
  await expect(items).toHaveCount(2);
  expect(backend.rows.some((r) => r.expression === "7 × 6")).toBe(false);

  // Reload: history comes back from the server.
  await page.reload();
  await expect(items).toHaveCount(2);
  await expect(page.getByText("Synced label")).toBeVisible();
});

test("API mode: errors are not sent, and a failing server shows a notice", async ({ page }) => {
  const backend = await mockBackend(page);
  await page.goto("/");
  await expect(page.getByTestId("history-item")).toHaveCount(1);

  await page.keyboard.type("1/0=");
  await expect(result(page)).toHaveText("Can't divide by zero");
  expect(backend.calls.filter((c) => c.method === "POST")).toHaveLength(0);

  await page.route(`${MOCK_SUPABASE}/functions/v1/calculate/calculate`, (route) =>
    route.request().method() === "OPTIONS"
      ? route.fulfill({ status: 204, headers: cors })
      : json(route, 500, { error: { code: "INTERNAL", message: "boom" } }),
  );
  await key(page, "all clear").click();
  await page.keyboard.type("1/3=");
  await expect(result(page)).toHaveText("0.33333333333333333333");
  await expect(page.getByRole("alert")).toContainText("Couldn't save to history");
});
