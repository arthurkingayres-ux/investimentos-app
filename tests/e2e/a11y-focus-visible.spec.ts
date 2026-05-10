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

test.describe("A11y: focus-visible em controles secundários (7a.G.2)", () => {
  test(".escopo-toggle button tem outline visível ao foco", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#rentabilidade");
    await expect(page.locator(".escopo-toggle button").first()).toBeVisible({
      timeout: 5_000,
    });
    const el = page.locator(".escopo-toggle button").first();
    // Ativa input modality "keyboard" antes do focus programático
    // (anti-flaky: garante :focus-visible — CRB 7a.G.2 Suggestion #6)
    await page.keyboard.press("Tab");
    await el.focus();
    const ow = await el.evaluate((e) => getComputedStyle(e).outlineWidth);
    expect(ow).not.toBe("0px");
  });

  test(".classe-row tem outline visível ao foco", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#alocacao");
    await expect(page.locator(".classe-row").first()).toBeVisible({
      timeout: 5_000,
    });
    const el = page.locator(".classe-row").first();
    // Ativa input modality "keyboard" antes do focus programático
    await page.keyboard.press("Tab");
    await el.focus();
    const ow = await el.evaluate((e) => getComputedStyle(e).outlineWidth);
    expect(ow).not.toBe("0px");
  });

  test(".breadcrumb button tem outline + min 44px (touch target)", async ({
    page,
  }) => {
    await autenticar(page);
    await page.goto("/#rentabilidade");
    await expect(page.locator(".breadcrumb button").first()).toBeVisible({
      timeout: 5_000,
    });
    const el = page.locator(".breadcrumb button").first();
    // Ativa input modality "keyboard" antes do focus programático
    await page.keyboard.press("Tab");
    await el.focus();
    const computed = await el.evaluate((e) => {
      const cs = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      return {
        outlineWidth: cs.outlineWidth,
        height: r.height,
        width: r.width,
      };
    });
    expect(computed.outlineWidth).not.toBe("0px");
    expect(computed.height).toBeGreaterThanOrEqual(44);
    expect(computed.width).toBeGreaterThanOrEqual(44);
  });
});
