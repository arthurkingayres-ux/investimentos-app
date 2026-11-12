import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";
import { cifrar, decifrar, abrir as abrirComite, resposta, contraste } from "./comite-comum";
import { semTransbordo } from "./olho-comum";

// 7a.BY.4 — o retorno esperado nas telas (spec 7a.BY §10 e §10.1).
//
// Três superfícies, só leitura: a seção "Retorno esperado" no dossiê (frase,
// régua do futuro, dispersão de um ano, método, datas, frase de honestidade e
// "Ver a conta"), o texto secundário sob o ticker na resposta do Comitê em
// #aportar e a linha "Régua do futuro" em #comite.
//
// Fixture 100% SINTÉTICA (repo público): tests/fixtures/retorno.sintetico.json,
// injetada no portfolio de teste decifrado e cifrada de novo na hora; os
// dossiês também são sintéticos e mínimos.

const F = (n: string) => fs.readFileSync(path.join(__dirname, "../fixtures/" + n), "utf-8");
const PORTFOLIO = F("portfolio.test.json.enc");
const IDX_REL = F("relatorios_index.test.json.enc");
const IDX_DOSSIES_CLARO = decifrar(F("dossies_index.test.json.enc"));
const RETORNO = () => JSON.parse(F("retorno.sintetico.json"));

const CATEGORIA: Record<string, string> = {
  EMPR3: "Ação BR", FUND11: "FII", ETFX11: "ETF", CRIP11: "Cripto", VELH3: "Ação BR", ALTO3: "Ação BR", SEMB3: "Ação BR", NEGA11: "ETF", ARRE3: "Ação BR",
};

function dossie(ticker: string): any {
  return {
    schema: "dossie_empresa_v1",
    ticker,
    nome: "Exemplo " + ticker,
    escopo: "Brasil",
    categoria: CATEGORIA[ticker],
    ri_portal_url: null,
    aberto_em: "2026-01-02",
    tese: { resumo: "Tese sintética de exemplo.", quebra_se: "Margem abaixo de 20% por dois trimestres.", revisada_em: null },
    ultima_verificacao_leve: null,
    timeline: [],
  };
}

const arquivo = (t: string) => `d_ret_${t.toLowerCase()}.json.enc`;

type Abrir = { retorno?: (r: any) => void; semBloco?: boolean; tema?: "dark" | null; erros?: string[] };

async function abrirDossie(page: Page, ticker: string, o: Abrir = {}) {
  const p = decifrar(PORTFOLIO);
  if (o.semBloco) delete p.retorno_esperado;
  else {
    const r = RETORNO();
    if (o.retorno) o.retorno(r);
    p.retorno_esperado = r;
  }
  const portfolio = cifrar(JSON.stringify(p));
  const idx = JSON.parse(JSON.stringify(IDX_DOSSIES_CLARO));
  idx.dossies.push(...Object.keys(CATEGORIA).map((t) => ({
    ticker: t, nome: "Exemplo " + t, categoria: CATEGORIA[t], escopo: "Brasil", arquivo: arquivo(t), sha256: "x",
  })));
  const idxCifrado = cifrar(JSON.stringify(idx));
  const cifrados: Record<string, string> = {};
  await page.route("**/portfolio.json.enc", (r) => r.fulfill({ status: 200, body: portfolio, contentType: "text/plain" }));
  await page.route("**/relatorios_index.json.enc", (r) => r.fulfill({ status: 200, body: IDX_REL, contentType: "text/plain" }));
  await page.route("**/dossies_index.json.enc", (r) => r.fulfill({ status: 200, body: idxCifrado, contentType: "text/plain" }));
  await page.route("**/d_*.json.enc", (r) => {
    const nome = r.request().url().split("/").pop()!.split("?")[0];
    const t = Object.keys(CATEGORIA).find((k) => arquivo(k) === nome);
    if (!t) return r.fulfill({ status: 404, body: "", contentType: "text/plain" });
    cifrados[nome] ??= cifrar(JSON.stringify(dossie(t)));
    return r.fulfill({ status: 200, body: cifrados[nome], contentType: "text/plain" });
  });
  if (o.erros) {
    const erros = o.erros;
    page.on("pageerror", (e) => erros.push("pageerror: " + e.message));
    page.on("console", (m) => {
      if (m.type() === "error" || m.text().includes("Alpine Expression Error")) erros.push("console: " + m.text());
    });
  }
  await page.addInitScript((tema) => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem("pinTimestamp", String(Date.now() - 24 * 60 * 60 * 1000));
    if (tema) localStorage.setItem("tema", tema);
  }, o.tema ?? null);
  await page.goto("/");
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
  await page.evaluate((t) => { location.hash = `#/dossie/${t}`; }, ticker);
  await expect(page.locator(".tela-dossie .dossie-corpo")).toBeVisible({ timeout: 10_000 });
}

