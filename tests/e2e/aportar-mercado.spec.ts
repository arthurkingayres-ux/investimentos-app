import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

// Fase 7a.AU — aporte por mercado. Fixtures 100% SINTÉTICAS (repo público).
// INTX faz o papel de INTR/XP: categoria "Ações BR", bandeira 🇺🇸, cotado em
// reais pelo payload como qualquer outro ativo.

const FIXTURE = fs.readFileSync(
  path.join(__dirname, "../fixtures/portfolio.test.json.enc"),
  "utf-8",
);

test.use({ viewport: { width: 390, height: 844 } });

async function abrirApp(page: Page) {
  await page.route("**/portfolio.json.enc", (route) =>
    route.fulfill({ status: 200, body: FIXTURE, contentType: "text/plain" }),
  );
  await page.addInitScript(() => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem("pinTimestamp", String(Date.now() - 24 * 60 * 60 * 1000));
  });
  await page.goto("/");
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
}

type Eua = "subexposto" | "balanceado" | "pausado";

// Patrimônio 100.000. Preços por cota (valor_mercado_brl / quantidade):
// VOO 500, VEA 300, BBAS3 25, INTX 200, HGLG11 160.
// Com aporte 5.000 (patrimônio pós 105.000), gaps em R$:
//   INTX 0,30×105.000 − 10.000 = 21.500  ← maior da carteira inteira
//   VOO  0,25×105.000 − 15.000 = 11.250  (modo "subexposto")
//   BBAS3 0,10×105.000 − 5.000 =  5.500
// VEA e HGLG11 têm drift_intra > 0 (pausados) no modo "subexposto".
function carteira(eua: Eua = "subexposto", semEua = false) {
  const voo =
    eua === "subexposto"
      ? { peso_atual: 0.15, drift_intra: -0.1 }
      : eua === "balanceado"
        ? { peso_atual: 0.30, drift_intra: 0 }
        : { peso_atual: 0.30, drift_intra: 0.1 };
  const vea =
    eua === "balanceado"
      ? { peso_atual: 0.15, drift_intra: 0 }
      : { peso_atual: 0.15, drift_intra: 0.05 };
  const categorias: any[] = [
    {
      nome: "EUA", peso_alvo: 0.35, peso_atual: 0.30, drift: -0.05,
      buckets: [{ tipo: "picks", ativos: [
        { ticker: "VOO", tipo: "pick", bandeira: "🇺🇸", peso_intra: 0.7, peso_alvo: 0.25, ...voo },
        { ticker: "VEA", tipo: "pick", bandeira: "🇺🇸", peso_intra: 0.3, peso_alvo: 0.10, ...vea },
      ] }],
    },
    {
      nome: "Ações BR", peso_alvo: 0.40, peso_atual: 0.15, drift: -0.25,
      buckets: [{ tipo: "picks", ativos: [
        { ticker: "BBAS3", tipo: "pick", bandeira: "🇧🇷", peso_intra: 0.25, peso_alvo: 0.10, peso_atual: 0.05, drift_intra: -0.05 },
        { ticker: "INTX", tipo: "pick", bandeira: "🇺🇸", peso_intra: 0.75, peso_alvo: 0.30, peso_atual: 0.10, drift_intra: -0.2 },
      ] }],
    },
    {
      nome: "FIIs", peso_alvo: 0.25, peso_atual: 0.40, drift: 0.15,
      buckets: [{ tipo: "picks", ativos: [
        { ticker: "HGLG11", tipo: "pick", bandeira: "🇧🇷", peso_intra: 1, peso_alvo: 0.25, peso_atual: 0.40, drift_intra: 0.15 },
      ] }],
    },
  ];
  return {
    patrimonio: { total_brl: 100000 },
    posicoes: [
      { ticker: "VOO", quantidade: 30, valor_mercado_brl: 15000, moeda: "USD" },
      { ticker: "VEA", quantidade: 50, valor_mercado_brl: 15000, moeda: "USD" },
      { ticker: "BBAS3", quantidade: 200, valor_mercado_brl: 5000 },
      { ticker: "INTX", quantidade: 50, valor_mercado_brl: 10000, moeda: "USD" },
      { ticker: "HGLG11", quantidade: 250, valor_mercado_brl: 40000 },
    ],
    politica: { categorias: semEua ? categorias.slice(1) : categorias },
  };
}

