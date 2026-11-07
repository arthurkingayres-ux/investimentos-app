import { test, expect, Page } from "@playwright/test";
import { fx, autenticar, abrirTela, coletarErros, norm, faceTexto, PROIBIDOS, medirForma, escalarValorFinal } from "./diag-comum";

// Fase 7a.BR.2 — capítulo 3 "O momento dos seus aportes"
// (#/raiox/diagnostico/aportes, spec §6.4 e §5.2). O número é XIRR − TWR da
// ponte, nas janelas fixas de ponteJanelasFixas, no escopo e na moeda
// escolhidos; nunca TWR − XIRR. A ponte publicada no fixture principal é curta
// (janelas indisponíveis): os testes com número abrem portfolio_selecao_aportes
// (ponte longa de 72 meses, XIRR em todos os escopos).
const PRINCIPAL = fx("portfolio.test.json.enc");
const APORTES = fx("portfolio_selecao_aportes.test.json.enc");
const PRE236 = fx("portfolio_pre_v236.test.json.enc");

const TELA = ".tela-diag-aportes";
const JANELAS = ["3a", "5a", "desde"] as const;
const SUJEITO: Record<string, string> = { Total: "", Brasil: " da parte brasileira", EUA: " da parte americana" };

test.use({ viewport: { width: 390, height: 844 } });

async function abrir(page: Page) {
  await abrirTela(page, "#/raiox/diagnostico/aportes", TELA, ".diag-ensaio");
}

async function escolherEscopo(page: Page, escopo: string, moeda?: string) {
  await page.locator(`${TELA} [data-apor-escopo="${escopo}"]`).click();
  if (moeda) await page.locator(`${TELA} [data-apor-moeda="${moeda}"]`).click();
}

async function escolherJanela(page: Page, k: string) {
  await page.locator(`${TELA} [data-testid="apor-janela-${k}"]`).click();
}

// A janela da ponte, calculada à parte pela gêmea JS (ponteJanelasFixas).
async function esperado(page: Page, escopo: string, moeda: string, k: string) {
  return page.evaluate(([e, m, kk]) => {
    const w = window as any;
    const b = w.Alpine.raw(w.Alpine.$data(document.body).json.ponte);
    const nTotal = b.meses.length - 1;
    const m0 = Math.max(w.ponteInicioEscopo(b, e, m), 1);
    const tam: Record<string, number> = { "3a": 36, "5a": 60 };
    const iIni = kk === "desde" ? m0 : nTotal - tam[kk] + 1;
    const j = w.ponteJanelasFixas(b, e, m)[kk];
    const d = j.xirr === null || j.sua === null ? null : j.xirr - j.sua;
    const r = d === null ? null : w.ponteRoundPy(d * 100, 1);
    return {
      disponivel: j.indisponivel === null, motivo: w.rent2MotivoTexto(j.indisponivel),
      anualizado: j.anualizado, n: j.n_meses, xirrNulo: j.xirr === null,
      ancora: w.rent2MmmAa(b.meses[iIni - 1]), ate: w.rent2MmmAa(b.meses[nTotal]),
      r, X: r === null ? null : w.rent2Abs1(r),
      sua: j.sua === null ? null : w.diagPct1(j.sua), xirr: j.xirr === null ? null : w.diagPct1(j.xirr),
    };
  }, [escopo, moeda, k] as const);
}

function fraseEsperada(e: Awaited<ReturnType<typeof esperado>>, escopo: string) {
  const base = `Desde ${e.ancora}, o calendário dos aportes${SUJEITO[escopo]}`;
  if (Math.abs(e.r!) < 0.5) return `${base} quase não mudou o seu retorno.`;
  const verbo = e.r! > 0 ? "somou" : "tirou";
  const pp = Math.abs(e.r!) < 2 ? "ponto" : "pontos";
  return `${base} ${verbo} ${e.X} ${pp} ${e.anualizado ? "ao ano" : "no período"} ${e.r! > 0 ? "ao" : "do"} seu retorno.`;
}

