import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

const FIXTURE = fs.readFileSync(
  path.join(__dirname, "../fixtures/portfolio.test.json.enc"),
  "utf-8",
);

// Copiado de alocacao.spec.ts — PIN + intercept do portfolio + landing no #alocacao.
async function autenticar(page: Page) {
  await page.route("**/portfolio.json.enc", (route) =>
    route.fulfill({ status: 200, body: FIXTURE, contentType: "text/plain" }),
  );
  await page.addInitScript(() => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem(
      "pinTimestamp",
      String(Date.now() - 1 * 24 * 60 * 60 * 1000),
    );
  });
  await page.goto("/");
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
  await page.goto("/#alocacao");
  await expect(page.locator(".tela-alocacao")).toBeVisible();
  await expect(page.locator(".tela-alocacao .aloca-cat").first()).toBeVisible();
}

// Injeta 3 categorias sintéticas via Alpine.$data — inclui uma estreita (<7%)
// pra exercitar a regra dos estreitos sem precisar regenerar a fixture binária.
// Replica o pattern de raiox-ultimos-7d.spec.ts / aportar.spec.ts.
const CATS_COM_ESTREITA = [
  {
    nome: "Ações BR",
    peso_alvo: 0.30,
    peso_atual: 0.272,
    drift: -0.028,
    valor_brl: 27200.0,
    buckets: [],
  },
  {
    nome: "EUA",
    peso_alvo: 0.65,
    peso_atual: 0.68,
    drift: 0.03,
    valor_brl: 68000.0,
    buckets: [],
  },
  {
    nome: "Cripto",
    peso_alvo: 0.05,
    peso_atual: 0.048,
    drift: -0.002,
    valor_brl: 4800.0,
    buckets: [],
  },
];

// Autentica + instala um spy em Element.prototype.scrollIntoView ANTES do
// app.js carregar (addInitScript roda antes de qualquer script da página).
// Chamadas ficam em window.__scrollCalls (id do elemento + opções).
async function autenticarComSpyScroll(page: Page) {
  await page.route("**/portfolio.json.enc", (route) =>
    route.fulfill({ status: 200, body: FIXTURE, contentType: "text/plain" }),
  );
  await page.addInitScript(() => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem(
      "pinTimestamp",
      String(Date.now() - 1 * 24 * 60 * 60 * 1000),
    );
    (window as any).__scrollCalls = [];
    Element.prototype.scrollIntoView = function (opts: any) {
      (window as any).__scrollCalls.push({ id: this.id, opts });
    };
  });
  await page.goto("/");
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
  await page.goto("/#alocacao");
  await expect(page.locator(".tela-alocacao")).toBeVisible();
  await expect(page.locator(".tela-alocacao .aloca-cat").first()).toBeVisible();
}

async function injetarCategorias(page: Page, categorias: unknown[]) {
  await page.evaluate((cats) => {
    const $data = (window as any).Alpine?.$data?.(document.body);
    if (!$data) {
      throw new Error("injetarCategorias: Alpine.$data(document.body) é undefined");
    }
    $data.json.politica.categorias = cats;
  }, categorias);
}

function parseStyleFloat(style: string, prop: "width" | "left"): number {
  const re = new RegExp(prop + "\\s*:\\s*([\\d.]+)%");
  const m = style.match(re);
  return m ? parseFloat(m[1]) : NaN;
}

