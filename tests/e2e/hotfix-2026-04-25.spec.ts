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
}

test.describe("Hotfix 2026-04-25", () => {
  test("Raio X não exibe interpretação seleção/timing (removida da tela de Rentabilidade na 7a.E.15)", async ({ page }) => {
    await autenticar(page);
    await expect(page.locator(".raiox .rent-interpretacao")).toHaveCount(0);
    await expect(page.locator(".interpretacao")).toHaveCount(0);
  });

  test("Alocação aplica classe dot-acoes-br à classe Ações BR", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#alocacao");
    await expect(page.locator(".tela-alocacao")).toBeVisible();
    const dot = page.locator(
      '.tela-alocacao .classe-row[data-classe="Ações BR"] .classe-dot',
    );
    await expect(dot).toHaveClass(/\bdot-acoes-br\b/);
  });
});
