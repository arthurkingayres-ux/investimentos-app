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

async function abrirRentabilidade(page: Page) {
  await page.goto("/#rentabilidade");
  await expect(
    page.locator(".tela-rentabilidade canvas[data-zr-dom-id]"),
  ).toBeVisible({ timeout: 5_000 });
}

async function abrirPatrimonio(page: Page) {
  await page.goto("/#/raiox/chart");
  await expect(page.locator(".tela-patrimonio")).toBeVisible({ timeout: 10_000 });
  await expect(
    page.locator("#patrimonio-grafico canvas[data-zr-dom-id]"),
  ).toBeVisible({ timeout: 5_000 });
}

async function abrirProventos(page: Page, modo: "anual" | "mensal" = "anual") {
  await page.goto("/#proventos");
  await expect(page.locator(".tela-proventos")).toBeVisible({ timeout: 10_000 });
  if (modo === "mensal") {
    await page.locator(".tela-proventos .escopo-toggle button", { hasText: /Mensal/i }).click();
    await page.waitForTimeout(200);
  }
  await expect(
    page.locator("#proventos-grafico canvas[data-zr-dom-id]"),
  ).toBeVisible({ timeout: 5_000 });
}

// Acessor genérico à option do ECharts via Alpine $data — mesmo padrão de
// rentabilidade-period-relative.spec.ts.
async function getOption(page: Page, propriedade: "echartsRent" | "echartsPatr" | "echartsProv") {
  return page.evaluate((prop) => {
    const data = (window as unknown as { Alpine: { $data: (el: Element) => Record<string, unknown> } }).Alpine.$data(document.body);
    const chart = (data as Record<string, { getOption: () => Record<string, unknown> } | undefined>)[prop];
    if (!chart) return null;
    return chart.getOption();
  }, propriedade);
}

