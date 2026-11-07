import { test, expect, Page } from "@playwright/test";
import { fx, autenticar, abrirTela, coletarErros, norm, faceTexto, PROIBIDOS, medirLer, CONTA_ABRE, COMO_LER } from "./diag-comum";

// Fase 7a.BT.2 — capítulo 5 "Como a carteira está montada"
// (#/raiox/diagnostico/construcao, spec 7a.BT §6.3 a §6.5). O bloco
// `construcao` (schema 2.38) chega pronto do backend; o teste lê o payload
// decifrado e monta o esperado com formatadores próprios (pct abaixo) e os da
// casa (ponteRoundPy, arredondarFechando, rent2MmmAa, diagMesAnterior), nunca
// com os helpers `cons*` da tela. Literal só onde trava copy. Fixtures 100%
// sintéticas (gerar_fixture.py, Task 5 da 7a.BT.2).
const PRINCIPAL = fx("portfolio.test.json.enc");
const NULO = fx("portfolio_construcao_null.test.json.enc");
const RISCO_NULO = fx("portfolio_construcao_risco_null.test.json.enc");
const CURTO = fx("portfolio_construcao_curto.test.json.enc");
const SEM_FORA = fx("portfolio_construcao_sem_fora.test.json.enc");
const SEM_CRIPTO = fx("portfolio_construcao_sem_cripto.test.json.enc");
const PRE238 = fx("portfolio_pre_v238.test.json.enc");

const TELA = ".tela-diag-construcao";
const JANELAS = ["3a", "5a", "desde"] as const;
const CATS = ["acoes_br", "fiis", "eua", "renda_fixa"];
const NOME: Record<string, string> = { acoes_br: "Ações BR", fiis: "FIIs", eua: "EUA", renda_fixa: "Renda Fixa BR" };
const TOKEN: Record<string, string> = { acoes_br: "--cat-acoes-br", fiis: "--cat-fii", eua: "--cat-eua", renda_fixa: "--cat-renda-fixa-br" };
// Só em "Ver a conta" (spec §6.5).
// "TER" sem /i: com ele, casaria o verbo "ter" da copy aprovada.
const PROIBIDOS_CONS = /Herfindahl|covariância|variância|correlação|contribuição marginal/i;
const PROIBIDO_TER = /\bTER\b/;

test.use({ viewport: { width: 390, height: 844 } });

// Fração → "62,0%" a `casas`, meio-para-par como o Python (via ponteRoundPy).
async function pctFn(page: Page) {
  return (x: number, casas = 1) => page.evaluate(([v, c]) => {
    const r = (window as any).ponteRoundPy(v * 100, c);
    return (r < 0 ? "−" : "") + Math.abs(r).toFixed(c).replace(".", ",") + "%";
  }, [x, casas] as const);
}

async function abrir(page: Page) {
  await abrirTela(page, "#/raiox/diagnostico/construcao", TELA, ".diag-ensaio");
}

async function bloco(page: Page) {
  return page.evaluate(() => (window as any).Alpine.$data(document.body).json.construcao);
}

async function escolher(page: Page, k: string) {
  await page.locator(`${TELA} [data-testid="cons-janela-${k}"]`).click();
  await expect(page.locator(`${TELA} [data-testid="cons-janela-${k}"]`)).toHaveAttribute("aria-pressed", "true");
}

// Fecho exibido de uma coluna, pela regra da casa (somar 100,0).
async function fecho(page: Page, fracs: number[]) {
  return page.evaluate((v) => (window as any).arredondarFechando(v.map((x) => x * 100), 100, 1), fracs);
}

const v1 = (x: number) => Math.abs(x).toFixed(1).replace(".", ",") + "%";

// A régua como a tela a mostra.
async function regua(page: Page) {
  return page.evaluate((sel) => {
    const nrm = (s: string | null) => (s || "").replace(/\s+/g, " ").trim();
    return Array.from(document.querySelectorAll(`${sel} [data-testid="cons-regua-linha"]`)).map((el) => ({
      id: el.getAttribute("data-id"),
      nome: nrm(el.querySelector(".cons-nome")!.textContent),
      role: el.getAttribute("role"), label: el.getAttribute("aria-label"),
      pesou: nrm(el.querySelector('[data-testid="cons-pesou"]')?.textContent || ""),
      somou: el.querySelector('[data-testid="cons-somou"]') ? nrm(el.querySelector('[data-testid="cons-somou"]')!.textContent) : null,
      barraPesou: (el.querySelector(".cons-barra--pesou") as HTMLElement | null)?.style.width || null,
      barraSomou: (el.querySelector(".cons-barra--somou") as HTMLElement | null)?.style.width ?? null,
    }));
  }, TELA);
}

// "pesou 39,6%" → 39.6; "somou 70,0%" → 70; "reduziu 15,0%" → −15.
function lerValor(s: string) {
  const m = /^(pesou|somou|reduziu) (\d+,\d)%$/.exec(s);
  if (!m) throw new Error("fora do formato: " + s);
  const v = Number(m[2].replace(",", "."));
  return m[1] === "reduziu" ? -v : v;
}

