import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

const FIXTURE = fs.readFileSync(
  path.join(__dirname, "../fixtures/portfolio.test.json.enc"),
  "utf-8",
);

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
}

// 7a.AE.3 — o slot de frescor do hero passa a dizer de quando é o FECHAMENTO
// exibido, e não mais o carimbo de PUBLICAÇÃO. A distinção é a fase inteira:
// numa noite ruim o app dizia "19 ago · 00:27" enquanto mostrava o fechamento
// de 17/08. Não era ausência de informação — era um sinal de frescor ERRADO
// ocupando o lugar.
test.describe("Raio-X — data do fechamento no hero (7a.AE.3)", () => {
  test("datas mistas: o hero mostra o INTERVALO", async ({ page }) => {
    await autenticar(page);
    // A fixture carrega Total {min: 2026-08-17, max: 2026-08-18}.
    await expect(page.locator(".hero-updated")).toHaveText(/17\/08.*18\/08/);
  });

  test("o hero NAO mostra mais o carimbo de publicacao", async ({ page }) => {
    // O regression guard da fase: `atualizado_em` tem hora (`· HH:MM`), e a
    // data do fechamento não. Se o slot voltar a mostrar o carimbo, a hora
    // reaparece.
    await autenticar(page);
    await expect(page.locator(".hero-updated")).not.toHaveText(/\d{2}:\d{2}/);
  });

  test("datas iguais: uma afirmacao, nao um intervalo", async ({ page }) => {
    await autenticar(page);
    await page.evaluate(() => {
      const $data = (window as any).Alpine?.$data?.(document.body);
      if (!$data) throw new Error("Alpine.$data(document.body) é undefined");
      $data.json.frescor_cotacoes.Total = {
        min: "2026-08-18",
        max: "2026-08-18",
        por_data: { "2026-08-18": 38 },
        sem_cotacao: 0,
      };
    });
    const slot = page.locator(".hero-updated");
    await expect(slot).toHaveText(/18\/08/);
    await expect(slot).not.toHaveText(/–|-/);
  });

  test("payload legado sem o bloco: degrada para o CARIMBO, nao para o silencio", async ({
    page,
  }) => {
    // Empty-safe. Entre o merge desta sub-fase e o primeiro run do cron, o
    // sibling ainda serve um payload v2.25 — e um hero mudo seria pior que o
    // carimbo antigo.
    //
    // O assert é sobre o TEXTO ESPERADO e não `/\S/`: "tem algum caractere"
    // passaria com o hero exibindo qualquer coisa, inclusive um "undefined" ou
    // o texto de outro estado. O que precisa ser provado é que o fallback é o
    // carimbo de publicação formatado — e a hora (`· HH:MM`) é justamente o
    // traço que distingue o carimbo da data de fechamento.
    await autenticar(page);
    await page.evaluate(() => {
      const $data = (window as any).Alpine?.$data?.(document.body);
      if (!$data) throw new Error("Alpine.$data(document.body) é undefined");
      delete $data.json.frescor_cotacoes;
    });
    const esperado = await page.evaluate(() => {
      const $data = (window as any).Alpine?.$data?.(document.body);
      return (window as any).formatDataHora($data.json.atualizado_em);
    });
    expect(esperado).toMatch(/\d{2}:\d{2}/); // o fallback tem hora, por definição
    await expect(page.locator(".hero-updated")).toHaveText(esperado);
  });

  test("bloco presente mas com min/max nulos tambem degrada para o carimbo", async ({
    page,
  }) => {
    // Distinto do teste acima, e não redundante: ali a CHAVE some (payload
    // legado); aqui ela existe com escopo vazio, que é o que
    // `frescor_por_escopo` devolve para uma carteira sem posição naquela
    // moeda. Um helper que só checasse `?.Total` cairia num `undefined` em vez
    // do carimbo.
    await autenticar(page);
    await page.evaluate(() => {
      const $data = (window as any).Alpine?.$data?.(document.body);
      if (!$data) throw new Error("Alpine.$data(document.body) é undefined");
      $data.json.frescor_cotacoes.Total = {
        min: null,
        max: null,
        por_data: {},
        sem_cotacao: 0,
      };
    });
    await expect(page.locator(".hero-updated")).toHaveText(/\d{2}:\d{2}/);
  });

  test("data ISO nao escorrega um dia por fuso", async ({ page }) => {
    // `new Date("2026-08-18")` é meia-noite UTC, que em America/Sao_Paulo
    // (UTC-3) volta para o dia 17. O helper tem de parsear por regex — mesmo
    // gotcha já documentado em formatDataExtenso (7a.S.10). Aqui ele seria
    // especialmente cruel: um bug de fuso nesta linha faria o app confessar o
    // pregão ERRADO, que é o defeito que a fase inteira existe para corrigir.
    await autenticar(page);
    const saida = await page.evaluate(() =>
      (window as any).formatDataDiaMes("2026-08-18"),
    );
    expect(saida).toBe("18/08");
  });

  test("entrada invalida nao vira 'undefined' na tela", async ({ page }) => {
    await autenticar(page);
    const saidas = await page.evaluate(() => {
      const f = (window as any).formatDataDiaMes;
      return [f(null), f(undefined), f(""), f("nao e data"), f(12345)];
    });
    for (const s of saidas) expect(s).toBe("");
  });

  test("data com forma valida mas faixa impossivel nao vira texto pendurado", async ({
    page,
  }) => {
    // Dois achados do CRB numa cadeia so. (1) `formatDataDiaMes` validava a
    // FORMA e nao a FAIXA, entao "2026-13-40" renderizava "40/13" — uma data
    // impossivel afirmada com a mesma confianca de uma real, no slot cuja
    // unica funcao e ser confiavel sobre a data. (2) Corrigir so o (1) criaria
    // um estado pior: o helper devolve "" e o slot exibiria "Fechamento de "
    // pendurado. Por isso `frescorTexto` tambem cai no carimbo quando a
    // formatacao falha.
    await autenticar(page);
    const formatados = await page.evaluate(() => {
      const f = (window as any).formatDataDiaMes;
      return [f("2026-13-01"), f("2026-00-10"), f("2026-08-40"), f("2026-08-00")];
    });
    for (const s of formatados) expect(s).toBe("");

    await page.evaluate(() => {
      const $data = (window as any).Alpine?.$data?.(document.body);
      if (!$data) throw new Error("Alpine.$data(document.body) é undefined");
      $data.json.frescor_cotacoes.Total = {
        min: "2026-13-40",
        max: "2026-13-40",
        por_data: { "2026-13-40": 1 },
        sem_cotacao: 0,
      };
    });
    const slot = page.locator(".hero-updated");
    await expect(slot).not.toHaveText(/Fechamento de\s*$/);
    await expect(slot).toHaveText(/\d{2}:\d{2}/); // caiu no carimbo
  });

  test("o slot e o eyebrow NUNCA se encostam (achado da verificacao visual)", async ({
    page,
  }) => {
    // `.hero-meta` e flex row com `space-between`, entao o eyebrow
    // ("PATRIMONIO TOTAL") e este slot dividem a MESMA linha. O texto novo tem
    // ~2x o comprimento do carimbo que ele substituiu, e a medicao a 320px
    // ANTES do conserto deu: label 99,9px + slot 136,1px = 236,0px, exatamente
    // a largura do container — folga ZERO. Nao estourava, mas dois textos
    // distintos encostados leem como um so, e um caractere a mais
    // transbordaria.
    //
    // O conserto foi `gap` + `flex-wrap: wrap` em `.hero-meta`: a 390px as
    // duas regras sao INERTES (o space-between ja da 33px), e a 320px o slot
    // desce para a linha de baixo em vez de colidir. Este teste trava as duas
    // metades — a folga minima quando na mesma linha, e a ausencia de
    // sobreposicao quando quebra.
    await autenticar(page);
    for (const largura of [390, 360, 320]) {
      await page.setViewportSize({ width: largura, height: 844 });
      const m = await page.evaluate(() => {
        const l = document.querySelector(".hero-label")!.getBoundingClientRect();
        const u = document.querySelector(".hero-updated")!.getBoundingClientRect();
        return {
          mesmaLinha: Math.abs(l.top - u.top) < 4,
          folga: u.left - l.right,
          sobrepoeVertical: u.top < l.bottom - 1 && u.left < l.right - 1,
        };
      });
      if (m.mesmaLinha) {
        expect(
          m.folga,
          `a ${largura}px o eyebrow e o slot ficaram a ${m.folga.toFixed(1)}px`,
        ).toBeGreaterThanOrEqual(8);
      } else {
        expect(m.sobrepoeVertical, `sobreposicao a ${largura}px`).toBe(false);
      }
    }
  });

  test("o slot fica legivel nos dois temas e a 320px", async ({ page }) => {
    // O card do hero é escuro nos DOIS temas (`--g-900`), então o contraste do
    // slot não muda entre eles — medido 4,58:1, passa AA. O que muda entre
    // temas é o resto da tela; o que muda a 320px é o espaço, e o texto novo é
    // ~2x mais longo que o carimbo que ele substituiu.
    await autenticar(page);
    for (const largura of [390, 320]) {
      await page.setViewportSize({ width: largura, height: 844 });
      for (const tema of ["light", "dark"]) {
        await page.evaluate((t) => {
          document.documentElement.setAttribute("data-theme", t);
        }, tema);
        const slot = page.locator(".hero-updated");
        await expect(slot).toBeVisible();
        const estourou = await slot.evaluate(
          (el) => el.scrollWidth > el.clientWidth + 1,
        );
        expect(
          estourou,
          `overflow em ${largura}px tema ${tema}`,
        ).toBe(false);
      }
    }
  });
});
