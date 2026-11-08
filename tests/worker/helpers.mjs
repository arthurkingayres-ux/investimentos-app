// 7a.BW.5: apoio dos testes do Worker do Comite (node --test, sem rede).
// KV em memoria, fetch falso e um par RSA gerado no proprio teste para assinar
// JWTs no formato do Cloudflare Access (RS256, kid no cabecalho).

export const TEAM = "https://time-ficticio.cloudflareaccess.com";
export const AUD = "aud-ficticio-0123456789abcdef";

export function kvMemoria() {
  const dados = new Map();
  return {
    dados,
    async get(chave, opcoes) {
      if (!dados.has(chave)) return null;
      const bruto = dados.get(chave).valor;
      const tipo = typeof opcoes === "string" ? opcoes : opcoes?.type;
      return tipo === "json" ? JSON.parse(bruto) : bruto;
    },
    async put(chave, valor, opcoes) {
      dados.set(chave, { valor: String(valor), ttl: opcoes?.expirationTtl ?? null });
    },
    async delete(chave) {
      dados.delete(chave);
    },
  };
}

function b64url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

export async function parDeChaves(kid = "kid-teste") {
  const par = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", par.publicKey);
  return { privada: par.privateKey, jwks: { keys: [{ ...jwk, kid, alg: "RS256", use: "sig" }] }, kid };
}

export async function assinarJwt(par, claims) {
  const cab = b64url(JSON.stringify({ alg: "RS256", kid: par.kid, typ: "JWT" }));
  const corpo = b64url(JSON.stringify(claims));
  const assinatura = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    par.privada,
    new TextEncoder().encode(`${cab}.${corpo}`),
  );
  return `${cab}.${corpo}.${b64url(new Uint8Array(assinatura))}`;
}

export function claimsValidas(extra = {}) {
  const agora = Math.floor(Date.now() / 1000);
  return { aud: [AUD], iss: TEAM, email: "pessoa@exemplo.invalid", iat: agora, exp: agora + 3600, ...extra };
}

// fetch falso: devolve o JWKS do par para a URL de certs e registra o resto.
export function fetchFalso(par, respostaGithub = { status: 204 }) {
  const chamadas = [];
  const fn = async (url, init = {}) => {
    const u = String(url);
    if (u === `${TEAM}/cdn-cgi/access/certs`) {
      return new Response(JSON.stringify(par.jwks), { status: 200, headers: { "content-type": "application/json" } });
    }
    chamadas.push({ url: u, init });
    return new Response(null, { status: respostaGithub.status });
  };
  fn.chamadas = chamadas;
  return fn;
}

export function envBase(kv) {
  return {
    COMITE: kv,
    ACCESS_AUD: AUD,
    ACCESS_TEAM_DOMAIN: TEAM,
    GITHUB_REPO: "dono-ficticio/repo-ficticio",
    WORKFLOW: "comite-aporte.yml",
    GITHUB_PAT_COMITE: "token-ficticio-nao-real",
    ASSETS: { fetch: async () => new Response("asset", { status: 200 }) },
  };
}

// Cifra sintetica: base64 de bytes aleatorios (o Worker nunca decifra).
export function cifraFicticia(n = 96) {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(n))).toString("base64");
}
