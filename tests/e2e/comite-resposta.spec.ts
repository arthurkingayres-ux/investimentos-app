import { test, expect, Page } from "@playwright/test";
import { abrir, resposta, contraste, VERBO_DE_ORDEM } from "./comite-comum";

// 7a.BW.6 Task 6.6: a resposta do Comitê no #aportar, lado a lado com a regra
// (spec 7a.BW §6.6, §13.1 e D5). O Worker é falso (page.route): GET
// /comite/resposta devolve a fixture SINTÉTICA cifrada com o segredo de teste.

test.use({ viewport: { width: 390, height: 844 } });

const bloco = (page: Page) => page.locator(".comite-resposta");

async function comValor(page: Page, valor: string) {
  await page.locator(".aporte-input").fill(valor);
}

test.describe("Comitê: a resposta no #aportar", () => {
  test("pedido recente deste aparelho: a proposta aparece, Comitê antes de Regra", async ({ page }) => {
    await abrir(page, { resposta: resposta() });
    await comValor(page, "6000");
    await expect(bloco(page)).toBeVisible({ timeout: 10_000 });
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

  test("grifo único: a razão principal é O grifo; o do plano da regra vira texto comum", async ({ page }) => {
    await abrir(page, { resposta: resposta() });
    await comValor(page, "6000");
    await expect(bloco(page)).toBeVisible({ timeout: 10_000 });
    // O plano da regra já montado (o grifo dele depende do debounce do campo).
    await expect(page.locator(".aporte-grifo")).toBeVisible();
    const grifos = page.locator(".tela-aportar .grifo:visible");
    await expect(grifos).toHaveCount(1);
    await expect(grifos.first()).toHaveClass(/comite-razao/);
    await expect(grifos.first()).toContainText("Juntar a remessa");
    // O plano da regra segue lá, só sem o grifo.
    await expect(page.locator(".aporte-grifo")).toBeVisible();
    await expect(page.locator(".aporte-grifo")).not.toHaveClass(/(^|\s)grifo(\s|$)/);
  });

  test("argumento contrário, o que mudaria e confiança visíveis sem toque", async ({ page }) => {
    const erros: string[] = [];
    await abrir(page, { resposta: resposta(), erros });
    await expect(bloco(page)).toBeVisible({ timeout: 10_000 });
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
    await abrir(page, {
      resposta: resposta((r) => (r.atual.custos.medido_em = "2026-11-08")),
    });
    await expect(bloco(page)).toBeVisible({ timeout: 10_000 });
    const custo = bloco(page).locator(".comite-linha-custo");
    await expect(custo.locator("td").nth(0)).toHaveText("R$ 0");
    await expect(custo.locator("td").nth(1)).toHaveText("R$ 61");
    await expect(bloco(page).locator(".comite-custo-nota")).toContainText(
      "custo estimado; câmbio e IOF por parâmetro medido em 08/11/2026",
    );
    await expect(bloco(page).locator(".comite-economia")).toContainText("R$ 61 a menos");
  });

  test("sem data dos parâmetros, a nota não inventa uma", async ({ page }) => {
    await abrir(page, { resposta: resposta() });
    await expect(bloco(page)).toBeVisible({ timeout: 10_000 });
    const nota = bloco(page).locator(".comite-custo-nota");
    await expect(nota).toContainText("custo estimado; câmbio e IOF por parâmetro");
    await expect(nota).not.toContainText("medido em");
  });

  test("outro valor: digitado diferente do pedido, a proposta fica, rotulada com o valor pedido", async ({ page }) => {
    await abrir(page, { resposta: resposta() });
    await comValor(page, "5000");
    await expect(bloco(page)).toBeVisible({ timeout: 10_000 });
    const rot = bloco(page).locator(".comite-outro-valor");
    await expect(rot).toBeVisible();
    await expect(rot).toContainText("R$ 6.000");
    await expect(rot).toContainText("R$ 5.000");
    await expect(bloco(page).locator('.comite-linha[data-ticker="ZZAA3"] td').nth(0)).toHaveText("R$ 2.400");
    await comValor(page, "6000");
    await expect(rot).toBeHidden();
  });

  test("recusada: mostra a regra e o motivo em uma linha", async ({ page }) => {
    await abrir(page, {
      resposta: resposta((r) => {
        r.estado = "recusada";
        r.atual.comite = null;
        r.atual.custos.comite = null;
        r.atual.economia_brl = null;
        r.atual.motivo_recusa = "ACIMA_DO_TETO";
      }),
    });
    await comValor(page, "6000");
    await expect(bloco(page)).toBeVisible({ timeout: 10_000 });
    const recusa = bloco(page).locator(".comite-recusa");
    await expect(recusa).toHaveText(
      "O Comitê não passou na conferência (levava um ativo acima do teto da faixa); esta é a regra.",
    );
    const cab = await bloco(page).locator(".comite-comparacao thead th.comite-col").allTextContents();
    expect(cab.map((t) => t.trim()).filter(Boolean)).toEqual(["Regra"]);
    await expect(bloco(page).locator(".comite-linha")).toHaveCount(4);
    await expect(bloco(page).locator(".comite-razao")).toHaveCount(0);
    // Sem proposta, o grifo da tela continua sendo o do plano.
    await expect(page.locator(".tela-aportar .grifo:visible")).toHaveCount(1);
    await expect(page.locator(".aporte-grifo")).toHaveClass(/(^|\s)grifo(\s|$)/);
  });

  test("recusada com código desconhecido: linha genérica, sem jargão", async ({ page }) => {
    await abrir(page, {
      resposta: resposta((r) => {
        r.atual.comite = null;
        r.atual.motivo_recusa = "XYZ_NOVO";
      }),
    });
    await expect(bloco(page)).toBeVisible({ timeout: 10_000 });
    // O código desconhecido não repete "não passou na conferência" entre
    // parênteses: a linha fica sem o motivo.
    await expect(bloco(page).locator(".comite-recusa")).toHaveText(
      "O Comitê não passou na conferência; esta é a regra.",
    );
    await expect(bloco(page)).not.toContainText("XYZ_NOVO");
  });

  test("antiga (> 30 dias): rotulada como antiga", async ({ page }) => {
    await abrir(page, {
      resposta: resposta((r) => (r.atual.criado_em = new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString())),
    });
    await expect(bloco(page)).toBeVisible({ timeout: 10_000 });
    await expect(bloco(page).locator(".comite-antiga")).toBeVisible();
    await expect(bloco(page).locator(".comite-antiga")).toContainText("antiga");
  });

  test("recente (< 30 dias): sem rótulo de antiga", async ({ page }) => {
    await abrir(page, { resposta: resposta() });
    await expect(bloco(page)).toBeVisible({ timeout: 10_000 });
    await expect(bloco(page).locator(".comite-antiga")).toHaveCount(0);
  });

  test("dado velho: o aviso de idade dos dados vira O grifo", async ({ page }) => {
    await abrir(page, {
      resposta: resposta((r) => {
        r.atual.grifo_dado_velho = true;
        r.atual.idade_fontes.dias_sem_ingestao = 40;
      }),
    });
    await comValor(page, "6000");
    await expect(bloco(page)).toBeVisible({ timeout: 10_000 });
    // O plano da regra já montado (o grifo dele depende do debounce do campo).
    await expect(page.locator(".aporte-grifo")).toBeVisible();
    const grifos = page.locator(".tela-aportar .grifo:visible");
    await expect(grifos).toHaveCount(1);
    await expect(grifos.first()).toHaveClass(/comite-dado-velho/);
    await expect(grifos.first()).toContainText("40 dias");
    // A razão principal continua lá, como texto.
    await expect(bloco(page).locator(".comite-razao")).toBeVisible();
    await expect(bloco(page).locator(".comite-razao")).not.toHaveClass(/(^|\s)grifo(\s|$)/);
  });

  test("link do bloco para #comite, com os registros daquela rodada", async ({ page }) => {
    await abrir(page, { resposta: resposta((r) => (r.registros[1].criado_em = r.atual.criado_em)) });
    await expect(bloco(page)).toBeVisible({ timeout: 10_000 });
    const link = page.locator(".comite-link-registros");
    await expect(link).toHaveAttribute("href", "#comite");
    await expect(link).toContainText("Anotado para a revisão estrutural (1)");
    const alt = await link.boundingBox();
    expect(alt!.height).toBeGreaterThanOrEqual(44);
    await link.click();
    await expect(page.locator(".tela-comite")).toBeVisible();
  });

  test("nenhum verbo de ordem na voz do Comitê", async ({ page }) => {
    await abrir(page, { resposta: resposta() });
    await comValor(page, "5000");
    await expect(bloco(page)).toBeVisible({ timeout: 10_000 });
    const txt = await page.locator(".comite-bloco").innerText();
    expect(txt).not.toMatch(VERBO_DE_ORDEM);
  });

  test("sem resposta (cifra null): nada novo na tela e nenhum erro de console", async ({ page }) => {
    const erros: string[] = [];
    await abrir(page, { resposta: null, erros });
    await comValor(page, "6000");
    await page.waitForTimeout(800);
    await expect(bloco(page)).toHaveCount(0);
    await expect(page.locator(".comite-link-registros")).toHaveCount(0);
    await expect(page.locator(".aporte-grifo")).toHaveClass(/(^|\s)grifo(\s|$)/);
    expect(erros).toEqual([]);
  });

  test("resposta guardada antes: abrir o #aportar sem pedido recente busca de novo", async ({ page }) => {
    let buscas = 0;
    page.on("request", (r) => {
      if (r.url().includes("/comite/resposta")) buscas++;
    });
    await abrir(page, { resposta: resposta(), enviadoEm: null, cache: resposta() });
    await expect(bloco(page)).toBeVisible({ timeout: 10_000 });
    expect(buscas).toBeGreaterThanOrEqual(1);
    // O que fica no aparelho é só a cifra.
    const guardado = await page.evaluate(() => localStorage.getItem("comite:resposta") || "");
    expect(guardado).not.toContain("ZZAA3");
    expect(guardado).not.toContain("Juntar");
  });

  test("sem pedido recente nem resposta guardada: o app não pergunta pela resposta", async ({ page }) => {
    let buscas = 0;
    page.on("request", (r) => {
      if (r.url().includes("/comite/resposta")) buscas++;
    });
    await abrir(page, { resposta: resposta(), enviadoEm: null });
    await page.waitForTimeout(800);
    expect(buscas).toBe(0);
    await expect(bloco(page)).toHaveCount(0);
  });

  test("bloquear a sessão tira a resposta decifrada da memória", async ({ page }) => {
    await abrir(page, { resposta: resposta() });
    await expect(bloco(page)).toBeVisible({ timeout: 10_000 });
    const depois = await page.evaluate(() => {
      const raiz = (window as any).Alpine.$data(document.body);
      raiz._limparEstadoSensivel();
      return raiz.comiteResposta;
    });
    expect(depois).toBeNull();
  });

  test("320 px: sem rolagem horizontal, com a proposta e o rótulo de outro valor", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await abrir(page, { resposta: resposta() });
    await comValor(page, "123456");
    await expect(bloco(page)).toBeVisible({ timeout: 10_000 });
    await bloco(page).scrollIntoViewIfNeeded();
    const larg = await page.evaluate(() => {
      const vp = document.documentElement.clientWidth;
      const fora = Array.from(document.querySelectorAll(".comite-resposta *")).filter(
        (el) => el.getBoundingClientRect().right > vp + 0.5,
      ).length;
      return { doc: document.documentElement.scrollWidth, vp, fora };
    });
    expect(larg.doc).toBeLessThanOrEqual(larg.vp);
    expect(larg.fora).toBe(0);
  });

  for (const tema of ["claro", "Plantão"] as const) {
    test(`${tema}: todo texto do bloco legível (AA 4,5:1 sobre o fundo efetivo)`, async ({ page }) => {
      await abrir(page, {
        resposta: resposta((r) => (r.atual.grifo_dado_velho = true)),
        tema: tema === "Plantão" ? "dark" : null,
      });
      await comValor(page, "5000");
      await expect(bloco(page)).toBeVisible({ timeout: 10_000 });
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
        const raiz = document.querySelector(".comite-resposta")!;
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
});
