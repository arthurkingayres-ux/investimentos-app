import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

const FIXTURE = fs.readFileSync(
  path.join(__dirname, "../fixtures/portfolio.test.json.enc"),
  "utf-8",
);

test.use({ viewport: { width: 390, height: 844 } });

// Injeta override de `json.ultimos_7d` via Alpine.$data antes de hidratar a tela.
// Replica o pattern de abrirAportarComMock (aportar.spec.ts) — força cenários
// específicos sem regenerar fixture binária.
async function abrirRaioxComUltimos7d(
  page: Page,
  override: Record<string, unknown> | null,
) {
  await page.route("**/portfolio.json.enc", (route) =>
    route.fulfill({ status: 200, body: FIXTURE, contentType: "text/plain" }),
  );
  await page.addInitScript((overrideStr) => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem(
      "pinTimestamp",
      String(Date.now() - 1 * 24 * 60 * 60 * 1000),
    );
    (window as any).__ultimos7dOverride =
      overrideStr === null ? null : JSON.parse(overrideStr);
  }, override === null ? null : JSON.stringify(override));
  await page.goto("/");
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => {
    const $data = (window as any).Alpine?.$data?.(document.body);
    if (!$data) {
      throw new Error(
        "abrirRaioxComUltimos7d: Alpine.$data(document.body) é undefined",
      );
    }
    const o = (window as any).__ultimos7dOverride;
    if (o === null) {
      delete $data.json.ultimos_7d;
    } else {
      $data.json.ultimos_7d = o;
    }
  });
}

const FIXTURE_ATIVA = {
  janela_dias: 7,
  data_corte: "2026-05-09",
  delta_patrim_brl: 4270.0,
  delta_patrim_pct: 0.016,
  decomposicao: {
    aportes_liq_brl: 11300.0,
    proventos_brl: 500.0,
    mercado_brl: -7530.0,
  },
  compras: [
    { ticker: "BBAS3", moeda: "BRL", bandeira: "🇧🇷", quantidade: 1000, valor_brl: 18500.0 },
    { ticker: "VOO", moeda: "USD", bandeira: "🇺🇸", quantidade: 5, valor_brl: 2450.0 },
  ],
  vendas: [
    { ticker: "PETR4", moeda: "BRL", bandeira: "🇧🇷", quantidade: 200, valor_brl: 7200.0 },
  ],
  proventos: [
    { ticker: "HGLG11", moeda: "BRL", bandeira: "🇧🇷", tipo: "Dividendo", valor_brl: 412.0 },
    { ticker: "BBAS3", moeda: "BRL", bandeira: "🇧🇷", tipo: "JCP", valor_brl: 88.0 },
  ],
  variacao_mercado: [
    { ticker: "PETR4", moeda: "BRL", bandeira: "🇧🇷", impacto_brl: 920.0, retorno_pct: 0.031 },
    { ticker: "VOO", moeda: "USD", bandeira: "🇺🇸", impacto_brl: 610.0, retorno_pct: 0.014 },
    { ticker: "ITSA4", moeda: "BRL", bandeira: "🇧🇷", impacto_brl: 180.0, retorno_pct: 0.009 },
    { ticker: "BBAS3", moeda: "BRL", bandeira: "🇧🇷", impacto_brl: -4180.0, retorno_pct: -0.052 },
    { ticker: "EGIE3", moeda: "BRL", bandeira: "🇧🇷", impacto_brl: -2140.0, retorno_pct: -0.028 },
    { ticker: "KNRI11", moeda: "BRL", bandeira: "🇧🇷", impacto_brl: -760.0, retorno_pct: -0.017 },
  ],
  variacao_mercado_base_data: "2026-05-09",
};

const FIXTURE_CALMA = {
  janela_dias: 7,
  data_corte: "2026-05-09",
  delta_patrim_brl: -1200.0,
  delta_patrim_pct: -0.005,
  decomposicao: {
    aportes_liq_brl: 0,
    proventos_brl: 0,
    mercado_brl: -1200.0,
  },
  compras: [],
  vendas: [],
  proventos: [],
  variacao_mercado: [],
  variacao_mercado_base_data: null,
};

// 7a.S.5 Task 2: DB recém-bootstrapped sem snapshot ≥7d — `ultimos_7d` existe
// (schema v2.13+) mas não tem o que mostrar (delta null + listas vazias).
// Distinto do legado (json.ultimos_7d ausente): aqui merece uma voz humana
// em vez de silêncio total.
const FIXTURE_SEM_HISTORICO = {
  janela_dias: 7,
  data_corte: "2026-05-09",
  delta_patrim_brl: null,
  delta_patrim_pct: null,
  decomposicao: { aportes_liq_brl: null, proventos_brl: null, mercado_brl: null },
  compras: [],
  vendas: [],
  proventos: [],
  variacao_mercado: [],
  variacao_mercado_base_data: null,
};

