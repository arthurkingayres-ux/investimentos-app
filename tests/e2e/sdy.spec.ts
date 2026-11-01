import { test, expect, Page } from "@playwright/test";
import fs from "fs";
import path from "path";

// Fase 7a.S.7b — tela dedicada #s-dy (Dividend Yield): poster da carteira +
// linhas por classe (dy-row) + bandeja da classe tocada (dy-champs). Desde a
// 7a.BO.2 (schema v2.33) a bandeja é o ranking completo da classe
// (`dividend_yield.ranking`); sem fallback para `campeoes` desde a 7a.BO.4.

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
  test("rota #/proventos/dy: poster + 3 dy-rows + ranking; tab persiste; breadcrumb", async ({ page }) => {
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

    // Ranking visível com pelo menos 1 item (ticker + dy%).
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

  test("clicar numa dy-row troca a classe do ranking", async ({ page }) => {
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

    // Clica na 2ª linha — o ranking deve trocar para a classe clicada.
    await rows.nth(1).click();
    await expect(rows.nth(1)).toHaveClass(/on/);
    await expect(rows.nth(0)).not.toHaveClass(/on/);
    // A classe do cabeçalho do ranking reflete a linha clicada.
    const segundaLinhaTexto = await rows.nth(1).locator(".cls").textContent();
    expect(segundaLinhaTexto).toBeTruthy();
    expect(primeiraLinhaTexto).not.toBe(segundaLinhaTexto);
    // O ranking segue com pelo menos 1 item (a fixture tem ≥ 3 em cada classe).
    await expect(champs.locator(".champ").first()).toBeVisible();
  });

  test("empty-safe: ranking vazio não quebra a tela", async ({ page }) => {
    await autenticar(page);
    await page.goto("/#/proventos/dy");
    await expect(page.locator(".tela-dy")).toBeVisible({ timeout: 10_000 });

    const erros: string[] = [];
    page.on("pageerror", (err) => erros.push(String(err)));
    await mutarDY(page, (dy) => {
      dy.ranking = { acao_br: [], fii: [], eua: [] };
    });
    await page.locator(".tela-dy .dy-row").first().click();
    await expect(page.locator('[data-testid="dy-champs"]'))
      .toContainText("Nenhum ativo nesta classe.");
    expect(erros).toEqual([]);
  });

  // CRB sev65: cold-start deep-link (bookmark/share-link) para #/proventos/dy
  // — NENHUM visit prévio a "/". O caminho verdadeiro passa por
  // tentarAutoResume (sessão válida em localStorage), não por um hashchange
  // no mesmo documento. hidratarDY() precisa rodar no re-hidrata pós-resume,
  // senão dySelecionado fica null e o ranking (x-show="dySelecionado") só
  // aparece após um toque manual numa .dy-row.
  test("cold-start deep-link: ranking aparece por default sem toque manual", async ({ page }) => {
    await page.route("**/portfolio.json.enc", (route) =>
      route.fulfill({ status: 200, body: FIXTURE, contentType: "text/plain" }));
    await page.addInitScript(() => {
      localStorage.setItem("pin", "123456");
      localStorage.setItem("pinTimestamp", String(Date.now() - 24 * 60 * 60 * 1000));
    });
    // Único goto — direto na rota push, sem passar pela home antes.
    await page.goto("/#/proventos/dy");
    await expect(page.locator(".tela-dy")).toBeVisible({ timeout: 10_000 });

    // O ranking deve estar visível SEM interação (prova o re-hidrata do cold-start).
    const champs = page.locator('[data-testid="dy-champs"]');
    await expect(champs).toBeVisible();
    await expect(champs.locator(".champ").first()).toBeVisible();
  });
});

// Muta `json.dividend_yield` em runtime (estados que a fixture não carrega).
async function mutarDY(page: Page, fn: (dy: Record<string, unknown>) => void) {
  await page.evaluate((src) => {
    const data = (window as unknown as {
      Alpine: { $data: (el: Element) => Record<string, unknown> };
    }).Alpine.$data(document.body) as { json: { dividend_yield: Record<string, unknown> } };
    new Function("dy", `(${src})(dy)`)(data.json.dividend_yield);
  }, fn.toString());
}

