import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

const FIXTURE = fs.readFileSync(
  path.join(__dirname, "../fixtures/portfolio.test.json.enc"),
  "utf-8",
);

async function mockPortfolio(page: Page) {
  await page.route("**/portfolio.json.enc", (route) =>
    route.fulfill({ status: 200, body: FIXTURE, contentType: "text/plain" }),
  );
}

test.describe("Multi-tab sync", () => {
  test("bloquear() em outra aba -> esta aba cai para PIN via evento storage", async ({
    context,
  }) => {
    const pageA = await context.newPage();
    await mockPortfolio(pageA);
    const pageB = await context.newPage();
    await mockPortfolio(pageB);

    // Log in na aba A
    // 7a.W.3.b: storage sem `pin` levaria ao ENROLLMENT. Este teste mede o
    // fluxo do dia a dia (aparelho já pareado), então semeia o PIN.
    await pageA.addInitScript(() => localStorage.setItem("pin", "123456"));
    await pageA.goto("/");
    await pageA.locator("input.pin-input").fill("123456");
    await pageA.locator("button.pin-submit").click();
    await expect(pageA.locator(".raiox")).toBeVisible({ timeout: 10_000 });

    // Aba B reusa sessao (mesmo localStorage via origin compartilhado)
    await pageB.goto("/");
    await expect(pageB.locator(".raiox")).toBeVisible({ timeout: 10_000 });

    // Aba B navega para uma rota não-default antes do bloqueio cross-tab,
    // para provar que o handler do evento storage também zera `rota`.
    await pageB.goto("/#alocacao");
    await expect(pageB.locator(".tela-alocacao")).toBeVisible();

    // A clica em Bloquear
    await pageA.getByRole("button", { name: /bloquear/i }).click();
    await expect(pageA.locator(".pin-screen")).toBeVisible();

    // B deve cair via evento storage
    await expect(pageB.locator(".pin-screen")).toBeVisible({ timeout: 5_000 });
    // E rota deve ter zerado (não pode ficar presa em "alocacao")
    const rotaB = await pageB.evaluate(
      () => Alpine.$data(document.body).rota,
    );
    expect(rotaB).toBe("");
  });

  test("race: bloquear() durante auto-resume da aba B -> B respeita logout", async ({
    context,
  }) => {
    const pageA = await context.newPage();
    await mockPortfolio(pageA);
    const pageB = await context.newPage();

    // Log in na aba A para semear localStorage com pin + pinTimestamp
    // 7a.W.3.b: storage sem `pin` levaria ao ENROLLMENT. Este teste mede o
    // fluxo do dia a dia (aparelho já pareado), então semeia o PIN.
    await pageA.addInitScript(() => localStorage.setItem("pin", "123456"));
    await pageA.goto("/");
    await pageA.locator("input.pin-input").fill("123456");
    await pageA.locator("button.pin-submit").click();
    await pageA.locator(".raiox").waitFor({ timeout: 10_000 });

    // Simula fetch lento em B: 2s de atraso no portfolio.json.enc.
    const FIXTURE = await pageA.evaluate(() =>
      fetch("./portfolio.json.enc").then((r) => r.text()),
    );
    await pageB.route("**/portfolio.json.enc", async (route) => {
      await new Promise((r) => setTimeout(r, 2_000));
      return route.fulfill({ status: 200, body: FIXTURE, contentType: "text/plain" });
    });

    // B abre — vai entrar em tentarAutoResume com fetch em curso (2s de espera).
    const navB = pageB.goto("/");
    await pageB.waitForTimeout(300);

    // Durante esse window, A chama bloquear() — limpa pin do localStorage.
    await pageA.getByRole("button", { name: /bloquear/i }).click();
    await expect(pageA.locator(".pin-screen")).toBeVisible();

    // Espera B terminar navegação + auto-resume + race-guard
    await navB;
    await pageB.waitForTimeout(3_000);

    // B DEVE continuar em PIN (race guard rejeita promoção de fase)
    await expect(pageB.locator(".pin-screen")).toBeVisible();
    await expect(pageB.locator(".raiox")).toHaveCount(0);
  });

  test("race: bloquear() APÓS o raio-x, com o índice de relatórios em voo -> B fica no PIN, não na frase", async ({
    context,
  }) => {
    // Regressão do CI de 22/10/2026 (0bf36e6): o auto-resume promove B a
    // raiox e só DEPOIS aguarda o índice de relatórios. O lock cross-tab
    // nessa janela zerava `json`; o resto do try lia `this.json.atualizado_em`,
    // estourava, e o catch tratava como carteira republicada (fase "frase").
    const pageA = await context.newPage();
    await mockPortfolio(pageA);
    const pageB = await context.newPage();
    await mockPortfolio(pageB);

    let liberarIndice!: () => void;
    const indiceRetido = new Promise<void>((r) => (liberarIndice = r));
    let indicePedido!: () => void;
    const indiceEmVoo = new Promise<void>((r) => (indicePedido = r));
    await pageB.route("**/relatorios_index.json.enc", async (route) => {
      indicePedido();
      await indiceRetido;
      await route.continue();
    });

    await pageA.addInitScript(() => localStorage.setItem("pin", "123456"));
    await pageA.goto("/");
    await pageA.locator("input.pin-input").fill("123456");
    await pageA.locator("button.pin-submit").click();
    await expect(pageA.locator(".raiox")).toBeVisible({ timeout: 10_000 });

    // B retoma a sessão e para no await do índice, já em raiox.
    await pageB.goto("/");
    await expect(pageB.locator(".raiox")).toBeVisible({ timeout: 10_000 });
    await indiceEmVoo;

    await pageA.getByRole("button", { name: /bloquear/i }).click();
    await expect(pageB.locator(".pin-screen")).toBeVisible({ timeout: 5_000 });

    // Solta o índice: o auto-resume retoma depois do lock. O `finally` do
    // carregador zera `_relIndicePromise` (o lock não toca nele), e o resto do
    // auto-resume roda nos microtasks seguintes, antes do próximo evaluate.
    liberarIndice();
    await expect
      .poll(() => pageB.evaluate(() => Alpine.$data(document.body)._relIndicePromise === null))
      .toBe(true);

    const estadoB = await pageB.evaluate(() => {
      const d = Alpine.$data(document.body);
      return { fase: d.fase, fraseMotivo: d.fraseMotivo };
    });
    expect(estadoB).toEqual({ fase: "pin", fraseMotivo: "" });
    await expect(pageB.locator(".pin-screen")).toBeVisible();
  });
});
