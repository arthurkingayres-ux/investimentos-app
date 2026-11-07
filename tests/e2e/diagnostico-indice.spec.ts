import { test, expect, Page } from "@playwright/test";
import { fx, autenticar, abrirTela, coletarErros, norm, faceTexto, PROIBIDOS, medirForma, corDoToken, escalarValorFinal } from "./diag-comum";

// Fase 7a.BR.2 — o índice do Diagnóstico (#/raiox/diagnostico, spec §6.2):
// quatro perguntas desde a 7a.BS.2 (a 2 é a da política, em
// diagnostico-politica.spec.ts; a seleção virou a 3 e os aportes a 4), uma linha cada, com a frase de estado da janela desde o
// início. Os valores esperados são lidos do payload decifrado e montados aqui,
// por uma implementação própria da regra do item 7 da §8 (nunca pelos helpers
// da tela, senão o teste concordaria com qualquer erro deles), formatados pelos
// formatadores da casa. Literal só onde o teste trava a copy.
const PRINCIPAL = fx("portfolio.test.json.enc");
const NULO = fx("portfolio_selecao_null.test.json.enc");
const PRE236 = fx("portfolio_pre_v236.test.json.enc");
const INDICIO = fx("portfolio_selecao_indicio.test.json.enc");
const DIVERGEM = fx("portfolio_selecao_divergem.test.json.enc");
const CURTO = fx("portfolio_selecao_curto.test.json.enc");
const INDISPONIVEL = fx("portfolio_selecao_indisponivel.test.json.enc");
const APORTES = fx("portfolio_selecao_aportes.test.json.enc");
const ATR_NULO = fx("portfolio_atribuicao_null.test.json.enc");
const ATR_PARCIAL = fx("portfolio_atribuicao_parcial.test.json.enc");
const PRE237 = fx("portfolio_pre_v237.test.json.enc");

const TELA = ".tela-diag-indice";
const linha = (page: Page, n: number) => page.locator(`${TELA} [data-testid="diag-indice-${n}"]`);

test.use({ viewport: { width: 390, height: 844 } });

async function abrir(page: Page) {
  await abrirTela(page, "#/raiox/diagnostico", TELA, ".diag-indice");
}

// A linha da seleção esperada (spec 7a.BR §6.2 e item 7 da §8; linha 3 desde a
// 7a.BS.2), montada do payload.
async function linha2Esperada(page: Page) {
  return page.evaluate(() => {
    const s = (window as any).Alpine.$data(document.body).json.selecao;
    const ORDEM = ["acoes_br", "fiis", "eua"];
    const NOME: Record<string, string> = { acoes_br: "Ações BR", fiis: "FIIs", eua: "EUA" };
    const IND: Record<string, string> = { IBOV: "IBOV", IFIX: "IFIX", SP500TR: "S&P 500" };
    const forte = (j: any) => j.indisponivel === null && (j.grau === "indicio" || j.grau === "consistente");
    const lado = (j: any) => (j.t < 0 ? "atrás do" : "à frente do");
    const oracao = (cl: string, j: any) => {
      const ind = IND[s.classes[cl].indice];
      return j.grau === "indicio" ? `${NOME[cl]} com indício de ficar ${lado(j)} ${ind}`
        : `${NOME[cl]} de forma consistente ${lado(j)} ${ind}`;
    };
    const presentes = ORDEM.filter((cl) => cl in s.classes);
    const fortes = presentes.filter((cl) => forte(s.classes[cl].janelas.desde));
    // Classe com o desde indisponível é nomeada, nunca contada como "não se
    // separa da sorte" (falta de dado não é veredito).
    const sem = presentes.filter((cl) => s.classes[cl].janelas.desde.indisponivel !== null).map((cl) => NOME[cl]);
    const semTxt = sem.length === 0 ? "" : (sem.length === 1 ? sem[0] : sem.slice(0, -1).join(", ") + " e " + sem[sem.length - 1]) + " sem dado hoje";
    let txt: string;
    if (sem.length && sem.length === presentes.length) txt = `Desde o início, ${semTxt}.`;
    else if (!fortes.length) txt = sem.length ? `Desde o início, nenhuma classe com dado se separa da sorte; ${semTxt}.` : "Desde o início, nenhuma classe se separa da sorte.";
    else {
      const resto = presentes.filter((cl) => !fortes.includes(cl) && s.classes[cl].janelas.desde.indisponivel === null);
      let cauda = "";
      if (resto.length && resto.every((cl) => s.classes[cl].janelas.desde.grau === "inconclusivo")) {
        cauda = resto.length === 1 ? "; a outra, inconclusiva" : "; as outras, inconclusivas";
      }
      if (semTxt) cauda += "; " + semTxt;
      txt = "Desde o início, " + fortes.map((cl) => oracao(cl, s.classes[cl].janelas.desde)).join("; ") + cauda + ".";
    }
    const extras: string[] = [];
    for (const cl of presentes) {
      if (fortes.includes(cl)) continue;
      const cand = (["3a", "5a"] as const).filter((k) => forte(s.classes[cl].janelas[k]));
      if (!cand.length) continue;
      const k = cand.reduce((a, b) => (Math.abs(s.classes[cl].janelas[b].t) > Math.abs(s.classes[cl].janelas[a].t) ? b : a));
      extras.push(`em ${k === "3a" ? 3 : 5} anos, ${oracao(cl, s.classes[cl].janelas[k])}`);
    }
    if (extras.length) {
      const e = extras.join("; ");
      txt += " " + e[0].toUpperCase() + e.slice(1) + ".";
    }
    return txt;
  });
}

