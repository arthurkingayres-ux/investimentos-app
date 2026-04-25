// Carteira Arthur — service worker
// Cache-first para o shell estático; network-first (timeout 2s) para portfolio.json.enc.

const CACHE_VERSION = "v3";
const CACHE_SHELL = `carteira-shell-${CACHE_VERSION}`;
const CACHE_DADOS = `carteira-dados-${CACHE_VERSION}`;

const SHELL_PRECACHE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/app.css",
  "./js/app.js",
  "./js/crypto.js",
  "./js/format.js",
  "./js/vendor/alpine.min.js",
  "./js/vendor/uplot.min.js",
  "./js/vendor/uplot.min.css",
];

const DADOS_URL = "portfolio.json.enc";
const DADOS_TIMEOUT_MS = 2000;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_SHELL);
    await Promise.all(SHELL_PRECACHE.map(async (url) => {
      try {
        await cache.add(new Request(url, { cache: "reload" }));
      } catch (err) {
        console.warn("[sw] precache fail:", url, err);
      }
    }));
    self.skipWaiting();
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

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith("/" + DADOS_URL) || url.pathname.endsWith(DADOS_URL)) {
    event.respondWith(networkFirstDados(req));
    return;
  }

  event.respondWith(cacheFirstShell(req));
});

async function cacheFirstShell(req) {
  const cache = await caches.open(CACHE_SHELL);
  const cached = await cache.match(req, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const resp = await fetch(req);
    if (resp && resp.ok && resp.type === "basic") {
      cache.put(req, resp.clone()).catch((err) => console.warn("[sw] put fail:", err));
    }
    return resp;
  } catch (err) {
    const fallback = await cache.match("./index.html");
    if (fallback && req.mode === "navigate") return fallback;
    throw err;
  }
}

async function networkFirstDados(req) {
  const cache = await caches.open(CACHE_DADOS);
  try {
    const resp = await fetchComTimeout(req, DADOS_TIMEOUT_MS);
    if (resp && resp.ok) {
      cache.put(req, resp.clone()).catch((err) => console.warn("[sw] put fail:", err));
    }
    return resp;
  } catch (err) {
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    throw err;
  }
}

function fetchComTimeout(req, timeoutMs) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error("sw-timeout"));
    }, timeoutMs);
    fetch(req, { cache: "no-store", signal: controller.signal })
      .then((resp) => { clearTimeout(timer); resolve(resp); })
      .catch((err) => { clearTimeout(timer); reject(err); });
  });
}
