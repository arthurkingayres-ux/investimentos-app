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

test.describe("7a.E.5 — Tela de Proventos", () => {
  test("rota #proventos carrega e mostra 3 KPIs", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#proventos");
    await expect(page.locator(".tela-proventos")).toBeVisible({ timeout: 10_000 });

    const kpis = page.locator(".tela-proventos .kpi");
    await expect(kpis).toHaveCount(3);

    for (let i = 0; i < 3; i++) {
      const txt = await kpis.nth(i).locator(".kpi-valor").textContent();
      expect(txt).toMatch(/R\$/);
    }
  });

  test("toggle Origem default; click Mensal (12m) alterna; header reativo", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#proventos");
    await expect(page.locator(".tela-proventos")).toBeVisible({ timeout: 10_000 });

    const origem = page.locator(".tela-proventos .escopo-toggle button", { hasText: /^Origem$/ });
    const mensal = page.locator(".tela-proventos .escopo-toggle button", { hasText: /Mensal/i });
    const header = page.locator(".tela-proventos .ativo-section-h");

    // Origem deve ser o tab ativo por default; header reflete janela.
    await expect(origem).toHaveClass(/active/);
    await expect(mensal).not.toHaveClass(/active/);
    await expect(header).toContainText("desde a Origem");

    // Clicar em Mensal alterna a seleção e o header.
    await mensal.click();
    await expect(mensal).toHaveClass(/active/);
    await expect(origem).not.toHaveClass(/active/);
    await expect(header).toContainText("últimos 12 meses");
  });

  test("tabela 'Por ativo' renderiza linhas e cada linha navega para #ativo/:TICKER", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#proventos");
    await expect(page.locator(".tela-proventos")).toBeVisible({ timeout: 10_000 });

    // Fixture v2.4 tem por_ativo_origem com 3 entradas; tabela deve renderizá-las.
    const linhas = page.locator(".tabela-proventos tbody tr");
    await expect(linhas.first()).toBeVisible({ timeout: 5_000 });
    const count = await linhas.count();
    expect(count).toBeGreaterThan(0);

    // Capturar o ticker da primeira linha antes de clicar.
    const tickerEsperado = (await linhas.first().locator("td").first().textContent())?.trim();
    expect(tickerEsperado).toBeTruthy();

    // Clicar na linha deve navegar para #ativo/<TICKER>.
    await linhas.first().click();
    await expect(page).toHaveURL(new RegExp(`#ativo/${tickerEsperado}$`));
  });

  test("toggle Mensal (12m) mostra tabela coerente com dados de 12 meses", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#proventos");
    await expect(page.locator(".tela-proventos")).toBeVisible({ timeout: 10_000 });

    // Alternar para Mensal (12m).
    await page.locator(".tela-proventos .escopo-toggle button", { hasText: /Mensal/i }).click();
    await page.waitForTimeout(300);

    // A tabela ainda deve mostrar linhas (por_ativo_12m tem 3 entradas na fixture).
    const linhas = page.locator(".tabela-proventos tbody tr");
    await expect(linhas.first()).toBeVisible({ timeout: 5_000 });
    const count = await linhas.count();
    expect(count).toBeGreaterThan(0);

    // Cabeçalho deve conter coluna Total.
    await expect(page.locator(".tabela-proventos thead")).toContainText(/Total/i);
  });
});
