import { test, expect, Page } from "@playwright/test";
import { fx, autenticar, coletarErros, norm, medirForma, escalarValorFinal } from "./diag-comum";
import { esperarResume } from "./esperar-resume";

// Fase 7a.BR.2, Task 6 — grifo da seleção e frase do momento dos aportes na
// Rentabilidade (spec §6.1, §6.5, §8 itens 8 e 9). Fixture 100% sintética:
// portfolio_selecao_aportes tem a ponte longa (72 meses) com XIRR não nulo.
// O número esperado sai do payload decifrado, por ponteJanela sobre a janela
// que a tela mostra (inclusive a arrastada): xirr − sua, nunca o contrário.
const APORTES = fx("portfolio_selecao_aportes.test.json.enc");
const TELA = ".tela-rentabilidade";
const tid = (id: string) => `${TELA} [data-testid="${id}"]`;
const SETTLE = 400;

test.use({ viewport: { width: 390, height: 844 } });

async function abrir(page: Page) {
  await page.goto("/#rentabilidade");
  await esperarResume(page);
  await expect(page.locator(tid("rent2-frase"))).toBeVisible({ timeout: 10_000 });
}

async function arrastar(page: Page, iIni: number, iFim: number) {
  await page.evaluate(([a, b]) => {
    const d = (window as any).Alpine.$data(document.body);
    const off = d._rentCtx.off;
    d.echartsRent.dispatchAction({ type: "dataZoom", startValue: a - 1 - off, endValue: b - off });
  }, [iIni, iFim]);
  await page.waitForTimeout(SETTLE);
}

async function abrirDetalhes(page: Page) {
  const det = page.locator(tid("rent2-detalhes"));
  if (!(await det.evaluate((e) => (e as HTMLDetailsElement).open))) await det.locator("summary").click();
}

// A janela corrente, recalculada por ponteJanela do lado do teste (xirr − sua).
async function esperado(page: Page) {
  return page.evaluate(() => {
    const w = window as any;
    const d = w.Alpine.$data(document.body);
    const c = d._rentCtx;
    const j = w.ponteJanela(w.Alpine.raw(c.bloco), c.escopo, c.moeda, d.rent2.iIni, d.rent2.iFim);
    if (j.xirr === null || j.sua === null) return { nulo: true, r: 0, X: "", anualizado: j.anualizado };
    const r = w.ponteRoundPy((j.xirr - j.sua) * 100, 1);
    return { nulo: false, r, X: w.rent2Abs1(r), anualizado: j.anualizado };
  });
}

function fraseDe(e: { r: number; X: string; anualizado: boolean }) {
  if (Math.abs(e.r) < 0.5) return "Nesta janela, o momento dos aportes quase não mudou o resultado.";
  const pp = Math.abs(e.r) < 2 ? "ponto" : "pontos";
  return `Nesta janela, o momento dos aportes ${e.r > 0 ? "somou" : "tirou"} ${e.X} ${pp} ${e.anualizado ? "ao ano" : "no período"}.`;
}

test.describe("Rentabilidade: grifo da seleção", () => {
  test("grifo visível sob 'o que mais pesou', sem dígito, abre o capítulo 2", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page, APORTES);
    await abrir(page);
    const g = page.locator(tid("rent-grifo-selecao"));
    await expect(g).toBeVisible();
    expect(norm(await g.textContent())).toBe("Isso é habilidade ou sorte? Ver no Diagnóstico ›");
    expect(await g.textContent()).not.toMatch(/\d/);
    // logo abaixo do "o que mais pesou": o irmão seguinte da seção
    const abaixo = await page.evaluate(() => {
      const p = document.querySelector('.tela-rentabilidade [data-testid="ponte-pesou"]')!;
      const g = document.querySelector('.tela-rentabilidade [data-testid="rent-grifo-selecao"]')!;
      return p.nextElementSibling === g;
    });
    expect(abaixo).toBe(true);
    const caixa = await g.boundingBox();
    expect(caixa!.height).toBeGreaterThanOrEqual(44);
    await g.click();
    await expect(page).toHaveURL(/#\/raiox\/diagnostico\/selecao$/);
    await expect(page.locator(".tela-diag-selecao .diag-ensaio").first()).toBeVisible();
    expect(erros).toEqual([]);
  });
});

