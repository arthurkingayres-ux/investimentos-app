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

// 7a.AX: coletor de erros Alpine. O Alpine ENGOLE erro de expressão em x-if
// (vira "falso"), então uma mutação que quebra um guard ficaria verde sem isto.
function coletarErros(page: Page) {
  const erros: string[] = [];
  page.on("pageerror", (e) => erros.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error" || m.text().includes("Alpine Expression Error")) erros.push(m.type() + ": " + m.text());
  });
  return erros;
}

// Retângulos que se sobrepõem de verdade (área > 0), para testes de colisão.
function sobrepoe(a: { l: number; r: number; t: number; b: number }, b: { l: number; r: number; t: number; b: number }) {
  return a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
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
    await abrirProjecao(page);
    await expect(page.locator(".proj-faixas__linha")).toHaveCount(3);
    await expect(page.locator('.proj-faixas__linha[data-id="twr"]')).toHaveCount(0);
    await expect(page.locator(".proj-decomp__item")).toHaveCount(1);
    const efeitos = page.locator(".proj-ponteiro__item").first().locator(".proj-ponteiro__ancora");
    expect(await efeitos.allInnerTexts()).toEqual(["Retorno do seu dinheiro"]);
  });
});

test.describe("Projeção como ensaio — capítulos 4 a 6", () => {
  test("decomposição com rendimento negativo: só as parcelas positivas na barra, a negativa em texto (Review Focus 1 da 7a.AW)", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page);
    await abrirProjecao(page);
    await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body).json.projecao.cenarios[0].decomposicao;
      d.rendimento_aportes = -50000;
    });
    const item = page.locator('.proj-decomp__item[data-id="twr"]');
    await expect(item.locator(".proj-decomp__seg")).toHaveCount(2);
    await expect(page.locator(".proj-tabela--decomp")).toContainText("−R$ 50 mil");
    expect(erros).toEqual([]);
  });

  test("ponteiro em lista: 5 alavancas na ordem, descrição só nos cenários, uma linha por âncora com nome e Δ", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const cap = page.locator('.proj-cap[data-cap="5"]');
    await expect(cap.locator("table")).toHaveCount(0);                // nada de cabeçalho de coluna
    const itens = cap.locator(".proj-ponteiro__item");
    await expect(itens).toHaveCount(5);
    expect(await cap.locator(".proj-ponteiro__nome").allInnerTexts()).toEqual([
      "+R$ 1.000/mês de aporte", "+1 p.p. de retorno real", "Década inicial fraca", "Real forte", "Aporte pela metade"]);
    for (const [i, it] of (await itens.all()).entries()) {
      await expect(it.locator(".proj-ponteiro__desc")).toHaveCount(i < 2 ? 0 : 1);
      expect(await it.locator(".proj-ponteiro__ancora").allInnerTexts()).toEqual(["Retorno da carteira", "Retorno do seu dinheiro"]);
      for (const d of await it.locator(".proj-delta").allInnerTexts()) expect(d).toContain(i < 2 ? "+R$" : "−R$");
      for (const seta of await it.locator(".proj-delta > span[aria-hidden='true']").all()) await expect(seta).toHaveText(i < 2 ? "▲" : "▼");
    }
    const txt = (await page.locator(".tela-projecao").innerText()).toLowerCase();
    for (const v of ["aporte mais", "compre", "venda ", "invista mais"]) expect(txt).not.toContain(v);
  });

  test("ponteiro a 320 px: nome da âncora e Δ na mesma linha, com folga, dentro do capítulo", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await autenticar(page);
    await abrirProjecao(page);
    const r = await page.evaluate(() => {
      const cap = document.querySelector('.proj-cap[data-cap="5"]')!.getBoundingClientRect();
      return Array.from(document.querySelectorAll(".proj-ponteiro__efeito")).map((e) => {
        const n = e.querySelector(".proj-ponteiro__ancora")!.getBoundingClientRect();
        const d = e.querySelector(".proj-delta")!.getBoundingClientRect();
        return { folga: d.left - n.right, mesma: n.top < d.bottom && d.top < n.bottom, dentro: d.right <= cap.right + 0.5 };
      });
    });
    expect(r).toHaveLength(10);
    for (const e of r) { expect(e.mesma).toBe(true); expect(e.folga).toBeGreaterThanOrEqual(8); expect(e.dentro).toBe(true); }
  });

  test("capítulo 6 e o rodapé", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const cap = page.locator('.proj-cap[data-cap="6"]');
    for (const t of ["Impostos e custos", "o viés é para cima", "Aporte que cresce com a renda"]) await expect(cap).toContainText(t);
    await expect(page.locator(".proj-rodape")).toHaveText("10.000 trajetórias · recalculada toda noite · projeção, não promessa");
  });

});

