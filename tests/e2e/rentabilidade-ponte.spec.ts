import { test, expect, Page } from "@playwright/test";
import { esperarResume } from "./esperar-resume";
import path from "path";
import fs from "fs";

// Fase 7a.BD.2 — a nova #rentabilidade como ponte: a carteira contra a mesma
// carteira feita só de índices (spec 2026-10-21-fase-7a-bd, §2/§6/§7/§8).
//
// Fixture 100% sintética (repo público): tests/fixtures/gerar_fixture.py,
// `_ponte_sintetica`. 30 meses (2024-04..2026-09); buraco de cotação no mês 4
// (ago/24, Total e Brasil); IFIX null no mês 8 (dez/24); 12m disponível em
// todo escopo; 3a/5a indisponíveis ("histórico começa em ..."); `desde`
// disponível só em EUA. Os números esperados abaixo saem da referência Python
// (tests/fixtures/ponte_esperado.test.json) arredondados a 1 casa pelo maior
// resto — o mesmo `arredondarFechando` que a tela usa.

const FIXTURES = path.join(__dirname, "../fixtures");
const lerFixture = (nome: string) => fs.readFileSync(path.join(FIXTURES, nome), "utf-8");

const TELA = ".tela-rentabilidade";
const tid = (id: string) => `${TELA} [data-testid="${id}"]`;

