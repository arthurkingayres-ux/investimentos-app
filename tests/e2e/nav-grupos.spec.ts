import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";
import { abrirOlho } from "./olho-comum";

// Fase 7a.CC.1 — navegação em dois níveis: cinco grupos na barra de baixo e,
// no topo, o cabeçalho do grupo com a faixa das telas dele. Fixtures: as
// sintéticas que a suíte já usa (repo público), nenhuma nova.

const F = (n: string) => fs.readFileSync(path.join(__dirname, "../fixtures/" + n), "utf-8");
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
const MAPA: Record<string, string> = JSON.parse(F("dossies_map.test.json"));

test.use({ viewport: { width: 390, height: 844 } });

async function mockTudo(page: Page, portfolio = PORTFOLIO) {
  await page.route("**/portfolio.json.enc", (r) =>
    r.fulfill({ status: 200, body: portfolio, contentType: "text/plain" }));
  await page.route("**/relatorios_index.json.enc", (r) =>
    r.fulfill({ status: 200, body: IDX_REL, contentType: "text/plain" }));
  await page.route("**/relatorio_*.json.enc", (r) =>
    r.fulfill({ status: 200, body: MAIO, contentType: "text/plain" }));
  await page.route("**/dossies_index.json.enc", (r) =>
    r.fulfill({ status: 200, body: IDX_DOSSIES, contentType: "text/plain" }));
  await page.route("**/d_*.json.enc", (r) => {
    const nome = r.request().url().split("/").pop()!.split("?")[0];
    const body = MAPA[nome] && DOSSIES[MAPA[nome]];
    return body
      ? r.fulfill({ status: 200, body, contentType: "text/plain" })
      : r.fulfill({ status: 404, body: "", contentType: "text/plain" });
  });
}

// `hash` é a PRIMEIRA navegação da página (deep link de verdade): um
// `page.goto('/#x')` depois do app carregado seria navegação no mesmo
// documento, com o estado da sessão sobrevivendo.
async function entrar(page: Page, hash = "", o: { tema?: "dark"; portfolio?: string } = {}) {
  await mockTudo(page, o.portfolio);
  await page.addInitScript((tema) => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem("pinTimestamp", String(Date.now() - 86_400_000));
    if (tema) localStorage.setItem("tema", tema);
  }, o.tema ?? null);
  await page.goto("/" + hash);
  await expect(page.locator(".tab-bar")).toBeVisible({ timeout: 10_000 });
}

// Navegação no mesmo documento, como um <a href> faria.
async function irPara(page: Page, hash: string) {
  await page.evaluate((h) => { location.hash = h; }, hash);
}

const barraAtiva = (page: Page) => page.locator('.tab-bar [aria-current="page"]');
const faixaAtiva = (page: Page) => page.locator('.grupo-cab nav [aria-current="page"]');

// §3 da spec, com o grupo e o item da faixa do §5.1 (CC.1: sem telas novas).
const MEMBROS: [string, string, string][] = [
  ["", "raiox", "Hoje"],
  ["#/raiox/chart", "raiox", "Histórico"],
  ["#/raiox/reserva", "raiox", "Reserva"],
  ["#patrimonio", "raiox", "Histórico"],
  ["#rentabilidade", "retorno", "Rentabilidade"],
  ["#proventos", "retorno", "Proventos"],
  ["#/proventos/dy", "retorno", "DY"],
  ["#/raiox/renda", "retorno", "Renda"],
  ["#alocacao", "carteira", "Alocação"],
  ["#/carteira/ativos", "carteira", "Ativos"],
  ["#politica", "carteira", "Alocação"],
  ["#olho", "carteira", "Vigília"],
  ["#/raiox/diagnostico", "analise", "Diagnóstico"],
  ["#/raiox/projecao", "analise", "Projeção"],
  ["#/raiox/relatorio", "analise", "Relatório"],
  ["#/raiox/relatorio/2026-05", "analise", "Relatório"],
  ["#aportar", "aportar", "Sugestão"],
  ["#comite", "aportar", "Comitê"],
];

