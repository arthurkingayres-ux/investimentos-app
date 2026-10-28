import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

// Fase 7a.BK.1 (Task 2) — topo e cartão da #alocacao pela faixa de tolerância
// (spec 7a.BK §3.2, §3.3, §3.5, §3.6). Fixtures 100% sintéticas (repo público),
// geradas por tests/fixtures/gerar_fixture.py:
//   portfolio_alocacao_faixa     EUA 0,50/0,58 (acima) · Ações BR 0,25/0,20 (abaixo)
//                                FIIs 0,15/0,14 (na faixa) · Renda Fixa BR 0,10/0,05
//                                (abaixo) · Classe X 0/0,03 (sem alvo)
//   portfolio_alocacao_na_faixa  EUA 0,50/0,51 · Ações BR 0,30/0,285 · FIIs 0,20/0,205

const FIXTURES = path.join(__dirname, "../fixtures");
const FAIXA = "portfolio_alocacao_faixa.test.json.enc";
const NA_FAIXA = "portfolio_alocacao_na_faixa.test.json.enc";
const TELA = ".tela-alocacao";

test.use({ viewport: { width: 390, height: 844 } });

async function autenticar(page: Page, fixture = "portfolio.test.json.enc", tema?: "light" | "dark") {
  const corpo = fs.readFileSync(path.join(FIXTURES, fixture), "utf-8");
  await page.route("**/portfolio.json.enc", (route) =>
    route.fulfill({ status: 200, body: corpo, contentType: "text/plain" }),
  );
  await page.addInitScript((t) => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem("pinTimestamp", String(Date.now() - 24 * 60 * 60 * 1000));
    if (t) localStorage.setItem("tema", t);
  }, tema ?? null);
  await page.goto("/");
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
}

async function abrirAlocacao(page: Page, fixture?: string, tema?: "light" | "dark") {
  await autenticar(page, fixture, tema);
  await page.goto("/#alocacao");
  await expect(page.locator(`${TELA} .aloca-cat`).first()).toBeVisible();
}

// Molde do injetarCategorias do spec da faixa empilhada (7a.S.8), que saiu.
async function injetarCategorias(page: Page, categorias: unknown[]) {
  await page.evaluate((cats) => {
    const $data = (window as any).Alpine?.$data?.(document.body);
    if (!$data) throw new Error("injetarCategorias: Alpine.$data(document.body) é undefined");
    $data.json.politica.categorias = cats;
  }, categorias);
}

function cardPorNome(page: Page, nome: string) {
  return page.locator(`${TELA} .aloca-cat`, {
    has: page.locator(".aloca-cat__nome", { hasText: new RegExp(`^${nome}$`) }),
  });
}

