import { expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";
import { cifrar, decifrar } from "./comite-comum";

// 7a.BX.4: apoio comum dos testes do Olho. O payload em claro é a fixture
// SINTÉTICA tests/fixtures/olho.sintetico.json (repo público: tickers EMPR3,
// FUND11 e vizinhos inventados, URLs em exemplo.invalid), cifrada na hora com o
// segredo de teste. O Worker é falso: page.route("**/olho").

const F = (n: string) => fs.readFileSync(path.join(__dirname, "../fixtures/" + n), "utf-8");
const PORTFOLIO = F("portfolio.test.json.enc");
const IDX_REL = F("relatorios_index.test.json.enc");
const IDX_DOSSIES_CLARO = decifrar(F("dossies_index.test.json.enc"));
const SMAL11 = F("dossie_SMAL11.test.json.enc");

function isoDiasAtras(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const z = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

export const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

// A fixture com a última rodada há 2 dias (vigília em dia); `mudar` ajusta o resto.
export function payload(mudar?: (p: any) => void): any {
  const p = JSON.parse(F("olho.sintetico.json"));
  const rodada = isoDiasAtras(2);
  p.ultima_rodada.data = rodada;
  p.primeira_rodada = isoDiasAtras(9);
  for (const a of p.alertas) a.data_rodada = rodada;
  if (mudar) mudar(p);
  return p;
}

export { isoDiasAtras };

// Dossiê sintético mínimo (schema dossie_empresa_v1) de uma empresa vigiada.
function dossie(ticker: string, categoria: string): any {
  return {
    schema: "dossie_empresa_v1",
    ticker,
    nome: "Empresa de Exemplo " + ticker,
    escopo: "Brasil",
    categoria,
    ri_portal_url: null,
    aberto_em: "2026-01-02",
    tese: {
      resumo: "Tese sintética de exemplo.",
      quebra_se: "Margem abaixo de 20% por dois trimestres seguidos.",
      revisada_em: null,
    },
    ultima_verificacao_leve: null,
    timeline: [],
  };
}

const SINTETICOS: Record<string, any> = {
  "d_olho_empr3.json.enc": dossie("EMPR3", "Ação BR"),
  "d_olho_fund11.json.enc": dossie("FUND11", "FII"),
};

export type AbrirOlho = {
  payload?: any | null; // null = KV sem a chave (cifra null)
  status?: number; // status HTTP de GET /olho (padrão 200)
  doCache?: boolean; // resposta com `x-olho-cache: 1` (cópia do service worker)
  gravadaEm?: string;
  tema?: "dark" | null;
  hash?: string;
  erros?: string[];
  pedidos?: string[]; // recebe a URL de cada GET /olho
};

export async function abrirOlho(page: Page, o: AbrirOlho = {}) {
  await page.route("**/portfolio.json.enc", (r) => r.fulfill({ status: 200, body: PORTFOLIO, contentType: "text/plain" }));
  await page.route("**/relatorios_index.json.enc", (r) => r.fulfill({ status: 200, body: IDX_REL, contentType: "text/plain" }));
  const idx = JSON.parse(JSON.stringify(IDX_DOSSIES_CLARO));
  idx.dossies.push(
    { ticker: "EMPR3", nome: "Empresa de Exemplo EMPR3", categoria: "Ação BR", escopo: "Brasil", arquivo: "d_olho_empr3.json.enc", sha256: "x" },
    { ticker: "FUND11", nome: "FUND11", categoria: "FII", escopo: "Brasil", arquivo: "d_olho_fund11.json.enc", sha256: "x" },
  );
  const idxCifrado = cifrar(JSON.stringify(idx));
  await page.route("**/dossies_index.json.enc", (r) => r.fulfill({ status: 200, body: idxCifrado, contentType: "text/plain" }));
  const cifrados: Record<string, string> = {};
  await page.route("**/d_*.json.enc", (r) => {
    const nome = r.request().url().split("/").pop()!.split("?")[0];
    if (SINTETICOS[nome]) {
      cifrados[nome] ??= cifrar(JSON.stringify(SINTETICOS[nome]));
      return r.fulfill({ status: 200, body: cifrados[nome], contentType: "text/plain" });
    }
    // SMAL11 (ETF da fixture da suíte) fica fora da vigília.
    if (nome === "d_994811e40d13819a.json.enc") return r.fulfill({ status: 200, body: SMAL11, contentType: "text/plain" });
    return r.fulfill({ status: 404, body: "", contentType: "text/plain" });
  });
  const p = o.payload === undefined ? payload() : o.payload;
  const corpo = p
    ? { cifra: cifrar(JSON.stringify(p)), gravada_em: o.gravadaEm ?? new Date().toISOString() }
    : { cifra: null, gravada_em: null };
  await page.route("**/olho", (route) => {
    o.pedidos?.push(route.request().url());
    return route.fulfill({
      status: o.status ?? 200,
      contentType: "application/json",
      headers: o.doCache ? { "x-olho-cache": "1" } : {},
      body: (o.status ?? 200) === 200 ? JSON.stringify(corpo) : "",
    });
  });
  if (o.erros) {
    const erros = o.erros;
    page.on("pageerror", (e) => erros.push("pageerror: " + e.message));
    page.on("console", (m) => {
      if (m.type() === "error" || m.text().includes("Alpine Expression Error")) erros.push("console: " + m.text());
    });
  }
  await page.addInitScript((tema) => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem("pinTimestamp", String(Date.now() - 24 * 60 * 60 * 1000));
    if (tema) localStorage.setItem("tema", tema);
  }, o.tema ?? null);
  await page.goto("/");
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
  if (o.hash) await page.evaluate((h) => (location.hash = h), o.hash);
}

// Nenhum descendente passa da largura da viewport (sem rolagem lateral).
export async function semTransbordo(page: Page, seletor: string) {
  const largura = page.viewportSize()!.width;
  const fora = await page.locator(seletor).evaluate((raiz, w) => {
    const r: string[] = [];
    for (const el of [raiz, ...Array.from(raiz.querySelectorAll("*"))]) {
      const b = (el as HTMLElement).getBoundingClientRect();
      if (b.width && b.right > w + 0.5) r.push((el as HTMLElement).className || el.tagName);
    }
    return r;
  }, largura);
  expect(fora).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(largura);
}
