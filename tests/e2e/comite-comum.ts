import { expect, Page } from "@playwright/test";
import crypto from "crypto";
import path from "path";
import fs from "fs";

// 7a.BW.6 Task 6.6: apoio comum dos testes da resposta do Comitê. A resposta
// em claro é a fixture SINTÉTICA tests/fixtures/comite-resposta.sintetica.json
// (repo público: tickers e valores inventados); aqui ela é cifrada na hora com
// o segredo de teste da suíte, no mesmo formato de js/crypto.js e
// src/output/crypto.py (PBKDF2-HMAC-SHA256 600.000 + AES-256-GCM,
// salt[16] + nonce[12] + ciphertext + tag, base64).

export const SEGREDO_TESTE = "123456";

const PORTFOLIO = fs.readFileSync(path.join(__dirname, "../fixtures/portfolio.test.json.enc"), "utf-8");
const IDX_REL = fs.readFileSync(path.join(__dirname, "../fixtures/relatorios_index.test.json.enc"), "utf-8");

export function fixtureResposta(): any {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "../fixtures/comite-resposta.sintetica.json"), "utf-8"),
  );
}

export function cifrar(texto: string, segredo = SEGREDO_TESTE): string {
  const salt = crypto.randomBytes(16);
  const nonce = crypto.randomBytes(12);
  const chave = crypto.pbkdf2Sync(segredo, salt, 600_000, 32, "sha256");
  const c = crypto.createCipheriv("aes-256-gcm", chave, nonce);
  const ct = Buffer.concat([c.update(texto, "utf8"), c.final(), c.getAuthTag()]);
  return Buffer.concat([salt, nonce, ct]).toString("base64");
}

// A fixture com o `criado_em` da proposta atual a uma hora de agora (pronta,
// não antiga); `mudar` ajusta o resto.
export function resposta(mudar?: (r: any) => void): any {
  const r = fixtureResposta();
  r.atual.criado_em = new Date(Date.now() - 3600 * 1000).toISOString();
  if (mudar) mudar(r);
  return r;
}

export type Abrir = {
  resposta?: any | null; // null = Worker sem resposta (cifra null)
  enviadoEm?: string | null; // pedido recente DESTE aparelho
  cache?: any | null; // resposta já guardada (só a cifra) em localStorage
  estado?: any; // corpo de GET /comite/estado (padrão: nada pendente)
  tema?: "dark" | null;
  hash?: string;
  erros?: string[];
};

export async function abrir(page: Page, o: Abrir = {}) {
  await page.route("**/portfolio.json.enc", (route) =>
    route.fulfill({ status: 200, body: PORTFOLIO, contentType: "text/plain" }),
  );
  await page.route("**/relatorios_index.json.enc", (route) =>
    route.fulfill({ status: 200, body: IDX_REL, contentType: "text/plain" }),
  );
  await page.route("**/comite/estado", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(o.estado ?? { pendente: false, recebido_em: null, disparado_em: null, ultima_falha: null }),
    }),
  );
  const corpo = o.resposta
    ? { cifra: cifrar(JSON.stringify(o.resposta)), gravada_em: new Date().toISOString() }
    : { cifra: null, gravada_em: null };
  await page.route("**/comite/resposta", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(corpo) }),
  );
  if (o.erros) {
    const erros = o.erros;
    page.on("pageerror", (e) => erros.push("pageerror: " + e.message));
    page.on("console", (m) => {
      if (m.type() === "error" || m.text().includes("Alpine Expression Error")) erros.push("console: " + m.text());
    });
    page.on("response", (r) => {
      if (r.status() >= 400) erros.push(`http ${r.status()}: ${r.url()}`);
    });
  }
  const cache = o.cache ? JSON.stringify({ cifra: cifrar(JSON.stringify(o.cache)), gravada_em: new Date().toISOString() }) : null;
  await page.addInitScript(
    ([enviadoEm, cacheStr, tema]) => {
      localStorage.setItem("pin", "123456");
      localStorage.setItem("pinTimestamp", String(Date.now() - 24 * 60 * 60 * 1000));
      if (enviadoEm) localStorage.setItem("comite:enviado_em", enviadoEm);
      if (cacheStr) localStorage.setItem("comite:resposta", cacheStr);
      if (tema) localStorage.setItem("tema", tema);
    },
    [o.enviadoEm === undefined ? new Date().toISOString() : o.enviadoEm, cache, o.tema ?? null] as const,
  );
  await page.goto("/");
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
  await page.evaluate((h) => (location.hash = h), o.hash ?? "#aportar");
  if ((o.hash ?? "#aportar") === "#aportar") await expect(page.locator(".tela-aportar")).toBeVisible();
}

// Texto que nunca pode aparecer na voz do Comitê (verbo de ordem).
export const VERBO_DE_ORDEM = /\b(compre|venda|vender)\b/i;

// Razão de contraste WCAG entre duas cores CSS rgb()/rgba() já resolvidas.
export function contraste(a: string, b: string): number {
  const rgb = (s: string) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const lum = (s: string) => {
    const [r, g, bl] = rgb(s).map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const l1 = lum(a) + 0.05;
  const l2 = lum(b) + 0.05;
  return Math.max(l1, l2) / Math.min(l1, l2);
}
