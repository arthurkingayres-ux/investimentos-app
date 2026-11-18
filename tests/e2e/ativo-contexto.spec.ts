import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";
import { cifrar, decifrar } from "./comite-comum";
import { abrirOlho } from "./olho-comum";

// 7a.CC.3 — o contexto do ativo (spec 7a.CC §5.9): Posição · Dossiê · Retorno
// esperado viram telas irmãs, com uma faixa própria logo abaixo do
// `.breadcrumb`. O Retorno esperado sai da rolagem do Dossiê e ganha endereço
// próprio (`#/dossie/:t/retorno`).
//
// O bloco de retorno não tem predicado próprio: renderiza sempre que o dossiê
// renderiza (ativo fora do bloco mostra "Retorno esperado indisponível hoje.").
// Por isso, com o código de hoje, a faixa tem 3 segmentos ou nenhum.
//
// Nenhuma fixture nova: o portfolio da suíte decifrado, com o bloco
// `retorno.sintetico.json` injetado; dossiês sintéticos mínimos (EMPR3, SEMB3,
// tickers inventados) acrescentados ao índice na hora.

const F = (n: string) => fs.readFileSync(path.join(__dirname, "../fixtures/" + n), "utf-8");
const PORTFOLIO_CLARO = decifrar(F("portfolio.test.json.enc"));
const IDX_REL = F("relatorios_index.test.json.enc");
const IDX_DOSSIES_CLARO = decifrar(F("dossies_index.test.json.enc"));
const RETORNO = () => JSON.parse(F("retorno.sintetico.json"));

// Os três estados do bloco, todos com dossiê: EMPR3 no bloco com faixa
// ("faixa"), CRIP11 no bloco sem faixa ("sem_faixa", motivo cripto) e SEMB3
// fora do bloco ("ausente").
const SINTETICOS = ["EMPR3", "CRIP11", "SEMB3"];
const arquivo = (t: string) => `d_ctx_${t.toLowerCase()}.json.enc`;

function dossie(ticker: string): any {
  return {
    schema: "dossie_empresa_v1",
    ticker,
    nome: "Exemplo " + ticker,
    escopo: "Brasil",
    categoria: "Ação BR",
    ri_portal_url: null,
    aberto_em: "2026-01-02",
    tese: { resumo: "Tese sintética de exemplo.", quebra_se: "Margem abaixo de 20% por dois trimestres.", revisada_em: null },
    ultima_verificacao_leve: null,
    timeline: [],
  };
}

// Primeira posição da fixture que NÃO está no índice de dossiês (calculada, não
// fixada: o teste não amarra num ticker da fixture).
const SEM_DOSSIE: string = (() => {
  const noIndice = new Set(IDX_DOSSIES_CLARO.dossies.map((d: any) => d.ticker));
  const p = PORTFOLIO_CLARO.posicoes.find((x: any) => !noIndice.has(x.ticker));
  return p.ticker;
})();

async function mockTudo(page: Page) {
  const p = JSON.parse(JSON.stringify(PORTFOLIO_CLARO));
  p.retorno_esperado = RETORNO();
  const portfolio = cifrar(JSON.stringify(p));
  const idx = JSON.parse(JSON.stringify(IDX_DOSSIES_CLARO));
  idx.dossies.push(...SINTETICOS.map((t) => ({
    ticker: t, nome: "Exemplo " + t, categoria: "Ação BR", escopo: "Brasil", arquivo: arquivo(t), sha256: "x",
  })));
  const idxCifrado = cifrar(JSON.stringify(idx));
  const cifrados: Record<string, string> = {};
  await page.route("**/portfolio.json.enc", (r) => r.fulfill({ status: 200, body: portfolio, contentType: "text/plain" }));
  await page.route("**/relatorios_index.json.enc", (r) => r.fulfill({ status: 200, body: IDX_REL, contentType: "text/plain" }));
  await page.route("**/dossies_index.json.enc", (r) => r.fulfill({ status: 200, body: idxCifrado, contentType: "text/plain" }));
  await page.route("**/d_*.json.enc", (r) => {
    const nome = r.request().url().split("/").pop()!.split("?")[0];
    const t = SINTETICOS.find((k) => arquivo(k) === nome);
    if (!t) return r.fulfill({ status: 404, body: "", contentType: "text/plain" });
    cifrados[nome] ??= cifrar(JSON.stringify(dossie(t)));
    return r.fulfill({ status: 200, body: cifrados[nome], contentType: "text/plain" });
  });
  await page.addInitScript(() => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem("pinTimestamp", String(Date.now() - 24 * 60 * 60 * 1000));
  });
}

