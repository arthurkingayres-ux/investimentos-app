import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

// Fase 7a.S.12 — Modo Plantão (dark OLED, teal-como-luz). FECHA a umbrella
// 7a.S. Toggle ☽/☀ manual + persistido (localStorage "tema"), NUNCA
// prefers-color-scheme. Bloco [data-theme="dark"] 100% aditivo — light
// continua sendo o default idêntico ao pré-S.12.

const F = (n: string) =>
  fs.readFileSync(path.join(__dirname, "../fixtures/" + n), "utf-8");
const PORTFOLIO = F("portfolio.test.json.enc");

async function mockPortfolio(page: Page) {
  await page.route("**/portfolio.json.enc", (r) =>
    r.fulfill({ status: 200, body: PORTFOLIO, contentType: "text/plain" }),
  );
  // Isola do índice de relatórios real (mesmo racional de abertura.spec.ts) —
  // specs deste arquivo que não testam #/raiox/relatorio não precisam dele.
  await page.route("**/relatorios_index.json.enc", (route) =>
    route.fulfill({ status: 404, body: "", contentType: "text/plain" }),
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

function temaDoHtml(page: Page) {
  return page.evaluate(() => document.documentElement.getAttribute("data-theme"));
}

test.describe("7a.S.12 Task 1 — bloco dark + toggle + persist + boot", () => {
  test("boot sem localStorage.tema: data-theme = light (default)", async ({ page }) => {
    await autenticar(page);
    expect(await temaDoHtml(page)).toBe("light");
  });

  test("toggle ☽/☀ flips [data-theme] light → dark e persiste em localStorage", async ({ page }) => {
    await autenticar(page);
    const toggle = page.locator("button.theme-toggle");
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    await toggle.click();
    expect(await temaDoHtml(page)).toBe("dark");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    const salvo = await page.evaluate(() => localStorage.getItem("tema"));
    expect(salvo).toBe("dark");

    // Volta pro claro — flip simétrico.
    await toggle.click();
    expect(await temaDoHtml(page)).toBe("light");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(await page.evaluate(() => localStorage.getItem("tema"))).toBe("light");
  });

  test("boot restaura o tema salvo (dark) de uma sessão anterior", async ({ page }) => {
    await mockPortfolio(page);
    await page.addInitScript(() => {
      localStorage.setItem("pin", "123456");
      localStorage.setItem(
        "pinTimestamp",
        String(Date.now() - 1 * 24 * 60 * 60 * 1000),
      );
      localStorage.setItem("tema", "dark");
    });
    await page.goto("/");
    await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
    expect(await temaDoHtml(page)).toBe("dark");
    await expect(page.locator("button.theme-toggle")).toHaveAttribute("aria-pressed", "true");
  });

  test("boot IGNORA prefers-color-scheme:dark emulado — só localStorage decide", async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "dark" });
    const page = await context.newPage();
    await mockPortfolio(page);
    await page.addInitScript(() => {
      localStorage.setItem("pin", "123456");
      localStorage.setItem(
        "pinTimestamp",
        String(Date.now() - 1 * 24 * 60 * 60 * 1000),
      );
      // Nenhuma chave "tema" — default deve vencer mesmo com o SO em dark.
    });
    await page.goto("/");
    await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
    expect(await temaDoHtml(page)).toBe("light");
    await context.close();
  });

  test("bloco dark resolve tokens (--accent/--ink/--cat-acoes-br mudam sob [data-theme=dark])", async ({ page }) => {
    await autenticar(page);
    const claro = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return { accent: s.getPropertyValue("--accent").trim(), ink: s.getPropertyValue("--ink").trim() };
    });
    expect(claro.accent).toBe("#047857");

    await page.locator("button.theme-toggle").click();
    const escuro = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return {
        accent: s.getPropertyValue("--accent").trim(),
        ink: s.getPropertyValue("--ink").trim(),
        catAcoesBr: s.getPropertyValue("--cat-acoes-br").trim(),
        surface: s.getPropertyValue("--surface").trim(),
      };
    });
    expect(escuro.accent).toBe("#34d399");
    expect(escuro.ink).toBe("#f1efe4");
    expect(escuro.catAcoesBr).toBe("#34d399");
    expect(escuro.surface).toBe("#0c1510");
    expect(escuro.accent).not.toBe(claro.accent);
    expect(escuro.ink).not.toBe(claro.ink);
  });

  test("dark: fundo do body/hero e texto do hero refletem o tema (elemento real, não só o token)", async ({ page }) => {
    await autenticar(page);
    await page.locator("button.theme-toggle").click();
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    // --neutral-50 dark = #040906 = rgb(4, 9, 6)
    expect(bg).toBe("rgb(4, 9, 6)");
    const heroBg = await page.evaluate(() => {
      const el = document.querySelector(".hero");
      return el ? getComputedStyle(el).backgroundColor : null;
    });
    // .hero fica escuro nos DOIS temas (override dedicado) — #03110a = rgb(3,17,10)
    expect(heroBg).toBe("rgb(3, 17, 10)");
  });
});

