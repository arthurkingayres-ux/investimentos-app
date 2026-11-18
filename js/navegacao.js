// 7a.CC — navegação em dois níveis (spec 7a.CC §5.1–§5.5).
//
// Fonte única do mapa `rota → (grupo, tela)`. A barra de baixo lista os cinco
// GRUPOS; o cabeçalho de grupo, no topo, lista as telas do grupo ativo (a
// "faixa"). `atualizarRota()` (js/app.js) continua derivando `rota` do hash e
// passa a derivar `tab` (agora o id do grupo) por este mapa.
//
// Telas-membro são as que aparecem numa faixa. Telas de push (`#ativo/:t`,
// `#/dossie/:t` e os cinco capítulos do Diagnóstico) não são membros: não têm
// faixa, mostram o "←" e não entram na memória de tela por grupo.
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

  // §5.1, verbatim. CC.2 acrescenta Raio-X › Reserva e Carteira › Ativos.
  const GRUPOS = [
    { id: "raiox", rotulo: "Raio-X", telas: [
      { rota: "", hash: "#", rotulo: "Hoje" },
      { rota: "patrimonio", hash: "#/raiox/chart", rotulo: "Histórico" },
    ] },
    { id: "retorno", rotulo: "Retorno", telas: [
      { rota: "rentabilidade", hash: "#rentabilidade", rotulo: "Rentabilidade" },
      { rota: "proventos", hash: "#proventos", rotulo: "Proventos" },
      { rota: "dy", hash: "#/proventos/dy", rotulo: "DY" },
      { rota: "renda", hash: "#/raiox/renda", rotulo: "Renda" },
    ] },
    { id: "carteira", rotulo: "Carteira", telas: [
      { rota: "alocacao", hash: "#alocacao", rotulo: "Alocação" },
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

  window.navegacaoBloco = function navegacaoBloco() {
    const inicial = () => ({
      ultimaTelaDoGrupo: {}, // id do grupo → hash da última tela-membro visitada
      origemContexto: "", // hash da tela-membro de onde se entrou no ativo/dossiê
      ultimaTelaMembro: "", // hash da última tela-membro visitada
    });

    return {
      GRUPOS,
      ...inicial(),

      grupoDaRota,
      grupoPorId,

      ehMembro(rota) {
        return grupoDaRota(rota) !== null;
      },

      // Grupo aceso por um capítulo do Diagnóstico (push), o único chamador:
      // ativo/dossiê preservam o grupo de origem e não passam por aqui.
      grupoPadraoDoPush() {
        return "analise";
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
      _ajustarFaixa() {
        const cab = document.querySelector(".grupo-cab");
        const h = cab ? cab.getBoundingClientRect().height : 0;
        document.documentElement.style.setProperty("--grupo-cab-h", Math.ceil(h) + "px");
        if (!cab) return;
        const faixa = cab.querySelector(".faixa");
        const ativo = faixa && faixa.querySelector('[aria-current="page"]');
        if (!ativo) return;
        const f = faixa.getBoundingClientRect();
        const a = ativo.getBoundingClientRect();
        if (a.left < f.left) faixa.scrollLeft -= f.left - a.left;
        else if (a.right > f.right) faixa.scrollLeft += a.right - f.right;
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
        if ((this.rota === "ativo" || this.rota === "dossie") && !this.origemContexto) {
          this.origemContexto = this.ultimaTelaMembro;
        }
      },
    };
  };
})();
