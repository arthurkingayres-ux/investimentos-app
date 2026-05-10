import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

const FIXTURE = fs.readFileSync(
  path.join(__dirname, "../fixtures/portfolio.test.json.enc"),
  "utf-8",
);

async function autenticar(page: Page) {
  await page.route("**/portfolio.json.enc", (route) =>
    route.fulfill({ status: 200, body: FIXTURE, contentType: "text/plain" }),
  );
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

test.describe("Responsive em viewports estreitos (7a.G.2)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await autenticar(page);
  });

  test("proventos kpi-grid-3 stacks em 1 coluna com 320px", async ({ page }) => {
    await page.goto("/#proventos");
    await expect(page.locator(".kpi-grid-3").first()).toBeVisible({
      timeout: 5_000,
    });

    const cols = await page.evaluate(() => {
      const grid = document.querySelector(".kpi-grid-3");
      if (!grid) return 0;
      return getComputedStyle(grid as Element).gridTemplateColumns.split(" ")
        .length;
    });
    expect(cols).toBe(1);

    // kpi-grid-3 não pode estourar a viewport (era 377 em viewport 320 antes do fix)
    const gridRight = await page.evaluate(() => {
      const grid = document.querySelector(".kpi-grid-3");
      if (!grid) return 0;
      return Math.round(grid.getBoundingClientRect().right);
    });
    expect(gridRight).toBeLessThanOrEqual(320);
  });
});