// Sessão que começa no Hoje e só depois troca o hash (origem conhecida: o Hoje).
async function entrar(page: Page, hash: string) {
  await mockTudo(page);
  await page.goto("/");
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
  await page.evaluate((h) => { location.hash = h; }, hash);
}

// Deep link de verdade: o hash é a 1ª navegação da página.
async function deepLink(page: Page, hash: string) {
  await mockTudo(page);
  await page.goto("/" + hash);
}

const faixaDe = (page: Page, tela: string) => page.locator(`${tela} nav.faixa-ativo`);
const voltar = (page: Page) => page.getByRole("button", { name: /^Voltar/ });
const hashAgora = (page: Page) => page.evaluate(() => location.hash);
const barraAtiva = (page: Page) => page.locator('.tab-bar [aria-current="page"]');
const TELAS: [string, string, string][] = [
  // [hash, seletor da tela, segmento ativo]
  ["#ativo/EMPR3", ".tela-ativo", "Posição"],
  ["#/dossie/EMPR3", ".tela-dossie", "Dossiê"],
  ["#/dossie/EMPR3/retorno", ".tela-retorno", "Retorno esperado"],
];

test.use({ viewport: { width: 390, height: 844 } });

test.describe("7a.CC.3 — a faixa do ativo", () => {
  test("com dossiê: três segmentos, na ordem, com o atual marcado nas três telas", async ({ page }) => {
    await entrar(page, "#ativo/EMPR3");
    for (const [hash, tela, atual] of TELAS) {
      await page.evaluate((h) => { location.hash = h; }, hash);
      await expect(page.locator(tela)).toBeVisible();
      const nav = faixaDe(page, tela);
      await expect(nav).toHaveAttribute("aria-label", "Telas de EMPR3");
      await expect(nav.locator("a")).toHaveText(["Posição", "Dossiê", "Retorno esperado"]);
      const hrefs = await nav.locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
      expect(hrefs).toEqual(["#ativo/EMPR3", "#/dossie/EMPR3", "#/dossie/EMPR3/retorno"]);
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
      await expect(nav.locator('[aria-current="page"]')).toHaveText(atual);
      // Logo abaixo do .breadcrumb, que mantém "←" e o ticker.
      const ordem = await page.locator(tela).evaluate((s) =>
        Array.from(s.children).filter((c) => c.tagName !== "TEMPLATE").slice(0, 2).map((c) => c.tagName + "." + c.className));
      expect(ordem[0]).toMatch(/^HEADER\.breadcrumb/);
      expect(ordem[1]).toMatch(/^NAV\.faixa/);
      await expect(page.locator(`${tela} .breadcrumb .eyebrow--accent`)).toContainText("EMPR3");
      await expect(page.locator(`${tela} .breadcrumb button[aria-label="Voltar"]`)).toBeVisible();
    }
  });

  test("sem dossiê: nenhuma faixa, a Posição de sempre", async ({ page }) => {
    await entrar(page, "#ativo/" + SEM_DOSSIE);
    await expect(page.locator(".tela-ativo .ticker-hero")).toContainText(SEM_DOSSIE);
    await expect(page.locator(".tela-ativo nav")).toHaveCount(0);
    await expect(page.locator("nav.faixa-ativo")).toHaveCount(0);
  });

  test("dossiê fora do bloco de retorno: o segmento existe e a tela diz indisponível", async ({ page }) => {
    await entrar(page, "#/dossie/SEMB3");
    await expect(page.locator(".tela-dossie .dossie-corpo")).toBeVisible();
    const nav = faixaDe(page, ".tela-dossie");
    await expect(nav.locator("a")).toHaveText(["Posição", "Dossiê", "Retorno esperado"]);
    await nav.locator("a", { hasText: "Retorno esperado" }).click();
    expect(await hashAgora(page)).toBe("#/dossie/SEMB3/retorno");
    await expect(page.locator(".tela-retorno [data-testid='retorno-indisponivel']"))
      .toHaveText("Retorno esperado indisponível hoje.");
  });

  test("dossiê no bloco sem faixa: o segmento existe e a tela diz o motivo", async ({ page }) => {
    await entrar(page, "#ativo/CRIP11");
    const nav = faixaDe(page, ".tela-ativo");
    await expect(nav.locator("a")).toHaveText(["Posição", "Dossiê", "Retorno esperado"]);
    await nav.locator("a", { hasText: "Retorno esperado" }).click();
    expect(await hashAgora(page)).toBe("#/dossie/CRIP11/retorno");
    const motivo = await page.evaluate(() => (window as any).retornoEsperado.MOTIVOS.cripto);
    await expect(page.locator(".tela-retorno [data-testid='retorno-motivo']")).toHaveText(motivo);
    await expect(page.locator(".tela-retorno [data-testid='retorno-regua']")).toHaveCount(0);
  });

  test("dossiê no bloco com faixa: o segmento existe e a tela mostra a faixa", async ({ page }) => {
    await entrar(page, "#ativo/EMPR3");
    await faixaDe(page, ".tela-ativo").locator("a", { hasText: "Retorno esperado" }).click();
    expect(await hashAgora(page)).toBe("#/dossie/EMPR3/retorno");
    await expect(page.locator(".tela-retorno [data-testid='retorno-frase']")).toBeVisible();
    await expect(page.locator(".tela-retorno [data-testid='retorno-indisponivel']")).toHaveCount(0);
  });

  test("a linha .dossie-entrada saiu do fim da Posição", async ({ page }) => {
    await entrar(page, "#ativo/HGLG11");
    await expect(page.locator(".tela-ativo .ticker-hero")).toBeVisible();
    await expect(page.locator(".dossie-entrada")).toHaveCount(0);
    await expect(faixaDe(page, ".tela-ativo").locator("a", { hasText: "Dossiê" })).toBeVisible();
  });
});

