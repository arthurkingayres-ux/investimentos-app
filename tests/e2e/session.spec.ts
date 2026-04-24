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

test.describe("Sessao", () => {
  test("auto-resume com sessao valida (<7d) -> raio-x direto", async ({ page }) => {
    await mockPortfolio(page);
    await page.addInitScript(() => {
      localStorage.setItem("pin", "123456");
      localStorage.setItem(
        "pinTimestamp",
        String(Date.now() - 3 * 24 * 60 * 60 * 1000),
      );
    });
    await page.goto("/");
    await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
  });

  test("sessao > 7d -> volta para PIN + limpa credencial do localStorage", async ({
    page,
  }) => {
    await mockPortfolio(page);
    await page.addInitScript(() => {
      localStorage.setItem("pin", "123456");
      localStorage.setItem(
        "pinTimestamp",
        String(Date.now() - 8 * 24 * 60 * 60 * 1000),
      );
    });
    await page.goto("/");
    await expect(page.locator(".pin-screen")).toBeVisible();
    const pin = await page.evaluate(() => localStorage.getItem("pin"));
    expect(pin).toBeNull();
  });

  test("janela 7d DESLIZANTE: auto-resume refresca pinTimestamp", async ({
    page,
  }) => {
    await mockPortfolio(page);
    const originalTs = Date.now() - 2 * 24 * 60 * 60 * 1000;
    await page.addInitScript((ts) => {
      localStorage.setItem("pin", "123456");
      localStorage.setItem("pinTimestamp", String(ts));
    }, originalTs);
    await page.goto("/");
    await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
    const novoTs = await page.evaluate(() =>
      Number(localStorage.getItem("pinTimestamp") || 0),
    );
    // Sliding window: timestamp foi refrescado para perto de agora.
    expect(novoTs).toBeGreaterThan(originalTs + 60_000);
  });
});
