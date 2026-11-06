import { test, expect, Page } from "@playwright/test";
import { fx, autenticar, abrirTela, coletarErros, norm, faceTexto, PROIBIDOS, medirForma, corDoToken } from "./diag-comum";

// Fase 7a.BR.2 — capítulo 2 "Seus picks batem o índice?"
// (#/raiox/diagnostico/selecao, spec §6.3 e §6.5). O bloco `selecao` chega
// pronto do backend; o teste lê o payload decifrado e formata o esperado com
// os formatadores da casa (diagPct1, rent2Abs1, ponteRoundPy, rent2MmmAa),
// salvo onde trava copy (frases do grau, item 2 da §8, verbatim).
const PRINCIPAL = fx("portfolio.test.json.enc");
const NULO = fx("portfolio_selecao_null.test.json.enc");
const PRE236 = fx("portfolio_pre_v236.test.json.enc");
const INDICIO = fx("portfolio_selecao_indicio.test.json.enc");
const DIVERGEM = fx("portfolio_selecao_divergem.test.json.enc");
const CURTO = fx("portfolio_selecao_curto.test.json.enc");
const INDISPONIVEL = fx("portfolio_selecao_indisponivel.test.json.enc");

const TELA = ".tela-diag-selecao";
const classe = (page: Page, cl: string) => page.locator(`${TELA} section.sel-classe[data-classe="${cl}"]`);
const JANELAS = ["3a", "5a", "desde"] as const;

// Geometria da régua (spec §6.3): viewBox 0..300, margem de 12 de cada lado,
// t de −3 a 3. O ponto fica preso às pontas.
const REGUA_X = (t: number) => 12 + ((Math.max(-3, Math.min(3, t)) + 3) / 6) * 276;

const GRAU: Record<string, [string, string]> = {
  inconclusivo: ["Inconclusivo.", "Ainda não dá para separar habilidade de sorte."],
  indicio: ["Indício.", "A diferença começa a ir além da sorte, mas ainda não é prova."],
  consistente: ["Consistente.", "Difícil explicar só por sorte."],
};

test.use({ viewport: { width: 390, height: 844 } });

async function abrir(page: Page) {
  await abrirTela(page, "#/raiox/diagnostico/selecao", TELA, ".diag-ensaio");
}

async function escolher(page: Page, k: string) {
  await page.locator(`${TELA} [data-testid="sel-janela-${k}"]`).click();
  await expect(page.locator(`${TELA} [data-testid="sel-janela-${k}"]`)).toHaveAttribute("aria-pressed", "true");
}

async function janela(page: Page, cl: string, k: string) {
  return page.evaluate(([c, kk]) => {
    const w = window as any;
    const s = w.Alpine.$data(document.body).json.selecao;
    const j = s.classes[c].janelas[kk];
    const r = j.diferenca_aa === null ? null : w.ponteRoundPy(j.diferenca_aa * 100, 1);
    return {
      j, excluidos: s.classes[c].excluidos,
      P: j.picks_aa === null ? null : w.diagPct1(j.picks_aa),
      I: j.indice_aa === null ? null : w.diagPct1(j.indice_aa),
      r, D: r === null ? null : w.rent2Abs1(r),
      de: j.de ? w.rent2MmmAa(j.de) : null, ate: w.rent2MmmAa(j.ate),
      motivo: j.indisponivel ? w.rent2MotivoTexto(j.indisponivel) : null,
    };
  }, [cl, k] as const);
}

function fraseEsperada(cl: string, w: Awaited<ReturnType<typeof janela>>) {
  const sujeito = cl === "fiis" ? "Seus fundos" : "Seus picks";
  const ind = { acoes_br: "IBOV", fiis: "IFIX", eua: "S&P 500" }[cl];
  const unid = w.j.anualizado ? "ao ano" : "no período";
  const moeda = cl === "eua" ? " em dólar" : "";
  const fim = w.r === 0 ? "Ficaram empatados."
    : `Ficaram ${w.D} ${Math.abs(w.r!) < 2 ? "ponto" : "pontos"} ${unid} ${w.r! > 0 ? "à frente" : "atrás"}.`;
  return `${sujeito} renderam ${w.P} ${unid}${moeda}; o ${ind}, ${w.I}. ${fim}`;
}