test.describe("Projeção como ensaio (7a.AW.2) — capítulos 0 a 3", () => {
  test("seis capítulos na ordem, cada um com ordinal e título, e o 4 sem número-tema", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const titulos = await page.locator(".proj-cap .proj-cap__titulo").allInnerTexts();
    expect(titulos).toEqual([
      "De onde você parte", "Quanto você aporta", "Quanto a carteira rende: quatro leituras",
      "O que isso dá aos 65", "O que mexe o ponteiro", "O que esta conta não inclui",
    ]);
    expect(await page.locator(".proj-cap .proj-cap__ordinal").allInnerTexts()).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(await page.locator(".proj-cap").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.cap))).toEqual(["1", "2", "3", "4", "5", "6"]);
    await expect(page.locator('.proj-cap[data-cap="4"] .proj-cap__tema')).toHaveCount(0);
  });

  test("o ordinal é tipografia de título e o número-tema é tabular", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const r = await page.evaluate(() => {
      const ord = document.querySelector(".proj-cap__ordinal")!;
      const tema = document.querySelector(".proj-cap__tema")!;
      const cs = (e: Element) => getComputedStyle(e);
      return { ordNum: cs(ord).fontVariantNumeric, temaNum: cs(tema).fontVariantNumeric,
               temaFam: cs(tema).fontFamily, temaPeso: cs(tema).fontWeight };
    });
    expect(r.temaNum).toContain("tabular-nums");
    expect(r.ordNum).not.toContain("tabular-nums");
    expect(/monospace/i.test(r.temaFam)).toBe(false);
    expect(r.temaPeso).toBe("700");
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
        .filter((el) => !el.classList.contains("proj-faixa") && !el.closest(".proj-resposta__valores")
          && (el as HTMLElement).offsetParent !== null
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

  test("âncora ausente: 'indisponível hoje' no capítulo 3, três barras, sem grifo", async ({ page }) => {
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
    await expect(page.locator(".proj-taxas__linha")).toHaveCount(3);
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

  test("320 px com todos os 'ver a conta' abertos: nada passa do retângulo do próprio capítulo", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await autenticar(page);
    await abrirProjecao(page);
    await page.evaluate(() => document.querySelectorAll(".tela-projecao details").forEach((d) => ((d as HTMLDetailsElement).open = true)));
    const r = await page.evaluate(() => {
      // Pelo retângulo de CADA capítulo, não só pela rolagem da página: uma peça
      // larga demais sobra para o respiro lateral sem gerar rolagem (7a.AW.2).
      // Nós sr-only ficam de fora (1 px de caixa, conteúdo transbordando por desenho).
      const ensaio = document.querySelector(".proj-ensaio")!.getBoundingClientRect();
      const blocos = [document.querySelector(".proj-resposta")!, ...Array.from(document.querySelectorAll(".proj-cap"))];
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
    expect(r.blocos).toBe(7);                     // a abertura + os seis capítulos
    expect(r.sw).toBeLessThanOrEqual(r.cw);
    expect(r.fora).toEqual([]);
  });

  test("a 320 px, os cabeçalhos de coluna das tabelas não encostam (folga ≥ 6 px entre os textos)", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await autenticar(page);
    await abrirProjecao(page);
    await page.evaluate(() => document.querySelectorAll(".tela-projecao details").forEach((d) => ((d as HTMLDetailsElement).open = true)));
    const r = await page.evaluate(() => {
      // Caixa do TEXTO de cada célula (Range), não a da célula: células vizinhas
      // sempre se tocam; o defeito é o texto de uma colar no da outra.
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
    expect(r.length).toBeGreaterThanOrEqual(2);          // decomp + percentis; vazio passaria por vacuidade
    for (const f of r) expect(f.folga, f.tabela).toBeGreaterThanOrEqual(6);
  });

  test("Modo Plantão: barras e pontos usam os tokens escuros", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("tema", "dark"));
    await autenticar(page);
    await abrirProjecao(page);
    const r = await page.evaluate(() => {
      const cor = (v: string) => { const s = document.createElement("span"); s.style.color = `var(${v})`; document.body.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c; };
      const bg = (sel: string) => getComputedStyle(document.querySelector(sel)!).backgroundColor;
      return {
        tema: document.documentElement.getAttribute("data-theme"),
        g700: cor("--g-700"), ink: cor("--ink"), n300: cor("--neutral-300"),
        barraTaxa: bg(".proj-taxas__barra--ancora"), barraFaixa: bg(".proj-faixas__barra"),
        pontoAncora: bg('.proj-faixas__linha--ancora .proj-faixas__ponto'),
        pontoMercado: bg('.proj-faixas__linha--comparacao .proj-faixas__ponto'),
      };
    });
    expect(r.tema).toBe("dark");
    expect(r.g700).toBe("rgb(52, 211, 153)");      // o --g-700 do Plantão (#34d399), não o claro (#047857)
    expect(r.barraTaxa).toBe(r.g700);
    expect(r.barraFaixa).toBe(r.g700);
    expect(r.pontoAncora).toBe(r.ink);
    expect(r.pontoMercado).toBe(r.n300);
  });
});

test.describe("Refinamento da projeção (7a.AX) — tipografia", () => {
  test("só os dois valores da frase-resposta usam a fonte mono", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    await page.evaluate(() => document.querySelectorAll(".proj-ensaio details").forEach((d) => ((d as HTMLDetailsElement).open = true)));
    const r = await page.evaluate(() => {
      const comTexto = Array.from(document.querySelectorAll(".proj-ensaio *")).filter((el) => {
        const h = el as HTMLElement;
        return h.offsetParent !== null
          && Array.from(h.childNodes).some((n) => n.nodeType === 3 && (n.textContent || "").trim() !== "");
      });
      const mono = comTexto.filter((el) => /monospace/i.test(getComputedStyle(el).fontFamily));
      return { total: comTexto.length, mono: mono.map((el) => el.className) };
    });
    expect(r.total).toBeGreaterThan(50);                // sem nós, a comparação abaixo passaria por vacuidade
    expect(r.mono).toEqual(["proj-faixa", "proj-faixa"]);
  });

  test("unidades e conectivos: fonte do texto, mesmo corpo do número, peso 400, cinza", async ({ page }) => {
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
      const faixa = document.querySelector(".proj-resposta .proj-faixa")!;
      return {
        cinza,
        itens: els.map((el) => {
          const cs = getComputedStyle(el);
          // O "número que ele liga": na abertura, o .proj-faixa; no resto, o pai (o número herda o corpo dele).
          const ref = el.closest(".proj-resposta") ? faixa : el.parentElement!;
          const numsIrmaos = Array.from(el.parentElement!.querySelectorAll(":scope > .proj-num"))
            .map((n) => getComputedStyle(n).fontSize);
          return { txt: (el.textContent || "").trim(), fam: cs.fontFamily, peso: cs.fontWeight, cor: cs.color,
                   corpo: cs.fontSize, corpoRef: getComputedStyle(ref).fontSize, numsIrmaos };
        }),
      };
    });
    expect(r.itens.length).toBeGreaterThanOrEqual(8);   // abertura "e" + temas + taxas das 4 leituras + faixas
    for (const i of r.itens) {
      expect(/monospace/i.test(i.fam), i.txt).toBe(false);
      expect(i.peso, i.txt).toBe("400");
      expect(i.cor, i.txt).toBe(r.cinza);
      expect(i.corpo, i.txt).toBe(i.corpoRef);
      for (const n of i.numsIrmaos) expect(n, i.txt).toBe(i.corpo);
    }
  });

  // 800 px: largura em que os dois valores CABEM, e então ficam na mesma linha.
  // 320 px: não cabem, e a quebra cai depois do "e". (A 390 px, com --num-xl mono,
  // os valores reais também não cabem numa linha: ~19 caracteres × ~18 px > ~300 px
  // de conteúdo. É o "quando cabem" da spec §3.2, não um defeito.)
  for (const w of [800, 320]) {
    test(`abertura a ${w}px: o 'e' fica na linha do primeiro valor`, async ({ page }) => {
      const erros = coletarErros(page);
      await page.setViewportSize({ width: w, height: 800 });
      await autenticar(page);
      await abrirProjecao(page);
      const linha = () => page.evaluate(() => {
        const [a, b] = Array.from(document.querySelectorAll(".proj-resposta .proj-faixa")).map((e) => e.getBoundingClientRect());
        const e = document.querySelector(".proj-resposta .proj-conectivo")!.getBoundingClientRect();
        // Mesma linha = centros verticais a menos de meia altura (a menor). Sobreposição
        // simples aceitava o ~1 px que o line-height deixa entre linhas vizinhas (medido).
        const mesma = (x: DOMRect, y: DOMRect) => Math.abs((x.top + x.bottom) / 2 - (y.top + y.bottom) / 2) < Math.min(x.height, y.height) / 2;
        return { eComA: mesma(a, e), bComA: mesma(a, b) };
      });
      const r = await linha();
      expect(r.eComA).toBe(true);
      if (w === 800) expect(r.bComA).toBe(true);        // cabem: mesma linha
      // Valores largos forçam a quebra: ela tem de cair DEPOIS do "e".
      await page.evaluate(() => {
        const cs = (window as any).Alpine.$data(document.body).json.projecao.cenarios;
        cs.find((c: any) => c.id === "twr").final.p50 = 8_800_000;
        cs.find((c: any) => c.id === "xirr").final.p50 = 999_900_000;
      });
      await expect(page.locator(".proj-resposta .proj-faixa").last()).toHaveText("R$ 999,9 mi");
      const r2 = await linha();
      expect(r2.eComA).toBe(true);
      if (w === 320) expect(r2.bComA).toBe(false);      // prova de que a quebra aconteceu (senão o teste é vácuo)
      expect(erros).toEqual([]);
    });
  }
});

