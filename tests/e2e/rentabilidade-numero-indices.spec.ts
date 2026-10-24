import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

// Fase 7a.BG.2 — o número no fim da curva tracejada "Mesma carteira, só com
// índices", ao lado do que a "Sua carteira" já tinha (spec 2026-10-23-fase-7a-bg,
// §5). Fixture 100% sintética (repo público): a mesma de rentabilidade-ponte
// (tests/fixtures/gerar_fixture.py, `_ponte_sintetica`), 30 meses 2024-04..2026-09,
// buraco de cotação em ago/24 (Total e Brasil), IFIX null em dez/24. Os casos
// que a fixture não tem (curvas iguais, fim em queda) são forçados por
// `mexerNoPayload`, com a mutação documentada no próprio teste.
//
// Regra de posição (sem limiar): o maior dos dois valores finais leva o rótulo
// em cima e o menor embaixo, SEMPRE; empate, a carteira em cima.

const FIXTURES = path.join(__dirname, "../fixtures");
const lerFixture = (nome: string) => fs.readFileSync(path.join(FIXTURES, nome), "utf-8");

const TELA = ".tela-rentabilidade";
const tid = (id: string) => `${TELA} [data-testid="${id}"]`;
const SETTLE = 400; // > RENT2_SETTLE_MS (150): o aria só se atualiza no settle

async function autenticar(page: Page, fixture = "portfolio.test.json.enc") {
  const corpo = lerFixture(fixture);
  await page.route("**/portfolio.json.enc", (route) =>
    route.fulfill({ status: 200, body: corpo, contentType: "text/plain" }),
  );
  await page.addInitScript(() => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem("pinTimestamp", String(Date.now() - 24 * 60 * 60 * 1000));
    localStorage.removeItem("moedaEUA");
  });
  await page.goto("/");
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
}

// Copiado de rentabilidade-ponte.spec.ts: altera o payload decifrado ANTES de
// o app usá-lo, embrulhando JSON.parse.
async function mexerNoPayload(page: Page, corpo: string) {
  await page.addInitScript((c) => {
    const real = JSON.parse;
    const mexer = new Function("p", c) as (p: any) => void;
    JSON.parse = function (texto: string, reviver?: any) {
      const o = real.call(JSON, texto, reviver);
      if (o && typeof o === "object" && "versao" in o && "ponte" in o) mexer(o);
      return o;
    } as typeof JSON.parse;
  }, corpo);
}

async function abrir(page: Page) {
  await page.goto("/#rentabilidade");
  await expect(page.locator(tid("rent2-frase"))).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(`${TELA} canvas[data-zr-dom-id]`)).toBeVisible({ timeout: 5_000 });
}

async function escopo(page: Page, nome: "Total" | "Brasil" | "EUA") {
  await page.locator(`${TELA} button[data-escopo="${nome}"]`).click();
  await expect(page.locator(`${TELA} button[data-escopo="${nome}"].active`)).toBeVisible();
}

// Arrasto: a mesma ação `dataZoom` que o slider despacha (ver rentabilidade-ponte).
async function arrastar(page: Page, iIni: number, iFim: number) {
  await page.evaluate(([a, b]) => {
    const d = (window as any).Alpine.$data(document.body);
    const off = d._rentCtx.off;
    d.echartsRent.dispatchAction({ type: "dataZoom", startValue: a - 1 - off, endValue: b - off });
  }, [iIni, iFim]);
}

// Formatação do lado do teste, independente do app: a regra de rent2PctPts
// (1 casa, vírgula decimal, sinal de menos U+2212, "%"), aplicada a p = v × 100.
// O arredondamento é o round() do Python: sobre o valor EXATO do double, com
// empate para o par. Reproduzido aqui por aritmética exata (BigInt sobre os
// bits do double), sem chamar ponteRoundPy do app.
function exatoDoDouble(x: number): { neg: boolean; num: bigint; den: bigint } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const bits = dv.getBigUint64(0);
  const neg = (bits >> 63n) === 1n;
  const expo = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  const mant = expo === 0 ? frac : frac | (1n << 52n);
  const e = (expo === 0 ? 1 : expo) - 1075; // x = mant · 2^e
  return e >= 0
    ? { neg, num: mant << BigInt(e), den: 1n }
    : { neg, num: mant, den: 1n << BigInt(-e) };
}

