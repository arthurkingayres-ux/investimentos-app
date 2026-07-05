const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FAIL_WINDOW_MS = 30 * 60 * 1000;
const BLOCK_5_MS = 5 * 60 * 1000;
const BLOCK_15_MS = 15 * 60 * 1000;
const BLOCK_60_MS = 60 * 60 * 1000;

// 7a.G.2 Pass 1 (colorize): cores resolvidas a partir dos tokens CSS em :root.
// Lê via getComputedStyle pra que o JS consuma a mesma source-of-truth do CSS.
const css = (token, fallback = "") =>
  getComputedStyle(document.documentElement).getPropertyValue(token).trim() || fallback;

// 7a.L.2.b: utilitárias puras (top-level, fora do Alpine.data) para o card
// "Período" do #rentabilidade. Newton-Raphson XIRR é fechado em ~5ms para
// janelas mensais típicas (84 anchors). Convenção de sinal igual a
// calcular_xirr_from_flows do backend: aporte = negativo, retirada = positiva.
function newtonRaphsonXirr(flows, guess = 0.10, maxIter = 50, tol = 1e-7) {
  if (!Array.isArray(flows) || flows.length < 2) return null;
  const d0 = flows[0][0];
  // Requer pelo menos um valor negativo E um positivo, senão XIRR é indefinida.
  let temNeg = false, temPos = false;
  for (const [, v] of flows) {
    if (v < 0) temNeg = true;
    if (v > 0) temPos = true;
  }
  if (!temNeg || !temPos) return null;
  let rate = (typeof guess === "number" && isFinite(guess)) ? guess : 0.10;
  for (let i = 0; i < maxIter; i++) {
    let npv = 0, dnpv = 0;
    for (const [d, v] of flows) {
      const dt = (d - d0) / (1000 * 60 * 60 * 24) / 365.25;
      const base = 1 + rate;
      if (base <= 0) return null;
      const denom = Math.pow(base, dt);
      npv += v / denom;
      dnpv += -dt * v / Math.pow(base, dt + 1);
    }
    if (Math.abs(dnpv) < 1e-12) return null;
    const newRate = rate - npv / dnpv;
    if (!isFinite(newRate)) return null;
    if (Math.abs(newRate - rate) < tol) return newRate;
    rate = newRate;
    if (Math.abs(rate) > 10) return null;
  }
  return null;
}

function parseMesData(yyyymm) {
  if (!yyyymm || typeof yyyymm !== "string") return null;
  const [ano, mes] = yyyymm.split("-").map(Number);
  if (!ano || !mes) return null;
  // new Date(y, m, 0) = último dia do mês m (1-indexed) — espelha
  // parseAnchor de hidratarRentabilidade. Garante consistência com L.1.
  return new Date(ano, mes, 0);
}

function construirFlows(hist, iA, iB) {
  // Constrói série de fluxos para XIRR: nav inicial negativo (preço pago pra
  // "comprar" a posição no anchor A), cashflows intermediários (aporte=neg,
  // retirada=pos — convenção já vinda do backend), nav final positivo
  // (resgate hipotético no anchor B).
  if (!hist || iB <= iA) return [];
  const flows = [];
  const dA = parseMesData(hist[iA].data);
  if (!dA) return [];
  flows.push([dA, -(hist[iA].nav || 0)]);
  for (let i = iA + 1; i < iB; i++) {
    const cf = hist[i].cashflow;
    if (cf) {
      const d = parseMesData(hist[i].data);
      if (d) flows.push([d, cf]);
    }
  }
  const dB = parseMesData(hist[iB].data);
  if (!dB) return [];
  flows.push([dB, hist[iB].nav || 0]);
  return flows;
}

function flowsBenchmark(hist, iA, iB, growthOf) {
  // Flows do benchmark: substitui nav portfolio por "nav hipotético se cada
  // aporte tivesse sido investido no índice na data do aporte". Escala o nav
  // inicial pelo crescimento do índice de iA→iB, e cashflows intermediários
  // pelo crescimento do índice de cada mês→iB.
  // 7a.E.26: growthOf é um accessor de growth por ponto. Default = benchmark_growth
  // (principal/CDI) preserva o caminho single (EUA + callers legados). Para
  // IBOV/SP500, o caller passa (p) => (p.benchmarks_growth||{})[idx] — senão o
  // XIRR seria computado contra o growth do CDI.
  growthOf = growthOf || ((p) => p.benchmark_growth);
  if (!hist || iB <= iA) return [];
  const growthA = growthOf(hist[iA]);
  const growthB = growthOf(hist[iB]);
  if (!growthA || !growthB) return [];

  const flows = [];
  const dA = parseMesData(hist[iA].data);
  if (!dA) return [];
  // Investimento inicial — mesmo nav portfolio (capital aplicado no início).
  flows.push([dA, -(hist[iA].nav || 0)]);
  // Cashflows intermediários: aporte real (mantém sinal/magnitude).
  for (let i = iA + 1; i < iB; i++) {
    const cf = hist[i].cashflow;
    if (cf) {
      const d = parseMesData(hist[i].data);
      if (d) flows.push([d, cf]);
    }
  }
  // Terminal: nav inicial cresce a growthB/growthA; cada aporte intermediário
  // cresce a growthB/growth[i]. Soma e injeta como flow positivo em iB.
  const dB = parseMesData(hist[iB].data);
  if (!dB) return [];
  let terminal = (hist[iA].nav || 0) * (growthB / growthA);
  for (let i = iA + 1; i < iB; i++) {
    const cf = hist[i].cashflow;
    if (cf) {
      const gi = growthOf(hist[i]);
      if (gi) {
        // cashflow já vem com convenção "aporte=neg" → inverte sinal para
        // "valor investido" (positivo) antes de escalar.
        terminal += (-cf) * (growthB / gi);
      }
    }
  }
  flows.push([dB, terminal]);
  return flows;
}

function gerarTituloPeriodo(hist, iA, iB) {
  if (!hist || hist.length === 0) return "Origem";
  if (iA === 0 && iB === hist.length - 1) return "Origem";
  const fmt = (yyyymm) => {
    if (!yyyymm) return "";
    const [ano, mes] = yyyymm.split("-");
    const meses = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
    const idx = parseInt(mes, 10) - 1;
    if (idx < 0 || idx > 11) return yyyymm;
    return `${meses[idx]}/${ano.slice(2)}`;
  };
  return `Período · ${fmt(hist[iA].data)} → ${fmt(hist[iB].data)}`;
}

// 7a.S.3 Task 1: "símbolo só no último ponto" — a série principal (linha)
// não desenha marcador em cada ponto ("colar de contas"); só o ponto mais
// recente ganha um marcador discreto (círculo vazado, não celebratório —
// DESIGN.md anti-pattern #20) + rótulo do valor acima. Usa markPoint em vez
// de per-point symbol callback: mais simples de recomputar a cada zoom
// (L.1 já reancora a série; aqui só recalculamos coord+label do markPoint).
// Benchmarks NUNCA recebem markPoint (função não é chamada para eles).
function ultimoIndiceValido(dataArr) {
  if (!Array.isArray(dataArr)) return -1;
  for (let i = dataArr.length - 1; i >= 0; i--) {
    if (dataArr[i] !== null && dataArr[i] !== undefined) return i;
  }
  return -1;
}

// 7a.S.3 Task 2: "eixo Y ancorado nos dados" — a curva de equity (patrimônio)
// NÃO é zero-anchored (min:0 esconderia a variação real, que nesse domínio
// nunca é perto de zero). Folga honesta: ~12% abaixo / ~14% acima do range
// combinado de todas as séries visíveis (mesma fórmula do mockup Monument:
// lo = min − span*0.12, hi = max + span*0.14). Barras (proventos) NÃO usam
// isso — ficam zero-anchored (padrão ECharts, sem min explícito).
function calcularEixoYAncorado(...arrays) {
  const vals = [].concat(...arrays).filter((v) => v !== null && v !== undefined && isFinite(v));
  if (vals.length === 0) return { min: undefined, max: undefined, cruzaZero: false };
  const menor = Math.min(...vals);
  const maior = Math.max(...vals);
  const span = (maior - menor) || Math.max(Math.abs(maior), 1) * 0.1;
  const min = menor - span * 0.12;
  const max = maior + span * 0.14;
  return { min, max, cruzaZero: min < 0 && max > 0 };
}

// 7a.S.3 Task 3: "barra parcial hachurada" — a última barra de cada série de
// proventos (ano corrente em Anual, mês corrente em Mensal) está por
// definição incompleta (ainda acumulando). Hachura + opacity reduzida
// sinalizam "honestidade de dado" sem esconder o valor parcial. Padrão
// diagonal espelha o SVG do mockup Monument (rotation 45°, traço fino).
const DECAL_PARCIAL = {
  symbol: "rect",
  dashArrayX: [1, 0],
  dashArrayY: [3, 4],
  rotation: Math.PI / 4,
  color: "rgba(255,255,255,0.55)",
};

// 7a.S.3 Task 4: "scrubber-instrumento" — restyle do dataZoom nativo do
// ECharts (patrimônio + rentabilidade). Trilho fino cor da marca, alças
// discretas (círculo simples em vez do ícone-ampulheta default), sem o
// chrome pesado default (dataBackground/selectedDataBackground — a
// silhueta em miniatura dos dados — e showDetail — bolha com valor bruto
// durante o drag). NÃO porta o overlay HTML custom do mockup (.zoomtrack
// com ticks de ano + bolha de mês na alça) — exigiria reescrever o listener
// de zoom e arriscaria quebrar o reancoramento L.1; fica como follow-up
// (ver relato da sub-fase). minValueSpan:1 é só a guarda mínima (não deixa
// zoom colapsar pra 1 ponto) — valor conservador pra não colidir com a
// fixture de teste sintética (6 pontos esparsos); dados reais mensais têm
// dezenas/centenas de pontos onde essa guarda nunca bina.
function criarDataZoomInstrumento(dc) {
  const hidden = { lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 } };
  return [
    { type: "inside", start: 0, end: 100, minValueSpan: 1 },
    {
      type: "slider",
      height: 8,
      bottom: 6,
      start: 0,
      end: 100,
      minValueSpan: 1,
      backgroundColor: COLORS.g700a06(),
      fillerColor: COLORS.g700a12(),
      borderColor: "transparent",
      brushSelect: false,
      showDetail: false,
      dataBackground: hidden,
      selectedDataBackground: hidden,
      handleIcon: "circle",
      handleSize: 14,
      handleStyle: { color: dc.tokens.g700, borderColor: "#fff", borderWidth: 1, opacity: 0.95 },
      moveHandleSize: 4,
      moveHandleStyle: { color: dc.tokens.g700, opacity: 0.35 },
      textStyle: { color: dc.tokens.gray, fontSize: 10 },
    },
  ];
}

function criarMarkPointUltimo(dataArr, formatFn, cor, fontFamily) {
  const idx = ultimoIndiceValido(dataArr);
  if (idx === -1) return { data: [] };
  const valor = dataArr[idx];
  return {
    symbol: "circle",
    symbolSize: 8,
    itemStyle: { color: "#fff", borderColor: cor, borderWidth: 2.5 },
    label: {
      show: true,
      position: "top",
      distance: 8,
      color: cor,
      fontWeight: 700,
      fontSize: 11,
      fontFamily: fontFamily,
      formatter: () => formatFn(valor),
    },
    animation: false,
    data: [{ coord: [idx, valor] }],
  };
}

const COLORS = {
  g700:      () => css("--g-700", "#047857"),
  g700a06:   () => css("--g-700-06", "rgba(4, 120, 87, 0.06)"),
  g700a12:   () => css("--g-700-12", "rgba(4, 120, 87, 0.12)"),
  blue700:   () => css("--blue-700", "#1d4ed8"),
  blue500:   () => css("--blue-500", "#0284c7"),
  purple500: () => css("--purple-500", "#a855f7"),
  amber:     () => css("--amber", "#f59e0b"),
  amber700:  () => css("--amber-700", "#b45309"),
  red:       () => css("--red", "#b91c1c"),
  ink:       () => css("--ink", "#1a1d1c"),
  gray:      () => css("--gray", "#5b605a"),
  // 7a.E.20.1: tokens semânticos de categoria (fonte única em :root).
  // 7a.M.1: +Renda Fixa BR (5ª categoria).
  catAcoesBr:    () => css("--cat-acoes-br",      "#047857"),
  catEua:        () => css("--cat-eua",           "#1e6091"),
  catFii:        () => css("--cat-fii",           "#b8731f"),
  catCripto:     () => css("--cat-cripto",        "#6d4ea8"),
  catRendaFixaBr: () => css("--cat-renda-fixa-br", "#0e7490"),
};

