import { test, expect } from "@playwright/test";

// Fase 7a.BK.1 — regra da faixa de tolerância, trilho e frase-resumo da
// #alocacao. Unitário sobre as funções globais de js/app.js (alocFaixa,
// alocTrilho, alocListaNomes, alocFraseResumo, alocRsCurto). Valores 100%
// sintéticos (repo público).
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => typeof (window as any).Alpine !== "undefined");
});

const CASOS: [number, number, string][] = [
  [0.50, 0.55, "na_faixa"], [0.50, 0.5501, "acima"],
  [0.50, 0.45, "na_faixa"], [0.50, 0.4499, "abaixo"],
  [0.05, 0.07, "na_faixa"], [0.05, 0.0701, "acima"],
  [0.05, 0.03, "na_faixa"], [0.05, 0.0299, "abaixo"],
  [0.20, 0.22, "na_faixa"], [0.20, 0.2201, "acima"], // 10%×0,20 = 0,02: os dois ramos empatam
  [0, 0.03, "sem_alvo"], [0.30, NaN, "sem_dado"],
];

for (const [alvo, atual, estado] of CASOS) {
  test(`alocFaixa(${alvo}, ${atual}) -> ${estado}`, async ({ page }) => {
    const r = await page.evaluate(([a, b]) => (window as any).alocFaixa(a, b), [alvo, atual]);
    expect(r.estado).toBe(estado);
  });
}

test("alocFaixa: tolerância, limites e nulos", async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    return {
      a: w.alocFaixa(0.05, 0.04),
      b: w.alocFaixa(0.50, 0.5),
      sa: w.alocFaixa(0, 0.1),
      sd: w.alocFaixa(0.3, null),
      sd2: w.alocFaixa(0.3, undefined),
    };
  });
  expect(r.a.tol).toBe(0.02);
  expect(r.b.tol).toBeCloseTo(0.05, 12);
  expect(r.b.min).toBeCloseTo(0.45, 12);
  expect(r.b.max).toBeCloseTo(0.55, 12);
  for (const x of [r.sa, r.sd, r.sd2]) {
    expect(x.tol).toBeNull();
    expect(x.min).toBeNull();
    expect(x.max).toBeNull();
  }
  expect(r.sd2.estado).toBe("sem_dado");
});

test("alocTrilho: janela, etiqueta e clamp", async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    return {
      t: w.alocTrilho(0.50, 0.58),
      lo: w.alocTrilho(0.10, 0.05),
      hi: w.alocTrilho(0.10, 0.40),
      n1: w.alocTrilho(0, 0.1),
      n2: w.alocTrilho(0.3, NaN),
    };
  });
  expect(r.t.naIni).toBeCloseTo(27.27, 1);
  expect(r.t.naFim).toBeCloseTo(72.73, 1);
  expect(r.t.etiqueta).toBeCloseTo(86.36, 1);
  expect(r.lo.etiqueta).toBe(5);
  expect(r.hi.etiqueta).toBe(95);
  expect(r.n1).toBeNull();
  expect(r.n2).toBeNull();
});

// Piso de 0,05 da janela: com alvo 0,10 a tolerância é 0,02 e 2,2 × tol = 0,044
// fica abaixo do piso, então R = 0,05 e a faixa ocupa 30% a 70% da largura.
// Com qualquer piso menor que 0,044 a janela encolhe e a faixa sai de 27,3% a 72,7%.
test("alocTrilho: piso de 0,05 da janela", async ({ page }) => {
  const r = await page.evaluate(() => (window as any).alocTrilho(0.10, 0.10));
  expect(r.naIni).toBeCloseTo(30, 6);
  expect(r.naFim).toBeCloseTo(70, 6);
  expect(r.etiqueta).toBeCloseTo(50, 6);
});

test("alocListaNomes", async ({ page }) => {
  const r = await page.evaluate(() => {
    const f = (window as any).alocListaNomes;
    return [f(["A"]), f(["A", "B"]), f(["A", "B", "C"])];
  });
  expect(r).toEqual(["A", "A e B", "A, B e C"]);
});

test("alocRsCurto", async ({ page }) => {
  const r = await page.evaluate(() => {
    const f = (window as any).alocRsCurto;
    return [450, 4210, 38400, 9960, 999.6, -450].map(f);
  });
  expect(r).toEqual(["R$ 450", "R$ 4,2 mil", "R$ 38 mil", "R$ 10 mil", "R$ 1,0 mil", "R$ 450"]);
});

