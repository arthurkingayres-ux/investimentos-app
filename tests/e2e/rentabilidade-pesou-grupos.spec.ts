import { test, expect, Page } from "@playwright/test";
import { esperarResume } from "./esperar-resume";
import path from "path";
import fs from "fs";

// Fase 7a.BH.1 — "quem pesou" com TODOS os ativos, em grupos (tiraram /
// somaram / junto). Unitário sobre as funções globais de js/app.js
// (rent2Pesou, rent2AnuncioPesou), com `r` sintético: contrib em fração,
// tickers SINT* (repo público, nunca dado real).
let errosPagina: string[] = [];

test.beforeEach(async ({ page }, info) => {
  errosPagina = [];
  page.on("pageerror", (e) => errosPagina.push(e.message));
  if (info.title.startsWith("e2e:")) return;
  await page.goto("/");
  await page.waitForFunction(() => typeof (window as any).Alpine !== "undefined");
});

const LINHAS = [{ id: "acoes_br", indice: "IBOV" }];

// 4 negativos (−2,0 −1,0 −0,5 −0,3), 3 positivos (+0,6 +0,4 +0,2) e um de
// 0,01 ponto (exibe 0,0): linha exibida −2,6.
const NEG = [
  { t: "SINTA3", contrib: -0.02 },
  { t: "SINTB3", contrib: -0.01 },
  { t: "SINTC3", contrib: -0.005 },
  { t: "SINTD3", contrib: -0.003 },
  { t: "SINTE3", contrib: 0.006 },
  { t: "SINTF3", contrib: 0.004 },
  { t: "SINTG3", contrib: 0.002 },
  { t: "SINTH3", contrib: 0.0001 },
];
const POS = NEG.map((a) => ({ t: a.t, contrib: a.t === "SINTH3" ? a.contrib : -a.contrib }));

async function pesou(page: any, ativos: any[], valorLinha: number, lid = "acoes_br", chave = "acoes_br") {
  return page.evaluate(
    ([r, lid, v]: any) => (window as any).rent2Pesou(r, lid, v, "ao ano"),
    [{ linhas: LINHAS, ativos: { [chave]: ativos } }, lid, valorLinha],
  );
}

test("linha negativa: todos os ativos, três grupos, tiraram primeiro", async ({ page }) => {
  const p = await pesou(page, NEG, -2.6);
  expect(p.neutra).toBe(false);
  expect(p.grupos.map((g: any) => g.id)).toEqual(["tiraram", "somaram", "junto"]);
  expect(p.grupos.reduce((s: number, g: any) => s + g.itens.length, 0)).toBe(8);
  expect(p.grupos.map((g: any) => g.contagem)).toEqual(["4 ativos", "3 ativos", "1 ativo"]);
  expect(p.grupos[2].titulo).toBe("Andou junto");
  expect(p.grupos[2].itens.map((i: any) => i.t)).toEqual(["SINTH3"]);
  expect(p.grupos[0].titulo).toBe("Tiraram pontos");
  expect(p.grupos[1].titulo).toBe("Somaram pontos");
  expect(p.grupos[2].sub).toBeNull();
  expect(errosPagina).toEqual([]);
});

test("linha positiva: somaram primeiro", async ({ page }) => {
  const p = await pesou(page, POS, 2.6);
  expect(p.grupos.map((g: any) => g.id)).toEqual(["somaram", "tiraram", "junto"]);
  expect(p.grupos.reduce((s: number, g: any) => s + g.itens.length, 0)).toBe(8);
  expect(errosPagina).toEqual([]);
});

test("ordem dentro do grupo por tamanho, empate pelo ticker", async ({ page }) => {
  // SINTB3 vem ANTES de SINTA3 na entrada: sem o desempate por t o sort
  // estável deixaria SINTB3 na frente e o teste passaria à toa.
  const p = await pesou(
    page,
    [
      { t: "SINTB3", contrib: -0.003 },
      { t: "SINTA3", contrib: -0.003 },
      { t: "SINTD3", contrib: -0.005 },
    ],
    -1.1,
  );
  expect(p.grupos.map((g: any) => g.id)).toEqual(["tiraram"]);
  expect(p.grupos[0].itens.map((i: any) => i.valor)).toEqual([-0.5, -0.3, -0.3]);
  expect(p.grupos[0].itens.map((i: any) => i.t)).toEqual(["SINTD3", "SINTA3", "SINTB3"]);
  expect(errosPagina).toEqual([]);
});

