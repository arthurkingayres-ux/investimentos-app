import { test, expect, Page } from "@playwright/test";
import { fx, autenticar, abrirTela, coletarErros, norm, faceTexto, PROIBIDOS, corDoToken, medirLer, CONTA_ABRE, COMO_LER } from "./diag-comum";

// Fase 7a.BS.2 — capítulo 2 "De onde veio o resultado"
// (#/raiox/diagnostico/politica, spec §6.3 a §6.5). O bloco `atribuicao`
// (schema 2.37) chega pronto do backend; o teste lê o payload decifrado e monta
// o esperado com os formatadores da casa (ponteRoundPy, rent2PctPts, rent2Abs1,
// rent2MmmAa, diagMesAnterior), nunca com os helpers `pol*` da tela, senão o
// teste concordaria com qualquer erro deles. Literal só onde trava copy.
// Fixtures 100% sintéticas (gerar_fixture.py, Task 6 da 7a.BS.2).
const PRINCIPAL = fx("portfolio.test.json.enc");
const NULO = fx("portfolio_atribuicao_null.test.json.enc");
const PARCIAL = fx("portfolio_atribuicao_parcial.test.json.enc");
const DESDE_INDISP = fx("portfolio_atribuicao_desde_indisponivel.test.json.enc");
const SEM_REGISTRO = fx("portfolio_atribuicao_sem_registro.test.json.enc");
const SEM_DOLAR = fx("portfolio_atribuicao_sem_dolar.test.json.enc");
const PRE237 = fx("portfolio_pre_v237.test.json.enc");

const TELA = ".tela-diag-politica";
const JANELAS = ["3a", "5a", "desde"] as const;
const CATS = ["acoes_br", "fiis", "eua", "renda_fixa"];
const CLASSES = ["acoes_br", "fiis", "eua"];
const NOME: Record<string, string> = { acoes_br: "Ações BR", fiis: "FIIs", eua: "EUA", renda_fixa: "Renda Fixa BR" };
const TOKEN: Record<string, string> = { acoes_br: "--cat-acoes-br", fiis: "--cat-fii", eua: "--cat-eua", renda_fixa: "--cat-renda-fixa-br" };
// Termos que só podem morar em "Ver a conta" (spec §6.5), além dos da 7a.BR.
const PROIBIDOS_POL = /Brinson|alocação|interação|GRAP|TWR|XIRR/i;

test.use({ viewport: { width: 390, height: 844 } });

async function abrir(page: Page) {
  await abrirTela(page, "#/raiox/diagnostico/politica", TELA, ".diag-ensaio");
}

async function escolher(page: Page, k: string) {
  await page.locator(`${TELA} [data-testid="pol-janela-${k}"]`).click();
  await expect(page.locator(`${TELA} [data-testid="pol-janela-${k}"]`)).toHaveAttribute("aria-pressed", "true");
}

// O que a janela `k` deve mostrar, lido do payload e formatado pela casa.
async function esperado(page: Page, k: string) {
  return page.evaluate((kk) => {
    const w = window as any;
    const a = w.Alpine.$data(document.body).json.atribuicao;
    const j = a.janelas[kk];
    if (j.indisponivel !== null) return { disponivel: false, j } as any;
    const r1 = (x: number) => w.ponteRoundPy(x * 100, 1);
    const P = r1(j.politica), N = r1(j.so_indices), C = r1(j.carteira);
    const A = w.ponteRoundPy(N - P, 1), S = w.ponteRoundPy(C - N, 1);
    return {
      disponivel: true, j, P, N, C, A, S,
      Ptxt: w.rent2PctPts(P), Ntxt: w.rent2PctPts(N), Ctxt: w.rent2PctPts(C),
      Atxt: w.rent2Abs1(A), Stxt: w.rent2Abs1(S),
      ancora: w.rent2MmmAa(w.diagMesAnterior(j.de)), ate: w.rent2MmmAa(j.ate),
      ano: w.diagMesAnterior(j.de).slice(0, 4),
    };
  }, k);
}

const pp = (v: number) => (Math.abs(v) < 2 ? "ponto" : "pontos");
const verbo1 = (v: number) => (v > 0 ? "somou" : v < 0 ? "tirou" : "ficou em");
const verboN = (v: number) => (v > 0 ? "somaram" : v < 0 ? "tiraram" : "ficaram em");

function fraseEsperada(e: any) {
  const unid = e.j.anualizado ? "ao ano" : "no período";
  return `Desde ${e.ancora}, a política rendeu ${e.Ptxt} ${unid}. O desvio do alvo ${verbo1(e.A)} ${e.Atxt} ${pp(e.A)}, e suas escolhas ${verboN(e.S)} ${e.Stxt}: a carteira rendeu ${e.Ctxt}.`;
}

function linhaIndiceEsperada(e: any) {
  const unid = e.j.anualizado ? "ao ano" : "no período";
  return `Desde ${e.ano}, a política rendeu ${e.Ptxt} ${unid}; o desvio do alvo ${verbo1(e.A)} ${e.Atxt} e suas escolhas ${verboN(e.S)} ${e.Stxt} ${pp(e.S)}.`;
}

// "▲ +0,4" → 0.4; "▼ −0,2" → −0.2; "±0,0" → 0.
function lerPontos(s: string) {
  const t = norm(s);
  if (t === "±0,0") return 0;
  const m = /^([▲▼]) ([+−])(\d+,\d)$/.exec(t);
  if (!m) throw new Error("valor fora do formato: " + t);
  const v = Number(m[3].replace(",", "."));
  if ((m[1] === "▲") !== (m[2] === "+")) throw new Error("seta e sinal discordam: " + t);
  return m[2] === "+" ? v : -v;
}

