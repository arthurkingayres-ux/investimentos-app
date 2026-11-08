// 7a.BW.5 Task 5.1: rotas do Comite no Worker (pedido, estado, cron, dispatch).
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../../worker/index.js";
import { assinarJwt, cifraFicticia, claimsValidas, envBase, fetchFalso, kvMemoria, parDeChaves } from "./helpers.mjs";

const par = await parDeChaves();
const jwt = await assinarJwt(par, claimsValidas());
let kv, env, fetchOriginal, falso;

beforeEach(() => {
  kv = kvMemoria();
  env = envBase(kv);
  fetchOriginal = globalThis.fetch;
  falso = fetchFalso(par);
  globalThis.fetch = falso;
});
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

function post(corpo, { comJwt = true, bruto = null } = {}) {
  const headers = { "content-type": "application/json" };
  if (comJwt) headers["Cf-Access-Jwt-Assertion"] = jwt;
  return worker.fetch(
    new Request("https://app.exemplo.invalid/comite/pedido", {
      method: "POST",
      headers,
      body: bruto ?? JSON.stringify(corpo),
    }),
    env,
    {},
  );
}

function getEstado() {
  return worker.fetch(
    new Request("https://app.exemplo.invalid/comite/estado", { headers: { "Cf-Access-Jwt-Assertion": jwt } }),
    env,
    {},
  );
}

// 06:30 UTC = 03:30 BRT do mesmo dia.
function cron(dia) {
  const t = Date.UTC(2026, 10, dia, 6, 30, 0);
  return worker.scheduled({ scheduledTime: t, cron: "30 6 * * *" }, env, {});
}

test("POST sem JWT: 401 e nada no KV", async () => {
  const r = await post({ cifra: cifraFicticia(), imediato: false }, { comJwt: false });
  assert.equal(r.status, 401);
  assert.equal(kv.dados.size, 0);
});

test("POST com JWT de outra aud: 403", async () => {
  const outro = await assinarJwt(par, claimsValidas({ aud: ["outra"] }));
  const r = await worker.fetch(
    new Request("https://app.exemplo.invalid/comite/pedido", {
      method: "POST",
      headers: { "Cf-Access-Jwt-Assertion": outro, "content-type": "application/json" },
      body: JSON.stringify({ cifra: cifraFicticia(), imediato: false }),
    }),
    env,
    {},
  );
  assert.equal(r.status, 403);
  assert.equal(kv.dados.size, 0);
});

test("POST valido: 202 na_fila e o pendente no KV, sem dispatch", async () => {
  const cifra = cifraFicticia();
  const r = await post({ cifra, imediato: false });
  assert.equal(r.status, 202);
  assert.deepEqual(await r.json(), { estado: "na_fila" });
  const pend = await kv.get("pedido:pendente", "json");
  assert.equal(pend.cifra, cifra);
  assert.equal(pend.disparado_em, null);
  assert.ok(!Number.isNaN(Date.parse(pend.recebido_em)));
  assert.equal(falso.chamadas.length, 0);
});

test("segundo pedido substitui o primeiro", async () => {
  await post({ cifra: cifraFicticia(), imediato: false });
  const segunda = cifraFicticia();
  await post({ cifra: segunda, imediato: false });
  assert.equal((await kv.get("pedido:pendente", "json")).cifra, segunda);
});

test("quarto pedido do dia: 429, e o pendente segue sendo o terceiro", async () => {
  const cifras = [cifraFicticia(), cifraFicticia(), cifraFicticia()];
  for (const c of cifras) assert.equal((await post({ cifra: c, imediato: false })).status, 202);
  const r = await post({ cifra: cifraFicticia(), imediato: false });
  assert.equal(r.status, 429);
  assert.equal((await kv.get("pedido:pendente", "json")).cifra, cifras[2]);
  const chaveLimite = [...kv.dados.keys()].find((k) => k.startsWith("limite:"));
  assert.match(chaveLimite, /^limite:\d{4}-\d{2}-\d{2}$/);
  assert.equal(kv.dados.get(chaveLimite).ttl, 2 * 24 * 3600);
});

test("corpo acima de 8 KB: 413", async () => {
  const r = await post(null, { bruto: JSON.stringify({ cifra: "A".repeat(9000), imediato: false }) });
  assert.equal(r.status, 413);
  assert.equal(kv.dados.size, 0);
});

test("corpo invalido: 400 (JSON quebrado, cifra nao base64, imediato nao booleano, cifra vazia)", async () => {
  for (const bruto of [
    "{nao json",
    JSON.stringify({ cifra: "nao base64!!", imediato: false }),
    JSON.stringify({ cifra: cifraFicticia(), imediato: "sim" }),
    JSON.stringify({ cifra: "", imediato: false }),
    JSON.stringify({ imediato: false }),
  ]) {
    const r = await post(null, { bruto });
    assert.equal(r.status, 400, bruto);
  }
  assert.equal(kv.dados.size, 0);
});

