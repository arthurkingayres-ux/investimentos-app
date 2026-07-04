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

// Accent = var(--g-700) = #047857 = rgb(4, 120, 87)
const ACCENT_RGB = "rgb(4, 120, 87)";

test.describe("Toque — focus-visible unificado (7a.S.2 Task 1)", () => {
  test(".escopo-toggle button (em #rentabilidade) foca com outline accent 2px", async ({
    page,
  }) => {
    await autenticar(page);
    await page.goto("/#rentabilidade");
    const el = page.locator(".escopo-toggle button").first();
    await expect(el).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press("Tab");
    await el.focus();
    const computed = await el.evaluate((e) => {
      const cs = getComputedStyle(e);
      return { outlineColor: cs.outlineColor, outlineWidth: cs.outlineWidth };
    });
    expect(computed.outlineColor).toBe(ACCENT_RGB);
    expect(computed.outlineWidth).toBe("2px");
  });

  test(".aloca-cat__head (em #alocacao) foca com outline accent 2px", async ({
    page,
  }) => {
    await autenticar(page);
    await page.goto("/#alocacao");
    const el = page.locator(".tela-alocacao .aloca-cat__head").first();
    await expect(el).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press("Tab");
    await el.focus();
    const computed = await el.evaluate((e) => {
      const cs = getComputedStyle(e);
      return { outlineColor: cs.outlineColor, outlineWidth: cs.outlineWidth };
    });
    expect(computed.outlineColor).toBe(ACCENT_RGB);
    expect(computed.outlineWidth).toBe("2px");
  });

  test(".breadcrumb button (em #patrimonio) foca com outline accent 2px", async ({
    page,
  }) => {
    await autenticar(page);
    await page.goto("/#patrimonio");
    const el = page.locator(".tela-patrimonio .breadcrumb button");
    await expect(el).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press("Tab");
    await el.focus();
    const computed = await el.evaluate((e) => {
      const cs = getComputedStyle(e);
      return { outlineColor: cs.outlineColor, outlineWidth: cs.outlineWidth };
    });
    expect(computed.outlineColor).toBe(ACCENT_RGB);
    expect(computed.outlineWidth).toBe("2px");
  });

  test("-webkit-tap-highlight-color: transparent aplicado globalmente", async ({
    page,
  }) => {
    await autenticar(page);
    const tap = await page.evaluate(() => {
      const cs = getComputedStyle(document.body);
      return cs.getPropertyValue("-webkit-tap-highlight-color").trim();
    });
    // Chromium normaliza para rgba(0, 0, 0, 0) quando "transparent" é aplicado.
    expect(["transparent", "rgba(0, 0, 0, 0)"]).toContain(tap);
  });
});

test.describe("Toque — :active pressionado (7a.S.2 Task 2)", () => {
  test("existem >= 6 regras :active no CSS e nenhuma usa propriedade de layout", async ({
    page,
  }) => {
    await autenticar(page);
    const result = await page.evaluate(() => {
      // Props de layout que NUNCA podem animar em :active (regra hardware-accel
      // do DESIGN.md) — só transform/box-shadow (e cor/background) são permitidos.
      // Regex ancorada no início da declaração (após ';' ou início) para não dar
      // falso-positivo em border-left/padding-left/line-height/etc. (CRB S.2 general-swe).
      const layoutRe = /(^|;)\s*(top|left|right|bottom|height|padding|margin)\s*:/;
      const activeSelectors: string[] = [];
      const offenders: string[] = [];

      const walk = (list: CSSRuleList) => {
        for (const rule of Array.from(list)) {
          if (rule instanceof CSSMediaRule) {
            walk(rule.cssRules);
          } else if (rule instanceof CSSStyleRule) {
            if (rule.selectorText && rule.selectorText.includes(":active")) {
              activeSelectors.push(rule.selectorText);
              const cssText = rule.style.cssText.toLowerCase();
              if (layoutRe.test(cssText)) {
                offenders.push(`${rule.selectorText} → ${rule.style.cssText}`);
              }
            }
          }
        }
      };

      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue; // stylesheet cross-origin — não é o nosso caso, mas defensivo
        }
        walk(rules);
      }

      return { count: activeSelectors.length, offenders, activeSelectors };
    });

    expect(result.offenders).toEqual([]);
    expect(result.count).toBeGreaterThanOrEqual(6);
  });

  test(".tab-bar a encolhe (scale) ao ser pressionada (mouse down)", async ({
    page,
  }) => {
    await autenticar(page);
    const tab = page.locator('.tab-bar a[data-tab="rentab"]');
    await expect(tab).toBeVisible();
    const box = await tab.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    const transform = await tab.evaluate((e) => getComputedStyle(e).transform);
    await page.mouse.up();
    expect(transform).not.toBe("none");
  });

  test(".hero-link encolhe + ganha shadow-pressed ao ser pressionado (mouse down)", async ({
    page,
  }) => {
    await autenticar(page);
    const hero = page.locator(".hero-link");
    await expect(hero).toBeVisible();
    const box = await hero.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    const computed = await hero.evaluate((e) => {
      const cs = getComputedStyle(e);
      return { transform: cs.transform, boxShadow: cs.boxShadow };
    });
    await page.mouse.up();
    expect(computed.transform).not.toBe("none");
    expect(computed.boxShadow).not.toBe("none");
  });
});