test("subtotais fecham com a linha", async ({ page }) => {
  const p = await pesou(page, NEG, -2.6);
  let total = 0;
  for (const g of p.grupos) {
    const soma = g.itens.reduce((s: number, i: any) => s + i.valor, 0);
    if (g.sub) expect(g.sub.valor).toBeCloseTo(Math.round(soma * 10) / 10, 9);
    total += soma;
  }
  expect(Math.round(total * 10) / 10).toBe(-2.6);
  expect(p.grupos[0].sub.valor).toBe(-3.8);
  expect(p.grupos[1].sub.valor).toBe(1.2);
  expect(errosPagina).toEqual([]);
});

test("linha neutra com +x e −x: lista aparece, tiraram primeiro", async ({ page }) => {
  const p = await pesou(page, [{ t: "SINTA3", contrib: 0.02 }, { t: "SINTB3", contrib: -0.02 }], 0);
  expect(p.neutra).toBe(true);
  expect(p.verbo).toBe("");
  expect(p.qtd).toBe("");
  expect(p.resto).not.toContain("Nada a explicar");
  expect(p.resto).toBe("andaram junto com o Ibovespa nesta janela.");
  expect(p.grupos.map((g: any) => g.id)).toEqual(["tiraram", "somaram"]);
  expect(errosPagina).toEqual([]);
});

test("linha neutra: os |subtotais| sempre empatam e tiraram vem primeiro", async ({ page }) => {
  // Com valorLinha neutro, arredondarFechando fecha a soma exibida em 0, então
  // os |subtotais| sempre empatam; o teste trava o desempate (tiraram) com
  // +3,0 contra −1,0 e −2,0.
  const p = await pesou(
    page,
    [{ t: "SINTA3", contrib: 0.03 }, { t: "SINTB3", contrib: -0.01 }, { t: "SINTC3", contrib: -0.02 }],
    0,
  );
  expect(p.grupos.map((g: any) => g.id)).toEqual(["tiraram", "somaram"]);
  expect(p.grupos[0].sub.valor).toBe(-3);
  expect(p.grupos[1].sub.valor).toBe(3);
  expect(errosPagina).toEqual([]);
});

test("sinal único: sem grupo vazio, singular em 1", async ({ page }) => {
  const p = await pesou(page, [{ t: "SINTA3", contrib: 0.01 }], 1.0);
  expect(p.grupos.length).toBe(1);
  expect(p.grupos[0].id).toBe("somaram");
  expect(p.grupos[0].titulo).toBe("Somou pontos");
  expect(p.grupos[0].contagem).toBe("1 ativo");
  expect(errosPagina).toEqual([]);
});

test("frase sem Quem mais pesou", async ({ page }) => {
  const p = await pesou(page, NEG, -2.6);
  expect(p.resto.endsWith("contra o Ibovespa.")).toBe(true);
  expect(p.resto).not.toContain("Quem mais pesou");
  expect(p.verbo).toBe("tiraram");
  expect(p.qtd).toBe("2,6 pontos");
  expect(errosPagina).toEqual([]);
});

test("arredondamento que cruza o zero", async ({ page }) => {
  const ativos = [{ t: "SINTX3", contrib: -0.00001 }, { t: "SINTY3", contrib: 0.01 }];
  // controle positivo: o maior resto leva o exibido de SINTX3 a 0,0.
  const exib = await page.evaluate(
    (a: any) => (window as any).arredondarFechando(a.map((x: any) => x.contrib * 100), 1.0),
    ativos,
  );
  expect(exib).toEqual([0, 1]);
  const p = await pesou(page, ativos, 1.0);
  expect(p.grupos.map((g: any) => g.id)).toEqual(["somaram", "junto"]);
  expect(p.grupos[1].itens.map((i: any) => i.t)).toEqual(["SINTX3"]);
  expect(errosPagina).toEqual([]);
});

