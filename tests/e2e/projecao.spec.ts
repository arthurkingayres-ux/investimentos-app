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

  // Largura MÍNIMA de conteúdo de cada tabela (o que ela ocupa quando só as
  // quebras permitidas acontecem). scrollWidth sozinho não mede folga: a
  // tabela tem width:100%, então scrollWidth == clientWidth sempre que cabe, e
  // o teste antigo passava com folga desconhecida no Windows e estourava 3 px
  // no Linux do CI. O app usa fontes do SISTEMA (Segoe/Consolas no Windows,
  // DejaVu no Linux, SF no iPhone), então a métrica muda por aparelho e a
  // folga tem de existir de verdade, não só no aparelho onde se mediu.
  async function larguraMinimaTabelas(page: Page) {
    return page.evaluate(() => Array.from(document.querySelectorAll(".proj-premissas")).map((t) => {
      const el = t as HTMLElement;
      const antes = el.style.width;
      el.style.width = "min-content";
      const min = el.getBoundingClientRect().width;
      el.style.width = antes;
      return { classe: el.className, min, disponivel: (el.parentElement as HTMLElement).clientWidth };
    }));
  }

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

  // FOLGA de 12 px (~5% da coluna de 232 px) na fonte do sistema, E caber sem
  // estourar com uma fonte LARGA forçada (Verdana no Windows, DejaVu Sans no
  // Linux, a mesma família de largura). O segundo assert é o que pega a classe
  // do defeito: medido em 25/09/2026, forçar Verdana levava a tabela de
  // classes de 191 para 233 px, a mesma direção e ordem de grandeza do 235
  // que o CI mediu no Linux.
  test("320 px: tabelas de premissas cabem com folga, também em fonte larga", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await autenticar(page);
    await abrirProjecao(page);
    const FOLGA = 12;
    const sistema = await larguraMinimaTabelas(page);
    expect(sistema).toHaveLength(2);
    for (const t of sistema) {
      expect(t.min, `${t.classe} na fonte do sistema`).toBeLessThanOrEqual(t.disponivel - FOLGA);
    }
    await page.addStyleTag({ content:
      '.tela-projecao, .tela-projecao * { font-family: Verdana, "DejaVu Sans", sans-serif !important; }' });
    const larga = await larguraMinimaTabelas(page);
    for (const t of larga) {
      expect(t.min, `${t.classe} em fonte larga`).toBeLessThanOrEqual(t.disponivel - FOLGA);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
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

  // Legenda em HTML, logo abaixo do gráfico (não mais dentro do canvas). A
  // legenda do ECharts dependia da métrica da fonte do sistema para se
  // posicionar: no Linux do CI "Mediana" foi medida em y = -1,5 (no TOPO do
  // canvas), enquanto no Windows ficava no fundo. Em HTML ela é fluxo normal
  // do documento e quebra linha como qualquer texto.
  // Em light E dark: fora do canvas, o tema do ECharts não cuida mais das
  // cores da legenda — quem cuida são os tokens do CSS, e isso tem de valer
  // também no Plantão.
  for (const tema of ["light", "dark"]) {
  test(`${tema}: legenda em HTML abaixo do gráfico, com a mediana e a série histórica`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.addInitScript((t) => localStorage.setItem("tema", t), tema);
    await autenticar(page);
    expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe(tema);
    await abrirProjecao(page);
    await expect(page.locator("#chart-projecao canvas")).toBeVisible();
    const leg = page.locator(".tela-projecao .proj-legenda");
    await expect(leg).toBeVisible();
    const itens = leg.locator("li");
    await expect(itens).toHaveCount(2);
    const nomeHist = await page.evaluate(() => {
      // @ts-ignore
      const o = echarts.getInstanceByDom(document.getElementById("chart-projecao")).getOption();
      return o.series.find((s: any) => s.name.includes("últimos")).name;
    });
    await expect(itens.nth(0)).toHaveText("Mediana");
    await expect(itens.nth(1)).toHaveText(nomeHist);
    // Traço é decorativo: o texto é o que se lê.
    await expect(leg.locator("[aria-hidden='true']")).toHaveCount(2);
    // Sem legenda dentro do canvas.
    const legendaCanvas = await page.evaluate(() => {
      // @ts-ignore
      const o = echarts.getInstanceByDom(document.getElementById("chart-projecao")).getOption();
      return (o.legend || []).length;
    });
    expect(legendaCanvas).toBe(0);
    // Abaixo do container do gráfico, sem invadi-lo.
    const g = await page.locator("#chart-projecao").boundingBox();
    const l = await leg.boundingBox();
    expect(l!.y).toBeGreaterThanOrEqual(g!.y + g!.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    // Cores dos traços = tokens do tema ativo. O token é resolvido para rgb
    // por um elemento-sonda (o valor declarado pode ser hex), e comparado com
    // a cor computada do traço sólido e com a cor dentro do gradiente do
    // tracejado.
    const cores = await page.evaluate(() => {
      const sonda = document.createElement("span");
      document.body.appendChild(sonda);
      const resolve = (tok: string) => {
        sonda.style.color = getComputedStyle(document.documentElement).getPropertyValue(tok).trim();
        return getComputedStyle(sonda).color;
      };
      const r = { g700: resolve("--g-700"), gray: resolve("--gray") };
      sonda.remove();
      const [solido, hist] = Array.from(document.querySelectorAll(".proj-legenda__traco")) as HTMLElement[];
      return { ...r, solido: getComputedStyle(solido).backgroundColor,
               hist: getComputedStyle(hist).backgroundImage };
    });
    expect(cores.solido).toBe(cores.g700);
    expect(cores.hist).toContain(cores.gray);
    // Contra vacuidade: os dois tokens são cores distintas e não-vazias.
    expect(cores.g700).not.toBe(cores.gray);
  });
  }

  for (const tema of ["light", "dark"]) {
  test(`${tema}: legenda sem a série histórica quando o payload não traz historico`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("tema", t), tema);
    await autenticar(page);
    expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe(tema);
    await page.evaluate(() => {
      const $data = (window as any).Alpine?.$data?.(document.body);
      if (!$data) throw new Error("Alpine.$data ausente");
      $data.json.projecao.historico = null;
    });
    await abrirProjecao(page);
    await expect(page.locator("#chart-projecao canvas")).toBeVisible();
    const itens = page.locator(".tela-projecao .proj-legenda li");
    await expect(itens).toHaveCount(1);
    await expect(itens.nth(0)).toHaveText("Mediana");
    const nomes = await page.evaluate(() => {
      // @ts-ignore
      return echarts.getInstanceByDom(document.getElementById("chart-projecao")).getOption().series.map((s: any) => s.name);
    });
    expect(nomes.some((n: string) => n.includes("últimos"))).toBe(false);
  });
  }

  // O nome do eixo X ("idade no ano") abaixo dos rótulos de idade, e dentro
  // do container. Mantido dentro do canvas porque é AUTO-CONSISTENTE: o
  // ECharts mede e desenha os ticks e o nome com a mesma fonte, e a distância
  // entre eles é nameGap (26 px) contra margem + altura de UMA linha de 11 px
  // do rótulo; depende da altura da linha, não da largura da fonte. Foi o
  // único assert daquele bloco que passou no Linux do CI.
  for (const w of [320, 390]) {
    for (const tema of ["light", "dark"]) {
      test(`${w} px ${tema}: nome do eixo X abaixo dos rótulos de idade e dentro do gráfico`, async ({ page }) => {
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
          return { ticks, nomeEixo, caixas };
        });
        const nome = r.caixas.filter((c) => c.txt === r.nomeEixo);
        const ticks = r.caixas.filter((c) => r.ticks.includes(c.txt));
        // Contra vacuidade: tudo que se compara foi de fato desenhado.
        expect(nome.length).toBe(1);
        expect(ticks.length).toBeGreaterThanOrEqual(3);
        const FOLGA = 4;
        const fundoTicks = Math.max(...ticks.map((t) => t.y + t.h));
        expect(nome[0].y, "nome do eixo abaixo dos ticks").toBeGreaterThanOrEqual(fundoTicks + FOLGA);
        const alt = await page.locator("#chart-projecao").evaluate((e) => e.clientHeight);
        expect(nome[0].y + nome[0].h, "nome do eixo dentro do container").toBeLessThanOrEqual(alt);
      });
    }
  }
});
