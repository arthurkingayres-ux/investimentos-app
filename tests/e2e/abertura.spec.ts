import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

// 7a.S.11 — A Abertura: cerimônia PIN → home (dissolve + reveal em stagger +
// breathe do delta pill). Cerimônia SEM celebração, 1×/sessão, reduced-motion
// zera tudo (dissolve/stagger/breathe — reveal instantâneo).
//
// Nota (spec §"Keypad/dots N/A"): o app usa `.pin-input` (campo de texto),
// não o keypad/dots do mockup — não há nada a testar ali, o PIN é reusado
// como já existe (pin-flow.spec.ts continua sendo a fonte de verdade do
// fluxo de autenticação em si).

const FIXTURE = fs.readFileSync(
  path.join(__dirname, "../fixtures/portfolio.test.json.enc"),
  "utf-8",
);

async function mockPortfolio(page: Page) {
  await page.route("**/portfolio.json.enc", (route) =>
    route.fulfill({ status: 200, body: FIXTURE, contentType: "text/plain" }),
  );
  // Isola do índice de relatórios real (mesmo racional de session.spec.ts):
  // evita decifra com PIN errado poluindo o teste com ruído/exceções.
  await page.route("**/relatorios_index.json.enc", (route) =>
    route.fulfill({ status: 404, body: "", contentType: "text/plain" }),
  );
}

// Monkeypatch global de DOMTokenList.add — grava, em ordem cronológica real,
// toda classe adicionada a qualquer elemento da página. Roda via
// addInitScript (antes de qualquer script da página, incl. Alpine/app.js),
// então captura desde o 1º frame. Usado para provar AUSÊNCIA determinística
// de uma classe (ao invés de correr contra o relógio).
async function comEspiaDeClasses(page: Page) {
  await page.addInitScript(() => {
    (window as any).__classAdds = [];
    const orig = DOMTokenList.prototype.add;
    DOMTokenList.prototype.add = function (...tokens: string[]) {
      tokens.forEach((t) => (window as any).__classAdds.push(t));
      return orig.apply(this, tokens as any);
    };
  });
}

async function autoResumir(page: Page) {
  await mockPortfolio(page);
  await page.addInitScript(() => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem(
      "pinTimestamp",
      String(Date.now() - 1 * 24 * 60 * 60 * 1000),
    );
  });
  await page.goto("/");
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
}

test.describe("A Abertura — dissolve da PIN screen (Task 1)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
  });

  test("PIN correto: .pin-screen ganha .pin-dissolve antes de virar raio-x", async ({ page }) => {
    await mockPortfolio(page);
    await page.goto("/");
    await page.locator("input.pin-input").fill("123456");
    await page.locator("button.pin-submit").click();

    const pinScreen = page.locator(".pin-screen");
    await expect(pinScreen).toHaveClass(/pin-dissolve/);
    const duration = await pinScreen.evaluate(
      (el) => window.getComputedStyle(el).transitionDuration,
    );
    expect(duration).toContain("0.55s"); // --d3

    await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
  });

  test("prefers-reduced-motion: PIN vira raio-x sem .pin-dissolve (instantâneo)", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await comEspiaDeClasses(page);
    await page.addInitScript(() => localStorage.clear());
    await mockPortfolio(page);
    await page.goto("/");
    await page.locator("input.pin-input").fill("123456");
    await page.locator("button.pin-submit").click();
    await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });

    const adds: string[] = await page.evaluate(() => (window as any).__classAdds);
    expect(adds).not.toContain("pin-dissolve");
    await context.close();
  });
});

