import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

// Fase 7a.AT.1 — renderizador de marcação mínima (parágrafo · lista `- ` ·
// negrito `**` · citação `[n]`) no Relatório Mensal e na `leitura` do dossiê.
//
// Fixtures 100% SINTÉTICAS: o sibling é público e o `.enc` decifra com o PIN de
// teste público (feedback_sibling_fixtures_sinteticas). O `javascript:` e o
// `<img onerror>` da fixture de Março são DELIBERADOS — são o controle da
// allowlist de esquema e do escape-antes-da-marcação.

const F = (n: string) =>
  fs.readFileSync(path.join(__dirname, "../fixtures/" + n), "utf-8");
const PORTFOLIO = F("portfolio.test.json.enc");
const INDICE = F("relatorios_index.test.json.enc");
const MAIO = F("relatorio_2026-05.test.json.enc");
const ABRIL = F("relatorio_2026-04.test.json.enc");
const MARCO = F("relatorio_2026-03.test.json.enc");
const IDX_DOSSIES = F("dossies_index.test.json.enc");
const DOSSIES: Record<string, string> = {
  AMZN: F("dossie_AMZN.test.json.enc"),
  HGLG11: F("dossie_HGLG11.test.json.enc"),
  ITSA4: F("dossie_ITSA4.test.json.enc"),
  SMAL11: F("dossie_SMAL11.test.json.enc"),
};
const MAPA: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../fixtures/dossies_map.test.json"), "utf-8"),
);

test.use({ viewport: { width: 390, height: 844 } });

async function mockTudo(page: Page) {
  await page.route("**/portfolio.json.enc", (r) =>
    r.fulfill({ status: 200, body: PORTFOLIO, contentType: "text/plain" }));
  await page.route("**/relatorios_index.json.enc", (r) =>
    r.fulfill({ status: 200, body: INDICE, contentType: "text/plain" }));
  await page.route("**/relatorio_*.json.enc", (r) => {
    const url = r.request().url();
    const body = url.includes("2026-04") ? ABRIL
               : url.includes("2026-03") ? MARCO : MAIO;
    return r.fulfill({ status: 200, body, contentType: "text/plain" });
  });
  await page.route("**/dossies_index.json.enc", (r) =>
    r.fulfill({ status: 200, body: IDX_DOSSIES, contentType: "text/plain" }));
  await page.route("**/d_*.json.enc", (r) => {
    const nome = r.request().url().split("/").pop()!.split("?")[0];
    const ticker = MAPA[nome];
    const body = ticker && DOSSIES[ticker];
    return body
      ? r.fulfill({ status: 200, body, contentType: "text/plain" })
      : r.fulfill({ status: 404, body: "", contentType: "text/plain" });
  });
  await page.addInitScript(() => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem("pinTimestamp", String(Date.now() - 1 * 24 * 60 * 60 * 1000));
  });
}

// Barreira no nó que É o gate de dado: `.rel-corpo` vive sob `x-if` e só existe
// com `relMes` populado (lição registrada em relatorio-mensal.spec.ts).
async function abrirMes(page: Page, mes: string) {
  await page.goto("/#/raiox/relatorio/" + mes);
  await expect(page.locator(".tela-relatorio .rel-corpo"))
    .toBeVisible({ timeout: 10_000 });
}

async function abrirMarco(page: Page) {
  await mockTudo(page);
  await abrirMes(page, "2026-03");
}

