import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

// Fase 7a.AW.2 — a projeção como ensaio. Fixtures 100% sintéticas
// (gerar_fixture.py::_projecao_sintetica): idade 40, horizonte 2051, taxas e
// valores inventados. Nenhum assert depende de valor biográfico real.
const fx = (n: string) => fs.readFileSync(path.join(__dirname, "../fixtures", n), "utf-8");
const PRINCIPAL = fx("portfolio.test.json.enc");
const NULO = fx("portfolio_projecao_null.test.json.enc");
const PRE227 = fx("portfolio_pre_v227.test.json.enc");
const PRE228 = fx("portfolio_pre_v228.test.json.enc");
const SO_XIRR = fx("portfolio_projecao_so_xirr.test.json.enc");
const NOMES = ["Retorno da carteira", "Retorno do seu dinheiro", "Mercado, média das classes", "Mercado, com rebalanceamento"];

test.use({ viewport: { width: 390, height: 844 } });

async function autenticar(page: Page, corpo = PRINCIPAL) {
  await page.route("**/portfolio.json.enc", (r) => r.fulfill({ status: 200, body: corpo, contentType: "text/plain" }));
  await page.addInitScript(() => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem("pinTimestamp", String(Date.now() - 86_400_000));
  });
  await page.goto("/");
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
}

// Abre a rota #/raiox/projecao e espera o nó que é gate de DADO (x-if,
// `.proj-ensaio`) ficar visível E a transição de entrada da tela
// (push-enter, 280ms) assentar, para que medições de layout (a régua a
// 320px) leiam um estado parado, não um quadro intermediário da animação.
// Usada pelas Tasks 8-9 (capítulos do ensaio); não referenciada nesta
// primeira parte da suíte, que só cobre a camada de dados e os estados
// vazios.
async function abrirProjecao(page: Page) {
  await page.goto("/#/raiox/projecao");
  await expect(page.locator(".tela-projecao .proj-ensaio")).toBeVisible();
  // Barreira condicional no que é efetivamente medido: enquanto o
  // push-enter (`.tela-projecao`, transform translateX 280ms) ainda roda, a
  // régua de 320px mede o container e os rótulos em DOIS round-trips
  // separados (`evaluateAll` + `evaluate`) que capturam o transform em
  // instantes ligeiramente diferentes — medido: a mesma sequência de
  // passos, sem esta espera, produzia um `cont.right` ~0,2-0,5px MAIOR ou
  // MENOR que o medido no round-trip anterior, o suficiente pra violar a
  // tolerância de 0,5px em execuções repetidas (`--repeat-each`). Esperar
  // o transform assentar em `none` elimina a causa, não o sintoma —
  // reaplicar viewport ou uma espera fixa não adiantavam sozinhos porque
  // não miravam a transição em si.
  await page
    .waitForFunction(() => {
      const el = document.querySelector(".tela-projecao");
      return !!el && getComputedStyle(el).transform === "none";
    }, undefined, { timeout: 2000 })
    .catch(() => {});
}

