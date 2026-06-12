import { test, expect, Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

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

// Paleta refinada travada na Fase 7a.E.20 (decisão de brainstorming opção B).
// 7a.M.1: 5ª categoria Renda Fixa BR (teal/cyan-700 #0e7490).
// Qualquer drift em :root vs ECharts vs .classe-dot deve ser PEGO por estes testes.
const PALETA = {
  catAcoesBr:    "#047857",
  catEua:        "#1e6091",
  catFii:        "#b8731f",
  catCripto:     "#6d4ea8",
  catRendaFixaBr: "#0e7490",
};

test.describe("7a.E.20.1 — Identidade visual (paleta de categorias)", () => {
  test("tokens semânticos --cat-* em :root expõem a paleta refinada", async ({ page }) => {
    await autenticar(page);
    const tokens = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return {
        catAcoesBr:    s.getPropertyValue("--cat-acoes-br").trim(),
        catEua:        s.getPropertyValue("--cat-eua").trim(),
        catFii:        s.getPropertyValue("--cat-fii").trim(),
        catCripto:     s.getPropertyValue("--cat-cripto").trim(),
        catRendaFixaBr: s.getPropertyValue("--cat-renda-fixa-br").trim(),
      };
    });
    expect(tokens.catAcoesBr).toBe(PALETA.catAcoesBr);
    expect(tokens.catEua).toBe(PALETA.catEua);
    expect(tokens.catFii).toBe(PALETA.catFii);
    expect(tokens.catCripto).toBe(PALETA.catCripto);
    expect(tokens.catRendaFixaBr).toBe(PALETA.catRendaFixaBr);
  });

  test("tema ECharts 'drarthur' deriva as 5 cores de categoria via readToken", async ({ page }) => {
    await autenticar(page);
    const tokens = await page.evaluate(() => {
      const w = window as any;
      const t = w.drarthurChart?.tokens || {};
      return {
        catAcoesBr: t.catAcoesBr,
        catEua: t.catEua,
        catFii: t.catFii,
        catCripto: t.catCripto,
        catRendaFixaBr: t.catRendaFixaBr,
      };
    });
    // Drift impossível: tema lê de :root, então tem que bater hex-a-hex.
    expect(tokens.catAcoesBr).toBe(PALETA.catAcoesBr);
    expect(tokens.catEua).toBe(PALETA.catEua);
    expect(tokens.catFii).toBe(PALETA.catFii);
    expect(tokens.catCripto).toBe(PALETA.catCripto);
    expect(tokens.catRendaFixaBr).toBe(PALETA.catRendaFixaBr);
  });

  test("drift EUA fechado: --cat-eua === tokens.catEua === COLORS.catEua()", async ({ page }) => {
    await autenticar(page);
    const trio = await page.evaluate(() => {
      const w = window as any;
      const rootToken = getComputedStyle(document.documentElement)
        .getPropertyValue("--cat-eua")
        .trim();
      const themeToken = w.drarthurChart?.tokens?.catEua;
      // COLORS é local ao module scope do app.js; checamos via leitura do :root
      // (a função css() do app.js faz exatamente isso).
      return { rootToken, themeToken };
    });
    expect(trio.rootToken).toBe(PALETA.catEua);
    expect(trio.themeToken).toBe(PALETA.catEua);
  });

  test(".aloca-cat__dot resolve para a paleta refinada (via --cat)", async ({ page }) => {
    await autenticar(page);
    // 7a.E.31: o dot do card de categoria deriva de --cat (catStyleVar), não de
    // classes dot-*. Grab pelo nome da categoria no header.
    await page.goto("/#alocacao");
    await page.waitForSelector(".tela-alocacao .aloca-cat__dot", { timeout: 5000 });
    const rgbs = await page.evaluate(() => {
      const grab = (nome: string) => {
        const cards = Array.from(document.querySelectorAll(".tela-alocacao .aloca-cat"));
        const card = cards.find(
          (c) => c.querySelector(".aloca-cat__nome")?.textContent?.trim() === nome,
        );
        const dot = card?.querySelector(".aloca-cat__dot");
        return dot ? getComputedStyle(dot as Element).backgroundColor : null;
      };
      return {
        acoesBr: grab("Ações BR"),
        eua:     grab("EUA"),
      };
    });
    // A fixture tem 2 categorias (Ações BR, EUA); ambas resolvem a paleta refinada.
    expect(rgbs.acoesBr).toBe("rgb(4, 120, 87)");
    expect(rgbs.eua).toBe("rgb(30, 96, 145)");
  });

  // Os 3 testes abaixo verificam estrutura — `.flag` renderiza, e quando o backend
  // emite schema v2.12 (production) o emoji aparece. A fixture `portfolio.test.json.enc`
  // ainda é pré-v2.12 e não traz `bandeira` propagado em todos os shapes; conteúdo do
  // emoji em produção é verificado pelos integration tests Python (TestFase7aE20BandeiraPropagation
  // em tests/test_json_pwa.py do main repo).

  test(".flag estrutural em #alocacao — 1 .flag por ativo do card expandido", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#alocacao");
    // 7a.E.31: vista única — expandir o primeiro card mostra os ativos com flag.
    await page.locator(".tela-alocacao .aloca-cat__head").first().click();
    await page.locator(".aloca-alvo__ativo").first().waitFor({ state: "attached", timeout: 5000 });
    const card = page.locator(".tela-alocacao .aloca-cat").first();
    const ativosCount = await card.locator(".aloca-alvo__ativo").count();
    const flagsCount = await card.locator(".aloca-alvo__ativo .flag").count();
    expect(ativosCount).toBeGreaterThan(0);
    expect(flagsCount).toBe(ativosCount);
  });

  test(".flag estrutural via #politica (shim) — 1 .flag por ativo do card expandido", async ({ page }) => {
    // 7a.E.31: `#politica` redireciona para `#alocacao` (vista única). Ativos
    // renderizam ao expandir um card.
    await autenticar(page);
    await page.goto("/#politica");
    await expect(page).toHaveURL(/#alocacao$/);
    await page.locator(".tela-alocacao .aloca-cat__head").first().click();
    await page.locator(".aloca-alvo__ativo").first().waitFor({ state: "attached", timeout: 5000 });
    const card = page.locator(".tela-alocacao .aloca-cat").first();
    const ativosCount = await card.locator(".aloca-alvo__ativo").count();
    const flagsCount = await card.locator(".aloca-alvo__ativo .flag").count();
    expect(ativosCount).toBeGreaterThan(0);
    expect(flagsCount).toBe(ativosCount);
  });

  test(".flag estrutural em #proventos drilldown por ativo — 1 .flag por linha", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#proventos");
    await page.locator(".tabela-proventos tbody tr").first().waitFor({ state: "attached", timeout: 5000 });
    const rowsCount = await page.locator(".tabela-proventos tbody tr").count();
    const flagsCount = await page.locator(".tabela-proventos .flag").count();
    expect(rowsCount).toBeGreaterThan(0);
    expect(flagsCount).toBe(rowsCount);
  });

  test("chart #patrimonio renderizado cicla --cat-eua no slot 1 (CRB Suggestion #2)", async ({ page }) => {
    // Fechamento end-to-end do drift EUA: tokens -> tema -> chart real renderizado.
    await autenticar(page);
    await page.goto("/#patrimonio");
    // Esperar o canvas do ECharts existir e o instance estar registrado.
    await page.waitForFunction(() => {
      const el = document.getElementById("patrimonio-grafico");
      const w = window as any;
      return el && w.echarts && w.echarts.getInstanceByDom && !!w.echarts.getInstanceByDom(el);
    }, { timeout: 10_000 });
    const color1 = await page.evaluate(() => {
      const el = document.getElementById("patrimonio-grafico");
      const w = window as any;
      const inst = w.echarts.getInstanceByDom(el);
      const colorArr = inst?.getOption?.()?.color;
      return Array.isArray(colorArr) ? (colorArr[1] || "").toLowerCase() : null;
    });
    // Slot 1 do tema é EUA — deve bater hex do --cat-eua.
    expect(color1).toBe(PALETA.catEua);
  });
});
