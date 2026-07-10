import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

const F = (n: string) =>
  fs.readFileSync(path.join(__dirname, "../fixtures/" + n), "utf-8");
const PORTFOLIO = F("portfolio.test.json.enc");
const INDICE = F("relatorios_index.test.json.enc");
const MAIO = F("relatorio_2026-05.test.json.enc");
const ABRIL = F("relatorio_2026-04.test.json.enc");
const BADSCHEMA = F("relatorio_badschema.test.json.enc");

test.use({ viewport: { width: 390, height: 844 } });

async function mockTudo(page: Page) {
  await page.route("**/portfolio.json.enc", (r) =>
    r.fulfill({ status: 200, body: PORTFOLIO, contentType: "text/plain" }));
  await page.route("**/relatorios_index.json.enc", (r) =>
    r.fulfill({ status: 200, body: INDICE, contentType: "text/plain" }));
  await page.route("**/relatorio_*.json.enc", (r) => {
    const url = r.request().url();
    const body = url.includes("2026-04") ? ABRIL : MAIO;
    return r.fulfill({ status: 200, body, contentType: "text/plain" });
  });
}

async function autenticar(page: Page) {
  await mockTudo(page);
  await page.addInitScript(() => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem("pinTimestamp", String(Date.now() - 1 * 24 * 60 * 60 * 1000));
  });
  await page.goto("/");
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
}

// A tela de relatório é a única com fetch+decrypt tardio: `.tela-relatorio` é
// x-show (visível de forma síncrona na troca de rota) enquanto as `.rel-secao`
// vivem sob um x-if, que ADICIONA e REMOVE do DOM. Barrar em `.rel-corpo` — o
// <div> interno ao x-if="relMes && !relCarregando && !relErro" — é a única
// barreira que implica `relMes` populado. Usar APENAS nos testes que leem o
// corpo; os estados loading/erro/vazio nunca o renderizam.
async function abrirRelatorio(page: Page) {
  await page.locator(".rel-card-home").click();
  await expect(page.locator(".tela-relatorio")).toBeVisible();
  await expect(page.locator(".tela-relatorio .rel-corpo")).toBeVisible();
}

