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

async function autenticar(page: Page) {
  await mockPortfolio(page);
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

const MONO_HINT = /SF Mono|Cascadia|JetBrains|Menlo|Consolas|ui-monospace|monospace/i;

test.describe("Monument visual (7a.I.2)", () => {
  test("hero-valor usa mono stack + escala 2.5rem peso 800", async ({ page }) => {
    await autenticar(page);
    const heroValor = page.locator(".hero-valor");
    await expect(heroValor).toBeVisible();
    const style = await heroValor.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return {
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        letterSpacing: cs.letterSpacing,
      };
    });
    expect(style.fontFamily).toMatch(MONO_HINT);
    // 2.5rem ≈ 40px com root 16px; resiliente a bases diferentes.
    expect(parseFloat(style.fontSize)).toBeGreaterThanOrEqual(36);
    expect(parseFloat(style.fontSize)).toBeLessThanOrEqual(44);
    expect(style.fontWeight).toBe("800");
    // tracking negativo (-0.025em).
    expect(parseFloat(style.letterSpacing)).toBeLessThan(0);
  });

  test("hero-meta arranja label e updated lado-a-lado (asymmetric)", async ({
    page,
  }) => {
    await autenticar(page);
    const heroMeta = page.locator(".hero .hero-meta");
    await expect(heroMeta).toBeVisible();
    const layout = await heroMeta.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return { display: cs.display, justifyContent: cs.justifyContent };
    });
    expect(layout.display).toBe("flex");
    expect(layout.justifyContent).toBe("space-between");
  });

  test("ticker-vm-grande em #ativo usa Monument mono stack", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#ativo/HGLG11");
    const tickerVm = page.locator(".ticker-vm-grande");
    await expect(tickerVm).toBeVisible({ timeout: 10_000 });
    const style = await tickerVm.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return {
        fontFamily: cs.fontFamily,
        fontWeight: cs.fontWeight,
      };
    });
    expect(style.fontFamily).toMatch(MONO_HINT);
    expect(style.fontWeight).toBe("800");
  });
});

// 7a.S.5 — Hero de facetas: tap/Enter/Space/dots ciclam 4 fatos read-only
// (patrimônio · divisão BR/EUA · variação 7d · desde a origem). Fixture:
// total_brl=258000, br_brl=149640 (58%), eua_brl=87720 (34%),
// variacao_semanal_brl=3100/pct=0.012, rentabilidade.Total.xirr_origem=0.1118.
const HERO_EYEBROWS = [
  "Patrimônio total",
  "Divisão Brasil · EUA",
  "Variação · 7 dias",
  "Desde a origem",
];

