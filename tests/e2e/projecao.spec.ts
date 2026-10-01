import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

// Fase 7a.AY.2 — a projeção com UM cenário: premissas prospectivas por classe,
// faixas por idade (45/55/65). Fixtures 100% sintéticas
// (gerar_fixture.py::_projecao_sintetica): fonte inventada ("Casa Sintética de
// Premissas", edição 2099), idade 30, ano 2030 → 2065. Nenhum assert depende de
// valor biográfico real nem de número de matriz real. Os valores esperados são
// lidos do PAYLOAD decifrado (não escritos à mão), salvo onde o teste existe
// justamente para travar um valor fixo.
const fx = (n: string) => fs.readFileSync(path.join(__dirname, "../fixtures", n), "utf-8");
const PRINCIPAL = fx("portfolio.test.json.enc");
const NULO = fx("portfolio_projecao_null.test.json.enc");
const PRE229 = fx("portfolio_pre_v229.test.json.enc");
const IDADE50 = fx("portfolio_projecao_idade50.test.json.enc");
const VENCIDA = fx("portfolio_projecao_vencida.test.json.enc");

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

// Abre a rota e espera o nó que é gate de DADO (x-if, `.proj-ensaio`) e o fim
// da transição de entrada (push-enter, transform 280ms): medições de layout
// em dois round-trips leriam quadros diferentes da animação (7a.AW.2).
async function abrirProjecao(page: Page) {
  await page.goto("/#/raiox/projecao");
  await expect(page.locator(".tela-projecao .proj-ensaio")).toBeVisible();
  await page
    .waitForFunction(() => {
      const el = document.querySelector(".tela-projecao");
      return !!el && getComputedStyle(el).transform === "none";
    }, undefined, { timeout: 2000 })
    .catch(() => {});
}

// O Alpine ENGOLE erro de expressão em x-if (vira "falso"): sem este coletor
// uma mutação que quebra um guard ficaria verde.
function coletarErros(page: Page) {
  const erros: string[] = [];
  page.on("pageerror", (e) => erros.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error" || m.text().includes("Alpine Expression Error")) erros.push(m.type() + ": " + m.text());
  });
  return erros;
}

const dados = (page: Page, expr: string) =>
  page.evaluate((e) => {
    const d = (window as any).Alpine.$data(document.body);
    return new Function("d", "return " + e)(d);
  }, expr);

const abrirContas = (page: Page) =>
  page.evaluate(() => document.querySelectorAll(".tela-projecao details").forEach((d) => ((d as HTMLDetailsElement).open = true)));

// Texto renderizado de um percentual com 1 casa ("5,6%") → número (5.6).
const pct = (s: string) => Number(s.replace("%", "").replace("−", "-").replace(",", ".").trim());

