// 7a.CC — navegação em dois níveis (spec 7a.CC §5.1–§5.5).
//
// Fonte única do mapa `rota → (grupo, tela)`. A barra de baixo lista os cinco
// GRUPOS; o cabeçalho de grupo, no topo, lista as telas do grupo ativo (a
// "faixa"). `atualizarRota()` (js/app.js) continua derivando `rota` do hash e
// passa a derivar `tab` (agora o id do grupo) por este mapa.
//
// Telas-membro são as que aparecem numa faixa. Telas de push (`#ativo/:t`,
// `#/dossie/:t`, `#/dossie/:t/retorno` e os cinco capítulos do Diagnóstico) não
// são membros: não têm faixa de grupo, mostram o "←" e não entram na memória
// de tela por grupo. As três do contexto do ativo têm a faixa do ativo
// (`segmentosDoAtivo`, spec 7a.CC §5.9).
//
// Memória e origem do "voltar" vivem só em estado Alpine (não persistem entre
// recargas, não vão a localStorage) e saem no "Bloquear sessão"
// (`_limparEstadoNavegacao`, chamado por `_limparEstadoSensivel`).
//
// Mixin do componente raiz (`...window.navegacaoBloco()`). O getter
// `grupoAtual` mora em js/app.js: o spread de um objeto avalia getters uma vez
// e copiaria o valor, não o getter.

