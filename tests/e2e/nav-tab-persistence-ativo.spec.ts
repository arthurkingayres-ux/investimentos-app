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

async function abrirPrimeiroTicker(page: Page) {
  // Navegar diretamente para #alocacao (clicar a tab dispara overlap com .rodape em
  // viewport mobile do Pixel 7; #alocacao seta rota=alocacao + tab=aloca via atualizarRota).
  await page.goto("/#alocacao");
  await expect(page.locator(".tela-alocacao")).toBeVisible({ timeout: 5_000 });
  // 7a.E.31: vista única — expandir o primeiro card de categoria e clicar o
  // primeiro ativo (push para #ativo/:ticker).
  const cards = page.locator(".tela-alocacao .aloca-cat");
  const total = await cards.count();
  for (let i = 0; i < total; i++) {
    await cards.nth(i).locator(".aloca-cat__head").click();
    const ativo = cards.nth(i).locator(".aloca-alvo__ativo").first();
    try {
      await expect(ativo).toBeVisible({ timeout: 1_500 });
      await ativo.click();
      return;
    } catch {
      continue;
    }
  }
  throw new Error("Nenhuma categoria na fixture tem ativo — ajustar fixture");
}

test.describe("Tab bar persiste em push #ativo/:ticker (7a.I.7)", () => {
  test("navegar Aloca → ticker mantém tab bar e aria-current=aloca", async ({ page }) => {
    await autenticar(page);
    await abrirPrimeiroTicker(page);
    await expect(page).toHaveURL(/#ativo\//);
    await expect(page.locator(".tela-ativo")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".tab-bar")).toBeVisible();
    await expect(
      page.locator('.tab-bar a[data-tab="aloca"]'),
    ).toHaveAttribute("aria-current", "page");
  });

  test("breadcrumb back de #ativo (aberto em Aloca) volta para Alocação, nunca Raio-X", async ({ page }) => {
    // voltar() deve retornar para a HOME da seção de origem (preservada em
    // `this.tab`), nunca pular para a Raio-X a partir de outra seção.
    await autenticar(page);
    await abrirPrimeiroTicker(page);
    await expect(page.locator(".tela-ativo")).toBeVisible({ timeout: 5_000 });
    await page.locator(".tela-ativo .breadcrumb button").click();
    await expect(page.locator(".tela-alocacao")).toBeVisible();
    await expect(page.locator(".raiox")).toBeHidden();
    await expect(page.locator(".tab-bar")).toBeVisible();
    await expect(
      page.locator('.tab-bar a[data-tab="aloca"]'),
    ).toHaveAttribute("aria-current", "page");
  });

  test("breadcrumb back de #ativo (aberto em Proventos) volta para Proventos, nunca Raio-X", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#proventos");
    await expect(page.locator(".tela-proventos")).toBeVisible({ timeout: 5_000 });
    await page.locator(".tela-proventos .row-link").first().click();
    await expect(page).toHaveURL(/#ativo\//);
    await expect(page.locator(".tela-ativo")).toBeVisible({ timeout: 5_000 });
    await page.locator(".tela-ativo .breadcrumb button").click();
    await expect(page.locator(".tela-proventos")).toBeVisible();
    await expect(page.locator(".raiox")).toBeHidden();
    await expect(
      page.locator('.tab-bar a[data-tab="provent"]'),
    ).toHaveAttribute("aria-current", "page");
  });

  test("breadcrumb back de #ativo (aberto em Raio-X) volta para Raio-X", async ({ page }) => {
    // Quando a seção de origem É a Raio-X (ex.: último aporte), back retorna lá.
    await autenticar(page);
    await page.locator(".aporte-item-link").first().click();
    await expect(page).toHaveURL(/#ativo\//);
    await expect(page.locator(".tela-ativo")).toBeVisible({ timeout: 5_000 });
    await page.locator(".tela-ativo .breadcrumb button").click();
    await expect(page.locator(".raiox")).toBeVisible();
    await expect(
      page.locator('.tab-bar a[data-tab="raiox"]'),
    ).toHaveAttribute("aria-current", "page");
  });

  test("clicar tab Raio-X dentro de #ativo navega de volta + troca aria-current", async ({ page }) => {
    await autenticar(page);
    await abrirPrimeiroTicker(page);
    await expect(page.locator(".tela-ativo")).toBeVisible({ timeout: 5_000 });
    await page.locator('.tab-bar a[data-tab="raiox"]').click();
    await expect(page.locator(".raiox")).toBeVisible();
    await expect(
      page.locator('.tab-bar a[data-tab="raiox"]'),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.locator('.tab-bar a[data-tab="aloca"]'),
    ).not.toHaveAttribute("aria-current", "page");
  });
});
