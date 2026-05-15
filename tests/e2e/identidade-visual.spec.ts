import { test, expect, Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

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

// Paleta refinada travada na Fase 7a.E.20 (decisão de brainstorming opção B).
// Qualquer drift em :root vs ECharts vs .classe-dot deve ser PEGO por estes testes.
const PALETA = {
  catAcoesBr: "#047857",
  catEua:     "#1e6091",
  catFii:     "#b8731f",
  catCripto:  "#6d4ea8",
};

test.describe("7a.E.20.1 — Identidade visual (paleta de categorias)", () => {
  test("tokens semânticos --cat-* em :root expõem a paleta refinada", async ({ page }) => {
    await autenticar(page);
    const tokens = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return {
        catAcoesBr: s.getPropertyValue("--cat-acoes-br").trim(),
        catEua:     s.getPropertyValue("--cat-eua").trim(),
        catFii:     s.getPropertyValue("--cat-fii").trim(),
        catCripto:  s.getPropertyValue("--cat-cripto").trim(),
      };
    });
    expect(tokens.catAcoesBr).toBe(PALETA.catAcoesBr);
    expect(tokens.catEua).toBe(PALETA.catEua);
    expect(tokens.catFii).toBe(PALETA.catFii);
    expect(tokens.catCripto).toBe(PALETA.catCripto);
  });

  test("tema ECharts 'drarthur' deriva as 4 cores de categoria via readToken", async ({ page }) => {
    await autenticar(page);
    const tokens = await page.evaluate(() => {
      const w = window as any;
      const t = w.drarthurChart?.tokens || {};
      return {
        catAcoesBr: t.catAcoesBr,
        catEua: t.catEua,
        catFii: t.catFii,
        catCripto: t.catCripto,
      };
    });
    // Drift impossível: tema lê de :root, então tem que bater hex-a-hex.
    expect(tokens.catAcoesBr).toBe(PALETA.catAcoesBr);
    expect(tokens.catEua).toBe(PALETA.catEua);
    expect(tokens.catFii).toBe(PALETA.catFii);
    expect(tokens.catCripto).toBe(PALETA.catCripto);
  });

  test("drift EUA fechado: --cat-eua === tokens.catEua === COLORS.catEua()", async ({ page }) => {
    await autenticar(page);
    const trio = await page.evaluate(() => {
      const w = window as any;
      const rootToken = getComputedStyle(document.documentElement)
        .getPropertyValue("--cat-eua")
        .trim();
      const themeToken = w.drarthurChart?.tokens?.catEua;
      // COLORS é local ao module scope do app.js; checamos via leitura do :root
      // (a função css() do app.js faz exatamente isso).
      return { rootToken, themeToken };
    });
    expect(trio.rootToken).toBe(PALETA.catEua);
    expect(trio.themeToken).toBe(PALETA.catEua);
  });

  test(".classe-dot.dot-* resolve para a paleta refinada", async ({ page }) => {
    await autenticar(page);
    // Expandir #alocacao pra renderizar as .classe-dot (uma por categoria).
    await page.goto("/#alocacao");
    await page.waitForSelector(".classe-dot.dot-eua", { timeout: 5000 });
    const rgbs = await page.evaluate(() => {
      const grab = (sel: string) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el as Element).backgroundColor : null;
      };
      return {
        acoesBr: grab(".classe-dot.dot-acoes-br"),
        eua:     grab(".classe-dot.dot-eua"),
        fii:     grab(".classe-dot.dot-fiis"),
        cripto:  grab(".classe-dot.dot-cripto"),
      };
    });
    expect(rgbs.acoesBr).toBe("rgb(4, 120, 87)");
    expect(rgbs.eua).toBe("rgb(30, 96, 145)");
    expect(rgbs.fii).toBe("rgb(184, 115, 31)");
    expect(rgbs.cripto).toBe("rgb(109, 78, 168)");
  });
});