test.describe("7a.AY.2 — a tela de um cenário", () => {
  test("1. frase-resposta: p50 na primeira linha, p10 e p90 na segunda, compactos", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page);
    await abrirProjecao(page);
    const r = await dados(page, "({ r: d.projResposta(), p50: d.formatBrlCompacto(d.projResposta().p50), p10: d.formatBrlCompacto(d.projResposta().p10), p90: d.formatBrlCompacto(d.projResposta().p90) })");
    const resp = page.locator(".proj-resposta");
    await expect(resp).toContainText("Aos 65 você teria cerca de " + r.p50 + ", em reais de hoje.");
    await expect(resp).toContainText("Em 8 de cada 10 cenários, entre " + r.p10 + " e " + r.p90 + ".");
    expect(await resp.locator(".proj-faixa").allInnerTexts()).toEqual([r.p50, r.p10, r.p90]);
    expect(r.p50).toMatch(/^R\$ \d+,\d mi$/);
    expect(erros).toEqual([]);
  });

  test("2. só três nós em fonte mono na tela, e são os três valores da frase-resposta", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    await abrirContas(page);
    const r = await page.evaluate(() => {
      const sonda = document.createElement("span");
      sonda.style.fontFamily = "var(--mono)";
      document.body.appendChild(sonda);
      const mono = getComputedStyle(sonda).fontFamily;
      sonda.remove();
      const comTexto = Array.from(document.querySelectorAll(".proj-ensaio *")).filter((el) => {
        const h = el as HTMLElement;
        return h.offsetParent !== null && Array.from(h.childNodes).some((n) => n.nodeType === 3 && (n.textContent || "").trim() !== "");
      });
      const monos = comTexto.filter((el) => getComputedStyle(el).fontFamily === mono);
      return { mono, total: comTexto.length, monos: monos.map((el) => ({ c: el.className, naResposta: !!el.closest(".proj-resposta") })) };
    });
    expect(r.mono).toMatch(/mono/i);                    // a sonda leu o token de verdade
    expect(r.total).toBeGreaterThan(60);                // sem nós a comparação passaria por vacuidade
    expect(r.monos).toEqual([
      { c: "proj-faixa", naResposta: true }, { c: "proj-faixa", naResposta: true }, { c: "proj-faixa", naResposta: true }]);
  });

  test("3. tabela por classe: uma por classe, na ordem do payload, e real − desconto = líquido no que se lê", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const classes = await dados(page, "d.projecao.premissas.classes.map(c => ({ rotulo: c.rotulo, peso: d.projFmtTaxa(c.peso, 0) }))");
    const cap = page.locator('.proj-cap[data-cap="3"]');
    const grupos = cap.locator(".proj-tabela--classes tbody.proj-classe");
    await expect(grupos).toHaveCount(classes.length);
    expect(classes.length).toBe(6);
    expect(await grupos.locator("th").allInnerTexts()).toEqual(classes.map((c: any) => c.rotulo));
    for (const [i, g] of (await grupos.all()).entries()) {
      const tds = await g.locator("td").allInnerTexts();
      expect(tds).toHaveLength(4);
      expect(tds[0]).toBe(classes[i].peso);
      const [real, desc, liq] = tds.slice(1).map(pct);
      expect(Math.abs(real - desc - liq), classes[i].rotulo + ": " + tds.join(" ")).toBeLessThan(1e-9);
      for (const t of tds.slice(1)) expect(t).toMatch(/^\d+,\d%$/);   // 1 casa
    }
    // Cabeçalho das colunas numéricas: os quatro nomes da spec.
    expect(await cap.locator(".proj-tabela--classes thead th").allInnerTexts()).toEqual(["Peso", "Retorno real", "Desconto", "Líquido"]);
  });

  test("3b. o desconto renderizado vem dos dois valores arredondados, mesmo quando o exato não fecharia", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    // Real 3,46% e líquido 3,24%: o desconto exato (0,22%) leria "0,2%", e 3,5 − 0,2 ≠ 3,2.
    // A tela tem de mostrar o desconto que FECHA a conta no que se lê: 3,5 − 0,3 = 3,2.
    await page.evaluate(() => {
      const c = (window as any).Alpine.$data(document.body).json.projecao.premissas.classes[0];
      c.retorno_real = 0.0346; c.retorno_liquido = 0.0324; c.desconto = 0.0022;
    });
    const tds = await page.locator(".proj-tabela--classes tbody.proj-classe").first().locator("td").allInnerTexts();
    expect(tds.slice(1)).toEqual(["3,5%", "0,3%", "3,2%"]);
  });

  test("4. a linha de fonte é do payload: nome, edição e data-base da fixture", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const f = await dados(page, "d.projecao.premissas.fonte");
    const linha = page.locator('.proj-cap[data-cap="3"] .proj-fonte-linha');
    await expect(linha).toContainText(f.nome);
    await expect(linha).toContainText("edição " + f.edicao);
    await expect(linha).toContainText("data-base " + f.data_base.split("-").reverse().join("/"));
    await expect(linha).toContainText("Fundos imobiliários: histórico");
  });

  test("5. premissas vencidas mostram a nota cinza; a fixture principal não", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    await expect(page.locator(".proj-nota-vencida")).toBeHidden();
    await page.unroute("**/portfolio.json.enc");
    const p2 = await page.context().newPage();
    await autenticar(p2, VENCIDA);
    await abrirProjecao(p2);
    const nota = p2.locator(".proj-nota-vencida");
    await expect(nota).toBeVisible();
    await expect(nota).toHaveText("Estas premissas têm mais de um ano; a edição nova ainda não entrou.");
    const cor = await p2.evaluate(() => {
      const s = document.createElement("span"); s.style.color = "var(--gray)"; document.body.appendChild(s);
      const c = getComputedStyle(s).color; s.remove();
      return { gray: c, nota: getComputedStyle(document.querySelector(".proj-nota-vencida")!).color };
    });
    expect(cor.nota).toBe(cor.gray);
  });

  test("6. três linhas no gráfico (45/55/65); com idade 50, duas", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const linhas = page.locator(".proj-faixas__linha");
    await expect(linhas).toHaveCount(3);
    expect(await page.locator(".proj-faixas__nome").allInnerTexts()).toEqual(["Aos 45", "Aos 55", "Aos 65"]);
    await page.unroute("**/portfolio.json.enc");
    const p2 = await page.context().newPage();
    const erros = coletarErros(p2);
    await autenticar(p2, IDADE50);
    await abrirProjecao(p2);
    await expect(p2.locator(".proj-faixas__linha")).toHaveCount(2);
    expect(await p2.locator(".proj-faixas__nome").allInnerTexts()).toEqual(["Aos 55", "Aos 65"]);
    expect(erros).toEqual([]);
  });

  test("7. coordenadas: tudo dentro do eixo, p50 de cada marco em p50/max, teto redondo", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const g = await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      const fx = d.projFaixas();
      const linhas = Array.from(document.querySelectorAll(".proj-faixas__linha")).map((li, i) => {
        const t = li.querySelector(".proj-faixas__trilho")!.getBoundingClientRect();
        const rel = (el: Element | null) => {
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return { l: ((b.left - t.left) / t.width) * 100, r: ((b.right - t.left) / t.width) * 100, c: ((b.left + b.width / 2 - t.left) / t.width) * 100 };
        };
        const m = d.projMarcos()[i];
        return { idade: m.idade, esperado: (m.p50 / fx.max) * 100, ponto: rel(li.querySelector(".proj-faixas__ponto")),
                 traco: rel(li.querySelector(".proj-faixas__traco")), barra: rel(li.querySelector(".proj-faixas__barra")) };
      });
      return { max: fx.max, eixo: Array.from(document.querySelectorAll(".proj-faixas__eixo span")).map((s) => s.textContent),
               fmtMax: d.formatBrlCompacto(fx.max), linhas };
    });
    expect(g.max).toBe(8_000_000);                       // maior p90 da fixture ~6,53 mi → escada → 8 mi
    expect(g.eixo).toEqual(["R$ 0", g.fmtMax]);
    for (const l of g.linhas) {
      expect(l.traco!.l, String(l.idade)).toBeGreaterThanOrEqual(-0.5);
      expect(l.traco!.r, String(l.idade)).toBeLessThanOrEqual(100.5);
      expect(l.barra!.l).toBeGreaterThanOrEqual(l.traco!.l - 0.5);
      expect(l.barra!.r).toBeLessThanOrEqual(l.traco!.r + 0.5);
      expect(Math.abs(l.ponto!.c - l.esperado), String(l.idade)).toBeLessThanOrEqual(0.5);
    }
    // A faixa se abre com o tempo: o traço do 65 é mais largo que o do 45.
    expect(g.linhas[2].traco!.r - g.linhas[2].traco!.l).toBeGreaterThan(g.linhas[0].traco!.r - g.linhas[0].traco!.l);
  });

  test("8. aria-label de cada linha cita os cinco percentis; valores escritos fora do role=img", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const esperado = await dados(page, "d.projMarcos().map(m => ({ label: d.projFaixaLabel(m.idade), v: ['p10','p25','p50','p75','p90'].map(k => d.formatBrlCompacto(m[k])), p10: d.formatBrlCompacto(m.p10), p50: d.formatBrlCompacto(m.p50), p90: d.formatBrlCompacto(m.p90) }))");
    const linhas = await page.locator(".proj-faixas__linha").all();
    expect(linhas).toHaveLength(3);
    for (const [i, li] of linhas.entries()) {
      const img = li.locator('[role="img"]');
      const label = await img.getAttribute("aria-label");
      expect(label).toBe(esperado[i].label);
      for (const v of esperado[i].v) expect(label).toContain(v);
      await expect(img).toHaveText("");                 // nada escrito dentro do desenho
      const val = li.locator(".proj-faixas__valores");
      await expect(val).toContainText("mediana " + esperado[i].p50);
      await expect(val).toContainText("8 em 10 entre " + esperado[i].p10 + " e " + esperado[i].p90);
    }
  });

  test("9. ponteiro: 2 sensibilidades + 3 estresses, mediana e Δ com sinal em texto", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const al = await dados(page, "d.projAlavancas().map(a => ({ nome: a.nome, p50: d.formatBrlCompacto(a.p50), delta: d.formatDeltaCompacto(a.delta) }))");
    const cap = page.locator('.proj-cap[data-cap="5"]');
    const itens = cap.locator(".proj-ponteiro__item");
    await expect(itens).toHaveCount(5);
    expect(await cap.locator(".proj-ponteiro__nome").allInnerTexts()).toEqual(al.map((a: any) => a.nome));
    for (const [i, it] of (await itens.all()).entries()) {
      await expect(it.locator(".proj-ponteiro__desc")).toHaveCount(i < 2 ? 0 : 1);
      await expect(it.locator(".proj-ponteiro__mediana")).toContainText(al[i].p50);
      const delta = it.locator(".proj-delta");
      await expect(delta).toContainText(al[i].delta);
      expect(al[i].delta).toMatch(i < 2 ? /^\+R\$/ : /^−R\$/);
      await expect(delta.locator("span[aria-hidden='true']")).toHaveText(i < 2 ? "▲" : "▼");
    }
    const txt = (await page.locator(".tela-projecao").innerText()).toLowerCase();
    for (const v of ["aporte mais", "compre", "venda ", "invista mais"]) expect(txt).not.toContain(v);
  });

  for (const [nome, corpo] of [["v2.28", PRE229], ["null", NULO]] as const) {
    test(`10. payload ${nome}: 'Projeção indisponível hoje' e card ausente, sem erro`, async ({ page }) => {
      const erros = coletarErros(page);
      await autenticar(page, corpo);
      await expect(page.locator(".proj-card-home")).toBeHidden();
      await page.goto("/#/raiox/projecao");
      await expect(page.locator(".tela-projecao")).toContainText("Projeção indisponível hoje");
      await expect(page.locator(".proj-ensaio")).toHaveCount(0);
      expect(erros).toEqual([]);
    });
  }

  for (const w of [320, 390]) {
    test(`11. sem rolagem horizontal a ${w} px, com tudo aberto, e nada fora do próprio capítulo`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 800 });
      await autenticar(page);
      await abrirProjecao(page);
      await abrirContas(page);
      const r = await page.evaluate(() => {
        const ensaio = document.querySelector(".proj-ensaio")!.getBoundingClientRect();
        const blocos = [document.querySelector(".proj-resposta")!, ...Array.from(document.querySelectorAll(".proj-cap")),
                        document.querySelector(".proj-conta--final")!];
        const fora: string[] = [];
        for (const bl of blocos) {
          const c = bl.getBoundingClientRect();
          if (c.left < ensaio.left - 0.5 || c.right > ensaio.right + 0.5) fora.push("bloco " + bl.className);
          for (const e of Array.from(bl.querySelectorAll("*"))) {
            if (e.closest(".sr-only")) continue;
            const b = e.getBoundingClientRect();
            if (b.width === 0) continue;
            if (b.left < c.left - 0.5 || b.right > c.right + 0.5) fora.push(e.tagName + "." + e.className);
          }
        }
        return { blocos: blocos.length, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, fora };
      });
      expect(r.blocos).toBe(8);                   // abertura + seis capítulos + a conta final
      expect(r.sw).toBeLessThanOrEqual(r.cw);
      expect(r.fora).toEqual([]);
    });
  }

  test("12. nada das quatro leituras: sem TWR, XIRR, âncora, 'quatro leituras', nem travessão", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    await abrirContas(page);
    const txt = await page.locator(".tela-projecao").innerText();
    for (const t of [/\bTWR\b/, /\bXIRR\b/, /âncora/i, /quatro leituras/i]) expect(txt).not.toMatch(t);
    expect(txt).not.toContain("—");
    const frases = txt.split(/[.!?]\s|\n/).map((f) => f.trim()).filter(Boolean);
    for (const f of frases) expect(f.split(/\s+/).length, f).toBeLessThanOrEqual(40);
  });
});

