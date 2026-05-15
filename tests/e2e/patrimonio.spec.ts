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

test.describe("7a.E.6 — Tela Histórico Patrimonial", () => {
  test("rota #patrimonio mostra 3 KPIs com valores em BRL", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#/raiox/chart");
    await expect(page.locator(".tela-patrimonio")).toBeVisible({ timeout: 10_000 });

    const kpis = page.locator(".tela-patrimonio .kpi");
    await expect(kpis).toHaveCount(3);

    for (let i = 0; i < 3; i++) {
      const txt = await kpis.nth(i).locator(".kpi-valor").textContent();
      expect(txt).toMatch(/R\$/);
    }
  });

  test("KPI 'Retorno acumulado' mostra percentual com sinal", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#/raiox/chart");
    await expect(page.locator(".tela-patrimonio")).toBeVisible({ timeout: 10_000 });

    const meta = page.locator(".tela-patrimonio .kpi-meta").first();
    await expect(meta).toBeVisible();
    const txt = (await meta.textContent()) || "";
    expect(txt).toMatch(/[+\-—]/);
  });

  test("gráfico patrimonio renderiza com canvas (ECharts)", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#/raiox/chart");
    await expect(page.locator(".tela-patrimonio")).toBeVisible({ timeout: 10_000 });

    const canvas = page.locator("#patrimonio-grafico canvas[data-zr-dom-id]").first();
    await expect(canvas).toBeVisible({ timeout: 5_000 });
  });

  test("hover no gráfico patrimonio mostra tooltip custom drarthur", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#/raiox/chart");
    await expect(page.locator(".tela-patrimonio")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#patrimonio-grafico canvas[data-zr-dom-id]").first()).toBeVisible({ timeout: 5_000 });

    const box = await page.locator("#patrimonio-grafico").boundingBox();
    if (!box) throw new Error("container sem boundingBox");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(150);

    // Tooltip ECharts custom: container injetado em document.body com border-radius:8px
    const hasTooltip = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll<HTMLElement>("div"));
      return els.some((el) => /border-radius:\s*8px/.test(el.style.cssText) && el.offsetParent !== null);
    });
    expect(hasTooltip).toBe(true);
  });

  test("aporte cumulativo é monotônico (consistência da fixture)", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#/raiox/chart");
    await expect(page.locator(".tela-patrimonio")).toBeVisible({ timeout: 10_000 });

    const monotonico = await page.evaluate(() => {
      const root = document.querySelector("[x-data]");
      // @ts-ignore
      const data = root && (window.Alpine?.$data?.(root));
      const ev = (data?.json?.patrimonio?.evolucao) || [];
      for (let i = 1; i < ev.length; i++) {
        if ((ev[i].aportes_acum_brl ?? 0) < (ev[i - 1].aportes_acum_brl ?? 0)) return false;
      }
      return ev.length > 0;
    });
    expect(monotonico).toBe(true);
  });
});