// Fixture SINTÉTICA (valores artificiais, NÃO a carteira real — o sibling é
// repo público) que reproduz a FORMA do caso que quebrava a faixa no celular
// (fix 2026-07-05): 5 categorias, incluindo um nome longo ("Renda Fixa BR"),
// uma estreita na faixa 7–12% (Renda Fixa BR ~9%) e uma de alvo 0% mas com
// posição atual (Cripto). Pesos redondos que somam 1.0; BRL de magnitude
// redonda não relacionada ao patrimônio real.
const CATS_SINTETICAS = [
  { nome: "EUA", peso_alvo: 0.50, peso_atual: 0.55, drift: 0.05, valor_brl: 55000, buckets: [] },
  { nome: "FIIs", peso_alvo: 0.22, peso_atual: 0.19, drift: -0.03, valor_brl: 19000, buckets: [] },
  { nome: "Ações BR", peso_alvo: 0.15, peso_atual: 0.14, drift: -0.01, valor_brl: 14000, buckets: [] },
  { nome: "Renda Fixa BR", peso_alvo: 0.13, peso_atual: 0.09, drift: -0.04, valor_brl: 9000, buckets: [] },
  { nome: "Cripto", peso_alvo: 0.0, peso_atual: 0.03, drift: 0.03, valor_brl: 3000, buckets: [] },
];

