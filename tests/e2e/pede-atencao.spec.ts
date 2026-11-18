import { test, expect, Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { cifrar } from "./comite-comum";
import { payload as olhoPayload, isoDiasAtras, semTransbordo } from "./olho-comum";

// 7a.CC.2 Task CC2.2: o Hoje com "Pede atenção" (spec 7a.CC §5.6, D1). Lista de
// bordas finas logo abaixo do hero e do "Ver histórico", antes dos "Últimos 7
// dias". Três itens, ordem fixa, cada um com a condição que já existia:
//   Vigília          olhoLinhaRaiox()                         → #olho
//   Notas pendentes  conferenciaVisivel()                     → #/raiox/reserva
//   Relatório novo   relUltimoMes && !mesLido(relUltimoMes)   → #/raiox/relatorio
// Sem item, o bloco não existe no DOM. Fixtures SINTÉTICAS: o Olho é a fixture
// olho.sintetico.json (EMPR3/FUND11), as notas usam tickers inventados (AAAA3),
// o relatório é o índice de teste (maio e abril de 2026).

test.use({ viewport: { width: 390, height: 844 } });

const F = (n: string) => fs.readFileSync(path.join(__dirname, "../fixtures/" + n), "utf-8");
const PORTFOLIO = F("portfolio.test.json.enc");
const IDX_REL = F("relatorios_index.test.json.enc");
const IDX_DOSSIES = F("dossies_index.test.json.enc");
const HORA = 3600 * 1000;
const iso = (msAtras: number) => new Date(Date.now() - msAtras).toISOString().replace(/\.\d{3}Z$/, "Z");

const NOTAS = [
  { tipo: "operacao", data: "2026-10-17", ticker: "AAAA3", lado: "Compra" },
  { tipo: "posicao", ticker: "BBBB4" },
];
const RESERVA = {
  versao: 1, lido_em: iso(2 * HORA), atualizado_pelo_banco_em: iso(5 * HORA),
  status_item: "UPDATED", execucao_item: "SUCCESS", total: 12345.67, n_posicoes: 7, n_sem_saldo: 0,
};

const SEMANA = {
  janela_dias: 7, data_corte: "2026-05-09", delta_patrim_brl: 1000, delta_patrim_pct: 0.01,
  decomposicao: { aportes_liq_brl: 500, proventos_brl: 100, mercado_brl: 400 },
  variacao_mercado: [], compras: [], vendas: [], proventos: [],
};

type Condicoes = { vigilia: boolean; notas: boolean; relatorio: boolean };
const TODAS: Condicoes = { vigilia: true, notas: true, relatorio: true };
const NENHUMA: Condicoes = { vigilia: false, notas: false, relatorio: false };

async function abrir(page: Page, c: Condicoes, o: { tema?: "dark" | null; erros?: string[] } = {}) {
  await page.route("**/portfolio.json.enc", (r) => r.fulfill({ status: 200, body: PORTFOLIO, contentType: "text/plain" }));
  await page.route("**/relatorios_index.json.enc", (r) => r.fulfill({ status: 200, body: IDX_REL, contentType: "text/plain" }));
  await page.route("**/dossies_index.json.enc", (r) => r.fulfill({ status: 200, body: IDX_DOSSIES, contentType: "text/plain" }));
  // Falsa = a ameaça já foi examinada (o payload chega, a linha não tem razão de existir).
  const olho = olhoPayload(c.vigilia ? undefined : (p) => {
    for (const a of p.alertas) { a.examinado = true; a.examinado_em = isoDiasAtras(1); }
  });
  await page.route("**/olho", (r) => r.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ cifra: cifrar(JSON.stringify(olho)), gravada_em: new Date().toISOString() }),
  }));
  // Falsa = a conferência chega sem item.
  const conf = { versao: 1, lido_em: iso(2 * HORA), itens: c.notas ? NOTAS : [] };
  await page.route("**/conferencia", (r) => r.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ cifra: cifrar(JSON.stringify(conf)), gravada_em: iso(HORA) }),
  }));
  await page.route("**/reserva", (r) => r.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ cifra: cifrar(JSON.stringify(RESERVA)), gravada_em: iso(HORA) }),
  }));
  if (o.erros) {
    const erros = o.erros;
    page.on("pageerror", (e) => erros.push("pageerror: " + e.message));
    page.on("console", (m) => {
      if (m.type() === "error" || m.text().includes("Alpine Expression Error")) erros.push("console: " + m.text());
    });
  }
  // Falsa = o último mês (maio de 2026) já foi lido neste aparelho.
  await page.addInitScript(([tema, lido]) => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem("pinTimestamp", String(Date.now() - 24 * 60 * 60 * 1000));
    if (tema) localStorage.setItem("tema", tema as string);
    if (lido) localStorage.setItem("relRead", JSON.stringify({ "2026-05": true }));
  }, [o.tema ?? null, !c.relatorio] as const);
  await page.goto("/");
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
  // "Últimos 7 dias" visível (a fixture da suíte não tem semana ativa), com
  // valores sintéticos: a posição do bloco é medida contra ele.
  await page.evaluate((u) => { (window as any).Alpine.$data(document.body).json.ultimos_7d = u; }, SEMANA);
  await tudoChegou(page);
}

