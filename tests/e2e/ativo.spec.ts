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

test.describe("Tela #ativo/:ticker", () => {
  test("HGLG11 mostra header + KPIs", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#ativo/HGLG11");
    await expect(page.locator(".tela-ativo .ticker-hero")).toContainText("HGLG11");
    await expect(page.locator(".tela-ativo .kpi-grid")).toBeVisible();
  });

  test("HGLG11 renderiza tabelas de movimentos e proventos com conteúdo do fixture", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#ativo/HGLG11");

    // Tabela de movimentos: HGLG11 do fixture tem 2 entradas (2026-04-15, 2026-03-10)
    // 7a.E.1 Bloco 4: lado "Compra" passa a renderizar como pill "B" (full word
    // preservada via :title="m.lado").
    const linhasMov = page.locator(".tela-ativo .tabela-movimentos tbody tr");
    await expect(linhasMov.first()).toBeVisible();
    await expect(linhasMov.first()).toContainText("2026-04-15");
    await expect(linhasMov.first().locator(".lado-pill")).toHaveText("B");
    await expect(linhasMov.first().locator(".lado-pill")).toHaveAttribute("title", "Compra");
    await expect(linhasMov.nth(1)).toContainText("2026-03-10");

    // Tabela de proventos: 2 entradas (2026-04-05, 2026-03-05) tipo "Rendimento"
    const linhasProv = page.locator(".tela-ativo .tabela-proventos tbody tr");
    await expect(linhasProv.first()).toBeVisible();
    await expect(linhasProv.first()).toContainText("2026-04-05");
    await expect(linhasProv.first()).toContainText("Rendimento");
    await expect(linhasProv.nth(1)).toContainText("2026-03-05");
  });

  test("movimentos com header 12m e coluna Lado abreviada (7a.E.1 Bloco 4)", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#ativo/HGLG11");

    // Headers das seções incluem "últimos 12 meses" (alinha com filtro
    // backend Task 2).
    const secMov = page.locator(".tela-ativo h3.ativo-section-h", {
      hasText: "Movimentos",
    });
    await expect(secMov).toContainText("últimos 12 meses");
    const secProv = page.locator(".tela-ativo h3.ativo-section-h", {
      hasText: "Proventos",
    });
    await expect(secProv).toContainText("últimos 12 meses");

    // Pelo menos uma pill .lado-pill renderizada com texto B ou S
    // (HGLG11 fixture tem 2 Compras → 2 pills "B").
    const ladoPills = page.locator(".tela-ativo .lado-pill");
    expect(await ladoPills.count()).toBeGreaterThan(0);
    const textos = await ladoPills.allTextContents();
    expect(textos.some((t) => t === "B" || t === "S")).toBe(true);
  });

  test("ticker desconhecido (FOO3) mostra fallback de não-encontrado", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#ativo/FOO3");
    await expect(page.locator(".tela-ativo .erro-nao-encontrado")).toContainText("FOO3");
  });

  test("hash com chars inválidos redireciona para raio-x", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#ativo/INVALID.CHARS");
    await expect(page.locator(".raiox")).toBeVisible();
    expect(await page.evaluate(() => location.hash)).toBe("");
  });
});
