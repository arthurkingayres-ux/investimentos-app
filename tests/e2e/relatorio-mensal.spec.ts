import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

const F = (n: string) =>
  fs.readFileSync(path.join(__dirname, "../fixtures/" + n), "utf-8");
const PORTFOLIO = F("portfolio.test.json.enc");
const INDICE = F("relatorios_index.test.json.enc");
const MAIO = F("relatorio_2026-05.test.json.enc");
const ABRIL = F("relatorio_2026-04.test.json.enc");
const BADSCHEMA = F("relatorio_badschema.test.json.enc");

test.use({ viewport: { width: 390, height: 844 } });

async function mockTudo(page: Page) {
  await page.route("**/portfolio.json.enc", (r) =>
    r.fulfill({ status: 200, body: PORTFOLIO, contentType: "text/plain" }));
  await page.route("**/relatorios_index.json.enc", (r) =>
    r.fulfill({ status: 200, body: INDICE, contentType: "text/plain" }));
  await page.route("**/relatorio_*.json.enc", (r) => {
    const url = r.request().url();
    const body = url.includes("2026-04") ? ABRIL : MAIO;
    return r.fulfill({ status: 200, body, contentType: "text/plain" });
  });
}

async function autenticar(page: Page) {
  await mockTudo(page);
  await page.addInitScript(() => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem("pinTimestamp", String(Date.now() - 1 * 24 * 60 * 60 * 1000));
  });
  await page.goto("/");
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
}