test.describe("7a.AY.2 — capítulos e conta", () => {
  test("seis capítulos na ordem, com ordinal e título; 'ver a conta' fechado por padrão", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    expect(await page.locator(".proj-cap__ordinal").allInnerTexts()).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(await page.locator(".proj-cap__titulo").allInnerTexts()).toEqual([
      "De onde você parte", "Quanto você aporta", "Quanto a carteira deve render", "O que isso dá",
      "O que mexe o ponteiro", "O que esta conta não inclui"]);
    for (const d of await page.locator(".tela-projecao details").all()) expect(await d.getAttribute("open")).toBeNull();
    const conta = page.locator('.proj-cap[data-cap="2"] details.proj-conta');
    await conta.locator("summary").click();
    await expect(conta.locator(".proj-tabela--conta tr")).toHaveCount(4);
  });

  test("cap. 3: tema é a taxa central, e o grifo único cita EUA a partir do payload", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const v = await dados(page, "({ taxa: d.projFmtTaxa(d.projecao.taxa_central.taxa), eua: d.projFmtTaxa(d.projecao.premissas.classes.find(c => c.classe === 'U.S. Large Cap').retorno_real, 1) })");
    const cap = page.locator('.proj-cap[data-cap="3"]');
    await expect(cap.locator(".proj-cap__tema")).toHaveText(v.taxa + " ao ano, acima da inflação");
    await expect(cap.locator(".proj-cap__texto").first()).toContainText("descontado de custos e impostos");
    await expect(page.locator(".tela-projecao .grifo")).toHaveCount(1);
    const grifo = cap.locator(".grifo.proj-grifo");
    await expect(grifo.locator(".proj-grifo__titulo")).toHaveText("Esta taxa olha para frente, não para trás");
    await expect(grifo).toContainText("10 a 15 anos");
    await expect(grifo).toContainText("6,7%");
    await expect(grifo).toContainText(v.eua);
    // Sem a linha americana no payload, a comparação some (nunca um número inventado).
    await page.evaluate(() => {
      const p = (window as any).Alpine.$data(document.body).json.projecao.premissas;
      p.classes = p.classes.filter((c: any) => c.classe !== "U.S. Large Cap");
    });
    await expect(grifo).not.toContainText("6,7%");
  });

  test("cap. 3 'ver a conta': composição do desconto, inflação, média e oscilação", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const v = await dados(page, "({ inf: d.projFmtTaxa(d.projecao.premissas.inflacao), media: d.projFmtTaxa(d.projecao.taxa_central.media_aritmetica), vol: d.projFmtTaxa(d.projecao.taxa_central.vol_carteira, 1), ter: d.projFmtTaxa(d.projecao.premissas.classes[0].desconto_composicao.ter) })");
    const conta = page.locator('.proj-cap[data-cap="3"] details.proj-conta');
    await conta.locator("summary").click();
    await expect(conta.locator(".proj-tabela--desconto tbody tr")).toHaveCount(6);
    await expect(conta.locator(".proj-tabela--desconto tbody tr").first()).toContainText(v.ter);
    for (const t of [v.inf, v.media, v.vol, "30% do dividendo", "1 ponto-base"]) await expect(conta).toContainText(t);
  });

  test("cap. 4: decomposição em barra e tabela; parcela negativa só em texto", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page);
    await abrirProjecao(page);
    const cap = page.locator('.proj-cap[data-cap="4"]');
    await expect(cap.locator(".proj-decomp__seg")).toHaveCount(3);
    await expect(cap.locator(".proj-tabela--decomp tbody tr")).toHaveCount(3);
    await expect(cap.locator(".proj-decomp__titulo")).toContainText("A mediana da simulação é esse mesmo valor");
    await page.evaluate(() => {
      (window as any).Alpine.$data(document.body).json.projecao.decomposicao.rendimento_aportes = -50000;
    });
    await expect(cap.locator(".proj-decomp__seg")).toHaveCount(2);
    await expect(cap.locator(".proj-tabela--decomp")).toContainText("−R$ 50 mil");
    expect(erros).toEqual([]);
  });

  test("cap. 6 e a conta final: percentis por marco, correlações, trajetórias", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const cap6 = page.locator('.proj-cap[data-cap="6"]');
    for (const t of ["valor de mercado", "Rebalancear", "10 a 15 anos", "Fundos imobiliários", "Renda-alvo"]) await expect(cap6).toContainText(t);
    // A justificativa da classe histórica vive só na linha de fonte do cap. 3 (board, iteração 1).
    await expect(cap6).toContainText("Fundos imobiliários: histórico 2010-2020 (sintético).");
    await expect(cap6).not.toContainText("premissa prospectiva");
    const fin = page.locator(".proj-conta--final");
    await fin.locator("summary").click();
    const perc = fin.locator(".proj-tabela--percentis");
    await expect(perc.locator("thead th")).toHaveCount(4);
    expect((await perc.locator("thead th").allInnerTexts()).slice(1)).toEqual(["45 anos", "55 anos", "65 anos"]);
    await expect(perc.locator("tbody tr")).toHaveCount(5);
    // Sem o "R$ " nas células (a 320 px as três colunas não cabiam com ele); a unidade fica na frase acima.
    const p90_65 = await dados(page, "d.formatBrlCompacto(d.projFinal().p90).replace('R$ ', '')");
    await expect(perc.locator("tbody tr").last().locator("td").last()).toHaveText(p90_65);
    await expect(fin.locator(".proj-tabela--correl tbody tr")).toHaveCount(15);       // 6 classes → 15 pares
    await expect(fin.locator(".proj-tabela--correl tbody tr").first()).toContainText("Ações Brasil e Ações EUA");
    await expect(fin).toContainText("10.000 trajetórias");
    await expect(page.locator(".proj-rodape")).toHaveText("10.000 trajetórias · recalculada toda noite · projeção, não promessa");
  });

  test("a 320 px: cabeçalhos das tabelas com folga ≥ 6 px entre os textos", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await autenticar(page);
    await abrirProjecao(page);
    await abrirContas(page);
    const r = await page.evaluate(() => {
      const texto = (el: Element) => { const rg = document.createRange(); rg.selectNodeContents(el); return rg.getBoundingClientRect(); };
      const folgas: { tabela: string; folga: number }[] = [];
      for (const t of Array.from(document.querySelectorAll(".proj-ensaio table"))) {
        for (const tr of Array.from(t.querySelectorAll("thead tr"))) {
          const ths = Array.from(tr.querySelectorAll("th")).filter((th) => (th.textContent || "").trim() !== "" && !th.querySelector(".sr-only"));
          for (let i = 1; i < ths.length; i++) folgas.push({ tabela: t.className, folga: texto(ths[i]).left - texto(ths[i - 1]).right });
        }
      }
      return folgas;
    });
    expect(r.length).toBeGreaterThanOrEqual(5);          // classes (3) + desconto (1) + percentis (2): vazio passaria por vacuidade
    for (const f of r) expect(f.folga, f.tabela).toBeGreaterThanOrEqual(6);
  });

  test("a 320 px: no ponteiro, mediana e Δ na mesma linha, com folga, dentro do capítulo", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await autenticar(page);
    await abrirProjecao(page);
    const r = await page.evaluate(() => {
      const cap = document.querySelector('.proj-cap[data-cap="5"]')!.getBoundingClientRect();
      return Array.from(document.querySelectorAll(".proj-ponteiro__efeito")).map((e) => {
        const n = e.querySelector(".proj-ponteiro__mediana")!.getBoundingClientRect();
        const d = e.querySelector(".proj-delta")!.getBoundingClientRect();
        return { folga: d.left - n.right, mesma: n.top < d.bottom && d.top < n.bottom, dentro: d.right <= cap.right + 0.5 };
      });
    });
    expect(r).toHaveLength(5);
    for (const e of r) { expect(e.mesma).toBe(true); expect(e.folga).toBeGreaterThanOrEqual(8); expect(e.dentro).toBe(true); }
  });

  for (const w of [800, 320]) {
    test(`abertura a ${w}px: na linha da faixa, o 'e' fica com o primeiro valor`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 800 });
      await autenticar(page);
      await abrirProjecao(page);
      const linha = () => page.evaluate(() => {
        const [, a, b] = Array.from(document.querySelectorAll(".proj-resposta .proj-faixa")).map((e) => e.getBoundingClientRect());
        const e = document.querySelector(".proj-resposta .proj-conectivo")!.getBoundingClientRect();
        const mesma = (x: DOMRect, y: DOMRect) => Math.abs((x.top + x.bottom) / 2 - (y.top + y.bottom) / 2) < Math.min(x.height, y.height) / 2;
        return { eComA: mesma(a, e), bComA: mesma(a, b) };
      });
      const r = await linha();
      expect(r.eComA).toBe(true);
      if (w === 800) expect(r.bComA).toBe(true);
      // Valores largos forçam a quebra: ela tem de cair DEPOIS do "e".
      await page.evaluate(() => {
        const fs = (window as any).Alpine.$data(document.body).json.projecao.faixas;
        const f = fs[fs.length - 1];
        f.p10 = 888_800_000; f.p90 = 999_900_000;
      });
      await expect(page.locator(".proj-resposta .proj-faixa").last()).toHaveText("R$ 999,9 mi");
      const r2 = await linha();
      expect(r2.eComA).toBe(true);
      if (w === 320) expect(r2.bComA).toBe(false);
    });
  }

  test("unidades e conectivos: fonte do texto, mesmo corpo do número vizinho, peso 400, cinza", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const r = await page.evaluate(() => {
      const sonda = document.createElement("span");
      sonda.style.color = "var(--gray)";
      document.querySelector(".proj-ensaio")!.appendChild(sonda);
      const cinza = getComputedStyle(sonda).color;
      sonda.remove();
      const els = Array.from(document.querySelectorAll(".proj-ensaio .proj-cap__unidade, .proj-ensaio .proj-conectivo"))
        .filter((el) => (el as HTMLElement).offsetParent !== null);
      return {
        cinza,
        itens: els.map((el) => {
          const cs = getComputedStyle(el);
          const viz = el.closest(".proj-resposta__intervalo") || el.parentElement!;
          return { txt: (el.textContent || "").trim(), mono: /mono/i.test(cs.fontFamily), peso: cs.fontWeight, cor: cs.color,
                   corpo: cs.fontSize, corpoRef: getComputedStyle(viz).fontSize };
        }),
      };
    });
    expect(r.itens.length).toBeGreaterThanOrEqual(3);   // o "e" da abertura + as unidades dos temas dos caps. 2 e 3
    for (const i of r.itens) {
      expect(i.mono, i.txt).toBe(false);
      expect(i.peso, i.txt).toBe("400");
      expect(i.cor, i.txt).toBe(r.cinza);
      expect(i.corpo, i.txt).toBe(i.corpoRef);
    }
  });

  test("Modo Plantão: gráfico e barra leem os tokens escuros", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("tema", "dark"));
    await autenticar(page);
    await abrirProjecao(page);
    const r = await page.evaluate(() => {
      const cor = (v: string) => { const s = document.createElement("span"); s.style.color = `var(${v})`; document.body.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c; };
      const bg = (sel: string) => getComputedStyle(document.querySelector(sel)!).backgroundColor;
      return {
        tema: document.documentElement.getAttribute("data-theme"),
        g700: cor("--g-700"), ink: cor("--ink"),
        barraFaixa: bg(".proj-faixas__barra"), ponto: bg(".proj-faixas__ponto"), aportes: bg(".proj-decomp__seg--aportes"),
      };
    });
    expect(r.tema).toBe("dark");
    expect(r.g700).toBe("rgb(52, 211, 153)");
    expect(r.barraFaixa).toBe(r.g700);
    expect(r.aportes).toBe(r.g700);
    expect(r.ponto).toBe(r.ink);
  });

  test("a rota não monta ECharts, e o card abre a tela", async ({ page }) => {
    await autenticar(page);
    const card = page.locator(".proj-card-home");
    await expect(card).toContainText("Projeção até os 65");
    await card.click();
    await expect(page).toHaveURL(/#\/raiox\/projecao$/);
    await expect(page.locator(".proj-faixas__linha")).toHaveCount(3);
    expect(await page.locator(".tela-projecao canvas").count()).toBe(0);
    expect(await page.locator(".tela-projecao [_echarts_instance_]").count()).toBe(0);
  });
});