test.describe("A Abertura — reveal em stagger + 1×/sessão (Task 2)", () => {
  test("1ª abertura da sessão: stagger revela eyebrow→hero→7d→relcard nesta ordem, total < 800ms", async ({ page }) => {
    // MutationObserver dedicado por-grupo — registra ORDEM real (não posição
    // no array global, que mistura classes de todo o app) + timestamp, via
    // addInitScript (roda antes do Alpine montar qualquer coisa).
    await page.addInitScript(() => {
      (window as any).__revelacaoOrdem = [];
      const observarQuandoExistir = (selector: string, label: string) => {
        const tentar = () => {
          const el = document.querySelector(selector);
          if (!el) { requestAnimationFrame(tentar); return; }
          const obs = new MutationObserver(() => {
            if (el.classList.contains("abertura-reveal-in")) {
              (window as any).__revelacaoOrdem.push({ label, t: performance.now() });
              obs.disconnect();
            }
          });
          obs.observe(el, { attributes: true, attributeFilter: ["class"] });
        };
        tentar();
      };
      observarQuandoExistir(".raiox > .eyebrow", "eyebrow");
      observarQuandoExistir("#hero", "hero");
      observarQuandoExistir(".raiox-7d", "7d");
      observarQuandoExistir(".rel-card-home", "relcard");
    });
    await autoResumir(page);

    await expect
      .poll(async () => (await page.evaluate(() => (window as any).__revelacaoOrdem.length)), {
        timeout: 3000,
      })
      .toBe(4);

    const ordem: { label: string; t: number }[] = await page.evaluate(
      () => (window as any).__revelacaoOrdem,
    );
    expect(ordem.map((o) => o.label)).toEqual(["eyebrow", "hero", "7d", "relcard"]);
    expect(ordem[3].t - ordem[0].t).toBeLessThan(800);
  });

  test("aberturaFeita já setado (sessão): home aparece direta, sem reveal em stagger", async ({ page }) => {
    await comEspiaDeClasses(page);
    await mockPortfolio(page);
    await page.addInitScript(() => {
      sessionStorage.setItem("aberturaFeita", "1");
      localStorage.setItem("pin", "123456");
      localStorage.setItem(
        "pinTimestamp",
        String(Date.now() - 1 * 24 * 60 * 60 * 1000),
      );
    });
    await page.goto("/");
    await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
    // Folga generosa (> maior delay do stagger, 550ms) pra provar ausência
    // mesmo esperando — não corremos contra o relógio pra PASSAR, só damos
    // tempo de sobra pra pegar qualquer ocorrência tardia.
    await page.waitForTimeout(700);

    const adds: string[] = await page.evaluate(() => (window as any).__classAdds);
    expect(adds).not.toContain("abertura-reveal");
    expect(adds).not.toContain("abertura-reveal-in");
  });

  test("window.aberturaMotion expõe o contrato de timing (ground-truth, espelha drarthurNav.motion)", async ({ page }) => {
    await autoResumir(page);
    const motion = await page.evaluate(() => (window as any).aberturaMotion);
    expect(motion.dissolveMs).toBe(550);
    expect(motion.dissolveRemoveMs).toBe(620);
    expect(motion.staggerMs).toEqual([100, 250, 400, 550]);
    expect(motion.breatheMs).toBe(980);
  });
});

test.describe("A Abertura — delta pill respira + reduced-motion (Task 3)", () => {
  test("hero-delta ganha .abertura-breathe ao fim — ciclo único, não-loop", async ({ page }) => {
    // A janela em que a classe fica presente é curta (~550ms, --d3) e ocorre
    // ~980ms após o mount — tentar "flagrar" isso via polling externo
    // (toHaveClass com timeout) é uma corrida real: o backoff de polling do
    // Playwright pode saltar exatamente por cima da janela e nunca amostrar
    // o estado transiente (não-flaky no sentido de "às vezes falha" — é
    // deterministicamente ruim quando a janela cai entre duas amostras).
    // Em vez disso, um MutationObserver DENTRO da página captura o ciclo
    // completo (add → computed style → remove) e só then expomos o
    // ESTADO FINAL estável (never muda depois) — sem corrida nenhuma.
    await page.addInitScript(() => {
      (window as any).__breathe = null;
      const tentar = () => {
        const el = document.querySelector(".hero-delta");
        if (!el) { requestAnimationFrame(tentar); return; }
        const obs = new MutationObserver(() => {
          if (el.classList.contains("abertura-breathe")) {
            const cs = window.getComputedStyle(el);
            (window as any).__breathe = {
              added: true,
              removedAfter: false,
              iterationCount: cs.animationIterationCount,
              duration: cs.animationDuration,
            };
          } else if ((window as any).__breathe && (window as any).__breathe.added) {
            (window as any).__breathe.removedAfter = true;
          }
        });
        obs.observe(el, { attributes: true, attributeFilter: ["class"] });
      };
      tentar();
    });
    await autoResumir(page);

    // Espera o ciclo TERMINAR (add + remove já aconteceram) — condição
    // estável, não instante transiente.
    await expect
      .poll(async () => page.evaluate(() => (window as any).__breathe?.removedAfter === true), {
        timeout: 3000,
      })
      .toBe(true);

    const breathe = await page.evaluate(() => (window as any).__breathe);
    expect(breathe.added).toBe(true);
    // Ciclo ÚNICO (não-loop, anti-pattern #11) — animation-iteration-count
    // explicitamente 1, nunca "infinite".
    expect(breathe.iterationCount).toBe("1");
    expect(breathe.duration).toBe("0.55s"); // --d3
    expect(breathe.removedAfter).toBe(true);
  });

  test("prefers-reduced-motion: sem stagger, sem breathe — home pronta direto", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await comEspiaDeClasses(page);
    await mockPortfolio(page);
    await page.addInitScript(() => {
      localStorage.setItem("pin", "123456");
      localStorage.setItem(
        "pinTimestamp",
        String(Date.now() - 1 * 24 * 60 * 60 * 1000),
      );
    });
    await page.goto("/");
    await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1200); // > breatheMs (980ms) — janela generosa

    const adds: string[] = await page.evaluate(() => (window as any).__classAdds);
    expect(adds).not.toContain("abertura-reveal");
    expect(adds).not.toContain("abertura-reveal-in");
    expect(adds).not.toContain("abertura-breathe");

    // 1×/sessão continua valendo mesmo no caminho instantâneo (reduced).
    const flag = await page.evaluate(() => sessionStorage.getItem("aberturaFeita"));
    expect(flag).toBe("1");
    await context.close();
  });
});

