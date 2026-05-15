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

async function autenticar(page: Page) {
  await mockPortfolio(page);
  await page.addInitScript(() => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem(
      "pinTimestamp",
      String(Date.now() - 1 * 24 * 60 * 60 * 1000),
    );
  });
  await page.goto("/");
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
}

test.describe("Raio-X enxuto (apenas hero + último aporte)", () => {
  test("hero patrimônio visível com valor", async ({ page }) => {
    await autenticar(page);
    const hero = page.locator(".hero.hero-link");
    await expect(hero).toBeVisible();
    await expect(page.locator("#hero-patrimonio")).toBeVisible();
  });

  test("bloco Último aporte visível", async ({ page }) => {
    await autenticar(page);
    const aporte = page.locator(".aporte-bloco");
    await expect(aporte).toBeVisible();
    await expect(aporte.locator(".aporte-label")).toBeVisible();
  });

  test("sparkline removido", async ({ page }) => {
    await autenticar(page);
    await expect(page.locator(".raiox-sparkline")).toHaveCount(0);
  });

  test("chips-stat-bloco removido", async ({ page }) => {
    await autenticar(page);
    await expect(page.locator(".chips-stat-bloco")).toHaveCount(0);
  });

  test("CTA 'Planejar próximo aporte' removido", async ({ page }) => {
    await autenticar(page);
    await expect(page.locator(".aporte-cta")).toHaveCount(0);
  });
});