test.describe("7a.BR.2 — capítulo 2", () => {
  test("abre em Desde, com ordinal, título e a linha que explica a pergunta", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    await expect(page.locator(`${TELA} .diag-ordinal`)).toHaveText("2");
    await expect(page.locator(`${TELA} .diag-titulo`)).toHaveText("Seus picks batem o índice?");
    await expect(page.locator(`${TELA} .sel-pergunta`)).toHaveText(
      "Por habilidade ou por sorte: quanto maior e mais regular a diferença mês a mês, menos ela se explica por sorte.");
    await expect(page.locator(`${TELA} [data-testid="sel-janela-desde"]`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(`${TELA} [data-testid="sel-janela-desde"]`)).toHaveText("Desde o início");
    await expect(page.locator(`${TELA} [data-testid="sel-janela-3a"]`)).toHaveText("3 anos");
    await expect(page.locator(`${TELA} [data-testid="sel-janela-5a"]`)).toHaveText("5 anos");
    // Sem escopo: as três classes juntas.
    await expect(page.locator(`${TELA} .escopo-toggle`)).toHaveCount(0);
    expect(erros).toEqual([]);
  });

  test("uma seção por classe na ordem Ações BR, FIIs, EUA, com o ponto da cor da categoria e '× índice'", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    const ordem = await page.locator(`${TELA} section.sel-classe`).evaluateAll((els) => els.map((e) => e.getAttribute("data-classe")));
    expect(ordem).toEqual(["acoes_br", "fiis", "eua"]);
    const cab = { acoes_br: ["Ações BR", "× IBOV", "--cat-acoes-br"], fiis: ["FIIs", "× IFIX", "--cat-fii"], eua: ["EUA", "× S&P 500, em dólar", "--cat-eua"] };
    for (const [cl, [nome, ind, token]] of Object.entries(cab)) {
      await expect(classe(page, cl).locator(".sel-classe__nome")).toHaveText(nome);
      await expect(classe(page, cl).locator(".sel-classe__indice")).toHaveText(ind);
      const cor = await classe(page, cl).locator(".sel-ponto").evaluate((e) => getComputedStyle(e).backgroundColor);
      expect(cor).toBe(await corDoToken(page, token));
    }
  });

  for (const k of JANELAS) {
    test(`frase dos números em ${k}: 'Seus picks|Seus fundos renderam P ao ano; o índice, I. Ficaram D ponto(s) ao ano à frente|atrás.'`, async ({ page }) => {
      const erros = coletarErros(page);
      await autenticar(page, PRINCIPAL);
      await abrir(page);
      await escolher(page, k);
      for (const cl of ["acoes_br", "fiis", "eua"]) {
        const w = await janela(page, cl, k);
        await expect(classe(page, cl).locator('[data-testid="sel-frase"]')).toHaveText(fraseEsperada(cl, w));
      }
      expect(erros).toEqual([]);
    });
  }

  test("EUA em 5 anos (diferença que arredonda a 0,0): 'Ficaram empatados.'", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    await escolher(page, "5a");
    const w = await janela(page, "eua", "5a");
    expect(w.r).toBe(0);
    await expect(classe(page, "eua").locator('[data-testid="sel-frase"]')).toContainText("Ficaram empatados.");
  });

  test("helpers puros: selFrase com diferença 0,0004 diz 'Ficaram empatados.'; o ponto da régua fica preso às pontas", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    const r = await page.evaluate(() => {
      const w = window as any;
      const j = { anualizado: true, picks_aa: 0.1, indice_aa: 0.0996, diferenca_aa: 0.0004 };
      const txt = (segs: any[]) => segs.map((s) => s.t).join("");
      return {
        frase: txt(w.selFrase("acoes_br", "IBOV", j)),
        positiva: txt(w.selFrase("fiis", "IFIX", { ...j, diferenca_aa: 0.012 })),
        dolar: txt(w.selFrase("eua", "S&P 500", { ...j, anualizado: false, diferenca_aa: -0.03 })),
        x42: w.selReguaX(4.2), x3: w.selReguaX(3), xm9: w.selReguaX(-9), xm3: w.selReguaX(-3), x0: w.selReguaX(0), x1: w.selReguaX(1),
      };
    });
    expect(r.frase).toBe("Seus picks renderam 10,0% ao ano; o IBOV, 10,0%. Ficaram empatados.");
    expect(r.positiva).toBe("Seus fundos renderam 10,0% ao ano; o IFIX, 10,0%. Ficaram 1,2 ponto ao ano à frente.");
    expect(r.dolar).toBe("Seus picks renderam 10,0% no período em dólar; o S&P 500, 10,0%. Ficaram 3,0 pontos no período atrás.");
    expect(r.x42).toBe(r.x3);
    expect(r.xm9).toBe(r.xm3);
    expect(r.x3).toBeCloseTo(REGUA_X(3), 6);
    expect(r.xm3).toBeCloseTo(REGUA_X(-3), 6);
    expect(r.x0).toBeCloseTo(150, 6);
    expect(r.x1).toBeGreaterThan(r.x0);
  });

  for (const [nome, corpo] of [["normal", PRINCIPAL], ["indicio", INDICIO]] as const) {
    test(`régua (${nome}): SVG role=img, ponto no t de cada classe do lado certo do zero, faixa e ponto sem cor de ganho ou perda`, async ({ page }) => {
      await autenticar(page, corpo);
      await abrir(page);
      const ink = await corDoToken(page, "--ink");
      const n200 = await corDoToken(page, "--neutral-200");
      for (const k of JANELAS) {
        await escolher(page, k);
        for (const cl of ["acoes_br", "fiis", "eua"]) {
          const w = await janela(page, cl, k);
          const svg = classe(page, cl).locator('.sel-regua svg[role="img"]');
          await expect(svg).toHaveCount(1);
          const g = await svg.evaluate((s) => {
            const c = s.querySelector(".sel-regua__ponto")!;
            const z = s.querySelector(".sel-regua__zero")!;
            const f = s.querySelector(".sel-regua__faixa")!;
            return {
              cx: Number(c.getAttribute("cx")), x0: Number(z.getAttribute("x1")),
              fx: Number(f.getAttribute("x")), fw: Number(f.getAttribute("width")),
              ponto: getComputedStyle(c).fill, faixa: getComputedStyle(f).fill,
              aria: s.getAttribute("aria-label") || "",
              tracos: s.querySelectorAll(".sel-regua__traco").length,
              vb: s.getAttribute("viewBox"),
            };
          });
          expect(g.vb).toBe("0 0 300 36");
          expect(g.cx, `${cl} ${k}`).toBeCloseTo(REGUA_X(w.j.t), 4);
          expect(Math.sign(g.cx - g.x0), `${cl} ${k}: lado do ponto`).toBe(Math.sign(w.j.t));
          expect(g.fx).toBeCloseTo(REGUA_X(-1), 4);
          expect(g.fx + g.fw).toBeCloseTo(REGUA_X(1), 4);
          expect(g.tracos).toBe(4);
          expect(g.ponto).toBe(ink);
          expect(g.faixa).toBe(n200);
          const lado = w.j.t < 0 ? "atrás" : "à frente";
          expect(g.aria).toContain(GRAU[w.j.grau][0].replace(".", "").toLowerCase());
          expect(g.aria).toContain(lado);
          const rot = await classe(page, cl).locator(".sel-regua__rotulos span").allTextContents();
          expect(rot).toEqual(["atrás do índice", "à frente"]);
        }
      }
    });
  }

  test("grau em uma frase com o rótulo em negrito (item 2 da §8, verbatim), e a linha cinza com os anos e os meses", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    for (const k of JANELAS) {
      await escolher(page, k);
      for (const cl of ["acoes_br", "fiis", "eua"]) {
        const w = await janela(page, cl, k);
        const [rotulo, texto] = GRAU[w.j.grau];
        const grau = classe(page, cl).locator('[data-testid="sel-grau"]');
        await expect(grau.locator("strong")).toHaveText(rotulo);
        await expect(grau).toHaveText(`${rotulo} ${texto}`);
        const anos = w.j.anos_para_afirmar;
        const n = Math.round(anos);
        const esperadoAnos = anos > 100 ? "Nesse ritmo, seriam precisos mais de 100 anos de histórico para afirmar."
          : `Nesse ritmo, seriam precisos uns ${n} anos de histórico para afirmar.`;
        await expect(classe(page, cl).locator('[data-testid="sel-anos"]')).toHaveText(esperadoAnos);
        await expect(classe(page, cl).locator('[data-testid="sel-meses"]')).toHaveText(`${w.j.n_meses} meses com picks, de ${w.de} a ${w.ate}.`);
      }
    }
  });

  test("consistente (variante indicio, FIIs desde): a linha dos anos some", async ({ page }) => {
    await autenticar(page, INDICIO);
    await abrir(page);
    const w = await janela(page, "fiis", "desde");
    expect(w.j.grau).toBe("consistente");
    await expect(classe(page, "fiis").locator('[data-testid="sel-grau"]')).toHaveText("Consistente. Difícil explicar só por sorte.");
    await expect(classe(page, "fiis").locator('[data-testid="sel-anos"]')).toHaveCount(0);
    await expect(classe(page, "fiis").locator('[data-testid="sel-meses"]')).toBeVisible();
  });

  test("EUA: a frase dos fundos fora da política conta só os fundos (XFND, k = 1); só com o rebate, some", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    const w = await janela(page, "eua", "desde");
    expect(w.excluidos).toEqual(["XFND"]);
    await expect(classe(page, "eua").locator('[data-testid="sel-fundos"]')).toHaveText(
      "Fundos que você teve fora da política (1) ficam fora da conta: são fundos, não escolha de empresa.");
    await expect(classe(page, "acoes_br").locator('[data-testid="sel-fundos"]')).toHaveCount(0);
  });

  test("EUA com excluidos só do rebate (variante indicio): a frase dos fundos some", async ({ page }) => {
    await autenticar(page, INDICIO);
    await abrir(page);
    expect((await janela(page, "eua", "desde")).excluidos).toEqual(["AVNU_REBATE"]);
    await expect(classe(page, "eua").locator('[data-testid="sel-fundos"]')).toHaveCount(0);
  });

  test("nota de honestidade sempre visível, 'Ver a conta' fechado com uma tabela por janela e a linha da ponte, e o aviso", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    await expect(page.locator(`${TELA} .sel-nota`)).toHaveText(
      "A régua mede a diferença média mês a mês contra o quanto ela oscila. A faixa cinza é onde a sorte explica o resultado; o primeiro traço depois dela é o indício, o segundo, o consistente. Os picks incluem os papéis que já saíram da carteira; ETFs de índice ficam fora. Fala do passado e não garante o futuro.");
    const det = page.locator(`${TELA} details.diag-conta`);
    await expect(det).not.toHaveAttribute("open", "");
    await expect(det.locator(".sel-tabela").first()).toBeHidden();
    await det.locator("summary").click();
    await expect(det.locator(".sel-tabela")).toHaveCount(3);
    const txt = norm(await det.textContent());
    expect(txt).toContain("tracking error");
    expect(txt).toContain("Information Ratio");
    expect(txt).toMatch(/estatística t/i);
    expect(txt).toContain("a ponte mostra quanto cada classe somou à carteira; a régua mede os picks contra o próprio índice");
    // A tabela de Desde traz os meses de cada classe.
    for (const cl of ["acoes_br", "fiis", "eua"]) {
      const w = await janela(page, cl, "desde");
      await expect(det.locator('.sel-tabela[data-janela="desde"] tr[data-linha="meses"]')).toContainText(String(w.j.n_meses));
    }
    await expect(page.locator(`${TELA} .diag-aviso`)).toHaveText("Rentabilidade passada não garante rentabilidade futura.");
  });
});

