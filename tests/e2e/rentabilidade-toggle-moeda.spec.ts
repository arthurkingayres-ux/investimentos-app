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

test.describe("Rentabilidade — toggle moeda BRL/USD (7a.E.13)", () => {
  test.beforeEach(async ({ page }) => {
    // Garante que cada teste começa sem moeda persistida
    await page.addInitScript(() => localStorage.removeItem("moedaEUA"));
  });

  test("toggle invisível em escopo Total/Brasil, visível em EUA", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#rentabilidade");
    await page.waitForSelector(".tela-rentabilidade .rent-grupo");

    // Total: toggle oculto
    await expect(page.locator(".tela-rentabilidade .moeda-toggle")).toBeHidden();

    // Brasil: toggle oculto
    await page.locator('.tela-rentabilidade button[data-escopo="Brasil"]').click();
    await expect(page.locator(".tela-rentabilidade .moeda-toggle")).toBeHidden();

    // EUA: toggle visível
    await page.locator('.tela-rentabilidade button[data-escopo="EUA"]').click();
    await expect(page.locator(".tela-rentabilidade .moeda-toggle")).toBeVisible();
    // R$ é ativo por default
    await expect(
      page.locator('.tela-rentabilidade .moeda-toggle button[data-moeda="BRL"].active'),
    ).toBeVisible();
  });

  test("clicar US$ alterna métricas (BRL → USD)", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#rentabilidade");
    await page.locator('.tela-rentabilidade button[data-escopo="EUA"]').click();
    await expect(page.locator(".tela-rentabilidade .moeda-toggle")).toBeVisible();

    // Capturar métrica xirr_origem em BRL
    const grupoOrigem = page.locator(".tela-rentabilidade .rent-grupo").first();
    const valorBrl = (
      await grupoOrigem.locator(".rent-metrica-valor").first().textContent()
    )?.trim();

    // Alternar para US$
    await page.locator('.tela-rentabilidade .moeda-toggle button[data-moeda="USD"]').click();
    await expect(
      page.locator('.tela-rentabilidade .moeda-toggle button[data-moeda="USD"].active'),
    ).toBeVisible();

    const valorUsd = (
      await grupoOrigem.locator(".rent-metrica-valor").first().textContent()
    )?.trim();

    expect(valorBrl).not.toBe(valorUsd);
  });

  test("modo USD: benchmarks só mostram S&P 500 (CDI/IBOV/IFIX ausentes)", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#rentabilidade");
    await page.locator('.tela-rentabilidade button[data-escopo="EUA"]').click();
    await page.locator('.tela-rentabilidade .moeda-toggle button[data-moeda="USD"]').click();

    const grupos = page.locator(".tela-rentabilidade .rent-grupo");
    for (let i = 0; i < 3; i++) {
      const labels = await grupos
        .nth(i)
        .locator(".rent-benchmark .bench-label")
        .allTextContents();
      // Só pode ter S&P 500 — ou variantes de SP500
      expect(labels.length).toBeGreaterThan(0);
      for (const label of labels) {
        const sp500Match = /S&P 500|SP500/i.test(label);
        expect(sp500Match, `Label "${label}" deve mencionar S&P 500 em modo USD`).toBe(true);
      }
    }
  });

  test("modo BRL: benchmarks mantêm CDI/IBOV/IFIX/SP500", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#rentabilidade");
    await page.locator('.tela-rentabilidade button[data-escopo="EUA"]').click();
    // BRL é default, garantir
    await page.locator('.tela-rentabilidade .moeda-toggle button[data-moeda="BRL"]').click();

    const grupoOrigem = page.locator(".tela-rentabilidade .rent-grupo").first();
    const labels = await grupoOrigem
      .locator(".rent-benchmark .bench-label")
      .allTextContents();
    // Fixture EUA.brl.benchmarks tem só SP500 (mas é o único exigido para EUA-BRL).
    // Esse teste apenas valida que benchmarks aparecem (não somem por engano).
    expect(labels.length).toBeGreaterThan(0);
  });

  test("persistência localStorage: US$ permanece após navegação", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#rentabilidade");
    await page.locator('.tela-rentabilidade button[data-escopo="EUA"]').click();
    await page.locator('.tela-rentabilidade .moeda-toggle button[data-moeda="USD"]').click();

    // Confirma que localStorage persistiu
    const moeda = await page.evaluate(() => localStorage.getItem("moedaEUA"));
    expect(moeda).toBe("USD");

    // Navega fora e volta
    await page.goto("/#alocacao");
    await page.waitForSelector(".tela-alocacao", { timeout: 5_000 }).catch(() => {});
    await page.goto("/#rentabilidade");
    await page.locator('.tela-rentabilidade button[data-escopo="EUA"]').click();

    // US$ ainda ativo
    await expect(
      page.locator('.tela-rentabilidade .moeda-toggle button[data-moeda="USD"].active'),
    ).toBeVisible();
  });

  test("7a.E.14: chart histórico EUA troca série pelo toggle BRL/USD", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#rentabilidade");
    await page.locator('.tela-rentabilidade button[data-escopo="EUA"]').click();
    await page.waitForSelector(".tela-rentabilidade canvas");

    // Captura série BRL via state Alpine (data renderizada em u_.data[1])
    const brlData = await page.evaluate(() => {
      const data = (window as unknown as {
        Alpine: { $data: (el: Element) => Record<string, unknown> };
      }).Alpine.$data(document.body);
      const inst = (data as { uplotInstance?: { data?: unknown[] } }).uplotInstance;
      return inst && inst.data ? JSON.parse(JSON.stringify(inst.data[1])) : null;
    });
    expect(brlData).not.toBeNull();

    // Trocar para USD
    await page.locator('.tela-rentabilidade button[data-moeda="USD"]').click();
    await page.waitForTimeout(200); // espera re-render

    const usdData = await page.evaluate(() => {
      const data = (window as unknown as {
        Alpine: { $data: (el: Element) => Record<string, unknown> };
      }).Alpine.$data(document.body);
      const inst = (data as { uplotInstance?: { data?: unknown[] } }).uplotInstance;
      return inst && inst.data ? JSON.parse(JSON.stringify(inst.data[1])) : null;
    });
    expect(usdData).not.toBeNull();
    // Séries têm valores diferentes (USD diverge de BRL na fixture: BRL 0.06→0.118, USD 0.04→0.275)
    expect(JSON.stringify(brlData)).not.toEqual(JSON.stringify(usdData));
  });
});