test("alocFraseResumo", async ({ page }) => {
  const r = await page.evaluate(() => {
    const f = (window as any).alocFraseResumo;
    const c = (nome: string, alvo: number, atual: number | null) => ({ nome, peso_alvo: alvo, peso_atual: atual });
    return [
      f([c("A", 0.3, 0.1), c("B", 0.3, 0.6), c("C", 0.3, 0.3)]),
      f([c("A", 0.3, 0.1), c("B", 0.3, 0.3), c("C", 0.3, 0.1)]),
      f([c("A", 0.3, 0.3), c("B", 0.3, 0.6), c("C", 0.3, 0.3)]),
      f([c("A", 0.3, 0.3), c("B", 0.3, 0.3), c("X", 0, 0.1)]),
      f([c("A", 0.3, 0.1), c("B", 0.3, 0.1), c("C", 0.3, 0.1), c("D", 0.3, 0.3)]),
      f([c("A", 0.3, 0.1), c("X", 0, 0.1), c("Y", 0.3, null)]),
      f([]),
      f([c("X", 0, 0.1), c("Y", 0.3, null)]),
    ];
  });
  expect(r).toEqual([
    "A está pedindo aporte. B está acima da faixa.",
    "A e C estão pedindo aporte. O resto está na faixa.",
    "B está acima da faixa. O resto está na faixa.",
    "Todas as categorias estão na faixa.",
    "A, B e C estão pedindo aporte. O resto está na faixa.",
    "A está pedindo aporte.",
    "",
    "",
  ]);
});

// ── Task 3: alocAgruparAtivos (spec 7a.BK §3.4) ─────────────────────────────
// Categoria literal igual à Ações BR da fixture `portfolio_alocacao_faixa`
// (tests/fixtures/gerar_fixture.py::_politica_alocacao_faixa). Pesos sintéticos.
function acoesBrSintetica() {
  const a = (ticker: string, pi: number, pia: number, valor: number, extra: object = {}) => ({
    ticker, tipo: "pick", quarentena: false, peso_intra: pi, peso_intra_atual: pia,
    drift_intra: pia - pi, valor_brl: valor, ...extra,
  });
  return {
    nome: "Ações BR", peso_alvo: 0.25, peso_atual: 0.20, valor_brl: 22000,
    buckets: [
      { tipo: "passive", peso_bucket: 0.45, peso_atual_bucket: 0.30,
        ativos: [a("BOVA11", 1.0, 1.0, 6000, { tipo: "passive" })] },
      { tipo: "picks", equal_weight: true, peso_bucket: 0.55, peso_atual_bucket: 0.70,
        ativos: [
          a("ITSA4", 0.333333, 0.545455, 6000),
          a("BBAS3", 0.333333, 0.090909, 1000),
          a("WEGE3", 0.333333, 0.363636, 4000),
          a("KNIP11", 0.0, 0.272727, 3000, { quarentena: true }),
          a("LREN3", 0, 0, 2000, { fora_do_alvo: true }),
        ] },
    ],
  };
}

test("alocAgruparAtivos: Ações BR sintética (pedindo, acima, na faixa, sem alvo, cestas)", async ({ page }) => {
  const r = await page.evaluate((cat) => (window as any).alocAgruparAtivos(cat), acoesBrSintetica());
  // Conta à mão.
  // BOVA11 é o único ativo elegível da cesta passiva: herda a cesta,
  //   alocFaixa(0,45; 0,30) = abaixo, e o R$ é (0,45 − 0,30) × 20 000 = 3 000,
  //   onde 20 000 = valor da categoria sem o off-policy LREN3 (o universo do
  //   peso_atual_bucket). Com cat.valor_brl (22 000) daria 3 300.
  // BBAS3: equal-weight dos picks = ITSA4 + BBAS3 + WEGE3 = 11 000 (sem KNIP11
  //   em quarentena e sem LREN3): (1/3 − 1/11) × 11 000 = 2 666,67. Com a cesta
  //   bruta (14 000, com a quarentena) daria 3 393,9.
  // ITSA4: (6/11 − 1/3) × 11 000 = 2 333,33, acima (tol 1/30, máx 0,3667).
  // WEGE3: 4/11 = 0,3636 ≤ 0,3667, na faixa.
  // R$ por ticker ANTES da ordem: a falha de universo aparece no valor, não só na ordem.
  const rsDe = (t: string) => [...r.pedindo, ...r.acima].find((x: any) => x.ticker === t)?.rs;
  expect(rsDe("BBAS3")).toBeCloseTo(2666.67, 0);
  expect(rsDe("BOVA11")).toBeCloseTo(3000, 0);
  expect(r.pedindo.map((x: any) => [x.ticker, x.cesta])).toEqual([["BOVA11", "Passivo"], ["BBAS3", "Picks"]]);
  expect(r.acima.map((x: any) => [x.ticker, x.cesta])).toEqual([["ITSA4", "Picks"]]);
  expect(r.acima[0].rs).toBeCloseTo(2333.33, 0);
  expect(r.naFaixa).toEqual(["WEGE3"]);
  expect(r.semAlvo).toEqual([{ ticker: "KNIP11", motivo: "quarentena" }, { ticker: "LREN3", motivo: "a zerar" }]);
  expect(r.cestas.map((c: any) => [c.nome, c.estado])).toEqual([["Passivo", "abaixo"], ["Picks", "acima"]]);
  expect(r.cestas[0].atual).toBeCloseTo(0.30, 9);
  expect(r.cestas[0].alvo).toBeCloseTo(0.45, 9);
  for (const x of [...r.pedindo, ...r.acima]) expect(x.rs).toBeGreaterThan(0);
});

