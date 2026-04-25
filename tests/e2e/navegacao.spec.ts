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

  test("botao Voltar leva de #rentabilidade para raio-x", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#rentabilidade");
    await expect(page.locator(".tela-rentabilidade")).toBeVisible();
    await page
      .locator('.tela-rentabilidade button[aria-label="Voltar"]')
      .click();
    await expect(page.locator(".raiox")).toBeVisible();
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

  test("raio-x mostra benchmark com prefixo 'vs' e travessão em Ano/12m", async ({ page }) => {
    await autenticar(page);
    // Garantir que estamos no raio-x (rota default).
    await expect(page.locator(".raiox")).toBeVisible();

    // Pegar a primeira linha de benchmark do escopo Total.
    const benchmarks = page.locator(".raiox .rent-benchmark");
    await expect(benchmarks.first()).toBeVisible();

    // Label deve começar com "vs " e ser uma string com peso visível.
    const primeiroLabel = benchmarks.first().locator(".bench-label");
    await expect(primeiroLabel).toContainText("vs ");

    // 4 spans diretos: label, valor (col Origem), travessão (col Ano), travessão (col 12m).
    const spansDaPrimeira = benchmarks.first().locator(":scope > span");
    await expect(spansDaPrimeira).toHaveCount(4);

    // As duas células finais devem ser travessões.
    await expect(spansDaPrimeira.nth(2)).toHaveText("—");
    await expect(spansDaPrimeira.nth(3)).toHaveText("—");
  });
});
