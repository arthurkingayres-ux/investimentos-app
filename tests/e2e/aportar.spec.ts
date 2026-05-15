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
        escala_max: 10,
        categorias: [
          {
            nome: "EUA",
            peso_alvo: 0.7,
            peso_atual: 0.5,
            drift: -0.2,
            ativos: [
              {
                ticker: "VOO",
                nota: 3,
                peso_intra: 1.0,
                peso_intra_atual: 1.0,
                peso_alvo: 0.7,
                peso_atual: 0.5,
                drift: -0.2,
                drift_intra: 0.0,
                status: "aportar",
              },
            ],
          },
          {
            nome: "Ações BR",
            peso_alvo: 0.3,
            peso_atual: 0.5,
            drift: 0.2,
            ativos: [],
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
        escala_max: 10,
        categorias: [
          {
            nome: "EUA",
            peso_alvo: 0.7,
            peso_atual: 0.5,
            drift: -0.2,
            ativos: [
              {
                ticker: "VOO",
                nota: 3,
                peso_intra: 1.0,
                peso_intra_atual: 1.0,
                peso_alvo: 0.7,
                peso_atual: 0.5,
                drift: -0.2,
                drift_intra: 0.0,
                status: "aportar",
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
        escala_max: 10,
        categorias: [
          {
            nome: "Ações BR",
            peso_alvo: 0.5,
            peso_atual: 0.045,
            drift: -0.455,
            ativos: [
              {
                ticker: "BBAS3",
                nota: 4,
                peso_intra: 0.5,
                peso_intra_atual: 0.55,
                peso_alvo: 0.25,
                peso_atual: 0.025,
                drift: -0.225,
                drift_intra: 0.05,
                status: "aportar",
              },
              {
                ticker: "ITSA4",
                nota: 4,
                peso_intra: 0.5,
                peso_intra_atual: 0.45,
                peso_alvo: 0.25,
                peso_atual: 0.02,
                drift: -0.23,
                drift_intra: -0.05,
                status: "aportar",
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

  test("quarentena lista tickers com nota 0 ou status pausar", async ({
    page,
  }) => {
    // Cenário explícito: GRND3 com nota=0 e ITSA4 com status="pausar" —
    // independente de evolução da fixture default.
    await abrirAportarComMock(page, {
      patrimonio: { total_brl: 100000 },
      posicoes: [
        { ticker: "BBAS3", quantidade: 100, valor_mercado_brl: 2500 },
        { ticker: "GRND3", quantidade: 50, valor_mercado_brl: 1500 },
        { ticker: "ITSA4", quantidade: 200, valor_mercado_brl: 2000 },
      ],
      politica: {
        escala_max: 10,
        categorias: [
          {
            nome: "Ações BR",
            peso_alvo: 1.0,
            peso_atual: 0.06,
            drift: -0.94,
            ativos: [
              {
                ticker: "BBAS3",
                nota: 4,
                peso_intra: 1.0,
                peso_intra_atual: 0.42,
                peso_alvo: 1.0,
                peso_atual: 0.025,
                drift: -0.975,
                drift_intra: -0.58,
                status: "aportar",
              },
              {
                ticker: "GRND3",
                nota: 0,
                peso_intra: 0.0,
                peso_intra_atual: 0.25,
                peso_alvo: 0.0,
                peso_atual: 0.015,
                drift: 0.015,
                drift_intra: 0.25,
                status: "fora_da_politica",
              },
              {
                ticker: "ITSA4",
                nota: 3,
                peso_intra: 0.0,
                peso_intra_atual: 0.33,
                peso_alvo: 0.0,
                peso_atual: 0.02,
                drift: 0.02,
                drift_intra: 0.33,
                status: "pausar",
              },
            ],
          },
        ],
      },
    });
    await page.locator(".aporte-input").fill("1000");
    await page.waitForTimeout(300);
    const quarentenaText = await page
      .locator(".aporte-quarentena")
      .textContent();
    expect(quarentenaText).toContain("GRND3");
    expect(quarentenaText).toContain("ITSA4");
    expect(quarentenaText).toContain(" · ");
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
        escala_max: 10,
        categorias: [
          {
            nome: "EUA",
            peso_alvo: 0.45,
            peso_atual: 0.5,
            drift: 0.05,
            ativos: [
              {
                ticker: "VOO",
                nota: 3,
                peso_intra: 1.0,
                peso_intra_atual: 1.0,
                peso_alvo: 0.45,
                peso_atual: 0.5,
                drift: 0.05,
                drift_intra: 0.0,
                status: "no_alvo",
              },
            ],
          },
          {
            nome: "Ações BR",
            peso_alvo: 0.45,
            peso_atual: 0.5,
            drift: 0.05,
            ativos: [
              {
                ticker: "BBAS3",
                nota: 4,
                peso_intra: 1.0,
                peso_intra_atual: 1.0,
                peso_alvo: 0.45,
                peso_atual: 0.5,
                drift: 0.05,
                drift_intra: 0.0,
                status: "no_alvo",
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
        escala_max: 10,
        categorias: [
          {
            nome: "Ações BR",
            peso_alvo: 1.0,
            peso_atual: 0.05,
            drift: -0.95,
            ativos: [
              {
                ticker: "BBAS3",
                nota: 4,
                peso_intra: 1.0,
                peso_intra_atual: 1.0,
                peso_alvo: 1.0,
                peso_atual: 0.05,
                drift: -0.95,
                drift_intra: 0.0,
                status: "aportar",
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

  test("aporte grande mostra banner de sobra", async ({ page }) => {
    // patrimonio=10000. EUA: peso_alvo=0.3, peso_atual=0.1 → gap=0.3*pos-1000.
    // BR: peso_alvo=0.3, peso_atual=0.1 → gap=0.3*pos-1000. Cripto 0.4 fica "cash" fora.
    // Aporte=15000 → pos=25000. gap_EUA=0.3*25000-1000=6500. gap_BR=6500. Soma=13000.
    // restante = 15000-13000 = 2000 → SOBRA.
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
        escala_max: 10,
        categorias: [
          {
            nome: "EUA",
            peso_alvo: 0.3,
            peso_atual: 0.1,
            drift: -0.2,
            ativos: [
              {
                ticker: "VOO",
                nota: 3,
                peso_intra: 1.0,
                peso_intra_atual: 1.0,
                peso_alvo: 0.3,
                peso_atual: 0.1,
                drift: -0.2,
                drift_intra: 0.0,
                status: "aportar",
              },
            ],
          },
          {
            nome: "Ações BR",
            peso_alvo: 0.3,
            peso_atual: 0.1,
            drift: -0.2,
            ativos: [
              {
                ticker: "BBAS3",
                nota: 4,
                peso_intra: 1.0,
                peso_intra_atual: 1.0,
                peso_alvo: 0.3,
                peso_atual: 0.1,
                drift: -0.2,
                drift_intra: 0.0,
                status: "aportar",
              },
            ],
          },
        ],
      },
    });
    await page.locator(".aporte-input").fill("15000");
    await page.waitForTimeout(300);
    await expect(page.locator(".aporte-banner")).toContainText("Sobrou R$");
  });

  test("link na home leva a #aportar", async ({ page }) => {
    await abrirAportar(page);
    await page.goto("/");
    await expect(page.locator(".raiox")).toBeVisible();
    await page.locator(".aporte-cta").click();
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
        escala_max: 10,
        categorias: [
          {
            nome: "EUA",
            peso_alvo: 0.7,
            peso_atual: 0.5,
            drift: -0.2,
            ativos: [
              {
                ticker: "VOO",
                nota: 3,
                peso_intra: 1.0,
                peso_intra_atual: 1.0,
                peso_alvo: 0.7,
                peso_atual: 0.5,
                drift: -0.2,
                drift_intra: 0.0,
                status: "aportar",
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
});
