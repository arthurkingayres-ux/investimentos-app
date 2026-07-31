import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

// 7a.W.3.b — cadastro da frase de acesso. Fixtures 100% SINTÉTICAS.
const FIXTURE = fs.readFileSync(
  path.join(__dirname, "../fixtures/portfolio.test.json.enc"), "utf-8");
const SEGREDO = "123456";           // o segredo do fixture (público, por design)
const PIN_LOCAL = "246810";
const FRASE_SEIS = "alfa beta gama delta epsilon zeta";

// 7a.W.3.b: a tela exige SEIS palavras, então o fluxo completo de cadastro só
// pode ser exercitado contra um payload cifrado com uma FRASE — que é o mundo
// pós-virada, o único em que essa tela tem sentido. Com a fixture cifrada com
// `SEGREDO` (1 token) o submit nunca habilitaria, e o teste mediria o gate em
// vez do fluxo.
const FIXTURE_FRASE = fs.readFileSync(
  path.join(__dirname, "../fixtures/portfolio_frase.test.json.enc"), "utf-8");

async function mock(page: Page, opts: { portfolio?: string } = {}) {
  await page.route("**/portfolio.json.enc", (r) =>
    r.fulfill({ status: 200, body: opts.portfolio ?? FIXTURE, contentType: "text/plain" }));
  for (const p of ["**/relatorios_index.json.enc", "**/dossies_index.json.enc"]) {
    await page.route(p, (r) => r.fulfill({ status: 404, body: "", contentType: "text/plain" }));
  }
}

test.use({ viewport: { width: 390, height: 844 } });

