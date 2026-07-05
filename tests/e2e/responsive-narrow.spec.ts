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

test.describe("Responsive em viewports estreitos (7a.G.2)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await autenticar(page);
  });

  // 7a.S.7b Task 4: substitui o wrap-to-1-col de 7a.G.2 finding #3 por um
  // affordance de rolagem horizontal (spec 7a.S §9, Fable: "3º KPI cortado
  // a 320px") — os 3 KPIs seguem lado a lado, alcançáveis via scroll, sem
  // nunca estourar a PÁGINA (o overflow fica contido no wrapper).
  test("proventos kpi-grid-3 tem rolagem horizontal a 320px — 3 KPIs alcançáveis, sem overflow da página", async ({ page }) => {
    await page.goto("/#proventos");
    await expect(page.locator(".kpi-grid-3").first()).toBeVisible({
      timeout: 5_000,
    });

    // A página (documento) nunca ganha scroll horizontal por causa do row de
    // KPIs — era esse o bug original (era 377 em viewport 320 antes do fix).
    const docOverflowsX = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(docOverflowsX).toBe(false);

    const kpis = page.locator(".tela-proventos .kpi-grid-3 .kpi");
    await expect(kpis).toHaveCount(3);

    // O container interno tem overflow disponível — é a affordance em si.
    const scrollInfo = await page.evaluate(() => {
      const grid = document.querySelector(".tela-proventos .kpi-grid-3") as HTMLElement;
      return { scrollWidth: grid.scrollWidth, clientWidth: grid.clientWidth };
    });
    expect(scrollInfo.scrollWidth).toBeGreaterThan(scrollInfo.clientWidth);

    // O 3º KPI é alcançável rolando o wrapper até o fim — e fica totalmente
    // dentro da faixa horizontal da viewport (não cortado) depois.
    await kpis.nth(2).evaluate((el) => el.scrollIntoView({ inline: "end", block: "nearest" }));
    await expect(kpis.nth(2)).toBeVisible();
    const box = await kpis.nth(2).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(321);
  });
});