// ── Board da AY.2, iteração 1: payload parcial e valores ausentes não quebram a tela.
test.describe("7a.AY.2 — robustez a payload parcial (board, iteração 1)", () => {
  for (const [nome, mutacao] of [
    ["sem a faixa da idade final", "p.faixas = p.faixas.filter(f => f.idade !== p.idade_final)"],
    ["sem decomposição", "delete p.decomposicao"],
    ["sem a lista de estresses", "delete p.ponteiro.estresse"],
    ["sem a fonte das premissas", "delete p.premissas.fonte"],
    // Board, iteração 2: toda chave que o template lê sem guarda própria.
    ["sem partida.patrimonio", "delete p.partida.patrimonio"],
    ["com aporte.mensal não numérico", "p.aporte.mensal = 'x'"],
    ["sem aporte.janela.de", "delete p.aporte.janela.de"],
    ["sem aporte.janela.ate", "delete p.aporte.janela.ate"],
    ["sem trajetorias", "delete p.trajetorias"],
    ["com decomposicao.partida_crescida NaN", "p.decomposicao.partida_crescida = NaN"],
    ["sem decomposicao.aportes", "delete p.decomposicao.aportes"],
    ["com decomposicao.rendimento_aportes nulo", "p.decomposicao.rendimento_aportes = null"],
    ["sem decomposicao.final", "delete p.decomposicao.final"],
  ] as const) {
    test(`bloco ${nome}: 'Projeção indisponível hoje', card ausente, nenhum erro`, async ({ page }) => {
      const erros = coletarErros(page);
      await autenticar(page);
      await abrirProjecao(page);
      await page.evaluate((m) => {
        const p = (window as any).Alpine.$data(document.body).json.projecao;
        new Function("p", m)(p);
      }, mutacao);
      await expect(page.locator(".tela-projecao")).toContainText("Projeção indisponível hoje");
      await expect(page.locator(".proj-ensaio")).toHaveCount(0);
      await expect(page.locator(".proj-card-home")).toBeHidden();
      expect(erros).toEqual([]);
    });
  }

  test("valor ausente na classe vira '—', nunca 0; correlação ausente também", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page);
    await abrirProjecao(page);
    await page.evaluate(() => {
      const p = (window as any).Alpine.$data(document.body).json.projecao;
      p.premissas.classes[0].retorno_real = null;
      p.premissas.classes[1].retorno_liquido = Number.NaN;
      p.premissas.correlacoes.matriz[0] = [1.0];          // linha truncada: matriz[0][1..] some
    });
    const g = page.locator(".proj-tabela--classes tbody.proj-classe");
    expect((await g.nth(0).locator("td").allInnerTexts()).slice(1)).toEqual(["—", "—", "5,6%"]);
    expect((await g.nth(1).locator("td").allInnerTexts()).slice(1)).toEqual(["5,0%", "—", "—"]);
    const fin = page.locator(".proj-conta--final");
    await fin.locator("summary").click();
    await expect(fin.locator(".proj-tabela--correl tbody tr").first().locator("td")).toHaveText("—");
    expect(await dados(page, "[d.projFmtRho(null), d.projFmtRho(undefined), d.projFmtRho(NaN), d.projFmtRho(-0.1)]")).toEqual(["—", "—", "—", "−0,10"]);
    expect(erros).toEqual([]);
  });

  test("delta ausente numa alavanca: só '—', sem seta e sem cor de direção", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page);
    await abrirProjecao(page);
    await page.evaluate(() => { delete (window as any).Alpine.$data(document.body).json.projecao.ponteiro.estresse[0].delta; });
    const d = page.locator(".proj-ponteiro__item").nth(2).locator(".proj-delta");
    await expect(d).toHaveText("—");
    await expect(d.locator("span[aria-hidden='true']")).toHaveCount(0);
    expect(await d.getAttribute("class")).not.toMatch(/proj-(neg|pos)/);
    // As outras alavancas seguem com seta.
    await expect(page.locator(".proj-ponteiro__item").nth(3).locator(".proj-delta span[aria-hidden='true']")).toHaveText("▼");
    expect(erros).toEqual([]);
  });

  test("marcos: a idade final sempre entra, e sem marco futuro o capítulo 4 diz isso em uma linha", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page);
    await abrirProjecao(page);
    // Idade final 60 (a faixa existe na série): 45, 55 e a própria 60; o 65 passa da idade final e sai.
    expect(await dados(page, "(d.json.projecao.idade_final = 60, d.projMarcos().map(m => m.idade))")).toEqual([45, 55, 60]);
    expect(await dados(page, "(d.json.projecao.idade_final = 65, d.projMarcos().map(m => m.idade))")).toEqual([45, 55, 65]);
    // Ninguém mais no futuro: lista vazia, nota cinza no cap. 4 e na conta final, sem linhas vazias.
    expect(await dados(page, "(d.json.projecao.idade_atual = 66, d.projMarcos().length)")).toBe(0);
    await expect(page.locator(".proj-faixas__linha")).toHaveCount(0);
    await expect(page.locator(".proj-faixas")).toBeHidden();
    await expect(page.locator(".proj-faixas-vazio")).toBeVisible();
    await expect(page.locator(".proj-faixas-vazio")).toHaveText("Não há idade futura para desenhar.");
    await page.locator(".proj-conta--final summary").click();
    await expect(page.locator(".proj-tabela--percentis")).toBeHidden();
    await expect(page.locator(".proj-conta--final")).toContainText("Não há idade futura para a tabela dos percentis.");
    expect(erros).toEqual([]);
  });
});