test("arredondamento que zera um valor BRUTO acima do limiar", async ({ page }) => {
  // SINTB3 tem 0,06 ponto BRUTO (acima de 0,05), mas o maior resto, ao fechar a
  // linha em +0,1, leva o EXIBIDO dele a 0,0: o grupo é o do exibido ("junto").
  // Agrupar pelo bruto o poria em "somaram" e o subtotal não fecharia.
  const ativos = [
    { t: "SINTA3", contrib: 0.0007 },
    { t: "SINTB3", contrib: 0.0006 },
    { t: "SINTC3", contrib: -0.0003 },
  ];
  const exib = await page.evaluate(
    (a: any) => (window as any).arredondarFechando(a.map((x: any) => x.contrib * 100), 0.1),
    ativos,
  );
  // controle positivo: o bruto de SINTB3 passa de 0,05 e o exibido é 0
  expect(Math.abs(ativos[1].contrib * 100)).toBeGreaterThanOrEqual(0.05);
  expect(exib).toEqual([0.1, 0, 0]);
  const p = await pesou(page, ativos, 0.1);
  expect(p.grupos.map((g: any) => g.id)).toEqual(["somaram", "junto"]);
  expect(p.grupos[0].itens.map((i: any) => i.t)).toEqual(["SINTA3"]);
  expect(p.grupos[0].sub.valor).toBe(0.1);
  expect(p.grupos[1].itens.map((i: any) => i.t)).toEqual(["SINTB3", "SINTC3"]);
  expect(errosPagina).toEqual([]);
});

test("rebate e linha sem ativos", async ({ page }) => {
  const p = await pesou(
    page,
    [{ t: "Rebates da corretora", contrib: -0.005 }, { t: "SINTA3", contrib: 0.002 }],
    -0.3,
  );
  expect(p.grupos.map((g: any) => g.id)).toEqual(["tiraram", "somaram"]);
  expect(p.grupos[0].itens.map((i: any) => i.t)).toEqual(["Rebates da corretora"]);
  expect(p.grupos[0].contagem).toBe("1 ativo");
  const vazio = await pesou(page, [], -0.3, "acoes_br", "outra_chave");
  expect(vazio.grupos).toEqual([]);
  expect(errosPagina).toEqual([]);
});

test("anúncio lê frase e cabeçalhos, nenhum ticker", async ({ page }) => {
  const txt = await page.evaluate(
    ([r]: any) => {
      const w = window as any;
      return w.rent2AnuncioPesou(w.rent2Pesou(r, "acoes_br", -2.6, "ao ano"));
    },
    [{ linhas: LINHAS, ativos: { acoes_br: NEG } }],
  );
  const q = "2,6", a = "3,8", b = "1,2";
  expect(txt).toBe(
    `Ações BR tiraram ${q} pontos ao ano contra o Ibovespa. Tiraram pontos, 4 ativos, menos ${a}. `
      + `Somaram pontos, 3 ativos, mais ${b}. Andou junto, 1 ativo.`,
  );
  for (const a of NEG) expect(txt).not.toContain(a.t);
  expect(await page.evaluate(() => (window as any).rent2AnuncioPesou(null))).toBe("");
  expect(errosPagina).toEqual([]);
});


// ---------------------------------------------------------------------------
// e2e (fixture sintética de linha longa: portfolio_ponte_muitos.test.json.enc,
// `acoes_br` com 11 ativos; 12m Brasil: acoes_br −0,4 e fiis +0,2)
// ---------------------------------------------------------------------------
const FIXTURES = path.join(__dirname, "../fixtures");
const TELA = ".tela-rentabilidade";
const tid = (id: string) => `${TELA} [data-testid="${id}"]`;

