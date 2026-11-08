// Carteira Arthur — service worker
// Cache-first para o shell estático; network-first (timeout 2s) para os dados
// cifrados *.json.enc (portfolio + relatórios mensais 7a.Q.3).
//
// 7a.BW.2 — o app mora no Worker `investimentos-app` (Static Assets), atrás do
// Cloudflare Access. Duas respostas novas chegam ao SW, e as duas quebravam o
// app instalado. MOLDE: Biblioteca-CirurgiaPlastica/webapp/library/sw.js, que
// já resolveu o mesmo problema no iPhone; o protótipo da BW.1 provou o molde
// nesta origem.
//
// 1. `/index.html` responde 307 para `/` (html_handling padrão do Static
//    Assets), e o `start_url` do manifest é `./index.html`. Navegação NUNCA
//    recebe resposta redirecionada: Safari e Chromium recusam ("Response
//    served by service worker has redirections"; net::ERR_FAILED). Por isso:
//    precache sem `cache.add` (que segue o redirect sem ponto de
//    interceptação), `unredirected` em toda entrega de navegação, e a
//    navegação ao app (`./` ou `./index.html`, sem query) abre a chave `./`.
// 2. Sessão do Access vencida: toda requisição responde 302 para
//    `*.cloudflareaccess.com`. Dados (`.json.enc`) buscados com
//    `redirect: "manual"` chegam como `opaqueredirect` (ou 3xx/401/403): o SW
//    serve a última cópia do cache e avisa a página (mensagem
//    ACESSO_VENCIDO), que oferece "Entrar". Entrar é navegar para
//    `./?entrar=<agora>`: a query fura o `caches.match` (sensível a query), a
//    navegação vai à rede e o redirect do Access chega ao navegador
//    (opaqueredirect, aceito em navegação), que mostra o login.
//
// Install estrito: se QUALQUER arquivo do shell falhar (sessão vencida no
// meio de um update, por exemplo), o install rejeita e o SW anterior segue
// servindo o cache dele. O install tolerante de antes ativaria um SW com
// shell vazio, e o `activate` apagaria o cache bom: offline morto.

const CACHE_VERSION = "v110";
const CACHE_SHELL = `carteira-shell-${CACHE_VERSION}`;
const CACHE_DADOS = `carteira-dados-${CACHE_VERSION}`;

const SHELL_PRECACHE = [
  "./",
  "./manifest.webmanifest",
  "./css/app.css",
  "./js/app.js",
  "./js/sw-update.js",
  "./js/crypto.js",
  "./js/format.js",
  "./js/transitions.js",
  "./js/aportar.js",
  "./js/vendor/alpine.min.js",
  "./js/vendor/echarts.min.js",
  "./js/echarts-theme.js",
];

const DADOS_TIMEOUT_MS = 2000;

// Zera o flag `redirected` preservando corpo, status e cabeçalhos. O
// early-return é necessário: opaqueredirect tem status 0 e corpo nulo, e
// `new Response(null, { status: 0 })` lançaria RangeError.
function unredirected(res) {
  if (!res.redirected) return res;
  return new Response(res.body, {
    status: res.status, statusText: res.statusText, headers: res.headers,
  });
}

// Busca TUDO antes de gravar QUALQUER COISA: falha de rede ou de sessão na
// busca não deixa resíduo no cache.
async function precache(cache) {
  const buscados = await Promise.all(SHELL_PRECACHE.map(async (url) => {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`precache falhou em ${url}: HTTP ${res.status}`);
    return [url, unredirected(res)];
  }));
  await Promise.all(buscados.map(([url, res]) => cache.put(url, res)));
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    // Só apaga o cache numa falha se foi ESTE install que o criou: um cache
    // pré-existente com o mesmo nome é o que o SW ativo está servindo.
    const jaExistia = await caches.has(CACHE_SHELL);
    const cache = await caches.open(CACHE_SHELL);
    try {
      await precache(cache);
    } catch (err) {
      if (!jaExistia) await caches.delete(CACHE_SHELL).catch(() => {});
      throw err;
    }
    // 2026-07: sem skipWaiting automático. Um SW novo fica em "waiting"; a
    // página detecta (js/sw-update.js) e mostra o snackbar. O skipWaiting só
    // acontece sob demanda, via a mensagem SKIP_WAITING (listener abaixo).
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const nomes = await caches.keys();
    await Promise.all(
      nomes
        .filter((n) => n !== CACHE_SHELL && n !== CACHE_DADOS)
        .map((n) => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

// Aplicação sob demanda: a página (js/sw-update.js aplicar()) posta esta
// mensagem ao worker em espera quando o usuário toca "Recarregar" no snackbar.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 7a.Q.3: todos os .enc (portfolio + índice/meses do relatório) são dados →
  // network-first. Cada pathname distinto cacheia em separado no CACHE_DADOS.
  if (url.pathname.endsWith(".json.enc")) {
    event.respondWith(networkFirstDados(event));
    return;
  }

  if (req.mode === "navigate" && ehEntradaDoApp(url)) {
    event.respondWith(navegacaoAoApp(req, url));
    return;
  }

  event.respondWith(cacheFirstShell(event));
});