// ── 7a.AY.2 (Task 10): getters e estados da projeção v2.29 (preservados).
test.describe("7a.AY — getters e estados da projeção v2.29", () => {
  test("v2.29: card da home diz 'Aos 65, cerca de R$ …'", async ({ page }) => {
    await autenticar(page);
    await expect(page.locator(".proj-card-home")).toBeVisible();
    await expect(page.locator(".proj-card-home .rel-card-home__mes")).toHaveText(/^Aos 65, cerca de R\$ .+/);
  });

  test("v2.28 (tem cenarios, sem faixas): projecao nula, card ausente, rota indisponível", async ({ page }) => {
    await autenticar(page, PRE229);
    expect(await dados(page, "d.projecao")).toBeNull();
    await expect(page.locator(".proj-card-home")).toBeHidden();
    await page.goto("/#/raiox/projecao");
    await expect(page.locator(".tela-projecao")).toContainText("Projeção indisponível hoje");
  });

  test("projecao null: card ausente e rota indisponível", async ({ page }) => {
    await autenticar(page, NULO);
    await expect(page.locator(".proj-card-home")).toBeHidden();
    await page.goto("/#/raiox/projecao");
    await expect(page.locator(".tela-projecao")).toContainText("Projeção indisponível hoje");
  });

  test("marcos 45/55/65 filtrados a idade > idade_atual", async ({ page }) => {
    await autenticar(page);
    expect(await dados(page, "d.projMarcos().map(f => f.idade)")).toEqual([45, 55, 65]);
    await page.unroute("**/portfolio.json.enc");
    const p2 = await page.context().newPage();
    await autenticar(p2, IDADE50);
    expect(await dados(p2, "d.projMarcos().map(f => f.idade)")).toEqual([55, 65]);
    expect(await dados(p2, "d.projFaixas().linhas.map(l => l.idade)")).toEqual([55, 65]);
  });

  test("resposta, eixo e rótulos coerentes com a faixa final", async ({ page }) => {
    await autenticar(page);
    const r = await dados(page, "d.projResposta()");
    const f = await dados(page, "d.projFinal()");
    expect(f.idade).toBe(65);
    expect(r).toEqual({ p50: f.p50, p10: f.p10, p90: f.p90 });
    const fx = await dados(page, "d.projFaixas()");
    const maxP90 = await dados(page, "Math.max(...d.projMarcos().map(m => m.p90))");
    expect(fx.max).toBeGreaterThanOrEqual(maxP90);
    for (const l of fx.linhas) {
      for (const k of ["p10", "p25", "p50", "p75", "p90"]) {
        expect(l[k]).toBeGreaterThanOrEqual(0);
        expect(l[k]).toBeLessThanOrEqual(100);
      }
    }
    expect(await dados(page, "d.projFaixaLabel(55)")).toMatch(/^Aos 55, em reais de hoje: 1 em 10 cenários abaixo de R\$/);
    expect(await dados(page, "d.projClasses().length")).toBe(6);
  });

  test("linha de fonte cita nome, edição, data-base e a classe histórica", async ({ page }) => {
    await autenticar(page);
    const t = await dados(page, "d.projFonteTexto()");
    expect(t).toContain("Premissas da Casa Sintética de Premissas (edição 2099, data-base 01/01/2099), em reais.");
    expect(t).toContain("Fundos imobiliários: histórico 2010-2020 (sintético), porque ninguém publica premissa prospectiva para eles.");
  });

  test("alavancas: 2 sensibilidades + 3 estresses; 'praticamente' só acima de 1%", async ({ page }) => {
    await autenticar(page);
    const a = await dados(page, "d.projAlavancas()");
    expect(a).toHaveLength(5);
    expect(a[0]).toMatchObject({ nome: "+R$ 1.000/mês de aporte", descricao: null });
    expect(a[2].descricao).toBeTruthy();
    expect(await dados(page, "d.projPraticamente()")).toBe("");
    expect(await dados(page, "(d.json.projecao.decomposicao.final *= 1.5, d.projPraticamente())")).toBe("praticamente ");
  });

  test("premissas vencidas continuam publicando o bloco", async ({ page }) => {
    await autenticar(page, VENCIDA);
    expect(await dados(page, "d.projecao.premissas_vencidas")).toBe(true);
    await expect(page.locator(".proj-card-home")).toBeVisible();
  });
});
