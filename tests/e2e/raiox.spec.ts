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

test.describe("Raio-X — cards e navegação", () => {
  test("Proventos se alcança pela barra (Retorno) e pela faixa → #proventos", async ({ page }) => {
    // 7a.CC: Proventos deixou de ser aba; é a 2ª tela do grupo Retorno.
    await autenticar(page);

    const tab = page.locator('.tab-bar a[data-tab="retorno"]');
    await expect(tab).toBeVisible();
    await tab.click();
    await page.locator(".grupo-cab nav a", { hasText: /^Proventos$/ }).click();
    await expect(page).toHaveURL(/#proventos$/);
    await expect(page.locator(".tela-proventos")).toBeVisible({ timeout: 10_000 });
  });

  test("faixa 'Histórico' → #/raiox/chart", async ({ page }) => {
    // 7a.I.5: `#/raiox/chart`. 7a.S.5: o hero virou facet-cycling. 7a.CE: o
    // "Ver histórico" abaixo do hero saiu; entra-se pela faixa do Raio-X.
    await autenticar(page);

    const chartLink = page.locator(".grupo-cab nav a", { hasText: /^Histórico$/ });
    await expect(chartLink).toBeVisible();
    await chartLink.click();
    await expect(page).toHaveURL(/#\/raiox\/chart$/);
    await expect(page.locator(".tela-patrimonio")).toBeVisible({ timeout: 10_000 });
  });

  // 7a.S.5 Task 2 — voz nos estados vazios: "Nenhum aporte registrado." era
  // robótico; a frase nova é curta e humana, sem perder a informação.
  test("sem aporte registrado: mensagem humana (não robótica)", async ({ page }) => {
    await autenticar(page);
    await page.evaluate(() => {
      const $data = (window as any).Alpine?.$data?.(document.body);
      if (!$data) throw new Error("Alpine.$data(document.body) é undefined");
      $data.json.ultimo_aporte = null;
    });
    const vazio = page.locator(".aporte-vazio");
    await expect(vazio).toBeVisible();
    await expect(vazio).toHaveText(/\S/);
    await expect(vazio).not.toHaveText("Nenhum aporte registrado.");
  });
});