// O toggle só existe dentro de `.raiox` (x-show="rota === ''") — no instante
// do clique NENHUMA tela de chart pode estar ativa (mesmo racional documentado
// em alternarTema(), js/app.js). O fluxo real e testável é: usuário troca o
// tema na home → navega (ou volta) para a tela do chart → hidratarX() roda de
// novo (dispose+init incondicional a cada entrada na rota) já lendo os tokens
// recém-reregistrados. `voltarHome` navega via a MESMA rota do tab-bar usada
// pelo resto da suíte (relatorio-mensal.spec.ts, etc.).
async function voltarHomeEAlternarTema(page: Page) {
  await page.locator('a[data-tab="raiox"]').click();
  await expect(page.locator(".raiox")).toBeVisible();
  await page.locator("button.theme-toggle").click();
  await expect.poll(() => temaDoHtml(page)).toBe("dark");
}

test.describe("7a.S.12 Task 2 — repaint dos charts", () => {
  test("rentabilidade: markPoint (Portfólio) e tooltip refletem o tema ao reentrar na tela pós-toggle", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#rentabilidade");
    await expect(page.locator(".tela-rentabilidade canvas[data-zr-dom-id]")).toBeVisible({ timeout: 5_000 });

    const antes = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (window as any).Alpine.$data(document.body);
      const opt = data.echartsRent.getOption();
      const tooltip = Array.isArray(opt.tooltip) ? opt.tooltip[0] : opt.tooltip;
      return {
        markColor: opt.series[0].markPoint.label.color,
        tooltipBg: tooltip.backgroundColor,
      };
    });
    expect(antes.markColor).toBe("#047857");
    expect(antes.tooltipBg).toBe("#ffffff");

    await voltarHomeEAlternarTema(page);
    await page.goto("/#rentabilidade");
    await expect(page.locator(".tela-rentabilidade canvas[data-zr-dom-id]")).toBeVisible({ timeout: 5_000 });

    const depois = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (window as any).Alpine.$data(document.body);
      const opt = data.echartsRent.getOption();
      const tooltip = Array.isArray(opt.tooltip) ? opt.tooltip[0] : opt.tooltip;
      return {
        markColor: opt.series[0].markPoint.label.color,
        tooltipBg: tooltip.backgroundColor,
      };
    });
    expect(depois.markColor).toBe("#34d399");
    expect(depois.markColor).not.toBe(antes.markColor);
    expect(depois.tooltipBg).toBe("#0c1510");
    expect(depois.tooltipBg).not.toBe(antes.tooltipBg);
  });

  test("L.1/L.2 sobrevivem a um repaint: dataZoom reancora Y e o card Período segue funcionando", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#rentabilidade");
    await expect(page.locator(".tela-rentabilidade canvas[data-zr-dom-id]")).toBeVisible({ timeout: 5_000 });

    await voltarHomeEAlternarTema(page);
    await page.goto("/#rentabilidade");
    await expect(page.locator(".tela-rentabilidade canvas[data-zr-dom-id]")).toBeVisible({ timeout: 5_000 });

    const subtitulo = page.locator(".tela-rentabilidade .chart-rent-subtitulo");
    await expect(subtitulo).toContainText(/Cresceu desde/);

    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (window as any).Alpine.$data(document.body);
      data.echartsRent.dispatchAction({ type: "dataZoom", start: 60, end: 100 });
    });
    await page.waitForTimeout(200);

    await expect(subtitulo).toContainText(/Cresceu desde/);
    const periodoTitulo = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (window as any).Alpine.$data(document.body);
      return data.periodoCustom.titulo;
    });
    expect(periodoTitulo).toBeTruthy();
  });

  test("proventos: repaint reconstrói o chart de barras sem perder dados (mesma contagem de barras)", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#proventos");
    await expect(page.locator(".tela-proventos")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#proventos-grafico canvas[data-zr-dom-id]")).toBeVisible({ timeout: 5_000 });

    const antesN = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (window as any).Alpine.$data(document.body);
      return data.echartsProv.getOption().series[0].data.length;
    });

    await voltarHomeEAlternarTema(page);
    await page.goto("/#proventos");
    await expect(page.locator("#proventos-grafico canvas[data-zr-dom-id]")).toBeVisible({ timeout: 5_000 });

    const depoisN = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (window as any).Alpine.$data(document.body);
      return data.echartsProv.getOption().series[0].data.length;
    });
    expect(depoisN).toBe(antesN);
    expect(depoisN).toBeGreaterThan(0);
  });

  test("reregister global refresca window.drarthurChart.tokens sem exigir re-obter o objeto (patrimônio)", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#/raiox/chart");
    await expect(page.locator(".tela-patrimonio")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#patrimonio-grafico canvas[data-zr-dom-id]")).toBeVisible({ timeout: 5_000 });

    const dcAntes = await page.evaluate(() => (window as unknown as { drarthurChart: { tokens: { g700: string } } }).drarthurChart.tokens.g700);
    expect(dcAntes).toBe("#047857");

    await voltarHomeEAlternarTema(page);

    // Mesmo objeto `tokens` (mutado in-place) — nenhum consumidor precisa
    // reobter `window.drarthurChart`. Já reflete o dark AQUI, mesmo sem
    // reentrar na tela do gráfico (a mutação é imediata, não lazy).
    const dcDepois = await page.evaluate(() => (window as unknown as { drarthurChart: { tokens: { g700: string } } }).drarthurChart.tokens.g700);
    expect(dcDepois).toBe("#34d399");

    await page.goto("/#/raiox/chart");
    await expect(page.locator("#patrimonio-grafico canvas[data-zr-dom-id]")).toBeVisible({ timeout: 5_000 });
    // expect.poll: espera a re-renderização async do chart (hidratarPatrimonio
    // dispose+init+setOption) assentar antes de ler o getOption — o canvas ficar
    // visível NÃO garante que o markPoint já foi setado (era flaky). CRB 7a.S.12.
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const data = (window as any).Alpine.$data(document.body);
            const mp = data.echartsPatr?.getOption()?.series?.[0]?.markPoint;
            return mp?.label?.color ?? null;
          }),
        { timeout: 5_000 },
      )
      .toBe("#34d399");
  });
});