test.describe("Refinamento da projeção (7a.AX) — barras de taxa", () => {
  const medirTaxas = (page: Page) => page.evaluate(() => {
    const a = (window as any).Alpine.$data(document.body);
    const box = (el: Element) => { const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width }; };
    const cap = box(document.querySelector('.proj-cap[data-cap="3"]')!);
    const linhas = Array.from(document.querySelectorAll(".proj-taxas__linha")).map((li) => ({
      id: (li as HTMLElement).dataset.id!,
      nome: li.querySelector(".proj-taxas__nome")!.textContent!.trim(),
      valor: li.querySelector(".proj-taxas__valor")!.textContent!.trim(),
      bNome: box(li.querySelector(".proj-taxas__nome")!), bTrilho: box(li.querySelector(".proj-taxas__trilho")!),
      bBarra: box(li.querySelector(".proj-taxas__barra")!), bValor: box(li.querySelector(".proj-taxas__valor")!),
      zeroX: li.querySelector(".proj-taxas__zero")!.getBoundingClientRect().left,
    }));
    const rot = document.querySelector(".proj-taxas__zero-rot");
    return {
      cap, linhas, zeroRot: rot ? rot.textContent!.trim() : null, bZeroRot: rot ? box(rot) : null,
      taxas: Object.fromEntries(a.projCenarios().map((c: any) => [c.id, c.taxa_real])),
      fmt: Object.fromEntries(a.projCenarios().map((c: any) => [c.id, a.projFmtTaxa(c.taxa_real)])),
    };
  });

  for (const w of [390, 320]) {
    test(`a ${w}px: uma linha por leitura na ordem, nome acima, comprimento proporcional, zero marcado, tudo dentro`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 800 });
      const erros = coletarErros(page);
      await autenticar(page);
      await abrirProjecao(page);
      const r = await medirTaxas(page);
      expect(r.linhas.map((l) => l.nome)).toEqual(NOMES);
      const max = Math.max(...Object.values(r.taxas) as number[]);
      for (const l of r.linhas) {
        expect(l.bNome.b, l.id).toBeLessThanOrEqual(l.bTrilho.t + 0.5);              // rótulo em linha própria
        expect(l.valor, l.id).toBe(r.fmt[l.id]);
        expect(Math.abs(l.bBarra.l - l.zeroX), l.id).toBeLessThanOrEqual(1);        // começa no zero
        expect(Math.abs(l.bBarra.w - l.bTrilho.w * r.taxas[l.id] / max), l.id).toBeLessThanOrEqual(1);
        expect(sobrepoe(l.bValor, l.bBarra), l.id).toBe(false);
        for (const b of [l.bNome, l.bTrilho, l.bBarra, l.bValor]) {
          expect(b.l, l.id).toBeGreaterThanOrEqual(r.cap.l - 0.5);
          expect(b.r, l.id).toBeLessThanOrEqual(r.cap.r + 0.5);
        }
      }
      expect(r.zeroRot).toBe("0%");
      expect(r.bZeroRot!.l).toBeGreaterThanOrEqual(r.cap.l - 0.5);
      expect(erros).toEqual([]);
    });
  }

  test("taxa negativa a 320 px: barra à esquerda do zero, valor com sinal à esquerda dela, tudo dentro", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    const erros = coletarErros(page);
    await autenticar(page);
    await abrirProjecao(page);
    await page.evaluate(() => { (window as any).Alpine.$data(document.body).json.projecao.cenarios.find((c: any) => c.id === "twr").taxa_real = -0.012; });
    await expect(page.locator(".proj-taxas--negativa")).toHaveCount(1);
    const r = await medirTaxas(page);
    expect(r.linhas).toHaveLength(4);
    const twr = r.linhas.find((l) => l.id === "twr")!;
    expect(twr.valor).toMatch(/^[−-]1,20%$/);
    expect(Math.abs(twr.bBarra.r - twr.zeroX)).toBeLessThanOrEqual(1);           // termina no zero
    expect(twr.bBarra.l).toBeLessThan(twr.zeroX - 5);                            // desenha para a esquerda
    expect(twr.bValor.r).toBeLessThanOrEqual(twr.bBarra.l + 0.5);                // valor à esquerda da ponta
    for (const l of r.linhas) {
      expect(sobrepoe(l.bValor, l.bBarra), l.id).toBe(false);
      for (const b of [l.bValor, l.bBarra]) {
        expect(b.l, l.id).toBeGreaterThanOrEqual(r.cap.l - 0.5);
        expect(b.r, l.id).toBeLessThanOrEqual(r.cap.r + 0.5);
      }
    }
    expect(erros).toEqual([]);
  });
});