// Décimos inteiros de p arredondado a 1 casa, meio-para-par sobre o valor exato.
function decimosMeioPar(p: number): number {
  const { neg, num, den } = exatoDoDouble(p);
  const n10 = num * 10n;
  let q = n10 / den;
  const r2 = (n10 % den) * 2n;
  if (r2 > den || (r2 === den && q % 2n === 1n)) q += 1n;
  const d = Number(q);
  return neg ? -d : d;
}

function fmtEsperado(v: number): string {
  const d = decimosMeioPar(v * 100);
  const abs = Math.abs(d);
  return (d < 0 ? "−" : "") + `${Math.trunc(abs / 10)},${abs % 10}` + "%";
}

type Serie = {
  name: string;
  data: Array<number | null>;
  mp: null | {
    n: number; coord: [number, number] | null; texto: string | null; pos: string | null;
    contorno: string | null; contornoLargura: number | null;
  };
};

function lerSeriesNoBrowser(): Serie[] {
  const d = (window as any).Alpine.$data(document.body);
  return d.echartsRent.getOption().series.map((s: any) => {
    const mp = s.markPoint;
    return {
      name: s.name,
      data: s.data,
      mp: !mp ? null : {
        n: Array.isArray(mp.data) ? mp.data.length : 0,
        coord: mp.data && mp.data[0] ? mp.data[0].coord : null,
        texto: mp.label && typeof mp.label.formatter === "function" ? mp.label.formatter() : null,
        pos: mp.label ? mp.label.position : null,
        contorno: mp.label ? mp.label.textBorderColor ?? null : null,
        contornoLargura: mp.label ? mp.label.textBorderWidth ?? null : null,
      },
    };
  });
}

async function series(page: Page): Promise<Serie[]> {
  return page.evaluate(lerSeriesNoBrowser);
}

function ultimo(data: Array<number | null>): { i: number; v: number } {
  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i] !== null && data[i] !== undefined) return { i, v: data[i] as number };
  }
  return { i: -1, v: NaN };
}

// As travas comuns a toda janela: um markPoint em cada série, no último ponto
// desenhado, com o texto do último valor e a posição pelo ranking.
function conferirMarcadores(s: Serie[]) {
  expect(s.map((x) => x.name)).toEqual(["Sua carteira", "Mesma carteira, só com índices"]);
  const [cart, ind] = s;
  const uC = ultimo(cart.data);
  const uI = ultimo(ind.data);
  expect(uC.i).toBeGreaterThanOrEqual(0);
  expect(uI.i).toBe(uC.i); // rent2Curvas corta as duas no mesmo t
  for (const [serie, u] of [[cart, uC], [ind, uI]] as const) {
    expect(serie.mp).not.toBeNull();
    expect(serie.mp!.n).toBe(1);
    expect(serie.mp!.coord![0]).toBe(u.i);
    expect(serie.mp!.texto).toBe(fmtEsperado(u.v));
  }
  const cartEmCima = uC.v >= uI.v;
  expect(cart.mp!.pos).toBe(cartEmCima ? "top" : "bottom");
  expect(ind.mp!.pos).toBe(cartEmCima ? "bottom" : "top");
  return { cart: uC, ind: uI, textoCart: fmtEsperado(uC.v), textoInd: fmtEsperado(uI.v) };
}

async function conferirAria(page: Page, textoCart: string, textoInd: string) {
  await expect(page.locator(tid("rent2-grafico"))).toHaveAttribute(
    "aria-label",
    new RegExp(`\\. Sua carteira ${textoCart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}; só com índices ${textoInd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.$`),
  );
}

