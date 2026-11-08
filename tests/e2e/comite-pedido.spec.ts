import { test, expect, Page, Route } from "@playwright/test";
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

async function abrirAportar(page: Page, opcoes: { estado?: object | null; enviadoEm?: string } = {}) {
  await page.route("**/portfolio.json.enc", (route) =>
    route.fulfill({ status: 200, body: FIXTURE, contentType: "text/plain" }),
  );
  const estado = opcoes.estado === undefined ? null : opcoes.estado;
  await page.route("**/comite/estado", (route) =>
    estado
      ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(estado) })
      : route.fulfill({ status: 404, body: "" }),
  );
  await page.addInitScript((enviadoEm) => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem("pinTimestamp", String(Date.now() - 24 * 60 * 60 * 1000));
    if (enviadoEm) localStorage.setItem("comite:enviado_em", enviadoEm);
  }, opcoes.enviadoEm ?? null);
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
const status = (page: Page) => page.locator(".comite-status");

test.describe("Comitê: o pedido no #aportar", () => {
  test("o botão usa o valor digitado no #aportar", async ({ page }) => {
    await abrirAportar(page);
    await page.locator(".aporte-input").fill("6000");
    await expect(botao(page)).toHaveText("Pedir proposta para R$ 6.000");
    await expect(botao(page)).toBeEnabled();
  });

  test("sem valor, o botão fica desabilitado e diz o que falta", async ({ page }) => {
    await abrirAportar(page);
    await page.locator(".aporte-input").fill("");
    await expect(botao(page)).toBeDisabled();
    await expect(bloco(page)).toContainText("Digite o valor acima");
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
    await page.locator("#comite-agora").check();
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