test.describe("Relatório — marcação mínima (7a.AT.1)", () => {
  test("lista vira <ul><li>, e bloco sem marcador vira parágrafo", async ({ page }) => {
    await abrirMarco(page);
    const secao = page.locator('.rel-secao[data-secao="como_voce_foi"]');
    await expect(secao.locator(".rel-prosa ul li")).toHaveCount(2);
    await expect(secao.locator(".rel-prosa ul li").first()).toContainText("Brasil");
    // A linha "Por escopo:" antes da lista é parágrafo próprio.
    await expect(secao.locator(".rel-prosa p")).toHaveCount(1);
    await expect(secao.locator(".rel-prosa p")).toContainText("Por escopo");
    // `nao_funcionando`: dois blocos, nenhum item — parágrafos, não lista.
    const nf = page.locator('.rel-secao[data-secao="nao_funcionando"]');
    await expect(nf.locator(".rel-prosa ul")).toHaveCount(0);
    await expect(nf.locator(".rel-prosa p")).toHaveCount(2);
  });

  test("negrito vira <strong> e não deixa asterisco à mostra", async ({ page }) => {
    await abrirMarco(page);
    const item = page.locator('.rel-secao[data-secao="como_voce_foi"] .rel-prosa li').first();
    await expect(item.locator("strong")).toHaveText("Brasil:");
    await expect(item).not.toContainText("**");
  });

  test("[n] dentro de item de lista vira link para a fonte", async ({ page }) => {
    await abrirMarco(page);
    const link = page.locator('.rel-secao[data-secao="como_voce_foi"] .rel-prosa li a.rel-cit');
    await expect(link).toHaveAttribute("href", "https://example.com/fii");
    await expect(link).toHaveAttribute("aria-label", "Fonte 1");
    await expect(link).toHaveAttribute("target", "_blank");
  });

  test("citação com url javascript: NÃO vira link vivo", async ({ page }) => {
    await abrirMarco(page);
    // A citação 2 é referenciada no gatilho do SMAL11, no card do radar.
    const link = page.locator('.rel-radar .rel-cit[aria-label="Fonte 2"]').first();
    await expect(link).toHaveAttribute("href", /#rel-evidencias$/);
    // Âncora interna não abre em aba nova.
    await expect(link).not.toHaveAttribute("target", "_blank");
    const hrefs = await page.locator("a.rel-cit").evaluateAll(
      (els) => els.map((e) => (e as HTMLAnchorElement).getAttribute("href") || ""));
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.some((h) => h.toLowerCase().includes("javascript:"))).toBe(false);
  });

  test("aspa numa URL que PASSA na allowlist não quebra o atributo href", async ({ page }) => {
    // O `href` do `[n]` é o ÚNICO ponto do renderizador que monta um atributo
    // HTML à mão (`href="${href}"`). A allowlist de esquema não cobre este
    // caminho: a citação 3 usa `https://`, passa nela, e carrega uma aspa. Sem
    // o `_escHtml` da URL, a aspa fecharia o atributo e o resto viraria markup.
    await abrirMarco(page);
    const link = page.locator('.rel-secao[data-secao="renda"] a.rel-cit[aria-label="Fonte 3"]');
    await expect(link).toHaveAttribute("href", 'https://example.com/a"onmouseover=alert(1)//');
    // O que importa: nenhum atributo `onmouseover` nasceu do texto.
    const temHandler = await link.evaluate((e) => e.hasAttribute("onmouseover"));
    expect(temHandler).toBe(false);
  });

  test("linha só com espaço separa blocos, e item vazio não vira <li> mudo", async ({ page }) => {
    // Dois casos de borda do parser de texto: `"A\\n \\nB"` não produz `\\n\\n`
    // literal e fundiria os blocos; e `"- "` sozinho produziria `<li></li>`.
    await abrirMarco(page);
    const html = await page.evaluate(() => {
      const app = (window as any).Alpine.$data(document.querySelector(".tela-relatorio")!);
      return {
        blocos: app._blocosParaHtml("A\n \nB", null),
        itemVazio: app._blocosParaHtml("- \n- real", null),
      };
    });
    expect(html.blocos).toBe("<p>A</p><p>B</p>");
    expect(html.itemVazio).toBe('<ul class="rel-lista"><li>real</li></ul>');
  });

  test("payload hostil é escapado, dentro de negrito e dentro de item", async ({ page }) => {
    await abrirMarco(page);
    const corpo = page.locator(".tela-relatorio .rel-corpo");
    await expect(corpo.locator("img")).toHaveCount(0);
    await expect(corpo.locator("script")).toHaveCount(0);
    // O texto hostil aparece COMO TEXTO — prova que foi escapado, não removido.
    await expect(corpo).toContainText("<img src=x onerror=alert(1)>");
    await expect(corpo).toContainText("<script>alert(2)</script>");
  });

  test("gatilho do radar: linha do evento + duas condições em lista", async ({ page }) => {
    await abrirMarco(page);
    const card = page.locator(".rel-radar-card").first();
    await expect(card.locator(".rel-bloco__rotulo").first()).toHaveText("Observar");
    await expect(card.locator(".rel-bloco__rotulo").nth(1)).toHaveText("Gatilho");
    const gatilho = card.locator(".rel-bloco").nth(1);
    await expect(gatilho.locator("p")).toContainText("Fechamento de fevereiro");
    await expect(gatilho.locator("li")).toHaveCount(2);
    await expect(gatilho.locator("li strong").first()).toHaveText("Segue intacta se:");
  });

  test("selo da prestação: só para veredito conhecido", async ({ page }) => {
    await abrirMarco(page);
    // `> li`: filho DIRETO. Sem isso o seletor casa tambem os <li> das listas
    // de marcacao que agora vivem DENTRO de cada item (4 itens + 5 de lista = 9).
    const itens = page.locator(".rel-prestacao > li");
    await expect(itens).toHaveCount(4);
    // HASH11 (intacta) tem selo.
    await expect(itens.nth(0).locator(".rel-selo")).toHaveCount(1);
    await expect(itens.nth(0).locator(".rel-selo")).toContainText("Tese intacta");
    // SMAL11 (sem veredito) não tem.
    await expect(itens.nth(1).locator(".rel-selo")).toHaveCount(0);
    // KISU11 ("Intacta", fora do enum) não tem — e em NENHUMA hipótese mostra
    // "Tese intacta", que é o fallback otimista de vereditoSelo.
    await expect(itens.nth(2).locator(".rel-selo")).toHaveCount(0);
    await expect(itens.nth(2)).not.toContainText("Tese intacta");
  });

  test("rótulos O que eu disse / O que aconteceu, com marcação", async ({ page }) => {
    await abrirMarco(page);
    const item = page.locator(".rel-prestacao > li").first();
    await expect(item.locator(".rel-bloco__rotulo").first()).toHaveText("O que eu disse");
    await expect(item.locator(".rel-bloco__rotulo").nth(1)).toHaveText("O que aconteceu");
    await expect(item.locator(".rel-bloco").first().locator("li")).toHaveCount(2);
    await expect(item.locator(".rel-bloco").nth(1).locator("li")).toHaveCount(2);
  });

  test("leitura do dossiê: [n] fica TEXTO, nunca link", async ({ page }) => {
    // Medido em 17/09/2026: 7 das 188 entradas reais de timeline já têm `[n]`
    // na `leitura`. Um link aqui apontaria para `#rel-evidencias`, que não
    // existe nesta tela e que, neste SPA, É ROTA — tocar nele navegaria.
    await mockTudo(page);
    await page.goto("/#/dossie/AMZN");
    await expect(page.locator(".tela-dossie .dossie-corpo")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".tela-dossie a.rel-cit")).toHaveCount(0);
    const leitura = page.locator(".tela-dossie .dossie-tl__item .rel-prosa").first();
    await expect(leitura).toContainText("[1]");
    // E a marcação continua funcionando na mesma tela.
    await expect(leitura.locator("li")).toHaveCount(2);
    await expect(leitura.locator("li strong").first()).toHaveText("Receita:");
  });

  // Os dois testes abaixo travam fixes que a VERIFICAÇÃO VISUAL achou e que
  // nenhum assert de contagem pegava — mutar qualquer um dos dois deixava a
  // suíte inteira verde (finding_invariante_correta_sem_teste_que_a_trave).

  test("item de lista DENTRO da prestação não herda o flex do item externo", async ({ page }) => {
    // `.rel-prestacao li` (descendente) aplicava `flex-direction: column` também
    // aos <li> da marcação, e cada pedaço do item — o negrito, o texto, o `[n]`,
    // o ponto final — caía numa linha própria. O seletor tem de ser `> li`.
    await abrirMarco(page);
    const liInterno = page.locator(".rel-prestacao .rel-bloco__corpo li").first();
    await expect(liInterno).toHaveCSS("display", "list-item");
    const itemExterno = page.locator(".rel-prestacao > li").first();
    await expect(itemExterno).toHaveCSS("flex-direction", "column");
    // E o item cabe em UMA linha (o defeito produzia quatro).
    const alturas = await page.locator(".rel-prestacao .rel-bloco__corpo li")
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    expect(Math.max(...alturas)).toBeLessThan(48);
  });

  test("seletor de mês não transborda com nome de mês longo", async ({ page }) => {
    // Medido a 390px antes do fix: "Maio 2026" cabia (369px) e todo mês de nome
    // longo saía da tela — "Setembro 2026" 425px, "Dezembro 2026" 433px. Atinge
    // 8 dos 12 meses, e o relatório publicado de Setembro cairia nisso.
    await abrirMarco(page);
    const larguraDe = async (txt: string) =>
      page.evaluate((t) => {
        const span = document.querySelector(".rel-seletor__btn > span")!;
        const orig = span.textContent;
        span.textContent = t;
        const de = document.documentElement;
        const estouro = de.scrollWidth > de.clientWidth;
        span.textContent = orig;
        return estouro;
      }, txt);
    for (const mes of ["Maio 2026", "Setembro 2026", "Dezembro 2026", "Fevereiro 2026"]) {
      expect(await larguraDe(mes), `${mes} transbordou`).toBe(false);
    }
  });

  test("relatório ANTIGO (sem marcação, sem veredito) renderiza como antes", async ({ page }) => {
    await mockTudo(page);
    await abrirMes(page, "2026-05");
    const secao = page.locator('.rel-secao[data-secao="leitura_mes"]');
    await expect(secao.locator(".rel-prosa p")).toHaveCount(1);
    await expect(secao.locator(".rel-prosa ul")).toHaveCount(0);
    // Nenhum selo na prestação: a fixture de Maio não tem `veredito`.
    await expect(page.locator(".rel-prestacao .rel-selo")).toHaveCount(0);
    // E o corpo continua sendo o mesmo texto de antes da fase.
    await expect(secao.locator(".rel-prosa")).toContainText(
      "Maio 2026 foi um mês de avanço sólido");
  });
});
