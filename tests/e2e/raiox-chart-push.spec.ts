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
  test("tap no affordance 'ver histórico' empurra para chart full + tab raiox persiste", async ({ page }) => {
    // 7a.S.5: o hero virou facet-cycling (tap cicla 4 fatos, não navega mais).
    // O acesso ao histórico completo migrou pro affordance discreto .hero-chart-link.
    await autenticar(page);
    const chartLink = page.locator(".hero-chart-link");
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

  test("affordance 'ver histórico' tem touch target ≥44px e aria-label", async ({ page }) => {
    await autenticar(page);
    const chartLink = page.locator(".hero-chart-link");
    await expect(chartLink).toHaveAttribute("aria-label", /.+/);
    const box = await chartLink.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test("legacy #patrimonio redireciona para #/raiox/chart", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#patrimonio");
    await expect(page).toHaveURL(/#\/raiox\/chart$/);
    await expect(page.locator(".tela-patrimonio")).toBeVisible();
  });

  test("voltar do chart full retorna para Raio-X", async ({ page }) => {
    await autenticar(page);
    await page.locator(".hero-chart-link").click();
    await expect(page.locator(".tela-patrimonio")).toBeVisible();
    await page.locator(".tela-patrimonio .breadcrumb button").click();
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
