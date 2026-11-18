import { test, expect, Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { cifrar, contraste } from "./comite-comum";
import { semTransbordo } from "./olho-comum";

// 7a.BZ.2 Task 2.3: a reserva no Raio-X (spec 7a.BZ §4.4). Payload SINTÉTICO
// (valores inventados), cifrado na hora com o segredo de teste; GET /reserva é
// falso (page.route). O bloco fica fora do hero, diz que não é carteira, traz a
// data da leitura e a origem "Open Finance", e nunca é somado a nada.

test.use({ viewport: { width: 320, height: 640 } });

const PORTFOLIO = fs.readFileSync(path.join(__dirname, "../fixtures/portfolio.test.json.enc"), "utf-8");
const HORA = 3600 * 1000;

function iso(msAtras: number): string {
  return new Date(Date.now() - msAtras).toISOString().replace(/\.\d{3}Z$/, "Z");
}
// dd/mm na hora local do navegador (a mesma conta da tela).
async function ddmmNaPagina(page: Page, isoStr: string): Promise<string> {
  return page.evaluate((s) => {
    const d = new Date(Date.parse(s));
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  }, isoStr);
}

function payload(mudar?: (p: any) => void): any {
  const p: any = {
    versao: 1,
    lido_em: iso(2 * HORA),
    atualizado_pelo_banco_em: iso(5 * HORA),
    status_item: "UPDATED",
    execucao_item: "SUCCESS",
    total: 12345.67,
    n_posicoes: 7,
    n_sem_saldo: 0,
  };
  if (mudar) mudar(p);
  return p;
}

type Abrir = {
  payload?: any | null; // null = KV sem a chave (cifra null)
  status?: number; // status HTTP de GET /reserva (padrão 200)
  tema?: "dark" | null;
  erros?: string[];
  semRota?: boolean; // não intercepta /reserva (vale o stub da raiz)
};

async function abrir(page: Page, o: Abrir = {}) {
  await page.route("**/portfolio.json.enc", (r) => r.fulfill({ status: 200, body: PORTFOLIO, contentType: "text/plain" }));
  if (!o.semRota) {
    const p = o.payload === undefined ? payload() : o.payload;
    const corpo = p ? { cifra: cifrar(JSON.stringify(p)), gravada_em: iso(HORA) } : { cifra: null, gravada_em: null };
    await page.route("**/reserva", (route) =>
      route.fulfill({
        status: o.status ?? 200,
        contentType: "application/json",
        body: (o.status ?? 200) === 200 ? JSON.stringify(corpo) : "",
      }),
    );
  }
  if (o.erros) {
    const erros = o.erros;
    page.on("pageerror", (e) => erros.push("pageerror: " + e.message));
    page.on("console", (m) => {
      if (m.type() === "error" || m.text().includes("Alpine Expression Error")) erros.push("console: " + m.text());
    });
  }
  await page.addInitScript((tema) => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem("pinTimestamp", String(Date.now() - 24 * 60 * 60 * 1000));
    if (tema) localStorage.setItem("tema", tema);
  }, o.tema ?? null);
  await page.goto("/#/raiox/reserva");
  await expect(page.locator(".tela-reserva")).toBeVisible({ timeout: 10_000 });
}

// 7a.CC.2: reserva e conferência vivem em Raio-X › Reserva; o hero, o aporte e o
// "Bloquear sessão" ficam no Hoje. Navegação no mesmo documento (sessão intacta).
async function irAoHoje(page: Page) {
  await page.evaluate(() => { location.hash = "#"; });
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
}

const texto = async (page: Page, sel: string) => (await page.locator(sel).innerText()).replace(/\s+/g, " ").trim();