test.describe("Projeção como ensaio (7a.AW.2) — dados e estados", () => {
  test("card da home: entre as duas âncoras, e abre a tela", async ({ page }) => {
    await autenticar(page);
    const card = page.locator(".proj-card-home");
    await expect(card).toContainText("Projeção até os 65");
    await expect(card).toContainText("pelo seu histórico, entre");
    await card.click();
    await expect(page).toHaveURL(/#\/raiox\/projecao$/);
    await expect(page.locator('.tab-bar a[data-tab="raiox"]')).toHaveAttribute("aria-current", "page");
  });

  test("ordem canônica dos cenários e nomes da fonte única", async ({ page }) => {
    await autenticar(page);
    const r = await page.evaluate(() => {
      const a = (window as any).Alpine.$data(document.body);
      return { ids: a.projCenarios().map((c: any) => c.id), nomes: a.projCenarios().map((c: any) => a.projNome(c.id)) };
    });
    expect(r.ids).toEqual(["twr", "xirr", "mercado_simples", "mercado_rebalanceado"]);
    expect(r.nomes).toEqual(NOMES);
  });

  for (const [nome, corpo] of [["null", NULO], ["pré-v2.27", PRE227], ["pré-v2.28", PRE228]] as const) {
    test(`payload ${nome}: card some e a rota diz indisponível hoje`, async ({ page }) => {
      await autenticar(page, corpo);
      await expect(page.locator(".proj-card-home")).toBeHidden();
      await page.goto("/#/raiox/projecao");
      await expect(page.locator(".tela-projecao")).toContainText("Projeção indisponível hoje");
      await expect(page.locator(".proj-ensaio")).toHaveCount(0);
    });
  }

  test("âncora ausente: card e frase-resposta com um valor e o nome da medida", async ({ page }) => {
    await autenticar(page, SO_XIRR);
    await expect(page.locator(".proj-card-home")).toContainText("pelo retorno do seu dinheiro,");
    await expect(page.locator(".proj-card-home")).not.toContainText("entre");
  });
});

// Snapshot leve do $data Alpine, para os testes que precisam ler estado do
// app (não do DOM) sem trazer a instância ECharts inteira pela ponte
// page.evaluate: `echartsProj` some da vez, sem número (funções e o gráfico
// de zrender por trás dele não são serializáveis de volta pro Node) — o que
// os testes precisam é só a CONTAGEM, então cada instância vira `null` antes
// de cruzar a ponte, preservando `.echartsProj?.length`.
async function app(page: Page) {
  return page.evaluate(() => {
    const d = (window as any).Alpine.$data(document.body);
    return { echartsProj: Array.isArray(d.echartsProj) ? d.echartsProj.map(() => null) : d.echartsProj };
  });
}

test.describe("Projeção como ensaio (7a.AW.2) — capítulos 4 a 7", () => {
  const opcao = (page: Page, id: string) => page.evaluate((id) => {
    const inst = (window as any).echarts.getInstanceByDom(document.getElementById(id));
    return inst ? JSON.parse(JSON.stringify(inst.getOption(), (k, v) => (typeof v === "function" ? "fn" : v))) : null;
  }, id);

  test("mapa: as quatro linhas, âncoras cheias, mercado tracejado, rótulo no fim, sem legenda nem zoom", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    await expect.poll(async () => (await opcao(page, "chart-projecao-mapa"))?.series?.length).toBe(4);
    const o = await opcao(page, "chart-projecao-mapa");
    const s = o.series;
    expect(s.map((x: any) => x.name)).toEqual(NOMES);
    expect(s[0].lineStyle.type).toBe("solid");
    expect(s[1].lineStyle.type).toBe("solid");
    expect(Array.isArray(s[2].lineStyle.type)).toBe(true);
    expect(Array.isArray(s[3].lineStyle.type)).toBe(true);
    expect(JSON.stringify(s[2].lineStyle.type)).not.toEqual(JSON.stringify(s[3].lineStyle.type));
    for (const x of s) expect(x.endLabel.show).toBe(true);
    expect(Array.isArray(o.legend) && o.legend.length > 0).toBe(true);   // [] passaria no every() por vacuidade
    expect(o.legend.every((l: any) => l.show === false)).toBe(true);
    expect(o.dataZoom || []).toHaveLength(0);
  });

  test("tabela taxa → valor aos 65, na ordem, e a decomposição das âncoras em forma e texto", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const cap = page.locator('.proj-cap[data-cap="4"]');
    expect(await cap.locator(".proj-tabela--final tbody th").allInnerTexts()).toEqual(NOMES);
    const barras = cap.locator(".proj-decomp");
    await expect(barras).toHaveCount(2);
    for (const b of await barras.all()) {
      await expect(b.locator(".proj-decomp__seg")).toHaveCount(3);
      for (const t of ["Seu patrimônio de hoje, crescido", "Aportes somados", "Rendimento dos aportes"])
        await expect(b).toContainText(t);
    }
  });

  test("decomposição com rendimento negativo: só as parcelas positivas na barra, a negativa em texto (Review Focus 1)", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body).json.projecao.cenarios[0].decomposicao;
      d.rendimento_aportes = -50000;
    });
    const b = page.locator('.proj-cap[data-cap="4"] .proj-decomp').first();
    await expect(b.locator(".proj-decomp__seg")).toHaveCount(2);
    await expect(b).toContainText("−R$");
  });

  test("leques: um por âncora, mesma escala Y, faixas planas", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    await expect.poll(async () => (await opcao(page, "chart-projecao-leque-xirr"))?.series?.length).toBeGreaterThan(0);
    const a = await opcao(page, "chart-projecao-leque-twr"), b = await opcao(page, "chart-projecao-leque-xirr");
    // typeof number, não só a igualdade: sem `max` explícito nos dois lados,
    // getOption() devolve `undefined` nos dois — `undefined === undefined`
    // passaria por vacuidade mesmo com a escala Y na verdade diferente entre
    // os dois leques (medido: [0, 3.500.000] contra [0, 5.000.000] de extent
    // real quando o max explícito é removido). Achado na prova de mutação do
    // Step 7(b) do plano.
    expect(typeof a.yAxis[0].max).toBe("number");
    expect(a.yAxis[0].max).toBe(b.yAxis[0].max);
    const areas = a.series.filter((x: any) => x.areaStyle && x.areaStyle.opacity > 0);
    expect(areas).toHaveLength(2);                                             // as duas faixas; vazio passaria por vacuidade
    for (const x of areas) expect(typeof x.areaStyle.color).toBe("string");     // plano, nunca gradiente
  });

  test("capítulo 5: de onde vem a largura, com o N e a referência do modelo", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const cap = page.locator('.proj-cap[data-cap="5"]');
    await expect(cap).toContainText("110 meses");
    await expect(cap).toContainText("Só as duas leituras do seu histórico têm faixa");
  });

  test("ponteiro: 5 linhas, uma coluna por âncora, sinal em texto e nenhum verbo de ação", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const t = page.locator('.proj-cap[data-cap="6"] .proj-tabela--ponteiro');
    await expect(t.locator("tbody tr")).toHaveCount(5);
    // a 1ª célula do cabeçalho só tem o rótulo sr-only ("Alavanca"), que innerText lê
    expect((await t.locator("thead th").allInnerTexts()).slice(1)).toEqual(["Retorno da carteira", "Retorno do seu dinheiro"]);
    const linhas = await t.locator("tbody tr").allInnerTexts();
    for (const l of linhas.slice(0, 2)) expect(l).toContain("+R$");
    for (const l of linhas.slice(2)) expect(l).toContain("−R$");
    const txt = (await page.locator(".tela-projecao").innerText()).toLowerCase();
    for (const v of ["aporte mais", "compre", "venda ", "invista mais"]) expect(txt).not.toContain(v);
  });

  test("âncora ausente some do mapa, dos leques e do ponteiro", async ({ page }) => {
    await autenticar(page, SO_XIRR);
    await abrirProjecao(page);
    await expect.poll(async () => (await opcao(page, "chart-projecao-mapa"))?.series?.length).toBe(3);
    await expect(page.locator("#chart-projecao-leque-twr")).toHaveCount(0);
    expect((await page.locator(".proj-tabela--ponteiro thead th").allInnerTexts()).slice(1)).toEqual(["Retorno do seu dinheiro"]);
  });

  test("capítulo 7 e o rodapé", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const cap = page.locator('.proj-cap[data-cap="7"]');
    for (const t of ["Impostos e custos", "o viés é para cima", "Aporte que cresce com a renda"]) await expect(cap).toContainText(t);
    await expect(page.locator(".proj-rodape")).toHaveText("10.000 trajetórias · recalculada toda noite · projeção, não promessa");
  });

  test("três instâncias montadas: mapa + um leque por âncora", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    await expect.poll(async () => (await app(page)).echartsProj?.length).toBe(3);
  });
});