// `./` e `./index.html` do escopo: as duas portas do app (o atalho instalado
// abre `./index.html`; o Static Assets canoniza para `./`).
function ehEntradaDoApp(url) {
  const escopo = new URL(self.registration.scope).pathname;
  return url.pathname === escopo || url.pathname === escopo + "index.html";
}

async function navegacaoAoApp(req, url) {
  const cache = await caches.open(CACHE_SHELL);
  // Sem query: shell do cache. Com query (`?entrar=`): rede, para o login do
  // Access acontecer; offline, cai no shell.
  if (!url.search) {
    const cached = await cache.match("./");
    if (cached) return unredirected(cached);
  }
  try {
    // Navegação carrega `redirect: "manual"`: o redirect do Access volta
    // como opaqueredirect, que o respondWith aceita e o navegador segue.
    return await fetch(req);
  } catch (err) {
    const cached = await cache.match("./");
    if (cached) return unredirected(cached);
    throw err;
  }
}

async function cacheFirstShell(event) {
  const req = event.request;
  const cache = await caches.open(CACHE_SHELL);
  // Match exato (respeita query string `?v=` para cache-bust automático).
  const cached = await cache.match(req);
  if (cached) return req.mode === "navigate" ? unredirected(cached) : cached;
  try {
    const resp = await fetch(req);
    if (resp && resp.ok && resp.type === "basic" && !resp.redirected) {
      const copia = resp.clone();
      event.waitUntil(cache.put(req, copia).catch((err) => console.warn("[sw] put fail:", err)));
    }
    return resp;
  } catch (err) {
    // Offline: fallback para qualquer versão cacheada (ignora `?v=`).
    const stale = await cache.match(req, { ignoreSearch: true });
    if (stale) return req.mode === "navigate" ? unredirected(stale) : stale;
    throw err;
  }
}

// Resposta que o Access dá no lugar do dado: redirect (opaqueredirect sob
// `redirect: "manual"`, ou 3xx explícito) ou recusa (401/403).
function ehBloqueioDoAccess(resp) {
  if (resp.type === "opaqueredirect") return true;
  return (resp.status >= 300 && resp.status < 400) || resp.status === 401 || resp.status === 403;
}

async function avisarAcessoVencido(event) {
  const alvos = [];
  if (event.clientId) {
    const c = await self.clients.get(event.clientId);
    if (c) alvos.push(c);
  }
  if (alvos.length === 0) alvos.push(...(await self.clients.matchAll({ type: "window" })));
  alvos.forEach((c) => c.postMessage({ type: "ACESSO_VENCIDO" }));
}

async function networkFirstDados(event) {
  const req = event.request;
  const cache = await caches.open(CACHE_DADOS);
  let resp;
  try {
    resp = await fetchComTimeout(req, DADOS_TIMEOUT_MS);
  } catch (err) {
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    throw err;
  }
  if (ehBloqueioDoAccess(resp)) {
    event.waitUntil(avisarAcessoVencido(event));
    const cached = await cache.match(req, { ignoreSearch: true });
    // Sem cópia: 401 sintético. Devolver o opaqueredirect a um fetch da
    // página (redirect "follow") viraria erro de rede sem explicação.
    return cached || new Response("", { status: 401, statusText: "Acesso vencido" });
  }
  if (resp.ok) {
    const copia = resp.clone();
    event.waitUntil(cache.put(req, copia).catch((err) => console.warn("[sw] put fail:", err)));
  }
  return resp;
}

function fetchComTimeout(req, timeoutMs) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error("sw-timeout"));
    }, timeoutMs);
    fetch(req, { cache: "no-store", redirect: "manual", signal: controller.signal })
      .then((resp) => { clearTimeout(timer); resolve(resp); })
      .catch((err) => { clearTimeout(timer); reject(err); });
  });
}
