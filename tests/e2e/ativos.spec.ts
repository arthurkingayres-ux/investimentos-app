import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";
import { decifrar, cifrar } from "./comite-comum";

// Fase 7a.CC.2 (Task CC2.3) — Carteira › Ativos (spec 7a.CC §5.8) e o "voltar"
// definitivo sem origem (§5.5 item 3). Fixtures sintéticas: a base da suíte e
// `portfolio_ativos_empate` (tickers inventados, três valores empatados).

const F = (n: string) => fs.readFileSync(path.join(__dirname, "../fixtures/" + n), "utf-8");
const BASE = F("portfolio.test.json.enc");
const EMPATE = F("portfolio_ativos_empate.test.json.enc");
const IDX_DOSSIES = F("dossies_index.test.json.enc");
const DOSSIES: Record<string, string> = { HGLG11: F("dossie_HGLG11.test.json.enc") };
const MAPA: Record<string, string> = JSON.parse(F("dossies_map.test.json"));

test.use({ viewport: { width: 390, height: 844 } });

async function entrar(page: Page, hash = "", portfolio = BASE) {
  await page.route("**/portfolio.json.enc", (r) =>
    r.fulfill({ status: 200, body: portfolio, contentType: "text/plain" }));
  await page.route("**/dossies_index.json.enc", (r) =>
    r.fulfill({ status: 200, body: IDX_DOSSIES, contentType: "text/plain" }));
  await page.route("**/d_*.json.enc", (r) => {
    const nome = r.request().url().split("/").pop()!.split("?")[0];
    const body = MAPA[nome] && DOSSIES[MAPA[nome]];
    return body
      ? r.fulfill({ status: 200, body, contentType: "text/plain" })
      : r.fulfill({ status: 404, body: "", contentType: "text/plain" });
  });
  await page.addInitScript(() => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem("pinTimestamp", String(Date.now() - 86_400_000));
  });
  await page.goto("/" + hash);
  await expect(page.locator(".tab-bar")).toBeVisible({ timeout: 10_000 });
}

const linhas = (page: Page) => page.locator(".tela-ativos [data-testid=ativos-linha]");
const barraAtiva = (page: Page) => page.locator('.tab-bar [aria-current="page"]');
const faixaAtiva = (page: Page) => page.locator('.grupo-cab nav [aria-current="page"]');
const voltar = (page: Page) => page.getByRole("button", { name: /^Voltar/ });
const hashAgora = (page: Page) => page.evaluate(() => location.hash);

const tickers = async (page: Page) =>
  (await linhas(page).locator("[data-testid=ativos-ticker]").allTextContents()).map((t) => t.trim());