// Caixas, em coordenada de tela, dos elementos de texto do zrender. Os dois
// rótulos de fim de curva são os textos iguais aos formatters e horizontalmente
// perto do último ponto (descarta um rótulo do eixo y que por acaso tenha o
// mesmo texto); os do eixo x são os "mmm/aa".
async function caixas(page: Page) {
  return page.evaluate(() => {
    const d = (window as any).Alpine.$data(document.body);
    const ch = d.echartsRent;
    const op = ch.getOption();
    const s = op.series;
    const textos = [s[0].markPoint.label.formatter(), s[1].markPoint.label.formatter()];
    const xPonto = ch.convertToPixel({ seriesIndex: 0 }, s[0].markPoint.data[0].coord)[0];
    const lista = ch.getZr().storage.getDisplayList(true);
    const cx = (e: any) => {
      const r = e.getBoundingRect().clone();
      if (e.transform) r.applyTransform(e.transform);
      return { texto: e.style.text as string, x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const comTexto = lista.filter((e: any) => e.style && typeof e.style.text === "string").map(cx);
    const rotulos = comTexto.filter((c: any) => textos.includes(c.texto) && Math.abs(c.x + c.w / 2 - xPonto) < 40);
    const eixoX = comTexto.filter((c: any) => /^[a-z]{3}\/\d{2}$/.test(c.texto));
    const slider = op.dataZoom.find((z: any) => z.type === "slider");
    const h = ch.getHeight();
    const grid = ch.getModel().getComponent("grid", 0).coordinateSystem.getRect();
    return {
      textos, rotulos, eixoX, w: ch.getWidth(), h,
      sliderTopo: h - slider.bottom - slider.height,
      chaoDoGrid: grid.y + grid.height,
    };
  });
}

type Caixa = { texto: string; x: number; y: number; w: number; h: number };
const cruzam = (a: Caixa, b: Caixa, folga = 0) =>
  a.x < b.x + b.w + folga && b.x < a.x + a.w + folga && a.y < b.y + b.h + folga && b.y < a.y + a.h + folga;

test.describe("7a.BG.2 — número no fim da curva só com índices", () => {
  test("janela padrão: as duas séries com markPoint no último ponto, texto do último valor, maior em cima; aria com os dois", async ({ page }) => {
    await autenticar(page);
    await abrir(page);
    const r = conferirMarcadores(await series(page));
    // Fixture: em 12m a carteira (19,7%) ganha dos índices (18,7%).
    expect(r.cart.v).toBeGreaterThan(r.ind.v);
    await conferirAria(page, r.textoCart, r.textoInd);
    // Contorno na cor da superfície do card nos dois rótulos (legibilidade
    // quando o rótulo de baixo fica no caminho da própria curva).
    const s = await series(page);
    const superficie = await page.evaluate(() => (window as any).drarthurChart.tokens.surface);
    for (const x of s) {
      expect(x.mp!.contorno).toBe(superficie);
      expect(x.mp!.contornoLargura).toBeGreaterThan(0);
    }
    await expect(page.locator(tid("rent2-grafico"))).toHaveAttribute(
      "aria-label",
      `Sua carteira e a mesma carteira só com índices, Cresceu desde set/25 · até set/26. Sua carteira ${r.textoCart}; só com índices ${r.textoInd}.`,
    );
  });

  test("outra janela fixa (EUA, Desde): os dois formatters e as posições acompanham as curvas novas", async ({ page }) => {
    await autenticar(page);
    await abrir(page);
    const antes = conferirMarcadores(await series(page));
    await escopo(page, "EUA");
    await page.locator(tid("rent2-janela-desde")).click();
    await expect(page.locator(tid("rent2-janela-desde"))).toHaveAttribute("aria-pressed", "true");
    const r = conferirMarcadores(await series(page));
    expect([r.textoCart, r.textoInd]).not.toEqual([antes.textoCart, antes.textoInd]);
    await conferirAria(page, r.textoCart, r.textoInd);
  });

  test("arrasto: depois do settle, formatters, posições e aria da janela nova", async ({ page }) => {
    await autenticar(page);
    await abrir(page);
    await arrastar(page, 10, 20);
    await page.waitForTimeout(SETTLE);
    const r = conferirMarcadores(await series(page));
    expect(r.cart.i).toBe(20);
    await conferirAria(page, r.textoCart, r.textoInd);
  });

  test("inversão do ranking: a posição de cada série troca entre as duas janelas", async ({ page }) => {
    await autenticar(page);
    await abrir(page);
    const a = conferirMarcadores(await series(page));
    const sA = await series(page);
    // Controle positivo: na janela padrão a carteira está acima.
    expect(a.cart.v).toBeGreaterThan(a.ind.v);
    expect(sA[0].mp!.pos).toBe("top");
    // jul/26..ago/26 (meses 22..23): os índices rendem mais que a carteira na
    // fixture (3,57% e 3,63% contra 3,44% e 3,56% ao mês).
    await arrastar(page, 22, 23);
    await page.waitForTimeout(SETTLE);
    const sB = await series(page);
    const b = conferirMarcadores(sB);
    expect(b.ind.v).toBeGreaterThan(b.cart.v); // controle positivo: inverteu de fato
    expect(sB[0].mp!.pos).toBe("bottom");
    expect(sB[1].mp!.pos).toBe("top");
    expect(sB[0].mp!.pos).not.toBe(sA[0].mp!.pos);
    expect(sB[1].mp!.pos).not.toBe(sA[1].mp!.pos);
  });

  test("Total numa janela que atravessa ago/24: o markPoint de cada série fica no último ponto desenhado", async ({ page }) => {
    await autenticar(page);
    await abrir(page);
    // Lido no mesmo tick do evento de zoom (antes do settle, que volta à última
    // janela válida): é a curva cortada que está desenhada.
    const s = await page.evaluate((ler) => {
      const d = (window as any).Alpine.$data(document.body);
      const off = d._rentCtx.off;
      d.echartsRent.dispatchAction({ type: "dataZoom", startValue: 2 - 1 - off, endValue: 10 - off });
      return new Function(`return (${ler})()`)();
    }, lerSeriesNoBrowser.toString());
    const r = conferirMarcadores(s as Serie[]);
    // Buraco em ago/24 (mês 4): as duas curvas param em jul/24 (mês 3, off = 0).
    expect(r.cart.i).toBe(3);
    expect((s as Serie[])[0].data[4]).toBeNull();
    expect((s as Serie[])[1].data[4]).toBeNull();
  });

  test("curvas quase iguais: os dois rótulos aparecem e as caixas do zrender não se cruzam", async ({ page }) => {
    // Mutação mínima: todo ativo vira `passivo`. Na ponteJanela o passivo entra
    // no composto com o PRÓPRIO retorno (numInd += g), então R_ind = R_p em todo
    // mês e as duas curvas coincidem (diferença 0, ≤ 0,1 ponto). É o pior caso
    // de colisão: o mesmo y, o mesmo texto.
    await mexerNoPayload(page, "p.ponte.ativos.forEach((a) => { a.passivo = true; });");
    await autenticar(page);
    await abrir(page);
    const s = await series(page);
    const uC = ultimo(s[0].data);
    const uI = ultimo(s[1].data);
    expect(uI.i).toBe(uC.i);
    expect(Math.abs(uC.v - uI.v)).toBeLessThanOrEqual(0.001); // controle: quase iguais de fato

    // A medida vem ANTES das travas de posição: é ela que tem de morder se a
    // regra de posição quebrar (ex.: "top" nos dois), não o assert do enum.
    const c = await caixas(page);
    expect(c.rotulos.length).toBe(2); // controle positivo: achou os dois textos
    const [a, b] = c.rotulos as Caixa[];
    const separados = a.y + a.h + 1 <= b.y || b.y + b.h + 1 <= a.y; // folga ≥ 1 px no eixo y
    expect(separados, JSON.stringify(c.rotulos)).toBe(true);
    expect(cruzam(a, b)).toBe(false);

    conferirMarcadores(s);
    // Empate: a carteira em cima.
    expect(s[0].mp!.pos).toBe("top");
    expect(s[1].mp!.pos).toBe("bottom");
  });

  test("janela que termina no mínimo da curva: o rótulo de baixo não cobre o eixo x nem o slider", async ({ page }) => {
    // Fim em queda: no último mês (set/26, índice 29) todo ativo perde 30% da
    // base (g = −0,3·d) e todo índice BRL cai 30%. As duas curvas de 12m terminam
    // abaixo da âncora (0%), isto é, no mínimo da janela: o rótulo `bottom` vai
    // para a faixa entre o chão do grid e o slider.
    await mexerNoPayload(page, [
      "const t = p.ponte.meses.length - 1;",
      "p.ponte.brl[t] = p.ponte.brl[t].map(([i, d, g]) => [i, d, Math.round(-0.3 * d * 100) / 100]);",
      "for (const k of Object.keys(p.ponte.indices.BRL)) p.ponte.indices.BRL[k][t] = -0.3;",
    ].join("\n"));
    await autenticar(page);
    await abrir(page);
    const s = await series(page);
    const r = conferirMarcadores(s);
    const minimo = (data: Array<number | null>) => Math.min(...(data.filter((v) => v !== null) as number[]));
    // Controle positivo: o último ponto é o mínimo das duas curvas.
    expect(r.cart.v).toBe(minimo(s[0].data));
    expect(r.ind.v).toBe(minimo(s[1].data));
    expect(r.cart.v).toBeLessThan(0);

    const c = await caixas(page);
    expect(c.rotulos.length).toBe(2);
    expect(c.eixoX.length).toBeGreaterThan(0); // controle positivo: achou os rótulos do eixo x
    const [a, b] = c.rotulos as Caixa[];
    expect(cruzam(a, b, 1)).toBe(false);
    const deBaixo = a.y > b.y ? a : b;
    for (const x of c.eixoX as Caixa[]) {
      expect(cruzam(deBaixo, x), `${JSON.stringify(deBaixo)} × ${JSON.stringify(x)}`).toBe(false);
    }
    expect(deBaixo.y + deBaixo.h).toBeLessThanOrEqual(c.sliderTopo);
    // Mais forte que "não cruza nenhum mmm/aa": o eixo x esconde rótulos que se
    // sobrepõem (hideOverlap) e o do último mês pode ou não estar desenhado,
    // conforme a janela. O rótulo de baixo fica DENTRO do grid, acima da faixa
    // dos rótulos do eixo x, qualquer que seja a janela.
    expect(deBaixo.y + deBaixo.h, JSON.stringify({ deBaixo, chao: c.chaoDoGrid })).toBeLessThanOrEqual(c.chaoDoGrid);
    // Nenhum rótulo cortado pela borda direita do canvas.
    for (const x of c.rotulos as Caixa[]) expect(x.x + x.w).toBeLessThanOrEqual(c.w);
  });

  test("fmtEsperado: meio-para-par sobre o valor exato do double (o round() do Python)", () => {
    // Empates exatos (0,25 e −0,25 e 0,75 são representáveis): vence o par.
    expect(decimosMeioPar(0.25)).toBe(2);
    expect(decimosMeioPar(-0.25)).toBe(-2);
    expect(decimosMeioPar(0.75)).toBe(8);
    // Não-empates: o double de 0,35 é 0,34999…978 (desce) e o de 0,45 é
    // 0,45000…011 (sobe). Math.round(x·10) daria 4 e 5, e erraria o primeiro.
    expect(decimosMeioPar(0.35)).toBe(3);
    expect(decimosMeioPar(0.45)).toBe(5);
    // Pelo formatter inteiro, em fração (v × 100 = 0,25 exato).
    expect(fmtEsperado(0.0025)).toBe("0,2%");
    expect(fmtEsperado(-0.0025)).toBe("−0,2%");
    expect(fmtEsperado(0.197)).toBe("19,7%");
  });

  test("vista indisponível com a curva cortada em ago/24 (Total): depois do settle, o aria diz os dois números do último ponto desenhado", async ({ page }) => {
    // Para o settle cair no ramo "sem janela válida anterior" de _rent2Soltar
    // (que aplica a própria janela indisponível, com a curva cortada), a janela
    // inicial também tem de ser indisponível: um buraco extra em fev/26 (mês 22)
    // no Total derruba o 12m. A curva cortada que se lê é a do buraco real de
    // ago/24.
    await mexerNoPayload(page, "p.ponte.buracos.Total.push(22);");
    await autenticar(page);
    // Sem `abrir`: com a vista indisponível não há frase do veredito para esperar.
    await page.goto("/#rentabilidade");
    await expect(page.locator(`${TELA} canvas[data-zr-dom-id]`)).toBeVisible({ timeout: 10_000 });
    await arrastar(page, 2, 10);
    await page.waitForTimeout(SETTLE);
    const ctl = await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      return { indisponivel: d.rent2.vista.indisponivel, iIni: d.rent2.iIni, iFim: d.rent2.iFim, ultimaValida: d._rentCtx.ultimaValida };
    });
    // Controle positivo: a vista é a indisponível da janela 2..10, sem janela válida.
    expect(ctl.indisponivel).toBeTruthy();
    expect([ctl.iIni, ctl.iFim]).toEqual([2, 10]);
    expect(ctl.ultimaValida).toBeNull();
    const s = await series(page);
    const r = conferirMarcadores(s);
    expect(r.cart.i).toBe(3); // cortada em jul/24
    expect(s[0].mp!.texto).toBe(r.textoCart);
    expect(s[1].mp!.texto).toBe(r.textoInd);
    await conferirAria(page, r.textoCart, r.textoInd);
  });
});
