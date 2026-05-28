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

test.describe("#ativo — formatação de quantidade (7a.E.23)", () => {
  test("posicaoAtual.quantidade fracionária renderiza com vírgula pt-BR (não 16 dígitos)", async ({
    page,
  }) => {
    await autenticar(page);
    // Forçar quantidade fracionária do float IEEE 754
    await page.evaluate(() => {
      const $data = (window as any).Alpine?.$data?.(document.body);
      if (!$data) throw new Error("Alpine.$data ausente");
      const voo = $data.json.posicoes.find((p: any) => p.ticker === "VOO");
      if (!voo) throw new Error("VOO ausente no fixture");
      voo.quantidade = 11.4701100000000002;
      voo.movimentos[0].quantidade = 0.31000000000000005;
    });
    await page.goto("/#ativo/VOO");
    await expect(page.locator(".tela-ativo .ticker-hero")).toContainText("VOO");

    // Card "Quantidade" do KPI grid
    const qtyKpi = page
      .locator(".tela-ativo .kpi", { hasText: "Quantidade" })
      .locator(".kpi-valor");
    await expect(qtyKpi).toBeVisible();
    const qtyText = ((await qtyKpi.textContent()) ?? "").trim();
    // Não pode vazar os 16 dígitos do float
    expect(qtyText).not.toMatch(/\d{6,}/);
    // Deve estar em formato pt-BR (vírgula, máx 4 casas)
    expect(qtyText).toMatch(/^\d{1,3}(,\d{1,4})?$/);
  });

  test("tabela de movimentos formata qty fracionária", async ({ page }) => {
    await autenticar(page);
    await page.evaluate(() => {
      const $data = (window as any).Alpine?.$data?.(document.body);
      if (!$data) throw new Error("Alpine.$data ausente");
      const voo = $data.json.posicoes.find((p: any) => p.ticker === "VOO");
      voo.movimentos[0].quantidade = 0.55103;
    });
    await page.goto("/#ativo/VOO");
    const firstMovQty = page
      .locator(".tela-ativo .tabela-movimentos tbody tr")
      .first()
      .locator("td.num")
      .first();
    await expect(firstMovQty).toBeVisible();
    const movText = ((await firstMovQty.textContent()) ?? "").trim();
    // Ponto decimal "0.55103" é o sintoma do bug; pt-BR usa vírgula
    expect(movText).not.toMatch(/\.\d{4,}/);
    expect(movText).toMatch(/^\d+(,\d{1,4})?$/);
  });
});