test.describe("7a.BT.2 — capítulo 5: abertura e concentração", () => {
  test("ordinal 5, título e a linha da pergunta; o ← volta ao índice", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    await expect(page.locator(`${TELA} .breadcrumb h1`)).toHaveText("Diagnóstico");
    await expect(page.locator(`${TELA} .diag-ordinal`)).toHaveText("5");
    await expect(page.locator(`${TELA} .diag-titulo`)).toHaveText("Como a carteira está montada");
    await expect(page.locator(`${TELA} [data-testid="cons-pergunta"]`)).toHaveText(
      "Quanto ela depende dos maiores ativos, de onde vem a oscilação e quanto custam os fundos.");
    await page.locator(`${TELA} .breadcrumb button`).click();
    await expect(page).toHaveURL(/#\/raiox\/diagnostico$/);
    expect(erros).toEqual([]);
  });

  test("frase da concentração com P, Q e N do payload em strong; 'em dd/mm/aa · n ativos'", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    const c = await bloco(page);
    const pct = await pctFn(page);
    const N = await page.evaluate((n) => (window as any).ponteRoundPy(n, 0), c.concentracao.n_efetivo);
    await expect(page.locator(`${TELA} h3#cons-maiores-titulo`)).toHaveText("Os maiores ativos");
    const frase = page.locator(`${TELA} [data-testid="cons-conc-frase"]`);
    await expect(frase).toHaveText(`Hoje, os 5 maiores ativos são ${await pct(c.concentracao.top5)} da carteira, e os 10 maiores, `
      + `${await pct(c.concentracao.top10)}. Ela se comporta como uma carteira de ${N} ativos de mesmo peso.`);
    await expect(frase.locator("strong")).toHaveText([await pct(c.concentracao.top5), await pct(c.concentracao.top10), String(N)]);
    await expect(frase).toHaveText("Hoje, os 5 maiores ativos são 62,0% da carteira, e os 10 maiores, 89,7%. Ela se comporta como uma carteira de 10 ativos de mesmo peso.");
    const d = c.data as string;
    await expect(page.locator(`${TELA} [data-testid="cons-conc-ate"]`)).toHaveText(
      `em ${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)} · ${c.concentracao.n_ativos} ativos`);
  });

  test("a lista dos 10 maiores, aberta: ponto da classe, ticker e peso, na ordem do bloco", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    const c = await bloco(page);
    const pct = await pctFn(page);
    const itens = page.locator(`${TELA} ol[data-testid="cons-maiores"] > li`);
    await expect(itens).toHaveCount(10);
    for (let i = 0; i < 10; i++) {
      const m = c.concentracao.maiores[i];
      await expect(itens.nth(i).locator(".cons-ticker")).toHaveText(m.ticker);
      await expect(itens.nth(i).locator(".cons-peso")).toHaveText(await pct(m.peso));
      await expect(itens.nth(i)).toBeVisible();
      const r = await itens.nth(i).evaluate((el, tok) => {
        const s = document.createElement("span"); s.style.background = `var(${tok})`; document.body.appendChild(s);
        const esp = getComputedStyle(s).backgroundColor; s.remove();
        return { ponto: getComputedStyle(el.querySelector(".cons-ponto")!).backgroundColor, esp };
      }, TOKEN[m.classe]);
      expect(r.ponto).toBe(r.esp);
    }
  });
});

