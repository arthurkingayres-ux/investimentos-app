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

test.describe("Tab bar a11y (7a.I.7)", () => {
  test("tab tem touch target >= 44px (height e width)", async ({ page }) => {
    await autenticar(page);
    const tab = page.locator('.tab-bar a[data-tab="rentab"]');
    const box = await tab.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  });

  test("tab tem outline visível ao foco via teclado", async ({ page }) => {
    await autenticar(page);
    const tab = page.locator('.tab-bar a[data-tab="rentab"]');
    // Ativa input modality "keyboard" antes do focus programatico
    // (anti-flaky: garante :focus-visible — padrão de a11y-focus-visible.spec.ts).
    await page.keyboard.press("Tab");
    await tab.focus();
    const ow = await tab.evaluate((e) => getComputedStyle(e).outlineWidth);
    expect(ow).not.toBe("0px");
  });

  test("tab bar tem altura mínima de 56px (base var --tab-bar-height; env safe-area soma)", async ({ page }) => {
    await autenticar(page);
    const tabBar = page.locator(".tab-bar");
    const height = await tabBar.evaluate((el) => {
      return parseFloat(getComputedStyle(el).height);
    });
    // var(--tab-bar-height) = 56px é o piso. Em viewport sem safe-area concreta
    // (Pixel 7 emulado sem notch), `env(safe-area-inset-bottom)` retorna 0 e a
    // altura final é exatamente 56px. Em dispositivo com notch real, o valor sobe.
    // Asserção é o piso — verificar contribuição da safe-area exigiria mock do env(),
    // que Playwright não expõe diretamente.
    expect(height).toBeGreaterThanOrEqual(56);
  });

  test("tab bar NAO aparece na tela PIN (gate antes do shell)", async ({ page }) => {
    // 7a.W.3.b: storage sem `pin` levaria ao ENROLLMENT. Este teste mede o
    // fluxo do dia a dia (aparelho já pareado), então semeia o PIN.
    await page.addInitScript(() => localStorage.setItem("pin", "123456"));
    await page.route("**/portfolio.json.enc", (route) =>
      route.fulfill({ status: 200, body: FIXTURE, contentType: "text/plain" }),
    );
    await page.goto("/");
    await expect(page.locator(".pin-screen")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".tab-bar")).toHaveCount(0);
  });
});