// Linhas da cascata como a tela as mostra.
async function cascata(page: Page) {
  return page.evaluate((sel) => {
    const nrm = (s: string | null) => (s || "").replace(/\s+/g, " ").trim();
    return Array.from(document.querySelectorAll(`${sel} .pol-cascata [data-testid="pol-linha"]`)).map((el) => ({
      tipo: el.getAttribute("data-tipo"), id: el.getAttribute("data-id"), grupo: el.getAttribute("data-grupo"),
      nome: nrm(el.querySelector(".pol-nome")!.textContent), sub: nrm(el.querySelector(":scope > .pol-sub")?.textContent || ""),
      subNoRotulo: !!el.querySelector(".pol-rotulo .pol-sub"),
      valor: nrm(el.querySelector(".pol-valor")!.textContent),
    }));
  }, TELA);
}

test.describe("7a.BS.2 — capítulo 2: abertura e frase", () => {
  test("ordinal 2, título, a linha da pergunta; abre em Desde; o ← volta ao índice", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    await expect(page.locator(`${TELA} .breadcrumb h1`)).toHaveText("Diagnóstico");
    await expect(page.locator(`${TELA} .diag-ordinal`)).toHaveText("2");
    await expect(page.locator(`${TELA} .diag-titulo`)).toHaveText("De onde veio o resultado");
    await expect(page.locator(`${TELA} .pol-pergunta`)).toHaveText("Sua carteira comparada com o plano que você definiu, para saber quanto do resultado veio do plano, de ter fugido dele e dos ativos que você escolheu.");
    await expect(page.locator(`${TELA} [data-testid="pol-janela-desde"]`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(`${TELA} [data-testid="pol-janela-3a"]`)).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(`${TELA} [data-testid="pol-janela-3a"]`)).toHaveText("3 anos");
    await expect(page.locator(`${TELA} [data-testid="pol-janela-5a"]`)).toHaveText("5 anos");
    await expect(page.locator(`${TELA} [data-testid="pol-janela-desde"]`)).toHaveText("Desde o início");
    for (const k of JANELAS) await expect(page.locator(`${TELA} [data-testid="pol-janela-${k}"]`)).toHaveClass(/diag-janela--herda/);
    await page.locator(`${TELA} .breadcrumb button`).click();
    await expect(page).toHaveURL(/#\/raiox\/diagnostico$/);
    await expect(page.locator(".tela-diag-indice .diag-indice")).toBeVisible();
    expect(erros).toEqual([]);
  });

  test("frase-resposta, os quatro números em strong, e 'até {mmm/aa} · N meses', nas três janelas", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    // Abre em Desde: a primeira volta confere sem tocar janela nenhuma.
    for (const [i, k] of (["desde", "3a", "5a", "desde"] as const).entries()) {
      if (i > 0) await escolher(page, k);
      const e = await esperado(page, k);
      expect(e.disponivel, k).toBe(true);
      await expect(page.locator(`${TELA} [data-testid="pol-frase"]`)).toHaveText(fraseEsperada(e));
      const fortes = (await page.locator(`${TELA} [data-testid="pol-frase"] strong`).allTextContents()).map(norm);
      expect(fortes).toEqual([e.Ptxt, `${e.Atxt} ${pp(e.A)}`, e.Stxt, e.Ctxt]);
      await expect(page.locator(`${TELA} [data-testid="pol-ate"]`)).toHaveText(`até ${e.ate} · ${e.j.n_meses} meses`);
    }
    expect(erros).toEqual([]);
  });

  test("rótulo do contrafactual e a política registrada, verbatim, com as datas do payload em dd/mm/aaaa", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    const d = await page.evaluate(() => {
      const a = (window as any).Alpine.$data(document.body).json.atribuicao;
      const br = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
      return { reg: br(a.registrada_desde), ini: br(a.registros_desde) };
    });
    await expect(page.locator(`${TELA} [data-testid="pol-contrafactual"]`)).toHaveText(
      "Como se a política de hoje tivesse sido seguida desde o início. Ela foi definida conhecendo este período, e por isso tende a parecer boa.");
    await expect(page.locator(`${TELA} [data-testid="pol-registrada"]`)).toHaveText(
      `Esta política está registrada desde ${d.reg}, sem mudança de peso. Os registros dos seus alvos começam em ${d.ini}; antes disso, não há alvo datado.`);
    // Item 7 da §6.3: logo após o rótulo do contrafactual.
    const ordem = await page.evaluate((sel) => {
      // O <template> do x-if fica entre os dois no DOM e não é renderizado.
      let n = document.querySelector(`${sel} [data-testid="pol-contrafactual"]`)!.nextElementSibling;
      while (n && n.tagName === "TEMPLATE") n = n.nextElementSibling;
      return n && n.getAttribute("data-testid");
    }, TELA);
    expect(ordem).toBe("pol-registrada");
    for (const t of ["pol-contrafactual", "pol-registrada"]) {
      const cor = await page.locator(`${TELA} [data-testid="${t}"]`).evaluate((el) => getComputedStyle(el).color);
      expect(cor).toBe(await corDoToken(page, "--gray"));
    }
  });

  test("'Como ler esta conta' aberta e sem toque, depois da ressalva e antes de 'Ver a conta'; a nota cinza absorvida; o aviso", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    await expect(page.locator(`${TELA} [data-testid="pol-nota"]`)).toHaveCount(0);
    const ler = await medirLer(page, TELA, "pol");
    expect(ler).toMatchObject({ visivel: true, foraDeDetails: true, rotulada: true, h3: COMO_LER, antesDaConta: true });
    expect(ler!.h4s).toEqual(["Três carteiras", "As duas diferenças", "A unidade", "O dólar", "A ressalva", "O que fica de fora"]);
    expect(ler!.itens).toEqual([3, 2]);
    // A ressalva do número fica junto da frase, acima da seção.
    const ordem = await page.evaluate((sel) => {
      const r = document.querySelector(sel)!;
      const ler = r.querySelector('[data-testid="pol-ler"]')!;
      return ["pol-contrafactual", "pol-registrada"].map((t) => {
        const el = r.querySelector(`[data-testid="${t}"]`);
        return !el || !!(el.compareDocumentPosition(ler) & Node.DOCUMENT_POSITION_FOLLOWING);
      });
    }, TELA);
    expect(ordem).toEqual([true, true]);
    const abre = page.locator(`${TELA} details.diag-conta .diag-conta__corpo > p`).first();
    await expect(abre).toHaveText(CONTA_ABRE);
    await expect(abre).toHaveClass(/\bdiag-conta__abre\b/);
    await expect(page.locator(`${TELA} .diag-aviso`)).toHaveText("Rentabilidade passada não garante rentabilidade futura.");
  });
});

