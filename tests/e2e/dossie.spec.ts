import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

// Fase 7a.R.3.b — tela do dossiê de empresa (#/dossie/<TICKER>).
// Fixtures 100% SINTÉTICAS: o sibling é público e o `.enc` decifra com o PIN
// de teste público (feedback_sibling_fixtures_sinteticas).

const F = (n: string) =>
  fs.readFileSync(path.join(__dirname, "../fixtures/" + n), "utf-8");
const PORTFOLIO = F("portfolio.test.json.enc");
const IDX_REL = F("relatorios_index.test.json.enc");
const MAIO = F("relatorio_2026-05.test.json.enc");
const IDX_DOSSIES = F("dossies_index.test.json.enc");
const DOSSIES: Record<string, string> = {
  AMZN: F("dossie_AMZN.test.json.enc"),
  HGLG11: F("dossie_HGLG11.test.json.enc"),
  ITSA4: F("dossie_ITSA4.test.json.enc"),
  SMAL11: F("dossie_SMAL11.test.json.enc"),
};
// 7a.W.2: o nome PEDIDO virou HMAC e não carrega mais o ticker — que é
// exatamente o ponto da mudança. O nome EM DISCO segue `dossie_<TICKER>.test`,
// legível para quem mantém o teste; o mapa (gerado por gerar_fixture.py) faz a
// ponte URL → fixture.
const MAPA: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../fixtures/dossies_map.test.json"), "utf-8"),
);
const arqDe = (ticker: string) =>
  Object.keys(MAPA).find((k) => MAPA[k] === ticker)!;

test.use({ viewport: { width: 390, height: 844 } });

// `**/d_*.json.enc` NÃO casa `dossies_index.json.enc` — as duas rotas convivem
// sem ordem de registro importar.
async function mockTudo(page: Page, opts: { indice?: "ok" | "404" } = {}) {
  await page.route("**/portfolio.json.enc", (r) =>
    r.fulfill({ status: 200, body: PORTFOLIO, contentType: "text/plain" }));
  await page.route("**/relatorios_index.json.enc", (r) =>
    r.fulfill({ status: 200, body: IDX_REL, contentType: "text/plain" }));
  await page.route("**/relatorio_*.json.enc", (r) =>
    r.fulfill({ status: 200, body: MAIO, contentType: "text/plain" }));
  await page.route("**/dossies_index.json.enc", (r) =>
    opts.indice === "404"
      ? r.fulfill({ status: 404, body: "", contentType: "text/plain" })
      : r.fulfill({ status: 200, body: IDX_DOSSIES, contentType: "text/plain" }));
  await page.route("**/d_*.json.enc", (r) => {
    const nome = r.request().url().split("/").pop()!.split("?")[0];
    const ticker = MAPA[nome];
    const body = ticker && DOSSIES[ticker];
    return body
      ? r.fulfill({ status: 200, body, contentType: "text/plain" })
      : r.fulfill({ status: 404, body: "", contentType: "text/plain" });
  });
}

async function autenticar(page: Page, opts: { indice?: "ok" | "404" } = {}) {
  await mockTudo(page, opts);
  await page.addInitScript(() => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem("pinTimestamp", String(Date.now() - 1 * 24 * 60 * 60 * 1000));
  });
  await page.goto("/");
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
}

// A tela é `x-show` (visível de forma síncrona na troca de rota) enquanto o
// conteúdo vive sob `x-if`. `.dossie-corpo` é o nó cuja visibilidade IMPLICA
// `dossieAtual` populado — a barreira vai nele, não no `x-show`
// (feedback_barreira_no_no_que_e_gate_de_dado).
async function abrirDossie(page: Page, ticker: string) {
  await page.goto("/#/dossie/" + ticker);
  await expect(page.locator(".tela-dossie")).toBeVisible();
  await expect(page.locator(".tela-dossie .dossie-corpo")).toBeVisible();
}