async function autenticar(page: Page, fixture = "portfolio_ponte_muitos.test.json.enc") {
  const corpo = fs.readFileSync(path.join(FIXTURES, fixture), "utf-8");
  await page.route("**/portfolio.json.enc", (route) =>
    route.fulfill({ status: 200, body: corpo, contentType: "text/plain" }),
  );
  await page.addInitScript(() => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem("pinTimestamp", String(Date.now() - 24 * 60 * 60 * 1000));
    localStorage.removeItem("moedaEUA");
  });
  await page.goto("/");
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
}

async function abrir(page: Page) {
  await page.goto("/#rentabilidade");
  await esperarResume(page);
  await expect(page.locator(tid("rent2-frase"))).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(`${TELA} canvas[data-zr-dom-id]`)).toBeVisible({ timeout: 5_000 });
}

async function escopo(page: Page, nome: "Total" | "Brasil" | "EUA") {
  await page.locator(`${TELA} button[data-escopo="${nome}"]`).click();
  await expect(page.locator(`${TELA} button[data-escopo="${nome}"].active`)).toBeVisible();
}

async function arrastar(page: Page, iIni: number, iFim: number) {
  await page.evaluate(([a, b]) => {
    const d = (window as any).Alpine.$data(document.body);
    const off = d._rentCtx.off;
    d.echartsRent.dispatchAction({ type: "dataZoom", startValue: a - 1 - off, endValue: b - off });
  }, [iIni, iFim]);
}

async function abrirLinha(page: Page, lid: string) {
  const linha = page.locator(`${tid("ponte-linha")}[data-linha="${lid}"]`);
  await linha.click();
  await expect(linha).toHaveAttribute("aria-pressed", "true");
}

const grupos = (page: Page) =>
  page.locator(tid("pesou-grupo")).evaluateAll((els) => els.map((e) => e.getAttribute("data-grupo")));

async function abrirBrasil12m(page: Page) {
  await autenticar(page);
  await abrir(page);
  await escopo(page, "Brasil");
  await abrirLinha(page, "acoes_br");
}

test("e2e: linha longa: todos os ativos aparecem, sem Outros", async ({ page }) => {
  await abrirBrasil12m(page);
  await expect(page.locator(tid("pesou-ativo"))).toHaveCount(11);
  // Trava contra "Outros" com qualquer testid: todo li da lista é um pesou-ativo.
  const totalLi = await page.locator(`${tid("ponte-pesou")} li`).count();
  expect(totalLi).toBeGreaterThan(0);
  await expect(page.locator(`${tid("ponte-pesou")} li[data-testid="pesou-ativo"]`)).toHaveCount(totalLi);
  const controle = await page.evaluate(() => {
    const d = (window as any).Alpine.$data(document.body);
    const ctx = d._rentCtx;
    const n = ctx.bloco.meses.length - 1;
    return (window as any).ponteJanela(ctx.bloco, "Brasil", "BRL", n - 11, n).ativos.acoes_br.length;
  });
  expect(controle).toBe(11);
  const tickers = await page.locator(tid("pesou-ativo")).evaluateAll((els) => els.map((e) => e.getAttribute("data-ticker")));
  for (const t of ["ITSA4", "BBAS3", "SINTA3", "SINTB3", "SINTC3", "SINTD3", "SINTE3", "SINTF3", "SINTG3", "SINTH3", "SINTI3"]) {
    expect(tickers).toContain(t);
  }
  // o minúsculo (exibe ±0,0) cai em "junto"
  await expect(page.locator(`${tid("pesou-grupo")}[data-grupo="junto"] [data-ticker="SINTI3"]`)).toHaveCount(1);
  expect(errosPagina).toEqual([]);
});