// Push aberto direto (sem origem): ativo/dossiê acendem a Carteira (o "←"
// leva a Carteira › Ativos, regra da CC.2), capítulos do Diagnóstico acendem a
// Análise.
const PUSHES: [string, string][] = [
  ["#ativo/HGLG11", "carteira"],
  ["#/dossie/HGLG11", "carteira"],
  ["#/raiox/diagnostico/risco", "analise"],
  ["#/raiox/diagnostico/politica", "analise"],
  ["#/raiox/diagnostico/selecao", "analise"],
  ["#/raiox/diagnostico/aportes", "analise"],
  ["#/raiox/diagnostico/construcao", "analise"],
];

test.describe("7a.CC.1 — mapa hash → grupo/tela (barra)", () => {
  for (const [hash, grupo] of MEMBROS) {
    test(`membro ${hash || "#"} acende o grupo ${grupo}`, async ({ page }) => {
      await entrar(page, hash);
      await expect(barraAtiva(page)).toHaveCount(1);
      await expect(barraAtiva(page)).toHaveAttribute("data-tab", grupo);
    });
  }
  for (const [hash, grupo] of PUSHES) {
    test(`push ${hash} sem origem acende o grupo ${grupo}`, async ({ page }) => {
      await entrar(page, hash);
      await expect(barraAtiva(page)).toHaveCount(1);
      await expect(barraAtiva(page)).toHaveAttribute("data-tab", grupo);
    });
  }
});

test.describe("7a.CC.1 — mapa hash → grupo/tela (faixa)", () => {
  for (const [hash, grupo, rotulo] of MEMBROS) {
    test(`membro ${hash || "#"} acende ${rotulo} na faixa`, async ({ page }) => {
      await entrar(page, hash);
      await expect(page.locator(".grupo-cab")).toBeVisible();
      await expect(faixaAtiva(page)).toHaveCount(1);
      await expect(faixaAtiva(page)).toHaveText(rotulo);
      await expect(barraAtiva(page)).toHaveAttribute("data-tab", grupo);
    });
  }
  for (const [hash] of PUSHES) {
    test(`push ${hash} não mostra cabeçalho de grupo`, async ({ page }) => {
      await entrar(page, hash);
      await expect(page.locator(".grupo-cab")).toBeHidden();
    });
  }
});

// ── CC1.2: barra, cabeçalho de grupo, faixa ────────────────────────────────

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
];

async function abrirMembro(page: Page, hash: string, rotulo: string) {
  if (hash === "") await page.locator('.tab-bar a[data-tab="raiox"]').click();
  else await irPara(page, hash);
  await expect(faixaAtiva(page)).toHaveText(rotulo);
}