test.describe("7a.BT.2 — capítulo 5: a oscilação", () => {
  test("janelas 3 anos · 5 anos · Desde, abrindo em Desde; frase com a classe de maior parte e 'até mmm/aa · N meses'", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    await expect(page.locator(`${TELA} h3#cons-osc-titulo`)).toHaveText("De onde vem a oscilação");
    await expect(page.locator(`${TELA} .diag-janelas button`)).toHaveText(["3 anos", "5 anos", "Desde o início"]);
    await expect(page.locator(`${TELA} [data-testid="cons-janela-desde"]`)).toHaveAttribute("aria-pressed", "true");
    const c = await bloco(page);
    for (const k of ["desde", "3a", "5a"] as const) {
      await escolher(page, k);
      const j = c.risco.janelas[k];
      const top = CATS.reduce((a, b) => (j.classes[b].parte > j.classes[a].parte ? b : a));
      const pes = await fecho(page, CATS.map((x) => j.classes[x].peso_medio));
      const par = await fecho(page, CATS.map((x) => j.classes[x].parte));
      const i = CATS.indexOf(top);
      const ancora = await page.evaluate((de) => (window as any).rent2MmmAa((window as any).diagMesAnterior(de)), j.de);
      const ate = await page.evaluate((a) => (window as any).rent2MmmAa(a), j.ate);
      const frase = page.locator(`${TELA} [data-testid="cons-osc-frase"]`);
      await expect(frase).toHaveText(`Desde ${ancora}, ${NOME[top]} pesou ${v1(pes[i])} da carteira e somou ${v1(par[i])} da oscilação.`);
      await expect(frase.locator("strong")).toHaveText([v1(pes[i]), v1(par[i])]);
      await expect(page.locator(`${TELA} [data-testid="cons-osc-ate"]`)).toHaveText(`até ${ate} · ${j.n_meses} meses`);
    }
    await escolher(page, "desde");
    await expect(page.locator(`${TELA} [data-testid="cons-osc-frase"]`)).toHaveText(
      "Desde out/20, Ações BR pesou 39,6% da carteira e somou 70,0% da oscilação.");
  });

  test("a régua: 4 linhas na ordem, role=img com aria-label, fecho exibido 100,0 nas duas colunas, Renda Fixa 'reduziu'", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    const c = await bloco(page);
    for (const k of JANELAS) {
      await escolher(page, k);
      const j = c.risco.janelas[k];
      const pes = await fecho(page, CATS.map((x) => j.classes[x].peso_medio));
      const par = await fecho(page, CATS.map((x) => j.classes[x].parte));
      const r = await regua(page);
      expect(r.map((l) => l.id)).toEqual(CATS);
      expect(r.map((l) => l.nome)).toEqual(CATS.map((x) => NOME[x]));
      let sp = 0, ss = 0;
      for (let i = 0; i < 4; i++) {
        const l = r[i];
        expect(l.role).toBe("img");
        const ps = lerValor(l.pesou), so = lerValor(l.somou!);
        expect(ps).toBeCloseTo(pes[i], 6);
        expect(so).toBeCloseTo(par[i], 6);
        sp += ps; ss += so;
        const verbo = so < 0 ? `reduziu ${v1(so)}` : `somou ${v1(so)}`;
        expect(l.label).toBe(`${NOME[CATS[i]]}: pesou ${v1(ps)}, ${verbo} da oscilação`);
        expect(l.barraPesou).toBe(`${pes[i]}%`);
        expect(l.barraSomou).toBe(so < 0 ? "0%" : `${Math.min(so, 100)}%`);
      }
      expect(Math.round(sp * 10) / 10).toBe(100);
      expect(Math.round(ss * 10) / 10).toBe(100);
      expect(r[3].somou).toMatch(/^reduziu /);
    }
  });

  test("a régua mostra o fecho por arredondarFechando: o arredondamento simples não fecharia em Desde", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    const j = (await bloco(page)).risco.janelas.desde;
    const ingenuo = (xs: number[]) => Math.round(xs.reduce((a, x) => a + Math.round(x * 1000) / 10, 0) * 10) / 10;
    expect(ingenuo(CATS.map((x) => j.classes[x].peso_medio))).not.toBe(100);
    expect(ingenuo(CATS.map((x) => j.classes[x].parte))).not.toBe(100);
  });

  test("a tabela sr-only repete a régua, linha a linha", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    const r = await regua(page);
    const linhas = await page.locator(`${TELA} .sr-only table[data-testid="cons-tabela"] tbody tr`).evaluateAll((trs) =>
      trs.map((tr) => Array.from(tr.children).map((c) => (c.textContent || "").replace(/\s+/g, " ").trim())));
    expect(linhas).toEqual(r.map((l) => [l.nome, l.pesou.replace("pesou ", ""), l.somou!.replace(/^somou /, "").replace(/^reduziu /, "−")]));
    await expect(page.locator(`${TELA} .sr-only table[data-testid="cons-tabela"] caption`)).toHaveText(
      "Quanto cada classe pesou na carteira e somou à oscilação, em %");
    await expect(page.locator(`${TELA} .sr-only table[data-testid="cons-tabela"] thead th`)).toHaveText(["Classe", "Pesou", "Somou à oscilação"]);
  });

  test("os 5 ativos que mais mexeram: h4, ponto, ticker, 'pesou W%' e 'somou R%' ou 'reduziu R%'", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    const c = await bloco(page);
    await expect(page.locator(`${TELA} h4#cons-ativos-titulo`)).toHaveText("Os ativos que mais mexeram na oscilação");
    for (const k of JANELAS) {
      await escolher(page, k);
      const at = c.risco.janelas[k].ativos;
      const itens = page.locator(`${TELA} ol[data-testid="cons-ativos"] > li`);
      await expect(itens).toHaveCount(5);
      for (let i = 0; i < 5; i++) {
        const a = at[i];
        const pr = await page.evaluate((x) => (window as any).ponteRoundPy(x * 100, 1), a.parte);
        await expect(itens.nth(i).locator(".cons-ticker")).toHaveText(a.ticker);
        await expect(itens.nth(i).locator(".cons-ativo-pesou")).toHaveText(`pesou ${v1(await page.evaluate((x) => (window as any).ponteRoundPy(x * 100, 1), a.peso_medio))}`);
        await expect(itens.nth(i).locator(".cons-ativo-somou")).toHaveText(`${pr < 0 ? "reduziu" : "somou"} ${v1(pr)}`);
      }
      await expect(itens.filter({ hasText: "reduziu" })).toHaveCount(1);
    }
  });

  test("histórico curto: 3a e 5a aria-disabled; Desde só com o trilho 'pesou'; 'somou' e a lista dão lugar à frase", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page, CURTO);
    await abrir(page);
    await expect(page.locator(`${TELA} [data-testid="cons-janela-desde"]`)).toHaveAttribute("aria-pressed", "true");
    for (const k of ["3a", "5a"]) {
      await expect(page.locator(`${TELA} [data-testid="cons-janela-${k}"]`)).toHaveAttribute("aria-disabled", "true");
    }
    const r = await regua(page);
    expect(r.length).toBe(4);
    for (const l of r) {
      expect(l.pesou).toMatch(/^pesou \d+,\d%$/);
      expect(l.somou).toBeNull();
      expect(l.barraSomou).toBeNull();
      expect(l.label).toMatch(/^.+: pesou \d+,\d%$/);
    }
    await expect(page.locator(`${TELA} [data-testid="cons-curto"]`)).toHaveText("Histórico curto para medir a oscilação.");
    await expect(page.locator(`${TELA} ol[data-testid="cons-ativos"]`)).toHaveCount(0);
    await expect(page.locator(`${TELA} [data-testid="cons-osc-frase"]`)).toHaveCount(0);
    // Tocar 3 anos diz o motivo e não muda a janela.
    await page.locator(`${TELA} [data-testid="cons-janela-3a"]`).click({ force: true });
    await expect(page.locator(`${TELA} [data-testid="cons-janela-desde"]`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(`${TELA} [data-testid="cons-motivo"]`)).toHaveText("Histórico começa em mai/24.");
    expect(erros).toEqual([]);
  });

  test("janela indisponível volta Desde → 5 anos → 3 anos e diz o motivo", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      const c = JSON.parse(JSON.stringify(d.json.construcao));
      c.risco.janelas.desde = { n_meses: 71, de: null, ate: null, indisponivel: "cotação ausente em 03/21",
        historico_curto: false, classes: {}, ativos: [], correlacoes: {} };
      d.json = { ...d.json, construcao: c };
    });
    await abrir(page);
    await expect(page.locator(`${TELA} [data-testid="cons-janela-desde"]`)).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator(`${TELA} [data-testid="cons-janela-5a"]`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(`${TELA} [data-testid="cons-motivo"]`)).toHaveText("Falta a cotação de um ativo em mar/21.");
  });

  // Board BT.2: a volta inteira, Desde e 5 anos indisponíveis ⇒ 3 anos.
  test("Desde e 5 anos indisponíveis: abre em 3 anos e diz o motivo de Desde", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      const c = JSON.parse(JSON.stringify(d.json.construcao));
      const vazio = (m: string) => ({ n_meses: 60, de: null, ate: null, indisponivel: m, historico_curto: false, classes: {}, ativos: [], correlacoes: {} });
      c.risco.janelas.desde = vazio("cotação ausente em 03/21");
      c.risco.janelas["5a"] = vazio("histórico começa em 05/24");
      d.json = { ...d.json, construcao: c };
    });
    await abrir(page);
    await expect(page.locator(`${TELA} [data-testid="cons-janela-3a"]`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(`${TELA} [data-testid="cons-motivo"]`)).toHaveText("Falta a cotação de um ativo em mar/21.");
  });

  // Board BT.2: o motivo próprio do bloco (Var(R) ≈ 0) tem tradução.
  test("helper puro: 'oscilação zero na janela' vira 'A carteira não oscilou nesta janela.'", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    const t = await page.evaluate(() => (window as any).diagMotivoTexto("oscilação zero na janela"));
    expect(t).toBe("A carteira não oscilou nesta janela.");
  });

  test("risco nulo: 'A oscilação por classe está indisponível hoje.'; concentração e custo seguem", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page, RISCO_NULO);
    await abrir(page);
    await expect(page.locator(`${TELA} [data-testid="cons-osc-indisponivel"]`)).toHaveText("A oscilação por classe está indisponível hoje.");
    await expect(page.locator(`${TELA} .diag-janelas`)).toHaveCount(0);
    await expect(page.locator(`${TELA} [data-testid="cons-regua-linha"]`)).toHaveCount(0);
    await expect(page.locator(`${TELA} [data-testid="cons-conc-frase"]`)).toBeVisible();
    await expect(page.locator(`${TELA} [data-testid="cons-custo-frase"]`)).toBeVisible();
    expect(erros).toEqual([]);
  });
});

