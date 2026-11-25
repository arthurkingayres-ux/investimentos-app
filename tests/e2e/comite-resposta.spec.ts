import { test, expect, Page } from "@playwright/test";
import { abrir, resposta, contraste, VERBO_DE_ORDEM } from "./comite-comum";

// 7a.BW.6 Task 6.6: a resposta do Comitê, lado a lado com a regra (spec 7a.BW
// §6.6, §13.1 e D5). O Worker é falso (page.route): GET /comite/resposta
// devolve a fixture SINTÉTICA cifrada com o segredo de teste.
//
// 7a.CH.1: a resposta saiu da Simulação e passou a viver DENTRO de um item do
// acordeão da aba Proposta, uma por rodada guardada. As asserções são as
// mesmas; o que mudou é onde se lê — `bloco(page)` agora é o corpo do item
// aberto. O que saiu com a mudança (spec 7a.CH §5.2 e D4): o grifo
// compartilhado com o plano da regra, o rótulo "proposta antiga", o rótulo
// "outro valor" e o link de registros. A data e o valor de cada rodada estão
// no cabeçalho do próprio item, e a Proposta não tem valor digitado com que
// comparar.

test.use({ viewport: { width: 390, height: 844 } });

const bloco = (page: Page) => page.locator(".proposta-corpo");

// Abre a aba Proposta e expande a rodada `i` (0 = a mais nova).
async function abrirRodada(page: Page, o: any = {}, i = 0) {
  await abrir(page, { ...o, hash: "#/aportar/proposta" });
  await page.locator(".proposta-item").nth(i).locator("button").click();
  await expect(bloco(page)).toBeVisible({ timeout: 10_000 });
}