test.describe("A Abertura — 1×/sessão robusto (CRB 7a.S.11)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
  });

  test("flag aberturaFeita é setada SÍNCRONO no entry (não após ~980ms) — re-lock não replica", async ({
    page,
  }) => {
    await autoResumir(page);
    // Logo após a home ficar visível (bem antes dos 980ms do breathe), a flag
    // já é "1" — set síncrono no entry. Com o bug antigo (set no setTimeout
    // final) estaria null aqui. Isso é o que impede o re-lock rápido de replicar.
    const flagEarly = await page.evaluate(() =>
      sessionStorage.getItem("aberturaFeita"),
    );
    expect(flagEarly).toBe("1");
  });

  test("deep-link numa sub-rota: cerimônia NÃO roda off-screen; toca 1× quando a home é 1º vista", async ({
    page,
  }) => {
    await comEspiaDeClasses(page);
    await mockPortfolio(page);
    await page.addInitScript(() => {
      localStorage.setItem("pin", "123456");
      localStorage.setItem(
        "pinTimestamp",
        String(Date.now() - 1 * 24 * 60 * 60 * 1000),
      );
    });
    // Sessão nasce numa SUB-ROTA (bookmark/deep-link), NÃO na home.
    await page.goto("/#rentabilidade");
    await expect(page.locator(".tela-rentabilidade")).toBeVisible({
      timeout: 10_000,
    });
    // Na sub-rota a cerimônia NÃO rodou off-screen + a flag NÃO foi setada.
    let adds: string[] = await page.evaluate(() => (window as any).__classAdds);
    expect(adds).not.toContain("abertura-reveal");
    let flag = await page.evaluate(() =>
      sessionStorage.getItem("aberturaFeita"),
    );
    expect(flag).toBeNull();
    // Usuário navega à HOME (tab Raio-X) → a cerimônia toca agora, ON-screen.
    await page.locator('a[data-tab="raiox"]').click();
    await expect(page.locator(".raiox")).toBeVisible();
    await page.waitForTimeout(700); // > último passo do stagger (550ms)
    adds = await page.evaluate(() => (window as any).__classAdds);
    expect(adds).toContain("abertura-reveal");
    expect(adds).toContain("abertura-reveal-in");
    flag = await page.evaluate(() => sessionStorage.getItem("aberturaFeita"));
    expect(flag).toBe("1");
  });

  // 7a.U Task 6 (CRB round 2, Finding 1): o teste acima ("flag ... re-lock não
  // replica") só prova o SET síncrono da flag — nunca aciona um lock de
  // verdade. `submitPin()` passou a chamar `atualizarRota()` ao promover a
  // fase (7a.U §4); na home (hash vazio) isso reagenda
  // `setTimeout(() => this.iniciarAbertura(), 0)` a CADA destrava, não só na
  // primeira. Este teste percorre o ciclo real do usuário — botão visível
  // `.btn-bloquear` (não `$data.bloquear()`, que pula a tela/rota real) →
  // PIN → home de novo — e prova que a 2ª passagem por `iniciarAbertura()`
  // não repete o reveal. Mesmo vocabulário do teste de deep-link acima
  // (`comEspiaDeClasses` + flag `aberturaFeita`), reusado aqui.
  test("re-lock via botão real: destravar na home NÃO repete a cerimônia (regressão 7a.U §4)", async ({ page }) => {
    await comEspiaDeClasses(page);
    await autoResumir(page); // 1ª abertura roda no boot (sessão pré-existente na home).
    await page.waitForTimeout(700); // > último passo do stagger — 1ª cerimônia termina.
    await page.evaluate(() => { (window as any).__classAdds = []; }); // espião limpo: só o RE-lock conta daqui.

    await page.getByRole("button", { name: /bloquear/i }).click();
    await expect(page.locator(".pin-screen")).toBeVisible();
    await page.locator("input.pin-input").fill("123456");
    await page.locator("button.pin-submit").click();
    await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(700); // folga > stagger inteiro, mesma margem dos testes acima.

    const adds: string[] = await page.evaluate(() => (window as any).__classAdds);
    expect(adds).not.toContain("abertura-reveal");
    expect(adds).not.toContain("abertura-reveal-in");
    // A flag segue "1" (nunca foi limpa pelo lock) — é ELA que barra o replay.
    const flag = await page.evaluate(() => sessionStorage.getItem("aberturaFeita"));
    expect(flag).toBe("1");
  });
});
