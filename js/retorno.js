// 7a.BY.4 — o retorno esperado nas telas (spec 7a.BY §10 e §10.1).
//
// O pipeline (repo principal, src/calculadora/retorno_esperado*.py) publica no
// portfolio.json o bloco `retorno_esperado` = {metodo_versao, medido_em,
// eixo_teto, por_ativo: {ticker: item}, placar}. Item com faixa: pessimista,
// central, otimista (frações reais ao ano, 10 anos), natureza
// ("fundamento" | "convencao"), metodo, insumos, insumos_data, preco_data,
// dispersao_1a, classe, fundamentos_velhos. Sem faixa: {sem_faixa: motivo, ...}.
//
// Três superfícies, só leitura: a seção "Retorno esperado" do dossiê, o texto
// secundário sob o ticker na resposta do Comitê (#aportar) e a linha "Régua do
// futuro" em #comite. Nenhuma tela ranqueia por retorno esperado (D3) e nenhuma
// mostra razão retorno/risco (D4). Uma casa decimal na tela.
//
// Funções puras em `window.retornoEsperado` (testáveis por page.evaluate) e o
// mixin do componente raiz em `window.retornoBloco()` (precisa de `this.json`).

(function () {
  "use strict";

  // Frase por extenso de cada motivo de `MOTIVOS_SEM_FAIXA` (Python). A
  // paridade é travada por tests/calculadora/test_retorno_motivos_paridade.py
  // no repo principal: motivo novo sem frase fica vermelho lá.
  const MOTIVOS = {
    cripto: "Sem faixa: cripto não tem lucro nem renda que ancorem uma estimativa.",
    lucro_medio_nao_positivo: "Sem faixa: o lucro médio dos últimos anos não é positivo.",
    menos_de_3_exercicios: "Sem faixa: há menos de 3 anos de balanços publicados.",
    contagem_anterior_a_evento: "Sem faixa: a contagem de ações é anterior ao último desdobramento ou bonificação.",
    sem_acoes_circulacao: "Sem faixa: falta uma contagem confiável de ações em circulação.",
    historico_curto: "Sem faixa: há menos de 12 meses de rendimentos para medir.",
    sem_classe_no_mapa: "Sem faixa: a classe deste ativo ainda não tem método nesta casa.",
    sem_preco: "Sem faixa: falta o preço de hoje.",
    sem_taxa_ntnb: "Sem faixa: falta a taxa do Tesouro IPCA+ de prazo comparável.",
    sem_deflator: "Sem faixa: a inflação do último ano ainda não foi publicada.",
    pl_nao_positivo: "Sem faixa: o patrimônio líquido não foi positivo no período.",
    moedas_misturadas: "Sem faixa: preço e balanço estão em moedas que não se convertem com fonte.",
    lucro_nominal_somado_nao_positivo: "Sem faixa: o lucro somado do período não é positivo.",
  };
  const MOTIVO_GENERICO = "Sem faixa: faltam dados para estimar este ativo hoje.";

  const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const GRAU = { inconclusivo: "inconclusiva", indicio: "com indício", consistente: "consistente" };

  // Geometria da régua: viewBox 0 0 300 40, eixo de 12 a 288 (o mesmo respiro
  // lateral da `sel-regua`), y do eixo em 20.
  const X0 = 12, X1 = 288, Y = 20;
  const TETO_PADRAO = 0.2; // spec §10.1 item 5; o valor vigente vem do payload

  const num = (x) => typeof x === "number" && Number.isFinite(x);

  // 0.0724 ⇒ "7,2"; uma casa decimal, vírgula, sinal de menos tipográfico.
  function pct1(x) {
    const s = (Math.round(x * 1000) / 10).toFixed(1).replace(".", ",");
    return s.replace(/^-/, "−");
  }

  function fraseMotivo(m) {
    return MOTIVOS[m] || MOTIVO_GENERICO;
  }

  // "2025-12-31" ⇒ "31/12/25"; "2026-11-10" ⇒ "10/11" (curta).
  function dataBR(iso, curta) {
    const m = typeof iso === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
    if (!m) return "";
    return curta ? `${m[3]}/${m[2]}` : `${m[3]}/${m[2]}/${m[1].slice(2)}`;
  }

  function temFaixa(it) {
    return !!it && !it.sem_faixa && num(it.pessimista) && num(it.central) && num(it.otimista);
  }

  function tetoDe(bloco) {
    const t = bloco && bloco.eixo_teto;
    return num(t) && t > 0 ? t : TETO_PADRAO;
  }

  function geometria(it, teto) {
    const pos = (v) => X0 + (X1 - X0) * Math.min(Math.max(v / teto, 0), 1);
    const g = {
      x1: pos(it.pessimista), x2: pos(it.otimista), xc: pos(it.central), y: Y,
      setaEsq: it.pessimista < 0, setaDir: it.otimista > teto,
      faixa: null,
    };
    if (num(it.dispersao_1a) && it.dispersao_1a > 0) {
      const a = pos(it.central - it.dispersao_1a), b = pos(it.central + it.dispersao_1a);
      g.faixa = { x: a, w: b - a };
    }
    // Rótulos do eixo: 0, metade e teto.
    g.rotulos = [0, teto / 2, teto].map((v) => `${Math.round(v * 1000) / 10}%`.replace(".", ","));
    return g;
  }

  function aria(it, teto) {
    const ponta = (v) => (v > teto ? `${pct1(v)}%, além do fim da régua` : v < 0 ? `${pct1(v)}%, aquém do início da régua` : `${pct1(v)}%`);
    let s = `Régua de 0% a ${pct1(teto).replace(",0", "")}% ao ano: estimativa entre ${ponta(it.pessimista)} e ${ponta(it.otimista)}, meio ${pct1(it.central)}%`;
    if (num(it.dispersao_1a)) s += `; num ano qualquer, cerca de ±${pct1(it.dispersao_1a)} pontos`;
    return s + ".";
  }

  function metodo(it) {
    const m = it.metodo || "";
    const ins = it.insumos || {};
    if (m === "acao_gordon") {
      const n = num(ins.exercicios) ? ins.exercicios : 5;
      return `Rendimento do lucro de ${n} anos ao preço de hoje; o que muda entre as pontas é quanto o lucro retido rende.`;
    }
    if (m === "fii_papel") return "A renda dos últimos 12 meses ao preço de hoje, descontada a inflação esperada; a ponta de baixo repete a pior queda já vista da renda.";
    if (m.startsWith("fii_")) return "A renda dos últimos 12 meses ao preço de hoje; o que muda entre as pontas é a pior queda já vista da renda e o quanto ela cresce.";
    if (m === "etf_acoes_jpm") return "A expectativa de longo prazo que a J.P. Morgan publica para a classe, descontadas a inflação e a taxa do fundo.";
    if (m === "etf_rf_ntnb") return "A taxa real do Tesouro IPCA+ de prazo próximo ao do índice, descontada a taxa do fundo.";
    return "";
  }

  // "Ver a conta": insumos e os três cenários, por extenso.
  function conta(it) {
    const m = it.metodo || "";
    const i = it.insumos || {};
    const p = (x) => (num(x) ? `${pct1(x)}%` : "sem dado");
    let insumos = [], cenarios = [], nota = "";
    if (m === "acao_gordon") {
      insumos = [
        ["Rendimento do lucro (lucro médio real ÷ valor de mercado)", p(i.y)],
        ["Parte do lucro distribuída", p(i.p)],
        ["Retorno real do patrimônio (ROE)", p(i.roe_real)],
      ];
      if (num(i.y) && num(i.p) && num(i.roe_real)) {
        // Os insumos vêm com 4 casas; refazer a conta com eles pode cair do outro lado de
        // 0,1 p.p. em relação à frase. A conta refeita só ORDENA os cenários (o pessimista
        // é o menor, o central a mediana, o otimista o maior); o valor exibido é o publicado.
        const brutos = [i.y * i.p, i.y, i.y * i.p + i.roe_real * (1 - i.p)];
        const ordem = [0, 1, 2].sort((a, b) => brutos[a] - brutos[b]);
        const publicado = [];
        [it.pessimista, it.central, it.otimista].forEach((v, k) => { publicado[ordem[k]] = v; });
        cenarios = [
          ["Só o lucro distribuído rende", p(publicado[0])],
          ["O lucro retido rende como o de hoje", p(publicado[1])],
          ["O lucro retido rende o ROE", p(publicado[2])],
        ];
      }
      nota = "As pontas são o menor e o maior dos três cenários; o meio da conta é o do meio.";
    } else if (m.startsWith("fii_")) {
      insumos = [
        ["Renda dos últimos 12 meses ÷ preço", p(i.dy12)],
        ["Pior queda da renda em 12 meses", p(i.q)],
      ];
      if (m !== "fii_papel") insumos.push(["Crescimento real da renda ao ano", p(i.crescimento_real)]);
      cenarios = m === "fii_papel"
        ? [["A pior queda da renda se repete", p(it.pessimista)], ["A renda de hoje, descontada a inflação esperada", p(it.central)]]
        : [["A pior queda da renda se repete", p(it.pessimista)], ["A renda de hoje se mantém", p(it.central)], ["A renda cresce como vinha crescendo", p(it.otimista)]];
      if (m === "fii_papel") nota = "Crédito não cresce acima da inflação: a ponta de cima é o próprio meio.";
    } else if (m === "etf_acoes_jpm" || m === "etf_rf_ntnb") {
      insumos = m === "etf_acoes_jpm"
        ? [["Expectativa da J.P. Morgan para a classe", p(i.composto)], ["Inflação esperada", p(i.inflacao)], ["Taxa do fundo", p(i.ter)]]
        : [["Taxa real do Tesouro IPCA+", p(i.taxa_real_ntnb)], ["Taxa do fundo", p(i.ter)]];
      cenarios = [["O ponto da fonte, real e sem a taxa do fundo", p(it.central)]];
      nota = `A faixa é esse ponto com ${pct1(it.central - it.pessimista)} pontos para cada lado, convenção desta casa.`;
    }
    return { insumos, cenarios, nota };
  }

  function mesAno(ym) {
    const m = typeof ym === "string" ? /^(\d{4})-(\d{2})$/.exec(ym) : null;
    return m ? `${MESES[Number(m[2]) - 1]}/${m[1]}` : "";
  }

  // 0.0812 ⇒ "0,08"; correlação, não porcentagem: duas casas.
  const ic2 = (x) => {
    const s = x.toFixed(2);
    return (s === "-0.00" ? "0.00" : s).replace(".", ",").replace(/^-/, "−");
  };

  function linhaPlacar(placar) {
    if (!placar || !num(placar.n_retratos) || placar.n_retratos < 1) return "";
    if (placar.grau === "curto" || !GRAU[placar.grau]) {
      const n = placar.n_retratos;
      const quando = mesAno(placar.primeiro_veredito);
      return `Régua do futuro: histórico curto · ${n} ${n === 1 ? "retrato" : "retratos"}${quando ? ` (primeiro veredito em ${quando})` : ""}`;
    }
    const ic = placar.ic_medio && placar.ic_medio.geral;
    const icTxt = num(ic) ? ` · IC médio ${ic2(ic)}` : "";
    const n = num(placar.n_maduros) ? ` em ${placar.n_maduros} retratos maduros` : "";
    return `Régua do futuro: ${GRAU[placar.grau]}${icTxt}${n}`;
  }

  window.retornoEsperado = { MOTIVOS, pct1, fraseMotivo, dataBR, temFaixa, geometria, aria, metodo, conta, linhaPlacar };

  window.retornoBloco = () => ({
    retornoBlocoAtual() {
      const b = this.json && this.json.retorno_esperado;
      return b && typeof b === "object" && b.por_ativo && typeof b.por_ativo === "object" ? b : null;
    },

    // Estado da seção no dossiê: "ausente" | "sem_faixa" | "faixa".
    retornoDe(ticker) {
      const b = this.retornoBlocoAtual();
      const it = b && b.por_ativo[ticker];
      if (!it) return { estado: "ausente" };
      if (!temFaixa(it)) return { estado: "sem_faixa", motivo: fraseMotivo(it.sem_faixa) };
      const teto = tetoDe(b);
      // Segmentos que não quebram por dentro (a 320 px, "10/11" ficava órfão).
      const datas = it.insumos_data
        ? [`Fundamentos de ${dataBR(it.insumos_data)}`, `preço de ${dataBR(it.preco_data, true)}`]
        : [`Preço de ${dataBR(it.preco_data, true)}`];
      return {
        estado: "faixa",
        pess: pct1(it.pessimista), cent: pct1(it.central), otim: pct1(it.otimista),
        convencao: it.natureza === "convencao",
        velhos: it.fundamentos_velhos === true
          ? `Atenção: os fundamentos são de ${dataBR(it.insumos_data)}. A estimativa pode não refletir a empresa de hoje.`
          : "",
        dispersao: num(it.dispersao_1a) ? `Num ano qualquer, este ativo variou cerca de ±${pct1(it.dispersao_1a)} pontos.` : "",
        g: geometria(it, teto),
        aria: aria(it, teto),
        metodo: metodo(it),
        datas,
        conta: conta(it),
      };
    },

    // Lido na hora de desenhar a seção (abrir o dossiê): offline, a seção diz
    // de quando é a cópia guardada.
    retornoOffline() {
      const b = this.retornoBlocoAtual();
      if (!b || navigator.onLine !== false) return "";
      const d = dataBR(b.medido_em, true);
      return d ? `Sem rede: estimativa de ${d}, a última que o aparelho guardou.` : "";
    },

    retornoLinhaAportar(ticker) {
      const b = this.retornoBlocoAtual();
      const it = b && b.por_ativo[ticker];
      if (!temFaixa(it)) return "";
      return `retorno esperado ${pct1(it.pessimista)}% a ${pct1(it.otimista)}% a.a. real`;
    },

    retornoLinhaPlacar() {
      const b = this.retornoBlocoAtual();
      return b ? linhaPlacar(b.placar) : "";
    },
  });
})();
