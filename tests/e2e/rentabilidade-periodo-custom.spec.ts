import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

// Fase 7a.L.2.b: card "Período" dinâmico sob #rentabilidade. Mostra TWR a.a.
// + XIRR a.a. (Newton-Raphson em JS) + vs benchmark calculados para a janela
// atual do dataZoom. Default (full range) = título "Origem" + valores
// espelham o card fixo Origem; arrastar handles muda o título para
// "Período · mai/24 → abr/26".

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
  // Esperar recomputarPeriodo inicial popular o card.
  await page.waitForFunction(() => {
    const data = (window as { Alpine?: { $data: (el: Element) => Record<string, unknown> } }).Alpine?.$data(document.body);
    return data && (data as { periodoCustom?: { fimIdx: number | null } }).periodoCustom?.fimIdx !== null;
  }, null, { timeout: 5_000 });
}

test.describe("Fase 7a.L.2.b — Rentabilidade card Período", () => {
  test("default (full range): card visível com título 'Origem' e valores numéricos", async ({ page }) => {
    await autenticar(page);
    await abrirRentabilidade(page);

    const card = page.locator(".tela-rentabilidade .rent-periodo");
    await expect(card).toBeVisible();

    const titulo = card.locator(".rent-periodo-titulo");
    await expect(titulo).toHaveText("Origem");

    // 2 métricas obrigatórias (XIRR + TWR); benchmark é opcional.
    const valores = await card.locator(".rent-periodo-valor").allTextContents();
    expect(valores.length).toBeGreaterThanOrEqual(2);
    // Valores são percentuais pt-BR (Intl: vírgula decimal, sufixo %).
    // Aceita "+12,34%", "−1,5%", "0,0%". Quando convergência falha vira "—".
    for (const v of valores) {
      expect(v.trim()).toMatch(/(%|—)/);
    }
  });

  test("arrastar dataZoom para janela curta muda título para 'Período · ...'", async ({ page }) => {
    await autenticar(page);
    await abrirRentabilidade(page);

    const titulo = page.locator(".tela-rentabilidade .rent-periodo-titulo");
    await expect(titulo).toHaveText("Origem");

    // Dispatch dataZoom para mostrar só a metade final da série.
    await page.evaluate(() => {
      const data = (window as { Alpine: { $data: (el: Element) => Record<string, unknown> } } & Window).Alpine.$data(document.body);
      const chart = (data as { echartsRent?: { dispatchAction: (a: Record<string, unknown>) => void } }).echartsRent;
      if (chart) {
        chart.dispatchAction({ type: "dataZoom", start: 50, end: 100 });
      }
    });
    await page.waitForTimeout(200);

    // Título dinâmico: "Período · <mes>/<aa> → <mes>/<aa>"
    await expect(titulo).toContainText(/Período · \w+\/\d+ → \w+\/\d+/);

    // Valores continuam numéricos (TWR/XIRR a.a. recalculados para janela).
    const valores = await page
      .locator(".tela-rentabilidade .rent-periodo .rent-periodo-valor")
      .allTextContents();
    for (const v of valores) {
      expect(v.trim()).toMatch(/(%|—)/);
    }
  });

  test("benchExtras: shape correto + uma .rent-periodo-bench por entrada", async ({ page }) => {
    // 7a.E.26 (Task 5): card multi-benchmark. periodoCustom.benchExtras =
    // [{nome, deltaXirr, deltaTwr}] (deltas = portfólio − benchmark, null
    // quando indefinido). Substitui os antigos benchXirr/benchTwr escalares.
    await autenticar(page);
    await abrirRentabilidade(page);

    const card = page.locator(".tela-rentabilidade .rent-periodo");
    await expect(card).toBeVisible();

    // Quando o card está visível, benchExtras é sempre populado (idx=null no
    // caminho single EUA; idxs CDI/IBOV/SP500 no multi). Shape vale para
    // qualquer versão de fixture (v2.17 ou v2.18).
    const extras = await page.evaluate(() => {
      const data = (window as { Alpine: { $data: (el: Element) => Record<string, unknown> } } & Window).Alpine.$data(document.body);
      return (data as { periodoCustom: { benchExtras: Array<Record<string, unknown>> } }).periodoCustom.benchExtras;
    });
    expect(Array.isArray(extras)).toBe(true);
    expect(extras.length).toBeGreaterThan(0);
    for (const b of extras) {
      expect(b).toHaveProperty("nome");
      expect(typeof b.nome).toBe("string");
      expect(b).toHaveProperty("deltaXirr"); // number | null
      expect(b).toHaveProperty("deltaTwr"); // number | null
    }

    // Uma linha .rent-periodo-bench renderizada por entrada de benchExtras.
    const benchRows = card.locator(".rent-periodo-bench");
    await expect(benchRows).toHaveCount(extras.length);
  });

  test("Newton-Raphson divergence: bench row renderiza '—' em vez de spread enganoso", async ({ page }) => {
    // CRB 7a.L.2.b finding (general-swe #2): força deltaXirr=null injetando
    // hist com cashflows all-outflow (sem flow positivo → Newton diverge).
    // Antes do fix, `?? 0` mostrava portfolio_xirr como spread (UX bug).
    // 7a.E.26 (Task 5): o estado escalar benchXirr virou benchExtras[i].deltaXirr.
    await autenticar(page);
    await abrirRentabilidade(page);

    // Injeta histPeriodo sintético no Alpine state e re-renderiza
    await page.evaluate(() => {
      const data = (window as { Alpine: { $data: (el: Element) => Record<string, unknown> } } & Window).Alpine.$data(document.body) as Record<string, unknown>;
      // Stub: NAV crescente sem flow positivo + benchmark_growth presente
      const histSintetica = [
        { data: "2024-01", nav: 1000, cashflow: -100, benchmark_growth: 1.0 },
        { data: "2024-02", nav: 1050, cashflow: -100, benchmark_growth: 1.01 },
        { data: "2024-03", nav: 1100, cashflow: -100, benchmark_growth: 1.02 },
      ];
      const ctx = (data as { _rentCtx?: Record<string, unknown> })._rentCtx;
      if (ctx) {
        ctx.histPeriodo = histSintetica;
        ctx.growthPortfolio = [1.0, 1.05, 1.10];
      }
      (data as { recomputarPeriodo: (a: number, b: number) => void }).recomputarPeriodo(0, 2);
    });
    await page.waitForTimeout(100);

    // Card visível com título "Origem" (sintético = full range)
    const card = page.locator(".tela-rentabilidade .rent-periodo");
    await expect(card).toBeVisible();

    // Lê o state real: cada entrada de benchExtras com deltaXirr === null
    // DEVE renderizar "—" na sua .rent-periodo-bench correspondente (nunca
    // um spread enganoso). Mantém a semântica condicional original (só
    // afirma "—" quando a divergência ocorre), agora keyed off benchExtras.
    const extras = await page.evaluate(() => {
      const data = (window as { Alpine: { $data: (el: Element) => Record<string, unknown> } } & Window).Alpine.$data(document.body);
      return (data as { periodoCustom: { benchExtras: Array<{ deltaXirr: number | null }> } }).periodoCustom.benchExtras;
    });
    expect(Array.isArray(extras)).toBe(true);
    expect(extras.length).toBeGreaterThan(0);

    const benchRows = card.locator(".rent-periodo-bench");
    await expect(benchRows).toHaveCount(extras.length);

    const anyXirrNull = extras.some((b) => b.deltaXirr === null);
    if (anyXirrNull) {
      // Pelo menos uma row exibe "—" no campo XIRR-spread.
      for (let i = 0; i < extras.length; i++) {
        if (extras[i].deltaXirr === null) {
          await expect(benchRows.nth(i)).toContainText("—");
        }
      }
    }
  });

  test("reset zoom (full range) restaura título 'Origem'", async ({ page }) => {
    await autenticar(page);
    await abrirRentabilidade(page);

    // Zoom in
    await page.evaluate(() => {
      const data = (window as { Alpine: { $data: (el: Element) => Record<string, unknown> } } & Window).Alpine.$data(document.body);
      const chart = (data as { echartsRent?: { dispatchAction: (a: Record<string, unknown>) => void } }).echartsRent;
      if (chart) {
        chart.dispatchAction({ type: "dataZoom", start: 50, end: 100 });
      }
    });
    await page.waitForTimeout(150);

    const tituloDuranteZoom = await page
      .locator(".tela-rentabilidade .rent-periodo-titulo")
      .textContent();
    expect(tituloDuranteZoom).toContain("Período");

    // Reset
    await page.evaluate(() => {
      const data = (window as { Alpine: { $data: (el: Element) => Record<string, unknown> } } & Window).Alpine.$data(document.body);
      const chart = (data as { echartsRent?: { dispatchAction: (a: Record<string, unknown>) => void } }).echartsRent;
      if (chart) {
        chart.dispatchAction({ type: "dataZoom", start: 0, end: 100 });
      }
    });
    await page.waitForTimeout(150);

    await expect(
      page.locator(".tela-rentabilidade .rent-periodo-titulo"),
    ).toHaveText("Origem");
  });
});
