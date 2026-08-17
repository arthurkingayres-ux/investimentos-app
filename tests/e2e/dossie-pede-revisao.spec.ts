import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

// Fase 7a.AD.2 — selo derivado "esta tese pede revisão" na tela do dossiê.
//
// O selo é ESTADO DERIVADO: nada é gravado no dossiê, nada muda no schema. O
// predicado (espelho em JS de `tese_pede_revisao`, src/output/dossie_empresa.py):
//
//   ∃ e ∈ timeline : e.confronto_tese.estado === "disparado"
//                    ∧ e.data > (tese.revisada_em || "")
//
// Fixtures 100% SINTÉTICAS: o sibling é público e o `.enc` decifra com o PIN
// de teste público (feedback_sibling_fixtures_sinteticas).

const F = (n: string) =>
  fs.readFileSync(path.join(__dirname, "../fixtures/" + n), "utf-8");
const PORTFOLIO = F("portfolio.test.json.enc");
const IDX_REL = F("relatorios_index.test.json.enc");
const MAIO = F("relatorio_2026-05.test.json.enc");
const IDX_DOSSIES = F("dossies_index.test.json.enc");
const DOSSIES: Record<string, string> = {
  AMZN: F("dossie_AMZN.test.json.enc"),
  HGLG11: F("dossie_HGLG11.test.json.enc"),
  ITSA4: F("dossie_ITSA4.test.json.enc"),
  SMAL11: F("dossie_SMAL11.test.json.enc"),
};
// Variante do edge `revisada_em: null`. Vive FORA do índice de propósito —
// `dossie.spec.ts` afirma `indice: 4` na contagem exata do teste de lock.
const AMZN_TESE_NULA = F("dossie_AMZN_tese_nula.test.json.enc");

const MAPA: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../fixtures/dossies_map.test.json"), "utf-8"),
);
const arqDe = (ticker: string) =>
  Object.keys(MAPA).find((k) => MAPA[k] === ticker)!;

test.use({ viewport: { width: 390, height: 844 } });

async function mockTudo(page: Page) {
  await page.route("**/portfolio.json.enc", (r) =>
    r.fulfill({ status: 200, body: PORTFOLIO, contentType: "text/plain" }));
  await page.route("**/relatorios_index.json.enc", (r) =>
    r.fulfill({ status: 200, body: IDX_REL, contentType: "text/plain" }));
  await page.route("**/relatorio_*.json.enc", (r) =>
    r.fulfill({ status: 200, body: MAIO, contentType: "text/plain" }));
  await page.route("**/dossies_index.json.enc", (r) =>
    r.fulfill({ status: 200, body: IDX_DOSSIES, contentType: "text/plain" }));
  await page.route("**/d_*.json.enc", (r) => {
    const nome = r.request().url().split("/").pop()!.split("?")[0];
    const ticker = MAPA[nome];
    const body = ticker && DOSSIES[ticker];
    return body
      ? r.fulfill({ status: 200, body, contentType: "text/plain" })
      : r.fulfill({ status: 404, body: "", contentType: "text/plain" });
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

// A barreira vai no `.dossie-corpo` (nó sob `x-if`, cuja visibilidade IMPLICA
// `dossieAtual` populado), não no `x-show` da tela
// (feedback_barreira_no_no_que_e_gate_de_dado).
async function abrirDossie(page: Page, ticker: string) {
  await page.evaluate((t) => { location.hash = `#/dossie/${t}`; }, ticker);
  await expect(page.locator(".tela-dossie .dossie-corpo")).toBeVisible({ timeout: 10_000 });
}

const SELO = ".tela-dossie .dossie-pede-revisao";

test.describe("7a.AD.2 — selo 'esta tese pede revisão'", () => {
  test("aparece quando há confronto disparado DEPOIS da revisão da tese", async ({ page }) => {
    await autenticar(page);
    await abrirDossie(page, "HGLG11");   // revisada 2026-06-27, disparo 2026-07-15
    await expect(page.locator(SELO)).toBeVisible();
  });

  test("some quando a revisão da tese é POSTERIOR ao disparo", async ({ page }) => {
    await autenticar(page);
    await abrirDossie(page, "SMAL11");   // revisada 2026-06-20, disparo 2025-12-31
    await expect(page.locator(SELO)).toBeHidden();
  });

  test("dossiê pré-AD.1 (sem confronto_tese em nenhuma entrada) não mostra selo", async ({ page }) => {
    await autenticar(page);
    await abrirDossie(page, "AMZN");
    await expect(page.locator(SELO)).toBeHidden();
  });

  test("tese NUNCA revisada com disparo mostra o selo (o edge do `|| \"\"`)", async ({ page }) => {
    // Sem o `|| ""`, `"2025-12-31" > null` avalia FALSO em JS e o caso MAIS
    // urgente — dossiê nunca revisado, tese disparada — ficaria mudo.
    await autenticar(page);
    await page.route("**/" + arqDe("AMZN"), (r) =>
      r.fulfill({ status: 200, body: AMZN_TESE_NULA, contentType: "text/plain" }));
    await abrirDossie(page, "AMZN");
    await expect(page.locator(SELO)).toBeVisible();
  });

  test("a11y: forma + TEXTO, nunca cor sozinha", async ({ page }) => {
    await autenticar(page);
    await abrirDossie(page, "HGLG11");
    const selo = page.locator(SELO);
    await expect(selo).toContainText(/pede revisão/i);
    // o glifo é decorativo e não pode ser lido pelo leitor de tela
    await expect(selo.locator("[aria-hidden='true']")).toHaveCount(1);
  });

  test("fica FORA do grifo — a tela segue com UM único grifo", async ({ page }) => {
    await autenticar(page);
    await abrirDossie(page, "HGLG11");
    await expect(page.locator(".tela-dossie .grifo")).toHaveCount(1);
    await expect(page.locator(".tela-dossie .grifo .dossie-pede-revisao")).toHaveCount(0);
  });

  test("vive dentro do bloco da tese, depois da linha de revisão", async ({ page }) => {
    await autenticar(page);
    await abrirDossie(page, "HGLG11");
    const ordem = await page.locator(
      ".tela-dossie .dossie-tese > *",
    ).evaluateAll((els) => els.map((e) => e.className.split(" ")[0]));
    expect(ordem[ordem.length - 1]).toBe("dossie-pede-revisao");
  });

  test("é uma frase a LER: --num-xs (13px), não a banda de 10px", async ({ page }) => {
    // Regra documentada nesta tela (bloco 3 do CSS): 10px cai abaixo do piso
    // de legibilidade de corpo em mobile; a voz secundária vem da cor.
    await autenticar(page);
    await abrirDossie(page, "HGLG11");
    const px = await page.locator(SELO).evaluate(
      (el) => getComputedStyle(el).fontSize);
    expect(px).toBe("13px");
  });

  test("sem overflow a 320px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await autenticar(page);
    await abrirDossie(page, "HGLG11");
    await expect(page.locator(SELO)).toBeVisible();
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