test.describe("7a.BS.2 — capítulo 2: a cascata", () => {
  test("ordem da spec §6.3 item 5, os três totais e as legendas da 7a.BU, nas três janelas", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    for (const k of JANELAS) {
      await escolher(page, k);
      const e = await esperado(page, k);
      const cls = CLASSES.filter((c) => c in e.j.escolhas_classes);
      const ls = await cascata(page);
      expect(ls.map((l) => `${l.tipo}:${l.id}`)).toEqual([
        "total:politica", "grupo:desvio", ...CATS.map((c) => `degrau:${c}`),
        "total:so_indices", "grupo:escolhas", ...cls.map((c) => `degrau:${c}`), "total:carteira",
      ]);
      const por = (id: string, tipo: string) => ls.find((l) => l.id === id && l.tipo === tipo)!;
      expect(por("politica", "total").nome).toBe("A política");
      expect(por("politica", "total").valor).toBe(e.Ptxt);
      expect(por("desvio", "grupo").nome).toBe("Desvio do alvo");
      expect(por("so_indices", "total").nome).toBe("Mesma carteira, só com índices");
      // 7a.BU §3.4: legenda de uma linha nos totais e nos cabeçalhos de grupo,
      // na segunda linha do grid (filho direto da linha, fora do rótulo).
      const LEG: Record<string, string> = {
        "total:politica": "o plano seguido à risca",
        "grupo:desvio": "o efeito de os seus pesos terem sido outros",
        "total:so_indices": "os seus pesos, rendendo os índices",
        "grupo:escolhas": "o efeito dos ativos que você escolheu",
        "total:carteira": "o que você ganhou de verdade",
      };
      for (const l of ls) {
        expect(l.sub, `${l.tipo}:${l.id}`).toBe(LEG[`${l.tipo}:${l.id}`] ?? "");
        expect(l.sub.length).toBeLessThanOrEqual(45);
        expect(l.subNoRotulo).toBe(false);
      }
      expect(por("so_indices", "total").valor).toBe(e.Ntxt);
      expect(por("escolhas", "grupo").nome).toBe("Suas escolhas");
      expect(por("carteira", "total").nome).toBe("Sua carteira");
      expect(por("carteira", "total").valor).toBe(e.Ctxt);
      const degraus = ls.filter((l) => l.tipo === "degrau");
      expect(degraus.filter((l) => l.grupo === "desvio").map((l) => l.nome)).toEqual(CATS.map((c) => NOME[c]));
      expect(degraus.filter((l) => l.grupo === "escolhas").map((l) => l.nome)).toEqual(cls.map((c) => NOME[c]));
      // Nunca "−0,0" (3 anos tem um desvio por categoria de zero negativo minúsculo).
      for (const l of ls) expect(l.valor, `${k} ${l.id}`).not.toMatch(/[−-]0,0(?!\d)/);
    }
    expect(erros).toEqual([]);
  });

  test("fecho exibido: os degraus de cada grupo somam o subtotal exibido, e os subtotais fecham os totais, a 1 casa", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    let absorveu = 0;
    for (const k of JANELAS) {
      await escolher(page, k);
      const e = await esperado(page, k);
      const ls = await cascata(page);
      const sub = (g: string) => lerPontos(ls.find((l) => l.tipo === "grupo" && l.id === g)!.valor);
      expect(sub("desvio"), k).toBeCloseTo(e.A, 9);
      expect(sub("escolhas"), k).toBeCloseTo(e.S, 9);
      for (const g of ["desvio", "escolhas"]) {
        const vs = ls.filter((l) => l.tipo === "degrau" && l.grupo === g).map((l) => lerPontos(l.valor));
        const soma = Math.round(vs.reduce((s, v) => s + v, 0) * 10) / 10;
        expect(soma, `${k} ${g}: ${vs.join(" + ")}`).toBeCloseTo(sub(g), 9);
        // Cada degrau fica a no máximo 0,1 do próprio valor arredondado.
        const brutos = g === "desvio" ? CATS.map((c) => e.j.desvio_categorias[c].total * 100)
          : CLASSES.filter((c) => c in e.j.escolhas_classes).map((c) => e.j.escolhas_classes[c] * 100);
        brutos.forEach((b, i) => {
          expect(Math.abs(vs[i] - b), `${k} ${g} ${i}`).toBeLessThanOrEqual(0.1 + 1e-9);
          if (Math.abs(vs[i] - Math.round(b * 10) / 10) > 1e-9) absorveu++;
        });
      }
      expect(Math.round((e.P + e.A + e.S) * 10) / 10).toBeCloseTo(e.C, 9);
    }
    // A fixture exige absorção em ao menos um grupo (senão este teste seria vácuo).
    expect(absorveu).toBeGreaterThan(0);
  });

  test("seta, sinal e cor dos degraus; o ponto da cor da categoria; barras: totais cheios, 'Sua carteira' em --ink", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    const r = await page.evaluate((sel) => {
      const raiz = document.querySelector(sel)!;
      const linhas = Array.from(raiz.querySelectorAll('.pol-cascata [data-testid="pol-linha"]'));
      return linhas.map((el) => {
        const barra = el.querySelector(".pol-barra") as HTMLElement | null;
        const ponto = el.querySelector(".pol-ponto") as HTMLElement | null;
        const valor = el.querySelector(".pol-valor") as HTMLElement;
        return {
          tipo: el.getAttribute("data-tipo"), id: el.getAttribute("data-id"),
          texto: valor.textContent!.trim(), corValor: getComputedStyle(valor).color,
          barra: barra ? { cor: getComputedStyle(barra).backgroundColor, w: barra.getBoundingClientRect().width, trilho: barra.parentElement!.getBoundingClientRect().width } : null,
          ponto: ponto ? getComputedStyle(ponto).backgroundColor : null,
        };
      });
    }, TELA);
    const fundo = async (t: string) => page.evaluate((v) => { const s = document.createElement("span"); s.style.background = `var(${v})`; document.body.appendChild(s); const c = getComputedStyle(s).backgroundColor; s.remove(); return c; }, t);
    const ink = await fundo("--ink"), gray = await fundo("--gray"), pos = await corDoToken(page, "--g-700"), neg = await corDoToken(page, "--red");
    for (const l of r) {
      if (l.tipo === "total") {
        expect(l.barra!.w, l.id!).toBeGreaterThan(l.barra!.trilho - 1);
        expect(l.barra!.cor, l.id!).toBe(l.id === "carteira" ? ink : gray);
      }
      if (l.tipo === "degrau") {
        const v = lerPontos(l.texto);
        if (v > 0) expect(l.corValor).toBe(pos);
        if (v < 0) expect(l.corValor).toBe(neg);
        expect(l.ponto, l.id!).toBe(await fundo(TOKEN[l.id!]));
      }
    }
  });

  test("categoria com efeito e sem peso real aparece, com o valor dela, e o fecho exibido segue", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page, PRINCIPAL);
    // Estado sintético: Renda Fixa BR sem peso real em nenhum mês da janela,
    // com efeito diferente de zero (−W·(b − R_P), spec §4.4).
    await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      const a = JSON.parse(JSON.stringify(d.json.atribuicao));
      for (const k of ["3a", "5a", "desde"]) a.janelas[k].desvio_categorias.renda_fixa.peso_real_medio = 0;
      d.json = { ...d.json, atribuicao: a };
    });
    await abrir(page);
    for (const k of JANELAS) {
      await escolher(page, k);
      const e = await esperado(page, k);
      const ls = await cascata(page);
      const rf = ls.find((l) => l.tipo === "degrau" && l.id === "renda_fixa");
      expect(rf, k).toBeTruthy();
      expect(rf!.nome).toBe("Renda Fixa BR");
      const vs = ls.filter((l) => l.tipo === "degrau" && l.grupo === "desvio").map((l) => lerPontos(l.valor));
      expect(vs.length).toBe(4);
      expect(Math.round(vs.reduce((s, v) => s + v, 0) * 10) / 10).toBeCloseTo(e.A, 9);
    }
    expect(erros).toEqual([]);
  });

  test("classe sem peso na janela não aparece nas escolhas", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      const a = JSON.parse(JSON.stringify(d.json.atribuicao));
      const j = a.janelas.desde;
      j.escolhas_classes.acoes_br += j.escolhas_classes.fiis;
      delete j.escolhas_classes.fiis;
      d.json = { ...d.json, atribuicao: a };
    });
    await abrir(page);
    const ls = await cascata(page);
    expect(ls.filter((l) => l.grupo === "escolhas").map((l) => l.nome)).toEqual(["Ações BR", "EUA"]);
  });

  test("as linhas não são botões; a tabela sr-only repete a cascata, linha a linha", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    await expect(page.locator(`${TELA} .pol-cascata button`)).toHaveCount(0);
    const ls = await cascata(page);
    const tab = page.locator(`${TELA} .sr-only table[data-testid="pol-tabela"]`);
    await expect(tab).toHaveCount(1);
    const linhas = await tab.locator("tbody tr").evaluateAll((trs) => trs.map((tr) => ({
      th: (tr.querySelector("th")!.textContent || "").replace(/\s+/g, " ").trim(),
      td: (tr.querySelector("td")!.textContent || "").replace(/\s+/g, " ").trim(),
    })));
    expect(linhas.length).toBe(ls.length);
    const e = await esperado(page, "desde");
    ls.forEach((l, i) => {
      expect(linhas[i].th).toContain(l.nome);
      // A cascata é aria-hidden: a legenda chega ao leitor de tela pela tabela.
      if (l.sub) expect(linhas[i].th).toContain(l.sub);
      if (l.tipo === "total") expect(linhas[i].td).toBe(`${l.valor} ao ano`);
      else {
        const v = lerPontos(l.valor);
        const falado = v === 0 ? `0,0 ${pp(v)}` : `${v > 0 ? "mais" : "menos"} ${Math.abs(v).toFixed(1).replace(".", ",")} ${pp(v)}`;
        expect(linhas[i].td).toBe(`${falado} ao ano`);
      }
    });
    expect(linhas[linhas.length - 1].td).toBe(`${e.Ctxt} ao ano`);
  });
});

