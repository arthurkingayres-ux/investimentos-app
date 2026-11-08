import { test, expect, Page } from "@playwright/test";
import { abrir, resposta, contraste, VERBO_DE_ORDEM } from "./comite-comum";

// 7a.BW.6 Task 6.6: a rota #comite, com os registros estratégicos e a linha do
// placar (spec 7a.BW §6.5, §13 e D5). Fixture SINTÉTICA.

test.use({ viewport: { width: 390, height: 844 } });

const tela = (page: Page) => page.locator(".tela-comite");

// A tela entra com transição (push-enter): medida durante ela não vê o
// transbordo (o teste de 320 px passava com a regra de quebra removida).
// Espera a tela assentar antes de medir largura.
const assentada = (page: Page) =>
  page.waitForFunction(() => {
    const t = document.querySelector(".tela-comite");
    return !!t && t.getAnimations({ subtree: true }).length === 0 && !t.className.includes("push-");
  });

test.describe("Comitê: a rota #comite", () => {
  test("abrir #comite busca a resposta mesmo sem pedido recente", async ({ page }) => {
    let buscas = 0;
    page.on("request", (r) => {
      if (r.url().includes("/comite/resposta")) buscas++;
    });
    await abrir(page, { resposta: resposta(), enviadoEm: null, hash: "#comite" });
    await expect(tela(page)).toBeVisible();
    await expect(tela(page).locator(".comite-registro")).toHaveCount(3, { timeout: 10_000 });
    expect(buscas).toBeGreaterThanOrEqual(1);
  });

  test("registros do mais novo para o mais antigo, com tipo, evidências, confirmaria e derrubaria", async ({ page }) => {
    const erros: string[] = [];
    await abrir(page, { resposta: resposta(), hash: "#comite", erros });
    const regs = tela(page).locator(".comite-registro");
    await expect(regs).toHaveCount(3, { timeout: 10_000 });
    expect(erros).toEqual([]);
    await expect(regs.nth(0).locator(".comite-registro__tipo")).toHaveText("Pergunta para você");
    await expect(regs.nth(1).locator(".comite-registro__tipo")).toHaveText("Reforço");
    await expect(regs.nth(2).locator(".comite-registro__tipo")).toHaveText("Observação de política");
    const r0 = regs.nth(0);
    await expect(r0).toContainText("A tese de ZZCC3 segue de pé");
    await expect(r0.locator(".comite-registro__evidencias li")).toHaveText(["queda de margem no trimestre sintético"]);
    await expect(r0.locator(".comite-registro__confirmaria")).toContainText("margem de volta no próximo trimestre");
    await expect(r0.locator(".comite-registro__derrubaria")).toContainText("segunda queda seguida");
    await expect(r0.locator(".comite-registro__data")).toHaveText("08/11/2026");
  });

  test("linha do placar: histórico curto e N propostas (atual + histórico)", async ({ page }) => {
    await abrir(page, { resposta: resposta(), hash: "#comite" });
    await expect(tela(page).locator(".comite-placar")).toHaveText("histórico curto · 3 propostas desde nov/2026", {
      timeout: 10_000,
    });
  });

  test("placar no singular com uma proposta só", async ({ page }) => {
    await abrir(page, { resposta: resposta((r) => (r.historico = [])), hash: "#comite" });
    await expect(tela(page).locator(".comite-placar")).toHaveText("histórico curto · 1 proposta desde nov/2026", {
      timeout: 10_000,
    });
  });

  test("sem resposta: diz que ainda não há registros, sem erro de console", async ({ page }) => {
    const erros: string[] = [];
    await abrir(page, { resposta: null, hash: "#comite", erros });
    await expect(tela(page)).toBeVisible();
    await expect(tela(page).locator(".comite-vazio")).toBeVisible({ timeout: 10_000 });
    await expect(tela(page).locator(".comite-registro")).toHaveCount(0);
    expect(erros).toEqual([]);
  });

  test("voltar leva ao #aportar", async ({ page }) => {
    await abrir(page, { resposta: resposta(), hash: "#comite" });
    await expect(tela(page)).toBeVisible();
    await tela(page).locator('button[aria-label="Voltar"]').click();
    await expect(page.locator(".tela-aportar")).toBeVisible();
    expect(await page.evaluate(() => location.hash)).toBe("#aportar");
  });

  test("nenhum verbo de ordem na tela", async ({ page }) => {
    await abrir(page, { resposta: resposta(), hash: "#comite" });
    await expect(tela(page).locator(".comite-registro")).toHaveCount(3, { timeout: 10_000 });
    expect(await tela(page).innerText()).not.toMatch(VERBO_DE_ORDEM);
  });

  test("320 px sem rolagem horizontal", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await abrir(page, { resposta: resposta(), hash: "#comite" });
    await expect(tela(page).locator(".comite-registro")).toHaveCount(3, { timeout: 10_000 });
    await assentada(page);
    const r = await page.evaluate(() => {
      const vp = document.documentElement.clientWidth;
      return {
        doc: document.documentElement.scrollWidth,
        vp,
        fora: Array.from(document.querySelectorAll(".tela-comite *")).filter(
          (el) => el.getBoundingClientRect().right > vp + 0.5,
        ).length,
      };
    });
    expect(r.doc).toBeLessThanOrEqual(r.vp);
    expect(r.fora).toBe(0);
  });

  // Ajuste pós-BW.6 (08/11): o Comitê cita evidências como caminhos do
  // envelope; a tela mostra o rótulo em português (o caminho segue no dado,
  // para o validador), na mesma ordem e quantidade, e nada transborda a 320 px.
  const CAMINHOS = [
    "diagnostico.risco.escopos.Brasil.3a.excesso_aa",
    "diagnostico.selecao.classes.acoes_br.janelas.3a.anos_para_afirmar",
    "contexto.diagnostico.selecao.classes.acoes_br.janelas.desde.t",
    "elegiveis.ZZCC3.gap",
    "diagnostico.atribuicao.janelas.5a.campo_novo_que_o_app_nao_conhece",
    "diagnostico.construcao.risco.janelas.3a.correlacoes.acoes_br|eua",
    "queda de margem no trimestre sintético",
  ];
  const ROTULOS = [
    "Excesso sobre o CDI ao ano (risco, Brasil, 3 anos)",
    "Anos para afirmar (seleção, Ações BR, 3 anos)",
    "Estatística t (seleção, Ações BR, desde o início)",
    "Distância até o alvo (elegíveis, ZZCC3)",
    "Campo novo que o app nao conhece (atribuição, 5 anos)",
    "Correlações (construção, risco, 3 anos, Ações BR × EUA)",
    "queda de margem no trimestre sintético",
  ];
  const comCaminhos = () =>
    resposta((r) => {
      const alvo = r.registros.find((x: any) => x.id === "r2");
      alvo.evidencias = CAMINHOS;
    });

  test("evidência em caminho do envelope aparece em português, na mesma ordem", async ({ page }) => {
    const erros: string[] = [];
    await abrir(page, { resposta: comCaminhos(), hash: "#comite", erros });
    const r0 = tela(page).locator(".comite-registro").nth(0);
    await expect(r0.locator(".comite-registro__evidencias li")).toHaveText(ROTULOS, { timeout: 10_000 });
    const texto = await tela(page).innerText();
    expect(texto).not.toContain("diagnostico.");
    expect(texto).not.toContain("_aa");
    expect(erros).toEqual([]);
  });

  test("320 px sem rolagem horizontal com evidências longas", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await abrir(page, {
      resposta: resposta((r) => {
        const alvo = r.registros.find((x: any) => x.id === "r2");
        alvo.evidencias = [...CAMINHOS, "um_token_qualquer_sem_ponto_e_sem_espaco_muito_comprido_que_nao_quebra"];
      }),
      hash: "#comite",
    });
    await expect(tela(page).locator(".comite-registro__evidencias li")).toHaveCount(CAMINHOS.length + 3, {
      timeout: 10_000,
    });
    await assentada(page);
    const r = await page.evaluate(() => {
      const vp = document.documentElement.clientWidth;
      return {
        doc: document.documentElement.scrollWidth,
        vp,
        fora: Array.from(document.querySelectorAll(".tela-comite *")).filter(
          (el) => el.getBoundingClientRect().right > vp + 0.5,
        ).length,
      };
    });
    expect(r.doc).toBeLessThanOrEqual(r.vp);
    expect(r.fora).toBe(0);
  });

  test("Modo Plantão: todo texto da tela legível (AA 4,5:1)", async ({ page }) => {
    await abrir(page, { resposta: resposta(), hash: "#comite", tema: "dark" });
    await expect(tela(page).locator(".comite-registro")).toHaveCount(3, { timeout: 10_000 });
    const pares = await page.evaluate(() => {
      const fundo = (el: Element | null): string => {
        while (el) {
          const b = getComputedStyle(el).backgroundColor;
          if (b && b !== "transparent" && !/rgba\(.*,\s*0\)$/.test(b)) return b;
          el = el.parentElement;
        }
        return getComputedStyle(document.body).backgroundColor;
      };
      const out: { t: string; c: string; b: string }[] = [];
      const w = document.createTreeWalker(document.querySelector(".tela-comite")!, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) {
        const n = w.currentNode as Text;
        const el = n.parentElement!;
        if (!n.textContent!.trim() || el.getClientRects().length === 0) continue;
        out.push({ t: n.textContent!.trim().slice(0, 30), c: getComputedStyle(el).color, b: fundo(el) });
      }
      return { tema: document.documentElement.getAttribute("data-theme"), out };
    });
    expect(pares.tema).toBe("dark");
    expect(pares.out.length).toBeGreaterThan(10);
    for (const p of pares.out) expect(contraste(p.c, p.b), `${p.t}: ${p.c} sobre ${p.b}`).toBeGreaterThanOrEqual(4.5);
  });
});
