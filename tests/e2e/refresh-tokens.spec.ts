import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

// Fase 7a.S.1 — Fundação. Prova que o substrato de tokens do Refresh Monument
// resolve em :root (valores LIGHT; o bloco dark é S.12). Inerte por design:
// nenhum elemento aplica estes tokens ainda — S.2–S.12 os consomem.
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

test.describe("Refresh 7a.S tokens (S.1 fundação)", () => {
  test("monument num scale resolve (--num-poster-lg 46px / -xl 54px)", async ({
    page,
  }) => {
    await autenticar(page);
    const esperado: Record<string, string> = {
      "--num-poster-lg": "46px",
      "--num-poster-xl": "54px",
    };
    for (const [token, px] of Object.entries(esperado)) {
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

  test("contrato de motion — --ease/--ease-spring cubic-bezier + --d1/d2/d3", async ({
    page,
  }) => {
    await autenticar(page);
    const vals = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return {
        ease: cs.getPropertyValue("--ease").trim(),
        spring: cs.getPropertyValue("--ease-spring").trim(),
        d1: cs.getPropertyValue("--d1").trim(),
        d2: cs.getPropertyValue("--d2").trim(),
        d3: cs.getPropertyValue("--d3").trim(),
      };
    });
    expect(vals.ease).toContain("cubic-bezier");
    expect(vals.spring).toContain("cubic-bezier");
    expect(vals.d1).toBe(".14s");
    expect(vals.d2).toBe(".3s");
    expect(vals.d3).toBe(".55s");
  });

  test("--accent resolve ao teal âncora (#047857 = rgb(4, 120, 87))", async ({
    page,
  }) => {
    await autenticar(page);
    const color = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.color = "var(--accent)";
      document.body.appendChild(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    });
    expect(color).toBe("rgb(4, 120, 87)");
  });

  test("tokens semânticos LIGHT resolvem; hero-glow/card-topline transparentes", async ({
    page,
  }) => {
    await autenticar(page);
    const vals = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const get = (t: string) => cs.getPropertyValue(t).trim();
      return {
        "--accent-2": get("--accent-2"),
        "--accent-soft": get("--accent-soft"),
        "--surface-2": get("--surface-2"),
        "--faint": get("--faint"),
        "--shadow-pressed": get("--shadow-pressed"),
        "--pill": get("--pill"),
        "--amber-bg": get("--amber-bg"),
        "--amber-bd": get("--amber-bd"),
        "--tab-bg": get("--tab-bg"),
        "--hero-glow": get("--hero-glow"),
        "--card-topline": get("--card-topline"),
      };
    });
    for (const [k, v] of Object.entries(vals)) {
      if (k === "--hero-glow" || k === "--card-topline") {
        expect(v, `${k} deve ser transparent`).toBe("transparent");
      } else {
        expect(v.length, `${k} deve resolver não-vazio`).toBeGreaterThan(0);
      }
    }
  });
});

test.describe("Refresh 7a.S componentes (S.1 — inertes)", () => {
  test(".eyebrow: 11px/800/.2em uppercase cor --faint", async ({ page }) => {
    await autenticar(page);
    const cs = await page.evaluate(() => {
      const el = document.createElement("span");
      el.className = "eyebrow";
      el.textContent = "raio-x";
      document.body.appendChild(el);
      const s = getComputedStyle(el);
      const out = {
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        letterSpacing: s.letterSpacing,
        textTransform: s.textTransform,
      };
      el.remove();
      return out;
    });
    expect(cs.fontSize).toBe("11px");
    expect(cs.fontWeight).toBe("800");
    expect(cs.letterSpacing).toBe("2.2px"); // .2em × 11px
    expect(cs.textTransform).toBe("uppercase");
  });

  test(".grifo: border-left 3px solid accent + radius 0/14px (assinatura)", async ({
    page,
  }) => {
    await autenticar(page);
    const cs = await page.evaluate(() => {
      const el = document.createElement("div");
      el.className = "grifo";
      document.body.appendChild(el);
      const s = getComputedStyle(el);
      const out = {
        blw: s.borderLeftWidth,
        bls: s.borderLeftStyle,
        blc: s.borderLeftColor,
        rtl: s.borderTopLeftRadius,
        rtr: s.borderTopRightRadius,
      };
      el.remove();
      return out;
    });
    expect(cs.blw).toBe("3px");
    expect(cs.bls).toBe("solid");
    expect(cs.blc).toBe("rgb(4, 120, 87)"); // --accent → --g-700
    expect(cs.rtl).toBe("0px");
    expect(cs.rtr).toBe("14px");
  });
});