test.describe("7a.CC.2 — Carteira › Ativos", () => {
  test("lista todas as posições, na ordem do valor, com a tela e a faixa certas", async ({ page }) => {
    const json = decifrar(BASE);
    await entrar(page, "#/carteira/ativos");
    await expect(page.locator(".tela-ativos")).toBeVisible();
    await expect(barraAtiva(page)).toHaveAttribute("data-tab", "carteira");
    await expect(faixaAtiva(page)).toHaveText("Ativos");
    await expect(page.locator(".grupo-cab nav a")).toHaveText(["Alocação", "Ativos", "Vigília"]);
    await expect(page.locator(".tela-ativos h1")).toHaveText("Ativos");
    await expect(linhas(page)).toHaveCount(json.posicoes.length);
    const esperado = [...json.posicoes]
      .sort((a: any, b: any) => b.valor_mercado_brl - a.valor_mercado_brl || (a.ticker < b.ticker ? -1 : 1))
      .map((p: any) => p.ticker);
    expect(await tickers(page)).toEqual(esperado);
  });

  test("ordem não crescente por valor; empate por ticker crescente (fixture sintética)", async ({ page }) => {
    const json = decifrar(EMPATE);
    await entrar(page, "#/carteira/ativos", EMPATE);
    await expect(linhas(page)).toHaveCount(json.posicoes.length);
    // Cripto é posição: aparece, não é filtrada.
    const ordem = await tickers(page);
    expect(ordem).toEqual(["DDDD3", "AAAA3", "BBBB11", "ZZZZ", "EEEE", "CCCC"]);
    const valorDe = (t: string) => json.posicoes.find((p: any) => p.ticker === t).valor_mercado_brl;
    for (let i = 1; i < ordem.length; i++) expect(valorDe(ordem[i])).toBeLessThanOrEqual(valorDe(ordem[i - 1]));
  });

  test("linha: bandeira, ticker e classe à esquerda, valor em BRL à direita, sem %", async ({ page }) => {
    await entrar(page, "#/carteira/ativos", EMPATE);
    const l = linhas(page).first(); // DDDD3
    await expect(l).toContainText("DDDD3");
    await expect(l).toContainText("Ações");
    await expect(l).toContainText("9.000");
    await expect(l).toContainText("🇧🇷");
    await expect(linhas(page).nth(4)).toContainText("🇺🇸"); // EEEE, USD
    await expect(linhas(page).nth(5)).toContainText("Cripto");
    for (const t of await linhas(page).allTextContents()) expect(t).not.toContain("%");
    await expect(page.locator(".tela-ativos")).not.toContainText("%");
  });

  test("cada linha é <a href=#ativo/TICKER> com ao menos 44px", async ({ page }) => {
    await entrar(page, "#/carteira/ativos", EMPATE);
    const n = await linhas(page).count();
    expect(n).toBe(6);
    for (let i = 0; i < n; i++) {
      const a = linhas(page).nth(i);
      expect(await a.evaluate((e) => e.tagName)).toBe("A");
      const t = (await a.locator("[data-testid=ativos-ticker]").textContent())!.trim();
      await expect(a).toHaveAttribute("href", "#ativo/" + t);
      expect((await a.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  });

  test("posicoes vazia: frase e nenhuma lista", async ({ page }) => {
    await entrar(page, "#/carteira/ativos", F("portfolio_pesou_sem_posicoes.test.json.enc"));
    await expect(page.locator(".tela-ativos")).toContainText("Nenhum ativo por aqui ainda.");
    await expect(page.locator(".tela-ativos ul")).toHaveCount(0);
    await expect(linhas(page)).toHaveCount(0);
  });

  test("posicoes ausente: frase e nenhuma lista", async ({ page }) => {
    const j = decifrar(BASE);
    delete j.posicoes;
    await entrar(page, "#/carteira/ativos", cifrar(JSON.stringify(j)));
    await expect(page.locator(".tela-ativos")).toContainText("Nenhum ativo por aqui ainda.");
    await expect(page.locator(".tela-ativos ul")).toHaveCount(0);
  });

  test("clique → #ativo/T → ← → Ativos, grupo Carteira aceso", async ({ page }) => {
    await entrar(page, "#/carteira/ativos");
    const t = (await linhas(page).first().locator("[data-testid=ativos-ticker]").textContent())!.trim();
    await linhas(page).first().click();
    await expect(page.locator(".tela-ativo")).toBeVisible();
    expect(await hashAgora(page)).toBe("#ativo/" + t);
    await voltar(page).click();
    expect(await hashAgora(page)).toBe("#/carteira/ativos");
    await expect(page.locator(".tela-ativos")).toBeVisible();
    await expect(barraAtiva(page)).toHaveAttribute("data-tab", "carteira");
    await expect(faixaAtiva(page)).toHaveText("Ativos");
  });
});

test.describe("7a.CC.2 — voltar sem origem (deep link) cai em Ativos", () => {
  test("#ativo/T direto: ← → #/carteira/ativos, grupo carteira", async ({ page }) => {
    await entrar(page, "#ativo/HGLG11");
    await expect(page.locator(".tela-ativo")).toBeVisible();
    // Ainda na tela de push, sem origem: o grupo aceso já é Carteira.
    await expect(barraAtiva(page)).toHaveAttribute("data-tab", "carteira");
    await voltar(page).click();
    expect(await hashAgora(page)).toBe("#/carteira/ativos");
    await expect(page.locator(".tela-ativos")).toBeVisible();
    await expect(barraAtiva(page)).toHaveAttribute("data-tab", "carteira");
  });

  test("#/dossie/T direto: ← → #/carteira/ativos, grupo carteira", async ({ page }) => {
    await entrar(page, "#/dossie/HGLG11");
    await expect(page.locator(".tela-dossie .dossie-corpo")).toBeVisible();
    // Ainda na tela de push, sem origem: o grupo aceso já é Carteira.
    await expect(barraAtiva(page)).toHaveAttribute("data-tab", "carteira");
    await voltar(page).click();
    expect(await hashAgora(page)).toBe("#/carteira/ativos");
    await expect(page.locator(".tela-ativos")).toBeVisible();
    await expect(barraAtiva(page)).toHaveAttribute("data-tab", "carteira");
  });
});
