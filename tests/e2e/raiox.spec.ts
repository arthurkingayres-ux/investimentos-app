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

test.describe("Raio-X — cards e navegação", () => {
  test("card 'Proventos recebidos' clicável → #proventos", async ({ page }) => {
    await autenticar(page);

    const card = page.locator("a.card-link", { hasText: "Proventos recebidos" });
    await expect(card).toBeVisible();
    await card.click();
    await expect(page).toHaveURL(/#proventos$/);
    await expect(page.locator(".tela-proventos")).toBeVisible({ timeout: 10_000 });
  });
});
