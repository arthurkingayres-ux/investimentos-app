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

test.describe("Aloca toggle Atual/Alvo (7a.I.4)", () => {
  test("default sem query mostra view Atual", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#alocacao");
    await expect(page.locator(".tela-alocacao")).toBeVisible();
    const ativo = page.locator(".aloca-segmented button[aria-selected='true']");
    await expect(ativo).toHaveText("Atual");
    await expect(page.locator(".tela-alocacao .alocacao-card")).toBeVisible();
    await expect(page.locator(".tela-alocacao .politica-card").first()).toBeHidden();
  });

  test("clicar Alvo troca view e atualiza URL", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#alocacao");
    await page.locator(".aloca-segmented button", { hasText: "Alvo" }).click();
    await expect(page).toHaveURL(/#alocacao\?v=alvo$/);
    await expect(page.locator(".tela-alocacao .politica-card").first()).toBeVisible();
    await expect(page.locator(".tela-alocacao .alocacao-card")).toBeHidden();
  });

  test("clicar Atual volta e atualiza URL", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#alocacao?v=alvo");
    await expect(page.locator(".tela-alocacao .politica-card").first()).toBeVisible();
    await page.locator(".aloca-segmented button", { hasText: "Atual" }).click();
    await expect(page).toHaveURL(/#alocacao\?v=atual$/);
    await expect(page.locator(".tela-alocacao .alocacao-card")).toBeVisible();
  });

  test("legacy #politica redireciona para #alocacao?v=alvo", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#politica");
    await expect(page).toHaveURL(/#alocacao\?v=alvo$/);
    await expect(page.locator(".tela-alocacao")).toBeVisible();
    await expect(page.locator(".tela-alocacao .politica-card").first()).toBeVisible();
  });

  test("chip 'política' do raio-x leva para Alvo", async ({ page }) => {
    await autenticar(page);
    await page.locator('.chip-stat[aria-label="Política de alocação"]').click();
    await expect(page).toHaveURL(/#alocacao\?v=alvo$/);
    await expect(page.locator(".tela-alocacao .politica-card").first()).toBeVisible();
  });

  test("cold-start submitPin em #alocacao?v=alvo abre tudo fechado", async ({ page }) => {
    // 7a.I.4 finding iter 3: mesmo bug de cold-start, mas no caminho submitPin
    // (sem PIN em localStorage; usuário digita PIN após landing em #alocacao?v=alvo).
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
    const firstCard = page.locator(".tela-alocacao .politica-card").first();
    await expect(firstCard).toBeVisible({ timeout: 5000 });
    await expect(firstCard).toHaveAttribute("data-collapsed", "true");
  });

  test("cold-start em #alocacao?v=alvo abre tudo fechado", async ({ page }) => {
    // 7a.I.4 finding iter 2: atualizarRota dispara hidratarColapsoPolitica antes
    // do JSON carregar (init → atualizarRota → tentarAutoResume). Sem o re-call
    // pós-resume, collapsedPolitica fica {} e cards renderizam expandidos.
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
    const firstCard = page.locator(".tela-alocacao .politica-card").first();
    await expect(firstCard).toBeVisible();
    await expect(firstCard).toHaveAttribute("data-collapsed", "true");
  });
});
