import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

// Fase 7a.AV.2 — tela #/raiox/projecao (card na home + conteúdo textual +
// estados). O gráfico entra na Task 12; aqui #chart-projecao é só o container.
// Fixtures 100% sintéticas (gerar_fixture.py::_projecao_sintetica): idades e
// anos são deliberadamente fictícios, então os asserts abaixo não dependem de
// idade/ano específicos, exceto o "Aos 65", que é o horizonte fixo da fase.

const fx = (n: string) => fs.readFileSync(path.join(__dirname, "../fixtures", n), "utf-8");
const PRINCIPAL = fx("portfolio.test.json.enc");
const NULO = fx("portfolio_projecao_null.test.json.enc");
const PRE = fx("portfolio_pre_v227.test.json.enc");

test.use({ viewport: { width: 390, height: 844 } });

async function autenticar(page: Page, corpo = PRINCIPAL) {
  await page.route("**/portfolio.json.enc", (r) =>
    r.fulfill({ status: 200, body: corpo, contentType: "text/plain" }));
  await page.addInitScript(() => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem("pinTimestamp", String(Date.now() - 86_400_000));
  });
  await page.goto("/");
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
}

// Barreira no nó que é gate de DADO (x-if), não no x-show da tela.
async function abrirProjecao(page: Page) {
  await page.goto("/#/raiox/projecao");
  await expect(page.locator(".tela-projecao .proj-corpo")).toBeVisible();
}

