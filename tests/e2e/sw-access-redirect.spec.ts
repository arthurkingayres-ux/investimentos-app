/**
 * 7a.BW.2 — o service worker contra as duas respostas que o app passa a
 * receber atrás do Cloudflare Access, no Worker com Static Assets:
 *
 * 1. `/index.html` responde 307 para `/` (html_handling padrão). O atalho
 *    instalado abre `./index.html` (start_url do manifest). Guardar a resposta
 *    redirecionada e servi-la a uma navegação é recusado pelo navegador
 *    (Safari e Chromium): o app instalado não abria offline (prova no iPhone,
 *    BW.1).
 * 2. Sessão do Access vencida: TODA requisição responde 302 para
 *    `*.cloudflareaccess.com`. O app tem de abrir com o shell e a última
 *    carteira do cache, e oferecer o login de novo.
 *
 * Diferente do resto da suíte, aqui o SW é REAL (`serviceWorkers: "allow"`) e
 * o servidor é um http local próprio, que imita o Worker. A fixture é a
 * sintética da suíte (`portfolio.test.json.enc`, PIN 123456).
 */
import { test, expect, Page, BrowserContext } from "@playwright/test";
import http from "http";
import fs from "fs";
import path from "path";
import type { AddressInfo } from "net";

const RAIZ = path.resolve(__dirname, "..", "..");
const FIXTURE = fs.readFileSync(path.join(RAIZ, "tests/fixtures/portfolio.test.json.enc"));
const LOGIN_ACCESS = "https://x.cloudflareaccess.com/cdn-cgi/access/login/investimentos-app";

const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

const estado = { acesso: "ok" as "ok" | "vencido" };
let servidor: http.Server;
let base = "";

function responder(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? "/", "http://local");
  if (estado.acesso === "vencido") {
    res.writeHead(302, { Location: `${LOGIN_ACCESS}?redirect_url=${encodeURIComponent(url.pathname)}` });
    res.end();
    return;
  }
  if (url.pathname === "/index.html") {
    res.writeHead(307, { Location: "/" });
    res.end();
    return;
  }
  if (url.pathname === "/portfolio.json.enc") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(FIXTURE);
    return;
  }
  if (url.pathname.endsWith(".json.enc")) {
    res.writeHead(404);
    res.end();
    return;
  }
  const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const arq = path.join(RAIZ, rel);
  if (!arq.startsWith(RAIZ) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { "Content-Type": TIPOS[path.extname(arq)] ?? "application/octet-stream" });
  res.end(fs.readFileSync(arq));
}

test.use({ serviceWorkers: "allow" });

test.beforeAll(async () => {
  servidor = http.createServer(responder);
  await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise<void>((ok) => servidor.close(() => ok()));
});

test.beforeEach(() => {
  estado.acesso = "ok";
});

/** Abre o app com sessão local, espera o SW controlar a página e a carteira passar por ele. */
async function instalarComCarteira(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem("pinTimestamp", String(Date.now()));
  });
  await page.goto(base + "/");
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15_000 });
  // Segunda abertura já sob o SW: a carteira passa a existir no cache dele.
  await page.goto(base + "/");
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 15_000 });
  return page;
}

test.describe("SW: o precache cobre o shell que o index.html carrega", () => {
  test("todo script e stylesheet do index.html está no SHELL_PRECACHE", () => {
    // Com o install estrito, SHELL_PRECACHE é o contrato do app offline: o
    // que não está ali só entra no cache se for buscado com o SW já ativo.
    // Derivado do index.html, não enumerado (CRB da 7a.BW.2: aportar.js faltava).
    const html = fs.readFileSync(path.join(RAIZ, "index.html"), "utf8");
    const sw = fs.readFileSync(path.join(RAIZ, "service-worker.js"), "utf8");
    const bloco = sw.match(/const SHELL_PRECACHE = \[([\s\S]*?)\];/);
    expect(bloco, "SHELL_PRECACHE não encontrado").not.toBeNull();
    const precache = [...bloco![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const usados = [
      ...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g),
      ...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g),
    ].map((m) => "./" + m[1].split("?")[0]);
    expect(usados.length).toBeGreaterThan(5);
    for (const u of usados) expect(precache, u).toContain(u);
  });
});

