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

test.describe("PIN flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await mockPortfolio(page);
  });

  test("PIN de 6 digitos correto -> raio-x", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".pin-screen")).toBeVisible();
    await page.locator("input.pin-input").fill("123456");
    await page.locator("button.pin-submit").click();
    await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
  });

  test("PIN com menos de 6 digitos -> botao desabilitado", async ({ page }) => {
    await page.goto("/");
    await page.locator("input.pin-input").fill("12345");
    await expect(page.locator("button.pin-submit")).toBeDisabled();
    await expect(page.locator(".pin-screen")).toBeVisible();
  });

  test("PIN errado -> mensagem + aba continua em PIN", async ({ page }) => {
    await page.goto("/");
    await page.locator("input.pin-input").fill("999999");
    await page.locator("button.pin-submit").click();
    await expect(page.locator(".pin-error")).toContainText("PIN incorreto", {
      timeout: 5_000,
    });
    await expect(page.locator(".pin-screen")).toBeVisible();
  });

  test("5 erros consecutivos -> bloqueio 5 min persistido em localStorage", async ({
    page,
  }) => {
    await page.goto("/");
    for (let i = 0; i < 5; i++) {
      await page.locator("input.pin-input").fill("999999");
      await page.locator("button.pin-submit").click();
      await page.waitForTimeout(150);
    }
    const until = await page.evaluate(() =>
      Number(localStorage.getItem("pinBlockUntil") || 0),
    );
    const agora = Date.now();
    expect(until - agora).toBeGreaterThan(4 * 60_000);
    expect(until - agora).toBeLessThan(6 * 60_000);
    const fails = await page.evaluate(() =>
      Number(localStorage.getItem("pinFails") || 0),
    );
    expect(fails).toBe(5);
  });

  test("PIN correto apos erros reseta contador pinFails", async ({ page }) => {
    await page.goto("/");
    for (let i = 0; i < 3; i++) {
      await page.locator("input.pin-input").fill("999999");
      await page.locator("button.pin-submit").click();
      await page.waitForTimeout(150);
    }
    await page.locator("input.pin-input").fill("123456");
    await page.locator("button.pin-submit").click();
    await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
    const fails = await page.evaluate(() => localStorage.getItem("pinFails"));
    expect(fails).toBeNull();
  });
});