test.describe("7a.R.3.b Task 2 — rota, carga e estados", () => {
  test("deep-link #/dossie/HGLG11 abre a tela do dossiê", async ({ page }) => {
    await autenticar(page);
    await abrirDossie(page, "HGLG11");
    await expect(page.locator(".tela-dossie .breadcrumb .eyebrow")).toHaveText("Dossiê");
  });

  test("a tab anterior é preservada (push child de duas tabs)", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#alocacao");
    await expect(page.locator('.tab-bar a[data-tab="aloca"]'))
      .toHaveAttribute("aria-current", "page");
    await abrirDossie(page, "HGLG11");
    await expect(page.locator('.tab-bar a[data-tab="aloca"]'))
      .toHaveAttribute("aria-current", "page");
  });

  test("índice 404 (pré-primeira publicação): tudo silencioso, app segue", async ({ page }) => {
    await autenticar(page, { indice: "404" });
    const erros: string[] = [];
    page.on("pageerror", (e) => erros.push(String(e)));
    await expect(page.locator(".hero")).toBeVisible();
    expect(await page.evaluate(() => (window as any).Alpine.$data(
      document.querySelector("[x-data]")).dossieIndice)).toEqual([]);
    expect(erros).toEqual([]);
  });

  test("erro de fetch do dossiê: mensagem calma + tentar de novo", async ({ page }) => {
    await autenticar(page);
    await page.route("**/" + arqDe("HGLG11"), (r) =>
      r.fulfill({ status: 500, body: "", contentType: "text/plain" }));
    await page.goto("/#/dossie/HGLG11");
    await expect(page.locator(".tela-dossie .dossie-erro")).toBeVisible();
    await expect(page.locator(".tela-dossie .dossie-erro")).toContainText("dossiê");
    await expect(page.locator(".tela-dossie .dossie-erro__acao")).toBeVisible();
    await expect(page.locator(".tela-dossie .dossie-corpo")).toHaveCount(0);
  });

  test("ticker fora do índice: estado vazio, sem tela quebrada", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#/dossie/BOVA11");
    await expect(page.locator(".tela-dossie .dossie-vazio")).toBeVisible();
  });

  // Guarda de não-colisão: a tela do dossiê NÃO pode introduzir um segundo
  // `.rel-erro`/`.rel-vazio`/`.rel-corpo` no DOM — os testes do Relatório
  // localizam essas classes SEM escopo, e um segundo nó os quebra por strict
  // mode. Esta é a regressão real que a Task 2 pegou.
  test("estados do dossiê não colidem com as classes do Relatório", async ({ page }) => {
    await autenticar(page);
    await abrirDossie(page, "HGLG11");
    for (const cls of [".rel-erro", ".rel-vazio", ".rel-corpo", ".rel-loading"]) {
      await expect(page.locator(".tela-dossie " + cls)).toHaveCount(0);
    }
  });

  test("formatters de data não deslocam o dia por fuso", async ({ page }) => {
    await autenticar(page);
    expect(await page.evaluate(() => (window as any).formatDataIso("2024-12-31")))
      .toBe("31/12/2024");
    expect(await page.evaluate(() => (window as any).formatMarcoMes("2024-12-31")))
      .toBe("DEZ 2024");
    expect(await page.evaluate(() => (window as any).formatMarcoMes("2026-03-01")))
      .toBe("MAR 2026");
    expect(await page.evaluate(() => (window as any).formatDataIso("lixo"))).toBe("");
  });
});