test.describe("7a.BT.2 — capítulo 5: o custo", () => {
  test("frase com T, R$ K e T_p; as duas linhas cinza (ações e FIIs; corretagem)", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    const u = (await bloco(page)).custo;
    const pct = await pctFn(page);
    const K = await page.evaluate((v) => (window as any).rent2Dinheiro(v, "BRL"), u.reais_ano);
    await expect(page.locator(`${TELA} h3#cons-custo-titulo`)).toHaveText("Quanto custam os fundos");
    const frase = page.locator(`${TELA} [data-testid="cons-custo-frase"]`);
    await expect(frase).toHaveText(`A taxa dos fundos custa ${await pct(u.ter_carteira, 2)} da carteira ao ano, cerca de ${K} por ano. `
      + `A política, com os mesmos fundos nos pesos-alvo, custaria ${await pct(u.ter_politica, 2)}.`);
    await expect(frase.locator("strong")).toHaveText([await pct(u.ter_carteira, 2), K, await pct(u.ter_politica, 2)]);
    await expect(frase).toHaveText(/^A taxa dos fundos custa 0,04% da carteira ao ano, cerca de R\$\s53 por ano\. A política, com os mesmos fundos nos pesos-alvo, custaria 0,06%\.$/);
    const fiis = u.fora.find((f: any) => f.grupo === "fiis").peso;
    const outros = u.fora.find((f: any) => f.grupo === "outros").peso;
    await expect(page.locator(`${TELA} [data-testid="cons-custo-fora"]`)).toHaveText(
      `Ações não cobram taxa de administração (${await pct(u.peso_sem_taxa)} da carteira). Os FIIs (${await pct(fiis)} da carteira) cobram, `
      + "dentro do fundo, mas a taxa deles ainda não está registrada: ficam fora da conta. "
      + `Outros ${await pct(outros)} da carteira também ficam fora, sem taxa registrada. `
      + `Na política, ${await pct(u.politica_peso_sem_fonte)} dos pesos-alvo também ficam fora da conta, sem taxa registrada.`);
    await expect(page.locator(`${TELA} [data-testid="cons-custo-banco"]`)).toHaveText(
      "Corretagem, emolumentos e o imposto retido nos proventos ainda não estão no banco; quando estiverem, entram aqui.");
  });

  test("sem_fora: só a frase das ações (e a ressalva da política, que segue com FIIs no alvo)", async ({ page }) => {
    await autenticar(page, SEM_FORA);
    await abrir(page);
    const u = (await bloco(page)).custo;
    const pct = await pctFn(page);
    await expect(page.locator(`${TELA} [data-testid="cons-custo-fora"]`)).toHaveText(
      `Ações não cobram taxa de administração (${await pct(u.peso_sem_taxa)} da carteira). `
      + `Na política, ${await pct(u.politica_peso_sem_fonte)} dos pesos-alvo também ficam fora da conta, sem taxa registrada.`);
  });

  // Board BT.2: a ressalva da política (spec §4.4) some quando nada da política fica fora.
  test("politica_peso_sem_fonte zero: a ressalva da política some", async ({ page }) => {
    await autenticar(page, SEM_FORA);
    await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      const c = JSON.parse(JSON.stringify(d.json.construcao));
      c.custo.politica_peso_sem_fonte = 0;
      d.json = { ...d.json, construcao: c };
    });
    await abrir(page);
    await expect(page.locator(`${TELA} [data-testid="cons-custo-fora"]`)).toContainText("Ações não cobram");
    await expect(page.locator(`${TELA} [data-testid="cons-custo-fora"]`)).not.toContainText("Na política");
  });
});

