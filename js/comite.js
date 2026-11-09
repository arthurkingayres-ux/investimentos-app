// 7a.BW.5 — o pedido do Comitê de Aporte, no #aportar.
//
// O Dr. Arthur pede uma proposta para o valor já digitado no simulador. O
// pedido em claro (§6.1 da spec 7a.BW) é
//   {"v":1, "valor_brl", "remetido_usd"|null, "nota"|null (<= 280),
//    "criado_em": ISO-8601, "nonce": 16 bytes hex}
// e sai do aparelho só cifrado com a frase de acesso (`window.cifrar`, o
// mesmo formato de src/output/crypto.py), num POST para /comite/pedido no
// próprio Worker, atrás do Access. O Worker nunca vê o valor; o Python
// decifra na Action (src/comite/pedido.py).
//
// Sem conexão (ou se o POST não chega), o corpo JÁ CIFRADO fica guardado em
// localStorage ("comite:rascunho") e sai quando a conexão volta ou por um
// toque em "Enviar agora". Nada em claro é persistido. O rascunho expira em
// 72 h, a mesma janela que o Python aceita para `criado_em`.
//
// Mixin do componente raiz (`...window.comiteBloco()` no Alpine.data("app")):
// precisa de `this.segredo` (a frase em memória depois do desbloqueio) e do
// valor do simulador (`aporteValor`, `_parseAporteValor`, `aporteFmtBrl0`).
//
// Estados do pedido: vazio · offline_rascunho · enviando · na_fila · rodando · falha
//
// 7a.BW.6 (Task 6.6): a RESPOSTA. O Worker devolve em GET /comite/resposta
// {"cifra", "gravada_em"}; a cifra é a resposta do `publicar` (versao 1),
// cifrada com a frase, no formato de js/crypto.js. O app só pergunta quando
// há motivo (a lição da BW.5: buscar sem motivo a cada abertura derrubou a
// suíte por erro de console e sujeira de estado): (a) este aparelho enviou um
// pedido nas últimas 72 h; (b) a rota #comite foi aberta; (c) o #aportar foi
// aberto e há uma resposta guardada de antes. Guarda-se SÓ a cifra em
// localStorage ("comite:resposta"); o claro vive em memória (`comiteResposta`)
// e sai no "Bloquear sessão". A tela (pronta, outro valor, recusada, antiga,
// dado velho) é derivada da resposta, sem estado próprio.

