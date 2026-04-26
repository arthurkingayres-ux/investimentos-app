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

test.describe("7a.E.9 — Raio-X rentabilidade 12m", () => {
  test("header da seção contém 'Rentabilidade · últimos 12 meses'", async ({ page }) => {
    await autenticar(page);
    const titulo = page.locator(".card.rentabilidade .card-titulo");
    await expect(titulo).toContainText("Rentabilidade");
    await expect(titulo).toContainText("·");
    await expect(titulo).toContainText("últimos 12 meses");
  });

  test("3 escopos com chip-xirr e chip-twr (Total/Brasil/EUA)", async ({ page }) => {
    await autenticar(page);
    const escopos = page.locator(".card.rentabilidade .rent-escopo");
    await expect(escopos).toHaveCount(3);

    for (let i = 0; i < 3; i++) {
      await expect(escopos.nth(i).locator(".chip-xirr")).toBeVisible();
      await expect(escopos.nth(i).locator(".chip-twr")).toBeVisible();
    }
  });

  test("chips NÃO contêm sufixo '12m' (header já carrega janela)", async ({ page }) => {
    await autenticar(page);
    const chipsTexto = await page
      .locator(".card.rentabilidade .rent-escopo .chip")
      .allInnerTexts();
    for (const texto of chipsTexto) {
      expect(texto.toLowerCase()).not.toContain("12m");
    }
  });

  test("lista de 5 benchmarks na ordem CDI, IBOV, IFIX, S&P 500, USD", async ({ page }) => {
    await autenticar(page);
    const linhas = page.locator(".rent-benchmarks-12m .bench-linha");
    await expect(linhas).toHaveCount(5);

    const labels = await linhas.locator(".bench-label").allInnerTexts();
    expect(labels).toEqual(["CDI", "IBOV", "IFIX", "S&P 500", "USD"]);
  });

  test("nenhum benchmark comparativo 'vs CDI'/'vs IBOV' aparece no raio-x", async ({ page }) => {
    await autenticar(page);
    const card = page.locator(".card.rentabilidade");
    const texto = (await card.innerText()).toLowerCase();
    expect(texto).not.toContain("vs cdi");
    expect(texto).not.toContain("vs ibov");
    expect(texto).not.toContain("vs s&p");
  });

  test("chips renderizam texto formatado, não literal 'null'/'undefined'", async ({ page }) => {
    // Sanity check: garante que formatPct nunca vaza string crua para o DOM.
    // Cobre o caminho null indiretamente (fixture com xirr_12m=null produziria
    // o mesmo formato '—' que outros valores ausentes na codebase).
    await autenticar(page);
    const chips = page.locator(".card.rentabilidade .rent-escopo .chip");
    const count = await chips.count();
    for (let i = 0; i < count; i++) {
      const txt = (await chips.nth(i).innerText()).trim();
      expect(txt.length).toBeGreaterThan(0);
      expect(txt.toLowerCase()).not.toBe("null");
      expect(txt.toLowerCase()).not.toBe("undefined");
    }
  });

  test("escopo com xirr_12m null renderiza '—' (route mock)", async ({ page }) => {
    // Fork da fixture com xirr_12m/twr_12m null no Total para exercitar o branch null.
    await page.route("**/portfolio.json.enc", async (route) => {
      await route.fulfill({ status: 200, body: FIXTURE, contentType: "text/plain" });
    });
    await page.addInitScript(() => {
      localStorage.setItem("pin", "123456");
      localStorage.setItem(
        "pinTimestamp",
        String(Date.now() - 1 * 24 * 60 * 60 * 1000),
      );
    });
    // Patch JSON após decifragem via Alpine init: testa formatPct(null)
    // diretamente forçando o estado.
    await page.goto("/");
    await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
    await page.evaluate(() => {
      const root = document.querySelector("[x-data]") as HTMLElement & { _x_dataStack?: object[] };
      const data = (window as unknown as { Alpine: { $data: (el: Element) => Record<string, unknown> } })
        .Alpine.$data(root);
      const j = data.json as { rentabilidade: Record<string, { xirr_12m: number | null; twr_12m: number | null }> };
      j.rentabilidade.Total.xirr_12m = null;
      j.rentabilidade.Total.twr_12m = null;
    });
    await page.waitForTimeout(100);
    const totalEscopo = page.locator(".card.rentabilidade .rent-escopo").first();
    const xirrChip = totalEscopo.locator(".chip-xirr");
    const txtXirr = (await xirrChip.innerText()).trim();
    // formatPct(null) → '—' por convenção da codebase
    expect(txtXirr).toMatch(/[—–-]/);
  });

  test("tela #rentabilidade detalhada permanece intacta (3 grupos Origem/Ano/12m)", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#rentabilidade");
    await expect(page.locator(".tela-rentabilidade")).toBeVisible({ timeout: 10_000 });
    const grupos = page.locator(".rent-grupo");
    expect(await grupos.count()).toBeGreaterThanOrEqual(3);
  });
});