test.describe("7a.BR.2 — capítulo 3", () => {
  test("abre em Total e Desde, com ordinal e título; os controles são os do capítulo 1", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page, APORTES);
    await abrir(page);
    await expect(page.locator(`${TELA} .diag-ordinal`)).toHaveText("4");
    await expect(page.locator(`${TELA} .diag-titulo`)).toHaveText("O momento dos seus aportes");
    await expect(page.locator(`${TELA} [data-apor-escopo="Total"]`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(`${TELA} [data-testid="apor-janela-desde"]`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(`${TELA} [data-apor-moeda="BRL"]`)).toBeHidden();
    await escolherEscopo(page, "EUA");
    await expect(page.locator(`${TELA} [data-apor-moeda="BRL"]`)).toHaveAttribute("aria-pressed", "true");
    expect(erros).toEqual([]);
  });

  const CASOS: [string, string][] = [["Total", "BRL"], ["Brasil", "BRL"], ["EUA", "BRL"], ["EUA", "USD"]];
  for (const fator of [1, 1.1] as const)
  for (const [escopo, moeda] of CASOS) {
    test(`frase-resposta, linha 'até', e os dois números (${escopo} ${moeda}, valor final × ${fator}) nas três janelas: X = XIRR − TWR`, async ({ page }) => {
      const erros = coletarErros(page);
      await autenticar(page, APORTES);
      await escalarValorFinal(page, fator);
      await abrir(page);
      if (escopo !== "Total") await escolherEscopo(page, escopo, moeda === "USD" ? "USD" : undefined);
      for (const k of JANELAS) {
        await escolherJanela(page, k);
        const e = await esperado(page, escopo, moeda, k);
        expect(e.disponivel, `${escopo} ${moeda} ${k}`).toBe(true);
        expect(e.xirrNulo).toBe(false);
        await expect(page.locator(`${TELA} [data-testid="apor-janela-${k}"]`)).toHaveAttribute("aria-pressed", "true");
        await expect(page.locator(`${TELA} [data-testid="apor-frase"]`)).toHaveText(fraseEsperada(e, escopo));
        await expect(page.locator(`${TELA} [data-testid="apor-ate"]`)).toHaveText(`até ${e.ate} · ${e.n} meses`);
        await expect(page.locator(`${TELA} [data-testid="apor-carteira"]`)).toHaveText(`${e.sua} ${e.anualizado ? "ao ano" : "no período"}`);
        await expect(page.locator(`${TELA} [data-testid="apor-dinheiro"]`)).toHaveText(`${e.xirr} ${e.anualizado ? "ao ano" : "no período"}`);
      }
      expect(erros).toEqual([]);
    });
  }

  for (const fator of [1.1, 0.9] as const)
  test(`o sinal segue XIRR − TWR (valor final × ${fator}): 'somou' quando o seu dinheiro rendeu mais que a carteira, 'tirou' quando menos`, async ({ page }) => {
    await autenticar(page, APORTES);
    await escalarValorFinal(page, fator);
    await abrir(page);
    let comNumero = 0;
    for (const [escopo, moeda] of CASOS) {
      await escolherEscopo(page, escopo, escopo === "EUA" ? moeda : undefined);
      for (const k of JANELAS) {
        await escolherJanela(page, k);
        const e = await esperado(page, escopo, moeda, k);
        if (Math.abs(e.r!) < 0.5) continue;
        comNumero++;
        expect(Math.sign(e.r!)).toBe(fator > 1 ? 1 : -1);
        const frase = page.locator(`${TELA} [data-testid="apor-frase"] strong`);
        await expect(frase).toHaveText(`${e.r! > 0 ? "somou" : "tirou"} ${e.X} ${Math.abs(e.r!) < 2 ? "ponto" : "pontos"}`);
      }
    }
    expect(comNumero).toBeGreaterThan(0);
  });

  test("helper puro: diferença de 0,004 'quase não mudou'; XIRR nulo diz que não deu para calcular", async ({ page }) => {
    await autenticar(page, APORTES);
    const r = await page.evaluate(() => {
      const w = window as any;
      const txt = (segs: any[]) => segs.map((s) => s.t).join("");
      return {
        quase: txt(w.aporFrase({ sua: 0.10, xirr: 0.104, anualizado: true }, "Desde jan/20", "")),
        somou: txt(w.aporFrase({ sua: 0.10, xirr: 0.107, anualizado: true }, "Desde jan/20", "")),
        tirou: txt(w.aporFrase({ sua: 0.10, xirr: 0.075, anualizado: false }, "Desde jan/20", " da parte americana")),
        nulo: txt(w.aporFrase({ sua: 0.10, xirr: null, anualizado: true }, "Desde jan/20", "")),
      };
    });
    expect(r.quase).toBe("Desde jan/20, o calendário dos aportes quase não mudou o seu retorno.");
    expect(r.somou).toBe("Desde jan/20, o calendário dos aportes somou 0,7 ponto ao ano ao seu retorno.");
    expect(r.tirou).toBe("Desde jan/20, o calendário dos aportes da parte americana tirou 2,5 pontos no período do seu retorno.");
    expect(r.nulo).toBe("Não deu para calcular o retorno do seu dinheiro nesta janela.");
  });

  test("linhas cinzas, as duas frases e a nota sempre visíveis; 'Ver a conta' fechado com TWR e XIRR; o aviso", async ({ page }) => {
    await autenticar(page, APORTES);
    await abrir(page);
    await expect(page.locator(`${TELA} [data-testid="apor-carteira-linha"]`)).toHaveText("Como se o dinheiro tivesse ficado parado do começo ao fim.");
    await expect(page.locator(`${TELA} [data-testid="apor-dinheiro-linha"]`)).toHaveText("Considera quando e quanto entrou e saiu.");
    const dts = await page.locator(`${TELA} .diag-pares dt`).allTextContents();
    expect(dts.map(norm)).toEqual(["A carteira", "O seu dinheiro"]);
    await expect(page.locator(`${TELA} .apor-explica`)).toHaveText(
      "Dinheiro que entra antes de meses bons puxa o seu retorno para cima do da carteira; antes de meses ruins, para baixo.");
    await expect(page.locator(`${TELA} .apor-nota`)).toHaveText(
      "Não mede acerto de escolha: quem aporta todo mês pelo salário ganha essa diferença, para um lado ou para o outro, sem ter escolhido o momento. Proventos que saíram da carteira contam como dinheiro que saiu.");
    const det = page.locator(`${TELA} details.diag-conta`);
    await expect(det).not.toHaveAttribute("open", "");
    await det.locator("summary").click();
    const txt = norm(await det.textContent());
    expect(txt).toContain("TWR");
    expect(txt).toContain("XIRR");
    expect(txt).toContain("a diferença muda de sinal conforme a janela");
    await expect(page.locator(`${TELA} .diag-aviso`)).toHaveText("Rentabilidade passada não garante rentabilidade futura.");
  });

  test("ponte curta (fixture principal): janelas indisponíveis dizem o motivo traduzido, sem frase nem números", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    const e = await esperado(page, "Total", "BRL", "desde");
    expect(e.disponivel).toBe(false);
    await expect(page.locator(`${TELA} [data-testid="apor-sem-janela"]`)).toHaveText(e.motivo);
    await expect(page.locator(`${TELA} [data-testid="apor-frase"]`)).toHaveCount(0);
    await expect(page.locator(`${TELA} .diag-pares`)).toHaveCount(0);
    expect(erros).toEqual([]);
  });

  test("payload pré-v2.36: o capítulo 3 segue (não depende do bloco selecao)", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page, PRE236);
    await abrir(page);
    await expect(page.locator(`${TELA} .diag-titulo`)).toHaveText("O momento dos seus aportes");
    expect(erros).toEqual([]);
  });

  test("sem ponte no payload: 'O momento dos aportes indisponível hoje.', sem erro", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page, APORTES);
    await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      d.json = { ...d.json, ponte: null };
    });
    await page.goto("/#/raiox/diagnostico/aportes");
    await expect(page.locator(TELA)).toContainText("O momento dos aportes indisponível hoje.");
    await page.goto("/#/raiox/diagnostico");
    await expect(page.locator('.tela-diag-indice [data-testid="diag-indice-4"] .diag-indice__estado')).toHaveText("Indisponível hoje.");
    expect(erros).toEqual([]);
  });
});

