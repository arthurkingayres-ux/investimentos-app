import { test, expect } from "@playwright/test";
import { abrir, estadoPendente, resposta, VERBO_DE_ORDEM } from "./comite-comum";

// Fase 7a.CH.1 — a aba Proposta: "o meu pedido está andando? o que o Comitê
// propôs antes?". Fixtures 100% SINTÉTICAS (o sibling é público): a resposta
// vem de tests/fixtures/comite-resposta.sintetica.json e o pedido pendente é
// cifrado na hora com o segredo de teste da suíte.
//
// O fuso do aparelho é Tóquio de propósito: a hora que o cartão mostra é a
// próxima 03:30 em America/Sao_Paulo, qualquer que seja o fuso local. Rodando
// em UTC (o default do Playwright) um bug de fuso de 3 h passaria sem ser
// visto em metade dos casos.

test.use({ viewport: { width: 390, height: 844 }, timezoneId: "Asia/Tokyo" });

// A conta de fuso é lida PELA TELA, que é onde ela importa — e não por um
// gancho que só o teste chamaria (achado do board de 25/11: três wrappers de
// uma linha existiam só para isto). Os passos do cartão carregam a data, a
// hora e a próxima 03:30 de uma vez.
test.describe("7a.CH.1 — a hora do pedido é sempre BRT", () => {
  const passos = (page: any) => page.locator(".proposta-passos li");

  test("as horas do cartão são BRT, com o aparelho em Tóquio", async ({ page }) => {
    await abrir(page, {
      resposta: null,
      enviadoEm: null,
      hash: "#/aportar/proposta",
      // Relógio fixo: o estado tem data ABSOLUTA, e sem congelar o `Date.now()`
      // da página estes asserts expirariam 72 h depois de 25/11.
      relogio: "2026-11-25T01:00:00Z",
      // 24/11 21:40 BRT = 25/11 00:40 UTC → roda 25/11 às 3h30 BRT
      estado: estadoPendente(5000, { recebido_em: "2026-11-25T00:40:00Z" }),
    });
    await expect(passos(page).nth(0)).toContainText("Pedido recebido · 24/11 às 21:40");
    await expect(passos(page).nth(1)).toContainText("Na fila · roda 25/11 às 3h30");
    await expect(passos(page).nth(3)).toContainText("Pronta · prevista até 25/11 às 5h30");
    await expect(page.locator(".proposta-cartao")).toContainText("Volte a partir das 5h30 de 25/11.");
  });

  test("pedido feito depois das 3h30 roda só no dia seguinte", async ({ page }) => {
    await abrir(page, {
      resposta: null,
      enviadoEm: null,
      hash: "#/aportar/proposta",
      relogio: "2026-11-25T07:30:00Z",
      // 25/11 04:00 BRT = 25/11 07:00 UTC → a 03:30 de hoje já passou
      estado: estadoPendente(5000, { recebido_em: "2026-11-25T07:00:00Z" }),
    });
    // Hora de um dígito sai no formato do mockup (4h00); de dois, 21:40.
    await expect(passos(page).nth(0)).toContainText("Pedido recebido · 25/11 às 4h00");
    await expect(passos(page).nth(1)).toContainText("Na fila · roda 26/11 às 3h30");
  });

  test("pedido antes das 3h30 roda ainda no mesmo dia", async ({ page }) => {
    await abrir(page, {
      resposta: null,
      enviadoEm: null,
      hash: "#/aportar/proposta",
      relogio: "2026-11-25T05:30:00Z",
      // 25/11 02:00 BRT = 25/11 05:00 UTC
      estado: estadoPendente(5000, { recebido_em: "2026-11-25T05:00:00Z" }),
    });
    await expect(passos(page).nth(1)).toContainText("Na fila · roda 25/11 às 3h30");
  });
});

