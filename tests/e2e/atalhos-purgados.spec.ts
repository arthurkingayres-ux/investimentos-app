import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

// Fase 7a.CE — purga dos atalhos duplicados. A 7a.CC deu a cada tela um lugar
// na barra e na faixa; os atalhos que só repetiam esse caminho saíram. Este
// arquivo trava a ausência de cinco deles. O sexto (a variante genérica
// "Registros do Comitê", sem contagem) é travado em comite-resposta.spec.ts.
// Cada ausência vem depois de uma âncora positiva da própria tela, para que
// uma tela que não carregou não passe por motivo errado.

const FIXTURE = fs.readFileSync(path.join(__dirname, "../fixtures/portfolio.test.json.enc"), "utf-8");

test.use({ viewport: { width: 390, height: 844 } });

async function autenticar(page: Page) {
  await page.route("**/portfolio.json.enc", (r) => r.fulfill({ status: 200, body: FIXTURE, contentType: "text/plain" }));
  await page.addInitScript(() => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem("pinTimestamp", String(Date.now() - 86_400_000));
  });
  await page.goto("/");
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
}

test.describe("7a.CE — atalhos duplicados não existem mais", () => {
  test("Hoje: sem o 'Ver histórico' abaixo do hero", async ({ page }) => {
    await autenticar(page);
    const raiox = page.locator("section.raiox");
    await expect(raiox.locator(".hero")).toBeVisible();
    await expect(raiox.locator(".hero-chart-link")).toHaveCount(0);
    await expect(raiox.locator('a[href="#/raiox/chart"]')).toHaveCount(0);
  });

  test("Proventos: sem o cartão de chamada do Dividend Yield", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#proventos");
    const tela = page.locator(".tela-proventos");
    await expect(tela.locator(".kpi-grid")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("dy-chamada")).toHaveCount(0);
    await expect(tela.locator(".dy-chamada")).toHaveCount(0);
  });

  test("Projeção: sem o link cruzado para a Renda", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#/raiox/projecao");
    await expect(page.locator(".tela-projecao .proj-ensaio")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".renda-link")).toHaveCount(0);
  });

  test("Renda: sem o link cruzado para a Projeção", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#/raiox/renda");
    await expect(page.locator(".tela-renda .renda-ensaio")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".renda-link")).toHaveCount(0);
  });

  test("ativo inexistente: sem link próprio de volta, o '←' do cabeçalho fica", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#ativo/FOO3");
    const tela = page.locator(".tela-ativo");
    await expect(tela.locator(".erro-nao-encontrado")).toContainText("FOO3");
    await expect(tela.locator(".erro-nao-encontrado a")).toHaveCount(0);
    await expect(tela.getByRole("button", { name: "Voltar" })).toBeVisible();
  });
});
