import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

// Fase 7a.BQ.2 — Diagnóstico, capítulo 1 "Quanto risco
// a carteira correu" (desde a 7a.BR.2 em #/raiox/diagnostico/risco; o
// #/raiox/diagnostico virou o índice), e o card da home. Fixtures 100% sintéticas: o bloco
// `risco` sai de construir_bloco_risco sobre gerar_fixture.py::_ponte_risco.
// Os valores esperados são lidos do payload decifrado e formatados pelos
// formatadores da casa (diagPct1, diagAbs1, diagNum2, rent2MmmAa), salvo onde
// o teste existe para travar a copy.
const fx = (n: string) => fs.readFileSync(path.join(__dirname, "../fixtures", n), "utf-8");
const PRINCIPAL = fx("portfolio.test.json.enc");
const NULO = fx("portfolio_risco_null.test.json.enc");
const PRE235 = fx("portfolio_pre_v235.test.json.enc");
const CURTO = fx("portfolio_risco_curto.test.json.enc");
const SEM_QUEDA = fx("portfolio_risco_sem_queda.test.json.enc");
const NAO_RECUPEROU = fx("portfolio_risco_nao_recuperou.test.json.enc");
const INDISPONIVEL = fx("portfolio_risco_indisponivel.test.json.enc");
const EUA_RECENTE = fx("portfolio_risco_eua_recente.test.json.enc");

const TELA = ".tela-diagnostico";

test.use({ viewport: { width: 390, height: 844 } });

async function autenticar(page: Page, corpo = PRINCIPAL) {
  await page.route("**/portfolio.json.enc", (r) => r.fulfill({ status: 200, body: corpo, contentType: "text/plain" }));
  await page.addInitScript(() => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem("pinTimestamp", String(Date.now() - 86_400_000));
  });
  await page.goto("/");
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
}

// Gate de DADO (x-if `.diag-ensaio`) + fim do push-enter (lição 7a.AW.2).
async function abrir(page: Page) {
  await page.goto("/#/raiox/diagnostico/risco");
  await expect(page.locator(`${TELA} .diag-ensaio`)).toBeVisible();
  await page
    .waitForFunction(() => {
      const el = document.querySelector(".tela-diagnostico");
      return !!el && getComputedStyle(el).transform === "none";
    }, undefined, { timeout: 2000 })
    .catch(() => {});
}

// O Alpine engole erro de expressão em x-if: sem este coletor, um guard
// quebrado ficaria verde.
function coletarErros(page: Page) {
  const erros: string[] = [];
  page.on("pageerror", (e) => erros.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error" || m.text().includes("Alpine Expression Error")) erros.push(m.type() + ": " + m.text());
  });
  return erros;
}

const norm = (s: string | null) => (s || "").replace(/\s+/g, " ").trim();

// Janela do payload já formatada pelos formatadores da casa.
async function janela(page: Page, escopo: string, chave: string) {
  return page.evaluate(([e, k]) => {
    const w = window as any;
    const j = w.Alpine.$data(document.body).json.risco.escopos[e][k];
    const q = j.queda;
    const mes = (ym: string | null) => (ym ? w.rent2MmmAa(ym) : null);
    return {
      j,
      ano: mes(w.diagMesAnterior(j.de))!.slice(-2),
      ancora: mes(w.diagMesAnterior(j.de)),
      ate: mes(j.ate),
      ret: w.diagPct1(j.retorno_aa),
      exc: j.excesso_aa == null ? null : w.diagAbs1(j.excesso_aa),
      vol: j.volatilidade_aa == null ? null : w.diagAbs1(j.volatilidade_aa) + "%",
      sharpe: j.sharpe == null ? null : w.diagNum2(j.sharpe),
      sharpeAbs: j.sharpe == null ? null : w.diagNum2(Math.abs(j.sharpe)),
      cdi: j.cdi_aa == null ? null : w.diagPct1(j.cdi_aa),
      queda: q && {
        q: w.diagAbs1(q.maxima), pico: mes(q.pico), fundo: mes(q.fundo), rec: mes(q.recuperacao),
        hoje: q.hoje == null ? null : w.diagAbs1(q.hoje), picoHoje: mes(q.pico_de_hoje),
        mq: q.meses_queda, mr: q.meses_recuperacao,
      },
    };
  }, [escopo, chave] as const);
}