async function calc(page: Page, valor: number, portfolio: any, opcoes?: any) {
  return page.evaluate(
    ([v, p, o]) => (window as any).aporteCalculo.calcularAporte(v, p, o),
    [valor, portfolio, opcoes] as const,
  );
}

const tickers = (r: any) =>
  r.categorias.flatMap((c: any) => c.compras.map((x: any) => x.ticker));
const soma = (r: any) =>
  r.categorias.flatMap((c: any) => c.compras).reduce((s: number, x: any) => s + x.valor, 0);
const rotulo = (r: any, nome: string) =>
  (r.categoriasNaoRecebedoras.find((c: any) => c.nome === nome) || {}).label;

test.describe("7a.AU · algoritmo por mercado", () => {
  test.beforeEach(async ({ page }) => { await abrirApp(page); });

  test("tudo: opcoes omitida, 'tudo' e valores inválidos dão o MESMO retorno", async ({ page }) => {
    const p = carteira();
    const base = await calc(page, 5000, p);
    for (const o of [{ mercado: "tudo" }, { mercado: "xyz" }, { mercado: "EUA" }, { mercado: undefined }, {}]) {
      expect(await calc(page, 5000, p, o)).toEqual(base);
    }
    // Cards saem agrupados na ordem das categorias da política (EUA, Ações
    // BR); dentro da categoria, por prioridade (INTX antes de BBAS3).
    expect(tickers(base)).toEqual(["VOO", "INTX", "BBAS3"]);
  });

  test("Só EUA: só compras da categoria EUA; BR e FIIs 'fora deste aporte'", async ({ page }) => {
    const r = await calc(page, 5000, carteira(), { mercado: "eua" });
    expect(r.estado).toBe("ok");
    expect(r.categorias.map((c: any) => c.nome)).toEqual(["EUA"]);
    expect(tickers(r)).toEqual(["VOO"]);
    expect(rotulo(r, "Ações BR")).toBe("fora deste aporte");
    expect(rotulo(r, "FIIs")).toBe("fora deste aporte");
    expect(r.banner).toBe("Aporte só nos EUA, concentrado no ativo dos EUA mais abaixo do alvo.");
  });

  test("Só EUA nunca recomenda o USD de Ações BR, mesmo sendo o maior gap da carteira", async ({ page }) => {
    // Controle pela MAIOR COMPRA, não por tickers(tudo)[0]: o flatten segue a
    // ordem das categorias da política (EUA primeiro), então [0] é VOO sempre
    // (G2). INTX 2.800 > VOO ~1.475 > BBAS3 725.
    const tudo = await calc(page, 5000, carteira());
    const compras = tudo.categorias.flatMap((c: any) => c.compras);
    expect(compras.reduce((a: any, b: any) => (a.valor > b.valor ? a : b)).ticker).toBe("INTX");
    const r = await calc(page, 5000, carteira(), { mercado: "eua" });
    expect(tickers(r)).not.toContain("INTX");
  });

  test("Só Brasil: nenhuma compra EUA; INTX EXIGIDO no plano, em cotas inteiras", async ({ page }) => {
    const r = await calc(page, 5010, carteira(), { mercado: "brasil" });
    expect(r.estado).toBe("ok");
    expect(r.categorias.map((c: any) => c.nome)).toEqual(["Ações BR"]);
    const intx = r.categorias[0].compras.find((x: any) => x.ticker === "INTX");
    expect(intx).toBeTruthy();
    expect(Number.isInteger(intx.cotas)).toBe(true);
    expect(intx.cotasFormatadas).toBe("20 cotas");
    expect(tickers(r)).not.toContain("VOO");
    expect(rotulo(r, "EUA")).toBe("fora deste aporte");
    expect(r.banner).toBe("Aporte só no Brasil, distribuído entre os 2 ativos mais abaixo do alvo.");
  });

  test("pausados e sem-posição restritos ao mercado", async ({ page }) => {
    const br = await calc(page, 5000, carteira(), { mercado: "brasil" });
    expect(br.pausados).toEqual(["HGLG11"]);
    const eua = await calc(page, 5000, carteira(), { mercado: "eua" });
    expect(eua.pausados).toEqual(["VEA"]);
    const tudo = await calc(page, 5000, carteira());
    expect(tudo.pausados.sort()).toEqual(["HGLG11", "VEA"]);
  });

  test("balanceado restrito: banner próprio e compras só EUA", async ({ page }) => {
    const r = await calc(page, 5000, carteira("balanceado"), { mercado: "eua" });
    expect(r.estado).toBe("balanceado");
    expect(r.banner).toBe(
      "Nenhum ativo dos EUA está abaixo do alvo. Aporte distribuído pelos pesos-alvo dos 2 ativos dos EUA.",
    );
    expect(tickers(r).sort()).toEqual(["VEA", "VOO"]);
  });

  test("vazio restrito: banner neutro + categorias fora do mercado listadas", async ({ page }) => {
    const r = await calc(page, 5000, carteira("pausado"), { mercado: "eua" });
    expect(r.estado).toBe("vazio");
    expect(r.categorias).toEqual([]);
    expect(r.banner).toBe("Nenhum ativo dos EUA disponível para compra dentro da política.");
    expect(r.categoriasNaoRecebedoras.map((c: any) => c.nome)).toEqual(["Ações BR", "FIIs"]);
    expect(r.categoriasNaoRecebedoras.every((c: any) => c.label === "fora deste aporte")).toBe(true);
    expect(r.pausados).toEqual(["VOO", "VEA"]);
    expect(r.sobra).toBe(5000); // spec §3.1: sobra = valor − Σ compras, e Σ = 0
  });

  test("aporte_pequeno: sobra = valor inteiro (nada coube)", async ({ page }) => {
    const r = await calc(page, 5, carteira(), { mercado: "brasil" });
    expect(r.estado).toBe("aporte_pequeno");
    expect(r.sobra).toBe(5);
  });

  test("política sem categoria EUA + Só EUA: vazio explicado, tudo 'fora deste aporte'", async ({ page }) => {
    const r = await calc(page, 5000, carteira("subexposto", true), { mercado: "eua" });
    expect(r.estado).toBe("vazio");
    expect(r.banner).toBe("Nenhum ativo dos EUA disponível para compra dentro da política.");
    expect(r.categoriasNaoRecebedoras.map((c: any) => c.label)).toEqual(["fora deste aporte", "fora deste aporte"]);
  });

  test("valor 0 em Só EUA: vazio sem banner (retorno antecipado vem antes do filtro)", async ({ page }) => {
    const r = await calc(page, 0, carteira(), { mercado: "eua" });
    expect(r.estado).toBe("vazio");
    expect(r.banner).toBeNull();
    expect(r.categoriasNaoRecebedoras).toEqual([]);
    expect(r.sobra).toBe(0);
  });

  test("sobra por modo: Só EUA exata 0; Só Brasil e Tudo-sem-EUA declaram R$ 10", async ({ page }) => {
    const eua = await calc(page, 5010, carteira(), { mercado: "eua" });
    expect(eua.sobra).toBe(0); // exato, não 1e-9
    expect(Math.round(soma(eua) * 100) / 100).toBe(5010);

    const br = await calc(page, 5010, carteira(), { mercado: "brasil" });
    expect(br.sobra).toBe(10);
    expect(Math.round((5010 - soma(br)) * 100) / 100).toBe(10);

    // Tudo sem nenhum EUA no top 5 (os dois EUA pausados) — o resíduo que
    // hoje some calado.
    const tudo = await calc(page, 5010, carteira("pausado"));
    expect(tickers(tudo).every((t: string) => t !== "VOO" && t !== "VEA")).toBe(true);
    expect(tudo.sobra).toBe(10);
  });

  test("MERCADOS exportado", async ({ page }) => {
    const m = await page.evaluate(() => (window as any).aporteCalculo.MERCADOS);
    expect(m).toEqual(["tudo", "brasil", "eua"]);
  });
});