// 7a.S.5 Task 2: semana ativa (headline + decomp + listas visíveis) mas sem
// cotação-base pra rankear movers (variacao_mercado vazio, distinto de
// FIXTURE_CALMA que tem TUDO vazio).
const FIXTURE_SEM_MOVERS = {
  ...FIXTURE_ATIVA,
  variacao_mercado: [],
  variacao_mercado_base_data: null,
};

test.describe("Raio-X — Últimos 7 dias (7a.J.1.b)", () => {
  test("semana ativa: bloco visível com headline + decomp 3-row + listas", async ({ page }) => {
    await abrirRaioxComUltimos7d(page, FIXTURE_ATIVA);

    const bloco = page.locator(".raiox-7d");
    await expect(bloco).toBeVisible();

    await expect(bloco.locator(".r7d-label")).toHaveText("Últimos 7 dias");
    const delta = bloco.locator(".r7d-delta");
    await expect(delta).toContainText("R$");
    await expect(delta).toHaveClass(/is-positive/);

    const rows = bloco.locator(".r7d-row");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0).locator("span").first()).toHaveText("Aportes líq.");
    await expect(rows.nth(1).locator("span").first()).toHaveText("Proventos");
    await expect(rows.nth(2).locator("span").first()).toHaveText("Mercado");

    // Sinais coloridos: aportes positivo, proventos positivo, mercado negativo
    await expect(rows.nth(0).locator("span").last()).toHaveClass(/is-positive/);
    await expect(rows.nth(2).locator("span").last()).toHaveClass(/is-negative/);

    // Listas: compras (2), vendas (1), proventos (2) populadas
    await expect(bloco.locator('.r7d-lista[data-list="compras"]')).toBeVisible();
    await expect(bloco.locator('.r7d-lista[data-list="vendas"]')).toBeVisible();
    await expect(bloco.locator('.r7d-lista[data-list="proventos"]')).toBeVisible();

    await expect(bloco.locator('.r7d-lista[data-list="compras"] li')).toHaveCount(2);
    await expect(bloco.locator('.r7d-lista[data-list="vendas"] li')).toHaveCount(1);
    await expect(bloco.locator('.r7d-lista[data-list="proventos"] li')).toHaveCount(2);
  });

  test("bandeiras .flag aparecem em compras/vendas/proventos (BR + EUA)", async ({ page }) => {
    await abrirRaioxComUltimos7d(page, FIXTURE_ATIVA);
    const bloco = page.locator(".raiox-7d");
    const flags = bloco.locator(".r7d-lista li .flag");
    await expect(flags.first()).toHaveText("🇧🇷");
    // Pelo menos 1 EUA (VOO está nas compras)
    const flagsAll = await flags.allTextContents();
    expect(flagsAll).toContain("🇺🇸");
  });

  test("semana calma: headline + decomp visíveis; listas escondidas", async ({ page }) => {
    await abrirRaioxComUltimos7d(page, FIXTURE_CALMA);

    const bloco = page.locator(".raiox-7d");
    await expect(bloco).toBeVisible();
    await expect(bloco.locator(".r7d-delta")).toContainText("R$");
    await expect(bloco.locator(".r7d-delta")).toHaveClass(/is-negative/);

    // Decomp 3 rows sempre presentes
    await expect(bloco.locator(".r7d-row")).toHaveCount(3);

    // Listas hidden por x-show (display:none)
    await expect(bloco.locator('.r7d-lista[data-list="compras"]')).toBeHidden();
    await expect(bloco.locator('.r7d-lista[data-list="vendas"]')).toBeHidden();
    await expect(bloco.locator('.r7d-lista[data-list="proventos"]')).toBeHidden();
  });

  test("ordem DOM: hero → ultimos-7d → último aporte", async ({ page }) => {
    await abrirRaioxComUltimos7d(page, FIXTURE_ATIVA);
    const ordem = await page.evaluate(() => {
      const raiox = document.querySelector(".raiox");
      if (!raiox) return null;
      const hero = raiox.querySelector(".hero");
      const u7d = raiox.querySelector(".raiox-7d");
      const aporte = raiox.querySelector(".aporte-bloco");
      const idx = (el: Element | null) =>
        el ? Array.from(raiox.children).indexOf(el) : -1;
      return { hero: idx(hero), u7d: idx(u7d), aporte: idx(aporte) };
    });
    expect(ordem).not.toBeNull();
    expect(ordem!.hero).toBeGreaterThanOrEqual(0);
    expect(ordem!.hero).toBeLessThan(ordem!.u7d);
    expect(ordem!.u7d).toBeLessThan(ordem!.aporte);
  });

  test("schema sem ultimos_7d (legacy): bloco fica escondido", async ({ page }) => {
    await abrirRaioxComUltimos7d(page, null);
    await expect(page.locator(".raiox-7d")).toBeHidden();
    // 7a.S.5: o fallback de voz (.r7d-vazio) é distinto do legado — legado
    // não tem `ultimos_7d` nenhum, então nem a mensagem quieta aparece.
    await expect(page.locator(".r7d-vazio")).toBeHidden();
  });

  // 7a.S.5 Task 2 — voz nos estados vazios: em vez de o bloco simplesmente
  // desaparecer sem explicação (schema presente mas sem dado suficiente),
  // uma frase curta e humana assume o lugar.
  test("sem histórico de 7d ainda (schema presente, dado insuficiente): mensagem humana em vez de silêncio", async ({ page }) => {
    await abrirRaioxComUltimos7d(page, FIXTURE_SEM_HISTORICO);
    await expect(page.locator(".raiox-7d")).toBeHidden();
    const vazio = page.locator(".r7d-vazio");
    await expect(vazio).toBeVisible();
    await expect(vazio).toHaveText(/\S/); // frase não-vazia
    await expect(vazio).not.toContainText("Nenhum dado disponível");
  });

  test("semana ativa sem cotação-base pra movers: mensagem humana no lugar do card", async ({ page }) => {
    await abrirRaioxComUltimos7d(page, FIXTURE_SEM_MOVERS);
    const bloco = page.locator(".raiox-7d");
    await expect(bloco).toBeVisible();
    await expect(bloco.locator(".r7d-movers")).toBeHidden();
    const vazio = bloco.locator(".r7d-movers-vazio");
    await expect(vazio).toBeVisible();
    await expect(vazio).toHaveText(/\S/);
    // As listas Compras/Vendas/Proventos da FIXTURE_ATIVA seguem intactas —
    // a voz cobre só o sub-bloco Movers, não o resto da semana ativa.
    await expect(bloco.locator('.r7d-lista[data-list="compras"]')).toBeVisible();
  });

  test("semana ativa COM movers: mensagem de vazio dos movers não aparece", async ({ page }) => {
    await abrirRaioxComUltimos7d(page, FIXTURE_ATIVA);
    await expect(page.locator(".r7d-movers")).toBeVisible();
    await expect(page.locator(".r7d-movers-vazio")).toBeHidden();
  });
});