test.describe("Faixa de composição 100% #alocacao (7a.S.8)", () => {
  test(".compo precede .aloca-lista no DOM (mapa do todo primeiro)", async ({ page }) => {
    await autenticar(page);
    const ordem = await page.evaluate(() => {
      const tela = document.querySelector(".tela-alocacao");
      const filhos = Array.from(tela?.children || []);
      const idxCompo = filhos.findIndex((el) => el.classList.contains("compo"));
      const idxLista = filhos.findIndex((el) => el.classList.contains("aloca-lista"));
      return { idxCompo, idxLista };
    });
    expect(ordem.idxCompo).toBeGreaterThanOrEqual(0);
    expect(ordem.idxLista).toBeGreaterThan(ordem.idxCompo);
  });

  test("N segmentos = N cards de categoria; larguras proporcionais a peso_atual", async ({ page }) => {
    await autenticar(page);
    const nCards = await page.locator(".tela-alocacao .aloca-cat").count();
    const nSeg = await page.locator(".compo-seg").count();
    expect(nSeg).toBe(nCards);
    expect(nSeg).toBe(2); // fixture default: Ações BR + EUA

    const segs = await page.$$eval(".compo-seg", (els) =>
      els.map((el) => ({ style: el.getAttribute("style") || "", aria: el.getAttribute("aria-label") || "" })),
    );
    // Ações BR peso_atual=0.272, EUA peso_atual=0.73 (fixture). Larguras somam
    // ~100% (normalizadas pela soma de peso_atual — 7a.S.8) e são proporcionais.
    // categoriasAlocacaoOrdenadas ordena por peso_alvo DESC (EUA 0.70 > Ações
    // BR 0.30) — resolvemos por aria-label em vez de índice posicional.
    const larguras = segs.map((s) => parseStyleFloat(s.style, "width"));
    expect(larguras.every((w) => Number.isFinite(w))).toBe(true);
    const soma = larguras.reduce((a, b) => a + b, 0);
    expect(soma).toBeGreaterThan(99.5);
    expect(soma).toBeLessThan(100.5);
    const largAcoesBr = larguras[segs.findIndex((s) => s.aria.includes("Ações BR"))];
    const largEua = larguras[segs.findIndex((s) => s.aria.includes("EUA"))];
    const razaoEsperada = 0.272 / 0.73;
    const razaoObservada = largAcoesBr / largEua;
    expect(razaoObservada).toBeGreaterThan(razaoEsperada - 0.02);
    expect(razaoObservada).toBeLessThan(razaoEsperada + 0.02);
  });

  test("cor do segmento reusa a identidade --cat-* (sem cor hardcoded)", async ({ page }) => {
    await autenticar(page);
    const cores = await page.$$eval(".compo-seg", (els) => {
      const grab = (nome: string) => {
        const el = els.find((e) => (e.getAttribute("aria-label") || "").includes(nome));
        return el ? getComputedStyle(el).backgroundColor : null;
      };
      return { acoesBr: grab("Ações BR"), eua: grab("EUA") };
    });
    expect(cores.acoesBr).toBe("rgb(4, 120, 87)"); // --cat-acoes-br
    expect(cores.eua).toBe("rgb(30, 96, 145)"); // --cat-eua
  });

  test("target ticks: N ticks = N categorias, posições cumulativas de peso_alvo", async ({ page }) => {
    await autenticar(page);
    const ticks = await page.$$eval(".compo-tick", (els) =>
      els.map((el) => ({
        style: el.getAttribute("style") || "",
        tv: el.querySelector(".tv")?.textContent?.trim() || "",
      })),
    );
    expect(ticks.length).toBe(2);
    // Ações BR peso_alvo=0.30, EUA peso_alvo=0.70 (soma exata 1.0). tv mostra
    // o peso_alvo PRÓPRIO da categoria (não o acumulado); categoriasAlocacao-
    // Ordenadas ordena por peso_alvo DESC → EUA (70%) vem primeiro, então sua
    // marca cumulativa cai em 70%; Ações BR (30%) fecha o acumulado em 100%.
    const pos = ticks.map((t) => parseStyleFloat(t.style, "left"));
    const idxEua = ticks.findIndex((t) => t.tv.replace(/\D/g, "") === "70");
    const idxAcoesBr = ticks.findIndex((t) => t.tv.replace(/\D/g, "") === "30");
    expect(idxEua).toBeGreaterThanOrEqual(0);
    expect(idxAcoesBr).toBeGreaterThanOrEqual(0);
    expect(pos[idxEua]).toBeGreaterThan(68);
    expect(pos[idxEua]).toBeLessThan(72);
    expect(pos[idxAcoesBr]).toBeGreaterThan(98);
    expect(pos[idxAcoesBr]).toBeLessThan(101);
  });

  test("regra dos estreitos: categoria estreita esconde o label mas mantém aria-label completo", async ({ page }) => {
    await autenticar(page);
    await injetarCategorias(page, CATS_COM_ESTREITA);
    await expect(page.locator(".compo-seg")).toHaveCount(3);

    // A visibilidade do rótulo agora é decidida por medição (ajustarLabelsFaixa
    // alterna .sl visibility). Cripto (~5%) é estreita demais → escondida; Ações
    // BR (27%) e EUA (68%) cabem → visíveis. A medição é assíncrona ($nextTick),
    // então poll até assentar.
    const dado = async (nome: string) =>
      page.$$eval(
        ".compo-seg",
        (segs, [alvo, visSrc]) => {
          const vis = new Function("el", `return (${visSrc})(el)`) as (e: Element) => boolean;
          const el = segs.find((s) => (s.getAttribute("aria-label") || "").includes(alvo));
          if (!el) return null;
          const sl = el.querySelector(".sl");
          return { aria: el.getAttribute("aria-label") || "", labelVisivel: !!sl && vis(sl) };
        },
        [nome, slVisivel.toString()] as [string, string],
      );

    await expect.poll(async () => (await dado("Ações BR"))?.labelVisivel).toBe(true);
    await expect.poll(async () => (await dado("EUA"))?.labelVisivel).toBe(true);
    const cripto = await dado("Cripto");
    expect(cripto!.labelVisivel).toBe(false);
    expect(cripto!.aria).toMatch(/Cripto/);
    expect(cripto!.aria).toMatch(/atual/);
    expect(cripto!.aria).toMatch(/alvo/);
    expect(cripto!.aria).toMatch(/%/);
  });

  test("segmentos são <button> operáveis (a11y)", async ({ page }) => {
    await autenticar(page);
    const tags = await page.$$eval(".compo-seg", (els) => els.map((el) => el.tagName));
    expect(tags.every((t) => t === "BUTTON")).toBe(true);
  });

  test("tap num segmento esmaece os irmãos + pisca o card certo + rola até ele", async ({ page }) => {
    await autenticarComSpyScroll(page);
    const segs = page.locator(".compo-seg");
    const idxEua = await segs.evaluateAll((els) =>
      els.findIndex((el) => (el.getAttribute("aria-label") || "").includes("EUA")),
    );
    await segs.nth(idxEua).click();

    // (a) irmãos esmaecidos, o próprio tocado não.
    const dimState = await segs.evaluateAll((els) =>
      els.map((el) => ({ aria: el.getAttribute("aria-label") || "", dim: el.classList.contains("dim") })),
    );
    const euaState = dimState.find((d) => d.aria.includes("EUA"));
    const acoesBrState = dimState.find((d) => d.aria.includes("Ações BR"));
    expect(euaState!.dim).toBe(false);
    expect(acoesBrState!.dim).toBe(true);

    // (b) o card EUA pisca.
    const cardEua = page.locator("#aloca-cat-EUA");
    await expect(cardEua).toHaveClass(/flash/);

    // (a11y CRB) a região aria-live anuncia a categoria tocada.
    await expect(page.locator(".compo [aria-live='polite']")).toContainText("EUA");

    // scrollIntoView foi chamado no card certo, com behavior smooth.
    const chamadas = await page.evaluate(() => (window as any).__scrollCalls);
    expect(chamadas.length).toBeGreaterThan(0);
    const ultima = chamadas[chamadas.length - 1];
    expect(ultima.id).toBe("aloca-cat-EUA");
    expect(ultima.opts.behavior).toBe("smooth");
    expect(ultima.opts.block).toBe("start");

    // Após o settle (~1400ms), dim/flash são removidos.
    await expect(cardEua).not.toHaveClass(/flash/, { timeout: 2000 });
    const dimApos = await segs.evaluateAll((els) => els.map((el) => el.classList.contains("dim")));
    expect(dimApos.every((d) => d === false)).toBe(true);
  });

  test("reduced-motion: tap rola (behavior auto) mas NÃO aplica dim nos irmãos nem flash no card", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await autenticarComSpyScroll(page);
    const segs = page.locator(".compo-seg");
    const idxEua = await segs.evaluateAll((els) =>
      els.findIndex((el) => (el.getAttribute("aria-label") || "").includes("EUA")),
    );
    await segs.nth(idxEua).click();

    const chamadas = await page.evaluate(() => (window as any).__scrollCalls);
    expect(chamadas.length).toBeGreaterThan(0);
    const ultima = chamadas[chamadas.length - 1];
    expect(ultima.id).toBe("aloca-cat-EUA");
    expect(ultima.opts.behavior).toBe("auto");

    // Sem pulso: nenhum segmento ganha .dim, nenhum card ganha .flash.
    const dimState = await segs.evaluateAll((els) => els.map((el) => el.classList.contains("dim")));
    expect(dimState.every((d) => d === false)).toBe(true);
    await expect(page.locator(".aloca-cat.flash")).toHaveCount(0);

    // (a11y CRB) o anúncio aria-live DISPARA mesmo sob reduced-motion — é a11y,
    // não motion: o leitor de tela precisa da confirmação do tap.
    await expect(page.locator(".compo [aria-live='polite']")).toContainText("EUA");

    await context.close();
  });
});

