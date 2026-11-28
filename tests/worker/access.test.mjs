// 7a.BW.5 Task 5.1: verificarAccess confere o JWT do Cloudflare Access.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TOLERANCIA_RELOGIO_MS, verificarAccess } from "../../worker/access.js";
import { AUD, TEAM, assinarJwt, claimsValidas, envBase, fetchFalso, kvMemoria, parDeChaves } from "./helpers.mjs";

const par = await parDeChaves();
const outroPar = await parDeChaves("kid-teste"); // mesmo kid, chave diferente
const env = envBase(kvMemoria());

function req(jwt) {
  const headers = jwt ? { "Cf-Access-Jwt-Assertion": jwt } : {};
  return new Request("https://app.exemplo.invalid/comite/estado", { headers });
}

test("sem JWT: 401", async () => {
  assert.deepEqual(await verificarAccess(req(null), env, fetchFalso(par)), { ok: false, status: 401 });
});

test("JWT malformado: 401", async () => {
  assert.deepEqual(await verificarAccess(req("nao.e.jwt"), env, fetchFalso(par)), { ok: false, status: 401 });
});

test("JWT valido: ok com o e-mail", async () => {
  const jwt = await assinarJwt(par, claimsValidas());
  assert.deepEqual(await verificarAccess(req(jwt), env, fetchFalso(par)), { ok: true, email: "pessoa@exemplo.invalid" });
});

test("aud como string (e nao lista) tambem vale", async () => {
  const jwt = await assinarJwt(par, claimsValidas({ aud: AUD }));
  assert.equal((await verificarAccess(req(jwt), env, fetchFalso(par))).ok, true);
});

test("JWT de outra aud: 403", async () => {
  const jwt = await assinarJwt(par, claimsValidas({ aud: ["outra-aplicacao"] }));
  assert.deepEqual(await verificarAccess(req(jwt), env, fetchFalso(par)), { ok: false, status: 403 });
});

test("JWT de outro emissor: 403", async () => {
  const jwt = await assinarJwt(par, claimsValidas({ iss: "https://outro.cloudflareaccess.com" }));
  assert.deepEqual(await verificarAccess(req(jwt), env, fetchFalso(par)), { ok: false, status: 403 });
});

test("JWT vencido: 403", async () => {
  const jwt = await assinarJwt(par, claimsValidas({ exp: Math.floor(Date.now() / 1000) - 10 }));
  assert.deepEqual(await verificarAccess(req(jwt), env, fetchFalso(par)), { ok: false, status: 403 });
});

test("assinatura de outra chave: 403", async () => {
  const jwt = await assinarJwt(outroPar, claimsValidas());
  assert.deepEqual(await verificarAccess(req(jwt), env, fetchFalso(par)), { ok: false, status: 403 });
});

test("alg diferente de RS256 no cabecalho: 403", async () => {
  const jwt = await assinarJwt(par, claimsValidas());
  const [, corpo, assinatura] = jwt.split(".");
  const cab = Buffer.from(JSON.stringify({ alg: "none", kid: par.kid })).toString("base64url");
  assert.deepEqual(await verificarAccess(req(`${cab}.${corpo}.${assinatura}`), env, fetchFalso(par)), { ok: false, status: 403 });
});

test("sem ACCESS_AUD configurado: 403 mesmo com JWT valido (falha fechado)", async () => {
  const jwt = await assinarJwt(par, claimsValidas());
  const semAud = { ...env, ACCESS_AUD: undefined };
  assert.deepEqual(await verificarAccess(req(jwt), semAud, fetchFalso(par)), { ok: false, status: 403 });
});

test("team domain sem https:// e normalizado", async () => {
  const jwt = await assinarJwt(par, claimsValidas());
  const host = { ...env, ACCESS_TEAM_DOMAIN: TEAM.replace("https://", "") };
  assert.equal((await verificarAccess(req(jwt), host, fetchFalso(par))).ok, true);
});

// ---------------------------------------------------------------------------
// 7a.CK.1 Task 1.1: `nbf` (not before). O Access ja barra quem nao logou, mas
// `verificarAccess` conferia `aud`, `iss` e `exp` e NAO `nbf`: um JWT emitido
// para o futuro era aceito antes de valer.
//
// Fechado onde o claim EXISTE, tolerante onde ele nao existe -- o Access nem
// sempre emite `nbf`, e exigi-lo barraria login legitimo.
//
// A tolerancia e IMPORTADA do modulo de proposito: um literal repetido aqui
// deixaria estes testes verdes depois de alguem trocar a constante no codigo.
const SEG = (ms) => Math.floor((Date.now() + ms) / 1000);

test("TOLERANCIA_RELOGIO_MS e exportada e nomeada (nao numero solto)", () => {
  assert.equal(typeof TOLERANCIA_RELOGIO_MS, "number");
  assert.ok(
    TOLERANCIA_RELOGIO_MS > 0 && TOLERANCIA_RELOGIO_MS <= 300_000,
    `tolerancia fora da faixa de skew plausivel: ${TOLERANCIA_RELOGIO_MS}`,
  );
});

test("nbf no futuro alem da tolerancia: 403", async () => {
  const jwt = await assinarJwt(par, claimsValidas({ nbf: SEG(TOLERANCIA_RELOGIO_MS + 60_000) }));
  assert.deepEqual(await verificarAccess(req(jwt), env, fetchFalso(par)), { ok: false, status: 403 });
});

test("nbf no futuro DENTRO da tolerancia: passa (relogio adiantado)", async () => {
  const jwt = await assinarJwt(par, claimsValidas({ nbf: SEG(TOLERANCIA_RELOGIO_MS / 2) }));
  assert.equal((await verificarAccess(req(jwt), env, fetchFalso(par))).ok, true);
});

test("nbf no passado: passa", async () => {
  const jwt = await assinarJwt(par, claimsValidas({ nbf: SEG(-3_600_000) }));
  assert.equal((await verificarAccess(req(jwt), env, fetchFalso(par))).ok, true);
});

test("nbf ausente: passa (o Access nem sempre o emite)", async () => {
  const jwt = await assinarJwt(par, claimsValidas());
  assert.equal((await verificarAccess(req(jwt), env, fetchFalso(par))).ok, true);
});

// Review Focus 1: claim de tipo errado nao barra nem lanca.
for (const [rotulo, nbf] of [["string", "1764200000"], ["null", null], ["objeto", {}]]) {
  test(`nbf como ${rotulo}: passa sem lancar`, async () => {
    const jwt = await assinarJwt(par, claimsValidas({ nbf }));
    assert.equal((await verificarAccess(req(jwt), env, fetchFalso(par))).ok, true);
  });
}
