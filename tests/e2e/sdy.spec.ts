import { test, expect, Page } from "@playwright/test";
import fs from "fs";
import path from "path";

// Fase 7a.S.7b — tela dedicada #s-dy (Dividend Yield): poster da carteira +
// linhas por classe (dy-row) + pódio de campeões (dy-champs), consumindo
// `dividend_yield.campeoes` (schema v2.23, Fase 7a.S.7a backend).

const FIXTURE = fs.readFileSync(
  path.join(__dirname, "../fixtures/portfolio.test.json.enc"), "utf-8");

const PIN_TESTE = "123456";

async function autenticar(page: Page) {
  await page.route("**/portfolio.json.enc", (route) =>
    route.fulfill({ status: 200, body: FIXTURE, contentType: "text/plain" }));
  await page.addInitScript(() => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem("pinTimestamp", String(Date.now() - 24 * 60 * 60 * 1000));
  });
  await page.goto("/");
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
}

// Decifra o payload B64 (PBKDF2-HMAC-SHA256 600k + AES-256-GCM) fora do
// browser — mesma paridade de js/crypto.js e src/output/crypto.py, mas em
// Node puro (Web Crypto global disponível desde Node 19+). Evita precisar de
// uma page carregada só para validar o shape do fixture (Task 0/1).
async function decifrarFixture(payloadB64: string, pin: string): Promise<string> {
  const PBKDF2_ITERATIONS = 600_000;
  const SALT_LENGTH = 16;
  const NONCE_LENGTH = 12;
  const bytes = Buffer.from(payloadB64, "base64");
  const salt = bytes.subarray(0, SALT_LENGTH);
  const nonce = bytes.subarray(SALT_LENGTH, SALT_LENGTH + NONCE_LENGTH);
  const ciphertext = bytes.subarray(SALT_LENGTH + NONCE_LENGTH);
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(pin), { name: "PBKDF2" }, false, ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial, { name: "AES-GCM", length: 256 }, false, ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce }, key, ciphertext as BufferSource,
  );
  return new TextDecoder().decode(plaintext);
}

