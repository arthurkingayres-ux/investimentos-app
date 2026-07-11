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

  // 7a.E.34 removeu o sufixo DY de #alocacao, então o antigo teste de
  // paridade #ativo↔#alocacao (via `.aloca-alvo__dy`) não tem mais alvo. A
  // paridade cross-superfície exata segue travada no backend por igualdade
  // `round(dy,4)` (7a.E.32.a); as duas superfícies visuais que restam (#ativo
  // e o pódio #s-dy) têm cobertura própria.

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

  // ── Fase 7a.E.35: selo "posição < 12 meses" sob o card DY ────────────────
  // `dyParcial(ticker)` lê `dividend_yield.por_ativo_parcial`. Fixture marca
  // HGLG11 (sintético); VOO fica de fora. O selo é `x-show`+`x-cloak` (nó único
  // sempre no DOM) → o caso "ausente" verifica visibilidade, não contagem.
  function seloParcial(page: Page) {
    return page
      .locator(".tela-ativo .kpi", { hasText: "Dividend Yield" })
      .locator(".kpi-nota-parcial");
  }

  test("posição parcial (< 12m) mostra o selo sob o card DY", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#ativo/HGLG11"); // HGLG11 ∈ por_ativo_parcial (fixture)
    await expect(cardDY(page)).toHaveText("9,1%");
    await expect(seloParcial(page)).toBeVisible();
    await expect(seloParcial(page)).toHaveText("posição < 12 meses");
  });

  test("posição não-parcial (VOO) não mostra o selo", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#ativo/VOO"); // VOO ∉ por_ativo_parcial
    await expect(cardDY(page)).toBeVisible();
    await expect(seloParcial(page)).not.toBeVisible();
  });

  test("selo aparece mesmo com DY '—' (posição parcial sem provento)", async ({ page }) => {
    await autenticar(page);
    // HGLG11 continua em por_ativo_parcial, mas sem DY → card mostra "—" e o
    // selo (propriedade da idade, não do DY) segue visível.
    await page.evaluate(() => {
      const $data = (window as any).Alpine?.$data?.(document.body);
      if (!$data) throw new Error("Alpine.$data ausente");
      delete $data.json.dividend_yield.por_ativo.HGLG11;
    });
    await page.goto("/#ativo/HGLG11");
    await expect(cardDY(page)).toHaveText("—");
    await expect(seloParcial(page)).toBeVisible();
  });
});
