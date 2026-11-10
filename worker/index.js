// 7a.BW.5: Worker investimentos-app. Serve o app (Static Assets) e, so em
// /comite/* (assets.run_worker_first), recebe o pedido do Comite de Aporte.
// 7a.BX.4: /olho tambem passa por aqui (leitura do payload do Olho).
//
// O caminho (spec 7a.BW §9.1): o app cifra o pedido com a frase de acesso e faz
// POST aqui; este Worker confere o JWT do Access, limita a 3 pedidos por dia
// (BRT) e guarda o texto cifrado no KV como "pedido pendente" (o ultimo
// substitui o anterior). O cron das 03:30 BRT (06:30 UTC) dispara o
// `workflow_dispatch` de comite-aporte.yml no repo principal com a cifra como
// input; "rodar agora" (`imediato`) dispara na hora. No dia 12 BRT, sem
// pendente por disparar, o cron dispara a rodada "so registros".
// 7a.BW.6: GET /comite/resposta entrega a resposta cifrada que o `publicar` do
// workflow grava no KV (`resposta`); o app a decifra com a frase.
// 7a.BX.4: GET /olho entrega, do mesmo jeito, o payload do Olho que o `publicar`
// do olho.yml grava no mesmo KV (chave `olho`), toda segunda.
//
// O Worker nunca ve o valor em claro e nunca loga a cifra nem o token: os logs
// levam so status HTTP.
//
// Segredos (painel/`wrangler secret`, nunca aqui): GITHUB_PAT_COMITE,
// ACCESS_AUD, ACCESS_TEAM_DOMAIN.

import { verificarAccess } from "./access.js";

const LIMITE_DIA = 3;
const MAX_CORPO = 8 * 1024;
const TTL_LIMITE_S = 2 * 24 * 3600;
const BRT_MS = -3 * 3600 * 1000; // Brasil sem horario de verao desde 2019
const RE_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const CHAVE_PENDENTE = "pedido:pendente";
const CHAVE_FALHA = "falha:ultima";
// 7a.BW.6: gravada pelo `publicar` do comite-aporte.yml pela API da Cloudflare
// (o repo do app e publico; Registro BW.3). Valor: {cifra, gravada_em}.
const CHAVE_RESPOSTA = "resposta";
// 7a.BX.4: gravada pelo `publicar` do olho.yml (src/olho/payload.py CHAVE_KV).
const CHAVE_OLHO = "olho";

