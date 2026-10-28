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
    localStorage.setItem(
      "pinTimestamp",
      String(Date.now() - 1 * 24 * 60 * 60 * 1000),
    );
  });
  await page.goto("/");
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
}

function cardPorNome(page: Page, nome: string) {
  return page.locator(".tela-alocacao .aloca-cat", {
    has: page.locator(".aloca-cat__nome", { hasText: nome }),
  });
}

// 7a.E.31: vista única — abre #alocacao e expande um card de categoria.
async function abrirCategoria(page: Page, nome: string) {
  await autenticar(page);
  await page.goto("/#alocacao");
  const card = cardPorNome(page, nome);
  await card.locator(".aloca-cat__head").click();
  await expect(card.locator(".aloca-cat__body")).toBeVisible();
  return card;
}

test.describe("#alocacao unificada — grupos por estado + identidade (7a.E.31 / 7a.BK.1)", () => {
  test("cada card de categoria seta --cat via inline style", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#alocacao");
    const cards = page.locator(".tela-alocacao .aloca-cat");
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < count; i++) {
      const cssVar = await cards.nth(i).evaluate((el) =>
        getComputedStyle(el).getPropertyValue("--cat").trim(),
      );
      expect(cssVar).not.toBe("");
    }
  });

  test("R$ da categoria no header herda a cor da categoria (--cat)", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#alocacao");
    const rs = page.locator(".tela-alocacao .aloca-cat__rs-valor").first();
    await expect(rs).toBeVisible();
    const color = await rs.evaluate((el) => getComputedStyle(el).color);
    expect(color).not.toMatch(/^rgb\(0,\s*0,\s*0\)/);
    expect(color).toMatch(/^rgba?\(/);
  });

  // 7a.BK.1: a linha das cestas usa os nomes curtos ("Passivo"/"Picks", spec
  // §3.4); o jargão "bucket" continua fora da tela.
  test("linha das cestas usa Passivo / Picks; jargão 'bucket' ausente", async ({ page }) => {
    const card = await abrirCategoria(page, "Ações BR");
    const cestas = card.locator(".aloca-cestas");
    await expect(cestas).toContainText("Passivo");
    await expect(cestas).toContainText("Picks");
    expect((await card.locator(".aloca-cat__body").innerText()).toLowerCase()).not.toMatch(/\bbucket\b/);
  });

  // 7a.BK.1: o minibar saiu (spec §4(e)); o tom âmbar de "acima" continua,
  // agora no R$ da linha do grupo "Acima da faixa", como TEXTO: --sem-down-texto,
  // o ocre escurecido que fecha AA na tinta da linha (7a.BK.1 Task 4).
  test("ativo acima da faixa: linha no grupo 'acima' com R$ em âmbar (--sem-down-texto)", async ({ page }) => {
    const card = await abrirCategoria(page, "Ações BR");
    const linha = card.locator('.aloca-grupo[data-grupo="acima"] .aloca-ativo').first();
    await expect(linha).toBeVisible();
    await expect(linha.locator(".aloca-ativo__rs")).toHaveText(/^sobram R\$ /);
    const cor = await linha.locator(".aloca-ativo__rs").evaluate((el) => getComputedStyle(el).color);
    // --sem-down-texto #8f5b16 → rgb(143, 91, 22) (o --cat-fii puro, #b8731f, dá 3,3:1)
    expect(cor).toMatch(/rgb\(143,\s*91,\s*22\)/);
  });

  // 7a.E.28 / 7a.BK.1 — pick em quarentena (KNIP11 na fixture) vai para "Sem
  // alvo" com o motivo em texto; nenhum R$ de aporte.
  test("pick em quarentena aparece em 'Sem alvo' com motivo 'quarentena'", async ({ page }) => {
    const card = await abrirCategoria(page, "Ações BR");
    const etq = card.locator('.aloca-grupo[data-grupo="sem_alvo"] .aloca-etq').filter({ hasText: "KNIP11" });
    await expect(etq).toBeVisible();
    await expect(etq.locator(".aloca-etq__ticker")).toHaveText("KNIP11");
    await expect(etq.locator(".aloca-etq__motivo")).toHaveText("quarentena");
    await expect(etq).toHaveAttribute("href", "#ativo/KNIP11");
    await expect(card.locator(".aloca-ativo").filter({ hasText: "KNIP11" })).toHaveCount(0);
  });

  // 7a.E.31 / 7a.BK.1 — held off-policy (LREN3 na fixture): "a zerar" em "Sem alvo".
  test("held off-policy aparece em 'Sem alvo' com motivo 'a zerar'", async ({ page }) => {
    const card = await abrirCategoria(page, "Ações BR");
    const etq = card.locator('.aloca-grupo[data-grupo="sem_alvo"] .aloca-etq').filter({ hasText: "LREN3" });
    await expect(etq).toBeVisible();
    await expect(etq.locator(".aloca-etq__motivo")).toHaveText("a zerar");
    await expect(etq).toHaveAttribute("href", "#ativo/LREN3");
    await expect(card.locator(".aloca-ativo").filter({ hasText: "LREN3" })).toHaveCount(0);
  });
});