test.describe("7a.BT.2 — capítulo 5: Como ler e Ver a conta", () => {
  test("'Como ler esta conta' aberta, sem toque, antes de 'Ver a conta', com o texto da §6.3 item 8", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    const ler = await medirLer(page, TELA, "cons");
    expect(ler).toMatchObject({ visivel: true, foraDeDetails: true, rotulada: true, h3: COMO_LER, antesDaConta: true });
    expect(ler!.h4s).toEqual(["O que esta pergunta mede", "Os números", "Como ler o seu resultado", "O que estes números não dizem"]);
    expect(ler!.dts).toEqual(["Os 5 e os 10 maiores", "Carteira de N ativos de mesmo peso", "Pesou × somou à oscilação", "A taxa dos fundos"]);
    const t = norm(await page.locator(`${TELA} [data-testid="cons-ler"]`).textContent());
    for (const trecho of [
      "Uma carteira pode render bem e depender demais de poucos ativos, ou ter uma parte pequena que responde pela maior parte dos solavancos. Aqui ficam três olhares sobre a montagem: o peso dos maiores, de onde vem a oscilação e quanto os fundos cobram.",
      "Quanto da carteira está nos maiores ativos. Quanto maior, mais o resultado depende deles.",
      "Uma forma de contar a diversificação: com 40 ativos (número inventado), se poucos pesam muito, a carteira se comporta como se tivesse bem menos. Um fundo de índice conta como um ativo, mesmo tendo centenas de empresas dentro, então este número subestima a diversificação dos fundos.",
      "O primeiro é o peso médio da classe na janela; o segundo, quanto ela respondeu pelos solavancos da carteira. Uma classe que pesa pouco e soma muito é a que mais balança, ou a que balança junto com o resto. Uma classe que \"reduziu\" a oscilação costuma subir quando as outras caem.",
      "O que os fundos descontam por ano, em porcentagem da carteira inteira. Sai da ficha de cada fundo, e entra só o fundo que tem ficha registrada.",
      "Compare as duas colunas da régua: onde \"somou\" passa muito de \"pesou\", ali está a parte que mais mexe com a carteira. No custo, compare com a política: a diferença vem de ter mais ou menos fundo do que o alvo, e de quais fundos.",
      "A oscilação é a do passado, com os pesos de cada mês: a carteira de hoje pode se comportar diferente. A concentração não sabe que dois ativos podem ser da mesma empresa ou do mesmo setor. E o custo ainda não inclui corretagem, emolumentos e o imposto retido.",
    ]) expect(t).toContain(trecho);
    await expect(page.locator(`${TELA} .diag-aviso`)).toHaveText("Rentabilidade passada não garante rentabilidade futura.");
  });

  test("'Ver a conta' fechado; aberto: Herfindahl, a parte da variância com a soma de 100%, correlação por janela, fundos com fonte, a cripto e os pesos da Alocação", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    const det = page.locator(`${TELA} details.diag-conta`);
    await expect(det).not.toHaveAttribute("open", "");
    await det.locator("summary").click();
    const c = await bloco(page);
    const pct = await pctFn(page);
    const abre = det.locator(".diag-conta__corpo > p").first();
    await expect(abre).toHaveText(CONTA_ABRE);
    const t = norm(await det.textContent());
    expect(t).toContain("inverso do índice de Herfindahl (1/Σw²)");
    expect(t).toContain("contribuição de cada classe à variância (covariância da contribuição mensal com o retorno da carteira, sobre a variância)");
    expect(t).toContain("As partes somam 100%.");
    // Correlação: uma tabela por janela, 6 pares, 2 casas ou "histórico curto".
    for (const k of JANELAS) {
      const tb = det.locator(`table[data-testid="cons-corr"][data-janela="${k}"] tbody tr`);
      await expect(tb).toHaveCount(6);
      const co = c.risco.janelas[k].correlacoes;
      const chaves = Object.keys(co);
      for (let i = 0; i < 6; i++) {
        const [a, b] = chaves[i].split("|");
        const r = co[chaves[i]];
        const rr = r === null ? null : await page.evaluate((x) => (window as any).ponteRoundPy(x, 2), r);
        const esp = rr === null ? "histórico curto" : (rr < 0 ? "−" : "") + Math.abs(rr).toFixed(2).replace(".", ",");
        await expect(tb.nth(i).locator("th")).toHaveText(`${NOME[a]} e ${NOME[b]}`);
        await expect(tb.nth(i).locator("td")).toHaveText(esp);
      }
    }
    const fundos = det.locator('table[data-testid="cons-fundos"] tbody tr');
    await expect(fundos).toHaveCount(c.custo.fundos.length);
    for (let i = 0; i < c.custo.fundos.length; i++) {
      const f = c.custo.fundos[i];
      await expect(fundos.nth(i).locator("th")).toHaveText(f.ticker);
      await expect(fundos.nth(i).locator("td").nth(0)).toHaveText(await pct(f.ter, 2));
      await expect(fundos.nth(i).locator("td").nth(1)).toHaveText(await pct(f.peso));
    }
    await expect(det.locator('[data-testid="cons-fonte"]')).toHaveText(c.custo.fundos.map((f: any) => `${f.ticker}: ${f.fonte_ter}.`));
    await expect(det.locator('[data-testid="cons-cripto"]')).toHaveText(
      `A cripto, ${await pct(c.concentracao.cripto_fora)} da carteira, fica fora, como na Rentabilidade.`);
    expect(t).toContain("Os pesos de hoje são os da Alocação, sem a cripto.");
  });

  test("sem_cripto: a frase da cripto some", async ({ page }) => {
    await autenticar(page, SEM_CRIPTO);
    await abrir(page);
    await page.locator(`${TELA} details.diag-conta summary`).click();
    await expect(page.locator(`${TELA} [data-testid="cons-cripto"]`)).toHaveCount(0);
  });
});