test.describe("7a.CC.3 — Dossiê e Retorno esperado separados", () => {
  test("#/dossie/T não contém o bloco de retorno", async ({ page }) => {
    await entrar(page, "#/dossie/EMPR3");
    await expect(page.locator(".tela-dossie .dossie-corpo")).toBeVisible();
    await expect(page.locator(".tela-dossie .dossie-tese")).toBeVisible();
    await expect(page.locator("[data-testid^='retorno-']")).toHaveCount(0);
    await expect(page.locator(".dossie-retorno")).toHaveCount(0);
    await expect(page.locator("[data-testid='dossie-retorno']")).toHaveCount(0);
  });

  test("#/dossie/T/retorno: só o bloco, com os mesmos data-testid e textos", async ({ page }) => {
    await entrar(page, "#/dossie/EMPR3/retorno");
    const s = page.locator(".tela-retorno [data-testid='dossie-retorno']");
    await expect(s).toBeVisible();
    await expect(s.locator("h2")).toHaveText("Retorno esperado");
    await expect(s.getByTestId("retorno-frase")).toHaveText(
      "Ao preço de hoje, entre 4,0% e 9,5% ao ano acima da inflação; o meio da conta dá 7,2%.",
    );
    await expect(s.getByTestId("retorno-dispersao")).toHaveText("Num ano qualquer, este ativo variou cerca de ±24,3 pontos.");
    await expect(s.getByTestId("retorno-datas")).toHaveText("Fundamentos de 31/12/25 · preço de 10/11");
    await expect(s.getByTestId("retorno-honestidade")).toHaveText(
      "Estimativa. É a peça mais incerta do app; o placar dirá se ela ordena bem. Até lá, não prova nada.",
    );
    await expect(s.getByTestId("retorno-regua")).toBeVisible();
    await expect(s.getByTestId("retorno-conta")).toBeVisible();
    // Nada do Dossiê na tela do retorno.
    await expect(page.locator(".tela-retorno .dossie-tese")).toHaveCount(0);
    await expect(page.locator(".tela-retorno .dossie-tl")).toHaveCount(0);
    await expect(page.locator(".tela-dossie")).toBeHidden();
  });
});

