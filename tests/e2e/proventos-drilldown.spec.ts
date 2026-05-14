import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

// Fase 7a.E.18 — drilldown mês×ativo na tela #proventos modo Mensal.
// A fixture portfolio.test.json.enc é gerada por tests/fixtures/gerar_fixture.py.
// Pré-7a.E.18 a fixture não inclui mensal_12m[N].por_ativo — vários specs
// abaixo só verdejam após regen da fixture (Task 8 do plano).

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

async function abrirProventosMensal(page: Page) {
  await autenticar(page);
  await page.goto("/#proventos");
  await expect(page.locator(".tela-proventos")).toBeVisible({ timeout: 10_000 });
  await page
    .locator(".tela-proventos .escopo-toggle button", { hasText: /Mensal/i })
    .click();
  // 7a.E.19.4: ECharts agora — canvas com data-zr-dom-id em vez de .u-over.
  await page.waitForSelector("#proventos-grafico canvas[data-zr-dom-id]", { timeout: 5_000 });
  // Espera animação de entrada (600ms) + Alpine settle.
  await page.waitForTimeout(700);
}

// Helper: click no canvas ECharts via Alpine handler direto (mais robusto que
// computar pixels do canvas — grid padding muda entre uPlot e ECharts).
async function clicarBarraIdx(page: Page, idx: number) {
  await page.evaluate((i) => {
    const data = (window as unknown as { Alpine: { $data: (el: Element) => Record<string, unknown> } }).Alpine.$data(document.body);
    const handler = (data as { _handleClickBarraMes?: (idx: number) => void })._handleClickBarraMes;
    if (handler) handler.call(data, i);
  }, idx);
  await page.waitForTimeout(200);
}

test.describe("7a.E.18 — Proventos · drilldown mês×ativo", () => {
  test("click numa barra Mensal filtra a tabela e atualiza o header", async ({ page }) => {
    await abrirProventosMensal(page);
    await clicarBarraIdx(page, 11); // mês mais recente
    const headerStrong = page.locator(".tela-proventos .ativo-section-h strong");
    await expect(headerStrong).toBeVisible();
    await expect(headerStrong).toHaveText(/\w+\/\d{4}/);
  });

  test("click na mesma barra limpa o filtro", async ({ page }) => {
    await abrirProventosMensal(page);
    await clicarBarraIdx(page, 11);
    await expect(page.locator(".tela-proventos .ativo-section-h strong")).toBeVisible();
    await clicarBarraIdx(page, 11);
    const header = page.locator(".tela-proventos .ativo-section-h");
    await expect(header).toContainText("últimos 12 meses");
    await expect(page.locator(".tela-proventos .ativo-section-h strong")).toHaveCount(0);
  });

  test("Esc limpa o filtro", async ({ page }) => {
    await abrirProventosMensal(page);
    await clicarBarraIdx(page, 11);
    await expect(page.locator(".tela-proventos .ativo-section-h strong")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    const header = page.locator(".tela-proventos .ativo-section-h");
    await expect(header).toContainText("últimos 12 meses");
  });

  test("hint 'Toque na mesma barra ou Esc para limpar' aparece ao filtrar", async ({ page }) => {
    await abrirProventosMensal(page);
    const hint = page.locator("#proventosHintLimpar");
    await expect(hint).toBeHidden();
    await clicarBarraIdx(page, 11);
    await expect(hint).toBeVisible();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    await expect(hint).toBeHidden();
  });

  test("KPIs do topo ficam invariantes ao filtrar", async ({ page }) => {
    await abrirProventosMensal(page);
    const kpiValor = page.locator(".tela-proventos .kpi-valor").first();
    const before = await kpiValor.textContent();
    await clicarBarraIdx(page, 11);
    const after = await kpiValor.textContent();
    expect(after).toBe(before);
  });

  test("companion button por mês é focável e ativa filtro", async ({ page }) => {
    await abrirProventosMensal(page);
    const btns = page.locator(".proventos-meses-a11y button");
    await expect(btns).toHaveCount(12);
    const last = btns.last();
    await last.focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);
    const headerStrong = page.locator(".tela-proventos .ativo-section-h strong");
    await expect(headerStrong).toBeVisible();
    await expect(headerStrong).toHaveText(/\w+\/\d{4}/);
  });

  // 7a.E.19.4: smoke real do event wiring ECharts. Os outros testes usam
  // clicarBarraIdx via Alpine helper para robustez. Este aqui faz click
  // pixel real no canvas após calcular as coordenadas reais via ECharts
  // `convertToPixel` — exercita chart.on("click") → params.componentType
  // → params.dataIndex → _handleClickBarraMes completo.
  test("ECharts click event no canvas dispara drilldown (smoke event wiring)", async ({ page }) => {
    await abrirProventosMensal(page);
    const coords = await page.evaluate(() => {
      const data = (window as unknown as { Alpine: { $data: (el: Element) => Record<string, unknown> } }).Alpine.$data(document.body);
      const chart = (data as { echartsProv?: { convertToPixel: (finder: Record<string, unknown>, value: unknown[]) => [number, number] } }).echartsProv;
      if (!chart) throw new Error("echartsProv não encontrado");
      // Converte (xCategory idx 11, yValue qualquer) para pixels do canvas
      const [x, y] = chart.convertToPixel({ seriesIndex: 0 }, [11, 0]);
      return { x, y };
    });
    const container = page.locator("#proventos-grafico");
    const box = await container.boundingBox();
    if (!box) throw new Error("container sem boundingBox");
    // Click absoluto na coordenada (boundingBox.x + coords.x, ... + coords.y - 20)
    // y-20 puxa pra dentro da barra (acima do baseline)
    await page.mouse.click(box.x + coords.x, box.y + coords.y - 20);
    await page.waitForTimeout(300);
    const headerStrong = page.locator(".tela-proventos .ativo-section-h strong");
    await expect(headerStrong).toBeVisible();
  });
});
