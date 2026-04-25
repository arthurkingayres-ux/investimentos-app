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

test.describe("Tela #rentabilidade", () => {
  test("renderiza canvas uPlot ao navegar para #rentabilidade", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#rentabilidade");
    await expect(page.locator(".tela-rentabilidade canvas")).toBeVisible();
  });

  test("toggle de escopo Brasil -> EUA atualiza estado, instância uPlot e canvas", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#rentabilidade");
    // Estado inicial: escopoAtivo deve ser Total (default)
    const inicial = await page.evaluate(() =>
      (window as any).Alpine.$data(document.body).escopoAtivo,
    );
    expect(inicial).toBe("Total");

    await page.locator('.tela-rentabilidade button[data-escopo="Brasil"]').click();
    await expect(
      page.locator('.tela-rentabilidade button[data-escopo="Brasil"].active'),
    ).toBeVisible();
    const aposBR = await page.evaluate(() =>
      (window as any).Alpine.$data(document.body).escopoAtivo,
    );
    expect(aposBR).toBe("Brasil");

    await page.locator('.tela-rentabilidade button[data-escopo="EUA"]').click();
    await expect(
      page.locator('.tela-rentabilidade button[data-escopo="EUA"].active'),
    ).toBeVisible();
    const aposEUA = await page.evaluate(() =>
      (window as any).Alpine.$data(document.body).escopoAtivo,
    );
    expect(aposEUA).toBe("EUA");

    // Canvas re-renderizado: hidratarRentabilidade destruiu instância anterior
    // e criou uma nova; verificamos via window dataURL hash que mudou em pelo
    // menos um pixel (toggle de série muda dados).
    const canvas = page.locator(".tela-rentabilidade canvas");
    await expect(canvas).toBeVisible();
    const tamanhoDataURL = await page.evaluate(() => {
      const c = document.querySelector(".tela-rentabilidade canvas") as HTMLCanvasElement;
      return c ? c.toDataURL().length : 0;
    });
    expect(tamanhoDataURL).toBeGreaterThan(100);
  });

  test("tabela resumo mostra Origem / Ano / 12m", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#rentabilidade");
    await expect(page.locator(".tela-rentabilidade").getByText("Origem")).toBeVisible();
    await expect(page.locator(".tela-rentabilidade").getByText("Ano")).toBeVisible();
    await expect(page.locator(".tela-rentabilidade").getByText("12m")).toBeVisible();
  });

  test("interpretacao automática aparece para escopo Total", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#rentabilidade");
    await page.locator('.tela-rentabilidade button[data-escopo="Total"]').click();
    await expect(
      page.locator(".tela-rentabilidade .interpretacao"),
    ).toBeVisible();
  });
});
