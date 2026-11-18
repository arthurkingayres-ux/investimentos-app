import { test, expect, Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { cifrar, contraste } from "./comite-comum";
import { semTransbordo } from "./olho-comum";

// 7a.BZ.3 Task 3.3: as notas pendentes no Raio-X (spec 7a.BZ §4.5). Payload
// SINTÉTICO (tickers fictícios), cifrado na hora com o segredo de teste;
// GET /conferencia e GET /reserva são falsos (page.route). O bloco só existe com
// item, fica logo abaixo da reserva, fora do hero, diz a data da conferência e
// a origem "Open Finance", e não nomeia instituição nenhuma.

test.use({ viewport: { width: 320, height: 640 } });

const PORTFOLIO = fs.readFileSync(path.join(__dirname, "../fixtures/portfolio.test.json.enc"), "utf-8");
const HORA = 3600 * 1000;

function iso(msAtras: number): string {
  return new Date(Date.now() - msAtras).toISOString().replace(/\.\d{3}Z$/, "Z");
}
async function ddmmNaPagina(page: Page, isoStr: string): Promise<string> {
  return page.evaluate((s) => {
    const d = new Date(Date.parse(s));
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  }, isoStr);
}

const UM = [{ tipo: "operacao", data: "2026-10-17", ticker: "AAAA3", lado: "Compra" }];
const QUATRO = [
  { tipo: "operacao", data: "2026-10-17", ticker: "AAAA3", lado: "Compra" },
  { tipo: "posicao", ticker: "BBBB4" },
  { tipo: "operacao", data: "2026-10-09", ticker: "CCCC11", lado: "Venda" },
  { tipo: "operacao", data: "2026-09-30", ticker: "DDDD34", lado: "Compra" },
];

function payload(itens: any[] = QUATRO, mudar?: (p: any) => void): any {
  const p: any = { versao: 1, lido_em: iso(2 * HORA), itens };
  if (mudar) mudar(p);
  return p;
}
const RESERVA = {
  versao: 1, lido_em: iso(2 * HORA), atualizado_pelo_banco_em: iso(5 * HORA),
  status_item: "UPDATED", execucao_item: "SUCCESS", total: 12345.67, n_posicoes: 7, n_sem_saldo: 0,
};

type Abrir = {
  payload?: any | null; // null = KV sem a chave (cifra null)
  status?: number; // status HTTP de GET /conferencia (padrão 200)
  tema?: "dark" | null;
  erros?: string[];
  semRota?: boolean;
};

async function abrir(page: Page, o: Abrir = {}) {
  await page.route("**/portfolio.json.enc", (r) => r.fulfill({ status: 200, body: PORTFOLIO, contentType: "text/plain" }));
  await page.route("**/reserva", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cifra: cifrar(JSON.stringify(RESERVA)), gravada_em: iso(HORA) }) }),
  );
  if (!o.semRota) {
    const p = o.payload === undefined ? payload() : o.payload;
    const corpo = p ? { cifra: cifrar(JSON.stringify(p)), gravada_em: iso(HORA) } : { cifra: null, gravada_em: null };
    const status = o.status ?? 200;
    await page.route("**/conferencia", (route) =>
      route.fulfill({ status, contentType: "application/json", body: status === 200 ? JSON.stringify(corpo) : "" }),
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
  // A reserva chega por outra busca: com ela pronta, a conferência já teve a vez dela.
  await expect(page.getByTestId("reserva-valor")).toHaveText(/R\$/, { timeout: 10_000 });
}

// 7a.CC.2: reserva e conferência vivem em Raio-X › Reserva; o hero, o aporte e o
// "Bloquear sessão" ficam no Hoje. Navegação no mesmo documento (sessão intacta).
async function irAoHoje(page: Page) {
  await page.evaluate(() => { location.hash = "#"; });
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
}

const texto = async (page: Page, sel: string) => (await page.locator(sel).innerText()).replace(/\s+/g, " ").trim();

// Espera a busca da conferência terminar (decifrada, recusada ou com erro)
// antes de afirmar que o bloco não existe: sem isto, "ausente" passaria vácuo.
// Sem relógio: aguarda a promise da última busca do mixin. Se a busca não
// resolve (rota pendurada), estoura o tempo em vez de passar.
async function conferenciaResolvida(page: Page, limiteMs = 10_000) {
  await page.waitForFunction(() => {
    const raiz = document.querySelector("[x-data]") as any;
    const d = (window as any).Alpine?.$data(raiz);
    return !!d && d.conferenciaUltimaBusca() !== null;
  }, undefined, { timeout: limiteMs });
  await page.evaluate(async (ms) => {
    const raiz = document.querySelector("[x-data]") as any;
    const busca = (window as any).Alpine.$data(raiz).conferenciaUltimaBusca();
    let relogio: any;
    const estouro = new Promise((_, nao) => { relogio = setTimeout(() => nao(new Error("busca da conferência não resolveu")), ms); });
    try { await Promise.race([busca, estouro]); } finally { clearTimeout(relogio); }
  }, limiteMs);
  // Mais um tick para o Alpine aplicar o x-if.
  await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => ok(null))));
}