test.describe("7a.BS.2 — capítulo 2: o dólar", () => {
  test("a frase do dólar segue o sinal, nas três janelas; o C0 é a carteira com o dólar parado; a linha cinza", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    const sinais = new Set<number>();
    for (const k of JANELAS) {
      await escolher(page, k);
      const d = await page.evaluate((kk) => {
        const w = window as any;
        const j = w.Alpine.$data(document.body).json.atribuicao.janelas[kk];
        const C = w.ponteRoundPy(j.carteira * 100, 1), C0 = w.ponteRoundPy(j.carteira_sem_dolar * 100, 1);
        const F = w.ponteRoundPy(C - C0, 1);
        return { C: w.rent2PctPts(C), C0: w.rent2PctPts(C0), F, Ftxt: w.rent2Abs1(F), bruto: j.dolar, unid: j.anualizado ? "ao ano" : "no período" };
      }, k);
      // O sinal exibido é o do payload (C − C0 é o dólar, por construção).
      expect(Math.sign(d.F), k).toBe(Math.sign(d.bruto));
      sinais.add(Math.sign(d.F));
      const ini = `Dos ${d.C} ${d.unid} da sua carteira, `;
      const meio = d.F > 0 ? `${d.Ftxt} ${pp(d.F)} ${Math.abs(d.F) < 2 ? "veio" : "vieram"} da alta do dólar.`
        : `a queda do dólar tirou ${d.Ftxt} ${pp(d.F)}.`;
      await expect(page.locator(`${TELA} [data-testid="pol-dolar-frase"]`)).toHaveText(`${ini}${meio} Com o dólar parado, ela teria rendido ${d.C0}.`);
      await expect(page.locator(`${TELA} [data-testid="pol-dolar-linha"]`)).toHaveText("É o que a parte americana ganhou ou perdeu só pela troca de moeda.");
    }
    // A fixture cobre os dois sinais (3 anos negativo; 5 anos e Desde positivos).
    expect([...sinais].sort()).toEqual([-1, 1]);
    expect(erros).toEqual([]);
  });

  test("helper puro: queda, alta e 'quase não mudou'", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    const r = await page.evaluate(() => {
      const w = window as any;
      return {
        queda: w.polDolarFrase({ carteira: 0.10, carteira_sem_dolar: 0.112, dolar: -0.012, anualizado: true }),
        quase: w.polDolarFrase({ carteira: 0.10, carteira_sem_dolar: 0.0996, dolar: 0.0004, anualizado: true }),
        alta: w.polDolarFrase({ carteira: 0.08, carteira_sem_dolar: 0.055, dolar: 0.025, anualizado: false }),
        nulo: w.polDolarFrase({ carteira: 0.08, carteira_sem_dolar: null, dolar: null, anualizado: true }),
      };
    });
    expect(r.queda).toBe("Dos 10,0% ao ano da sua carteira, a queda do dólar tirou 1,2 ponto. Com o dólar parado, ela teria rendido 11,2%.");
    expect(r.quase).toBe("Dos 10,0% ao ano da sua carteira, o dólar quase não mudou o resultado. Com o dólar parado, ela teria rendido 10,0%.");
    expect(r.alta).toBe("Dos 8,0% no período da sua carteira, 2,5 pontos vieram da alta do dólar. Com o dólar parado, ela teria rendido 5,5%.");
    expect(r.nulo).toBe("");
  });

  test("sem_dolar: a seção do dólar some, a cascata segue", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page, SEM_DOLAR);
    await abrir(page);
    for (const k of JANELAS) {
      await escolher(page, k);
      await expect(page.locator(`${TELA} [data-testid="pol-dolar"]`)).toHaveCount(0);
      const e = await esperado(page, k);
      await expect(page.locator(`${TELA} [data-testid="pol-frase"]`)).toHaveText(fraseEsperada(e));
      expect((await cascata(page)).length).toBeGreaterThan(5);
    }
    await page.locator(`${TELA} details.diag-conta summary`).click();
    expect(norm(await page.locator(`${TELA} details.diag-conta`).textContent())).not.toContain("câmbio da corretora");
    expect(erros).toEqual([]);
  });
});

