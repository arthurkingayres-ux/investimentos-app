import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

const FIXTURE = fs.readFileSync(
  path.join(__dirname, "../fixtures/portfolio.test.json.enc"),
  "utf-8",
);

test.use({ viewport: { width: 390, height: 844 } });

async function abrirAportar(page: Page) {
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
  await page.goto("/#aportar");
  await expect(page.locator(".tela-aportar")).toBeVisible();
}

// Helper: substitui this.json antes do render para forçar cenários
// específicos (BR subexposta, balanceado, quarentena com KNIP11 etc).
// Funciona injetando override no objeto Alpine assim que a fase=raiox.
async function abrirAportarComMock(page: Page, override: any) {
  await page.route("**/portfolio.json.enc", (route) =>
    route.fulfill({ status: 200, body: FIXTURE, contentType: "text/plain" }),
  );
  await page.addInitScript((overrideStr) => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem(
      "pinTimestamp",
      String(Date.now() - 1 * 24 * 60 * 60 * 1000),
    );
    (window as any).__aporteOverride = JSON.parse(overrideStr);
  }, JSON.stringify(override));
  await page.goto("/");
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
  // Aplica override no estado Alpine usando a referência exposta via x-data.
  // Throw se Alpine.$data não devolver o componente — evita falha silenciosa
  // do mock (testes passariam com fixture default em vez do override).
  await page.evaluate(() => {
    const root = document.body;
    const $data = (window as any).Alpine?.$data?.(root);
    if (!$data) {
      throw new Error(
        "abrirAportarComMock: Alpine.$data(document.body) é undefined — override não aplicado",
      );
    }
    if (!(window as any).__aporteOverride) {
      throw new Error(
        "abrirAportarComMock: window.__aporteOverride ausente",
      );
    }
    Object.assign($data.json, (window as any).__aporteOverride);
  });
  await page.goto("/#aportar");
  await expect(page.locator(".tela-aportar")).toBeVisible();
}