for (const tema of [null, "dark"] as const) {
  const nome = tema ? "Plantão" : "claro";

  test(`[${nome}] com itens: visível sem toque, contagem, as duas formas de linha e o rodapé`, async ({ page }) => {
    const erros: string[] = [];
    const p = payload();
    await abrir(page, { payload: p, tema, erros });
    const bloco = page.getByTestId("conferencia");
    await expect(bloco).toBeVisible({ timeout: 10_000 });
    await expect(bloco.locator(".conferencia__titulo")).toHaveText("Notas pendentes");
    await expect(page.getByTestId("conferencia-contagem")).toContainText("4");
    await expect(page.getByTestId("conferencia-contagem").locator(".sr-only")).toHaveText("4 pendentes");
    await expect(bloco.locator(".conferencia__explica")).toHaveText("A corretora mostra operações que ainda não vieram por nota.");
    const itens = page.getByTestId("conferencia-item");
    await expect(itens).toHaveText([
      "17/10/2026 · AAAA3 · Compra",
      "BBBB4 · posição diferente do banco",
      "09/10/2026 · CCCC11 · Venda",
      "30/09/2026 · DDDD34 · Compra",
    ]);
    // Semântica de lista, para o leitor de tela anunciar quantos são.
    await expect(bloco.locator("ul > li")).toHaveCount(4);
    // Ticker e data em mono.
    const fontes = await itens.first().locator(".conferencia__mono").evaluateAll((els) => els.map((e) => getComputedStyle(e).fontFamily));
    expect(fontes).toHaveLength(2);
    const mono = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--mono").trim());
    for (const f of fontes) expect(f.replace(/\s/g, "")).toBe(mono.replace(/\s/g, ""));
    const fonte = page.getByTestId("conferencia-fonte");
    await expect(fonte).toHaveText(`Conferida em ${await ddmmNaPagina(page, p.lido_em)} pelo Open Finance`);
    await expect(fonte).not.toHaveClass(/is-desatualizada/);
    // Sem toque: o bloco começa dentro da primeira tela a 320 px.
    await expect(bloco).toBeInViewport();
    await semTransbordo(page, '[data-testid="conferencia"]');
    // Folga real entre título e contagem (em flex space-between falha a folga, não o transbordo).
    const folga = await bloco.evaluate((el) => {
      const t = el.querySelector(".conferencia__titulo")!.getBoundingClientRect();
      const c = el.querySelector(".conferencia__contagem")!.getBoundingClientRect();
      return c.left - t.right;
    });
    expect(folga).toBeGreaterThanOrEqual(12);
    // Contraste AA de cada linha contra o fundo.
    const cores = await bloco.evaluate((el) => {
      const cor = (s: string) => getComputedStyle(el.querySelector(s)!).color;
      return {
        item: cor(".conferencia__item"), explica: cor(".conferencia__explica"),
        fonte: cor(".conferencia__fonte"), contagem: cor(".conferencia__contagem"),
        fundo: getComputedStyle(document.body).backgroundColor,
      };
    });
    for (const k of ["item", "explica", "fonte", "contagem"] as const) {
      expect(contraste(cores[k], cores.fundo), k).toBeGreaterThanOrEqual(4.5);
    }
    // Não é controle: nenhum link, botão ou foco dentro do bloco.
    await expect(bloco.locator("a, button, [tabindex]")).toHaveCount(0);
    expect(erros).toEqual([]);
  });

  test(`[${nome}] desatualizada: lido_em com mais de 48 h, palavra escrita e cor de aviso`, async ({ page }) => {
    const p = payload(UM, (x) => { x.lido_em = iso(49 * HORA); });
    await abrir(page, { payload: p, tema });
    const fonte = page.getByTestId("conferencia-fonte");
    await expect(fonte).toHaveText(`Desatualizada: conferida em ${await ddmmNaPagina(page, p.lido_em)} pelo Open Finance`, { timeout: 10_000 });
    await expect(fonte).toHaveClass(/is-desatualizada/);
    const cores = await fonte.evaluate((el) => ({
      txt: getComputedStyle(el).color, peso: getComputedStyle(el).fontWeight,
      fundo: getComputedStyle(document.body).backgroundColor,
    }));
    expect(cores.peso).toBe("600");
    expect(contraste(cores.txt, cores.fundo)).toBeGreaterThanOrEqual(4.5);
    await semTransbordo(page, '[data-testid="conferencia"]');
  });

  test(`[${nome}] um item: contagem no singular para o leitor de tela`, async ({ page }) => {
    await abrir(page, { payload: payload(UM), tema });
    await expect(page.getByTestId("conferencia-item")).toHaveText(["17/10/2026 · AAAA3 · Compra"], { timeout: 10_000 });
    await expect(page.getByTestId("conferencia-contagem").locator(".sr-only")).toHaveText("1 pendente");
    await semTransbordo(page, '[data-testid="conferencia"]');
  });
}