test("alocAgruparAtivos: quarentena tem precedência sobre fora_do_alvo", async ({ page }) => {
  const r = await page.evaluate(() => (window as any).alocAgruparAtivos({
    nome: "C", peso_alvo: 0.3, peso_atual: 0.3, valor_brl: 1000,
    buckets: [{ tipo: "picks", peso_bucket: 1, peso_atual_bucket: 1, ativos: [
      { ticker: "AAA3", quarentena: true, fora_do_alvo: true, peso_intra: 0, peso_intra_atual: 0, valor_brl: 1000 },
    ] }],
  }));
  expect(r.semAlvo).toEqual([{ ticker: "AAA3", motivo: "quarentena" }]);
});

test("alocAgruparAtivos: quarentenado e off-policy vão para sem alvo; R$ segue finito", async ({ page }) => {
  const r = await page.evaluate(() => (window as any).alocAgruparAtivos({
    nome: "C", peso_alvo: 0.3, peso_atual: 0.3, valor_brl: 9000,
    buckets: [
      { tipo: "passive", peso_bucket: 0.5, peso_atual_bucket: 0.6,
        ativos: [{ ticker: "PASS11", peso_intra: 1, peso_intra_atual: 1, valor_brl: 6000 }] },
      { tipo: "picks", peso_bucket: 0.5, peso_atual_bucket: 0.4, ativos: [
        { ticker: "KNIP11", quarentena: true, peso_intra: 0, peso_intra_atual: 1, valor_brl: 2000 },
        { ticker: "LREN3", fora_do_alvo: true, peso_intra: 0, peso_intra_atual: 0, valor_brl: 1000 },
      ] },
    ],
  }));
  expect(r.semAlvo).toEqual([{ ticker: "KNIP11", motivo: "quarentena" }, { ticker: "LREN3", motivo: "a zerar" }]);
  // Assert direto, linha a linha: JSON.stringify transformaria NaN em null.
  const linhas = [...r.pedindo, ...r.acima];
  expect(linhas.length).toBeGreaterThan(0);
  for (const x of linhas) expect(Number.isFinite(x.rs), x.ticker).toBe(true);
  expect(r.semAlvo.map((x: any) => x.ticker)).not.toContain("PASS11");
});

test("alocAgruparAtivos: valor_brl NaN num elegível cai no guard e o R$ fica finito", async ({ page }) => {
  const r = await page.evaluate(() => (window as any).alocAgruparAtivos({
    nome: "C", peso_alvo: 0.3, peso_atual: 0.3, valor_brl: 7000,
    buckets: [{ tipo: "picks", peso_bucket: 1, peso_atual_bucket: 1, ativos: [
      { ticker: "AAA3", peso_intra: 0.5, peso_intra_atual: 0.3, valor_brl: NaN },
      { ticker: "BBB3", peso_intra: 0.5, peso_intra_atual: 0.7, valor_brl: 7000 },
    ] }],
  }));
  // peso_intra_atual é finito, então o estado sai; o valor EW é NaN e o guard
  // Number.isFinite zera o R$ em vez de deixar NaN chegar à tela.
  expect(r.pedindo.map((x: any) => x.ticker)).toEqual(["AAA3"]);
  expect(r.acima.map((x: any) => x.ticker)).toEqual(["BBB3"]);
  for (const x of [...r.pedindo, ...r.acima]) expect(Number.isFinite(x.rs), x.ticker).toBe(true);
});