// As três fontes chegaram (com ou sem razão para o item): sem isto, "ausente"
// passaria vácuo enquanto a busca ainda está em voo.
async function tudoChegou(page: Page) {
  await page.waitForFunction(() => {
    const d = (window as any).Alpine?.$data(document.body);
    return !!d && !!d.olho && !!d.conferencia && !!d.relUltimoMes;
  }, undefined, { timeout: 10_000 });
  await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => ok(null))));
}

const bloco = (page: Page) => page.locator(".raiox").getByTestId("pede-atencao");
const linha = (page: Page, chave: string) => page.locator(".raiox").getByTestId("pede-atencao-" + chave);

const ESPERADO: Record<keyof Condicoes, { texto: RegExp; href: string }> = {
  vigilia: { texto: /^\s*▲\s*1 tese sob ameaça\s*›\s*$/, href: "#olho" },
  notas: { texto: /^\s*2 pendentes\s*›\s*$/, href: "#/raiox/reserva" },
  relatorio: { texto: /^\s*Relatório de Maio 2026 saiu\s*›\s*$/, href: "#/raiox/relatorio" },
};

test.describe("Pede atenção: cada item com a sua condição", () => {
  for (const chave of ["vigilia", "notas", "relatorio"] as const) {
    test(`${chave}: condição verdadeira, o item aparece sozinho no bloco`, async ({ page }) => {
      const erros: string[] = [];
      await abrir(page, { ...NENHUMA, [chave]: true }, { erros });
      await expect(bloco(page)).toBeVisible();
      await expect(bloco(page).locator(".pede-atencao__titulo")).toHaveText("Pede atenção");
      await expect(bloco(page).locator("a.pede-atencao__linha")).toHaveCount(1);
      const l = linha(page, chave);
      await expect(l).toHaveText(ESPERADO[chave].texto);
      await expect(l).toHaveAttribute("href", ESPERADO[chave].href);
      expect(erros).toEqual([]);
    });

    test(`${chave}: condição falsa, o item some e os outros ficam`, async ({ page }) => {
      await abrir(page, { ...TODAS, [chave]: false });
      await expect(bloco(page)).toBeVisible();
      await expect(bloco(page).locator("a.pede-atencao__linha")).toHaveCount(2);
      await expect(linha(page, chave)).toHaveCount(0);
    });
  }

  test("as três falsas: o bloco não existe no DOM (nem título, nem espaço)", async ({ page }) => {
    await abrir(page, NENHUMA);
    await expect(page.getByTestId("pede-atencao")).toHaveCount(0);
    await expect(page.locator(".pede-atencao__titulo")).toHaveCount(0);
    expect(await page.locator(".raiox").innerText()).not.toContain("Pede atenção");
  });

  test("a condição que muda com a tela aberta: ler o relatório tira o item ao voltar ao Hoje", async ({ page }) => {
    await page.route("**/relatorio_*.json.enc", (r) =>
      r.fulfill({ status: 200, body: F("relatorio_2026-05.test.json.enc"), contentType: "text/plain" }));
    await abrir(page, { ...NENHUMA, relatorio: true });
    await linha(page, "relatorio").click();
    await expect(page).toHaveURL(/#\/raiox\/relatorio$/);
    await expect(page.locator(".tela-relatorio .rel-corpo")).toBeVisible({ timeout: 10_000 });
    await page.locator('.tab-bar a[data-tab="raiox"]').click();
    await expect(page.locator(".raiox")).toBeVisible();
    await expect(page.getByTestId("pede-atencao")).toHaveCount(0);
  });
});

test.describe("Pede atenção: as três verdadeiras", () => {
  test("ordem Vigília, Notas pendentes, Relatório; textos sem travessão; linhas ≥ 44px", async ({ page }) => {
    await abrir(page, TODAS);
    const linhas = bloco(page).locator("a.pede-atencao__linha");
    await expect(linhas).toHaveCount(3);
    expect(await linhas.evaluateAll((els) => els.map((e) => e.getAttribute("data-testid"))))
      .toEqual(["pede-atencao-vigilia", "pede-atencao-notas", "pede-atencao-relatorio"]);
    for (const chave of ["vigilia", "notas", "relatorio"] as const) {
      await expect(linha(page, chave)).toHaveText(ESPERADO[chave].texto);
      expect((await linha(page, chave).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await bloco(page).innerText()).not.toMatch(/—|–/);
    // O glifo é decorativo: o texto acessível é o de olhoLinhaRaiox().
    await expect(linha(page, "vigilia").locator(".olho-glifo")).toHaveAttribute("aria-hidden", "true");
    // Lista de verdade, para o leitor de tela anunciar quantos são.
    await expect(bloco(page).locator("ul > li")).toHaveCount(3);
  });

  for (const [chave, destino] of [
    ["vigilia", ".tela-olho"], ["notas", ".tela-reserva"], ["relatorio", ".tela-relatorio"],
  ] as const) {
    test(`destino de ${chave}: ${ESPERADO[chave].href}`, async ({ page }) => {
      await abrir(page, TODAS);
      await linha(page, chave).click();
      await expect(page).toHaveURL(new RegExp(ESPERADO[chave].href.replace(/[/#]/g, "\\$&") + "$"));
      await expect(page.locator(destino)).toBeVisible();
    });
  }

  // D1: o bloco ocupa o lugar onde a linha do Olho e as Notas pendentes
  // estavam: logo abaixo do hero e do "Ver histórico", antes dos 7 dias.
  test("posição (D1): depois do hero e do 'Ver histórico', antes dos 'Últimos 7 dias', no DOM e na tela", async ({ page }) => {
    await abrir(page, TODAS);
    const ordem = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="pede-atencao"]')!;
      const link = document.querySelector(".raiox .hero-chart-link")!;
      const r7d = document.querySelector(".raiox .raiox-7d")!;
      const vazio = document.querySelector(".raiox .r7d-vazio")!;
      const segue = (a: Element, x: Element) => !!(a.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING);
      return { depoisDoLink: segue(link, b), antesDos7d: segue(b, r7d) && segue(b, vazio) };
    });
    expect(ordem).toEqual({ depoisDoLink: true, antesDos7d: true });
    const caixa = (await bloco(page).boundingBox())!;
    const link = (await page.locator(".raiox .hero-chart-link").boundingBox())!;
    expect(caixa.y).toBeGreaterThanOrEqual(link.y + link.height);
    const r7d = page.locator(".raiox .raiox-7d");
    await expect(r7d).toBeVisible();
    expect(caixa.y + caixa.height).toBeLessThanOrEqual((await r7d.boundingBox())!.y);
  });

  test("Hoje sem os removidos: nenhum dos quatro cartões nem a linha antiga do Olho", async ({ page }) => {
    await abrir(page, TODAS);
    await expect(bloco(page)).toBeVisible();
    const raiox = page.locator("section.raiox");
    for (const sel of [".rel-card-home", ".proj-card-home", ".renda-card-home", ".diag-card-home", ".olho-raiox"]) {
      await expect(raiox.locator(sel), sel).toHaveCount(0);
    }
  });
});

// O alerta das notas cabia no olhar de 5 segundos quando a conferência morava
// no Hoje (7a.BZ.3). A conferência foi para Raio-X › Reserva; quem leva o
// alerta ao Hoje agora é o item "Notas pendentes", acima dos 7 dias e visível
// ao abrir, sem rolar.
test("Notas pendentes no Hoje: com conferência pendente o alerta aparece acima dos 7 dias, sem rolar", async ({ page }) => {
  await abrir(page, { ...NENHUMA, notas: true });
  const l = linha(page, "notas");
  await expect(l).toBeVisible();
  await expect(l).toBeInViewport();
  const r7d = (await page.locator(".raiox .raiox-7d").boundingBox())!;
  expect((await l.boundingBox())!.y).toBeLessThan(r7d.y);
  await l.click();
  await expect(page.getByTestId("conferencia")).toBeVisible();
});

test.describe("Pede atenção: 375×667, claro e Plantão", () => {
  for (const tema of [null, "dark"] as const) {
    test(`375 ${tema ?? "claro"}: sem transbordo, com os três itens e sem nenhum`, async ({ page, browser }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await abrir(page, TODAS, { tema });
      await expect(bloco(page)).toBeVisible();
      await semTransbordo(page, ".raiox");
      await page.screenshot({ path: `test-results/pede-atencao-375-${tema ?? "claro"}-tres.png`, fullPage: true });
      const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
      const outra = await ctx.newPage();
      await abrir(outra, NENHUMA, { tema });
      await expect(outra.getByTestId("pede-atencao")).toHaveCount(0);
      await semTransbordo(outra, ".raiox");
      await outra.screenshot({ path: `test-results/pede-atencao-375-${tema ?? "claro"}-nenhum.png`, fullPage: true });
      await ctx.close();
    });
  }
});
