import { test, expect, Page } from "@playwright/test";
import { abrirOlho, payload, ddmm, isoDiasAtras, semTransbordo } from "./olho-comum";

// 7a.BX.4 Task 4.2: o Olho no app (spec 7a.BX §13.1, D1). Fixture SINTÉTICA
// (EMPR3, FUND11), cifrada na hora; GET /olho é falso (page.route).

test.use({ viewport: { width: 390, height: 844 } });

const COPY_PROIBIDA = /recomenda|compre|venda|—|–/i;

async function textoDaTela(page: Page, sel: string) {
  return (await page.locator(sel).innerText()).replace(/\s+/g, " ");
}

test.describe("Olho: Raio-X", () => {
  test("tese sob ameaça não examinada: UMA linha, glifo + texto, leva a #olho", async ({ page }) => {
    const erros: string[] = [];
    await abrirOlho(page, { erros });
    const linha = page.getByTestId("olho-raiox");
    await expect(linha).toBeVisible({ timeout: 10_000 });
    await expect(linha).toHaveCount(1);
    await expect(linha).toHaveText(/1 tese sob ameaça\s*· ver/);
    await expect(linha.locator(".olho-glifo")).toHaveAttribute("aria-hidden", "true");
    const caixa = await linha.boundingBox();
    expect(caixa!.height).toBeGreaterThanOrEqual(44);
    // Abaixo do hero (a linha de frescor vive nele).
    const hero = await page.locator("#hero").boundingBox();
    expect(caixa!.y).toBeGreaterThan(hero!.y + hero!.height);
    await linha.click();
    await expect(page).toHaveURL(/#olho$/);
    await expect(page.locator(".tela-olho")).toBeVisible();
    expect(erros).toEqual([]);
  });

  test("ameaça já examinada, ou só observar: a linha NÃO existe no DOM", async ({ page }) => {
    await abrirOlho(page, {
      payload: payload((p) => {
        p.alertas[0].examinado = true;
        p.alertas[0].examinado_em = isoDiasAtras(1);
      }),
    });
    // Controle: o payload chegou (o índice do Diagnóstico o lê).
    await page.evaluate(() => (location.hash = "#/raiox/diagnostico"));
    await expect(page.getByTestId("diag-indice-olho")).toContainText("nenhuma tese sob ameaça", { timeout: 10_000 });
    await page.evaluate(() => (location.hash = ""));
    await expect(page.locator(".raiox")).toBeVisible();
    await expect(page.getByTestId("olho-raiox")).toHaveCount(0);
  });
});

test.describe("Olho: a rota #olho", () => {
  test("cabeçalho de estado, alertas por grau (ameaça antes de observar), sem efeito recolhido", async ({ page }) => {
    const p = payload();
    await abrirOlho(page, { payload: p, hash: "#olho" });
    const estado = page.getByTestId("olho-estado");
    await expect(estado).toBeVisible({ timeout: 10_000 });
    await expect(estado.locator(".olho-estado__rodada")).toHaveText(
      new RegExp(`^Última vigília \\S+ ${ddmm(p.ultima_rodada.data)} · 5\\sativos · 6\\sdocumentos lidos$`),
    );
    await expect(estado.locator(".olho-fontes li")).toHaveText(["CVM ok", "fnet ok", "EDGAR ok"]);
    const grupos = page.locator(".olho-grupo");
    await expect(grupos).toHaveCount(2);
    await expect(grupos.nth(0)).toHaveAttribute("data-grau", "tese_sob_ameaca");
    await expect(grupos.nth(0).locator(".olho-grupo__titulo")).toHaveText(/▲\s*Tese sob ameaça/);
    await expect(grupos.nth(1).locator(".olho-grupo__titulo")).toHaveText(/◇\s*Observar/);
    const a = grupos.nth(0).locator(".olho-alerta");
    await expect(a.locator(".olho-alerta__ticker")).toHaveText("EMPR3");
    await expect(a.locator(".olho-alerta__data")).toHaveText("12/11 · Fato Relevante");
    const titulo = a.locator(".olho-alerta__titulo");
    await expect(titulo).toHaveAttribute("href", "https://exemplo.invalid/doc/900001");
    await expect(titulo).toHaveAttribute("target", "_blank");
    await expect(titulo).toHaveAttribute("rel", /noopener/);
    await expect(a.locator(".olho-trecho")).toHaveText("“a Companhia revisa sua estimativa de margem para 18%”");
    await expect(a.locator(".olho-alerta__estado")).toHaveText("aguarda o reexame");
    // A citação NÃO é grifo.
    await expect(page.locator(".tela-olho .grifo")).toHaveCount(0);
    // Sem efeito: uma linha recolhida, que abre a contagem por ativo.
    const se = page.getByTestId("olho-sem-efeito");
    await expect(se).toHaveText(/4\slidos sem efeito/);
    await expect(se).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".olho-sem-efeito__lista")).toHaveCount(0);
    await se.click();
    await expect(se).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".olho-sem-efeito__lista li")).toHaveText([/EMPR3\s*1 documento/, /EXMP\s*2 documentos/, /OUTR3\s*1 documento/]);
    expect(await textoDaTela(page, ".tela-olho")).not.toMatch(COPY_PROIBIDA);
  });

  test("um toque leva do alerta ao dossiê, e o dossiê mostra a Vigília", async ({ page }) => {
    await abrirOlho(page, { hash: "#olho" });
    await page.locator(".olho-alerta__ticker", { hasText: "EMPR3" }).click();
    await expect(page).toHaveURL(/#\/dossie\/EMPR3$/);
    await expect(page.getByTestId("dossie-vigilia")).toBeVisible({ timeout: 10_000 });
  });

  test("estado: nunca rodou (KV sem a chave)", async ({ page }) => {
    await abrirOlho(page, { payload: null, hash: "#olho" });
    await expect(page.getByTestId("olho-nunca")).toHaveText(/^A primeira vigília roda na segunda \d{2}\/\d{2}\.$/, { timeout: 10_000 });
    await expect(page.getByTestId("olho-estado")).toHaveCount(0);
  });

  test("estado: rodou sem novidade", async ({ page }) => {
    await abrirOlho(page, {
      hash: "#olho",
      payload: payload((p) => {
        p.ultima_rodada.novidades = 0;
        p.ultima_rodada.lidos = 0;
        p.alertas = [];
      }),
    });
    await expect(page.getByTestId("olho-sem-novidade")).toHaveText("5 ativos vigiados, nada novo.", { timeout: 10_000 });
    await expect(page.locator(".olho-grupo")).toHaveCount(0);
  });

  test("estado: fonte muda e fonte com erro dizem quem ficou sem vigília", async ({ page }) => {
    await abrirOlho(page, {
      hash: "#olho",
      payload: payload((p) => {
        p.ultima_rodada.fontes.fnet.estado = "erro";
        p.ultima_rodada.fontes.edgar.estado = "muda";
      }),
    });
    const fontes = page.locator(".olho-fontes li");
    await expect(fontes).toHaveText(
      ["CVM ok", "fnet sem resposta nesta semana: 2 FIIs sem vigília", "EDGAR respondeu vazio nesta semana: 1 ação americana sem vigília"],
      { timeout: 10_000 },
    );
    await expect(page.locator('.olho-fontes li[data-fonte="fnet"]')).toHaveClass(/is-fora/);
    await expect(page.locator('.olho-fontes li[data-fonte="cvm"]')).not.toHaveClass(/is-fora/);
  });

  test("estado: documentos na fila", async ({ page }) => {
    await abrirOlho(page, { hash: "#olho", payload: payload((p) => (p.fila = 3)) });
    await expect(page.getByTestId("olho-fila")).toHaveText("3 documentos ficaram na fila para a próxima vigília.", { timeout: 10_000 });
  });

  test("estado: falha de leitura nomeia o documento", async ({ page }) => {
    await abrirOlho(page, {
      hash: "#olho",
      payload: payload((p) => {
        p.falhas_leitura = [{ chave: "fnet:9", ticker: "FUNX11", fonte: "fnet", categoria: "Relatório Gerencial",
          data_entrega: isoDiasAtras(5), data_rodada: isoDiasAtras(2), titulo: "Relatório de exemplo", url: "https://exemplo.invalid/doc/9", motivo: "" }];
      }),
    });
    const f = page.locator(".olho-falhas");
    await expect(f.locator(".olho-grupo__titulo")).toHaveText("Não foi possível ler", { timeout: 10_000 });
    await expect(f.locator(".olho-falha")).toHaveText("FUNX11: Relatório de exemplo");
    await expect(f.locator("a")).toHaveAttribute("href", "https://exemplo.invalid/doc/9");
  });

  test("estado: vigília atrasada (mais de 10 dias) é aviso explícito, também no índice", async ({ page }) => {
    const velha = isoDiasAtras(12);
    await abrirOlho(page, { hash: "#olho", payload: payload((p) => (p.ultima_rodada.data = velha)) });
    await expect(page.getByTestId("olho-atraso")).toHaveText(
      `A vigília está parada: a última leitura foi em ${ddmm(velha)}, há 12 dias. Nada lido depois disso aparece aqui.`,
      { timeout: 10_000 },
    );
    await page.evaluate(() => (location.hash = "#/raiox/diagnostico"));
    await expect(page.getByTestId("diag-indice-olho")).toContainText("a vigília está parada");
  });

  test("controle do atraso: 10 dias ainda não é atraso", async ({ page }) => {
    await abrirOlho(page, { hash: "#olho", payload: payload((p) => (p.ultima_rodada.data = isoDiasAtras(10))) });
    await expect(page.getByTestId("olho-estado")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("olho-atraso")).toHaveCount(0);
  });

  test("estado: offline, a cópia do service worker vem com a idade", async ({ page }) => {
    await abrirOlho(page, { hash: "#olho", doCache: true, gravadaEm: "2026-11-09T11:31:00Z" });
    await expect(page.getByTestId("olho-cache")).toHaveText("Sem conexão: mostrando a vigília guardada em 09/11.", { timeout: 10_000 });
    await expect(page.getByTestId("olho-estado")).toBeVisible();
  });

  test("estado: alerta examinado sai do Raio-X e mostra a data do Relatório", async ({ page }) => {
    const quando = isoDiasAtras(1);
    await abrirOlho(page, {
      hash: "#olho",
      payload: payload((p) => {
        p.alertas[0].examinado = true;
        p.alertas[0].examinado_em = quando;
      }),
    });
    const est = page.locator('.olho-alerta[data-grau="tese_sob_ameaca"] .olho-alerta__estado');
    await expect(est).toHaveText(`examinado no Relatório de ${ddmm(quando)}`, { timeout: 10_000 });
    await expect(est).toHaveClass(/is-examinado/);
  });

  test("erro ao abrir: frase e Tentar de novo (44 px)", async ({ page }) => {
    await abrirOlho(page, { hash: "#olho", status: 500 });
    const erro = page.getByTestId("olho-erro");
    await expect(erro).toContainText("Não foi possível abrir a vigília agora.", { timeout: 10_000 });
    const b = await erro.getByRole("button", { name: "Tentar de novo" }).boundingBox();
    expect(b!.height).toBeGreaterThanOrEqual(44);
  });

  test("Bloquear sessão apaga o claro do Olho", async ({ page }) => {
    await abrirOlho(page, { hash: "#olho" });
    await expect(page.getByTestId("olho-estado")).toBeVisible({ timeout: 10_000 });
    const depois = await page.evaluate(() => {
      const raiz = document.querySelector("[x-data]") as any;
      const d = (window as any).Alpine.$data(raiz);
      d._limparEstadoSensivel();
      return { olho: d.olho, estado: d.olhoEstado };
    });
    expect(depois).toEqual({ olho: null, estado: "ausente" });
  });
});