const SECAO = ".tela-dossie [data-testid='dossie-retorno']";
const sec = (page: Page) => page.locator(SECAO);
const HONESTIDADE = "Estimativa. É a peça mais incerta do app; o placar dirá se ela ordena bem. Até lá, não prova nada.";
const PROIBIDO = /vai render|barato|caro|\bcompre\b|—/i;

test.describe("7a.BY.4 — dossiê, seção Retorno esperado", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("faixa normal: frase, régua, dispersão, método, datas e honestidade", async ({ page }) => {
    const erros: string[] = [];
    await abrirDossie(page, "EMPR3", { erros });
    const s = sec(page);
    await expect(s.locator("h2")).toHaveText("Retorno esperado");
    await expect(s.getByTestId("retorno-frase")).toHaveText(
      "Ao preço de hoje, entre 4,0% e 9,5% ao ano acima da inflação; o meio da conta dá 7,2%.",
    );
    await expect(s.getByTestId("retorno-dispersao")).toHaveText("Num ano qualquer, este ativo variou cerca de ±24,3 pontos.");
    await expect(s.getByTestId("retorno-metodo")).toHaveText(
      "Rendimento do lucro de 5 anos ao preço de hoje; o que muda entre as pontas é quanto o lucro retido rende.",
    );
    // Spec §10.1 item 5: as duas datas, nos formatos dd/mm/aa e dd/mm.
    await expect(s.getByTestId("retorno-datas")).toHaveText(/^Fundamentos de \d{2}\/\d{2}\/\d{2} · preço de \d{2}\/\d{2}$/);
    await expect(s.getByTestId("retorno-datas")).toHaveText("Fundamentos de 31/12/25 · preço de 10/11");
    await expect(s.getByTestId("retorno-honestidade")).toHaveText(HONESTIDADE);
    await expect(s.getByTestId("retorno-convencao")).toHaveCount(0);
    await expect(s.getByTestId("retorno-velhos")).toHaveCount(0);
    expect(await s.innerText()).not.toMatch(PROIBIDO);
    expect(erros).toEqual([]);
  });

  test("régua: eixo fixo 0 a eixo_teto, traço do pessimista ao otimista, faixa do ano por trás", async ({ page }) => {
    await abrirDossie(page, "EMPR3");
    const svg = sec(page).locator("figure[data-testid='retorno-regua'] svg");
    await expect(svg).toHaveAttribute("role", "img");
    await expect(svg).toHaveAttribute("aria-label",
      "Régua de 0% a 20% ao ano: estimativa entre 4,0% e 9,5%, meio 7,2%; num ano qualquer, cerca de ±24,3 pontos.");
    const n = async (sel: string, attr: string) => Number(await svg.locator(sel).getAttribute(attr));
    const x1 = await n(".ret-regua__traco", "x1"), x2 = await n(".ret-regua__traco", "x2");
    const xc = await n(".ret-regua__ponto", "cx");
    const fx = await n(".ret-regua__faixa", "x"), fw = await n(".ret-regua__faixa", "width");
    // Eixo de 12 a 288 (276 unidades) para 0% a 20%: 4,0% ⇒ 12 + 276·0,198 = 66,6.
    expect(x1).toBeCloseTo(12 + 276 * (0.0396 / 0.2), 1);
    expect(x2).toBeCloseTo(12 + 276 * (0.0954 / 0.2), 1);
    expect(xc).toBeCloseTo(12 + 276 * (0.072 / 0.2), 1);
    // A faixa do ano (central ± 24,31 p.p., recortada no eixo) é mais larga que o traço.
    expect(fx).toBeCloseTo(12, 1);
    expect(fx + fw).toBeCloseTo(12 + 276 * ((0.072 + 0.2431) / 0.2 > 1 ? 1 : (0.072 + 0.2431) / 0.2), 1);
    expect(fw).toBeGreaterThan(x2 - x1);
    await expect(svg.locator(".ret-regua__seta--esq")).toBeHidden();
    await expect(svg.locator(".ret-regua__seta--dir")).toBeHidden();
    await expect(sec(page).locator(".ret-regua__rotulos")).toHaveText(/0%\s*10%\s*20%/);
  });

  test("teto do eixo vem do payload", async ({ page }) => {
    await abrirDossie(page, "EMPR3", { retorno: (r) => { r.eixo_teto = 0.1; } });
    const svg = sec(page).locator("figure[data-testid='retorno-regua'] svg");
    expect(Number(await svg.locator(".ret-regua__ponto").getAttribute("cx"))).toBeCloseTo(12 + 276 * 0.72, 1);
    await expect(sec(page).locator(".ret-regua__rotulos")).toHaveText(/0%\s*5%\s*10%/);
  });

  for (const [nome, mudar] of [["ausente", (r: any) => { delete r.eixo_teto; }], ["zero", (r: any) => { r.eixo_teto = 0; }]] as const) {
    test(`teto do eixo ${nome} no payload: cai em 20%`, async ({ page }) => {
      await abrirDossie(page, "EMPR3", { retorno: mudar });
      const svg = sec(page).locator("figure[data-testid='retorno-regua'] svg");
      expect(Number(await svg.locator(".ret-regua__ponto").getAttribute("cx"))).toBeCloseTo(12 + 276 * 0.36, 1);
      await expect(sec(page).locator(".ret-regua__rotulos")).toHaveText(/0%\s*10%\s*20%/);
    });
  }

  test("valor fora do eixo encosta na borda com seta", async ({ page }) => {
    await abrirDossie(page, "ALTO3");
    const svg = sec(page).locator("figure[data-testid='retorno-regua'] svg");
    expect(Number(await svg.locator(".ret-regua__traco").getAttribute("x2"))).toBeCloseTo(288, 1);
    await expect(svg.locator(".ret-regua__seta--dir")).toBeVisible();
    await expect(svg.locator(".ret-regua__seta--esq")).toBeHidden();
    await expect(svg).toHaveAttribute("aria-label", /22,7%, além do fim da régua/);
  });

  test("valor abaixo de zero encosta na borda esquerda com seta", async ({ page }) => {
    await abrirDossie(page, "NEGA11");
    const svg = sec(page).locator("figure[data-testid='retorno-regua'] svg");
    expect(Number(await svg.locator(".ret-regua__traco").getAttribute("x1"))).toBeCloseTo(12, 1);
    await expect(svg.locator(".ret-regua__seta--esq")).toBeVisible();
    await expect(svg.locator(".ret-regua__seta--dir")).toBeHidden();
    await expect(svg).toHaveAttribute("aria-label", /−0,1%, aquém do início da régua/);
  });

  test("linha do placar: n_maduros ausente e IC que arredonda a zero", async ({ page }) => {
    await abrirDossie(page, "EMPR3");
    const l = await page.evaluate(() => {
      const f = (window as any).retornoEsperado.linhaPlacar;
      return [
        f({ n_retratos: 40, grau: "inconclusivo", ic_medio: { geral: -0.001 }, n_maduros: 37 }),
        f({ n_retratos: 40, grau: "inconclusivo", ic_medio: { geral: 0.05 } }),
      ];
    });
    expect(l[0]).toBe("Régua do futuro: inconclusiva · IC médio 0,00 em 37 retratos maduros");
    expect(l[1]).toBe("Régua do futuro: inconclusiva · IC médio 0,05");
  });

  test("Ver a conta: fechado por padrão; aberto mostra insumos e os três cenários", async ({ page }) => {
    await abrirDossie(page, "EMPR3");
    const conta = sec(page).getByTestId("retorno-conta");
    await expect(conta).not.toHaveAttribute("open", "");
    await expect(conta.getByTestId("retorno-cenario").first()).toBeHidden();
    await conta.locator("summary").click();
    await expect(conta).toHaveAttribute("open", "");
    await expect(conta.getByTestId("retorno-insumo")).toHaveText([
      /Rendimento do lucro.*7,2%/, /distribuída.*55,0%/, /ROE.*12,4%/,
    ]);
    await expect(conta.getByTestId("retorno-cenario")).toHaveText([
      /Só o lucro distribuído rende.*4,0%/, /O lucro retido rende como o de hoje.*7,2%/, /O lucro retido rende o ROE.*9,5%/,
    ]);
    expect(await conta.innerText()).not.toMatch(PROIBIDO);
  });

  test("Ver a conta mostra os valores publicados, não os refeitos com insumos arredondados", async ({ page }) => {
    // ARRE3: insumos de 4 casas refazem y·p = 3,625% ("3,6") e y·p + ROE·(1−p) = 8,625% ("8,6");
    // o publicado, do valor cheio, é 3,65% e 8,65%. A conta tem de bater com a frase.
    await abrirDossie(page, "ARRE3");
    const s = sec(page);
    await expect(s.getByTestId("retorno-frase")).toContainText("entre 3,7% e 8,7%");
    await s.getByTestId("retorno-conta").locator("summary").click();
    await expect(s.getByTestId("retorno-cenario")).toHaveText([/3,7%$/, /7,3%$/, /8,7%$/]);
  });

  test("FII: método e conta próprios", async ({ page }) => {
    await abrirDossie(page, "FUND11");
    const s = sec(page);
    await expect(s.getByTestId("retorno-frase")).toHaveText(
      "Ao preço de hoje, entre 7,5% e 10,5% ao ano acima da inflação; o meio da conta dá 8,5%.",
    );
    await expect(s.getByTestId("retorno-metodo")).toContainText("renda dos últimos 12 meses");
    await s.getByTestId("retorno-conta").locator("summary").click();
    await expect(s.getByTestId("retorno-cenario")).toHaveText([/pior queda.*7,5%/i, /renda de hoje.*8,5%/i, /renda cresce.*10,5%/i]);
  });

  test("convenção declarada (ETF)", async ({ page }) => {
    await abrirDossie(page, "ETFX11");
    const s = sec(page);
    await expect(s.getByTestId("retorno-convencao")).toHaveText("A fonte publica um ponto; a faixa é convenção desta casa.");
    await expect(s.getByTestId("retorno-frase")).toContainText("6,0%");
    // Sem dispersão (cotação curta): sem a linha e sem a faixa do ano na régua.
    await expect(s.getByTestId("retorno-dispersao")).toHaveCount(0);
    await expect(s.locator(".ret-regua__faixa")).toBeHidden();
  });

  test("sem faixa: o motivo por extenso, em uma linha, sem régua", async ({ page }) => {
    await abrirDossie(page, "CRIP11");
    const s = sec(page);
    await expect(s.getByTestId("retorno-motivo")).toHaveText(
      await page.evaluate(() => (window as any).retornoEsperado.MOTIVOS.cripto),
    );
    await expect(s.getByTestId("retorno-regua")).toHaveCount(0);
    await expect(s.getByTestId("retorno-frase")).toHaveCount(0);
  });

  test("todo motivo do mapa tem frase por extenso, sem jargão nem travessão", async ({ page }) => {
    await abrirDossie(page, "CRIP11");
    const motivos = await page.evaluate(() => (window as any).retornoEsperado.MOTIVOS);
    expect(Object.keys(motivos).length).toBeGreaterThanOrEqual(13);
    for (const [k, v] of Object.entries(motivos)) {
      expect(typeof v, k).toBe("string");
      expect((v as string).length, k).toBeGreaterThan(20);
      expect(v as string, k).not.toMatch(/_|—/);
      expect(v as string, k).not.toMatch(PROIBIDO);
    }
    // Motivo desconhecido (versão nova do backend) cai numa frase genérica, nunca no código cru.
    expect(await page.evaluate(() => (window as any).retornoEsperado.fraseMotivo("motivo_novo"))).not.toMatch(/_/);
  });

  test("fundamentos velhos: aviso explícito com a data", async ({ page }) => {
    await abrirDossie(page, "VELH3");
    await expect(sec(page).getByTestId("retorno-velhos")).toHaveText(
      "Atenção: os fundamentos são de 31/12/24. A estimativa pode não refletir a empresa de hoje.",
    );
  });

  test("bloco ausente (payload antigo) ou ativo fora do bloco: indisponível hoje", async ({ page }) => {
    await abrirDossie(page, "EMPR3", { semBloco: true });
    await expect(sec(page).getByTestId("retorno-indisponivel")).toHaveText("Retorno esperado indisponível hoje.");
  });

  test("ativo que não está no bloco: indisponível hoje", async ({ page }) => {
    await abrirDossie(page, "SEMB3");
    await expect(sec(page).getByTestId("retorno-indisponivel")).toHaveText("Retorno esperado indisponível hoje.");
  });

  test("offline: diz de quando é a estimativa guardada", async ({ page, context }) => {
    await abrirDossie(page, "FUND11");
    await expect(sec(page).getByTestId("retorno-offline")).toHaveCount(0);
    await page.evaluate(() => { location.hash = "#/raiox"; });
    await context.setOffline(true);
    await page.evaluate(() => { location.hash = "#/dossie/EMPR3"; });
    await expect(sec(page).getByTestId("retorno-offline")).toHaveText("Sem rede: estimativa de 10/11, a última que o aparelho guardou.");
    await context.setOffline(false);
  });
});

