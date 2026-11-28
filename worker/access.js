// 7a.BW.5: confere o JWT do Cloudflare Access nas rotas /comite/*.
//
// O Access ja barra quem nao logou antes de a requisicao chegar aqui; esta
// conferencia e a segunda camada (spec 7a.BW §8.1): sem ela, um erro de
// configuracao do Access (politica trocada, aplicacao apagada) deixaria o POST
// aberto. Falha FECHADO: sem ACCESS_AUD ou ACCESS_TEAM_DOMAIN, nada passa.
//
// Sem dependencia (jose): RS256 com WebCrypto contra o JWKS de
// https://<time>.cloudflareaccess.com/cdn-cgi/access/certs, casando pelo `kid`.
// O JWKS fica em memoria do isolate por 1 h; `kid` desconhecido forca uma
// releitura (rotacao de chave do Access).
//
// ACCESS_AUD e ACCESS_TEAM_DOMAIN sao secrets do Worker, nao `vars` do
// wrangler.jsonc: enquanto o repo do app for publico, o time do Access (e o
// subdominio da conta) nao entram em arquivo dele (plano 7a.BW, Task 2.4).

const TTL_JWKS_MS = 60 * 60 * 1000;

// 7a.CK.1: folga de relogio do `nbf`, e SO dele. 60 s e o skew padrao de JWT --
// grande o bastante para absorver a deriva entre o emissor do Access e este
// isolate, pequeno o bastante para nao valer como janela de ataque.
//
// O `exp` logo abaixo NAO tem folga, e a assimetria e deliberada: dar folga ao
// `exp` estenderia a vida de um token vencido (falha ABERTA), enquanto dar folga
// ao `nbf` so evita barrar um token legitimo cujo emissor esta alguns segundos
// adiantado (falha FECHADA sem a folga, mas com falso negativo). Errar para o
// lado seguro tem direcao oposta nos dois claims. O comentario desta constante
// dizia "conferencias temporais", no plural, e sugeria que a folga cobria as
// duas -- achado do board da 7a.CK.1.
//
// Exportada para que o teste importe o valor em vez de repetir o literal.
export const TOLERANCIA_RELOGIO_MS = 60 * 1000;
const cacheJwks = new Map(); // team -> { chaves: Map<kid, CryptoKey>, em }

function normalizarTeam(team) {
  const t = String(team).trim().replace(/\/+$/, "");
  return t.startsWith("https://") ? t : `https://${t}`;
}

function b64urlParaBytes(s) {
  const base = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base + "=".repeat((4 - (base.length % 4)) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function lerJsonB64(s) {
  return JSON.parse(new TextDecoder().decode(b64urlParaBytes(s)));
}

async function carregarChaves(team, fetcher) {
  const r = await fetcher(`${team}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error(`certs HTTP ${r.status}`);
  const { keys = [] } = await r.json();
  const chaves = new Map();
  for (const jwk of keys) {
    if (jwk.kty !== "RSA" || !jwk.kid) continue;
    const chave = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    chaves.set(jwk.kid, chave);
  }
  const entrada = { chaves, em: Date.now() };
  cacheJwks.set(team, entrada);
  return entrada;
}

async function chavePorKid(team, kid, fetcher) {
  let entrada = cacheJwks.get(team);
  if (!entrada || Date.now() - entrada.em > TTL_JWKS_MS || !entrada.chaves.has(kid)) {
    entrada = await carregarChaves(team, fetcher);
  }
  return entrada.chaves.get(kid) ?? null;
}

export async function verificarAccess(request, env, jwksFetcher = (...a) => fetch(...a)) {
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!jwt) return { ok: false, status: 401 };
  const partes = jwt.split(".");
  if (partes.length !== 3) return { ok: false, status: 401 };

  if (!env.ACCESS_AUD || !env.ACCESS_TEAM_DOMAIN) return { ok: false, status: 403 };
  const team = normalizarTeam(env.ACCESS_TEAM_DOMAIN);

  let cab, claims;
  try {
    cab = lerJsonB64(partes[0]);
    claims = lerJsonB64(partes[1]);
  } catch {
    return { ok: false, status: 401 };
  }
  if (cab.alg !== "RS256" || !cab.kid) return { ok: false, status: 403 };

  try {
    const chave = await chavePorKid(team, cab.kid, jwksFetcher);
    if (!chave) return { ok: false, status: 403 };
    const valida = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      chave,
      b64urlParaBytes(partes[2]),
      new TextEncoder().encode(`${partes[0]}.${partes[1]}`),
    );
    if (!valida) return { ok: false, status: 403 };
  } catch {
    return { ok: false, status: 403 };
  }

  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(env.ACCESS_AUD)) return { ok: false, status: 403 };
  if (claims.iss !== team) return { ok: false, status: 403 };
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now()) return { ok: false, status: 403 };
  // `nbf` (7a.CK.1): fechado onde o claim EXISTE -- um JWT emitido para o
  // futuro nao vale ainda. Tolerante onde ele NAO existe, e onde vem com tipo
  // errado: o Access nem sempre emite `nbf`, e exigi-lo barraria login
  // legitimo. Por isso o teste de tipo e a condicao, nao um `else` de erro.
  if (typeof claims.nbf === "number" && claims.nbf * 1000 > Date.now() + TOLERANCIA_RELOGIO_MS)
    return { ok: false, status: 403 };

  return { ok: true, email: claims.email ?? null };
}