test.describe("7a.BR.2 — índice do Diagnóstico", () => {
  test("título, instrução, quatro perguntas tocáveis de 44 px, nota e aviso; o ← volta ao Raio-X", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    await expect(page.locator(`${TELA} .breadcrumb h1`)).toHaveText("Diagnóstico");
    await expect(page.locator(`${TELA} .diag-indice__titulo`)).toHaveText("A carteira está indo bem?");
    await expect(page.locator(`${TELA} .diag-indice__instrucao`)).toHaveText("Quatro perguntas, lidas nesta ordem. Toque em uma para ver a conta.");
    const titulos = ["Quanto risco a carteira correu", "De onde veio o resultado", "Seus picks batem o índice?", "O momento dos seus aportes"];
    const rotas = ["#/raiox/diagnostico/risco", "#/raiox/diagnostico/politica", "#/raiox/diagnostico/selecao", "#/raiox/diagnostico/aportes"];
    await expect(page.locator(`${TELA} a.diag-indice__linha`)).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      const a = linha(page, i + 1);
      await expect(a).toHaveAttribute("href", rotas[i]);
      await expect(a.locator(".diag-indice__ordinal")).toHaveText(String(i + 1));
      await expect(a.locator(".diag-indice__pergunta")).toHaveText(titulos[i]);
      expect(norm(await a.locator(".diag-indice__estado").textContent()).length).toBeGreaterThan(0);
      await expect(a.locator(".diag-indice__chevron")).toHaveText("›");
      const caixa = await a.boundingBox();
      expect(caixa!.height).toBeGreaterThanOrEqual(44);
    }
    await expect(page.locator(`${TELA} .diag-indice__nota`)).toHaveText(
      "Cada linha resume a janela desde o início. A conta, as outras janelas e os escopos ficam dentro de cada pergunta.");
    await expect(page.locator(`${TELA} .diag-aviso`)).toHaveText("Rentabilidade passada não garante rentabilidade futura.");
    await page.locator(`${TELA} .breadcrumb button`).click();
    await expect(page.locator(".raiox")).toBeVisible();
    await expect(page).not.toHaveURL(/diagnostico/);
    expect(erros).toEqual([]);
  });

  test("o card da home não muda e abre o índice", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    const card = page.locator(".diag-card-home");
    await expect(card).toHaveAttribute("href", "#/raiox/diagnostico");
    await card.click();
    await expect(page).toHaveURL(/#\/raiox\/diagnostico$/);
    await expect(page.locator(`${TELA} .diag-indice`)).toBeVisible();
  });

  test("linha 1 é a frase do card da home", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    const card = norm(await page.locator(".diag-card-home__texto").textContent());
    expect(card.length).toBeGreaterThan(0);
    await abrir(page);
    await expect(linha(page, 1).locator(".diag-indice__estado")).toHaveText(card.endsWith(".") ? card : card + ".");
  });

  for (const [nome, corpo] of [["normal", PRINCIPAL], ["indicio", INDICIO], ["divergem", DIVERGEM], ["curto", CURTO], ["indisponivel", INDISPONIVEL]] as const) {
    test(`linha 3 (${nome}): o desde e, para cada classe com indício ou consistente em 3 ou 5 anos, a oração da janela de maior |t|`, async ({ page }) => {
      const erros = coletarErros(page);
      await autenticar(page, corpo);
      await abrir(page);
      const esperada = await linha2Esperada(page);
      await expect(linha(page, 3).locator(".diag-indice__estado")).toHaveText(esperada);
      expect(erros).toEqual([]);
    });
  }

  test("linha 3 (normal) trava a copy: nenhuma classe no desde, Ações BR com indício em 3 anos", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    const t3 = await page.evaluate(() => (window as any).Alpine.$data(document.body).json.selecao.classes.acoes_br.janelas["3a"].t);
    await expect(linha(page, 3).locator(".diag-indice__estado")).toHaveText(
      `Desde o início, nenhuma classe se separa da sorte. Em 3 anos, Ações BR com indício de ficar ${t3 < 0 ? "atrás do" : "à frente do"} IBOV.`);
  });

  // Ajuste pós-Alfred (06/11): falta de dado não vira veredito. Na variante
  // indisponivel, Ações BR e FIIs ficam sem o desde e EUA fica inconclusivo.
  test("linha 3 (indisponivel) trava a copy: as classes sem dado são nomeadas, fora de 'nenhuma classe se separa da sorte'", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page, INDISPONIVEL);
    await abrir(page);
    const g = await page.evaluate(() => {
      const c = (window as any).Alpine.$data(document.body).json.selecao.classes;
      return [c.acoes_br.janelas.desde.indisponivel !== null, c.fiis.janelas.desde.indisponivel !== null, c.eua.janelas.desde.grau];
    });
    expect(g).toEqual([true, true, "inconclusivo"]);
    const estado = linha(page, 3).locator(".diag-indice__estado");
    await expect(estado).toHaveText("Desde o início, nenhuma classe com dado se separa da sorte; Ações BR e FIIs sem dado hoje.");
    await expect(estado).not.toHaveText(/^Desde o início, nenhuma classe se separa da sorte\./);
    expect(erros).toEqual([]);
  });

  test("linha 3, helper puro: todas sem dado ⇒ só a lista; uma forte com uma sem dado ⇒ a cauda nomeia as duas coisas", async ({ page }) => {
    await autenticar(page, INDISPONIVEL);
    const r = await page.evaluate(() => {
      const w = window as any;
      const s = JSON.parse(JSON.stringify(w.Alpine.$data(document.body).json.selecao));
      const todas = JSON.parse(JSON.stringify(s));
      todas.classes.eua.janelas.desde.indisponivel = "cotação ausente em 03/24";
      for (const k of ["3a", "5a"]) todas.classes.eua.janelas[k].grau = "inconclusivo";
      const mista = JSON.parse(JSON.stringify(s));
      delete mista.classes.fiis;
      Object.assign(mista.classes.eua.janelas.desde, { grau: "indicio", t: 1.5 });
      return { todas: w.selIndiceFrase(todas), mista: w.selIndiceFrase(mista) };
    });
    expect(r.todas).toBe("Desde o início, Ações BR, FIIs e EUA sem dado hoje.");
    expect(r.mista).toBe("Desde o início, EUA com indício de ficar à frente do S&P 500; Ações BR sem dado hoje.");
  });

  for (const [nome, corpo] of [["selecao null", NULO], ["pré-v2.36", PRE236]] as const) {
    test(`payload ${nome}: a linha 3 diz 'Indisponível hoje.' e continua tocável; as outras seguem`, async ({ page }) => {
      const erros = coletarErros(page);
      await autenticar(page, corpo);
      await abrir(page);
      await expect(linha(page, 3).locator(".diag-indice__estado")).toHaveText("Indisponível hoje.");
      await expect(linha(page, 1).locator(".diag-indice__estado")).not.toHaveText("Indisponível hoje.");
      await expect(linha(page, 4)).toBeVisible();
      await linha(page, 3).click();
      await expect(page).toHaveURL(/#\/raiox\/diagnostico\/selecao$/);
      await expect(page.locator(".tela-diag-selecao")).toContainText("Confiança da seleção indisponível hoje.");
      expect(erros).toEqual([]);
    });
  }

  // 7a.BS.2 (spec §6.4): sem o bloco `atribuicao` válido, a linha 2 diz
  // "Indisponível hoje." e continua tocável; as linhas 1, 3 e 4 seguem com o
  // texto delas (o resto do payload é o da fixture principal).
  for (const [nome, corpo] of [["atribuicao null", ATR_NULO], ["atribuicao parcial", ATR_PARCIAL], ["pré-v2.37", PRE237]] as const) {
    test(`payload ${nome}: a linha 2 diz 'Indisponível hoje.' e continua tocável; as linhas 1, 3 e 4 seguem`, async ({ page }) => {
      const erros = coletarErros(page);
      await autenticar(page, corpo);
      const card = norm(await page.locator(".diag-card-home__texto").textContent());
      await abrir(page);
      await expect(page.locator(`${TELA} a.diag-indice__linha`)).toHaveCount(4);
      await expect(linha(page, 2).locator(".diag-indice__pergunta")).toHaveText("De onde veio o resultado");
      await expect(linha(page, 2).locator(".diag-indice__estado")).toHaveText("Indisponível hoje.");
      await expect(linha(page, 1).locator(".diag-indice__estado")).toHaveText(card.endsWith(".") ? card : card + ".");
      await expect(linha(page, 3).locator(".diag-indice__estado")).toHaveText(await linha2Esperada(page));
      const l4 = norm(await linha(page, 4).locator(".diag-indice__estado").textContent());
      expect(l4.length).toBeGreaterThan(0);
      expect(l4).not.toBe("Indisponível hoje.");
      const caixa = await linha(page, 2).boundingBox();
      expect(caixa!.height).toBeGreaterThanOrEqual(44);
      await linha(page, 2).click();
      await expect(page).toHaveURL(/#\/raiox\/diagnostico\/politica$/);
      await expect(page.locator(".tela-diag-politica")).toContainText("De onde veio o resultado: indisponível hoje.");
      expect(erros).toEqual([]);
    });
  }

  for (const fator of [1, 1.1, 0.9] as const)
  test(`linha 4 (ponte longa, valor final × ${fator}): 'Desde {ano}, o calendário dos aportes {somou|tirou} X ponto(s) ao ano {ao|do} seu retorno.' com X = XIRR − TWR do Total desde`, async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page, APORTES);
    await escalarValorFinal(page, fator);
    await abrir(page);
    const e = await page.evaluate(() => {
      const w = window as any;
      const b = w.Alpine.raw(w.Alpine.$data(document.body).json.ponte);
      const m0 = Math.max(w.ponteInicioEscopo(b, "Total", "BRL"), 1);
      const j = w.ponteJanelasFixas(b, "Total", "BRL").desde;
      const r = w.ponteRoundPy((j.xirr - j.sua) * 100, 1);
      return { ano: b.meses[m0 - 1].slice(0, 4), r, x: w.rent2Abs1(r) };
    });
    const estado = linha(page, 4).locator(".diag-indice__estado");
    if (fator === 1) {
      // A ponte da fixture fica abaixo do limiar de 0,5 ponto (item 8 da §8).
      expect(Math.abs(e.r)).toBeLessThan(0.5);
      await expect(estado).toHaveText(`Desde ${e.ano}, o calendário dos aportes quase não mudou o seu retorno.`);
    } else {
      expect(Math.sign(e.r)).toBe(fator > 1 ? 1 : -1);
      expect(Math.abs(e.r)).toBeGreaterThanOrEqual(0.5);
      const verbo = e.r > 0 ? "somou" : "tirou";
      const pp = Math.abs(e.r) < 2 ? "ponto" : "pontos";
      await expect(estado).toHaveText(`Desde ${e.ano}, o calendário dos aportes ${verbo} ${e.x} ${pp} ao ano ${e.r > 0 ? "ao" : "do"} seu retorno.`);
    }
    expect(erros).toEqual([]);
  });

  test("linha 4 (ponte curta, desde indisponível): o motivo traduzido no lugar da frase, e a linha continua tocável", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    const motivo = await page.evaluate(() => {
      const w = window as any;
      const b = w.Alpine.raw(w.Alpine.$data(document.body).json.ponte);
      return w.rent2MotivoTexto(w.ponteJanelasFixas(b, "Total", "BRL").desde.indisponivel);
    });
    expect(motivo.length).toBeGreaterThan(0);
    await expect(linha(page, 4).locator(".diag-indice__estado")).toHaveText(motivo);
    await linha(page, 4).click();
    await expect(page).toHaveURL(/#\/raiox\/diagnostico\/aportes$/);
    await expect(page.locator(".tela-diag-aportes .diag-ensaio")).toBeVisible();
    expect(erros).toEqual([]);
  });

  test("cada linha abre o seu capítulo, e o ← do capítulo volta ao índice", async ({ page }) => {
    const erros = coletarErros(page);
    // A fixture principal (v2.37) tem os quatro capítulos montados; a
    // portfolio_selecao_aportes é anterior ao bloco `atribuicao`.
    await autenticar(page, PRINCIPAL);
    for (const [n, tela] of [[1, ".tela-diagnostico"], [2, ".tela-diag-politica"], [3, ".tela-diag-selecao"], [4, ".tela-diag-aportes"]] as const) {
      await abrir(page);
      await linha(page, n).click();
      await expect(page.locator(`${tela} .diag-ensaio`)).toBeVisible();
      await expect(page.locator(`${tela} .diag-ordinal`)).toHaveText(String(n));
      await page.locator(`${tela} .breadcrumb button`).click();
      await expect(page).toHaveURL(/#\/raiox\/diagnostico$/);
      await expect(page.locator(`${TELA} .diag-indice`)).toBeVisible();
    }
    expect(erros).toEqual([]);
  });
});