test("alocAgruparAtivos: cesta única é sempre na faixa, e o ativo único dela herda", async ({ page }) => {
  // Categoria sem posição: peso_atual_bucket 0 contra peso_bucket 1. Pela letra
  // do §3.4 a cesta única está na faixa; sem isso, o ativo sairia "pedindo
  // aporte" com "faltam R$ 0".
  const r = await page.evaluate(() => (window as any).alocAgruparAtivos({
    nome: "C", peso_alvo: 0.1, peso_atual: 0, valor_brl: 0,
    buckets: [{ tipo: "passive", peso_bucket: 1, peso_atual_bucket: 0, ativos: [
      { ticker: "UNIC11", peso_intra: 1, peso_intra_atual: 0, valor_brl: 0 },
    ] }],
  }));
  expect(r.naFaixa).toEqual(["UNIC11"]);
  expect(r.pedindo).toEqual([]);
  expect(r.acima).toEqual([]);
  expect(r.cestas).toEqual([]);
});

test("alocAgruparAtivos: cesta só com o quarentenado em carteira expõe rs 0 nos elegíveis", async ({ page }) => {
  const r = await page.evaluate(() => (window as any).alocAgruparAtivos({
    nome: "C", peso_alvo: 0.5, peso_atual: 0.3, valor_brl: 2000,
    buckets: [
      { tipo: "passive", peso_bucket: 0.5, peso_atual_bucket: 0.5, ativos: [
        { ticker: "PASS11", peso_intra: 1, peso_intra_atual: 1, valor_brl: 1000 },
      ] },
      { tipo: "picks", peso_bucket: 0.5, peso_atual_bucket: 0.5, ativos: [
        { ticker: "KNIP11", quarentena: true, peso_intra: 0, peso_intra_atual: 1, valor_brl: 1000 },
        { ticker: "AAAA3", peso_intra: 0.5, peso_intra_atual: 0, valor_brl: 0 },
        { ticker: "BBBB3", peso_intra: 0.5, peso_intra_atual: 0, valor_brl: 0 },
      ] },
    ],
  }));
  // Os dois elegíveis estão abaixo (0 contra 0,5), mas o valor EW é 0: o R$
  // é 0, e a tela mostra a linha sem o trecho do valor (assert de DOM no
  // alocacao-tolerancia.spec.ts).
  expect(r.pedindo.map((x: any) => [x.ticker, x.cesta, x.rs])).toEqual([["AAAA3", "Picks", 0], ["BBBB3", "Picks", 0]]);
});

test("alocAgruparAtivos: categoria de cesta única não gera cestas nem nome de cesta", async ({ page }) => {
  const r = await page.evaluate(() => (window as any).alocAgruparAtivos({
    nome: "EUA", peso_alvo: 0.5, peso_atual: 0.5, valor_brl: 10000,
    buckets: [{ tipo: "passive", peso_bucket: 1, peso_atual_bucket: 1, ativos: [
      { ticker: "AAA", peso_intra: 0.5, peso_intra_atual: 0.3, valor_brl: 3000 },
      { ticker: "BBB", peso_intra: 0.5, peso_intra_atual: 0.7, valor_brl: 7000 },
    ] }],
  }));
  expect(r.cestas).toEqual([]);
  // (0,5 − 0,3) × 10 000 = 2 000 nos dois sentidos.
  expect(r.pedindo).toEqual([{ ticker: "AAA", cesta: null, rs: expect.closeTo(2000, 6) }]);
  expect(r.acima).toEqual([{ ticker: "BBB", cesta: null, rs: expect.closeTo(2000, 6) }]);
});

test("alocAgruparAtivos: empate de R$ ordena por ticker", async ({ page }) => {
  const r = await page.evaluate(() => (window as any).alocAgruparAtivos({
    nome: "C", peso_alvo: 0.3, peso_atual: 0.3, valor_brl: 10000,
    buckets: [{ tipo: "picks", peso_bucket: 1, peso_atual_bucket: 1, ativos: [
      { ticker: "ZZZ3", peso_intra: 0.25, peso_intra_atual: 0.05, valor_brl: 500 },
      { ticker: "AAA3", peso_intra: 0.25, peso_intra_atual: 0.05, valor_brl: 500 },
      { ticker: "MMM3", peso_intra: 0.25, peso_intra_atual: 0.15, valor_brl: 1500 },
      { ticker: "XXX3", peso_intra: 0.25, peso_intra_atual: 0.75, valor_brl: 7500 },
    ] }],
  }));
  expect(r.pedindo.map((x: any) => x.ticker)).toEqual(["AAA3", "ZZZ3", "MMM3"]);
});

