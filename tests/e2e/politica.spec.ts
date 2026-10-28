import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

const FIXTURE = fs.readFileSync(
  path.join(__dirname, "../fixtures/portfolio.test.json.enc"),
  "utf-8",
);

test.use({ viewport: { width: 390, height: 844 } });

// 7a.E.31: a antiga `tela-politica` e o segmented Atual/Alvo foram fundidos
// numa vista única `#alocacao`. `#politica` (shim legado) redireciona para
// `#alocacao`. As cestas/ativos vivem no corpo colapsável de cada card —
// abrimos todos os cards para inspecionar a hierarquia inteira.
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
  await expect(page).toHaveURL(/#alocacao$/);
  await expect(page.locator(".tela-alocacao .aloca-cat").first()).toBeVisible();
  // Expandir todos os cards de categoria.
  const heads = page.locator(".tela-alocacao .aloca-cat__head");
  const n = await heads.count();
  for (let i = 0; i < n; i++) await heads.nth(i).click();
  await expect(page.locator(".tela-alocacao .aloca-grupo").first()).toBeVisible();
}

test.describe("Política (vista #alocacao unificada)", () => {
  test("renderiza cards das categorias sem horizontal scroll em iPhone retrato", async ({ page }) => {
    await abrirPolitica(page);
    const cards = await page.locator(".tela-alocacao .aloca-cat").count();
    expect(cards).toBeGreaterThan(0);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth
    );
    expect(overflow).toBe(false);
  });

  // 7a.BK.1: o corpo expandido agrupa os ativos por estado (spec §3.4). Os
  // rótulos "Cesta passiva"/"N ativos · equal-weight" e as pílulas "± pp"
  // saíram com as cestas antigas (spec §3.4 e §4(d)/(e)).
  test("cada card expandido exibe grupos por estado com ativos-link", async ({ page }) => {
    await abrirPolitica(page);
    const cards = page.locator(".tela-alocacao .aloca-cat");
    const n = await cards.count();
    for (let i = 0; i < n; i++) {
      await expect(cards.nth(i).locator(".aloca-grupo").first()).toBeVisible();
      expect(await cards.nth(i).locator(".aloca-ativo, .aloca-etq").count()).toBeGreaterThan(0);
    }
    const lista = page.locator(".tela-alocacao .aloca-lista");
    expect(await lista.innerText()).not.toMatch(/\d,\d{2}\s+pp/);
  });

  test("labels 'bucket' (jargão tech) não aparecem na UI", async ({ page }) => {
    await abrirPolitica(page);
    const visibleText = await page.locator(".tela-alocacao .aloca-lista").innerText();
    expect(visibleText.toLowerCase()).not.toMatch(/\bbucket\b/);
  });
});
