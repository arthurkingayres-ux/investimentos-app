import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

const FIXTURE = fs.readFileSync(
  path.join(__dirname, "../fixtures/portfolio.test.json.enc"),
  "utf-8",
);

async function mockPortfolio(page: Page) {
  await page.route("**/portfolio.json.enc", (route) =>
    route.fulfill({ status: 200, body: FIXTURE, contentType: "text/plain" }),
  );
}

test.describe("Toast de atualizacao", () => {
  test("atualizado_em novo vs. cache -> toast verde 'Carteira atualizada'", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem("atualizadoEm", "2026-04-10T09:00:00");
    });
    await mockPortfolio(page);
    await page.goto("/");
    await page.locator("input.pin-input").fill("123456");
    await page.locator("button.pin-submit").click();
    await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Carteira atualizada/)).toBeVisible({
      timeout: 4_000,
    });
  });

  test("mesmo atualizado_em -> sem toast verde", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("atualizadoEm", "2026-04-24T15:00:00");
    });
    await mockPortfolio(page);
    await page.goto("/");
    await page.locator("input.pin-input").fill("123456");
    await page.locator("button.pin-submit").click();
    await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1_500);
    await expect(page.getByText(/Carteira atualizada/)).toHaveCount(0);
  });
});