test.describe("SW atrás do Access (Worker com Static Assets)", () => {
  test("offline: o atalho ./index.html e a raiz abrem com a última carteira", async ({ context }) => {
    const page = await instalarComCarteira(context);
    await context.setOffline(true);
    await page.goto(base + "/index.html");
    await expect(page.locator(".raiox")).toBeVisible({ timeout: 15_000 });
    await page.goto(base + "/");
    await expect(page.locator(".raiox")).toBeVisible({ timeout: 15_000 });
    await context.setOffline(false);
  });

  test("sessão vencida: abre com a carteira do cache e oferece entrar de novo", async ({ context }) => {
    const page = await instalarComCarteira(context);
    estado.acesso = "vencido";
    await page.goto(base + "/index.html");
    await expect(page.locator(".raiox")).toBeVisible({ timeout: 15_000 });
    const aviso = page.locator(".acesso-snackbar");
    await expect(aviso).toBeVisible({ timeout: 10_000 });
    await expect(aviso).toContainText("Sessão expirada");
    for (const nome of ["Entrar", "Dispensar aviso"]) {
      const caixa = await aviso.getByRole("button", { name: nome }).boundingBox();
      expect(caixa!.height, nome).toBeGreaterThanOrEqual(44);
      expect(caixa!.width, nome).toBeGreaterThanOrEqual(44);
    }
    // Os dois avisos dividem a superfície: o de nova versão cede a vez.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("sw:update-available")));
    await expect(page.locator(".versao-snackbar")).toBeHidden();

    // "Entrar" fura o cache (query única) e a navegação recebe o redirect do Access.
    const indoAoLogin = page.waitForRequest((r) => r.url().startsWith(LOGIN_ACCESS), { timeout: 10_000 });
    await aviso.getByRole("button", { name: "Entrar" }).click();
    await indoAoLogin;
  });

  test("cache envenenado com resposta redirecionada: a navegação offline ainda abre", async ({ context }) => {
    // O `unredirected` na entrega é o que o Safari/Chromium exigem: resposta
    // com o flag `redirected` servida a uma navegação vira net::ERR_FAILED.
    // O precache já grava sem o flag, então o caminho só é exercitado com o
    // cache envenenado (cache de versão anterior, ou outro escritor). CRB da
    // 7a.BW.2: sem este teste, `unredirected` virar identidade passava verde.
    const page = await instalarComCarteira(context);
    const redirecionada = await page.evaluate(async () => {
      const r = await fetch("/index.html");
      const nome = (await caches.keys()).find((n) => n.startsWith("carteira-shell-"));
      if (!nome) throw new Error("cache do shell ausente");
      await (await caches.open(nome)).put("./", r.clone());
      return r.redirected;
    });
    expect(redirecionada, "a resposta guardada tem de vir redirecionada").toBe(true);
    await context.setOffline(true);
    await page.goto(base + "/");
    await expect(page.locator(".raiox")).toBeVisible({ timeout: 15_000 });
    await context.setOffline(false);
  });

  test("sessão vencida: a carteira cacheada não é sobrescrita pela página de login", async ({ context }) => {
    const page = await instalarComCarteira(context);
    estado.acesso = "vencido";
    await page.goto(base + "/");
    await expect(page.locator(".raiox")).toBeVisible({ timeout: 15_000 });
    estado.acesso = "ok";
    await context.setOffline(true);
    await page.goto(base + "/");
    await expect(page.locator(".raiox")).toBeVisible({ timeout: 15_000 });
    await context.setOffline(false);
  });
});
