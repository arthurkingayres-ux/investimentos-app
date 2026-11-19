import { test, expect, Page } from "@playwright/test";
import fs from "fs";
import path from "path";

// 7a.CD.3: o provento que ainda espera o documento. Três marcas, nenhum número muda:
//   selo "a confirmar"  linha com `provisorio: true` (7 dias do Hoje e tabela do ativo)
//   prova de fogo       `proventos.ultima_prova` numa nota sob os KPIs de #proventos
//   pedido do documento `proventos.pedir_documento` (texto do payload) no "Pede atenção"
// O texto do pedido vem do payload cifrado: o código deste repo não o escreve.
// Fixture SINTÉTICA: tickers e valores inventados, injetados sobre portfolio.test.

test.use({ viewport: { width: 390, height: 844 } });

const F = (n: string) => fs.readFileSync(path.join(__dirname, "../fixtures/" + n), "utf-8");
const PORTFOLIO = F("portfolio.test.json.enc");
const TEXTO_PEDIDO = "Mande o extrato de proventos da SINTETICA";

const SEMANA = {
  janela_dias: 7, data_corte: "2026-05-09", delta_patrim_brl: 1000, delta_patrim_pct: 0.01,
  decomposicao: { aportes_liq_brl: 500, proventos_brl: 33.33, mercado_brl: 466.67 },
  variacao_mercado: [], compras: [], vendas: [],
  proventos: [
    { ticker: "ZZZZ11", moeda: "BRL", bandeira: "", tipo: "Rendimento", valor_brl: 22.22, provisorio: true },
    { ticker: "YYYY11", moeda: "BRL", bandeira: "", tipo: "Rendimento", valor_brl: 11.11, provisorio: false },
  ],
};

async function abrir(page: Page, proventos: Record<string, unknown>, largura = 390) {
  await page.setViewportSize({ width: largura, height: 844 });
  await page.route("**/portfolio.json.enc", (r) => r.fulfill({ status: 200, body: PORTFOLIO, contentType: "text/plain" }));
  await page.addInitScript(() => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem("pinTimestamp", String(Date.now() - 24 * 60 * 60 * 1000));
    localStorage.setItem("relRead", JSON.stringify({ "2026-05": true }));
  });
  await page.goto("/");
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
  await page.evaluate(([u, p]) => {
    const d = (window as any).Alpine.$data(document.body);
    d.json.ultimos_7d = u;
    Object.assign(d.json.proventos, p);
  }, [SEMANA, proventos] as const);
}

const selo = (page: Page) => page.getByTestId("provento-a-confirmar");

test.describe("7a.CD.3: selo 'a confirmar'", () => {
  test("Hoje, 7 dias: o selo só na linha provisória, lido como texto", async ({ page }) => {
    await abrir(page, {});
    const lista = page.locator('.raiox .r7d-lista[data-list="proventos"]');
    await expect(lista.locator("li")).toHaveCount(2);
    await expect(lista.locator("li").filter({ hasText: "ZZZZ11" }).getByTestId("provento-a-confirmar")).toHaveText("a confirmar");
    await expect(lista.locator("li").filter({ hasText: "YYYY11" }).getByTestId("provento-a-confirmar")).toHaveCount(0);
    await expect(selo(page)).toHaveCount(1);
  });

  test("a 320px o selo não empurra a linha para fora", async ({ page }) => {
    await abrir(page, {}, 320);
    const lista = page.locator('.raiox .r7d-lista[data-list="proventos"]');
    const transborda = await lista.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return [...el.querySelectorAll("li, li *")].some((x) => x.getBoundingClientRect().right > r.right + 0.5);
    });
    expect(transborda).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("tela do ativo: o selo na linha provisória da tabela de 12 meses", async ({ page }) => {
    await abrir(page, {});
    const ticker = await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      const p = d.json.posicoes[0];
      p.proventos = [
        { data_pagamento: "2026-11-17", valor_liquido_brl: 9.99, tipo: "Rendimento", provisorio: true },
        { data_pagamento: "2026-10-15", valor_liquido_brl: 8.88, tipo: "Rendimento", provisorio: false },
      ];
      return p.ticker as string;
    });
    // Hash, não goto: recarregar perderia a injeção.
    await page.evaluate((t) => { location.hash = "ativo/" + t; }, ticker);
    const linhas = page.locator(".tela-ativo .tabela-proventos tbody tr");
    await expect(linhas).toHaveCount(2);
    await expect(linhas.nth(0).getByTestId("provento-a-confirmar")).toHaveText("a confirmar");
    await expect(linhas.nth(1).getByTestId("provento-a-confirmar")).toHaveCount(0);
  });

  test("payload antigo (sem a chave): nenhum selo", async ({ page }) => {
    await abrir(page, {});
    await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      d.json.ultimos_7d = { ...d.json.ultimos_7d, proventos: d.json.ultimos_7d.proventos.map(({ provisorio, ...r }: any) => r) };
    });
    await expect(page.locator('.raiox .r7d-lista[data-list="proventos"] li')).toHaveCount(2);
    await expect(selo(page)).toHaveCount(0);
  });
});

