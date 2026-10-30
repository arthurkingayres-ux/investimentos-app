import { test, expect, Page } from "@playwright/test";
import { esperarResume } from "./esperar-resume";
import path from "path";
import fs from "fs";

// Fase 7a.BL.2 (Task 7) — no "quem pesou", o ativo que não está mais em
// `json.posicoes` ganha a etiqueta "saiu da carteira", sem mudar de grupo, de
// posição nem de valor. Fixtures sintéticas (repo público), geradas por
// gerar_portfolio_pesou_saiu em tests/fixtures/gerar_fixture.py:
//   portfolio_pesou_saiu.test.json.enc         — SINTE3, SINTG3 e SINTB3 fora de posicoes
//     (1º e 3º de "tiraram", 2º de "somaram": marcado no meio do grupo pega reordenação)
//   portfolio_pesou_sem_posicoes.test.json.enc — posicoes vazio (controle)
const FIXTURES = path.join(__dirname, "../fixtures");
const TELA = ".tela-rentabilidade";
const tid = (id: string) => `${TELA} [data-testid="${id}"]`;
const SAIUS = ["SINTE3", "SINTG3", "SINTB3"];
const SAIU = SAIUS[0];
const REBATE = "Rebates da corretora";
const ETIQUETA = "saiu da carteira";

let errosPagina: string[] = [];
test.beforeEach(async ({ page }) => {
  errosPagina = [];
  page.on("pageerror", (e) => errosPagina.push(e.message));
});

async function abrir(page: Page, fixture: string) {
  const corpo = fs.readFileSync(path.join(FIXTURES, fixture), "utf-8");
  await page.route("**/portfolio.json.enc", (route) =>
    route.fulfill({ status: 200, body: corpo, contentType: "text/plain" }),
  );
  await page.addInitScript(() => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem("pinTimestamp", String(Date.now() - 24 * 60 * 60 * 1000));
    localStorage.removeItem("moedaEUA");
  });
  await page.goto("/");
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
  await page.goto("/#rentabilidade");
  await esperarResume(page);
  await expect(page.locator(tid("rent2-frase"))).toBeVisible({ timeout: 10_000 });
}

async function escopo(page: Page, nome: "Total" | "Brasil" | "EUA") {
  await page.locator(`${TELA} button[data-escopo="${nome}"]`).click();
  await expect(page.locator(`${TELA} button[data-escopo="${nome}"].active`)).toBeVisible();
}

async function abrirLinha(page: Page, lid: string) {
  const linha = page.locator(`${tid("ponte-linha")}[data-linha="${lid}"]`);
  await linha.click();
  await expect(linha).toHaveAttribute("aria-pressed", "true");
}

// grupo, índice no grupo, ticker, valor, etiqueta — na ordem da tela
const itens = (page: Page) =>
  page.locator(tid("pesou-ativo")).evaluateAll((els) =>
    els.map((e) => {
      const g = e.closest('[data-testid="pesou-grupo"]')!;
      return {
        grupo: g.getAttribute("data-grupo"),
        i: Array.from(g.querySelectorAll('[data-testid="pesou-ativo"]')).indexOf(e),
        t: e.getAttribute("data-ticker"),
        valor: e.getAttribute("data-valor"),
        saiu: e.getAttribute("data-saiu"),
        texto: (e as HTMLElement).innerText,
      };
    }),
  );

test("o ativo fora de posicoes leva a etiqueta, no mesmo grupo, posição e valor do controle", async ({ page }) => {
  await abrir(page, "portfolio_pesou_sem_posicoes.test.json.enc");
  await escopo(page, "Brasil");
  await abrirLinha(page, "acoes_br");
  const controle = await itens(page);

  await page.unrouteAll();
  await abrir(page, "portfolio_pesou_saiu.test.json.enc");
  await escopo(page, "Brasil");
  await abrirLinha(page, "acoes_br");
  const com = await itens(page);

  expect(com.length).toBe(11);
  expect(com.map(({ grupo, i, t, valor }) => ({ grupo, i, t, valor }))).toEqual(
    controle.map(({ grupo, i, t, valor }) => ({ grupo, i, t, valor })),
  );
  // os marcados não estão todos no início dos grupos
  expect(com.filter((a) => SAIUS.includes(a.t!)).some((a) => a.i > 0)).toBe(true);
  for (const t of SAIUS) {
    const marcado = com.find((a) => a.t === t)!;
    expect(marcado.saiu, t).toBe("true");
    expect(marcado.texto, t).toContain(ETIQUETA);
  }
  // a etiqueta entra no nome acessível do item (nada de aria-hidden nela)
  const li = page.locator(`${tid("pesou-ativo")}[data-ticker="${SAIU}"]`);
  await expect(li.locator('[aria-hidden="true"]')).toHaveCount(0);
  // negativo: todo ativo presente em posicoes fica sem a etiqueta
  for (const a of com.filter((a) => !SAIUS.includes(a.t!))) {
    expect(a.saiu, a.t!).toBe("false");
    expect(a.texto, a.t!).not.toContain(ETIQUETA);
  }
  expect(errosPagina).toEqual([]);
});