test("47 h ainda está em dia", async ({ page }) => {
  await abrir(page, { payload: payload(UM, (p) => { p.lido_em = iso(47 * HORA); }) });
  await expect(page.getByTestId("conferencia-fonte")).toHaveText(/^Conferida em \d{2}\/\d{2} pelo Open Finance$/, { timeout: 10_000 });
});

test.describe("Notas pendentes: o bloco não aparece, e o resto da tela fica", () => {
  const casos: [string, Abrir][] = [
    ["lista vazia", { payload: payload([]) }],
    ["404 em /conferencia", { status: 404 }],
    ["500 em /conferencia", { status: 500 }],
    ["KV sem a chave (cifra null)", { payload: null }],
    ["stub local da suíte (sem interceptar)", { semRota: true }],
    ["versão desconhecida", { payload: payload(QUATRO, (p) => { p.versao = 2; }) }],
    ["itens que não são lista", { payload: payload(QUATRO, (p) => { p.itens = { a: 1 }; }) }],
    ["um item malformado derruba o payload inteiro", { payload: payload([...QUATRO, { tipo: "operacao", data: "17/10/2026", ticker: "EEEE3", lado: "Compra" }]) }],
    ["lado fora de Compra/Venda", { payload: payload([{ tipo: "operacao", data: "2026-10-17", ticker: "AAAA3", lado: "BUY" }]) }],
    ["tipo desconhecido", { payload: payload([{ tipo: "outro", ticker: "AAAA3" }]) }],
  ];
  for (const [nome, o] of casos) {
    test(nome, async ({ page }) => {
      const erros: string[] = [];
      await abrir(page, { ...o, erros: o.status ? undefined : erros });
      await conferenciaResolvida(page);
      await expect(page.getByTestId("conferencia")).toHaveCount(0);
      // Reserva e patrimônio intactos.
      await expect(page.getByTestId("reserva-valor")).toHaveText(/R\$\s12\.345,67/);
      await irAoHoje(page);
      await expect(page.locator("#hero-patrimonio")).toHaveText(/R\$/);
      await expect(page.locator(".aporte-bloco")).toBeVisible();
      expect(erros).toEqual([]);
    });
  }
});

test("controle positivo do 'ausente': o mesmo caminho com itens mostra o bloco", async ({ page }) => {
  await abrir(page, { payload: payload(UM) });
  await conferenciaResolvida(page);
  await expect(page.getByTestId("conferencia")).toHaveCount(1);
});

// Sem lista de nomes de instituição aqui: o repo é público, e a lista diria
// quais são. O texto inteiro do bloco é travado palavra por palavra: só o que a
// spec manda (título, contagem, explicação, itens e o rodapé com "Open
// Finance"), então nenhum nome de instituição cabe nele.
test("o texto inteiro do bloco é só o que a spec manda", async ({ page }) => {
  const p = payload();
  await abrir(page, { payload: p });
  await expect(page.getByTestId("conferencia")).toBeVisible({ timeout: 10_000 });
  expect(await texto(page, '[data-testid="conferencia"]')).toBe(
    "Notas pendentes 4 4 pendentes A corretora mostra operações que ainda não vieram por nota. " +
      "17/10/2026 · AAAA3 · Compra BBBB4 · posição diferente do banco 09/10/2026 · CCCC11 · Venda 30/09/2026 · DDDD34 · Compra " +
      `Conferida em ${await ddmmNaPagina(page, p.lido_em)} pelo Open Finance`,
  );
});

