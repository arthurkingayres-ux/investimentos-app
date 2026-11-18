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
  // 7a.CC: a tela não tem mais cabeçalho próprio visível. A abertura é o
  // eyebrow do grupo (Carteira, 11px) no .grupo-cab, e "Alocação" fica como h1
  // só para leitor de tela e como item ativo da faixa. (Antes: .breadcrumb
  // com .eyebrow h1 "Alocação".)
  test("abre com o eyebrow do grupo Carteira; h1 Alocação só para leitor de tela (sem patrimônio)", async ({ page }) => {
    // 7a.S.4: a voz única de abertura de tela é .eyebrow. CRB: .eyebrow
    // voltou a ser <h1> (heading semantics para leitor de tela), mas
    // estilizado pequeno (11px) — a classe vence a regra `h1 { font-size:
    // 1.75rem }` grande por especificidade. O invariante correto é: É
    // heading (tagName H1) E está pequeno (fontSize), nunca só um dos dois.
    await autenticar(page);
    const eyebrow = page.locator(".grupo-cab .eyebrow");
    await expect(eyebrow).toHaveText("Carteira");
    expect(await eyebrow.evaluate((el) => getComputedStyle(el).fontSize)).toBe("11px");
    const titulo = page.locator(".tela-alocacao > h1");
    await expect(titulo).toHaveText("Alocação");
    await expect(titulo).toHaveClass(/\bsr-only\b/);
    await expect(page.locator(".grupo-cab nav [aria-current='page']")).toHaveText("Alocação");
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

  test("header mostra nome + R$ da categoria; rodapé mostra estado e faixa", async ({ page }) => {
    await autenticar(page);
    const card = page.locator(".tela-alocacao .aloca-cat").first();
    await expect(card.locator(".aloca-cat__nome")).toBeVisible();
    const rs = await card.locator(".aloca-cat__rs-valor").textContent();
    expect(rs?.trim()).toMatch(/R\$\s?\d/);
    // 7a.BK.1: Ações BR 0,30/0,272 — tolerância 0,03, faixa 27% a 33%.
    const acoes = page.locator(".tela-alocacao .aloca-cat", {
      has: page.locator(".aloca-cat__nome", { hasText: "Ações BR" }),
    });
    await expect(acoes.locator('[data-testid="aloca-cat-estado"]')).toHaveText("Na faixa");
    await expect(acoes.locator('[data-testid="aloca-cat-faixa"]')).toHaveText(
      "alvo 30,0% · faixa 27,0% a 33,0%",
    );
  });

  test("clicar no header expande o corpo com os grupos", async ({ page }) => {
    await autenticar(page);
    const card = page.locator(".tela-alocacao .aloca-cat").first();
    await card.locator(".aloca-cat__head").click();
    await expect(card.locator(".aloca-cat__head")).toHaveAttribute("aria-expanded", "true");
    await expect(card.locator(".aloca-cat__body")).toBeVisible();
    await expect(card.locator(".aloca-grupo").first()).toBeVisible();
  });

  test("clicar num ativo dentro do card navega para #ativo/:ticker", async ({ page }) => {
    await autenticar(page);
    const card = page.locator(".tela-alocacao .aloca-cat").first();
    await card.locator(".aloca-cat__head").click();
    await card.locator(".aloca-ativo, .aloca-etq").first().click();
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