document.addEventListener("alpine:init", () => {
  Alpine.data("app", () => ({
    fase: "pin",
    rota: "",
    tab: "raiox",
    tickerAtual: "",
    // 7a.S.5: hero de facetas — índice ativo (0..3) + labels estáticos (usados
    // tanto pelo eyebrow quanto pelo aria-label dos facet-dots). heroFacetHintGone
    // reflete sessionStorage.heroFacetHintSeen (1×/sessão, como heroCountUpDone).
    heroFacetAtivo: 0,
    heroFacetHintGone: false,
    heroFacetLabels: [
      "Patrimônio total",
      "Divisão Brasil · EUA",
      "Variação · 7 dias",
      "Desde a origem",
    ],
    // CRB 7a.S.5 — re-entrância de _renderHeroFace: geração da troca +
    // handles de timers/RAF em voo (ver comentários na própria função).
    _heroFaceGen: 0,
    _heroEyebrowSwapTimeout: null,
    _heroFaceRafOuter: null,
    _heroFaceRafInner: null,
    _heroSettleTimeout: null,
    // 7a.Q.3 — Relatório Mensal (payloads cifrados separados do portfolio.json)
    relIndice: null,        // {schema, atualizado_em, meses:[…]} | null
    relMes: null,           // artefato relatorio_mensal_v1 do mês carregado | null
    relMesAtual: "",        // 'YYYY-MM' atualmente renderizado
    relRotaMes: null,       // mês pedido pela rota (#/raiox/relatorio/:mes) | null
    relCarregando: false,   // decifra do mês em andamento
    relErro: "",            // mensagem de erro de arquivo/decifra
    relSeletorAberto: false,// dropdown de meses aberto/fechado
    pin: "",
    pinError: "",
    carregando: false,
    json: null,
    agora: Date.now(),
    pinBlockUntil: 0,
    shake: false,
    toast: { visible: false, mensagem: "", tom: "verde", timer: null },
    agoraTimer: null,
    escopoAtivo: "Total",
    moeda: localStorage.getItem("moedaEUA") || "BRL",
    // 7a.E.31: tela #alocação unificada — uma lista de cards de categoria
    // colapsáveis. catAberta mapeia nome→bool; todas começam fechadas (map
    // vazio = false). Não-persistente (reseta no reload), preservado ao
    // trocar de aba (vive só em memória Alpine).
    catAberta: {},
    proventosToggle: "origem",
    proventosMesSelecionado: null, // 7a.E.18: índice em mensal_12m ou null
    // 7a.S.7b: linha-razão do card do chart (= soma exata das barras exibidas;
    // troca com o toggle Anual/Mensal). Ver renderProventosGrafico().
    proventosTotalLabel: "",
    proventosTotalValor: 0,
    // 7a.S.7b: categoria (acao_br/fii/eua) do pódio de campeões em #s-dy.
    dySelecionado: null,
    _escListenerProventos: null,
    // 7a.L.1: sub-título do chart #rentabilidade (atualizado por dataZoom)
    rentabilidadeSubtitulo: "",
    // 7a.L.2.b: estado do 4º card "Período" sob #rentabilidade. fimIdx=null
    // = card oculto (default). Populado por recomputarPeriodo a cada datazoom
    // ou após hidratarRentabilidade.
    periodoCustom: {
      iniIdx: 0,
      fimIdx: null,
      twr: null,
      xirr: null,
      benchExtras: [],
      titulo: "Origem",
    },
    // 7a.H.1: estado da tela #aportar
    aporteValor: "",
    aporteBanner: null,
    aporteCategoriasRecebedoras: [],
    aporteCategoriasNaoRecebedoras: [],
    aportePausados: [],
    aporteTickersSemPosicao: [],

    async init() {
      this.pinBlockUntil = Number(localStorage.getItem("pinBlockUntil")) || 0;
      this.agoraTimer = setInterval(() => { this.agora = Date.now(); }, 1000);
      // 7a.E.17: cleanup de chaves legadas do toggle de #politica (versões
      // anteriores persistiam o estado collapsed por categoria).
      try {
        ["Ações BR", "Cripto", "EUA", "FIIs"].forEach((cat) =>
          localStorage.removeItem("politica.collapsed." + cat)
        );
      } catch (_) {}
      window.addEventListener("storage", (e) => {
        // Multi-tab sync: se outra aba limpou a sessão, esta aba cai para PIN.
        if (e.key === "pin" && e.newValue === null && this.fase === "raiox") {
          this.fase = "pin";
          this.rota = "";
          this.json = null;
          this.pin = "";
          this.pinError = "";
        }
      });
      window.addEventListener("hashchange", () => this.atualizarRota());
      this.atualizarRota();
      // 7a.I.6: posiciona indicator. A tab-bar só vira DOM quando fase virar
      // 'raiox' (template x-if), então também observamos `fase`.
      this.$nextTick(() => this.updateTabIndicator());
      this.$watch("fase", () => this.$nextTick(() => this.updateTabIndicator()));
      this.$watch("tab", () => this.$nextTick(() => this.updateTabIndicator()));
      // Resize debounce via rAF: teclado virtual mobile dispara dezenas de eventos
      // — coalesce em 1 update por frame evita layout thrashing.
      let resizeRaf = 0;
      window.addEventListener("resize", () => {
        if (resizeRaf) return;
        resizeRaf = requestAnimationFrame(() => {
          resizeRaf = 0;
          this.updateTabIndicator();
        });
      });
      await this.tentarAutoResume();
    },

    atualizarRota() {
      // 7a.I.1/7a.I.4: deriva tab top-level (1 de 5) de rota. Hash pode trazer
      // querystring (ex.: `#alocacao?v=alvo`) — separamos `path` e `params`.
      // #ativo/:ticker é push e PRESERVA a tab anterior (não reseta).
      // 7a.I.5: rotas push-child usam `/` líder no path (ex.: `/raiox/chart`)
      // — `replace(/^#/, "")` mantém a barra. Rotas top-level são sem barra.
      const raw = (location.hash || "").replace(/^#/, "");
      const qIdx = raw.indexOf("?");
      const path = qIdx === -1 ? raw : raw.slice(0, qIdx);
      const params = new URLSearchParams(qIdx === -1 ? "" : raw.slice(qIdx + 1));
      if (path === "") { this.rota = ""; this.tab = "raiox"; return; }
      if (path === "rentabilidade") {
        this.rota = "rentabilidade";
        this.tab = "rentab";
        // Hidrata o gráfico após Alpine renderizar a section.
        setTimeout(() => this.hidratarRentabilidade(), 0);
        return;
      }
      if (path === "alocacao") {
        // 7a.E.31: vista única. Sem ?v= (segmented Atual/Alvo removido). As
        // categorias começam fechadas; catAberta vive em memória Alpine.
        this.rota = "alocacao";
        this.tab = "aloca";
        return;
      }
      if (path === "politica") {
        // 7a.I.4 shim mantido (7a.E.31): `#politica` foi fundida em `#alocacao`.
        // replaceState não dispara hashchange — sem loop com este handler.
        history.replaceState(null, "", "#alocacao");
        this.rota = "alocacao";
        this.tab = "aloca";
        return;
      }
      if (path === "proventos") {
        this.rota = "proventos";
        this.tab = "provent";
        setTimeout(() => this.hidratarProventos(), 0);
        return;
      }
      if (path === "/raiox/chart") {
        // 7a.I.5: chart full é push child da tab Raio-X. URL canônica.
        this.rota = "patrimonio";
        this.tab = "raiox";
        setTimeout(() => this.hidratarPatrimonio(), 0);
        return;
      }
      if (path === "/proventos/dy") {
        // 7a.S.7b: tela dedicada de Dividend Yield é push child da tab
        // Proventos — tab persiste (não reseta pra raiox), voltar() usa
        // home["provent"] = "#proventos" (mapa genérico, sem shim dedicado).
        this.rota = "dy";
        this.tab = "provent";
        setTimeout(() => this.hidratarDY(), 0);
        return;
      }
      const mr = path.match(/^\/raiox\/relatorio(?:\/(\d{4}-\d{2}))?$/);
      if (mr) {
        this.rota = "relatorio";
        this.tab = "raiox";
        this.relRotaMes = mr[1] || null;
        this.relSeletorAberto = false;
        setTimeout(() => this.hidratarRelatorio(), 0);
        return;
      }
      if (path === "patrimonio") {
        // 7a.I.5 shim: rota legada `#patrimonio` virou push child de raiox.
        // replaceState não dispara hashchange — sem loop.
        history.replaceState(null, "", "#/raiox/chart");
        this.rota = "patrimonio";
        this.tab = "raiox";
        setTimeout(() => this.hidratarPatrimonio(), 0);
        return;
      }
      if (path === "aportar") {
        this.rota = "aportar";
        this.tab = "aportar";
        this.hidratarAportar();
        return;
      }
      // Limite de 16 chars cobre tickers BR/EUA + sintéticos longos como
      // AVNU_REBATE (Fase 7a.28). Caso surjam tickers com `.` (ex.: BRK.B),
      // expandir a charclass — nenhum ativo da carteira atual usa.
      const m = path.match(/^ativo\/([A-Z0-9_-]{2,16})$/);
      if (m) { this.rota = "ativo"; this.tickerAtual = m[1]; return; /* tab preserva valor anterior */ }
      // Fallback: hash inválido vira raio-x sem entrar no histórico.
      history.replaceState(null, "", location.pathname + location.search);
      this.rota = "";
      this.tab = "raiox";
    },

    tabIndex() {
      // 7a.I.6: mapa tab → índice (0..4) usado pelo indicator slide.
      const ordem = ["raiox", "rentab", "aloca", "provent", "aportar"];
      const i = ordem.indexOf(this.tab);
      return i === -1 ? 0 : i;
    },

    updateTabIndicator() {
      // 7a.I.6: posiciona .tab-bar-indicator via translateX baseado no índice.
      // Grid 5 colunas iguais → cada tab = 20% do nav; indicator tem width 10%
      // → para centralizá-lo: offset = índice*tabWidth + (tabWidth - indicatorWidth)/2.
      const nav = document.querySelector(".tab-bar");
      if (!nav) return;
      const navWidth = nav.getBoundingClientRect().width;
      if (navWidth === 0) return;
      const tabWidth = navWidth / 5;
      const indicatorWidth = navWidth * 0.10;
      const x = this.tabIndex() * tabWidth + (tabWidth - indicatorWidth) / 2;
      nav.style.setProperty("--tab-indicator-x", x + "px");
    },

    ativarCountUpHero(elParam, onDone) {
      // 7a.I.6: dono exclusivo do textContent de #hero-patrimonio. Removido o
      // x-text para não disputar com o RAF (Alpine re-renderiza no meio dos
      // 700ms reverteria o frame intermediário para o valor final).
      // 7a.S.5: aceita um elemento explícito (passado por _renderHeroFace,
      // escopado ao nó recém-criado da faceta ativa). Isso evita uma corrida
      // real: com o hero de facetas, o nó ANTIGO com o mesmo id só é removido
      // 320ms depois (transição de saída) — se o usuário ciclar de volta pra
      // faceta 0 dentro desse intervalo, document.getElementById encontraria
      // o nó velho (1º em ordem no DOM) em vez do novo, e o RAF do 1º count-up
      // (ainda em voo) continuaria escrevendo nele, revertendo o texto pro
      // valor parcial. Passar o elemento explícito elimina a ambiguidade.
      //
      // CRB 7a.S.5: `onDone` opcional (chamado 1x, síncrono nos caminhos
      // instantâneos/refresh, assíncrono no caminho RAF) — usado por
      // _renderHeroFace para saber quando o count-up terminou e liberar o
      // aria-busy do #hero-body. Todo caminho de saída chama onDone, inclusive
      // os guards antecipados (senão o aria-busy travaria em "true").
      const done = () => { if (onDone) onDone(); };
      if (!this.json || !this.json.patrimonio) { done(); return; }
      const target = this.json.patrimonio.total_brl;
      if (typeof target !== "number" || !isFinite(target)) { done(); return; }
      const el = elParam || document.getElementById("hero-patrimonio");
      if (!el) { done(); return; }
      // Refresh dentro da mesma sessão (heroCountUpDone=1) = valor final direto,
      // sem animação. Primeira load por sessão = count-up 700ms via RAF.
      // transitions.js carrega síncrono antes de app.js em index.html, então
      // drarthurNav está sempre definido nesse ponto — sem fallback redundante.
      if (sessionStorage.getItem("heroCountUpDone") === "1") {
        el.textContent = window.formatBrl(target);
        done();
        return;
      }
      window.drarthurNav.applyCountUp(el, target, (n) => window.formatBrl(n), done);
      sessionStorage.setItem("heroCountUpDone", "1");
    },

    // ── Hero de facetas (7a.S.5) ────────────────────────────────────────
    // Conteúdo de #hero-body é gerido via DOM imperativo (mesmo racional de
    // ativarCountUpHero: a transição de duas camadas .hero-face.out/.on —
    // com remoção atrasada 320ms — não mapeia bem pra x-show/x-if do Alpine
    // sem arriscar nós duplicados/strict-mode). heroFacetAtivo (estado Alpine)
    // permanece a single source pros facet-dots (x-for reativo).

    // Deriva os 4 fatos a partir de `this.json` — chamado a cada troca de
    // faceta (barato: 4 objetos pequenos), nunca cacheado, pra sempre refletir
    // o JSON corrente.
    _heroFacetsData() {
      const j = this.json || {};
      const p = j.patrimonio || {};
      const rentTotal = (j.rentabilidade && j.rentabilidade.Total) || {};
      const origem = rentTotal.xirr_origem ?? rentTotal.twr_origem ?? null;
      return [
        {
          tipo: "big",
          eyebrow: this.heroFacetLabels[0],
          valor: p.total_brl,
          delta: p.variacao_semanal_brl,
          deltaPct: p.variacao_semanal_pct,
        },
        {
          tipo: "split",
          eyebrow: this.heroFacetLabels[1],
          totalBrl: p.total_brl,
          brBrl: p.br_brl,
          euaBrl: p.eua_brl,
        },
        {
          tipo: "variacao7d",
          eyebrow: this.heroFacetLabels[2],
          valor: p.variacao_semanal_brl,
          pct: p.variacao_semanal_pct,
        },
        {
          tipo: "origem",
          eyebrow: this.heroFacetLabels[3],
          valor: origem,
        },
      ];
    },

    // Monta o innerHTML de UMA faceta. Números são sempre computados (nunca
    // texto vindo do usuário) — sem risco de XSS na concatenação.
    _heroFaceHtml(f) {
      if (f.tipo === "big") {
        const temDelta = f.delta !== null && f.delta !== undefined;
        const temPct = f.deltaPct !== null && f.deltaPct !== undefined;
        const deltaHtml = temDelta
          ? '<div class="hero-delta ' + (f.delta >= 0 ? "is-positive" : "is-negative") + '">' +
            '<span class="seta" aria-hidden="true">' + (f.delta >= 0 ? "▲" : "▼") + "</span>" +
            "<span>" + window.formatBrl(f.delta) + "</span>" +
            (temPct ? "<span>(" + window.formatPct(f.deltaPct) + ")</span>" : "") +
            '<span class="texto">· 7d</span></div>'
          : "";
        return '<p class="hero-valor" id="hero-patrimonio"></p>' + deltaHtml;
      }
      if (f.tipo === "split") {
        const total = f.totalBrl || 0;
        const brPct = total > 0 ? (f.brBrl || 0) / total : 0;
        const euaPct = total > 0 ? (f.euaBrl || 0) / total : 0;
        return (
          '<div class="hero-split">' +
          '<div class="col"><div class="cap">🇧🇷 Brasil</div>' +
          '<div class="num">' + window.formatBrl(f.brBrl) + "</div>" +
          '<div class="pct">' + window.formatPctSemSinal(brPct, 1) + "</div></div>" +
          '<div class="col"><div class="cap">🇺🇸 EUA</div>' +
          '<div class="num">' + window.formatBrl(f.euaBrl) + "</div>" +
          '<div class="pct">' + window.formatPctSemSinal(euaPct, 1) + "</div></div>" +
          "</div>" +
          '<div class="hero-splitbar">' +
          '<i style="width:' + (brPct * 100).toFixed(2) + '%;background:var(--cat-acoes-br)"></i>' +
          '<i style="width:' + (euaPct * 100).toFixed(2) + '%;background:var(--cat-eua)"></i>' +
          "</div>"
        );
      }
      if (f.tipo === "variacao7d") {
        if (f.valor === null || f.valor === undefined) {
          return (
            '<p class="hero-valor">—</p>' +
            '<p class="hero-sub">Sem histórico de 7 dias ainda — volte em breve.</p>'
          );
        }
        const seta = f.valor >= 0 ? "▲" : "▼";
        const temPct = f.pct !== null && f.pct !== undefined;
        return (
          '<p class="hero-valor"><span aria-hidden="true">' + seta + "</span> " +
          window.formatBrlSigned(f.valor) + "</p>" +
          '<p class="hero-sub">' +
          (temPct ? window.formatPct(f.pct) + " " : "") +
          "nesta semana · mercado + aportes + proventos</p>"
        );
      }
      if (f.tipo === "origem") {
        if (f.valor === null || f.valor === undefined) {
          return (
            '<p class="hero-valor">—</p>' +
            '<p class="hero-sub">Ainda sem dado suficiente para calcular o retorno desde a origem.</p>'
          );
        }
        return (
          '<p class="hero-valor">' + window.formatPct(f.valor) + "</p>" +
          '<p class="hero-sub">ao ano · retorno acumulado desde o início da carteira</p>'
        );
      }
      return "";
    },

    // Troca a faceta ativa. opts.instant pula a transição (mount inicial);
    // caso contrário, respeita prefers-reduced-motion (drarthurNav.motion.reduced).
    // Facet "big" sempre delega o número a ativarCountUpHero() — que já resolve
    // sozinho "1ª vez anima, revisitas mostram valor final direto" via
    // sessionStorage.heroCountUpDone (nunca reseta ao trocar de faceta).
    _renderHeroFace(idx, opts) {
      opts = opts || {};
      const dados = this._heroFacetsData();
      const f = dados[idx];
      if (!f) return;
      this.heroFacetAtivo = idx;
      const reduced = window.drarthurNav.motion.reduced;
      const instant = !!(opts.instant || reduced);

      // CRB 7a.S.5 (re-entrância): geração desta troca. Um settle assíncrono
      // (RAF/timeout) de uma troca ANTERIOR ainda em voo confere este número
      // antes de agir; se mudou, a troca foi superada e o settle é descartado
      // — evita que um callback tardio limpe o aria-busy no meio de uma
      // transição mais nova (ver tentarLimparBusy abaixo).
      this._heroFaceGen = (this._heroFaceGen || 0) + 1;
      const gen = this._heroFaceGen;

      // Cancela timers/RAFs pendentes de uma troca anterior. Sem isso, num
      // ciclo rápido (auto-repeat de tecla segurando Enter/Space, ou toques/
      // cliques em sequência nos dots) o double-RAF pendente da troca
      // anterior ainda acrescentaria `.on` a um nó já retirado — a raiz do
      // órfão que este fix elimina — e o setTimeout do eyebrow escreveria um
      // label fora de ordem.
      if (this._heroEyebrowSwapTimeout) {
        clearTimeout(this._heroEyebrowSwapTimeout);
        this._heroEyebrowSwapTimeout = null;
      }
      if (this._heroFaceRafOuter) {
        cancelAnimationFrame(this._heroFaceRafOuter);
        this._heroFaceRafOuter = null;
      }
      if (this._heroFaceRafInner) {
        cancelAnimationFrame(this._heroFaceRafInner);
        this._heroFaceRafInner = null;
      }
      if (this._heroSettleTimeout) {
        clearTimeout(this._heroSettleTimeout);
        this._heroSettleTimeout = null;
      }

      const bodyEl = document.getElementById("hero-body");
      // CRB 7a.S.5 (a11y): #hero-body é aria-live="polite" — sem isto, o SR
      // lê ~42 frames parciais do count-up (RAF reescreve textContent) e,
      // durante a transição de saída de 320ms, duas `.hero-face` coexistem
      // no DOM. `aria-busy="true"` faz assistive tech ignorar a churn; só
      // volta a "false" (tentarLimparBusy) quando a entrada assentar E — se
      // for a faceta "big" — o count-up também tiver terminado.
      if (bodyEl) bodyEl.setAttribute("aria-busy", "true");

      const eyebrowEl = document.getElementById("hero-eyebrow");
      if (eyebrowEl) {
        if (instant) {
          eyebrowEl.textContent = f.eyebrow;
        } else {
          eyebrowEl.classList.add("swap");
          this._heroEyebrowSwapTimeout = setTimeout(() => {
            eyebrowEl.textContent = f.eyebrow;
            eyebrowEl.classList.remove("swap");
            this._heroEyebrowSwapTimeout = null;
          }, 150);
        }
      }
      if (!bodyEl) return;

      // Retira TODAS as faces pré-existentes — não só `.hero-face.on`. Numa
      // troca rápida, a face recém-entrante ainda não ganhou `.on` (double-
      // RAF pendente) quando a próxima troca chega; buscar só `.on` não a
      // encontraria, e ela ficaria órfã em #hero-body, ganhando `.on` mais
      // tarde e piscando um fato velho na tela.
      bodyEl.querySelectorAll(".hero-face").forEach((node) => {
        // Mesmo racional do fix original (7a.I.6/7a.S.5): nunca dois nós com
        // #hero-patrimonio coexistindo — getElementById resolveria pro nó
        // errado. Agora aplicado a QUALQUER face retirada, não só a `.on`.
        const valorId = node.querySelector("#hero-patrimonio");
        if (valorId) valorId.removeAttribute("id");
        if (instant) {
          node.remove();
        } else {
          node.classList.remove("on");
          node.classList.add("out");
          setTimeout(() => node.remove(), 320);
        }
      });

      const el = document.createElement("div");
      el.className = "hero-face";
      el.innerHTML = this._heroFaceHtml(f);
      bodyEl.appendChild(el);

      // "Entrada pronta" = a face nova assentou visualmente (instantâneo, ou
      // 320ms após o double-RAF — mesma folga usada pra remoção do nó de
      // saída, cobre a transição --d2 de opacity/transform). "Count-up
      // pronto" só existe pra faceta "big"; as demais já nascem prontas.
      let entradaPronta = false;
      let countUpPronto = f.tipo !== "big";
      const tentarLimparBusy = () => {
        if (gen !== this._heroFaceGen) return; // troca superada — ignora
        if (entradaPronta && countUpPronto && bodyEl) {
          bodyEl.setAttribute("aria-busy", "false");
        }
      };
      const marcarEntradaPronta = () => { entradaPronta = true; tentarLimparBusy(); };
      const marcarCountUpPronto = () => { countUpPronto = true; tentarLimparBusy(); };

      if (instant) {
        el.classList.add("on");
        marcarEntradaPronta();
      } else {
        this._heroFaceRafOuter = requestAnimationFrame(() => {
          this._heroFaceRafOuter = null;
          this._heroFaceRafInner = requestAnimationFrame(() => {
            this._heroFaceRafInner = null;
            el.classList.add("on");
            this._heroSettleTimeout = setTimeout(() => {
              this._heroSettleTimeout = null;
              marcarEntradaPronta();
            }, 320);
          });
        });
      }

      if (f.tipo === "big") {
        // Escopado ao nó recém-criado (não document.getElementById) — ver
        // comentário em ativarCountUpHero sobre a corrida com o nó antigo
        // ainda pendente de remoção (transição de saída, 320ms).
        this.ativarCountUpHero(el.querySelector("#hero-patrimonio"), marcarCountUpPronto);
      }
    },

    // x-init do #hero — mount inicial (faceta 0, instantâneo) + hidrata o
    // flag do hint a partir do sessionStorage (mesmo padrão de heroCountUpDone).
    montarHeroFacetas() {
      try {
        this.heroFacetHintGone = sessionStorage.getItem("heroFacetHintSeen") === "1";
      } catch (_) {
        this.heroFacetHintGone = false;
      }
      this._renderHeroFace(0, { instant: true });
    },

    _hintGoneHero() {
      if (this.heroFacetHintGone) return;
      this.heroFacetHintGone = true;
      try { sessionStorage.setItem("heroFacetHintSeen", "1"); } catch (_) {}
    },

    // @click do card inteiro — cicla sequencialmente (wrap-around).
    ciclarHeroFacet() {
      this._hintGoneHero();
      const proximo = (this.heroFacetAtivo + 1) % this.heroFacetLabels.length;
      this._renderHeroFace(proximo, {});
    },

    // @click.stop de um facet-dot — pula direto pro índice tocado.
    irParaFacetHero(idx) {
      this._hintGoneHero();
      if (idx === this.heroFacetAtivo) return;
      this._renderHeroFace(idx, {});
    },

    // 7a.E.31: alterna o card de uma categoria na vista #alocação unificada.
    // Não-persistente; map vazio = todas fechadas.
    toggleCategoria(nome) {
      this.catAberta = {
        ...this.catAberta,
        [nome]: !this.catAberta[nome],
      };
    },

    // 7a.E.31: R$ de mercado da categoria / do ativo (schema v2.20).
    valorBrlCategoria(cat) { return (cat && cat.valor_brl) || 0; },
    valorBrlAtivo(ativo) { return (ativo && ativo.valor_brl) || 0; },

    voltar() {
      // history.length é heurística frágil — em link compartilhado aberto
      // numa aba com histórico prévio, history.back() saída do PWA.
      // Sempre reescrevemos o hash via replaceState; mais previsível e mantém
      // o usuário dentro do app.
      //
      // O back de uma tela drill-down (#ativo, #/raiox/chart) retorna para a
      // HOME da seção de origem — nunca pula para a Raio-X a partir de outra
      // seção. `this.tab` preserva a tab de origem (atualizarRota não a reseta
      // em push #ativo/:ticker), então mapeamos tab → hash da home e deixamos
      // atualizarRota() re-derivar rota/tab/hidratação a partir do hash.
      // 7a.I.7 forçava `tab=raiox` aqui: o back de #ativo aberto em
      // #alocacao/#proventos caía na Raio-X em vez da seção de origem.
      const home = {
        raiox: "",
        rentab: "#rentabilidade",
        aloca: "#alocacao",
        provent: "#proventos",
        aportar: "#aportar",
      };
      const hash = Object.prototype.hasOwnProperty.call(home, this.tab)
        ? home[this.tab]
        : "";
      history.replaceState(null, "", hash || location.pathname);
      this.atualizarRota();
    },

    selecionarEscopo(escopo) {
      this.escopoAtivo = escopo;
      this.hidratarRentabilidade();
    },

    // Drift em pontos percentuais com sinal explícito (ex: "+0.34pp" / "−1.20pp").
    // Não usa Intl.NumberFormat porque o sufixo "pp" não é parte do locale.
    formatPctSinalPP(v) {
      if (v === null || v === undefined || Number.isNaN(v)) return "—";
      const pp = v * 100;
      const sign = pp > 0 ? "+" : pp < 0 ? "−" : "±";
      return sign + Math.abs(pp).toFixed(2) + "pp";
    },

    // ── Últimos 7 dias (Fase 7a.J.1) ────────────────────────────────────
    // Bloco invisível quando schema v<2.13 (sem ultimos_7d) ou em DB
    // recém-bootstrapped sem snapshot ≥7d E sem movs/proventos na janela.
    ultimos7dVisivel() {
      const u = this.json && this.json.ultimos_7d;
      if (!u) return false;
      const temDelta = u.delta_patrim_brl !== null && u.delta_patrim_brl !== undefined;
      const temListas =
        (u.compras || []).length > 0 ||
        (u.vendas || []).length > 0 ||
        (u.proventos || []).length > 0;
      return temDelta || temListas;
    },

    // Headline "+R$ 4.270  +1,6%" / "−R$ 1.200  −0,5%" / "—"
    formatDeltaR7d(brl, pct) {
      if (brl === null || brl === undefined) return "—";
      const partes = [window.formatBrl(brl)];
      if (pct !== null && pct !== undefined) partes.push(window.formatPct(pct));
      return partes.join("  ");
    },

    // Linha de decomposicao: "+R$ 11.300" / "−R$ 7.530" / "R$ 0" / "—"
    formatDecompR7d(brl) {
      if (brl === null || brl === undefined) return "—";
      return window.formatBrl(brl);
    },

    // Classe semântica para colorir delta/decomp.
    sinalClasse(brl) {
      if (brl === null || brl === undefined) return "";
      if (brl > 0) return "is-positive";
      if (brl < 0) return "is-negative";
      return "";
    },

    // Quantidade pt-BR com tabular-nums; ações inteiras, ETF/cripto podem ter casas.
    formatQtyR7d(q) {
      if (q === null || q === undefined || Number.isNaN(q)) return "";
      const digits = Number.isInteger(q) ? 0 : Math.min(4, q.toString().split(".")[1]?.length || 0);
      return new Intl.NumberFormat("pt-BR", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(q);
    },

    // ===== 7a.E.23 — helpers da vista Alvo (#alocacao) =====

    labelCestaTipo(tipo) {
      if (tipo === "passive") return "Cesta passiva";
      if (tipo === "picks") return "Cesta de picks";
      return tipo || "";
    },

    // Recebe drift como FRAÇÃO (ex.: -0.0168 = -1,68 pp; convenção do backend
    // espelhando formatPctSinalPP em app.js:428) e devolve
    // { texto: "−1,68 pp" | "+4,30 pp" | "0,00 pp", classe: "under"|"over"|"hold", arrow: "↑"|"↓"|"·" }.
    // Threshold ±0.005 fraction = ±0,5 pp evita ruído de arredondamento como ação.
    // classe reflete posição vs alvo: "under" = atual<alvo (precisa aportar); "over" = acima.
    formatDelta(pp) {
      if (pp === null || pp === undefined || Number.isNaN(pp)) {
        return { texto: "—", classe: "hold", arrow: "" };
      }
      const ppVal = pp * 100;
      const fmt = new Intl.NumberFormat("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Math.abs(ppVal));
      if (pp <= -0.005) return { texto: `−${fmt} pp`, classe: "under", arrow: "↑" };
      if (pp >= 0.005) return { texto: `+${fmt} pp`, classe: "over",  arrow: "↓" };
      return { texto: "0,00 pp", classe: "hold", arrow: "·" };
    },

    // Razão atual/alvo capada em 1 (acima de 100 % usa marker pra mostrar overflow).
    // `!alvo` já captura 0/null/undefined/NaN (Number.isNaN(alvo) seria dead code).
    _ratio(atual, alvo) {
      if (!alvo || alvo <= 0) return 0;
      if (atual === null || atual === undefined || Number.isNaN(atual)) return 0;
      return Math.min(1, atual / alvo);
    },

    catFillPct(cat) { return this._ratio(cat?.peso_atual, cat?.peso_alvo); },
    catIsOver(cat) {
      const a = cat?.peso_alvo;
      return a && a > 0 && cat?.peso_atual > a;
    },

    cestaFillPct(bucket) { return this._ratio(bucket?.peso_atual_bucket, bucket?.peso_bucket); },
    cestaIsOver(bucket) {
      const a = bucket?.peso_bucket;
      return a && a > 0 && bucket?.peso_atual_bucket > a;
    },

    ativoFillPct(ativo) { return this._ratio(ativo?.peso_intra_atual, ativo?.peso_intra); },
    ativoIsOver(ativo) {
      const a = ativo?.peso_intra;
      return a && a > 0 && ativo?.peso_intra_atual > a;
    },

    // Map nome categoria → token CSS de identidade.
    catCssVar(nome) {
      const map = {
        "Ações BR": "--cat-acoes-br",
        "EUA": "--cat-eua",
        "FII": "--cat-fii",
        "FIIs": "--cat-fii",
        "Cripto": "--cat-cripto",
        "Renda Fixa BR": "--cat-renda-fixa-br",
      };
      return map[nome] || "--g-700";
    },

    catStyleVar(nome) {
      return `--cat: var(${this.catCssVar(nome)});`;
    },

    // Posição do marker quando há overflow: trilha sempre 100 % preenchida,
    // marker fica no ponto onde o alvo está em relação ao atual.
    markerLeftOver(alvo, atual) {
      if (!atual || atual <= 0 || !alvo) return "100%";
      return `${Math.min(99, (alvo / atual) * 100)}%`;
    },

    // Tipo de provento abreviado: "Dividendo" → "Div"; "Rendimento" → "Rend"; "JCP" → "JCP".
    abreviarTipoR7d(tipo) {
      if (!tipo) return "";
      const abrev = { "Dividendo": "Div", "Rendimento": "Rend", "JCP": "JCP" };
      return abrev[tipo] || tipo;
    },

    selecionarMoeda(m) {
      // Schema v2.6: toggle só ativo em escopo=EUA. Para Total/Brasil é no-op.
      if (m !== "BRL" && m !== "USD") return;
      this.moeda = m;
      try { localStorage.setItem("moedaEUA", m); } catch (_) {}
      // 7a.E.14: re-renderizar chart histórico com a série da moeda ativa.
      // hidratarRentabilidade é guardado por (rota === "rentabilidade").
      if (this.escopoAtivo === "EUA") {
        this.hidratarRentabilidade();
      }
    },

    rentabilidadeAtiva() {
      // Devolve o bloco de métricas + benchmarks adequado ao escopo+moeda.
      // EUA é nested {brl,usd}; Total e Brasil permanecem flat.
      const rent = this.json && this.json.rentabilidade;
      if (!rent) return null;
      const escopo = rent[this.escopoAtivo];
      if (!escopo) return null;
      if (this.escopoAtivo === "EUA") {
        if (escopo.brl || escopo.usd) {
          const chave = this.moeda === "USD" ? "usd" : "brl";
          return escopo[chave] || escopo.brl || null;
        }
        return escopo;
      }
      return escopo;
    },

    moedaToggleVisivel() {
      // Mostra toggle só quando escopo=EUA E o JSON é v2.6+ (tem brl/usd).
      if (this.escopoAtivo !== "EUA") return false;
      const eua = this.json && this.json.rentabilidade && this.json.rentabilidade.EUA;
      return !!(eua && eua.brl && eua.usd);
    },

    get posicaoAtual() {
      if (!this.json || !this.json.posicoes || !this.tickerAtual) return null;
      return (
        this.json.posicoes.find((p) => p.ticker === this.tickerAtual) || null
      );
    },

    // 7a.Q.3: carrega o índice de relatórios mensais (payload cifrado separado)
    async carregarIndiceRelatorios() {
      if (!this.pin) return;
      try {
        const resp = await fetch("./relatorios_index.json.enc", { cache: "no-cache" });
        if (!resp.ok) { this.relIndice = null; return; }
        const payloadB64 = (await resp.text()).trim();
        const idx = JSON.parse(await window.decifrar(payloadB64, this.pin));
        this.relIndice =
          idx && idx.schema === "relatorios_index_v1" && Array.isArray(idx.meses)
            ? idx
            : null;
      } catch (err) {
        console.warn("índice de relatórios indisponível", err);
        this.relIndice = null; // degradação graciosa — o resto do app segue
      }
    },

    get relUltimoMes() {
      const meses = this.relIndice && this.relIndice.meses;
      return meses && meses.length ? meses[0] : null; // índice é mês DESC
    },

    bandeiraDaPosicao(p) {
      if (!p) return "";
      return p.moeda === "USD" ? "🇺🇸" : "🇧🇷";
    },

    // 7a.E.1: abrevia o lado do movimento para 1-3 chars com semantic class.
    // B/S são vermelho/verde; demais lados ficam neutros mas legíveis.
    formatarLado(lado) {
      const mapa = {
        "Compra":      { texto: "B",   classe: "lado-B"      },
        "Venda":       { texto: "S",   classe: "lado-S"      },
        "Subscrição":  { texto: "Sub", classe: "lado-neutro" },
        "Direito":     { texto: "Dir", classe: "lado-neutro" },
        "Desdobro":    { texto: "Spl", classe: "lado-neutro" },
        "Atualização": { texto: "Atu", classe: "lado-neutro" },
        "Fração":      { texto: "Fra", classe: "lado-neutro" },
        "Cessão":      { texto: "Ces", classe: "lado-neutro" },
        "Exercido":    { texto: "Exe", classe: "lado-neutro" },
        "Não Exercido":{ texto: "NEx", classe: "lado-neutro" },
      };
      return mapa[lado] || { texto: lado, classe: "lado-neutro" };
    },

    // 7a.E.31: categorias da vista #alocação unificada ordenadas por peso_alvo
    // decrescente (renomeia categoriasAlvoOrdenadas da 7a.E.29). .slice() copia
    // o array reativo do json antes do sort — nunca o muta. peso_alvo ausente
    // resolve 0 (categoria cai pro fim). Sort estável; empate por nome.
    get categoriasAlocacaoOrdenadas() {
      const cats =
        (this.json && this.json.politica && this.json.politica.categorias) || [];
      return cats
        .slice()
        .sort((a, b) => (b.peso_alvo || 0) - (a.peso_alvo || 0) || a.nome.localeCompare(b.nome));
    },

    // ── #proventos ──────────────────────────────────────────────────

    get totalProventosOrigem() {
      const evol = this.json?.proventos?.evolucao_anual || [];
      return evol.reduce((acc, e) => acc + (e.total || 0), 0);
    },

    tabelaProventosAtual() {
      const prov = this.json?.proventos || {};
      // 7a.E.18: quando Mensal + mês selecionado, filtra para por_ativo do mês.
      if (
        this.proventosToggle === "mensal" &&
        this.proventosMesSelecionado !== null
      ) {
        const m12 = prov.mensal_12m || [];
        const entry = m12[this.proventosMesSelecionado];
        if (!entry) return [];
        // Normaliza shape {ticker, valor} → {ticker, total} pra colar com o
        // template existente que usa item.total. Preserva bandeira e tipo
        // (7a.O.2): o aluguel de ações entra como entrada própria tipo
        // "Aluguel", que coexiste com o dividendo do mesmo ticker no mês.
        return (entry.por_ativo || []).map((a) => ({
          ticker: a.ticker,
          total: a.valor,
          bandeira: a.bandeira,
          tipo: a.tipo,
        }));
      }
      return this.proventosToggle === "origem"
        ? (prov.por_ativo_origem || [])
        : (prov.por_ativo_12m || []);
    },

    // 7a.E.18: rótulo "Maio/2026" do mês selecionado.
    proventosMesLabel() {
      const idx = this.proventosMesSelecionado;
      if (idx === null) return "";
      const m12 = this.json?.proventos?.mensal_12m || [];
      const entry = m12[idx];
      if (!entry || !entry.mes) return "";
      const [ano, mes] = entry.mes.split("-");
      const nomes = [
        "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
        "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro",
      ];
      const nomeMes = nomes[parseInt(mes, 10) - 1] || "";
      return `${nomeMes}/${ano}`;
    },

    setProventosToggle(modo) {
      this.proventosToggle = modo;
      this.proventosMesSelecionado = null; // 7a.E.18: troca de modo limpa drill
      this.renderProventosGrafico();
    },

    hidratarProventos() {
      if (this.rota !== "proventos" || !this.json) return;
      this.proventosToggle = "origem";
      this.proventosMesSelecionado = null;
      // 7a.E.18: Esc limpa o drill enquanto a tela #proventos está visível.
      if (!this._escListenerProventos) {
        this._escListenerProventos = (evt) => {
          if (
            evt.key === "Escape" &&
            this.rota === "proventos" &&
            this.proventosMesSelecionado !== null
          ) {
            this.proventosMesSelecionado = null;
            this.renderProventosGrafico();
          }
        };
        document.addEventListener("keydown", this._escListenerProventos);
      }
      this.$nextTick(() => this.renderProventosGrafico());
    },

    renderProventosGrafico() {
      const prov = this.json?.proventos || {};
      const container = document.getElementById("proventos-grafico");
      if (!container) return;

      // Cleanup
      if (this.echartsProv) { try { this.echartsProv.dispose(); } catch (_) {} this.echartsProv = null; }
      if (this.resizeObserverProv) { try { this.resizeObserverProv.disconnect(); } catch (_) {} this.resizeObserverProv = null; }
      container.innerHTML = "";

      let labels, valores;
      if (this.proventosToggle === "origem") {
        const evol = prov.evolucao_anual || [];
        labels = evol.map((e) => String(e.ano));
        valores = evol.map((e) => e.total);
        // 7a.S.7b: linha-razão "Total · <anoInicio>–<anoFim>" — soma exata
        // das barras exibidas (nunca um agregado independente do gráfico).
        this.proventosTotalLabel = evol.length
          ? `Total · ${evol[0].ano}–${evol[evol.length - 1].ano}`
          : "Total";
      } else {
        const m12 = prov.mensal_12m || [];
        const meses = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
        labels = m12.map((e) => {
          const [yy, mm] = (e.mes || "").split("-");
          const idx = parseInt(mm, 10) - 1;
          return (idx >= 0 && idx <= 11) ? `${meses[idx]}/${yy.slice(2)}` : (e.mes || "");
        });
        valores = m12.map((e) => e.valor);
        this.proventosTotalLabel = "Total · 12 meses";
      }
      this.proventosTotalValor = valores.reduce((acc, v) => acc + (v || 0), 0);

      const notaParcialEl = document.getElementById("proventosNotaParcial");

      if (!labels.length) {
        container.innerHTML = '<p class="placeholder">Sem dados de proventos.</p>';
        if (notaParcialEl) notaParcialEl.textContent = "";
        return;
      }
      if (typeof echarts === "undefined" || !window.drarthurChart) {
        container.innerHTML = '<p class="placeholder">Não foi possível renderizar o gráfico.</p>';
        if (notaParcialEl) notaParcialEl.textContent = "";
        return;
      }

      const ehMensal = this.proventosToggle === "mensal";
      const mesSelecionado = ehMensal ? this.proventosMesSelecionado : null;

      const dc = window.drarthurChart;
      const formatBRL = (v) => {
        if (v == null) return "—";
        if (v >= 1000) return "R$ " + (v / 1000).toFixed(0) + "k";
        return "R$ " + Math.round(v);
      };

      // 7a.S.3 Task 3: a última barra do array é sempre o bucket em curso
      // (ano corrente em Anual, mês corrente em Mensal) — honestidade de
      // dado, independente da data real do sistema (ver DESIGN.md).
      const ultimoIdx = valores.length - 1;

      // barData: aplica fade + destaque quando há seleção, e hachura na
      // barra parcial (persiste independente da seleção — é atributo do
      // dado, não do estado de interação).
      const barData = valores.map((v, i) => {
        const item = { value: v };
        const ehParcial = i === ultimoIdx;
        let color = dc.tokens.g700;
        let opacity = 1.0;
        if (mesSelecionado !== null && i !== mesSelecionado) {
          opacity = 0.55;
        } else if (mesSelecionado !== null && i === mesSelecionado) {
          color = dc.tokens.g900;
          opacity = 1.0;
        } else if (ehParcial) {
          opacity = 0.65;
        }
        item.itemStyle = { color, opacity };
        if (ehParcial) item.itemStyle.decal = DECAL_PARCIAL;
        return item;
      });

      if (notaParcialEl) {
        notaParcialEl.textContent = `${labels[ultimoIdx]} em curso — hachura · toque numa barra para ler`;
      }

      const chart = echarts.init(container, "drarthur", { renderer: "canvas" });
      const self = this;

      const option = {
        grid: { top: 10, right: 8, bottom: 24, left: 8, containLabel: true },
        tooltip: Object.assign({}, dc.tooltipBase, {
          trigger: "item",
          formatter: (p) => dc.tooltipFormatterAxis([{
            axisValueLabel: p.name,
            seriesName: "Proventos",
            color: dc.tokens.g700,
            value: p.value,
          }], formatBRL),
        }),
        xAxis: { type: "category", data: labels },
        yAxis: { type: "value", axisLabel: { formatter: formatBRL } },
        series: [{
          name: "Proventos",
          type: "bar",
          data: barData,
          barWidth: "60%",
          itemStyle: { color: dc.tokens.g700 },
        }],
        aria: { enabled: true },
      };
      Object.assign(option, dc.motionConfig);

      try {
        chart.setOption(option);
      } catch (err) {
        console.warn("ECharts proventos falhou; placeholder", err);
        chart.dispose();
        container.innerHTML = '<p class="placeholder">Não foi possível renderizar o gráfico.</p>';
        return;
      }

      // 7a.E.18: handler de click — só no modo Mensal
      container.classList.remove("is-clickable");
      if (ehMensal) {
        chart.on("click", function (params) {
          if (params && params.componentType === "series") {
            self._handleClickBarraMes(params.dataIndex);
          }
        });
        // Cursor pointer no container (não no canvas — ECharts pode trocar canvas no resize)
        container.classList.add("is-clickable");
      }

      // 7a.E.18: hint "Toque na mesma barra ou Esc para limpar"
      const hint = document.getElementById("proventosHintLimpar");
      if (hint) hint.hidden = !(ehMensal && mesSelecionado !== null);

      // 7a.E.18: companion buttons a11y
      this._renderCompanionMesesA11y();

      if (typeof ResizeObserver !== "undefined") {
        this.resizeObserverProv = new ResizeObserver(() => {
          try { chart.resize(); } catch (_) {}
        });
        this.resizeObserverProv.observe(container);
      }

      this.echartsProv = chart;
    },

    // 7a.E.18: handler de click no gráfico — agora recebe dataIndex direto do ECharts
    _handleClickBarraMes(idx) {
      const m12 = this.json?.proventos?.mensal_12m || [];
      if (idx === null || idx === undefined || idx < 0 || idx >= m12.length) return;
      if (this.proventosMesSelecionado === idx) {
        this.proventosMesSelecionado = null;
      } else {
        this.proventosMesSelecionado = idx;
      }
      this.renderProventosGrafico();
    },

    // 7a.E.18: lista de <button> visualmente oculta com 12 meses; foco visível.
    _renderCompanionMesesA11y() {
      const ul = document.getElementById("proventosMesesA11y");
      if (!ul) return;
      if (this.proventosToggle !== "mensal") {
        ul.innerHTML = "";
        return;
      }
      const m12 = this.json?.proventos?.mensal_12m || [];
      const nomes = [
        "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
        "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro",
      ];
      ul.innerHTML = m12
        .map((entry, idx) => {
          const [ano, mes] = (entry.mes || "").split("-");
          const nome = nomes[parseInt(mes, 10) - 1] || "";
          const valor = (entry.valor || 0).toLocaleString("pt-BR", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });
          const label = (entry.valor || 0) > 0
            ? `${nome} de ${ano}, R$ ${valor}, toque para detalhar`
            : `${nome} de ${ano}, sem proventos, toque para detalhar`;
          return `<li><button type="button" data-idx="${idx}" aria-label="${label}">${nome}</button></li>`;
        })
        .join("");
      const self = this;
      ul.querySelectorAll("button").forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = parseInt(btn.dataset.idx, 10);
          if (self.proventosMesSelecionado === idx) {
            self.proventosMesSelecionado = null;
          } else {
            self.proventosMesSelecionado = idx;
          }
          self.renderProventosGrafico();
        });
      });
    },

    // ── 7a.S.7b: #s-dy (Dividend Yield — tela dedicada) ───────────────

    // Entrada na rota: escolhe a categoria default do pódio de campeões —
    // a de MAIOR dy entre os 3 sub-escopos (empty-safe: fica null se os 3
    // vierem sem dado, ou se dividend_yield ainda não existir no payload).
    hidratarDY() {
      if (this.rota !== "dy" || !this.json) return;
      const dy = this.json?.dividend_yield || {};
      let melhor = null;
      let melhorValor = -Infinity;
      ["fii", "acao_br", "eua"].forEach((key) => {
        const v = dy[key]?.dy;
        if (typeof v === "number" && v > melhorValor) {
          melhorValor = v;
          melhor = key;
        }
      });
      this.dySelecionado = melhor;
    },

    // As 3 linhas por classe (ordem do mockup: FII, Ação BR, EUA·USD) com a
    // largura da barra proporcional ao maior dy entre elas.
    dyClassesLista() {
      const dy = this.json?.dividend_yield || {};
      const linhas = [
        { key: "fii", nm: "FII" },
        { key: "acao_br", nm: "Ação BR" },
        { key: "eua", nm: "EUA · USD" },
      ].map((l) => ({ ...l, dy: dy[l.key]?.dy ?? null }));
      const max = Math.max(0.0001, ...linhas.map((l) => l.dy || 0));
      return linhas.map((l) => ({
        ...l,
        barPct: Math.max(0, ((l.dy || 0) / max) * 100),
      }));
    },

    selecionarDY(key) {
      this.dySelecionado = key;
    },

    // Campeões (0-3 itens) da categoria selecionada. Empty-safe: `campeoes`
    // pode não existir ainda (payload antigo pré-7a.S.7a) ou a categoria
    // pode vir com lista vazia — em ambos os casos retorna [].
    dyCampeoesAtuais() {
      if (!this.dySelecionado) return [];
      const campeoes = this.json?.dividend_yield?.campeoes || {};
      return campeoes[this.dySelecionado] || [];
    },

    dyCampeoesLabelAtual() {
      const map = { fii: "FII", acao_br: "Ação BR", eua: "EUA · USD" };
      return map[this.dySelecionado] || "";
    },

    // Largura da barra de cada campeão, proporcional ao maior dy da lista atual.
    dyBarPctCampeao(item) {
      const lista = this.dyCampeoesAtuais();
      const max = Math.max(0.0001, ...lista.map((p) => p.dy || 0));
      return Math.max(0, ((item.dy || 0) / max) * 100);
    },

    // Formata o valor de mercado do campeão na moeda nativa do item — BRL
    // (Ação BR/FII) ou USD (EUA, USD-nativo, sem conversão FX).
    formatMoedaCampeao(valor, moeda) {
      if (moeda === "USD") {
        return new Intl.NumberFormat("en-US", {
          style: "currency", currency: "USD",
        }).format(valor ?? 0);
      }
      return window.formatBrl(valor);
    },

    // ── 7a.E.6: Histórico patrimonial ─────────────────────────────────
    patrimonioAtual() {
      const ev = this.json?.patrimonio?.evolucao || [];
      if (!ev.length) return 0;
      return ev[ev.length - 1].total_brl ?? 0;
    },

    aporteCumulativo() {
      const ev = this.json?.patrimonio?.evolucao || [];
      if (!ev.length) return 0;
      return ev[ev.length - 1].aportes_acum_brl ?? 0;
    },

    retornoAcumuladoBrl() {
      return this.patrimonioAtual() - this.aporteCumulativo();
    },

    retornoAcumuladoPctTexto() {
      const a = this.aporteCumulativo();
      if (!a) return "—";
      const pct = (this.patrimonioAtual() / a) - 1;
      return window.formatPct(pct, 1);
    },

    hidratarPatrimonio() {
      if (this.rota !== "patrimonio" || !this.json) return;
      this.$nextTick(() => this.renderPatrimonioGrafico());
    },

    // 7a.Q.3: hidratação + lazy-load + navegação do relatório mensal
    async hidratarRelatorio() {
      if (this.rota !== "relatorio") return;
      if (!this.json || !this.pin) return; // pré-auth: re-chamado no boot
      if (!this.relIndice) await this.carregarIndiceRelatorios();
      const alvo = this.relRotaMes || (this.relUltimoMes ? this.relUltimoMes.mes : null);
      if (!alvo) { this.relMes = null; this.relMesAtual = ""; this.relErro = ""; return; }
      await this.carregarRelatorioMes(alvo);
    },

    async carregarRelatorioMes(mes) {
      if (this.relMesAtual === mes && this.relMes) return; // já carregado
      const entrada = (this.relIndice && this.relIndice.meses || []).find((m) => m.mes === mes);
      const arquivo = entrada ? entrada.arquivo : `relatorio_${mes}.json.enc`;
      this.relCarregando = true;
      this.relErro = "";
      try {
        const resp = await fetch("./" + arquivo, { cache: "no-cache" });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const art = JSON.parse(await window.decifrar((await resp.text()).trim(), this.pin));
        if (!art || art.schema !== "relatorio_mensal_v1") throw new Error("schema inesperado");
        this.relMes = art;
        this.relMesAtual = mes;
      } catch (err) {
        console.warn("relatório do mês indisponível", err);
        this.relMes = null;
        this.relErro = "Não foi possível abrir o relatório deste mês.";
      } finally {
        this.relCarregando = false;
      }
    },

    selecionarMesRelatorio(mes) {
      this.relSeletorAberto = false;
      location.hash = "#/raiox/relatorio/" + mes; // hashchange → atualizarRota → hidrata
    },

    voltarDoRelatorio() {
      location.hash = "";
    },

    // 7a.Q.3: helpers de renderização das seções
    classeSecao(id) {
      if (id === "leitura_mes") return "rel-secao--manchete";
      if (id === "nao_funcionando") return "rel-secao--destaque";
      return "";
    },

    vereditoSelo(v) {
      if (v === "sob_pressao")
        return { label: "Sob pressão", marca: "◐", classe: "rel-selo--pressao" };
      if (v === "deteriorando")
        return { label: "Deteriorando", marca: "▽", classe: "rel-selo--deteriorando" };
      return { label: "Tese intacta", marca: "●", classe: "rel-selo--intacta" };
    },

    radarFiltrado(apenasAtencao) {
      const r = (this.relMes && this.relMes.radar) || [];
      return apenasAtencao ? r.filter((x) => x.veredito !== "intacta") : r;
    },

    prosaParaHtml(corpo, citacoes) {
      const esc = (s) => String(s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
      const porId = {};
      (citacoes || []).forEach((c) => { porId[c.id] = c; });
      const linkify = (txt) =>
        txt.replace(/\[(\d+)\]/g, (m, n) => {
          const c = porId[parseInt(n, 10)];
          const href = c && c.url ? esc(c.url) : "#rel-evidencias";
          return `<a class="rel-cit" href="${href}" target="_blank" rel="noopener" `
               + `aria-label="Fonte ${n}">[${n}]</a>`;
        });
      return (corpo || "")
        .split(/\n{2,}/)
        .map((par) => `<p>${linkify(esc(par.trim()))}</p>`)
        .join("");
    },

    renderPatrimonioGrafico() {
      const ev = this.json?.patrimonio?.evolucao || [];
      const container = document.getElementById("patrimonio-grafico");
      if (!container) return;

      // Cleanup
      if (this.echartsPatr) { try { this.echartsPatr.dispose(); } catch (_) {} this.echartsPatr = null; }
      if (this.resizeObserverPatr) { try { this.resizeObserverPatr.disconnect(); } catch (_) {} this.resizeObserverPatr = null; }
      container.innerHTML = "";

      if (!ev.length) {
        container.innerHTML = '<p class="placeholder">Sem histórico de patrimônio.</p>';
        return;
      }
      if (typeof echarts === "undefined" || !window.drarthurChart) {
        container.innerHTML = '<p class="placeholder">Não foi possível renderizar o gráfico.</p>';
        return;
      }

      const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
      const xLabels = ev.map((e) => {
        const d = new Date(e.data + "T00:00:00");
        return MESES[d.getMonth()] + "/" + String(d.getFullYear()).slice(2);
      });
      const totais = ev.map((e) => e.total_brl);
      const aportes = ev.map((e) => e.aportes_acum_brl);

      const formatBRL = (v) => {
        if (v == null) return "—";
        const a = Math.abs(v);
        if (a >= 1_000_000) return "R$ " + (v / 1_000_000).toFixed(1) + "M";
        if (a >= 1000) return "R$ " + Math.round(v / 1000) + "k";
        return "R$ " + Math.round(v);
      };

      const dc = window.drarthurChart;
      const chart = echarts.init(container, "drarthur", { renderer: "canvas" });
      const eixoY = calcularEixoYAncorado(totais, aportes);

      const option = {
        grid: { top: 10, right: 24, bottom: 60, left: 8, containLabel: true },
        tooltip: Object.assign({}, dc.tooltipBase, {
          trigger: "axis",
          formatter: (params) => dc.tooltipFormatterAxis(params, formatBRL),
        }),
        legend: {
          data: ["Patrimônio", "Aporte acum."],
          bottom: 28,
          icon: "circle",
          itemWidth: 8,
          itemHeight: 8,
          textStyle: { color: dc.tokens.gray, fontSize: 11, fontFamily: dc.fontFamily },
        },
        xAxis: {
          type: "category",
          data: xLabels,
          boundaryGap: false,
          axisLabel: {
            interval: Math.max(0, Math.floor(xLabels.length / 6) - 1),
            hideOverlap: true,
          },
        },
        yAxis: { type: "value", min: eixoY.min, max: eixoY.max, axisLabel: { formatter: formatBRL } },
        dataZoom: criarDataZoomInstrumento(dc),
        series: [
          {
            name: "Patrimônio", type: "line", data: totais, smooth: false,
            lineStyle: { width: 2.5 }, showSymbol: false,
            // 7a.S.3: markPoint fixo no ÚLTIMO ponto real (= patrimônio de hoje),
            // âncora ABSOLUTA — diferente do markPoint period-relative da rentabilidade
            // (que reancora no aoMoverZoom). Ao dar zoom numa janela passada o rótulo
            // sai de vista de propósito: rotular um ponto passado como se fosse "hoje"
            // enganaria. Assimetria intencional (CRB 7a.S.3 general-swe).
            markPoint: criarMarkPointUltimo(totais, formatBRL, dc.tokens.g700, dc.fontFamily),
            markLine: eixoY.cruzaZero ? {
              silent: true, symbol: "none", label: { show: false },
              lineStyle: { type: "dashed", color: dc.tokens.gray, width: 1, opacity: 0.5 },
              data: [{ yAxis: 0 }],
            } : undefined,
          },
          {
            name: "Aporte acum.", type: "line", data: aportes, smooth: false,
            lineStyle: { type: [6, 4], width: 1.8 }, showSymbol: false,
          },
        ],
        aria: { enabled: true },
      };
      Object.assign(option, dc.motionConfig);

      try {
        chart.setOption(option);
      } catch (err) {
        console.warn("ECharts patrimonio falhou; placeholder", err);
        chart.dispose();
        container.innerHTML = '<p class="placeholder">Não foi possível renderizar o gráfico.</p>';
        return;
      }

      if (typeof ResizeObserver !== "undefined") {
        this.resizeObserverPatr = new ResizeObserver(() => {
          try { chart.resize(); } catch (_) {}
        });
        this.resizeObserverPatr.observe(container);
      }

      this.echartsPatr = chart;
    },

    hidratarRentabilidade() {
      if (this.rota !== "rentabilidade" || !this.json) return;
      const target = document.getElementById("chart-rent");
      if (!target) return;

      const rent = (this.json.rentabilidade || {})[this.escopoAtivo];
      // 7a.E.14: schema v2.7 aninha EUA.historico_twr em {brl, usd}.
      let serie;
      const rawHistorico = rent && rent.historico_twr;
      if (this.escopoAtivo === "EUA" && rawHistorico && !Array.isArray(rawHistorico)) {
        const chave = this.moeda === "USD" ? "usd" : "brl";
        serie = rawHistorico[chave] || rawHistorico.brl || [];
      } else {
        serie = rawHistorico || [];
      }

      // 7a.E.7.3: filtro firstStable preserva pontos não-cumulativos sãos
      const firstStable = serie.findIndex((p) => {
        if (p.twr === null) return false;
        const cap = p.anualizado === false ? 2.0 : 1.0;
        return Math.abs(p.twr) < cap;
      });
      serie = firstStable === -1 ? [] : serie.slice(firstStable);

      // Cleanup
      if (this.echartsRent) { try { this.echartsRent.dispose(); } catch (_) {} this.echartsRent = null; }
      if (this.resizeObserverChart) { try { this.resizeObserverChart.disconnect(); } catch (_) {} this.resizeObserverChart = null; }
      target.innerHTML = "";
      if (serie.length === 0) {
        target.innerHTML = '<p class="placeholder">Dados insuficientes. Aguarde próximo aporte.</p>';
        return;
      }
      if (typeof echarts === "undefined" || !window.drarthurChart) {
        target.innerHTML = '<p class="placeholder">Não foi possível renderizar o gráfico.</p>';
        return;
      }

      // 7a.E.1: eixo X em "Mmm/AA"
      const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
      const formatarMmmAA = (yyyymm) => {
        if (!yyyymm) return "";
        const [yy, mm] = yyyymm.split("-");
        const idx = parseInt(mm, 10) - 1;
        if (idx < 0 || idx > 11) return yyyymm;
        return MESES[idx] + "/" + yy.slice(2);
      };

      // 7a.L.1: chart period-relative. Converte cada ponto para "growth factor"
      // = (1 + cumulativo_desde_origem). Reconcilia anualizado=true (twr é aa,
      // converte via (1+aa)^(days/365.25)) e anualizado=false (twr já é cum).
      // Pontos com twr=null herdam o growth anterior (last-known).
      const parseAnchor = (yyyymm) => {
        if (!yyyymm) return null;
        const [yy, mm] = yyyymm.split("-").map(Number);
        if (!yy || !mm) return null;
        // new Date(y, m, 0) = último dia do mês m (1-indexed)
        return new Date(yy, mm, 0);
      };
      const primeiraAnchor = parseAnchor(serie[0].data);
      const computeGrowth = (p) => {
        if (p.twr === null || p.twr === undefined) return null;
        // CRB #4: anualizado !== true (default-cumulative) — usa branch
        // cumulativo a menos que campo seja explicitamente `true`. Defende
        // contra schemas futuros que omitam o campo.
        if (p.anualizado !== true) return 1 + p.twr;
        const anchor = parseAnchor(p.data);
        if (!anchor || !primeiraAnchor) return 1 + p.twr;
        const days = Math.max(0, (anchor - primeiraAnchor) / 86400000);
        if (days < 1) return 1.0;
        return Math.pow(1 + p.twr, days / 365.25);
      };
      const buildGrowthArray = (key) => {
        const out = [];
        let last = 1.0;
        for (const p of serie) {
          const g =
            key === "twr"
              ? computeGrowth(p)
              : p.benchmark === null || p.benchmark === undefined
                ? null
                : computeGrowth({
                    twr: p.benchmark,
                    anualizado: p.anualizado,
                    data: p.data,
                  });
          if (g !== null) last = g;
          out.push(g === null ? last : g);
        }
        return out;
      };
      const growthPortfolio = buildGrowthArray("twr");
      const growthBenchmark = buildGrowthArray("benchmark");

      // 7a.E.26: gate data-driven (substitui o gate ehTotal da 7a.E.25). Total
      // tem benchmarks={CDI,IBOV,SP500}; Brasil={CDI,IBOV} (IBOV no gráfico BR);
      // EUA não tem `benchmarks` → caminho single (1 linha) intacto.
      const dc = window.drarthurChart;
      const ORDEM_BENCH = ["CDI", "IBOV", "SP500"];
      const temMultiBench = !!(serie[0] && serie[0].benchmarks);
      const benchList = temMultiBench
        ? ORDEM_BENCH.filter((k) => serie[0].benchmarks[k] !== undefined)
        : [];
      const NOME_BENCH = { CDI: "CDI", IBOV: "IBOV", SP500: "S&P 500" };
      const COR_BENCH = {
        CDI: dc.tokens.gray,
        IBOV: dc.tokens.amber700,
        SP500: dc.tokens.blue700,
      };
      const buildGrowthBenchExtra = (idx) => {
        const out = [];
        let last = 1.0;
        for (const p of serie) {
          const raw = p.benchmarks ? p.benchmarks[idx] : null;
          const g =
            raw === null || raw === undefined
              ? null
              : computeGrowth({ twr: raw, anualizado: p.anualizado, data: p.data });
          if (g !== null) last = g;
          out.push(g === null ? last : g);
        }
        return out;
      };
      const growthExtra = temMultiBench
        ? benchList.map((idx) => ({ idx, growth: buildGrowthBenchExtra(idx) }))
        : [];

      // Devolve a série Y reanchorada para [startIdx, endIdx]. Fora do range
      // emite null (linha some) — preserva o comportamento esperado de zoom.
      const reancorar = (growthArr, startIdx, endIdx) => {
        // CRB #1: ?? em vez de || — preserva base=0 (caso extremo −100%);
        // logical-OR coalescia para 1.0 silenciosamente, mascarando drawdown total.
        const base = growthArr[startIdx] ?? 1.0;
        return growthArr.map((g, i) => {
          if (i < startIdx || i > endIdx) return null;
          if (g === null) return null;
          return g / base - 1;
        });
      };

      const xLabels = serie.map((p) => formatarMmmAA(p.data));
      const totalIdx = serie.length - 1;
      const portfolio = reancorar(growthPortfolio, 0, totalIdx);
      const benchmark = reancorar(growthBenchmark, 0, totalIdx);
      const extraReanc = growthExtra.map((e) => ({
        idx: e.idx,
        data: reancorar(e.growth, 0, totalIdx),
      }));
      this.rentabilidadeSubtitulo = "Cresceu desde " + formatarMmmAA(serie[0].data);

      const benchNomePorEscopo = { Total: "CDI", Brasil: "CDI", EUA: "S&P 500" };
      const benchNome = benchNomePorEscopo[this.escopoAtivo] || "Benchmark";

      // 7a.E.1 (F2): precision-aware. <1% mostra 2 casas; resto 1 casa.
      const formatPct = (v) => {
        if (v == null) return "—";
        const abs = Math.abs(v);
        const decimals = abs < 0.01 ? 2 : 1;
        return (v * 100).toFixed(decimals) + "%";
      };

      const chart = echarts.init(target, "drarthur", { renderer: "canvas" });

      const option = {
        grid: { top: 12, right: 24, bottom: 60, left: 8, containLabel: true },
        tooltip: Object.assign({}, dc.tooltipBase, {
          trigger: "axis",
          formatter: (params) => dc.tooltipFormatterAxis(params, formatPct),
        }),
        legend: {
          data: temMultiBench
            ? ["Portfólio", ...growthExtra.map((e) => NOME_BENCH[e.idx])]
            : ["Portfólio", benchNome],
          bottom: 28,
          icon: "circle",
          itemWidth: 8,
          itemHeight: 8,
          textStyle: { color: dc.tokens.gray, fontSize: 12, fontFamily: dc.fontFamily },
        },
        xAxis: {
          type: "category",
          data: xLabels,
          boundaryGap: false,
          axisLabel: {
            interval: Math.max(0, Math.floor(xLabels.length / 6) - 1),
            hideOverlap: true,
          },
        },
        yAxis: { type: "value", axisLabel: { formatter: formatPct } },
        dataZoom: criarDataZoomInstrumento(dc),
        series: temMultiBench
          ? [
              {
                name: "Portfólio", type: "line", data: portfolio, smooth: false,
                lineStyle: { width: 2.5 }, connectNulls: false, showSymbol: false,
                markPoint: criarMarkPointUltimo(portfolio, formatPct, dc.tokens.g700, dc.fontFamily),
              },
              ...extraReanc.map((e) => ({
                name: NOME_BENCH[e.idx],
                type: "line",
                data: e.data,
                smooth: false,
                lineStyle: { type: [5, 5], width: 1.5, color: COR_BENCH[e.idx] },
                itemStyle: { color: COR_BENCH[e.idx] },
                connectNulls: false,
                showSymbol: false,
              })),
            ]
          : [
              {
                name: "Portfólio", type: "line", data: portfolio, smooth: false,
                lineStyle: { width: 2.5 }, connectNulls: false, showSymbol: false,
                markPoint: criarMarkPointUltimo(portfolio, formatPct, dc.tokens.g700, dc.fontFamily),
              },
              {
                name: benchNome, type: "line", data: benchmark, smooth: false,
                lineStyle: { type: [5, 5], width: 1.5 }, connectNulls: false, showSymbol: false,
              },
            ],
        aria: { enabled: true },
      };
      Object.assign(option, dc.motionConfig);

      try {
        chart.setOption(option);
      } catch (err) {
        console.warn("ECharts rentabilidade falhou; placeholder", err);
        chart.dispose();
        target.innerHTML = '<p class="placeholder">Não foi possível renderizar o gráfico.</p>';
        return;
      }

      if (typeof ResizeObserver !== "undefined") {
        this.resizeObserverChart = new ResizeObserver(() => {
          try { chart.resize(); } catch (_) {}
        });
        this.resizeObserverChart.observe(target);
      }

      // 7a.L.2.b: ref para recomputarPeriodo. Captura `historico_periodo` da
      // série ativa (nested {brl,usd} em EUA pós-v2.14; flat em Brasil/Total).
      // Também guarda growthPortfolio/totalIdx para reuso pelo recomputador.
      const rentRoot = (this.json.rentabilidade || {})[this.escopoAtivo];
      let histPeriodo = null;
      if (rentRoot) {
        const hp = rentRoot.historico_periodo;
        if (hp) {
          if (this.escopoAtivo === "EUA" && !Array.isArray(hp)) {
            const chave = this.moeda === "USD" ? "usd" : "brl";
            histPeriodo = hp[chave] || hp.brl || null;
          } else if (Array.isArray(hp)) {
            histPeriodo = hp;
          }
        }
      }
      this._rentCtx = {
        serie,
        totalIdx,
        growthPortfolio,
        histPeriodo,
        formatarMmmAA,
      };

      // 7a.S.6: narração do zoom — pulse `.live` no subtítulo enquanto o
      // usuário arrasta o dataZoom (mockup .chart-sub.live). Debounce: cada
      // evento "datazoom" (fila contínua durante o arrasto) reseta o timer;
      // `.live` só sai depois de um settle sem novos eventos — aproxima
      // "fim do arrasto" sem depender de mousedown/mouseup nativos do
      // dataZoom do ECharts (que não expõe esses limites diretamente).
      // Gated por window.drarthurNav.motion.reduced (mesma fonte de verdade
      // do resto do app shell, ver hero de facetas 7a.S.5): sob
      // reduced-motion a classe nunca é adicionada — só o texto muda.
      const subtituloEl = document.querySelector(".chart-rent-subtitulo");
      const LIVE_SETTLE_MS = 300;
      let liveSettleTimer = null;

      // 7a.L.1: listener dataZoom — reancora Y para [startIdx, endIdx] visível
      // e atualiza sub-título. Arrow function captura `this` lexicalmente.
      const aoMoverZoom = () => {
        let startIdx = 0;
        let endIdx = totalIdx;
        try {
          const opt = chart.getOption();
          const dz = opt.dataZoom && opt.dataZoom[0];
          if (dz) {
            if (typeof dz.startValue === "number") startIdx = Math.max(0, Math.floor(dz.startValue));
            else if (typeof dz.start === "number") startIdx = Math.max(0, Math.floor((dz.start / 100) * totalIdx));
            if (typeof dz.endValue === "number") endIdx = Math.min(totalIdx, Math.ceil(dz.endValue));
            else if (typeof dz.end === "number") endIdx = Math.min(totalIdx, Math.ceil((dz.end / 100) * totalIdx));
          }
        } catch (_) {}
        if (endIdx <= startIdx) endIdx = Math.min(totalIdx, startIdx + 1);
        const novaP = reancorar(growthPortfolio, startIdx, endIdx);
        // CRB #3: atualiza subtítulo ANTES do setOption — se ECharts internal
        // falhar (chart disposed mid-event), subtítulo fica consistente com a
        // intenção do usuário em vez de divergir das séries renderizadas.
        this.rentabilidadeSubtitulo =
          "Cresceu desde " + formatarMmmAA(serie[startIdx].data);
        // 7a.S.6: pulse `.live` — narra o arrasto sem tocar no cálculo acima.
        if (subtituloEl && !window.drarthurNav.motion.reduced) {
          subtituloEl.classList.add("live");
          clearTimeout(liveSettleTimer);
          liveSettleTimer = setTimeout(() => {
            subtituloEl.classList.remove("live");
          }, LIVE_SETTLE_MS);
        }
        // 7a.S.3 Task 1: markPoint do último ponto visível reancora junto —
        // sem isso, ficaria preso no índice/valor da janela anterior.
        const markPointReanc = criarMarkPointUltimo(novaP, formatPct, dc.tokens.g700, dc.fontFamily);
        try {
          if (temMultiBench) {
            chart.setOption({
              series: [
                { name: "Portfólio", data: novaP, markPoint: markPointReanc },
                ...growthExtra.map((e) => ({
                  name: NOME_BENCH[e.idx],
                  data: reancorar(e.growth, startIdx, endIdx),
                })),
              ],
            });
          } else {
            const novaB = reancorar(growthBenchmark, startIdx, endIdx);
            chart.setOption({
              series: [
                { name: "Portfólio", data: novaP, markPoint: markPointReanc },
                { name: benchNome, data: novaB },
              ],
            });
          }
        } catch (_) {}
        // 7a.L.2.b: recomputa card "Período" da janela atual.
        this.recomputarPeriodo(startIdx, endIdx);
      };
      chart.on("datazoom", aoMoverZoom);

      this.echartsRent = chart;

      // 7a.L.2.b: estado inicial do card. Default = full range → titulo "Origem".
      // Inicializado para fimIdx !== null para que x-show resolva true logo
      // após hidratar (o card mostra os valores espelhando Origem fixo).
      this.recomputarPeriodo(0, totalIdx);
    },

    // ── 7a.L.2.b: card "Período" sob #rentabilidade ────────────────────
    recomputarPeriodo(startIdx, endIdx) {
      // Hook chamado por (a) aoMoverZoom do dataZoom, (b) final de
      // hidratarRentabilidade, (c) selecionarMoeda (re-hidrata → reentra).
      // Reseta estado se contexto inválido (rota mudou, chart disposed).
      const ctx = this._rentCtx;
      if (!ctx || !ctx.histPeriodo || ctx.histPeriodo.length < 2) {
        this.periodoCustom = {
          iniIdx: 0,
          fimIdx: null,
          twr: null,
          xirr: null,
          benchExtras: [],
          titulo: "Origem",
        };
        return;
      }
      const hist = ctx.histPeriodo;
      const N = hist.length;
      // Clamp para índices da histPeriodo (totalIdx é da serie do twr; em
      // pipelines normais ambos têm mesma cardinalidade, mas defendemos).
      const maxIdx = N - 1;
      let iA = Math.max(0, Math.min(maxIdx, Math.floor(startIdx || 0)));
      let iB = Math.max(0, Math.min(maxIdx, Math.floor(endIdx || 0)));
      if (iB < iA) iB = iA;
      // CRB 7a.L.2.b finding (general-swe #4): caller passa endIdx baseado
      // na length da TWR series, que pode ser ≠ hist.length se firstStable
      // filtrou pontos iniciais. Capturamos intenção "full range" pelo caller
      // (startIdx=0 + endIdx>=N-1 implícito antes do clamp).
      const fullRangeIntent = (startIdx || 0) === 0 && (endIdx || 0) >= maxIdx;

      // Janela zero (single point) → métricas indefinidas mas mantém título.
      if (iA === iB) {
        this.periodoCustom = {
          iniIdx: iA,
          fimIdx: iB,
          twr: null,
          xirr: null,
          benchExtras: [],
          titulo: fullRangeIntent ? "Origem" : gerarTituloPeriodo(hist, iA, iB),
        };
        return;
      }

      const dA = parseMesData(hist[iA].data);
      const dB = parseMesData(hist[iB].data);
      let twr_aa = null;
      if (dA && dB) {
        const dias = (dB - dA) / 86400000;
        if (dias >= 1 && ctx.growthPortfolio) {
          // TWR a.a. via chain rule sobre growthPortfolio (L.1 já calcula).
          // Quando histPeriodo e growthPortfolio têm índices alinhados,
          // growth[iA..iB] entrega o produto correto. Defende com fallback
          // quando algum extremo é null.
          const gp = ctx.growthPortfolio;
          // gp pode ter mais/menos pontos que hist se firstStable filtrou
          // pontos iniciais. Reusa o último crescimento conhecido.
          const gA = gp[Math.min(iA, gp.length - 1)] ?? 1;
          const gB = gp[Math.min(iB, gp.length - 1)] ?? 1;
          if (gA > 0) {
            twr_aa = Math.pow(gB / gA, 365.25 / dias) - 1;
          }
        }
      }

      const flows = construirFlows(hist, iA, iB);
      const xirr_aa = newtonRaphsonXirr(flows, twr_aa ?? 0.10);

      // 7a.E.26: card multi-benchmark. Total compara contra CDI/IBOV/SP500,
      // Brasil contra CDI/IBOV, EUA contra S&P 500 (caminho single via
      // benchmark_growth + rentBenchNome()). benchExtras: [{nome, deltaXirr,
      // deltaTwr}] com deltas = portfólio − benchmark (null quando indefinido).
      const ORDEM_BENCH = ["CDI", "IBOV", "SP500"];
      const NOME_BENCH = { CDI: "CDI", IBOV: "IBOV", SP500: "S&P 500" };
      const temMulti = hist[iA] && hist[iA].benchmarks_growth;
      const idxs = temMulti
        ? ORDEM_BENCH.filter((k) => hist[iA].benchmarks_growth[k] !== undefined)
        : [null]; // null = caminho single (EUA), usa benchmark_growth
      const benchExtras = [];
      for (const idx of idxs) {
        const gA = idx ? (hist[iA].benchmarks_growth || {})[idx] : hist[iA].benchmark_growth;
        const gB = idx ? (hist[iB].benchmarks_growth || {})[idx] : hist[iB].benchmark_growth;
        let bTwr = null;
        let bXirr = null;
        if (gA && gB && dA && dB) {
          const dias = (dB - dA) / 86400000;
          if (dias >= 1 && gA > 0) {
            const benchGrowth = gB / gA;
            if (benchGrowth > 0) {
              bTwr = Math.pow(benchGrowth, 365.25 / dias) - 1;
              const growthOf = idx
                ? (p) => (p.benchmarks_growth || {})[idx]
                : (p) => p.benchmark_growth;
              bXirr = newtonRaphsonXirr(flowsBenchmark(hist, iA, iB, growthOf), bTwr);
            }
          }
        }
        benchExtras.push({
          nome: idx ? NOME_BENCH[idx] : this.rentBenchNome(),
          deltaXirr: (bXirr !== null && xirr_aa !== null) ? xirr_aa - bXirr : null,
          deltaTwr: (bTwr !== null && twr_aa !== null) ? twr_aa - bTwr : null,
        });
      }

      this.periodoCustom = {
        iniIdx: iA,
        fimIdx: iB,
        twr: twr_aa,
        xirr: xirr_aa,
        benchExtras,
        titulo: fullRangeIntent ? "Origem" : gerarTituloPeriodo(hist, iA, iB),
      };
    },

    rentBenchNome() {
      // Nome amigável do benchmark principal do escopo ativo (para o
      // label "vs ..." no card Período). Brasil/Total = CDI, EUA = S&P 500.
      return this.escopoAtivo === "EUA" ? "S&P 500" : "CDI";
    },

    // ── 7a.H.1: Tela #aportar ─────────────────────────────────────────
    hidratarAportar() {
      if (!this.json) return;
      // Restaurar valor persistido se dentro da janela TTL 24h
      try {
        const ts = parseInt(localStorage.getItem("aporte.ts") || "0", 10);
        const TTL_MS = 24 * 60 * 60 * 1000;
        if (ts > 0 && Date.now() - ts < TTL_MS) {
          const v = localStorage.getItem("aporte.valor") || "";
          if (v && !this.aporteValor) {
            this.aporteValor = v;
          }
        } else if (ts > 0) {
          // Janela expirou — limpa pra não restaurar ao próximo entrar
          localStorage.removeItem("aporte.valor");
          localStorage.removeItem("aporte.ts");
        }
      } catch (_) {}
      this.recalcularAporte();
    },

    aporteHelperText() {
      if (!this.aporteValor || String(this.aporteValor).trim() === "") {
        return "Digite quanto você tem disponível para investir.";
      }
      const limpo = String(this.aporteValor)
        .replace(/[^\d.,]/g, "")
        .replace(/\./g, "")
        .replace(",", ".");
      const valor = parseFloat(limpo);
      if (!isFinite(valor) || valor <= 0) {
        return "Digite quanto você tem disponível para investir.";
      }
      return `Com ${window.formatBrl(valor)} você compraria:`;
    },

    recalcularAporte() {
      const limpo = String(this.aporteValor || "")
        .replace(/[^\d.,]/g, "")
        .replace(/\./g, "")
        .replace(",", ".");
      const valor = parseFloat(limpo) || 0;
      const aporteValorStr = String(this.aporteValor || "").trim();
      try {
        if (valor > 0) {
          localStorage.setItem("aporte.valor", this.aporteValor);
          localStorage.setItem("aporte.ts", String(Date.now()));
        } else if (valor === 0 || aporteValorStr === "") {
          // Input limpo pelo usuário — remove valor stale do localStorage
          // pra não restaurar fantasma na próxima entrada da tela.
          localStorage.removeItem("aporte.valor");
          localStorage.removeItem("aporte.ts");
        }
      } catch (_) {}
      if (!window.aporteCalculo || !this.json) {
        this.aporteBanner = null;
        this.aporteCategoriasRecebedoras = [];
        this.aporteCategoriasNaoRecebedoras = [];
        this.aportePausados = [];
        this.aporteTickersSemPosicao = [];
        return;
      }
      const r = window.aporteCalculo.calcularAporte(valor, this.json);
      this.aporteBanner = r.banner;
      this.aporteCategoriasRecebedoras = r.categorias || [];
      this.aporteCategoriasNaoRecebedoras = r.categoriasNaoRecebedoras || [];
      this.aportePausados = r.pausados || [];
      this.aporteTickersSemPosicao = r.tickersSemPosicao || [];
    },

    limparSessao() {
      // Remove apenas credenciais de sessão. NÃO toca pinBlockUntil/pinFails/pinFirstFailAt
      // — rate-limit persiste intencionalmente (atacante não escapa via bloquear manual).
      localStorage.removeItem("pin");
      localStorage.removeItem("pinTimestamp");
      localStorage.removeItem("atualizadoEm");
    },

    mostrarToast(mensagem, tom = "verde", duracaoMs = 3000) {
      if (this.toast.timer) clearTimeout(this.toast.timer);
      this.toast = {
        visible: true,
        mensagem,
        tom,
        timer: setTimeout(() => { this.toast.visible = false; }, duracaoMs),
      };
    },

    avaliarAtualizacao(atualizadoEmNovo) {
      const anterior = localStorage.getItem("atualizadoEm");
      if (!navigator.onLine) {
        this.mostrarToast(
          `Offline · última atualização: ${window.formatDataHora(atualizadoEmNovo)}`,
          "cinza",
          3000,
        );
        return;
      }
      if (anterior && anterior !== atualizadoEmNovo) {
        this.mostrarToast(
          `Carteira atualizada · ${window.formatDataHora(atualizadoEmNovo)}`,
          "verde",
          3000,
        );
      }
    },

    async tentarAutoResume() {
      const pin = localStorage.getItem("pin");
      const ts = Number(localStorage.getItem("pinTimestamp") || 0);
      if (!pin || !ts) return;
      if (Date.now() - ts >= SESSION_TTL_MS) {
        this.limparSessao();
        return;
      }
      this.carregando = true;
      try {
        const response = await fetch("./portfolio.json.enc", { cache: "no-cache" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payloadB64 = (await response.text()).trim();
        const plaintext = await window.decifrar(payloadB64, pin);
        // Race guard: outra aba pode ter chamado bloquear() durante o await.
        // Se o pin sumiu do localStorage, respeitar o logout e não promover a fase.
        if (localStorage.getItem("pin") === null) {
          return;
        }
        this.json = JSON.parse(plaintext);
        this.pin = pin;
        this.fase = "raiox";
        // Janela 7d deslizante — refresca o timestamp assim que o auto-resume
        // valida a sessão, ANTES do carregamento (lento) do índice de
        // relatórios. PIN só é exigido após 7d de inatividade total.
        localStorage.setItem("pinTimestamp", String(Date.now()));
        // 7a.Q.3: carga do índice de relatórios (payload separado).
        await this.carregarIndiceRelatorios();
        if (this.rota === "relatorio") this.hidratarRelatorio();
        this.avaliarAtualizacao(this.json.atualizado_em);
        localStorage.setItem("atualizadoEm", this.json.atualizado_em);
        // 7a.H.1: se a rota já é #aportar (reload), hidratar agora que temos json.
        if (this.rota === "aportar") {
          this.hidratarAportar();
        }
        // 7a.E.31: a vista #alocação unificada começa com todas as categorias
        // fechadas (catAberta vazio) — sem hidratação pós-resume necessária.
        // 7a.I.5: cold-start em `#/raiox/chart` chamou hidratarPatrimonio
        // antes do json — gráfico ECharts não renderiza no primeiro tick.
        if (this.rota === "patrimonio") {
          this.hidratarPatrimonio();
        }
        // 7a.S.7b: mesmo padrão de #/raiox/chart — cold-start em
        // `#/proventos/dy` (bookmark/share-link) chega aqui sem json ainda,
        // então hidratarDY() precisa rodar agora que o payload chegou; senão
        // dySelecionado fica null e o pódio (x-show) nunca aparece por default.
        if (this.rota === "dy") this.hidratarDY();
      } catch (err) {
        console.warn("auto-resume falhou, limpando sessão", err);
        this.limparSessao();
      } finally {
        this.carregando = false;
      }
    },

    get estaBloqueado() {
      return this.agora < this.pinBlockUntil;
    },

    get bloqueioRestanteMin() {
      if (!this.estaBloqueado) return 0;
      return Math.max(1, Math.ceil((this.pinBlockUntil - this.agora) / 60000));
    },

    registrarFalha() {
      const agora = Date.now();
      let fails = Number(localStorage.getItem("pinFails") || 0);
      let firstAt = Number(localStorage.getItem("pinFirstFailAt") || 0);
      if (!firstAt || agora - firstAt > FAIL_WINDOW_MS) {
        fails = 0;
        firstAt = agora;
      }
      fails += 1;
      localStorage.setItem("pinFails", String(fails));
      localStorage.setItem("pinFirstFailAt", String(firstAt));

      let dur = 0;
      if (fails === 5) dur = BLOCK_5_MS;
      else if (fails === 6) dur = BLOCK_15_MS;
      else if (fails >= 7) dur = BLOCK_60_MS;
      if (dur > 0) {
        const until = agora + dur;
        this.pinBlockUntil = until;
        localStorage.setItem("pinBlockUntil", String(until));
      }
    },

    resetarFalhas() {
      localStorage.removeItem("pinFails");
      localStorage.removeItem("pinFirstFailAt");
      localStorage.removeItem("pinBlockUntil");
      this.pinBlockUntil = 0;
    },

    dispararShake() {
      this.shake = true;
      setTimeout(() => { this.shake = false; }, 420);
    },

    get linhasAlocacao() {
      const a = (this.json && this.json.alocacao) || {};
      const atual = a.atual || {};
      const alvo = a.alvo || {};
      const aliases = { "FIIs BR": "FII", "Ações Brasil": "Ações BR" };
      // 7a.E.20.1: gradiente e dot derivam de var(--cat-*) (single source).
      // 7a.M.1: +Renda Fixa BR.
      // Stops escuros das gradientes são tonais; ficam inline (não são "a cor da categoria").
      const grad = {
        "EUA":           `linear-gradient(90deg, #133e5d 0%, ${COLORS.catEua()} 100%)`,
        "Ações BR":      `linear-gradient(90deg, var(--g-900) 0%, ${COLORS.catAcoesBr()} 100%)`,
        "FII":           `linear-gradient(90deg, #8a5418 0%, ${COLORS.catFii()} 100%)`,
        "Cripto":        `linear-gradient(90deg, #4e3979 0%, ${COLORS.catCripto()} 100%)`,
        "Renda Fixa BR": `linear-gradient(90deg, #0a4a5e 0%, ${COLORS.catRendaFixaBr()} 100%)`,
      };
      const dot = {
        "EUA":           COLORS.catEua(),
        "Ações BR":      COLORS.catAcoesBr(),
        "FII":           COLORS.catFii(),
        "Cripto":        COLORS.catCripto(),
        "Renda Fixa BR": COLORS.catRendaFixaBr(),
      };
      return Object.keys(atual)
        .sort((x, y) => (atual[y] || 0) - (atual[x] || 0))
        .map((k) => {
          let alvoKey = k in alvo ? k : Object.keys(alvo).find((ak) => (aliases[ak] || ak) === k);
          const pctAtual = atual[k] || 0;
          const pctAlvo = (alvoKey && alvo[alvoKey]) || 0;
          return {
            nome: k,
            pct_atual: pctAtual,
            pct_alvo: pctAlvo,
            drift: pctAtual - pctAlvo,
            gradiente: grad[k] || "linear-gradient(90deg, var(--gray), var(--neutral-200))",
            cor: dot[k] || "var(--gray)",
          };
        });
    },

    get anoCorrente() {
      return this.json?.proventos?.mensal?.[0]?.mes?.slice(0, 4)
             ?? String(new Date().getFullYear());
    },

    get anoAnterior() {
      return String(Number(this.anoCorrente) - 1);
    },

    bloquear() {
      // Lock manual: limpa sessão mas preserva rate-limit (pinBlockUntil/pinFails).
      // Invariante: atacante não escapa do bloqueio progressivo chamando bloquear().
      this.limparSessao();
      this.fase = "pin";
      this.json = null;
      this.pin = "";
      this.pinError = "";
    },

    get escoposRentabilidade12m() {
      // 7a.E.15: layout inline ("XIRR · TWR") aplicado aos 3 escopos para uniformidade.
      // Sufixo "· em BRL" preservado só em EUA via flag mostrar_em_brl — Total/Brasil
      // são BRL nativo, explicitar é ruído. Schema v2.6+ aninha EUA em {brl,usd};
      // raio-x sempre lê BRL (glance único, sem toggle).
      const r = (this.json && this.json.rentabilidade) || {};
      const flags = { Total: "🌍", Brasil: "🇧🇷", EUA: "🇺🇸" };
      return ["Total", "Brasil", "EUA"]
        .filter((k) => r[k])
        .map((k) => {
          const fonte = (k === "EUA" && r.EUA && r.EUA.brl) ? r.EUA.brl : r[k];
          return {
            key: k,
            flag: flags[k],
            data: { xirr_12m: fonte.xirr_12m, twr_12m: fonte.twr_12m },
            rent_inline: true,
            mostrar_em_brl: k === "EUA",
          };
        });
    },

    get benchmarks12m() {
      // Raio-x: lista única de 5 benchmarks 12m (valores de mercado, independem do escopo).
      const bm = (this.json && this.json.benchmarks_12m) || {};
      return [
        { key: "cdi",   label: "CDI",     valor: bm.cdi   ?? null },
        { key: "ibov",  label: "IBOV",    valor: bm.ibov  ?? null },
        { key: "ifix",  label: "IFIX",    valor: bm.ifix  ?? null },
        { key: "sp500", label: "S&P 500", valor: bm.sp500 ?? null },
        { key: "usd",   label: "USD",     valor: bm.usd   ?? null },
      ];
    },

    get escoposRentabilidade() {
      // Mantido para a tela detalhada `#rentabilidade` (lê origem/ytd/12m + benchmarks por escopo).
      const r = (this.json && this.json.rentabilidade) || {};
      const flags = { Total: "🌍", Brasil: "🇧🇷", EUA: "🇺🇸" };
      return ["Total", "Brasil", "EUA"]
        .filter((k) => r[k])
        .map((k, i) => ({
          key: k,
          flag: flags[k],
          data: r[k],
          benchmarks: Object.entries(r[k].benchmarks || {}),
          isFirst: i === 0,
        }));
    },

    async submitPin() {
      if (this.estaBloqueado) return;
      if (this.pin.length !== 6 || !/^\d{6}$/.test(this.pin)) {
        this.pinError = "PIN deve ter 6 dígitos";
        return;
      }
      this.pinError = "";
      this.carregando = true;
      let payloadB64;
      try {
        const response = await fetch("./portfolio.json.enc", { cache: "no-cache" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        payloadB64 = (await response.text()).trim();
      } catch (err) {
        console.warn("fetch portfolio falhou", err);
        this.pinError = "Dados indisponíveis · verifique sua conexão";
        this.carregando = false;
        return;
      }
      try {
        const plaintext = await window.decifrar(payloadB64, this.pin);
        this.json = JSON.parse(plaintext);
        this.avaliarAtualizacao(this.json.atualizado_em);
        localStorage.setItem("pin", this.pin);
        localStorage.setItem("pinTimestamp", String(Date.now()));
        localStorage.setItem("atualizadoEm", this.json.atualizado_em);
        this.resetarFalhas();
        this.fase = "raiox";
        // 7a.Q.3: carga do índice de relatórios (payload separado).
        await this.carregarIndiceRelatorios();
        if (this.rota === "relatorio") this.hidratarRelatorio();
        // 7a.E.31: #alocação unificada abre com todas as categorias fechadas;
        // sem re-hidratação de colapso necessária pós-PIN.
        // 7a.I.5: mesmo padrão — bookmark direto de `#/raiox/chart` precisa
        // re-hidratar o gráfico depois que `json` chegou via submitPin.
        if (this.rota === "patrimonio") {
          this.hidratarPatrimonio();
        }
        // 7a.S.7b: bookmark direto de `#/proventos/dy` — re-hidrata o DY
        // depois que `json` chegou via submitPin (espelha #/raiox/chart).
        if (this.rota === "dy") this.hidratarDY();
      } catch (err) {
        console.error("decifra falhou", err);
        this.registrarFalha();
        this.dispararShake();
        if (this.estaBloqueado) {
          this.pinError = `Aguarde ${this.bloqueioRestanteMin} min`;
        } else {
          this.pinError = "PIN incorreto";
        }
        this.pin = "";
      } finally {
        this.carregando = false;
      }
    },
  }));
});