test("e2e: cabeçalhos: contagem = itens, subtotal = soma dos itens", async ({ page }) => {
  await abrirBrasil12m(page);
  const gs = page.locator(tid("pesou-grupo"));
  const n = await gs.count();
  expect(n).toBe(3);
  for (let i = 0; i < n; i++) {
    const g = gs.nth(i);
    const id = await g.getAttribute("data-grupo");
    const rotulo = (await g.locator('[data-testid="pesou-cab"] .ponte-pesou-cab-rotulo').innerText()).replace(/\s+/g, " ");
    const m = rotulo.match(/ · (\d+) ativos?$/);
    expect(m, rotulo).not.toBeNull();
    const valores = await g.locator('[data-testid="pesou-ativo"]').evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-valor"))));
    expect(Number(m![1])).toBe(valores.length);
    if (id === "junto") {
      await expect(g.locator('[data-testid="pesou-sub"]')).toHaveCount(0);
    } else {
      const sub = Number(await g.locator('[data-testid="pesou-sub"]').getAttribute("data-valor"));
      const soma = valores.reduce((s, v) => s + v, 0);
      expect(sub).toBeCloseTo(Math.round(soma * 10) / 10, 9);
    }
  }
  // nada recolhido: todo grupo visível e nenhum "ver mais"
  for (let i = 0; i < n; i++) await expect(gs.nth(i)).toBeVisible();
  await expect(page.locator(tid("ponte-pesou"))).not.toContainText(/ver mais/i);
  expect(errosPagina).toEqual([]);
});

test("e2e: fechamento em todas as janelas fixas e numa livre", async ({ page }) => {
  await autenticar(page);
  await abrir(page);
  let conferidas = 0;
  const fechar = async () => {
    const ids = await page.locator(tid("ponte-linha")).evaluateAll((els) => els.map((e) => e.getAttribute("data-linha")));
    for (const lid of ids) {
      await abrirLinha(page, lid!);
      const linha = Number(await page.locator(`${tid("ponte-linha")}[data-linha="${lid}"]`).getAttribute("data-valor"));
      const valores = await page.locator(tid("pesou-ativo")).evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-valor"))));
      const soma = Math.round(valores.reduce((s, v) => s + v, 0) * 10) / 10;
      expect(soma, `linha ${lid}`).toBeCloseTo(linha, 9);
      conferidas++;
    }
  };
  for (const esc of ["Total", "Brasil"] as const) {
    await escopo(page, esc);
    for (const k of ["12m", "3a", "5a", "desde"]) {
      const botao = page.locator(tid(`rent2-janela-${k}`));
      if ((await botao.getAttribute("aria-disabled")) === "true") continue;
      await botao.click();
      await expect(botao).toHaveAttribute("aria-pressed", "true");
      await fechar();
    }
    await arrastar(page, 10, 14);
    await expect(page.locator(tid("rent2-subtitulo"))).toContainText("Período livre");
    await fechar();
  }
  expect(conferidas).toBeGreaterThanOrEqual(3);
  expect(errosPagina).toEqual([]);
});

test("e2e: ordem dos grupos na tela", async ({ page }) => {
  await abrirBrasil12m(page);
  // acoes_br: −0,4 na 12m do Brasil
  expect(await grupos(page)).toEqual(["tiraram", "somaram", "junto"]);
  // fiis: +0,2
  await abrirLinha(page, "fiis");
  expect(await grupos(page)).toEqual(["somaram", "tiraram"]);
  expect(errosPagina).toEqual([]);
});

test("e2e: 320px sem rolagem horizontal", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await abrirBrasil12m(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  const caixas = await page.locator(`${tid("pesou-sub")}, ${tid("ponte-pesou")} .ponte-pesou-valor`).evaluateAll((els) =>
    els.map((e) => ({ right: e.getBoundingClientRect().right, folgado: e.scrollWidth <= e.clientWidth })),
  );
  expect(caixas.length).toBeGreaterThanOrEqual(11);
  for (const c of caixas) {
    expect(c.right).toBeLessThanOrEqual(320);
    expect(c.folgado).toBe(true);
  }
  const cabs = await page.locator(tid("pesou-cab")).evaluateAll((els) =>
    els.map((e) => ({ right: e.getBoundingClientRect().right, ok: e.scrollWidth <= e.clientWidth })),
  );
  for (const c of cabs) {
    expect(c.right).toBeLessThanOrEqual(320);
    expect(c.ok).toBe(true);
  }
  expect(errosPagina).toEqual([]);
});
