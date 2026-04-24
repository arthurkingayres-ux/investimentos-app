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

test.describe("Multi-tab sync", () => {
  test("bloquear() em outra aba -> esta aba cai para PIN via evento storage", async ({
    context,
  }) => {
    const pageA = await context.newPage();
    await mockPortfolio(pageA);
    const pageB = await context.newPage();
    await mockPortfolio(pageB);

    // Log in na aba A
    await pageA.goto("/");
    await pageA.locator("input.pin-input").fill("123456");
    await pageA.locator("button.pin-submit").click();
    await expect(pageA.locator(".raiox")).toBeVisible({ timeout: 10_000 });

    // Aba B reusa sessao (mesmo localStorage via origin compartilhado)
    await pageB.goto("/");
    await expect(pageB.locator(".raiox")).toBeVisible({ timeout: 10_000 });

    // A clica em Bloquear
    await pageA.getByRole("button", { name: /bloquear/i }).click();
    await expect(pageA.locator(".pin-screen")).toBeVisible();

    // B deve cair via evento storage
    await expect(pageB.locator(".pin-screen")).toBeVisible({ timeout: 5_000 });
  });
});
