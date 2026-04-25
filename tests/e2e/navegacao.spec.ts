import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

const FIXTURE = fs.readFileSync(
  path.join(__dirname, "../fixtures/portfolio.test.json.enc"),
  "utf-8",
);

async function mockPortfolio(page: Page) {
  await page.route("**/portfolio.json.enc", (route) =>
    route.fulfill({ status: 200, body: FIXTURE, contentType: "text/plain" }),
  );
}

async function autenticar(page: Page) {
  await mockPortfolio(page);
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

test.describe("Navegacao hash routing", () => {
  test("hash invalido cai em raio-x e limpa hash da URL", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#hashinvalido");
    await expect(page.locator(".raiox")).toBeVisible();
    expect(await page.evaluate(() => location.hash)).toBe("");
  });

  test("botao Voltar leva de #rentabilidade para raio-x", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#rentabilidade");
    await expect(page.locator(".tela-rentabilidade")).toBeVisible();
    await page
      .locator('.tela-rentabilidade button[aria-label="Voltar"]')
      .click();
    await expect(page.locator(".raiox")).toBeVisible();
  });

  test("history.back() respeita hash entre rotas", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#rentabilidade");
    await page.goto("/#alocacao");
    await page.goBack();
    await expect(page.locator(".tela-rentabilidade")).toBeVisible();
    expect(await page.evaluate(() => location.hash)).toBe("#rentabilidade");
  });

  test("reload em #alocacao mantem rota", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#alocacao");
    await page.reload();
    await expect(page.locator(".tela-alocacao")).toBeVisible();
  });

  test("raio-x mostra benchmark com prefixo 'vs' compactado em 2-col", async ({ page }) => {
    await autenticar(page);
    await expect(page.locator(".raiox")).toBeVisible();

    // Pegar a primeira linha de benchmark do escopo Total.
    const benchmarks = page.locator(".raiox .rent-benchmark");
    await expect(benchmarks.first()).toBeVisible();

    // Label deve começar com "vs ".
    const primeiroLabel = benchmarks.first().locator(".bench-label");
    await expect(primeiroLabel).toContainText("vs ");

    // 2 spans diretos: label + bench-valor (sr-only é descendant de bench-valor).
    const spansDaPrimeira = benchmarks.first().locator(":scope > span");
    await expect(spansDaPrimeira).toHaveCount(2);
  });

  test("raio-x não exibe colunas YTD ou 12m no card de Rentabilidade", async ({ page }) => {
    await autenticar(page);
    await expect(page.locator(".raiox")).toBeVisible();

    // rent-cols-head foi removido do raio-x.
    await expect(page.locator(".raiox .rent-cols-head")).toHaveCount(0);

    // .rent-linha do raio-x agora tem só 2 filhos diretos (label + chip).
    const linhasRaiox = page.locator(".raiox .rent-linha");
    const count = await linhasRaiox.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(linhasRaiox.nth(i).locator(":scope > span")).toHaveCount(2);
    }
  });

  test("raio-x não exibe benchmarks YTD ou 12m — Origem-only (proteção 7a.E.3 + 7a.E.4)", async ({ page }) => {
    await autenticar(page);
    await expect(page.locator(".raiox")).toBeVisible();

    const benchmarks = page.locator(".raiox .rent-benchmark");
    const count = await benchmarks.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const text = await benchmarks.nth(i).textContent();
      const pct = (text ?? "").match(/[+\-]?\d+(?:[,.]?\d+)?\s*%/g) ?? [];
      // Raio-x mostra APENAS Origem — máximo 1 percentual por linha de benchmark.
      expect(pct.length).toBeLessThanOrEqual(1);
    }
  });

  test("raio-x card alocação não prepend '+' em pct atual ou alvo", async ({ page }) => {
    await autenticar(page);
    await expect(page.locator(".raiox")).toBeVisible();

    // Card raio-x: percentual atual + alvo de cada classe.
    const atuais = await page.locator(".raiox .aloc-valores .atual").allTextContents();
    expect(atuais.length).toBeGreaterThan(0);
    for (const t of atuais) {
      expect(t.startsWith("+"), `aloc atual com '+': ${t}`).toBe(false);
    }

    const alvos = await page.locator(".raiox .aloc-valores .alvo").allTextContents();
    for (const t of alvos) {
      expect(t.includes("+"), `aloc alvo com '+': ${t}`).toBe(false);
    }
  });

  test("hash #proventos é rota válida (não cai no fallback do Raio-X)", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#proventos");
    await expect(page.locator(".tela-proventos")).toBeVisible({ timeout: 10_000 });
    expect(page.url()).toMatch(/#proventos$/);
  });
});
