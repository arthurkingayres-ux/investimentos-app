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

test.describe("Raio-X 1-viewport (7a.I.3)", () => {
  test("sparkline 12m renderiza sob o hero", async ({ page }) => {
    await autenticar(page);
    const spark = page.locator(".raiox-sparkline");
    await expect(spark).toBeVisible();
    // ECharts injeta um <canvas> ou <svg> dentro do container.
    const hasCanvas = await spark.locator("canvas, svg").count();
    expect(hasCanvas).toBeGreaterThan(0);
  });

  test("4 chips (rent/aloca/prov/política) presentes na ordem", async ({ page }) => {
    await autenticar(page);
    const chips = page.locator(".chips-stat-bloco .chip-stat");
    await expect(chips).toHaveCount(4);
    await expect(chips.nth(0)).toContainText(/rent/i);
    await expect(chips.nth(1)).toContainText(/aloca/i);
    await expect(chips.nth(2)).toContainText(/prov/i);
    await expect(chips.nth(3)).toContainText(/pol[ií]tica/i);
  });

  test("bloco Último aporte continua visível", async ({ page }) => {
    await autenticar(page);
    const aporte = page.locator(".aporte-bloco");
    await expect(aporte).toBeVisible();
    // Label uppercase em vez de h2 grande.
    await expect(aporte.locator(".aporte-label")).toBeVisible();
  });

  test("CTA pill 'Planejar próximo aporte' linka para #aportar", async ({ page }) => {
    await autenticar(page);
    const cta = page.locator(".aporte-cta");
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("href", "#aportar");
  });
});
