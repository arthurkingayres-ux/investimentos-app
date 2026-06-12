import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

const FIXTURE = fs.readFileSync(
  path.join(__dirname, "../fixtures/portfolio.test.json.enc"),
  "utf-8",
);

test.use({ viewport: { width: 390, height: 844 } });

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

function cardPorNome(page: Page, nome: string) {
  return page.locator(".tela-alocacao .aloca-cat", {
    has: page.locator(".aloca-cat__nome", { hasText: nome }),
  });
}

// 7a.E.31: vista única — abre #alocacao e expande um card de categoria.
async function abrirCategoria(page: Page, nome: string) {
  await autenticar(page);
  await page.goto("/#alocacao");
  const card = cardPorNome(page, nome);
  await card.locator(".aloca-cat__head").click();
  await expect(card.locator(".aloca-cat__body")).toBeVisible();
  return card;
}

test.describe("#alocacao unificada — cestas + identidade (7a.E.31 / 7a.E.23)", () => {
  test("cada card de categoria seta --cat via inline style", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#alocacao");
    const cards = page.locator(".tela-alocacao .aloca-cat");
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < count; i++) {
      const cssVar = await cards.nth(i).evaluate((el) =>
        getComputedStyle(el).getPropertyValue("--cat").trim(),
      );
      expect(cssVar).not.toBe("");
    }
  });

  test("R$ da categoria no header herda a cor da categoria (--cat)", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#alocacao");
    const rs = page.locator(".tela-alocacao .aloca-cat__rs-valor").first();
    await expect(rs).toBeVisible();
    const color = await rs.evaluate((el) => getComputedStyle(el).color);
    expect(color).not.toMatch(/^rgb\(0,\s*0,\s*0\)/);
    expect(color).toMatch(/^rgba?\(/);
  });

  test("trilha categoria tem marker preto (ink) com cap-dot pseudo-elemento", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#alocacao");
    const marker = page.locator(".tela-alocacao .aloca-cat .aloca-alvo__trilha-cat .marker").first();
    await expect(marker).toBeVisible();
    const bg = await marker.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toMatch(/rgb\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})\)/);
  });

  test("labels 'Cesta passiva' / 'Cesta de picks' presentes; jargão 'bucket' ausente", async ({ page }) => {
    await abrirCategoria(page, "Ações BR");
    const labels = await page
      .locator(".tela-alocacao .aloca-alvo__clabel")
      .allTextContents();
    expect(labels.length).toBeGreaterThan(0);
    const haveCesta = labels.some((t) => /Cesta\s+(passiva|de\s+picks)/i.test(t));
    expect(haveCesta).toBe(true);
    expect(labels.some((t) => /\bbucket\b/i.test(t))).toBe(false);
  });

  test("ativo expandido mostra R$ de mercado", async ({ page }) => {
    const card = await abrirCategoria(page, "Ações BR");
    const valor = card.locator(".aloca-alvo__valor-ativo").first();
    await expect(valor).toBeVisible();
    expect((await valor.textContent())?.trim()).toMatch(/R\$\s?\d/);
  });

  test("drift da categoria multiplica fração por 100 (-0.10 → -10,00 pp)", async ({ page }) => {
    await autenticar(page);
    const nomeMutado = await page.evaluate(() => {
      const $data = (window as any).Alpine?.$data?.(document.body);
      if (!$data?.json?.politica?.categorias?.length) {
        throw new Error("política ausente no fixture");
      }
      $data.json.politica.categorias[0].drift = -0.10;
      return $data.json.politica.categorias[0].nome as string;
    });
    await page.goto("/#alocacao");
    const drift = cardPorNome(page, nomeMutado).locator(".aloca-cat__drift");
    await expect(drift).toBeVisible();
    const txt = ((await drift.textContent()) ?? "").trim();
    expect(txt).toMatch(/10,00\s+pp/);
    expect(txt).not.toMatch(/0,10\s+pp/);
  });

  test("ativo acima do alvo recebe mini-bar amber (--sem-down)", async ({ page }) => {
    await autenticar(page);
    const nome = await page.evaluate(() => {
      const $data = (window as any).Alpine?.$data?.(document.body);
      if (!$data || !$data.json?.politica?.categorias?.length) {
        throw new Error("política ausente no fixture");
      }
      const cat = $data.json.politica.categorias[0];
      const cesta = cat.buckets?.[0];
      if (!cesta?.ativos?.length) throw new Error("cesta vazia");
      const a = cesta.ativos[0];
      a.peso_intra = 0.05;
      a.peso_intra_atual = 0.15;
      a.drift_intra = 0.10;
      return cat.nome as string;
    });
    await page.goto("/#alocacao");
    await cardPorNome(page, nome).locator(".aloca-cat__head").click();
    const overFill = page
      .locator(".tela-alocacao .aloca-alvo__minibar .fill--over")
      .first();
    await expect(overFill).toBeVisible();
    const bg = await overFill.evaluate((el) => getComputedStyle(el).backgroundColor);
    // amber --cat-fii #b8731f → rgb(184, 115, 31)
    expect(bg).toMatch(/rgb\(184,\s*115,\s*31\)/);
  });

  // 7a.E.28 — selo "Quarentena" no pick quarentenado (KNIP11 na fixture).
  test("pick em quarentena mostra selo, alvo 0% e sem delta de drift", async ({ page }) => {
    const card = await abrirCategoria(page, "Ações BR");
    const row = card
      .locator(".aloca-alvo__ativo--quarentena")
      .filter({ hasText: "KNIP11" });
    await expect(row).toBeVisible();
    const selo = row.locator(".aloca-alvo__selo-quar");
    await expect(selo).toBeVisible();
    await expect(selo).toContainText(/Quarentena/i);
    await expect(selo).toContainText(/investidor qualificado/i);
    await expect(row.locator(".aloca-alvo__delta")).toBeHidden();
    await expect(row).toContainText(/alvo 0%/);
    await expect(row.locator(".aloca-alvo__ticker")).toHaveText("KNIP11");
  });

  // 7a.E.31 — selo "fora do alvo" no held off-policy (LREN3 na fixture).
  test("held off-policy mostra selo 'fora do alvo', subtexto 'a zerar' e sem minibar/delta", async ({ page }) => {
    const card = await abrirCategoria(page, "Ações BR");
    const row = card
      .locator(".aloca-alvo__ativo--fora")
      .filter({ hasText: "LREN3" });
    await expect(row).toBeVisible();
    const selo = row.locator(".aloca-alvo__selo-fora");
    await expect(selo).toBeVisible();
    await expect(selo).toContainText(/fora do alvo/i);
    await expect(row).toContainText(/a zerar/i);
    await expect(row).toContainText(/sem alvo/i);
    // off-policy não mostra minibar nem delta de drift
    await expect(row.locator(".aloca-alvo__minibar")).toBeHidden();
    await expect(row.locator(".aloca-alvo__delta")).toBeHidden();
    // mas mostra o R$ de mercado
    await expect(row.locator(".aloca-alvo__valor-ativo")).toBeVisible();
    // ticker permanece legível
    await expect(row.locator(".aloca-alvo__ticker")).toHaveText("LREN3");
  });
});
