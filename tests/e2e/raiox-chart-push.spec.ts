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

test.describe("Raio-X chart push (#/raiox/chart) — 7a.I.5", () => {
  test("faixa 'Histórico' abre o chart full + tab raiox persiste", async ({ page }) => {
    // 7a.S.5: o hero virou facet-cycling (tap cicla 4 fatos, não navega mais).
    // 7a.CE: o "Ver histórico" abaixo do hero saiu; o Histórico é membro da faixa do Raio-X.
    await autenticar(page);
    const chartLink = page.locator(".grupo-cab nav a", { hasText: /^Histórico$/ });
    await expect(chartLink).toBeVisible();
    await chartLink.click();
    await expect(page).toHaveURL(/#\/raiox\/chart$/);
    await expect(page.locator(".tela-patrimonio")).toBeVisible();
    await expect(
      page.locator('.tab-bar a[data-tab="raiox"]'),
    ).toHaveAttribute("aria-current", "page");
  });

  test("tap no hero NÃO navega (cicla faceta em vez de ir pro chart)", async ({ page }) => {
    // 7a.S.5: regression guard — a mudança de comportamento é intencional.
    await autenticar(page);
    const hero = page.locator(".hero");
    await hero.click();
    await expect(page).not.toHaveURL(/raiox\/chart/);
    await expect(page.locator(".tela-patrimonio")).toBeHidden();
    await expect(page.locator(".raiox")).toBeVisible();
  });

  test("legacy #patrimonio redireciona para #/raiox/chart", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#patrimonio");
    await expect(page).toHaveURL(/#\/raiox\/chart$/);
    await expect(page.locator(".tela-patrimonio")).toBeVisible();
  });

  // 7a.CC: o chart é Raio-X › Histórico (tela-membro, sem "←"); volta-se ao
  // Hoje pela faixa. (Antes: botão Voltar.)
  test("do chart full a faixa (Hoje) retorna para Raio-X", async ({ page }) => {
    await autenticar(page);
    await page.locator(".grupo-cab nav a", { hasText: /^Histórico$/ }).click();
    await expect(page.locator(".tela-patrimonio")).toBeVisible();
    await expect(page.locator(".tela-patrimonio").getByRole("button", { name: /^Voltar/ })).toHaveCount(0);
    await page.locator(".grupo-cab nav a", { hasText: /^Hoje$/ }).click();
    await expect(page.locator(".raiox")).toBeVisible();
    await expect(page.locator(".tela-patrimonio")).toBeHidden();
  });

  test("cold-start em #/raiox/chart renderiza o gráfico (auto-resume)", async ({ page }) => {
    // 7a.I.5 finding iter 1: bookmark direto entrava em hidratarPatrimonio
    // antes de json carregar; canvas nunca aparecia. Fix: re-call em tentarAutoResume.
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
    await page.goto("/#/raiox/chart");
    await expect(page.locator(".tela-patrimonio")).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator("#patrimonio-grafico canvas[data-zr-dom-id]").first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("cold-start submitPin em #/raiox/chart renderiza o gráfico", async ({ page }) => {
    // 7a.I.5 finding iter 1: mesmo bug pelo caminho submitPin (sem PIN salvo).
    // 7a.W.3.b: "sem PIN salvo" passou a significar ENROLLMENT. O que este
    // teste mede é o cold-start pelo submitPin num aparelho pareado.
    await page.addInitScript(() => localStorage.setItem("pin", "123456"));
    await page.route("**/portfolio.json.enc", (route) =>
      route.fulfill({ status: 200, body: FIXTURE, contentType: "text/plain" }),
    );
    await page.goto("/#/raiox/chart");
    await expect(page.locator(".pin-screen")).toBeVisible({ timeout: 10_000 });
    await page.locator("input.pin-input").fill("123456");
    await page.locator("button.pin-submit").click();
    await expect(page.locator(".tela-patrimonio")).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator("#patrimonio-grafico canvas[data-zr-dom-id]").first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});