test.describe("7a.S.12 Task 3 — teal-como-luz + contraste AA", () => {
  test("WCAG AA: --ink sobre --neutral-50/--surface ≥ 4.5:1; --gray/--accent/--cat-* ≥ 3:1 no dark", async ({ page }) => {
    await autenticar(page);
    await page.locator("button.theme-toggle").click();
    const t = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      const get = (k: string) => s.getPropertyValue(k).trim();
      return {
        ink: get("--ink"), bg: get("--neutral-50"), surface: get("--surface"),
        gray: get("--gray"), accent: get("--accent"), red: get("--red"), amber: get("--amber"),
        // Cores de benchmark lidas JS-side por echarts-theme (CDI=gray, IBOV=amber-700,
        // S&P500=blue-700) — grep de seletor CSS não as pega; testar aqui (CRB 7a.S.12).
        blue700: get("--blue-700"), amber700: get("--amber-700"),
        catEua: get("--cat-eua"), catAcoesBr: get("--cat-acoes-br"),
        catFii: get("--cat-fii"), catCripto: get("--cat-cripto"), catRf: get("--cat-renda-fixa-br"),
      };
    });

    function luminance(hex: string): number {
      const c = hex.replace("#", "");
      const r = parseInt(c.substring(0, 2), 16) / 255;
      const g = parseInt(c.substring(2, 4), 16) / 255;
      const b = parseInt(c.substring(4, 6), 16) / 255;
      const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    }
    function contrast(a: string, b: string): number {
      const l1 = luminance(a) + 0.05;
      const l2 = luminance(b) + 0.05;
      return l1 > l2 ? l1 / l2 : l2 / l1;
    }

    expect(contrast(t.ink, t.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.ink, t.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.gray, t.bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(t.accent, t.bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(t.red, t.bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(t.amber, t.bg)).toBeGreaterThanOrEqual(3);
    // Benchmarks do gráfico (S&P500/IBOV, JS-read) ≥ 3:1 no dark.
    expect(contrast(t.blue700, t.bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(t.amber700, t.bg)).toBeGreaterThanOrEqual(3);
    // Categorias — uso gráfico (dot/série), meta ≥3:1 contra o fundo.
    for (const cat of [t.catEua, t.catAcoesBr, t.catFii, t.catCripto, t.catRf]) {
      expect(contrast(cat, t.bg)).toBeGreaterThanOrEqual(3);
    }
  });

  test("card ganha hairline superior (--card-topline) no dark; ausente no light", async ({ page }) => {
    // .card só aparece de fato em #aportar (.aporte-card herda .card), e só
    // depois de preencher o simulador (S.10 — cards se montam sob valor). O
    // toggle vive só em .raiox, então o padrão é: verifica claro → volta pra
    // home → alterna → revisita a tela (preenche de novo) pra checar o dark.
    await autenticar(page);
    await page.goto("/#aportar");
    await expect(page.locator(".tela-aportar")).toBeVisible({ timeout: 10_000 });
    await page.locator(".aporte-input").fill("5000");
    await expect(page.locator(".aporte-card").first()).toBeVisible({ timeout: 5_000 });
    const claro = await page.evaluate(() => getComputedStyle(document.querySelector(".card") as Element).boxShadow);
    expect(claro).not.toContain("inset");

    await voltarHomeEAlternarTema(page);
    await page.goto("/#aportar");
    await expect(page.locator(".tela-aportar")).toBeVisible({ timeout: 10_000 });
    await page.locator(".aporte-input").fill("5000");
    await expect(page.locator(".aporte-card").first()).toBeVisible({ timeout: 5_000 });
    const escuro = await page.evaluate(() => getComputedStyle(document.querySelector(".card") as Element).boxShadow);
    expect(escuro).toContain("inset");
  });

  test("tab-bar-indicator ganha glow teal no dark", async ({ page }) => {
    await autenticar(page);
    const claro = await page.evaluate(() => {
      const el = document.querySelector(".tab-bar-indicator");
      return el ? getComputedStyle(el).boxShadow : "none";
    });
    expect(claro).toBe("none");

    await page.locator("button.theme-toggle").click();
    const escuro = await page.evaluate(() => {
      const el = document.querySelector(".tab-bar-indicator");
      return el ? getComputedStyle(el).boxShadow : "none";
    });
    expect(escuro).not.toBe("none");
  });

  test("poster (#s-dy) ganha text-shadow teal no dark", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#/proventos/dy");
    await expect(page.locator(".tela-dy")).toBeVisible({ timeout: 10_000 });
    const claro = await page.evaluate(() => getComputedStyle(document.querySelector(".poster") as Element).textShadow);
    expect(claro).toBe("none");

    await page.locator('a[data-tab="raiox"]').click();
    await expect(page.locator(".raiox")).toBeVisible();
    await page.locator("button.theme-toggle").click();
    await page.goto("/#/proventos/dy");
    await expect(page.locator(".tela-dy")).toBeVisible({ timeout: 10_000 });
    const escuro = await page.evaluate(() => getComputedStyle(document.querySelector(".poster") as Element).textShadow);
    expect(escuro).not.toBe("none");
  });

  test("seg.on (.escopo-toggle button.active) ganha tinta escura sobre o teal no dark", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#rentabilidade");
    await expect(page.locator(".tela-rentabilidade")).toBeVisible({ timeout: 10_000 });

    const claro = await page.evaluate(() =>
      getComputedStyle(document.querySelector(".escopo-toggle button.active") as Element).color,
    );
    expect(claro).toBe("rgb(255, 255, 255)");

    await voltarHomeEAlternarTema(page);
    await page.goto("/#rentabilidade");
    await expect(page.locator(".tela-rentabilidade")).toBeVisible({ timeout: 10_000 });
    const escuro = await page.evaluate(() =>
      getComputedStyle(document.querySelector(".escopo-toggle button.active") as Element).color,
    );
    expect(escuro).toBe("rgb(4, 19, 12)");
  });
});