test.describe("Tela #aportar", () => {
  test("renderiza com input vazio + placeholder + helper", async ({ page }) => {
    await abrirAportar(page);
    await expect(page.locator(".aporte-input")).toHaveValue("");
    await expect(page.locator(".aporte-input")).toHaveAttribute(
      "placeholder",
      "R$ 0,00",
    );
    await expect(page.locator(".aporte-helper")).toContainText("Digite quanto");
    await expect(page.locator(".aporte-card")).toHaveCount(0);
  });

  test("aporte de R$ 5.000 com EUA subexposta gera card EUA + lista", async ({
    page,
  }) => {
    // Cenário forçado: EUA subexposta (alvo 0.70, atual 0.50)
    await abrirAportarComMock(page, {
      patrimonio: { total_brl: 258000 },
      posicoes: [
        {
          ticker: "VOO",
          quantidade: 10,
          valor_mercado_brl: 27040,
          moeda: "USD",
        },
      ],
      politica: {
        categorias: [
          {
            nome: "EUA",
            peso_alvo: 0.7,
            peso_atual: 0.5,
            drift: -0.2,
            buckets: [
              {
                tipo: "picks",
                ativos: [
                  {
                    ticker: "VOO",
                    tipo: "pick",
                    peso_intra: 1.0,
                    drift_intra: 0.0,
                    peso_alvo: 0.7,
                    peso_atual: 0.5,
                    drift: -0.2,
                  },
                ],
              },
            ],
          },
          {
            nome: "Ações BR",
            peso_alvo: 0.3,
            peso_atual: 0.5,
            drift: 0.2,
            buckets: [{ tipo: "picks", ativos: [] }],
          },
        ],
      },
    });
    await page.locator(".aporte-input").fill("5000");
    await page.waitForTimeout(300);
    await expect(page.locator(".aporte-card")).toHaveCount(1);
    await expect(page.locator(".aporte-cat-name")).toHaveText("EUA");
    await expect(page.locator(".aporte-compra-row")).not.toHaveCount(0);
  });

  test("cotas fracionárias para EUA (com '.' e R$)", async ({ page }) => {
    await abrirAportarComMock(page, {
      patrimonio: { total_brl: 258000 },
      posicoes: [
        {
          ticker: "VOO",
          quantidade: 10,
          valor_mercado_brl: 27040,
          moeda: "USD",
        },
      ],
      politica: {
        categorias: [
          {
            nome: "EUA",
            peso_alvo: 0.7,
            peso_atual: 0.5,
            drift: -0.2,
            buckets: [
              {
                tipo: "picks",
                ativos: [
                  {
                    ticker: "VOO",
                    tipo: "pick",
                    peso_intra: 1.0,
                    drift_intra: 0.0,
                    peso_alvo: 0.7,
                    peso_atual: 0.5,
                    drift: -0.2,
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    await page.locator(".aporte-input").fill("5000");
    await page.waitForTimeout(300);
    const firstQty = page.locator(".aporte-compra-qty").first();
    // pt-BR locale usa "," como separador decimal: ex "1,85 cotas"
    const qtyText = (await firstQty.textContent()) || "";
    expect(qtyText).toMatch(/\d+,\d+\s*cotas/);
    const firstSub = page.locator(".aporte-compra-qty-sub").first();
    await expect(firstSub).toContainText("R$");
  });

  test("cotas inteiras para BR/FII quando subexposta", async ({ page }) => {
    await abrirAportarComMock(page, {
      patrimonio: { total_brl: 100000 },
      posicoes: [
        { ticker: "BBAS3", quantidade: 100, valor_mercado_brl: 2500 },
        { ticker: "ITSA4", quantidade: 200, valor_mercado_brl: 2000 },
      ],
      politica: {
        categorias: [
          {
            nome: "Ações BR",
            peso_alvo: 0.5,
            peso_atual: 0.045,
            drift: -0.455,
            buckets: [
              {
                tipo: "picks",
                ativos: [
                  {
                    ticker: "BBAS3",
                    tipo: "pick",
                    peso_intra: 0.5,
                    drift_intra: 0.05,
                    peso_alvo: 0.25,
                    peso_atual: 0.025,
                    drift: -0.225,
                  },
                  {
                    ticker: "ITSA4",
                    tipo: "pick",
                    peso_intra: 0.5,
                    drift_intra: -0.05,
                    peso_alvo: 0.25,
                    peso_atual: 0.02,
                    drift: -0.23,
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    await page.locator(".aporte-input").fill("5000");
    await page.waitForTimeout(300);
    const qtys = await page.locator(".aporte-compra-qty").allTextContents();
    expect(qtys.length).toBeGreaterThan(0);
    for (const q of qtys) {
      expect(q).not.toContain(".");
    }
  });

  test("quarentena lista tickers com drift_intra positivo", async ({
    page,
  }) => {
    // Cenário explícito: GRND3 e ITSA4 com drift_intra > 0 (quarentena v3).
    await abrirAportarComMock(page, {
      patrimonio: { total_brl: 100000 },
      posicoes: [
        { ticker: "BBAS3", quantidade: 100, valor_mercado_brl: 2500 },
        { ticker: "GRND3", quantidade: 50, valor_mercado_brl: 1500 },
        { ticker: "ITSA4", quantidade: 200, valor_mercado_brl: 2000 },
      ],
      politica: {
        categorias: [
          {
            nome: "Ações BR",
            peso_alvo: 1.0,
            peso_atual: 0.06,
            drift: -0.94,
            buckets: [
              {
                tipo: "picks",
                ativos: [
                  {
                    ticker: "BBAS3",
                    tipo: "pick",
                    peso_intra: 1.0,
                    drift_intra: -0.58,
                    peso_alvo: 1.0,
                    peso_atual: 0.025,
                    drift: -0.975,
                  },
                  {
                    ticker: "GRND3",
                    tipo: "pick",
                    peso_intra: 0.0,
                    drift_intra: 0.25,
                    peso_alvo: 0.0,
                    peso_atual: 0.015,
                    drift: 0.015,
                  },
                  {
                    ticker: "ITSA4",
                    tipo: "pick",
                    peso_intra: 0.0,
                    drift_intra: 0.33,
                    peso_alvo: 0.0,
                    peso_atual: 0.02,
                    drift: 0.02,
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    await page.locator(".aporte-input").fill("1000");
    await page.waitForTimeout(300);
    const pausadosText = await page
      .locator(".aporte-pausados")
      .textContent();
    expect(pausadosText).toContain("GRND3");
    expect(pausadosText).toContain("ITSA4");
    expect(pausadosText).toContain(" · ");
  });

  test("estado balanceado mostra banner e 1+ cards proporcionais", async ({
    page,
  }) => {
    // "Balanceado" no algoritmo = gap positivo em NENHUMA categoria.
    // Como gap = peso_alvo*patrimonio_pos - peso_atual*patrimonio_atual,
    // todas precisam estar acima do alvo o suficiente para absorver o aporte.
    // Aporte = 5000, patrimonio = 100000 → pos = 105000.
    // gap_EUA = 0.5*105000 - peso_atual*100000 ≤ 0 → peso_atual ≥ 0.525.
    // Idem BR. Como somam <1.0 dá pra ter cripto pra fechar.
    // Cenário: pesos_alvo somam <1.0 (representando cash slack/imprecisão),
    // peso_atual estritamente acima de peso_alvo em TODAS — gap negativo.
    await abrirAportarComMock(page, {
      patrimonio: { total_brl: 100000 },
      posicoes: [
        {
          ticker: "VOO",
          quantidade: 10,
          valor_mercado_brl: 50000,
          moeda: "USD",
        },
        { ticker: "BBAS3", quantidade: 1000, valor_mercado_brl: 50000 },
      ],
      politica: {
        categorias: [
          {
            nome: "EUA",
            peso_alvo: 0.45,
            peso_atual: 0.5,
            drift: 0.05,
            buckets: [
              {
                tipo: "picks",
                ativos: [
                  {
                    ticker: "VOO",
                    tipo: "pick",
                    peso_intra: 1.0,
                    drift_intra: 0.0,
                    peso_alvo: 0.45,
                    peso_atual: 0.5,
                    drift: 0.05,
                  },
                ],
              },
            ],
          },
          {
            nome: "Ações BR",
            peso_alvo: 0.45,
            peso_atual: 0.5,
            drift: 0.05,
            buckets: [
              {
                tipo: "picks",
                ativos: [
                  {
                    ticker: "BBAS3",
                    tipo: "pick",
                    peso_intra: 1.0,
                    drift_intra: 0.0,
                    peso_alvo: 0.45,
                    peso_atual: 0.5,
                    drift: 0.05,
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    await page.locator(".aporte-input").fill("5000");
    await page.waitForTimeout(300);
    await expect(page.locator(".aporte-banner")).toContainText(
      "Carteira dentro da política",
    );
    const cards = await page.locator(".aporte-card").count();
    expect(cards).toBeGreaterThanOrEqual(1);
  });

  test("aporte de R$ 5 mostra banner abaixo-do-mínimo e zero cards", async ({
    page,
  }) => {
    // Aporte de R$ 5: 5 * 0.30 = R$1.50 pra BR, ITSA4 (R$10) -> 0 cotas; resto vai pra EUA fracionário
    // Cenário forçado: força inteiro com preço > aporte
    await abrirAportarComMock(page, {
      patrimonio: { total_brl: 100000 },
      posicoes: [
        { ticker: "BBAS3", quantidade: 100, valor_mercado_brl: 5000 },
      ],
      politica: {
        categorias: [
          {
            nome: "Ações BR",
            peso_alvo: 1.0,
            peso_atual: 0.05,
            drift: -0.95,
            buckets: [
              {
                tipo: "picks",
                ativos: [
                  {
                    ticker: "BBAS3",
                    tipo: "pick",
                    peso_intra: 1.0,
                    drift_intra: 0.0,
                    peso_alvo: 1.0,
                    peso_atual: 0.05,
                    drift: -0.95,
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    await page.locator(".aporte-input").fill("10");
    await page.waitForTimeout(300);
    await expect(page.locator(".aporte-banner")).toContainText(
      "Valor abaixo do mínimo",
    );
    await expect(page.locator(".aporte-card")).toHaveCount(0);
  });

  test("aporte distribuído sem sobra (cap-5 + residual em fracionário)", async ({ page }) => {
    // patrimonio=10000. EUA + BR ambos subexpostos. Aporte=15000.
    // Algoritmo cap-5: 2 candidatos válidos → distribui proporcional ao gap.
    // VOO (gap=6500) e BBAS3 (gap=6500) recebem 7500 cada. VOO fracionário
    // absorve qualquer resíduo → ZERO sobra. Banner não menciona "Sobrou R$".
    await abrirAportarComMock(page, {
      patrimonio: { total_brl: 10000 },
      posicoes: [
        {
          ticker: "VOO",
          quantidade: 1,
          valor_mercado_brl: 1000,
          moeda: "USD",
        },
        { ticker: "BBAS3", quantidade: 100, valor_mercado_brl: 1000 },
      ],
      politica: {
        categorias: [
          {
            nome: "EUA",
            peso_alvo: 0.3,
            peso_atual: 0.1,
            drift: -0.2,
            buckets: [
              {
                tipo: "picks",
                ativos: [
                  {
                    ticker: "VOO",
                    tipo: "pick",
                    peso_intra: 1.0,
                    drift_intra: 0.0,
                    peso_alvo: 0.3,
                    peso_atual: 0.1,
                    drift: -0.2,
                  },
                ],
              },
            ],
          },
          {
            nome: "Ações BR",
            peso_alvo: 0.3,
            peso_atual: 0.1,
            drift: -0.2,
            buckets: [
              {
                tipo: "picks",
                ativos: [
                  {
                    ticker: "BBAS3",
                    tipo: "pick",
                    peso_intra: 1.0,
                    drift_intra: 0.0,
                    peso_alvo: 0.3,
                    peso_atual: 0.1,
                    drift: -0.2,
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    await page.locator(".aporte-input").fill("15000");
    await page.waitForTimeout(300);
    await expect(page.locator(".aporte-banner")).not.toContainText("Sobrou R$");
    await expect(page.locator(".aporte-banner")).toContainText("subexpostos");
    expect(await page.locator(".aporte-card").count()).toBeGreaterThanOrEqual(2);
  });

  test("cap de 5 picks: ≥6 ativos válidos resulta em ≤5 compras", async ({ page }) => {
    // 6 ativos BR válidos, todos com gap positivo. Esperado: top 5 por gap_brl.
    // peso_intra_atual < peso_intra para todos → drift_intra negativo (abaixo do
    // alvo) → nenhum entra em quarentena (predicado prod: drift_intra > 0).
    const bbas = { ticker: "BBAS3", preco: 25, peso_intra: 0.20, peso_intra_atual: 0.05 };
    const itsa = { ticker: "ITSA4", preco: 10, peso_intra: 0.20, peso_intra_atual: 0.10 };
    const grnd = { ticker: "WEGE3", preco: 30, peso_intra: 0.20, peso_intra_atual: 0.05 };
    const radl = { ticker: "RADL3", preco: 25, peso_intra: 0.20, peso_intra_atual: 0.10 };
    const flry = { ticker: "FLRY3", preco: 15, peso_intra: 0.10, peso_intra_atual: 0.05 };
    const pssa = { ticker: "PSSA3", preco: 50, peso_intra: 0.10, peso_intra_atual: 0.05 };
    const all = [bbas, itsa, grnd, radl, flry, pssa];
    await abrirAportarComMock(page, {
      patrimonio: { total_brl: 100000 },
      posicoes: all.map((a) => ({
        ticker: a.ticker,
        quantidade: 100,
        valor_mercado_brl: a.preco * 100,
      })),
      politica: {
        categorias: [
          {
            nome: "Ações BR",
            peso_alvo: 1.0,
            peso_atual: 0.60,
            drift: -0.40,
            buckets: [
              {
                tipo: "picks",
                ativos: all.map((a) => ({
                  ticker: a.ticker,
                  tipo: "pick",
                  peso_intra: a.peso_intra,
                  drift_intra: a.peso_intra_atual - a.peso_intra,
                  peso_alvo: a.peso_intra,
                  peso_atual: a.peso_intra_atual * 0.60,
                  drift: -0.05,
                })),
              },
            ],
          },
        ],
      },
    });
    await page.locator(".aporte-input").fill("5000");
    await page.waitForTimeout(300);
    const rows = await page.locator(".aporte-compra-row").count();
    expect(rows).toBeLessThanOrEqual(5);
    expect(rows).toBe(5);
  });

  test("tab bar 'apt' leva a #aportar", async ({ page }) => {
    await abrirAportar(page);
    await page.goto("/");
    await expect(page.locator(".raiox")).toBeVisible();
    await page.locator('.tab-bar a[data-tab="aportar"]').click();
    expect(page.url()).toContain("#aportar");
    await expect(page.locator(".tela-aportar")).toBeVisible();
  });

  test("último valor persiste por 24h em localStorage", async ({ page }) => {
    await abrirAportar(page);
    await page.locator(".aporte-input").fill("5000");
    await page.waitForTimeout(300);
    await page.reload();
    await expect(page.locator(".tela-aportar")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".aporte-input")).toHaveValue("5000");

    await page.evaluate(() => {
      localStorage.setItem(
        "aporte.ts",
        String(Date.now() - 25 * 60 * 60 * 1000),
      );
    });
    await page.reload();
    await expect(page.locator(".tela-aportar")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".aporte-input")).toHaveValue("");
  });
});

test.describe("Tela #aportar · simulador vivo (7a.S.10)", () => {
  test("apcap pré-carrega o último aporte + hero-chip 'Repetir'; +5k/+10k/zerar", async ({
    page,
  }) => {
    await abrirAportar(page);
    // Fixture default: ultimo_aporte = { data: "2026-04-20", total_brl: 5000 }.
    await expect(page.locator(".aporte-input")).toHaveValue("");
    await expect(page.locator(".aporte-cap")).toContainText("R$ 5.000");
    await expect(page.locator(".aporte-cap")).toContainText("20 de abril");

    const hero = page.locator(".aporte-chip--hero");
    await expect(hero).toContainText("Repetir");
    await expect(hero).toContainText("R$ 5.000");
    await hero.click();
    await expect(page.locator(".aporte-input")).toHaveValue("5000");

    await page.locator(".aporte-chip--zero").click();
    await expect(page.locator(".aporte-input")).toHaveValue("0");

    await page.locator(".aporte-chip--add5k").click();
    await expect(page.locator(".aporte-input")).toHaveValue("5000");

    await page.locator(".aporte-chip--add10k").click();
    await expect(page.locator(".aporte-input")).toHaveValue("15000");
  });

  test("apcap fallback + hero-chip oculto quando não há último aporte", async ({
    page,
  }) => {
    await abrirAportarComMock(page, { ultimo_aporte: null });
    await expect(page.locator(".aporte-chip--hero")).toBeHidden();
    const texto = (await page.locator(".aporte-cap").textContent()) || "";
    expect(texto.trim().length).toBeGreaterThan(0);
    // Chips restantes seguem funcionais mesmo sem último aporte.
    await page.locator(".aporte-chip--add5k").click();
    await expect(page.locator(".aporte-input")).toHaveValue("5000");
  });

  test("scrubber 0–20.000 passo 100: move o valor + recalcula + a11y", async ({
    page,
  }) => {
    await abrirAportar(page);
    const range = page.locator(".aporte-scrub-input");
    await expect(range).toHaveAttribute("min", "0");
    await expect(range).toHaveAttribute("max", "20000");
    await expect(range).toHaveAttribute("step", "100");
    await expect(range).toHaveAttribute("aria-label", /.+/);
    await expect(range).toHaveAttribute("aria-valuemin", "0");
    await expect(range).toHaveAttribute("aria-valuemax", "20000");

    await range.fill("5300");
    await expect(page.locator(".aporte-input")).toHaveValue("5300");
    await expect(range).toHaveAttribute("aria-valuenow", "5300");
  });

  test("plano se monta: stagger + count-up de cotas + tag 'abaixo · aportar' + grifo (gap parcial)", async ({
    page,
  }) => {
    await abrirAportarComMock(page, {
      patrimonio: { total_brl: 100000 },
      posicoes: [{ ticker: "BBAS3", quantidade: 100, valor_mercado_brl: 2500 }],
      politica: {
        categorias: [
          {
            nome: "Ações BR",
            peso_alvo: 0.5,
            peso_atual: 0.1,
            drift: -0.4,
            buckets: [
              {
                tipo: "picks",
                ativos: [
                  {
                    ticker: "BBAS3",
                    tipo: "pick",
                    peso_intra: 1.0,
                    drift_intra: -0.4,
                    peso_alvo: 0.5,
                    peso_atual: 0.1,
                    drift: -0.4,
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    await page.locator(".aporte-input").fill("5000");
    await page.waitForTimeout(700); // > 520ms count-up + 30ms stagger delay

    // Cap-5/zero-sobra INTACTOS: 1 pick, cotas inteiras (BR), sem residual.
    const rows = await page.locator(".aporte-compra-row").count();
    expect(rows).toBeLessThanOrEqual(5);
    await expect(page.locator(".aporte-compra-qty").first()).toHaveText("200 cotas");

    // Stagger reveal aplicado.
    await expect(page.locator(".aporte-card").first()).toHaveClass(/aporte-card--in/);

    // Tag: gap NÃO fecha inteiro (posPct 14,29% < alvoPct 50%).
    await expect(page.locator(".aporte-cat-tag").first()).toContainText("abaixo");
    await expect(page.locator(".aporte-cat-tag").first()).toContainText("aportar");

    // Grifo do plano: "R$ 5.000" + "11%" (fração do gap fechada) + "zero sobra".
    const grifo = page.locator(".aporte-grifo");
    await expect(grifo).toContainText("R$ 5.000");
    await expect(grifo).toContainText("11%");
    await expect(grifo).toContainText(/zero sobra/i);
  });

  test("grifo do plano: tag 'fecha o gap' quando o aporte ultrapassa o alvo da categoria", async ({
    page,
  }) => {
    await abrirAportarComMock(page, {
      patrimonio: { total_brl: 100000 },
      posicoes: [{ ticker: "ITSA4", quantidade: 100, valor_mercado_brl: 1000 }],
      politica: {
        categorias: [
          {
            nome: "Ações BR",
            peso_alvo: 0.1,
            peso_atual: 0.08,
            drift: -0.02,
            buckets: [
              {
                tipo: "picks",
                ativos: [
                  {
                    ticker: "ITSA4",
                    tipo: "pick",
                    peso_intra: 1.0,
                    drift_intra: -0.02,
                    peso_alvo: 0.1,
                    peso_atual: 0.08,
                    drift: -0.02,
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    await page.locator(".aporte-input").fill("5000");
    await page.waitForTimeout(700);
    await expect(page.locator(".aporte-cat-tag").first()).toContainText("fecha o gap");
    const grifo = page.locator(".aporte-grifo");
    await expect(grifo).toContainText("R$ 5.000");
    await expect(grifo).toContainText(/zero sobra/i);
  });

  test("grifo/tag usam precisão RAW do peso_alvo, não alvoPct arredondado (CRB #1)", async ({
    page,
  }) => {
    // peso_alvo NÃO-REDONDO (0.304 → alvoPct arredonda p/ 30, mas o raw é 30,4).
    // Cenário calibrado p/ pousar a posição pós-aporte ENTRE 30 e 30,4:
    //   patrimonio 100.000 · categoria peso_atual 0,28 (28%) · pick ITSA4 @R$10.
    //   aporte 3.150 → 315 cotas · valor_cat 3.150 (zero residual).
    //   posPct = (28.000 + 3.150) / 103.150 = 30,199% · deltaPct = 2,199pp.
    // Com o RAW (alvo 30,4): restante 2,4pp; percorrido 2,199/2,4 = 92%;
    //   posPct 30,199 < 30,4 → NÃO fechou → tag "abaixo · aportar".  ← correto
    // Com o ARREDONDADO (alvo 30): restante 2pp; percorrido 2,199/2 → capa 100%
    //   → grifo "gap fecha inteiro"; posPct 30,199 ≥ 30 → tag "fecha o gap".
    //   Ambos MATERIALMENTE ERRADOS — este teste falharia com a math antiga.
    await abrirAportarComMock(page, {
      patrimonio: { total_brl: 100000 },
      posicoes: [{ ticker: "ITSA4", quantidade: 100, valor_mercado_brl: 1000 }],
      politica: {
        categorias: [
          {
            nome: "Ações BR",
            peso_alvo: 0.304,
            peso_atual: 0.28,
            drift: -0.024,
            buckets: [
              {
                tipo: "picks",
                ativos: [
                  {
                    ticker: "ITSA4",
                    tipo: "pick",
                    peso_intra: 1.0,
                    drift_intra: -0.024,
                    peso_alvo: 0.304,
                    peso_atual: 0.28,
                    drift: -0.024,
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    await page.locator(".aporte-input").fill("3150");
    await page.waitForTimeout(700);

    // Tag: RAW → "abaixo · aportar" (não "fecha o gap").
    await expect(page.locator(".aporte-cat-tag").first()).toContainText("abaixo");
    await expect(page.locator(".aporte-cat-tag").first()).not.toContainText(
      "fecha o gap",
    );

    // Grifo: RAW → "92%" parcial (não "gap fecha inteiro").
    const grifo = page.locator(".aporte-grifo");
    await expect(grifo).toContainText("92%");
    await expect(grifo).not.toContainText("gap fecha inteiro");
    await expect(grifo).toContainText(/zero sobra/i);

    // Sanidade: a trilha DISPLAY pode continuar arredondada (alvo 30%) —
    // só a math narrativa precisa ser raw-consistente.
    await expect(page.locator(".aporte-trilha-line").first()).toContainText(
      "alvo 30%",
    );
  });

  test("zero-write: nota de simulação pura sempre visível", async ({ page }) => {
    await abrirAportar(page);
    await expect(page.locator(".aporte-nota .writes")).toContainText(
      "Simulação pura",
    );
    await page.locator(".aporte-chip--add5k").click();
    await expect(page.locator(".aporte-nota .writes")).toContainText(
      "nada é gravado",
    );
  });
});

test.describe("Cross-screen: grifo #alocação → #aportar (7a.S.10 Task 4)", () => {
  test("grifo 'abaixo do alvo' navega para #aportar com preset do último aporte", async ({
    page,
  }) => {
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
    await page.goto("/#alocacao");
    await expect(page.locator(".tela-alocacao")).toBeVisible();

    // Fixture default: "Ações BR" peso_alvo 0.30 vs peso_atual 0.272 (~3pp abaixo).
    const grifo = page.locator(".aloca-grifo");
    await expect(grifo).toBeVisible();
    await expect(grifo).toContainText("Ações BR");
    await expect(grifo).toContainText("pp abaixo");
    await expect(grifo).toContainText("Simular aporte");

    await grifo.click();
    await expect(page.locator(".tela-aportar")).toBeVisible();
    expect(page.url()).toContain("#aportar");
    // Preset = json.ultimo_aporte.total_brl (5000 na fixture default).
    await expect(page.locator(".aporte-input")).toHaveValue("5000");
  });
});

test.describe("Tela #aportar · reduced motion", () => {
  test("prefers-reduced-motion: cards já revelados direto, sem stagger/count-up animado", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await abrirAportarComMock(page, {
      patrimonio: { total_brl: 100000 },
      posicoes: [{ ticker: "BBAS3", quantidade: 100, valor_mercado_brl: 2500 }],
      politica: {
        categorias: [
          {
            nome: "Ações BR",
            peso_alvo: 0.5,
            peso_atual: 0.1,
            drift: -0.4,
            buckets: [
              {
                tipo: "picks",
                ativos: [
                  {
                    ticker: "BBAS3",
                    tipo: "pick",
                    peso_intra: 1.0,
                    drift_intra: -0.4,
                    peso_alvo: 0.5,
                    peso_atual: 0.1,
                    drift: -0.4,
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    await page.locator(".aporte-input").fill("5000");
    await page.waitForTimeout(80); // bem menor que os 30ms+ da coreografia animada
    await expect(page.locator(".aporte-card").first()).toHaveClass(/aporte-card--in/);
    await expect(page.locator(".aporte-compra-qty").first()).toHaveText("200 cotas");
    const transition = await page
      .locator(".aporte-card")
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(transition).toBe("0s");
  });
});

test.describe("Tela #aportar · reduced motion", () => {
  test("prefers-reduced-motion zera transição da trilha", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await abrirAportarComMock(page, {
      patrimonio: { total_brl: 258000 },
      posicoes: [
        {
          ticker: "VOO",
          quantidade: 10,
          valor_mercado_brl: 27040,
          moeda: "USD",
        },
      ],
      politica: {
        categorias: [
          {
            nome: "EUA",
            peso_alvo: 0.7,
            peso_atual: 0.5,
            drift: -0.2,
            buckets: [
              {
                tipo: "picks",
                ativos: [
                  {
                    ticker: "VOO",
                    tipo: "pick",
                    peso_intra: 1.0,
                    drift_intra: 0.0,
                    peso_alvo: 0.7,
                    peso_atual: 0.5,
                    drift: -0.2,
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    await page.locator(".aporte-input").fill("5000");
    await page.waitForTimeout(300);
    const transition = await page
      .locator(".aporte-trilha-delta")
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(transition).toBe("0s");
  });

  // 7a.E.28: pick em quarentena (investidor qualificado) nunca recomendado.
  // Testa direto window.aporteCalculo: o quarentenado tem drift_intra 0 (não
  // pega no filtro drift>0), preço presente e gap positivo — só o filtro
  // explícito !a.quarentena o exclui. E não aparece na lista de "pausados".
  test("pick em quarentena não é recomendado nem listado como pausado", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => !!(window as any).aporteCalculo);
    const r = await page.evaluate(() => {
      const portfolio = {
        patrimonio: { total_brl: 10000 },
        posicoes: [
          { ticker: "ACT1", quantidade: 10, valor_mercado_brl: 1000 },
          { ticker: "KNIP11", quantidade: 1, valor_mercado_brl: 100 },
        ],
        politica: {
          categorias: [
            {
              nome: "FIIs",
              peso_alvo: 1.0,
              peso_atual: 0.11,
              drift: -0.89,
              buckets: [
                {
                  tipo: "picks",
                  equal_weight: true,
                  peso_bucket: 1.0,
                  peso_atual_bucket: 0.11,
                  drift_bucket: -0.89,
                  ativos: [
                    {
                      ticker: "ACT1",
                      tipo: "pick",
                      peso_intra: 1.0,
                      peso_intra_atual: 0.9,
                      drift_intra: -0.1,
                      peso_alvo: 1.0,
                      peso_atual: 0.1,
                      drift: -0.9,
                      bandeira: "🇧🇷",
                    },
                    {
                      ticker: "KNIP11",
                      tipo: "pick",
                      quarentena: true,
                      peso_intra: 0.0,
                      peso_intra_atual: 0.0,
                      drift_intra: 0.0,
                      peso_alvo: 0.0,
                      peso_atual: 0.01,
                      drift: 0.01,
                      bandeira: "🇧🇷",
                    },
                  ],
                },
              ],
            },
          ],
        },
      };
      const res = (window as any).aporteCalculo.calcularAporte(5000, portfolio);
      const recomendados = (res.categorias || []).flatMap((c: any) =>
        (c.compras || []).map((l: any) => l.ticker),
      );
      return { recomendados, pausados: res.pausados || [] };
    });
    expect(r.recomendados).toContain("ACT1");
    expect(r.recomendados).not.toContain("KNIP11");
    expect(r.pausados).not.toContain("KNIP11");
  });
});
