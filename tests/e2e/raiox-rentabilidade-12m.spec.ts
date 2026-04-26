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

  test("XIRR/TWR null no escopo renderiza fallback sem quebrar", async ({ page }) => {
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

  test("tela #rentabilidade detalhada permanece intacta (3 grupos Origem/Ano/12m)", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#rentabilidade");
    await expect(page.locator(".tela-rentabilidade")).toBeVisible({ timeout: 10_000 });
    const grupos = page.locator(".rent-grupo");
    expect(await grupos.count()).toBeGreaterThanOrEqual(3);
  });
});
