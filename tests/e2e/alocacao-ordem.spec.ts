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

test.describe("Ordenação #alocacao unificada (7a.E.31)", () => {
  test("categorias ordenadas por peso_alvo decrescente", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#alocacao");
    await expect(page.locator(".tela-alocacao .aloca-cat").first()).toBeVisible();
    // O "alvo Y%" de cada card (foot) é o número de ordenação.
    const textos = await page.$$eval(
      ".tela-alocacao .aloca-cat .aloca-cat__foot-alvo b",
      (els) => els.map((e) => (e.textContent || "").trim()),
    );
    expect(textos.length).toBeGreaterThan(1);
    assertNaoCrescente(textos.map(parsePct));
  });

  test("primeira categoria é a de maior alvo (EUA 70% na fixture)", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#alocacao");
    const primeiro = page.locator(".tela-alocacao .aloca-cat .aloca-cat__nome").first();
    await expect(primeiro).toHaveText("EUA");
  });
});