test.describe("7a.BS.2 — capítulo 2: Ver a conta", () => {
  test("fechado; aberto, a tabela por categoria de cada janela, as definições, Brinson-Fachler, a interação, Dietz × mercado, as fontes e o dólar", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    const det = page.locator(`${TELA} details.diag-conta`);
    await expect(det).not.toHaveAttribute("open", "");
    await expect(det.locator("summary")).toHaveText("Ver a conta");
    await det.locator("summary").click();
    const a = await page.evaluate(() => (window as any).Alpine.$data(document.body).json.atribuicao);
    for (const k of JANELAS) {
      const tb = det.locator(`table.pol-conta-tabela[data-janela="${k}"]`);
      await expect(tb).toHaveCount(1);
      const cab = (await tb.locator("thead th").allTextContents()).map(norm);
      expect(cab).toEqual(CATS.map((c) => NOME[c]));
      const rot = (await tb.locator("tbody th").allTextContents()).map(norm);
      expect(rot).toEqual(["Alvo", "Peso real médio", "Peso da categoria", "Mistura dentro dela", "Desvio"]);
      const cel = await tb.locator("tbody tr").evaluateAll((trs) => trs.map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => (td.textContent || "").trim())));
      const esp = await page.evaluate(([kk, cats]) => {
        const w = window as any;
        const dc = w.Alpine.$data(document.body).json.atribuicao.janelas[kk].desvio_categorias;
        return [
          cats.map((c: string) => w.diagPct1(dc[c].alvo)),
          cats.map((c: string) => w.diagPct1(dc[c].peso_real_medio)),
          cats.map((c: string) => w.diagNum2(dc[c].peso * 100)),
          cats.map((c: string) => w.diagNum2(dc[c].mistura * 100)),
          cats.map((c: string) => w.diagNum2(dc[c].total * 100)),
        ];
      }, [k, CATS] as const);
      expect(cel, k).toEqual(esp);
      for (const row of cel) for (const v of row) expect(v).not.toMatch(/^[−-]0,0+%?$/);
    }
    const txt = norm(await det.textContent());
    expect(txt).toContain("atribuição de Brinson-Fachler");
    expect(txt).toContain("a interação entre peso e escolha fica em suas escolhas, como na Rentabilidade");
    expect(txt).toContain("Dietz");
    expect(txt).toContain("retorno de mercado");
    for (const def of ["A política:", "Desvio do alvo:", "Peso da categoria:", "Mistura dentro dela:", "Suas escolhas:"]) expect(txt).toContain(def);
    // Fontes: um item por fundo, na ordem do payload, com cada trecho e as datas.
    const fontes = (await det.locator('[data-testid="pol-fonte"]').allTextContents()).map(norm);
    const fundos = [...new Set(a.fontes.map((f: any) => f.fundo))];
    expect(fontes.length).toBe(fundos.length);
    const mmm = (ym: string) => page.evaluate((x) => (window as any).rent2MmmAa(x), ym);
    for (const f of a.fontes) {
      const item = fontes[fundos.indexOf(f.fundo)];
      expect(item.startsWith(`${f.fundo}:`)).toBe(true);
      expect(item).toContain(`de ${await mmm(f.de)} a ${await mmm(f.ate)}`);
      if (f.fonte === "bcb") expect(item).toContain(`${f.indice} do Banco Central`);
    }
    expect(txt).toContain("ações brasileiras negociadas em dólar");
    expect(txt).toContain("câmbio da corretora");
    expect(erros).toEqual([]);
  });

  test("o IMA-B 5 aparece como aproximação do índice que o fundo replica", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      const a = JSON.parse(JSON.stringify(d.json.atribuicao));
      a.fontes = a.fontes.map((f: any) => (f.fonte === "bcb" ? { ...f, indice: "IMA-B 5" } : f));
      d.json = { ...d.json, atribuicao: a };
    });
    await abrir(page);
    await page.locator(`${TELA} details.diag-conta summary`).click();
    const fontes = (await page.locator(`${TELA} [data-testid="pol-fonte"]`).allTextContents()).map(norm);
    const rf = fontes.find((f) => f.includes("IMA-B 5"))!;
    expect(rf).toContain("IMA-B 5 do Banco Central, como aproximação do índice que o fundo replica,");
    expect(fontes.filter((f) => !f.includes("IMA-B")).every((f) => !f.includes("aproximação"))).toBe(true);
  });
});