test.describe("7a.CC.3 — voltar e grupo", () => {
  test("Vigília → ativo → Posição → Retorno esperado → ← volta à Vigília", async ({ page }) => {
    await abrirOlho(page, { hash: "#olho" });
    await expect(page.locator(".tela-olho")).toBeVisible({ timeout: 10_000 });
    await page.locator(".olho-alerta__ticker", { hasText: "EMPR3" }).first().click();
    expect(await hashAgora(page)).toBe("#/dossie/EMPR3");
    await expect(page.locator(".tela-dossie .dossie-corpo")).toBeVisible();
    await expect(barraAtiva(page)).toHaveAttribute("data-tab", "carteira");
    await faixaDe(page, ".tela-dossie").locator("a", { hasText: "Posição" }).click();
    expect(await hashAgora(page)).toBe("#ativo/EMPR3");
    await expect(page.locator(".tela-ativo")).toBeVisible();
    await faixaDe(page, ".tela-ativo").locator("a", { hasText: "Retorno esperado" }).click();
    expect(await hashAgora(page)).toBe("#/dossie/EMPR3/retorno");
    await expect(page.locator(".tela-retorno")).toBeVisible();
    await expect(barraAtiva(page)).toHaveAttribute("data-tab", "carteira");
    await voltar(page).click();
    expect(await hashAgora(page)).toBe("#olho");
    await expect(page.locator(".tela-olho")).toBeVisible();
  });

  test("Hoje → ativo → Retorno esperado → ←: volta ao Hoje (a troca de segmento não muda a origem)", async ({ page }) => {
    await entrar(page, "#ativo/EMPR3");
    await faixaDe(page, ".tela-ativo").locator("a", { hasText: "Retorno esperado" }).click();
    await expect(page.locator(".tela-retorno")).toBeVisible();
    await expect(barraAtiva(page)).toHaveAttribute("data-tab", "raiox");
    await voltar(page).click();
    expect(await hashAgora(page)).toBe("");
    await expect(page.locator(".raiox")).toBeVisible();
  });

  for (const hash of ["#/dossie/EMPR3", "#/dossie/EMPR3/retorno"]) {
    test(`deep link ${hash}: Carteira acesa e ← leva a Carteira › Ativos`, async ({ page }) => {
      await deepLink(page, hash);
      // Conteúdo, não só a section: no retorno, o bloco de verdade.
      await expect(page.locator(hash.endsWith("/retorno")
        ? ".tela-retorno [data-testid^='retorno-']"
        : ".tela-dossie .dossie-corpo").first()).toBeVisible({ timeout: 10_000 });
      await expect(barraAtiva(page)).toHaveAttribute("data-tab", "carteira");
      await voltar(page).click();
      expect(await hashAgora(page)).toBe("#/carteira/ativos");
      await expect(page.locator(".tela-ativos")).toBeVisible();
      await expect(barraAtiva(page)).toHaveAttribute("data-tab", "carteira");
    });
  }
});

// Board da CC3.1: a tela do retorno não pode ficar em branco. Ela reusa os três
// estados da tela do Dossiê (mesmas condições, classes e textos) e só mostra o
// bloco quando o corpo do dossiê renderizaria.
test.describe("7a.CC.3 — estados da tela do retorno", () => {
  test("deep link num ticker sem dossiê: o mesmo vazio da tela do Dossiê", async ({ page }) => {
    await deepLink(page, "#/dossie/ZZZZ/retorno");
    const vazio = page.locator(".tela-retorno .dossie-vazio");
    await expect(vazio).toBeVisible({ timeout: 10_000 });
    await expect(vazio).toHaveText("Ainda não há dossiê para este ativo.");
    await expect(page.locator("[data-testid^='retorno-']")).toHaveCount(0);
  });

  test("arquivo do dossiê falhando: o mesmo erro da tela do Dossiê, com tentar de novo", async ({ page }) => {
    await mockTudo(page);
    await page.route("**/" + arquivo("EMPR3"), (r) => r.fulfill({ status: 500, body: "", contentType: "text/plain" }));
    await page.goto("/#/dossie/EMPR3/retorno");
    const erro = page.locator(".tela-retorno .dossie-erro");
    await expect(erro).toBeVisible({ timeout: 10_000 });
    await expect(erro.locator("p")).toHaveText("Não foi possível abrir o dossiê deste ativo.");
    await expect(erro.locator(".dossie-erro__acao")).toHaveText("Tentar de novo");
    await expect(page.locator("[data-testid^='retorno-']")).toHaveCount(0);
    await expect(page.locator(".tela-retorno .dossie-vazio")).toBeHidden();
  });

  test("índice de dossiês falhando: o mesmo vazio, sem tela em branco", async ({ page }) => {
    await mockTudo(page);
    await page.route("**/dossies_index.json.enc", (r) => r.fulfill({ status: 404, body: "", contentType: "text/plain" }));
    await page.goto("/#/dossie/EMPR3/retorno");
    await expect(page.locator(".tela-retorno .dossie-vazio")).toHaveText("Ainda não há dossiê para este ativo.", { timeout: 10_000 });
    await expect(page.locator("[data-testid^='retorno-']")).toHaveCount(0);
  });

  test("carregando: o mesmo esqueleto da tela do Dossiê, depois o bloco", async ({ page }) => {
    await mockTudo(page);
    let soltar!: () => void;
    const preso = new Promise<void>((r) => { soltar = r; });
    await page.route("**/" + arquivo("EMPR3"), async (r) => { await preso; await r.fallback(); });
    await page.goto("/#/dossie/EMPR3/retorno");
    await expect(page.locator(".tela-retorno .dossie-loading")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("[data-testid^='retorno-']")).toHaveCount(0);
    soltar();
    await expect(page.locator(".tela-retorno [data-testid='retorno-frase']")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".tela-retorno .dossie-loading")).toBeHidden();
  });
});