for (const tema of [null, "dark"] as const) {
  const nome = tema ? "Plantão" : "claro";

  test(`[${nome}] com payload: visível ao abrir sem toque, BRL, data da leitura e "Open Finance"`, async ({ page }) => {
    const erros: string[] = [];
    const p = payload();
    await abrir(page, { payload: p, tema, erros });
    const bloco = page.getByTestId("reserva");
    await expect(page.getByTestId("reserva-valor")).toHaveText(/R\$\s12\.345,67/, { timeout: 10_000 });
    // Sem toque e sem rolagem: dentro da primeira tela a 320 px.
    await expect(bloco).toBeInViewport({ ratio: 1 });
    await expect(bloco.locator(".reserva__titulo")).toHaveText("Reserva");
    await expect(bloco.locator(".reserva__fora")).toHaveText("Fora da carteira de aposentadoria");
    await expect(page.getByTestId("reserva-fonte")).toHaveText(`Lida em ${await ddmmNaPagina(page, p.lido_em)} pelo Open Finance`);
    await expect(page.getByTestId("reserva-fonte")).not.toHaveClass(/is-desatualizada/);
    await expect(page.getByTestId("reserva-sem-saldo")).toHaveCount(0);
    // O texto inteiro do bloco é só o que a spec manda: rótulo, valor, "fora da
    // carteira", data e origem. Nenhum nome de instituição entra no código público.
    expect(await texto(page, '[data-testid="reserva"]')).toBe(
      `Reserva R$ 12.345,67 Fora da carteira de aposentadoria Lida em ${await ddmmNaPagina(page, p.lido_em)} pelo Open Finance`,
    );
    await semTransbordo(page, '[data-testid="reserva"]');
    // Contraste AA do valor e das linhas de apoio contra o fundo.
    const cores = await bloco.evaluate((el) => {
      const cor = (s: string) => getComputedStyle(el.querySelector(s)!).color;
      return { valor: cor(".reserva__valor"), fora: cor(".reserva__fora"), fundo: getComputedStyle(document.body).backgroundColor };
    });
    expect(contraste(cores.valor, cores.fundo)).toBeGreaterThanOrEqual(4.5);
    expect(contraste(cores.fora, cores.fundo)).toBeGreaterThanOrEqual(4.5);
    expect(erros).toEqual([]);
  });

  test(`[${nome}] desatualizada: palavra escrita e cor de aviso`, async ({ page }) => {
    const p = payload((x) => {
      x.lido_em = iso(49 * HORA);
      x.atualizado_pelo_banco_em = iso(50 * HORA);
    });
    await abrir(page, { payload: p, tema });
    const fonte = page.getByTestId("reserva-fonte");
    await expect(fonte).toHaveText(`Desatualizada: lida em ${await ddmmNaPagina(page, p.lido_em)} pelo Open Finance`, { timeout: 10_000 });
    await expect(fonte).toHaveClass(/is-desatualizada/);
    const cores = await fonte.evaluate((el) => ({
      txt: getComputedStyle(el).color,
      fundo: getComputedStyle(document.body).backgroundColor,
    }));
    expect(contraste(cores.txt, cores.fundo)).toBeGreaterThanOrEqual(4.5);
    await semTransbordo(page, '[data-testid="reserva"]');
  });
}

test.describe("Reserva: quando é desatualizada", () => {
  const casos: [string, (p: any) => void][] = [
    ["leitura com mais de 48 h", (p) => { p.lido_em = iso(49 * HORA); }],
    ["banco sem atualizar há mais de 48 h", (p) => { p.atualizado_pelo_banco_em = iso(49 * HORA); }],
    ["banco sem data de atualização", (p) => { p.atualizado_pelo_banco_em = null; }],
    ["status do item fora de UPDATED", (p) => { p.status_item = "LOGIN_ERROR"; }],
    ["execução que não foi SUCCESS", (p) => { p.execucao_item = "PARTIAL_SUCCESS"; }],
  ];
  for (const [nome, mudar] of casos) {
    test(nome, async ({ page }) => {
      await abrir(page, { payload: payload(mudar) });
      await expect(page.getByTestId("reserva-fonte")).toHaveText(/^Desatualizada: lida em \d{2}\/\d{2} pelo Open Finance$/, { timeout: 10_000 });
    });
  }

  test("47 h e execução ausente (payload antigo) ainda estão em dia", async ({ page }) => {
    await abrir(page, {
      payload: payload((p) => {
        p.lido_em = iso(47 * HORA);
        p.atualizado_pelo_banco_em = iso(47 * HORA);
        delete p.execucao_item;
      }),
    });
    await expect(page.getByTestId("reserva-fonte")).toHaveText(/^Lida em \d{2}\/\d{2} pelo Open Finance$/, { timeout: 10_000 });
  });
});

test.describe("Reserva: indisponível sem quebrar a tela", () => {
  const casos: [string, Abrir][] = [
    ["404 em /reserva", { status: 404 }],
    ["500 em /reserva", { status: 500 }],
    ["KV sem a chave (cifra null)", { payload: null }],
    ["stub local da suíte (sem interceptar)", { semRota: true }],
    ["payload sem posição nenhuma", { payload: payload((p) => { p.n_posicoes = 0; p.total = 0; }) }],
    ["payload de versão desconhecida", { payload: payload((p) => { p.versao = 2; }) }],
  ];
  for (const [nome, o] of casos) {
    test(nome, async ({ page }) => {
      const erros: string[] = [];
      await abrir(page, { ...o, erros: o.status ? undefined : erros });
      const valor = page.getByTestId("reserva-valor");
      await expect(valor).toHaveText("indisponível", { timeout: 10_000 });
      await expect(page.getByTestId("reserva")).toContainText("Reserva");
      await expect(page.getByTestId("reserva")).toContainText("Fora da carteira de aposentadoria");
      await expect(page.getByTestId("reserva-fonte")).toHaveCount(0);
      // O resto do Raio-X (no Hoje) segue de pé.
      await irAoHoje(page);
      await expect(page.locator("#hero-patrimonio")).toHaveText(/R\$/);
      await expect(page.locator(".aporte-bloco")).toBeVisible();
      expect(erros).toEqual([]);
    });
  }
});

test("aplicação sem saldo: o total fica e a tela diz quantas ficaram fora da soma", async ({ page }) => {
  await abrir(page, { payload: payload((p) => { p.n_sem_saldo = 2; }) });
  await expect(page.getByTestId("reserva-sem-saldo")).toHaveText("2 aplicações vieram sem saldo e ficaram fora da soma.", { timeout: 10_000 });
  await expect(page.getByTestId("reserva-valor")).toHaveText(/R\$\s12\.345,67/);
});