async function abrirComCarteira(page: Page, portfolio: any) {
  await abrirApp(page);
  await page.evaluate((p) => {
    const d = (window as any).Alpine?.$data?.(document.body);
    if (!d) throw new Error("Alpine.$data(document.body) indefinido — override não aplicado");
    Object.assign(d.json, p);
  }, portfolio);
  await page.evaluate(() => (location.hash = "#aportar"));
  await expect(page.locator(".tela-aportar")).toBeVisible();
}

const botao = (page: Page, m: string) =>
  page.locator(`.aporte-mercado-toggle button[data-mercado="${m}"]`);

async function preencher(page: Page, valor: string) {
  await page.locator(".aporte-input").fill(valor);
  await page.waitForTimeout(300);
}

const estado = (page: Page) =>
  page.evaluate(() => (window as any).Alpine.$data(document.body).aporteMercado);

test.describe("7a.AU · seletor de mercado na tela", () => {
  test("toggle acima do valor, Tudo ativo por default, rótulos acessíveis", async ({ page }) => {
    await abrirComCarteira(page, carteira());
    await expect(botao(page, "tudo")).toHaveClass(/active/);
    await expect(botao(page, "tudo")).toHaveAttribute("aria-selected", "true");
    await expect(botao(page, "eua")).toHaveAttribute("aria-selected", "false");
    await expect(botao(page, "brasil")).toHaveAttribute("aria-label", "Brasil");
    await expect(botao(page, "eua")).toHaveAttribute("aria-label", "Estados Unidos");
    const yToggle = (await page.locator(".aporte-mercado-toggle").boundingBox())!.y;
    const yInput = (await page.locator(".aporte-input").boundingBox())!.y;
    expect(yToggle).toBeLessThan(yInput);
  });

  test("Só EUA na tela: cards só EUA, BR em 'Outras' como 'fora deste aporte'", async ({ page }) => {
    await abrirComCarteira(page, carteira());
    await preencher(page, "5000");
    await botao(page, "eua").click();
    await expect(botao(page, "eua")).toHaveClass(/active/);
    await expect(page.locator(".aporte-cat-name")).toHaveText(["EUA"]);
    await expect(page.locator(".aporte-outras")).toContainText("Ações BR");
    await expect(page.locator(".aporte-outras")).toContainText("fora deste aporte");
    await expect(page.locator(".aporte-banner")).toContainText("Aporte só nos EUA");
  });

  test("alternar EUA → Tudo → EUA: cards que voltam ficam visíveis", async ({ page }) => {
    await abrirComCarteira(page, carteira());
    await preencher(page, "5000");
    await botao(page, "eua").click();
    await botao(page, "tudo").click();
    await expect(page.locator(".aporte-cat-name")).toHaveText(["EUA", "Ações BR"]);
    await botao(page, "eua").click();
    await page.waitForTimeout(400);
    const card = page.locator(".aporte-card").first();
    await expect(card).toHaveClass(/aporte-card--in/);
    await expect(card).toBeVisible();
  });

  test("não persiste: sair e voltar à tela volta a Tudo", async ({ page }) => {
    await abrirComCarteira(page, carteira());
    await botao(page, "eua").click();
    expect(await estado(page)).toBe("eua");
    await page.evaluate(() => (location.hash = "#raiox"));
    await expect(page.locator(".raiox")).toBeVisible();
    await page.evaluate(() => (location.hash = "#aportar"));
    await expect(botao(page, "tudo")).toHaveClass(/active/);
    expect(await estado(page)).toBe("tudo");
    // Por igualdade de valor e nome de chave, nunca substring: o envelope
    // cifrado em localStorage é base64 e casaria "eua" por acaso.
    const ls = await page.evaluate(() => ({ ...localStorage }));
    expect(Object.values(ls)).not.toContain("eua");
    expect(Object.keys(ls).some((k) => /mercado/i.test(k))).toBe(false);
  });

  test("preset do grifo de #alocação abre em Tudo, mesmo vindo de um EUA", async ({ page }) => {
    await abrirApp(page);
    await page.evaluate(() => (location.hash = "#aportar"));
    await botao(page, "eua").click();
    expect(await estado(page)).toBe("eua");
    await page.evaluate(() => (location.hash = "#alocacao"));
    await page.locator(".aloca-grifo").click();
    await expect(page.locator(".tela-aportar")).toBeVisible();
    await expect(page.locator(".aporte-input")).toHaveValue("5000");
    await expect(botao(page, "tudo")).toHaveClass(/active/);
  });

  // Fase 7a.AU (fix pós-merge): `tentarAutoResume()` (boot) hidrata #aportar
  // DUAS vezes quando o hash de entrada já é "#aportar" — 1ª síncrona em
  // `atualizarRota()` (json ainda ausente, early-return) e 2ª depois de
  // `await carregarIndiceRelatorios()`, linha "se a rota já é #aportar
  // (reload), hidratar agora que temos json". Se o Dr. Arthur tocar EUA
  // enquanto esse await está pendente, a 2ª hidratação sobrescrevia
  // `aporteMercado` de volta para "tudo" — silenciosamente, sem erro. Mesma
  // classe de corrida que a 7a.U/7a.V.2 fecharam para
  // hidratarRelatorio/hidratarDossie: portão via promise controlada pelo
  // teste (não por relógio), self-guard contra vacuidade antes da ação, e
  // `waitForFunction` no fim do await em vez de sleep às cegas.
  test("tocar EUA durante a espera do boot não é desfeito pela hidratação tardia", async ({ page }) => {
    await page.route("**/portfolio.json.enc", (route) =>
      route.fulfill({ status: 200, body: FIXTURE, contentType: "text/plain" }),
    );
    let liberar!: () => void;
    const portao = new Promise<void>((r) => { liberar = r; });
    await page.route("**/relatorios_index.json.enc", async (route) => {
      await portao;
      return route.fulfill({ status: 404, body: "" });
    });
    await page.addInitScript(() => {
      localStorage.setItem("pin", "123456");
      localStorage.setItem("pinTimestamp", String(Date.now() - 24 * 60 * 60 * 1000));
    });

    await page.goto("/#aportar");
    await expect(page.locator(".aporte-mercado-toggle")).toBeVisible({ timeout: 10_000 });

    // Self-guard contra vacuidade: prova que a janela do await está ABERTA
    // antes de agir — sem isto, um portão furado faria o teste passar sem
    // nenhuma corrida real acontecer.
    await page.waitForFunction(() => {
      const d = (window as any).Alpine.$data(document.body);
      return !!d._relIndicePromise && !!d.segredo;
    }, undefined, { timeout: 10_000 });

    await botao(page, "eua").click();
    expect(await estado(page)).toBe("eua");

    liberar();
    await page.waitForFunction(
      () => (window as any).Alpine.$data(document.body)._relIndicePromise === null,
      undefined, { timeout: 10_000 },
    );
    // Folga para a continuação tardia de tentarAutoResume rodar (ou não).
    await page.waitForTimeout(300);

    expect(await estado(page)).toBe("eua");
    await expect(botao(page, "eua")).toHaveClass(/active/);
  });

  test("lock volta o modo a Tudo (antes do unlock)", async ({ page }) => {
    await abrirComCarteira(page, carteira());
    await botao(page, "eua").click();
    expect(await estado(page)).toBe("eua");
    await page.evaluate(() => (window as any).Alpine.$data(document.body).bloquear());
    expect(await estado(page)).toBe("tudo");
  });

  test("sobra na tela: Só Brasil declara 'Sobram R$ 10,00' e não diz 'zero sobra'", async ({ page }) => {
    await abrirComCarteira(page, carteira());
    await preencher(page, "5010");
    await botao(page, "brasil").click();
    const grifo = page.locator(".aporte-grifo");
    await expect(grifo).toContainText("Sobram R$ 10,00, que ficam para o próximo aporte.");
    await expect(grifo).not.toContainText(/zero sobra/i);
    await expect(page.locator(".aporte-nota")).not.toContainText(/zero sobra/i);
  });

  test("sobra na tela: Só EUA diz 'Zero sobra' e não mostra 'Sobram'", async ({ page }) => {
    await abrirComCarteira(page, carteira());
    await preencher(page, "5010");
    await botao(page, "eua").click();
    const grifo = page.locator(".aporte-grifo");
    await expect(grifo).toContainText(/zero sobra/i);
    await expect(grifo).not.toContainText("Sobram");
  });

  test("sobra na tela: modo Tudo sem EUA no top 5 passa a declarar a sobra", async ({ page }) => {
    await abrirComCarteira(page, carteira("pausado"));
    await preencher(page, "5010");
    await expect(botao(page, "tudo")).toHaveClass(/active/);
    await expect(page.locator(".aporte-grifo")).toContainText("Sobram R$ 10,00");
    await expect(page.locator(".aporte-grifo")).not.toContainText(/zero sobra/i);
    await expect(page.locator(".aporte-nota")).not.toContainText(/zero sobra/i);
  });

  test("copy restrita: grifo do balanceado e linha da nota (presente só fora do Tudo)", async ({ page }) => {
    await abrirComCarteira(page, carteira("balanceado"));
    await preencher(page, "5000");
    await expect(page.locator(".aporte-nota-mercado")).toHaveCount(0);
    await botao(page, "eua").click();
    await expect(page.locator(".aporte-grifo")).toContainText(
      "o aporte segue os pesos-alvo dos ativos dos EUA",
    );
    await expect(page.locator(".aporte-nota-mercado")).toHaveText(
      "Só EUA: o plano cobre apenas a parte dos EUA da política; o resto fica para outro aporte.",
    );
    await botao(page, "brasil").click();
    await expect(page.locator(".aporte-nota-mercado")).toHaveText(
      "Só Brasil: o plano cobre apenas a parte do Brasil da política; o resto fica para outro aporte.",
    );
    await botao(page, "tudo").click();
    await expect(page.locator(".aporte-nota-mercado")).toHaveCount(0);
  });

  test("vazio restrito na tela: zero cards + banner neutro", async ({ page }) => {
    await abrirComCarteira(page, carteira("pausado"));
    await preencher(page, "5000");
    await botao(page, "eua").click();
    await expect(page.locator(".aporte-card")).toHaveCount(0);
    await expect(page.locator(".aporte-banner")).toHaveText(
      "Nenhum ativo dos EUA disponível para compra dentro da política.",
    );
  });
});

test.describe("7a.AU · toggle sem overflow", () => {
  for (const largura of [320, 390]) {
    for (const tema of ["light", "dark"]) {
      test(`${largura}px · ${tema}`, async ({ page }) => {
        await page.setViewportSize({ width: largura, height: 800 });
        await page.addInitScript((t) => localStorage.setItem("tema", t), tema);
        await abrirComCarteira(page, carteira());
        await botao(page, "eua").click();
        const m = await page.evaluate(() => {
          const t = document.querySelector(".aporte-mercado-toggle") as HTMLElement;
          return {
            toggle: t.scrollWidth - t.clientWidth,
            pagina: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            tema: document.documentElement.getAttribute("data-theme"),
          };
        });
        expect(m.tema).toBe(tema);
        expect(m.toggle).toBeLessThanOrEqual(0);
        expect(m.pagina).toBeLessThanOrEqual(0);
      });
    }
  }
});