(function () {
  "use strict";

  const CHAVE_RASCUNHO = "comite:rascunho";
  // Quando ESTE aparelho enviou o último pedido. Só com ele recente o app
  // pergunta ao Worker pelo estado: sem pedido, nada a perguntar (e nenhuma
  // leitura do KV gasta à toa).
  const CHAVE_ENVIADO = "comite:enviado_em";
  const ESTADO_JANELA_MS = 72 * 3600 * 1000;
  const NOTA_MAX = 280;
  // 47 h, e não as 72 h que o Python aceita para `criado_em`: o pedido ainda
  // espera até 24 h na fila do Worker pelo cron diário das 03:30, mais a fila
  // do próprio workflow; a hora que sobra é essa folga. Travado contra a
  // constante do Python e o cron do wrangler.jsonc em tests/comite/test_pedido.py.
  const RASCUNHO_TTL_MS = 47 * 3600 * 1000;
  // Teto do Python (src/comite/pedido.py VALOR_MAX_BRL), travado no mesmo teste.
  const VALOR_MAX_BRL = 1_000_000;
  // Disparo sem resposta conhecida há mais que isto deixa de ser "rodando".
  const RODANDO_MAX_MS = 2 * 3600 * 1000;
  // A resposta guardada (só a cifra) e a idade em que a proposta vira "antiga".
  const CHAVE_RESPOSTA = "comite:resposta";
  const ANTIGA_MS = 30 * 24 * 3600 * 1000;
  // Duas entradas seguidas na tela (boot e desbloqueio re-chamam a rota) não
  // pedem a resposta duas vezes.
  const BUSCA_INTERVALO_MS = 20 * 1000;

  // Código estável do validador → uma linha, sem jargão. Código desconhecido
  // não ganha parênteses: a linha diz só que não passou.
  const MOTIVOS = {
    MODO_DIVERGENTE: "respondeu a outra rodada",
    PROPOSTA_AUSENTE: "não trouxe proposta",
    PROPOSTA_EM_REGISTROS: "trouxe proposta numa rodada só de registros",
    ATIVO_FORA_DO_ENVELOPE: "propunha um ativo fora dos que estão abaixo do alvo",
    ATIVO_REPETIDO: "repetia um ativo na proposta",
    MAIS_DE_5: "passava de 5 ativos",
    ACIMA_DO_TETO: "levava um ativo acima do teto da faixa",
    SOMA_DIFERENTE: "a soma não fechava com o valor pedido",
    CUSTO_DIVERGENTE: "o custo declarado não batia com o recalculado",
    NUMERO_INEXISTENTE: "citava um número que não está nos dados",
    VERBO_DE_ORDEM: "falava em tom de ordem",
    TESE_QUEBRADA_SEM_AVISO: "deixava de avisar uma tese quebrada",
    REGISTRO_REPETIDO: "repetia um registro sem fato novo",
    REGISTRO_SEM_EVIDENCIA: "trazia um registro sem evidência",
    SAIDA_AUSENTE: "não respondeu a tempo",
    SAIDA_INVALIDA: "respondeu fora do formato",
    VALIDADOR_FALHOU: "a conferência falhou por erro interno",
  };

  const TIPO_REGISTRO = {
    pergunta: "Pergunta para você",
    observacao_politica: "Observação de política",
    reforco: "Reforço",
  };

  // Ajuste pós-BW.6 (08/11): o Comitê cita cada evidência pelo caminho do
  // número no envelope (ex.: diagnostico.selecao.classes.acoes_br.janelas.3a.t).
  // O caminho continua no dado (o validador e a conferência o leem); a tela
  // mostra o rótulo em português: a métrica primeiro, o contexto entre
  // parênteses, na mesma ordem e quantidade. Caminho com segmento que o mapa
  // não conhece cai num rótulo legível (sublinhado vira espaço), nunca some.
  // Texto livre (com espaço) passa como veio.
  // Chaves de topo do envelope (src/comite/envelope.py) e os blocos do
  // Diagnóstico, que o Comitê às vezes cita sem o prefixo `contexto.`.
  const EVID_RAIZ = new Set([
    "versao", "modo", "pedido", "regra", "patrimonio_brl", "patrimonio_pos_brl", "elegiveis",
    "excluidos", "contexto", "idade_fontes", "avisos", "grifo_dado_velho", "tabela_custos_medida_em",
    "anteriores", "diagnostico", "risco", "selecao", "atribuicao", "construcao", "fx_usd_brl",
    "ordens_avenue_no_mes", "dividend_yield", "estado_mes",
  ]);
  const EVID_ESTRUTURA = new Set(["contexto", "diagnostico", "escopos", "classes", "janelas", "categorias"]);
  const EVID_CONTEXTO = {
    risco: "risco",
    selecao: "seleção",
    atribuicao: "atribuição",
    construcao: "construção",
    elegiveis: "elegíveis",
    excluidos: "excluídos",
    regra: "regra",
    proposta: "proposta",
    pedido: "pedido",
    idade_fontes: "idade das fontes",
    estado_mes: "mês corrente",
    anteriores: "rodadas anteriores",
    registros: "registros",
    propostas: "propostas",
    tese: "tese",
    custo: "custo",
    concentracao: "concentração",
    queda: "queda",
    curva: "curva",
    indices: "índices",
    fontes: "fontes",
    Brasil: "Brasil",
    Total: "carteira toda",
    EUA_BRL: "EUA em reais",
    EUA_USD: "EUA em dólar",
    acoes_br: "Ações BR",
    eua: "EUA",
    fiis: "FIIs",
    renda_fixa: "renda fixa",
    "3a": "3 anos",
    "5a": "5 anos",
    "12m": "12 meses",
    desde: "desde o início",
  };
  const EVID_METRICA = {
    excesso_aa: "excesso sobre o CDI ao ano",
    excesso_medio_aa: "excesso médio ao ano",
    retorno_aa: "retorno ao ano",
    cdi_aa: "CDI ao ano",
    volatilidade_aa: "volatilidade ao ano",
    sharpe: "índice de Sharpe",
    sortino: "índice de Sortino",
    queda_maxima: "queda máxima",
    meses_queda: "meses em queda",
    meses_recuperacao: "meses até recuperar",
    recuperacao: "recuperação",
    n_meses: "meses na amostra",
    historico_curto: "histórico curto",
    diferenca_aa: "diferença sobre o índice ao ano",
    picks_aa: "retorno das escolhas ao ano",
    indice_aa: "retorno do índice ao ano",
    desvio_aa: "desvio ao ano",
    t: "estatística t",
    anos_para_afirmar: "anos para afirmar",
    grau: "grau de evidência",
    razao: "razão",
    sinais_divergem: "sinais divergentes",
    desvio: "desvio da política",
    escolhas: "efeito das escolhas",
    dolar: "efeito do dólar",
    carteira: "carteira",
    carteira_sem_dolar: "carteira sem o dólar",
    politica: "política",
    so_indices: "só os índices",
    n_efetivo: "número efetivo de ativos",
    n_ativos: "número de ativos",
    top5: "peso dos 5 maiores",
    top10: "peso dos 10 maiores",
    ter_carteira: "taxa de administração da carteira",
    ter_politica: "taxa de administração da política",
    reais_ano: "custo em reais por ano",
    correlacoes: "correlações",
    gap: "distância até o alvo",
    gap_brl: "distância até o alvo em reais",
    peso_atual: "peso atual",
    peso_alvo: "peso-alvo",
    teto_faixa: "teto da faixa",
    preco_brl: "preço em reais",
    tese_quebrada: "tese quebrada",
    veredito: "veredito da tese",
    quebra_se: "condição de quebra da tese",
    quebra_atingido: "condição de quebra atingida",
    idade_confronto_dias: "dias desde o último confronto",
    valor_brl: "valor em reais",
    remetido_usd: "já remetido em dólar",
    taxa: "câmbio",
    fx_usd_brl: "câmbio dólar/real",
    ordens_avenue_no_mes: "ordens na Avenue no mês",
    usd_ja_remetido: "dólar já remetido",
    dividend_yield: "dividend yield",
    patrimonio_brl: "patrimônio",
    patrimonio_pos_brl: "patrimônio depois do aporte",
    posicoes_ate: "posições até",
    ultima_ingestao: "última ingestão",
    dias_sem_ingestao: "dias sem ingestão",
    precos_em: "data dos preços",
    grifo_dado_velho: "dado velho",
  };

  const legivel = (seg) => seg.replace(/_/g, " ").trim();
  const PAR_CLASSES = /^[a-z_]+\|[a-z_]+$/;
  const CAMINHO = /^[A-Za-z_][A-Za-z0-9_|]*(?:\.[A-Za-z0-9_|]+|\[\d+\])+$/;

  function evidenciaLegivel(e) {
    if (typeof e !== "string") return "";
    const bruto = e.trim();
    // Só caminho: começa por letra e é feito de segmentos de palavra ligados
    // por ponto (ou índice [n]). O resto é texto livre e passa intacto:
    // "12.5%" ou "0.85x" não podem perder o inteiro (board BW.6.1), e o
    // primeiro segmento tem de ser chave do envelope: "v1.2.3" é texto.
    if (!CAMINHO.test(bruto) || !EVID_RAIZ.has(bruto.split(/[.[]/)[0])) return bruto;
    const segs = bruto.split(/[.[\]]+/).filter((s) => s && !/^\d+$/.test(s) && !EVID_ESTRUTURA.has(s));
    if (!segs.length) return bruto;
    const nomeCtx = (s) => {
      if (Object.prototype.hasOwnProperty.call(EVID_CONTEXTO, s)) return EVID_CONTEXTO[s];
      if (PAR_CLASSES.test(s)) return s.split("|").map((c) => EVID_CONTEXTO[c] || legivel(c)).join(" × ");
      if (/^[A-Z0-9]{4,7}$/.test(s)) return s; // ticker, como veio
      return legivel(s);
    };
    const tem = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    const ehCtx = (x) => tem(EVID_CONTEXTO, x) || PAR_CLASSES.test(x) || /^[A-Z0-9]{4,7}$/.test(x);
    // A métrica é o último segmento conhecido como métrica; sem nenhum, o
    // último segmento que não é contexto (par de classes, ticker) vira a
    // métrica pelo rótulo legível. O resto, na ordem, é o contexto.
    let im = -1;
    for (let i = segs.length - 1; i >= 0 && im < 0; i--) if (tem(EVID_METRICA, segs[i])) im = i;
    if (im < 0 && !ehCtx(segs[segs.length - 1])) im = segs.length - 1;
    const metrica = im >= 0 ? (EVID_METRICA[segs[im]] || legivel(segs[im])) : null;
    const ctx = segs.filter((_, i) => i !== im).map(nomeCtx).filter(Boolean);
    if (!metrica) {
      const t = ctx.join(", ");
      return t.charAt(0).toUpperCase() + t.slice(1);
    }
    const cab = metrica.charAt(0).toUpperCase() + metrica.slice(1);
    return ctx.length ? `${cab} (${ctx.join(", ")})` : cab;
  }

  const LADO_RISCO = {
    mais_risco: "Mais risco que a regra",
    menos_risco: "Menos risco que a regra",
    equivalente: "Risco parecido com o da regra",
  };

  const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

  const TEXTO = {
    enviando: "Enviando o pedido…",
    na_fila: "Pedido na fila; resposta até amanhã às 7h.",
    rodando: "O Comitê está rodando agora; a resposta chega em alguns minutos.",
    offline_rascunho: "Sem conexão; guardei o pedido. Ele sai quando a conexão voltar.",
    limite: "Limite de 3 pedidos por dia atingido. O último pedido segue valendo; amanhã dá para pedir de novo.",
    sessao: "O login do app expirou. Entre de novo e toque em Enviar de novo; o pedido está guardado.",
    expirado: "O pedido guardado tem mais de 2 dias e foi descartado. Peça de novo.",
  };

  function lerRascunho() {
    try {
      const r = JSON.parse(localStorage.getItem(CHAVE_RASCUNHO) || "null");
      if (!r || typeof r.cifra !== "string") return null;
      return r;
    } catch {
      return null;
    }
  }

  function gravarRascunho(r) {
    try {
      localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify(r));
    } catch {
      /* sem storage: o pedido só vive nesta aba */
    }
  }

  function apagarRascunho() {
    try {
      localStorage.removeItem(CHAVE_RASCUNHO);
    } catch {
      /* nada a fazer */
    }
  }

  function lerEnviadoEm() {
    try {
      const t = Date.parse(localStorage.getItem(CHAVE_ENVIADO) || "");
      return Number.isFinite(t) ? t : null;
    } catch {
      return null;
    }
  }

  function gravarEnviadoEm() {
    try {
      localStorage.setItem(CHAVE_ENVIADO, new Date().toISOString());
    } catch {
      /* sem storage: só não pergunta o estado na próxima abertura */
    }
  }

  function lerRespostaGuardada() {
    try {
      const r = JSON.parse(localStorage.getItem(CHAVE_RESPOSTA) || "null");
      return r && typeof r.cifra === "string" && r.cifra ? r : null;
    } catch {
      return null;
    }
  }

  function gravarResposta(r) {
    try {
      localStorage.setItem(CHAVE_RESPOSTA, JSON.stringify(r));
    } catch {
      /* sem storage: a resposta só vive nesta aba */
    }
  }

  function brl0(n) {
    return Number.isFinite(n) ? window.formatBrl(Math.round(n), 0) : "—";
  }

  // "2026-11-08" ou ISO completo → "08/11/2026" (data local do aparelho).
  function data(iso) {
    if (typeof iso !== "string" || !iso) return "";
    const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + "T12:00:00") : new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const p = (x) => String(x).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
  }

  // Fora do estado do Alpine (como `iniciado`): a cifra que gerou a resposta
  // em memória, a busca em voo e a hora da última busca.
  let cifraDecifrada = null;
  let buscaEmVoo = null;
  let ultimaBusca = 0;

  // Fora do estado do Alpine: o listener de "online" é do documento, uma vez
  // por carga, e uma flag reativa sobreviveria ao "Bloquear sessão" (o
  // lock-higiene.spec.ts compara o estado antes e depois).
  let iniciado = false;

  function nonceHex() {
    const b = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  }

  // "300,50" / "1.234,5" / "300.5" → número; vazio → null; inválido → NaN.
  function lerUsd(raw) {
    const s = String(raw ?? "").trim().replace(/\s/g, "").replace(/^US\$/i, "");
    if (!s) return null;
    const normal = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
    if (!/^\d+(\.\d+)?$/.test(normal)) return NaN;
    return Number(normal);
  }

  window.comiteBloco = function comiteBloco() {
    const inicial = () => ({
      comiteEstado: "vazio",
      comiteMensagem: "",
      comiteRemetido: "",
      comiteNota: "",
      comiteAgora: false,
      comiteErroCampo: "",
      comiteResposta: null,
    });
    return {
      ...inicial(),
      comiteNotaMax: NOTA_MAX,

      // Chamado por _limparEstadoSensivel (Bloquear sessão): a nota e a
      // remessa digitadas são do Dr. Arthur e não sobrevivem ao bloqueio. O
      // rascunho em localStorage fica: é só a cifra.
      _limparEstadoComite() {
        Object.assign(this, inicial());
        cifraDecifrada = null;
      },

      comiteValor() {
        return this._parseAporteValor(this.aporteValor);
      },

      comiteBotaoTexto() {
        const v = this.comiteValor();
        return v > 0 ? `Pedir proposta para ${this.aporteFmtBrl0(v)}` : "Pedir proposta";
      },

      comiteBotaoDesabilitado() {
        return this.comiteEstado === "enviando" || !(this.comiteValor() > 0) || !this.segredo;
      },

      comiteTemRascunho() {
        return this.comiteEstado === "offline_rascunho" || (this.comiteEstado === "falha" && lerRascunho() !== null);
      },

      comiteTextoReenviar() {
        return this.comiteEstado === "offline_rascunho" ? "Enviar agora" : this.comiteMensagem === TEXTO.sessao ? "Enviar de novo" : "Tentar de novo";
      },

      _comitePor(estado, mensagem) {
        this.comiteEstado = estado;
        this.comiteMensagem = mensagem ?? TEXTO[estado] ?? "";
      },

      // x-init do bloco: rascunho guardado, depois o estado do Worker.
      comiteIniciar() {
        if (iniciado) return;
        iniciado = true;
        window.addEventListener("online", () => {
          if (lerRascunho()) this.comiteReenviar();
        });
        // Destravou numa tela que mostra a resposta: decifra a guardada.
        this.$watch("segredo", (s) => {
          if (!s || (this.rota !== "aportar" && this.rota !== "comite")) return;
          const g = lerRespostaGuardada();
          if (g) this._comiteDecifrar(g.cifra);
        });
        const r = lerRascunho();
        if (r) {
          if (Date.now() - Date.parse(r.criado_em) > RASCUNHO_TTL_MS) {
            apagarRascunho();
            this._comitePor("falha", TEXTO.expirado);
          } else {
            this._comitePor("offline_rascunho");
          }
          return;
        }
        this.comiteAtualizarEstado();
      },

      async comiteAtualizarEstado() {
        if (!navigator.onLine) return;
        const enviado = lerEnviadoEm();
        if (enviado === null || Date.now() - enviado > ESTADO_JANELA_MS) return;
        try {
          const r = await fetch("./comite/estado", { cache: "no-store", redirect: "manual" });
          if (r.ok) {
            const e = await r.json();
            // Só se nada aconteceu enquanto lia.
            if (this.comiteEstado === "vazio") {
              if (e.pendente) {
                this._comitePor("na_fila");
              } else if (e.disparado_em && Date.now() - Date.parse(e.disparado_em) < RODANDO_MAX_MS) {
                this._comitePor("rodando");
              }
            }
          }
        } catch {
          /* sem estado do Worker: fica como está */
        }
        // (a) pedido recente deste aparelho: a resposta pode ter chegado.
        await this.comiteBuscarResposta(true);
      },

      // Entrada em #aportar ou #comite (chamado por atualizarRota): (b) e (c).
      comiteAoAbrir() {
        const guardada = lerRespostaGuardada();
        if (guardada) this._comiteDecifrar(guardada.cifra);
        if (this.rota === "comite" || guardada) this.comiteBuscarResposta();
      },

      async comiteBuscarResposta(forcar = false) {
        if (!navigator.onLine) return;
        if (buscaEmVoo) return buscaEmVoo;
        if (!forcar && Date.now() - ultimaBusca < BUSCA_INTERVALO_MS) return;
        ultimaBusca = Date.now();
        buscaEmVoo = (async () => {
          try {
            const r = await fetch("./comite/resposta", { cache: "no-store", redirect: "manual" });
            if (!r.ok) return;
            const corpo = await r.json();
            if (typeof corpo?.cifra !== "string" || !corpo.cifra) return;
            gravarResposta({ cifra: corpo.cifra, gravada_em: corpo.gravada_em ?? null });
            await this._comiteDecifrar(corpo.cifra);
          } catch {
            /* sem rede ou login vencido: fica a resposta guardada */
          } finally {
            buscaEmVoo = null;
          }
        })();
        return buscaEmVoo;
      },

      async _comiteDecifrar(cifra) {
        const segredo = this.segredo;
        if (!segredo || !cifra) return;
        if (this.comiteResposta && cifraDecifrada === cifra) return;
        let obj;
        try {
          obj = JSON.parse(await window.decifrar(cifra, segredo));
        } catch {
          return; // outra frase, ou cifra corrompida: não mostra nada
        }
        if (!obj || obj.versao !== 1 || this.segredo !== segredo) return;
        cifraDecifrada = cifra;
        this.comiteResposta = obj;
        // A resposta chegou depois do pedido deste aparelho: o status da fila
        // deixa de valer.
        const enviado = lerEnviadoEm();
        // Só a rodada de aporte responde ao pedido: ela é a única que troca
        // `atual`. A rodada só de registros (dia 12) tem `ultima_rodada` mais
        // nova e não pode limpar o "na fila" (CRB 7a.BW.6).
        const quando = Date.parse(obj.atual?.criado_em || "");
        if ((this.comiteEstado === "na_fila" || this.comiteEstado === "rodando") && enviado && quando >= enviado) {
          this._comitePor("vazio", "");
        }
      },

      // ── A resposta na tela (tudo derivado de `comiteResposta`) ─────────
      comiteAtual() {
        return (this.comiteResposta && this.comiteResposta.atual) || null;
      },

      comiteTemProposta() {
        const a = this.comiteAtual();
        return !!(a && a.comite);
      },

      comiteDadoVelho() {
        const a = this.comiteAtual();
        return !!(a && a.grifo_dado_velho === true);
      },

      // O plano da regra perde o grifo quando a resposta traz o seu: a razão
      // principal da proposta, ou o aviso de dado velho (um grifo por tela).
      comiteTomaGrifo() {
        return this.comiteTemProposta() || this.comiteDadoVelho();
      },

      comiteAntiga() {
        const a = this.comiteAtual();
        const t = a ? Date.parse(a.criado_em) : NaN;
        return Number.isFinite(t) && Date.now() - t > ANTIGA_MS;
      },

      comiteOutroValor() {
        const a = this.comiteAtual();
        const v = this.comiteValor();
        return !!(a && v > 0 && Number.isFinite(a.valor_pedido) && Math.round(v) !== Math.round(a.valor_pedido));
      },

      comiteFmt(n) {
        return brl0(n);
      },

      comiteData(iso) {
        return data(iso);
      },

      comiteCabecalho() {
        const a = this.comiteAtual();
        if (!a) return "";
        return `Proposta de ${data(a.criado_em).slice(0, 5)} para ${brl0(a.valor_pedido)}`;
      },

      comiteTextoOutroValor() {
        const a = this.comiteAtual();
        if (!a) return "";
        return `Esta proposta vale para ${brl0(a.valor_pedido)}; o valor acima é ${brl0(this.comiteValor())}. Para o valor novo, peça outra proposta.`;
      },

      comiteTextoAntiga() {
        const a = this.comiteAtual();
        return a ? `Proposta antiga, de ${data(a.criado_em)}; a carteira mudou desde então.` : "";
      },

      comiteTextoRecusa() {
        const a = this.comiteAtual();
        const m = a && MOTIVOS[a.motivo_recusa];
        return `O Comitê não passou na conferência${m ? ` (${m})` : ""}; esta é a regra.`;
      },

      comiteTextoIdade() {
        const a = this.comiteAtual();
        const i = (a && a.idade_fontes) || {};
        const partes = [];
        if (i.posicoes_ate) partes.push(`posições até ${data(i.posicoes_ate)}`);
        if (i.precos_em) partes.push(`preços de ${data(i.precos_em)}`);
        let t = partes.length ? `Dados com ${partes.join(" e ")}` : "";
        if (Number.isFinite(i.dias_sem_ingestao)) {
          const d = i.dias_sem_ingestao;
          t += `${t ? "; " : ""}${d} ${d === 1 ? "dia" : "dias"} sem extrato novo`;
        }
        if (!t) return "";
        if (this.comiteDadoVelho()) {
          return `Dados velhos. ${t}. A proposta usa esses números; atualize a carteira antes de remeter.`;
        }
        return `${t}.`;
      },

      // Uma linha por ativo: os do Comitê primeiro, na ordem dele; depois os
      // que só a regra põe. A diferença vai em texto, nunca só em cor.
      comiteLinhas() {
        const a = this.comiteAtual();
        if (!a) return [];
        const regra = new Map();
        for (const c of (a.regra && a.regra.categorias) || []) {
          for (const x of c.compras || []) regra.set(x.ticker, (regra.get(x.ticker) || 0) + (x.valor || 0));
        }
        const linhas = [];
        const vistos = new Set();
        for (const x of (a.comite && a.comite.ativos) || []) {
          vistos.add(x.ticker);
          linhas.push({ ticker: x.ticker, comite: x.valor_brl, regra: regra.has(x.ticker) ? regra.get(x.ticker) : null });
        }
        for (const [ticker, v] of regra) {
          if (!vistos.has(ticker)) linhas.push({ ticker, comite: null, regra: v });
        }
        for (const l of linhas) {
          if (!a.comite) l.dif = "";
          else if (l.comite == null) l.dif = "só na Regra";
          else if (l.regra == null) l.dif = "só no Comitê";
          else if (Math.abs(l.comite - l.regra) < 0.5) l.dif = "igual nos dois";
          else l.dif = l.comite > l.regra ? "Comitê põe mais" : "Comitê põe menos";
        }
        return linhas;
      },

      comiteCusto(lado) {
        const c = this.comiteAtual()?.custos;
        if (!c) return "—";
        return Number.isFinite(c[lado]) ? brl0(c[lado]) : "sem estimativa";
      },

      comiteCustoNota() {
        const medido = this.comiteAtual()?.custos?.medido_em;
        return `custo estimado; câmbio e IOF por parâmetro${medido ? ` medido em ${data(medido)}` : ""}`;
      },

      comiteEconomia() {
        const a = this.comiteAtual();
        const e = a && a.economia_brl;
        if (!a || !a.comite || !Number.isFinite(e)) return "";
        if (Math.abs(e) < 0.5) return "Os dois caminhos custam o mesmo.";
        return e > 0 ? `O caminho do Comitê custa ${brl0(e)} a menos.` : `O caminho do Comitê custa ${brl0(-e)} a mais.`;
      },

      comiteRisco() {
        const r = this.comiteAtual()?.comite?.risco_retorno;
        if (!r) return "";
        return [LADO_RISCO[r.lado], r.texto].filter(Boolean).join(". ");
      },

      comiteConfianca() {
        const c = this.comiteAtual()?.comite?.confianca;
        if (!c || !c.nivel) return "";
        return `Confiança ${c.nivel}${c.motivo ? `: ${c.motivo}` : ""}.`;
      },

      comiteAvisos() {
        const a = this.comiteAtual();
        if (!a) return [];
        return [...(a.avisos || []), ...((a.comite && a.comite.avisos) || [])].filter((x) => typeof x === "string" && x);
      },

      comiteRegistros() {
        const rs = (this.comiteResposta && this.comiteResposta.registros) || [];
        return [...rs].sort((x, y) => (Date.parse(y.criado_em) || 0) - (Date.parse(x.criado_em) || 0));
      },

      comiteTipoRegistro(tipo) {
        return TIPO_REGISTRO[tipo] || "Registro";
      },

      comiteEvidencia(e) {
        return evidenciaLegivel(e);
      },

      // Os registros da mesma rodada da proposta (mesmo dia) dão a contagem.
      comiteLinkRegistros() {
        const a = this.comiteAtual();
        const dia = a && typeof a.criado_em === "string" ? a.criado_em.slice(0, 10) : null;
        const n = dia ? this.comiteRegistros().filter((r) => String(r.criado_em || "").slice(0, 10) === dia).length : 0;
        return n > 0 ? `Anotado para a revisão estrutural (${n})` : "Registros do Comitê";
      },

      // 7a.BW.7: a linha lê `comite_placar` do payload da carteira (o backend
      // conta no livro). Payload antigo, sem a chave: linha vazia, sem cair na
      // contagem do KV. "comparavel" (inalcançável nesta fase) usa a mesma linha.
      comitePlacar() {
        const p = this.json && this.json.comite_placar;
        if (!p || !Number.isFinite(p.n_propostas)) return "";
        const n = p.n_propostas;
        const m = typeof p.desde === "string" ? /^(\d{4})-(\d{2})$/.exec(p.desde) : null;
        const mes = m ? MESES[Number(m[2]) - 1] : null;
        const desde = mes ? ` desde ${mes}/${m[1]}` : "";
        return `histórico curto · ${n} ${n === 1 ? "proposta" : "propostas"}${desde}`;
      },

      comiteUltimaRodada() {
        const u = this.comiteResposta && this.comiteResposta.ultima_rodada;
        if (!u || !u.criado_em) return "";
        const modo = u.modo === "registros" ? "só registros" : "com proposta";
        const recusa = /recusad/.test(u.estado || "") ? ", que não passou na conferência" : "";
        return `Última rodada em ${data(u.criado_em)}, ${modo}${recusa}.`;
      },

      async comiteEnviar() {
        this.comiteErroCampo = "";
        const valor = this.comiteValor();
        if (!(valor > 0) || !this.segredo) return;
        if (valor > VALOR_MAX_BRL) {
          this._comitePor("falha", "O Comitê aceita pedidos de até R$ 1.000.000. Ajuste o valor acima.");
          return;
        }
        const remetido = lerUsd(this.comiteRemetido);
        if (Number.isNaN(remetido)) {
          this.comiteErroCampo = "Valor em US$ inválido. Use só números, como 300 ou 300,50.";
          return;
        }
        const nota = this.comiteNota.trim().slice(0, NOTA_MAX) || null;
        const pedido = {
          v: 1,
          valor_brl: valor,
          remetido_usd: remetido,
          nota,
          criado_em: new Date().toISOString(),
          nonce: nonceHex(),
        };
        this._comitePor("enviando");
        let cifra;
        try {
          cifra = await window.cifrar(JSON.stringify(pedido), this.segredo);
        } catch {
          this._comitePor("falha", "Não consegui cifrar o pedido neste aparelho. Toque em Pedir proposta de novo.");
          return;
        }
        const rascunho = { cifra, imediato: Boolean(this.comiteAgora), criado_em: pedido.criado_em };
        gravarRascunho(rascunho);
        await this._comitePost(rascunho);
      },

      async comiteReenviar() {
        // Um envio por vez: o evento "online" e o toque em "Enviar agora"
        // podem chegar juntos, e cada POST gasta uma das 3 vagas do dia.
        if (this.comiteEstado === "enviando") return;
        const r = lerRascunho();
        if (!r) return;
        if (Date.now() - Date.parse(r.criado_em) > RASCUNHO_TTL_MS) {
          apagarRascunho();
          this._comitePor("falha", TEXTO.expirado);
          return;
        }
        this._comitePor("enviando");
        await this._comitePost(r);
      },

      async _comitePost(rascunho) {
        if (!navigator.onLine) {
          this._comitePor("offline_rascunho");
          return;
        }
        let resp;
        try {
          resp = await fetch("./comite/pedido", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ cifra: rascunho.cifra, imediato: rascunho.imediato }),
            redirect: "manual",
            cache: "no-store",
          });
        } catch {
          this._comitePor("offline_rascunho");
          return;
        }
        // O Access responde redirect para o login quando a sessão venceu.
        if (resp.type === "opaqueredirect" || resp.status === 401 || resp.status === 403 || (resp.status >= 300 && resp.status < 400)) {
          this._comitePor("falha", TEXTO.sessao);
          return;
        }
        if (resp.status === 429) {
          apagarRascunho();
          this._comitePor("falha", TEXTO.limite);
          return;
        }
        if (resp.status !== 202) {
          this._comitePor("falha", `O pedido não chegou ao Comitê (erro ${resp.status}). Toque em Tentar de novo.`);
          return;
        }
        apagarRascunho();
        gravarEnviadoEm();
        let corpo = {};
        try {
          corpo = await resp.json();
        } catch {
          /* 202 sem corpo: na fila */
        }
        this._comitePor(corpo.estado === "disparado" ? "rodando" : "na_fila");
      },
    };
  };
})();
