import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

// Fase 7a.E.33 — Dividend Yield (trailing 12m) como 7º card KPI da tela #ativo.
// Reusa `dividend_yield.por_ativo` (schema v2.24) via o helper `dyAtivo`, já
// consumido por #alocacao e pelo pódio #s-dy. Fixture 100% sintético.

const FIXTURE = fs.readFileSync(
  path.join(__dirname, "../fixtures/portfolio.test.json.enc"),
  "utf-8",
);

test.use({ viewport: { width: 390, height: 844 } });

async function autenticar(page: Page) {
  await page.route("**/portfolio.json.enc", (route) =>
    route.fulfill({ status: 200, body: FIXTURE, contentType: "text/plain" }),
  );
  await page.addInitScript(() => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem("pinTimestamp", String(Date.now() - 1 * 24 * 60 * 60 * 1000));
  });
  await page.goto("/");
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
}

// O card DY é o 7º .kpi, localizado pelo rótulo por-extenso "Dividend Yield".
function cardDY(page: Page) {
  return page
    .locator(".tela-ativo .kpi", { hasText: "Dividend Yield" })
    .locator(".kpi-valor");
}

test.describe("#ativo — Dividend Yield (7a.E.33)", () => {
  test("ticker com DY mostra o card com o valor formatado", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#ativo/HGLG11");
    await expect(page.locator(".tela-ativo .ticker-hero")).toContainText("HGLG11");
    // HGLG11 → por_ativo 0.091 → formatPctSemSinal(0.091, 1) = "9,1%".
    await expect(cardDY(page)).toHaveText("9,1%");
    // Card COM número não carrega aria-label (o valor já se explica).
    await expect(cardDY(page)).not.toHaveAttribute("aria-label", /.*/);
  });

  test("card é o último da grade, imediatamente depois do XIRR", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#ativo/HGLG11");
    const labels = page.locator(".tela-ativo .kpi-grid .kpi-label");
    await expect(labels).toHaveCount(7);
    await expect(labels.nth(5)).toHaveText("XIRR");
    await expect(labels.nth(6)).toHaveText("Dividend Yield");
  });

  test("chave ausente de por_ativo (posição sem DY) renderiza o traço + nome acessível", async ({ page }) => {
    await autenticar(page);
    // por_ativo continua existindo, mas sem a chave HGLG11 — o caso
    // produção-comum (sem provento nos 12m, ou dust barrado). Espelha o
    // papel do BOVA11 no #alocacao. Mutação in-test evita regenerar fixture
    // (mesmo padrão de ativo-qty-format.spec.ts).
    await page.evaluate(() => {
      const $data = (window as any).Alpine?.$data?.(document.body);
      if (!$data) throw new Error("Alpine.$data ausente");
      delete $data.json.dividend_yield.por_ativo.HGLG11;
    });
    await page.goto("/#ativo/HGLG11");
    await expect(cardDY(page)).toHaveText("—");
    await expect(cardDY(page)).toHaveAttribute("aria-label", "sem dividend yield");
  });

  test("paridade: DY do #ativo é idêntico ao sufixo do #alocacao para o mesmo ticker", async ({ page }) => {
    await autenticar(page);
    // VOO está em posicoes[] E na política (EUA) → aparece nas duas telas.
    await page.goto("/#ativo/VOO");
    await expect(cardDY(page)).toHaveText("1,9%");

    // No #alocacao, o mesmo ticker mostra "DY 1,9%" (mesmo valor + prefixo).
    await page.goto("/#alocacao");
    const cardEUA = page.locator(".tela-alocacao .aloca-cat", {
      has: page.locator(".aloca-cat__nome", { hasText: "EUA" }),
    });
    await cardEUA.locator(".aloca-cat__head").click();
    await expect(cardEUA.locator(".aloca-cat__body")).toBeVisible();
    const dyAloca = cardEUA
      .locator(".aloca-alvo__ativo", {
        has: page.locator(".aloca-alvo__ticker", { hasText: /^VOO$/ }),
      })
      .locator(".aloca-alvo__dy");
    await expect(dyAloca).toHaveText("DY 1,9%");
  });

  test("empty-safe: payload sem o mapa por_ativo (pré-v2.24) renderiza o traço, sem erro de console", async ({ page }) => {
    const erros: string[] = [];
    page.on("console", (msg) => { if (msg.type() === "error") erros.push(msg.text()); });
    page.on("pageerror", (e) => erros.push(String(e)));
    await autenticar(page);
    await page.evaluate(() => {
      const $data = (window as any).Alpine?.$data?.(document.body);
      if (!$data) throw new Error("Alpine.$data ausente");
      delete $data.json.dividend_yield.por_ativo; // o mapa inteiro some
    });
    await page.goto("/#ativo/HGLG11");
    await expect(cardDY(page)).toHaveText("—");
    expect(erros, erros.join("\n")).toHaveLength(0);
  });
});