test("nunca somada: o patrimônio do hero é idêntico com e sem reserva", async ({ page, browser }) => {
  await abrir(page, { payload: null });
  await expect(page.getByTestId("reserva-valor")).toHaveText("indisponível", { timeout: 10_000 });

  const ctx = await browser.newContext({ viewport: { width: 320, height: 640 } });
  const outra = await ctx.newPage();
  await abrir(outra, { payload: payload((p) => { p.total = 99999.99; }) });
  await expect(outra.getByTestId("reserva-valor")).toHaveText(/R\$\s99\.999,99/, { timeout: 10_000 });
  await irAoHoje(page);
  await irAoHoje(outra);
  // Todas as facetas do hero, uma a uma, iguais nas duas páginas.
  for (let i = 0; i < 4; i++) {
    await page.locator(".fd").nth(i).click();
    await outra.locator(".fd").nth(i).click();
    await expect(page.locator("#hero-body .hero-face.on")).toHaveCount(1);
    await expect(outra.locator("#hero-body .hero-face.on")).toHaveCount(1);
    // Poll: a 1ª faceta pode ainda estar no count-up ao entrar no Hoje.
    await expect.poll(async () => (await outra.locator("#hero-body .hero-face.on").innerText())
      === (await page.locator("#hero-body .hero-face.on").innerText())).toBe(true);
  }
  // De volta à faceta 0: o count-up já rodou nesta sessão, o valor sai inteiro.
  await page.locator(".fd").nth(0).click();
  await outra.locator(".fd").nth(0).click();
  const final = await page.locator("#hero-patrimonio").innerText();
  expect(final).toMatch(/^R\$\s[\d.]+,\d{2}$/);
  await expect(outra.locator("#hero-patrimonio")).toHaveText(final);
  await ctx.close();
});

test("fora do hero do patrimônio: tem tela própria e o Hoje não a traz", async ({ page }) => {
  await abrir(page);
  const bloco = page.getByTestId("reserva");
  await expect(page.getByTestId("reserva-valor")).toHaveText(/R\$/, { timeout: 10_000 });
  expect(await bloco.evaluate((el) => el.closest("#hero") === null && !el.querySelector("#hero")
    && el.closest(".tela-reserva") !== null && el.closest(".raiox") === null)).toBe(true);
  // Não é controle: nenhum link, botão ou foco dentro do bloco.
  await expect(bloco.locator("a, button, [tabindex]")).toHaveCount(0);
  await irAoHoje(page);
  await expect(page.locator('.raiox [data-testid="reserva"]')).toHaveCount(0);
});

const dadosAlpine = (page: Page) =>
  page.evaluate(() => {
    const raiz = document.querySelector("[x-data]") as any;
    const d = (window as any).Alpine.$data(raiz);
    return { reserva: d.reserva, estado: d.reservaEstado };
  });

test("busca em voo durante o bloqueio: a resposta que chega depois não grava nada", async ({ page }) => {
  let soltar!: () => void;
  const segura = new Promise<void>((ok) => (soltar = ok));
  let pedido!: () => void;
  const pediu = new Promise<void>((ok) => (pedido = ok));
  const corpo = JSON.stringify({ cifra: cifrar(JSON.stringify(payload())), gravada_em: iso(HORA) });
  await page.route("**/reserva", async (route) => {
    pedido();
    await segura;
    await route.fulfill({ status: 200, contentType: "application/json", body: corpo }).catch(() => {});
  });
  await abrir(page, { semRota: true });
  await pediu;
  await irAoHoje(page);
  await page.locator(".btn-bloquear").click();
  soltar();
  // Dá tempo à resposta chegar e à decifra (PBKDF2) terminar.
  await page.waitForTimeout(3000);
  expect((await dadosAlpine(page)).reserva).toBeNull();
});

test("ao voltar ao app, busca de novo: a leitura nova reavalia a marca de desatualizada", async ({ page }) => {
  let atual = payload();
  await page.route("**/reserva", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ cifra: cifrar(JSON.stringify(atual)), gravada_em: iso(HORA) }),
    }),
  );
  await abrir(page, { semRota: true });
  const fonte = page.getByTestId("reserva-fonte");
  await expect(fonte).toHaveText(/^Lida em/, { timeout: 10_000 });
  atual = payload((p) => { p.lido_em = iso(50 * HORA); });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(fonte).toHaveText(/^Desatualizada: lida em/, { timeout: 10_000 });
});

test("bloquear a sessão apaga a reserva da memória", async ({ page }) => {
  await abrir(page);
  await expect(page.getByTestId("reserva-valor")).toHaveText(/R\$/, { timeout: 10_000 });
  await irAoHoje(page);
  await page.locator(".btn-bloquear").click();
  const claro = await page.evaluate(() => {
    const raiz = document.querySelector("[x-data]") as any;
    const dados = raiz && (window as any).Alpine ? (window as any).Alpine.$data(raiz) : null;
    return dados ? dados.reserva : "sem-alpine";
  });
  expect(claro).toBeNull();
});