test.describe("7a.BT.2 — capítulo 5: estados (spec §6.4)", () => {
  for (const [nome, corpo] of [["construcao null", NULO], ["pré-v2.38", PRE238]] as const) {
    test(`payload ${nome}: 'Como a carteira está montada: indisponível hoje.', sem erro`, async ({ page }) => {
      const erros = coletarErros(page);
      await autenticar(page, corpo);
      await page.goto("/#/raiox/diagnostico/construcao");
      await expect(page.locator(`${TELA} [data-testid="cons-indisponivel"]`)).toHaveText("Como a carteira está montada: indisponível hoje.");
      await expect(page.locator(`${TELA} .diag-ensaio`)).toHaveCount(0);
      expect(erros).toEqual([]);
    });
  }

  // Board BT.2: a validação da janela de risco derruba o bloco (não só o custo).
  const RISCO_MAL: [string, string][] = [
    ["classes com 3 chaves", "delete j.classes.renda_fixa;"],
    ["parte numérica em histórico curto", "j.historico_curto = true; j.ativos = [];"],
    ["correlação com classe desconhecida", "j.correlacoes['acoes_br|cripto'] = 0.5;"],
    ["ativo com classe desconhecida", "j.ativos[0].classe = 'cripto';"],
    ["correlação com par faltando", "delete j.correlacoes['acoes_br|fiis'];"],
    ["correlação com a classe repetida", "delete j.correlacoes['acoes_br|fiis']; j.correlacoes['fiis|fiis'] = 1;"],
  ];
  for (const [nome, mut] of RISCO_MAL) {
    test(`janela de risco malformada (${nome}): indisponível no capítulo e na linha 5`, async ({ page }) => {
      const erros = coletarErros(page);
      await autenticar(page, PRINCIPAL);
      await page.evaluate((m) => {
        const d = (window as any).Alpine.$data(document.body);
        const c = JSON.parse(JSON.stringify(d.json.construcao));
        const j = c.risco.janelas["5a"];
        new Function("j", m)(j);
        d.json = { ...d.json, construcao: c };
      }, mut);
      await page.goto("/#/raiox/diagnostico/construcao");
      await expect(page.locator(`${TELA} [data-testid="cons-indisponivel"]`)).toBeVisible();
      await page.goto("/#/raiox/diagnostico");
      await expect(page.locator('.tela-diag-indice [data-testid="diag-indice-5"] .diag-indice__estado')).toHaveText("Indisponível hoje.");
      expect(erros).toEqual([]);
    });
  }

  test("bloco parcial (sem custo.fundos): indisponível no capítulo e na linha 5", async ({ page }) => {
    const erros = coletarErros(page);
    await autenticar(page, PRINCIPAL);
    await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      const c = JSON.parse(JSON.stringify(d.json.construcao));
      delete c.custo.fundos;
      d.json = { ...d.json, construcao: c };
    });
    await page.goto("/#/raiox/diagnostico/construcao");
    await expect(page.locator(`${TELA} [data-testid="cons-indisponivel"]`)).toBeVisible();
    await page.goto("/#/raiox/diagnostico");
    await expect(page.locator('.tela-diag-indice [data-testid="diag-indice-5"] .diag-indice__estado')).toHaveText("Indisponível hoje.");
    expect(erros).toEqual([]);
  });
});