test.describe("7a.BY.4 — 320 px nos dois temas", () => {
  test.use({ viewport: { width: 320, height: 700 } });
  for (const tema of [null, "dark"] as const) {
    test(`dossiê sem transbordo e legível (${tema ?? "claro"})`, async ({ page }) => {
      await abrirDossie(page, "EMPR3", { tema });
      await sec(page).getByTestId("retorno-conta").locator("summary").click();
      await semTransbordo(page, SECAO);
      // Texto secundário (honestidade, datas) com contraste AA sobre o fundo real.
      for (const id of ["retorno-honestidade", "retorno-datas", "retorno-frase"]) {
        const [cor, fundo] = await sec(page).getByTestId(id).evaluate((el) => {
          let n: Element | null = el, bg = "rgba(0, 0, 0, 0)";
          while (n && (bg === "rgba(0, 0, 0, 0)" || bg === "transparent")) { bg = getComputedStyle(n).backgroundColor; n = n.parentElement; }
          return [getComputedStyle(el).color, bg];
        });
        expect(contraste(cor, fundo), id).toBeGreaterThanOrEqual(4.5);
      }
      // O traço da expectativa contra o fundo: 3:1 (WCAG 1.4.11).
      const [traco, fundo] = await sec(page).locator(".ret-regua__traco").evaluate((el) => {
        let n: Element | null = el.closest("section"), bg = "rgba(0, 0, 0, 0)";
        while (n && (bg === "rgba(0, 0, 0, 0)" || bg === "transparent")) { bg = getComputedStyle(n).backgroundColor; n = n.parentElement; }
        return [getComputedStyle(el).stroke, bg];
      });
      expect(contraste(traco, fundo)).toBeGreaterThanOrEqual(3);
      await sec(page).screenshot({ path: `test-results/retorno-320-${tema ?? "claro"}.png` });
    });
  }
});