test.describe("7a.BR.2 — capítulo 2: estados (spec §6.5)", () => {
  test("janela indisponível numa classe: o motivo traduzido no lugar da frase e da régua; EUA segue", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page, INDISPONIVEL);
    await abrir(page);
    for (const cl of ["acoes_br", "fiis"]) {
      const w = await janela(page, cl, "desde");
      expect(w.motivo).toMatch(/^Falta a cotação de um ativo em [a-z]{3}\/\d{2}\.$/);
      await expect(classe(page, cl).locator('[data-testid="sel-motivo"]')).toHaveText(w.motivo!);
      await expect(classe(page, cl).locator('[data-testid="sel-frase"]')).toHaveCount(0);
      await expect(classe(page, cl).locator(".sel-regua")).toHaveCount(0);
      await expect(classe(page, cl).locator('[data-testid="sel-grau"]')).toHaveCount(0);
    }
    await expect(classe(page, "eua").locator('[data-testid="sel-frase"]')).toBeVisible();
    await expect(classe(page, "eua").locator(".sel-regua svg")).toBeVisible();
    expect(erros).toEqual([]);
  });

  test("curto (EUA a 20 meses): a frase dos números fica, a régua some, o grau diz o histórico curto", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page, CURTO);
    await abrir(page);
    for (const k of JANELAS) {
      await escolher(page, k);
      const w = await janela(page, "eua", k);
      expect(w.j.grau).toBe("curto");
      await expect(classe(page, "eua").locator('[data-testid="sel-frase"]')).toHaveText(fraseEsperada("eua", w));
      await expect(classe(page, "eua").locator(".sel-regua")).toHaveCount(0);
      await expect(classe(page, "eua").locator('[data-testid="sel-grau"]')).toHaveText("Histórico curto: menos de 3 anos com picks nesta janela.");
      await expect(classe(page, "eua").locator('[data-testid="sel-grau"] strong')).toHaveText("Histórico curto:");
      // O grau já diz que é cedo: sem "Nesse ritmo, seriam precisos…" (ajuste
      // pós-Alfred, 06/11), mas os meses com picks ficam.
      expect(w.j.anos_para_afirmar).not.toBeNull();
      await expect(classe(page, "eua").locator('[data-testid="sel-anos"]')).toHaveCount(0);
      await expect(classe(page, "eua").locator('[data-testid="sel-meses"]')).toBeVisible();
      await expect(classe(page, "eua")).not.toContainText("Nesse ritmo");
      await expect(classe(page, "acoes_br").locator(".sel-regua svg")).toBeVisible();
    }
    expect(erros).toEqual([]);
  });

  test("sinais que discordam: grau inconclusivo e a linha cinza acrescenta a frase das duas medidas", async ({ page }) => {
    await autenticar(page, DIVERGEM);
    await abrir(page);
    const w = await janela(page, "acoes_br", "desde");
    expect(w.j.sinais_divergem).toBe(true);
    await expect(classe(page, "acoes_br").locator('[data-testid="sel-grau"]')).toHaveText("Inconclusivo. Ainda não dá para separar habilidade de sorte.");
    await expect(classe(page, "acoes_br").locator('[data-testid="sel-divergem"]')).toHaveText(
      "A diferença composta e a média mês a mês apontam para lados opostos.");
    await expect(classe(page, "fiis").locator('[data-testid="sel-divergem"]')).toHaveCount(0);
  });

  for (const [nome, corpo] of [["selecao null", NULO], ["pré-v2.36", PRE236]] as const) {
    test(`payload ${nome}: 'Confiança da seleção indisponível hoje.', sem classes nem erro`, async ({ page }) => {
      const erros = coletarErros(page);
      await autenticar(page, corpo);
      await page.goto("/#/raiox/diagnostico/selecao");
      await expect(page.locator(TELA)).toContainText("Confiança da seleção indisponível hoje.");
      await expect(page.locator(`${TELA} section.sel-classe`)).toHaveCount(0);
      expect(erros).toEqual([]);
    });
  }

  const TRUNCADOS: [string, string][] = [
    ["janela sem t", "delete s.classes.eua.janelas.desde.t;"],
    ["grau fora do enum", "s.classes.fiis.janelas['3a'].grau = 'otimo';"],
    ["sem a janela 5a", "delete s.classes.acoes_br.janelas['5a'];"],
    ["excluidos que não é lista", "s.classes.eua.excluidos = 'XFND';"],
    ["motivo vazio", "s.classes.fiis.janelas.desde.indisponivel = '';"],
    // Board 7a.BR.2: nenhuma classe conhecida não é bloco válido.
    ["classes vazio", "s.classes = {};"],
  ];
  for (const [nome, mutacao] of TRUNCADOS) {
    test(`bloco parcial (${nome}): indisponível hoje, nenhum erro`, async ({ page }) => {
      const erros = coletarErros(page);
      await autenticar(page, PRINCIPAL);
      await page.evaluate((m) => {
        const d = (window as any).Alpine.$data(document.body);
        const s = JSON.parse(JSON.stringify(d.json.selecao));
        new Function("s", m)(s);
        d.json = { ...d.json, selecao: s };
      }, mutacao);
      await page.goto("/#/raiox/diagnostico/selecao");
      await expect(page.locator(TELA)).toContainText("Confiança da seleção indisponível hoje.");
      await page.goto("/#/raiox/diagnostico");
      await expect(page.locator('.tela-diag-indice [data-testid="diag-indice-2"] .diag-indice__estado')).toHaveText("Indisponível hoje.");
      expect(erros).toEqual([]);
    });
  }
});