test.describe("7a.R.3.b Task 3 — cabeçalho, arco, frescor e tese", () => {
  test("cabeçalho: dot da categoria, bandeira do escopo, ticker, nome", async ({ page }) => {
    await autenticar(page);
    await abrirDossie(page, "HGLG11");
    await expect(page.locator(".tela-dossie .dossie-ticker")).toHaveText("HGLG11");
    await expect(page.locator(".tela-dossie .dossie-sub")).toContainText("FII");
    await expect(page.locator(".tela-dossie .dossie-cabecalho .flag")).toHaveText("🇧🇷");
    // FII → --cat-fii (ocre), não o fallback --g-700.
    const cor = await page.locator(".tela-dossie .dossie-dot")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(cor).toBe("rgb(184, 115, 31)");
  });

  test("ponte de vocabulário: 'Ação BR' e 'Exterior' NÃO caem no fallback teal", async ({ page }) => {
    await autenticar(page);
    await abrirDossie(page, "SMAL11"); // categoria "Ação BR" → --cat-acoes-br
    expect(await page.locator(".tela-dossie .dossie-dot")
      .evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(4, 120, 87)");
    await abrirDossie(page, "AMZN");   // categoria "Exterior" → --cat-eua
    expect(await page.locator(".tela-dossie .dossie-dot")
      .evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(30, 96, 145)");
    await expect(page.locator(".tela-dossie .dossie-cabecalho .flag")).toHaveText("🇺🇸");
  });

  test("mini-mapa: um glifo por entrada, na ordem cronológica, com par sr-only", async ({ page }) => {
    await autenticar(page);
    await abrirDossie(page, "HGLG11");
    // Um glifo por ENTRADA (4), mas o rótulo do ano só na primeira ocorrência
    // de cada ano — 12 dos 39 dossiês reais têm mais de uma entrada por ano
    // (KNRI11 tem três em 2026) e "2026 2026 2026" gagueja.
    await expect(page.locator(".tela-dossie .dossie-arco__marca")).toHaveCount(4);
    expect(await page.locator(".tela-dossie .dossie-arco__ano").allTextContents())
      .toEqual(["2024", "2025", "2026", ""]);
    expect(await page.locator(".tela-dossie .dossie-arco__marca").allTextContents())
      .toEqual(["●", "●", "◐", "▽"]);
    // Forma + texto, nunca cor sozinha: os glifos são aria-hidden e o par
    // .sr-only carrega a leitura.
    await expect(page.locator(".tela-dossie .dossie-arco__linha"))
      .toHaveAttribute("aria-hidden", "true");
    await expect(page.locator(".tela-dossie .dossie-arco .sr-only"))
      .toHaveText(/2024 tese intacta, 2025 tese intacta, 2026 sob pressão/);
  });

  test("frescor: dossiê com ultima_verificacao_leve null mostra só a última leitura", async ({ page }) => {
    await autenticar(page);
    await abrirDossie(page, "HGLG11");
    const t = await page.locator(".tela-dossie .dossie-frescor").textContent();
    expect(t).toContain("última leitura em 15/07/2026");
    expect(t).not.toContain("verificação leve");
  });

  test("frescor: cláusula de verificação leve é aditiva quando existe", async ({ page }) => {
    await autenticar(page);
    await abrirDossie(page, "SMAL11");
    await expect(page.locator(".tela-dossie .dossie-frescor"))
      .toHaveText("última leitura em 31/12/2025 · verificação leve em 15/06/2026");
  });

  test("tese lidera a tela e o grifo é EXATAMENTE um (anti-pattern #14)", async ({ page }) => {
    await autenticar(page);
    await abrirDossie(page, "HGLG11");
    await expect(page.locator(".tela-dossie .grifo")).toHaveCount(1);
    await expect(page.locator(".tela-dossie .dossie-grifo")).toContainText("quebra se");
    await expect(page.locator(".tela-dossie .dossie-revisada")).toHaveText(/27\/06\/2026/);
    // Ordem no DOM: cabeçalho → arco → frescor → tese.
    const ordem = await page.locator(
      ".tela-dossie .dossie-cabecalho, .tela-dossie .dossie-arco, " +
      ".tela-dossie .dossie-frescor, .tela-dossie .dossie-tese",
    ).evaluateAll((els) => els.map((e) => e.className.split(" ")[0]));
    expect(ordem).toEqual(["dossie-cabecalho", "dossie-arco", "dossie-frescor", "dossie-tese"]);
  });

  test("dossiê esqueleto: sem arco, sem frescor, sem grifo — tese ainda renderiza", async ({ page }) => {
    await autenticar(page);
    await abrirDossie(page, "ITSA4");
    await expect(page.locator(".tela-dossie .dossie-arco")).toBeHidden();
    await expect(page.locator(".tela-dossie .dossie-frescor")).toBeHidden();
    await expect(page.locator(".tela-dossie .grifo")).toHaveCount(0);
    await expect(page.locator(".tela-dossie .dossie-tese .rel-prosa")).toBeVisible();
  });
});

test.describe("7a.R.3.b Task 4 — linha do tempo", () => {
  test("ordem cronológica ASCENDENTE, todas as entradas abertas", async ({ page }) => {
    await autenticar(page);
    await abrirDossie(page, "HGLG11");
    await expect(page.locator(".tela-dossie .dossie-tl__item")).toHaveCount(4);
    expect(await page.locator(".tela-dossie .dossie-tl__data").allTextContents())
      .toEqual(["DEZ 2024", "DEZ 2025", "JUN 2026", "JUL 2026"]);
    // Nada colapsável: as 3 leituras estão visíveis sem nenhum clique.
    await expect(page.locator(".tela-dossie .dossie-tl__item .rel-prosa").nth(0)).toBeVisible();
    await expect(page.locator(".tela-dossie .dossie-tl__item .rel-prosa").nth(3)).toBeVisible();
  });

  test("selo certo por veredito, com forma + texto + cor", async ({ page }) => {
    await autenticar(page);
    await abrirDossie(page, "HGLG11");
    const selos = page.locator(".tela-dossie .dossie-tl__item .rel-selo");
    await expect(selos.nth(0)).toHaveClass(/rel-selo--intacta/);
    await expect(selos.nth(2)).toHaveClass(/rel-selo--pressao/);
    await expect(selos.nth(2)).toContainText("Sob pressão");
    await expect(selos.nth(2).locator(".rel-selo__marca"))
      .toHaveAttribute("aria-hidden", "true");
    await abrirDossie(page, "SMAL11");
    await expect(page.locator(".tela-dossie .dossie-tl__item .rel-selo").nth(1))
      .toHaveClass(/rel-selo--deteriorando/);
  });

  test("gatilho aparece como sub-linha da entrada", async ({ page }) => {
    await autenticar(page);
    await abrirDossie(page, "HGLG11");
    await expect(page.locator(".tela-dossie .dossie-tl__gatilho").nth(0))
      .toContainText("backfill histórico");
  });

  test("numeros_reportados como lista de definição — nunca grid de KPI", async ({ page }) => {
    await autenticar(page);
    await abrirDossie(page, "HGLG11");
    // Anti-goal §6.1: zero KPI vivo na tela.
    await expect(page.locator(".tela-dossie .kpi")).toHaveCount(0);
    const dl = page.locator(".tela-dossie .dossie-tl__item").nth(0).locator(".dossie-numeros");
    await expect(dl).toHaveCount(1);
    expect(await dl.locator("dt").allTextContents())
      .toEqual(["RECEITA EXEMPLO", "VACANCIA EXEMPLO", "DISTRIBUICAO EXEMPLO"]);
    // Citações congeladas: prosa sans, sem tnum e sem mono.
    const dd = dl.locator("dd").nth(1);
    await expect(dd).toContainText("física de exemplo");
    const est = await dd.evaluate((el) => {
      const s = getComputedStyle(el);
      return { ff: s.fontFamily, fvn: s.fontVariantNumeric };
    });
    expect(est.ff).not.toMatch(/mono/i);
    expect(est.fvn).not.toMatch(/tabular-nums/);
  });

  test("fontes no rodapé da entrada: link externo seguro e alvo ≥44px", async ({ page }) => {
    await autenticar(page);
    await abrirDossie(page, "HGLG11");
    const links = page.locator(".tela-dossie .dossie-tl__item").nth(2).locator(".dossie-fontes a");
    await expect(links).toHaveCount(2);
    await expect(links.nth(0)).toHaveAttribute("target", "_blank");
    await expect(links.nth(0)).toHaveAttribute("rel", "noopener");
    await expect(links.nth(0)).toHaveAttribute("href", /^https:\/\/example\.com\//);
    const box = await links.nth(0).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test("timeline vazia mostra 'sem entradas ainda'", async ({ page }) => {
    await autenticar(page);
    await abrirDossie(page, "ITSA4");
    await expect(page.locator(".tela-dossie .dossie-tl__item")).toHaveCount(0);
    await expect(page.locator(".tela-dossie .dossie-tl-vazio")).toHaveText("sem entradas ainda");
  });
});

test.describe("7a.R.3.b Task 5 — entradas e voltar", () => {
  test("#ativo: a entrada aparece quando temDossie e some quando não tem", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#ativo/HGLG11");                     // está no índice
    await expect(page.locator(".tela-ativo .dossie-entrada")).toBeVisible();
    await expect(page.locator(".tela-ativo .dossie-entrada")).toContainText("Dossiê");
    const box = await page.locator(".tela-ativo .dossie-entrada").boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await page.goto("/#ativo/VOO");                        // fora do índice
    await expect(page.locator(".tela-ativo .dossie-entrada")).toBeHidden();
  });

  test("#ativo → dossiê → voltar retorna ao #ativo de origem", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#ativo/HGLG11");
    await page.locator(".tela-ativo .dossie-entrada").click();
    await expect(page).toHaveURL(/#\/dossie\/HGLG11$/);
    await expect(page.locator(".tela-dossie .dossie-corpo")).toBeVisible();
    await page.locator(".tela-dossie .breadcrumb button").click();
    await expect(page).toHaveURL(/#ativo\/HGLG11$/);
    await expect(page.locator(".tela-ativo")).toBeVisible();
  });

  test("Relatório: ticker com dossiê vira link; sem dossiê fica texto", async ({ page }) => {
    await autenticar(page);
    await page.locator(".rel-card-home").click();
    await expect(page.locator(".tela-relatorio .rel-corpo")).toBeVisible();
    // SMAL11 está no índice; HASH11 e KISU11 não.
    await expect(page.locator(".rel-radar-card__ticker--link")).toHaveCount(1);
    await expect(page.locator(".rel-radar-card__ticker--link")).toHaveText("SMAL11");
    await expect(page.locator(".rel-radar-card__ticker--link"))
      .toHaveAttribute("href", "#/dossie/SMAL11");
    // O selo de veredito continua exatamente onde estava, ao lado.
    await expect(page.locator(".tela-relatorio .rel-radar-card .rel-selo")).toHaveCount(3);
  });

  test("Relatório → dossiê → voltar retorna ao Relatório", async ({ page }) => {
    await autenticar(page);
    await page.locator(".rel-card-home").click();
    await expect(page.locator(".tela-relatorio .rel-corpo")).toBeVisible();
    await page.locator(".rel-radar-card__ticker--link").click();
    await expect(page).toHaveURL(/#\/dossie\/SMAL11$/);
    await expect(page.locator(".tela-dossie .dossie-corpo")).toBeVisible();
    await page.locator(".tela-dossie .breadcrumb button").click();
    await expect(page).toHaveURL(/#\/raiox\/relatorio$/);
    await expect(page.locator(".tela-relatorio")).toBeVisible();
  });

  test("deep-link sem origem: voltar cai no #ativo do próprio ticker", async ({ page }) => {
    await autenticar(page);
    await abrirDossie(page, "AMZN");
    await page.locator(".tela-dossie .breadcrumb button").click();
    await expect(page).toHaveURL(/#ativo\/AMZN$/);
  });

  test("índice 404: nenhuma entrada em lugar nenhum", async ({ page }) => {
    await autenticar(page, { indice: "404" });
    await page.goto("/#ativo/HGLG11");
    await expect(page.locator(".tela-ativo .dossie-entrada")).toBeHidden();
    await page.goto("/#/raiox/relatorio");
    await expect(page.locator(".tela-relatorio .rel-corpo")).toBeVisible();
    await expect(page.locator(".rel-radar-card__ticker--link")).toHaveCount(0);
  });
});

test.describe("7a.R.3.b Task 6 — responsivo, Modo Plantão e a11y", () => {
  for (const w of [390, 320]) {
    test(`sem overflow horizontal a ${w}px`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 800 });
      await autenticar(page);
      await abrirDossie(page, "HGLG11");
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test("Modo Plantão: tela legível, sem overflow, tokens resolvem no dark", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("tema", "dark"));
    await autenticar(page);
    await abrirDossie(page, "HGLG11");
    expect(await page.evaluate(() =>
      document.documentElement.getAttribute("data-theme"))).toBe("dark");
    // Texto de leitura não pode colapsar no fundo.
    const cores = await page.locator(".tela-dossie .dossie-tl__item .rel-prosa").first()
      .evaluate((el) => ({
        fg: getComputedStyle(el).color,
        bg: getComputedStyle(document.body).backgroundColor,
      }));
    expect(cores.fg).not.toBe(cores.bg);
    // O grifo mantém o border-left accent no dark.
    const bl = await page.locator(".tela-dossie .grifo")
      .evaluate((el) => getComputedStyle(el).borderLeftWidth);
    expect(bl).toBe("3px");
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("hierarquia de headings: h1 Dossiê → h2 seções → h3 marcos", async ({ page }) => {
    await autenticar(page);
    await abrirDossie(page, "HGLG11");
    // Sequencial, sem pular nível: 1 h1 ("Dossiê") → 2 h2 (Tese, Linha do
    // tempo) → 1 h3 por entrada. Contado a partir da timeline, não fixado num
    // número, para o teste não amarrar na contagem de entradas da fixture.
    const niveis = await page.locator(
      ".tela-dossie h1, .tela-dossie h2, .tela-dossie h3",
    ).evaluateAll((els) => els.map((e) => e.tagName));
    const entradas = await page.locator(".tela-dossie .dossie-tl__item").count();
    expect(niveis).toEqual(["H1", "H2", "H2", ...Array(entradas).fill("H3")]);
  });

  test("botão voltar tem alvo ≥44px e rótulo acessível", async ({ page }) => {
    await autenticar(page);
    await abrirDossie(page, "HGLG11");
    const btn = page.locator(".tela-dossie .breadcrumb button");
    await expect(btn).toHaveAttribute("aria-label", "Voltar");
    const box = await btn.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});

// Estes dois defeitos só apareceram na verificação visual REAL (Playwright MCP
// contra os 39 dossiês de produção) — a fixture original, curta e com nome
// distinto do ticker, não os expunha. Ambos são amplos, não casos de borda.
test.describe("7a.R.3.b Task 7 — correções da verificação visual real", () => {
  test("sub-linha não repete o ticker quando nome == ticker (29 dos 39 reais)", async ({ page }) => {
    await autenticar(page);
    await abrirDossie(page, "HGLG11"); // nome == "HGLG11"
    await expect(page.locator(".tela-dossie .dossie-ticker")).toHaveText("HGLG11");
    // Sobra só a categoria — sem "HGLG11 · FII" logo sob o "HGLG11" grande.
    await expect(page.locator(".tela-dossie .dossie-sub")).toHaveText("FII");
  });

  test("sub-linha mantém o nome quando ele acrescenta informação", async ({ page }) => {
    await autenticar(page);
    await abrirDossie(page, "SMAL11"); // nome == "Empresa de Exemplo Dois"
    await expect(page.locator(".tela-dossie .dossie-sub"))
      .toHaveText("Empresa de Exemplo Dois · Ação BR");
  });

  test("mini-mapa: glifos alinhados mesmo com o rótulo do ano omitido", async ({ page }) => {
    await autenticar(page);
    await abrirDossie(page, "HGLG11"); // 2 entradas em 2026 → 2º rótulo vazio
    const tops = await page.locator(".tela-dossie .dossie-arco__marca")
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    // Sem reservar a linha do rótulo, o span vazio colapsa e o glifo sobe ~11px.
    expect(new Set(tops).size).toBe(1);
  });

  test("mini-mapa: leitor de tela recebe o ano de TODAS as entradas", async ({ page }) => {
    await autenticar(page);
    await abrirDossie(page, "HGLG11");
    // O rótulo visual omite o ano repetido, mas o par .sr-only não pode: sem
    // ancoragem temporal a leitura auditiva do arco fica ambígua.
    await expect(page.locator(".tela-dossie .dossie-arco .sr-only"))
      .toHaveText("Arco da tese: 2024 tese intacta, 2025 tese intacta, "
        + "2026 sob pressão, 2026 deteriorando");
  });
});

// Findings do code-review-board (2026-07-26), todos Suggestion, auto-aplicados.
test.describe("7a.R.3.b CRB — findings auto-aplicados", () => {
  test("CRB#1: não sobra helper morto de navegação do dossiê", async ({ page }) => {
    await autenticar(page);
    const d = await page.evaluate(() => {
      const app = (window as any).Alpine.$data(document.querySelector("[x-data]"));
      return { temAbrirDossie: typeof app.abrirDossie,
               temRegistrar: typeof app.registrarOrigemDossie };
    });
    // `abrirDossie` era dead code: o markup usa <a href> real e só registra a
    // origem no @click. O método nomeado substitui a expressão inline nos 3
    // call sites (entrada do #ativo + radar + prestação do Relatório).
    expect(d.temAbrirDossie).toBe("undefined");
    expect(d.temRegistrar).toBe("function");
    // Os links só existem dentro do #ativo / do Relatório — contar na home
    // daria 0 e o teste passaria por vacuidade.
    await page.goto("/#ativo/HGLG11");
    await expect(page.locator('.tela-ativo a[href="#/dossie/HGLG11"]')).toBeVisible();
    await expect(page.locator('.tela-ativo a[href="#/dossie/HGLG11"]'))
      .toHaveAttribute("@click", /registrarOrigemDossie/);
  });

  test("CRB#2: lock manual descarta o dossiê decifrado da memória", async ({ page }) => {
    await autenticar(page);
    await abrirDossie(page, "HGLG11");
    const antes = await page.evaluate(() => {
      const a = (window as any).Alpine.$data(document.querySelector("[x-data]"));
      return { atual: !!a.dossieAtual, indice: a.dossieIndice.length };
    });
    expect(antes).toEqual({ atual: true, indice: 4 });
    const depois = await page.evaluate(() => {
      const a = (window as any).Alpine.$data(document.querySelector("[x-data]"));
      a.bloquear();
      return { atual: !!a.dossieAtual, indice: a.dossieIndice.length,
               carregado: a.dossieCarregado, origem: a.dossieOrigem };
    });
    expect(depois).toEqual({ atual: false, indice: 0, carregado: "", origem: "" });
  });

  test("CRB#3: URL de fonte com scheme não-http degrada para texto", async ({ page }) => {
    await autenticar(page);
    const r = await page.evaluate(() => {
      const a = (window as any).Alpine.$data(document.querySelector("[x-data]"));
      return {
        https: a.urlFonteSegura("https://example.com/x"),
        http: a.urlFonteSegura("http://example.com/x"),
        js: a.urlFonteSegura("javascript:alert(1)"),
        jsEspaco: a.urlFonteSegura("  JavaScript:alert(1)"),
        data: a.urlFonteSegura("data:text/html,<script>"),
        vazio: a.urlFonteSegura(""),
        nulo: a.urlFonteSegura(null),
      };
    });
    expect(r.https).toBe("https://example.com/x");
    expect(r.http).toBe("http://example.com/x");
    expect(r.js).toBeNull();
    expect(r.jsEspaco).toBeNull();
    expect(r.data).toBeNull();
    expect(r.vazio).toBeNull();
    expect(r.nulo).toBeNull();
    // A fixture só tem URLs https → todas as fontes seguem linkadas.
    await abrirDossie(page, "HGLG11");
    await expect(page.locator(".tela-dossie .dossie-fontes a").first())
      .toHaveAttribute("href", /^https:\/\//);
  });
});
