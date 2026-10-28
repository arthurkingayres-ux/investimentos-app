import { test, expect, Page } from "@playwright/test";
import { esperarResume } from "./esperar-resume";
import path from "path";
import fs from "fs";

// Fase 7a.BG.1 — cripto fora da carteira. Este arquivo guarda as AUSÊNCIAS
// (e o degrau de versão): o que a carteira não mostra mais. Fixtures 100%
// sintéticas (repo público), regeneradas por tests/fixtures/gerar_fixture.py.

const FIXTURES = path.join(__dirname, "../fixtures");
const TELA = ".tela-rentabilidade";
const tid = (id: string) => `${TELA} [data-testid="${id}"]`;

async function autenticar(page: Page, fixture = "portfolio.test.json.enc") {
  const corpo = fs.readFileSync(path.join(FIXTURES, fixture), "utf-8");
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
}

async function abrirRentabilidade(page: Page) {
  await page.goto("/#rentabilidade");
  await esperarResume(page);
}

test.describe("7a.BG.1 — cripto fora da carteira", () => {
  test("ponte: Total, Brasil e EUA sem linha Cripto; Detalhes sem Bitcoin", async ({ page }) => {
    await autenticar(page);
    await abrirRentabilidade(page);
    await expect(page.locator(tid("rent2-frase"))).toBeVisible({ timeout: 10_000 });
    // a linha existe nos três escopos (o teste não pode passar num escopo vazio)
    for (const nome of ["Total", "Brasil", "EUA"]) {
      await page.locator(`${TELA} button[data-escopo="${nome}"]`).click();
      await expect(page.locator(tid("ponte-linha")).first()).toBeVisible();
      await expect(page.locator(`${tid("ponte-linha")}[data-linha="cripto"]`)).toHaveCount(0);
      await expect(page.locator(tid("ponte")).getByText(/cripto/i)).toHaveCount(0);
    }
    // Detalhes aberto, em Total: nenhum índice BTC, nenhum "Bitcoin" na tela.
    await page.locator(`${TELA} button[data-escopo="Total"]`).click();
    await page.locator(tid("rent2-detalhes")).locator("summary").click();
    await expect(page.locator(tid("rent2-indice")).first()).toBeVisible();
    await expect(page.locator(`${tid("rent2-indice")}[data-indice="BTC"]`)).toHaveCount(0);
    await expect(page.locator(tid("rent2-detalhes")).getByText("Bitcoin")).toHaveCount(0);
    await expect(page.locator(TELA).getByText("Bitcoin")).toHaveCount(0);
  });

  test("payload 2.30 (pre_v231): estado 'versão' com o botão de recarregar, nunca o de 'erro'", async ({ page }) => {
    await autenticar(page, "portfolio_pre_v231.test.json.enc");
    await abrirRentabilidade(page);
    const aviso = page.locator(tid("rent2-sem-bloco"));
    await expect(aviso).toBeVisible({ timeout: 10_000 });
    await expect(aviso).toContainText("Rentabilidade indisponível nesta versão dos dados");
    await expect(aviso).not.toContainText("Não foi possível montar a rentabilidade agora.");
    await expect(aviso.getByRole("button", { name: "Recarregar" })).toBeVisible();
    // nada da ponte antiga (com Cripto/Bitcoin) chega à tela
    await expect(page.locator(tid("ponte-linha"))).toHaveCount(0);
    const estado = await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      return { versao: d.json.versao, semBloco: d.rent2.semBloco };
    });
    expect(estado).toEqual({ versao: "2.30", semBloco: "versao" });
  });

  // ── Hero, alocação e aportar (Task 8b) ──────────────────────────────
  // Valores da fixture sintética (gerar_fixture.py, PAYLOAD.patrimonio):
  // total 258.000 = carteira 237.360 + cripto 20.640; carteira_br 149.640;
  // eua 87.720. br_brl (170.280) segue com a cripto e NÃO é o R$ do split.

  async function abrirSplit(page: Page) {
    await page.locator(".hero").click();
    await expect(page.locator("#hero-eyebrow")).toHaveText("Divisão Brasil · EUA");
    await expect(page.locator(".hero-body .hero-face.on .hero-split")).toBeVisible();
  }

  const RODAPE = '[data-testid="cripto-rodape"]';
  const pctNum = (t: string) => parseFloat(t.replace("%", "").replace(",", ".").trim());

  test("hero split: Brasil + EUA = 100% da carteira, R$ Brasil sem a cripto, rodapé com a cripto", async ({ page }) => {
    await autenticar(page);
    await abrirSplit(page);
    const face = page.locator(".hero-body .hero-face.on");
    const cols = face.locator(".hero-split .col");
    await expect(cols.nth(0).locator(".num")).toHaveText("R$ 149.640,00");
    await expect(cols.nth(1).locator(".num")).toHaveText("R$ 87.720,00");
    const br = pctNum(await cols.nth(0).locator(".pct").innerText());
    const eua = pctNum(await cols.nth(1).locator(".pct").innerText());
    expect(br).toBe(63.0);   // 149.640 / 237.360
    expect(eua).toBe(37.0);  // 87.720 / 237.360
    expect(br + eua).toBeCloseTo(100, 5);
    const rodape = face.locator(RODAPE);
    await expect(rodape).toHaveCount(1);
    await expect(rodape).toHaveText(/^\+\s?R\$\s20\.640,00 em cripto, fora da divisão$/);
  });

  test("alocação: soma dos 'atual' fecha 100%, nenhuma categoria Cripto, rodapé com a cripto", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#alocacao");
    await expect(page.locator(".tela-alocacao .aloca-cat").first()).toBeVisible();
    const nomes = await page.locator(".tela-alocacao .aloca-cat__nome").allInnerTexts();
    expect(nomes.length).toBeGreaterThan(0);
    expect(nomes.map((n) => n.trim())).not.toContain("Cripto");
    // 7a.BK.1: o percentual atual de cada categoria é a etiqueta do trilho.
    const atuais = await page
      .locator('.tela-alocacao [data-testid="aloca-trilho"] .aloca-trilho__etq')
      .allInnerTexts();
    expect(atuais.length).toBe(nomes.length);
    const soma = atuais.map(pctNum).reduce((a, b) => a + b, 0);
    // A fixture soma 100,2% (resíduo de arredondamento dos pesos sintéticos);
    // com a cripto dentro do denominador a soma das demais cairia ~8 pp
    // abaixo de 100.
    expect(Math.abs(soma - 100)).toBeLessThan(0.5);
    const rodape = page.locator(`.tela-alocacao ${RODAPE}`);
    await expect(rodape).toBeVisible();
    await expect(rodape).toHaveText(/^\+\s?R\$\s20\.640,00 em cripto, fora da divisão$/);
  });

  test("cripto_brl = 0: sem rodapé no hero e na alocação", async ({ page }) => {
    await autenticar(page, "portfolio_cripto_zero.test.json.enc");
    await abrirSplit(page);
    await expect(page.locator(`.hero-body ${RODAPE}`)).toHaveCount(0);
    // o split continua sobre a carteira (= total, sem cripto)
    const cols = page.locator(".hero-body .hero-face.on .hero-split .col");
    await expect(cols.nth(0).locator(".pct")).toHaveText("63,0%");
    await page.goto("/#alocacao");
    await expect(page.locator(".tela-alocacao .aloca-cat").first()).toBeVisible();
    await expect(page.locator(`.tela-alocacao ${RODAPE}`)).toHaveCount(0);
  });

  test("payload 2.30 (pre_v231): split cai em total_brl/br_brl, sem rodapé, sem NaN", async ({ page }) => {
    await autenticar(page, "portfolio_pre_v231.test.json.enc");
    await abrirSplit(page);
    const face = page.locator(".hero-body .hero-face.on");
    const cols = face.locator(".hero-split .col");
    await expect(cols.nth(0).locator(".num")).toHaveText("R$ 170.280,00"); // br_brl 2.30 INCLUI a cripto
    await expect(cols.nth(0).locator(".pct")).toHaveText("66,0%"); // 170.280 / 258.000
    await expect(cols.nth(1).locator(".pct")).toHaveText("34,0%"); // 87.720 / 258.000
    await expect(face).not.toContainText("NaN");
    await expect(face.locator(RODAPE)).toHaveCount(0);
    await page.goto("/#alocacao");
    await expect(page.locator(".tela-alocacao .aloca-cat").first()).toBeVisible();
    await expect(page.locator(`.tela-alocacao ${RODAPE}`)).toHaveCount(0);
    await expect(page.locator(".tela-alocacao")).not.toContainText("NaN");
  });

  test("aportar: valor atual da categoria = peso_atual × carteira_brl; 'Só Brasil' não compra Cripto", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => !!(window as any).aporteCalculo);
    const r = await page.evaluate(() => {
      const ativo = (ticker: string, peso_alvo: number, peso_atual: number) => ({
        ticker, tipo: "passive", peso_intra: 1.0, peso_intra_atual: 1.0,
        drift_intra: -0.1, peso_alvo, peso_atual, drift: peso_atual - peso_alvo,
        bandeira: "🇧🇷",
      });
      const cat = (nome: string, peso_alvo: number, peso_atual: number, ticker: string) => ({
        nome, peso_alvo, peso_atual, drift: peso_atual - peso_alvo,
        buckets: [{ tipo: "passive", peso_bucket: 1.0, peso_atual_bucket: 1.0,
                    drift_bucket: 0, ativos: [ativo(ticker, peso_alvo, peso_atual)] }],
      });
      const portfolio = {
        // carteira 200.000 + cripto 50.000 = patrimônio 250.000
        patrimonio: { total_brl: 250000, cripto_brl: 50000, carteira_brl: 200000 },
        posicoes: [
          { ticker: "AAA1", quantidade: 100, valor_mercado_brl: 10000 },
          { ticker: "CRP1", quantidade: 100, valor_mercado_brl: 10000 },
        ],
        politica: {
          categorias: [
            cat("Ações BR", 1.0, 0.5, "AAA1"),
            // payload antigo ainda com uma categoria Cripto
            cat("Cripto", 0.0, 0.0, "CRP1"),
          ],
        },
      };
      const calc = (window as any).aporteCalculo.calcularAporte;
      const tudo = calc(10000, portfolio);
      const card = tudo.categorias.find((c: any) => c.nome === "Ações BR");
      const brasil = calc(10000, portfolio, { mercado: "brasil" });
      const compradosBrasil = brasil.categorias.flatMap((c: any) => c.compras.map((l: any) => l.ticker));
      const naoRecBrasil = brasil.categoriasNaoRecebedoras;
      return {
        posPct: card.posPct,
        valorCat: card.compras.reduce((s: number, l: any) => s + l.valor, 0),
        compradosBrasil,
        criptoBrasil: naoRecBrasil.find((c: any) => c.nome === "Cripto"),
      };
    });
    // valor_pos = 0,5 × 200.000 + compra; pos = 200.000 + 10.000.
    expect(r.posPct).toBeCloseTo(((0.5 * 200000 + r.valorCat) / 210000) * 100, 6);
    expect(r.compradosBrasil).not.toContain("CRP1");
    expect(r.criptoBrasil && r.criptoBrasil.label).toBe("fora deste aporte");
  });
});
