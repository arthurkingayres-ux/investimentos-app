// 7a.BX.4 Task 4.1: GET /olho entrega o payload cifrado do Olho que o `publicar` do
// olho.yml grava no KV (chave `olho`, valor {cifra, gravada_em}); o app decifra com a frase.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../../worker/index.js";
import { assinarJwt, cifraFicticia, claimsValidas, envBase, fetchFalso, kvMemoria, parDeChaves } from "./helpers.mjs";

const par = await parDeChaves();
const jwt = await assinarJwt(par, claimsValidas());
let kv, env;

beforeEach(() => {
  kv = kvMemoria();
  env = envBase(kv);
  globalThis.fetch = fetchFalso(par);
});

function getOlho({ comJwt = true, method = "GET", caminho = "/olho" } = {}) {
  const headers = comJwt ? { "Cf-Access-Jwt-Assertion": jwt } : {};
  return worker.fetch(new Request(`https://app.exemplo.invalid${caminho}`, { method, headers }), env, {});
}

test("GET /olho sem nada no KV: 200 com cifra null (404 viraria erro de console no app)", async () => {
  const r = await getOlho();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(await r.json(), { cifra: null, gravada_em: null });
});

test("GET /olho devolve a cifra e a data gravadas pelo publicar", async () => {
  const cifra = cifraFicticia();
  await kv.put("olho", JSON.stringify({ cifra, gravada_em: "2026-11-16T11:31:00Z" }));
  const r = await getOlho();
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { cifra, gravada_em: "2026-11-16T11:31:00Z" });
});

test("GET /olho nao entrega a resposta do Comite (chaves separadas)", async () => {
  await kv.put("resposta", JSON.stringify({ cifra: cifraFicticia(), gravada_em: "2026-11-09T06:41:00Z" }));
  assert.deepEqual(await (await getOlho()).json(), { cifra: null, gravada_em: null });
});

test("GET /olho sem JWT: 401, e POST: 405", async () => {
  await kv.put("olho", JSON.stringify({ cifra: cifraFicticia(), gravada_em: "2026-11-16T11:31:00Z" }));
  assert.equal((await getOlho({ comJwt: false })).status, 401);
  assert.equal((await getOlho({ method: "POST" })).status, 405);
});

test("GET /olho com valor ilegivel no KV: cifra null, sem lancar", async () => {
  await kv.put("olho", "isto nao e json");
  assert.deepEqual(await (await getOlho()).json(), { cifra: null, gravada_em: null });
});

test("/olho/qualquer-coisa: 404 atras do Access, nunca asset", async () => {
  assert.equal((await getOlho({ caminho: "/olho/x" })).status, 404);
  assert.equal((await getOlho({ caminho: "/olho/x", comJwt: false })).status, 401);
});
