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

// Lê "12,3 %" / "1,8%" -> 1.8 (number). Vírgula decimal pt-BR.
function parsePct(txt: string): number {
  const m = txt.replace(/\s/g, "").replace("%", "").replace(",", ".");
  return parseFloat(m);
}

function assertNaoCrescente(valores: number[]) {
  for (let i = 1; i < valores.length; i++) {
    expect(valores[i]).toBeLessThanOrEqual(valores[i - 1]);
  }
}

test.describe("Ordenação decrescente #alocacao (7a.E.29)", () => {
  test("vista Atual ordena classes por % atual decrescente", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#alocacao");
    // 7a.E.30: abrir a seção colapsável da vista Atual.
    await page
      .locator(".tela-alocacao .aloca-vista:not(.aloca-alvo__list) .aloca-secao-head")
      .click();
    await expect(page.locator(".tela-alocacao .alocacao-card")).toBeVisible();
    // Coleta o primeiro span de cada .classe-pct (o número-headline da classe).
    const textos = await page.$$eval(
      ".tela-alocacao .classe-bloco .classe-pct > span:first-child",
      (els) => els.map((e) => (e.textContent || "").trim()),
    );
    expect(textos.length).toBeGreaterThan(1);
    assertNaoCrescente(textos.map(parsePct));
  });

  test("vista Alvo ordena categorias por % alvo decrescente", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#alocacao?v=alvo");
    // 7a.E.30: abrir a seção colapsável da vista Alvo.
    await page.locator(".tela-alocacao .aloca-alvo__list .aloca-secao-head").click();
    await expect(
      page.locator(".tela-alocacao .aloca-alvo__card").first(),
    ).toBeVisible();
    const textos = await page.$$eval(
      ".tela-alocacao .aloca-alvo__card .aloca-alvo__alvo-big",
      (els) => els.map((e) => (e.textContent || "").trim()),
    );
    expect(textos.length).toBeGreaterThan(1);
    assertNaoCrescente(textos.map(parsePct));
  });
});
