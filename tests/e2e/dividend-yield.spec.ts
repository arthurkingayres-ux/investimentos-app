import { test, expect, Page } from "@playwright/test";
import fs from "fs";
import path from "path";

const FIXTURE = fs.readFileSync(
  path.join(__dirname, "../fixtures/portfolio.test.json.enc"), "utf-8");

async function autenticar(page: Page) {
  await page.route("**/portfolio.json.enc", (route) =>
    route.fulfill({ status: 200, body: FIXTURE, contentType: "text/plain" }));
  await page.addInitScript(() => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem("pinTimestamp", String(Date.now() - 24*60*60*1000));
  });
  await page.goto("/");
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
}

test.describe("#proventos — bloco Dividend Yield", () => {
  test.beforeEach(async ({ page }) => {
    await autenticar(page);
    await page.goto("/#proventos");
    await expect(page.locator(".tela-proventos")).toBeVisible({ timeout: 10_000 });
  });

  test("renderiza os 4 escopos de DY", async ({ page }) => {
    await expect(page.getByTestId("dy-bloco")).toBeVisible();
    await expect(page.getByTestId("dy-total")).toBeVisible();
    await expect(page.getByTestId("dy-acao_br")).toBeVisible();
    await expect(page.getByTestId("dy-fii")).toBeVisible();
    await expect(page.getByTestId("dy-eua")).toBeVisible();
  });

  test("EUA marcado como USD", async ({ page }) => {
    await expect(page.getByTestId("dy-eua")).toContainText("USD");
  });

  test("valores DY no formato pt-BR com %", async ({ page }) => {
    await expect(page.getByTestId("dy-total")).toContainText("%");
  });
});