async function autenticar(page: Page, fixture = "portfolio.test.json.enc") {
  const corpo = lerFixture(fixture);
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

// Altera o payload decifrado ANTES de o app usá-lo (o arquivo é cifrado, e a
// fixture não tem estas variantes): embrulha JSON.parse e aplica `corpo` ao
// objeto que tem a forma do portfolio (chaves `versao` e `ponte`).
async function mexerNoPayload(page: Page, corpo: string) {
  await page.addInitScript((c) => {
    const real = JSON.parse;
    const mexer = new Function("p", c) as (p: any) => void;
    JSON.parse = function (texto: string, reviver?: any) {
      const o = real.call(JSON, texto, reviver);
      if (o && typeof o === "object" && "versao" in o && "ponte" in o) mexer(o);
      return o;
    } as typeof JSON.parse;
  }, corpo);
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

// Arrasto no trilho do gráfico: a mesma ação `dataZoom` que o slider do ECharts
// despacha quando o dedo move a alça. Janela em índices de `ponte.meses`
// (iIni..iFim inclusivos); o eixo do gráfico começa na âncora do escopo
// (`_rentCtx.off`), e a janela começa um mês depois da âncora.
async function arrastar(page: Page, iIni: number, iFim: number) {
  await page.evaluate(([a, b]) => {
    const d = (window as any).Alpine.$data(document.body);
    const off = d._rentCtx.off;
    d.echartsRent.dispatchAction({ type: "dataZoom", startValue: a - 1 - off, endValue: b - off });
  }, [iIni, iFim]);
}

async function linhasDaPonte(page: Page) {
  return page.locator(tid("ponte-linha")).evaluateAll((els) =>
    els.map((e) => ({
      id: e.getAttribute("data-linha"),
      valor: Number(e.getAttribute("data-valor")),
      sinal: e.getAttribute("data-sinal"),
      pressed: e.getAttribute("aria-pressed"),
      texto: (e.textContent || "").replace(/\s+/g, " ").trim(),
    })),
  );
}

async function tickersPesou(page: Page) {
  return page.locator(tid("pesou-ativo")).evaluateAll((els) => els.map((e) => e.getAttribute("data-ticker")));
}

test.describe("7a.BD.2 — #rentabilidade como ponte", () => {
  test("abre em 12 meses: veredito, pontos ao ano, os dois retornos e o fim da série", async ({ page }) => {
    await autenticar(page);
    await abrir(page);

    await expect(page.locator(tid("rent2-janela-12m"))).toHaveAttribute("aria-pressed", "true");
    for (const k of ["3a", "5a", "desde"]) {
      await expect(page.locator(tid(`rent2-janela-${k}`))).toHaveAttribute("aria-pressed", "false");
    }
    await expect(page.locator(tid("rent2-frase"))).toHaveText(
      "Nos últimos 12 meses, você ganhou da sua carteira de índices.",
    );
    await expect(page.locator(tid("rent2-numero"))).toHaveText("▲ +1,0");
    await expect(page.locator(tid("rent2-unidade"))).toHaveText("ponto ao ano");
    await expect(page.locator(tid("rent2-par-sua"))).toContainText("19,6% ao ano");
    await expect(page.locator(tid("rent2-par-ind"))).toContainText("18,6% ao ano");
    // fim da série a partir de ponte.ate (2026-09), âncora = fim de set/25
    await expect(page.locator(tid("rent2-subtitulo"))).toHaveText("Cresceu desde set/25 · até set/26");
    // nada da tela antiga
    await expect(page.locator(`${TELA} .rent-grupo, ${TELA} .rent-periodo, ${TELA} .rent-legenda`)).toHaveCount(0);
    // gráfico com duas séries, só a carteira e o composto
    const nomes = await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      return d.echartsRent.getOption().series.map((s: any) => s.name);
    });
    expect(nomes).toEqual(["Sua carteira", "Mesma carteira, só com índices"]);
  });

  test("janela longa sem histórico: botão desabilitado com o motivo, a janela não muda", async ({ page }) => {
    await autenticar(page);
    await abrir(page);

    const tres = page.locator(tid("rent2-janela-3a"));
    await expect(tres).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator(tid("rent2-janela-5a"))).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator(tid("rent2-janela-12m"))).not.toHaveAttribute("aria-disabled", "true");
    await expect(page.locator(tid("rent2-motivo"))).toBeHidden();

    // aria-disabled (não `disabled`): continua focável e tocável para dizer o
    // motivo — o Playwright o trata como desabilitado, daí o force.
    await tres.click({ force: true });
    await expect(page.locator(tid("rent2-motivo"))).toHaveText("Histórico começa em mai/24.");
    await expect(page.locator(tid("rent2-janela-12m"))).toHaveAttribute("aria-pressed", "true");
    await expect(tres).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(tid("rent2-numero"))).toHaveText("▲ +1,0");

    // Desde, em Total, cruza o buraco de cotação de ago/24: o motivo do backend
    // chega traduzido, nunca com id interno.
    await page.locator(tid("rent2-janela-desde")).click({ force: true });
    await expect(page.locator(tid("rent2-motivo"))).toHaveText("Falta a cotação de um ativo em ago/24.");
    await expect(page.locator(tid("rent2-janela-12m"))).toHaveAttribute("aria-pressed", "true");
  });

  test("botão de janela longa disponível troca número, ponte e subtítulo (EUA, Desde)", async ({ page }) => {
    await autenticar(page);
    await abrir(page);
    await escopo(page, "EUA");

    await expect(page.locator(tid("rent2-numero"))).toHaveText("▲ +1,0");
    const antes = await linhasDaPonte(page);
    expect(antes.map((l) => [l.id, l.valor])).toEqual([["picks", 1.2], ["fora", -0.2]]);

    await page.locator(tid("rent2-janela-desde")).click();
    await expect(page.locator(tid("rent2-janela-desde"))).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(tid("rent2-janela-12m"))).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(tid("rent2-numero"))).toHaveText("▲ +0,4");
    await expect(page.locator(tid("rent2-frase"))).toHaveText(
      "Desde mai/24, você ganhou da sua carteira americana de índices.",
    );
    await expect(page.locator(tid("rent2-par-sua"))).toContainText("55,5% ao ano");
    await expect(page.locator(tid("rent2-subtitulo"))).toHaveText("Cresceu desde mai/24 · até set/26");
    const depois = await linhasDaPonte(page);
    expect(depois.map((l) => [l.id, l.valor])).toEqual([["picks", 0.8], ["fora", -0.4]]);
  });

  // 7a.BE.2: bloco longo (72 meses, `_ponte_longa`), Total/BRL. Literais derivados
  // uma vez da referência Python (a partir de Investimentos/, PYTHONPATH=.):
  //   caso "janelas_fixas" com bloco_ref "longo", Total/BRL, em
  //   tests/fixtures/ponte_esperado.test.json; sua e ind = x*100 a 1 casa;
  //   linhas = arredondar_fechando([contrib*100 ...], sua_d - ind_d, 1), com
  //   sua_d/ind_d já arredondados (é o que a tela faz em rent2Vista: as linhas
  //   fecham na diferença EXIBIDA). 3a: 9,8 / 8,8 -> 1,0 -> acoes_br 0,3.
  //   5a: 11,4 / 10,4 -> 1,0 -> acoes_br 0,3. Refeitos na 7a.BG.1 (cripto fora
  //   da carteira: a fixture regenerada não tem mais a linha Cripto).
  test("bloco longo: 3a e 5a disponíveis trocam número, pares e a primeira linha", async ({ page }) => {
    await autenticar(page, "portfolio_ponte_longa.test.json.enc");
    await abrir(page);

    const casos: [string, string, string, string, number][] = [
      ["3a", "9,8% ao ano", "8,8% ao ano", "acoes_br", 0.3],
      ["5a", "11,4% ao ano", "10,4% ao ano", "acoes_br", 0.3],
    ];
    for (const [k, sua, ind, id, valor] of casos) {
      const botao = page.locator(tid(`rent2-janela-${k}`));
      await expect(botao).not.toHaveAttribute("aria-disabled", "true");
      await botao.click();
      await expect(botao).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator(tid("rent2-par-sua"))).toContainText(sua);
      await expect(page.locator(tid("rent2-par-ind"))).toContainText(ind);
      const linhas = await linhasDaPonte(page);
      expect([linhas[0].id, linhas[0].valor]).toEqual([id, valor]);
    }
  });

  test("janela fixa que não existe no novo escopo volta a 12 meses e diz o motivo", async ({ page }) => {
    await autenticar(page);
    await abrir(page);
    await escopo(page, "EUA");
    await page.locator(tid("rent2-janela-desde")).click();
    await expect(page.locator(tid("rent2-janela-desde"))).toHaveAttribute("aria-pressed", "true");

    // Em Total, "Desde" cruza o buraco de ago/24: não fica marcada nem esconde a tela.
    await escopo(page, "Total");
    await expect(page.locator(tid("rent2-janela-12m"))).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(tid("rent2-janela-desde"))).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(tid("rent2-motivo"))).toHaveText("Falta a cotação de um ativo em ago/24.");
    await expect(page.locator(tid("rent2-janela-indisp"))).toBeHidden();
    await expect(page.locator(tid("rent2-numero"))).toHaveText("▲ +1,0");
    await expect(page.locator(tid("rent2-frase"))).toHaveText(
      "Nos últimos 12 meses, você ganhou da sua carteira de índices.",
    );

    // Um arrasto pelo buraco agora tem para onde voltar (a 12m aceita).
    await arrastar(page, 3, 6);
    await expect(page.locator(tid("rent2-janela-12m"))).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(tid("rent2-numero"))).toHaveText("▲ +1,0");

    // De volta a EUA a janela fixa escolhida (12m) segue valendo; o motivo some.
    await escopo(page, "EUA");
    await expect(page.locator(tid("rent2-janela-12m"))).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(tid("rent2-motivo"))).toBeHidden();
  });

  test("arrasto de 5 meses: nenhuma janela marcada e 'no período' em número, ponte e detalhes", async ({ page }) => {
    await autenticar(page);
    await abrir(page);

    await arrastar(page, 10, 14);
    await expect(page.locator(tid("rent2-subtitulo"))).toHaveText("Período livre · de jan/25 a jun/25 (5 meses)");
    for (const k of ["12m", "3a", "5a", "desde"]) {
      await expect(page.locator(tid(`rent2-janela-${k}`))).toHaveAttribute("aria-pressed", "false");
    }
    await expect(page.locator(tid("rent2-frase"))).toHaveText(
      "De jan/25 a jun/25, você ganhou da sua carteira de índices.",
    );
    await expect(page.locator(tid("rent2-numero"))).toHaveText("▲ +0,4");
    await expect(page.locator(tid("rent2-unidade"))).toHaveText("ponto no período");
    await expect(page.locator(tid("rent2-par-sua"))).toContainText("10,4% no período");
    await expect(page.locator(tid("rent2-par-ind"))).toContainText("10,0% no período");
    await expect(page.locator(tid("ponte"))).toContainText("Em pontos no período. Toque numa linha.");
    await page.locator(`${tid("ponte-linha")}[data-linha="eua"]`).click();
    await expect(page.locator(tid("ponte-pesou"))).toContainText(
      "EUA somaram 0,2 ponto no período contra o S&P 500 com dividendos.",
    );
    await expect(page.locator(tid("rent2-detalhes"))).toContainText("no período");
    await expect(page.locator(tid("rent2-detalhes"))).not.toContainText("ao ano");
    await expect(page.locator(tid("rent2-motivo"))).toBeHidden();
  });

  test("arrasto que cruza o buraco ou o IFIX nulo: motivo legível e a janela volta à última válida", async ({ page }) => {
    await autenticar(page);
    await abrir(page);

    await arrastar(page, 3, 6); // inclui ago/24, mês com cotação ausente
    await expect(page.locator(tid("rent2-motivo"))).toHaveText("Falta a cotação de um ativo em ago/24.");
    await expect(page.locator(tid("rent2-janela-12m"))).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(tid("rent2-numero"))).toHaveText("▲ +1,0");
    await expect(page.locator(tid("rent2-subtitulo"))).toHaveText("Cresceu desde set/25 · até set/26");
    const zoom = await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      const dz = d.echartsRent.getOption().dataZoom[0];
      return [Math.round(dz.startValue) + d._rentCtx.off + 1, Math.round(dz.endValue) + d._rentCtx.off];
    });
    expect(zoom).toEqual([18, 29]);

    await escopo(page, "Brasil");
    await arrastar(page, 7, 9); // inclui dez/24, IFIX sem dado
    await expect(page.locator(tid("rent2-motivo"))).toHaveText("O IFIX não tem dado em dez/24.");
    await expect(page.locator(tid("rent2-janela-12m"))).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(TELA)).not.toContainText("SP500TR");
  });

  test("ponte: abre na linha que mais tirou e o toque troca 'quem pesou'", async ({ page }) => {
    await autenticar(page);
    await abrir(page);
    await escopo(page, "Brasil");

    const linhas = await linhasDaPonte(page);
    expect(linhas.map((l) => l.id)).toEqual(["acoes_br", "fiis"]);
    const menor = Math.min(...linhas.map((l) => l.valor));
    const aberta = linhas.find((l) => l.pressed === "true")!;
    expect(aberta.valor).toBe(menor);
    expect(aberta.id).toBe("fiis");
    await expect(page.locator(tid("ponte-pesou"))).toContainText(
      "FIIs somaram 0,4 ponto ao ano contra o IFIX.",
    );
    expect((await tickersPesou(page)).sort()).toEqual(["HGLG11", "XPML11"]);

    await page.locator(`${tid("ponte-linha")}[data-linha="acoes_br"]`).click();
    await expect(page.locator(`${tid("ponte-linha")}[data-linha="acoes_br"]`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(`${tid("ponte-linha")}[data-linha="fiis"]`)).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(tid("ponte-pesou"))).toContainText(
      "Ações BR somaram 0,5 ponto ao ano contra o Ibovespa.",
    );
    // a linha positiva lista primeiro o grupo de quem somou
    expect(await tickersPesou(page)).toEqual(["ITSA4", "BBAS3"]);
    await expect(page.locator(`${tid("pesou-ativo")}[data-ticker="ITSA4"]`)).toContainText("▲ +0,9");
    await expect(page.locator(`${tid("pesou-ativo")}[data-ticker="BBAS3"]`)).toContainText("▼ −0,4");

    // EUA abre em "Fora da política atual" (singular) — a linha negativa
    await escopo(page, "EUA");
    await expect(page.locator(`${tid("ponte-linha")}[data-linha="fora"]`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(tid("ponte-pesou"))).toContainText(
      "Fora da política atual tirou 0,2 ponto ao ano contra o S&P 500 com dividendos.",
    );
  });

  test("a soma exibida das linhas fecha a diferença do topo; passivo nunca aparece", async ({ page }) => {
    await autenticar(page);
    await abrir(page);

    for (const nome of ["Total", "Brasil", "EUA"] as const) {
      await escopo(page, nome);
      const linhas = await linhasDaPonte(page);
      const ind = Number(await page.locator(tid("ponte-total-ind")).getAttribute("data-valor"));
      const sua = Number(await page.locator(tid("ponte-total-sua")).getAttribute("data-valor"));
      const soma = linhas.reduce((a, l) => a + l.valor, 0);
      expect(Math.round((ind + soma) * 10) / 10).toBe(sua);

      const vistos: string[] = [];
      for (const l of linhas) {
        await page.locator(`${tid("ponte-linha")}[data-linha="${l.id}"]`).click();
        vistos.push(...((await tickersPesou(page)) as string[]));
      }
      for (const passivo of ["BOVA11", "IMAB11", "VOO"]) {
        expect(vistos).not.toContain(passivo);
        await expect(page.locator(TELA)).not.toContainText(passivo);
      }
    }
  });

  // Spec §8: "Totais (início e fim) em barra cheia neutra". Um eixo truncado
  // nos totais (toco + marca de corte contra barra quase cheia) fazia 18,7%
  // contra 19,7% parecer muitas vezes mais. A guia tracejada, que é uma caixa
  // da largura do trilho deslocada por transform, não pode vazar para a
  // coluna do valor.
  test("totais da ponte em barra cheia neutra, mesma largura, sem marca de corte; guia presa ao trilho", async ({ page }) => {
    await autenticar(page);
    await abrir(page);

    for (const nome of ["Total", "Brasil", "EUA"] as const) {
      await escopo(page, nome);
      await page.waitForTimeout(500); // transição das barras (--d2) assenta
      const m = await page.evaluate(() => {
        const tela = document.querySelector(".tela-rentabilidade")!;
        const caixa = (sel: string) => tela.querySelector(sel)!.getBoundingClientRect();
        const trilho = caixa('[data-testid="ponte-total-ind"] .ponte-trilho');
        const ind = caixa(".ponte-barra--ind");
        const sua = caixa(".ponte-barra--sua");
        const marcas = Array.from(tela.querySelectorAll(".ponte-trilho")).filter(
          (t) => t.hasAttribute("data-corte") || !["none", "normal", ""].includes(getComputedStyle(t, "::after").content),
        ).length;
        const trilhos = Array.from(tela.querySelectorAll('[data-testid="ponte-linha"] .ponte-trilho'));
        // a guia (início de cada degrau) fica DENTRO do trilho — com o
        // overflow:hidden, uma guia fora dele sumiria em silêncio
        const vazamento = trilhos.some((t) => {
          const r = t.getBoundingClientRect();
          const g = t.querySelector(".ponte-guia")!.getBoundingClientRect();
          return g.left < r.left - 0.5 || g.left > r.right + 0.5;
        });
        return { trilho: trilho.width, ind: ind.width, sua: sua.width, indL: ind.left - trilho.left, marcas, vazamento,
          overflow: trilhos.map((t) => getComputedStyle(t).overflowX) };
      });
      expect(Math.abs(m.ind - m.sua), `${nome}: larguras ${m.ind} × ${m.sua}`).toBeLessThan(0.5);
      expect(m.ind, `${nome}: barra cheia`).toBeGreaterThan(m.trilho - 0.5);
      expect(Math.abs(m.indL)).toBeLessThan(0.5);
      expect(m.marcas, `${nome}: marca de corte`).toBe(0);
      expect(m.vazamento).toBe(false);
      expect(new Set(m.overflow)).toEqual(new Set(["hidden"]));
    }
  });

  test("contribuição entre −0,05 e +0,05 é neutra: '±0,0' cinza e 'andou junto com o índice'", async ({ page }) => {
    await autenticar(page);
    await abrir(page);
    await escopo(page, "EUA");
    // Na fixture o O (linha `fora`) pesa −0,1999 ponto ao ano. Para a linha
    // neutra, o teste soma 0,14% da base ao ganho mensal dele NA MEMÓRIA (bloco
    // sintético). A contribuição é linear no ganho (~149 pontos por unidade de
    // k; medido: k=0,002 dá +0,0985 e k=0 dá −0,1999), logo k=0,0014 dá cerca de
    // +0,009: não nula, e abaixo de 0,05, então a tela arredonda para "±0,0".
    await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      const p = d.json.ponte;
      const idx = p.ativos.findIndex((a: any) => a.t === "O");
      for (const mes of p.brl) for (const e of mes) if (e[0] === idx) e[2] = e[2] + e[1] * 0.0014;
      d.hidratarRentabilidade();
    });

    const linhas = await linhasDaPonte(page);
    expect(linhas.map((l) => l.id)).toEqual(["picks", "fora"]);
    const fora = linhas.find((l) => l.id === "fora")!;
    expect(fora.sinal).toBe("neutro");
    expect(fora.texto).toContain("±0,0");
    expect(fora.texto).not.toMatch(/[▲▼]/);
    expect(fora.pressed).toBe("true"); // a menor contribuição exibida
    await expect(page.locator(tid("ponte-pesou"))).toContainText(
      "Fora da política atual andou junto com o S&P 500 com dividendos nesta janela.",
    );
    // linha neutra: os ativos da linha (O e o rebate, que não é mais escondido
    // atrás de "Outros") aparecem, ambos no grupo "junto"
    await expect(page.locator(tid("pesou-ativo"))).toHaveCount(2);
    await expect(page.locator(`${tid("pesou-grupo")}[data-grupo="junto"] [data-ticker="O"]`)).toHaveCount(1);
    await expect(page.locator(`${tid("pesou-grupo")}[data-grupo="junto"] [data-ticker="Rebates da corretora"]`)).toHaveCount(1);
    // a live region leva a mesma frase neutra (ramo `neutra` de _rent2Anunciar)
    await expect(page.locator(tid("rent2-anuncio-pesou"))).toHaveText(
      "Fora da política atual andou junto com o S&P 500 com dividendos nesta janela. Andaram junto, 2 ativos.",
    );
    const corNeutra = await page.locator(`${tid("ponte-linha")}[data-linha="fora"] .ponte-valor`).evaluate(
      (e) => [getComputedStyle(e).color, getComputedStyle(document.documentElement).getPropertyValue("--gray").trim()],
    );
    const rgb = await page.evaluate((hex) => {
      const el = document.createElement("span");
      el.style.color = hex;
      document.body.appendChild(el);
      const c = getComputedStyle(el).color;
      el.remove();
      return c;
    }, corNeutra[1]);
    expect(corNeutra[0]).toBe(rgb);
  });

  test("escopos: linhas certas por escopo; EUA com BRL/USD", async ({ page }) => {
    await autenticar(page);
    await abrir(page);

    await expect(page.locator(`${TELA} .moeda-toggle`)).toBeHidden();
    await escopo(page, "Brasil");
    await expect(page.locator(tid("rent2-frase"))).toHaveText(
      "Nos últimos 12 meses, você ganhou da sua carteira brasileira de índices.",
    );
    expect((await linhasDaPonte(page)).map((l) => l.id)).toEqual(["acoes_br", "fiis"]);
    await expect(page.locator(`${TELA} .moeda-toggle`)).toBeHidden();

    await escopo(page, "EUA");
    await expect(page.locator(`${TELA} .moeda-toggle`)).toBeVisible();
    const eua = await linhasDaPonte(page);
    expect(eua.map((l) => l.id)).toEqual(["picks", "fora"]);
    expect(eua[0].texto).toContain("Picks");
    expect(eua[0].texto).toContain("vs S&P 500 com dividendos");
    expect(eua[1].texto).toContain("Fora da política atual");
    await expect(page.locator(tid("rent2-frase"))).toHaveText(
      "Nos últimos 12 meses, você ganhou da sua carteira americana de índices.",
    );
    await expect(page.locator(tid("rent2-par-sua"))).toContainText("23,4% ao ano");
    await expect(page.locator(tid("rent2-entrou"))).toContainText(/R\$\s5\.357/);

    await page.locator(`${TELA} .moeda-toggle button[data-moeda="USD"]`).click();
    await expect(page.locator(`${TELA} .moeda-toggle button[data-moeda="USD"].active`)).toBeVisible();
    await expect(page.locator(tid("rent2-numero"))).toHaveText("▲ +0,9");
    await expect(page.locator(tid("rent2-par-sua"))).toContainText("9,2% ao ano");
    await expect(page.locator(tid("rent2-entrou"))).toContainText(/US\$\s1\.040/);
    await expect(page.locator(tid("rent2-entrou"))).not.toContainText("R$");
  });

  test("em reais: 'Entrou na carteira', 'Ganho, com proventos' e 'Em set/26'", async ({ page }) => {
    await autenticar(page);
    await abrir(page);

    const reais = page.locator(`${TELA} .rent2-reais`);
    await expect(reais).toContainText("Entrou na carteira");
    await expect(reais).toContainText("Ganho, com proventos");
    await expect(reais).toContainText("Em set/26");
    await expect(reais).not.toContainText(/Aportado|Hoje/);
    await expect(page.locator(tid("rent2-entrou"))).toHaveText(/^R\$\s11\.957$/);
    await expect(page.locator(tid("rent2-ganho"))).toHaveText(/^▲ \+ R\$\s27\.570$/);
    await expect(page.locator(tid("rent2-valor-fim"))).toHaveText(/^R\$\s173\.532$/);
  });

  test("Detalhes fechado por padrão: índices do escopo, TWR igual ao topo, XIRR e o aviso", async ({ page }) => {
    await autenticar(page);
    await abrir(page);

    const det = page.locator(tid("rent2-detalhes"));
    await expect(det).not.toHaveAttribute("open", "");
    expect(await det.evaluate((e) => (e as HTMLDetailsElement).open)).toBe(false);
    await expect(page.locator(tid("rent2-twr"))).toBeHidden();

    await det.locator("summary").click();
    const indices = await page.locator(tid("rent2-indice")).evaluateAll((els) =>
      els.map((e) => [e.getAttribute("data-indice"), (e.textContent || "").replace(/\s+/g, " ").trim()]),
    );
    expect(indices.map((i) => i[0])).toEqual(["CDI", "IBOV", "IFIX", "SP500TR"]);
    expect(indices.map((i) => i[1])).toEqual([
      "CDI 10,9%", "Ibovespa 16,4%", "IFIX 7,5%", "S&P 500 com dividendos 22,0%",
    ]);
    const topo = await page.locator(`${tid("rent2-par-sua")} .rent2-par-valor`).textContent();
    await expect(page.locator(`${tid("rent2-twr")} .rent2-regua-valor`)).toHaveText(topo!.trim());
    await expect(page.locator(tid("rent2-twr"))).toContainText("A carteira (TWR)");
    await expect(page.locator(`${tid("rent2-xirr")} .rent2-regua-valor`)).toHaveText("19,7%");
    await expect(page.locator(tid("rent2-xirr"))).toContainText("Seu dinheiro (XIRR)");
    await expect(page.locator(tid("rent2-aviso"))).toHaveText(
      "Rentabilidade passada não garante resultado futuro. Valores antes de impostos.",
    );

    await escopo(page, "Brasil");
    expect(await page.locator(tid("rent2-indice")).evaluateAll((els) => els.map((e) => e.getAttribute("data-indice"))))
      .toEqual(["CDI", "IBOV", "IFIX"]);
    await escopo(page, "EUA");
    expect(await page.locator(tid("rent2-indice")).evaluateAll((els) => els.map((e) => e.getAttribute("data-indice"))))
      .toEqual(["SP500TR"]);
  });

  test("Fora da política, linha de um ativo e o rebate: 'quem pesou' mostra os dois, cada um no seu grupo", async ({ page }) => {
    await autenticar(page);
    await abrir(page);
    await escopo(page, "EUA");
    // Na fixture a linha `fora` tem um ativo só (O; o rebate não pesa). Para a
    // linha ficar positiva, o teste afasta o ganho dele do índice NA MEMÓRIA.
    await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      const p = d.json.ponte;
      const idx = p.ativos.findIndex((a: any) => a.t === "O");
      for (const mes of p.brl) for (const e of mes) if (e[0] === idx) e[2] = e[2] + e[1] * 0.03;
      d.hidratarRentabilidade();
    });
    const fora = page.locator(`${tid("ponte-linha")}[data-linha="fora"]`);
    await expect(fora).toHaveAttribute("data-sinal", "pos");
    await fora.click();
    await expect(page.locator(tid("ponte-pesou"))).toContainText("Fora da política atual somou");
    await expect(page.locator(tid("ponte-pesou"))).toContainText("contra o S&P 500 com dividendos");
    // 7a.BH.1: o rebate (±0,0) deixou de sumir atrás de "Outros" e vai a "junto"
    expect(await tickersPesou(page)).toEqual(["O", "Rebates da corretora"]);
    expect(await page.locator(tid("pesou-grupo")).evaluateAll((els) => els.map((e) => e.getAttribute("data-grupo")))).toEqual(["somaram", "junto"]);
    // Trava contra "Outros" com qualquer testid: todo li da lista é um pesou-ativo.
    const totalLi = await page.locator(`${tid("ponte-pesou")} li`).count();
    expect(totalLi).toBeGreaterThan(0);
    await expect(page.locator(`${tid("ponte-pesou")} li[data-testid="pesou-ativo"]`)).toHaveCount(totalLi);
  });

  test("veredito em perda e em empate", async ({ page }) => {
    await autenticar(page);
    await abrir(page);

    await arrastar(page, 2, 3);
    await expect(page.locator(tid("rent2-frase"))).toHaveText(
      "De mai/24 a jul/24, você ficou atrás da sua carteira de índices.",
    );
    await expect(page.locator(tid("rent2-numero"))).toHaveText("▼ −0,5");
    await expect(page.locator(tid("rent2-unidade"))).toHaveText("ponto no período");

    await arrastar(page, 1, 2);
    await expect(page.locator(tid("rent2-frase"))).toHaveText(
      // verbatim do rascunho aprovado (Ep3THq6qaE386WF6CvNk3N): "empatou com sua carteira…", sem artigo
      "De abr/24 a jun/24, você empatou com sua carteira de índices.",
    );
    await expect(page.locator(tid("rent2-numero"))).toHaveText("±0,0");
  });

  test("payload sem o bloco ponte (v2.29 em cache): indisponível com recarregar, nunca a tela antiga", async ({ page }) => {
    await autenticar(page, "portfolio_pre_v230.test.json.enc");
    await page.goto("/#rentabilidade");
    const aviso = page.locator(tid("rent2-sem-bloco"));
    await expect(aviso).toBeVisible({ timeout: 10_000 });
    await expect(aviso).toContainText("Rentabilidade indisponível nesta versão dos dados");
    await expect(page.locator(tid("rent2-frase"))).toBeHidden();
    await expect(page.locator(tid("ponte"))).toBeHidden();
    await expect(page.locator(`${TELA} .rent2-janelas`)).toBeHidden();
    await expect(page.locator(`${TELA} canvas`)).toHaveCount(0);
    await expect(page.locator(`${TELA} .rent-grupo, ${TELA} .rent-periodo`)).toHaveCount(0);

    const recarregar = aviso.getByRole("button", { name: "Recarregar" });
    await expect(recarregar).toBeVisible();
    await Promise.all([page.waitForEvent("load"), recarregar.click()]);
  });

  test("320px: sem rolagem horizontal e valor da ponte com folga do trilho", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 760 });
    await autenticar(page);
    await abrir(page);

    for (const nome of ["Total", "Brasil", "EUA"] as const) {
      await escopo(page, nome);
      const largura = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(largura, `scrollWidth em ${nome}`).toBeLessThanOrEqual(320);
      const folgas = await page.locator(`${TELA} .ponte-degrau`).evaluateAll((els) =>
        els.map((e) => {
          const t = e.querySelector(".ponte-trilho")!.getBoundingClientRect();
          const v = e.querySelector(".ponte-valor")!.getBoundingClientRect();
          const r = e.getBoundingClientRect();
          return { folga: v.left - t.right, sobra: r.right - v.right };
        }),
      );
      for (const f of folgas) {
        expect(f.folga).toBeGreaterThanOrEqual(6);
        expect(f.sobra).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("Modo Plantão: ponte em tokens escuros, sem cor fixa no componente", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("tema", "dark"));
    await autenticar(page);
    await abrir(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    const cores = await page.evaluate(() => {
      const pos = document.querySelector('.tela-rentabilidade [data-testid="ponte-linha"][data-sinal="pos"] .ponte-valor')!;
      const tok = (n: string) => {
        const el = document.createElement("span");
        el.style.color = getComputedStyle(document.documentElement).getPropertyValue(n).trim();
        document.body.appendChild(el);
        const c = getComputedStyle(el).color;
        el.remove();
        return c;
      };
      return { pos: getComputedStyle(pos).color, g700: tok("--g-700") };
    });
    expect(cores.pos).toBe(cores.g700);
    expect(cores.g700).toBe("rgb(52, 211, 153)");
    const inlineHex = await page.locator(`${TELA} [style]`).evaluateAll((els) =>
      els.map((e) => e.getAttribute("style") || "").filter((s) => /#[0-9a-f]{3,8}\b|rgb\(/i.test(s)),
    );
    expect(inlineHex).toEqual([]);
  });

  test("tabela equivalente da ponte para leitor de tela", async ({ page }) => {
    await autenticar(page);
    await abrir(page);

    const tabela = page.locator(tid("ponte-tabela"));
    await expect(tabela).toHaveCount(1);
    await expect(tabela.locator("caption")).toHaveText(
      "Ponte entre a carteira só com índices e a sua carteira, em pontos ao ano",
    );
    const linhas = await tabela.locator("tbody tr").evaluateAll((els) =>
      els.map((e) => Array.from(e.children).map((c) => (c.textContent || "").trim()).join(" ")),
    );
    expect(linhas.length).toBe(5);
    expect(linhas[0]).toContain("Só com índices");
    expect(linhas[0]).toContain("18,6% ao ano");
    expect(linhas[1]).toContain("Ações BR, contra o Ibovespa: mais 0,2 ponto");
    expect(linhas[4]).toContain("Sua carteira");
    expect(linhas[4]).toContain("19,6% ao ano");
    // escondida da vista, não do leitor de tela: o wrapper .sr-only recorta a 1px
    const recorte = await tabela.evaluate((e) => {
      const w = e.parentElement!;
      return { classe: w.classList.contains("sr-only"), largura: w.getBoundingClientRect().width };
    });
    expect(recorte).toEqual({ classe: true, largura: 1 });
    await expect(page.locator(`${tid("ponte-linha")}[data-linha="acoes_br"]`)).toHaveAttribute(
      "aria-label", "Ações BR contra o Ibovespa, mais 0,2 ponto ao ano. Mostrar quem pesou",
    );
    await expect(page.locator(tid("rent2-anuncio"))).toHaveAttribute("aria-live", "polite");
    await expect(page.locator(tid("rent2-anuncio-pesou"))).toHaveAttribute("aria-live", "polite");
    await expect(page.locator(tid("rent2-anuncio"))).toHaveText(
      "Nos últimos 12 meses, você ganhou da sua carteira de índices. +1,0 ponto ao ano.",
    );
    await expect(page.locator(tid("rent2-anuncio-pesou"))).toHaveText(
      "Ações BR somaram 0,2 ponto ao ano contra o Ibovespa. Somou pontos, 1 ativo, mais 0,4. Tirou pontos, 1 ativo, menos 0,2.",
    );
    // a parte visual não é live region (senão o arrasto inundaria o leitor de tela)
    await expect(page.locator(`${TELA} .rent2-veredito`)).not.toHaveAttribute("aria-live", /.*/);
    await expect(page.locator(tid("ponte-pesou"))).not.toHaveAttribute("aria-live", /.*/);
  });

  test("live region: durante o arrasto o anúncio não muda; no settle, anuncia a janela nova", async ({ page }) => {
    await autenticar(page);
    await abrir(page);
    const antes = "Nos últimos 12 meses, você ganhou da sua carteira de índices. +1,0 ponto ao ano.";
    await expect(page.locator(tid("rent2-anuncio"))).toHaveText(antes);

    const noArrasto = await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      const off = d._rentCtx.off;
      d.echartsRent.dispatchAction({ type: "dataZoom", startValue: 10 - 1 - off, endValue: 14 - off });
      return { frase: d.rent2.vista.frase, anuncio: d.rent2.anuncio };
    });
    // o visual já trocou; o anúncio, não
    expect(noArrasto.frase).toBe("De jan/25 a jun/25, você ganhou da sua carteira de índices.");
    expect(noArrasto.anuncio).toBe(antes);
    await expect(page.locator(tid("rent2-anuncio"))).toHaveText(
      "De jan/25 a jun/25, você ganhou da sua carteira de índices. +0,4 ponto no período.",
    );
  });

  test("arredondamento: só as linhas absorvem o ajuste; 'Só com índices' é o arredondamento simples", async ({ page }) => {
    await autenticar(page);
    await abrir(page);
    const v = await page.evaluate(() => {
      // Empate de restos: ind 18,64 e três linhas de 0,34 (sua 19,66). O total
      // dos índices não pode ganhar o empate (spec §4.4: ajusta as linhas).
      const r = {
        n_meses: 12, anualizado: true, sua: 0.1966, ind: 0.1864, dif: 0.0102,
        linhas: [
          { id: "acoes_br", indice: "IBOV", contrib: 0.0034 },
          { id: "fiis", indice: "IFIX", contrib: 0.0034 },
          { id: "eua", indice: "SP500TR", contrib: 0.0034 },
        ],
        ativos: {}, entrou: 0, ganho: 0, valor_fim: 0, xirr: null, indices: {}, indisponivel: null,
      };
      const bloco = { meses: ["2025-09", "2025-10", "2026-09"] };
      const w = window as any;
      const vista = w.rent2Vista(r, 1, 2, { bloco, escopo: "Total", moeda: "BRL", chave: null, m0: 1, linhaUsuario: null });
      return {
        ind: vista.ind, sua: vista.sua, numero: vista.numero,
        linhas: vista.ponte.linhas.map((l: any) => l.valor),
      };
    });
    expect(v.ind).toBe("18,6%");
    expect(v.sua).toBe("19,7%");
    expect(v.numero).toBe("▲ +1,1");
    expect(Math.round(v.linhas.reduce((a: number, b: number) => a + b, 0) * 10) / 10).toBe(1.1);
  });

  test("falha ao montar a ponte no cold-start: segue destravado e a tela diz que está indisponível", async ({ page }) => {
    const erros: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") erros.push(m.text()); });
    // classe sem índice na ponte: ponteJanela lança (dado mais novo que o app)
    await mexerNoPayload(page, "p.ponte.ativos[0].classe = 'classe_nova';");
    await autenticar(page);
    await page.goto("/#rentabilidade");
    await page.reload(); // cold-start direto na rota: o auto-resume hidrata a tela
    await expect(page.locator(tid("rent2-sem-bloco"))).toBeVisible({ timeout: 10_000 });
    // estado próprio de erro: não se confunde com payload de versão antiga
    await expect(page.locator(tid("rent2-sem-bloco"))).toContainText("Não foi possível montar a rentabilidade agora.");
    await expect(page.locator(tid("rent2-sem-bloco"))).not.toContainText("nesta versão dos dados");
    await expect(page.locator(tid("rent2-sem-bloco")).getByRole("button", { name: "Recarregar" })).toBeVisible();
    const estado = await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      return { fase: d.fase, motivo: d.fraseMotivo, json: !!d.json };
    });
    expect(estado).toEqual({ fase: "raiox", motivo: "", json: true });
    await expect(page.locator(".pin-screen, .frase-screen")).toHaveCount(0);
    expect(erros.some((e) => e.includes("rentabilidade"))).toBe(true);
  });

  test("payload v2.30 com ponte null: 'não foi publicada nesta atualização', sem recarregar", async ({ page }) => {
    await mexerNoPayload(page, "p.ponte = null;");
    await autenticar(page);
    await page.goto("/#rentabilidade");
    const aviso = page.locator(tid("rent2-sem-bloco"));
    await expect(aviso).toBeVisible({ timeout: 10_000 });
    await expect(aviso).toHaveText("A conta da rentabilidade não foi publicada nesta atualização.");
    await expect(aviso.getByRole("button", { name: "Recarregar" })).toHaveCount(0);
    await expect(page.locator(tid("rent2-frase"))).toBeHidden();
  });

  test("motivo de janela indisponível é anunciado pela live region", async ({ page }) => {
    await autenticar(page);
    await abrir(page);
    // Toda a fixture tem 12m disponível; força a vista indisponível como o
    // backend faria (histórico curto) e confere que a região viva a anuncia.
    await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      d.rent2.vista = { indisponivel: "Histórico começa em mai/24.", subtitulo: "", ariaGrafico: "" };
      d._rent2Anunciar();
    });
    await expect(page.locator(tid("rent2-janela-indisp"))).toBeVisible();
    await expect(page.locator(tid("rent2-anuncio"))).toHaveText("Histórico começa em mai/24.");
    await expect(page.locator(tid("rent2-anuncio"))).toHaveAttribute("aria-live", "polite");
  });

  test("sair da tela no meio do arrasto e voltar: a classe de arrasto não fica presa", async ({ page }) => {
    await autenticar(page);
    await abrir(page);
    await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      const off = d._rentCtx.off;
      d.echartsRent.dispatchAction({ type: "dataZoom", startValue: 10 - 1 - off, endValue: 14 - off });
      // dentro dos 150 ms do settle: sai e volta
      location.hash = "#proventos";
      setTimeout(() => { location.hash = "#rentabilidade"; }, 20);
    });
    await expect(page.locator(tid("rent2-frase"))).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(400); // muito além do settle (150 ms)
    await expect(page.locator(TELA)).not.toHaveClass(/is-arrastando/);
  });

  test("prefers-reduced-motion: barras sem transição; com movimento, transição só fora do arrasto", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await autenticar(page);
    await abrir(page);
    const dur = () => page.locator(`${TELA} .ponte-barra`).first().evaluate((e) => getComputedStyle(e).transitionDuration);
    // controle positivo: com movimento liberado a barra anima
    expect(await dur()).not.toBe("0s");
    // durante o arrasto, zero animação
    const noArrasto = await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      const off = d._rentCtx.off;
      d.echartsRent.dispatchAction({ type: "dataZoom", startValue: 10 - 1 - off, endValue: 14 - off });
      const sec = document.querySelector(".tela-rentabilidade")!;
      const barra = document.querySelector(".tela-rentabilidade .ponte-barra")!;
      return { classe: sec.classList.contains("is-arrastando"), dur: getComputedStyle(barra).transitionDuration };
    });
    expect(noArrasto.classe).toBe(true);
    expect(noArrasto.dur).toBe("0s");

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await expect(page.locator(tid("rent2-frase"))).toBeVisible({ timeout: 10_000 });
    expect(await dur()).toBe("0s");
  });
});
