import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

const FIXTURE = fs.readFileSync(
  path.join(__dirname, "../fixtures/portfolio.test.json.enc"),
  "utf-8",
);

test.use({ viewport: { width: 390, height: 844 } });

async function abrirPolitica(page: Page) {
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
  await page.goto("/#politica");
  await expect(page.locator(".tela-politica")).toBeVisible();
  await expect(page.locator(".politica-card").first()).toBeVisible();
}

test.describe("Tela #politica", () => {
  test("renderiza cards das categorias sem horizontal scroll em iPhone retrato", async ({ page }) => {
    await abrirPolitica(page);
    const cards = await page.locator(".politica-card").count();
    expect(cards).toBeGreaterThan(0);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth
    );
    expect(overflow).toBe(false);
  });

  test("toggle expande/colapsa e persiste em localStorage", async ({ page }) => {
    await abrirPolitica(page);
    const firstCard = page.locator(".politica-card").first();
    const firstHeader = firstCard.locator(".politica-header");
    await expect(firstCard).toHaveAttribute("data-collapsed", "false");
    await firstHeader.click();
    await expect(firstCard).toHaveAttribute("data-collapsed", "true");
    const stored = await page.evaluate(() => {
      const keys = Object.keys(localStorage).filter((k) =>
        k.startsWith("politica.collapsed.")
      );
      return keys.length > 0 ? localStorage.getItem(keys[0]) : null;
    });
    expect(stored).toBe("true");
  });

  test("status pills usam texto + ícone direcional", async ({ page }) => {
    await abrirPolitica(page);
    const labels = await page.locator(".politica-pill").allTextContents();
    const matches = labels.filter((t) =>
      /aportar|esperar|fora da política|no alvo/i.test(t)
    );
    expect(matches.length).toBeGreaterThan(0);
  });

  test("nota aparece como 'Nota X/N' numérico nos ativos", async ({ page }) => {
    await abrirPolitica(page);
    // Pelo menos um ativo da grade deve mostrar a nota numericamente.
    const notaTexts = await page.locator(".politica-nota").allTextContents();
    expect(notaTexts.length).toBeGreaterThan(0);
    expect(notaTexts.some((t) => /Nota \d+\/\d+/.test(t))).toBe(true);
  });

  test("link 'Ver política' em #alocacao navega para #politica", async ({ page }) => {
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
    await page.goto("/#alocacao");
    await expect(page.locator(".tela-alocacao")).toBeVisible();
    await page.locator(".alocacao-politica-link").click();
    await expect(page.locator(".tela-politica")).toBeVisible();
  });
});
