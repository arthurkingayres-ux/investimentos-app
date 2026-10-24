import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

// Fase 7a.BJ.2 — renda da carteira (#/raiox/renda) e o card da home. Fixtures
// 100% sintéticas (gerar_fixture.py::_renda_sintetica): idade 30, horizonte 95,
// fonte inventada. Os valores esperados são lidos do PAYLOAD decifrado e
// formatados pelo formatador da casa (window.formatBrl), nunca escritos à mão,
// salvo onde o teste existe para travar a copy.
const fx = (n: string) => fs.readFileSync(path.join(__dirname, "../fixtures", n), "utf-8");
const PRINCIPAL = fx("portfolio.test.json.enc");
const NULO = fx("portfolio_renda_null.test.json.enc");
const PRE232 = fx("portfolio_pre_v232.test.json.enc");
const COBREM = fx("portfolio_renda_cobrem.test.json.enc");
const ZERO = fx("portfolio_renda_zero.test.json.enc");
const CURTA = fx("portfolio_renda_curta.test.json.enc");

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

// Gate de DADO (x-if `.renda-ensaio`) + fim do push-enter: medições de layout
// em dois round-trips leriam quadros diferentes da animação (lição 7a.AW.2).
async function abrirRenda(page: Page) {
  await page.goto("/#/raiox/renda");
  await expect(page.locator(".tela-renda .renda-ensaio")).toBeVisible();
  await page
    .waitForFunction(() => {
      const el = document.querySelector(".tela-renda");
      return !!el && getComputedStyle(el).transform === "none";
    }, undefined, { timeout: 2000 })
    .catch(() => {});
}

// O Alpine engole erro de expressão em x-if: sem este coletor, um guard
// quebrado ficaria verde.
function coletarErros(page: Page) {
  const erros: string[] = [];
  page.on("pageerror", (e) => erros.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error" || m.text().includes("Alpine Expression Error")) erros.push(m.type() + ": " + m.text());
  });
  return erros;
}

// Bloco renda do payload decifrado + o formatador inteiro da casa.
const renda = (page: Page) =>
  page.evaluate(() => {
    const r = (window as any).Alpine.$data(document.body).json.renda;
    const brl = (v: number) => (window as any).formatBrl(v, 0);
    return { r, fmt: {
      mensal: brl(r.hoje.mensal), anual: brl(r.hoje.anual),
      variacao: brl(Math.abs(r.hoje.variacao_12m_mensal ?? 0)),
      dividendos: brl(r.hoje.dividendos_mensal), vendas: brl(r.hoje.vendas_mensal),
      mediana: brl(r.heranca.mediana_horizonte),
      guard: r.guardrails.map((g: any) => ({ pat: brl(g.patrimonio), mensal: brl(g.mensal) })),
      pisos: r.heranca.pisos.map((p: any) => ({ piso: brl(p.piso), mensal: brl(p.mensal) })),
      marcos: r.projecao.filter((l: any) => r.marcos.includes(l.idade))
        .map((l: any) => ({ idade: l.idade, p10: brl(l.p10), p50: brl(l.p50), p90: brl(l.p90) })),
    } };
  });

const norm = (s: string | null) => (s || "").replace(/\s+/g, " ").trim();