test.describe("Comitê: a resposta no item do acordeão da Proposta", () => {
  test("a proposta aparece, Comitê antes de Regra", async ({ page }) => {
    await abrirRodada(page, { resposta: resposta() });
    const cab = await bloco(page).locator(".comite-comparacao thead th.comite-col").allTextContents();
    expect(cab.map((t) => t.trim()).filter(Boolean)).toEqual(["Comitê", "Regra"]);
    // Cada linha tem as duas colunas, nesta ordem, em mono.
    const linha = bloco(page).locator('.comite-linha[data-ticker="ZZAA3"]');
    await expect(linha.locator("td").nth(0)).toHaveText("R$ 2.400");
    await expect(linha.locator("td").nth(1)).toHaveText("R$ 1.100");
    const fonte = await linha.locator("td").nth(0).evaluate((el) => getComputedStyle(el).fontFamily);
    expect(fonte).toMatch(/mono|Consolas|Menlo/i);
    // Ativo só da regra e só do Comitê: forma (traço) e texto, não só cor.
    const soRegra = bloco(page).locator('.comite-linha[data-ticker="ZZDD"]');
    await expect(soRegra.locator("td").nth(0)).toHaveText("—");
    await expect(soRegra.locator(".comite-dif")).toHaveText("só na Regra");
    await expect(bloco(page).locator('.comite-linha[data-ticker="ZZBB11"] .comite-dif')).toHaveText("só no Comitê");
    await expect(linha.locator(".comite-dif")).toHaveText("Comitê põe mais");
    await expect(bloco(page).locator(".comite-linha")).toHaveCount(5);
  });

  test("a razão principal é o grifo do item", async ({ page }) => {
    await abrirRodada(page, { resposta: resposta() });
    const grifos = bloco(page).locator(".grifo:visible");
    await expect(grifos).toHaveCount(1);
    await expect(grifos.first()).toHaveClass(/comite-razao/);
    await expect(grifos.first()).toContainText("Juntar a remessa");
  });

  test("argumento contrário, o que mudaria e confiança visíveis sem toque", async ({ page }) => {
    const erros: string[] = [];
    await abrirRodada(page, { resposta: resposta(), erros });
    await expect(bloco(page).locator(".comite-contrario")).toBeVisible();
    await expect(bloco(page).locator(".comite-contrario")).toContainText("Se o dólar subir");
    await expect(bloco(page).locator(".comite-mudaria")).toContainText("Uma remessa já feita");
    await expect(bloco(page).locator(".comite-confianca")).toContainText("média");
    await expect(bloco(page).locator(".comite-porque li")).toHaveCount(2);
    await expect(bloco(page).locator("details")).toHaveCount(0);
    await expect(bloco(page)).toContainText("o Comitê propõe");
    expect(erros).toEqual([]);
  });

  test("custo dos dois caminhos, com o que é estimativa", async ({ page }) => {
    await abrirRodada(page, {
      resposta: resposta((r) => (r.atual.custos.medido_em = "2026-11-08")),
    });
    const custo = bloco(page).locator(".comite-linha-custo");
    await expect(custo.locator("td").nth(0)).toHaveText("R$ 0");
    await expect(custo.locator("td").nth(1)).toHaveText("R$ 61");
    await expect(bloco(page).locator(".comite-custo-nota")).toContainText(
      "custo estimado; câmbio e IOF por parâmetro medido em 08/11/2026",
    );
    await expect(bloco(page).locator(".comite-economia")).toContainText("R$ 61 a menos");
  });

  test("sem data dos parâmetros, a nota não inventa uma", async ({ page }) => {
    await abrirRodada(page, { resposta: resposta() });
    const nota = bloco(page).locator(".comite-custo-nota");
    await expect(nota).toContainText("custo estimado; câmbio e IOF por parâmetro");
    await expect(nota).not.toContainText("medido em");
  });

  test("recusada: mostra a regra e o motivo em uma linha", async ({ page }) => {
    await abrirRodada(page, {
      resposta: resposta((r) => {
        r.estado = "recusada";
        r.atual.comite = null;
        r.atual.custos.comite = null;
        r.atual.economia_brl = null;
        r.atual.motivo_recusa = "ACIMA_DO_TETO";
      }),
    });
    const recusa = bloco(page).locator(".comite-recusa");
    await expect(recusa).toHaveText(
      "O Comitê não passou na conferência (levava um ativo acima do teto da faixa); esta é a regra.",
    );
    const cab = await bloco(page).locator(".comite-comparacao thead th.comite-col").allTextContents();
    expect(cab.map((t) => t.trim()).filter(Boolean)).toEqual(["Regra"]);
    await expect(bloco(page).locator(".comite-linha")).toHaveCount(4);
    await expect(bloco(page).locator(".comite-razao")).toHaveCount(0);
    // O resumo do cabeçalho do item diz o mesmo, sem abrir.
    await expect(page.locator(".proposta-item").nth(0)).toContainText("Não passou na conferência");
  });

  test("recusada com código desconhecido: linha genérica, sem jargão", async ({ page }) => {
    await abrirRodada(page, {
      resposta: resposta((r) => {
        r.atual.comite = null;
        r.atual.motivo_recusa = "XYZ_NOVO";
      }),
    });
    // O código desconhecido não repete "não passou na conferência" entre
    // parênteses: a linha fica sem o motivo.
    await expect(bloco(page).locator(".comite-recusa")).toHaveText(
      "O Comitê não passou na conferência; esta é a regra.",
    );
    await expect(bloco(page)).not.toContainText("XYZ_NOVO");
  });

  test("dado velho: o aviso de idade dos dados é o grifo do item, e a razão vira texto", async ({ page }) => {
    await abrirRodada(page, {
      resposta: resposta((r) => {
        r.atual.grifo_dado_velho = true;
        r.atual.idade_fontes.dias_sem_ingestao = 40;
      }),
    });
    const grifos = bloco(page).locator(".grifo:visible");
    await expect(grifos).toHaveCount(1);
    await expect(grifos.first()).toHaveClass(/comite-dado-velho/);
    await expect(grifos.first()).toContainText("40 dias");
    // A razão principal continua lá, como texto.
    await expect(bloco(page).locator(".comite-razao")).toBeVisible();
    await expect(bloco(page).locator(".comite-razao")).not.toHaveClass(/(^|\s)grifo(\s|$)/);
  });

  test("nenhum verbo de ordem na voz do Comitê", async ({ page }) => {
    await abrirRodada(page, { resposta: resposta() });
    const txt = await page.locator(".tela-proposta").innerText();
    expect(txt).not.toMatch(VERBO_DE_ORDEM);
  });

  test("sem resposta (cifra null): nenhum item, nenhum corpo, nenhum erro de console", async ({ page }) => {
    const erros: string[] = [];
    await abrir(page, { resposta: null, erros, hash: "#/aportar/proposta" });
    await page.waitForTimeout(800);
    await expect(bloco(page)).toHaveCount(0);
    await expect(page.locator(".proposta-item")).toHaveCount(0);
    await expect(page.locator(".proposta-vazio")).toBeVisible();
    expect(erros).toEqual([]);
  });

  test("resposta guardada antes: abrir a Proposta sem pedido recente busca de novo", async ({ page }) => {
    let buscas = 0;
    page.on("request", (r) => {
      if (r.url().includes("/comite/resposta")) buscas++;
    });
    await abrirRodada(page, { resposta: resposta(), enviadoEm: null, cache: resposta() });
    expect(buscas).toBeGreaterThanOrEqual(1);
    // O que fica no aparelho é só a cifra.
    const guardado = await page.evaluate(() => localStorage.getItem("comite:resposta") || "");
    expect(guardado).not.toContain("ZZAA3");
    expect(guardado).not.toContain("Juntar");
  });

  // 7a.CH.1: na SIMULAÇÃO a regra de "só pergunta com motivo" não muda — a
  // tela não mostra mais proposta nenhuma, então nada a buscar.
  test("sem pedido recente nem resposta guardada: a Simulação não pergunta pela resposta", async ({ page }) => {
    let buscas = 0;
    page.on("request", (r) => {
      if (r.url().includes("/comite/resposta")) buscas++;
    });
    await abrir(page, { resposta: resposta(), enviadoEm: null });
    await page.waitForTimeout(800);
    expect(buscas).toBe(0);
    await expect(page.locator(".tela-aportar .comite-resposta")).toHaveCount(0);
  });

  test("bloquear a sessão tira a resposta decifrada da memória", async ({ page }) => {
    await abrirRodada(page, { resposta: resposta() });
    const depois = await page.evaluate(() => {
      const raiz = (window as any).Alpine.$data(document.body);
      raiz._limparEstadoSensivel();
      return raiz.comiteResposta;
    });
    expect(depois).toBeNull();
  });

  test("320 px: sem rolagem horizontal, com a proposta aberta", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await abrirRodada(page, { resposta: resposta() });
    await bloco(page).scrollIntoViewIfNeeded();
    const larg = await page.evaluate(() => {
      const vp = document.documentElement.clientWidth;
      const fora = Array.from(document.querySelectorAll(".proposta-corpo *")).filter(
        (el) => el.getBoundingClientRect().right > vp + 0.5,
      ).length;
      return { doc: document.documentElement.scrollWidth, vp, fora };
    });
    expect(larg.doc).toBeLessThanOrEqual(larg.vp);
    expect(larg.fora).toBe(0);
  });

  for (const tema of ["claro", "Plantão"] as const) {
    test(`${tema}: todo texto do item legível (AA 4,5:1 sobre o fundo efetivo)`, async ({ page }) => {
      await abrirRodada(page, {
        resposta: resposta((r) => (r.atual.grifo_dado_velho = true)),
        tema: tema === "Plantão" ? "dark" : null,
      });
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
        const raiz = document.querySelector(".proposta-corpo")!;
        const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
        while (w.nextNode()) {
          const n = w.currentNode as Text;
          const el = n.parentElement!;
          if (!n.textContent!.trim() || el.getClientRects().length === 0) continue;
          out.push({ t: n.textContent!.trim().slice(0, 30), c: getComputedStyle(el).color, b: fundo(el) });
        }
        return { tema: document.documentElement.getAttribute("data-theme"), out };
      });
      expect(pares.tema).toBe(tema === "Plantão" ? "dark" : "light");
      expect(pares.out.length).toBeGreaterThan(10);
      for (const p of pares.out) {
        expect(contraste(p.c, p.b), `${p.t}: ${p.c} sobre ${p.b}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  // O cabeçalho do item também é texto, e fora do corpo aberto.
  for (const tema of ["claro", "Plantão"] as const) {
    test(`${tema}: o cabeçalho de cada item é legível (AA 4,5:1)`, async ({ page }) => {
      await abrir(page, {
        resposta: resposta(),
        tema: tema === "Plantão" ? "dark" : null,
        hash: "#/aportar/proposta",
      });
      await expect(page.locator(".proposta-item")).toHaveCount(3);
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
        document.querySelectorAll(".proposta-item__cab span").forEach((el) => {
          const t = (el.textContent || "").trim();
          if (!t || el.getClientRects().length === 0 || el.children.length) return;
          out.push({ t: t.slice(0, 30), c: getComputedStyle(el).color, b: fundo(el) });
        });
        return out;
      });
      expect(pares.length).toBeGreaterThanOrEqual(6);
      for (const p of pares) {
        expect(contraste(p.c, p.b), `${p.t}: ${p.c} sobre ${p.b}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});

// CRB 7a.BW.6 (iter 1): a rodada só de registros do dia 12 não responde ao pedido de
// aporte; ela não pode limpar o "na fila" deste aparelho. Só a resposta de aporte
// (atual.criado_em) depois do envio limpa. 7a.CH.1: o estado que esta regra protege
// é o `comiteEstado` local, que continua sendo o retorno do envio na Simulação.
test("rodada so de registros mais nova nao limpa o pedido na fila", async ({ page }) => {
  const enviado = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const r = resposta((x) => {
    x.estado = "registros";
    x.atual.criado_em = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    x.ultima_rodada = { modo: "registros", estado: "registros", criado_em: new Date().toISOString(), motivo_recusa: null };
  });
  await abrir(page, {
    resposta: r,
    enviadoEm: enviado,
    estado: { pendente: true, recebido_em: enviado, disparado_em: null, ultima_falha: null, cifra: null },
  });
  await expect(page.getByText("Pedido na fila; resposta até amanhã às 7h.")).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.getByText("Pedido na fila; resposta até amanhã às 7h.")).toBeVisible();
});
