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

// Cabeçalho da seção da vista Atual (escopo: .aloca-vista que NÃO é a lista alvo)
function headAtual(page: Page) {
  return page.locator(
    ".tela-alocacao .aloca-vista:not(.aloca-alvo__list) .aloca-secao-head",
  );
}
function headAlvo(page: Page) {
  return page.locator(".tela-alocacao .aloca-alvo__list .aloca-secao-head");
}

test.describe("Aloca toggle Atual/Alvo (7a.I.4)", () => {
  test("default sem query mostra view Atual (seção fechada)", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#alocacao");
    await expect(page.locator(".tela-alocacao")).toBeVisible();
    const ativo = page.locator(".aloca-segmented button[aria-selected='true']");
    await expect(ativo).toHaveText("Atual");
    // Cabeçalho visível, conteúdo oculto até clicar
    await expect(headAtual(page)).toBeVisible();
    await expect(headAtual(page)).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".tela-alocacao .alocacao-card")).toBeHidden();
  });

  test("clicar Alvo troca view e atualiza URL (seção alvo fechada)", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#alocacao");
    await page.locator(".aloca-segmented button", { hasText: "Alvo" }).click();
    await expect(page).toHaveURL(/#alocacao\?v=alvo$/);
    // Card alvo continua oculto até abrir a seção
    await expect(page.locator(".tela-alocacao .aloca-alvo__card").first()).toBeHidden();
    await headAlvo(page).click();
    await expect(page.locator(".tela-alocacao .aloca-alvo__card").first()).toBeVisible();
  });

  test("clicar Atual volta e atualiza URL", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#alocacao?v=alvo");
    await expect(headAlvo(page)).toBeVisible();
    await page.locator(".aloca-segmented button", { hasText: "Atual" }).click();
    await expect(page).toHaveURL(/#alocacao\?v=atual$/);
    await expect(headAtual(page)).toBeVisible();
    await expect(headAtual(page)).toHaveAttribute("aria-expanded", "false");
  });

  test("legacy #politica redireciona para #alocacao?v=alvo", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#politica");
    await expect(page).toHaveURL(/#alocacao\?v=alvo$/);
    await expect(page.locator(".tela-alocacao")).toBeVisible();
    await expect(headAlvo(page)).toBeVisible();
  });

  test("cold-start submitPin em #alocacao?v=alvo: abre seção renderiza cards", async ({ page }) => {
    await page.route("**/portfolio.json.enc", (route) =>
      route.fulfill({
        status: 200,
        body: fs.readFileSync(
          path.join(__dirname, "../fixtures/portfolio.test.json.enc"),
          "utf-8",
        ),
        contentType: "text/plain",
      }),
    );
    // Não pré-seedar PIN — força fluxo submitPin.
    await page.goto("/#alocacao?v=alvo");
    await expect(page.locator(".pin-screen")).toBeVisible({ timeout: 10_000 });
    await page.locator("input.pin-input").fill("123456");
    await page.locator("button.pin-submit").click();
    await expect(headAlvo(page)).toBeVisible({ timeout: 5000 });
    await headAlvo(page).click();
    const firstCard = page.locator(".tela-alocacao .aloca-alvo__card").first();
    await expect(firstCard).toBeVisible({ timeout: 5000 });
  });

  test("cold-start em #alocacao?v=alvo: abre seção renderiza cards", async ({ page }) => {
    await page.route("**/portfolio.json.enc", (route) =>
      route.fulfill({
        status: 200,
        body: fs.readFileSync(
          path.join(__dirname, "../fixtures/portfolio.test.json.enc"),
          "utf-8",
        ),
        contentType: "text/plain",
      }),
    );
    await page.addInitScript(() => {
      localStorage.setItem("pin", "123456");
      localStorage.setItem(
        "pinTimestamp",
        String(Date.now() - 1 * 24 * 60 * 60 * 1000),
      );
    });
    await page.goto("/#alocacao?v=alvo");
    await expect(headAlvo(page)).toBeVisible();
    await headAlvo(page).click();
    const firstCard = page.locator(".tela-alocacao .aloca-alvo__card").first();
    await expect(firstCard).toBeVisible();
  });
});

test.describe("Aloca seção colapsável (7a.E.30)", () => {
  test("seção Atual começa fechada", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#alocacao");
    await expect(headAtual(page)).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".tela-alocacao .alocacao-card")).toBeHidden();
  });

  test("clique no cabeçalho abre (card visível, aria-expanded=true)", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#alocacao");
    await headAtual(page).click();
    await expect(headAtual(page)).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".tela-alocacao .alocacao-card")).toBeVisible();
  });

  test("segundo clique fecha de novo", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#alocacao");
    await headAtual(page).click();
    await expect(page.locator(".tela-alocacao .alocacao-card")).toBeVisible();
    await headAtual(page).click();
    await expect(headAtual(page)).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".tela-alocacao .alocacao-card")).toBeHidden();
  });

  test("estados independentes: abrir Atual não afeta Alvo", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#alocacao");
    await headAtual(page).click();
    await expect(page.locator(".tela-alocacao .alocacao-card")).toBeVisible();
    // troca para Alvo: seção Alvo segue fechada (estado inicial false)
    await page.locator(".aloca-segmented button", { hasText: "Alvo" }).click();
    await expect(headAlvo(page)).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".tela-alocacao .aloca-alvo__card").first()).toBeHidden();
  });

  test("mantém estado ao trocar de aba (Atual aberta persiste)", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#alocacao");
    await headAtual(page).click();
    await expect(page.locator(".tela-alocacao .alocacao-card")).toBeVisible();
    await page.locator(".aloca-segmented button", { hasText: "Alvo" }).click();
    await expect(headAlvo(page)).toBeVisible();
    await page.locator(".aloca-segmented button", { hasText: "Atual" }).click();
    // Atual continua aberta (não resetou ao trocar de aba)
    await expect(headAtual(page)).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".tela-alocacao .alocacao-card")).toBeVisible();
  });
});
