import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

const FIXTURE = fs.readFileSync(
  path.join(__dirname, "../fixtures/portfolio.test.json.enc"),
  "utf-8",
);

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
  await page.goto("/#alocacao");
  await expect(page.locator(".tela-alocacao")).toBeVisible();
}

test.describe("Tela #alocacao unificada (7a.E.31)", () => {
  test("topo mostra patrimônio total + nº de categorias", async ({ page }) => {
    await autenticar(page);
    const valor = page.locator(".tela-alocacao .aloca-top__valor");
    await expect(valor).toBeVisible();
    expect((await valor.textContent())?.trim()).toMatch(/R\$\s?\d/);
    const sub = page.locator(".tela-alocacao .aloca-top__sub");
    // fixture tem 2 categorias (Ações BR, EUA)
    expect((await sub.textContent())?.trim()).toMatch(/2\s+categorias/);
  });

  test("renderiza um card por categoria; todos começam fechados", async ({ page }) => {
    await autenticar(page);
    const cards = page.locator(".tela-alocacao .aloca-cat");
    const n = await cards.count();
    expect(n).toBeGreaterThanOrEqual(2);
    // Resumo (header + barra + foot) sempre visível; corpo oculto.
    for (let i = 0; i < n; i++) {
      const card = cards.nth(i);
      await expect(card.locator(".aloca-cat__head")).toHaveAttribute("aria-expanded", "false");
      await expect(card.locator(".aloca-cat__body")).toBeHidden();
      await expect(card.locator(".aloca-cat__rs-valor")).toBeVisible();
    }
  });

  test("header mostra nome + R$ da categoria; foot mostra atual/alvo/drift", async ({ page }) => {
    await autenticar(page);
    const card = page.locator(".tela-alocacao .aloca-cat").first();
    await expect(card.locator(".aloca-cat__nome")).toBeVisible();
    const rs = await card.locator(".aloca-cat__rs-valor").textContent();
    expect(rs?.trim()).toMatch(/R\$\s?\d/);
    const foot = await card.locator(".aloca-cat__foot").textContent();
    expect(foot).toMatch(/atual/);
    expect(foot).toMatch(/alvo/);
  });

  test("clicar no header expande o corpo com cestas", async ({ page }) => {
    await autenticar(page);
    const card = page.locator(".tela-alocacao .aloca-cat").first();
    await card.locator(".aloca-cat__head").click();
    await expect(card.locator(".aloca-cat__head")).toHaveAttribute("aria-expanded", "true");
    await expect(card.locator(".aloca-cat__body")).toBeVisible();
    await expect(card.locator(".aloca-alvo__cesta").first()).toBeVisible();
  });

  test("clicar num ativo dentro do card navega para #ativo/:ticker", async ({ page }) => {
    await autenticar(page);
    const card = page.locator(".tela-alocacao .aloca-cat").first();
    await card.locator(".aloca-cat__head").click();
    await card.locator(".aloca-alvo__ativo").first().click();
    expect(await page.evaluate(() => location.hash)).toMatch(/^#ativo\//);
  });

  test("legacy #politica redireciona para #alocacao (sem ?v=)", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#politica");
    await expect(page).toHaveURL(/#alocacao$/);
    await expect(page.locator(".tela-alocacao")).toBeVisible();
    await expect(page.locator(".tela-alocacao .aloca-cat").first()).toBeVisible();
  });
});