// Board 7a.BR.2: ramos dos helpers que nenhuma fixture alcança.
test.describe("7a.BR.2 — capítulo 2: ramos dos helpers", () => {
  test("selAnosTexto: acima de 100 anos, piso de 1 ano e sem número", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    const r = await page.evaluate(() => {
      const w = window as any;
      const j = (a: number | null) => ({ grau: "inconclusivo", anos_para_afirmar: a });
      return { cem: w.selAnosTexto(j(150)), piso: w.selAnosTexto(j(0.6)), nulo: w.selAnosTexto(j(null)) };
    });
    expect(r.cem).toBe("Nesse ritmo, seriam precisos mais de 100 anos de histórico para afirmar.");
    expect(r.piso).toBe("Nesse ritmo, seria preciso cerca de 1 ano de histórico para afirmar.");
    expect(r.nulo).toBe("");
  });

  test("t = 0 (estado sintético, inconclusivo): ponto no zero e o aria diz 'empatado com o IBOV'", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page, PRINCIPAL);
    await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      const s = JSON.parse(JSON.stringify(d.json.selecao));
      Object.assign(s.classes.acoes_br.janelas.desde, { t: 0, grau: "inconclusivo", sinais_divergem: false });
      d.json = { ...d.json, selecao: s };
    });
    await abrir(page);
    const svg = classe(page, "acoes_br").locator('.sel-regua svg[role="img"]');
    await expect(svg).toHaveAttribute("aria-label", "Régua da confiança: inconclusivo, empatado com o IBOV.");
    expect(Number(await svg.locator(".sel-regua__ponto").getAttribute("cx"))).toBeCloseTo(150, 6);
    expect(erros).toEqual([]);
  });
});

