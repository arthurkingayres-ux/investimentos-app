import { test, expect, Page, Route } from "@playwright/test";
import { contraste } from "./comite-comum";
import path from "path";
import fs from "fs";

// 7a.BW.5 Task 5.2: o pedido do Comitê no #aportar. O app cifra o pedido com a
// frase (aqui o segredo de teste da suíte, "123456") e faz POST em
// /comite/pedido; o Worker é falso (page.route). Fixture 100% sintética.

const FIXTURE = fs.readFileSync(
  path.join(__dirname, "../fixtures/portfolio.test.json.enc"),
  "utf-8",
);
const SEGREDO_TESTE = "123456";

test.use({ viewport: { width: 390, height: 844 } });

type Captura = { corpos: string[] };

async function abrirAportar(page: Page, opcoes: { estado?: object | null; enviadoEm?: string; tema?: "dark" } = {}) {
  await page.route("**/portfolio.json.enc", (route) =>
    route.fulfill({ status: 200, body: FIXTURE, contentType: "text/plain" }),
  );
  const estado = opcoes.estado === undefined ? null : opcoes.estado;
  await page.route("**/comite/estado", (route) =>
    estado
      ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(estado) })
      : route.fulfill({ status: 404, body: "" }),
  );
  // 7a.BW.6: com pedido recente o app também pergunta pela resposta; aqui o
  // Worker falso não tem nenhuma.
  await page.route("**/comite/resposta", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"cifra":null,"gravada_em":null}' }),
  );
  await page.addInitScript(([enviadoEm, tema]) => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem("pinTimestamp", String(Date.now() - 24 * 60 * 60 * 1000));
    if (enviadoEm) localStorage.setItem("comite:enviado_em", enviadoEm);
    if (tema) localStorage.setItem("tema", tema);
  }, [opcoes.enviadoEm ?? null, opcoes.tema ?? null] as const);
  await page.goto("/");
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => (location.hash = "#aportar"));
  await expect(page.locator(".tela-aportar")).toBeVisible();
}

function rotaPedido(page: Page, resposta: { status: number; body?: object }, captura: Captura) {
  return page.route("**/comite/pedido", async (route: Route) => {
    captura.corpos.push(route.request().postData() ?? "");
    await route.fulfill({
      status: resposta.status,
      contentType: "application/json",
      body: JSON.stringify(resposta.body ?? {}),
    });
  });
}

async function decifrarNoApp(page: Page, cifra: string) {
  return page.evaluate(
    async ([c, s]) => JSON.parse(await (window as any).decifrar(c, s)),
    [cifra, SEGREDO_TESTE],
  );
}

const bloco = (page: Page) => page.locator(".comite-bloco");
const botao = (page: Page) => page.locator(".comite-pedir");
// 7a.CH.1: o "Rodar agora" virou botao-interruptor, fora do `details`.
const agora = (page: Page) => page.locator(".aporte-agora");
const sub = (page: Page) => page.locator(".comite-pedir__sub");
const status = (page: Page) => page.locator(".comite-status");