test.describe("Projeção como ensaio (7a.AW.2) — capítulos 0 a 3", () => {
  test("capítulos na ordem, cada um com ordinal e título", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const titulos = await page.locator(".proj-cap .proj-cap__titulo").allInnerTexts();
    expect(titulos).toEqual([
      "De onde você parte", "Quanto você aporta", "Quanto a carteira rende: quatro leituras",
      "O que isso dá aos 65", "A incerteza", "O que mexe o ponteiro", "O que esta conta não inclui",
    ]);
    const ordinais = await page.locator(".proj-cap .proj-cap__ordinal").allInnerTexts();
    expect(ordinais).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
  });

  test("o ordinal é tipografia de título e o número-tema é tabular", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const r = await page.evaluate(() => {
      const ord = document.querySelector(".proj-cap__ordinal")!;
      const tema = document.querySelector(".proj-cap__tema")!;
      const cs = (e: Element) => getComputedStyle(e);
      return { ordNum: cs(ord).fontVariantNumeric, temaNum: cs(tema).fontVariantNumeric,
               ordFam: cs(ord).fontFamily, temaFam: cs(tema).fontFamily };
    });
    expect(r.temaNum).toContain("tabular-nums");
    expect(r.ordNum).not.toContain("tabular-nums");
    expect(r.ordFam).not.toEqual(r.temaFam);
  });

  test("frase-resposta com as duas âncoras, e os dois números são os maiores da tela", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const resp = page.locator(".proj-resposta");
    await expect(resp).toContainText("Pelo seu histórico, aos 65 você teria entre");
    await expect(resp).toContainText("em reais de hoje, se nada mudar no seu ritmo de aporte");
    const t = await page.evaluate(() => {
      const px = (el: Element) => parseFloat(getComputedStyle(el).fontSize);
      const faixa = Array.from(document.querySelectorAll(".proj-resposta .proj-faixa")).map(px);
      const outros = Array.from(document.querySelectorAll(".tela-projecao *"))
        .filter((el) => !el.classList.contains("proj-faixa") && (el as HTMLElement).offsetParent !== null
          && el.childElementCount === 0 && (el.textContent || "").trim() !== "").map(px);
      return { faixa, max: Math.max(...outros) };
    });
    expect(t.faixa).toHaveLength(2);
    for (const v of t.faixa) expect(v).toBeGreaterThan(t.max);
  });

  test("'ver a conta' fechado por padrão, abre ao toque", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const contas = page.locator("details.proj-conta");
    expect(await contas.count()).toBeGreaterThanOrEqual(6);   // 6 na Task 8; a Task 9 soma 2
    for (const d of await contas.all()) await expect(d).not.toHaveAttribute("open", "");
    const primeira = contas.first();
    await primeira.locator("summary").click();
    await expect(primeira).toHaveAttribute("open", "");
    await expect(primeira.locator(".proj-conta__corpo")).toBeVisible();
  });

  test("capítulo 2: a conta do aporte com as quatro somas e a janela", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const cap = page.locator('.proj-cap[data-cap="2"]');
    await cap.locator("details.proj-conta summary").click();
    for (const t of ["Compras menos vendas", "Proventos", "Aluguel de ações", "÷ 12", "De 26/09/2025 a 25/09/2026"])
      await expect(cap).toContainText(t);
    await expect(cap.locator(".proj-nota-piso")).toBeHidden();
  });

  test("nota de piso zero (Review Focus 3)", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    await page.evaluate(() => { (window as any).Alpine.$data(document.body).json.projecao.aporte.piso_zero_aplicado = true; });
    await expect(page.locator('.proj-cap[data-cap="2"] .proj-nota-piso')).toBeVisible();
  });

  test("régua: quatro marcas, o zero marcado, um rótulo por linha e nenhum sobreposto a 320 px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await autenticar(page);
    await abrirProjecao(page);
    const regua = page.locator(".proj-regua");
    await expect(regua.locator(".proj-regua__marca")).toHaveCount(4);
    await expect(regua.locator(".proj-regua__zero")).toBeVisible();
    const caixas = await regua.locator(".proj-regua__rotulo").evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect()).map((b) => ({ l: b.left, r: b.right, t: b.top, b: b.bottom })));
    expect(caixas).toHaveLength(4);                      // sem rótulos, os laços abaixo passariam por vacuidade
    for (let i = 0; i < caixas.length; i++)
      for (let j = i + 1; j < caixas.length; j++) {
        const a = caixas[i], b = caixas[j];
        const sobrepoe = a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
        expect(sobrepoe).toBe(false);
      }
    const cont = await regua.evaluate((e) => e.getBoundingClientRect());
    for (const c of caixas) { expect(c.l).toBeGreaterThanOrEqual(cont.left - 0.5); expect(c.r).toBeLessThanOrEqual(cont.right + 0.5); }
  });

  test("régua: domínio sempre inclui o zero, e taxa negativa fica à esquerda dele", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const r = await page.evaluate(() => {
      const a = (window as any).Alpine.$data(document.body);
      const d1 = a.projReguaDominio([0.02, 0.045, 0.0535, 0.065]);
      const d2 = a.projReguaDominio([-0.03, 0.01]);
      a.json.projecao.cenarios[0].taxa_real = -0.012;
      const rg = a.projRegua();
      return { d1, d2, twrX: rg.marcas.find((m: any) => m.id === "twr").x, zeroX: rg.zeroX };
    });
    expect(r.d1.lo).toBeLessThanOrEqual(0);
    expect(r.d2.lo).toBeLessThan(-0.03);
    expect(r.d2.hi).toBeGreaterThan(0.01);
    expect(r.twrX).toBeLessThan(r.zeroX);
  });

  test("uma subseção por cenário, na ordem, com o grifo único entre as âncoras e o mercado", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const cap = page.locator('.proj-cap[data-cap="3"]');
    expect(await cap.locator(".proj-leitura__nome").allInnerTexts()).toEqual(NOMES);
    await expect(page.locator(".tela-projecao .grifo")).toHaveCount(1);
    const grifo = cap.locator(".grifo");
    await expect(grifo).toContainText("Por que as duas medidas do seu histórico discordam");
    await expect(grifo.locator("tbody tr")).toHaveCount(11);
    await expect(grifo).toContainText("antes da medição");      // 2016: retorno null
  });

  test("âncora ausente: 'indisponível hoje' no capítulo 3, três marcas, sem grifo", async ({ page }) => {
    // Sem `t` (twr), `projGrifoFrase()` só é segura porque checa `!t || !x`
    // antes de ler `t.taxa_real` — um regresso ali (ex.: checar só `!x`)
    // lançaria um TypeError dentro da expressão `x-if`, que o Alpine
    // intercepta e loga como "Alpine Expression Error" sem propagar pra
    // fora (a tela continua parecendo correta: o `.grifo` simplesmente não
    // renderiza, por coincidência com o estado esperado desta fixture).
    // Sem esta captura, essa classe de regressão passaria muda.
    const erros: string[] = [];
    page.on("pageerror", (e) => erros.push("pageerror: " + e.message));
    page.on("console", (m) => {
      if (m.type() === "error" || m.text().includes("Alpine Expression Error")) erros.push(m.type() + ": " + m.text());
    });
    await autenticar(page, SO_XIRR);
    await abrirProjecao(page);
    await expect(page.locator('.proj-cap[data-cap="3"]')).toContainText("Retorno da carteira indisponível hoje");
    await expect(page.locator(".proj-regua__marca")).toHaveCount(3);
    await expect(page.locator(".tela-projecao .grifo")).toHaveCount(0);
    await expect(page.locator(".proj-resposta")).toContainText("Pelo retorno do seu dinheiro, aos 65 você teria");
    expect(erros).toEqual([]);
  });
});