// Board 7a.BR.2: o oráculo linha2Esperada espelha a regra; estes casos
// travam a linha 3 (a da seleção desde a 7a.BS.2) com a string exata, escrita à mão, sobre blocos sintéticos
// derivados do fixture principal (Ações BR: indício em 3 anos com t > 0, desde
// inconclusivo; FIIs e EUA inconclusivos em tudo).
test.describe("7a.BR.2 — índice: linha 3 (seleção) por casos literais", () => {
  async function frase(page: Page, mut: string) {
    return page.evaluate((m) => {
      const w = window as any;
      const s = JSON.parse(JSON.stringify(w.Alpine.$data(document.body).json.selecao));
      new Function("s", m)(s);
      return w.selIndiceFrase(s);
    }, mut);
  }

  test("duas classes fortes em 3a/5a com o desde inconclusivo: uma oração por classe, na janela de maior |t|", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    const r = await frase(page, `
      Object.assign(s.classes.fiis.janelas["5a"], { grau: "indicio", t: -1.2 });
      Object.assign(s.classes.eua.janelas["3a"], { grau: "consistente", t: 2.4 });
      Object.assign(s.classes.eua.janelas["5a"], { grau: "indicio", t: 1.1 });`);
    expect(r).toBe("Desde o início, nenhuma classe se separa da sorte. Em 3 anos, Ações BR com indício de ficar à frente do IBOV; em 5 anos, FIIs com indício de ficar atrás do IFIX; em 3 anos, EUA de forma consistente à frente do S&P 500.");
  });

  test("uma consistente e uma com indício no desde: as duas orações e 'a outra, inconclusiva'", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    const r = await frase(page, `
      Object.assign(s.classes.fiis.janelas.desde, { grau: "consistente", t: 2.5 });
      Object.assign(s.classes.eua.janelas.desde, { grau: "indicio", t: -1.3 });`);
    expect(r).toBe("Desde o início, FIIs de forma consistente à frente do IFIX; EUA com indício de ficar atrás do S&P 500; a outra, inconclusiva. Em 3 anos, Ações BR com indício de ficar à frente do IBOV.");
  });

  test("classe curta no resto suprime a cauda 'inconclusiva'", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    const r = await frase(page, `
      Object.assign(s.classes.fiis.janelas.desde, { grau: "consistente", t: 2.5 });
      Object.assign(s.classes.eua.janelas.desde, { grau: "curto", n_meses: 20 });`);
    expect(r).toBe("Desde o início, FIIs de forma consistente à frente do IFIX. Em 3 anos, Ações BR com indício de ficar à frente do IBOV.");
  });
});

