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

async function readIndicatorX(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const nav = document.querySelector(".tab-bar") as HTMLElement | null;
    return nav?.style.getPropertyValue("--tab-indicator-x") ?? "";
  });
}

test.describe("Tab indicator slide (7a.I.6)", () => {
  test("indicator existe como elemento único na tab-bar", async ({ page }) => {
    await autenticar(page);
    await expect(page.locator(".tab-bar-indicator")).toHaveCount(1);
  });

  test("--tab-indicator-x muda ao trocar de tab", async ({ page }) => {
    await autenticar(page);
    // Espera o init() rodar updateTabIndicator (via $nextTick)
    await page.waitForFunction(() => {
      const nav = document.querySelector(".tab-bar") as HTMLElement | null;
      return !!nav && nav.style.getPropertyValue("--tab-indicator-x") !== "";
    });
    const xRaiox = await readIndicatorX(page);
    expect(xRaiox).not.toBe("");

    await page.locator('.tab-bar a[data-tab="aportar"]').click();
    await expect(page.locator(".tela-aportar")).toBeVisible();
    // Aguarda a transition completar e o watcher atualizar --tab-indicator-x.
    await page.waitForFunction(
      (prev) => {
        const nav = document.querySelector(".tab-bar") as HTMLElement | null;
        const x = nav?.style.getPropertyValue("--tab-indicator-x") ?? "";
        return x !== "" && x !== prev;
      },
      xRaiox,
    );
    const xAportar = await readIndicatorX(page);
    expect(xAportar).not.toBe(xRaiox);

    // Indicator de raio-x (índice 0) começa em pixel menor do que aportar (índice 4).
    expect(parseFloat(xAportar)).toBeGreaterThan(parseFloat(xRaiox));
  });

  test("indicator usa cubic-bezier 220ms (sem reduced-motion)", async ({ page }) => {
    await autenticar(page);
    const transition = await page.locator(".tab-bar-indicator").evaluate((el) => {
      return window.getComputedStyle(el).transition;
    });
    expect(transition).toContain("transform");
    expect(transition).toContain("0.22s");
    expect(transition).toContain("cubic-bezier(0.16, 1, 0.3, 1)");
  });

  test("indicator sem transition em prefers-reduced-motion", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await autenticar(page);
    const transition = await page.locator(".tab-bar-indicator").evaluate((el) => {
      return window.getComputedStyle(el).transition;
    });
    // Reduced-motion sobrescreve para 'none' ou duration 0s.
    expect(transition === "none" || transition.includes("0s")).toBe(true);
    await context.close();
  });
});