test.describe("7a.S.12 Task 4 — screenshots light+dark (prova visual)", () => {
  test("captura raiox/rentabilidade/alocacao/proventos/dy/relatorio/aportar nos DOIS temas", async ({ page }) => {
    test.setTimeout(60_000);
    const INDICE = F("relatorios_index.test.json.enc");
    const MAIO = F("relatorio_2026-05.test.json.enc");
    await page.route("**/portfolio.json.enc", (r) =>
      r.fulfill({ status: 200, body: PORTFOLIO, contentType: "text/plain" }));
    await page.route("**/relatorios_index.json.enc", (r) =>
      r.fulfill({ status: 200, body: INDICE, contentType: "text/plain" }));
    await page.route("**/relatorio_*.json.enc", (r) =>
      r.fulfill({ status: 200, body: MAIO, contentType: "text/plain" }));
    await page.addInitScript(() => {
      localStorage.setItem("pin", "123456");
      localStorage.setItem("pinTimestamp", String(Date.now() - 1 * 24 * 60 * 60 * 1000));
    });

    const rotas: Array<{ hash: string; selector: string; nome: string }> = [
      { hash: "", selector: ".raiox", nome: "raiox" },
      { hash: "#rentabilidade", selector: ".tela-rentabilidade", nome: "rentabilidade" },
      { hash: "#alocacao", selector: ".tela-alocacao", nome: "alocacao" },
      { hash: "#proventos", selector: ".tela-proventos", nome: "proventos" },
      { hash: "#/proventos/dy", selector: ".tela-dy", nome: "dy" },
      { hash: "#/raiox/relatorio", selector: ".tela-relatorio", nome: "relatorio" },
      { hash: "#aportar", selector: ".tela-aportar", nome: "aportar" },
    ];
    const dir = path.join(__dirname, "../screenshots");
    fs.mkdirSync(dir, { recursive: true });

    for (const tema of ["light", "dark"] as const) {
      await page.goto("/");
      await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
      if (tema === "dark") {
        await page.locator("button.theme-toggle").click();
        expect(await temaDoHtml(page)).toBe("dark");
      }
      for (const r of rotas) {
        await page.goto("/" + r.hash);
        await expect(page.locator(r.selector)).toBeVisible({ timeout: 10_000 });
        if (r.nome === "aportar") {
          // Simulador só monta os cards com um valor preenchido — screenshot
          // mais representativo (senão captura só o estado vazio).
          await page.locator(".aporte-input").fill("5000");
          await page.waitForTimeout(200);
        }
        await page.waitForTimeout(200); // settle de motion/chart antes do screenshot
        await page.screenshot({ path: path.join(dir, `modo-plantao-${r.nome}-${tema}.png`) });
      }
    }
  });
});