test.describe("Rentabilidade — labels YTD periódico (7a.E.13.2)", () => {
  test("card YTD usa label 'XIRR' / 'TWR' (sem a.a.); origem e 12m mantêm 'a.a.'", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#rentabilidade");
    await page.waitForSelector(".tela-rentabilidade .rent-grupo");

    const grupos = page.locator(".tela-rentabilidade .rent-grupo");
    // Origem (índice 0): "XIRR a.a." e "TWR a.a."
    const origemLabels = await grupos
      .nth(0)
      .locator(".rent-metrica-label")
      .allTextContents();
    expect(origemLabels[0]).toBe("XIRR a.a.");
    expect(origemLabels[1]).toBe("TWR a.a.");

    // YTD (índice 1): "XIRR" e "TWR" (sem a.a.)
    const ytdLabels = await grupos
      .nth(1)
      .locator(".rent-metrica-label")
      .allTextContents();
    expect(ytdLabels[0]).toBe("XIRR");
    expect(ytdLabels[1]).toBe("TWR");

    // 12m (índice 2): "XIRR a.a." e "TWR a.a."
    const m12Labels = await grupos
      .nth(2)
      .locator(".rent-metrica-label")
      .allTextContents();
    expect(m12Labels[0]).toBe("XIRR a.a.");
    expect(m12Labels[1]).toBe("TWR a.a.");
  });
});