test.describe("Raio-X — Movers de mercado (7a.J.2.b)", () => {
  test("lista visível, ordenada (altas antes de baixas), 6 linhas", async ({ page }) => {
    await abrirRaioxComUltimos7d(page, FIXTURE_ATIVA);

    const movers = page.locator(".r7d-movers");
    await expect(movers).toBeVisible();
    await expect(movers.locator(".r7d-movers-title")).toContainText("Variação no mercado");

    const itens = movers.locator("li");
    await expect(itens).toHaveCount(6);

    // Ordem do array preservada: 3 altas (desc) seguidas de 3 baixas (asc).
    const tickers = await itens.locator(".tk").allTextContents();
    expect(tickers).toEqual(["PETR4", "VOO", "ITSA4", "BBAS3", "EGIE3", "KNRI11"]);
  });

  test("altas verdes com ▲ / baixas vermelhas com ▼", async ({ page }) => {
    await abrirRaioxComUltimos7d(page, FIXTURE_ATIVA);
    const itens = page.locator(".r7d-movers li");

    const primeira = itens.first();
    await expect(primeira.locator(".arr")).toHaveText("▲");
    await expect(primeira.locator(".arr")).toHaveClass(/is-positive/);
    await expect(primeira.locator(".rs")).toHaveClass(/is-positive/);
    await expect(primeira.locator(".rs")).toContainText("R$");

    const ultima = itens.last();
    await expect(ultima.locator(".arr")).toHaveText("▼");
    await expect(ultima.locator(".arr")).toHaveClass(/is-negative/);
    await expect(ultima.locator(".rs")).toHaveClass(/is-negative/);
  });

  test("formatBrlSigned: alta prefixa '+', baixa prefixa '−'", async ({ page }) => {
    await abrirRaioxComUltimos7d(page, FIXTURE_ATIVA);
    const itens = page.locator(".r7d-movers li");
    // pt-BR currency com signDisplay exceptZero: "+R$ 920,00" / "−R$ 4.180,00"
    // (Intl emite U+2212 MINUS SIGN no negativo; o regex abaixo aceita "-" e "−")
    await expect(itens.first().locator(".rs")).toContainText("+");
    const ultimaRs = await itens.last().locator(".rs").textContent();
    expect(ultimaRs).toMatch(/^[-−]/);
  });

  test("bandeiras BR + EUA presentes nos movers", async ({ page }) => {
    await abrirRaioxComUltimos7d(page, FIXTURE_ATIVA);
    const flags = await page.locator(".r7d-movers li .flag").allTextContents();
    expect(flags).toContain("🇧🇷");
    expect(flags).toContain("🇺🇸");
  });

  test("seção oculta quando variacao_mercado vazio", async ({ page }) => {
    await abrirRaioxComUltimos7d(page, FIXTURE_CALMA);
    await expect(page.locator(".r7d-movers")).toBeHidden();
  });

  test("ordem DOM dentro do bloco: decomp → movers → listas", async ({ page }) => {
    await abrirRaioxComUltimos7d(page, FIXTURE_ATIVA);
    const ordem = await page.evaluate(() => {
      const bloco = document.querySelector(".raiox-7d");
      if (!bloco) return null;
      const decomp = bloco.querySelector(".r7d-decomp");
      const movers = bloco.querySelector(".r7d-movers");
      const listas = bloco.querySelector(".r7d-listas");
      const idx = (el: Element | null) =>
        el ? Array.from(bloco.children).indexOf(el) : -1;
      return { decomp: idx(decomp), movers: idx(movers), listas: idx(listas) };
    });
    expect(ordem).not.toBeNull();
    expect(ordem!.decomp).toBeGreaterThanOrEqual(0);
    expect(ordem!.decomp).toBeLessThan(ordem!.movers);
    expect(ordem!.movers).toBeLessThan(ordem!.listas);
  });

  test("smoke visual: screenshot do bloco Últimos 7 dias com movers", async ({ page }) => {
    await abrirRaioxComUltimos7d(page, FIXTURE_ATIVA);
    const bloco = page.locator(".raiox-7d");
    await expect(bloco.locator(".r7d-movers")).toBeVisible();
    await bloco.screenshot({ path: "test-results/r7d-movers-7a-j2b.png" });
  });

  // 7a.S.5 Task 3 — grifo consagrado: .r7d-movers vira o ÚNICO cartão com
  // border-left na tela Raio-X (Apêndice B da spec: "Raio-X = card Movers",
  // já documentado como anti-pattern #14 do DESIGN.md). border-left 3px
  // var(--accent) = rgb(4, 120, 87); --surface-2 = rgb(243, 243, 236).
  test("grifo: .r7d-movers usa .grifo (border-left --accent + radius 0/14 + bg --surface-2)", async ({ page }) => {
    await abrirRaioxComUltimos7d(page, FIXTURE_ATIVA);
    const movers = page.locator(".r7d-movers");
    await expect(movers).toBeVisible();
    const estilo = await movers.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        borderLeftWidth: cs.borderLeftWidth,
        borderLeftColor: cs.borderLeftColor,
        borderLeftStyle: cs.borderLeftStyle,
        borderTopLeftRadius: cs.borderTopLeftRadius,
        borderTopRightRadius: cs.borderTopRightRadius,
        borderBottomRightRadius: cs.borderBottomRightRadius,
        borderBottomLeftRadius: cs.borderBottomLeftRadius,
        backgroundColor: cs.backgroundColor,
      };
    });
    expect(estilo.borderLeftWidth).toBe("3px");
    expect(estilo.borderLeftStyle).toBe("solid");
    expect(estilo.borderLeftColor).toBe("rgb(4, 120, 87)"); // var(--accent)
    expect(estilo.borderTopLeftRadius).toBe("0px");
    expect(estilo.borderTopRightRadius).toBe("14px");
    expect(estilo.borderBottomRightRadius).toBe("14px");
    expect(estilo.borderBottomLeftRadius).toBe("0px");
    expect(estilo.backgroundColor).toBe("rgb(243, 243, 236)"); // var(--surface-2)
  });

  test("grifo: dados e ordem dos movers preservados (não é só cosmético)", async ({ page }) => {
    await abrirRaioxComUltimos7d(page, FIXTURE_ATIVA);
    const tickers = await page.locator(".r7d-movers li .tk").allTextContents();
    expect(tickers).toEqual(["PETR4", "VOO", "ITSA4", "BBAS3", "EGIE3", "KNRI11"]);
  });
});
