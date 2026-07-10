import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

// Aviso de nova versão do app (shell) — snackbar de update do SW.
// Estratégia de 2 camadas (spec §7): (1) guarda PURA ehAtualizacaoDisponivel
// testada direto via page.evaluate; (2) UI + fiação dirigidas pelo seam do
// evento window "sw:update-available" (serviceWorkers:"block" global → nenhum
// SW real; o ciclo de 2 versões vivas é caro/instável de dirigir).

const PORTFOLIO = fs.readFileSync(
  path.join(__dirname, "../fixtures/portfolio.test.json.enc"),
  "utf-8",
);

async function mockPortfolio(page: Page) {
  await page.route("**/portfolio.json.enc", (r) =>
    r.fulfill({ status: 200, body: PORTFOLIO, contentType: "text/plain" }),
  );
  await page.route("**/relatorios_index.json.enc", (r) =>
    r.fulfill({ status: 404, body: "", contentType: "text/plain" }),
  );
}

async function autenticar(page: Page) {
  await mockPortfolio(page);
  await page.addInitScript(() => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem(
      "pinTimestamp",
      String(Date.now() - 24 * 60 * 60 * 1000),
    );
  });
  await page.goto("/");
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
}

async function dispararUpdate(page: Page) {
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("sw:update-available")),
  );
}

// Stub em swUpdate.aplicar p/ provar a fiação do botão SEM navegar de verdade.
async function stubAplicar(page: Page) {
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__aplicarChamado = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).swUpdate.aplicar = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__aplicarChamado = true;
    };
  });
}

test.describe("Aviso de nova versão — guarda pura ehAtualizacaoDisponivel", () => {
  test("installed + controller ativo → true (update real)", async ({ page }) => {
    await mockPortfolio(page);
    await page.goto("/");
    const r = await page.evaluate(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ehAtualizacaoDisponivel({ estado: "installed", temController: true }),
    );
    expect(r).toBe(true);
  });

  test("installed SEM controller → false (1ª instalação, não avisa)", async ({ page }) => {
    await mockPortfolio(page);
    await page.goto("/");
    const r = await page.evaluate(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ehAtualizacaoDisponivel({ estado: "installed", temController: false }),
    );
    expect(r).toBe(false);
  });

  test("installing/activated → false (não é o momento de avisar)", async ({ page }) => {
    await mockPortfolio(page);
    await page.goto("/");
    const [inst, act] = await page.evaluate(() => [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ehAtualizacaoDisponivel({ estado: "installing", temController: true }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ehAtualizacaoDisponivel({ estado: "activated", temController: true }),
    ]);
    expect(inst).toBe(false);
    expect(act).toBe(false);
  });
});

test.describe("Aviso de nova versão — snackbar (fiação por seam)", () => {
  test("carga normal (sem evento): snackbar NÃO aparece", async ({ page }) => {
    await autenticar(page);
    await page.waitForTimeout(500);
    await expect(page.locator(".update-snackbar")).not.toBeVisible();
  });

  test("evento → snackbar visível: texto, role, botões e alvos ≥44px", async ({ page }) => {
    await autenticar(page);
    await dispararUpdate(page);
    const snack = page.locator(".update-snackbar");
    await expect(snack).toBeVisible();
    await expect(snack).toHaveAttribute("role", "status");
    const icone = snack.locator(".update-snackbar__icone");
    await expect(icone).toHaveAttribute("aria-hidden", "true");
    await expect(icone).toHaveText("↻");
    await expect(snack.locator(".update-snackbar__texto")).toHaveText("Nova versão disponível");
    const acao = snack.locator(".update-snackbar__acao");
    const fechar = snack.locator(".update-snackbar__fechar");
    await expect(acao).toHaveText("Recarregar");
    await expect(fechar).toHaveAttribute("aria-label", "Dispensar aviso");
    await expect(fechar).toHaveText("✕");
    for (const b of [acao, fechar]) {
      const box = await b.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
  });

  test("toque em Recarregar chama swUpdate.aplicar() SEM navegar", async ({ page }) => {
    await autenticar(page);
    await stubAplicar(page);
    await dispararUpdate(page);
    await page.locator(".update-snackbar__acao").click();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await page.evaluate(() => (window as any).__aplicarChamado)).toBe(true);
    await expect(page.locator(".raiox")).toBeVisible(); // não navegou
  });

  test("toque em ✕ esconde sem chamar aplicar()", async ({ page }) => {
    await autenticar(page);
    await stubAplicar(page);
    await dispararUpdate(page);
    await expect(page.locator(".update-snackbar")).toBeVisible();
    await page.locator(".update-snackbar__fechar").click();
    await expect(page.locator(".update-snackbar")).not.toBeVisible();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await page.evaluate(() => (window as any).__aplicarChamado)).toBe(false);
  });

  test("dark (Modo Plantão): superfície flipa → texto vira tinta escura #04130c", async ({ page }) => {
    await autenticar(page);
    await page.locator("button.theme-toggle").click();
    await dispararUpdate(page);
    const snack = page.locator(".update-snackbar");
    await expect(snack).toBeVisible();
    const cor = await snack.evaluate((el) => getComputedStyle(el).color);
    expect(cor).toBe("rgb(4, 19, 12)");
  });

  test("reduced-motion: snackbar aparece no estado final (opacity 1)", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await autenticar(page);
    await dispararUpdate(page);
    const snack = page.locator(".update-snackbar");
    await expect(snack).toBeVisible();
    await expect(snack).toHaveCSS("opacity", "1");
    await context.close();
  });
});
