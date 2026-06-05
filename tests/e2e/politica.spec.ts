import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

const FIXTURE = fs.readFileSync(
  path.join(__dirname, "../fixtures/portfolio.test.json.enc"),
  "utf-8",
);

test.use({ viewport: { width: 390, height: 844 } });

// 7a.I.4: a antiga `tela-politica` foi fundida na tab Aloca via segmented
// toggle Atual/Alvo. Os testes abaixo navegam por `#politica` (shim legado)
// que redireciona para `#alocacao?v=alvo`.
// 7a.E.23: a vista Alvo foi reescrita; cards sempre expandidos, sem accordion.
// Selectors agora são `.aloca-alvo__*` em vez de `.politica-*`.
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
  await expect(page.locator(".tela-alocacao")).toBeVisible();
  await expect(page.locator(".tela-alocacao .aloca-alvo__card").first()).toBeVisible();
}

test.describe("Política (view Alvo dentro de #alocacao)", () => {
  test("renderiza cards das categorias sem horizontal scroll em iPhone retrato", async ({ page }) => {
    await abrirPolitica(page);
    const cards = await page.locator(".tela-alocacao .aloca-alvo__card").count();
    expect(cards).toBeGreaterThan(0);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth
    );
    expect(overflow).toBe(false);
  });

  test("hierarquia v3 (7a.E.23): cada card exibe cestas + ativos sempre expandidos", async ({ page }) => {
    await abrirPolitica(page);
    // 7a.E.29: a vista Alvo ordena os cards por peso_alvo; o primeiro card no
    // DOM não é mais garantidamente uma categoria com cesta de picks. Verifico
    // a estrutura no primeiro card (cesta visível) e os marcadores de picks
    // (label "Cesta de picks" + meta "equal-weight") na lista inteira.
    const firstCard = page.locator(".tela-alocacao .aloca-alvo__card").first();
    const cestas = firstCard.locator(".aloca-alvo__cesta");
    await expect(cestas.first()).toBeVisible();
    const lista = page.locator(".tela-alocacao .aloca-alvo__list");
    const labels = await lista.locator(".aloca-alvo__clabel").allTextContents();
    expect(labels.some((t) => /Cesta passiva|Cesta de picks/i.test(t))).toBe(true);
    // Cesta de picks inclui "X ativos · equal-weight" no meta (em alguma categoria)
    const metas = await lista.locator(".aloca-alvo__cmeta").allTextContents();
    expect(metas.some((t) => /\d+\s+ativos\s+·\s+equal-weight/i.test(t))).toBe(true);
    // Ativos dentro das cestas do primeiro card
    const ativos = firstCard.locator(".aloca-alvo__cesta .aloca-alvo__ativo");
    expect(await ativos.count()).toBeGreaterThan(0);
  });

  test("delta pills usam mono ± pp + seta direcional (↑ aportar / ↓ acima)", async ({ page }) => {
    await abrirPolitica(page);
    const labels = await page.locator(".tela-alocacao .aloca-alvo__delta").allTextContents();
    expect(labels.length).toBeGreaterThan(0);
    // Pelo menos um delta com ↑ (precisa aportar) ou ↓ (acima do alvo) deve existir
    const directionais = labels.filter((t) => /↑|↓/.test(t));
    expect(directionais.length).toBeGreaterThan(0);
    // Texto pp segue padrão pt-BR com vírgula
    const ppPattern = labels.filter((t) => /[+−]?\d{1,3},\d{2}\s+pp/.test(t));
    expect(ppPattern.length).toBeGreaterThan(0);
  });

  test("labels 'bucket' (jargão tech) não aparecem na UI", async ({ page }) => {
    // 7a.E.23 rebrand: backend mantém bucket.tipo, UI usa "Cesta passiva/de picks".
    await abrirPolitica(page);
    const visibleText = await page.locator(".tela-alocacao .aloca-alvo__list").innerText();
    // Não pode haver a palavra "bucket" em lugar nenhum do markup renderizado
    expect(visibleText.toLowerCase()).not.toMatch(/\bbucket\b/);
  });
});
