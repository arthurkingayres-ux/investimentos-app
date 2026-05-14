import { test, expect, Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

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

test.describe("7a.E.19.1 — Bootstrap ECharts + tema 'drarthur'", () => {
  test("echarts global está disponível após load", async ({ page }) => {
    await autenticar(page);
    const tipo = await page.evaluate(() => typeof (window as any).echarts);
    expect(tipo).toBe("object");
  });

  test("tema drarthur registrado e helpers expostos", async ({ page }) => {
    await autenticar(page);
    const result = await page.evaluate(() => {
      const w = window as any;
      return {
        hasTokens: !!w.drarthurChart?.tokens?.g700,
        hasMotion: !!w.drarthurChart?.motionConfig,
        hasTooltipFmt: typeof w.drarthurChart?.tooltipFormatterAxis === "function",
        hasTooltipBase: typeof w.drarthurChart?.tooltipBase === "object",
        g700Color: w.drarthurChart?.tokens?.g700,
      };
    });
    expect(result.hasTokens).toBe(true);
    expect(result.hasMotion).toBe(true);
    expect(result.hasTooltipFmt).toBe(true);
    expect(result.hasTooltipBase).toBe(true);
    expect(result.g700Color).toBe("#047857");
  });

  test("motion config zera com prefers-reduced-motion: reduce", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await autenticar(page);
    const duration = await page.evaluate(() => {
      const w = window as any;
      return w.drarthurChart?.motionConfig?.animationDuration;
    });
    expect(duration).toBe(0);
  });

  test("motion config ativo sem prefers-reduced-motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await autenticar(page);
    const motion = await page.evaluate(() => {
      const w = window as any;
      const mc = w.drarthurChart?.motionConfig || {};
      return {
        duration: mc.animationDuration,
        durationUpdate: mc.animationDurationUpdate,
        easing: mc.animationEasing,
      };
    });
    expect(motion.duration).toBe(600);
    expect(motion.durationUpdate).toBe(400);
    expect(motion.easing).toBe("cubicOut");
  });

  test("uPlot foi removido (7a.E.19.5)", async ({ page }) => {
    await autenticar(page);
    const hasUPlot = await page.evaluate(() => typeof (window as any).uPlot);
    expect(hasUPlot).toBe("undefined");
  });
});