function json(corpo, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function diaBrt(ms) {
  const d = new Date(ms + BRT_MS);
  return { iso: d.toISOString().slice(0, 10), dia: d.getUTCDate() };
}

export async function dispatch(inputs, env) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${env.WORKFLOW}/dispatches`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_PAT_COMITE}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      // A API do GitHub responde 403 sem User-Agent.
      "User-Agent": "comite-aporte",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: "master", inputs }),
  });
  if (!r.ok) throw new Error(`dispatch falhou: HTTP ${r.status}`);
  console.log(`dispatch ok (${inputs.modo}): HTTP ${r.status}`);
}

async function registrarFalha(env, erro) {
  await env.COMITE.put(CHAVE_FALHA, JSON.stringify({ em: new Date().toISOString(), motivo: String(erro.message ?? erro) }));
}

// Dispara o pendente. So o dispatch pode falhar "de verdade": se ele passou e
// o KV falhar ao marcar `disparado_em`, o workflow JA esta rodando, e tratar
// isso como falha faria o app dizer "na fila" e o cron redisparar o mesmo
// pedido. O caso fica no log; um redisparo pelo cron da madrugada continua
// possivel (o KV nao sabe que disparou) e a rodada duplicada e barrada na
// BW.6 pelo nonce do pedido.
//
// O `pendente` foi lido antes do dispatch e e regravado depois: um POST que
// chegue nesse intervalo e sobrescrito pela cifra antiga (o app disse "na fila"
// para ele). Aceito pelo mesmo motivo do contador: um usuario so, e o dispatch
// leva menos de um segundo.
async function dispararPendente(env, pendente) {
  await dispatch({ modo: "aporte", pedido: pendente.cifra }, env);
  pendente.disparado_em = new Date().toISOString();
  try {
    await env.COMITE.put(CHAVE_PENDENTE, JSON.stringify(pendente));
    await env.COMITE.delete(CHAVE_FALHA);
  } catch (e) {
    console.error("disparado, mas o KV nao gravou disparado_em");
  }
}

async function lerCorpo(request) {
  const texto = await request.text();
  if (new TextEncoder().encode(texto).length > MAX_CORPO) return { status: 413 };
  let corpo;
  try {
    corpo = JSON.parse(texto);
  } catch {
    return { status: 400 };
  }
  if (!corpo || typeof corpo !== "object") return { status: 400 };
  const { cifra, imediato } = corpo;
  if (typeof cifra !== "string" || cifra.length === 0 || !RE_BASE64.test(cifra)) return { status: 400 };
  if (typeof imediato !== "boolean") return { status: 400 };
  return { cifra, imediato };
}

async function postPedido(request, env) {
  const corpo = await lerCorpo(request);
  if (corpo.status) return json({ erro: corpo.status === 413 ? "corpo grande demais" : "corpo invalido" }, corpo.status);

  // Ler-somar-gravar no KV nao e atomico (e o KV e eventualmente consistente):
  // dois POSTs simultaneos podem passar do limite. Aceito: um usuario so, e o
  // app desabilita o botao e serializa o reenvio. O limite protege a cota, nao
  // e controle de acesso (esse e o Access + a cifra pela frase).
  const { iso } = diaBrt(Date.now());
  const chaveLimite = `limite:${iso}`;
  const usados = Number((await env.COMITE.get(chaveLimite)) ?? 0);
  if (usados >= LIMITE_DIA) return json({ erro: "limite diario" }, 429);
  await env.COMITE.put(chaveLimite, String(usados + 1), { expirationTtl: TTL_LIMITE_S });

  const pendente = { cifra: corpo.cifra, recebido_em: new Date().toISOString(), disparado_em: null };
  await env.COMITE.put(CHAVE_PENDENTE, JSON.stringify(pendente));

  if (corpo.imediato) {
    try {
      await dispararPendente(env, pendente);
      return json({ estado: "disparado" }, 202);
    } catch (e) {
      // Fica na fila: o cron da madrugada tenta de novo.
      console.error(`rodar agora falhou: ${e.message}`);
      await registrarFalha(env, e);
    }
  }
  return json({ estado: "na_fila" }, 202);
}

async function getEstado(env) {
  const pendente = await env.COMITE.get(CHAVE_PENDENTE, "json");
  const falha = await env.COMITE.get(CHAVE_FALHA, "json");
  return json({
    pendente: Boolean(pendente && !pendente.disparado_em),
    recebido_em: pendente?.recebido_em ?? null,
    disparado_em: pendente?.disparado_em ?? null,
    ultima_falha: falha ?? null,
  });
}

// Sem resposta (ou valor ilegivel) responde 200 com cifra null: um 404 viraria
// erro de console no app a cada abertura.
async function getCifraGravada(env, chave) {
  let gravada = null;
  try {
    gravada = await env.COMITE.get(chave, "json");
  } catch {
    gravada = null;
  }
  const cifra = typeof gravada?.cifra === "string" && gravada.cifra ? gravada.cifra : null;
  return json({ cifra, gravada_em: cifra ? (gravada.gravada_em ?? null) : null });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const ehOlho = url.pathname === "/olho" || url.pathname.startsWith("/olho/");
    if (!url.pathname.startsWith("/comite/") && !ehOlho) return env.ASSETS.fetch(request);

    const acesso = await verificarAccess(request, env);
    if (!acesso.ok) return json({ erro: "acesso negado" }, acesso.status);

    if (url.pathname === "/olho") {
      if (request.method !== "GET") return json({ erro: "metodo" }, 405);
      return getCifraGravada(env, CHAVE_OLHO);
    }
    if (url.pathname === "/comite/pedido") {
      if (request.method !== "POST") return json({ erro: "metodo" }, 405);
      return postPedido(request, env);
    }
    if (url.pathname === "/comite/estado") {
      if (request.method !== "GET") return json({ erro: "metodo" }, 405);
      return getEstado(env);
    }
    if (url.pathname === "/comite/resposta") {
      if (request.method !== "GET") return json({ erro: "metodo" }, 405);
      return getCifraGravada(env, CHAVE_RESPOSTA);
    }
    return json({ erro: "nao encontrado" }, 404);
  },

  async scheduled(event, env, ctx) {
    const { dia } = diaBrt(event.scheduledTime ?? Date.now());
    const pendente = await env.COMITE.get(CHAVE_PENDENTE, "json");
    try {
      // Exclusivo de proposito: no dia 12 com pedido por disparar, a rodada
      // de aporte ja produz os registros estrategicos (spec 7a.BW §6.5); a
      // "so registros" existe para o mes sem pedido.
      if (pendente && !pendente.disparado_em) {
        await dispararPendente(env, pendente);
      } else if (dia === 12) {
        await dispatch({ modo: "registros" }, env);
        await env.COMITE.delete(CHAVE_FALHA);
      } else {
        console.log("cron: nada a disparar");
      }
    } catch (e) {
      console.error(`cron falhou: ${e.message}`);
      await registrarFalha(env, e);
      throw e;
    }
  },
};