test("posicoes vazio: ninguém é marcado, em nenhuma linha", async ({ page }) => {
  await abrir(page, "portfolio_pesou_sem_posicoes.test.json.enc");
  let vistos = 0;
  for (const esc of ["Brasil", "EUA"] as const) {
    await escopo(page, esc);
    const ids = await page.locator(tid("ponte-linha")).evaluateAll((els) => els.map((e) => e.getAttribute("data-linha")));
    for (const lid of ids) {
      await abrirLinha(page, lid!);
      const is = await itens(page);
      vistos += is.length;
      for (const a of is) {
        expect(a.saiu, a.t!).toBe("false");
        expect(a.texto, a.t!).not.toContain(ETIQUETA);
      }
    }
  }
  expect(vistos).toBeGreaterThan(11);
  expect(errosPagina).toEqual([]);
});

test("o rebate da corretora nunca recebe a etiqueta", async ({ page }) => {
  await abrir(page, "portfolio_pesou_saiu.test.json.enc");
  await escopo(page, "EUA");
  const ids = await page.locator(tid("ponte-linha")).evaluateAll((els) => els.map((e) => e.getAttribute("data-linha")));
  let achou = 0;
  for (const lid of ids) {
    await abrirLinha(page, lid!);
    for (const a of (await itens(page)).filter((a) => a.t === REBATE)) {
      achou++;
      expect(a.saiu).toBe("false");
      expect(a.texto).not.toContain(ETIQUETA);
    }
  }
  expect(achou).toBeGreaterThan(0);
  expect(errosPagina).toEqual([]);
});

test("rent2Pesou sem conjunto de posições (null/undefined) não marca ninguém", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => typeof (window as any).Alpine !== "undefined");
  const r = await page.evaluate(() => {
    const w = window as any;
    const rr = { linhas: [{ id: "acoes_br", indice: "IBOV" }], ativos: { acoes_br: [{ t: "SINTA3", contrib: -0.01 }] } };
    const marcados = (p: any) => p.grupos.flatMap((g: any) => g.itens).filter((i: any) => i.saiu).length;
    return {
      nulo: marcados(w.rent2Pesou(rr, "acoes_br", -1.0, "ao ano", null)),
      ausente: marcados(w.rent2Pesou(rr, "acoes_br", -1.0, "ao ano")),
      fora: marcados(w.rent2Pesou(rr, "acoes_br", -1.0, "ao ano", new Set(["SINTB3"]))),
    };
  });
  expect(r).toEqual({ nulo: 0, ausente: 0, fora: 1 });
  expect(errosPagina).toEqual([]);
});

test("a 320 px a linha marcada não transborda", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await abrir(page, "portfolio_pesou_saiu.test.json.enc");
  await escopo(page, "Brasil");
  await abrirLinha(page, "acoes_br");
  const li = page.locator(`${tid("pesou-ativo")}[data-ticker="${SAIU}"]`);
  await expect(li).toHaveAttribute("data-saiu", "true");
  const m = await li.evaluate((e) => {
    const valor = e.querySelector(".ponte-pesou-valor")!.getBoundingClientRect();
    const tk = e.querySelector(".ponte-pesou-ticker > span")!.getBoundingClientRect();
    const etq = e.querySelector(".ponte-pesou-saiu")!.getBoundingClientRect();
    return { sw: e.scrollWidth, cw: e.clientWidth, right: valor.right, tk, etq };
  });
  expect(m.sw).toBeLessThanOrEqual(m.cw);
  // a etiqueta desce para baixo do ticker, alinhada à esquerda com ele (sem recuo)
  expect(m.etq.top).toBeGreaterThanOrEqual(m.tk.bottom - 1);
  expect(Math.abs(m.etq.left - m.tk.left)).toBeLessThanOrEqual(1);
  expect(m.right).toBeLessThanOrEqual(320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  expect(errosPagina).toEqual([]);
});

test("a 375 px a etiqueta cabe na linha do ticker e nada transborda", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await abrir(page, "portfolio_pesou_saiu.test.json.enc");
  await escopo(page, "Brasil");
  await abrirLinha(page, "acoes_br");
  for (const t of SAIUS) {
    const li = page.locator(`${tid("pesou-ativo")}[data-ticker="${t}"]`);
    await expect(li).toHaveAttribute("data-saiu", "true");
    const m = await li.evaluate((e) => {
      const tk = e.querySelector(".ponte-pesou-ticker > span")!.getBoundingClientRect();
      const etq = e.querySelector(".ponte-pesou-saiu")!.getBoundingClientRect();
      const valor = e.querySelector(".ponte-pesou-valor")!.getBoundingClientRect();
      return { sw: e.scrollWidth, cw: e.clientWidth, tk, etq, valor };
    });
    expect(m.sw, t).toBeLessThanOrEqual(m.cw);
    // mesma linha: a etiqueta começa antes de o ticker terminar verticalmente
    expect(m.etq.top, t).toBeLessThan(m.tk.bottom);
    expect(m.etq.left, t).toBeGreaterThan(m.tk.right);
    expect(m.etq.right, t).toBeLessThan(m.valor.left);
  }
  expect(errosPagina).toEqual([]);
});
