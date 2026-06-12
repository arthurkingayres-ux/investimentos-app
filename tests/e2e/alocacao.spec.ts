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
  await page.goto("/#alocacao");
  await expect(page.locator(".tela-alocacao")).toBeVisible();
  // 7a.E.30: vista Atual começa sob seção colapsável fechada; abrir para
  // que .alocacao-card e suas .classe-row fiquem visíveis/clicáveis.
  await page
    .locator(".tela-alocacao .aloca-vista:not(.aloca-alvo__list) .aloca-secao-head")
    .click();
  await expect(page.locator(".tela-alocacao .alocacao-card")).toBeVisible();
}

test.describe("Tela #alocacao", () => {
  test("mostra >= 4 classes (EUA, FIIs, Ações BR, Cripto; +Renda Fixa BR pós-7a.M.1 quando houver posição)", async ({ page }) => {
    await autenticar(page);
    const classes = page.locator(".tela-alocacao .classe-row");
    // Tolerante: 4 (fixtures pré-7a.M.1) ou 5 (fixtures pós, com posição em RF BR).
    // O PWA renderiza só o que aparece em alocacao.atual; valor-zero é omitido.
    const n = await classes.count();
    expect(n).toBeGreaterThanOrEqual(4);
    expect(n).toBeLessThanOrEqual(5);
  });

  test("clicar em FIIs expande lista de tickers", async ({ page }) => {
    await autenticar(page);
    await page.locator('.tela-alocacao .classe-row[data-classe="FIIs"]').click();
    await expect(
      page.locator('.tela-alocacao .classe-tickers[data-classe="FIIs"]'),
    ).toBeVisible();
  });

  test("clicar em outra classe colapsa a primeira", async ({ page }) => {
    await autenticar(page);
    await page.locator('.tela-alocacao .classe-row[data-classe="FIIs"]').click();
    await page.locator('.tela-alocacao .classe-row[data-classe="EUA"]').click();
    await expect(
      page.locator('.tela-alocacao .classe-tickers[data-classe="FIIs"]'),
    ).not.toBeVisible();
    await expect(
      page.locator('.tela-alocacao .classe-tickers[data-classe="EUA"]'),
    ).toBeVisible();
  });

  test("clicar em ticker dentro da classe navega para #ativo/:ticker", async ({ page }) => {
    await autenticar(page);
    await page.locator('.tela-alocacao .classe-row[data-classe="FIIs"]').click();
    await page
      .locator('.tela-alocacao .classe-tickers[data-classe="FIIs"] a.ticker-row')
      .first()
      .click();
    expect(await page.evaluate(() => location.hash)).toMatch(/^#ativo\//);
  });

  test("linha do ticker mostra apenas % da classe (7a.E.1 Bloco 5)", async ({ page }) => {
    await autenticar(page);
    await page.locator('.tela-alocacao .classe-row[data-classe="FIIs"]').click();
    const tickerRows = page.locator(
      '.tela-alocacao .classe-tickers[data-classe="FIIs"] a.ticker-row',
    );
    await expect(tickerRows.first()).toBeVisible();

    // Não deve haver "total" após o percentual nas linhas dos tickers
    const textoLinha = await tickerRows.first().textContent();
    expect(textoLinha).not.toMatch(/\stotal/);

    // Deve haver exatamente 1 .ticker-pct (não 2)
    const pcts = tickerRows.first().locator(".ticker-pct");
    await expect(pcts).toHaveCount(1);
  });

  test("vista Atual mostra valor R$ por classe (7a.E.27)", async ({ page }) => {
    await autenticar(page);
    const rows = page.locator(".tela-alocacao .classe-row");
    const n = await rows.count();
    expect(n).toBeGreaterThanOrEqual(4);

    // Toda linha de classe renderiza um valor em R$ secundário (.classe-vm).
    const vms = page.locator(".tela-alocacao .classe-row .classe-vm");
    await expect(vms.first()).toBeVisible();
    await expect(vms).toHaveCount(n);

    // O valor formatado contém "R$" e tem dígito (classe com posição > 0).
    const texto = await vms.first().textContent();
    expect(texto).toMatch(/R\$\s?\d/);

    // O percentual atual permanece o número dominante (.classe-pct > span:first-child).
    const pct = rows.first().locator(".classe-pct > span").first();
    expect((await pct.textContent())?.trim()).toMatch(/%$/);
  });

  test("tela detalhada alocação não prepend '+' em ticker drilldown (todas classes)", async ({ page }) => {
    await autenticar(page);

    // Iterar pelas 5 classes para cobrir todos os tickers, não só FIIs.
    // Renda Fixa BR (7a.M.1) entra como 5ª; classe sem posição é pulada pelo `count()===0`.
    for (const classe of ["EUA", "FIIs", "Ações BR", "Cripto", "Renda Fixa BR"]) {
      const row = page.locator(`.tela-alocacao .classe-row[data-classe="${classe}"]`);
      // Algumas classes podem estar fora da fixture; pular se não aparecer.
      if ((await row.count()) === 0) continue;
      await row.click();
      // Aguardar Alpine renderizar; pode haver classe vazia (sem tickers).
      await page.waitForTimeout(50);
      const ulSelector = `.tela-alocacao .classe-tickers[data-classe="${classe}"] .ticker-pct`;
      const tickerPcts = await page.locator(ulSelector).allTextContents();
      for (const t of tickerPcts) {
        expect(t.startsWith("+"), `${classe} ticker pct com '+': ${t}`).toBe(false);
      }
      // Re-collapse para próxima iteração ficar limpa.
      await row.click();
    }
  });
});