test.describe("7a.CH.1 — o cartão do pedido em andamento", () => {
  // Critério 5 da sub-fase: aparelho LIMPO, que não fez o pedido. É o que faz
  // o estado valer em qualquer aparelho — sem `comite:enviado_em` nenhum.
  test("aparelho que não pediu vê o pedido na fila, com o valor", async ({ page }) => {
    const erros: string[] = [];
    await abrir(page, {
      resposta: null,
      enviadoEm: null,
      erros,
      hash: "#/aportar/proposta",
      relogio: "2026-11-25T01:00:00Z",
      estado: estadoPendente(5000, { recebido_em: "2026-11-25T00:40:00Z" }),
    });
    const c = page.locator(".proposta-cartao");
    await expect(c).toBeVisible();
    await expect(c).toHaveAttribute("data-fase", "na_fila");
    await expect(c.locator(".proposta-valor")).toHaveText("R$ 5.000");
    await expect(c.locator('li[aria-current="step"]')).toContainText("Na fila");
    await expect(c).toContainText("Aparece em qualquer aparelho.");
    expect(erros).toEqual([]);
  });

  test("'Rodar agora' que não disparou: segue na fila e diz por quê", async ({ page }) => {
    await abrir(page, {
      resposta: null,
      enviadoEm: null,
      hash: "#/aportar/proposta",
      estado: estadoPendente(5000, {
        recebido_em: "2026-11-25T00:40:00Z",
        ultima_falha: { em: "2026-11-25T00:40:05Z", motivo: "dispatch falhou: HTTP 403" },
      }),
      relogio: "2026-11-25T01:00:00Z",
    });
    const c = page.locator(".proposta-cartao");
    await expect(c).toHaveAttribute("data-fase", "na_fila");
    await expect(c.locator('[data-aviso="falha-agora"]')).toContainText("não conseguiu disparar");
    // O motivo técnico do KV nunca vai à tela.
    await expect(c).not.toContainText("HTTP 403");
  });

  test("em análise: disparado há menos de 2 h", async ({ page }) => {
    const agora = Date.now();
    await abrir(page, {
      resposta: null,
      enviadoEm: null,
      hash: "#/aportar/proposta",
      estado: estadoPendente(4000, {
        recebido_em: new Date(agora - 90 * 60_000).toISOString(),
        disparado_em: new Date(agora - 30 * 60_000).toISOString(),
      }),
    });
    const c = page.locator(".proposta-cartao");
    await expect(c).toHaveAttribute("data-fase", "em_analise");
    await expect(c.locator('li[aria-current="step"]')).toContainText("Em análise");
    await expect(c.locator(".proposta-valor")).toHaveText("R$ 4.000");
  });

  test("sem resposta: disparado há mais de 2 h e nada chegou", async ({ page }) => {
    const agora = Date.now();
    await abrir(page, {
      resposta: null,
      enviadoEm: null,
      hash: "#/aportar/proposta",
      estado: estadoPendente(4000, {
        recebido_em: new Date(agora - 5 * 3600_000).toISOString(),
        disparado_em: new Date(agora - 4 * 3600_000).toISOString(),
      }),
    });
    const c = page.locator(".proposta-cartao");
    await expect(c).toHaveAttribute("data-fase", "sem_resposta");
    await expect(c.locator('[data-aviso="sem-resposta"]')).toContainText("Peça de novo na Simulação");
  });

  test("respondido: o cartão sai e fica a linha com link para a Simulação", async ({ page }) => {
    const agora = Date.now();
    await abrir(page, {
      resposta: resposta((r) => {
        r.atual.criado_em = new Date(agora - 10 * 60_000).toISOString();
      }),
      enviadoEm: null,
      hash: "#/aportar/proposta",
      estado: estadoPendente(4000, {
        recebido_em: new Date(agora - 3 * 3600_000).toISOString(),
        disparado_em: new Date(agora - 2.5 * 3600_000).toISOString(),
      }),
    });
    await expect(page.locator(".proposta-sem-pedido")).toBeVisible();
    await expect(page.locator(".proposta-cartao")).toHaveCount(0);
    await page.locator(".proposta-sem-pedido a").click();
    await expect(page.locator(".tela-aportar")).toBeVisible();
    expect(await page.evaluate(() => location.hash)).toBe("#aportar");
  });

  test("fora das 72 h: sem cartão", async ({ page }) => {
    await abrir(page, {
      resposta: null,
      enviadoEm: null,
      hash: "#/aportar/proposta",
      estado: estadoPendente(4000, { recebido_em: new Date(Date.now() - 4 * 24 * 3600_000).toISOString() }),
    });
    await expect(page.locator(".proposta-sem-pedido")).toBeVisible();
    await expect(page.locator(".proposta-cartao")).toHaveCount(0);
  });

  // Review Focus 1: o app NÃO afirma ausência de pedido quando não conseguiu
  // conferir. "Nenhum pedido em andamento." seria uma afirmação categórica.
  test("Worker fora do ar: diz que não deu para conferir, e não que não há pedido", async ({ page }) => {
    const erros: string[] = [];
    await abrir(page, { resposta: null, enviadoEm: null, erros, hash: "#/aportar/proposta", estadoStatus: 502 });
    await expect(page.locator(".proposta-sem-conexao")).toContainText("não deu para conferir");
    await expect(page.locator(".proposta-cartao")).toHaveCount(0);
    await expect(page.locator(".tela-proposta")).not.toContainText("Nenhum pedido em andamento");
    expect(erros.filter((e) => !e.includes("502"))).toEqual([]);
  });

  // Review Focus 2: cifra que não decifra neste aparelho (frase trocada).
  test("cifra que não decifra: o estado aparece, o valor não", async ({ page }) => {
    const erros: string[] = [];
    await abrir(page, {
      resposta: null,
      enviadoEm: null,
      erros,
      hash: "#/aportar/proposta",
      estado: estadoPendente(5000, { recebido_em: "2026-11-25T00:40:00Z" }),
      cifraQuebrada: true,
      relogio: "2026-11-25T01:00:00Z",
    });
    const c = page.locator(".proposta-cartao");
    await expect(c).toHaveAttribute("data-fase", "na_fila");
    await expect(c.locator(".proposta-valor")).toHaveCount(0);
    expect(erros).toEqual([]);
  });

  // Review Focus 6: o caminho mais comum de todos — pedir e ser levado à
  // Proposta antes de o KV propagar. O Worker responde 200 e VAZIO.
  test("acabei de pedir e o KV não propagou: o cartão diz 'Pedido recebido'", async ({ page }) => {
    await abrir(page, {
      resposta: null,
      hash: "#/aportar/proposta",
      enviadoEm: new Date(Date.now() - 5_000).toISOString(),
      estado: { pendente: false, recebido_em: null, disparado_em: null, ultima_falha: null, cifra: null },
    });
    const c = page.locator(".proposta-cartao");
    await expect(c).toBeVisible();
    await expect(c).toHaveAttribute("data-fase", "na_fila");
    await expect(c.locator('li[aria-current="step"]')).toContainText("Pedido recebido");
    await expect(page.locator(".tela-proposta")).not.toContainText("Nenhum pedido em andamento");
  });

  test("passados os 2 min sem o Worker mostrar o pedido, o cartão sai", async ({ page }) => {
    await abrir(page, {
      resposta: null,
      hash: "#/aportar/proposta",
      enviadoEm: new Date(Date.now() - 3 * 60_000).toISOString(),
      estado: { pendente: false, recebido_em: null, disparado_em: null, ultima_falha: null, cifra: null },
    });
    await expect(page.locator(".proposta-sem-pedido")).toBeVisible();
    await expect(page.locator(".proposta-cartao")).toHaveCount(0);
  });

  // Review Focus 7: reverter o $watch("rota") tem de ficar VERMELHO. Prova
  // também que `comiteIniciar()` roda ao entrar direto na aba Proposta (o
  // risco de pre-flight: ele é x-init de um nó dentro da tela-aportar, e
  // `x-show` não remove do DOM).
  test("sair da Proposta mata o polling", async ({ page }) => {
    let n = 0;
    await abrir(page, {
      resposta: null,
      enviadoEm: null,
      hash: "#/aportar/proposta",
      estado: estadoPendente(5000),
      aoConsultarEstado: () => {
        n += 1;
      },
    });
    await expect(page.locator(".proposta-cartao")).toBeVisible();
    await page.evaluate(() => {
      location.hash = "#aportar";
    });
    await expect(page.locator(".tela-aportar")).toBeVisible();
    const antes = n;
    await page.waitForTimeout(25_000); // > BUSCA_INTERVALO_MS (20 s)
    expect(n).toBe(antes);
  });

  // O polling existe de verdade: enquanto a tela está aberta e há pedido, o
  // app volta a perguntar. Sem este par, "mata o polling" passaria vácuo
  // num app que nunca ligou polling nenhum.
  test("na Proposta aberta, o app volta a perguntar ao Worker", async ({ page }) => {
    let n = 0;
    await abrir(page, {
      resposta: null,
      enviadoEm: null,
      hash: "#/aportar/proposta",
      estado: estadoPendente(5000),
      aoConsultarEstado: () => {
        n += 1;
      },
    });
    await expect(page.locator(".proposta-cartao")).toBeVisible();
    const antes = n;
    await page.waitForTimeout(25_000);
    expect(n).toBeGreaterThan(antes);
  });
});