test.describe("7a.CC.3 — movimento", () => {
  // Lê o deslocamento horizontal da tela que entra, no quadro seguinte ao que
  // ela aparece: no push ela ainda está deslocada (translateX > 0); na troca
  // de segmento, só a opacidade anda.
  const transformAoEntrar = (page: Page, clicar: string, tela: string) =>
    page.evaluate(([sel, t]) => new Promise<number>((res) => {
      const el = document.querySelector(t) as HTMLElement;
      (document.querySelector(sel) as HTMLElement).click();
      const espera = () => requestAnimationFrame(() => {
        if (getComputedStyle(el).display === "none") return espera();
        requestAnimationFrame(() => res(new DOMMatrix(getComputedStyle(el).transform).m41));
      });
      espera();
    }), [clicar, tela]);

  test("troca de segmento é fade (sem deslocamento); entrar no ativo segue push", async ({ page }) => {
    await entrar(page, "#/carteira/ativos");
    await expect(page.locator(".tela-ativos")).toBeVisible();
    // Controle: entrar no contexto do ativo é push (desloca).
    await page.evaluate(() => {
      const a = document.createElement("a");
      a.href = "#ativo/EMPR3"; a.id = "ctx-teste"; document.body.appendChild(a);
    });
    const push = await transformAoEntrar(page, "#ctx-teste", ".tela-ativo");
    expect(push).toBeGreaterThan(0);
    await expect(faixaDe(page, ".tela-ativo")).toBeVisible();
    await page.waitForTimeout(400);
    const fade = await transformAoEntrar(page, ".tela-ativo nav.faixa-ativo a[href='#/dossie/EMPR3']", ".tela-dossie");
    expect(fade).toBe(0);
  });

  test("reduced motion: troca de segmento sem transição", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await entrar(page, "#ativo/EMPR3");
    await expect(faixaDe(page, ".tela-ativo")).toBeVisible();
    await faixaDe(page, ".tela-ativo").locator("a", { hasText: "Dossiê" }).click();
    const d = await page.locator(".tela-dossie").evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(d.split(",").every((x) => parseFloat(x) === 0)).toBe(true);
    await context.close();
  });
});

test.describe("7a.CC.3 — acessibilidade e largura", () => {
  for (const w of [320, 375, 390]) {
    test(`${w}px: um aria-current por nav, alvo ≥ 44px, corpo sem rolagem lateral, atual visível`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 800 });
      await entrar(page, "#ativo/EMPR3");
      for (const [hash, tela] of TELAS) {
        await page.evaluate((h) => { location.hash = h; }, hash);
        const nav = faixaDe(page, tela);
        await expect(nav).toBeVisible();
        await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
        await expect(page.locator('.tab-bar [aria-current="page"]')).toHaveCount(1);
        for (const a of await nav.locator("a").all()) {
          const box = await a.boundingBox();
          expect(box!.height).toBeGreaterThanOrEqual(44);
        }
        const transborda = await page.evaluate(() =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(transborda, `${hash} a ${w}px`).toBeLessThanOrEqual(0);
        // O segmento atual fica inteiro dentro da área visível da faixa.
        await expect.poll(async () => {
          const [f, a] = await nav.evaluate((n) => {
            const at = n.querySelector('[aria-current="page"]')!;
            return [n.getBoundingClientRect(), at.getBoundingClientRect()].map((r) => [r.left, r.right]);
          });
          return a[0] >= f[0] - 1 && a[1] <= f[1] + 1;
        }, { message: `${hash} a ${w}px` }).toBe(true);
      }
    });
  }
});