test.describe("7a.BS.2 — capítulo 2: estados (spec §6.4)", () => {
  test("desde_indisponivel: abre em 5 anos; Desde aria-disabled com o motivo traduzido; tocar Desde só diz o motivo", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page, DESDE_INDISP);
    await abrir(page);
    const motivo = await page.evaluate(() => (window as any).Alpine.$data(document.body).json.atribuicao.janelas.desde.indisponivel);
    expect(motivo).toBe("retorno do PUSA sem dado em 03/21");
    const desde = page.locator(`${TELA} [data-testid="pol-janela-desde"]`);
    await expect(desde).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator(`${TELA} [data-testid="pol-janela-5a"]`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(`${TELA} [data-testid="pol-motivo"]`)).toHaveText("Falta o retorno do PUSA em mar/21.");
    await expect(page.locator(`${TELA} [data-testid="pol-motivo"]`)).toHaveClass(/diag-motivo/);
    const e = await esperado(page, "5a");
    await expect(page.locator(`${TELA} [data-testid="pol-frase"]`)).toHaveText(fraseEsperada(e));
    // 7a.BU: a seção é estática e não depende da janela.
    expect((await medirLer(page, TELA, "pol"))!.visivel).toBe(true);
    // aria-disabled: o Playwright não clica sem force (o botão segue focável e tocável).
    await desde.click({ force: true });
    await expect(page.locator(`${TELA} [data-testid="pol-janela-5a"]`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(`${TELA} [data-testid="pol-motivo"]`)).toHaveText("Falta o retorno do PUSA em mar/21.");
    // A linha 2 do índice diz o motivo, e continua tocável.
    await page.goto("/#/raiox/diagnostico");
    await expect(page.locator('.tela-diag-indice [data-testid="diag-indice-2"] .diag-indice__estado')).toHaveText("Falta o retorno do PUSA em mar/21.");
    expect(erros).toEqual([]);
  });

  test("helper puro: o motivo de fundo vira 'Falta o retorno do {fundo} em {mmm/aa}.'; os da ponte passam pelo tradutor da casa", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    const r = await page.evaluate(() => {
      const w = window as any;
      return {
        fundo: w.polMotivoTexto("retorno do XFND sem dado em 03/24"),
        ponte: w.polMotivoTexto("cotação ausente em 03/24"),
        casa: w.rent2MotivoTexto("cotação ausente em 03/24"),
      };
    });
    expect(r.fundo).toBe("Falta o retorno do XFND em mar/24.");
    expect(r.ponte).toBe(r.casa);
  });

  test("sem_registro: a linha da política registrada some; o rótulo do contrafactual fica", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page, SEM_REGISTRO);
    await abrir(page);
    await expect(page.locator(`${TELA} [data-testid="pol-registrada"]`)).toHaveCount(0);
    await expect(page.locator(`${TELA} [data-testid="pol-contrafactual"]`)).toBeVisible();
    expect(erros).toEqual([]);
  });

  for (const [nome, corpo] of [["atribuicao null", NULO], ["parcial", PARCIAL], ["pré-v2.37", PRE237]] as const) {
    test(`payload ${nome}: 'De onde veio o resultado: indisponível hoje.', sem erro; o ← volta ao índice`, async ({ page }) => {
      const erros = coletarErros(page);
      await autenticar(page, corpo);
      await page.goto("/#/raiox/diagnostico/politica");
      await expect(page.locator(`${TELA} .placeholder`)).toHaveText("De onde veio o resultado: indisponível hoje.");
      await expect(page.locator(`${TELA} .diag-ensaio`)).toHaveCount(0);
      await page.locator(`${TELA} .breadcrumb button`).click();
      await expect(page).toHaveURL(/#\/raiox\/diagnostico$/);
      expect(erros).toEqual([]);
    });
  }

  const TRUNCADOS: [string, string][] = [
    ["sem janelas", "delete a.janelas;"],
    ["janela 3a ausente", "delete a.janelas['3a'];"],
    ["categoria sem total", "delete a.janelas['5a'].desvio_categorias.fiis.total;"],
    ["categoria fora do alvo", "a.janelas.desde.desvio_categorias.cripto = { ...a.janelas.desde.desvio_categorias.fiis };"],
    ["escolha de classe desconhecida", "a.janelas.desde.escolhas_classes.cripto = 0.001;"],
    ["dólar pela metade", "a.janelas.desde.carteira_sem_dolar = null;"],
    ["motivo vazio", "a.janelas.desde.indisponivel = '';"],
    ["fontes que não é lista", "a.fontes = 'x';"],
    ["registros_desde ausente", "delete a.registros_desde;"],
  ];
  for (const [nome, mutacao] of TRUNCADOS) {
    test(`bloco parcial (${nome}): indisponível hoje no capítulo e na linha 2 do índice, nenhum erro`, async ({ page }) => {
      const erros = coletarErros(page);
      await autenticar(page, PRINCIPAL);
      await page.evaluate((m) => {
        const d = (window as any).Alpine.$data(document.body);
        const a = JSON.parse(JSON.stringify(d.json.atribuicao));
        new Function("a", m)(a);
        d.json = { ...d.json, atribuicao: a };
      }, mutacao);
      await page.goto("/#/raiox/diagnostico/politica");
      await expect(page.locator(TELA)).toContainText("De onde veio o resultado: indisponível hoje.");
      await page.goto("/#/raiox/diagnostico");
      await expect(page.locator('.tela-diag-indice [data-testid="diag-indice-2"] .diag-indice__estado')).toHaveText("Indisponível hoje.");
      expect(erros).toEqual([]);
    });
  }

  test("pol memorizado por bloco e (janela, toque): a mesma chave devolve o mesmo objeto", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    const r = await page.evaluate(() => {
      const w = window as any;
      const a = w.Alpine.$data(document.body).atribuicao;
      return {
        mesmo: w.polMemo(a, "desde", "") === w.polMemo(a, "desde", ""),
        outro: w.polMemo(a, "desde", "") !== w.polMemo(a, "5a", ""),
        janela: w.polMemo(a, "5a", "").chave,
      };
    });
    expect(r).toEqual({ mesmo: true, outro: true, janela: "5a" });
  });

  // Vigências ausentes ou malformadas no pipeline: `registrada_desde` e
  // `registros_desde` saem nulos e o resto do bloco é publicado (board BS.2).
  // O capítulo segue, só sem a linha da política registrada.
  test("vigências ausentes (registrada_desde e registros_desde nulos): o capítulo segue, sem a linha do item 7", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page, PRINCIPAL);
    await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      d.json = { ...d.json, atribuicao: { ...d.json.atribuicao, registrada_desde: null, registros_desde: null } };
    });
    await page.goto("/#/raiox/diagnostico/politica");
    await expect(page.locator(`${TELA} [data-testid="pol-frase"]`)).toBeVisible();
    await expect(page.locator(TELA)).not.toContainText("indisponível hoje");
    await expect(page.locator(`${TELA} [data-testid="pol-registrada"]`)).toHaveCount(0);
    expect(erros).toEqual([]);
  });
});

