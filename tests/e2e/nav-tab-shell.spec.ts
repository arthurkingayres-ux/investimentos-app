import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

const FIXTURE = fs.readFileSync(
  path.join(__dirname, "../fixtures/portfolio.test.json.enc"),
  "utf-8",
);

async function mockPortfolio(page: Page) {
  await page.route("**/portfolio.json.enc", (route) =>
    route.fulfill({ status: 200, body: FIXTURE, contentType: "text/plain" }),
  );
}

async function autenticar(page: Page) {
  await mockPortfolio(page);
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

test.describe("Tab bar shell (7a.I.1)", () => {
  test("tab bar visivel em raio-x com 5 destinos", async ({ page }) => {
    await autenticar(page);
    const tabBar = page.locator(".tab-bar");
    await expect(tabBar).toBeVisible();
    const tabs = tabBar.locator("a");
    await expect(tabs).toHaveCount(5);
    await expect(tabs.nth(0)).toHaveText(/raio-?x/i);
    await expect(tabs.nth(1)).toHaveText(/rent/i);
    await expect(tabs.nth(2)).toHaveText(/aloca/i);
    await expect(tabs.nth(3)).toHaveText(/prov/i);
    await expect(tabs.nth(4)).toHaveText(/apt/i);
  });

  test("tab raiox tem aria-current=page em rota vazia", async ({ page }) => {
    await autenticar(page);
    const tabRaiox = page.locator('.tab-bar a[data-tab="raiox"]');
    await expect(tabRaiox).toHaveAttribute("aria-current", "page");
  });

  test("clicar tab rentab navega para #rentabilidade e marca aria-current", async ({
    page,
  }) => {
    await autenticar(page);
    await page.locator('.tab-bar a[data-tab="rentab"]').click();
    await expect(page).toHaveURL(/#rentabilidade$/);
    await expect(page.locator(".tela-rentabilidade")).toBeVisible();
    await expect(
      page.locator('.tab-bar a[data-tab="rentab"]'),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.locator('.tab-bar a[data-tab="raiox"]'),
    ).not.toHaveAttribute("aria-current", "page");
  });

  test("rota legada #politica mantem tab aloca ativa", async ({ page }) => {
    // 7a.I.4: `#politica` foi fundida em `#alocacao?v=alvo`. O shim em
    // `atualizarRota` faz `replaceState`, então a URL termina em
    // `#alocacao?v=alvo` e a tab ativa continua sendo `aloca`.
    await autenticar(page);
    await page.goto("/#politica");
    await expect(page.locator(".tela-alocacao")).toBeVisible();
    await expect(page.locator(".tela-alocacao .politica-card").first()).toBeVisible();
    await expect(
      page.locator('.tab-bar a[data-tab="aloca"]'),
    ).toHaveAttribute("aria-current", "page");
  });

  test("tab bar NAO aparece na tela PIN", async ({ page }) => {
    await mockPortfolio(page);
    await page.goto("/");
    await expect(page.locator(".pin-screen")).toBeVisible();
    await expect(page.locator(".tab-bar")).toHaveCount(0);
  });

  test("tab bar tem indicator 2px no topo da tab ativa", async ({ page }) => {
    await autenticar(page);
    const tabRaiox = page.locator('.tab-bar a[data-tab="raiox"]');
    const indicatorHeight = await tabRaiox.evaluate((el) => {
      const style = window.getComputedStyle(el, "::before");
      return style.height;
    });
    expect(indicatorHeight).toBe("2px");
  });
});