test.describe("7a.BJ.2 — card na home", () => {
  test("card logo abaixo da projeção: 'Renda da carteira' e 'Sua carteira já pagaria R$ X por mês'", async ({ page }) => {
    await autenticar(page);
    const { fmt } = await renda(page);
    const card = page.locator(".renda-card-home");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Renda da carteira");
    expect(norm(await card.textContent())).toContain(norm(`Sua carteira já pagaria ${fmt.mensal} por mês`));
    const vizinho = await page.evaluate(() => {
      const p = document.querySelector(".proj-card-home");
      let n = p && p.nextElementSibling;
      while (n && n.tagName === "TEMPLATE") n = n.nextElementSibling;
      return n ? n.className : null;
    });
    expect(vizinho).toContain("renda-card-home");
    await card.click();
    await expect(page).toHaveURL(/#\/raiox\/renda$/);
    await expect(page.locator(".tela-renda .renda-ensaio")).toBeVisible();
  });

  test("renda zero: o card não promete renda inexistente", async ({ page }) => {
    await autenticar(page, ZERO);
    const card = page.locator(".renda-card-home");
    await expect(card).toBeVisible();
    await expect(card).not.toContainText("já pagaria");
    await expect(card).toContainText("ainda não sustenta renda");
  });

  for (const [nome, corpo] of [["renda null", NULO], ["pré-v2.32", PRE232]] as const) {
    test(`payload ${nome}: card ausente e a rota diz 'Renda indisponível hoje.', sem erro`, async ({ page }) => {
      const erros = coletarErros(page);
      await autenticar(page, corpo);
      await expect(page.locator(".renda-card-home")).toBeHidden();
      await page.goto("/#/raiox/renda");
      await expect(page.locator(".tela-renda")).toContainText("Renda indisponível hoje.");
      await expect(page.locator(".tela-renda .renda-ensaio")).toHaveCount(0);
      expect(erros).toEqual([]);
    });
  }
});

test.describe("7a.BJ.2 — o salário de hoje", () => {
  test("herói: frase, R$ X por mês (único mono da tela) e R$ Y por ano em reais de hoje", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page);
    await abrirRenda(page);
    const { fmt } = await renda(page);
    const hoje = page.locator(".renda-hoje");
    await expect(hoje).toContainText("Se você parasse de trabalhar hoje, sua carteira sustentaria");
    expect(norm(await page.locator(".renda-heroi").textContent())).toBe(norm(fmt.mensal));
    expect(norm(await hoje.textContent())).toContain(norm(`${fmt.anual} por ano, em reais de hoje`));
    const monos = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".tela-renda *"))
        .filter((el) => /mono/i.test(getComputedStyle(el).fontFamily) && Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || "").trim()))
        .map((el) => el.className));
    expect(monos).toEqual(["renda-heroi"]);
    expect(erros).toEqual([]);
  });

  test("chip de 12 meses: positivo com '+', em reais por mês", async ({ page }) => {
    await autenticar(page);
    await abrirRenda(page);
    const { r, fmt } = await renda(page);
    expect(r.hoje.variacao_12m_mensal).toBeGreaterThan(0);
    expect(norm(await page.locator(".renda-chip").textContent())).toBe(norm(`+${fmt.variacao} por mês em 12 meses`));
  });

  test("chip negativo mostra o sinal '−' em texto, sem vermelho", async ({ page }) => {
    await autenticar(page, COBREM);
    await abrirRenda(page);
    const { r, fmt } = await renda(page);
    expect(r.hoje.variacao_12m_mensal).toBeLessThan(0);
    const chip = page.locator(".renda-chip");
    expect(norm(await chip.textContent())).toBe(norm(`−${fmt.variacao} por mês em 12 meses`));
    const cores = await page.evaluate(() => {
      const c = (v: string) => { const s = document.createElement("span"); s.style.color = `var(${v})`; document.body.appendChild(s); const x = getComputedStyle(s).color; s.remove(); return x; };
      return { chip: getComputedStyle(document.querySelector(".renda-chip")!).color, red: c("--red") };
    });
    expect(cores.chip).not.toBe(cores.red);
  });

  test("histórico curto: o chip some", async ({ page }) => {
    await autenticar(page, CURTA);
    await abrirRenda(page);
    await expect(page.locator(".renda-heroi")).toBeVisible();
    await expect(page.locator(".renda-chip")).toHaveCount(0);
  });

  test("de onde viria: duas linhas (proventos < renda) e a barra de dois segmentos", async ({ page }) => {
    await autenticar(page);
    await abrirRenda(page);
    const { fmt } = await renda(page);
    const linhas = page.locator(".renda-origem tbody tr");
    await expect(linhas).toHaveCount(2);
    expect(norm(await linhas.nth(0).textContent())).toBe(norm(`Dividendos e aluguéis ${fmt.dividendos}`));
    expect(norm(await linhas.nth(1).textContent())).toBe(norm(`Vendas de cotas ${fmt.vendas}`));
    await expect(page.locator(".renda-origem__seg")).toHaveCount(2);
    await expect(page.locator(".renda-origem")).toContainText("rebalance");
  });

  test("proventos cobrem: 100% proventos e a frase do excedente", async ({ page }) => {
    await autenticar(page, COBREM);
    await abrirRenda(page);
    const linhas = page.locator(".renda-origem tbody tr");
    await expect(linhas).toHaveCount(1);
    await expect(linhas.first()).toContainText("Dividendos e aluguéis");
    const segs = page.locator(".renda-origem__seg");
    await expect(segs).toHaveCount(1);
    expect(await segs.first().evaluate((el) => (el as HTMLElement).style.width)).toBe("100%");
    await expect(page.locator(".renda-origem")).toContainText("já cobrem essa renda");
  });

  test("renda zero por piso alto: a frase do piso no lugar do herói, e a tabela de pisos continua", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page, ZERO);
    await abrirRenda(page);
    await expect(page.locator(".renda-hoje")).toContainText("Com o piso de herança atual, a carteira ainda não sustenta renda");
    await expect(page.locator(".renda-heroi")).toHaveCount(0);
    await expect(page.locator(".renda-chip")).toHaveCount(0);
    await expect(page.locator(".renda-origem")).toHaveCount(0);
    const { r } = await renda(page);
    await expect(page.locator(".renda-pisos tbody")).toHaveCount(r.heranca.pisos.length);
    expect(erros).toEqual([]);
  });

  test("o que 'seguro' quer dizer: probabilidade, horizonte e piso lidos do payload", async ({ page }) => {
    await autenticar(page);
    await abrirRenda(page);
    const { r } = await renda(page);
    const t = norm(await page.locator(".renda-seguro").textContent());
    expect(t).toContain(`${Math.round(r.premissas.probabilidade * 100)}%`);
    expect(t).toContain(`até os ${r.premissas.idade_horizonte}`);
    expect(t).toContain("varia a cada atualização");
  });
});