test.describe("7a.BS.2 — índice: a linha 2", () => {
  test("linha 2 (normal): a frase do Desde, lida do payload", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page, PRINCIPAL);
    await abrirTela(page, "#/raiox/diagnostico", ".tela-diag-indice", ".diag-indice");
    const e = await esperado(page, "desde");
    await expect(page.locator('.tela-diag-indice [data-testid="diag-indice-2"] .diag-indice__estado')).toHaveText(linhaIndiceEsperada(e));
    expect(erros).toEqual([]);
  });

  test("helper puro: desvio negativo 'tirou', escolhas negativas 'tiraram', no período sem anualizar", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    const r = await page.evaluate(() => {
      const w = window as any;
      const a = JSON.parse(JSON.stringify(w.Alpine.$data(document.body).json.atribuicao));
      Object.assign(a.janelas.desde, { de: "2021-02", anualizado: true, politica: 0.10, so_indices: 0.095, carteira: 0.07 });
      const neg = w.polIndiceFrase(a);
      Object.assign(a.janelas.desde, { anualizado: false, politica: 0.04, so_indices: 0.046, carteira: 0.081 });
      const pos = w.polIndiceFrase(a);
      return { neg, pos };
    });
    expect(r.neg).toBe("Desde 2021, a política rendeu 10,0% ao ano; o desvio do alvo tirou 0,5 e suas escolhas tiraram 2,5 pontos.");
    expect(r.pos).toBe("Desde 2021, a política rendeu 4,0% no período; o desvio do alvo somou 0,6 e suas escolhas somaram 3,5 pontos.");
  });
});