test.describe("7a.BY.4 — Comitê", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("#aportar: faixa em texto secundário sob o ticker; nada sem faixa", async ({ page }) => {
    await abrirComite(page, { resposta: resposta(), portfolio: (p) => { p.retorno_esperado = RETORNO(); } });
    const linha = (t: string) => page.locator(`.tela-aportar .comite-linha[data-ticker="${t}"]`);
    await expect(linha("ZZAA3").locator(".comite-ret")).toHaveText("retorno esperado 6,1% a 9,5% a.a. real");
    await expect(linha("ZZBB11").locator(".comite-ret")).toHaveCount(0);
    await expect(linha("ZZDD").locator(".comite-ret")).toHaveCount(0);
    await expect(linha("ZZAA3").locator(".comite-tk")).toHaveText("ZZAA3");
  });

  test("#aportar sem o bloco: nenhuma linha de retorno", async ({ page }) => {
    await abrirComite(page, { resposta: resposta() });
    await expect(page.locator(".tela-aportar .comite-ret")).toHaveCount(0);
  });

  test("#comite: Régua do futuro, histórico curto com N retratos e o primeiro veredito", async ({ page }) => {
    await abrirComite(page, { resposta: resposta(), hash: "#comite", portfolio: (p) => { p.retorno_esperado = RETORNO(); } });
    await expect(page.locator(".tela-comite [data-testid='comite-regua']")).toHaveText(
      "Régua do futuro: histórico curto · 1 retrato (primeiro veredito em out/2030)",
    );
  });

  test("#comite: sem retrato ainda, sem placar antigo: nada", async ({ page }) => {
    await abrirComite(page, {
      resposta: resposta(), hash: "#comite",
      portfolio: (p) => { const r = RETORNO(); delete r.placar.n_retratos; p.retorno_esperado = r; },
    });
    await expect(page.locator(".tela-comite [data-testid='comite-regua']")).toHaveCount(0);
  });

  test("#comite: com grau, grau e IC médio lado a lado", async ({ page }) => {
    await abrirComite(page, {
      resposta: resposta(), hash: "#comite",
      portfolio: (p) => {
        const r = RETORNO();
        Object.assign(r.placar, { n_retratos: 48, n_maduros: 37, grau: "inconclusivo", ic_medio: { geral: -0.0812, acoes: null, fiis: null } });
        p.retorno_esperado = r;
      },
    });
    await expect(page.locator(".tela-comite [data-testid='comite-regua']")).toHaveText(
      "Régua do futuro: inconclusiva · IC médio −0,08 em 37 retratos maduros",
    );
  });
});