test.describe("Olho: o dossiê", () => {
  test("seção Vigília abaixo da tese: alerta, citação (não grifo) e rodapé", async ({ page }) => {
    const p = payload();
    await abrirOlho(page, { payload: p, hash: "#/dossie/EMPR3" });
    const v = page.getByTestId("dossie-vigilia");
    await expect(v).toBeVisible({ timeout: 10_000 });
    // Ordem: tese, vigília, retorno esperado (7a.BY.4), linha do tempo.
    const ordem = await page.locator(".dossie-corpo > section").evaluateAll((els) => els.map((e) => e.className));
    expect(ordem.slice(0, 4)).toEqual(["dossie-tese", "dossie-vigilia", "dossie-retorno", "dossie-tl"]);
    const a = v.locator(".olho-alerta");
    await expect(a).toHaveCount(1);
    await expect(a.locator(".olho-alerta__grau")).toHaveText(/▲\s*Tese sob ameaça\s*12\/11 · Fato Relevante/);
    await expect(a.locator(".olho-alerta__estado")).toHaveText("aguarda o reexame");
    await expect(page.locator(".tela-dossie .grifo")).toHaveCount(1); // só o quebra_se
    await expect(v.getByTestId("dossie-vigilia-rodape")).toHaveText(
      `Vigiado desde ${ddmm(p.primeira_rodada)} · última vigília ${ddmm(p.ultima_rodada.data)} · 1 documento lido sem efeito`,
    );
  });

  test("dossiê de ETF: fora da vigília", async ({ page }) => {
    await abrirOlho(page, { hash: "#/dossie/SMAL11" });
    await expect(page.getByTestId("dossie-vigilia-fora")).toHaveText("Fora da vigília: ETF não tem fato de empresa.", { timeout: 10_000 });
  });

  test("payload anterior à BX.4 (sem vigiados): ETF sem seção, vigiado ainda mostra alerta", async ({ page }) => {
    const p = payload((x) => {
      delete x.vigiados;
      delete x.primeira_rodada;
    });
    await abrirOlho(page, { payload: p, hash: "#/dossie/SMAL11" });
    await expect(page.locator(".dossie-tese")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("dossie-vigilia")).toHaveCount(0);
    await page.evaluate(() => (location.hash = "#/dossie/EMPR3"));
    await expect(page.getByTestId("dossie-vigilia-rodape")).toHaveText(
      `Última vigília ${ddmm(p.ultima_rodada.data)} · 1 documento lido sem efeito`,
      { timeout: 10_000 },
    );
  });

  test("fonte do ativo fora do ar: o dossiê diz que ele não foi vigiado", async ({ page }) => {
    await abrirOlho(page, { hash: "#/dossie/FUND11", payload: payload((p) => (p.ultima_rodada.fontes.fnet.estado = "erro")) });
    await expect(page.getByTestId("dossie-vigilia")).toContainText("fnet sem resposta nesta semana: este ativo não foi vigiado.", { timeout: 10_000 });
  });
});