test.describe("7a.BR.2 — capítulo 3: regras de forma (spec §6.6)", () => {
  for (const [escopo, moeda] of [["Total", "BRL"], ["Brasil", "BRL"], ["EUA", "USD"]] as const) {
    test(`face sem travessão nem termos técnicos (${escopo} ${moeda})`, async ({ page }) => {
      const erros = coletarErros(page);
      await autenticar(page, APORTES);
      await abrir(page);
      if (escopo !== "Total") await escolherEscopo(page, escopo, moeda === "USD" ? "USD" : undefined);
      for (const k of JANELAS) {
        await escolherJanela(page, k);
        const face = await faceTexto(page, TELA);
        expect(face).not.toMatch(/[—–]|--/);
        expect(face).not.toMatch(PROIBIDOS);
      }
      expect(erros).toEqual([]);
    });
  }

  for (const largura of [320, 390] as const) {
    for (const [escopo, moeda] of [["Total", "BRL"], ["EUA", "USD"]] as const) {
      test(`a ${largura} px (${escopo} ${moeda}): nada passa da coluna e folga ≥ 8 px entre rótulo e valor`, async ({ page }) => {
        await page.setViewportSize({ width: largura, height: 800 });
        await autenticar(page, APORTES);
        await abrir(page);
        if (escopo !== "Total") await escolherEscopo(page, escopo, moeda === "USD" ? "USD" : undefined);
        await page.locator(`${TELA} details.diag-conta summary`).click();
        const r = await medirForma(page, TELA, ".diag-ensaio");
        expect(r.sw).toBeLessThanOrEqual(r.cw);
        expect(r.fora).toEqual([]);
        expect(r.folgas.length).toBeGreaterThanOrEqual(2);
        for (const f of r.folgas) expect(f.folga, f.linha).toBeGreaterThanOrEqual(8);
      });
    }
  }

  test("janelas novas herdam a fonte do texto (font: inherit)", async ({ page }) => {
    await autenticar(page, APORTES);
    await abrir(page);
    const r = await page.evaluate(() => {
      const raiz = document.querySelector(".tela-diag-aportes .diag-ensaio")!;
      const b = raiz.querySelector('[data-testid="apor-janela-3a"]')!;
      return { botao: getComputedStyle(b).fontFamily, corpo: getComputedStyle(raiz).fontFamily };
    });
    expect(r.botao).toBe(r.corpo);
  });

  test("Modo Plantão: frase e números leem os tokens escuros", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("tema", "dark"));
    await autenticar(page, APORTES);
    await abrir(page);
    const r = await page.evaluate(() => {
      const cor = (v: string) => { const s = document.createElement("span"); s.style.color = `var(${v})`; document.body.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c; };
      const q = (s: string) => document.querySelector(s)!;
      return {
        tema: document.documentElement.getAttribute("data-theme"),
        ink: cor("--ink"), gray: cor("--gray"),
        frase: getComputedStyle(q('.tela-diag-aportes [data-testid="apor-frase"]')).color,
        dd: getComputedStyle(q('.tela-diag-aportes [data-testid="apor-carteira"]')).color,
        linha: getComputedStyle(q('.tela-diag-aportes [data-testid="apor-carteira-linha"]')).color,
      };
    });
    expect(r.tema).toBe("dark");
    expect(r.frase).toBe(r.ink);
    expect(r.dd).toBe(r.ink);
    expect(r.linha).toBe(r.gray);
  });
});