// Categoria sintética com um elegível sem dado (peso_intra_atual nulo). O
// backend nunca emite isso; o caso trava o ramo defensivo do `else` final.
function catSemDadoSintetica() {
  return {
    nome: "C", peso_alvo: 0.3, peso_atual: 0.3, valor_brl: 9000,
    buckets: [
      { tipo: "passive", peso_bucket: 0.7, peso_atual_bucket: 0.7, ativos: [
        { ticker: "PAS11", peso_intra: 0.5, peso_intra_atual: 0.5, valor_brl: 2500 },
        { ticker: "NULO11", peso_intra: 0.5, peso_intra_atual: null, valor_brl: 2500 },
      ] },
      { tipo: "picks", peso_bucket: 0.3, peso_atual_bucket: 0.3, ativos: [
        { ticker: "PIC3", peso_intra: 0.5, peso_intra_atual: 0.5, valor_brl: 2000 },
        { ticker: "PIC4", peso_intra: 0.5, peso_intra_atual: 0.5, valor_brl: 2000 },
      ] },
    ],
  };
}

// Conservação: cada ativo do payload cai em exatamente um dos quatro grupos.
const CASOS_CONSERVACAO: [string, any][] = [
  ["Ações BR sintética", acoesBrSintetica()],
  ["cesta única, dois elegíveis", {
    nome: "C", peso_alvo: 0.1, peso_atual: 0.1, valor_brl: 3000,
    buckets: [{ tipo: "passive", peso_bucket: 1, peso_atual_bucket: 1, ativos: [
      { ticker: "UNIC11", peso_intra: 0.5, peso_intra_atual: 0.5, valor_brl: 1000 },
      { ticker: "UNIC12", peso_intra: 0.5, peso_intra_atual: 0.5, valor_brl: 1000 },
      { ticker: "OFF3", fora_do_alvo: true, peso_intra: 0, peso_intra_atual: 0, valor_brl: 1000 },
    ] }],
  }],
  // Cesta de um único elegível numa categoria de duas cestas (ramo
  // `eleg.length === 1`). Aqui só a partição é conferida; o estado herdado da
  // cesta é travado pelo teste da Ações BR sintética (BOVA11 em pedindo).
  ["duas cestas, uma com um único elegível", {
    nome: "C", peso_alvo: 0.2, peso_atual: 0.2, valor_brl: 5000,
    buckets: [
      { tipo: "passive", peso_bucket: 0.7, peso_atual_bucket: 0.8, ativos: [
        { ticker: "PAS12", peso_intra: 0.5, peso_intra_atual: 0.5, valor_brl: 2000 },
        { ticker: "PAS13", peso_intra: 0.5, peso_intra_atual: 0.5, valor_brl: 2000 },
      ] },
      { tipo: "picks", peso_bucket: 0.3, peso_atual_bucket: 0.2, ativos: [
        { ticker: "SOLO3", peso_intra: 1, peso_intra_atual: 1, valor_brl: 500 },
        { ticker: "QUAR3", quarentena: true, peso_intra: 0, peso_intra_atual: 1, valor_brl: 500 },
      ] },
    ],
  }],
  // Elegível com peso_intra_atual nulo => estado sem_dado: cai no `else` final
  // e fica em naFaixa (defensivo), nunca some.
  ["duas cestas, elegível sem_dado", catSemDadoSintetica()],
];
for (const [nome, cat] of CASOS_CONSERVACAO) {
  test(`alocAgruparAtivos: conservação — ${nome}`, async ({ page }) => {
    const r = await page.evaluate((c) => (window as any).alocAgruparAtivos(c), cat);
    const payload: string[] = cat.buckets.flatMap((b: any) => b.ativos.map((a: any) => a.ticker));
    const saida: string[] = [
      ...r.pedindo.map((x: any) => x.ticker), ...r.acima.map((x: any) => x.ticker),
      ...r.naFaixa, ...r.semAlvo.map((x: any) => x.ticker),
    ];
    expect(r.pedindo.length + r.acima.length + r.naFaixa.length + r.semAlvo.length).toBe(payload.length);
    expect(saida.length).toBe(new Set(saida).size);
    expect([...saida].sort()).toEqual([...payload].sort());
  });
}

test("alocAgruparAtivos: elegível sem_dado fica em naFaixa", async ({ page }) => {
  const r = await page.evaluate((c) => (window as any).alocAgruparAtivos(c), catSemDadoSintetica());
  expect(r.naFaixa).toContain("NULO11");
  expect(r.pedindo.map((x: any) => x.ticker)).not.toContain("NULO11");
  expect(r.acima.map((x: any) => x.ticker)).not.toContain("NULO11");
});
