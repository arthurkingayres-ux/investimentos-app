import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

const FIXTURE = fs.readFileSync(
  path.join(__dirname, "../fixtures/portfolio.test.json.enc"),
  "utf-8",
);

// Copiado de alocacao.spec.ts — PIN + intercept do portfolio + landing no #alocacao.
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
  await page.goto("/#alocacao");
  await expect(page.locator(".tela-alocacao")).toBeVisible();
  // 7a.E.30: abrir a seção colapsável da vista Atual (idempotente — testes que
  // não tocam .classe-row apenas veem o card aberto, sem efeito colateral).
  await page
    .locator(".tela-alocacao .aloca-vista:not(.aloca-alvo__list) .aloca-secao-head")
    .click();
  await expect(page.locator(".tela-alocacao .alocacao-card")).toBeVisible();
}

test.describe("Escala numérica (7a.E.27)", () => {
  test("os 6 tokens --num-* resolvem em :root com os px esperados", async ({
    page,
  }) => {
    await autenticar(page);
    const esperado: Record<string, string> = {
      "--num-poster": "40px",
      "--num-xl": "30px",
      "--num-lg": "20px",
      "--num-md": "16px",
      "--num-sm": "15px",
      "--num-xs": "13px",
    };
    for (const [token, px] of Object.entries(esperado)) {
      // resolve o rem→px medindo num probe com width:var(--num-*)
      const valor = await page.evaluate((t) => {
        const probe = document.createElement("div");
        probe.style.width = `var(${t})`;
        document.body.appendChild(probe);
        const w = getComputedStyle(probe).width;
        probe.remove();
        return w;
      }, token);
      expect(valor, `${token} deve resolver a ${px}`).toBe(px);
    }
  });

  test(".ticker-vm usa --num-sm (15px), não o default herdado 16px", async ({
    page,
  }) => {
    await autenticar(page);
    await page
      .locator('.tela-alocacao .classe-row[data-classe="FIIs"]')
      .click();
    const vm = page
      .locator('.tela-alocacao .classe-tickers[data-classe="FIIs"] .ticker-vm')
      .first();
    await expect(vm).toBeVisible();
    const fs = await vm.evaluate((el) => getComputedStyle(el).fontSize);
    expect(fs).toBe("15px");
  });

  test("valor de 7 dígitos no .ticker-vm não estoura #alocacao a 320px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await autenticar(page);
    await page
      .locator('.tela-alocacao .classe-row[data-classe="FIIs"]')
      .click();
    const vm = page
      .locator('.tela-alocacao .classe-tickers[data-classe="FIIs"] .ticker-vm')
      .first();
    await expect(vm).toBeVisible();
    // Força o pior caso de magnitude no valor monetário.
    await vm.evaluate((el) => {
      el.textContent = "R$ 1.234.567,89";
    });
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