test.describe("7a.CD.3: a última prova de fogo em #proventos", () => {
  const nota = (page: Page) => page.locator(".tela-proventos").getByTestId("prov-prova");

  test("com data: 'Última prova de fogo em DD/MM/AAAA.'", async ({ page }) => {
    await abrir(page, { ultima_prova: "2026-11-16" });
    await page.goto("/#proventos");
    await expect(nota(page)).toHaveText("Última prova de fogo em 16/11/2026.");
  });

  test("null: 'Ainda sem prova de fogo.'", async ({ page }) => {
    await abrir(page, { ultima_prova: null });
    await page.goto("/#proventos");
    await expect(nota(page)).toHaveText("Ainda sem prova de fogo.");
  });

  test("payload sem a chave: a nota não aparece", async ({ page }) => {
    await abrir(page, {});
    await page.goto("/#proventos");
    await expect(page.locator(".tela-proventos .kpi")).toHaveCount(3);
    await expect(nota(page)).toBeHidden();
  });
});

test.describe("7a.CD.3: pedido do documento no 'Pede atenção'", () => {
  const item = (page: Page) => page.locator(".raiox").getByTestId("pede-atencao-extrato");

  test("com texto no payload: o item aparece com ele e leva a #proventos", async ({ page }) => {
    await abrir(page, { pedir_documento: TEXTO_PEDIDO });
    await expect(item(page)).toHaveText(new RegExp("^\\s*" + TEXTO_PEDIDO + "\\s*›\\s*$"));
    await expect(item(page)).toHaveAttribute("href", "#proventos");
    expect((await item(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await item(page).click();
    await expect(page.locator(".tela-proventos")).toBeVisible();
  });

  test("null: o item não existe", async ({ page }) => {
    await abrir(page, { pedir_documento: null });
    await expect(item(page)).toHaveCount(0);
  });

  // Os padrões são montados em partes: escritos inteiros, este teste publicaria
  // no repo público justamente o nome que ele proíbe.
  test("o código do app não nomeia a origem dos proventos", async () => {
    const raiz = path.join(__dirname, "../..");
    const js = fs.readdirSync(path.join(raiz, "js")).filter((f) => f.endsWith(".js")).map((f) => "js/" + f);
    expect(js.length).toBeGreaterThan(5); // controle positivo: a varredura achou o código
    const fontes = ["index.html", "service-worker.js", ...js].map((f) => fs.readFileSync(path.join(raiz, f), "utf-8"));
    const proibidos = [new RegExp(["extrato de proventos", "da"].join(" "), "i"), new RegExp(["plu", "ggy"].join(""), "i")];
    for (const s of fontes) {
      for (const p of proibidos) expect(s).not.toMatch(p);
    }
  });
});
