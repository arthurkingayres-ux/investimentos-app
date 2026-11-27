import { test, expect, Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { abrir, resposta, placar, contraste, VERBO_DE_ORDEM } from "./comite-comum";

// A régua de retorno (7a.BY.4) só aparece com o bloco `retorno_esperado` no
// payload — a fixture base não o traz. Fixture SINTÉTICA, a mesma de
// `retorno-esperado.spec.ts`.
const retornoSintetico = () =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "../fixtures/retorno.sintetico.json"), "utf-8"));

// 7a.CH.2: a aba Comitê deixa de ser a lista de registros e passa a ser o que
// ele é e como presta contas — o cabeçalho de três parágrafos (spec §5.4,
// verbatim do mockup aprovado), o cartão de três números derivados de
// `json.comite_placar`, a régua de retorno e os relatórios anuais.
// Substitui `comite-registros.spec.ts`. Fixtures SINTÉTICAS (repo público).

test.use({ viewport: { width: 390, height: 844 } });

const tela = (page: Page) => page.locator(".tela-comite");

// A tela entra com transição (push-enter): medida durante ela não vê o
// transbordo. Espera a tela assentar antes de medir largura.
const assentada = (page: Page) =>
  page.waitForFunction(() => {
    const t = document.querySelector(".tela-comite");
    return !!t && t.getAnimations({ subtree: true }).length === 0 && !t.className.includes("push-");
  });

const comPlacar = (page: Page, mudar?: (c: any) => void, relogio?: string) =>
  abrir(page, {
    resposta: resposta(),
    hash: "#comite",
    relogio,
    portfolio: (p) => {
      p.comite_placar = placar(mudar);
    },
  });