test.describe("7a.BR.2 — capítulo 2: regras de forma (spec §6.6)", () => {
  for (const [nome, corpo] of [["normal", PRINCIPAL], ["curto", CURTO], ["indisponivel", INDISPONIVEL], ["divergem", DIVERGEM], ["nulo", NULO]] as const) {
    test(`face sem travessão nem termos técnicos (${nome}), nas três janelas`, async ({ page }) => {
      const erros = coletarErros(page);
      await autenticar(page, corpo);
      await page.goto("/#/raiox/diagnostico/selecao");
      await expect(page.locator(TELA)).toBeVisible();
      for (const k of nome === "nulo" ? ["desde"] : JANELAS) {
        if (nome !== "nulo") await escolher(page, k);
        const face = await faceTexto(page, TELA);
        expect(face).not.toMatch(/[—–]|--/);
        expect(face).not.toMatch(PROIBIDOS);
      }
      expect(erros).toEqual([]);
    });
  }

  for (const largura of [320, 390] as const) {
    for (const [nome, corpo] of [["normal", PRINCIPAL], ["curto", CURTO], ["indisponivel", INDISPONIVEL]] as const) {
      test(`a ${largura} px (${nome}): nada passa da coluna e a régua cabe nela`, async ({ page }) => {
        await page.setViewportSize({ width: largura, height: 800 });
        await autenticar(page, corpo);
        await abrir(page);
        await page.locator(`${TELA} details.diag-conta summary`).click();
        const r = await medirForma(page, TELA, ".diag-ensaio");
        expect(r.sw).toBeLessThanOrEqual(r.cw);
        expect(r.fora).toEqual([]);
        for (const f of r.folgas) expect(f.folga, f.linha).toBeGreaterThanOrEqual(8);
        const caixas = await page.locator(`${TELA} .sel-regua svg`).evaluateAll((els) => {
          const col = document.querySelector(".tela-diag-selecao .diag-ensaio")!.getBoundingClientRect();
          return els.map((e) => { const b = e.getBoundingClientRect(); return { l: b.left - col.left, r: col.right - b.right, w: b.width }; });
        });
        expect(caixas.length).toBeGreaterThan(0);
        for (const c of caixas) { expect(c.l).toBeGreaterThanOrEqual(-0.5); expect(c.r).toBeGreaterThanOrEqual(-0.5); expect(c.w).toBeGreaterThan(200); }
        // Verificação visual da Task 7: a 320 px "−1,0%" encostava no valor
        // vizinho (6 px), e o sinal de menos lia como parte da célula ao lado.
        // Mede a folga entre os TEXTOS de células vizinhas da mesma linha.
        const folgasTabela = await page.locator(`${TELA} .sel-tabela tr`).evaluateAll((trs) => {
          const caixa = (el: Element) => { const rg = document.createRange(); rg.selectNodeContents(el); return rg.getBoundingClientRect(); };
          const out: { linha: string; folga: number }[] = [];
          for (const tr of trs) {
            const cel = Array.from(tr.children).map(caixa).filter((b) => b.width > 0);
            for (let i = 1; i < cel.length; i++) out.push({ linha: (tr.textContent || "").trim().slice(0, 40), folga: cel[i].left - cel[i - 1].right });
          }
          return out;
        });
        expect(folgasTabela.length).toBeGreaterThan(0);
        for (const f of folgasTabela) expect(f.folga, f.linha).toBeGreaterThanOrEqual(8);
      });
    }
  }

  test("janelas novas herdam a fonte do texto (font: inherit)", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    const r = await page.evaluate(() => {
      const b = document.querySelector('.tela-diag-selecao [data-testid="sel-janela-3a"]')!;
      return { botao: getComputedStyle(b).fontFamily, corpo: getComputedStyle(document.querySelector(".tela-diag-selecao .diag-ensaio")!).fontFamily };
    });
    expect(r.botao).toBe(r.corpo);
  });

  test("Modo Plantão: ponto, faixa e zero da régua leem os tokens escuros", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("tema", "dark"));
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    const ink = await corDoToken(page, "--ink");
    const n200 = await corDoToken(page, "--neutral-200");
    const gray = await corDoToken(page, "--gray");
    const r = await page.evaluate(() => {
      const s = document.querySelector(".tela-diag-selecao .sel-regua svg")!;
      return {
        tema: document.documentElement.getAttribute("data-theme"),
        ponto: getComputedStyle(s.querySelector(".sel-regua__ponto")!).fill,
        faixa: getComputedStyle(s.querySelector(".sel-regua__faixa")!).fill,
        zero: getComputedStyle(s.querySelector(".sel-regua__zero")!).stroke,
        rotulo: getComputedStyle(document.querySelector(".tela-diag-selecao .sel-regua__rotulos span")!).color,
        destaques: Array.from(document.querySelectorAll(".tela-diag-selecao .sel-frase strong")).map((e) => getComputedStyle(e).color),
      };
    });
    expect(r.tema).toBe("dark");
    // Critique 7a.BR.2: o destaque da frase em --g-900 virava menta no
    // Plantão e pintava "atrás" na cor do ganho; o grau não é mérito.
    expect(r.destaques.length).toBeGreaterThan(0);
    for (const c of r.destaques) expect(c).toBe(ink);
    expect(r.ponto).toBe(ink);
    expect(r.faixa).toBe(n200);
    expect(r.zero).toBe(ink);
    expect(r.rotulo).toBe(gray);
  });
});