test.describe("Olho: índice do Diagnóstico", () => {
  test("link permanente, fora da lista numerada, com o estado", async ({ page }) => {
    const p = payload();
    await abrirOlho(page, { payload: p, hash: "#/raiox/diagnostico" });
    const l = page.getByTestId("diag-indice-olho");
    await expect(l).toHaveText(new RegExp(`O Olho: aconteceu algo com as empresas\\?\\s*Última vigília ${ddmm(p.ultima_rodada.data)}: 1 tese sob ameaça\\.`), { timeout: 10_000 });
    await expect(page.locator(".diag-indice__lista .diag-indice__olho")).toHaveCount(0);
    expect((await l.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await l.click();
    await expect(page).toHaveURL(/#olho$/);
  });
});

test.describe("Olho: prova visual a 320 px, claro e Plantão", () => {
  for (const tema of [null, "dark"] as const) {
    test(`320 px ${tema ?? "claro"}: #olho, dossiê e Raio-X sem transbordo`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 720 });
      await abrirOlho(page, {
        tema,
        payload: payload((p) => {
          p.ultima_rodada.fontes.fnet.estado = "erro";
          p.fila = 2;
        }),
      });
      await expect(page.getByTestId("olho-raiox")).toBeVisible({ timeout: 10_000 });
      await semTransbordo(page, ".raiox");
      await page.getByTestId("olho-raiox").screenshot({ path: `test-results/olho-raiox-320-${tema ?? "claro"}.png` });
      await page.evaluate(() => (location.hash = "#olho"));
      await expect(page.getByTestId("olho-estado")).toBeVisible();
      await page.getByTestId("olho-sem-efeito").click();
      await semTransbordo(page, ".tela-olho");
      await page.screenshot({ path: `test-results/olho-320-${tema ?? "claro"}.png`, fullPage: true });
      await page.evaluate(() => (location.hash = "#/dossie/EMPR3"));
      await expect(page.getByTestId("dossie-vigilia")).toBeVisible({ timeout: 10_000 });
      await semTransbordo(page, ".tela-dossie");
      await page.getByTestId("dossie-vigilia").screenshot({ path: `test-results/olho-dossie-320-${tema ?? "claro"}.png` });
    });
  }
});