test.describe("7a.CH.1 — as propostas guardadas, em acordeão", () => {
  test("as rodadas guardadas, todas fechadas, da mais nova para a mais antiga", async ({ page }) => {
    await abrir(page, { resposta: resposta(), hash: "#/aportar/proposta" });
    const itens = page.locator(".proposta-item");
    await expect(itens).toHaveCount(3); // atual + 2 do histórico (fixture sintética)
    // Decisão dele: TODAS fechadas ao abrir, inclusive a mais nova.
    await expect(page.locator('.proposta-item button[aria-expanded="true"]')).toHaveCount(0);
    await expect(itens.nth(0)).toContainText("R$ 6.000");
    await expect(itens.nth(1)).toContainText("05/11");
    await expect(itens.nth(2)).toContainText("02/11");
    await expect(itens.nth(1)).toContainText("Não passou na conferência");
    await expect(page.locator(".proposta-rodape")).toContainText("Mostra as 12 mais recentes");
  });

  test("abrir um item mostra a proposta daquela rodada, não a mais nova", async ({ page }) => {
    await abrir(page, { resposta: resposta(), hash: "#/aportar/proposta" });
    await page.locator(".proposta-item").nth(2).locator("button").click();
    const corpo = page.locator(".proposta-item").nth(2).locator(".proposta-corpo");
    await expect(corpo).toBeVisible();
    // Motivo da 3ª rodada (SOMA_DIFERENTE), não o da atual.
    await expect(corpo.locator(".comite-recusa")).toContainText("a soma não fechava");
    await expect(page.locator(".proposta-item").nth(0).locator(".proposta-corpo")).toHaveCount(0);
  });

  test("a proposta da rodada atual aparece com a tabela Comitê × Regra", async ({ page }) => {
    await abrir(page, { resposta: resposta(), hash: "#/aportar/proposta" });
    await page.locator(".proposta-item").nth(0).locator("button").click();
    const corpo = page.locator(".proposta-item").nth(0).locator(".proposta-corpo");
    await expect(corpo.locator(".comite-comparacao")).toBeVisible();
    const cabs = corpo.locator(".comite-comparacao thead th.comite-col");
    await expect(cabs).toHaveText(["Comitê", "Regra"]);
    await expect(corpo.locator(".comite-contrario")).not.toHaveText("");
    await expect(corpo.locator(".comite-mudaria")).not.toHaveText("");
  });

  test("o aviso de tese do Olho aparece dentro do item que o tem", async ({ page }) => {
    await abrir(page, {
      hash: "#/aportar/proposta",
      resposta: resposta((r) => {
        r.atual.avisos = ["A tese de AAAA3 está em dúvida: o Olho registrou queda de margem."];
      }),
    });
    await page.locator(".proposta-item").nth(0).locator("button").click();
    await expect(page.locator(".proposta-item").nth(0).locator(".comite-avisos li")).toContainText("tese de AAAA3");
  });

  // Review Focus 3: histórico acima de 12, atual nulo, rodada sem nonce.
  test("mais de 12 rodadas: corta em 12 e não repete chave", async ({ page }) => {
    const erros: string[] = [];
    await abrir(page, {
      hash: "#/aportar/proposta",
      erros,
      resposta: resposta((r) => {
        r.historico = Array.from({ length: 20 }, (_, i) => ({
          ...r.historico[0],
          nonce: "n" + i,
          criado_em: new Date(Date.UTC(2026, 9, 20 - i, 6, 40)).toISOString(),
        }));
      }),
    });
    await expect(page.locator(".proposta-item")).toHaveCount(12);
    expect(erros).toEqual([]);
  });

  test("rodada sem nonce: a data serve de chave, sem erro de console", async ({ page }) => {
    const erros: string[] = [];
    await abrir(page, {
      hash: "#/aportar/proposta",
      erros,
      resposta: resposta((r) => {
        delete r.atual.nonce;
        r.historico.forEach((h: any) => delete h.nonce);
      }),
    });
    await expect(page.locator(".proposta-item")).toHaveCount(3);
    await page.locator(".proposta-item").nth(0).locator("button").click();
    await expect(page.locator(".proposta-item").nth(0).locator(".proposta-corpo")).toBeVisible();
    expect(erros).toEqual([]);
  });

  test("atual nulo (só histórico): a lista é o histórico", async ({ page }) => {
    await abrir(page, {
      hash: "#/aportar/proposta",
      resposta: resposta((r) => {
        r.atual = null;
      }),
    });
    await expect(page.locator(".proposta-item")).toHaveCount(2);
  });

  test("sem rodada nenhuma: convida a pedir na Simulação", async ({ page }) => {
    await abrir(page, { resposta: null, hash: "#/aportar/proposta" });
    await expect(page.locator(".proposta-vazio")).toContainText("Nenhuma proposta ainda");
    await expect(page.locator(".proposta-item")).toHaveCount(0);
    await expect(page.locator(".proposta-rodape")).toHaveCount(0);
    // Visto em 25/11: o titulo da lista aparecia sobre o estado vazio.
    await expect(page.locator(".proposta-lista-tit")).toHaveCount(0);
  });

  test("a Simulação não mostra mais proposta nenhuma", async ({ page }) => {
    await abrir(page, { resposta: resposta(), hash: "#aportar" });
    // O grifo só existe com o plano montado, e o plano só monta com valor.
    await page.locator(".aporte-input").fill("6000");
    await expect(page.locator(".aporte-grifo")).toBeVisible();
    await expect(page.locator(".tela-aportar .comite-resposta")).toHaveCount(0);
    await expect(page.locator(".tela-aportar .comite-link-registros")).toHaveCount(0);
    // O grifo da tela volta a ser SEMPRE o da regra: antes a proposta o tomava
    // (comiteTomaGrifo), e o da regra virava texto comum.
    await expect(page.locator(".tela-aportar .grifo:visible")).toHaveCount(1);
    await expect(page.locator(".aporte-grifo")).toHaveClass(/\bgrifo\b/);
  });

  test("320 px: nenhum transbordo com um item aberto", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await abrir(page, { resposta: resposta(), hash: "#/aportar/proposta" });
    await page.locator(".proposta-item").nth(0).locator("button").click();
    await expect(page.locator(".proposta-corpo")).toBeVisible();
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(0);
  });

  test("o cabeçalho do item é alvo de toque de 56 px", async ({ page }) => {
    await abrir(page, { resposta: resposta(), hash: "#/aportar/proposta" });
    const h = await page.locator(".proposta-item__cab").first().evaluate((el) => el.getBoundingClientRect().height);
    expect(h).toBeGreaterThanOrEqual(56);
  });

  test("nenhum verbo de ordem na aba Proposta, com tudo aberto", async ({ page }) => {
    await abrir(page, { resposta: resposta(), hash: "#/aportar/proposta" });
    for (const i of [0, 1, 2]) await page.locator(".proposta-item").nth(i).locator("button").click();
    await expect(page.locator(".proposta-corpo")).toHaveCount(3);
    expect(await page.locator(".tela-proposta").innerText()).not.toMatch(VERBO_DE_ORDEM);
  });
});

