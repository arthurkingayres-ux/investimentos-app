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

export function decifrar(b64: string, segredo = SEGREDO_TESTE): any {
  const buf = Buffer.from(b64.trim(), "base64");
  const salt = buf.subarray(0, 16);
  const nonce = buf.subarray(16, 28);
  const ct = buf.subarray(28, buf.length - 16);
  const tag = buf.subarray(buf.length - 16);
  const chave = crypto.pbkdf2Sync(segredo, salt, 600_000, 32, "sha256");
  const d = crypto.createDecipheriv("aes-256-gcm", chave, nonce);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString("utf8"));
}

export function cifrar(texto: string, segredo = SEGREDO_TESTE): string {
  const salt = crypto.randomBytes(16);
  const nonce = crypto.randomBytes(12);
  const chave = crypto.pbkdf2Sync(segredo, salt, 600_000, 32, "sha256");
  const c = crypto.createCipheriv("aes-256-gcm", chave, nonce);
  const ct = Buffer.concat([c.update(texto, "utf8"), c.final(), c.getAuthTag()]);
  return Buffer.concat([salt, nonce, ct]).toString("base64");
}

// `comite_placar` sintético (forma do backend, 7a.BW.7 Task 7.3a).
export function placar(mudar?: (c: any) => void): any {
  const c: any = {
    estado: "historico_curto",
    n_propostas: 2,
    desde: "2026-11",
    meses: 1,
    sombras: { regra: [], comite: [], real: [] },
    twr: { regra: null, comite: null, real: null },
  };
  if (mudar) mudar(c);
  return c;
}

// 7a.CH.1: um pedido pendente SINTETICO, cifrado como o app o cifra (o mesmo
// formato de js/crypto.js e src/output/crypto.py). Valor ficticio: o sibling e
// publico.
export function pedidoCifrado(valorBrl: number, segredo = SEGREDO_TESTE): string {
  return cifrar(
    JSON.stringify({
      v: 1,
      valor_brl: valorBrl,
      remetido_usd: null,
      nota: null,
      criado_em: new Date().toISOString(),
      nonce: crypto.randomBytes(16).toString("hex"),
    }),
    segredo,
  );
}

// Corpo de GET /comite/estado com um pedido na fila, incluindo a cifra que o
// Worker passou a devolver (7a.CH.1 Task 3).
export function estadoPendente(
  valorBrl: number,
  o: { recebido_em?: string; disparado_em?: string | null; ultima_falha?: any; pendente?: boolean; segredo?: string } = {},
): any {
  return {
    pendente: o.pendente ?? (o.disparado_em ? false : true),
    recebido_em: o.recebido_em ?? new Date().toISOString(),
    disparado_em: o.disparado_em ?? null,
    ultima_falha: o.ultima_falha ?? null,
    cifra: pedidoCifrado(valorBrl, o.segredo),
  };
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
  // 7a.CH.1: status HTTP da consulta de estado (502 = Worker fora do ar),
  // cifra que não decifra neste aparelho, e um gancho para CONTAR consultas
  // (page.on("request") não é confiável com a rota interceptada).
  estadoStatus?: number;
  cifraQuebrada?: boolean;
  aoConsultarEstado?: () => void;
  // 7a.CH.1: congela `Date.now()` da página. Teste com data ABSOLUTA no
  // estado do pedido PRECISA disto: sem relógio fixo ele fica verde hoje e
  // vermelho sozinho 72 h depois, quando a janela de `propostaFase` expira
  // (o padrão "expiração por construção estoura na suíte"). `setFixedTime`
  // não mexe nos timers, então o polling continua funcionando.
  relogio?: string;
  tema?: "dark" | null;
  hash?: string;
  erros?: string[];
  // 7a.BW.7 Task 7.3b: ajusta o portfolio decifrado (ex.: injeta `comite_placar`
  // sintético) antes de servi-lo de novo cifrado.
  portfolio?: (p: any) => void;
};

export async function abrir(page: Page, o: Abrir = {}) {
  let portfolioCifrado = PORTFOLIO;
  if (o.portfolio) {
    const p = decifrar(PORTFOLIO);
    o.portfolio(p);
    portfolioCifrado = cifrar(JSON.stringify(p));
  }
  await page.route("**/portfolio.json.enc", (route) =>
    route.fulfill({ status: 200, body: portfolioCifrado, contentType: "text/plain" }),
  );
  await page.route("**/relatorios_index.json.enc", (route) =>
    route.fulfill({ status: 200, body: IDX_REL, contentType: "text/plain" }),
  );
  const estadoBase = o.estado ?? { pendente: false, recebido_em: null, disparado_em: null, ultima_falha: null, cifra: null };
  const estadoCorpo = o.cifraQuebrada
    ? { ...estadoBase, cifra: pedidoCifrado(5000, "outra-frase-de-teste") }
    : estadoBase;
  await page.route("**/comite/estado", (route) => {
    if (o.aoConsultarEstado) o.aoConsultarEstado();
    if (o.estadoStatus && o.estadoStatus !== 200) {
      return route.fulfill({ status: o.estadoStatus, contentType: "application/json", body: JSON.stringify({ erro: "x" }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(estadoCorpo) });
  });
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
  // O `pinTimestamp` é derivado do relógio PEDIDO, não do relógio real: o
  // `Date.now()` dentro do init script lê o tempo real, porque este script é
  // adicionado ANTES do relógio falso (`setFixedTime`, abaixo) e os init
  // scripts rodam na ordem de adição. Com `relogio` no futuro, um
  // `pinTimestamp` real ficava mais de `SESSION_TTL_MS` (7 dias, `js/app.js`)
  // atrás do relógio da página: `tentarAutoResume` chamava `limparSessao()` e
  // o app nunca chegava ao raio X — o teste morria no timeout do `.raiox`, não
  // na asserção. Calcular a base aqui, no Node, é robusto a qualquer ordem de
  // instalação (7a.CJ, G2).
  const base = o.relogio ? new Date(o.relogio).getTime() : Date.now();
  await page.addInitScript(
    ([enviadoEm, cacheStr, tema, pinTs]) => {
      localStorage.setItem("pin", "123456");
      localStorage.setItem("pinTimestamp", String(pinTs));
      if (enviadoEm) localStorage.setItem("comite:enviado_em", enviadoEm);
      if (cacheStr) localStorage.setItem("comite:resposta", cacheStr);
      if (tema) localStorage.setItem("tema", tema);
    },
    [
      o.enviadoEm === undefined ? new Date().toISOString() : o.enviadoEm,
      cache,
      o.tema ?? null,
      base - 24 * 60 * 60 * 1000,
    ] as const,
  );
  if (o.relogio) await page.clock.setFixedTime(new Date(o.relogio));
  await page.goto("/");
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
  await page.evaluate((h) => (location.hash = h), o.hash ?? "#aportar");
  const h = o.hash ?? "#aportar";
  if (h === "#aportar") await expect(page.locator(".tela-aportar")).toBeVisible();
  if (h === "#/aportar/proposta") await expect(page.locator(".tela-proposta")).toBeVisible();
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