// Achados do board (7a.BX.4, iteração 1).
test.describe("Olho: bordas da busca e das datas", () => {
  test("bloqueio com a busca em voo: nada é gravado depois do bloqueio", async ({ page }) => {
    await abrirOlho(page);
    await page.waitForFunction(() => {
      const d = (window as any).Alpine.$data(document.querySelector("[x-data]"));
      return d.olhoEstado !== "carregando" && d.olhoEstado !== "ausente";
    });
    // Nova busca lenta (KV sem a chave), bloqueio no meio dela.
    await page.unroute("**/olho");
    await page.route("**/olho", async (r) => {
      await new Promise((ok) => setTimeout(ok, 800));
      await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cifra: null, gravada_em: null }) });
    });
    const depois = await page.evaluate(async () => {
      const d = (window as any).Alpine.$data(document.querySelector("[x-data]"));
      d._limparEstadoOlho();
      const busca = d.olhoCarregar();
      d._limparEstadoSensivel();
      await busca;
      return { olho: d.olho, estado: d.olhoEstado };
    });
    expect(depois).toEqual({ olho: null, estado: "ausente" });
  });

  test("busca antiga que termina depois do bloqueio não derruba a busca nova em voo", async ({ page }) => {
    await abrirOlho(page);
    await page.waitForFunction(() => {
      const d = (window as any).Alpine.$data(document.querySelector("[x-data]"));
      return d.olhoEstado !== "carregando" && d.olhoEstado !== "ausente";
    });
    let atraso = 300;
    await page.unroute("**/olho");
    await page.route("**/olho", async (r) => {
      const ms = atraso;
      atraso += 900; // a segunda busca termina bem depois da primeira
      await new Promise((ok) => setTimeout(ok, ms));
      await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cifra: null, gravada_em: null }) });
    });
    const mesma = await page.evaluate(async () => {
      const d = (window as any).Alpine.$data(document.querySelector("[x-data]"));
      const antiga = d.olhoCarregar();
      d._limparEstadoOlho(); // bloqueio só do Olho: o segredo segue em memória
      const nova = d.olhoCarregar();
      await antiga; // a antiga termina com a nova ainda em voo
      return d.olhoCarregar() === nova;
    });
    expect(mesma).toBe(true);
  });

  test.describe("fuso de São Paulo", () => {
    test.use({ timezoneId: "America/Sao_Paulo" });
    test("cópia gravada às 22h30 BRT mostra o dia de BRT, não o de UTC", async ({ page }) => {
      await abrirOlho(page, { hash: "#olho", doCache: true, gravadaEm: "2026-11-10T01:30:00Z" });
      await expect(page.getByTestId("olho-cache")).toHaveText("Sem conexão: mostrando a vigília guardada em 09/11.", { timeout: 10_000 });
    });
  });

  for (const [agora, esperado] of [
    ["2026-11-15T12:00:00-03:00", "16/11"], // domingo: a segunda seguinte
    ["2026-11-16T07:00:00-03:00", "16/11"], // segunda: hoje
    ["2026-11-24T12:00:00-03:00", "30/11"], // terça: virada para a segunda do fim do mês
  ] as const) {
    test(`nunca rodou em ${agora.slice(0, 10)}: a primeira vigília é segunda ${esperado}`, async ({ page }) => {
      await page.clock.setFixedTime(new Date(agora));
      await abrirOlho(page, { payload: null, hash: "#olho" });
      await expect(page.getByTestId("olho-nunca")).toHaveText(`A primeira vigília roda na segunda ${esperado}.`, { timeout: 10_000 });
    });
  }
});
