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

test.describe("drarthurNav.motion (7a.I.6)", () => {
  test("durações default sem prefers-reduced-motion", async ({ page }) => {
    await autenticar(page);
    const motion = await page.evaluate(() => (window as any).drarthurNav.motion);
    expect(motion.reduced).toBe(false);
    expect(motion.tabFade).toBe(220);
    expect(motion.tabIndicator).toBe(220);
    expect(motion.countUp).toBe(700);
    expect(motion.push).toBe(280);
    expect(motion.segmented).toBe(280);
    expect(motion.easing).toBe("cubic-bezier(0.16, 1, 0.3, 1)");
  });

  test("prefers-reduced-motion: reduce zera todas as motions", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await autenticar(page);
    const motion = await page.evaluate(() => (window as any).drarthurNav.motion);
    expect(motion.reduced).toBe(true);
    expect(motion.tabFade).toBe(0);
    expect(motion.tabIndicator).toBe(0);
    expect(motion.countUp).toBe(0);
    expect(motion.push).toBe(0);
    expect(motion.segmented).toBe(0);
    await context.close();
  });

  test("ativarCountUpHero refresh dentro da sessão pula RAF e seta valor final", async ({
    browser,
  }) => {
    // 7a.I.6 CRB iter 2: o hero tem 2 caminhos (primeira load = applyCountUp,
    // refresh = textContent direto). Aqui exercemos o refresh: pré-seta
    // heroCountUpDone via addInitScript e valida que o hero já vem formatado.
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route("**/portfolio.json.enc", (route) =>
      route.fulfill({ status: 200, body: FIXTURE, contentType: "text/plain" }),
    );
    await page.addInitScript(() => {
      sessionStorage.setItem("heroCountUpDone", "1");
      localStorage.setItem("pin", "123456");
      localStorage.setItem(
        "pinTimestamp",
        String(Date.now() - 1 * 24 * 60 * 60 * 1000),
      );
    });
    await page.goto("/");
    await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
    const hero = page.locator("#hero-patrimonio");
    await expect(hero).toBeVisible();
    // Refresh path = valor final imediato. Comparamos contra o valor exato
    // derivado do fixture (não só prefix/non-zero) para que um bug que ainda
    // produza BRL não-zero seja detectado.
    const expectedText = await page.evaluate(() => {
      const total = (window as any).Alpine.$data(
        document.querySelector("[x-data]"),
      ).json.patrimonio.total_brl;
      return (window as any).formatBrl(total);
    });
    expect(await hero.textContent()).toBe(expectedText);
    await context.close();
  });

  test("applyCountUp seta valor instantâneo em reduced-motion", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await autenticar(page);
    const finalText = await page.evaluate(() => {
      const el = document.createElement("p");
      document.body.appendChild(el);
      (window as any).drarthurNav.applyCountUp(el, 1234.56, (n: number) =>
        n.toFixed(2),
      );
      const t = el.textContent;
      el.remove();
      return t;
    });
    expect(finalText).toBe("1234.56");
    await context.close();
  });
});
