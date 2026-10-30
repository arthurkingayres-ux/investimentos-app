import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

// Fase 7a.BL.2 (Task 6) — o split "Brasil · EUA" do hero cabe a 320 px.
// Fixture sintética com 7 dígitos nas duas colunas (repo público), gerada por
// gerar_portfolio_hero_7digitos em tests/fixtures/gerar_fixture.py. O que
// falha em flex com duas colunas é a FOLGA entre os números, não o
// transbordo: o critério é right(BR) + 8 <= left(EUA).

const FIXTURE = path.join(__dirname, "../fixtures/portfolio_hero_7digitos.test.json.enc");
const FOLGA_MIN = 8;

async function abrirSplit(page: Page) {
  const corpo = fs.readFileSync(FIXTURE, "utf-8");
  await page.route("**/portfolio.json.enc", (route) =>
    route.fulfill({ status: 200, body: corpo, contentType: "text/plain" }),
  );
  await page.addInitScript(() => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem("pinTimestamp", String(Date.now() - 24 * 60 * 60 * 1000));
    localStorage.removeItem("moedaEUA");
  });
  await page.goto("/");
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
  await page.locator(".hero").click();
  await expect(page.locator("#hero-eyebrow")).toHaveText("Divisão Brasil · EUA");
  await expect(page.locator(".hero-body .hero-face.on .hero-split")).toBeVisible();
}

for (const vp of [
  { width: 320, height: 640 },
  { width: 375, height: 812 },
]) {
  test.describe(`hero split a ${vp.width} px`, () => {
    test.use({ viewport: vp });

    test("7 dígitos nas duas colunas: texto inteiro, sem transbordo, folga >= 8 px", async ({ page }) => {
      await abrirSplit(page);
      const nums = page.locator(".hero-body .hero-face.on .hero-split .num");
      await expect(nums.nth(0)).toHaveText("R$ 1.234.567,89");
      await expect(nums.nth(1)).toHaveText("R$ 7.654.321,09");
      const m = await nums.evaluateAll((els) =>
        els.map((el) => {
          // a caixa do TEXTO, não a do bloco: o .num é display:block e ocupa a
          // coluna inteira mesmo quando o texto transborda ou sobra espaço.
          const r = document.createRange();
          r.selectNodeContents(el);
          const t = r.getBoundingClientRect();
          return { left: t.left, right: t.right, sw: el.scrollWidth, cw: el.clientWidth };
        }),
      );
      for (const n of m) expect(n.sw).toBeLessThanOrEqual(n.cw);
      expect(m[0].right + FOLGA_MIN).toBeLessThanOrEqual(m[1].left);
      // e o número não sai da tela pela direita
      expect(m[1].right).toBeLessThanOrEqual(vp.width);
    });

    // A mono do CI (Linux, DejaVu Sans Mono) e a do iPhone (SF Mono) são
    // ~0,60 em, mais largas que a Cascadia desta máquina (~0,586 em). Com a
    // coluna em `min-width: 0`, 1–2 px a mais estouravam a coluna (medido
    // com Courier New: 117 px numa coluna de 112). A coluna nunca é menor que
    // o número; a folga entre eles continua sendo o gap inteiro.
    test("mono mais larga (~0,60 em, como DejaVu/SF Mono): segue sem transbordo e com folga", async ({ page }) => {
      await abrirSplit(page);
      const nums = page.locator(".hero-body .hero-face.on .hero-split .num");
      const base = await nums.first().evaluate((el) => {
        const r = document.createRange();
        r.selectNodeContents(el);
        return r.getBoundingClientRect().width;
      });
      await page.addStyleTag({
        content: '.hero-split .num { font-family: "Courier New", "DejaVu Sans Mono", "Liberation Mono", monospace !important; letter-spacing: 0 !important; }',
      });
      const m = await nums.evaluateAll((els) =>
        els.map((el) => {
          const r = document.createRange();
          r.selectNodeContents(el);
          const t = r.getBoundingClientRect();
          return { left: t.left, right: t.right, w: t.width, sw: el.scrollWidth, cw: el.clientWidth };
        }),
      );
      // a sonda tem de estar de fato mais larga que a fonte de base desta máquina
      expect(m[0].w).toBeGreaterThan(base);
      for (const n of m) expect(n.sw).toBeLessThanOrEqual(n.cw);
      expect(m[0].right + FOLGA_MIN).toBeLessThanOrEqual(m[1].left);
      expect(m[1].right).toBeLessThanOrEqual(vp.width);
    });

    test("nenhum font-size cru: o .num usa um degrau da escala --num-*", async ({ page }) => {
      await abrirSplit(page);
      const r = await page.evaluate(() => {
        const num = document.querySelector(".hero-body .hero-face.on .hero-split .num")!;
        const px = getComputedStyle(num).fontSize;
        const raiz = getComputedStyle(document.documentElement);
        const sonda = document.createElement("div");
        document.body.appendChild(sonda);
        const escala: Record<string, string> = {};
        for (const k of ["--num-xl", "--num-lg", "--num-md", "--num-sm", "--num-xs"]) {
          sonda.style.fontSize = raiz.getPropertyValue(k).trim();
          escala[k] = getComputedStyle(sonda).fontSize;
        }
        sonda.remove();
        return { px, escala };
      });
      expect(Object.values(r.escala)).toContain(r.px);
    });
  });
}
