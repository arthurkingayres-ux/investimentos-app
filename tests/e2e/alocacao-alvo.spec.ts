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

async function abrirAlvo(page: Page) {
  await autenticar(page);
  await page.goto("/#alocacao?v=alvo");
  await expect(page.locator(".tela-alocacao .aloca-alvo__card").first()).toBeVisible();
}

test.describe("#alocacao vista Alvo — reforma visual (7a.E.23)", () => {
  test("renderiza um card por categoria com --cat setado via inline style", async ({ page }) => {
    await abrirAlvo(page);
    const cards = page.locator(".tela-alocacao .aloca-alvo__card");
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(2);

    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      const cssVar = await card.evaluate((el) =>
        getComputedStyle(el).getPropertyValue("--cat").trim(),
      );
      // Resolved --cat deve ser cor concreta (hex via --cat-* ou rgb computado)
      expect(cssVar).not.toBe("");
    }
  });

  test("número-poster alvo herda cor da categoria (não é cinza/preto)", async ({ page }) => {
    await abrirAlvo(page);
    const firstBig = page.locator(".tela-alocacao .aloca-alvo__alvo-big").first();
    await expect(firstBig).toBeVisible();
    const color = await firstBig.evaluate((el) => getComputedStyle(el).color);
    // não pode ser preto puro, branco puro ou cinza neutro
    expect(color).not.toMatch(/^rgb\(0,\s*0,\s*0\)/);
    expect(color).not.toMatch(/^rgb\(255,\s*255,\s*255\)/);
    expect(color).not.toMatch(/^rgb\(110,\s*110,\s*115\)/);
    // deve ser rgb válido
    expect(color).toMatch(/^rgba?\(/);
  });

  test("trilha categoria tem marker preto (ink) com cap-dot pseudo-elemento", async ({ page }) => {
    await abrirAlvo(page);
    const marker = page.locator(".tela-alocacao .aloca-alvo__trilha-cat .marker").first();
    await expect(marker).toBeVisible();
    const bg = await marker.evaluate((el) => getComputedStyle(el).backgroundColor);
    // var(--ink) — qualquer tom escuro próximo de #1d1d1f
    expect(bg).toMatch(/rgb\((\d{1,2}),\s*(\d{1,2}),\s*(\d{1,2})\)/);
  });

  test("labels 'Cesta passiva' / 'Cesta de picks' presentes; jargão 'bucket' ausente", async ({ page }) => {
    await abrirAlvo(page);
    const labels = await page
      .locator(".tela-alocacao .aloca-alvo__clabel")
      .allTextContents();
    expect(labels.length).toBeGreaterThan(0);
    const haveCesta = labels.some((t) => /Cesta\s+(passiva|de\s+picks)/i.test(t));
    expect(haveCesta).toBe(true);
    // "bucket" não pode vazar como label
    expect(labels.some((t) => /\bbucket\b/i.test(t))).toBe(false);
  });

  test("formatDelta multiplica fração por 100 (drift -0.10 renderiza -10,00 pp, não -0,10 pp)", async ({ page }) => {
    await autenticar(page);
    // Injetar drift conhecido de -0.10 fração (= -10,00 pp pelo backend)
    await page.evaluate(() => {
      const $data = (window as any).Alpine?.$data?.(document.body);
      if (!$data?.json?.politica?.categorias?.length) {
        throw new Error("política ausente no fixture");
      }
      $data.json.politica.categorias[0].drift = -0.10;
    });
    await page.goto("/#alocacao?v=alvo");
    const firstDrift = page.locator(".tela-alocacao .aloca-alvo__drift").first();
    await expect(firstDrift).toBeVisible();
    const txt = ((await firstDrift.textContent()) ?? "").trim();
    // Deve conter "10,00 pp" — não "0,10 pp" (bug de escala fração vs pp)
    expect(txt).toMatch(/10,00\s+pp/);
    expect(txt).not.toMatch(/^[↑↓·\s]*−?\+?0,10\s+pp/);
  });

  test("ativo acima do alvo recebe mini-bar amber (--sem-down)", async ({ page }) => {
    await autenticar(page);
    // Injetar override: forçar um ativo com peso_intra_atual > peso_intra
    await page.evaluate(() => {
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
    });
    await page.goto("/#alocacao?v=alvo");
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
    await abrirAlvo(page);
    const row = page
      .locator(".tela-alocacao .aloca-alvo__ativo--quarentena")
      .filter({ hasText: "KNIP11" });
    await expect(row).toBeVisible();
    // selo presente com o texto "Quarentena" + qualificador
    const selo = row.locator(".aloca-alvo__selo-quar");
    await expect(selo).toBeVisible();
    await expect(selo).toContainText(/Quarentena/i);
    await expect(selo).toContainText(/investidor qualificado/i);
    // não mostra o delta aportar/pausar nesta linha (x-show=false → display:none)
    await expect(row.locator(".aloca-alvo__delta")).toBeHidden();
    // sublabel comunica alvo 0%
    await expect(row).toContainText(/alvo 0%/);
    // o ticker do ativo permanece legível (texto não some)
    await expect(row.locator(".aloca-alvo__ticker")).toHaveText("KNIP11");
  });
});
