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
  test("cabeçalho padrão .breadcrumb abre com .eyebrow Alocação, que é h1 pequeno (sem patrimônio)", async ({ page }) => {
    // 7a.S.4: a voz única de abertura de tela é .eyebrow. CRB: .eyebrow
    // voltou a ser <h1> (heading semantics para leitor de tela), mas
    // estilizado pequeno (11px) — a classe vence a regra `h1 { font-size:
    // 1.75rem }` grande por especificidade. O invariante correto é: É
    // heading (tagName H1) E está pequeno (fontSize), nunca só um dos dois.
    await autenticar(page);
    const header = page.locator(".tela-alocacao > header.breadcrumb");
    const eyebrow = header.locator(".eyebrow");
    await expect(eyebrow).toHaveText("Alocação");
    const info = await eyebrow.evaluate((el) => ({
      tag: el.tagName,
      fontSize: getComputedStyle(el).fontSize,
    }));
    expect(info.tag).toBe("H1");
    expect(info.fontSize).toBe("11px");
    // topo não repete patrimônio nem "N categorias" (igual às demais telas)
    await expect(page.locator(".tela-alocacao .aloca-top__valor")).toHaveCount(0);
    await expect(page.locator(".tela-alocacao .aloca-top__sub")).toHaveCount(0);
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