test.describe("7a.BJ.2 — como ele cresce, ano bom e ano ruim, herança", () => {
  test("tabela 'Se você parasse aos…': uma linha por marco, com a faixa '8 em 10 cenários'", async ({ page }) => {
    await autenticar(page);
    await abrirRenda(page);
    const { fmt } = await renda(page);
    const tab = page.locator(".renda-marcos");
    await expect(page.locator(".renda-cresce")).toContainText("Se você parasse aos");
    await expect(tab.locator("tbody")).toHaveCount(fmt.marcos.length);
    expect(fmt.marcos.length).toBeGreaterThan(3);
    for (let i = 0; i < fmt.marcos.length; i++) {
      const m = fmt.marcos[i];
      const t = norm(await tab.locator("tbody").nth(i).textContent());
      expect(t).toContain(`Aos ${m.idade}`);
      expect(t).toContain(norm(m.p50));
      expect(t).toContain(norm(`8 em 10 cenários entre ${m.p10} e ${m.p90}`));
    }
  });

  test("frase-resumo: mês em prosa ('outubro de 2028'), não rótulo ('Outubro 2028')", async ({ page }) => {
    await autenticar(page);
    await abrirRenda(page);
    const t = norm(await page.locator(".renda-cresce .renda-texto").first().textContent());
    expect(t).toMatch(/^Em [a-zç]+ de \d{4}, o patrimônio de então sustentaria /);
  });

  test("gráfico SVG: passado em linha cheia, hoje marcado, mediana tracejada, faixa, legenda com as duas unidades", async ({ page }) => {
    await autenticar(page);
    await abrirRenda(page);
    const g = page.locator(".renda-grafico svg[role='img']");
    await expect(g).toHaveCount(1);
    expect((await g.getAttribute("aria-label")) || "").toMatch(/por mês/);
    const r = await page.evaluate(() => {
      const q = (s: string) => document.querySelector(".renda-grafico " + s) as SVGElement | null;
      const pass = q(".renda-grafico__passado"), med = q(".renda-grafico__mediana");
      return {
        passado: !!pass && !getComputedStyle(pass).strokeDasharray.match(/\d/),
        mediana: !!med && /\d/.test(getComputedStyle(med).strokeDasharray),
        faixa: !!q(".renda-grafico__faixa"), hoje: !!q(".renda-grafico__hoje"),
      };
    });
    expect(r).toEqual({ passado: true, mediana: true, faixa: true, hoje: true });
    const leg = page.locator(".renda-grafico__legenda");
    await expect(leg).toContainText("reais de cada época");
    await expect(leg).toContainText("reais de hoje");
    await expect(leg).toContainText("8 em 10 cenários");
    expect(await page.locator(".tela-renda canvas").count()).toBe(0);
  });

  test("guardrails: quatro linhas na ordem +20%, hoje, −20%, −35%, em reais", async ({ page }) => {
    await autenticar(page);
    await abrirRenda(page);
    const { fmt } = await renda(page);
    const tb = page.locator(".renda-guardrails tbody");
    await expect(tb).toHaveCount(4);
    const rotulos = ["subir 20%", "Hoje", "cair 20%", "cair 35%"];
    for (let i = 0; i < 4; i++) {
      const t = norm(await tb.nth(i).textContent());
      expect(t).toContain(rotulos[i]);
      expect(t).toContain(norm(`${fmt.guard[i].mensal} por mês`));
      expect(t).toContain(norm(fmt.guard[i].pat));
    }
  });

  test("herança: mediana aos 95 na frase; pisos com a linha configurada destacada", async ({ page }) => {
    await autenticar(page);
    await abrirRenda(page);
    const { r, fmt } = await renda(page);
    expect(norm(await page.locator(".renda-heranca").textContent())).toContain(norm(`sobrariam ${fmt.mediana} aos ${r.premissas.idade_horizonte}`));
    const tb = page.locator(".renda-pisos tbody");
    await expect(tb).toHaveCount(r.heranca.pisos.length);
    const atual = page.locator(".renda-pisos tbody[aria-current='true']");
    await expect(atual).toHaveCount(1);
    const i = r.heranca.pisos.findIndex((p: any) => p.configurado);
    expect(norm(await atual.textContent())).toContain(norm(`${fmt.pisos[i].mensal} por mês`));
    await expect(atual).toContainText("o seu piso");
  });

  test("piso configurado de 7 dígitos (variante zero): a linha dele é a destacada", async ({ page }) => {
    await autenticar(page, ZERO);
    await abrirRenda(page);
    const { r, fmt } = await renda(page);
    const i = r.heranca.pisos.findIndex((p: any) => p.configurado);
    expect(r.heranca.pisos[i].piso).toBeGreaterThanOrEqual(1_000_000);
    expect(norm(await page.locator(".renda-pisos tbody[aria-current='true']").textContent())).toContain(norm(fmt.pisos[i].piso));
  });

  test("notas do rodapé: IR, fonte do payload, premissas de hoje, US$ 60 mil, motivação", async ({ page }) => {
    await autenticar(page);
    await abrirRenda(page);
    const { r } = await renda(page);
    const n = page.locator(".renda-notas");
    await expect(n).toContainText("antes do IR sobre vendas");
    await expect(n).toContainText(r.premissas.fonte.nome);
    await expect(n).toContainText("premissas de hoje");
    await expect(n).toContainText("US$ 60 mil");
    await expect(n).toContainText("motivação, não plano de saque");
  });

  test("links cruzados: a projeção aponta para a renda e a renda para a projeção", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#/raiox/projecao");
    const ida = page.locator(".tela-projecao a[href='#/raiox/renda']");
    await expect(ida).toBeVisible();
    await ida.click();
    await expect(page).toHaveURL(/#\/raiox\/renda$/);
    const volta = page.locator(".tela-renda a[href='#/raiox/projecao']");
    await expect(volta).toBeVisible();
    await volta.click();
    await expect(page).toHaveURL(/#\/raiox\/projecao$/);
  });

  // Board 7a.BJ.2 (iteração 1): o getter só exige o que o template lê — o
  // choque 0 (régua dos pisos) e os booleanos —, não a cardinalidade do backend.
  test("guardrails com outra quantidade (3, com o choque 0): a tela publica, uma linha por choque", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page);
    await page.evaluate(() => { const d = (window as any).Alpine.$data(document.body); d.json = { ...d.json, renda: { ...d.json.renda, guardrails: d.json.renda.guardrails.slice(0, 3) } }; });
    await page.goto("/#/raiox/renda");
    await expect(page.locator(".renda-guardrails tbody")).toHaveCount(3);
    expect(erros).toEqual([]);
  });

  for (const [nome, muta] of [
    ["sem proventos_cobrem", "r.hoje = { ...r.hoje }; delete r.hoje.proventos_cobrem"],
    ["configurado não-booleano", "r.heranca = { ...r.heranca, pisos: r.heranca.pisos.map((p) => ({ ...p, configurado: 'sim' })) }"],
    ["sem o choque 0", "r.guardrails = r.guardrails.filter((g) => g.choque !== 0)"],
  ] as const) {
    test(`bloco parcial (${nome}): indisponível, card ausente, nenhum erro`, async ({ page }) => {
      const erros = coletarErros(page);
      await autenticar(page);
      await page.evaluate((m) => {
        const d = (window as any).Alpine.$data(document.body);
        const r = { ...d.json.renda };
        new Function("r", m)(r);
        d.json = { ...d.json, renda: r };
      }, muta);
      await expect(page.locator(".renda-card-home")).toBeHidden();
      await page.goto("/#/raiox/renda");
      await expect(page.locator(".tela-renda")).toContainText("Renda indisponível hoje.");
      expect(erros).toEqual([]);
    });
  }

  test("histórico de 1 ponto e projeção vazia: publica sem erro, sem NaN, a tabela diz que não há idade futura", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page);
    await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      const r = d.json.renda;
      d.json = { ...d.json, renda: { ...r, historico: r.historico.slice(-1), projecao: [], hoje: { ...r.hoje, variacao_12m_mensal: null } } };
    });
    await abrirRenda(page);
    await expect(page.locator(".renda-heroi")).toBeVisible();
    await expect(page.locator(".renda-cresce")).toContainText("Não há idade futura para a tabela.");
    await expect(page.locator(".renda-marcos")).toBeHidden();
    const attrs = await page.evaluate(() => Array.from(document.querySelectorAll(".renda-grafico path, .renda-grafico polygon"))
      .map((el) => (el.getAttribute("d") || "") + (el.getAttribute("points") || "")).join(" "));
    expect(attrs).not.toMatch(/NaN|Infinity/);
    expect(erros).toEqual([]);
  });

  test("bloco parcial (sem heranca): indisponível, card ausente, nenhum erro", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page);
    await page.evaluate(() => { const d = (window as any).Alpine.$data(document.body); d.json = { ...d.json, renda: { ...d.json.renda, heranca: undefined } }; });
    await expect(page.locator(".renda-card-home")).toBeHidden();
    await page.goto("/#/raiox/renda");
    await expect(page.locator(".tela-renda")).toContainText("Renda indisponível hoje.");
    expect(erros).toEqual([]);
  });
});

