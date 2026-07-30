import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

// 7a.W.3.a — envelope local. Fixtures 100% SINTÉTICAS (repo público).
const FIXTURE = fs.readFileSync(
  path.join(__dirname, "../fixtures/portfolio.test.json.enc"), "utf-8");

// O segredo do fixture é "123456" (ver gerar_fixture.py) — curto de propósito:
// o `.enc` de teste decifra com ele por design, num repo público.
const SEGREDO = "123456";

async function mock(page: Page) {
  await page.route("**/portfolio.json.enc", (r) =>
    r.fulfill({ status: 200, body: FIXTURE, contentType: "text/plain" }));
  await page.route("**/relatorios_index.json.enc", (r) =>
    r.fulfill({ status: 404, body: "", contentType: "text/plain" }));
  await page.route("**/dossies_index.json.enc", (r) =>
    r.fulfill({ status: 404, body: "", contentType: "text/plain" }));
}

test.describe("7a.W.3.a — envelope local", () => {
  test("unlock cria o envelope e o segredo NAO vai em claro pro localStorage", async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await mock(page);
    await page.goto("/");
    await page.locator("input.pin-input").fill(SEGREDO);
    await page.locator("button.pin-submit").click();
    await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });

    const ls = await page.evaluate(() => ({
      envelope: localStorage.getItem("envelope"),
      pin: localStorage.getItem("pin"),
      chaves: Object.keys(localStorage).sort(),
    }));
    expect(ls.envelope).not.toBeNull();
    expect(ls.envelope!.length).toBeGreaterThan(40);
    // O envelope é ciphertext: não pode conter o segredo em claro.
    expect(ls.envelope).not.toContain(SEGREDO);
    // Nenhuma chave nova inesperada. Se aparecer uma, ou é intencional (e
    // entra nesta lista) ou é vazamento.
    expect(ls.chaves).toEqual(
      ["atualizadoEm", "envelope", "pin", "pinTimestamp"].sort(),
    );
  });

  test("o envelope decifra de volta pro segredo com o PIN local", async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await mock(page);
    await page.goto("/");
    await page.locator("input.pin-input").fill(SEGREDO);
    await page.locator("button.pin-submit").click();
    await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });

    const aberto = await page.evaluate(async () => {
      const env = localStorage.getItem("envelope")!;
      return await (window as any).decifrar(env, localStorage.getItem("pin")!);
    });
    expect(aberto).toBe(SEGREDO);
  });

  test("migracao silenciosa: aparelho com pin e sem envelope entra sem pedir nada", async ({ page }) => {
    // O estado de TODOS os aparelhos do Dr. Arthur hoje: `pin` no
    // localStorage, nenhum envelope. Não pode pedir nada e não pode quebrar.
    await mock(page);
    await page.addInitScript((s) => {
      localStorage.clear();
      localStorage.setItem("pin", s);
      localStorage.setItem("pinTimestamp", String(Date.now() - 3 * 24 * 60 * 60 * 1000));
    }, SEGREDO);
    await page.goto("/");
    await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });

    const env = await page.evaluate(() => localStorage.getItem("envelope"));
    expect(env).not.toBeNull();
    const aberto = await page.evaluate(async () =>
      await (window as any).decifrar(localStorage.getItem("envelope")!, localStorage.getItem("pin")!));
    expect(aberto).toBe(SEGREDO);
  });

  test("PIN errado nao abre o envelope e nao destroi o envelope bom", async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await mock(page);
    await page.goto("/");
    await page.locator("input.pin-input").fill(SEGREDO);
    await page.locator("button.pin-submit").click();
    await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
    const envBom = await page.evaluate(() => localStorage.getItem("envelope"));

    await page.evaluate(() => (window as any).Alpine.$data(document.body).bloquear());
    await expect(page.locator(".pin-screen")).toBeVisible();
    await page.locator("input.pin-input").fill("999999");
    await page.locator("button.pin-submit").click();
    await expect(page.locator(".pin-error")).toBeVisible({ timeout: 10_000 });

    // O envelope tem de continuar lá, byte a byte: um PIN errado é erro de
    // digitação, não motivo para desparear o aparelho.
    expect(await page.evaluate(() => localStorage.getItem("envelope"))).toBe(envBom);
    expect(await page.evaluate(() => (window as any).Alpine.$data(document.body).segredo)).toBe("");
  });

  test("envelope corrompido degrada para o caminho de sempre, sem tela branca", async ({ page }) => {
    await mock(page);
    await page.addInitScript((s) => {
      localStorage.clear();
      localStorage.setItem("envelope", "isto-nao-e-base64-valido!!!");
      localStorage.setItem("pin", s);
      localStorage.setItem("pinTimestamp", String(Date.now()));
    }, SEGREDO);
    await page.goto("/");
    // Não trava e não fica em branco: cai na tela de PIN (ou entra, se o
    // caminho de recuperação conseguir). O que NÃO pode é exception não
    // tratada nem spinner eterno.
    await expect(page.locator(".pin-screen, .raiox").first()).toBeVisible({ timeout: 10_000 });
    const erros: string[] = [];
    page.on("pageerror", (e) => erros.push(String(e)));
    await page.waitForTimeout(500);
    expect(erros).toEqual([]);
  });
});
