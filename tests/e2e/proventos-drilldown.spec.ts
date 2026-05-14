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
  // Espera uPlot existir (renderProventosGrafico injeta dentro do div).
  await page.waitForSelector("#proventos-grafico .u-over", { timeout: 5_000 });
  // Pequena espera para Alpine reagir ao state change.
  await page.waitForTimeout(150);
}

// Helper: click no overlay u-over (que cobre o canvas e captura pointer events).
async function clicarBarraIdx(page: Page, idx: number) {
  const over = page.locator("#proventos-grafico .u-over").first();
  const box = await over.boundingBox();
  if (!box) throw new Error("u-over sem bounding box");
  // posToIdx do uPlot mapeia X em pixels do canvas para índice. Como o
  // u-over cobre a plot area, a fração (idx+0.5)/n cai no meio do slot idx.
  const n = 12;
  const slotX = box.width * ((idx + 0.5) / n);
  await over.click({ position: { x: slotX, y: box.height / 2 } });
  await page.waitForTimeout(150);
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
});