test.describe("7a.W.3.b — enrollment", () => {
  test("aparelho virgem cai no cadastro da frase, nao na tela de PIN", async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await mock(page);
    await page.goto("/");
    await expect(page.locator(".frase-screen")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".pin-screen")).toHaveCount(0);
    await expect(page.locator(".frase-screen .eyebrow"))
      .toHaveText("PRIMEIRO ACESSO NESTE APARELHO");
    await expect(page.locator(".frase-screen h1")).toHaveText("Sua frase de acesso");
  });

  test("aparelho com envelope cai na tela de PIN, nao no cadastro", async ({ page }) => {
    await mock(page);
    await page.addInitScript((s) => {
      localStorage.clear();
      // Basta o `pin`: `init()` decide a fase por "tem pin OU envelope", e
      // com pin presente o aparelho não é virgem. A MIGRAÇÃO não roda aqui
      // (sem `pinTimestamp`, `tentarAutoResume` sai antes dela) — quem
      // exercita a migração é o teste dedicado em envelope.spec.ts.
      localStorage.setItem("pin", s);
    }, SEGREDO);
    await page.goto("/");
    await expect(page.locator(".pin-screen")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".frase-screen")).toHaveCount(0);
  });

  test("campo desliga autocapitalize, autocorrect e spellcheck", async ({ page }) => {
    // O detalhe que mais provavelmente arruinaria o fluxo se esquecido: o
    // corretor do celular destrói palavras diceware em silêncio.
    await page.addInitScript(() => localStorage.clear());
    await mock(page);
    await page.goto("/");
    const campo = page.locator(".frase-input");
    await expect(campo).toBeVisible();
    await expect(campo).toHaveAttribute("autocapitalize", "off");
    await expect(campo).toHaveAttribute("autocorrect", "off");
    await expect(campo).toHaveAttribute("spellcheck", "false");
    // Campo VISÍVEL (não `type=password`): ele precisa conferir as palavras.
    await expect(campo).toHaveAttribute("type", "text");
    // Campo ÚNICO, não seis caixinhas: caixinhas viram OTP, brigam com colar e
    // forçam navegação entre campos no teclado do celular (spec §7.3).
    await expect(page.locator(".frase-input")).toHaveCount(1);
  });

  test("contador conta palavras e o submit so habilita nas 6", async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await mock(page);
    await page.goto("/");
    const campo = page.locator(".frase-input");
    const botao = page.locator(".frase-submit");
    const contador = page.locator(".frase-contador");

    await expect(botao).toBeDisabled();
    await expect(contador).toHaveText("0 de 6 palavras");

    await campo.fill("alfa beta gama");
    await expect(contador).toHaveText("3 de 6 palavras");
    await expect(botao).toBeDisabled();

    await campo.fill(FRASE_SEIS);
    await expect(contador).toHaveText("6 de 6 palavras");
    await expect(botao).toBeEnabled();

    // Espaço duplo e maiúscula não inflam a contagem nem quebram o gate.
    await campo.fill("  ALFA   beta\tgama delta epsilon zeta ");
    await expect(contador).toHaveText("6 de 6 palavras");
    await expect(botao).toBeEnabled();
  });

  test("frase errada da erro generico e nao diz qual palavra errou", async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await mock(page);
    await page.goto("/");
    await page.locator(".frase-input").fill(FRASE_SEIS);   // ≠ segredo do fixture
    await page.locator(".frase-submit").click();
    const erro = page.locator(".frase-erro");
    await expect(erro).toBeVisible({ timeout: 15_000 });
    await expect(erro).toHaveText(
      "Não foi possível abrir a carteira com essa frase. Confira as palavras e a ordem.");
    // Nenhuma palavra da tentativa aparece no erro: a única validação possível
    // é tentar decifrar o payload de verdade, e não dá para saber qual palavra
    // errou — nem deve (spec §7.4).
    for (const t of FRASE_SEIS.split(" ")) {
      await expect(erro).not.toContainText(t);
    }
    await expect(page.locator(".frase-screen")).toBeVisible();
  });

  test("sem rede no cadastro tem estado proprio, distinto de frase errada", async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.route("**/portfolio.json.enc", (r) => r.abort("failed"));
    await page.goto("/");
    await page.locator(".frase-input").fill(FRASE_SEIS);
    await page.locator(".frase-submit").click();
    await expect(page.locator(".frase-erro")).toHaveText(
      "Sem conexão. O primeiro acesso neste aparelho precisa de internet.",
      { timeout: 15_000 });
  });

  test("payload que nao abre mais leva ao cadastro com VOZ PROPRIA, sem acusar o PIN", async ({ page }) => {
    // Cenário real do dia seguinte à virada, num aparelho que ainda tinha
    // sessão: o envelope abre (o PIN local está certo), mas o segredo de
    // dentro não decifra mais o payload republicado.
    await mock(page);
    await page.addInitScript((s) => {
      localStorage.clear();
      localStorage.setItem("pin", s);
      localStorage.setItem("pinTimestamp", String(Date.now()));
    }, "999999");   // envelope será criado com um segredo que não decifra o fixture
    await page.goto("/");
    await expect(page.locator(".frase-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".frase-screen .eyebrow")).toHaveText("A CARTEIRA FOI REPUBLICADA");
    await expect(page.locator(".frase-screen h1")).toHaveText("Uma frase nova");
    // NÃO acusa o PIN: o PIN local está certo, quem mudou foi o segredo.
    await expect(page.locator(".frase-screen")).not.toContainText("PIN incorreto");
    await expect(page.locator(".pin-screen")).toHaveCount(0);
  });

  test("layout: coluna unica no mesmo eixo da tela de PIN, sem card", async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await mock(page);
    await page.goto("/");
    const tela = page.locator(".frase-screen");
    await expect(tela).toBeVisible();
    // Mesmo token de topo da .pin-screen (3rem = 48px): as duas telas de
    // entrada do app pousam no mesmo eixo.
    expect(await tela.evaluate((el) => getComputedStyle(el).paddingTop)).toBe("48px");
    // Sem card, sem container: a spec pede a página, não uma caixa nela.
    expect(await tela.evaluate((el) => getComputedStyle(el).borderWidth)).toBe("0px");
    // Ordem do DOM: eyebrow → título → razão → campo → contador → botão.
    const ordem = await tela.evaluate((el) =>
      Array.from(el.querySelectorAll(".eyebrow, h1, .frase-razao, .frase-input, .frase-contador, .frase-submit"))
        .map((n) => n.className || n.tagName.toLowerCase()));
    expect(ordem.length).toBe(6);
  });

  test("alvos de toque >= 44px e sem overflow horizontal a 320px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.addInitScript(() => localStorage.clear());
    await mock(page);
    await page.goto("/");
    await expect(page.locator(".frase-screen")).toBeVisible();
    for (const sel of [".frase-input", ".frase-submit"]) {
      const box = await page.locator(sel).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("aparelho virgem: apos a frase, escolhe o PIN local e entra", async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await mock(page, { portfolio: FIXTURE_FRASE });
    await page.goto("/");
    await page.locator(".frase-input").fill(FRASE_SEIS);
    await page.locator(".frase-submit").click();

    // Etapa 2: o PIN local. Só existe em aparelho virgem.
    await expect(page.locator(".frase-pin-input")).toBeVisible({ timeout: 15_000 });
    await page.locator(".frase-pin-input").fill(PIN_LOCAL);
    await page.locator(".frase-pin-submit").click();

    // Sucesso cai n'A Abertura existente (7a.S.11), não numa tela de "pronto".
    await expect(page.locator(".raiox")).toBeVisible({ timeout: 15_000 });

    const ls = await page.evaluate(() => ({
      pin: localStorage.getItem("pin"),
      envelope: localStorage.getItem("envelope"),
    }));
    expect(ls.pin).toBe(PIN_LOCAL);
    const aberto = await page.evaluate(async () =>
      await (window as any).decifrar(localStorage.getItem("envelope")!, localStorage.getItem("pin")!));
    expect(aberto).toBe(FRASE_SEIS);
  });

  test("re-enrollment num aparelho que ja tem PIN nao pede PIN de novo", async ({ page }) => {
    // Refinamento sobre o brief (spec §7.4): o passo do PIN local só aparece
    // em aparelho virgem. Quem já tem PIN guardado digita só as palavras.
    await mock(page, { portfolio: FIXTURE_FRASE });
    await page.addInitScript(() => {
      localStorage.clear();
      localStorage.setItem("pin", "999999");
      localStorage.setItem("pinTimestamp", String(Date.now()));
    });
    await page.goto("/");
    await expect(page.locator(".frase-screen")).toBeVisible({ timeout: 15_000 });
    await page.locator(".frase-input").fill(FRASE_SEIS);
    await page.locator(".frase-submit").click();
    await expect(page.locator(".raiox")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".frase-pin-input")).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("pin"))).toBe("999999");
  });
});