// ── Achados do code-review-board de 25/11/2026 ────────────────────────────
test.describe("7a.CH.1 — achados do board", () => {
  // Important: comiteTextoIdade(r) chamava comiteDadoVelho() sem repassar r,
  // então o aviso "Dados velhos" de uma rodada guardada seguia a rodada ATUAL.
  test("o aviso de dados velhos é da rodada aberta, não da atual", async ({ page }) => {
    await abrir(page, {
      hash: "#/aportar/proposta",
      resposta: resposta((r) => {
        // Atual: dados frescos. Histórico[0]: dados velhos.
        r.atual.grifo_dado_velho = false;
        r.atual.idade_fontes.dias_sem_ingestao = 1;
        r.historico[0].grifo_dado_velho = true;
        r.historico[0].idade_fontes = { ...r.historico[0].idade_fontes, dias_sem_ingestao: 40 };
      }),
    });
    // A rodada ANTIGA (índice 1) é a que tem dados velhos.
    await page.locator(".proposta-item").nth(1).locator("button").click();
    const velha = page.locator(".proposta-item").nth(1).locator(".comite-idade");
    await expect(velha).toContainText("Dados velhos");
    await expect(velha).toHaveClass(/comite-dado-velho/);
    // E a ATUAL, aberta, não herda o aviso da outra.
    await page.locator(".proposta-item").nth(0).locator("button").click();
    const nova = page.locator(".proposta-item").nth(0).locator(".comite-idade");
    await expect(nova).not.toContainText("Dados velhos");
    await expect(nova).not.toHaveClass(/comite-dado-velho/);
  });

  // O inverso, que é como o bug se manifestava: atual velha, guardada fresca.
  test("rodada guardada fresca não herda o aviso da atual velha", async ({ page }) => {
    await abrir(page, {
      hash: "#/aportar/proposta",
      resposta: resposta((r) => {
        r.atual.grifo_dado_velho = true;
        r.atual.idade_fontes.dias_sem_ingestao = 40;
        r.historico[0].grifo_dado_velho = false;
        r.historico[0].idade_fontes = { ...r.historico[0].idade_fontes, dias_sem_ingestao: 1 };
      }),
    });
    await page.locator(".proposta-item").nth(1).locator("button").click();
    await expect(page.locator(".proposta-item").nth(1).locator(".comite-idade")).not.toContainText("Dados velhos");
  });

  // Parser: `comite: null` cobre mais do que reprovação na conferência.
  // Os TRÊS motivos do Set, não só um: tirar qualquer um deles tem de ficar
  // vermelho (achado da 2ª volta do board).
  for (const [motivo, noCorpo] of [
    ["SAIDA_AUSENTE", "não respondeu a tempo"],
    ["SAIDA_INVALIDA", "respondeu fora do formato"],
    ["VALIDADOR_FALHOU", "a conferência falhou por erro interno"],
  ] as const) {
    test(`rodada com ${motivo} não diz 'não passou na conferência'`, async ({ page }) => {
      await abrir(page, {
        hash: "#/aportar/proposta",
        resposta: resposta((r) => {
          r.atual.comite = null;
          r.atual.motivo_recusa = motivo;
        }),
      });
      const item = page.locator(".proposta-item").nth(0);
      await expect(item).toContainText("Não houve proposta · valeu a regra");
      await expect(item).not.toContainText("Não passou na conferência");
      // E o motivo exato continua no corpo.
      await item.locator("button").click();
      await expect(item.locator(".comite-recusa")).toContainText(noCorpo);
    });
  }

  test("recusa de verdade continua dizendo que não passou na conferência", async ({ page }) => {
    await abrir(page, {
      hash: "#/aportar/proposta",
      resposta: resposta((r) => {
        r.atual.comite = null;
        r.atual.motivo_recusa = "ACIMA_DO_TETO";
      }),
    });
    await expect(page.locator(".proposta-item").nth(0)).toContainText("Não passou na conferência");
  });

  // Parser: o Worker afirma pendente, mas a data não parseia. Afirmar
  // "nenhum pedido" ali seria o defeito de origem da fase, reencenado.
  test("pendente com data ilegível vale como na fila, não como ausência de pedido", async ({ page }) => {
    await abrir(page, {
      resposta: null,
      enviadoEm: null,
      hash: "#/aportar/proposta",
      estado: { pendente: true, recebido_em: "nao-e-data", disparado_em: null, ultima_falha: null, cifra: null },
    });
    const c = page.locator(".proposta-cartao");
    await expect(c).toHaveAttribute("data-fase", "na_fila");
    await expect(page.locator(".tela-proposta")).not.toContainText("Nenhum pedido em andamento");
    // Sem data, o passo não pode sair com o separador solto ("Pedido
    // recebido · "), e o corrente é a FILA, que é o que o Worker afirma.
    const texto = (i: number) => c.locator(".proposta-passos li").nth(i).innerText();
    expect((await texto(0)).replace(/\s+/g, " ").trim()).toMatch(/Pedido recebido$/);
    expect((await texto(3)).replace(/\s+/g, " ").trim()).toMatch(/Pronta$/);
    await expect(c.locator('li[aria-current="step"]')).toContainText("Na fila");
    // Nenhuma linha do cartão termina em separador pendurado.
    for (const linha of (await c.innerText()).split("\n")) {
      expect(linha.trim(), `linha com separador solto: ${linha}`).not.toMatch(/·$/);
    }
  });

  // SWE 2ª volta: resposta lenta de uma busca ANTIGA não pode sobrescrever o
  // que uma mais nova já gravou. Determinístico: a 1ª resposta fica presa
  // numa promise do teste, a 2ª busca é disparada e respondida, e só então a
  // 1ª é liberada com o estado velho.
  test("resposta fora de ordem não sobrescreve o estado mais novo", async ({ page }) => {
    await abrir(page, {
      resposta: null,
      enviadoEm: null,
      hash: "#/aportar/proposta",
      relogio: "2026-11-25T01:00:00Z",
      estado: estadoPendente(5000, { recebido_em: "2026-11-25T00:40:00Z" }),
    });
    await expect(page.locator(".proposta-valor")).toHaveText("R$ 5.000");

    // A rota do teste entra DEPOIS da do helper: no Playwright a última
    // registrada é a que vence.
    let liberar!: () => void;
    const presa = new Promise<void>((r) => (liberar = r));
    let n = 0;
    const corpo = (valor: number) =>
      JSON.stringify(estadoPendente(valor, { recebido_em: "2026-11-25T00:40:00Z" }));
    await page.route("**/comite/estado", async (route) => {
      n += 1;
      if (n === 1) {
        await presa; // a lenta só responde depois da rápida
        return route.fulfill({ status: 200, contentType: "application/json", body: corpo(1111) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: corpo(7777) });
    });

    const buscar = () => page.evaluate(() => (window as any).Alpine.$data(document.body)._propostaBuscarEstado());
    const lenta = buscar(); // fica presa na rota
    await expect.poll(() => n).toBe(1);
    await buscar(); // a mais nova responde na hora
    await expect(page.locator(".proposta-valor")).toHaveText("R$ 7.777");

    liberar();
    await lenta;
    // A velha chegou depois e NÃO derrubou o valor novo.
    await expect(page.locator(".proposta-valor")).toHaveText("R$ 7.777");
  });

  // SWE: chave repetida no x-for faria dois itens compartilharem o estado
  // "aberta". O backend de hoje não produz isso; o dedup tira a classe.
  test("rodada repetida no histórico não duplica item nem compartilha o aberto", async ({ page }) => {
    const erros: string[] = [];
    await abrir(page, {
      hash: "#/aportar/proposta",
      erros,
      resposta: resposta((r) => {
        // `atual` repetida dentro do histórico, mesma chave.
        r.historico = [JSON.parse(JSON.stringify(r.atual)), ...r.historico];
      }),
    });
    await expect(page.locator(".proposta-item")).toHaveCount(3);
    await page.locator(".proposta-item").nth(0).locator("button").click();
    await expect(page.locator(".proposta-corpo")).toHaveCount(1);
    expect(erros).toEqual([]);
  });
});