// Fix 2026-07-05: legibilidade da faixa no celular com 5 categorias (fixture
// sintética CATS_SINTETICAS, forma do caso real). O threshold fixo antigo
// (peso_atual ≥ 7%, depois larguraPct ≥ 12%) escondia categorias reais como
// Renda Fixa BR (~9%) mesmo quando o número "PP%" caberia. Agora a decisão é
// por MEDIÇÃO: o rótulo (.sl, só o percentual) aparece sempre que couber de
// verdade no segmento (ajustarLabelsFaixa), senão fica só cor. Antes do fix
// original os labels "Nome PP%" transbordavam e colidiam em texto ilegível.

// Um .sl conta como visível quando não está nem display:none nem
// visibility:hidden (a medição usa visibility p/ poder medir sem reflow).
function slVisivel(el: Element): boolean {
  const cs = getComputedStyle(el);
  return cs.display !== "none" && cs.visibility !== "hidden";
}

test.describe("Faixa mobile — legibilidade com 5 categorias (fix 2026-07-05)", () => {
  test("label interno do segmento é só o percentual (sem nome de categoria)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await autenticar(page);
    await injetarCategorias(page, CATS_SINTETICAS);
    await expect(page.locator(".compo-seg")).toHaveCount(5);

    await expect
      .poll(async () =>
        page.$$eval(".compo-seg .sl", (els, visSrc) => {
          const vis = new Function("el", `return (${visSrc})(el)`) as (e: Element) => boolean;
          return els.filter(vis).map((el) => el.textContent?.trim() || "");
        }, slVisivel.toString()),
      )
      .not.toEqual([]);

    const labels = await page.$$eval(".compo-seg .sl", (els, visSrc) => {
      const vis = new Function("el", `return (${visSrc})(el)`) as (e: Element) => boolean;
      return els.filter(vis).map((el) => el.textContent?.trim() || "");
    }, slVisivel.toString());
    // Todo label visível é APENAS "PP%" — dígitos + %, sem letras (nome mora no
    // card abaixo + no aria-label). Antes do fix vinha "EUA 58%", "Ações BR 14%".
    for (const t of labels) {
      expect(t).toMatch(/^\d+%$/);
    }
  });

  for (const w of [320, 390]) {
    test(`nenhum label visível transborda seu próprio segmento @ ${w}px (invariante)`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 844 });
      await autenticar(page);
      await injetarCategorias(page, CATS_SINTETICAS);
      await expect(page.locator(".compo-seg")).toHaveCount(5);

      // O invariante (label visível nunca extrapola o segmento) precisa valer
      // DEPOIS que a medição assíncrona assentou — poll até estabilizar em [].
      await expect
        .poll(async () =>
          page.$$eval(".compo-seg", (segs, visSrc) => {
            const vis = new Function("el", `return (${visSrc})(el)`) as (e: Element) => boolean;
            return segs
              .map((seg) => {
                const sl = seg.querySelector(".sl");
                if (!sl || !vis(sl)) return null;
                const s = seg.getBoundingClientRect();
                const r = sl.getBoundingClientRect();
                return r.left < s.left - 1 || r.right > s.right + 1
                  ? seg.getAttribute("aria-label")
                  : null;
              })
              .filter((x) => x !== null);
          }, slVisivel.toString()),
        )
        .toEqual([]);
    });
  }

  test("categoria de ~9% (Renda Fixa BR) MOSTRA seu % quando cabe; Cripto (estreita) fica só cor", async ({ page }) => {
    // Num celular típico (390px), Renda Fixa BR (~9%) tem largura suficiente
    // p/ "9%" — deve aparecer (era o ponto do Dr. Arthur: não podia ficar sem
    // número). Cripto (~3%, alvo 0) é estreita demais → só cor, mas o
    // aria-label de ambas segue completo (a11y).
    await page.setViewportSize({ width: 390, height: 844 });
    await autenticar(page);
    await injetarCategorias(page, CATS_SINTETICAS);
    await expect(page.locator(".compo-seg")).toHaveCount(5);

    const dado = async (nome: string) =>
      page.$$eval(
        ".compo-seg",
        (segs, [alvo, visSrc]) => {
          const vis = new Function("el", `return (${visSrc})(el)`) as (e: Element) => boolean;
          const el = segs.find((s) => (s.getAttribute("aria-label") || "").includes(alvo));
          if (!el) return null;
          const sl = el.querySelector(".sl");
          return {
            aria: el.getAttribute("aria-label") || "",
            visivel: !!sl && vis(sl),
            texto: sl?.textContent?.trim() || "",
          };
        },
        [nome, slVisivel.toString()] as [string, string],
      );

    await expect.poll(async () => (await dado("Renda Fixa BR"))?.visivel).toBe(true);
    const rf = await dado("Renda Fixa BR");
    expect(rf!.texto).toMatch(/^\d+%$/);
    expect(rf!.aria).toMatch(/Renda Fixa BR/);

    const cripto = await dado("Cripto");
    expect(cripto!.visivel).toBe(false);
    expect(cripto!.aria).toMatch(/Cripto/);
    expect(cripto!.aria).toMatch(/atual/);
    expect(cripto!.aria).toMatch(/alvo/);
  });

  test("resize re-mede: Renda Fixa BR aparece ao alargar de 320px → 390px", async ({ page }) => {
    // Exercita o @resize.window (ajustarLabelsFaixa re-mede na rotação/resize):
    // a 320px "9%" da Renda Fixa BR não cabe (escondida); ao alargar p/ 390px o
    // handler re-mede e o rótulo passa a caber → aparece.
    const rfVisivel = async () =>
      page.$$eval(
        ".compo-seg",
        (segs, visSrc) => {
          const vis = new Function("el", `return (${visSrc})(el)`) as (e: Element) => boolean;
          const el = segs.find((s) => (s.getAttribute("aria-label") || "").includes("Renda Fixa BR"));
          const sl = el?.querySelector(".sl");
          return !!sl && vis(sl);
        },
        slVisivel.toString(),
      );

    await page.setViewportSize({ width: 320, height: 844 });
    await autenticar(page);
    await injetarCategorias(page, CATS_SINTETICAS);
    await expect(page.locator(".compo-seg")).toHaveCount(5);
    await expect.poll(rfVisivel).toBe(false);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(rfVisivel).toBe(true);
  });

  test("categoria de alvo 0% (Cripto) NÃO emite tick; ticks = categorias com alvo > 0", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await autenticar(page);
    await injetarCategorias(page, CATS_SINTETICAS);

    // 5 segmentos (todas têm posição atual), mas só 4 têm alvo > 0.
    await expect(page.locator(".compo-seg")).toHaveCount(5);
    await expect(page.locator(".compo-tick")).toHaveCount(4);

    const tvs = await page.$$eval(".compo-tick .tv", (els) => els.map((e) => e.textContent?.trim() || ""));
    // Nenhum tick mostra "0%" (o alvo 0% da Cripto não vira régua).
    expect(tvs).not.toContain("0%");
  });

  test("alvo pequeno-mas-positivo (< 0,5%) também é omitido do tick (fronteira do epsilon)", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await autenticar(page);
    // Categoria do meio com alvo 0,3% (< 0.005): tem posição atual (vira
    // segmento) mas NÃO emite régua — seu tick cairia colado na anterior e o
    // label arredondaria p/ "0%". Vizinhas somam o resto p/ alvos = 1.0.
    await injetarCategorias(page, [
      { nome: "EUA", peso_alvo: 0.6, peso_atual: 0.5, drift: -0.1, valor_brl: 50000, buckets: [] },
      { nome: "Cripto", peso_alvo: 0.003, peso_atual: 0.05, drift: 0.047, valor_brl: 5000, buckets: [] },
      { nome: "FIIs", peso_alvo: 0.397, peso_atual: 0.45, drift: 0.053, valor_brl: 45000, buckets: [] },
    ]);
    await expect(page.locator(".compo-seg")).toHaveCount(3);
    await expect(page.locator(".compo-tick")).toHaveCount(2);
    const tvs = await page.$$eval(".compo-tick .tv", (els) => els.map((e) => e.textContent?.trim() || ""));
    expect(tvs).not.toContain("0%");
  });

  test("labels dos ticks ficam dentro da faixa (não vazam a borda direita/esquerda)", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await autenticar(page);
    await injetarCategorias(page, CATS_SINTETICAS);
    await expect(page.locator(".compo-tick")).toHaveCount(4);

    const vaza = await page.evaluate(() => {
      const band = document.querySelector(".compo-band")!.getBoundingClientRect();
      return Array.from(document.querySelectorAll<HTMLElement>(".compo-tick .tv"))
        .map((tv) => {
          const r = tv.getBoundingClientRect();
          return { txt: tv.textContent?.trim(), vazaR: r.right > band.right + 1, vazaL: r.left < band.left - 1 };
        })
        .filter((x) => x.vazaR || x.vazaL);
    });
    expect(vaza).toEqual([]);
  });

  test("sem overflow horizontal do documento a 320px com as 5 categorias reais", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await autenticar(page);
    await injetarCategorias(page, CATS_SINTETICAS);
    await expect(page.locator(".compo-seg")).toHaveCount(5);

    const overflowX = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflowX).toBe(false);
  });
});
