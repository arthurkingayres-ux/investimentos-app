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

// Card por nome de categoria (header.aloca-cat__nome).
function cardPorNome(page: Page, nome: string) {
  return page.locator(".tela-alocacao .aloca-cat", {
    has: page.locator(".aloca-cat__nome", { hasText: nome }),
  });
}

test.describe("Aloca colapso por categoria (7a.E.31)", () => {
  test("todas as categorias começam fechadas", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#alocacao");
    const heads = page.locator(".tela-alocacao .aloca-cat__head");
    const n = await heads.count();
    expect(n).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < n; i++) {
      await expect(heads.nth(i)).toHaveAttribute("aria-expanded", "false");
    }
    await expect(page.locator(".tela-alocacao .aloca-cat__body").first()).toBeHidden();
  });

  test("clique no header abre (corpo visível, aria-expanded=true)", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#alocacao");
    const card = cardPorNome(page, "Ações BR");
    await card.locator(".aloca-cat__head").click();
    await expect(card.locator(".aloca-cat__head")).toHaveAttribute("aria-expanded", "true");
    await expect(card.locator(".aloca-cat__body")).toBeVisible();
  });

  test("segundo clique fecha de novo", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#alocacao");
    const card = cardPorNome(page, "Ações BR");
    await card.locator(".aloca-cat__head").click();
    await expect(card.locator(".aloca-cat__body")).toBeVisible();
    await card.locator(".aloca-cat__head").click();
    await expect(card.locator(".aloca-cat__head")).toHaveAttribute("aria-expanded", "false");
    await expect(card.locator(".aloca-cat__body")).toBeHidden();
  });

  test("estados independentes: abrir uma categoria não abre as outras", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#alocacao");
    const acoes = cardPorNome(page, "Ações BR");
    const eua = cardPorNome(page, "EUA");
    await acoes.locator(".aloca-cat__head").click();
    await expect(acoes.locator(".aloca-cat__body")).toBeVisible();
    await expect(eua.locator(".aloca-cat__head")).toHaveAttribute("aria-expanded", "false");
    await expect(eua.locator(".aloca-cat__body")).toBeHidden();
  });

  test("mantém estado ao trocar de aba (categoria aberta persiste)", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#alocacao");
    const acoes = cardPorNome(page, "Ações BR");
    await acoes.locator(".aloca-cat__head").click();
    await expect(acoes.locator(".aloca-cat__body")).toBeVisible();
    // navega para outra aba e volta
    await page.goto("/#rentabilidade");
    await expect(page.locator(".tela-rentabilidade, .tela-detalhes").first()).toBeVisible();
    await page.goto("/#alocacao");
    // Ações BR continua aberta (estado vive em memória Alpine, não resetou)
    await expect(acoes.locator(".aloca-cat__head")).toHaveAttribute("aria-expanded", "true");
    await expect(acoes.locator(".aloca-cat__body")).toBeVisible();
  });

  test("reload reseta tudo para fechado (não-persistente)", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#alocacao");
    const acoes = cardPorNome(page, "Ações BR");
    await acoes.locator(".aloca-cat__head").click();
    await expect(acoes.locator(".aloca-cat__body")).toBeVisible();
    await page.reload();
    await expect(page.locator(".tela-alocacao")).toBeVisible();
    await expect(
      page.locator(".tela-alocacao .aloca-cat__head").first(),
    ).toHaveAttribute("aria-expanded", "false");
  });
});