test.describe("Rentabilidade: frase do momento dos aportes", () => {
  test("janela padrão: a frase traz xirr − sua do payload, dentro de Detalhes, sob as duas réguas", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page, APORTES);
    await abrir(page);
    await abrirDetalhes(page);
    const f = page.locator(tid("rent-aporte-frase"));
    await expect(f).toBeVisible();
    const e = await esperado(page);
    expect(e.nulo).toBe(false);
    expect(norm(await f.textContent())).toBe(fraseDe(e));
    const dentro = await page.evaluate(() => {
      const f = document.querySelector('.tela-rentabilidade [data-testid="rent-aporte-frase"]')!;
      const x = document.querySelector('.tela-rentabilidade [data-testid="rent2-xirr"]')!;
      return !!f.closest("details") && !!(x.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(dentro).toBe(true);
    expect(erros).toEqual([]);
  });

  test("a frase muda ao arrastar a janela e acompanha a janela arrastada", async ({ page }) => {
    await autenticar(page, APORTES);
    // A ponte da fixture dá "quase não mudou" em toda janela; escalar o valor
    // final dos fluxos (só o XIRR se move) dá números a comparar.
    await escalarValorFinal(page, 1.6);
    await abrir(page);
    await abrirDetalhes(page);
    const f = page.locator(tid("rent-aporte-frase"));
    const antes = norm(await f.textContent());
    expect(antes).toMatch(/somou|tirou/);
    await arrastar(page, 30, 52);
    const e = await esperado(page);
    expect(e.nulo).toBe(false);
    expect(e.anualizado).toBe(true);
    const depois = norm(await f.textContent());
    expect(depois).toBe(fraseDe(e));
    expect(depois).not.toBe(antes);
  });

  test("janela de menos de 12 meses: 'no período', no lugar de 'ao ano'", async ({ page }) => {
    await autenticar(page, APORTES);
    await abrir(page);
    await abrirDetalhes(page);
    await arrastar(page, 40, 47);
    const e = await esperado(page);
    expect(e.nulo).toBe(false);
    expect(e.anualizado).toBe(false);
    const t = norm(await page.locator(tid("rent-aporte-frase")).textContent());
    expect(t).toBe(fraseDe(e));
    expect(t).not.toMatch(/ao ano/);
  });

  test("com xirr nulo a frase some (e volta quando o número volta)", async ({ page }) => {
    await autenticar(page, APORTES);
    await abrir(page);
    await abrirDetalhes(page);
    await expect(page.locator(tid("rent-aporte-frase"))).toBeVisible();
    await page.evaluate(() => {
      const w = window as any;
      const d = w.Alpine.$data(document.body);
      const c = d._rentCtx;
      const r = w.ponteJanela(w.Alpine.raw(c.bloco), c.escopo, c.moeda, d.rent2.iIni, d.rent2.iFim);
      d._rent2Aplicar(d.rent2.iIni, d.rent2.iFim, d.rent2.chave, { ...r, xirr: null });
    });
    await expect(page.locator(tid("rent-aporte-frase"))).toHaveCount(0);
    await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      d._rent2Aplicar(d.rent2.iIni, d.rent2.iFim, d.rent2.chave);
    });
    await expect(page.locator(tid("rent-aporte-frase"))).toBeVisible();
  });

  test("rentAporFrase: sinal, plural, 'no período' e o limiar de 0,5 ponto, com valores sintéticos", async ({ page }) => {
    await autenticar(page, APORTES);
    await abrir(page);
    const f = await page.evaluate(() => {
      const w = window as any;
      const j = (xirr: number | null, sua: number | null, anualizado = true) => ({ xirr, sua, anualizado });
      return {
        soma: w.rentAporFrase(j(0.113, 0.1)),            // +1,3
        tira: w.rentAporFrase(j(0.08, 0.1)),             // −2,0
        plural: w.rentAporFrase(j(0.125, 0.1)),          // +2,5
        periodo: w.rentAporFrase(j(0.06, 0.05, false)),  // +1,0 no período
        abaixo: w.rentAporFrase(j(0.1044, 0.1)),         // +0,44: quase não mudou
        abaixoNeg: w.rentAporFrase(j(0.0956, 0.1)),      // −0,44: quase não mudou
        limiar: w.rentAporFrase(j(0.105, 0.1)),          // +0,5: já não é "quase não mudou"
        limiarNeg: w.rentAporFrase(j(0.095, 0.1)),       // −0,5
        zero: w.rentAporFrase(j(0.1, 0.1)),
        nulo: w.rentAporFrase(j(null, 0.1)),
        nuloSua: w.rentAporFrase(j(0.1, null)),
      };
    });
    const quase = "Nesta janela, o momento dos aportes quase não mudou o resultado.";
    expect(f.soma).toBe("Nesta janela, o momento dos aportes somou 1,3 ponto ao ano.");
    expect(f.tira).toBe("Nesta janela, o momento dos aportes tirou 2,0 pontos ao ano.");
    expect(f.plural).toBe("Nesta janela, o momento dos aportes somou 2,5 pontos ao ano.");
    expect(f.periodo).toBe("Nesta janela, o momento dos aportes somou 1,0 ponto no período.");
    expect(f.abaixo).toBe(quase);
    expect(f.abaixoNeg).toBe(quase);
    expect(f.limiar).toBe("Nesta janela, o momento dos aportes somou 0,5 ponto ao ano.");
    expect(f.limiarNeg).toBe("Nesta janela, o momento dos aportes tirou 0,5 ponto ao ano.");
    expect(f.zero).toBe(quase);
    expect(f.nulo).toBe("");
    expect(f.nuloSua).toBe("");
  });

  test("forma: sem travessão, sem overflow a 390 e 320 px", async ({ page }) => {
    await autenticar(page, APORTES);
    await abrir(page);
    await abrirDetalhes(page);
    for (const w of [390, 320]) {
      await page.setViewportSize({ width: w, height: 844 });
      const txt =
        norm(await page.locator(tid("rent-aporte-frase")).textContent()) + " " +
        norm(await page.locator(tid("rent-grifo-selecao")).textContent());
      expect(txt).not.toMatch(/[—–]/);
      const m = await medirForma(page, TELA, ".rent2-detalhes-corpo");
      expect(m.sw).toBeLessThanOrEqual(m.cw);
      expect(m.fora).toEqual([]);
      const g = await page.locator(tid("rent-grifo-selecao")).boundingBox();
      expect(g!.x + g!.width).toBeLessThanOrEqual(w);
    }
  });
});