test.describe("7a.CC.1 — faixa", () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.width}×${vp.height}: sem rolagem lateral, tela ativa inteira na faixa, alvos ≥ 44px`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize(vp);
      await entrar(page);
      for (const [hash, , rotulo] of MEMBROS) {
        await abrirMembro(page, hash, rotulo);
        const doc = await page.evaluate(() => ({
          sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        expect(doc.sw, `rolagem lateral em ${hash || "#"}`).toBe(doc.cw);
        // A faixa rola sozinha até a tela ativa (Retorno › Renda em 320px).
        await expect.poll(() => page.evaluate(() => {
          const nav = document.querySelector(".grupo-cab nav")!.getBoundingClientRect();
          const a = document.querySelector('.grupo-cab nav [aria-current="page"]')!.getBoundingClientRect();
          return a.left >= nav.left - 0.5 && a.right <= nav.right + 0.5;
        }), `item ativo fora da faixa em ${hash || "#"}`).toBe(true);
        const alturas = await page.locator(".grupo-cab nav a, .tab-bar a").evaluateAll(
          (els) => els.map((e) => e.getBoundingClientRect().height));
        expect(Math.min(...alturas)).toBeGreaterThanOrEqual(44);
        await expect(page.locator('.tab-bar [aria-current="page"]')).toHaveCount(1);
        await expect(page.locator('.grupo-cab nav [aria-current="page"]')).toHaveCount(1);
      }
    });
  }
});

test.describe("7a.CC.1 — rótulos", () => {
  test("barra com os cinco grupos e faixa de Retorno com as quatro telas", async ({ page }) => {
    await entrar(page, "#rentabilidade");
    await expect(page.locator(".tab-bar a")).toHaveText(["Raio-X", "Retorno", "Carteira", "Análise", "Aportar"]);
    await expect(page.locator(".grupo-cab nav a")).toHaveText(["Rentabilidade", "Proventos", "DY", "Renda"]);
    await expect(page.locator(".grupo-cab nav")).toHaveAttribute("aria-label", "Telas de Retorno");
    await expect(page.locator(".tab-bar")).toHaveAttribute("aria-label", "Navegação principal");
    // Links reais (deep link preservado).
    const hrefs = await page.locator(".grupo-cab nav a").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    expect(hrefs).toEqual(["#rentabilidade", "#proventos", "#/proventos/dy", "#/raiox/renda"]);
  });

  test("faixa de Carteira: Alocação, Ativos, Vigília, com links reais", async ({ page }) => {
    await entrar(page, "#alocacao");
    await expect(page.locator(".grupo-cab nav a")).toHaveText(["Alocação", "Ativos", "Vigília"]);
    await expect(page.locator(".grupo-cab nav")).toHaveAttribute("aria-label", "Telas de Carteira");
    const hrefs = await page.locator(".grupo-cab nav a").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    expect(hrefs).toEqual(["#alocacao", "#/carteira/ativos", "#olho"]);
  });
});

test.describe("7a.CC.1 — sem ← em tela-membro", () => {
  test("nenhuma tela-membro mostra Voltar; toda tela de push mostra", async ({ page }) => {
    test.setTimeout(90_000);
    await entrar(page);
    const voltar = page.getByRole("button", { name: /^Voltar/ });
    for (const [hash, , rotulo] of MEMBROS) {
      await abrirMembro(page, hash, rotulo);
      await expect(voltar, `Voltar visível em ${hash || "#"}`).toHaveCount(0);
    }
    for (const [hash] of PUSHES) {
      await irPara(page, hash);
      await expect(page.locator(".grupo-cab")).toBeHidden();
      // toHaveCount espera a tela anterior sair (a saída de um push dura um quadro).
      await expect(voltar, `Voltar ausente em ${hash}`).toHaveCount(1);
      await expect(voltar).toBeVisible();
    }
  });
});

test.describe("7a.CC.1 — faixa estável sem dado", () => {
  test("payload sem renda: a faixa lista Renda e a tela mostra o placeholder", async ({ page }) => {
    await entrar(page, "", { portfolio: F("portfolio_renda_null.test.json.enc") });
    await irPara(page, "#/raiox/renda");
    await expect(page.locator(".grupo-cab nav a")).toHaveText(["Rentabilidade", "Proventos", "DY", "Renda"]);
    await expect(faixaAtiva(page)).toHaveText("Renda");
    await expect(page.locator(".tela-renda")).toContainText("Renda indisponível hoje.");
  });
});

// Luminância relativa WCAG; fundos translúcidos compostos à mão, camada a
// camada, no PIOR caso: o cabeçalho é translúcido (--tab-bg + blur), então o
// que rola por baixo dele conta. Compõe sobre preto e sobre --g-900 (o hero
// escuro) e devolve a MENOR razão: com a pílula opaca o que está por baixo
// deixa de importar; se ela voltar a ser translúcida, o teste cai.
const CONTRASTE_PILULA = `(() => {
  const rgba = (s) => { const n = (s.match(/[\\d.]+/g) || []).map(Number); return [n[0], n[1], n[2], n.length > 3 ? n[3] : 1]; };
  const sobre = (cima, baixo) => [0, 1, 2].map((i) => cima[i] * cima[3] + baixo[i] * (1 - cima[3])).concat(1);
  const lum = (c) => { const [r, g, b] = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const item = document.querySelector('.grupo-cab nav [aria-current="page"]');
  const est = getComputedStyle(item);
  const cab = rgba(getComputedStyle(document.querySelector('.grupo-cab')).backgroundColor);
  const g900 = rgba(getComputedStyle(document.documentElement).getPropertyValue('--g-900').trim().replace(/^#(..)(..)(..)$/, (_, r, g, b) => 'rgb(' + parseInt(r, 16) + ',' + parseInt(g, 16) + ',' + parseInt(b, 16) + ')'));
  const camadas = (est.backgroundImage.match(/rgba?\\([^)]*\\)/g) || []).map(rgba);
  const texto = rgba(est.color);
  const razoes = [[0, 0, 0, 1], g900].map((baixo) => {
    let fundo = sobre(rgba(est.backgroundColor), sobre(cab, baixo));
    for (const c of camadas.slice(0, 1)) fundo = sobre(c, fundo);
    const l1 = lum(texto) + 0.05, l2 = lum(fundo) + 0.05;
    return Math.max(l1, l2) / Math.min(l1, l2);
  });
  return { razao: Math.min(...razoes), temTinta: camadas.length > 0 || rgba(est.backgroundColor)[3] > 0 };
})()`;

test.describe("7a.CC.1 — contraste da pílula", () => {
  for (const tema of ["claro", "plantão"] as const) {
    test(`texto ativo sobre a pílula fecha 4,5:1 no tema ${tema}, com qualquer coisa rolando por baixo`, async ({ page }) => {
      await entrar(page, "#rentabilidade", tema === "plantão" ? { tema: "dark" } : {});
      await expect(page.locator("html")).toHaveAttribute("data-theme", tema === "plantão" ? "dark" : "light");
      const r = (await page.evaluate(CONTRASTE_PILULA)) as { razao: number; temTinta: boolean };
      expect(r.temTinta, "a pílula precisa ter fundo").toBe(true);
      expect(r.razao).toBeGreaterThanOrEqual(4.5);
    });
  }
});

test.describe("7a.CC.1 — âncora sob o cabeçalho fixo", () => {
  test("alvo de âncora em tela-membro para abaixo do cabeçalho de grupo", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await entrar(page, "#/raiox/projecao");
    await expect(page.locator("#proj-cap-3")).toBeAttached();
    // O app não tem âncora interna hoje; o salto é o do navegador para um id.
    await page.evaluate(() => document.getElementById("proj-cap-3")!.scrollIntoView({ block: "start" }));
    const medir = () => page.evaluate(() => ({
      alvo: document.getElementById("proj-cap-3")!.getBoundingClientRect().top,
      cab: document.querySelector(".grupo-cab")!.getBoundingClientRect().bottom,
      rolou: window.scrollY,
    }));
    // A rolagem assenta: o alvo para logo abaixo do cabeçalho (scroll-margin =
    // cabeçalho + 8px), não no fim da página por falta de conteúdo.
    await expect.poll(async () => {
      const r = await medir();
      return r.rolou > 0 && r.alvo >= r.cab && r.alvo <= r.cab + 8 + 2;
    }).toBe(true);
  });

  test("em tela de push, sem cabeçalho de grupo, a margem de âncora não o desconta", async ({ page }) => {
    await entrar(page, "#rentabilidade");
    const margem = () => page.evaluate(() => parseFloat(getComputedStyle(document.getElementById("hero")!).scrollMarginTop));
    await expect.poll(margem).toBeGreaterThan(40); // controle: membro desconta o cabeçalho
    await irPara(page, "#ativo/HGLG11");
    await expect(page.locator(".tela-ativo")).toBeVisible();
    await expect.poll(margem).toBeLessThanOrEqual(8);
  });
});

// ── CC1.3: voltar por origem e memória de grupo ────────────────────────────

const botaoVoltar = (page: Page) => page.getByRole("button", { name: /^Voltar/ });
const hashAgora = (page: Page) => page.evaluate(() => location.hash);
const tocarGrupo = (page: Page, id: string) => page.locator(`.tab-bar a[data-tab="${id}"]`).click();
const tocarTela = (page: Page, rotulo: string) =>
  page.locator(".grupo-cab nav a", { hasText: new RegExp("^" + rotulo + "$") }).click();

// Abre a categoria que contém o link do ativo e toca nele (link real da lista).
async function abrirAtivoDaAlocacao(page: Page, ticker: string) {
  await irPara(page, "#alocacao");
  await expect(page.locator(".tela-alocacao")).toBeVisible();
  const link = page.locator(`.tela-alocacao a[href="#ativo/${ticker}"]`).first();
  const cabecas = page.locator(".tela-alocacao .aloca-cat__head");
  for (let i = 0; i < (await cabecas.count()) && !(await link.isVisible()); i++) {
    await cabecas.nth(i).click();
  }
  await link.click();
  await expect(page.locator(".tela-ativo")).toBeVisible();
}

test.describe("7a.CC.1 — voltar por origem", () => {
  test("ativo aberto da Alocação volta à Alocação, com Carteira acesa", async ({ page }) => {
    await entrar(page);
    await abrirAtivoDaAlocacao(page, "VOO");
    await expect(barraAtiva(page)).toHaveAttribute("data-tab", "carteira");
    await botaoVoltar(page).click();
    expect(await hashAgora(page)).toBe("#alocacao");
    await expect(page.locator(".tela-alocacao")).toBeVisible();
    await expect(barraAtiva(page)).toHaveAttribute("data-tab", "carteira");
  });

  test("ativo aberto de Proventos volta a Proventos, com Retorno aceso", async ({ page }) => {
    await entrar(page);
    await irPara(page, "#proventos");
    await page.locator(".tela-proventos .row-link").first().click();
    await expect(page.locator(".tela-ativo")).toBeVisible();
    await botaoVoltar(page).click();
    expect(await hashAgora(page)).toBe("#proventos");
    await expect(barraAtiva(page)).toHaveAttribute("data-tab", "retorno");
  });

  test("ativo aberto do Aportar volta ao Aportar, com Aportar aceso", async ({ page }) => {
    // A tela do Aportar não tem link de ativo hoje: a navegação é a mesma
    // troca de hash que um <a href> faria, a partir dela.
    await entrar(page);
    await irPara(page, "#aportar");
    await expect(page.locator(".tela-aportar")).toBeVisible();
    await irPara(page, "#ativo/HGLG11");
    await expect(page.locator(".tela-ativo")).toBeVisible();
    await expect(barraAtiva(page)).toHaveAttribute("data-tab", "aportar");
    await botaoVoltar(page).click();
    expect(await hashAgora(page)).toBe("#aportar");
    await expect(barraAtiva(page)).toHaveAttribute("data-tab", "aportar");
  });

  test("ativo aberto do Hoje (último aporte) volta ao Hoje, com Raio-X aceso", async ({ page }) => {
    await entrar(page);
    await irPara(page, "#rentabilidade"); // grupo aceso antes não é o Raio-X
    await tocarGrupo(page, "raiox");
    await page.locator(".aporte-item-link").first().click();
    await expect(page.locator(".tela-ativo")).toBeVisible();
    await botaoVoltar(page).click();
    expect(await hashAgora(page)).toBe("");
    await expect(page.locator(".raiox")).toBeVisible();
    await expect(barraAtiva(page)).toHaveAttribute("data-tab", "raiox");
  });

  test("voltar atravessa o dossiê: Alocação → ativo → dossiê → ← → Alocação", async ({ page }) => {
    // Na fixture, o ativo com dossiê (HGLG11) não está na lista da Alocação:
    // a entrada no ativo é a troca de hash que o link faria; o dossiê, o link real.
    await entrar(page);
    await irPara(page, "#alocacao");
    await expect(page.locator(".tela-alocacao")).toBeVisible();
    await irPara(page, "#ativo/HGLG11");
    await page.locator(".tela-ativo .dossie-entrada").click();
    await expect(page.locator(".tela-dossie .dossie-corpo")).toBeVisible();
    await expect(barraAtiva(page)).toHaveAttribute("data-tab", "carteira");
    await botaoVoltar(page).click();
    expect(await hashAgora(page)).toBe("#alocacao");
    await expect(barraAtiva(page)).toHaveAttribute("data-tab", "carteira");
  });

  test("Relatório → dossiê → ← volta ao Relatório", async ({ page }) => {
    await entrar(page, "#/raiox/relatorio");
    await expect(page.locator(".tela-relatorio .rel-corpo")).toBeVisible();
    await page.locator(".rel-radar-card__ticker--link").first().click();
    await expect(page.locator(".tela-dossie .dossie-corpo")).toBeVisible();
    await botaoVoltar(page).click();
    expect(await hashAgora(page)).toBe("#/raiox/relatorio");
    await expect(barraAtiva(page)).toHaveAttribute("data-tab", "analise");
  });
});

test.describe("7a.CC.2 — deep link sem origem (regra definitiva)", () => {
  test("#ativo direto: ← cai em Carteira › Ativos, com Carteira acesa", async ({ page }) => {
    await entrar(page, "#ativo/HGLG11");
    await expect(page.locator(".tela-ativo")).toBeVisible();
    await expect(barraAtiva(page)).toHaveAttribute("data-tab", "carteira");
    await botaoVoltar(page).click();
    expect(await hashAgora(page)).toBe("#/carteira/ativos");
    await expect(page.locator(".tela-ativos")).toBeVisible();
    await expect(barraAtiva(page)).toHaveAttribute("data-tab", "carteira");
    await expect(faixaAtiva(page)).toHaveText("Ativos");
  });

  test("#/dossie direto: ← cai em Carteira › Ativos, com Carteira acesa", async ({ page }) => {
    await entrar(page, "#/dossie/HGLG11");
    await expect(page.locator(".tela-dossie .dossie-corpo")).toBeVisible();
    await expect(barraAtiva(page)).toHaveAttribute("data-tab", "carteira");
    await botaoVoltar(page).click();
    expect(await hashAgora(page)).toBe("#/carteira/ativos");
    await expect(page.locator(".tela-ativos")).toBeVisible();
    await expect(barraAtiva(page)).toHaveAttribute("data-tab", "carteira");
  });
});

test.describe("7a.CC.1 — memória de grupo", () => {
  test("Retorno › Renda → Carteira → Retorno cai em Renda; Retorno de novo, em Rentabilidade", async ({ page }) => {
    await entrar(page);
    await tocarGrupo(page, "retorno");
    expect(await hashAgora(page)).toBe("#rentabilidade");
    await tocarTela(page, "Renda");
    expect(await hashAgora(page)).toBe("#/raiox/renda");
    await tocarGrupo(page, "carteira");
    expect(await hashAgora(page)).toBe("#alocacao");
    await tocarGrupo(page, "retorno");
    expect(await hashAgora(page)).toBe("#/raiox/renda");
    await expect(faixaAtiva(page)).toHaveText("Renda");
    await tocarGrupo(page, "retorno");
    expect(await hashAgora(page)).toBe("#rentabilidade");
    await expect(faixaAtiva(page)).toHaveText("Rentabilidade");
  });

  test("tocar o grupo aceso durante um push leva à primeira tela dele", async ({ page }) => {
    await entrar(page);
    await irPara(page, "#/raiox/renda");
    await expect(faixaAtiva(page)).toHaveText("Renda");
    await irPara(page, "#ativo/HGLG11");
    await expect(page.locator(".tela-ativo")).toBeVisible();
    await expect(barraAtiva(page)).toHaveAttribute("data-tab", "retorno");
    await tocarGrupo(page, "retorno");
    expect(await hashAgora(page)).toBe("#rentabilidade");
    await expect(faixaAtiva(page)).toHaveText("Rentabilidade");
  });

  test("push não entra na memória: Vigília → dossiê → Retorno → Carteira cai na Vigília", async ({ page }) => {
    await abrirOlho(page);
    await tocarGrupo(page, "carteira");
    await tocarTela(page, "Vigília");
    expect(await hashAgora(page)).toBe("#olho");
    await page.locator(".olho-alerta__ticker").first().click();
    await expect(page.locator(".tela-dossie")).toBeVisible();
    expect(await hashAgora(page)).toMatch(/^#\/dossie\//);
    await tocarGrupo(page, "retorno");
    expect(await hashAgora(page)).toBe("#rentabilidade");
    await tocarGrupo(page, "carteira");
    expect(await hashAgora(page)).toBe("#olho");
    await expect(faixaAtiva(page)).toHaveText("Vigília");
  });

  test("lock zera a memória e a origem: depois de destravar, Retorno cai em Rentabilidade", async ({ page }) => {
    await entrar(page);
    await tocarGrupo(page, "retorno");
    await tocarTela(page, "Renda");
    await expect(faixaAtiva(page)).toHaveText("Renda");
    await abrirAtivoDaAlocacao(page, "VOO");
    const antes = await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      return { memoria: { ...d.ultimaTelaDoGrupo }, origem: d.origemContexto };
    });
    expect(antes.memoria.retorno).toBe("#/raiox/renda");
    expect(antes.origem).toBe("#alocacao");
    await page.evaluate(() => (window as any).Alpine.$data(document.body).bloquear());
    await expect(page.locator(".pin-screen")).toBeVisible();
    const travado = await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      return { memoria: { ...d.ultimaTelaDoGrupo }, origem: d.origemContexto, ultima: d.ultimaTelaMembro };
    });
    expect(travado).toEqual({ memoria: {}, origem: "", ultima: "" });
    await page.locator("input.pin-input").fill("123456");
    await page.locator("button.pin-submit").click();
    await expect(page.locator(".tab-bar")).toBeVisible({ timeout: 10_000 });
    await tocarGrupo(page, "retorno");
    expect(await hashAgora(page)).toBe("#rentabilidade");
  });
});

test.describe("7a.CC.2 — Raio-X › Reserva", () => {
  test("o Hoje não carrega reserva nem conferência; a faixa do Raio-X tem a Reserva", async ({ page }) => {
    await entrar(page);
    await expect(page.locator(".grupo-cab nav a")).toHaveText(["Hoje", "Histórico", "Reserva"]);
    await expect(page.locator(".raiox")).toBeVisible();
    await expect(page.locator('.raiox [data-testid="reserva"]')).toHaveCount(0);
    await expect(page.locator('.raiox [data-testid="conferencia"]')).toHaveCount(0);
  });
  test("#/raiox/reserva mostra a tela com a seção da reserva", async ({ page }) => {
    await entrar(page, "#/raiox/reserva");
    await expect(page.locator(".tela-reserva")).toBeVisible();
    await expect(page.locator('.tela-reserva [data-testid="reserva"]')).toHaveCount(1);
    await expect(page.locator(".tela-reserva h1.sr-only")).toHaveText("Reserva");
  });
});