test.describe("7a.BS.2 — capítulo 2: regras de forma (spec §6.5)", () => {
  for (const [nome, corpo] of [["normal", PRINCIPAL], ["desde_indisponivel", DESDE_INDISP], ["sem_dolar", SEM_DOLAR], ["nulo", NULO]] as const) {
    test(`face sem travessão nem os termos de 'Ver a conta' (${nome})`, async ({ page }) => {
      const erros = coletarErros(page);
      await autenticar(page, corpo);
      await page.goto("/#/raiox/diagnostico/politica");
      await expect(page.locator(`${TELA} .breadcrumb h1`)).toBeVisible();
      const disponiveis = nome === "nulo" ? [] : JANELAS;
      for (const k of disponiveis) {
        await page.locator(`${TELA} [data-testid="pol-janela-${k}"]`).click({ force: true });
        const face = await faceTexto(page, TELA);
        expect(face).not.toMatch(/[—–]|--/);
        expect(face).not.toMatch(PROIBIDOS);
        expect(face).not.toMatch(PROIBIDOS_POL);
      }
      if (!disponiveis.length) {
        const face = await faceTexto(page, TELA);
        expect(face).not.toMatch(/[—–]|--/);
      }
      // Os termos técnicos moram em "Ver a conta" (que existe e os carrega).
      if (disponiveis.length) {
        const conta = norm(await page.locator(`${TELA} details.diag-conta`).textContent());
        expect(conta).toMatch(/Brinson/);
        expect(conta).not.toMatch(/[—–]|--/);
      }
      expect(erros).toEqual([]);
    });
  }

  for (const largura of [320, 390] as const) {
    for (const [nome, corpo] of [["normal", PRINCIPAL], ["desde_indisponivel", DESDE_INDISP]] as const) {
      test(`a ${largura} px (${nome}): nada passa da coluna, a cascata cabe e há folga ≥ 8 px entre rótulo e valor em toda linha`, async ({ page }) => {
        await page.setViewportSize({ width: largura, height: 800 });
        await autenticar(page, corpo);
        await abrir(page);
        for (const k of nome === "normal" ? JANELAS : (["3a", "5a"] as const)) {
          await escolher(page, k);
          await page.locator(`${TELA} details.diag-conta`).evaluate((d) => ((d as HTMLDetailsElement).open = true));
          const r = await page.evaluate((sel) => {
            const raiz = document.querySelector(sel)!;
            const col = raiz.querySelector(".diag-ensaio")!.getBoundingClientRect();
            const nrm = (s: string | null) => (s || "").replace(/\s+/g, " ").trim();
            const caixa = (el: Element) => { const rg = document.createRange(); rg.selectNodeContents(el); return rg.getBoundingClientRect(); };
            const fora = Array.from(raiz.querySelectorAll(".diag-ensaio *"))
              .filter((el) => !el.closest(".sr-only"))
              .filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && (b.right > col.right + 0.5 || b.left < col.left - 0.5); })
              .map((el) => (el as HTMLElement).getAttribute("class") + " " + nrm(el.textContent).slice(0, 30));
            for (const b of Array.from(raiz.querySelectorAll("button"))) {
              if ((b as HTMLElement).offsetParent && b.scrollWidth > b.clientWidth + 0.5) fora.push("texto vaza do botão: " + nrm(b.textContent));
            }
            const casc = raiz.querySelector(".pol-cascata")!.getBoundingClientRect();
            const folgas = Array.from(raiz.querySelectorAll('.pol-cascata [data-testid="pol-linha"]')).map((l) => {
              const a = caixa(l.querySelector(".pol-rotulo")!), b = caixa(l.querySelector(".pol-valor")!);
              const mesma = a.top < b.bottom && b.top < a.bottom;
              return { linha: nrm(l.textContent), folga: mesma ? b.left - a.right : 999, alto: l.getBoundingClientRect().height };
            });
            return { fora, folgas, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, casc: { l: casc.left, r: casc.right }, col: { l: col.left, r: col.right } };
          }, TELA);
          expect(r.sw).toBeLessThanOrEqual(r.cw);
          expect(r.fora).toEqual([]);
          expect(r.casc.l).toBeGreaterThanOrEqual(r.col.l - 0.5);
          expect(r.casc.r).toBeLessThanOrEqual(r.col.r + 0.5);
          expect(r.folgas.length).toBeGreaterThan(8);
          for (const f of r.folgas) expect(f.folga, `${largura} ${k} ${f.linha}`).toBeGreaterThanOrEqual(8);
        }
      });
    }
  }

  test("janelas herdam a fonte do texto (font: inherit), com alvo tocável ≥ 44 px de altura", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    const r = await page.evaluate(() => {
      const raiz = document.querySelector(".tela-diag-politica .diag-ensaio")!;
      return Array.from(raiz.querySelectorAll(".diag-janelas button")).map((b) => ({
        f: getComputedStyle(b).fontFamily, corpo: getComputedStyle(raiz).fontFamily, h: b.getBoundingClientRect().height,
      }));
    });
    expect(r.length).toBe(3);
    for (const b of r) { expect(b.f).toBe(b.corpo); expect(b.h).toBeGreaterThanOrEqual(44); }
  });

  for (const tema of ["claro", "Plantão"] as const) {
    test(`${tema}: frase e números em --ink, linhas cinzas em --gray, Renda Fixa BR no token dela, 'Sua carteira' em --ink`, async ({ page }) => {
      if (tema === "Plantão") await page.addInitScript(() => localStorage.setItem("tema", "dark"));
      await autenticar(page, PRINCIPAL);
      await abrir(page);
      const r = await page.evaluate(() => {
        const sel = ".tela-diag-politica";
        const cor = (v: string) => { const s = document.createElement("span"); s.style.color = `var(${v})`; document.body.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c; };
        const fundo = (v: string) => { const s = document.createElement("span"); s.style.background = `var(${v})`; document.body.appendChild(s); const c = getComputedStyle(s).backgroundColor; s.remove(); return c; };
        const q = (s: string) => document.querySelector(`${sel} ${s}`)!;
        return {
          tema: document.documentElement.getAttribute("data-theme"),
          ink: cor("--ink"), gray: cor("--gray"), inkBg: fundo("--ink"), rf: fundo("--cat-renda-fixa-br"),
          frase: getComputedStyle(q('[data-testid="pol-frase"]')).color,
          fortes: Array.from(document.querySelectorAll(`${sel} [data-testid="pol-frase"] strong`)).map((s) => getComputedStyle(s).color),
          // A regra dos capítulos da 7a.BR (spec §6.5): o número herda a fonte da frase, sem mono próprio.
          fonteFrase: getComputedStyle(q('[data-testid="pol-frase"]')).fontFamily,
          fontesFortes: Array.from(document.querySelectorAll(`${sel} [data-testid="pol-frase"] strong`)).map((s) => getComputedStyle(s).fontFamily),
          ate: getComputedStyle(q('[data-testid="pol-ate"]')).color,
          dolarLinha: getComputedStyle(q('[data-testid="pol-dolar-linha"]')).color,
          ponto: getComputedStyle(q('[data-testid="pol-linha"][data-id="renda_fixa"] .pol-ponto')).backgroundColor,
          sua: getComputedStyle(q('[data-testid="pol-linha"][data-id="carteira"] .pol-barra')).backgroundColor,
          suaValor: getComputedStyle(q('[data-testid="pol-linha"][data-id="carteira"] .pol-valor')).color,
        };
      });
      expect(r.tema).toBe(tema === "Plantão" ? "dark" : "light");
      expect(r.frase).toBe(r.ink);
      expect(r.fortes.length).toBe(4);
      for (const c of r.fortes) expect(c).toBe(r.ink);
      for (const f of r.fontesFortes) expect(f).toBe(r.fonteFrase);
      expect(r.ate).toBe(r.gray);
      const ler = await medirLer(page, TELA, "pol");
      expect(ler!.cores).toEqual([r.ink]);
      expect(ler!.dfnPeso).toEqual(["600"]);
      expect(r.dolarLinha).toBe(r.gray);
      expect(r.ponto).toBe(r.rf);
      expect(r.sua).toBe(r.inkBg);
      expect(r.suaValor).toBe(r.ink);
    });
  }

  test("sem motion nova: as barras e as linhas da cascata não têm transição nem animação", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    const r = await page.evaluate(() => Array.from(document.querySelectorAll(".tela-diag-politica .pol-cascata *")).map((el) => {
      const s = getComputedStyle(el);
      return { d: s.transitionDuration, a: s.animationName };
    }));
    for (const x of r) { expect(x.d.split(",").every((v) => parseFloat(v) === 0)).toBe(true); expect(x.a).toBe("none"); }
  });
});