test.describe("7a.BK.1 — topo da #alocacao (frase-resumo e grifo)", () => {
  test("faixa: frase-resumo nomeia quem pede aporte e quem está acima", async ({ page }) => {
    await abrirAlocacao(page, FAIXA);
    const frase = page.locator(`${TELA} [data-testid="aloca-frase"]`);
    await expect(frase).toBeVisible();
    await expect(frase).toHaveText(
      "Ações BR e Renda Fixa BR estão pedindo aporte. EUA está acima da faixa.",
    );
    await expect(frase).toHaveClass(/aloca-frase/);
  });

  test("faixa: grifo aponta as categorias abaixo da faixa, sem pp", async ({ page }) => {
    await abrirAlocacao(page, FAIXA);
    const grifo = page.locator(`${TELA} .aloca-grifo`);
    await expect(grifo).toBeVisible();
    // Copy aprovada verbatim (spec §3.2, §4(h)): sem ponto final.
    await expect(grifo.locator(".aloca-grifo__texto")).toHaveText(
      "Próximo aporte vai para Ações BR e Renda Fixa BR",
    );
    await expect(grifo).toContainText("Simular aporte");
    expect(await grifo.innerText()).not.toMatch(/pp/);
  });

  test("na_faixa: 'Todas as categorias estão na faixa.' e nenhum grifo", async ({ page }) => {
    await abrirAlocacao(page, NA_FAIXA);
    await expect(page.locator(`${TELA} [data-testid="aloca-frase"]`)).toHaveText(
      "Todas as categorias estão na faixa.",
    );
    await expect(page.locator(`${TELA} .aloca-grifo`)).toBeHidden();
  });

  test("política vazia: politica-intro visível; frase, grifo e rodapé de cripto ocultos", async ({ page }) => {
    await abrirAlocacao(page, FAIXA);
    // Controle positivo: a fixture tem cripto > 0 e payload 2.31+.
    await expect(page.locator(`${TELA} [data-testid="cripto-rodape"]`)).toBeVisible();
    await injetarCategorias(page, []);
    await expect(page.locator(`${TELA} [data-testid="cripto-rodape"]`)).toHaveCount(0);
    await expect(page.locator(`${TELA} .politica-intro`)).toBeVisible();
    await expect(page.locator(`${TELA} .aloca-frase`)).toBeHidden();
    await expect(page.locator(`${TELA} .aloca-grifo`)).toBeHidden();
  });

  test("nome de categoria do payload entra no grifo como texto, nunca como HTML", async ({ page }) => {
    await abrirAlocacao(page, FAIXA);
    await injetarCategorias(page, [
      { nome: "<b>X</b>", peso_alvo: 0.5, peso_atual: 0.3, drift: -0.2, valor_brl: 30000, buckets: [] },
      { nome: "EUA", peso_alvo: 0.5, peso_atual: 0.5, drift: 0, valor_brl: 50000, buckets: [] },
    ]);
    const grifo = page.locator(`${TELA} .aloca-grifo`);
    await expect(grifo).toBeVisible();
    expect(await grifo.innerText()).toContain("<b>X</b>");
    await expect(page.locator(`${TELA} .aloca-grifo b`)).toHaveCount(0);
  });

  test("faixa: nada da faixa empilhada sobra no DOM", async ({ page }) => {
    await abrirAlocacao(page, FAIXA);
    await expect(page.locator(`${TELA} .compo-band`)).toHaveCount(0);
    await expect(page.locator(`${TELA} .compo-seg`)).toHaveCount(0);
    await expect(page.locator(`${TELA} .compo-tick`)).toHaveCount(0);
  });
});