test("imediato: dispara o workflow com a cifra, ref master, e marca disparado_em", async () => {
  const cifra = cifraFicticia();
  const r = await post({ cifra, imediato: true });
  assert.equal(r.status, 202);
  assert.deepEqual(await r.json(), { estado: "disparado" });
  assert.equal(falso.chamadas.length, 1);
  const { url, init } = falso.chamadas[0];
  assert.equal(url, "https://api.github.com/repos/dono-ficticio/repo-ficticio/actions/workflows/comite-aporte.yml/dispatches");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.Authorization, "Bearer token-ficticio-nao-real");
  assert.equal(init.headers["User-Agent"], "comite-aporte");
  const corpo = JSON.parse(init.body);
  assert.equal(corpo.ref, "master");
  assert.deepEqual(corpo.inputs, { modo: "aporte", pedido: cifra });
  assert.ok((await kv.get("pedido:pendente", "json")).disparado_em);
});

test("imediato com dispatch falhando: 202 na_fila, ultima_falha registrada, cron tenta de novo", async () => {
  globalThis.fetch = falso = fetchFalso(par, { status: 500 });
  const r = await post({ cifra: cifraFicticia(), imediato: true });
  assert.equal(r.status, 202);
  assert.deepEqual(await r.json(), { estado: "na_fila" });
  const est = await (await getEstado()).json();
  assert.equal(est.pendente, true);
  assert.equal(est.disparado_em, null);
  assert.match(est.ultima_falha.motivo, /HTTP 500/);
  globalThis.fetch = falso = fetchFalso(par);
  await cron(11);
  assert.equal(falso.chamadas.length, 1);
  assert.equal((await (await getEstado()).json()).ultima_falha, null);
});

test("GET estado sem pedido", async () => {
  const r = await getEstado();
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { pendente: false, recebido_em: null, disparado_em: null, ultima_falha: null });
});

test("GET estado sem JWT: 401", async () => {
  const r = await worker.fetch(new Request("https://app.exemplo.invalid/comite/estado"), env, {});
  assert.equal(r.status, 401);
});

test("GET estado com pendente nao disparado", async () => {
  await post({ cifra: cifraFicticia(), imediato: false });
  const est = await (await getEstado()).json();
  assert.equal(est.pendente, true);
  assert.ok(est.recebido_em);
  assert.equal(est.disparado_em, null);
  assert.equal("cifra" in est, false);
});

test("scheduled sem pendente em dia 11 nao chama fetch", async () => {
  await cron(11);
  assert.equal(falso.chamadas.length, 0);
});

test("scheduled sem pendente em dia 12 dispara modo registros", async () => {
  await cron(12);
  assert.equal(falso.chamadas.length, 1);
  assert.deepEqual(JSON.parse(falso.chamadas[0].init.body).inputs, { modo: "registros" });
});

test("scheduled com pendente nao disparado dispara aporte e marca disparado_em", async () => {
  const cifra = cifraFicticia();
  await post({ cifra, imediato: false });
  await cron(11);
  assert.equal(falso.chamadas.length, 1);
  assert.deepEqual(JSON.parse(falso.chamadas[0].init.body).inputs, { modo: "aporte", pedido: cifra });
  const est = await (await getEstado()).json();
  assert.equal(est.pendente, false);
  assert.ok(est.disparado_em);
});

test("pendente ja disparado nao redispara (dia 11)", async () => {
  await post({ cifra: cifraFicticia(), imediato: true });
  await cron(11);
  assert.equal(falso.chamadas.length, 1);
});

test("pendente ja disparado em dia 12: a rodada de registros acontece", async () => {
  await post({ cifra: cifraFicticia(), imediato: true });
  await cron(12);
  assert.equal(falso.chamadas.length, 2);
  assert.deepEqual(JSON.parse(falso.chamadas[1].init.body).inputs, { modo: "registros" });
});

test("dia 12 com pendente por disparar: so o aporte (a rodada de aporte ja produz os registros)", async () => {
  const cifra = cifraFicticia();
  await post({ cifra, imediato: false });
  await cron(12);
  assert.equal(falso.chamadas.length, 1);
  assert.deepEqual(JSON.parse(falso.chamadas[0].init.body).inputs, { modo: "aporte", pedido: cifra });
});

test("dispatch ok e put do KV falhando: o pedido conta como disparado, nao como falha", async () => {
  const cifra = cifraFicticia();
  await post({ cifra, imediato: false });
  const putOriginal = kv.put;
  kv.put = async (chave, ...resto) => {
    if (chave === "pedido:pendente") throw new Error("kv fora");
    return putOriginal.call(kv, chave, ...resto);
  };
  await cron(11); // nao lanca: o workflow foi disparado
  assert.equal(falso.chamadas.length, 1);
  kv.put = putOriginal;
  assert.equal(kv.dados.has("falha:ultima"), false);
});

