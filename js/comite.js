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
    DESVIO_SEM_MOTIVO: "trocava um ativo da regra sem dizer por quê",
    TROCA_POR_RETORNO: "trocava um ativo por retorno esperado sem cumprir as travas",
    REGISTRO_REPETIDO: "repetia um registro sem fato novo",
    REGISTRO_SEM_EVIDENCIA: "trazia um registro sem evidência",
    SAIDA_AUSENTE: "não respondeu a tempo",
    SAIDA_INVALIDA: "respondeu fora do formato",
    VALIDADOR_FALHOU: "a conferência falhou por erro interno",
  };

  // 7a.CH.1: motivos em que NÃO houve proposta para conferir — o Comitê não
  // respondeu, respondeu fora do formato, ou o validador quebrou. Não são
  // reprovação na conferência, e o resumo do acordeão não pode dizer que são.
  const SEM_CONFERENCIA = new Set(["SAIDA_AUSENTE", "SAIDA_INVALIDA", "VALIDADOR_FALHOU"]);


  const LADO_RISCO = {
    mais_risco: "Mais risco que a regra",
    menos_risco: "Menos risco que a regra",
    equivalente: "Risco parecido com o da regra",
  };

  const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  // 7a.CH.2: o cartão da aba Comitê escreve a prestação de contas por extenso
  // ("novembro de 2027") na seção dos relatórios anuais, e abreviada no cartão.
  const MESES_LONGOS = [
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
  ];

  // `desde` é "YYYY-MM": o mês mais ANTIGO do livro — `src/comite/placar.py`
  // olha qualquer linha, inclusive a rodada de registros do dia 12, não só a
  // primeira proposta pronta (que é o que `n_propostas` conta). Uma leitura só,
  // usada pelo Placar e pela prestação: duas cópias do mesmo regex divergem no
  // dia em que o contrato mudar. Formato errado ou ausente ⇒ null, e a tela
  // mostra "—" em vez de inventar mês (sem fonte = dado falso).
  function lerDesde(desde) {
    const m = typeof desde === "string" ? /^(\d{4})-(\d{2})$/.exec(desde) : null;
    if (!m) return null;
    const mes = Number(m[2]);
    if (!(mes >= 1 && mes <= 12)) return null;
    return { mes: mes - 1, ano: Number(m[1]) };
  }

  // A prestação de contas é anual e RECORRENTE: "a cada 12 meses" (decisão do
  // Dr. Arthur, 7a.CH D7, reafirmada em 27/11/2026). O que a tela mostra é o
  // PRÓXIMO aniversário de `desde` — o primeiro `desde + 12·k`, k >= 1, que
  // ainda não passou. A D7 da 7a.CH entregou `desde + 12` fixo, o que depois
  // de nov/2027 mostraria uma data passada sob o rótulo "Próxima"; a 7a.CJ
  // troca a soma única pela recorrência.
  //
  // Três regras da spec 7a.CJ §3, cada uma visível no código abaixo:
  //   - o mês do aniversário AINDA é o próximo (`>=`, não `>`): durante
  //     nov/2027 a linha diz nov/2027, e só em dez/2027 passa a nov/2028;
  //   - a comparação é por MÊS, nunca por dia — a prestação é mês/ano, sem
  //     dia, e um índice absoluto de mês (ano * 12 + mes) não tem fuso;
  //   - k começa em 1: `desde` no mês corrente ou no futuro dá `desde` + 12.
  //     A primeira prestação nunca é o próprio mês de início.
  //
  // "Hoje" é o relógio do aparelho, lido uma vez por chamada: não há data de
  // referência no payload, e o relógio local já decide o resto das datas
  // relativas do app. Nos testes ele é fixado pelo `page.clock` (ver
  // `comite-tela.spec.ts`), e por isso a função não recebe um parâmetro
  // injetável — ele seria código morto.
  function prestacao(desde) {
    const d = lerDesde(desde);
    if (!d) return null;
    const agora = new Date();
    const mesCorrente = agora.getFullYear() * 12 + agora.getMonth();
    let ano = d.ano + 1;
    while (ano * 12 + d.mes < mesCorrente) ano += 1;
    return { mes: d.mes, ano };
  }

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

  // ── 7a.CH.1: a aba Proposta ───────────────────────────────────────────
  // Brasil sem horário de verão desde 2019 — o MESMO valor e o mesmo nome do
  // Worker (worker/index.js, BRT_MS). A premissa é compartilhada: o cron do
  // Comitê roda às 03:30 BRT, e a hora que o cartão mostra tem de ser essa,
  // qualquer que seja o fuso do aparelho (ele viaja).
  const BRT_MS = -3 * 3600 * 1000;

  // A janela do §5.3: logo depois do envio o KV da Cloudflare pode ainda não
  // mostrar o pedido (consistência eventual). Nesses 2 min o aparelho que
  // pediu confia no próprio `enviado_em` — sem isso, o caminho mais comum de
  // todos (pedir e ser levado à Proposta) diria "Nenhum pedido em andamento."
  // segundos depois de ele pedir, que é o defeito de origem desta fase.
  const ACABEI_DE_PEDIR_MS = 2 * 60 * 1000;

  // A "parede" BRT: o instante deslocado, para ler dia/hora locais do Brasil
  // com os getters UTC (que não dependem do fuso do aparelho).
  function paredeBrt(ms) {
    return new Date(ms + BRT_MS);
  }

  // Próxima 03:30 BRT depois de `desdeMs`, em epoch. Igual a 03:30 do dia da
  // parede; se já passou, o dia seguinte.
  function proxima0330(desdeMs) {
    const d = paredeBrt(desdeMs);
    let alvo = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 3, 30, 0, 0) - BRT_MS;
    if (alvo <= desdeMs) alvo += 24 * 3600 * 1000;
    return alvo;
  }

  function dataBrt(ms) {
    if (!Number.isFinite(ms)) return "";
    const d = paredeBrt(ms);
    const p = (x) => String(x).padStart(2, "0");
    return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}`;
  }

  // "3h30" na hora de um dígito (o formato do mockup aprovado), "21:40" nas
  // outras. Uma regra, não uma lista de exceções.
  function horaBrt(ms) {
    if (!Number.isFinite(ms)) return "";
    const d = paredeBrt(ms);
    const h = d.getUTCHours();
    const m = String(d.getUTCMinutes()).padStart(2, "0");
    return h < 10 ? `${h}h${m}` : `${String(h).padStart(2, "0")}:${m}`;
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

  // 7a.CH.1: o timer do polling da aba Proposta. Fora do Alpine pelo mesmo
  // motivo dos de cima, e ÚNICO: `_propostaLigarPolling` sempre limpa antes de
  // criar, e o guard no corpo do tick o mata ao sair da rota.
  let propostaTimer = null;

  // 7a.CH.1: cada busca de estado leva um número de ordem. Uma resposta lenta
  // de uma busca ANTIGA não pode sobrescrever o estado que uma mais nova já
  // gravou (o polling de 20 s e uma reentrada na tela podem se cruzar).
  let propostaSeq = 0;

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
      // 7a.CH.1 — a aba Proposta. Entram em `inicial()` de propósito: é o que
      // faz o "Bloquear sessão" levá-los junto (o corpo de /comite/estado, o
      // valor decifrado do pedido e quais itens do acordeão estão abertos são
      // dado do Dr. Arthur, não preferência de UI).
      propostaWorker: null,   // corpo do GET /comite/estado desta sessão
      propostaValor: null,    // valor_brl decifrado da cifra do pendente
      propostaSemRede: false, // a última consulta ao Worker não chegou
      propostaAberta: {},     // chave da rodada → aberta no acordeão?
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
        // Invalida busca em voo: sem isto, uma resposta que chega depois do
        // "Bloquear sessão" repovoa `propostaWorker` com dado do Dr. Arthur.
        propostaSeq += 1;
      },

      comiteValor() {
        return this._parseAporteValor(this.aporteValor);
      },

      // ── 7a.CH.1: a aba Proposta ───────────────────────────────────────
      // O estado do pedido vem SEMPRE do Worker, nunca do localStorage: é
      // isso que o faz valer em qualquer aparelho (spec 7a.CH §5.3). O
      // `comiteEstado` local continua existindo só para o retorno do envio na
      // Simulação (enviando, falha, rascunho offline).

      _propostaRecebidoEm() {
        const t = Date.parse(this.propostaWorker?.recebido_em || "");
        return Number.isFinite(t) ? t : null;
      },

      _propostaDisparadoEm() {
        const t = Date.parse(this.propostaWorker?.disparado_em || "");
        return Number.isFinite(t) ? t : null;
      },

      // A resposta já cobre este pedido? `recebido_em` é `toISOString()` do
      // Worker (com milissegundos) e `criado_em` vem do `iso_z()` do Python:
      // formatos ISO diferentes comparados como STRING falhariam em silêncio,
      // e "respondido" nunca disparar deixaria o cartão preso em "sem
      // resposta" com a proposta já entregue. Date.parse nos dois lados.
      propostaRespondido() {
        const recebido = this._propostaRecebidoEm();
        const quando = Date.parse(this.comiteAtual()?.criado_em || "");
        if (recebido === null || !Number.isFinite(quando)) return false;
        return quando >= recebido;
      },

      // O "Rodar agora" não conseguiu disparar: o Worker deixa o pedido na
      // fila e registra a falha. O MOTIVO técnico fica no KV, nunca na tela.
      propostaFalhaDoAgora() {
        const recebido = this._propostaRecebidoEm();
        const falha = Date.parse(this.propostaWorker?.ultima_falha?.em || "");
        return recebido !== null && Number.isFinite(falha) && falha > recebido;
      },

      propostaFase() {
        const agora = Date.now();
        // 1. Acabei de pedir e o KV ainda não propagou (§5.3). O Worker
        //    respondeu — com sucesso e vazio —, então não é falta de rede.
        const enviado = lerEnviadoEm();
        const recebido = this._propostaRecebidoEm();
        if (recebido === null && enviado !== null && agora - enviado < ACABEI_DE_PEDIR_MS) return "na_fila";
        // 2. Não consegui conferir. O app NÃO afirma ausência de pedido.
        if (this.propostaSemRede && !this.propostaWorker) return "sem_conexao";
        // 3. O Worker diz que HÁ pedido, mas a data não parseia: não dá para
        //    datar os passos, e ainda assim afirmar "nenhum pedido" seria o
        //    defeito de origem desta fase. Vale o que o Worker afirma.
        if (recebido === null && this.propostaWorker?.pendente === true) return "na_fila";
        // 4/5. Sem pedido, fora da janela de 72 h, ou já respondido.
        if (recebido === null) return "sem_pedido";
        if (agora - recebido >= ESTADO_JANELA_MS) return "sem_pedido";
        if (this.propostaRespondido()) return "sem_pedido";
        // 5/6/7.
        if (this.propostaWorker.pendente === true) return "na_fila";
        const disparado = this._propostaDisparadoEm();
        if (disparado !== null && agora - disparado < RODANDO_MAX_MS) return "em_analise";
        return "sem_resposta";
      },

      // Quando a proposta deve estar pronta: 2 h depois do disparo, ou 2 h
      // depois da próxima 03:30 enquanto ela não aconteceu. Texto de
      // ESTIMATIVA ("prevista até"), nunca promessa.
      _propostaPrevistaMs() {
        const disparado = this._propostaDisparadoEm();
        if (disparado !== null) return disparado + RODANDO_MAX_MS;
        const recebido = this._propostaRecebidoEm() ?? lerEnviadoEm();
        if (recebido === null) return null;
        return proxima0330(recebido) + RODANDO_MAX_MS;
      },

      propostaPassos() {
        const fase = this.propostaFase();
        if (fase === "sem_pedido" || fase === "sem_conexao") return [];
        const recebido = this._propostaRecebidoEm() ?? lerEnviadoEm();
        const roda = recebido === null ? null : proxima0330(recebido);
        const prevista = this._propostaPrevistaMs();
        // Sem data não há sufixo: "Pedido recebido · " com o separador solto
        // é texto quebrado, e o caminho é alcançável (o Worker afirma
        // pendente com `recebido_em` ilegível).
        const quando = (ms) => `${dataBrt(ms)} às ${horaBrt(ms)}`;
        const passos = [
          { chave: "recebido", texto: recebido === null ? "Pedido recebido" : `Pedido recebido · ${quando(recebido)}` },
          { chave: "fila", texto: roda === null ? "Na fila" : `Na fila · roda ${quando(roda)}` },
          { chave: "analise", texto: "Em análise · até ~2 h" },
          { chave: "pronta", texto: prevista === null ? "Pronta" : `Pronta · prevista até ${quando(prevista)}` },
        ];
        // O passo corrente: na fase `na_fila` é "fila", a menos que o Worker
        // ainda não mostre o pedido (acabei de pedir), em que é "recebido".
        // O passo corrente é "recebido" só quando o WORKER ainda não mostra o
        // pedido (o fallback de 2 min). Se ele afirma `pendente`, o pedido
        // está na fila, mesmo que a data não parseie.
        let corrente = "fila";
        const esperandoOWorker = this._propostaRecebidoEm() === null && this.propostaWorker?.pendente !== true;
        if (fase === "na_fila" && esperandoOWorker) corrente = "recebido";
        else if (fase === "em_analise" || fase === "sem_resposta") corrente = "analise";
        const i = passos.findIndex((p) => p.chave === corrente);
        for (let k = 0; k < passos.length; k++) {
          passos[k].estado = k < i ? "feito" : k === i ? "corrente" : "futuro";
        }
        return passos;
      },

      propostaValorTexto() {
        return Number.isFinite(this.propostaValor) ? brl0(this.propostaValor) : "";
      },

      // "Volte a partir das 5h30 de 25/11." A data vai explícita: "amanhã"
      // fica falso na virada da meia-noite e depende do fuso do aparelho.
      propostaVolteTexto() {
        const fase = this.propostaFase();
        if (fase === "sem_pedido" || fase === "sem_conexao" || fase === "sem_resposta") return "";
        const prevista = this._propostaPrevistaMs();
        if (prevista === null) return "";
        return `Volte a partir das ${horaBrt(prevista)} de ${dataBrt(prevista)}.`;
      },

      // ── As propostas guardadas, em acordeão ───────────────────────────
      // `atual` primeiro, depois o `historico`: da mais nova para a mais
      // antiga, no máximo 12. O backend guarda `atual` MAIS até
      // MAX_HISTORICO = 12 no histórico, ou seja, 13 rodadas; o corte em 12 é
      // desta tela, e o rodapé diz isso. Entrada sem `criado_em` é
      // descartada — sem data não há cabeçalho de item.
      propostaRodadas() {
        const r = this.comiteResposta;
        if (!r) return [];
        const todas = [r.atual, ...(Array.isArray(r.historico) ? r.historico : [])];
        const vistas = new Set();
        const saida = [];
        for (const x of todas) {
          if (!x || typeof x.criado_em !== "string" || !x.criado_em) continue;
          // O backend MOVE a `atual` para o `historico` quando ela é
          // superada, então hoje não há repetida. O dedup é barato e tira a
          // classe inteira: chave repetida no x-for faz o Alpine compartilhar
          // o estado "aberta" entre dois itens.
          const chave = this.propostaChave(x);
          if (vistas.has(chave)) continue;
          vistas.add(chave);
          saida.push(x);
          if (saida.length === 12) break;
        }
        return saida;
      },

      // Chave do x-for e do mapa de abertos. O `nonce` do pedido é único por
      // rodada; o `criado_em` é a reserva para payload que não o traga.
      propostaChave(r) {
        return (r && (r.nonce || r.criado_em)) || "";
      },

      propostaCabecalhoItem(r) {
        if (!r) return "";
        const v = Number.isFinite(r.valor_pedido) ? brl0(r.valor_pedido) : "sem valor";
        return `${dataBrt(Date.parse(r.criado_em))} · ${v}`;
      },

      propostaResumo(r) {
        if (!r) return "";
        if (!r.comite) {
          // `comite: null` cobre mais do que reprovação na conferência:
          // SAIDA_AUSENTE/SAIDA_INVALIDA/VALIDADOR_FALHOU são o Comitê não ter
          // respondido a tempo, fora do formato, ou erro interno do
          // validador. Dizer "não passou na conferência" ali afirmaria um
          // motivo que o dado não sustenta; o motivo exato está no corpo do
          // item (`comiteTextoRecusa`).
          return SEM_CONFERENCIA.has(r.motivo_recusa)
            ? "Não houve proposta · valeu a regra"
            : "Não passou na conferência · valeu a regra";
        }
        const n = (r.comite.ativos || []).length;
        return `Comitê propôs · ${n} ${n === 1 ? "ativo" : "ativos"}`;
      },

      propostaEstaAberta(chave) {
        return this.propostaAberta[chave] === true;
      },

      propostaAlternar(chave) {
        this.propostaAberta = { ...this.propostaAberta, [chave]: !this.propostaEstaAberta(chave) };
      },

      propostaRodape() {
        return "Mostra as 12 mais recentes. As anteriores ficam no livro do Comitê.";
      },

      async _propostaBuscarEstado() {
        if (!navigator.onLine) {
          this.propostaSemRede = true;
          return;
        }
        const seq = ++propostaSeq;
        // Chegou tarde: outra busca, mais nova, já gravou. Descartar.
        const velha = () => seq !== propostaSeq;
        let r;
        try {
          r = await fetch("./comite/estado", { cache: "no-store", redirect: "manual" });
        } catch {
          if (!velha()) this.propostaSemRede = true;
          return;
        }
        // O Access responde redirect para o login quando a sessão venceu.
        if (!r.ok || r.type === "opaqueredirect") {
          if (!velha()) this.propostaSemRede = true;
          return;
        }
        let corpo;
        try {
          corpo = await r.json();
        } catch {
          if (!velha()) this.propostaSemRede = true;
          return;
        }
        if (velha()) return;
        this.propostaSemRede = false;
        this.propostaWorker = corpo;
        await this._propostaDecifrarValor(corpo.cifra);
        // Recheca DEPOIS do decifrar: duas buscas podem passar pelo guard e
        // terminar fora de ordem, deixando o valor da cifra antiga.
        if (velha()) this.propostaValor = null;
      },

      // A cifra do pendente, decifrada com a frase já desbloqueada. Falha em
      // silêncio (frase trocada, payload de formato antigo, base64 quebrado):
      // o cartão aparece com o estado e SEM o valor. Sem console.error — erro
      // de console derruba a suíte, e aqui não há nada a consertar.
      async _propostaDecifrarValor(cifra) {
        if (typeof cifra !== "string" || !cifra || !this.segredo) {
          this.propostaValor = null;
          return;
        }
        const segredo = this.segredo;
        let obj;
        try {
          obj = JSON.parse(await window.decifrar(cifra, segredo));
        } catch {
          this.propostaValor = null;
          return;
        }
        if (this.segredo !== segredo) return; // bloqueou enquanto decifrava
        this.propostaValor = obj && obj.v === 1 && Number.isFinite(obj.valor_brl) ? obj.valor_brl : null;
      },

      async propostaAoAbrir() {
        await this._propostaBuscarEstado();
        await this.comiteBuscarResposta(true);
        this._propostaLigarPolling();
      },

      // UM mecanismo, de propósito. Havia dois (este guard e um $watch de
      // `rota`), e medido em 25/11/2026 cada um passava sozinho: o teste "sair
      // da Proposta mata o polling" só ficava vermelho com os DOIS mutados, ou
      // seja, nenhum dos dois estava trancado. Com um só, reverter esta linha
      // fica vermelho — que é o ponto de ter o teste.
      _propostaLigarPolling() {
        this._propostaPararPolling();
        if (this.propostaFase() === "sem_pedido") return;
        propostaTimer = setInterval(() => {
          if (this.rota !== "proposta") {
            this._propostaPararPolling();
            return;
          }
          this._propostaBuscarEstado();
          this.comiteBuscarResposta(true);
        }, BUSCA_INTERVALO_MS);
      },

      _propostaPararPolling() {
        if (propostaTimer !== null) {
          clearInterval(propostaTimer);
          propostaTimer = null;
        }
      },

      // 7a.CH.1: o rotulo do botao e fixo ("Pedir proposta"); o valor e o
      // quando vao no SUBTITULO, e o interruptor ao lado diz se roda ja.
      comiteSubtitulo() {
        const v = this.comiteValor();
        if (!(v > 0)) return "";
        return `${this.aporteFmtBrl0(v)} · ${this.comiteAgora ? "roda já" : "roda às 3h30"}`;
      },

      comiteAjudaPedido() {
        if (!(this.comiteValor() > 0)) return "Digite o valor acima para pedir uma proposta.";
        const quando = this.comiteAgora
          ? "Roda assim que você pedir (pode falhar se você estiver usando o Claude, porque a cota é a mesma)."
          : "O Comitê roda às 3h30.";
        return `${quando} Ao pedir, você vai para a aba Proposta.`;
      },

      comiteAgoraDesabilitado() {
        return !(this.comiteValor() > 0) || this.comiteEstado === "enviando";
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

      // 7a.CH.1: as funcoes de exibicao recebem a RODADA. O default
      // `comiteAtual()` mantem os chamadores antigos; o acordeao da aba
      // Proposta passa cada uma das 12 rodadas guardadas.
      comiteTemProposta(r = this.comiteAtual()) {
        return !!(r && r.comite);
      },

      comiteDadoVelho(r = this.comiteAtual()) {
        return !!(r && r.grifo_dado_velho === true);
      },

      comiteFmt(n) {
        return brl0(n);
      },

      comiteData(iso) {
        return data(iso);
      },

      comiteTextoRecusa(r = this.comiteAtual()) {
        const a = r;
        const m = a && MOTIVOS[a.motivo_recusa];
        return `O Comitê não passou na conferência${m ? ` (${m})` : ""}; esta é a regra.`;
      },

      comiteTextoIdade(r = this.comiteAtual()) {
        const a = r;
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
        if (this.comiteDadoVelho(r)) {
          return `Dados velhos. ${t}. A proposta usa esses números; atualize a carteira antes de remeter.`;
        }
        return `${t}.`;
      },

      // Uma linha por ativo: os do Comitê primeiro, na ordem dele; depois os
      // que só a regra põe. A diferença vai em texto, nunca só em cor.
      comiteLinhas(r = this.comiteAtual()) {
        const a = r;
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

      comiteCusto(lado, r = this.comiteAtual()) {
        const c = r?.custos;
        if (!c) return "—";
        return Number.isFinite(c[lado]) ? brl0(c[lado]) : "sem estimativa";
      },

      comiteCustoNota(r = this.comiteAtual()) {
        const medido = r?.custos?.medido_em;
        return `custo estimado; câmbio e IOF por parâmetro${medido ? ` medido em ${data(medido)}` : ""}`;
      },

      comiteEconomia(r = this.comiteAtual()) {
        const a = r;
        const e = a && a.economia_brl;
        if (!a || !a.comite || !Number.isFinite(e)) return "";
        if (Math.abs(e) < 0.5) return "Os dois caminhos custam o mesmo.";
        return e > 0 ? `O caminho do Comitê custa ${brl0(e)} a menos.` : `O caminho do Comitê custa ${brl0(-e)} a mais.`;
      },

      comiteRisco(r = this.comiteAtual()) {
        const rr = r?.comite?.risco_retorno;
        if (!rr) return "";
        return [LADO_RISCO[rr.lado], rr.texto].filter(Boolean).join(". ");
      },

      comiteConfianca(r = this.comiteAtual()) {
        const c = r?.comite?.confianca;
        if (!c || !c.nivel) return "";
        return `Confiança ${c.nivel}${c.motivo ? `: ${c.motivo}` : ""}.`;
      },

      comiteAvisos(r = this.comiteAtual()) {
        const a = r;
        if (!a) return [];
        return [...(a.avisos || []), ...((a.comite && a.comite.avisos) || [])].filter((x) => typeof x === "string" && x);
      },

      // 7a.CH.2: `comiteRegistros`, `comiteTipoRegistro` e `comiteEvidencia`
      // saíram com a lista da tela (e com elas o mapa de tipos e todo o
      // aglomerado de leitura de evidências). `comiteResposta.registros`
      // continua no payload e no livro: a prestação anual (fase 5) o lê de
      // novo, e o código apagado está no histórico do git.

      // 7a.CH.2: o cartão da aba Comitê. Os três números vêm todos de
      // `json.comite_placar` (o backend conta no livro); nenhum é fixo no
      // código, e payload antigo sem a chave mostra "—" em vez de número
      // inventado. Substitui a linha única `comitePlacar()` da 7a.BW.7.
      _comitePlacarDado() {
        const p = this.json && this.json.comite_placar;
        return p && Number.isFinite(p.n_propostas) ? p : null;
      },

      comitePropostasNoLivro() {
        const p = this._comitePlacarDado();
        return p ? String(p.n_propostas) : "—";
      },

      // "Sem veredito" é VALOR FIXO desta fase, de propósito: a spec §5.4 manda
      // esta frase e só ela, e o veredito é a fase 5. `p.estado` (que o backend
      // vira para "comparavel" aos 36 meses) ainda não é lido aqui — quando a
      // fase 5 ramificar por ele, o teste "estado comparavel ainda diz 'Sem
      // veredito'" (comite-tela.spec.ts) fica vermelho — é o aviso que se quer.
      // `desde` ausente: sem o mês, só a janela.
      comitePlacarTexto() {
        const p = this._comitePlacarDado();
        if (!p) return "—";
        const d = lerDesde(p.desde);
        const partir = d ? ` a partir de ${MESES[d.mes]}/${d.ano}` : "";
        return `Sem veredito · série curta (36 meses${partir})`;
      },

      comitePrestacao() {
        const p = this._comitePlacarDado();
        const q = p ? prestacao(p.desde) : null;
        return q ? `${MESES[q.mes]}/${q.ano}` : "—";
      },

      comitePrestacaoLonga() {
        const p = this._comitePlacarDado();
        const q = p ? prestacao(p.desde) : null;
        return q ? `${MESES_LONGOS[q.mes]} de ${q.ano}` : "";
      },

      // A fase 5 preenche esta seção com os relatórios de verdade; até lá, o
      // estado vazio com a data derivada — ou sem ela, quando não há `desde`.
      comiteRelatoriosVazio() {
        const longa = this.comitePrestacaoLonga();
        return longa ? `Nenhum ainda. O primeiro chega em ${longa}.` : "Nenhum ainda.";
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
        // 7a.CH.1 (§5.2 item 5): enviado com sucesso, o app leva a aba
        // Proposta, onde o estado do pedido vive. O guard da rota importa: o
        // reenvio automatico do evento "online" pode disparar com ele em
        // qualquer tela, e arrasta-lo dali seria pior do que nao navegar.
        if (this.rota === "aportar") this.irParaTela("#/aportar/proposta");
      },
    };
  };
})();
