import { test, expect, Page, Locator } from "@playwright/test";
import path from "path";
import fs from "fs";

// Fase 7a.S.6 — Rentabilidade: seletor lidera + ordem de cards + narração do
// zoom. Reordena os cards (Período → Ano → 12 meses → Origem, movendo Origem
// para o fim dos .rent-grupos), adiciona o pulse `.live` no subtítulo durante
// o dataZoom, e reforça o tratamento visual do seletor de escopo.

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
  // Esperar recomputarPeriodo inicial popular o card Período.
  await page.waitForFunction(() => {
    const data = (window as { Alpine?: { $data: (el: Element) => Record<string, unknown> } }).Alpine?.$data(document.body);
    return data && (data as { periodoCustom?: { fimIdx: number | null } }).periodoCustom?.fimIdx !== null;
  }, null, { timeout: 5_000 });
}

async function topOf(locator: Locator): Promise<number> {
  return locator.evaluate((el) => el.getBoundingClientRect().top);
}

test.describe("Fase 7a.S.6 — ordem dos cards (Período → Ano → 12m → Origem)", () => {
  test("ordem visual via getBoundingClientRect().top", async ({ page }) => {
    await autenticar(page);
    await abrirRentabilidade(page);

    const periodo = page.locator(".tela-rentabilidade .rent-periodo");
    await expect(periodo).toBeVisible();

    const grupos = page.locator(".tela-rentabilidade .rent-grupo");
    await expect(grupos).toHaveCount(3);

    // Confirma rótulos na nova ordem (defesa contra falso-positivo por posição).
    await expect(grupos.nth(0).locator(".rent-grupo-titulo")).toHaveText("Ano (YTD)");
    await expect(grupos.nth(1).locator(".rent-grupo-titulo")).toHaveText("12 meses");
    await expect(grupos.nth(2).locator(".rent-grupo-titulo")).toHaveText("Origem");

    const topPeriodo = await topOf(periodo);
    const topAno = await topOf(grupos.nth(0));
    const top12m = await topOf(grupos.nth(1));
    const topOrigem = await topOf(grupos.nth(2));

    expect(topPeriodo).toBeLessThan(topAno);
    expect(topAno).toBeLessThan(top12m);
    expect(top12m).toBeLessThan(topOrigem);
  });
});

test.describe("Fase 7a.S.6 — narração do zoom (.live)", () => {
  test("subtítulo ganha .live durante o arrasto do dataZoom e perde após settle", async ({ page }) => {
    await autenticar(page);
    await abrirRentabilidade(page);

    const subtitulo = page.locator(".tela-rentabilidade .chart-rent-subtitulo");
    await expect(subtitulo).not.toHaveClass(/live/);

    await page.evaluate(() => {
      const data = (window as { Alpine: { $data: (el: Element) => Record<string, unknown> } } & Window).Alpine.$data(document.body);
      const chart = (data as { echartsRent?: { dispatchAction: (a: Record<string, unknown>) => void } }).echartsRent;
      if (chart) chart.dispatchAction({ type: "dataZoom", start: 50, end: 100 });
    });

    // Logo após o evento datazoom, o pulse está ativo.
    await expect(subtitulo).toHaveClass(/live/);
    // Texto (cálculo L.1) segue correto durante o pulse.
    await expect(subtitulo).toContainText(/Cresceu desde/);

    // Após o settle (sem novos eventos datazoom), o pulse é removido.
    await expect(subtitulo).not.toHaveClass(/live/, { timeout: 2_000 });
  });

  test("cada novo evento datazoom reinicia o settle (drag contínuo mantém .live)", async ({ page }) => {
    await autenticar(page);
    await abrirRentabilidade(page);

    const subtitulo = page.locator(".tela-rentabilidade .chart-rent-subtitulo");

    const disparar = (start: number, end: number) =>
      page.evaluate(({ start, end }) => {
        const data = (window as { Alpine: { $data: (el: Element) => Record<string, unknown> } } & Window).Alpine.$data(document.body);
        const chart = (data as { echartsRent?: { dispatchAction: (a: Record<string, unknown>) => void } }).echartsRent;
        if (chart) chart.dispatchAction({ type: "dataZoom", start, end });
      }, { start, end });

    await disparar(40, 100);
    await expect(subtitulo).toHaveClass(/live/);
    await page.waitForTimeout(150);
    await disparar(50, 100); // "move" seguinte antes do settle original expirar
    await expect(subtitulo).toHaveClass(/live/);
  });

  test("prefers-reduced-motion: subtítulo NÃO ganha .live (só o texto muda)", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await autenticar(page);
    await abrirRentabilidade(page);

    const subtitulo = page.locator(".tela-rentabilidade .chart-rent-subtitulo");
    const textoAntes = await subtitulo.textContent();

    await page.evaluate(() => {
      const data = (window as { Alpine: { $data: (el: Element) => Record<string, unknown> } } & Window).Alpine.$data(document.body);
      const chart = (data as { echartsRent?: { dispatchAction: (a: Record<string, unknown>) => void } }).echartsRent;
      if (chart) chart.dispatchAction({ type: "dataZoom", start: 50, end: 100 });
    });

    await expect(subtitulo).not.toHaveClass(/live/);
    const textoDepois = await subtitulo.textContent();
    // Texto deve ter mudado (zoom reancorou), mesmo sem o pulse visual.
    expect(textoDepois).not.toBe(textoAntes);
    expect(textoDepois).toMatch(/Cresceu desde/);
  });
});

test.describe("Fase 7a.S.6 — seletor lidera (ênfase)", () => {
  test("escopo-toggle é o 1º elemento interativo da tela (sem número-poster antes do chart)", async ({ page }) => {
    await autenticar(page);
    await abrirRentabilidade(page);

    const tela = page.locator(".tela-rentabilidade");
    const primeiroInterativo = tela.locator("button, a, input").first();
    await expect(primeiroInterativo).toHaveAttribute("data-escopo", "Total");

    // Nenhum elemento de "número grande" (poster) aparece entre o header e o chart.
    const posterAntesDoChart = await page.evaluate(() => {
      const tela = document.querySelector(".tela-rentabilidade");
      const chart = document.getElementById("chart-rent");
      if (!tela || !chart) return null;
      const posterSelectors = [".hero-valor", ".rent-poster", ".num-poster"];
      const nodes = Array.from(tela.querySelectorAll(posterSelectors.join(",")));
      return nodes.filter((n) => {
        const pos = n.compareDocumentPosition(chart);
        return !!(pos & Node.DOCUMENT_POSITION_FOLLOWING); // n vem antes de chart no DOM
      }).length;
    });
    expect(posterAntesDoChart).toBe(0);
  });

  test("escopo ativo tem destaque visual distinto do inativo (peso + realce)", async ({ page }) => {
    await autenticar(page);
    await abrirRentabilidade(page);

    const ativo = page.locator('.tela-rentabilidade button[data-escopo="Total"]');
    const inativo = page.locator('.tela-rentabilidade button[data-escopo="Brasil"]');

    const [pesoAtivo, pesoInativo, boxShadowAtivo] = await Promise.all([
      ativo.evaluate((e) => getComputedStyle(e).fontWeight),
      inativo.evaluate((e) => getComputedStyle(e).fontWeight),
      ativo.evaluate((e) => getComputedStyle(e).boxShadow),
    ]);

    expect(Number(pesoAtivo)).toBeGreaterThan(Number(pesoInativo));
    expect(boxShadowAtivo).not.toBe("none");
  });
});
