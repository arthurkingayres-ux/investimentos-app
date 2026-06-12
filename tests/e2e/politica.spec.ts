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
  await expect(page.locator(".tela-alocacao .aloca-alvo__cesta").first()).toBeVisible();
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

  test("hierarquia v3: cada card expandido exibe cestas + ativos", async ({ page }) => {
    await abrirPolitica(page);
    const firstCard = page.locator(".tela-alocacao .aloca-cat").first();
    const cestas = firstCard.locator(".aloca-alvo__cesta");
    await expect(cestas.first()).toBeVisible();
    const lista = page.locator(".tela-alocacao .aloca-lista");
    const labels = await lista.locator(".aloca-alvo__clabel").allTextContents();
    expect(labels.some((t) => /Cesta passiva|Cesta de picks/i.test(t))).toBe(true);
    // Cesta de picks inclui "X ativos · equal-weight" no meta (em alguma categoria)
    const metas = await lista.locator(".aloca-alvo__cmeta").allTextContents();
    expect(metas.some((t) => /\d+\s+ativos\s+·\s+equal-weight/i.test(t))).toBe(true);
    const ativos = lista.locator(".aloca-alvo__cesta .aloca-alvo__ativo");
    expect(await ativos.count()).toBeGreaterThan(0);
  });

  test("delta pills usam mono ± pp + seta direcional (↑ aportar / ↓ acima)", async ({ page }) => {
    await abrirPolitica(page);
    const labels = await page.locator(".tela-alocacao .aloca-alvo__delta").allTextContents();
    expect(labels.length).toBeGreaterThan(0);
    const directionais = labels.filter((t) => /↑|↓/.test(t));
    expect(directionais.length).toBeGreaterThan(0);
    const ppPattern = labels.filter((t) => /[+−]?\d{1,3},\d{2}\s+pp/.test(t));
    expect(ppPattern.length).toBeGreaterThan(0);
  });

  test("labels 'bucket' (jargão tech) não aparecem na UI", async ({ page }) => {
    await abrirPolitica(page);
    const visibleText = await page.locator(".tela-alocacao .aloca-lista").innerText();
    expect(visibleText.toLowerCase()).not.toMatch(/\bbucket\b/);
  });
});
