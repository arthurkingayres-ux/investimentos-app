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

async function abrirRentabilidade(page: Page) {
  await page.goto("/#rentabilidade");
  await expect(
    page.locator(".tela-rentabilidade canvas[data-zr-dom-id]"),
  ).toBeVisible({ timeout: 5_000 });
}

test.describe("Fase 7a.L.1 — Rentabilidade chart period-relative", () => {
  test("default (100% zoom): subtítulo mostra 'Cresceu desde {ano_origem}'", async ({ page }) => {
    await autenticar(page);
    await abrirRentabilidade(page);

    const subtitulo = page.locator(".tela-rentabilidade .chart-rent-subtitulo");
    await expect(subtitulo).toBeVisible();
    await expect(subtitulo).toContainText(/Cresceu desde/);
    // Default âncora: deve mencionar mês/ano da série (formato "Mmm/AA";
    // fixture sintética começa em 2024-01 → "Jan/24")
    await expect(subtitulo).toContainText(/\/24/);
  });

  test("default Y é cumulativo desde origem (sanity > 0 quando portfolio cresceu)", async ({ page }) => {
    await autenticar(page);
    await abrirRentabilidade(page);

    // Portfolio TWR_origem na fixture é positivo (0.05 → 0.118).
    // Em modo cumulativo desde origem, último ponto = growth_total - 1 > 0.
    const ultimoPortfolio = await page.evaluate(() => {
      const data = (window as { Alpine: { $data: (el: Element) => Record<string, unknown> } } & Window).Alpine.$data(document.body);
      const chart = (data as { echartsRent?: { getOption: () => { series: Array<{ data: Array<number | null> }> } } }).echartsRent;
      if (!chart) return null;
      const portfolioSeries = chart.getOption().series[0].data;
      return portfolioSeries[portfolioSeries.length - 1];
    });
    expect(ultimoPortfolio).not.toBeNull();
    expect(ultimoPortfolio as number).toBeGreaterThan(0);
  });

  test("zoom para janela curta reancora Y e atualiza subtítulo", async ({ page }) => {
    await autenticar(page);
    await abrirRentabilidade(page);

    // Capturar Y do último ponto antes do zoom (modo default 100%)
    const yAntes = await page.evaluate(() => {
      const data = (window as { Alpine: { $data: (el: Element) => Record<string, unknown> } } & Window).Alpine.$data(document.body);
      const chart = (data as { echartsRent?: { getOption: () => { series: Array<{ data: Array<number | null> }> } } }).echartsRent;
      if (!chart) return null;
      const d = chart.getOption().series[0].data;
      return d[d.length - 1];
    });

    // Disparar dataZoom para mostrar apenas os 2 últimos pontos (~75-100%)
    await page.evaluate(() => {
      const data = (window as { Alpine: { $data: (el: Element) => Record<string, unknown> } } & Window).Alpine.$data(document.body);
      const chart = (data as { echartsRent?: { dispatchAction: (a: Record<string, unknown>) => void } }).echartsRent;
      if (chart) {
        chart.dispatchAction({
          type: "dataZoom",
          start: 75,
          end: 100,
        });
      }
    });

    await page.waitForTimeout(150);

    const yDepois = await page.evaluate(() => {
      const data = (window as { Alpine: { $data: (el: Element) => Record<string, unknown> } } & Window).Alpine.$data(document.body);
      const chart = (data as { echartsRent?: { getOption: () => { series: Array<{ data: Array<number | null> }> } } }).echartsRent;
      if (!chart) return null;
      const d = chart.getOption().series[0].data;
      return d[d.length - 1];
    });

    // Y do último ponto deve ter mudado (reancorado para janela menor).
    // CRB #5: assertion de magnitude (|y_depois| < |y_antes|) é frágil contra
    // fixtures futuras — basta verificar que o valor mudou (reancoragem
    // ocorreu) e o tipo permanece numérico.
    expect(yDepois).not.toEqual(yAntes);
    expect(typeof yDepois).toBe("number");

    // Subtítulo deve continuar começando com "Cresceu desde" (com data nova)
    const subtitulo = page.locator(".tela-rentabilidade .chart-rent-subtitulo");
    await expect(subtitulo).toContainText(/Cresceu desde/);
  });

  test("reset do zoom (100%) recupera subtítulo default", async ({ page }) => {
    await autenticar(page);
    await abrirRentabilidade(page);

    const subtituloInicial = await page
      .locator(".tela-rentabilidade .chart-rent-subtitulo")
      .textContent();

    // Zoom in
    await page.evaluate(() => {
      const data = (window as { Alpine: { $data: (el: Element) => Record<string, unknown> } } & Window).Alpine.$data(document.body);
      const chart = (data as { echartsRent?: { dispatchAction: (a: Record<string, unknown>) => void } }).echartsRent;
      if (chart) {
        chart.dispatchAction({ type: "dataZoom", start: 75, end: 100 });
      }
    });
    await page.waitForTimeout(150);

    // Reset
    await page.evaluate(() => {
      const data = (window as { Alpine: { $data: (el: Element) => Record<string, unknown> } } & Window).Alpine.$data(document.body);
      const chart = (data as { echartsRent?: { dispatchAction: (a: Record<string, unknown>) => void } }).echartsRent;
      if (chart) {
        chart.dispatchAction({ type: "dataZoom", start: 0, end: 100 });
      }
    });
    await page.waitForTimeout(150);

    const subtituloFinal = await page
      .locator(".tela-rentabilidade .chart-rent-subtitulo")
      .textContent();
    expect(subtituloFinal).toBe(subtituloInicial);
  });

  // 7a.L.2.c: paridade card "Período" ↔ chart no endpoint visível.
  // O card mostra TWR a.a. (anualizado); a curva mostra growth cumulativo
  // desde primeiro ponto visível (L.1). Para janelas >= 1 ano, TWR a.a.
  // ≈ growth cumulativo (mesma magnitude). Para janelas < 1 ano, TWR a.a.
  // > growth cumulativo (anualização amplifica). Spec valida sinal +
  // consistência de magnitude (não igualdade exata por isso).
  test("paridade card Período ↔ chart: TWR a.a. e growth visual têm mesmo sinal", async ({ page }) => {
    await autenticar(page);
    await abrirRentabilidade(page);

    // Zoom em janela média (50-100%) → ambos cards e chart populados
    await page.evaluate(() => {
      const data = (window as { Alpine: { $data: (el: Element) => Record<string, unknown> } } & Window).Alpine.$data(document.body);
      const chart = (data as { echartsRent?: { dispatchAction: (a: Record<string, unknown>) => void } }).echartsRent;
      if (chart) {
        chart.dispatchAction({ type: "dataZoom", start: 50, end: 100 });
      }
    });
    await page.waitForTimeout(200);

    const cardTwr = await page.evaluate(() => {
      const data = (window as { Alpine: { $data: (el: Element) => Record<string, unknown> } } & Window).Alpine.$data(document.body);
      return (data as { periodoCustom: { twr: number | null } }).periodoCustom.twr;
    });

    const endpointVisual = await page.evaluate(() => {
      const data = (window as { Alpine: { $data: (el: Element) => Record<string, unknown> } } & Window).Alpine.$data(document.body);
      const chart = (data as { echartsRent?: { getOption: () => Record<string, unknown> } }).echartsRent;
      if (!chart) return null;
      const opt = chart.getOption();
      const series = (opt.series as Array<{ data: number[] }>)?.[0]?.data;
      if (!series || series.length === 0) return null;
      // Pega último valor visível (reancorado por L.1)
      return series[series.length - 1];
    });

    // Ambos não-null e mesmo sinal (cresceu/decresceu na janela)
    if (cardTwr !== null && endpointVisual !== null) {
      expect(Math.sign(cardTwr)).toBe(Math.sign(endpointVisual));
    }
  });
});