test.describe("Comitê: o pedido no #aportar", () => {
  // 7a.CH.1: o rotulo do botao virou fixo e o valor foi para o SUBTITULO,
  // ao lado de quando a rodada acontece.
  test("o subtítulo do botão usa o valor digitado e diz quando roda", async ({ page }) => {
    await abrirAportar(page);
    await page.locator(".aporte-input").fill("6000");
    await expect(botao(page).locator(".comite-pedir__tit")).toHaveText("Pedir proposta");
    await expect(sub(page)).toHaveText("R$ 6.000 · roda às 3h30");
    await expect(botao(page)).toBeEnabled();
  });

  test("sem valor: os dois botões desabilitados, subtítulo vazio e a ajuda diz o que falta", async ({ page }) => {
    await abrirAportar(page);
    await page.locator(".aporte-input").fill("");
    await expect(botao(page)).toBeDisabled();
    await expect(agora(page)).toBeDisabled();
    await expect(sub(page)).toHaveText("");
    await expect(bloco(page)).toContainText("Digite o valor acima");
  });

  test("o interruptor 'Rodar agora' começa apagado, alterna e manda imediato", async ({ page }) => {
    const captura: Captura = { corpos: [] };
    await abrirAportar(page);
    await rotaPedido(page, { status: 202, body: { estado: "disparado" } }, captura);
    await page.locator(".aporte-input").fill("5000");
    await expect(agora(page)).toHaveAttribute("aria-pressed", "false");
    await expect(sub(page)).toHaveText("R$ 5.000 · roda às 3h30");
    await expect(bloco(page)).toContainText("O Comitê roda às 3h30.");
    await agora(page).click();
    await expect(agora(page)).toHaveAttribute("aria-pressed", "true");
    await expect(sub(page)).toHaveText("R$ 5.000 · roda já");
    await expect(bloco(page)).toContainText("a cota é a mesma");
    // Sem texto ligado/desligado no proprio interruptor: aceso/apagado ja diz
    // (decisao dele). O glifo e decorativo (aria-hidden) e sai da contagem.
    const rotulo = await agora(page).evaluate((el) =>
      Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent || "")
        .join("")
        .trim(),
    );
    expect(rotulo).toBe("Rodar agora");
    expect(await agora(page).innerText()).not.toMatch(/ligad|desligad|ativ|inativ/i);
    await botao(page).click();
    // A barreira e a navegacao: ela so acontece depois do 202, entao esperar
    // por ela garante que o POST ja foi capturado.
    await expect(page.locator(".tela-proposta")).toBeVisible();
    const { imediato } = JSON.parse(captura.corpos[0]);
    expect(imediato).toBe(true);
  });

  test("recarregar volta o interruptor para apagado", async ({ page }) => {
    await abrirAportar(page);
    await page.locator(".aporte-input").fill("5000");
    await agora(page).click();
    await expect(agora(page)).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(page.locator(".tela-aportar")).toBeVisible({ timeout: 10_000 });
    await expect(agora(page)).toHaveAttribute("aria-pressed", "false");
  });

  // Review Focus 5: aceso e depois zerado.
  test("aceso e depois zerado: desabilita os dois sem enviar nada", async ({ page }) => {
    const captura: Captura = { corpos: [] };
    await abrirAportar(page);
    await rotaPedido(page, { status: 202, body: { estado: "na_fila" } }, captura);
    await page.locator(".aporte-input").fill("5000");
    await agora(page).click();
    await page.locator(".aporte-chip--zero").click();
    await expect(botao(page)).toBeDisabled();
    await expect(agora(page)).toBeDisabled();
    expect(captura.corpos).toEqual([]);
  });

  test("202: o app vai para a aba Proposta", async ({ page }) => {
    const captura: Captura = { corpos: [] };
    await abrirAportar(page);
    await rotaPedido(page, { status: 202, body: { estado: "na_fila" } }, captura);
    await page.locator(".aporte-input").fill("5000");
    await botao(page).click();
    await expect(page.locator(".tela-proposta")).toBeVisible();
    expect(await page.evaluate(() => location.hash)).toBe("#/aportar/proposta");
  });

  test("falha de envio fica na Simulação, com a mensagem e o reenviar", async ({ page }) => {
    const captura: Captura = { corpos: [] };
    await abrirAportar(page);
    await rotaPedido(page, { status: 500 }, captura);
    await page.locator(".aporte-input").fill("5000");
    await botao(page).click();
    await expect(status(page)).toContainText("erro 500");
    await expect(page.locator(".comite-reenviar")).toBeVisible();
    await expect(page.locator(".tela-aportar")).toBeVisible();
    expect(await page.evaluate(() => location.hash)).toBe("#aportar");
  });

  test("'Remessa e nota' continua, recolhido, e sem 'horário' no rótulo", async ({ page }) => {
    await abrirAportar(page);
    await expect(page.locator(".comite-opcoes summary")).toHaveText("Remessa e nota");
    expect(await page.locator("details.comite-opcoes").evaluate((el: HTMLDetailsElement) => el.open)).toBe(false);
    await expect(page.locator("#comite-agora")).toHaveCount(0);
  });

  // §5.5: o contraste do texto escuro sobre ambar e do cinza sobre branco
  // >= 4,5:1. O construtor MEDE; nao passando, escurece o token.
  for (const tema of ["claro", "Plantao"] as const) {
    test(`${tema}: o texto dos dois botões passa AA nos dois estados do interruptor`, async ({ page }) => {
      await abrirAportar(page, { tema: tema === "Plantao" ? "dark" : undefined });
      await page.locator(".aporte-input").fill("5000");
      const medir = () =>
        page.evaluate(() => {
          const fundo = (el: Element | null): string => {
            while (el) {
              const b = getComputedStyle(el).backgroundColor;
              if (b && b !== "transparent" && !/rgba\(.*,\s*0\)$/.test(b)) return b;
              el = el.parentElement;
            }
            return getComputedStyle(document.body).backgroundColor;
          };
          const out: { t: string; c: string; b: string }[] = [];
          for (const sel of [".aporte-agora", ".comite-pedir__tit", ".comite-pedir__sub", ".comite-ajuda-pedido"]) {
            const el = document.querySelector(sel);
            if (!el || el.getClientRects().length === 0) continue;
            out.push({ t: sel, c: getComputedStyle(el).color, b: fundo(el) });
          }
          return out;
        });
      for (const estado of ["apagado", "aceso"] as const) {
        if (estado === "aceso") {
          await agora(page).click();
          // O interruptor tem transicao de 150 ms em color/background: ler
          // getComputedStyle logo depois do clique devolve o frame INICIAL,
          // isto e, as cores do estado anterior. Medido em 25/11/2026: sem
          // esta espera o teste passava mesmo com texto claro sobre ambar.
          // `toHaveCSS` repete ate casar, que e a barreira certa.
          await expect(agora(page)).toHaveCSS("background-color", "rgb(245, 158, 11)");
        }
        const medidos = await medir();
        // Sem isto o teste passaria VACUO se um seletor deixasse de casar.
        expect(medidos.map((m) => m.t)).toEqual([".aporte-agora", ".comite-pedir__tit", ".comite-pedir__sub", ".comite-ajuda-pedido"]);
        for (const m of medidos) {
          expect(contraste(m.c, m.b), `${estado} ${m.t}: ${m.c} sobre ${m.b}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }

  // O estado do interruptor sai por FORMA, nao so por cor: borda tracejada x
  // continua, raio 10 px x pilula, e o raio vazado x cheio. A verificacao
  // visual de 25/11 pegou o que nenhum teste pegava -- o glifo era um emoji
  // colorido, identico nos dois estados.
  test("o estado do interruptor tem sinal de forma, não só de cor", async ({ page }) => {
    await abrirAportar(page);
    await page.locator(".aporte-input").fill("5000");
    const ler = () =>
      page.evaluate(() => {
        const b = document.querySelector(".aporte-agora") as HTMLElement;
        const i = document.querySelector(".aporte-agora__ico") as SVGElement;
        return {
          borda: getComputedStyle(b).borderTopStyle,
          raio: getComputedStyle(b).borderTopLeftRadius,
          fill: getComputedStyle(i).fill,
        };
      });
    const apagado = await ler();
    await agora(page).click();
    await expect(agora(page)).toHaveCSS("background-color", "rgb(245, 158, 11)");
    const aceso = await ler();
    expect(apagado.borda).toBe("dashed");
    expect(aceso.borda).toBe("solid");
    expect(apagado.raio).not.toBe(aceso.raio);
    expect(apagado.fill).toBe("none");
    expect(aceso.fill).not.toBe("none");
  });

  test("os dois botões têm alvo de toque de 60 px e a linha é 2 por 3", async ({ page }) => {
    await abrirAportar(page);
    await page.locator(".aporte-input").fill("5000");
    const [a, b] = await Promise.all([
      agora(page).evaluate((el) => el.getBoundingClientRect()),
      botao(page).evaluate((el) => el.getBoundingClientRect()),
    ]);
    expect(a.height).toBeGreaterThanOrEqual(60);
    expect(b.height).toBeGreaterThanOrEqual(60);
    // 2 de 5 contra 3 de 5, com folga de medicao.
    expect(b.width / a.width).toBeGreaterThan(1.2);
    // Folga entre eles: em grid o que falha e a folga, nao o transbordo.
    expect(b.left - a.right).toBeGreaterThanOrEqual(6);
  });

  test("um toque envia, sem modal: corpo cifrado com a frase, valor fora do claro", async ({ page }) => {
    const captura: Captura = { corpos: [] };
    await abrirAportar(page);
    await rotaPedido(page, { status: 202, body: { estado: "na_fila" } }, captura);
    await page.locator(".aporte-input").fill("6000");
    let dialogo = false;
    page.on("dialog", () => (dialogo = true));
    await botao(page).click();
    await expect(status(page)).toHaveText("Pedido na fila; resposta até amanhã às 7h.");
    expect(dialogo).toBe(false);
    expect(captura.corpos).toHaveLength(1);
    const corpo = captura.corpos[0];
    expect(corpo).not.toContain("6000");
    expect(corpo).not.toContain("6.000");
    const { cifra, imediato } = JSON.parse(corpo);
    expect(imediato).toBe(false);
    const pedido = await decifrarNoApp(page, cifra);
    expect(pedido.v).toBe(1);
    expect(pedido.valor_brl).toBe(6000);
    expect(pedido.remetido_usd).toBeNull();
    expect(pedido.nota).toBeNull();
    expect(pedido.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(await page.evaluate(() => localStorage.getItem("comite:enviado_em"))).not.toBeNull();
    expect(Math.abs(Date.parse(pedido.criado_em) - Date.now())).toBeLessThan(60_000);
  });

  test("campos opcionais recolhidos: remessa, nota e rodar agora entram no pedido", async ({ page }) => {
    const captura: Captura = { corpos: [] };
    await abrirAportar(page);
    await rotaPedido(page, { status: 202, body: { estado: "disparado" } }, captura);
    await page.locator(".aporte-input").fill("6000");
    await expect(page.locator("#comite-remetido")).toBeHidden();
    await page.locator(".comite-opcoes summary").click();
    await page.locator("#comite-remetido").fill("300,50");
    await page.locator("#comite-nota").fill("Priorizar Brasil este mês");
    await agora(page).click(); // 7a.CH.1: o "rodar agora" e o interruptor, fora do details
    await botao(page).click();
    await expect(status(page)).toHaveText("O Comitê está rodando agora; a resposta chega em alguns minutos.");
    const { cifra, imediato } = JSON.parse(captura.corpos[0]);
    expect(imediato).toBe(true);
    const pedido = await decifrarNoApp(page, cifra);
    expect(pedido.remetido_usd).toBe(300.5);
    expect(pedido.nota).toBe("Priorizar Brasil este mês");
  });

  test("nota acima de 280 caracteres é barrada no campo", async ({ page }) => {
    await abrirAportar(page);
    await page.locator(".comite-opcoes summary").click();
    await page.locator("#comite-nota").fill("x".repeat(300));
    await expect(page.locator("#comite-nota")).toHaveValue("x".repeat(280));
    await expect(bloco(page)).toContainText("280/280");
  });

  test("sem conexão: não envia, guarda o pedido, e o rascunho sobrevive a recarregar", async ({ page, context }) => {
    let tentativas = 0;
    await abrirAportar(page);
    await page.route("**/comite/pedido", (route) => {
      tentativas++;
      return route.abort("internetdisconnected");
    });
    await page.locator(".aporte-input").fill("6000");
    await context.setOffline(true);
    await botao(page).click();
    await expect(status(page)).toContainText("Sem conexão; guardei o pedido.");
    expect(tentativas).toBe(0);
    await context.setOffline(false);
    // A rede "volta" mas o POST continua falhando: o rascunho fica.
    await expect(status(page)).toContainText("Sem conexão; guardei o pedido.");

    // O hash continua #aportar: o app reabre direto nesta tela.
    await page.reload();
    await expect(page.locator(".tela-aportar")).toBeVisible({ timeout: 10_000 });
    await expect(status(page)).toContainText("Sem conexão; guardei o pedido.");

    const captura: Captura = { corpos: [] };
    await page.unroute("**/comite/pedido");
    await rotaPedido(page, { status: 202, body: { estado: "na_fila" } }, captura);
    await page.locator(".comite-reenviar").click();
    await expect(status(page)).toHaveText("Pedido na fila; resposta até amanhã às 7h.");
    expect(captura.corpos).toHaveLength(1);
    const pedido = await decifrarNoApp(page, JSON.parse(captura.corpos[0]).cifra);
    expect(pedido.valor_brl).toBe(6000);
    expect(await page.evaluate(() => localStorage.getItem("comite:rascunho"))).toBeNull();
  });

  test("dois eventos 'online' seguidos com rascunho: um POST só", async ({ page }) => {
    await abrirAportar(page);
    let posts = 0;
    await page.route("**/comite/pedido", async (route) => {
      posts++;
      await new Promise((ok) => setTimeout(ok, 300));
      await route.fulfill({ status: 202, contentType: "application/json", body: '{"estado":"na_fila"}' });
    });
    await page.evaluate(() =>
      localStorage.setItem(
        "comite:rascunho",
        JSON.stringify({ cifra: "QUJD", imediato: false, criado_em: new Date().toISOString() }),
      ),
    );
    await page.evaluate(() => {
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("online"));
    });
    await expect(status(page)).toHaveText("Pedido na fila; resposta até amanhã às 7h.");
    expect(posts).toBe(1);
  });

  test("valor acima de R$ 1.000.000: não envia e diz o teto", async ({ page }) => {
    const captura: Captura = { corpos: [] };
    await abrirAportar(page);
    await rotaPedido(page, { status: 202, body: { estado: "na_fila" } }, captura);
    await page.locator(".aporte-input").fill("1000001");
    await botao(page).click();
    await expect(bloco(page)).toContainText("até R$ 1.000.000");
    expect(captura.corpos).toHaveLength(0);
  });

  test("429: diz que o limite do dia acabou", async ({ page }) => {
    const captura: Captura = { corpos: [] };
    await abrirAportar(page);
    await rotaPedido(page, { status: 429, body: { erro: "limite diario" } }, captura);
    await page.locator(".aporte-input").fill("6000");
    await botao(page).click();
    await expect(status(page)).toContainText("Limite de 3 pedidos por dia");
  });

  test("login expirado (401): pede para entrar de novo e guarda o pedido", async ({ page }) => {
    const captura: Captura = { corpos: [] };
    await abrirAportar(page);
    await rotaPedido(page, { status: 401, body: { erro: "acesso negado" } }, captura);
    await page.locator(".aporte-input").fill("6000");
    await botao(page).click();
    await expect(status(page)).toContainText("O login do app expirou");
    await expect(page.locator(".comite-reenviar")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("comite:rascunho"))).not.toBeNull();
  });

  test("erro do servidor: mostra o código e oferece tentar de novo", async ({ page }) => {
    const captura: Captura = { corpos: [] };
    await abrirAportar(page);
    await rotaPedido(page, { status: 500 }, captura);
    await page.locator(".aporte-input").fill("6000");
    await botao(page).click();
    await expect(status(page)).toContainText("erro 500");
    await expect(page.locator(".comite-reenviar")).toHaveText("Tentar de novo");
  });

  test("ao abrir, um pedido deste aparelho já na fila aparece como na fila", async ({ page }) => {
    await abrirAportar(page, {
      estado: { pendente: true, recebido_em: new Date().toISOString(), disparado_em: null, ultima_falha: null },
      enviadoEm: new Date().toISOString(),
    });
    await expect(status(page)).toHaveText("Pedido na fila; resposta até amanhã às 7h.");
  });

  test("sem pedido recente deste aparelho, o app não pergunta o estado ao Worker", async ({ page }) => {
    let consultas = 0;
    page.on("request", (r) => {
      if (r.url().includes("/comite/estado")) consultas++;
    });
    await abrirAportar(page, {
      estado: { pendente: true, recebido_em: new Date().toISOString(), disparado_em: null, ultima_falha: null },
      enviadoEm: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString(),
    });
    await page.waitForTimeout(500);
    expect(consultas).toBe(0);
    await expect(status(page)).toHaveText("");
  });

  test("bloquear a sessão limpa a nota e a remessa digitadas", async ({ page }) => {
    await abrirAportar(page);
    await page.locator(".comite-opcoes summary").click();
    await page.locator("#comite-remetido").fill("300");
    await page.locator("#comite-nota").fill("nota digitada");
    const limpo = await page.evaluate(() => {
      const raiz = (window as any).Alpine.$data(document.body);
      raiz._limparEstadoSensivel();
      return { nota: raiz.comiteNota, remetido: raiz.comiteRemetido, estado: raiz.comiteEstado };
    });
    expect(limpo).toEqual({ nota: "", remetido: "", estado: "vazio" });
  });

  test("320 px: sem rolagem horizontal com as opções abertas", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await abrirAportar(page);
    await page.locator(".aporte-input").fill("123456");
    await page.locator(".comite-opcoes summary").click();
    await bloco(page).scrollIntoViewIfNeeded();
    const larg = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      vp: document.documentElement.clientWidth,
      bloco: document.querySelector(".comite-bloco")!.getBoundingClientRect().right,
    }));
    expect(larg.doc).toBeLessThanOrEqual(larg.vp);
    expect(larg.bloco).toBeLessThanOrEqual(larg.vp);
    const alvo = await botao(page).boundingBox();
    expect(alvo!.height).toBeGreaterThanOrEqual(44);
  });

  test("foco visível no botão pelo teclado", async ({ page }) => {
    await abrirAportar(page);
    await page.locator(".aporte-input").fill("6000");
    await botao(page).focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(botao(page)).toBeFocused();
    const outline = await botao(page).evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe("none");
  });

  test("o status é anunciado (aria-live polite)", async ({ page }) => {
    await abrirAportar(page);
    await expect(status(page)).toHaveAttribute("aria-live", "polite");
  });
});