test("imediato com dispatch ok e put do KV falhando: responde disparado", async () => {
  const putOriginal = kv.put;
  let n = 0;
  kv.put = async (chave, ...resto) => {
    if (chave === "pedido:pendente" && ++n === 2) throw new Error("kv fora");
    return putOriginal.call(kv, chave, ...resto);
  };
  const r = await post({ cifra: cifraFicticia(), imediato: true });
  kv.put = putOriginal;
  assert.equal(r.status, 202);
  assert.deepEqual(await r.json(), { estado: "disparado" });
  assert.equal(falso.chamadas.length, 1);
});

test("scheduled com dispatch falhando: registra ultima_falha e lanca", async () => {
  await post({ cifra: cifraFicticia(), imediato: false });
  globalThis.fetch = falso = fetchFalso(par, { status: 401 });
  await assert.rejects(cron(11), /HTTP 401/);
  const est = await (await getEstado()).json();
  assert.equal(est.pendente, true);
  assert.match(est.ultima_falha.motivo, /HTTP 401/);
});

test("dia BRT: 02:00 UTC do dia 13 ainda e dia 12 em BRT", async () => {
  await worker.scheduled({ scheduledTime: Date.UTC(2026, 10, 13, 2, 0, 0) }, env, {});
  assert.equal(falso.chamadas.length, 1);
});

test("rota desconhecida em /comite: 404; metodo errado: 405", async () => {
  const h = { "Cf-Access-Jwt-Assertion": jwt };
  assert.equal((await worker.fetch(new Request("https://app.exemplo.invalid/comite/outra", { headers: h }), env, {})).status, 404);
  assert.equal((await worker.fetch(new Request("https://app.exemplo.invalid/comite/pedido", { headers: h }), env, {})).status, 405);
});

test("fora de /comite: entrega os assets", async () => {
  const r = await worker.fetch(new Request("https://app.exemplo.invalid/index.html"), env, {});
  assert.equal(await r.text(), "asset");
});

test("nenhum console.* recebe a cifra nem o token", async () => {
  const vistos = [];
  const nomes = ["log", "info", "warn", "error", "debug"];
  const orig = Object.fromEntries(nomes.map((n) => [n, console[n]]));
  for (const n of nomes) console[n] = (...a) => vistos.push(a.map(String).join(" "));
  try {
    const cifra = cifraFicticia();
    await post({ cifra, imediato: true });
    globalThis.fetch = falso = fetchFalso(par, { status: 500 });
    await post({ cifra, imediato: true });
    await assert.rejects(cron(11));
    await cron(12).catch(() => {});
    const tudo = vistos.join("\n");
    assert.ok(vistos.length > 0, "controle: o Worker loga alguma coisa (status), senao o teste e vacuo");
    assert.equal(tudo.includes(cifra), false);
    assert.equal(tudo.includes("token-ficticio-nao-real"), false);
  } finally {
    Object.assign(console, orig);
  }
});

// 7a.BW.6 Task 6.4: a resposta cifrada mora no KV (repo do app e publico, Registro BW.3);
// o publicar do comite-aporte.yml grava `resposta` pela API da Cloudflare.
function getResposta({ comJwt = true, method = "GET" } = {}) {
  const headers = comJwt ? { "Cf-Access-Jwt-Assertion": jwt } : {};
  return worker.fetch(new Request("https://app.exemplo.invalid/comite/resposta", { method, headers }), env, {});
}

test("GET resposta sem nada no KV: 200 com cifra null (404 viraria erro de console no app)", async () => {
  const r = await getResposta();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(await r.json(), { cifra: null, gravada_em: null });
});

test("GET resposta devolve a cifra e a data gravadas pelo publicar", async () => {
  const cifra = cifraFicticia();
  await kv.put("resposta", JSON.stringify({ cifra, gravada_em: "2026-11-09T06:41:00Z" }));
  const r = await getResposta();
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { cifra, gravada_em: "2026-11-09T06:41:00Z" });
});

test("GET resposta sem JWT: 401, e POST: 405", async () => {
  await kv.put("resposta", JSON.stringify({ cifra: cifraFicticia(), gravada_em: "2026-11-09T06:41:00Z" }));
  assert.equal((await getResposta({ comJwt: false })).status, 401);
  assert.equal((await getResposta({ method: "POST" })).status, 405);
});

test("GET resposta com valor ilegivel no KV: cifra null, sem lancar", async () => {
  await kv.put("resposta", "isto nao e json");
  const r = await getResposta();
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { cifra: null, gravada_em: null });
});