test.describe("7a.BJ.2 — 320 px e Modo Plantão", () => {
  for (const [nome, corpo] of [["normal", PRINCIPAL], ["zero", ZERO], ["cobrem", COBREM]] as const) {
    test(`a 320 px (${nome}): sem rolagem horizontal e folga ≥ 8 px entre rótulo e valor nas tabelas`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 800 });
      await autenticar(page, corpo);
      await abrirRenda(page);
      const r = await page.evaluate(() => {
        const texto = (el: Element) => { const rg = document.createRange(); rg.selectNodeContents(el); return rg.getBoundingClientRect(); };
        const folgas: { linha: string; folga: number }[] = [];
        for (const tr of Array.from(document.querySelectorAll(".renda-ensaio table tr.renda-linha"))) {
          const th = tr.querySelector("th"), td = tr.querySelector("td");
          if (!th || !td) continue;
          const a = texto(th), b = texto(td);
          const mesma = a.top < b.bottom && b.top < a.bottom;
          folgas.push({ linha: norm(tr.textContent), folga: mesma ? b.left - a.right : 999 });
        }
        function norm(s: string | null) { return (s || "").replace(/\s+/g, " ").trim(); }
        const tela = document.querySelector(".tela-renda")!.getBoundingClientRect();
        const fora = Array.from(document.querySelectorAll(".renda-ensaio *"))
          .filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.right > tela.right + 0.5; })
          .map((el) => el.className);
        return { folgas, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, fora };
      });
      expect(r.sw).toBeLessThanOrEqual(r.cw);
      expect(r.fora).toEqual([]);
      expect(r.folgas.length).toBeGreaterThanOrEqual(8);
      for (const f of r.folgas) expect(f.folga, f.linha).toBeGreaterThanOrEqual(8);
    });
  }

  test("Modo Plantão: linha do passado, mediana e herói leem os tokens escuros", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("tema", "dark"));
    await autenticar(page);
    await abrirRenda(page);
    const r = await page.evaluate(() => {
      const cor = (v: string) => { const s = document.createElement("span"); s.style.color = `var(${v})`; document.body.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c; };
      const q = (s: string) => document.querySelector(s)!;
      return {
        tema: document.documentElement.getAttribute("data-theme"),
        ink: cor("--ink"), g700: cor("--g-700"), g900: cor("--g-900"),
        passado: getComputedStyle(q(".renda-grafico__passado")).stroke,
        mediana: getComputedStyle(q(".renda-grafico__mediana")).stroke,
        heroi: getComputedStyle(q(".renda-heroi")).color,
      };
    });
    expect(r.tema).toBe("dark");
    expect(r.passado).toBe(r.ink);
    expect(r.mediana).toBe(r.g700);
    expect(r.heroi).toBe(r.g900);
  });
});