test("fora do hero do patrimônio e depois da reserva no DOM e na tela", async ({ page }) => {
  await abrir(page);
  const bloco = page.getByTestId("conferencia");
  await expect(bloco).toBeVisible({ timeout: 10_000 });
  const pos = await bloco.evaluate((el) => {
    const reserva = document.querySelector('[data-testid="reserva"]')!;
    return {
      foraDoHero: el.closest("#hero") === null && !el.querySelector("#hero"),
      foraDaReserva: el.closest('[data-testid="reserva"]') === null,
      depoisDaReserva: !!(reserva.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING),
    };
  });
  expect(pos).toEqual({ foraDoHero: true, foraDaReserva: true, depoisDaReserva: true });
  const reserva = (await page.getByTestId("reserva").boundingBox())!;
  const caixa = (await bloco.boundingBox())!;
  expect(caixa.y).toBeGreaterThanOrEqual(reserva.y + reserva.height - 1);
});

test("nada é somado: o hero é idêntico com e sem conferência", async ({ page, browser }) => {
  await abrir(page, { payload: null });
  const ctx = await browser.newContext({ viewport: { width: 320, height: 640 } });
  const outra = await ctx.newPage();
  await abrir(outra);
  await expect(outra.getByTestId("conferencia")).toBeVisible({ timeout: 10_000 });
  await irAoHoje(page);
  await irAoHoje(outra);
  for (let i = 0; i < 4; i++) {
    await page.locator(".fd").nth(i).click();
    await outra.locator(".fd").nth(i).click();
    // Poll: a 1ª faceta pode ainda estar no count-up ao entrar no Hoje.
    await expect.poll(async () => (await outra.locator("#hero-body .hero-face.on").innerText())
      === (await page.locator("#hero-body .hero-face.on").innerText())).toBe(true);
  }
  await ctx.close();
});

const dadosAlpine = (page: Page) =>
  page.evaluate(() => {
    const raiz = document.querySelector("[x-data]") as any;
    return (window as any).Alpine.$data(raiz).conferencia;
  });

test("bloquear a sessão apaga a conferência da memória e da tela", async ({ page }) => {
  await abrir(page);
  await expect(page.getByTestId("conferencia")).toBeVisible({ timeout: 10_000 });
  await irAoHoje(page);
  await page.locator(".btn-bloquear").click();
  expect(await dadosAlpine(page)).toBeNull();
  await expect(page.getByTestId("conferencia")).toHaveCount(0);
});

test("busca em voo durante o bloqueio: a resposta que chega depois não grava nada", async ({ page }) => {
  let soltar!: () => void;
  const segura = new Promise<void>((ok) => (soltar = ok));
  let pedido!: () => void;
  const pediu = new Promise<void>((ok) => (pedido = ok));
  const corpo = JSON.stringify({ cifra: cifrar(JSON.stringify(payload())), gravada_em: iso(HORA) });
  await page.route("**/conferencia", async (route) => {
    pedido();
    await segura;
    await route.fulfill({ status: 200, contentType: "application/json", body: corpo }).catch(() => {});
  });
  await abrir(page, { semRota: true });
  await pediu;
  await irAoHoje(page);
  await page.locator(".btn-bloquear").click();
  soltar();
  // A busca de antes do bloqueio termina (a resposta chegou e foi descartada).
  await conferenciaResolvida(page);
  expect(await dadosAlpine(page)).toBeNull();
});

test("controle negativo do helper: com a busca pendurada, ele estoura o tempo", async ({ page }) => {
  await page.route("**/conferencia", () => { /* nunca responde */ });
  await abrir(page, { semRota: true });
  await expect(conferenciaResolvida(page, 2_000)).rejects.toThrow(/não resolveu/);
  await expect(page.getByTestId("conferencia")).toHaveCount(0);
});

test("ao voltar ao app, busca de novo: a lista nova substitui a velha", async ({ page }) => {
  let atual = payload(UM);
  await page.route("**/conferencia", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cifra: cifrar(JSON.stringify(atual)), gravada_em: iso(HORA) }) }),
  );
  await abrir(page, { semRota: true });
  await expect(page.getByTestId("conferencia-item")).toHaveCount(1, { timeout: 10_000 });
  atual = payload([]);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByTestId("conferencia")).toHaveCount(0, { timeout: 10_000 });
});
