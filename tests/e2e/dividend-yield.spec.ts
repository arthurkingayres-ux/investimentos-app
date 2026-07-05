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

// 7a.S.7b: o Dividend Yield saiu do topo de #proventos (bloco inline
// removido) e virou tela dedicada #s-dy, aberta pela chamada
// `[data-testid="dy-chamada"]`. Os 4 escopos (total/acao_br/fii/eua) seguem
// os MESMOS dados — só reformatados como poster + 3 dy-row.

test.describe("#proventos → chamada Dividend Yield", () => {
  test("chamada mostra o DY da carteira e navega para #s-dy", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#proventos");
    await expect(page.locator(".tela-proventos")).toBeVisible({ timeout: 10_000 });

    const chamada = page.getByTestId("dy-chamada");
    await expect(chamada).toBeVisible();
    await expect(chamada).toContainText("%");

    await chamada.click();
    await expect(page).toHaveURL(/#\/proventos\/dy$/);
    await expect(page.locator(".tela-dy")).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("#s-dy — os 4 escopos de Dividend Yield (dados preservados)", () => {
  test.beforeEach(async ({ page }) => {
    await autenticar(page);
    await page.goto("/#/proventos/dy");
    await expect(page.locator(".tela-dy")).toBeVisible({ timeout: 10_000 });
  });

  test("renderiza o poster (total) + 3 linhas por classe (acao_br/fii/eua)", async ({ page }) => {
    await expect(page.locator(".poster")).toBeVisible();
    await expect(page.locator(".dy-row")).toHaveCount(3);
  });

  test("EUA marcado como USD", async ({ page }) => {
    const linhaEua = page.locator(".dy-row", { hasText: "EUA" });
    await expect(linhaEua).toContainText("USD");
  });

  test("valores DY no formato pt-BR com %", async ({ page }) => {
    await expect(page.locator(".poster")).toContainText("%");
    const valores = page.locator(".dy-row .yv");
    await expect(valores).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      await expect(valores.nth(i)).toContainText("%");
    }
  });
});