test.describe("7a.BK.1 — cartão da categoria (trilho e rodapé)", () => {
  const RODAPES: [string, string, string | null][] = [
    ["EUA", "Acima da faixa", "alvo 50,0% · faixa 45,0% a 55,0%"],
    ["Ações BR", "Pedindo aporte", "alvo 25,0% · faixa 22,5% a 27,5%"],
    ["FIIs", "Na faixa", "alvo 15,0% · faixa 13,0% a 17,0%"],
    ["Renda Fixa BR", "Pedindo aporte", "alvo 10,0% · faixa 8,0% a 12,0%"],
    ["Classe X", "Sem alvo", null],
  ];

  test("faixa: rodapé com estado em palavra e faixa por extenso", async ({ page }) => {
    await abrirAlocacao(page, FAIXA);
    for (const [nome, estado, faixa] of RODAPES) {
      const card = cardPorNome(page, nome);
      await expect(card.locator('[data-testid="aloca-cat-estado"]'), nome).toHaveText(estado);
      const ft = card.locator('[data-testid="aloca-cat-faixa"]');
      if (faixa) await expect(ft, nome).toHaveText(faixa);
      else await expect(ft, nome).toBeHidden();
    }
    // Classe X: sem alvo, sem trilho.
    await expect(cardPorNome(page, "Classe X").locator('[data-testid="aloca-trilho"]')).toBeHidden();
    // Cor do estado: a classe modificadora acompanha o estado.
    await expect(cardPorNome(page, "EUA").locator(".aloca-cat__estado")).toHaveClass(/aloca-cat__estado--acima/);
    await expect(cardPorNome(page, "Ações BR").locator(".aloca-cat__estado")).toHaveClass(/aloca-cat__estado--abaixo/);
    await expect(cardPorNome(page, "FIIs").locator(".aloca-cat__estado")).toHaveClass(/aloca-cat__estado--na_faixa/);
  });

  test("faixa: etiqueta do trilho mostra o atual e fica na posição certa", async ({ page }) => {
    await abrirAlocacao(page, FAIXA);
    const eua = cardPorNome(page, "EUA").locator('[data-testid="aloca-trilho"]');
    await expect(eua).toBeVisible();
    const etqEua = eua.locator(".aloca-trilho__etq");
    await expect(etqEua).toHaveText("58,0%");
    const na = await eua.locator(".aloca-trilho__na").boundingBox();
    const etq = await etqEua.boundingBox();
    expect(na && etq).toBeTruthy();
    // EUA 58% contra uma faixa de 45% a 55%: a etiqueta inteira fica à direita da faixa.
    expect(etq!.x).toBeGreaterThan(na!.x + na!.width);

    // Renda Fixa BR 5% contra janela 5%–15%: o valor cai na borda e a etiqueta
    // é presa em 5% pela função; o CSS ainda a mantém inteira dentro da cápsula
    // (Review Focus 5), então ela encosta na borda esquerda, sem vazar.
    const rf = cardPorNome(page, "Renda Fixa BR").locator('[data-testid="aloca-trilho"]');
    const trilho = await rf.boundingBox();
    const etqRf = await rf.locator(".aloca-trilho__etq").boundingBox();
    await expect(rf.locator(".aloca-trilho__etq")).toHaveText("5,0%");
    expect(etqRf!.x).toBeGreaterThanOrEqual(trilho!.x - 0.5);
    expect(etqRf!.x - trilho!.x).toBeLessThan(4);
  });

  test("faixa: o trilho é decorativo para leitor de tela", async ({ page }) => {
    await abrirAlocacao(page, FAIXA);
    const trilhos = page.locator(`${TELA} [data-testid="aloca-trilho"]`);
    const n = await trilhos.count();
    expect(n).toBe(5);
    for (let i = 0; i < n; i++) {
      await expect(trilhos.nth(i)).toHaveAttribute("aria-hidden", "true");
    }
  });

  test("principal: categoria com peso_atual NaN tem rodapé '—', sem trilho e fica fora da frase", async ({ page }) => {
    await abrirAlocacao(page);
    await page.evaluate(() => {
      const $data = (window as any).Alpine.$data(document.body);
      $data.json.politica.categorias.push({
        nome: "Classe Y", peso_alvo: 0.2, peso_atual: NaN, drift: NaN, valor_brl: 0, buckets: [],
      });
    });
    const card = cardPorNome(page, "Classe Y");
    await expect(card).toBeVisible();
    await expect(card.locator('[data-testid="aloca-cat-estado"]')).toHaveText("—");
    await expect(card.locator('[data-testid="aloca-cat-faixa"]')).toBeHidden();
    await expect(card.locator('[data-testid="aloca-trilho"]')).toBeHidden();
    const frase = page.locator(`${TELA} [data-testid="aloca-frase"]`);
    await expect(frase).toHaveText("Todas as categorias estão na faixa.");
    expect(await frase.innerText()).not.toContain("Classe Y");
    await expect(page.locator(`${TELA}`)).not.toContainText("NaN");
  });
});

