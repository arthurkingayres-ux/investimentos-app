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

test.describe("Navegacao hash routing", () => {
  test("hash invalido cai em raio-x e limpa hash da URL", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#hashinvalido");
    await expect(page.locator(".raiox")).toBeVisible();
    expect(await page.evaluate(() => location.hash)).toBe("");
  });

  test("history.back() respeita hash entre rotas", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#rentabilidade");
    await page.goto("/#alocacao");
    await page.goBack();
    await expect(page.locator(".tela-rentabilidade")).toBeVisible();
    expect(await page.evaluate(() => location.hash)).toBe("#rentabilidade");
  });

  test("reload em #alocacao mantem rota", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#alocacao");
    await page.reload();
    await expect(page.locator(".tela-alocacao")).toBeVisible();
  });

  // 7a.I.3: o raio-x perdeu os cards embed de Rentabilidade/Alocação/Proventos
  // (substituídos por chip-stats inline + sparkline + CTA pill). Protections
  // legadas — "raio-x sem coluna vs", "raio-x sem YTD/12m", "raio-x aloca
  // sem '+'" — removidas: o estado que elas protegiam não existe mais.
  // Cobertura nova do chip-stat vive em raiox-viewport.spec.ts.

  test("hash #proventos é rota válida (não cai no fallback do Raio-X)", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#proventos");
    await expect(page.locator(".tela-proventos")).toBeVisible({ timeout: 10_000 });
    expect(page.url()).toMatch(/#proventos$/);
  });

  test("hash #patrimonio é rota válida (não cai no fallback do Raio-X)", async ({ page }) => {
    // 7a.I.5: `#patrimonio` virou shim push child de raiox; URL final é `#/raiox/chart`.
    await autenticar(page);
    await page.goto("/#patrimonio");
    await expect(page.locator(".tela-patrimonio")).toBeVisible({ timeout: 10_000 });
    expect(page.url()).toMatch(/#\/raiox\/chart$/);
  });
});