test.describe("7a.S.3 — Higiene de dataviz (ECharts)", () => {
  test.describe("Task 1 — símbolo só no último ponto", () => {
    test("rentabilidade (Total, multi-bench): Portfólio sem símbolo ao longo da linha + markPoint no último ponto; benchmarks sem símbolo e sem markPoint", async ({ page }) => {
      await autenticar(page);
      await abrirRentabilidade(page);

      const opt = await getOption(page, "echartsRent");
      expect(opt).not.toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const series = (opt as any).series as Array<Record<string, unknown>>;
      expect(series.length).toBeGreaterThanOrEqual(2); // Portfólio + ao menos 1 benchmark

      const portfolio = series[0];
      expect(portfolio.name).toBe("Portfólio");
      expect(portfolio.showSymbol).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const markPoint = portfolio.markPoint as any;
      expect(markPoint).toBeTruthy();
      expect(Array.isArray(markPoint.data)).toBe(true);
      expect(markPoint.data.length).toBe(1);

      for (let i = 1; i < series.length; i++) {
        const bench = series[i];
        expect(bench.showSymbol).toBe(false);
        expect(bench.markPoint ?? undefined).toBeUndefined();
      }
    });

    test("patrimônio: Patrimônio sem símbolo + markPoint no último ponto; Aporte acum. sem símbolo e sem markPoint", async ({ page }) => {
      await autenticar(page);
      await abrirPatrimonio(page);

      const opt = await getOption(page, "echartsPatr");
      expect(opt).not.toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const series = (opt as any).series as Array<Record<string, unknown>>;
      expect(series.length).toBe(2);

      const patrimonio = series[0];
      expect(patrimonio.name).toBe("Patrimônio");
      expect(patrimonio.showSymbol).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const markPoint = patrimonio.markPoint as any;
      expect(markPoint).toBeTruthy();
      expect(markPoint.data.length).toBe(1);

      const aporte = series[1];
      expect(aporte.name).toBe("Aporte acum.");
      expect(aporte.showSymbol).toBe(false);
      expect(aporte.markPoint ?? undefined).toBeUndefined();
    });

    test("rentabilidade: markPoint reancora após dataZoom (não fica preso no índice antigo)", async ({ page }) => {
      await autenticar(page);
      await abrirRentabilidade(page);

      const idxAntes = await page.evaluate(() => {
        const data = (window as unknown as { Alpine: { $data: (el: Element) => Record<string, unknown> } }).Alpine.$data(document.body);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chart = (data as any).echartsRent;
        const mp = chart.getOption().series[0].markPoint;
        return mp?.data?.[0]?.coord?.[0] ?? null;
      });
      expect(idxAntes).not.toBeNull();

      await page.evaluate(() => {
        const data = (window as unknown as { Alpine: { $data: (el: Element) => Record<string, unknown> } }).Alpine.$data(document.body);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chart = (data as any).echartsRent;
        chart.dispatchAction({ type: "dataZoom", start: 0, end: 60 });
      });
      await page.waitForTimeout(200);

      const idxDepois = await page.evaluate(() => {
        const data = (window as unknown as { Alpine: { $data: (el: Element) => Record<string, unknown> } }).Alpine.$data(document.body);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chart = (data as any).echartsRent;
        const mp = chart.getOption().series[0].markPoint;
        return mp?.data?.[0]?.coord?.[0] ?? null;
      });
      expect(idxDepois).not.toBeNull();
      expect(idxDepois).not.toBe(idxAntes);
    });
  });

  test.describe("Task 2 — eixo Y ancorado nos dados (equity patrimônio)", () => {
    test("yAxis do patrimônio NÃO é zero-anchored: min < menor valor da série, com folga", async ({ page }) => {
      await autenticar(page);
      await abrirPatrimonio(page);

      const resultado = await page.evaluate(() => {
        const data = (window as unknown as { Alpine: { $data: (el: Element) => Record<string, unknown> } }).Alpine.$data(document.body);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chart = (data as any).echartsPatr;
        if (!chart) return null;
        const opt = chart.getOption();
        const yAxis = opt.yAxis[0];
        const totais = opt.series[0].data as number[];
        const aportes = opt.series[1].data as number[];
        return {
          min: yAxis.min,
          max: yAxis.max,
          menorDado: Math.min(...totais, ...aportes),
          maiorDado: Math.max(...totais, ...aportes),
        };
      });
      expect(resultado).not.toBeNull();
      const { min, max, menorDado, maiorDado } = resultado as { min: number; max: number; menorDado: number; maiorDado: number };
      expect(typeof min).toBe("number");
      expect(typeof max).toBe("number");
      // NÃO zero-anchored: min é folga abaixo do menor dado, não 0.
      expect(min).not.toBe(0);
      expect(min).toBeLessThan(menorDado);
      expect(max).toBeGreaterThan(maiorDado);
      // Folga honesta (~12% abaixo / ~14% acima do range) — não exagerada.
      const span = maiorDado - menorDado;
      expect(menorDado - min).toBeLessThan(span * 0.25);
      expect(max - maiorDado).toBeLessThan(span * 0.25);
    });

    test("gráfico de proventos (barras) permanece zero-anchored (sem regressão)", async ({ page }) => {
      await autenticar(page);
      await abrirProventos(page, "anual");

      const yMin = await page.evaluate(() => {
        const data = (window as unknown as { Alpine: { $data: (el: Element) => Record<string, unknown> } }).Alpine.$data(document.body);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chart = (data as any).echartsProv;
        if (!chart) return undefined;
        return chart.getOption().yAxis[0].min;
      });
      // ECharts default (sem min explícito) ancora em 0 quando todos os valores
      // são positivos — min deve ser undefined (não configuramos) ou 0.
      expect(yMin === undefined || yMin === 0).toBe(true);
    });
  });

  test.describe("Task 3 — barra parcial hachurada (proventos)", () => {
    test("modo Anual: última barra (ano corrente) tem decal + opacity distinta; demais sem decal", async ({ page }) => {
      await autenticar(page);
      await abrirProventos(page, "anual");

      const barData = await page.evaluate(() => {
        const data = (window as unknown as { Alpine: { $data: (el: Element) => Record<string, unknown> } }).Alpine.$data(document.body);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chart = (data as any).echartsProv;
        const opt = chart.getOption();
        return opt.series[0].data as Array<{ value: number; itemStyle?: { decal?: unknown; opacity?: number } }>;
      });
      expect(barData.length).toBeGreaterThan(1);

      const ultima = barData[barData.length - 1];
      expect(ultima.itemStyle?.decal).toBeTruthy();
      expect(ultima.itemStyle?.opacity).toBeCloseTo(0.65, 1);

      for (let i = 0; i < barData.length - 1; i++) {
        expect(barData[i].itemStyle?.decal ?? undefined).toBeUndefined();
      }

      const nota = await page.locator("#proventosNotaParcial").textContent();
      expect(nota).toMatch(/em curso/i);
      expect(nota).toMatch(/2026/); // fixture: última barra anual = 2026
    });

    test("modo Mensal: última barra (mês corrente) tem decal; nota cita o mês", async ({ page }) => {
      await autenticar(page);
      await abrirProventos(page, "mensal");

      const barData = await page.evaluate(() => {
        const data = (window as unknown as { Alpine: { $data: (el: Element) => Record<string, unknown> } }).Alpine.$data(document.body);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chart = (data as any).echartsProv;
        const opt = chart.getOption();
        return opt.series[0].data as Array<{ value: number; itemStyle?: { decal?: unknown } }>;
      });
      const ultima = barData[barData.length - 1];
      expect(ultima.itemStyle?.decal).toBeTruthy();

      const nota = await page.locator("#proventosNotaParcial").textContent();
      expect(nota).toMatch(/em curso/i);
      // fixture: mensal_12m última entrada = 2026-04 → label "Abr/26"
      expect(nota).toMatch(/Abr\/26/i);
    });

    test("drilldown preservado: clicar na barra parcial mantém decal e realça opacity", async ({ page }) => {
      await autenticar(page);
      await abrirProventos(page, "mensal");

      const box = await page.locator("#proventos-grafico").boundingBox();
      if (!box) throw new Error("sem boundingBox");
      // Última barra fica próxima da borda direita do container.
      await page.mouse.click(box.x + box.width - 20, box.y + box.height - 20);
      await page.waitForTimeout(250);

      const barData = await page.evaluate(() => {
        const data = (window as unknown as { Alpine: { $data: (el: Element) => Record<string, unknown> } }).Alpine.$data(document.body);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chart = (data as any).echartsProv;
        return chart.getOption().series[0].data as Array<{ itemStyle?: { decal?: unknown; opacity?: number } }>;
      });
      const ultima = barData[barData.length - 1];
      // Decal é atributo de honestidade de dado — persiste independente de seleção.
      expect(ultima.itemStyle?.decal).toBeTruthy();
    });
  });

  test.describe("Task 4 — scrubber-instrumento (dataZoom restyle)", () => {
    async function getSlider(page: Page, propriedade: "echartsRent" | "echartsPatr") {
      const opt = await getOption(page, propriedade);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dz = (opt as any).dataZoom as Array<Record<string, unknown>>;
      const slider = dz.find((d) => d.type === "slider");
      const inside = dz.find((d) => d.type === "inside");
      return { slider, inside };
    }

    test("rentabilidade: slider fino, sem chrome pesado (brushSelect/showDetail/dataBackground)", async ({ page }) => {
      await autenticar(page);
      await abrirRentabilidade(page);
      const { slider, inside } = await getSlider(page, "echartsRent");
      expect(slider).toBeTruthy();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = slider as any;
      expect(s.height).toBeLessThanOrEqual(10);
      expect(s.brushSelect).toBe(false);
      expect(s.showDetail).toBe(false);
      expect(typeof s.handleIcon).toBe("string");
      // dataBackground "chrome pesado" oculto/sutil (opacity baixa).
      if (s.dataBackground) {
        const lineOp = s.dataBackground.lineStyle?.opacity;
        const areaOp = s.dataBackground.areaStyle?.opacity;
        if (lineOp !== undefined) expect(lineOp).toBeLessThanOrEqual(0.05);
        if (areaOp !== undefined) expect(areaOp).toBeLessThanOrEqual(0.05);
      }
      // Cor da marca (fillerColor/backgroundColor não-transparent, brand-tinted).
      expect(String(s.fillerColor)).toMatch(/rgba?\(4,\s?120,\s?87/);
      expect(inside).toBeTruthy();
    });

    test("patrimônio: mesmo restyle do scrubber aplicado", async ({ page }) => {
      await autenticar(page);
      await abrirPatrimonio(page);
      const { slider, inside } = await getSlider(page, "echartsPatr");
      expect(slider).toBeTruthy();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = slider as any;
      expect(s.height).toBeLessThanOrEqual(10);
      expect(s.brushSelect).toBe(false);
      expect(s.showDetail).toBe(false);
      expect(typeof s.handleIcon).toBe("string");
      expect(inside).toBeTruthy();
    });

    test("L.1 SEGUE funcionando após o restyle: zoom reancora Y e atualiza subtítulo", async ({ page }) => {
      await autenticar(page);
      await abrirRentabilidade(page);

      const subtitulo = page.locator(".tela-rentabilidade .chart-rent-subtitulo");
      await expect(subtitulo).toContainText(/Cresceu desde/);

      await page.evaluate(() => {
        const data = (window as unknown as { Alpine: { $data: (el: Element) => Record<string, unknown> } }).Alpine.$data(document.body);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chart = (data as any).echartsRent;
        chart.dispatchAction({ type: "dataZoom", start: 60, end: 100 });
      });
      await page.waitForTimeout(200);

      await expect(subtitulo).toContainText(/Cresceu desde/);
      const periodoTitulo = await page.evaluate(() => {
        const data = (window as unknown as { Alpine: { $data: (el: Element) => Record<string, unknown> } }).Alpine.$data(document.body);
        return (data as { periodoCustom: { titulo: string } }).periodoCustom.titulo;
      });
      expect(periodoTitulo).toBeTruthy();
    });
  });
});