async function geometriaFaixas(page: Page) {
  return page.evaluate(() => {
    const a = (window as any).Alpine.$data(document.body);
    const f = a.projFaixas();
    const box = (el: Element | null) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { l: b.left, r: b.right, t: b.top, b: b.bottom, cx: b.left + b.width / 2, w: b.width };
    };
    const linhas = Array.from(document.querySelectorAll(".proj-faixas__linha")).map((li) => {
      const id = (li as HTMLElement).dataset.id!;
      const c = a.projCenario(id);
      const txt = (s: string) => li.querySelector(s)!.textContent!.replace(/\s+/g, " ").trim();
      return {
        id, papel: c.papel, final: { ...c.final }, valorEsperado: a.projValorFinal(c),
        nome: txt(".proj-faixas__nome"), valores: txt(".proj-faixas__valores"),
        valoresNoImg: !!li.querySelector(".proj-faixas__valores")!.closest('[role="img"]'),
        label: li.querySelector('[role="img"]')!.getAttribute("aria-label") || "",
        nome_: box(li.querySelector(".proj-faixas__nome")), trilho: box(li.querySelector(".proj-faixas__trilho"))!,
        valores_: box(li.querySelector(".proj-faixas__valores")),
        traco: box(li.querySelector(".proj-faixas__traco")), barra: box(li.querySelector(".proj-faixas__barra")),
        ponto: box(li.querySelector(".proj-faixas__ponto")),
        fmt: Object.fromEntries(["p10", "p25", "p50", "p75", "p90", "deterministico"].map((k) => [k, a.formatBrlCompacto(c.final[k])])),
        fmtValor: a.formatBrlCompacto(a.projValorFinal(c)),
        fmtTaxa: a.projFmtTaxa(c.taxa_real),
      };
    });
    return { max: f.max, fmtMax: a.formatBrlCompacto(f.max), linhas,
      eixo: Array.from(document.querySelectorAll(".proj-faixas__eixo span")).map((s) => s.textContent!.trim()) };
  });
}

