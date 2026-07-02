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
  // Isola do artefato de produção: o relatorios_index.json.enc real é cifrado
  // com o PIN de prod (≠ 123456) e o PBKDF2 de PIN-errado alargava a race do
  // Test 3. Servimos 404 — o carregarIndiceRelatorios cai no catch e segue.
  await page.route("**/relatorios_index.json.enc", (route) =>
    route.fulfill({ status: 404, body: "", contentType: "text/plain" }),
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
    // Sliding window: timestamp foi refrescado para perto de agora. expect.poll
    // absorve o timing residual (o refresh agora ocorre logo após a fase virar
    // raiox, mas ainda num microtask).
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            Number(localStorage.getItem("pinTimestamp") || 0),
          ),
        { timeout: 5_000 },
      )
      .toBeGreaterThan(originalTs + 60_000);
  });
});
