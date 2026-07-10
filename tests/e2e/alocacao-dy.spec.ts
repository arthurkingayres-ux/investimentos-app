import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

const FIXTURE = fs.readFileSync(
  path.join(__dirname, "../fixtures/portfolio.test.json.enc"),
  "utf-8",
);

test.use({ viewport: { width: 390, height: 844 } });

async function autenticar(page: Page) {
  await page.route("**/portfolio.json.enc", (route) =>
    route.fulfill({ status: 200, body: FIXTURE, contentType: "text/plain" }),
  );
  await page.addInitScript(() => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem("pinTimestamp", String(Date.now() - 1 * 24 * 60 * 60 * 1000));
  });
  await page.goto("/");
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
}

function cardPorNome(page: Page, nome: string) {
  return page.locator(".tela-alocacao .aloca-cat", {
    has: page.locator(".aloca-cat__nome", { hasText: nome }),
  });
}

async function abrirCategoria(page: Page, nome: string) {
  await autenticar(page);
  await page.goto("/#alocacao");
  const card = cardPorNome(page, nome);
  await card.locator(".aloca-cat__head").click();
  await expect(card.locator(".aloca-cat__body")).toBeVisible();
  return card;
}

function linhaDoTicker(card: ReturnType<typeof cardPorNome>, ticker: string) {
  return card.locator(".aloca-alvo__ativo", {
    has: card.page().locator(".aloca-alvo__ticker", { hasText: new RegExp(`^${ticker}$`) }),
  });
}

// `.aloca-alvo__ativo-sub` existe 3× na linha (normal / quarentena / fora-do-alvo);
// `x-show` esconde por display:none mas mantém os nós no DOM. `:visible` isola a
// que está de fato renderizada — sem isso o locator estoura em strict mode.
const SUB_VISIVEL = ".aloca-alvo__ativo-sub:visible";

test.describe("#alocacao — DY por ativo (7a.E.32)", () => {
  test("ativo com DY renderiza o valor com o rótulo DY", async ({ page }) => {
    const card = await abrirCategoria(page, "Ações BR");
    const dy = linhaDoTicker(card, "ITSA4").locator(".aloca-alvo__dy");
    await expect(dy).toHaveText("DY 8,2%");
  });

  test("ticker ausente de por_ativo mostra o traço, não um zero", async ({ page }) => {
    // BOVA11 é omitido do fixture de propósito: a ausência da chave É o
    // "não há número aqui". Um "DY 0,0%" aqui seria uma mentira.
    const card = await abrirCategoria(page, "Ações BR");
    const dy = linhaDoTicker(card, "BOVA11").locator(".aloca-alvo__dy");
    await expect(dy).toHaveText("—");
    await expect(dy).not.toContainText("DY");
  });

  test("o traço tem nome acessível — leitor não anuncia um travessão solto", async ({ page }) => {
    const card = await abrirCategoria(page, "Ações BR");
    const dy = linhaDoTicker(card, "BOVA11").locator(".aloca-alvo__dy");
    await expect(dy).toHaveAttribute("aria-label", "sem dividend yield");
  });

  test("o ativo COM DY não carrega aria-label — o texto já se explica", async ({ page }) => {
    const card = await abrirCategoria(page, "Ações BR");
    const dy = linhaDoTicker(card, "ITSA4").locator(".aloca-alvo__dy");
    await expect(dy).not.toHaveAttribute("aria-label", /.*/);
  });

  test("DY sobrevive aos 3 estados de linha (normal / quarentena / fora do alvo)", async ({ page }) => {
    // O slot é o mesmo nos 3 estados — é a razão de ele ser sufixo do ticker.
    const card = await abrirCategoria(page, "Ações BR");
    await expect(linhaDoTicker(card, "ITSA4").locator(".aloca-alvo__dy")).toHaveText("DY 8,2%");
    await expect(linhaDoTicker(card, "KNIP11").locator(".aloca-alvo__dy")).toHaveText("DY 10,8%");
    await expect(linhaDoTicker(card, "LREN3").locator(".aloca-alvo__dy")).toHaveText("DY 2,1%");
  });

  test("dark mode: DY herda --gray, sem cor hardcoded", async ({ page }) => {
    const card = await abrirCategoria(page, "Ações BR");
    const linha = linhaDoTicker(card, "ITSA4");
    const corDe = (sel: string) =>
      linha.locator(sel).evaluate((el) => getComputedStyle(el).color);

    const dyLight = await corDe(".aloca-alvo__dy");
    expect(await corDe(SUB_VISIVEL)).toBe(dyLight);

    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await expect
      .poll(() => linha.locator(".aloca-alvo__dy").evaluate((el) => getComputedStyle(el).color))
      .not.toBe(dyLight);

    // Continua casando com a voz secundária da linha — mesmo token, não um cinza solto.
    const dyDark = await corDe(".aloca-alvo__dy");
    expect(await corDe(SUB_VISIVEL)).toBe(dyDark);
  });

  test("sem overflow horizontal a 320px nas 3 variantes de linha", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    const card = await abrirCategoria(page, "Ações BR");

    for (const ticker of ["ITSA4", "KNIP11", "LREN3", "BOVA11"]) {
      const linha = linhaDoTicker(card, ticker);
      await expect(linha).toBeVisible();
      const estourou = await linha.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      expect(estourou, `${ticker} estourou a largura a 320px`).toBe(false);
    }

    const bodyEstourou = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(bodyEstourou).toBe(false);
  });
});