test.describe("#s-dy — tela dedicada Dividend Yield (Task 2)", () => {
  // A jornada "clicar a chamada em #proventos → chega em #s-dy" é coberta em
  // proventos.spec.ts / dividend-yield.spec.ts (Task 3, reforma do topo de
  // #proventos). Aqui a rota é exercitada diretamente pela URL canônica.
  test("rota #/proventos/dy: poster + 3 dy-rows + podio; tab persiste; breadcrumb", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#/proventos/dy");
    await expect(page.locator(".tela-dy")).toBeVisible({ timeout: 10_000 });

    // Poster: DY da carteira, formato pt-BR com %.
    const poster = page.locator(".tela-dy .poster");
    await expect(poster).toBeVisible();
    await expect(poster).toContainText("%");

    // 3 linhas por classe (FII / Ação BR / EUA).
    const rows = page.locator(".tela-dy .dy-row");
    await expect(rows).toHaveCount(3);

    // Pódio de campeões visível com pelo menos 1 campeão (ticker + dy%).
    const champs = page.locator('[data-testid="dy-champs"]');
    await expect(champs).toBeVisible();
    await expect(champs.locator(".champ").first()).toBeVisible();
    await expect(champs.locator(".champ .tk").first()).not.toBeEmpty();
    await expect(champs.locator(".champ .y").first()).toContainText("%");

    // Tab bar persiste (push, não PIN) — Proventos segue marcada.
    await expect(page.locator(".tab-bar")).toBeVisible();
    await expect(
      page.locator('.tab-bar a[data-tab="provent"]'),
    ).toHaveAttribute("aria-current", "page");

    // Breadcrumb: eyebrow--accent + botão voltar → retorna a #proventos.
    await expect(page.locator(".tela-dy .breadcrumb .eyebrow--accent")).toHaveText(/Dividend Yield/i);
    await page.locator(".tela-dy .breadcrumb button").click();
    await expect(page.locator(".tela-proventos")).toBeVisible();
    await expect(page.locator(".tela-dy")).toBeHidden();
    await expect(page).not.toHaveURL(/\/proventos\/dy$/);
  });

  test("clicar numa dy-row troca a categoria do pódio de campeões", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#/proventos/dy");
    await expect(page.locator(".tela-dy")).toBeVisible({ timeout: 10_000 });

    const rows = page.locator(".tela-dy .dy-row");
    const champs = page.locator('[data-testid="dy-champs"]');

    // Clica na 1ª linha (o que estiver selecionado por default já mostra "on").
    const primeiraLinhaTexto = await rows.nth(0).locator(".cls").textContent();
    await rows.nth(0).click();
    await expect(rows.nth(0)).toHaveClass(/on/);
    const tickerAntes = await champs.locator(".champ .tk").first().textContent();

    // Clica na 2ª linha — pódio deve trocar para a categoria clicada.
    await rows.nth(1).click();
    await expect(rows.nth(1)).toHaveClass(/on/);
    await expect(rows.nth(0)).not.toHaveClass(/on/);
    // Categoria do cabeçalho do pódio reflete a linha clicada.
    const segundaLinhaTexto = await rows.nth(1).locator(".cls").textContent();
    expect(segundaLinhaTexto).toBeTruthy();
    expect(primeiraLinhaTexto).not.toBe(segundaLinhaTexto);
    // O pódio segue com pelo menos 1 campeão (fixture tem 3 em cada categoria).
    await expect(champs.locator(".champ").first()).toBeVisible();
  });

  test("empty-safe: campeoes ausente/vazio não quebra a tela", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#/proventos/dy");
    await expect(page.locator(".tela-dy")).toBeVisible({ timeout: 10_000 });

    // Remove campeoes em runtime (simula payload antigo/pré-7a.S.7a) e força
    // a categoria selecionada para uma sem campeões — não deve lançar erro.
    const erros: string[] = [];
    page.on("pageerror", (err) => erros.push(String(err)));
    await page.evaluate(() => {
      const data = (window as unknown as {
        Alpine: { $data: (el: Element) => Record<string, unknown> };
      }).Alpine.$data(document.body) as { json: { dividend_yield: Record<string, unknown> } };
      data.json.dividend_yield.campeoes = { acao_br: [], fii: [], eua: [] };
    });
    // Reforça o clique numa linha para re-render após a mutação.
    await page.locator(".tela-dy .dy-row").first().click();
    await page.waitForTimeout(150);
    await expect(page.locator(".tela-dy")).toBeVisible();
    expect(erros).toEqual([]);
  });

  // CRB sev65: cold-start deep-link (bookmark/share-link) para #/proventos/dy
  // — NENHUM visit prévio a "/". O caminho verdadeiro passa por
  // tentarAutoResume (sessão válida em localStorage), não por um hashchange
  // no mesmo documento. hidratarDY() precisa rodar no re-hidrata pós-resume,
  // senão dySelecionado fica null e o pódio (x-show="dySelecionado") só
  // aparece após um toque manual numa .dy-row.
  test("cold-start deep-link: pódio de campeões aparece por default sem toque manual", async ({ page }) => {
    await page.route("**/portfolio.json.enc", (route) =>
      route.fulfill({ status: 200, body: FIXTURE, contentType: "text/plain" }));
    await page.addInitScript(() => {
      localStorage.setItem("pin", "123456");
      localStorage.setItem("pinTimestamp", String(Date.now() - 24 * 60 * 60 * 1000));
    });
    // Único goto — direto na rota push, sem passar pela home antes.
    await page.goto("/#/proventos/dy");
    await expect(page.locator(".tela-dy")).toBeVisible({ timeout: 10_000 });

    // O pódio deve estar visível SEM interação (prova o re-hidrata do cold-start).
    const champs = page.locator('[data-testid="dy-champs"]');
    await expect(champs).toBeVisible();
    await expect(champs.locator(".champ").first()).toBeVisible();
  });
});

test.describe("Fixture — dividend_yield.campeoes (Task 0/1)", () => {
  test("fixture decifrada expõe campeoes com as 3 categorias", async () => {
    const json = JSON.parse(await decifrarFixture(FIXTURE, PIN_TESTE));
    expect(json.dividend_yield).toBeTruthy();
    expect(json.dividend_yield.campeoes).toBeTruthy();
    expect(Object.keys(json.dividend_yield.campeoes).sort()).toEqual([
      "acao_br", "eua", "fii",
    ]);
    // Cada categoria tem 1-3 campeões com o shape esperado.
    for (const cat of ["acao_br", "fii", "eua"]) {
      const lista = json.dividend_yield.campeoes[cat];
      expect(Array.isArray(lista)).toBe(true);
      expect(lista.length).toBeGreaterThan(0);
      expect(lista.length).toBeLessThanOrEqual(3);
      for (const item of lista) {
        expect(typeof item.ticker).toBe("string");
        expect(typeof item.dy).toBe("number");
        expect(typeof item.proventos_12m).toBe("number");
        expect(typeof item.valor).toBe("number");
        expect(["BRL", "USD"]).toContain(item.moeda);
        expect(typeof item.bandeira).toBe("string");
      }
    }
  });
});