test.describe("7a.BT.2 — capítulo 5: regras de forma (spec §6.5)", () => {
  for (const [nome, corpo] of [["normal", PRINCIPAL], ["curto", CURTO], ["risco nulo", RISCO_NULO], ["nulo", NULO]] as const) {
    test(`face sem travessão nem os termos de 'Ver a conta' (${nome})`, async ({ page }) => {
      const erros = coletarErros(page);
      await autenticar(page, corpo);
      await page.goto("/#/raiox/diagnostico/construcao");
      await expect(page.locator(`${TELA} .breadcrumb h1`)).toBeVisible();
      const ks = nome === "normal" ? JANELAS : ([] as const);
      for (const k of ks) {
        await escolher(page, k);
        const face = await faceTexto(page, TELA);
        expect(face).not.toMatch(/[—–]|--/);
        expect(face).not.toMatch(PROIBIDOS);
        expect(face).not.toMatch(PROIBIDOS_CONS);
        expect(face).not.toMatch(PROIBIDO_TER);
      }
      const face = await faceTexto(page, TELA);
      expect(face).not.toMatch(/[—–]|--/);
      expect(face).not.toMatch(PROIBIDOS_CONS);
      expect(face).not.toMatch(PROIBIDO_TER);
      if (nome !== "nulo") {
        const conta = norm(await page.locator(`${TELA} details.diag-conta`).textContent());
        expect(conta).toMatch(/Herfindahl/);
        expect(conta).not.toMatch(/[—–]|--/);
      }
      expect(erros).toEqual([]);
    });
  }

  for (const largura of [320, 390] as const) {
    for (const tema of ["claro", "Plantão"] as const) {
      test(`a ${largura} px (${tema}): nada passa da coluna, régua na coluna, folga ≥ 8 px na lista dos 10, na régua e na dos 5`, async ({ page }) => {
        if (tema === "Plantão") await page.addInitScript(() => localStorage.setItem("tema", "dark"));
        await page.setViewportSize({ width: largura, height: 800 });
        await autenticar(page, PRINCIPAL);
        await abrir(page);
        for (const k of JANELAS) {
          await escolher(page, k);
          await page.locator(`${TELA} details.diag-conta`).evaluate((d) => ((d as HTMLDetailsElement).open = true));
          const r = await page.evaluate((sel) => {
            const raiz = document.querySelector(sel)!;
            const col = raiz.querySelector(".diag-ensaio")!.getBoundingClientRect();
            const nrm = (s: string | null) => (s || "").replace(/\s+/g, " ").trim();
            const caixa = (el: Element) => { const rg = document.createRange(); rg.selectNodeContents(el); return rg.getBoundingClientRect(); };
            const fora = Array.from(raiz.querySelectorAll(".diag-ensaio *"))
              .filter((el) => !el.closest(".sr-only"))
              .filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && (b.right > col.right + 0.5 || b.left < col.left - 0.5); })
              .map((el) => (el as HTMLElement).getAttribute("class") + " " + nrm(el.textContent).slice(0, 30));
            for (const b of Array.from(raiz.querySelectorAll("button"))) {
              if ((b as HTMLElement).offsetParent && b.scrollWidth > b.clientWidth + 0.5) fora.push("texto vaza do botão: " + nrm(b.textContent));
            }
            const folga = (rot: Element, val: Element) => {
              const a = rot.getBoundingClientRect(), b = caixa(val);
              const mesma = a.top < b.bottom && b.top < a.bottom;
              return mesma ? b.left - a.right : 999;
            };
            const folgas: { linha: string; folga: number }[] = [];
            for (const li of Array.from(raiz.querySelectorAll('[data-testid="cons-maiores"] > li, [data-testid="cons-ativos"] > li'))) {
              folgas.push({ linha: nrm(li.textContent), folga: folga(li.querySelector(".cons-ticker")!, li.querySelector(".cons-ticker ~ :last-child")!) });
            }
            for (const t of Array.from(raiz.querySelectorAll(".cons-trilho-linha"))) {
              folgas.push({ linha: nrm(t.textContent), folga: folga(t.querySelector(".cons-trilho")!, t.querySelector(".cons-valor")!) });
            }
            const reg = raiz.querySelector(".cons-regua")!.getBoundingClientRect();
            return { fora, folgas, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, reg: { l: reg.left, r: reg.right }, col: { l: col.left, r: col.right } };
          }, TELA);
          expect(r.sw).toBeLessThanOrEqual(r.cw);
          expect(r.fora).toEqual([]);
          expect(r.reg.l).toBeGreaterThanOrEqual(r.col.l - 0.5);
          expect(r.reg.r).toBeLessThanOrEqual(r.col.r + 0.5);
          expect(r.folgas.length).toBe(10 + 5 + 8);
          for (const f of r.folgas) expect(f.folga, `${largura} ${k} ${f.linha}`).toBeGreaterThanOrEqual(8);
        }
      });
    }
  }

  // Verificação visual da BT.2: a 320 px a coluna tem ~232 px e o par
  // "pesou/somou" não cabe ao lado do ticker; o ticker não pode quebrar letra a
  // letra (a folga ficava ≥ 8 px com o ticker espremido em 17 px).
  test("a 320 px, nenhum ticker quebra: uma linha só por ticker nas duas listas", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    const r = await page.evaluate(() => Array.from(document.querySelectorAll(".tela-diag-construcao .cons-ticker")).map((t) => {
      const rg = document.createRange(); rg.selectNodeContents(t);
      const linhas = new Set(Array.from(rg.getClientRects()).map((x) => Math.round(x.top)));
      return { t: t.textContent, linhas: linhas.size };
    }));
    expect(r.length).toBe(15);
    for (const x of r) expect(x.linhas, x.t!).toBe(1);
  });

  test("janelas herdam a fonte do texto (font: inherit), com alvo tocável ≥ 44 px de altura", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    const r = await page.evaluate(() => {
      const raiz = document.querySelector(".tela-diag-construcao .diag-ensaio")!;
      return Array.from(raiz.querySelectorAll(".diag-janelas button")).map((b) => ({
        f: getComputedStyle(b).fontFamily, corpo: getComputedStyle(raiz).fontFamily, h: b.getBoundingClientRect().height,
      }));
    });
    expect(r.length).toBe(3);
    for (const b of r) { expect(b.f).toBe(b.corpo); expect(b.h).toBeGreaterThanOrEqual(44); }
  });

  for (const tema of ["claro", "Plantão"] as const) {
    test(`${tema}: números em strong 700 --ink sem mono; régua 'pesou' em --neutral-200 com número --gray, 'somou' em --ink 700; nada em --g-700 nem --red`, async ({ page }) => {
      if (tema === "Plantão") await page.addInitScript(() => localStorage.setItem("tema", "dark"));
      await autenticar(page, PRINCIPAL);
      await abrir(page);
      const r = await page.evaluate(() => {
        const sel = ".tela-diag-construcao";
        const cor = (v: string) => { const s = document.createElement("span"); s.style.color = `var(${v})`; document.body.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c; };
        const fundo = (v: string) => { const s = document.createElement("span"); s.style.background = `var(${v})`; document.body.appendChild(s); const c = getComputedStyle(s).backgroundColor; s.remove(); return c; };
        const todos = (s: string) => Array.from(document.querySelectorAll(`${sel} ${s}`)) as HTMLElement[];
        const frases = todos('[data-testid="cons-conc-frase"], [data-testid="cons-osc-frase"], [data-testid="cons-custo-frase"]');
        return {
          tema: document.documentElement.getAttribute("data-theme"),
          ink: cor("--ink"), gray: cor("--gray"), inkBg: fundo("--ink"), n200: fundo("--neutral-200"),
          g700: [cor("--g-700"), fundo("--g-700")], red: [cor("--red"), fundo("--red")],
          fortes: frases.flatMap((f) => Array.from(f.querySelectorAll("strong")).map((s) => ({
            c: getComputedStyle(s).color, w: getComputedStyle(s).fontWeight, f: getComputedStyle(s).fontFamily, ff: getComputedStyle(f).fontFamily,
          }))),
          barrasPesou: todos(".cons-barra--pesou").map((b) => getComputedStyle(b).backgroundColor),
          barrasSomou: todos(".cons-barra--somou").map((b) => getComputedStyle(b).backgroundColor),
          valPesou: todos('[data-testid="cons-pesou"]').map((b) => getComputedStyle(b).color),
          valSomou: todos('[data-testid="cons-somou"]').map((b) => [getComputedStyle(b).color, getComputedStyle(b).fontWeight]),
          // O ponto da classe usa o token da categoria (o de Ações BR tem o
          // mesmo valor de --g-700): fica fora da regra e é conferido abaixo.
          regua: todos(".cons-regua *:not(.cons-ponto)").concat(todos(".cons-regua")).flatMap((e) => [getComputedStyle(e).color, getComputedStyle(e).backgroundColor]),
          pontos: todos(".cons-regua .cons-ponto").map((e) => [e.closest("[data-id]")!.getAttribute("data-id"), getComputedStyle(e).backgroundColor]),
          cats: Object.fromEntries([["acoes_br", "--cat-acoes-br"], ["fiis", "--cat-fii"], ["eua", "--cat-eua"], ["renda_fixa", "--cat-renda-fixa-br"]].map(([k, t]) => [k, fundo(t)])),
          cinzas: todos('[data-testid="cons-custo-fora"], [data-testid="cons-custo-banco"], [data-testid="cons-conc-ate"], [data-testid="cons-osc-ate"]').map((e) => getComputedStyle(e).color),
        };
      });
      expect(r.tema).toBe(tema === "Plantão" ? "dark" : "light");
      expect(r.fortes.length).toBe(3 + 2 + 3);
      for (const s of r.fortes) { expect(s.c).toBe(r.ink); expect(s.w).toBe("700"); expect(s.f).toBe(s.ff); }
      expect(r.barrasPesou.length).toBe(4);
      for (const b of r.barrasPesou) expect(b).toBe(r.n200);
      for (const b of r.barrasSomou) expect(b).toBe(r.inkBg);
      for (const c of r.valPesou) expect(c).toBe(r.gray);
      for (const [c, w] of r.valSomou) { expect(c).toBe(r.ink); expect(w).toBe("700"); }
      for (const c of r.regua) { expect(r.g700).not.toContain(c); expect(r.red).not.toContain(c); }
      expect(r.pontos.length).toBe(4);
      for (const [id, c] of r.pontos) expect(c).toBe((r.cats as any)[id!]);
      for (const c of r.cinzas) expect(c).toBe(r.gray);
      const ler = await medirLer(page, TELA, "cons");
      expect(ler!.cores).toEqual([r.ink]);
    });
  }

  test("sem motion nova: a régua não tem transição nem animação", async ({ page }) => {
    await autenticar(page, PRINCIPAL);
    await abrir(page);
    const r = await page.evaluate(() => Array.from(document.querySelectorAll(".tela-diag-construcao .cons-regua *")).map((el) => {
      const s = getComputedStyle(el);
      return { d: s.transitionDuration, a: s.animationName };
    }));
    expect(r.length).toBeGreaterThan(0);
    for (const x of r) { expect(x.d.split(",").every((v) => parseFloat(v) === 0)).toBe(true); expect(x.a).toBe("none"); }
  });
});
