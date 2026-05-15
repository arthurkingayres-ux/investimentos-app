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

const MONO_HINT = /SF Mono|Cascadia|JetBrains|Menlo|Consolas|ui-monospace|monospace/i;

test.describe("Monument visual (7a.I.2)", () => {
  test("hero-valor usa mono stack + escala 3.25rem peso 800", async ({ page }) => {
    await autenticar(page);
    const heroValor = page.locator(".hero-valor");
    await expect(heroValor).toBeVisible();
    const style = await heroValor.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return {
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        letterSpacing: cs.letterSpacing,
      };
    });
    expect(style.fontFamily).toMatch(MONO_HINT);
    // 3.25rem; resiliente a root font-size 62.5% / outras bases.
    expect(parseFloat(style.fontSize)).toBeGreaterThanOrEqual(48);
    expect(style.fontWeight).toBe("800");
    // tracking negativo (-0.025em).
    expect(parseFloat(style.letterSpacing)).toBeLessThan(0);
  });

  test("hero-meta arranja label e updated lado-a-lado (asymmetric)", async ({
    page,
  }) => {
    await autenticar(page);
    const heroMeta = page.locator(".hero .hero-meta");
    await expect(heroMeta).toBeVisible();
    const layout = await heroMeta.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return { display: cs.display, justifyContent: cs.justifyContent };
    });
    expect(layout.display).toBe("flex");
    expect(layout.justifyContent).toBe("space-between");
  });

  test("ticker-vm-grande em #ativo usa Monument mono stack", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#ativo/HGLG11");
    const tickerVm = page.locator(".ticker-vm-grande");
    await expect(tickerVm).toBeVisible({ timeout: 10_000 });
    const style = await tickerVm.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return {
        fontFamily: cs.fontFamily,
        fontWeight: cs.fontWeight,
      };
    });
    expect(style.fontFamily).toMatch(MONO_HINT);
    expect(style.fontWeight).toBe("800");
  });
});
