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

    // Aba B navega para uma rota não-default antes do bloqueio cross-tab,
    // para provar que o handler do evento storage também zera `rota`.
    await pageB.goto("/#alocacao");
    await expect(pageB.locator(".tela-alocacao")).toBeVisible();

    // A clica em Bloquear
    await pageA.getByRole("button", { name: /bloquear/i }).click();
    await expect(pageA.locator(".pin-screen")).toBeVisible();

    // B deve cair via evento storage
    await expect(pageB.locator(".pin-screen")).toBeVisible({ timeout: 5_000 });
    // E rota deve ter zerado (não pode ficar presa em "alocacao")
    const rotaB = await pageB.evaluate(
      () => Alpine.$data(document.body).rota,
    );
    expect(rotaB).toBe("");
  });

  test("race: bloquear() durante auto-resume da aba B -> B respeita logout", async ({
    context,
  }) => {
    const pageA = await context.newPage();
    await mockPortfolio(pageA);
    const pageB = await context.newPage();

    // Log in na aba A para semear localStorage com pin + pinTimestamp
    await pageA.goto("/");
    await pageA.locator("input.pin-input").fill("123456");
    await pageA.locator("button.pin-submit").click();
    await pageA.locator(".raiox").waitFor({ timeout: 10_000 });

    // Simula fetch lento em B: 2s de atraso no portfolio.json.enc.
    const FIXTURE = await pageA.evaluate(() =>
      fetch("./portfolio.json.enc").then((r) => r.text()),
    );
    await pageB.route("**/portfolio.json.enc", async (route) => {
      await new Promise((r) => setTimeout(r, 2_000));
      return route.fulfill({ status: 200, body: FIXTURE, contentType: "text/plain" });
    });

    // B abre — vai entrar em tentarAutoResume com fetch em curso (2s de espera).
    const navB = pageB.goto("/");
    await pageB.waitForTimeout(300);

    // Durante esse window, A chama bloquear() — limpa pin do localStorage.
    await pageA.getByRole("button", { name: /bloquear/i }).click();
    await expect(pageA.locator(".pin-screen")).toBeVisible();

    // Espera B terminar navegação + auto-resume + race-guard
    await navB;
    await pageB.waitForTimeout(3_000);

    // B DEVE continuar em PIN (race guard rejeita promoção de fase)
    await expect(pageB.locator(".pin-screen")).toBeVisible();
    await expect(pageB.locator(".raiox")).toHaveCount(0);
  });
});