test.describe("Relatório Mensal — push screen (7a.Q.3)", () => {
  test("card na home abre o relatório do último mês", async ({ page }) => {
    await autenticar(page);
    const card = page.locator(".rel-card-home");
    await expect(card).toBeVisible();
    await card.click();
    await expect(page).toHaveURL(/#\/raiox\/relatorio$/);
    await expect(page.locator(".tela-relatorio")).toBeVisible();
    await expect(page.locator('.tab-bar a[data-tab="raiox"]'))
      .toHaveAttribute("aria-current", "page");
    // último mês = 2026-05 → título visível no header
    await expect(page.locator(".tela-relatorio .breadcrumb")).toContainText("Maio 2026");
  });

  test("renderiza as 9 seções na ordem canônica", async ({ page }) => {
    await autenticar(page);
    await abrirRelatorio(page);
    const ids = await page.locator(".tela-relatorio .rel-secao").evaluateAll(
      (els) => els.map((e) => e.getAttribute("data-secao")));
    expect(ids).toEqual([
      "prestacao_contas", "leitura_mes", "como_voce_foi", "funcionando",
      "nao_funcionando", "renda", "alinhamento", "radar", "evidencias",
    ]);
    // manchete forte e §5 com destaque
    await expect(page.locator('.rel-secao[data-secao="leitura_mes"]'))
      .toHaveClass(/rel-secao--manchete/);
    await expect(page.locator('.rel-secao[data-secao="nao_funcionando"]'))
      .toHaveClass(/rel-secao--destaque/);
  });

  test("selos de veredito com forma + texto + cor (a11y)", async ({ page }) => {
    await autenticar(page);
    await abrirRelatorio(page);
    const radar = page.locator('.rel-secao[data-secao="radar"]');
    await expect(radar.locator(".rel-radar-card")).toHaveCount(3);
    // texto do veredito presente (não só cor)
    await expect(radar).toContainText("Tese intacta");
    await expect(radar).toContainText("Sob pressão");
    await expect(radar).toContainText("Deteriorando");
    // §5 destaca os não-intacta como selos
    const dest = page.locator('.rel-secao[data-secao="nao_funcionando"]');
    await expect(dest.locator(".rel-selo")).toHaveCount(2); // SMAL11 + KISU11
    // glyph é aria-hidden (leitor lê só o texto)
    await expect(radar.locator(".rel-selo__marca").first())
      .toHaveAttribute("aria-hidden", "true");
  });

  test("mini-cards do dossiê + lista de evidências", async ({ page }) => {
    await autenticar(page);
    await abrirRelatorio(page);
    // como_voce_foi: kpis de performance + decomposição (4 + 3 = 7)
    const cvf = page.locator('.rel-secao[data-secao="como_voce_foi"]');
    await expect(cvf.locator(".kpi")).toHaveCount(7);
    // renda: kpis
    await expect(page.locator('.rel-secao[data-secao="renda"] .kpi'))
      .toHaveCount(4);
    // evidências: 3 citações, a baixa marcada como "sinal incerto"
    const ev = page.locator('.rel-secao[data-secao="evidencias"]');
    await expect(ev.locator(".rel-evidencias li")).toHaveCount(3);
    await expect(ev).toContainText("sinal incerto");
    const link = ev.locator('a[href="https://example.com/hash11"]');
    await expect(link).toHaveAttribute("target", "_blank");
  });

  // ── B1: Month selector ──────────────────────────────────────────────────────
  test("seletor de mês troca o relatório e decifra sob demanda", async ({ page }) => {
    await autenticar(page);
    await abrirRelatorio(page);
    await expect(page.locator(".tela-relatorio .breadcrumb")).toContainText("Maio 2026");
    await page.locator(".rel-seletor__btn").click();
    await expect(page.locator(".rel-seletor__lista")).toBeVisible();
    await page.locator('.rel-seletor__item', { hasText: "Abril 2026" }).click();
    await expect(page).toHaveURL(/#\/raiox\/relatorio\/2026-04$/);
    await expect(page.locator(".tela-relatorio .breadcrumb")).toContainText("Abril 2026");
    // mês 1 (abril) → prestação de contas vira nota, sem linhas estruturadas
    await expect(page.locator(".rel-prestacao")).toBeHidden();
    await expect(page.locator('.rel-secao[data-secao="prestacao_contas"]'))
      .toContainText("Primeiro relatório");
  });

  // ── B2: States — loading / error / empty ────────────────────────────────────
  test("erro de arquivo mostra mensagem calma + voltar ao último mês", async ({ page }) => {
    await autenticar(page);
    // sobrescreve a rota do mês para falhar (404)
    await page.route("**/relatorio_2099-01.json.enc", (r) => r.fulfill({ status: 404, body: "" }));
    await page.goto("/#/raiox/relatorio/2099-01");
    await expect(page.locator(".rel-erro")).toBeVisible();
    await expect(page.locator(".rel-erro")).toContainText("Não foi possível");
    await page.locator(".rel-erro__voltar").click();
    await expect(page.locator(".tela-relatorio .breadcrumb")).toContainText("Maio 2026");
  });

  test("card oculto e mensagem calma quando não há relatórios (empty-safe)", async ({ page }) => {
    await page.route("**/portfolio.json.enc", (r) =>
      r.fulfill({ status: 200, body: PORTFOLIO, contentType: "text/plain" }));
    await page.route("**/relatorios_index.json.enc", (r) => r.fulfill({ status: 404, body: "" }));
    await page.addInitScript(() => {
      localStorage.setItem("pin", "123456");
      localStorage.setItem("pinTimestamp", String(Date.now() - 1 * 24 * 60 * 60 * 1000));
    });
    await page.goto("/");
    await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".rel-card-home")).toBeHidden();
    await page.goto("/#/raiox/relatorio");
    await expect(page.locator(".rel-vazio")).toBeVisible();
    await expect(page.locator(".rel-vazio")).toContainText("Ainda não há relatórios");
  });

  // ── B3: Cold-start + back navigation ────────────────────────────────────────
  test("cold-start direto em #/raiox/relatorio/:mes renderiza (auto-resume)", async ({ page }) => {
    await mockTudo(page);
    await page.addInitScript(() => {
      localStorage.setItem("pin", "123456");
      localStorage.setItem("pinTimestamp", String(Date.now() - 1 * 24 * 60 * 60 * 1000));
    });
    await page.goto("/#/raiox/relatorio/2026-04");
    await expect(page.locator(".tela-relatorio")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".tela-relatorio .breadcrumb")).toContainText("Abril 2026");
  });

  test("cold-start submitPin em #/raiox/relatorio renderiza o último mês", async ({ page }) => {
    await mockTudo(page);
    await page.goto("/#/raiox/relatorio");
    await expect(page.locator(".pin-screen")).toBeVisible({ timeout: 10_000 });
    await page.locator("input.pin-input").fill("123456");
    await page.locator("button.pin-submit").click();
    await expect(page.locator(".tela-relatorio")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".tela-relatorio .breadcrumb")).toContainText("Maio 2026");
  });

  test("voltar retorna ao Raio-X", async ({ page }) => {
    await autenticar(page);
    await page.locator(".rel-card-home").click();
    await expect(page.locator(".tela-relatorio")).toBeVisible();
    await page.locator(".tela-relatorio .breadcrumb button").first().click();
    await expect(page.locator(".raiox")).toBeVisible();
    await expect(page.locator(".tela-relatorio")).toBeHidden();
  });

  test("payload com schema inválido cai no estado de erro (não renderiza prosa)", async ({ page }) => {
    await autenticar(page);
    // decifra OK (PIN de teste) mas schema != relatorio_mensal_v1 → branch de erro
    await page.route("**/relatorio_2026-05.json.enc", (r) =>
      r.fulfill({ status: 200, body: BADSCHEMA, contentType: "text/plain" }));
    await page.goto("/#/raiox/relatorio/2026-05");
    await expect(page.locator(".rel-erro")).toBeVisible();
    await expect(page.locator(".rel-erro")).toContainText("Não foi possível");
    await expect(page.locator(".rel-corpo")).toBeHidden();
  });

  // ── 7a.S.9 Task 1: capa editorial (poster + veredito + seletor sem quebra) ──
  test("capa editorial: mês em poster (46px) + veredito derivado do artefato", async ({ page }) => {
    await autenticar(page);
    await page.locator(".rel-card-home").click();
    await expect(page.locator(".tela-relatorio")).toBeVisible();

    const poster = page.locator(".rel-poster");
    await expect(poster).toBeVisible();
    await expect(poster).toContainText("Maio");
    await expect(poster).toContainText("2026");
    const fontSize = await poster.evaluate((el) => getComputedStyle(el).fontSize);
    expect(fontSize).toBe("46px");

    // Veredito NÃO é fabricado: é a 1ª frase da seção "leitura_mes" do artefato
    // real (fixture), com o rótulo "Veredito do mês" prefixado.
    const veredito = page.locator(".rel-veredito-linha");
    await expect(veredito).toContainText("Veredito do mês");
    await expect(veredito).toContainText(
      "Maio 2026 foi um mês de avanço sólido, puxado pela ponta nos EUA."
    );

    // Troca de mês troca o veredito junto (mesma derivação, mês diferente).
    await page.locator(".rel-seletor__btn").click();
    await page.locator(".rel-seletor__item", { hasText: "Abril 2026" }).click();
    await expect(page.locator(".tela-relatorio .breadcrumb")).toContainText("Abril 2026");
    await expect(poster).toContainText("Abril");
    await expect(veredito).toContainText(
      "Abril 2026 foi um mês de avanço sólido, puxado pela ponta nos EUA."
    );
  });

  test("seletor de mês não quebra linha @320px (micro-atrito Fable)", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await autenticar(page);
    await page.locator(".rel-card-home").click();
    await expect(page.locator(".tela-relatorio")).toBeVisible();
    const btn = page.locator(".rel-seletor__btn");
    const whiteSpace = await btn.evaluate((el) => getComputedStyle(el).whiteSpace);
    expect(whiteSpace).toBe("nowrap");
    // Altura de uma única linha (~44px de min-height, nunca duas linhas de texto).
    const box = await btn.boundingBox();
    expect(box && box.height).toBeLessThanOrEqual(44);
  });

  // ── 7a.S.9 Task 2: evento mensal — dot "não lido" ────────────────────────────
  test("dot não-lido no card home; some após abrir o mês (relRead localStorage)", async ({ page }) => {
    await autenticar(page);
    const dot = page.locator(".rel-card-home .rel-dot");
    await expect(dot).toBeVisible();
    // a11y: significado textual, não só cor+pulse.
    await expect(page.locator(".rel-card-home .sr-only")).toHaveText("não lido");

    await page.locator(".rel-card-home").click();
    await expect(page.locator(".tela-relatorio")).toBeVisible();
    await page.locator(".tela-relatorio .breadcrumb button").first().click();
    await expect(page.locator(".raiox")).toBeVisible();
    await expect(page.locator(".rel-card-home .rel-dot")).toBeHidden();
  });

  test("dot não-lido no item do seletor; some por-mês ao abrir", async ({ page }) => {
    await autenticar(page);
    await page.locator(".rel-card-home").click(); // abre maio (último) → marca lido
    await expect(page.locator(".tela-relatorio")).toBeVisible();
    await page.locator(".rel-seletor__btn").click();
    const itemMaio = page.locator(".rel-seletor__item", { hasText: "Maio 2026" });
    const itemAbril = page.locator(".rel-seletor__item", { hasText: "Abril 2026" });
    await expect(itemMaio.locator(".rel-dot")).toBeHidden(); // já lido (era o último)
    await expect(itemAbril.locator(".rel-dot")).toBeVisible(); // ainda não lido

    await itemAbril.click();
    await expect(page.locator(".tela-relatorio .breadcrumb")).toContainText("Abril 2026");
    await page.locator(".rel-seletor__btn").click();
    await expect(page.locator(".rel-seletor__item", { hasText: "Abril 2026" }).locator(".rel-dot"))
      .toBeHidden();
  });

  test("dot não-lido pulsa por padrão; prefers-reduced-motion desliga", async ({ page }) => {
    await autenticar(page);
    const dot = page.locator(".rel-card-home .rel-dot");
    await expect(dot).toBeVisible();
    const animOn = await dot.evaluate((el) => getComputedStyle(el, "::after").animationName);
    expect(animOn).not.toBe("none");
  });

  test("dot não-lido: prefers-reduced-motion desliga o pulse", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await autenticar(page);
    const dot = page.locator(".rel-card-home .rel-dot");
    await expect(dot).toBeVisible();
    const animOff = await dot.evaluate((el) => getComputedStyle(el, "::after").animationName);
    expect(animOff).toBe("none");
  });

  // Regressão do separador de milhar pt-BR (7a.S.9 Task 1 / CRB): a 1ª frase
  // de "leitura_mes" com um valor "R$ 3.240,50" no meio NÃO pode ser cortada
  // no ponto de milhar. _primeiraFrase corta só em '.'/'!'/'?' seguido de
  // espaço ou fim — "3.240,50" não tem espaço após o ponto, então preserva a
  // frase inteira. Injeta o corpo via Alpine.$data (determinístico, sem
  // fixture extra) e checa a derivação real da linha de veredito.
  test("veredito: separador de milhar pt-BR não trunca a 1ª frase", async ({ page }) => {
    await autenticar(page);
    await abrirRelatorio(page);

    await page.evaluate(() => {
      const $data = (window as any).Alpine?.$data?.(document.body);
      if (!$data) throw new Error("Alpine.$data(document.body) é undefined");
      const sec = ($data.relMes.secoes || []).find((s: any) => s && s.id === "leitura_mes");
      if (!sec) throw new Error("seção leitura_mes ausente no relMes");
      sec.corpo =
        "O patrimônio subiu para R$ 3.240,50 no mês. A segunda frase não deve aparecer.";
    });

    const veredito = page.locator(".rel-veredito-linha");
    // Frase inteira, incluindo o valor com ponto de milhar…
    await expect(veredito).toContainText("O patrimônio subiu para R$ 3.240,50 no mês.");
    // …e NUNCA a 2ª frase (prova que não cortou em "3.240").
    await expect(veredito).not.toContainText("A segunda frase não deve aparecer");
  });

  // ── 7a.S.9 Task 3: grifo âmbar consagrado (Apêndice B: Relatório = âmbar) ────
  test("box 'NÃO funcionando' consagra o grifo âmbar (S.1); selos preservados", async ({ page }) => {
    await autenticar(page);
    await abrirRelatorio(page);
    const dest = page.locator('.rel-secao[data-secao="nao_funcionando"]');
    await expect(dest).toHaveClass(/rel-secao--destaque/); // preservado
    await expect(dest).toHaveClass(/grifo--amber/);
    const borderColor = await dest.evaluate((el) => getComputedStyle(el).borderLeftColor);
    expect(borderColor).toBe("rgb(245, 158, 11)"); // var(--amber) #f59e0b
    // Selos de veredito continuam preservados dentro do box (SMAL11 + KISU11).
    await expect(dest.locator(".rel-selo")).toHaveCount(2);
  });
});
