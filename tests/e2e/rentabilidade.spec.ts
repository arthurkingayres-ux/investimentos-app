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

test.describe("Tela #rentabilidade", () => {
  test("renderiza canvas uPlot ao navegar para #rentabilidade", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#rentabilidade");
    await expect(page.locator(".tela-rentabilidade canvas")).toBeVisible();
  });

  test("toggle de escopo Brasil -> EUA atualiza estado e canvas", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#rentabilidade");
    await page.locator('.tela-rentabilidade button[data-escopo="Brasil"]').click();
    await expect(
      page.locator('.tela-rentabilidade button[data-escopo="Brasil"].active'),
    ).toBeVisible();
    await page.locator('.tela-rentabilidade button[data-escopo="EUA"]').click();
    await expect(
      page.locator('.tela-rentabilidade button[data-escopo="EUA"].active'),
    ).toBeVisible();
    // Canvas re-renderizado com nova série mensal do escopo EUA
    await expect(page.locator(".tela-rentabilidade canvas")).toBeVisible();
  });

  test("tabela resumo mostra Origem / Ano / 12m", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#rentabilidade");
    await expect(page.locator(".tela-rentabilidade").getByText("Origem")).toBeVisible();
    await expect(page.locator(".tela-rentabilidade").getByText("Ano")).toBeVisible();
    await expect(page.locator(".tela-rentabilidade").getByText("12m")).toBeVisible();
  });

  test("interpretacao automática aparece para escopo Total", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#rentabilidade");
    await page.locator('.tela-rentabilidade button[data-escopo="Total"]').click();
    await expect(
      page.locator(".tela-rentabilidade .interpretacao"),
    ).toBeVisible();
  });
});