async function abrirClasse(page: Page, nome: string) {
  if (!page.url().includes("#/proventos/dy")) await page.goto("/#/proventos/dy");
  await expect(page.locator(".tela-dy")).toBeVisible({ timeout: 10_000 });
  await page.locator(".tela-dy .dy-row", {
    has: page.locator(".cls", { hasText: new RegExp(`^${nome}$`) }),
  }).click();
}

// Ação BR da fixture (15 = 12 com DY + 3 sem), na ordem do payload.
const ACAO_BR_COM = [
  "ITSA4", "BBAS3", "SMAL11", "SINTA3", "SINTB3", "SINTC3",
  "SINTD3", "SINTE3", "SINTG3", "SINTH3", "SINTJ3", "SINTK3",
];
const ACAO_BR_SEM = ["SINTX3", "SINTY3", "SINTZ3"];

test.describe("#s-dy — ranking completo da classe (7a.BO.2)", () => {
  test("ranking: a classe longa renderiza todos os itens na ordem do payload", async ({ page }) => {
    await autenticar(page);
    await abrirClasse(page, "Ação BR");
    const bloco = page.locator('[data-testid="dy-champs"]');
    await expect(bloco.locator("ol .champ")).toHaveCount(12);
    expect(await bloco.locator("ol .champ .tk").allTextContents()).toEqual(ACAO_BR_COM);
    await expect(bloco.locator("ul .champ")).toHaveCount(3);
    expect(await bloco.locator("ul .champ .tk").allTextContents()).toEqual(ACAO_BR_SEM);
  });

  test("top-3 com posição em destaque", async ({ page }) => {
    await autenticar(page);
    await abrirClasse(page, "Ação BR");
    const rk = page.locator('[data-testid="dy-champs"] ol .champ .rk');
    await expect(rk).toHaveCount(12);
    const cor = (n: number) => rk.nth(n).evaluate((el) => getComputedStyle(el).color);
    const accent = await page.evaluate(() => {
      const el = document.createElement("span");
      el.style.color = "var(--accent)";
      document.querySelector(".tela-dy")!.appendChild(el);
      const c = getComputedStyle(el).color;
      el.remove();
      return c;
    });
    expect(await cor(0)).toBe(accent);
    expect(await cor(2)).toBe(accent);
    expect(await cor(3)).not.toBe(accent);
  });

  test("subgrupo sem DY rende — no DY e no valor null", async ({ page }) => {
    await autenticar(page);
    await abrirClasse(page, "Ação BR");
    const sem = page.locator('[data-testid="dy-champs"] ul');
    await expect(page.locator("#dy-sem-h")).toHaveText("Sem dividend yield em 12 meses");
    await expect(sem).toHaveAttribute("aria-labelledby", "dy-sem-h");
    const x = sem.locator(".champ", { has: page.locator(".tk", { hasText: "SINTX3" }) });
    await expect(x.locator(".y")).toHaveText("—");
    await expect(x.locator(".bw")).toHaveCount(0);
    await expect(x.locator(".rs")).toHaveText("—");
    const y = sem.locator(".champ", { has: page.locator(".tk", { hasText: "SINTY3" }) });
    await expect(y.locator(".y")).toHaveText("—");
    await expect(y.locator(".rs")).toContainText("R$");
    await expect(sem).not.toContainText("0,0%");
    await expect(sem).not.toContainText("R$ 0,00");
  });

  test("subgrupo some quando vazio", async ({ page }) => {
    await autenticar(page);
    await abrirClasse(page, "EUA · USD");
    const bloco = page.locator('[data-testid="dy-champs"]');
    await expect(bloco.locator("ol .champ")).toHaveCount(3);
    await expect(bloco.locator("ul")).toHaveCount(0);
    await expect(page.locator("#dy-sem-h")).toHaveCount(0);
  });

  test("selo só nos parciais", async ({ page }) => {
    await autenticar(page);
    const bloco = page.locator('[data-testid="dy-champs"]');
    const selos = bloco.locator(".champ .kpi-nota-parcial");
    const comSelo = bloco.locator(".champ", { has: page.locator(".kpi-nota-parcial") }).locator(".tk");
    await abrirClasse(page, "Ação BR");
    await expect(selos).toHaveCount(1);
    await expect(selos).toHaveText("posição < 12 meses");
    await expect(comSelo).toHaveText("SINTE3");
    await abrirClasse(page, "FII");
    await expect(selos).toHaveCount(1);
    await expect(comSelo).toHaveText("HGLG11");
    await abrirClasse(page, "EUA · USD");
    await expect(bloco.locator("ol .champ")).toHaveCount(3);
    await expect(selos).toHaveCount(0);
  });

  test("estado vazio: só sem DY", async ({ page }) => {
    await autenticar(page);
    await abrirClasse(page, "FII");
    await mutarDY(page, (dy) => {
      const r = dy.ranking as Record<string, Array<Record<string, unknown>>>;
      r.fii = r.fii.map((i) => ({ ...i, dy: null }));
    });
    const bloco = page.locator('[data-testid="dy-champs"]');
    await expect(bloco.locator(".dy-champs-vazio"))
      .toHaveText("Nenhum ativo desta classe pagou provento nos últimos 12 meses.");
    await expect(bloco.locator("ol .champ")).toHaveCount(0);
    await expect(bloco.locator("ul .champ")).toHaveCount(4);
    // O subgrupo vem logo abaixo da copy.
    const depois = await bloco.evaluate((el) => {
      const v = el.querySelector(".dy-champs-vazio");
      const h = el.querySelector("#dy-sem-h");
      return !!(v && h && (v.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    expect(depois).toBe(true);
  });

  test("estado vazio: classe sem item", async ({ page }) => {
    await autenticar(page);
    await abrirClasse(page, "FII");
    await mutarDY(page, (dy) => {
      (dy.ranking as Record<string, unknown>).fii = [];
    });
    const bloco = page.locator('[data-testid="dy-champs"]');
    await expect(bloco.locator(".dy-champs-vazio")).toHaveText("Nenhum ativo nesta classe.");
    await expect(bloco.locator(".champ")).toHaveCount(0);
    await expect(bloco.locator("ul")).toHaveCount(0);
  });

  // 7a.BO.4: sem fallback. Payload sem `ranking` (< 2.33) mostra a classe
  // vazia, mesmo com um `campeoes` antigo presente.
  test("payload sem ranking: classe vazia, sem fallback", async ({ page }) => {
    const erros: string[] = [];
    page.on("pageerror", (err) => erros.push(String(err)));
    await autenticar(page);
    await abrirClasse(page, "Ação BR");
    await mutarDY(page, (dy) => {
      const r = dy.ranking as Record<string, Array<Record<string, unknown>>>;
      dy.campeoes = { acao_br: r.acao_br.slice(0, 3), fii: [], eua: [] };
      delete dy.ranking;
    });
    const bloco = page.locator('[data-testid="dy-champs"]');
    await expect(bloco.locator(".dy-champs-vazio")).toHaveText("Nenhum ativo nesta classe.");
    await expect(bloco.locator(".champ")).toHaveCount(0);
    expect(erros).toEqual([]);
  });

  test("aria-live anuncia o cabeçalho", async ({ page }) => {
    await autenticar(page);
    await abrirClasse(page, "Ação BR");
    const bloco = page.locator('[data-testid="dy-champs"]');
    const live = bloco.locator("[aria-live]");
    await expect(live).toHaveCount(1);
    await expect(live).toHaveText("Ranking Ação BR, 12 ativos com dividend yield, 3 sem.");
    await expect(live).not.toContainText("ITSA4");
    expect(await bloco.getAttribute("aria-live")).toBeNull();
    expect(await bloco.locator("ol").getAttribute("aria-live")).toBeNull();
  });

  test("anúncio no singular", async ({ page }) => {
    await autenticar(page);
    await abrirClasse(page, "FII");
    await mutarDY(page, (dy) => {
      const r = dy.ranking as Record<string, Array<Record<string, unknown>>>;
      r.fii = r.fii.slice(0, 1).concat(r.fii.slice(3));
    });
    await expect(page.locator('[data-testid="dy-champs"] [aria-live]'))
      .toHaveText("Ranking FII, 1 ativo com dividend yield, 1 sem.");
  });

  test("copy de ranking", async ({ page }) => {
    await autenticar(page);
    await abrirClasse(page, "Ação BR");
    await expect(page.locator(".tela-dy .dy-cap")).toContainText("toque para o ranking");
    await expect(page.locator(".tela-dy .dy-cap")).not.toContainText("campeões");
    const labels = await page.locator(".tela-dy .dy-row").evaluateAll(
      (els) => els.map((e) => e.getAttribute("aria-label") || ""));
    expect(labels).toHaveLength(3);
    for (const lbl of labels) expect(lbl).toMatch(/— ver o ranking$/);
    const h = page.locator('[data-testid="dy-champs"] .dc-h');
    await expect(h.locator(".t")).toHaveText("Ranking · Ação BR");
    await expect(h.locator(".c")).toHaveText("maior yield · 12m");
    await expect(h).not.toContainText("★");
    await expect(page.locator(".tela-dy .footnote-dy"))
      .toContainText("— = sem provento no período ou sem número confiável");
  });

  test("320px sem rolagem horizontal", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await autenticar(page);
    await abrirClasse(page, "Ação BR");
    const bloco = page.locator('[data-testid="dy-champs"]');
    await expect(bloco.locator("ol .champ")).toHaveCount(12);
    const doc = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(doc.sw).toBeLessThanOrEqual(doc.cw);
    // `.y` é flex 0 0 auto e a bandeja corta o overflow: o scrollWidth do
    // `.y` nunca acusaria. O que trava é a borda direita do DY dentro da
    // área útil da bandeja.
    const vazados = await bloco.evaluate((el) => {
      const cs = getComputedStyle(el);
      const limite = el.getBoundingClientRect().right - parseFloat(cs.paddingRight);
      return [...el.querySelectorAll(".champ .y")]
        .filter((y) => y.getBoundingClientRect().right > limite + 0.5).length;
    });
    expect(vazados).toBe(0);
    await bloco.screenshot({ path: "tests/screenshots/sdy-ranking-320.png" });
  });
});

test.describe("Fixture — dividend_yield.ranking (7a.BO.2, 2.34 na 7a.BO.4)", () => {
  test("ranking com as 3 categorias, sem campeoes", async () => {
    const json = JSON.parse(await decifrarFixture(FIXTURE, PIN_TESTE));
    expect(json.versao).toBe("2.34");
    const { ranking } = json.dividend_yield;
    expect(json.dividend_yield).not.toHaveProperty("campeoes");
    expect(Object.keys(ranking).sort()).toEqual(["acao_br", "eua", "fii"]);
    expect(ranking.acao_br).toHaveLength(15);
    for (const cat of ["acao_br", "fii", "eua"]) {
      expect(ranking[cat].length).toBeGreaterThan(0);
      for (const item of ranking[cat]) {
        expect(Object.keys(item).sort()).toEqual(
          ["bandeira", "dy", "moeda", "proventos_12m", "ticker", "valor"]);
        expect(typeof item.ticker).toBe("string");
        expect(item.dy === null || typeof item.dy === "number").toBe(true);
        expect(typeof item.proventos_12m).toBe("number");
        expect(item.valor === null || typeof item.valor === "number").toBe(true);
        expect(["BRL", "USD"]).toContain(item.moeda);
      }
    }
  });
});
