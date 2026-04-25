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
  await page.goto("/#alocacao");
  await expect(page.locator(".tela-alocacao")).toBeVisible();
}

test.describe("Tela #alocacao", () => {
  test("mostra 4 classes (EUA, FIIs, Ações BR, Cripto)", async ({ page }) => {
    await autenticar(page);
    const classes = page.locator(".tela-alocacao .classe-row");
    await expect(classes).toHaveCount(4);
  });

  test("clicar em FIIs expande lista de tickers", async ({ page }) => {
    await autenticar(page);
    await page.locator('.tela-alocacao .classe-row[data-classe="FIIs"]').click();
    await expect(
      page.locator('.tela-alocacao .classe-tickers[data-classe="FIIs"]'),
    ).toBeVisible();
  });

  test("clicar em outra classe colapsa a primeira", async ({ page }) => {
    await autenticar(page);
    await page.locator('.tela-alocacao .classe-row[data-classe="FIIs"]').click();
    await page.locator('.tela-alocacao .classe-row[data-classe="EUA"]').click();
    await expect(
      page.locator('.tela-alocacao .classe-tickers[data-classe="FIIs"]'),
    ).not.toBeVisible();
    await expect(
      page.locator('.tela-alocacao .classe-tickers[data-classe="EUA"]'),
    ).toBeVisible();
  });

  test("clicar em ticker dentro da classe navega para #ativo/:ticker", async ({ page }) => {
    await autenticar(page);
    await page.locator('.tela-alocacao .classe-row[data-classe="FIIs"]').click();
    await page
      .locator('.tela-alocacao .classe-tickers[data-classe="FIIs"] a.ticker-row')
      .first()
      .click();
    expect(await page.evaluate(() => location.hash)).toMatch(/^#ativo\//);
  });
});