test.describe("Refinamento da projeção (7a.AX) — gráfico de faixas", () => {
  test("uma linha por leitura: âncoras com traço, barra e ponto; mercado só ponto; eixo de R$ 0 ao teto", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const g = await geometriaFaixas(page);
    expect(g.linhas.map((l) => l.id)).toEqual(["twr", "xirr", "mercado_simples", "mercado_rebalanceado"]);
    for (const [i, l] of g.linhas.entries()) {
      expect(l.nome).toBe(NOMES[i] + " · " + l.fmtTaxa + " ao ano");
      expect(l.ponto, l.id).not.toBeNull();
      if (l.papel === "ancora") { expect(l.traco, l.id).not.toBeNull(); expect(l.barra, l.id).not.toBeNull(); }
      else { expect(l.traco, l.id).toBeNull(); expect(l.barra, l.id).toBeNull(); }
      const desenhados = l.papel === "ancora" ? [l.final.p90, l.valorEsperado] : [l.valorEsperado];
      for (const v of desenhados) expect(g.max, l.id).toBeGreaterThanOrEqual(v);
    }
    expect(g.eixo).toEqual(["R$ 0", g.fmtMax]);
    // O teto é "redondo": o maior desenhado da fixture é o p90 do XIRR (~4,23 mi),
    // que a escada leva a 5 mi. Sem este valor fixo, uma escada quebrada que
    // devolvesse o máximo cru passaria (o rótulo do eixo se auto-referencia). G2.
    expect(g.max).toBe(5_000_000);
  });

  test("posição proporcional ao valor, conferida por coordenada", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const g = await geometriaFaixas(page);
    expect(g.linhas).toHaveLength(4);
    const x = (l: any, v: number) => l.trilho.l + l.trilho.w * (v / g.max);
    for (const l of g.linhas) {
      expect(Math.abs(l.ponto!.cx - x(l, l.valorEsperado)), l.id).toBeLessThanOrEqual(1);
      if (l.papel !== "ancora") continue;
      expect(Math.abs(l.traco!.l - x(l, l.final.p10)), l.id).toBeLessThanOrEqual(1);
      expect(Math.abs(l.traco!.r - x(l, l.final.p90)), l.id).toBeLessThanOrEqual(1);
      expect(Math.abs(l.barra!.l - x(l, l.final.p25)), l.id).toBeLessThanOrEqual(1);
      expect(Math.abs(l.barra!.r - x(l, l.final.p75)), l.id).toBeLessThanOrEqual(1);
    }
  });

  test("sem a âncora XIRR e com o mercado acima do maior p90: todo ponto e faixa dentro do eixo, na posição certa", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page);
    await abrirProjecao(page);
    await page.evaluate(() => {
      const p = (window as any).Alpine.$data(document.body).json.projecao;
      p.cenarios.splice(p.cenarios.findIndex((c: any) => c.id === "xirr"), 1);
      p.cenarios.find((c: any) => c.id === "mercado_rebalanceado").final.p50 = 5_000_000;
    });
    await expect(page.locator(".proj-faixas__linha")).toHaveCount(3);
    const g = await geometriaFaixas(page);
    const twr = g.linhas.find((l) => l.id === "twr")!;
    expect(twr.final.p90).toBeLessThan(5_000_000);            // premissa do cenário: o mercado passa do maior p90
    expect(g.max).toBeGreaterThanOrEqual(5_000_000);
    // 5 mi é teto exato (projEixoTeto(5e6) = 5e6), então o ponto do mercado cai em
    // 100% do eixo: é o único estado que exerce o recuo de 7 px do trilho. A caixa
    // do ponto (12 px, centrada) tem de ficar dentro do capítulo (G2 da 7a.AX).
    const cap = await page.locator('.proj-cap[data-cap="4"]').evaluate((e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right }; });
    const reb = g.linhas.find((l) => l.id === "mercado_rebalanceado")!;
    expect(Math.abs(reb.ponto!.cx - reb.trilho.r)).toBeLessThanOrEqual(1); // premissa: ponto em 100%
    for (const l of g.linhas) {
      expect(l.ponto!.l, l.id).toBeGreaterThanOrEqual(cap.l - 0.5);
      expect(l.ponto!.r, l.id).toBeLessThanOrEqual(cap.r + 0.5);
    }
    for (const l of g.linhas) {
      for (const b of [l.traco, l.barra].filter(Boolean) as any[]) {
        expect(b.l, l.id).toBeGreaterThanOrEqual(l.trilho.l - 0.5);
        expect(b.r, l.id).toBeLessThanOrEqual(l.trilho.r + 0.5);
      }
      expect(l.ponto!.cx, l.id).toBeGreaterThanOrEqual(l.trilho.l - 0.5);
      expect(l.ponto!.cx, l.id).toBeLessThanOrEqual(l.trilho.r + 0.5);
      expect(Math.abs(l.ponto!.cx - (l.trilho.l + l.trilho.w * l.valorEsperado / g.max)), l.id).toBeLessThanOrEqual(1);
    }
    expect(erros).toEqual([]);
  });

  test("a 320 px: valores escritos em linha própria, fora do role=img, iguais ao payload, sem sobreposição", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await autenticar(page);
    await abrirProjecao(page);
    const g = await geometriaFaixas(page);
    expect(g.linhas).toHaveLength(4);
    const caixas: any[] = [];
    for (const l of g.linhas) {
      if (l.papel === "ancora") expect(l.valores).toBe(`mediana ${l.fmt.p50}; 8 em 10 entre ${l.fmt.p10} e ${l.fmt.p90}`);
      else expect(l.valores).toBe(l.fmtValor);
      expect(l.valoresNoImg, l.id).toBe(false);
      expect(l.nome_!.b, l.id).toBeLessThanOrEqual(l.trilho.t + 0.5);
      expect(l.trilho.b, l.id).toBeLessThanOrEqual(l.valores_!.t + 0.5);
      caixas.push(l.nome_, l.trilho, l.valores_);
    }
    expect(caixas).toHaveLength(12);
    for (let i = 0; i < caixas.length; i++)
      for (let j = i + 1; j < caixas.length; j++) expect(sobrepoe(caixas[i], caixas[j]), `${i}x${j}`).toBe(false);
  });

  test("aria-label de cada linha: os cinco percentis nas âncoras, o valor no mercado", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const g = await geometriaFaixas(page);
    expect(g.linhas).toHaveLength(4);
    for (const l of g.linhas) {
      expect(l.label, l.id).toContain(NOMES[g.linhas.indexOf(l)]);
      const esperados = l.papel === "ancora" ? ["p10", "p25", "p50", "p75", "p90"].map((k) => l.fmt[k]) : [l.fmtValor];
      for (const v of esperados) expect(l.label, l.id + " " + v).toContain(v);
    }
  });

  test("faixa degenerada ou mediana fora dela: só o ponto, sem erro", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page);
    await abrirProjecao(page);
    await page.evaluate(() => {
      const cs = (window as any).Alpine.$data(document.body).json.projecao.cenarios;
      const t = cs.find((c: any) => c.id === "twr").final;
      t.p10 = t.p25 = t.p75 = t.p90 = t.p50;                 // vol zero
      const x = cs.find((c: any) => c.id === "xirr").final;
      x.p10 = x.p50 * 1.1;                                     // mediana abaixo do p10
    });
    await expect(page.locator('.proj-faixas__linha[data-id="twr"] .proj-faixas__traco')).toHaveCount(0);
    const g = await geometriaFaixas(page);
    for (const id of ["twr", "xirr"]) {
      const l = g.linhas.find((x) => x.id === id)!;
      expect(l.traco, id).toBeNull();
      expect(l.barra, id).toBeNull();
      expect(l.ponto, id).not.toBeNull();
      expect(l.valores, id).toBe(`mediana ${l.fmt.p50}`);
    }
    expect(erros).toEqual([]);
  });

  test("legenda uma vez, em texto, e o 'ver a conta' com os cinco percentis de cada âncora", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const cap = page.locator('.proj-cap[data-cap="4"]');
    await expect(cap.locator(".proj-faixas__legenda")).toHaveCount(1);
    await expect(cap.locator(".proj-faixas__legenda")).toHaveText("Traço fino: 8 em 10 trajetórias. Barra: metade delas. Ponto: a mediana.");
    const conta = cap.locator("details.proj-conta--percentis");
    await expect(conta).not.toHaveAttribute("open", "");
    await conta.locator("summary").click();
    const t = conta.locator(".proj-tabela--percentis");
    expect((await t.locator("thead th").allInnerTexts()).slice(1)).toEqual(["Retorno da carteira", "Retorno do seu dinheiro"]);
    await expect(t.locator("tbody tr")).toHaveCount(5);
    const g = await geometriaFaixas(page);
    const linhas = await t.locator("tbody tr").allInnerTexts();
    for (const [i, k] of ["p10", "p25", "p50", "p75", "p90"].entries())
      for (const id of ["twr", "xirr"]) expect(linhas[i], k + id).toContain(g.linhas.find((l) => l.id === id)!.fmt[k]);
  });

  test("a largura das faixas: a oscilação da carteira, o N e a do modelo", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const txt = (await page.locator('.proj-cap[data-cap="4"]').innerText()).replace(/\s+/g, " ");
    expect(txt).toContain("A largura das faixas");
    expect(txt).toContain("A largura vem da oscilação da própria carteira, 12,0% ao ano, medida em 110 meses. O modelo das classes daria 15,0%.");
    expect(txt).toContain("Só as duas leituras do seu histórico têm faixa.");
  });

  test("a rota não monta ECharts", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    await expect(page.locator(".proj-faixas__linha")).toHaveCount(4);
    const r = await page.evaluate(() => {
      const d = (window as any).Alpine.closestDataStack(document.body)[0];
      return {
        canvas: document.querySelectorAll(".tela-projecao canvas").length,
        inst: document.querySelectorAll(".tela-projecao [_echarts_instance_]").length,
        chaves: Object.keys(d).filter((k) => /Proj$/.test(k)),
      };
    });
    expect(r).toEqual({ canvas: 0, inst: 0, chaves: [] });
  });
});