test.describe("7a.BR.2 — índice: regras de forma (spec §6.6)", () => {
  for (const [nome, corpo] of [["normal", PRINCIPAL], ["aportes", APORTES], ["nulo", NULO]] as const) {
    test(`face sem travessão nem termos técnicos (${nome})`, async ({ page }) => {
      const erros = coletarErros(page);
      await autenticar(page, corpo);
      await abrir(page);
      const face = await faceTexto(page, TELA);
      expect(face).not.toMatch(/[—–]|--/);
      expect(face).not.toMatch(PROIBIDOS);
      expect(erros).toEqual([]);
    });
  }

  for (const largura of [320, 390] as const) {
    test(`a ${largura} px nada passa da coluna`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: 800 });
      await autenticar(page, INDICIO);
      await abrir(page);
      const r = await medirForma(page, TELA, ".diag-indice");
      expect(r.sw).toBeLessThanOrEqual(r.cw);
      expect(r.fora).toEqual([]);
    });
  }

  test("Modo Plantão: pergunta, estado e borda leem os tokens escuros", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("tema", "dark"));
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    const ink = await corDoToken(page, "--ink");
    const n200 = await corDoToken(page, "--neutral-200");
    const r = await page.evaluate(() => {
      const a = document.querySelector('.tela-diag-indice [data-testid="diag-indice-2"]')!;
      return {
        tema: document.documentElement.getAttribute("data-theme"),
        estado: getComputedStyle(a.querySelector(".diag-indice__estado")!).color,
        borda: getComputedStyle(a).borderBottomColor,
      };
    });
    expect(r.tema).toBe("dark");
    expect(r.estado).toBe(ink);
    expect(r.borda).toBe(n200);
  });
});