test.describe("Hero de facetas (7a.S.5)", () => {
  test("tap no hero cicla as 4 facetas em ordem, com wrap-around", async ({ page }) => {
    await autenticar(page);
    const hero = page.locator(".hero");
    const eyebrow = page.locator("#hero-eyebrow");
    await expect(eyebrow).toHaveText(HERO_EYEBROWS[0]);
    for (let i = 1; i <= 4; i++) {
      await hero.click();
      await expect(eyebrow).toHaveText(HERO_EYEBROWS[i % 4]);
    }
  });

  test("Enter (hero focado) cicla a faceta", async ({ page }) => {
    await autenticar(page);
    const hero = page.locator(".hero");
    await hero.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#hero-eyebrow")).toHaveText(HERO_EYEBROWS[1]);
  });

  test("Space (hero focado) cicla a faceta", async ({ page }) => {
    await autenticar(page);
    const hero = page.locator(".hero");
    await hero.focus();
    await page.keyboard.press("Space");
    await expect(page.locator("#hero-eyebrow")).toHaveText(HERO_EYEBROWS[1]);
  });

  test("facet-dots: tocar no dot 3 pula direto pra faceta 3 (aria-current + classe on)", async ({ page }) => {
    await autenticar(page);
    const dots = page.locator(".hero-facets .fd");
    await expect(dots).toHaveCount(4);
    await dots.nth(2).click();
    await expect(page.locator("#hero-eyebrow")).toHaveText(HERO_EYEBROWS[2]);
    await expect(dots.nth(2)).toHaveClass(/on/);
    await expect(dots.nth(2)).toHaveAttribute("aria-current", "true");
    await expect(dots.nth(0)).not.toHaveClass(/on/);
    await expect(dots.nth(0)).not.toHaveAttribute("aria-current", "true");
    // cada dot é rotulado e é um alvo de toque ≥44px.
    await expect(dots.nth(2)).toHaveAttribute("aria-label", /Faceta 3 de 4/);
    const box = await dots.nth(2).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test("tocar num facet-dot não navega (stopPropagation não borbulha pro hero)", async ({ page }) => {
    await autenticar(page);
    await page.locator(".hero-facets .fd").nth(1).click();
    await expect(page).not.toHaveURL(/raiox\/chart/);
    await expect(page.locator(".raiox")).toBeVisible();
  });

  test("count-up NÃO re-dispara ao voltar pra faceta 'Patrimônio total'", async ({ page }) => {
    await autenticar(page);
    const hero = page.locator(".hero");
    // 4 cliques = 1→2→3→0 (wrap-around de volta ao patrimônio).
    for (let i = 0; i < 4; i++) await hero.click();
    await expect(page.locator("#hero-eyebrow")).toHaveText(HERO_EYEBROWS[0]);
    // Leitura imediata (sem esperar) prova que não há RAF de count-up em voo:
    // heroCountUpDone já setado na 1ª renderização → texto final direto.
    const texto = await page.evaluate(() =>
      document.getElementById("hero-patrimonio")!.textContent,
    );
    const esperado = await page.evaluate(() => {
      const total = (window as any).Alpine.$data(
        document.querySelector("[x-data]"),
      ).json.patrimonio.total_brl;
      return (window as any).formatBrl(total);
    });
    expect(texto).toBe(esperado);
  });

  test("faceta 'Divisão Brasil · EUA' mostra valores do JSON", async ({ page }) => {
    await autenticar(page);
    await page.locator(".hero").click();
    await expect(page.locator("#hero-eyebrow")).toHaveText(HERO_EYEBROWS[1]);
    const cols = page.locator(".hero-body .hero-split .col");
    await expect(cols).toHaveCount(2);
    await expect(cols.nth(0).locator(".num")).toHaveText("R$ 149.640,00");
    await expect(cols.nth(1).locator(".num")).toHaveText("R$ 87.720,00");
    await expect(cols.nth(0).locator(".pct")).toHaveText("58,0%");
    await expect(cols.nth(1).locator(".pct")).toHaveText("34,0%");
  });

  test("faceta 'Desde a origem' mostra o retorno acumulado", async ({ page }) => {
    await autenticar(page);
    const hero = page.locator(".hero");
    await hero.click();
    await hero.click();
    await hero.click();
    await expect(page.locator("#hero-eyebrow")).toHaveText(HERO_EYEBROWS[3]);
    await expect(page.locator(".hero-body .hero-valor")).toHaveText(/\+11,18%/);
  });

  test("hint '☞ toque no número' some no 1º toque (1×/sessão)", async ({ page }) => {
    await autenticar(page);
    const hint = page.locator(".hero-hint");
    await expect(hint).toBeVisible();
    await expect(hint).not.toHaveClass(/gone/);
    await page.locator(".hero").click();
    await expect(hint).toHaveClass(/gone/);
    const flag = await page.evaluate(() => sessionStorage.getItem("heroFacetHintSeen"));
    expect(flag).toBe("1");
  });

  test("hint já vem escondido quando heroFacetHintSeen já setado (refresh)", async ({ page }) => {
    await mockPortfolio(page);
    await page.addInitScript(() => {
      sessionStorage.setItem("heroFacetHintSeen", "1");
      localStorage.setItem("pin", "123456");
      localStorage.setItem(
        "pinTimestamp",
        String(Date.now() - 1 * 24 * 60 * 60 * 1000),
      );
    });
    await page.goto("/");
    await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".hero-hint")).toHaveClass(/gone/);
  });

  test("prefers-reduced-motion: troca de faceta é instantânea (sem RAF/timeout)", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await autenticar(page);
    await page.locator(".hero").click();
    // Leitura imediata (o teste em si já corre pós-microtask do click do
    // Playwright) — em reduced motion não há setTimeout(150ms) no meio.
    const texto = await page.evaluate(() => document.getElementById("hero-eyebrow")!.textContent);
    expect(texto).toBe(HERO_EYEBROWS[1]);
    await context.close();
  });

  // CRB 7a.S.5 (Fix 1): 2 trocas de faceta disparadas na MESMA volta de JS,
  // sem await entre elas — reproduz o auto-repeat de tecla (Enter/Space
  // seguros) ou toques/cliques rápidos nos dots. Antes do fix, a 2ª troca
  // buscava só `.hero-face.on` (a 1ª já tinha perdido essa classe ao virar
  // `.out`, e a face entrante ainda não a tinha ganho — double-RAF pendente),
  // então nenhum nó era retirado: a face do meio ficava órfã em #hero-body e,
  // quando seu double-RAF atrasado disparava, ganhava `.on` e reaparecia na
  // tela (fato velho piscando por cima/sob o fato atual).
  test("2 trocas de faceta sem aguardar entre elas não deixam nó órfão (re-entrância)", async ({ page }) => {
    await autenticar(page);
    await page.evaluate(() => {
      const data = (window as any).Alpine.$data(document.querySelector("[x-data]"));
      // Duas chamadas síncronas, sem await/yield entre elas: 0 → 1 → 2.
      data.ciclarHeroFacet();
      data.ciclarHeroFacet();
    });
    // Eyebrow reflete a 2ª troca (faceta "Variação · 7 dias"), não a 1ª nem
    // um valor revertido por um nó órfão ressuscitado depois.
    await expect(page.locator("#hero-eyebrow")).toHaveText(HERO_EYEBROWS[2]);
    // Espera a transição de saída (320ms) + folga assentarem — é exatamente
    // a janela em que, sem o fix, o nó órfão ganharia `.on` e reapareceria.
    await page.waitForTimeout(450);
    const faces = page.locator("#hero-body .hero-face");
    await expect(faces).toHaveCount(1);
    await expect(faces.first()).toHaveClass(/\bon\b/);
    await expect(faces.first()).not.toHaveClass(/\bout\b/);
    // Conteúdo correto (faceta "variacao7d") e não-garbled: um único
    // `.hero-sub` com o marcador da faceta atual, não a divisão BR/EUA (1)
    // nem o patrimônio total (0).
    await expect(page.locator("#hero-body .hero-sub")).toHaveCount(1);
    await expect(page.locator("#hero-body .hero-sub")).toContainText("nesta semana");
    await expect(page.locator("#hero-body .hero-split")).toHaveCount(0);
  });

  // CRB 7a.S.5 (Fix 2, a11y): #hero-body fica aria-busy="true" durante a
  // troca (count-up + transição de entrada) e só volta a "false" quando
  // ambos assentarem — silencia o aria-live="polite" pra não ler frames
  // parciais do count-up nem as duas `.hero-face` que coexistem durante a
  // saída.
  test("aria-busy silencia o #hero-body durante a troca e libera após assentar (a11y)", async ({ page }) => {
    await autenticar(page);
    const body = page.locator("#hero-body");
    // Mount inicial: aguarda o count-up de 700ms + entrada assentarem antes
    // de medir a próxima troca isoladamente.
    await expect(body).toHaveAttribute("aria-busy", "false", { timeout: 3000 });
    await page.locator(".hero").click(); // faceta 0 → 1 ("split", sem count-up)
    await expect(body).toHaveAttribute("aria-busy", "true");
    await expect(body).toHaveAttribute("aria-busy", "false");
  });
});