test.describe("Comitê: a aba que explica e presta contas", () => {
  test("o cabeçalho explica o que é, quando roda e como presta contas", async ({ page }) => {
    const erros: string[] = [];
    await abrir(page, {
      resposta: resposta(),
      hash: "#comite",
      erros,
      portfolio: (p) => (p.comite_placar = placar()),
    });
    const t = tela(page);
    await expect(t).toBeVisible();
    await expect(t.locator(".comite-explica")).toBeVisible({ timeout: 10_000 });
    await expect(t).toContainText("propõe, nunca decide");
    await expect(t).toContainText("todo dia 12");
    await expect(t).toContainText("36 meses");
    expect(await t.innerText()).not.toMatch(VERBO_DE_ORDEM);
    expect(erros).toEqual([]);
  });

  // Relógio pinado pelo mesmo motivo do teste dos relatórios anuais: a linha
  // da prestação é derivada do calendário desde a 7a.CJ, e um `nov/2027` lido
  // do relógio real ficaria vermelho por construção em dez/2027.
  test("as três linhas do cartão vêm de comite_placar", async ({ page }) => {
    await abrir(page, {
      resposta: resposta(),
      hash: "#comite",
      relogio: "2026-11-27T12:00:00-03:00",
      portfolio: (p) => {
        p.comite_placar = placar();
        p.retorno_esperado = retornoSintetico();
      },
    });
    const c = tela(page).locator(".comite-cartao");
    await expect(c).toBeVisible({ timeout: 10_000 });
    await expect(c.locator('[data-linha="propostas"] .comite-cartao__val')).toHaveText("2");
    await expect(c.locator('[data-linha="placar"]')).toContainText("Sem veredito");
    await expect(c.locator('[data-linha="placar"]')).toContainText("36 meses a partir de nov/2026");
    await expect(c.locator('[data-linha="prestacao"]')).toContainText("nov/2027");
    await expect(page.locator('[data-testid="comite-regua"]')).toBeVisible();
    await expect(tela(page).locator(".comite-ultima")).toContainText("Última rodada em");
  });

  // O valor do Placar é uma frase, não um número: em `space-between` ele
  // quebra para a segunda linha e fica alinhado à DIREITA, esfarrapado — o que
  // a verificação visual pegou e nenhum teste de transbordo pega (falha a
  // folga, não a largura). Reverter o empilhamento tem de ficar vermelho aqui.
  test("o valor do Placar empilha sob o rótulo, alinhado à esquerda", async ({ page }) => {
    // 320 px é a largura de conferência da casa: força a quebra da frase
    // qualquer que seja a métrica da fonte. A 390 px com uma fonte estreita a
    // frase caberia numa linha e o `nLinhas > 1` ficaria vermelho sem
    // regressão nenhuma — foi o que a fonte do CI já fez uma vez.
    await page.setViewportSize({ width: 320, height: 640 });
    await comPlacar(page);
    const linha = tela(page).locator('[data-linha="placar"]');
    await linha.waitFor({ timeout: 10_000 });
    const m = await linha.evaluate((el) => {
      const rotEl = el.querySelector(".comite-cartao__rot")!;
      const valEl = el.querySelector(".comite-cartao__val")!;
      const rot = rotEl.getBoundingClientRect();
      const val = valEl.getBoundingClientRect();
      // A caixa do valor é larga com `text-align` esquerdo OU direito — medir a
      // caixa não distingue os dois. O que se vê é o TEXTO: um Range sobre o nó
      // dá um retângulo por linha renderizada.
      const r = document.createRange();
      r.selectNodeContents(valEl);
      const linhas = Array.from(r.getClientRects()).filter((x) => x.width > 0);
      return {
        rotX: rot.left,
        rotW: rot.width,
        valY: val.top,
        rotBottom: rot.bottom,
        nLinhas: linhas.length,
        texto1X: linhas.length ? linhas[0].left : NaN,
        // A ÚLTIMA linha é a sensível: num parágrafo alinhado à direita a
        // primeira quase enche a caixa e começaria perto de `rotX` mesmo assim.
        textoNX: linhas.length ? linhas[linhas.length - 1].left : NaN,
        linhaW: el.getBoundingClientRect().width,
      };
    });
    // O rótulo ocupa a linha inteira: a linha do Placar é empilhada, não uma
    // coluna dupla que depende da quebra do flex para não ficar torta.
    expect(m.rotW).toBeGreaterThan(m.linhaW * 0.9);
    // O valor vem abaixo dele…
    expect(m.valY).toBeGreaterThanOrEqual(m.rotBottom - 1);
    // …e o TEXTO renderizado começa na mesma margem esquerda do rótulo, em mais
    // de uma linha (é a frase longa, que é o caso que quebrava).
    expect(m.nLinhas).toBeGreaterThan(1);
    expect(Math.abs(m.texto1X - m.rotX)).toBeLessThan(1);
    expect(Math.abs(m.textoNX - m.rotX)).toBeLessThan(1);
  });

  // 7a.CJ: "a cada 12 meses" é recorrência, não data única. A prestação é o
  // primeiro aniversário de `desde` que ainda NÃO passou — e o mês do
  // aniversário ainda conta como próximo (spec 7a.CJ §3). A conta é feita à
  // mão em cada caso: trava a recorrência, não só o formato.
  //
  // O relógio é pinado em TODOS os casos. Os dois primeiros são a prova
  // canônica do anti-objetivo (a tela de 27/11/2026 não muda com esta fase) e,
  // sem pinar, quebrariam sozinhos a partir de dez/2027 — vermelho por
  // construção. Meio-dia + `timezoneId` para que o caso do último dia do mês
  // não vire de mês conforme o fuso do runner (o CI tende a UTC).
  test.describe("a próxima prestação é o próximo aniversário", () => {
    test.use({ timezoneId: "America/Sao_Paulo" });

    for (const [rotulo, relogio, desde, mes, longo] of [
      // k = 1: `desde` no mês corrente e `desde` no futuro.
      ["hoje, desde 2026-11", "2026-11-27T12:00:00-03:00", "2026-11", "nov/2027", "novembro de 2027"],
      ["hoje, desde no futuro", "2026-11-27T12:00:00-03:00", "2027-03", "mar/2028", "março de 2028"],
      // O 1º aniversário passou: anda para o seguinte.
      ["depois do 1º aniversário", "2027-12-15T12:00:00-03:00", "2026-11", "nov/2028", "novembro de 2028"],
      // Fronteira do `>=`: no último dia do mês do aniversário ele ainda é o
      // próximo. Com `>` em vez de `>=` isto daria nov/2028.
      ["no último dia do mês do aniversário", "2027-11-30T12:00:00-03:00", "2026-11", "nov/2027", "novembro de 2027"],
      // k > 2: trava o laço, não só o primeiro salto.
      ["k > 2", "2031-03-01T12:00:00-03:00", "2026-11", "nov/2031", "novembro de 2031"],
      // O mês importa, não só o ano: jan/2027 ainda está adiante de dez/2026.
      ["mês de desde já passou no ano corrente", "2026-12-10T12:00:00-03:00", "2026-01", "jan/2027", "janeiro de 2027"],
      ["virada de ano", "2028-01-01T12:00:00-03:00", "2026-11", "nov/2028", "novembro de 2028"],
    ] as const) {
      test(`${rotulo}: prestação em ${mes}`, async ({ page }) => {
        await comPlacar(page, (c) => (c.desde = desde), relogio);
        await expect(page.locator('[data-linha="prestacao"]')).toContainText(mes, { timeout: 10_000 });
        await expect(tela(page).locator(".comite-relatorios")).toContainText(longo);
      });
    }
  });

  // `estado` vira "comparavel" no backend aos 36 meses (src/comite/placar.py).
  // Esta fase mostra "Sem veredito" de qualquer jeito, por decisão da spec §5.4
  // — o veredito é a fase 5. O teste declara isso como valor fixo: quem
  // ramificar por `estado` sem rever a copy fica vermelho aqui, de propósito.
  test("estado comparavel ainda diz 'Sem veredito' (o veredito é a fase 5)", async ({ page }) => {
    await comPlacar(page, (c) => {
      c.estado = "comparavel";
      c.n_propostas = 48;
      c.meses = 40;
    });
    const v = tela(page).locator('[data-linha="placar"] .comite-cartao__val');
    await expect(v).toHaveText("Sem veredito · série curta (36 meses a partir de nov/2026)", { timeout: 10_000 });
    await expect(tela(page).locator('[data-linha="propostas"] .comite-cartao__val')).toHaveText("48");
  });

  // Os ramos de rejeição de `lerDesde`: sem eles a tela inventaria mês (mês 00
  // viraria "dez do ano anterior" por índice negativo, 13 viraria `undefined`).
  // Reverter a checagem de faixa tem de ficar vermelho aqui.
  // Cada caso trava uma guarda DIFERENTE de `lerDesde`, e nenhum é decorativo:
  //   mês 00 / mês 13 → a faixa 1..12
  //   string vazia    → a regex
  //   com dia         → a âncora `$`
  //   prefixo         → a âncora `^` (sem ela, "x2026-11" casaria no offset 1)
  //   array           → a guarda `typeof === "string"`. Um NÚMERO aqui seria
  //                     vácuo: `exec(202611)` já o converte em "202611", que a
  //                     regex rejeita sozinha. `["2026-11"]` converte para
  //                     "2026-11", que CASA — sem o `typeof`, este fica verde.
  for (const [rotulo, desde] of [
    ["mês 00", "2026-00"],
    ["mês 13", "2026-13"],
    ["string vazia", ""],
    ["com dia", "2026-11-01"],
    ["prefixo", "x2026-11"],
    ["array que vira string válida", ["2026-11"] as unknown as string],
  ] as const) {
    test(`desde inválido (${rotulo}): '—' na prestação e nenhum mês no Placar`, async ({ page }) => {
      const erros: string[] = [];
      await abrir(page, {
        resposta: resposta(),
        hash: "#comite",
        erros,
        portfolio: (p) => (p.comite_placar = placar((c) => (c.desde = desde))),
      });
      await expect(tela(page).locator('[data-linha="prestacao"] .comite-cartao__val')).toHaveText("—", {
        timeout: 10_000,
      });
      await expect(tela(page).locator('[data-linha="placar"] .comite-cartao__val')).toHaveText(
        "Sem veredito · série curta (36 meses)",
      );
      const texto = await tela(page).innerText();
      expect(texto).not.toMatch(/jan\/|fev\/|mar\/|abr\/|mai\/|jun\/|jul\/|ago\/|set\/|out\/|nov\/|dez\//);
      expect(texto).not.toContain("undefined");
      expect(erros).toEqual([]);
    });
  }

  test("payload sem comite_placar: '—' nas três linhas, sem número inventado", async ({ page }) => {
    const erros: string[] = [];
    await abrir(page, { resposta: resposta(), hash: "#comite", erros, portfolio: (p) => delete p.comite_placar });
    await expect(tela(page).locator(".comite-cartao")).toBeVisible({ timeout: 10_000 });
    for (const l of ["propostas", "placar", "prestacao"]) {
      await expect(page.locator(`[data-linha="${l}"] .comite-cartao__val`)).toHaveText("—");
    }
    expect(erros).toEqual([]);
  });

  test("comite_placar sem desde: sem mês inventado", async ({ page }) => {
    const erros: string[] = [];
    await abrir(page, {
      resposta: resposta(),
      hash: "#comite",
      erros,
      portfolio: (p) => (p.comite_placar = placar((c) => (c.desde = null))),
    });
    await expect(page.locator('[data-linha="propostas"]')).toContainText("2", { timeout: 10_000 });
    await expect(page.locator('[data-linha="prestacao"] .comite-cartao__val')).toHaveText("—");
    const texto = await tela(page).innerText();
    expect(texto).not.toMatch(/jan\/|fev\/|mar\/|abr\/|mai\/|jun\/|jul\/|ago\/|set\/|out\/|nov\/|dez\//);
    expect(erros).toEqual([]);
  });

  // Relógio pinado em 27/11/2026: com a regra da 7a.CJ, a data derivada anda
  // com o calendário, e um "novembro de 2027" lido do relógio real ficaria
  // vermelho por construção em dez/2027. Faxina antes da data, não depois.
  test("relatórios anuais: nenhum ainda, com a data derivada", async ({ page }) => {
    await comPlacar(page, undefined, "2026-11-27T12:00:00-03:00");
    await expect(tela(page).locator(".comite-relatorios")).toContainText(
      "Nenhum ainda. O primeiro chega em novembro de 2027.",
      { timeout: 10_000 },
    );
  });

  test("sem resposta do Worker: o cabeçalho e o cartão continuam, sem erro de console", async ({ page }) => {
    const erros: string[] = [];
    await abrir(page, {
      resposta: null,
      hash: "#comite",
      erros,
      portfolio: (p) => (p.comite_placar = placar()),
    });
    await expect(tela(page).locator(".comite-explica")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-linha="propostas"]')).toContainText("2");
    await expect(tela(page).locator(".comite-ultima")).toHaveCount(0);
    expect(erros).toEqual([]);
  });

  // 7a.CC: o Comitê é tela-membro de Aportar, sem "←"; o caminho de volta é a
  // faixa do grupo.
  test("a faixa (Simulação) leva ao #aportar; sem voltar na tela", async ({ page }) => {
    await comPlacar(page);
    await expect(tela(page)).toBeVisible();
    await expect(tela(page).locator('button[aria-label="Voltar"]')).toHaveCount(0);
    await page.locator(".grupo-cab nav a", { hasText: /^Simulação$/ }).click();
    await expect(page.locator(".tela-aportar")).toBeVisible();
    expect(await page.evaluate(() => location.hash)).toBe("#aportar");
  });

  for (const tema of ["dark", null] as const) {
    test(`${tema ?? "claro"}: todo texto da tela legível (AA 4,5:1)`, async ({ page }) => {
      await abrir(page, {
        resposta: resposta(),
        hash: "#comite",
        tema,
        portfolio: (p) => (p.comite_placar = placar()),
      });
      await expect(tela(page).locator(".comite-cartao")).toBeVisible({ timeout: 10_000 });
      const pares = await page.evaluate(() => {
        const fundo = (el: Element | null): string => {
          while (el) {
            const b = getComputedStyle(el).backgroundColor;
            if (b && b !== "transparent" && !/rgba\(.*,\s*0\)$/.test(b)) return b;
            el = el.parentElement;
          }
          return getComputedStyle(document.body).backgroundColor;
        };
        const out: { t: string; c: string; b: string }[] = [];
        const w = document.createTreeWalker(document.querySelector(".tela-comite")!, NodeFilter.SHOW_TEXT);
        while (w.nextNode()) {
          const n = w.currentNode as Text;
          const el = n.parentElement!;
          if (!n.textContent!.trim() || el.getClientRects().length === 0) continue;
          out.push({ t: n.textContent!.trim().slice(0, 30), c: getComputedStyle(el).color, b: fundo(el) });
        }
        return { tema: document.documentElement.getAttribute("data-theme"), out };
      });
      expect(pares.tema).toBe(tema ?? "light");
      expect(pares.out.length).toBeGreaterThan(8);
      for (const p of pares.out) expect(contraste(p.c, p.b), `${p.t}: ${p.c} sobre ${p.b}`).toBeGreaterThanOrEqual(4.5);
    });
  }

  // Task 10: os registros saem da TELA, não do dado. A fase 5 (prestação
  // anual) os lê de novo do livro, e o payload decifrado continua trazendo-os.
  test("os registros não aparecem mais na tela, e o payload continua trazendo-os", async ({ page }) => {
    await comPlacar(page);
    await expect(tela(page).locator(".comite-cartao")).toBeVisible({ timeout: 10_000 });
    // A ordem importa: esperar os 3 registros no estado ANTES de medir a tela.
    // Medir a tela primeiro deixaria o teste passar de graça enquanto
    // `comiteResposta` ainda é null — não há registro para renderizar, e a
    // contagem zero não prova nada. Com os 3 no estado, o zero é a prova.
    await page.waitForFunction(
      () => (window as any).Alpine.$data(document.body).comiteResposta?.registros?.length === 3,
      undefined,
      { timeout: 10_000 },
    );
    await expect(
      page.locator("ol.comite-registros, .comite-registro, .comite-vazio, .comite-tela-ajuda"),
    ).toHaveCount(0);
  });

  test("320 px: sem rolagem horizontal", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await comPlacar(page);
    await expect(tela(page).locator(".comite-cartao")).toBeVisible({ timeout: 10_000 });
    await assentada(page);
    const r = await page.evaluate(() => {
      const vp = document.documentElement.clientWidth;
      return {
        doc: document.documentElement.scrollWidth,
        vp,
        fora: Array.from(document.querySelectorAll(".tela-comite *")).filter(
          (el) => el.getBoundingClientRect().right > vp + 0.5,
        ).length,
      };
    });
    expect(r.doc).toBeLessThanOrEqual(r.vp);
    expect(r.fora).toBe(0);
  });
});
