import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

// Fase 7a.BD.2 — teste cruzado da gêmea JS (ponteJanela, ponteJanelasFixas,
// arredondarFechando em js/app.js) contra a referência Python
// (src/calculadora/ponte.py do repo principal). O esperado NÃO é escrito à
// mão: tests/fixtures/ponte_esperado.test.json é a saída da referência Python
// sobre o bloco ponte sintético da fixture (100% fórmula, nenhum dado real).
//
// Comparação campo a campo:
// - números: tolerância absoluta 1e-9 (frações); o campo `xirr` usa 1e-6,
//   porque as duas pontas resolvem a raiz por métodos iterativos distintos
//   (pyxirr × Newton-Raphson com tol 1e-7 na taxa, ou bissecção) — a
//   convenção de datas é a mesma (ACT/365, fim de mês), só a parada do
//   iterador difere. Medido em 21/10/2026: desvio máximo 7,8e-10 numa versão
//   anterior do fixture e 4,5e-11 na atual (17 XIRR): a parada do iterador não
//   garante 1e-9. Com a base 365,25 do card "Período" o desvio seria ~1e-4,
//   então 1e-6 ainda trava a convenção;
// - texto, booleano, null, chaves e ordem (linhas, ativos, chaves de `ativos`
//   e de `indices`, rótulos `t`): igualdade exata.
const ESPERADO = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../fixtures/ponte_esperado.test.json"), "utf-8"),
);

const TOL = 1e-9;
const TOL_XIRR = 1e-6;

function comparar(obtido: any, esperado: any, caminho: string, erros: string[], tol = TOL) {
  if (esperado === null || typeof esperado !== "object") {
    if (typeof esperado === "number") {
      if (typeof obtido !== "number" || !Number.isFinite(obtido) || Math.abs(obtido - esperado) > tol) {
        erros.push(`${caminho}: obtido ${obtido}, esperado ${esperado}`);
      }
    } else if (obtido !== esperado) {
      erros.push(`${caminho}: obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`);
    }
    return;
  }
  if (Array.isArray(esperado)) {
    if (!Array.isArray(obtido) || obtido.length !== esperado.length) {
      erros.push(`${caminho}: lista obtida ${JSON.stringify(obtido)}, esperada de tamanho ${esperado.length}`);
      return;
    }
    esperado.forEach((e, i) => comparar(obtido[i], e, `${caminho}[${i}]`, erros, tol));
    return;
  }
  if (obtido === null || typeof obtido !== "object" || Array.isArray(obtido)) {
    erros.push(`${caminho}: obtido ${JSON.stringify(obtido)}, esperado objeto`);
    return;
  }
  const ke = Object.keys(esperado);
  const ko = Object.keys(obtido);
  if (JSON.stringify(ke) !== JSON.stringify(ko)) {
    erros.push(`${caminho}: chaves obtidas ${JSON.stringify(ko)}, esperadas ${JSON.stringify(ke)}`);
    return;
  }
  for (const k of ke) {
    comparar(obtido[k], esperado[k], `${caminho}.${k}`, erros, k === "xirr" ? TOL_XIRR : tol);
  }
}

test("ponteJanela/ponteJanelasFixas/arredondarFechando reproduzem a referência Python", async ({ page }) => {
  const errosPagina: string[] = [];
  page.on("pageerror", (e) => errosPagina.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => typeof (window as any).Alpine !== "undefined");

  const obtidos = await page.evaluate(({ bloco, casos }) => {
    const w = window as any;
    return casos.map((c: any) => {
      const ch = c.chamada;
      if ("valores" in ch) return w.arredondarFechando(ch.valores, ch.total, ch.casas);
      // casos de XIRR extremo trazem o próprio mini-bloco (gerar_fixture.py::_ponte_mini)
      if ("i_ini" in ch) return w.ponteJanela(ch.bloco ?? bloco, ch.escopo, ch.moeda, ch.i_ini, ch.i_fim);
      return w.ponteJanelasFixas(bloco, ch.escopo, ch.moeda);
    });
  }, { bloco: ESPERADO.bloco, casos: ESPERADO.casos });

  // O fixture precisa exercitar os três caminhos e os casos-chave; um fixture
  // esvaziado daria verde vácuo.
  const casos = ESPERADO.casos as any[];
  expect(casos.filter((c) => "valores" in c.chamada).length).toBeGreaterThan(0);
  expect(casos.filter((c) => "i_ini" in c.chamada).length).toBeGreaterThan(0);
  expect(casos.filter((c) => !("valores" in c.chamada) && !("i_ini" in c.chamada)).length).toBeGreaterThan(0);
  expect(JSON.stringify(casos)).toContain("Rebates da corretora");
  expect(JSON.stringify(casos)).toContain("cotação ausente em");
  expect(JSON.stringify(casos)).toContain("histórico começa em");
  // XIRR de janela curta acima de 1000 % a.a. (onde o teto antigo do Newton
  // devolvia null) e os mini-blocos de retorno extremo, com XIRR numérico.
  const xirrExtremo = casos.filter((c) => "i_ini" in c.chamada && c.esperado.n_meses < 12
    && typeof c.esperado.xirr === "number" && Math.pow(1 + c.esperado.xirr, 12 / c.esperado.n_meses) - 1 > 10);
  expect(xirrExtremo.length).toBeGreaterThanOrEqual(3);
  expect(casos.filter((c) => c.chamada.bloco && typeof c.esperado.xirr === "number").length).toBe(4);

  const erros: string[] = [];
  casos.forEach((c, i) => comparar(obtidos[i], c.esperado, `caso[${i}] ${JSON.stringify(c.chamada).slice(0, 80)}`, erros));
  expect(erros, erros.slice(0, 20).join("\n")).toEqual([]);
  expect(errosPagina).toEqual([]);
});