const meses = (n: number) => (n === 1 ? "1 mês" : `${n} meses`);

async function escolherEscopo(page: Page, escopo: "Total" | "Brasil" | "EUA", moeda?: "BRL" | "USD") {
  await page.locator(`${TELA} [data-diag-escopo="${escopo}"]`).click();
  if (moeda) await page.locator(`${TELA} [data-diag-moeda="${moeda}"]`).click();
}

test.describe("7a.BQ.2 — card na home", () => {
  test("card logo abaixo da Renda: 'Diagnóstico da carteira' e a pior queda desde o início com a volta ao pico", async ({ page }) => {
    await autenticar(page);
    const w = await janela(page, "Total", "desde");
    const card = page.locator(".diag-card-home");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Diagnóstico da carteira");
    const ano = "20" + w.ano;
    expect(norm(await card.textContent())).toContain(
      `Desde ${ano}, a pior queda foi de ${w.queda!.q}%, e a carteira voltou ao pico ${meses(w.queda!.mr)} depois do fundo`);
    const vizinho = await page.evaluate(() => {
      const p = document.querySelector(".renda-card-home");
      let n = p && p.nextElementSibling;
      while (n && n.tagName === "TEMPLATE") n = n.nextElementSibling;
      return n ? n.className : null;
    });
    expect(vizinho).toContain("diag-card-home");
    await card.click();
    await expect(page).toHaveURL(/#\/raiox\/diagnostico$/);
    await expect(page.locator(".tela-diag-indice .diag-indice")).toBeVisible();
  });

  test("ainda não recuperou: o card diz que a carteira ainda não voltou ao pico", async ({ page }) => {
    await autenticar(page, NAO_RECUPEROU);
    const card = page.locator(".diag-card-home");
    await expect(card).toBeVisible();
    await expect(card).toContainText("e a carteira ainda não voltou ao pico");
    await expect(card).not.toContainText("depois do fundo");
  });

  // Decisão do Dr. Arthur (06/11/2026): sem a janela Desde do Total o card
  // FICA, sem número, com o motivo; é o único caminho até a tela.
  test("sem a janela Desde do Total: o card fica, com o motivo no lugar do número, e abre a tela", async ({ page }) => {
    await autenticar(page, INDISPONIVEL);
    const motivo = await page.evaluate(() => {
      const w = window as any;
      return w.diagMotivoTexto(w.Alpine.$data(document.body).json.risco.escopos.Total.desde.indisponivel);
    });
    expect(motivo).toMatch(/^Falta a cotação de um ativo em [a-z]{3}\/\d{2}\.$/);
    const card = page.locator(".diag-card-home");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Diagnóstico da carteira");
    await expect(card.locator(".diag-card-home__texto")).toHaveText(motivo);
    await expect(card).not.toContainText("pior queda");
    await card.click();
    await expect(page).toHaveURL(/#\/raiox\/diagnostico$/);
    await expect(page.locator(".tela-diag-indice .diag-indice")).toBeVisible();
  });

  for (const [nome, corpo] of [["risco null", NULO], ["pré-v2.35", PRE235]] as const) {
    test(`payload ${nome}: card ausente e a rota diz 'Diagnóstico indisponível hoje.', sem botão nem erro`, async ({ page }) => {
      const erros = coletarErros(page);
      await autenticar(page, corpo);
      await expect(page.locator(".diag-card-home")).toBeHidden();
      await page.goto("/#/raiox/diagnostico/risco");
      await expect(page.locator(TELA)).toContainText("Diagnóstico indisponível hoje.");
      await expect(page.locator(`${TELA} .diag-ensaio`)).toHaveCount(0);
      // Só o "voltar" do breadcrumb: nada de "Recarregar".
      await expect(page.locator(`${TELA} button`)).toHaveCount(1);
      expect(erros).toEqual([]);
    });
  }
});

test.describe("7a.BQ.2 — a tela", () => {
  test("capítulo 1, título, voltar ao índice e janela padrão Desde", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page);
    await abrir(page);
    await expect(page.locator(`${TELA} .breadcrumb h1`)).toHaveText("Diagnóstico");
    await expect(page.locator(`${TELA} .diag-ordinal`)).toHaveText("1");
    await expect(page.locator(`${TELA} .diag-titulo`)).toHaveText("Quanto risco a carteira correu");
    await expect(page.locator(`${TELA} [data-testid="diag-janela-desde"]`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(`${TELA} [data-testid="diag-janela-3a"]`)).toHaveAttribute("aria-pressed", "false");
    await page.locator(`${TELA} .breadcrumb button`).click();
    await expect(page).toHaveURL(/#\/raiox\/diagnostico$/);
    await expect(page.locator(".tela-diag-indice .diag-indice")).toBeVisible();
    expect(erros).toEqual([]);
  });

  test("frase-resposta acima do CDI (Total) e a linha 'até mmm/aa · N meses'", async ({ page }) => {
    await autenticar(page);
    await abrir(page);
    const w = await janela(page, "Total", "desde");
    expect(w.j.excesso_aa).toBeGreaterThan(0);
    const pts = Number(w.exc!.replace(",", ".")) < 2 ? "ponto" : "pontos";
    await expect(page.locator(`${TELA} [data-testid="diag-frase"]`)).toHaveText(
      `Desde ${w.ancora} a carteira rendeu ${w.ret} ao ano, ${w.exc} ${pts} acima do CDI, oscilando ${w.vol} ao ano.`);
    await expect(page.locator(`${TELA} [data-testid="diag-ate"]`)).toHaveText(`até ${w.ate} · ${w.j.n_meses} meses`);
  });

  test("três números: oscilação, pior queda com ▼ em vermelho e Sharpe com a frase", async ({ page }) => {
    await autenticar(page);
    await abrir(page);
    const w = await janela(page, "Total", "desde");
    await expect(page.locator(`${TELA} [data-testid="diag-osc"]`)).toHaveText(`${w.vol} ao ano`);
    const queda = page.locator(`${TELA} [data-testid="diag-queda"]`);
    await expect(queda).toHaveText(`▼ −${w.queda!.q}%`);
    const cores = await page.evaluate(() => {
      const cor = (v: string) => { const s = document.createElement("span"); s.style.color = `var(${v})`; document.body.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c; };
      return { red: cor("--red"), queda: getComputedStyle(document.querySelector('[data-testid="diag-queda"]')!).color };
    });
    expect(cores.queda).toBe(cores.red);
    await expect(page.locator(`${TELA} [data-testid="diag-sharpe"]`)).toHaveText(w.sharpe!);
    const pts = Math.abs(w.j.sharpe) < 2 ? "ponto" : "pontos";
    await expect(page.locator(`${TELA} [data-testid="diag-sharpe-linha"]`)).toHaveText(
      `Cada ponto de oscilação rendeu ${w.sharpeAbs} ${pts} acima do CDI.`);
  });

  test("Brasil abaixo do CDI: frase com 'abaixo do CDI' e Sharpe negativo com o módulo na linha", async ({ page }) => {
    await autenticar(page);
    await abrir(page);
    await escolherEscopo(page, "Brasil");
    const w = await janela(page, "Brasil", "desde");
    expect(w.j.sharpe).toBeLessThan(0);
    await expect(page.locator(`${TELA} [data-testid="diag-frase"]`)).toContainText(`a parte brasileira rendeu ${w.ret} ao ano, ${w.exc}`);
    await expect(page.locator(`${TELA} [data-testid="diag-frase"]`)).toContainText("abaixo do CDI");
    await expect(page.locator(`${TELA} [data-testid="diag-sharpe"]`)).toHaveText(w.sharpe!);
    expect(w.sharpe!.startsWith("−")).toBe(true);
    await expect(page.locator(`${TELA} [data-testid="diag-sharpe-linha"]`)).toContainText(
      `Cada ponto de oscilação rendeu ${w.sharpeAbs} ponto`);
    await expect(page.locator(`${TELA} [data-testid="diag-sharpe-linha"]`)).toContainText("abaixo do CDI.");
  });

  test("EUA em dólar: frase em dólar, Sharpe '—' e a frase do motivo", async ({ page }) => {
    await autenticar(page);
    await abrir(page);
    await expect(page.locator(`${TELA} [data-diag-moeda]`).first()).toBeHidden();
    await escolherEscopo(page, "EUA", "USD");
    const w = await janela(page, "EUA_USD", "desde");
    await expect(page.locator(`${TELA} [data-testid="diag-frase"]`)).toHaveText(
      `Desde ${w.ancora} a parte americana rendeu ${w.ret} ao ano em dólar, oscilando ${w.vol} ao ano.`);
    await expect(page.locator(`${TELA} [data-testid="diag-sharpe"]`)).toHaveText("—");
    await expect(page.locator(`${TELA} [data-testid="diag-sharpe-linha"]`)).toHaveText(
      "Em dólar não há comparação: o CDI é uma taxa em reais, e não temos uma taxa americana com fonte.");
    // A janela "Desde" do EUA começa depois da do Total.
    const total = await janela(page, "Total", "desde");
    expect(w.ancora).not.toBe(total.ancora);
    await expect(page.locator(`${TELA} [data-testid="diag-janela-desde"]`)).toHaveText(`Desde ${w.ancora}`);
  });

  test("gráfico 'Quanto abaixo do pico': SVG role=img com o pior ponto no aria-label e o rótulo do fundo", async ({ page }) => {
    await autenticar(page);
    await abrir(page);
    const w = await janela(page, "Total", "desde");
    await expect(page.locator(`${TELA} .diag-subtitulo`)).toHaveText("Quanto abaixo do pico");
    const svg = page.locator(`${TELA} .diag-grafico svg[role="img"]`);
    await expect(svg).toBeVisible();
    await expect(svg).toHaveAttribute("aria-label",
      `Distância até o pico, mês a mês, de ${w.ancora} a ${w.ate}. Pior ponto: menos ${w.queda!.q}% em ${w.queda!.fundo}.`);
    await expect(page.locator(`${TELA} [data-testid="diag-fundo-rotulo"]`)).toHaveText(`−${w.queda!.q}% em ${w.queda!.fundo}`);
    const n = await page.evaluate(() => {
      const d = document.querySelector(".diag-grafico__linha")!.getAttribute("d") || "";
      return (d.match(/[ML]/g) || []).length;
    });
    expect(n).toBe(w.j.curva.length + 1); // âncora + um ponto por mês
  });

  test("frase da queda com recuperação e a frase de hoje", async ({ page }) => {
    await autenticar(page);
    await abrir(page);
    const w = await janela(page, "Total", "desde");
    const q = w.queda!;
    await expect(page.locator(`${TELA} [data-testid="diag-frase-queda"]`)).toHaveText(
      `A pior queda começou no pico de ${q.pico} e chegou ao fundo em ${q.fundo}, ${meses(q.mq)} depois. ` +
      `A carteira voltou ao pico em ${q.rec}, ${meses(q.mr)} depois do fundo.`);
    await expect(page.locator(`${TELA} [data-testid="diag-frase-hoje"]`)).toHaveText(
      `Hoje ela está ${q.hoje}% abaixo do pico de ${q.picoHoje}.`);
  });

  test("ainda não recuperou: a frase diz quanto está abaixo hoje e há quantos meses", async ({ page }) => {
    await autenticar(page, NAO_RECUPEROU);
    await abrir(page);
    const w = await janela(page, "Total", "desde");
    const q = w.queda!;
    const k = await page.evaluate(([f, a]) => (window as any).diagMesesEntre(f, a), [w.j.queda.fundo, w.j.ate] as const);
    await expect(page.locator(`${TELA} [data-testid="diag-frase-queda"]`)).toHaveText(
      `A pior queda começou no pico de ${q.pico} e chegou ao fundo em ${q.fundo}, ${meses(q.mq)} depois. ` +
      `A carteira ainda não voltou ao pico de ${q.pico}: hoje está ${q.hoje}% abaixo dele, ${meses(k)} depois.`);
    await expect(page.locator(`${TELA} [data-testid="diag-frase-hoje"]`)).toHaveCount(0);
  });

  test("frase de hoje some no pico: sem queda, o gráfico some e a frase diz isso", async ({ page }) => {
    await autenticar(page, SEM_QUEDA);
    await abrir(page);
    await expect(page.locator(`${TELA} .diag-grafico`)).toHaveCount(0);
    await expect(page.locator(`${TELA} [data-testid="diag-sem-queda"]`)).toHaveText(
      "Na janela, a carteira não ficou abaixo do pico em nenhum fechamento de mês.");
    await expect(page.locator(`${TELA} [data-testid="diag-frase-hoje"]`)).toHaveCount(0);
    await expect(page.locator(`${TELA} [data-testid="diag-frase-queda"]`)).toHaveCount(0);
    await expect(page.locator(`${TELA} [data-testid="diag-queda"]`)).toHaveText("0,0%");
  });

  test("nota de honestidade sempre visível, 'Ver a conta' fechado com a tabela e o aviso de rentabilidade passada", async ({ page }) => {
    await autenticar(page);
    await abrir(page);
    const w = await janela(page, "Total", "desde");
    await expect(page.locator(`${TELA} .diag-nota`)).toHaveText(
      "Medido no fechamento de cada mês. Uma queda que começa e termina dentro do mesmo mês não aparece, então a pior queda real pode ter sido maior.");
    const det = page.locator(`${TELA} details.diag-conta`);
    await expect(det).not.toHaveAttribute("open", "");
    await expect(det.locator("table")).toBeHidden();
    await det.locator("summary").click();
    const tab = det.locator("table");
    await expect(tab).toBeVisible();
    await expect(tab.locator("thead")).toContainText("Sua carteira");
    await expect(tab.locator("thead")).toContainText("Só com índices");
    const linhas = (await tab.locator("tbody tr th").allTextContents()).map(norm);
    expect(linhas).toEqual(["Retorno ao ano", "Oscilação ao ano", "Pior queda", "Sharpe", "Sortino"]);
    const ind = await page.evaluate(() => {
      const w = window as any;
      const i = w.Alpine.$data(document.body).json.risco.escopos.Total.desde.indices;
      return w.diagPct1(i.retorno_aa);
    });
    await expect(tab.locator("tbody tr").first()).toContainText(w.ret);
    await expect(tab.locator("tbody tr").first()).toContainText(ind);
    await expect(det).toContainText(`CDI no período: ${w.cdi} ao ano. ${w.j.n_meses} meses, de ${w.ancora} a ${w.ate}.`);
    await expect(det).toContainText("desvio-padrão");
    await expect(page.locator(`${TELA} .diag-aviso`)).toHaveText("Rentabilidade passada não garante rentabilidade futura.");
  });

  test("trocar a janela: 3 anos fica pressionada e a linha diz 36 meses", async ({ page }) => {
    await autenticar(page);
    await abrir(page);
    await page.locator(`${TELA} [data-testid="diag-janela-3a"]`).click();
    await expect(page.locator(`${TELA} [data-testid="diag-janela-3a"]`)).toHaveAttribute("aria-pressed", "true");
    const w = await janela(page, "Total", "3a");
    await expect(page.locator(`${TELA} [data-testid="diag-ate"]`)).toHaveText(`até ${w.ate} · 36 meses`);
    await expect(page.locator(`${TELA} [data-testid="diag-frase"]`)).toContainText(`Desde ${w.ancora} a carteira rendeu ${w.ret} ao ano`);
  });
});

test.describe("7a.BQ.2 — estados (spec §6.3)", () => {
  test("janela indisponível: a tela abre na anterior válida (Desde → 5 anos → 3 anos) e diz o motivo", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page, INDISPONIVEL);
    await abrir(page);
    const motivo = await page.evaluate(() => {
      const w = window as any;
      return w.diagMotivoTexto(w.Alpine.$data(document.body).json.risco.escopos.Total.desde.indisponivel);
    });
    expect(motivo).toMatch(/^Falta a cotação de um ativo em [a-z]{3}\/\d{2}\.$/);
    await expect(page.locator(`${TELA} [data-testid="diag-janela-3a"]`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(`${TELA} [data-testid="diag-janela-desde"]`)).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator(`${TELA} [data-testid="diag-janela-5a"]`)).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator(`${TELA} [data-testid="diag-motivo"]`)).toHaveText(motivo);
    const w = await janela(page, "Total", "3a");
    await expect(page.locator(`${TELA} [data-testid="diag-ate"]`)).toHaveText(`até ${w.ate} · 36 meses`);
    // Tocar numa indisponível não muda a janela: só diz o motivo dela.
    await page.locator(`${TELA} [data-testid="diag-janela-5a"]`).click({ force: true });
    await expect(page.locator(`${TELA} [data-testid="diag-janela-3a"]`)).toHaveAttribute("aria-pressed", "true");
    expect(erros).toEqual([]);
  });

  test("histórico curto: frase e pior queda ficam, oscilação e Sharpe dizem por que não; janela maior que o histórico é aria-disabled com o motivo", async ({ page }) => {
    await autenticar(page, CURTO);
    await abrir(page);
    const w = await janela(page, "Total", "desde");
    expect(w.j.historico_curto).toBe(true);
    await expect(page.locator(`${TELA} [data-testid="diag-frase"]`)).toHaveText(
      `Desde ${w.ancora} a carteira rendeu ${w.ret} ao ano, ${w.exc} ${Number(w.exc!.replace(",", ".")) < 2 ? "ponto" : "pontos"} abaixo do CDI.`);
    await expect(page.locator(`${TELA} [data-testid="diag-osc"]`)).toHaveText("Histórico curto para medir a oscilação");
    await expect(page.locator(`${TELA} [data-testid="diag-sharpe"]`)).toHaveText("Histórico curto para medir a oscilação");
    await expect(page.locator(`${TELA} [data-testid="diag-queda"]`)).toHaveText(`▼ −${w.queda!.q}%`);
    const tres = page.locator(`${TELA} [data-testid="diag-janela-3a"]`);
    await expect(tres).toHaveAttribute("aria-disabled", "true");
    await tres.click({ force: true });
    await expect(page.locator(`${TELA} [data-testid="diag-janela-desde"]`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(`${TELA} [data-testid="diag-motivo"]`)).toHaveText(/^Histórico começa em [a-z]{3}\/\d{2}\.$/);
  });

  // Board 7a.BQ.2: o motivo exibido tem de ser o da janela TOCADA. Na fixture
  // Desde e 5a caem pelo mesmo buraco; o 5a ganha aqui outro motivo.
  test("tocar numa indisponível mostra o motivo DELA, não o da janela pedida", async ({ page }) => {
    await autenticar(page, INDISPONIVEL);
    await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      const r = JSON.parse(JSON.stringify(d.json.risco));
      r.escopos.Total["5a"].indisponivel = "histórico começa em 03/21";
      d.json = { ...d.json, risco: r };
    });
    await abrir(page);
    await expect(page.locator(`${TELA} [data-testid="diag-motivo"]`)).toHaveText(/^Falta a cotação de um ativo em /);
    await page.locator(`${TELA} [data-testid="diag-janela-5a"]`).click({ force: true });
    await expect(page.locator(`${TELA} [data-testid="diag-motivo"]`)).toHaveText("Histórico começa em mar/21.");
    await expect(page.locator(`${TELA} [data-testid="diag-janela-3a"]`)).toHaveAttribute("aria-pressed", "true");
  });

  // Board 7a.BQ.2: o getter `risco` promete que bloco parcial cai em null
  // ("indisponível hoje", card ausente), nunca em "undefined" ou NaN na tela.
  const TRUNCADOS: [string, string][] = [
    ["sem o escopo EUA_USD", "delete r.escopos.EUA_USD;"],
    ["queda sem meses_recuperacao", "delete r.escopos.Total.desde.queda.meses_recuperacao;"],
    ["curva vazia com queda", "r.escopos.Total.desde.curva = [];"],
    ["pico_de_hoje de outro tipo", "r.escopos.Total.desde.queda.pico_de_hoje = 5;"],
    ["motivo de indisponível vazio", "r.escopos.Total.desde.indisponivel = \"\";"],
  ];
  for (const [nome, mutacao] of TRUNCADOS) {
    test(`bloco parcial (${nome}): indisponível, card ausente, nenhum erro`, async ({ page }) => {
      const erros = coletarErros(page);
      await autenticar(page);
      await expect(page.locator(".diag-card-home")).toBeVisible();
      await page.evaluate((m) => {
        const d = (window as any).Alpine.$data(document.body);
        const r = JSON.parse(JSON.stringify(d.json.risco));
        new Function("r", m)(r);
        d.json = { ...d.json, risco: r };
      }, mutacao);
      await expect(page.locator(".diag-card-home")).toBeHidden();
      await page.goto("/#/raiox/diagnostico/risco");
      await expect(page.locator(TELA)).toContainText("Diagnóstico indisponível hoje.");
      await expect(page.locator(`${TELA} .diag-ensaio`)).toHaveCount(0);
      expect(erros).toEqual([]);
    });
  }

  test("EUA sem nenhuma janela válida: o motivo traduzido no lugar da frase, sem números nem gráfico", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page, EUA_RECENTE);
    await abrir(page);
    await escolherEscopo(page, "EUA");
    await expect(page.locator(`${TELA} [data-testid="diag-sem-janela"]`)).toHaveText("Histórico curto: menos de 12 meses.");
    await expect(page.locator(`${TELA} [data-testid="diag-frase"]`)).toHaveCount(0);
    await expect(page.locator(`${TELA} .diag-pares`)).toHaveCount(0);
    await expect(page.locator(`${TELA} .diag-grafico`)).toHaveCount(0);
    // Volta ao Total: tudo de novo.
    await escolherEscopo(page, "Total");
    await expect(page.locator(`${TELA} [data-testid="diag-frase"]`)).toBeVisible();
    expect(erros).toEqual([]);
  });
});