(function () {
  "use strict";

  // §5.1, verbatim, com Raio-X › Reserva e Carteira › Ativos (CC.2).
  const GRUPOS = [
    { id: "raiox", rotulo: "Raio-X", telas: [
      { rota: "", hash: "#", rotulo: "Hoje" },
      { rota: "patrimonio", hash: "#/raiox/chart", rotulo: "Histórico" },
      { rota: "reserva", hash: "#/raiox/reserva", rotulo: "Reserva" },
    ] },
    { id: "retorno", rotulo: "Retorno", telas: [
      { rota: "rentabilidade", hash: "#rentabilidade", rotulo: "Rentabilidade" },
      { rota: "proventos", hash: "#proventos", rotulo: "Proventos" },
      { rota: "dy", hash: "#/proventos/dy", rotulo: "DY" },
      { rota: "renda", hash: "#/raiox/renda", rotulo: "Renda" },
    ] },
    { id: "carteira", rotulo: "Carteira", telas: [
      { rota: "alocacao", hash: "#alocacao", rotulo: "Alocação" },
      { rota: "ativos", hash: "#/carteira/ativos", rotulo: "Ativos" },
      { rota: "olho", hash: "#olho", rotulo: "Vigília" },
    ] },
    { id: "analise", rotulo: "Análise", telas: [
      { rota: "diagnostico", hash: "#/raiox/diagnostico", rotulo: "Diagnóstico" },
      { rota: "projecao", hash: "#/raiox/projecao", rotulo: "Projeção" },
      { rota: "relatorio", hash: "#/raiox/relatorio", rotulo: "Relatório" },
    ] },
    { id: "aportar", rotulo: "Aportar", telas: [
      { rota: "aportar", hash: "#aportar", rotulo: "Sugestão" },
      { rota: "comite", hash: "#comite", rotulo: "Comitê" },
    ] },
  ];
  GRUPOS.forEach((g) => { g.telas.forEach(Object.freeze); Object.freeze(g.telas); Object.freeze(g); });
  Object.freeze(GRUPOS);

  const GRUPO_DA_ROTA = {};
  GRUPOS.forEach((g) => g.telas.forEach((t) => { GRUPO_DA_ROTA[t.rota] = g.id; }));

  function grupoDaRota(rota) {
    return Object.prototype.hasOwnProperty.call(GRUPO_DA_ROTA, rota) ? GRUPO_DA_ROTA[rota] : null;
  }

  function grupoPorId(id) {
    return GRUPOS.find((g) => g.id === id) || null;
  }

  // Hash da tela corrente como a faixa o escreve (Hoje = "#").
  function hashAtual() {
    return location.hash || "#";
  }

  // Rotas do contexto do ativo (§5.5 item 2, §5.9): Posição, Dossiê, Retorno.
  const CONTEXTO_DO_ATIVO = ["ativo", "dossie", "dossie-retorno"];
  function ehContextoDoAtivo(rota) {
    return CONTEXTO_DO_ATIVO.includes(rota);
  }

  window.navegacaoBloco = function navegacaoBloco() {
    const inicial = () => ({
      ultimaTelaDoGrupo: {}, // id do grupo → hash da última tela-membro visitada
      origemContexto: "", // hash da tela-membro de onde se entrou no ativo/dossiê
      ultimaTelaMembro: "", // hash da última tela-membro visitada
      trocaDeSegmento: false, // a última troca de rota foi entre segmentos do mesmo ativo
    });

    return {
      GRUPOS,
      ...inicial(),

      grupoDaRota,
      grupoPorId,
      ehContextoDoAtivo,

      // Ticker do contexto do ativo na rota corrente; "" fora dele.
      _tickerDoContexto() {
        if (this.rota === "ativo") return this.tickerAtual || "";
        if (this.rota === "dossie" || this.rota === "dossie-retorno") return this.dossieTicker || "";
        return "";
      },

      // §5.9: o segmento Retorno esperado aparece quando o bloco de retorno
      // seria renderizado. Medido em 18/11/2026: o predicado externo do bloco
      // (`section.dossie-retorno`) era o do corpo do dossiê, sem condição
      // própria; o estado "ausente" mostra "Retorno esperado indisponível
      // hoje." e "sem_faixa" mostra o motivo.
      // Relação entre os dois: a faixa decide ANTES de abrir o dossiê, então
      // usa o que se sabe do índice (`temDossie(t)`); a tela do retorno
      // renderiza o bloco quando o corpo do dossiê renderizaria (dossieAtual
      // carregado, sem erro, sem carga em voo; index.html) e, até lá, mostra
      // os mesmos estados de carga, erro e vazio da tela do Dossiê. Com o
      // dossiê do índice carregando bem, os dois coincidem. Consequência hoje:
      // a faixa tem três segmentos ou nenhum.
      retornoNaFaixa(ticker) {
        return this.temDossie(ticker);
      },

      // §5.9: segmentos do contexto do ativo, na ordem. Posição sempre; Dossiê
      // se há dossiê; Retorno esperado pelo predicado acima. Um segmento só
      // (sem dossiê) = a faixa não é renderizada (o index.html testa > 1).
      segmentosDoAtivo(ticker) {
        if (!ticker) return [];
        const segs = [{ rota: "ativo", rotulo: "Posição", hash: "#ativo/" + ticker }];
        if (this.temDossie(ticker)) segs.push({ rota: "dossie", rotulo: "Dossiê", hash: "#/dossie/" + ticker });
        if (this.retornoNaFaixa(ticker)) {
          segs.push({ rota: "dossie-retorno", rotulo: "Retorno esperado", hash: "#/dossie/" + ticker + "/retorno" });
        }
        return segs;
      },

      ehMembro(rota) {
        return grupoDaRota(rota) !== null;
      },

      // Grupo aceso por um capítulo do Diagnóstico (push), o único chamador:
      // ativo/dossiê preservam o grupo de origem e não passam por aqui.
      grupoPadraoDoPush() {
        return "analise";
      },

      // §5.6: "Pede atenção" no Hoje. Ordem fixa; só entra item cuja condição
      // já existe (Olho, conferência, relatório não lido). Lista vazia = o bloco
      // não existe. Lido pelo getter `pedeAtencao` de js/app.js (o spread do
      // mixin avaliaria um getter daqui uma vez só).
      pedeAtencaoItens() {
        const itens = [];
        const olho = this.olhoLinhaRaiox();
        if (olho) itens.push({ chave: "vigilia", texto: olho, href: "#olho" });
        if (this.conferenciaVisivel()) {
          itens.push({ chave: "notas", texto: this.conferenciaContagemTexto(), href: "#/raiox/reserva" });
        }
        const rel = this.relUltimoMes;
        if (rel && !this.mesLido(rel.mes)) {
          itens.push({ chave: "relatorio", texto: "Relatório de " + window.formatMesAno(rel.mes) + " saiu", href: "#/raiox/relatorio" });
        }
        return itens;
      },

      // §5.8: todas as posições, `valor_mercado_brl` decrescente, empate por
      // ticker crescente. Cópia: nunca reordena o payload. Ausente/vazio → [].
      ativosOrdenados() {
        const pos = this.json && Array.isArray(this.json.posicoes) ? this.json.posicoes : [];
        const v = (p) => (typeof p.valor_mercado_brl === "number" ? p.valor_mercado_brl : 0);
        return pos.slice().sort((a, b) => {
          const d = v(b) - v(a);
          if (d !== 0) return d;
          return a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0;
        });
      },

      _limparEstadoNavegacao() {
        Object.assign(this, inicial());
      },

      // §5.2: toque num grupo da barra. Inativo → última tela-membro visitada
      // daquele grupo nesta sessão (ou a primeira da faixa); já ativo → a
      // primeira da faixa (no Raio-X, o Hoje, com a Abertura de sempre).
      irParaGrupo(id) {
        const g = grupoPorId(id);
        if (!g) return;
        const destino = id === this.tab
          ? g.telas[0].hash
          : (this.ultimaTelaDoGrupo[id] || g.telas[0].hash);
        this.irParaTela(destino);
      },

      // Toque num item da faixa (ou destino da barra). O Hoje sai do hash por
      // `replaceState` (URL limpa, como o toque no Raio-X sempre fez); os
      // demais destinos mudam o hash e o `hashchange` chama atualizarRota().
      irParaTela(hash) {
        if (!hash || hash === "#") {
          history.replaceState(null, "", location.pathname);
          this.atualizarRota();
          this.$nextTick(() => this.iniciarAbertura());
          return;
        }
        location.hash = hash;
      },

      // A faixa rola na horizontal dentro dela mesma (Retorno não cabe em
      // 320px): traz a tela ativa inteira para a área visível. `scrollLeft` e
      // não `scrollIntoView`, que rolaria também o documento. Também publica a
      // altura do cabeçalho em `--grupo-cab-h` (scroll-margin das âncoras): 0
      // em tela de push, onde o cabeçalho de grupo está oculto.
      // 7a.CC.3: vale também para a faixa do ativo (Retorno esperado não cabe
      // em 320px); faixa oculta (display: none) mede 0 de largura e é ignorada.
      _ajustarFaixa() {
        const cab = document.querySelector(".grupo-cab");
        const h = cab ? cab.getBoundingClientRect().height : 0;
        document.documentElement.style.setProperty("--grupo-cab-h", Math.ceil(h) + "px");
        document.querySelectorAll(".faixa").forEach((faixa) => {
          const ativo = faixa.querySelector('[aria-current="page"]');
          if (!ativo) return;
          const f = faixa.getBoundingClientRect();
          if (!f.width) return;
          const a = ativo.getBoundingClientRect();
          if (a.left < f.left) faixa.scrollLeft -= f.left - a.left;
          else if (a.right > f.right) faixa.scrollLeft += a.right - f.right;
        });
      },

      // Chamado ao fim de cada `atualizarRota()` e quando a fase vira "raiox"
      // (o auto-resume deriva a rota ainda na tela de PIN). Só a sessão
      // destravada tem memória: na tela de PIN nada é gravado, e o lock zera.
      // Idempotente: rodar duas vezes na mesma rota dá o mesmo estado.
      _registrarNavegacao() {
        if (this.fase !== "raiox") return;
        if (this.ehMembro(this.rota)) {
          const hash = hashAtual();
          this.ultimaTelaDoGrupo = { ...this.ultimaTelaDoGrupo, [this.tab]: hash };
          this.ultimaTelaMembro = hash;
          this.origemContexto = "";
          return;
        }
        // Push nunca grava memória de grupo. A origem do contexto do ativo é a
        // última tela-membro antes do PRIMEIRO push (ativo → dossiê não a
        // troca); vazia num deep link.
        if (ehContextoDoAtivo(this.rota) && !this.origemContexto) {
          this.origemContexto = this.ultimaTelaMembro;
          // Deep link (sem origem): o "←" leva a Carteira › Ativos, então é a
          // Carteira que fica acesa (§5.5 item 3).
          if (!this.origemContexto) this.tab = "carteira";
        }
      },
    };
  };
})();
