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
  test("tap na sparkline empurra para chart full + tab raiox persiste", async ({ page }) => {
    await autenticar(page);
    const spark = page.locator("#raiox-sparkline");
    await expect(spark).toBeVisible();
    await spark.click();
    await expect(page).toHaveURL(/#\/raiox\/chart$/);
    await expect(page.locator(".tela-patrimonio")).toBeVisible();
    await expect(
      page.locator('.tab-bar a[data-tab="raiox"]'),
    ).toHaveAttribute("aria-current", "page");
  });

  test("hero link aponta para #/raiox/chart", async ({ page }) => {
    await autenticar(page);
    const hero = page.locator(".hero.hero-link");
    await expect(hero).toHaveAttribute("href", "#/raiox/chart");
    await hero.click();
    await expect(page).toHaveURL(/#\/raiox\/chart$/);
    await expect(page.locator(".tela-patrimonio")).toBeVisible();
  });

  test("keydown Enter na sparkline navega para chart full", async ({ page }) => {
    await autenticar(page);
    const spark = page.locator("#raiox-sparkline");
    await spark.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#\/raiox\/chart$/);
    await expect(page.locator(".tela-patrimonio")).toBeVisible();
  });

  test("legacy #patrimonio redireciona para #/raiox/chart", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#patrimonio");
    await expect(page).toHaveURL(/#\/raiox\/chart$/);
    await expect(page.locator(".tela-patrimonio")).toBeVisible();
  });

  test("voltar do chart full retorna para Raio-X", async ({ page }) => {
    await autenticar(page);
    await page.locator("#raiox-sparkline").click();
    await expect(page.locator(".tela-patrimonio")).toBeVisible();
    await page.locator(".tela-patrimonio .breadcrumb button").click();
    await expect(page.locator(".raiox")).toBeVisible();
    await expect(page.locator(".tela-patrimonio")).toBeHidden();
  });
});