test.describe("7a.BQ.2 — regras de forma (spec §6.4)", () => {
  const CASOS: [string, string, "Total" | "Brasil" | "EUA", ("BRL" | "USD")?][] = [
    ["normal Total", PRINCIPAL, "Total"], ["normal Brasil", PRINCIPAL, "Brasil"],
    ["normal EUA USD", PRINCIPAL, "EUA", "USD"], ["não recuperou", NAO_RECUPEROU, "Total"],
    ["curto", CURTO, "Total"],
  ];
  for (const [nome, corpo, escopo, moeda] of CASOS) {
    test(`face sem travessão nem termos técnicos proibidos (${nome}); mono só na frase-resposta`, async ({ page }) => {
      const erros = coletarErros(page);
      await autenticar(page, corpo);
      await abrir(page);
      if (escopo !== "Total") await escolherEscopo(page, escopo, moeda);
      const r = await page.evaluate(() => {
        const raiz = document.querySelector(".tela-diagnostico")!;
        const textos: string[] = [];
        const mono: string[] = [];
        const walker = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
        let n: Node | null;
        while ((n = walker.nextNode())) {
          const el = n.parentElement!;
          const t = (n.textContent || "").trim();
          if (!t || el.closest("details") || el.closest(".sr-only")) continue;
          if (!(el as HTMLElement).offsetParent && getComputedStyle(el).position !== "fixed") continue;
          // O "—" de valor ausente é permitido só no dd do Sharpe.
          if (!(t === "—" && el.closest('[data-testid="diag-sharpe"]'))) textos.push(t);
          if (/mono/i.test(getComputedStyle(el).fontFamily)) mono.push(el.closest('[data-testid="diag-frase"]') ? "ok" : t);
        }
        return { face: textos.join(" "), mono };
      });
      expect(r.face).not.toMatch(/[—–]/);
      expect(r.face).not.toMatch(/TWR|XIRR|drawdown|desvio-padrão/i);
      expect(r.mono.filter((m) => m !== "ok")).toEqual([]);
      expect(erros).toEqual([]);
    });
  }

  for (const largura of [320, 390] as const) {
    for (const fonte of ["sistema", "larga"] as const) {
      for (const [nome, corpo, escopo, moeda] of [
        ["normal Total", PRINCIPAL, "Total"], ["normal EUA USD", PRINCIPAL, "EUA", "USD"], ["curto", CURTO, "Total"],
      ] as [string, string, "Total" | "EUA", ("BRL" | "USD")?][]) {
        test(`a ${largura} px (${nome}, fonte ${fonte}): nada passa da coluna e folga ≥ 8 px entre rótulo e valor`, async ({ page }) => {
          await page.setViewportSize({ width: largura, height: 800 });
          await autenticar(page, corpo);
          await abrir(page);
          if (escopo !== "Total") await escolherEscopo(page, escopo, moeda);
          if (fonte === "larga") {
            await page.addStyleTag({ content:
              '.tela-diagnostico, .tela-diagnostico * { font-family: "DejaVu Sans", Verdana, sans-serif !important; }' +
              '.tela-diagnostico .diag-mono { font-family: "DejaVu Sans Mono", "Courier New", monospace !important; }' });
            await page.evaluate(() => document.fonts.ready);
          }
          await page.locator(`${TELA} details.diag-conta summary`).click();
          const r = await page.evaluate(() => {
            const texto = (el: Element) => { const rg = document.createRange(); rg.selectNodeContents(el); return rg.getBoundingClientRect(); };
            const nrm = (s: string | null) => (s || "").replace(/\s+/g, " ").trim();
            const folgas: { linha: string; folga: number }[] = [];
            for (const par of Array.from(document.querySelectorAll(".diag-ensaio .diag-par"))) {
              const dt = par.querySelector("dt"), dd = par.querySelector("dd");
              if (!dt || !dd) continue;
              const a = texto(dt), b = texto(dd);
              const mesma = a.top < b.bottom && b.top < a.bottom;
              folgas.push({ linha: nrm(par.textContent), folga: mesma ? b.left - a.right : 999 });
            }
            const col = document.querySelector(".diag-ensaio")!.getBoundingClientRect();
            const fora = Array.from(document.querySelectorAll(".diag-ensaio *"))
              .filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && (b.right > col.right + 0.5 || b.left < col.left - 0.5); })
              .filter((el) => !el.closest(".sr-only"))
              .map((el) => (el as HTMLElement).className + " " + nrm(el.textContent).slice(0, 30));
            // Texto que vaza da borda do PRÓPRIO botão não passa da coluna e
            // escapa do filtro acima (verificação visual, 320 px, "Desde mmm/aa").
            for (const b of Array.from(document.querySelectorAll(".diag-janela, .diag-escopos button, .diag-moedas button"))) {
              if ((b as HTMLElement).offsetParent && b.scrollWidth > b.clientWidth + 0.5) fora.push("texto vaza do botão: " + nrm(b.textContent));
            }
            return { folgas, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, fora };
          });
          expect(r.sw).toBeLessThanOrEqual(r.cw);
          expect(r.fora).toEqual([]);
          expect(r.folgas.length).toBe(3);
          for (const f of r.folgas) expect(f.folga, f.linha).toBeGreaterThanOrEqual(8);
        });
      }
    }
  }

  test("Modo Plantão: linha, área, fundo e queda leem os tokens escuros", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("tema", "dark"));
    await autenticar(page);
    await abrir(page);
    const r = await page.evaluate(() => {
      const cor = (v: string) => { const s = document.createElement("span"); s.style.color = `var(${v})`; document.body.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c; };
      const q = (s: string) => document.querySelector(s)!;
      return {
        tema: document.documentElement.getAttribute("data-theme"),
        ink: cor("--ink"), n200: cor("--neutral-200"), red: cor("--red"),
        linha: getComputedStyle(q(".diag-grafico__linha")).stroke,
        area: getComputedStyle(q(".diag-grafico__area")).fill,
        fundo: getComputedStyle(q(".diag-grafico__fundo")).borderTopColor,
        queda: getComputedStyle(q('[data-testid="diag-queda"]')).color,
      };
    });
    expect(r.tema).toBe("dark");
    expect(r.linha).toBe(r.ink);
    expect(r.area).toBe(r.n200);
    expect(r.fundo).toBe(r.red);
    expect(r.queda).toBe(r.red);
  });
});
