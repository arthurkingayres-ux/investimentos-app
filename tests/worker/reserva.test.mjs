// 7a.BZ.2 Task 2.2: GET /reserva entrega a reserva cifrada que o reserva.yml (repo
// principal, scripts/ci/reserva_publicar.py) grava no KV (chave `reserva`, valor
// {cifra, gravada_em}); o app decifra com a frase. Espelho do /olho.
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

function getReserva({ comJwt = true, method = "GET", caminho = "/reserva" } = {}) {
  const headers = comJwt ? { "Cf-Access-Jwt-Assertion": jwt } : {};
  return worker.fetch(new Request(`https://app.exemplo.invalid${caminho}`, { method, headers }), env, {});
}

test("GET /reserva sem nada no KV: 200 com cifra null, como o /olho", async () => {
  const r = await getReserva();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(await r.json(), { cifra: null, gravada_em: null });
});

test("GET /reserva devolve a cifra e a data gravadas pelo reserva.yml", async () => {
  const cifra = cifraFicticia();
  await kv.put("reserva", JSON.stringify({ cifra, gravada_em: "2026-11-16T12:18:00Z" }));
  const r = await getReserva();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "application/json; charset=utf-8");
  assert.deepEqual(await r.json(), { cifra, gravada_em: "2026-11-16T12:18:00Z" });
});

test("GET /reserva nao entrega o Olho nem a resposta do Comite (chaves separadas)", async () => {
  await kv.put("olho", JSON.stringify({ cifra: cifraFicticia(), gravada_em: "2026-11-16T11:31:00Z" }));
  await kv.put("resposta", JSON.stringify({ cifra: cifraFicticia(), gravada_em: "2026-11-09T06:41:00Z" }));
  assert.deepEqual(await (await getReserva()).json(), { cifra: null, gravada_em: null });
});

test("GET /olho nao entrega a reserva", async () => {
  await kv.put("reserva", JSON.stringify({ cifra: cifraFicticia(), gravada_em: "2026-11-16T12:18:00Z" }));
  const r = await getReserva({ caminho: "/olho" });
  assert.deepEqual(await r.json(), { cifra: null, gravada_em: null });
});

test("GET /reserva sem JWT: 401, e POST: 405", async () => {
  await kv.put("reserva", JSON.stringify({ cifra: cifraFicticia(), gravada_em: "2026-11-16T12:18:00Z" }));
  assert.equal((await getReserva({ comJwt: false })).status, 401);
  assert.equal((await getReserva({ method: "POST" })).status, 405);
});

test("GET /reserva com valor ilegivel no KV: cifra null, sem lancar", async () => {
  await kv.put("reserva", "isto nao e json");
  assert.deepEqual(await (await getReserva()).json(), { cifra: null, gravada_em: null });
});

test("/reserva/qualquer-coisa: 404 atras do Access, nunca asset", async () => {
  assert.equal((await getReserva({ caminho: "/reserva/x" })).status, 404);
  assert.equal((await getReserva({ caminho: "/reserva/x", comJwt: false })).status, 401);
});
