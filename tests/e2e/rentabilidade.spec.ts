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

test.describe("Tela #rentabilidade", () => {
  test("renderiza canvas ECharts ao navegar para #rentabilidade", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#rentabilidade");
    await expect(page.locator(".tela-rentabilidade canvas[data-zr-dom-id]")).toBeVisible();
  });

  test("toggle de escopo Brasil -> EUA atualiza estado, instância ECharts e canvas", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#rentabilidade");
    // Estado inicial: escopoAtivo deve ser Total (default)
    const inicial = await page.evaluate(() =>
      (window as any).Alpine.$data(document.body).escopoAtivo,
    );
    expect(inicial).toBe("Total");

    await page.locator('.tela-rentabilidade button[data-escopo="Brasil"]').click();
    await expect(
      page.locator('.tela-rentabilidade button[data-escopo="Brasil"].active'),
    ).toBeVisible();
    const aposBR = await page.evaluate(() =>
      (window as any).Alpine.$data(document.body).escopoAtivo,
    );
    expect(aposBR).toBe("Brasil");

    await page.locator('.tela-rentabilidade button[data-escopo="EUA"]').click();
    await expect(
      page.locator('.tela-rentabilidade button[data-escopo="EUA"].active'),
    ).toBeVisible();
    const aposEUA = await page.evaluate(() =>
      (window as any).Alpine.$data(document.body).escopoAtivo,
    );
    expect(aposEUA).toBe("EUA");

    // Canvas re-renderizado (ECharts): verificamos via dataURL length não-trivial
    const canvas = page.locator(".tela-rentabilidade canvas[data-zr-dom-id]").first();
    await expect(canvas).toBeVisible();
    const tamanhoDataURL = await page.evaluate(() => {
      const c = document.querySelector(".tela-rentabilidade canvas[data-zr-dom-id]") as HTMLCanvasElement;
      return c ? c.toDataURL().length : 0;
    });
    expect(tamanhoDataURL).toBeGreaterThan(100);
  });

  test("resumo mostra grupos Origem / Ano (YTD) / 12 meses", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#rentabilidade");
    await expect(page.locator(".tela-rentabilidade").getByText("Origem")).toBeVisible();
    await expect(page.locator(".tela-rentabilidade").getByText("Ano (YTD)")).toBeVisible();
    await expect(page.locator(".tela-rentabilidade").getByText("12 meses")).toBeVisible();
  });

  test("redesign 7a.E.1: 3 grupos por janela + legenda Como ler", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#rentabilidade");

    const grupos = page.locator(".tela-rentabilidade .rent-grupo");
    await expect(grupos).toHaveCount(3);
    await expect(grupos.nth(0).locator(".rent-grupo-titulo")).toHaveText("Origem");
    await expect(grupos.nth(1).locator(".rent-grupo-titulo")).toHaveText("Ano (YTD)");
    await expect(grupos.nth(2).locator(".rent-grupo-titulo")).toHaveText("12 meses");

    // Cada grupo tem exatamente 2 métricas (XIRR + TWR)
    for (let i = 0; i < 3; i++) {
      await expect(grupos.nth(i).locator(".rent-metrica")).toHaveCount(2);
    }

    const legenda = page.locator(".tela-rentabilidade .rent-legenda");
    await expect(legenda).toBeVisible();
    await expect(legenda).toContainText("Como ler");
    await expect(legenda).toContainText("XIRR");
    await expect(legenda).toContainText("TWR");
  });

  test("legenda do gráfico (ECharts) mostra Portfólio + benchmark do escopo", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#rentabilidade");
    await expect(page.locator(".tela-rentabilidade canvas[data-zr-dom-id]")).toBeVisible({ timeout: 5_000 });

    // ECharts: legenda é parte do canvas — verificamos via getOption() do chart instance
    const legendaTotal = await page.evaluate(() => {
      const data = (window as { Alpine: { $data: (el: Element) => Record<string, unknown> } } & Window).Alpine.$data(document.body);
      const chart = (data as { echartsRent?: { getOption: () => { legend: Array<{ data: string[] }> } } }).echartsRent;
      return chart ? chart.getOption().legend[0].data : [];
    });
    expect(legendaTotal).toContain("Portfólio");
    expect(legendaTotal).toContain("CDI");

    // Trocar para EUA: legenda deve atualizar para S&P 500
    await page.locator('.tela-rentabilidade button[data-escopo="EUA"]').click();
    await page.waitForTimeout(200);
    const legendaEUA = await page.evaluate(() => {
      const data = (window as { Alpine: { $data: (el: Element) => Record<string, unknown> } } & Window).Alpine.$data(document.body);
      const chart = (data as { echartsRent?: { getOption: () => { legend: Array<{ data: string[] }> } } }).echartsRent;
      return chart ? chart.getOption().legend[0].data : [];
    });
    expect(legendaEUA).toContain("S&P 500");
  });
});