test.describe("7a.BK.1 — acordeão agrupado por estado (spec §3.4)", () => {
  async function abrirCategoria(page: Page, nome: string) {
    const card = cardPorNome(page, nome);
    await card.locator(".aloca-cat__head").click();
    await expect(card.locator(".aloca-cat__body")).toBeVisible();
    return card;
  }

  test("faixa: Ações BR mostra cestas, grupos na ordem, contagens e R$", async ({ page }) => {
    await abrirAlocacao(page, FAIXA);
    const card = await abrirCategoria(page, "Ações BR");
    await expect(card.locator(".aloca-cestas")).toHaveText(
      "Passivo pedindo aporte (30,0% de 45%) · Picks acima da faixa (70,0% de 55%)",
    );
    const grupos = card.locator(".aloca-grupo");
    expect(await grupos.evaluateAll((els) => els.map((e) => e.getAttribute("data-grupo")))).toEqual(
      ["pedindo", "acima", "na_faixa", "sem_alvo"],
    );
    const head = (g: string) => card.locator(`.aloca-grupo[data-grupo="${g}"] .aloca-grupo__head`);
    const titulo = (g: string) => head(g).locator(".aloca-grupo__titulo");
    const meta = (g: string) => head(g).locator(".aloca-grupo__meta");
    await expect(titulo("pedindo")).toHaveText("Pedindo aporte");
    await expect(meta("pedindo")).toHaveText("2");
    await expect(titulo("acima")).toHaveText("Acima da faixa");
    await expect(meta("acima")).toHaveText("ficam sem aporte");
    await expect(titulo("na_faixa")).toHaveText("Na faixa");
    await expect(meta("na_faixa")).toHaveText("1");
    await expect(titulo("sem_alvo")).toHaveText("Sem alvo");
    await expect(meta("sem_alvo")).toHaveText("não recebem aporte");

    // R$ à mão (cesta de picks com KNIP11 em quarentena): BBAS3 =
    // (1/3 − 1/11) × 11 000 = 2 666,67 → "R$ 2,7 mil"; com a cesta bruta
    // (14 000) daria 3 393,9 → "R$ 3,4 mil". BOVA11 herda a cesta passiva:
    // (0,45 − 0,30) × 20 000 = 3 000 → "R$ 3,0 mil" (com 22 000, "R$ 3,3 mil").
    const pedindo = card.locator('.aloca-grupo[data-grupo="pedindo"] .aloca-ativo');
    await expect(pedindo).toHaveCount(2);
    for (const [i, [tk, cesta, rs]] of [
      ["BOVA11", "Passivo", "faltam R$ 3,0 mil"],
      ["BBAS3", "Picks", "faltam R$ 2,7 mil"],
    ].entries()) {
      await expect(pedindo.nth(i).locator(".aloca-ativo__ticker")).toHaveText(tk);
      await expect(pedindo.nth(i).locator(".aloca-ativo__cesta")).toHaveText(cesta);
      await expect(pedindo.nth(i).locator(".aloca-ativo__rs")).toHaveText(rs);
    }
    const acima = card.locator('.aloca-grupo[data-grupo="acima"] .aloca-ativo');
    await expect(acima).toHaveCount(1);
    await expect(acima.locator(".aloca-ativo__ticker")).toHaveText("ITSA4");
    await expect(acima.locator(".aloca-ativo__rs")).toHaveText("sobram R$ 2,3 mil");

    // Na faixa: só o ticker, nenhum número além dele (decisão (d)).
    const etqNa = card.locator('.aloca-grupo[data-grupo="na_faixa"] .aloca-etq');
    await expect(etqNa).toHaveCount(1);
    await expect(etqNa).toHaveText("WEGE3");
    expect((await etqNa.innerText()).replace("WEGE3", "")).not.toMatch(/\d/);

    const sem = card.locator('.aloca-grupo[data-grupo="sem_alvo"] .aloca-etq');
    await expect(sem).toHaveCount(2);
    await expect(sem.nth(0)).toHaveClass(/aloca-etq--apagada/);
    await expect(sem.nth(0)).toContainText("KNIP11");
    await expect(sem.nth(0)).toContainText("quarentena");
    await expect(sem.nth(1)).toContainText("LREN3");
    await expect(sem.nth(1)).toContainText("a zerar");
  });

  test("faixa: todo ativo do acordeão é link para #ativo/<ticker>", async ({ page }) => {
    await abrirAlocacao(page, FAIXA);
    const card = await abrirCategoria(page, "Ações BR");
    const links = card.locator(".aloca-ativo, .aloca-etq");
    await expect(links).toHaveCount(6);
    const pares = await links.evaluateAll((els) =>
      els.map((e) => [e.tagName, e.getAttribute("href"), e.querySelector("[class$='__ticker']")?.textContent?.trim()]),
    );
    for (const [tag, href, tk] of pares) {
      expect(tag).toBe("A");
      expect(href).toBe(`#ativo/${tk}`);
    }
    expect(pares.map((p) => p[2]).sort()).toEqual(["BBAS3", "BOVA11", "ITSA4", "KNIP11", "LREN3", "WEGE3"]);
  });

  test("faixa: EUA (cesta única) não mostra linha de cestas nem nome de cesta", async ({ page }) => {
    await abrirAlocacao(page, FAIXA);
    const card = await abrirCategoria(page, "EUA");
    await expect(card.locator(".aloca-cestas")).toHaveCount(0);
    await expect(card.locator(".aloca-ativo__cesta")).toHaveCount(0);
    await expect(card.locator(".aloca-cat__body")).not.toContainText(/Passivo|Picks/);
    await expect(card.locator('.aloca-etq')).toHaveText(["VOO"]);
  });
});