test.describe("Refinamento da projeção (7a.AX) — de onde vem o valor", () => {
  test("uma barra por âncora, alinhadas, com uma legenda comum que é a própria tabela de valores", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const r = await page.evaluate(() => {
      const a = (window as any).Alpine.$data(document.body);
      const itens = Array.from(document.querySelectorAll(".proj-decomp__item")).map((it) => {
        const b = it.querySelector(".proj-decomp__barra")!.getBoundingClientRect();
        return { id: (it as HTMLElement).dataset.id, nome: it.querySelector(".proj-decomp__nome")!.textContent!.trim(),
                 l: b.left, w: b.width, segs: it.querySelectorAll(".proj-decomp__seg").length };
      });
      const t = document.querySelector(".proj-tabela--decomp")!;
      const esperado = a.projAncoras().map((c: any) => [c.decomposicao.partida_crescida, c.decomposicao.aportes, c.decomposicao.rendimento_aportes].map((v: number) => a.formatBrlCompacto(v)));
      return {
        itens,
        cab: Array.from(t.querySelectorAll("thead th")).slice(1).map((th) => th.textContent!.trim()),
        linhas: Array.from(t.querySelectorAll("tbody tr")).map((tr) => ({
          rotulo: tr.querySelector("th")!.textContent!.trim(), marca: !!tr.querySelector("th .proj-decomp__marca"),
          vals: Array.from(tr.querySelectorAll("td")).map((td) => td.textContent!.trim()) })),
        esperado,
        listasAntigas: document.querySelectorAll(".proj-decomp__lista").length,
        pesos: Array.from(t.querySelectorAll("tbody th")).map((th) => getComputedStyle(th).fontWeight),
      };
    });
    expect(r.itens.map((i) => i.nome)).toEqual(["Retorno da carteira", "Retorno do seu dinheiro"]);
    expect(Math.abs(r.itens[0].l - r.itens[1].l)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(r.itens[0].w - r.itens[1].w)).toBeLessThanOrEqual(0.5);
    for (const i of r.itens) expect(i.segs, i.id).toBe(3);
    expect(r.cab).toEqual(["Retorno da carteira", "Retorno do seu dinheiro"]);
    expect(r.linhas.map((l) => l.rotulo)).toEqual(["Seu patrimônio de hoje, crescido", "Aportes somados", "Rendimento dos aportes"]);
    for (const l of r.linhas) expect(l.marca, l.rotulo).toBe(true);
    for (const [j, l] of r.linhas.entries()) expect(l.vals).toEqual(r.esperado.map((col: string[]) => col[j]));
    expect(r.listasAntigas).toBe(0);                                 // uma legenda só
    // Review finding (Important): `.proj-tabela th:first-child { font-weight: 600 }`
    // tem a mesma especificidade que `tbody th` escopado por classe — o rótulo da
    // linha (prosa) não pode renderizar em negrito, só a marca de cor ao lado dele.
    expect(r.pesos).toEqual(["400", "400", "400"]);
  });

  test("a frase determinística e o 'praticamente' ficam sempre visíveis, uma vez por âncora", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const frases = page.locator('.proj-cap[data-cap="4"] .proj-decomp__titulo');
    await expect(frases).toHaveCount(2);
    const r = await page.evaluate(() => {
      const a = (window as any).Alpine.$data(document.body);
      return {
        fora: Array.from(document.querySelectorAll(".proj-decomp__titulo")).every((p) => !p.closest("details")),
        det: a.projAncoras().map((c: any) => a.formatBrlCompacto(c.final.deterministico)),
        prat: a.projAncoras().map((c: any) => a.projPraticamente(c)),
      };
    });
    expect(r.fora).toBe(true);
    for (const [i, f] of (await frases.all()).entries()) {
      await expect(f).toBeVisible();
      await expect(f).toContainText("na taxa constante, sem sorteio, " + r.det[i]);
      await expect(f).toContainText("A mediana da simulação é " + r.prat[i] + "esse mesmo histórico composto");
    }
  });
});