test.describe("Projeção até os 65 (7a.AV.2)", () => {
  test("card na home abre a tela e a tab Raio-X persiste", async ({ page }) => {
    await autenticar(page);
    const card = page.locator(".proj-card-home");
    await expect(card).toBeVisible();
    await expect(card).toContainText("valor central");
    await card.click();
    await expect(page).toHaveURL(/#\/raiox\/projecao$/);
    await expect(page.locator(".tela-projecao")).toBeVisible();
    await expect(page.locator('.tab-bar a[data-tab="raiox"]')).toHaveAttribute("aria-current", "page");
  });

  test("voltar do breadcrumb devolve à home Raio-X", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    await page.locator('.tela-projecao .breadcrumb button[aria-label="Voltar"]').click();
    await expect(page.locator(".tela-projecao")).toBeHidden();
    await expect(page.locator(".proj-card-home")).toBeVisible();
  });

  test("linha-resposta com a faixa e o valor central", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const resp = page.locator(".proj-resposta");
    await expect(resp).toContainText("Aos 65, entre");
    await expect(resp).toContainText("valor central");
    await expect(resp).toContainText("em reais de hoje");
    await expect(resp).not.toContainText("mais provável");
  });

  test("os dois números da faixa são os maiores da tela", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const tamanhos = await page.evaluate(() => {
      const px = (el: Element) => parseFloat(getComputedStyle(el).fontSize);
      const faixa = Array.from(document.querySelectorAll(".proj-resposta .proj-faixa")).map(px);
      const outros = Array.from(document.querySelectorAll(".tela-projecao *"))
        .filter((el) => !el.classList.contains("proj-faixa") && (el as HTMLElement).offsetParent !== null
          && el.childElementCount === 0 && (el.textContent || "").trim() !== "")
        .map(px);
      return { faixa, maxOutros: Math.max(...outros) };
    });
    expect(tamanhos.faixa).toHaveLength(2);
    for (const t of tamanhos.faixa) expect(t).toBeGreaterThan(tamanhos.maxOutros);
  });

  test("aria-label do gráfico é dinâmico e carrega o resultado", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const esperado = await page.evaluate(() => {
      const app = (window as any).Alpine.$data(document.body);
      const f = app.projFinal();
      return {
        idade: String(app.projecao.idade_final),
        p10: app.formatBrlCompacto(f.p10),
        p50: app.formatBrlCompacto(f.p50),
        p90: app.formatBrlCompacto(f.p90),
      };
    });
    const label = await page.locator("#chart-projecao").getAttribute("aria-label");
    expect(label).toContain("Aos " + esperado.idade + ", entre " + esperado.p10 + " e " + esperado.p90);
    expect(label).toContain("valor central " + esperado.p50);
    await expect(page.locator("#chart-projecao")).toHaveAttribute("role", "img");
  });

  test("'e se' lista 2 sensibilidades e 3 cenários hipotéticos com sinal em texto", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const sens = page.locator(".proj-sens li");
    await expect(sens).toHaveCount(2);
    for (let i = 0; i < 2; i++) await expect(sens.nth(i)).toContainText("+R$");
    await expect(page.locator(".proj-estresse-titulo")).toContainText("hipotéticos");
    const est = page.locator(".proj-estresse li");
    await expect(est).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      await expect(est.nth(i)).toContainText("−R$");
      // forma + texto + cor: seta decorativa (aria-hidden) e classe de cor
      await expect(est.nth(i).locator(".proj-delta")).toHaveClass(/proj-neg/);
      await expect(est.nth(i).locator('.proj-delta [aria-hidden="true"]')).toHaveText("▼");
    }
  });

  test("premissas: aporte, 4 classes com fonte recolhida, e a linha do viés", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    await expect(page.locator(".proj-premissas tbody tr.proj-classe")).toHaveCount(4);
    const det = page.locator(".proj-premissas details").first();
    await expect(det).not.toHaveAttribute("open", "");
    await expect(page.locator(".tela-projecao")).toContainText("brutos de impostos e custos");
    await expect(page.locator(".tela-projecao")).toContainText("10.000 trajetórias");
    await expect(page.locator(".tela-projecao")).toContainText("Projeção, não promessa.");
  });

  test("aporte: o histórico 12m é um só e cobre os dois períodos", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const aporte = page.locator(".proj-aporte");
    // colunas = antes e depois do marco; linhas = histórico · estimativa · usado
    await expect(aporte.locator("thead th")).toHaveCount(3);
    await expect(aporte.locator("tbody tr")).toHaveCount(3);
    const hist = aporte.locator("td.proj-hist");
    await expect(hist).toHaveCount(1);
    await expect(hist).toHaveAttribute("colspan", "2");
    await expect(aporte).not.toContainText("igual");
    // estimativa ausente na fixture: texto, não travessão
    await expect(aporte).toContainText("não informada");
  });

  test("fonte por classe abre no toque e o summary tem alvo de 44 px", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const sums = page.locator(".proj-premissas summary");
    await expect(sums).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      const box = await sums.nth(i).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await sums.first().click();
    await expect(page.locator(".proj-premissas details").first()).toHaveAttribute("open", "");
    await expect(page.locator(".proj-premissas details").first()).toContainText("Fonte sintética A");
  });

  // CRB Suggestion 1 (2026-09-25): `p.fonte + ' (' + p.periodo + ')'` sem
  // guarda de nulo renderizava "undefined (undefined)" em vez do fallback
  // "—" que o resto da tela usa para dado ausente. Mutação in-test do
  // payload já decifrado (mesmo idioma de ativo-dy.spec.ts): não regenera
  // fixture, apaga fonte e período de uma única premissa.
  test("citação de premissa sem fonte/período usa o fallback '—', nunca 'undefined'", async ({ page }) => {
    await autenticar(page);
    await page.evaluate(() => {
      const $data = (window as any).Alpine?.$data?.(document.body);
      if (!$data) throw new Error("Alpine.$data ausente");
      delete $data.json.projecao.premissas[0].fonte;
      delete $data.json.projecao.premissas[0].periodo;
    });
    await abrirProjecao(page);
    const sums = page.locator(".proj-premissas summary");
    await sums.first().click();
    await expect(page.locator(".proj-fonte__txt").first()).toHaveText("—");
    const pagina = await page.locator(".tela-projecao").innerText();
    expect(pagina).not.toContain("undefined");
  });

  test("premissas por classe exibem o valor aprovado sem comer dígito", async ({ page }) => {
    // A tabela existe para o dono auditar o que o modelo usa: retorno real com
    // 2 casas e volatilidade com 1, como aprovados (G3 da Task 11). Fixture:
    // vol 0.30/0.20/0.15/0.10, retorno 0.05/0.06/0.04/0.05.
    await autenticar(page);
    await abrirProjecao(page);
    const linhas = page.locator(".proj-classes tbody tr.proj-classe");
    const vol = ["30,0%", "20,0%", "15,0%", "10,0%"];
    const ret = ["5,00%", "6,00%", "4,00%", "5,00%"];
    for (let i = 0; i < 4; i++) {
      await expect(linhas.nth(i).locator("td").nth(1)).toHaveText(ret[i]);
      await expect(linhas.nth(i).locator("td").nth(2)).toHaveText(vol[i]);
    }
    // e a formatação é fiel a valores reais com dígito significativo
    const r = await page.evaluate(() => [
      (window as any).formatPctSemSinal(0.095, 1), (window as any).formatPctSemSinal(0.377, 1),
      (window as any).formatPctSemSinal(0.0538, 2), (window as any).formatPctSemSinal(0.0331, 2)]);
    expect(r).toEqual(["9,5%", "37,7%", "5,38%", "3,31%"]);
  });

  test("formatBrl ganhou casas opcionais sem mudar a saída de sempre", async ({ page }) => {
    await autenticar(page);
    const r = await page.evaluate(() => {
      const w = window as any, app = w.Alpine.$data(document.body);
      return [w.formatBrl(1234.5), w.formatBrl(null), app.formatBrlInteiro(20000.4), app.formatBrlInteiro(null)];
    });
    expect(r.map((x: string) => x.replace(/\u00a0/g, " "))).toEqual(["R$ 1.234,50", "R$ 0,00", "R$ 20.000", "—"]);
  });

  test("copy sem travessão e sem verbo de ação", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    const txt = await page.locator(".tela-projecao").innerText();
    expect(txt).not.toContain("—");
    expect(txt).not.toMatch(/\b(aporte mais|compre|venda)\b/i);
    expect(txt).not.toMatch(/mais provável/i);
  });

  for (const [nome, corpo] of [["null", NULO], ["pré-v2.27", PRE]] as const) {
    test(`payload ${nome}: card some e a rota diz indisponível, sem erro no console`, async ({ page }) => {
      const erros: string[] = [];
      page.on("pageerror", (e) => erros.push(String(e)));
      await autenticar(page, corpo);
      await expect(page.locator(".proj-card-home")).toBeHidden();
      await page.goto("/#/raiox/projecao");
      await expect(page.locator(".tela-projecao")).toContainText(
        "Projeção indisponível: premissas ausentes ou inválidas.");
      await expect(page.locator(".tela-projecao .proj-corpo")).toHaveCount(0);
      expect(erros).toEqual([]);
    });
  }

  // CRB Suggestion 4 (2026-09-25): `x-show="projecao"` só checava o objeto,
  // não o último ponto — com `projecao` presente mas `pontos` vazio (shape
  // improvável; o backend valida, mas barato de fechar) o card aparecia sem
  // subtítulo. `projFinal()` já devolve `null` nesse caso; o card passa a
  // usar o mesmo guard.
  test("home: projeção com pontos vazio (shape improvável) esconde o card, sem erro no console", async ({ page }) => {
    const erros: string[] = [];
    page.on("pageerror", (e) => erros.push(String(e)));
    await autenticar(page);
    await page.evaluate(() => {
      const $data = (window as any).Alpine?.$data?.(document.body);
      if (!$data) throw new Error("Alpine.$data ausente");
      $data.json.projecao.pontos = [];
    });
    await expect(page.locator(".proj-card-home")).toBeHidden();
    expect(erros).toEqual([]);
  });

  test("formato compacto arredonda antes de escolher a banda", async ({ page }) => {
    await autenticar(page);
    const r = await page.evaluate(() => {
      // idioma da casa: o app vive em document.body (medido em aportar-mercado.spec.ts)
      const app = (window as any).Alpine.$data(document.body);
      return [999_600, 999_499, 1_000_000, 2_437_000, -1_060_000, 850_400, 400].map((v) => app.formatBrlCompacto(v));
    });
    // -1_060_000 e não -1_050_000: 1,05 em binário arredonda por toFixed de forma dependente do motor.
    expect(r).toEqual(["R$ 1,0 mi", "R$ 999 mil", "R$ 1,0 mi", "R$ 2,4 mi", "−R$ 1,1 mi", "R$ 850 mil", "R$ 400"]);
  });

  test("320 px sem overflow horizontal (página e tabelas)", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await autenticar(page);
    await abrirProjecao(page);
    const m = await page.evaluate(() => ({
      pagina: document.documentElement.scrollWidth,
      tabelas: Array.from(document.querySelectorAll(".proj-premissas")).map(
        (t) => [t.scrollWidth, (t.parentElement as HTMLElement).clientWidth]),
    }));
    expect(m.pagina).toBeLessThanOrEqual(320);
    for (const [sw, cw] of m.tabelas) expect(sw).toBeLessThanOrEqual(cw);
  });

  // Task 12: gráfico em leque. Lê a option real do ECharts (não o canvas):
  // nomes das séries, estilo da histórica, markLine do marco, eixo e dataZoom.
  test("gráfico: 2 faixas, mediana, linha histórica tracejada e marco", async ({ page }) => {
    await autenticar(page);
    await abrirProjecao(page);
    await expect(page.locator("#chart-projecao canvas")).toBeVisible();
    const opt = await page.evaluate(() => {
      const el = document.getElementById("chart-projecao")!;
      // @ts-ignore
      const o = echarts.getInstanceByDom(el).getOption();
      return {
        nomes: o.series.map((s: any) => s.name),
        tracejado: o.series.find((s: any) => s.name.includes("últimos"))?.lineStyle?.type,
        marco: JSON.stringify(o.series.map((s: any) => s.markLine || null)),
        markPoints: o.series.filter((s: any) => s.markPoint && (s.markPoint.data || []).length).map((s: any) => s.name),
        gradiente: JSON.stringify(o.series.map((s: any) => s.areaStyle || null)).includes("colorStops"),
        eixo: o.xAxis[0].data.slice(0, 2),
        yMin: o.yAxis[0].min,
        zoom: (o.dataZoom || []).length,
      };
    });
    expect(opt.nomes).toEqual(expect.arrayContaining(["Mediana", "p10 a p90", "p25 a p75"]));
    expect(opt.tracejado).toBeTruthy();
    expect(opt.marco).toContain("fim da formação");
    // 7a.S.3: markPoint só no último ponto da série principal.
    expect(opt.markPoints).toEqual(["Mediana"]);
    // Faixas com preenchimento PLANO (exceção registrada ao anti-pattern #17).
    expect(opt.gradiente).toBe(false);
    expect(opt.eixo[0]).toBe("hoje");
    expect(opt.yMin).toBe(0);
    expect(opt.zoom).toBe(0);
  });

  // CRB Suggestion 3 (2026-09-25): quando `marco.ano` não casa com nenhum
  // ponto do horizonte (marco já passado — formação encerrada antes de
  // `ano_atual` — ou além do último ponto), `iMarco` fica -1 e o gráfico
  // simplesmente não desenha a markLine. Comportamento correto (não há onde
  // marcar); o teste prova que o gráfico segue de pé, sem erro, e sem linha
  // nenhuma nas 5 séries.
  test("marco fora do horizonte (já encerrado): gráfico renderiza sem markLine e sem erro", async ({ page }) => {
    const erros: string[] = [];
    page.on("pageerror", (e) => erros.push(String(e)));
    await autenticar(page);
    await page.evaluate(() => {
      const $data = (window as any).Alpine?.$data?.(document.body);
      if (!$data) throw new Error("Alpine.$data ausente");
      // ano_atual da fixture é 2026; um marco de 2020 já passou.
      $data.json.projecao.marco = { ano: 2020, idade: 34, rotulo: "fim da formação" };
    });
    await abrirProjecao(page);
    await expect(page.locator("#chart-projecao canvas")).toBeVisible();
    const marks = await page.evaluate(() => {
      const el = document.getElementById("chart-projecao")!;
      // @ts-ignore
      const o = echarts.getInstanceByDom(el).getOption();
      return o.series.map((s: any) => s.markLine ?? null);
    });
    expect(marks.every((m: any) => m === null)).toBe(true);
    expect(erros).toEqual([]);
  });

  test("Plantão: tela e gráfico renderizam sem erro", async ({ page }) => {
    const erros: string[] = [];
    page.on("pageerror", (e) => erros.push(String(e)));
    // Chave e valor reais do Modo Plantão (modo-plantao.spec.ts): tema=dark.
    await page.addInitScript(() => localStorage.setItem("tema", "dark"));
    await autenticar(page);
    expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");
    await abrirProjecao(page);
    await expect(page.locator("#chart-projecao canvas")).toBeVisible();
    // Boot frio em Plantão: os tokens do ECharts têm de ser os DARK (antes
    // desta fase nasciam claros, e a grade saía quase branca sobre o OLED).
    const t = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const dc = (window as any).drarthurChart.tokens;
      return { g700: [dc.g700, cs.getPropertyValue("--g-700").trim()],
               grade: [dc.neutral200, cs.getPropertyValue("--neutral-200").trim()] };
    });
    expect(t.g700[0]).toBe(t.g700[1]);
    expect(t.grade[0]).toBe(t.grade[1]);
    expect(erros).toEqual([]);
  });

  // Fix round Task 12: a 320 px a legenda quebrava em 2 linhas e "Mediana"
  // caía em cima do nome do eixo X. Mede o layout RENDERIZADO: os retângulos
  // (em coordenadas do canvas) dos textos que o zrender realmente desenhou.
  for (const w of [320, 390]) {
    for (const tema of ["light", "dark"]) {
      test(`${w} px ${tema}: legenda, rótulos do eixo X e nome do eixo não se sobrepõem`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: 844 });
        await page.addInitScript((t) => localStorage.setItem("tema", t), tema);
        await autenticar(page);
        await abrirProjecao(page);
        await expect(page.locator("#chart-projecao canvas")).toBeVisible();
        const r = await page.evaluate(() => {
          const el = document.getElementById("chart-projecao")!;
          // @ts-ignore
          const chart = echarts.getInstanceByDom(el);
          const o = chart.getOption();
          const legenda: string[] = o.legend[0].data.map((d: any) => (typeof d === "string" ? d : d.name));
          const ticks: string[] = o.xAxis[0].data;
          const nomeEixo: string = o.xAxis[0].name;
          const caixas: { txt: string; x: number; y: number; w: number; h: number }[] = [];
          chart.getZr().storage.getDisplayList().forEach((d: any) => {
            const txt = d.style && d.style.text;
            if (typeof txt !== "string" || !txt || d.invisible || d.ignore) return;
            const b = d.getBoundingRect().clone();
            b.applyTransform(d.getComputedTransform());
            caixas.push({ txt, x: b.x, y: b.y, w: b.width, h: b.height });
          });
          return { legenda, ticks, nomeEixo, caixas };
        });
        const pega = (pred: (t: string) => boolean) => r.caixas.filter((c) => pred(c.txt));
        const leg = pega((t) => r.legenda.includes(t));
        const nome = pega((t) => t === r.nomeEixo);
        const ticks = pega((t) => r.ticks.includes(t));
        // Contra vacuidade: tudo que se compara foi de fato desenhado.
        expect(leg.length).toBe(r.legenda.length);
        expect(nome.length).toBe(1);
        expect(ticks.length).toBeGreaterThanOrEqual(3);
        const FOLGA = 4; // px de ar visível entre os blocos
        const sobrepoe = (a: any, b: any) =>
          a.x < b.x + b.w + FOLGA && b.x < a.x + a.w + FOLGA &&
          a.y < b.y + b.h + FOLGA && b.y < a.y + a.h + FOLGA;
        for (const l of leg) {
          expect(sobrepoe(l, nome[0]), `legenda "${l.txt}" x nome do eixo`).toBe(false);
          for (const t of ticks) expect(sobrepoe(l, t), `legenda "${l.txt}" x tick "${t.txt}"`).toBe(false);
        }
        for (const t of ticks) expect(sobrepoe(t, nome[0]), `tick "${t.txt}" x nome do eixo`).toBe(false);
        // Camadas, não só ausência de interseção: a 320 px o defeito original
        // era "Mediana" na MESMA linha do nome do eixo, 6 px ao lado dele
        // (sem intersectar), lendo como "Mediana idade no ano". Ticks, depois
        // o nome, depois a legenda inteira, cada faixa com folga vertical.
        const fundoTicks = Math.max(...ticks.map((t) => t.y + t.h));
        expect(nome[0].y, "nome do eixo abaixo dos ticks").toBeGreaterThanOrEqual(fundoTicks + FOLGA);
        for (const l of leg) {
          expect(l.y, `legenda "${l.txt}" abaixo do nome do eixo`).toBeGreaterThanOrEqual(nome[0].y + nome[0].h + FOLGA);
        }
        // E nada sai do container (o texto não pode ser cortado embaixo).
        const alt = await page.locator("#chart-projecao").evaluate((e) => e.clientHeight);
        for (const c of [...leg, ...nome]) expect(c.y + c.h).toBeLessThanOrEqual(alt);
      });
    }
  }
});
