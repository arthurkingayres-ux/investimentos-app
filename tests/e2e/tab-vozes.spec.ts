import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

// Fase 7a.S.4 — Tab bar por extenso + vozes de título unificadas.
// Task 1: rótulos por extenso na tab bar + estilo Monument (10.5px/600/700).
// Task 2: `.eyebrow` como abertura única das 5 telas de tab; push screens
// (#ativo/#patrimonio/#relatorio) usam a variante `.eyebrow--accent`.
const FIXTURE = fs.readFileSync(
  path.join(__dirname, "../fixtures/portfolio.test.json.enc"),
  "utf-8",
);

async function mockPortfolio(page: Page) {
  await page.route("**/portfolio.json.enc", (route) =>
    route.fulfill({ status: 200, body: FIXTURE, contentType: "text/plain" }),
  );
}

async function autenticar(page: Page) {
  await mockPortfolio(page);
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

// CRB 7a.S.4: o .eyebrow agora é um <h1> de verdade (heading semantics —
// leitor de tela volta a encontrar landmark de título), mas visualmente
// segue pequeno (11px/800/.2em, a classe vence a regra `h1 { font-size:
// 1.75rem }` por especificidade). O invariante correto combina as DUAS
// pontas: é heading (tagName H1) E está estilizado pequeno (fontSize),
// nunca só uma.
async function expectEyebrowHeading(locator: import("@playwright/test").Locator, texto?: string) {
  await expect(locator).toBeVisible();
  if (texto !== undefined) {
    await expect(locator).toHaveText(texto);
  }
  const info = await locator.evaluate((el) => ({
    tag: el.tagName,
    fontSize: getComputedStyle(el).fontSize,
  }));
  expect(info.tag).toBe("H1");
  expect(info.fontSize).toBe("11px");
}

// 7a.CC: tela-membro não tem mais cabeçalho próprio visível. A voz de abertura
// é o eyebrow do GRUPO no .grupo-cab (11px, --faint), e o título da tela
// continua no DOM como <h1> só para leitor de tela (spec 7a.CC §5.4).
async function expectAberturaDeMembro(page: Page, tela: string, h1: string, grupo: string) {
  const eyebrow = page.locator(".grupo-cab .eyebrow");
  await expect(eyebrow).toBeVisible();
  await expect(eyebrow).toHaveText(grupo);
  expect(await eyebrow.evaluate((el) => getComputedStyle(el).fontSize)).toBe("11px");
  const titulo = page.locator(`${tela} h1`).first();
  await expect(titulo).toHaveText(h1);
  await expect(titulo).toHaveClass(/\bsr-only\b/);
  await expect(page.locator(tela).getByRole("button", { name: /^Voltar/ })).toHaveCount(0);
}

test.describe("Tab bar por extenso (7a.S.4 Task 1)", () => {
  test("os 5 links da tab bar têm o texto por extenso (fim das abreviações)", async ({ page }) => {
    await autenticar(page);
    const tabs = page.locator(".tab-bar a");
    await expect(tabs).toHaveCount(5);
    // 7a.CC: os rótulos são os dos cinco grupos.
    await expect(tabs).toHaveText(["Raio-X", "Retorno", "Carteira", "Análise", "Aportar"]);
  });

  test("tab ativa é --accent (rgb(4, 120, 87)) + font-weight 700; inativa usa --faint + 600", async ({ page }) => {
    await autenticar(page);
    const ativa = page.locator('.tab-bar a[data-tab="raiox"]');
    const inativa = page.locator('.tab-bar a[data-tab="retorno"]');
    const cs = await ativa.evaluate((el) => {
      const s = getComputedStyle(el);
      return { color: s.color, weight: s.fontWeight, size: s.fontSize };
    });
    expect(cs.color).toBe("rgb(4, 120, 87)");
    expect(cs.weight).toBe("700");
    expect(cs.size).toBe("10.5px");

    const csInativa = await inativa.evaluate((el) => {
      const s = getComputedStyle(el);
      return { color: s.color, weight: s.fontWeight };
    });
    expect(csInativa.color).toBe("rgb(152, 158, 151)"); // --faint #989e97
    expect(csInativa.weight).toBe("600");
  });

  test("sem overflow horizontal a 320px (5 rótulos por extenso cabem)", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await autenticar(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("Voz única de abertura de tela — .eyebrow (7a.S.4 Task 2)", () => {
  test("Raio-X: a abertura é o eyebrow do grupo; o h1 'Raio X' fica para leitor de tela; hero intacto", async ({ page }) => {
    await autenticar(page);
    await expectAberturaDeMembro(page, ".raiox", "Raio X", "Raio-X");
    await expect(page.locator("#hero-patrimonio")).toBeVisible();
  });

  for (const [hash, tela, h1, grupo] of [
    ["#rentabilidade", ".tela-rentabilidade", "Rentabilidade", "Retorno"],
    ["#alocacao", ".tela-alocacao", "Alocação", "Carteira"],
    ["#proventos", ".tela-proventos", "Proventos", "Retorno"],
    ["#aportar", ".tela-aportar", "Próximo aporte", "Aportar"],
    ["#/raiox/chart", ".tela-patrimonio", "Histórico patrimonial", "Raio-X"],
  ]) {
    test(`${h1}: eyebrow do grupo ${grupo} no topo, h1 da tela só para leitor de tela, sem voltar`, async ({ page }) => {
      await autenticar(page);
      await page.goto("/" + hash);
      await expect(page.locator(tela)).toBeVisible({ timeout: 5_000 });
      await expectAberturaDeMembro(page, tela, h1, grupo);
    });
  }

  // CRB 7a.S.4: cobertura estava restrita ao #patrimonio; os outros 2 push
  // screens (#ativo/#relatorio) também ganharam .eyebrow--accent em S.4 Task 2
  // mas não tinham asserção dedicada.
  test("push screen #ativo usa .eyebrow--accent como h1 pequeno, mantém breadcrumb + botão voltar", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#ativo/HGLG11");
    await expect(page.locator(".tela-ativo")).toBeVisible();
    const header = page.locator(".tela-ativo header.breadcrumb");
    await expect(header.locator("button[aria-label='Voltar']")).toBeVisible();
    const eyebrow = header.locator(".eyebrow.eyebrow--accent");
    await expectEyebrowHeading(eyebrow, "HGLG11");
    const color = await eyebrow.evaluate((el) => getComputedStyle(el).color);
    expect(color).toBe("rgb(4, 120, 87)");
  });

  // 7a.CC: o Relatório virou tela-membro de Análise. Mantém o próprio
  // cabeçalho só pelo seletor de mês; sem "←", título só para leitor de tela.
  test("Relatório: eyebrow do grupo Análise, seletor de mês no cabeçalho, sem voltar", async ({ page }) => {
    await autenticar(page);
    // degradação graciosa: sem mock do índice, cai em .rel-vazio — o header
    // renderiza incondicionalmente antes desse branch.
    await page.route("**/relatorios_index.json.enc", (route) =>
      route.fulfill({ status: 404, body: "" }),
    );
    await page.goto("/#/raiox/relatorio");
    await expect(page.locator(".tela-relatorio")).toBeVisible();
    await expectAberturaDeMembro(page, ".tela-relatorio", "Relatório", "Análise");
    await expect(page.locator(".tela-relatorio header.rel-breadcrumb .rel-seletor")).toBeAttached();
  });
});