test.describe("7a.BK.1 — R$ arredondado a zero não vira 'faltam R$ 0'", () => {
  test("linha de pedindo com valor EW 0 fica só com ticker e cesta", async ({ page }) => {
    await abrirAlocacao(page, FAIXA);
    // Cesta de picks em que só o quarentenado está em carteira: os dois
    // elegíveis têm valor 0, então o valor EW é 0 e o R$ de cada um também.
    await injetarCategorias(page, [
      { nome: "Classe Z", peso_alvo: 0.5, peso_atual: 0.3, drift: -0.2, valor_brl: 2000, buckets: [
        { tipo: "passive", peso_bucket: 0.5, peso_atual_bucket: 0.5, ativos: [
          { ticker: "PASS11", peso_intra: 1, peso_intra_atual: 1, valor_brl: 1000 },
        ] },
        { tipo: "picks", peso_bucket: 0.5, peso_atual_bucket: 0.5, ativos: [
          { ticker: "KNIP11", quarentena: true, peso_intra: 0, peso_intra_atual: 1, valor_brl: 1000 },
          { ticker: "AAAA3", peso_intra: 0.5, peso_intra_atual: 0, valor_brl: 0 },
          { ticker: "BBBB3", peso_intra: 0.5, peso_intra_atual: 0, valor_brl: 0 },
        ] },
      ] },
    ]);
    const card = cardPorNome(page, "Classe Z");
    await card.locator(".aloca-cat__head").click();
    const linhas = card.locator('.aloca-grupo[data-grupo="pedindo"] .aloca-ativo');
    await expect(linhas).toHaveCount(2);
    for (let i = 0; i < 2; i++) {
      await expect(linhas.nth(i).locator(".aloca-ativo__cesta")).toHaveText("Picks");
      await expect(linhas.nth(i).locator(".aloca-ativo__rs")).toHaveCount(0);
      expect(await linhas.nth(i).innerText()).not.toMatch(/R\$|faltam/);
    }
  });
});

// ── Task 4: acabamento (tokens da faixa, 320 px, temas, reduced-motion) ────
type Caixa = { x: number; y: number; width: number; height: number };
function dentro(inner: Caixa, outer: Caixa, rotulo: string) {
  const f = 0.5; // folga de subpixel
  expect(inner.x, `${rotulo}: esquerda`).toBeGreaterThanOrEqual(outer.x - f);
  expect(inner.y, `${rotulo}: topo`).toBeGreaterThanOrEqual(outer.y - f);
  expect(inner.x + inner.width, `${rotulo}: direita`).toBeLessThanOrEqual(outer.x + outer.width + f);
  expect(inner.y + inner.height, `${rotulo}: base`).toBeLessThanOrEqual(outer.y + outer.height + f);
}

