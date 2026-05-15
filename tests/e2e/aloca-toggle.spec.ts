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
    const ativo = page.locator(".aloca-segmented button[aria-pressed='true']");
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
});