test.describe("Relatório Mensal — push screen (7a.Q.3)", () => {
  test("card na home abre o relatório do último mês", async ({ page }) => {
    await autenticar(page);
    const card = page.locator(".rel-card-home");
    await expect(card).toBeVisible();
    await card.click();
    await expect(page).toHaveURL(/#\/raiox\/relatorio$/);
    await expect(page.locator(".tela-relatorio")).toBeVisible();
    await expect(page.locator('.tab-bar a[data-tab="raiox"]'))
      .toHaveAttribute("aria-current", "page");
    // último mês = 2026-05 → título visível no header
    await expect(page.locator(".tela-relatorio .breadcrumb")).toContainText("Maio 2026");
  });

  test("renderiza as 9 seções na ordem canônica", async ({ page }) => {
    await autenticar(page);
    await page.locator(".rel-card-home").click();
    await expect(page.locator(".tela-relatorio")).toBeVisible();
    const ids = await page.locator(".tela-relatorio .rel-secao").evaluateAll(
      (els) => els.map((e) => e.getAttribute("data-secao")));
    expect(ids).toEqual([
      "prestacao_contas", "leitura_mes", "como_voce_foi", "funcionando",
      "nao_funcionando", "renda", "alinhamento", "radar", "evidencias",
    ]);
    // manchete forte e §5 com destaque
    await expect(page.locator('.rel-secao[data-secao="leitura_mes"]'))
      .toHaveClass(/rel-secao--manchete/);
    await expect(page.locator('.rel-secao[data-secao="nao_funcionando"]'))
      .toHaveClass(/rel-secao--destaque/);
  });

  test("selos de veredito com forma + texto + cor (a11y)", async ({ page }) => {
    await autenticar(page);
    await page.locator(".rel-card-home").click();
    await expect(page.locator(".tela-relatorio")).toBeVisible();
    const radar = page.locator('.rel-secao[data-secao="radar"]');
    await expect(radar.locator(".rel-radar-card")).toHaveCount(3);
    // texto do veredito presente (não só cor)
    await expect(radar).toContainText("Tese intacta");
    await expect(radar).toContainText("Sob pressão");
    await expect(radar).toContainText("Deteriorando");
    // §5 destaca os não-intacta como selos
    const dest = page.locator('.rel-secao[data-secao="nao_funcionando"]');
    await expect(dest.locator(".rel-selo")).toHaveCount(2); // SMAL11 + KISU11
    // glyph é aria-hidden (leitor lê só o texto)
    await expect(radar.locator(".rel-selo__marca").first())
      .toHaveAttribute("aria-hidden", "true");
  });

  test("mini-cards do dossiê + lista de evidências", async ({ page }) => {
    await autenticar(page);
    await page.locator(".rel-card-home").click();
    await expect(page.locator(".tela-relatorio")).toBeVisible();
    // como_voce_foi: kpis de performance + decomposição (4 + 3 = 7)
    const cvf = page.locator('.rel-secao[data-secao="como_voce_foi"]');
    await expect(cvf.locator(".kpi")).toHaveCount(7);
    // renda: kpis
    await expect(page.locator('.rel-secao[data-secao="renda"] .kpi'))
      .toHaveCount(4);
    // evidências: 3 citações, a baixa marcada como "sinal incerto"
    const ev = page.locator('.rel-secao[data-secao="evidencias"]');
    await expect(ev.locator(".rel-evidencias li")).toHaveCount(3);
    await expect(ev).toContainText("sinal incerto");
    const link = ev.locator('a[href="https://example.com/hash11"]');
    await expect(link).toHaveAttribute("target", "_blank");
  });

  // ── B1: Month selector ──────────────────────────────────────────────────────
  test("seletor de mês troca o relatório e decifra sob demanda", async ({ page }) => {
    await autenticar(page);
    await page.locator(".rel-card-home").click();
    await expect(page.locator(".tela-relatorio .breadcrumb")).toContainText("Maio 2026");
    await page.locator(".rel-seletor__btn").click();
    await expect(page.locator(".rel-seletor__lista")).toBeVisible();
    await page.locator('.rel-seletor__item', { hasText: "Abril 2026" }).click();
    await expect(page).toHaveURL(/#\/raiox\/relatorio\/2026-04$/);
    await expect(page.locator(".tela-relatorio .breadcrumb")).toContainText("Abril 2026");
    // mês 1 (abril) → prestação de contas vira nota, sem linhas estruturadas
    await expect(page.locator(".rel-prestacao")).toBeHidden();
    await expect(page.locator('.rel-secao[data-secao="prestacao_contas"]'))
      .toContainText("Primeiro relatório");
  });

  // ── B2: States — loading / error / empty ────────────────────────────────────
  test("erro de arquivo mostra mensagem calma + voltar ao último mês", async ({ page }) => {
    await autenticar(page);
    // sobrescreve a rota do mês para falhar (404)
    await page.route("**/relatorio_2099-01.json.enc", (r) => r.fulfill({ status: 404, body: "" }));
    await page.goto("/#/raiox/relatorio/2099-01");
    await expect(page.locator(".rel-erro")).toBeVisible();
    await expect(page.locator(".rel-erro")).toContainText("Não foi possível");
    await page.locator(".rel-erro__voltar").click();
    await expect(page.locator(".tela-relatorio .breadcrumb")).toContainText("Maio 2026");
  });

  test("card oculto e mensagem calma quando não há relatórios (empty-safe)", async ({ page }) => {
    await page.route("**/portfolio.json.enc", (r) =>
      r.fulfill({ status: 200, body: PORTFOLIO, contentType: "text/plain" }));
    await page.route("**/relatorios_index.json.enc", (r) => r.fulfill({ status: 404, body: "" }));
    await page.addInitScript(() => {
      localStorage.setItem("pin", "123456");
      localStorage.setItem("pinTimestamp", String(Date.now() - 1 * 24 * 60 * 60 * 1000));
    });
    await page.goto("/");
    await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".rel-card-home")).toBeHidden();
    await page.goto("/#/raiox/relatorio");
    await expect(page.locator(".rel-vazio")).toBeVisible();
    await expect(page.locator(".rel-vazio")).toContainText("Ainda não há relatórios");
  });

  // ── B3: Cold-start + back navigation ────────────────────────────────────────
  test("cold-start direto em #/raiox/relatorio/:mes renderiza (auto-resume)", async ({ page }) => {
    await mockTudo(page);
    await page.addInitScript(() => {
      localStorage.setItem("pin", "123456");
      localStorage.setItem("pinTimestamp", String(Date.now() - 1 * 24 * 60 * 60 * 1000));
    });
    await page.goto("/#/raiox/relatorio/2026-04");
    await expect(page.locator(".tela-relatorio")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".tela-relatorio .breadcrumb")).toContainText("Abril 2026");
  });

  test("cold-start submitPin em #/raiox/relatorio renderiza o último mês", async ({ page }) => {
    await mockTudo(page);
    await page.goto("/#/raiox/relatorio");
    await expect(page.locator(".pin-screen")).toBeVisible({ timeout: 10_000 });
    await page.locator("input.pin-input").fill("123456");
    await page.locator("button.pin-submit").click();
    await expect(page.locator(".tela-relatorio")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".tela-relatorio .breadcrumb")).toContainText("Maio 2026");
  });

  test("voltar retorna ao Raio-X", async ({ page }) => {
    await autenticar(page);
    await page.locator(".rel-card-home").click();
    await expect(page.locator(".tela-relatorio")).toBeVisible();
    await page.locator(".tela-relatorio .breadcrumb button").first().click();
    await expect(page.locator(".raiox")).toBeVisible();
    await expect(page.locator(".tela-relatorio")).toBeHidden();
  });

  test("payload com schema inválido cai no estado de erro (não renderiza prosa)", async ({ page }) => {
    await autenticar(page);
    // decifra OK (PIN de teste) mas schema != relatorio_mensal_v1 → branch de erro
    await page.route("**/relatorio_2026-05.json.enc", (r) =>
      r.fulfill({ status: 200, body: BADSCHEMA, contentType: "text/plain" }));
    await page.goto("/#/raiox/relatorio/2026-05");
    await expect(page.locator(".rel-erro")).toBeVisible();
    await expect(page.locator(".rel-erro")).toContainText("Não foi possível");
    await expect(page.locator(".rel-corpo")).toBeHidden();
  });
});