for (const largura of [320, 390]) {
  for (const tema of ["light", "dark"] as const) {
    test.describe(`7a.BK.1 — geometria a ${largura} px, tema ${tema}`, () => {
      test.use({ viewport: { width: largura, height: 844 } });
      test("sem rolagem horizontal; etiqueta dentro do trilho; rodapé e acordeão dentro do cartão", async ({ page }) => {
        await abrirAlocacao(page, FAIXA, tema);
        expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe(tema);
        const card = cardPorNome(page, "Ações BR");
        await card.locator(".aloca-cat__head").click();
        await expect(card.locator(".aloca-cat__body")).toBeVisible();

        const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
        expect(sw).toBeLessThanOrEqual(cw);

        const trilhos = page.locator(`${TELA} [data-testid="aloca-trilho"]:visible`);
        const n = await trilhos.count();
        expect(n).toBe(4); // Classe X (sem alvo) não tem trilho
        for (let i = 0; i < n; i++) {
          const t = (await trilhos.nth(i).boundingBox())!;
          const e = (await trilhos.nth(i).locator(".aloca-trilho__etq").boundingBox())!;
          dentro(e, t, `etiqueta ${i}`);
        }

        const cats = page.locator(`${TELA} .aloca-cat`);
        const nc = await cats.count();
        for (let i = 0; i < nc; i++) {
          const c = (await cats.nth(i).boundingBox())!;
          for (const sel of [".aloca-cat__faixa", ".aloca-cat__estado"]) {
            const el = cats.nth(i).locator(sel);
            if (!(await el.isVisible())) continue;
            dentro((await el.boundingBox())!, c, `${sel} ${i}`);
          }
        }

        if (largura === 320) {
          // Nome longo + faixa de dois dígitos: o rodapé quebra em duas linhas
          // inteiras (estado em cima, faixa embaixo), em vez de espremer as duas.
          const rf = cardPorNome(page, "Renda Fixa BR");
          const est = (await rf.locator(".aloca-cat__estado").boundingBox())!;
          const fx = (await rf.locator(".aloca-cat__faixa").boundingBox())!;
          expect(fx.y).toBeGreaterThanOrEqual(est.y + est.height - 1);
          expect(await rf.locator(".aloca-cat__faixa").evaluate((e) => e.getClientRects().length)).toBe(1);
        }

        const c = (await card.boundingBox())!;
        const filhos = card.locator(".aloca-ativo, .aloca-etq, .aloca-cestas");
        const nf = await filhos.count();
        expect(nf).toBe(7);
        for (let i = 0; i < nf; i++) dentro((await filhos.nth(i).boundingBox())!, c, `acordeão ${i}`);
        // O CONTEÚDO da linha também cabe nela (a caixa da linha cabe no cartão
        // mesmo quando o "faltam R$" transborda por dentro dela).
        const linhas = card.locator(".aloca-ativo");
        for (let i = 0; i < (await linhas.count()); i++) {
          const caixa = (await linhas.nth(i).boundingBox())!;
          for (const sel of [".aloca-ativo__ticker", ".aloca-ativo__cesta", ".aloca-ativo__rs"]) {
            const el = linhas.nth(i).locator(sel);
            if ((await el.count()) === 0) continue;
            dentro((await el.boundingBox())!, caixa, `linha ${i} ${sel}`);
          }
          const [scw, clw] = await linhas.nth(i).evaluate((e) => [e.scrollWidth, e.clientWidth]);
          expect(scw, `linha ${i}: scrollWidth`).toBeLessThanOrEqual(clw);
        }
        // Etiquetas tocáveis (altura ≥ 32 px).
        const etqs = card.locator(".aloca-etq");
        for (let i = 0; i < (await etqs.count()); i++) {
          expect((await etqs.nth(i).boundingBox())!.height).toBeGreaterThanOrEqual(32);
        }
      });
    });
  }
}

test.describe("7a.BK.1 — token da faixa nos dois temas", () => {
  async function corNaFaixa(page: Page) {
    return page.evaluate(() => {
      const el = document.querySelector(".tela-alocacao .aloca-cat__estado--na_faixa") as HTMLElement;
      const probe = document.createElement("span");
      probe.style.color = "var(--faixa-ok)";
      document.body.appendChild(probe);
      const token = getComputedStyle(probe).color;
      probe.remove();
      const decl = getComputedStyle(document.documentElement).getPropertyValue("--faixa-ok").trim();
      return { estado: getComputedStyle(el).color, token, decl };
    });
  }

  test("'Na faixa' usa --faixa-ok, e o par escuro é outro", async ({ page, context }) => {
    await abrirAlocacao(page, FAIXA, "light");
    const claro = await corNaFaixa(page);
    // O token tem de existir: sem ele, var() cai na cor herdada e o par
    // estado == token passaria vácuo.
    expect(claro.decl).not.toBe("");
    expect(claro.estado).toBe(claro.token);

    const p2 = await context.newPage();
    await abrirAlocacao(p2, FAIXA, "dark");
    const escuro = await corNaFaixa(p2);
    expect(escuro.estado).toBe(escuro.token);
    expect(escuro.estado).not.toBe(claro.estado);
  });
});

test.describe("7a.BK.1 — reduced-motion na etiqueta do trilho", () => {
  const dur = (page: Page) =>
    page.locator(`${TELA} .aloca-trilho__etq`).first().evaluate((e) => getComputedStyle(e).transitionDuration);

  test("sem preferência: a etiqueta anima (controle positivo)", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await abrirAlocacao(page, FAIXA);
    expect(await dur(page)).not.toBe("0s");
  });

  test("reduce: transition-duration da etiqueta computa 0s", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await abrirAlocacao(page, FAIXA);
    expect(await dur(page)).toBe("0s");
  });
});
