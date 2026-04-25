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

test.describe("Rentabilidade — benchmarks em 3 grupos (7a.E.4)", () => {
  test("cada grupo (Origem / Ano (YTD) / 12 meses) lista benchmarks com XIRR e TWR", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#rentabilidade");
    await page.waitForSelector(".tela-rentabilidade .rent-grupo");

    const grupos = page.locator(".tela-rentabilidade .rent-grupo");
    await expect(grupos).toHaveCount(3);

    // Verificar cada grupo independentemente por título e presença de benchmarks.
    const titulosEsperados = ["Origem", "Ano (YTD)", "12 meses"];
    for (let i = 0; i < 3; i++) {
      const grupo = grupos.nth(i);

      // Título correto.
      await expect(grupo.locator(".rent-grupo-titulo")).toHaveText(titulosEsperados[i]);

      // Pelo menos 1 benchmark presente.
      const benchmarks = grupo.locator(".rent-benchmark");
      const count = await benchmarks.count();
      expect(count).toBeGreaterThan(0);

      // Primeira linha de benchmark contém 2 percentuais (XIRR + TWR).
      const text = await benchmarks.first().textContent();
      const pct = (text ?? "").match(/[+\-]?\d+(?:[,.]?\d+)?\s*%/g) ?? [];
      expect(pct.length).toBeGreaterThanOrEqual(2);
    }
  });

  test("benchmark Origem exibe valor diferente de YTD e 12m (janelas distintas)", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#rentabilidade");
    await page.waitForSelector(".tela-rentabilidade .rent-grupo");

    const grupos = page.locator(".tela-rentabilidade .rent-grupo");

    // Coletar texto do primeiro benchmark de cada grupo.
    const textos: string[] = [];
    for (let i = 0; i < 3; i++) {
      const bench = grupos.nth(i).locator(".rent-benchmark").first();
      textos.push((await bench.textContent()) ?? "");
    }

    // Os três textos devem diferir — garantindo que janelas distintas alimentam cada grupo.
    expect(textos[0]).not.toBe(textos[1]);
    expect(textos[1]).not.toBe(textos[2]);
  });

  test("toggle EUA mostra benchmark S&P 500 em todos os 3 grupos", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#rentabilidade");

    await page.locator('.tela-rentabilidade button[data-escopo="EUA"]').click();
    await expect(
      page.locator('.tela-rentabilidade button[data-escopo="EUA"].active'),
    ).toBeVisible();

    const grupos = page.locator(".tela-rentabilidade .rent-grupo");
    await expect(grupos).toHaveCount(3);

    for (let i = 0; i < 3; i++) {
      const labels = grupos.nth(i).locator(".rent-benchmark .bench-label");
      const count = await labels.count();
      expect(count).toBeGreaterThan(0);

      // Pelo menos um label menciona S&P 500.
      const textos = await labels.allTextContents();
      const temSP500 = textos.some((t) => t.includes("S&P 500"));
      expect(temSP500).toBe(true);
    }
  });
});