test.describe("Projeção como ensaio (7a.AW.2) — copy, largura e tema", () => {
  test("copy: sem travessão, siglas só em 'ver a conta', frases de até 40 palavras", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const r = await page.evaluate(() => {
      const tela = document.querySelector(".tela-projecao") as HTMLElement;
      const clone = tela.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("details.proj-conta, .sr-only").forEach((d) => d.remove());
      return { tudo: tela.innerText, fora: clone.innerText };
    });
    expect(r.tudo).not.toContain("—");
    expect(r.fora).not.toMatch(/\bTWR\b|\bXIRR\b/);
    const frases = r.tudo.split(/[.!?]\s|\n/).map((f) => f.trim()).filter(Boolean);
    for (const f of frases) expect(f.split(/\s+/).length, f).toBeLessThanOrEqual(40);
  });

  test("320 px com todos os 'ver a conta' abertos: sem rolagem horizontal", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await autenticar(page);
    await abrirProjecao(page);
    await page.evaluate(() => document.querySelectorAll(".tela-projecao details").forEach((d) => ((d as HTMLDetailsElement).open = true)));
    const r = await page.evaluate(() => {
      // Além da rolagem da página: nenhum nó do ensaio passa da borda direita
      // dele. Uma tabela larga demais sobra para dentro do respiro lateral da
      // tela sem gerar rolagem (medido na prova de mutação da seta do ponteiro),
      // então só o scrollWidth passaria por vacuidade. Nós sr-only ficam de fora
      // (1 px de caixa, conteúdo transbordando por desenho).
      const borda = document.querySelector(".proj-ensaio")!.getBoundingClientRect().right;
      const fora = Array.from(document.querySelectorAll(".proj-ensaio *"))
        .filter((e) => !e.closest(".sr-only") && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().right > borda + 0.5)
        .map((e) => e.tagName + "." + e.className);
      return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, fora };
    });
    expect(r.sw).toBeLessThanOrEqual(r.cw);
    expect(r.fora).toEqual([]);
  });

  test("Modo Plantão: os gráficos usam os tokens escuros", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("tema", "dark"));
    await autenticar(page);
    await abrirProjecao(page);
    await expect.poll(() => page.evaluate(() => !!(window as any).echarts.getInstanceByDom(document.getElementById("chart-projecao-mapa")))).toBe(true);
    const r = await page.evaluate(() => {
      const ink = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim();
      const inst = (window as any).echarts.getInstanceByDom(document.getElementById("chart-projecao-mapa"));
      return { ink, tema: document.documentElement.getAttribute("data-theme"), cor: inst.getOption().series[0].lineStyle.color };
    });
    expect(r.tema).toBe("dark");
    expect(r.cor.toLowerCase()).toBe(r.ink.toLowerCase());
  });
});
