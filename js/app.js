const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FAIL_WINDOW_MS = 30 * 60 * 1000;
const BLOCK_5_MS = 5 * 60 * 1000;
const BLOCK_15_MS = 15 * 60 * 1000;
const BLOCK_60_MS = 60 * 60 * 1000;

// 7a.G.2 Pass 1 (colorize): cores resolvidas a partir dos tokens CSS em :root.
// Lê via getComputedStyle pra que o JS consuma a mesma source-of-truth do CSS.
const css = (token, fallback = "") =>
  getComputedStyle(document.documentElement).getPropertyValue(token).trim() || fallback;

const COLORS = {
  g700:      () => css("--g-700", "#047857"),
  g700a12:   () => css("--g-700-12", "rgba(4, 120, 87, 0.12)"),
  blue700:   () => css("--blue-700", "#1d4ed8"),
  blue500:   () => css("--blue-500", "#0284c7"),
  purple500: () => css("--purple-500", "#a855f7"),
  amber:     () => css("--amber", "#f59e0b"),
  amber700:  () => css("--amber-700", "#b45309"),
  red:       () => css("--red", "#b91c1c"),
  ink:       () => css("--ink", "#1a1d1c"),
  gray:      () => css("--gray", "#5b605a"),
};

document.addEventListener("alpine:init", () => {
  Alpine.data("app", () => ({
    fase: "pin",
    rota: "",
    tickerAtual: "",
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
    classeExpandida: null,
    uplotProv: null,
    proventosToggle: "origem",
    proventosMesSelecionado: null, // 7a.E.18: índice em mensal_12m ou null
    _escListenerProventos: null,
    collapsedPolitica: {},

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
      await this.tentarAutoResume();
    },

    atualizarRota() {
      const h = (location.hash || "").replace(/^#/, "");
      if (h === "") { this.rota = ""; return; }
      if (h === "rentabilidade") {
        this.rota = "rentabilidade";
        // Hidrata o gráfico após Alpine renderizar a section.
        setTimeout(() => this.hidratarRentabilidade(), 0);
        return;
      }
      if (h === "alocacao") { this.rota = "alocacao"; return; }
      if (h === "politica") {
        this.rota = "politica";
        this.hidratarColapsoPolitica();
        return;
      }
      if (h === "proventos") {
        this.rota = "proventos";
        setTimeout(() => this.hidratarProventos(), 0);
        return;
      }
      if (h === "patrimonio") {
        this.rota = "patrimonio";
        setTimeout(() => this.hidratarPatrimonio(), 0);
        return;
      }
      // Limite de 16 chars cobre tickers BR/EUA + sintéticos longos como
      // AVNU_REBATE (Fase 7a.28). Caso surjam tickers com `.` (ex.: BRK.B),
      // expandir a charclass — nenhum ativo da carteira atual usa.
      const m = h.match(/^ativo\/([A-Z0-9_-]{2,16})$/);
      if (m) { this.rota = "ativo"; this.tickerAtual = m[1]; return; }
      // Fallback: hash inválido vira raio-x sem entrar no histórico.
      history.replaceState(null, "", location.pathname + location.search);
      this.rota = "";
    },

    voltar() {
      // history.length é heurística frágil — em link compartilhado aberto
      // numa aba com histórico prévio, history.back() saída do PWA.
      // Sempre limpamos o hash via replaceState e zeramos a rota; mais
      // previsível e mantém o usuário dentro do app.
      history.replaceState(null, "", location.pathname);
      this.rota = "";
    },

    selecionarEscopo(escopo) {
      this.escopoAtivo = escopo;
      this.hidratarRentabilidade();
    },

    hidratarColapsoPolitica() {
      // 7a.E.17: cada navegação para #politica reseta todas as seções para
      // fechado. Ignora localStorage; estado vive só em memória Alpine.
      if (!this.json || !this.json.politica) return;
      const out = {};
      for (const cat of this.json.politica.categorias) {
        out[cat.nome] = true;
      }
      this.collapsedPolitica = out;
    },

    togglePolitica(nome) {
      this.collapsedPolitica = {
        ...this.collapsedPolitica,
        [nome]: !this.collapsedPolitica[nome],
      };
    },

    labelStatusPolitica(s) {
      // Drift binário intra-categoria (7a.E.16.3): "aportar" leva seta pra cima
      // (drift<0 → comprar); "pausar" é só texto (não vendemos quando valoriza).
      return {
        aportar: "↑ aportar",
        no_alvo: "no alvo",
        pausar: "pausar",
        fora_da_politica: "fora da política",
      }[s] || s;
    },

    // Drift em pontos percentuais com sinal explícito (ex: "+0.34pp" / "−1.20pp").
    // Não usa Intl.NumberFormat porque o sufixo "pp" não é parte do locale.
    formatPctSinalPP(v) {
      if (v === null || v === undefined || Number.isNaN(v)) return "—";
      const pp = v * 100;
      const sign = pp > 0 ? "+" : pp < 0 ? "−" : "±";
      return sign + Math.abs(pp).toFixed(2) + "pp";
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

    expandirClasse(classe) {
      this.classeExpandida = this.classeExpandida === classe ? null : classe;
    },

    tickersDaClasse(classe) {
      const posicoes = (this.json && this.json.posicoes) || [];
      const filtroPorClasse = (p) => {
        if (classe === "EUA") return p.moeda === "USD" && p.classe !== "Cripto";
        if (classe === "Cripto") return p.classe === "Cripto";
        if (classe === "FIIs") return p.classe === "FIIs" || p.classe === "FII";
        if (classe === "Ações BR") {
          return (
            p.moeda === "BRL" &&
            p.classe !== "FIIs" &&
            p.classe !== "FII" &&
            p.classe !== "Cripto"
          );
        }
        return false;
      };
      return posicoes
        .filter(filtroPorClasse)
        .slice()
        .sort((a, b) => (b.valor_mercado_brl || 0) - (a.valor_mercado_brl || 0));
    },

    // Pré-computa lista de tickers da classe + pesos numa única passada.
    // Evita O(N²) de avaliar pesoNaClasse(ticker, classe) -> tickersDaClasse(classe)
    // dentro do x-for do template — agora cada classe é processada 1x por render.
    tickersComPesos(classe) {
      const tickers = this.tickersDaClasse(classe);
      const totalClasse = tickers.reduce(
        (acc, t) => acc + (t.valor_mercado_brl || 0),
        0,
      );
      return tickers.map((p) => ({
        ...p,
        peso_na_classe: totalClasse > 0 ? (p.valor_mercado_brl || 0) / totalClasse : 0,
      }));
    },

    // Tabela compartilhada de aliases — schema do backend usa nomes
    // ligeiramente diferentes entre alocacao.atual e alocacao.alvo
    // (ex.: "Exterior" vs "EUA", "Ações Brasil" vs "Ações BR"). Ambos
    // pctAtualClasse e pctAlvoClasse resolvem pela mesma tabela para
    // evitar drift fictício (atual=0%, alvo!=0%).
    _aliasesClasse(classe) {
      const tabela = {
        "FIIs": ["FIIs", "FIIs BR", "FII"],
        "Ações BR": ["Ações BR", "Ações Brasil", "Ação BR"],
        "EUA": ["EUA", "Exterior"],
        "Cripto": ["Cripto"],
      };
      return tabela[classe] || [classe];
    },

    pctAtualClasse(classe) {
      const atual = (this.json && this.json.alocacao && this.json.alocacao.atual) || {};
      for (const k of this._aliasesClasse(classe)) {
        if (atual[k] != null) return atual[k];
      }
      return 0;
    },

    get posicaoAtual() {
      if (!this.json || !this.json.posicoes || !this.tickerAtual) return null;
      return (
        this.json.posicoes.find((p) => p.ticker === this.tickerAtual) || null
      );
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

    pctAlvoClasse(classe) {
      const alvo = (this.json && this.json.alocacao && this.json.alocacao.alvo) || {};
      for (const k of this._aliasesClasse(classe)) {
        if (alvo[k] != null) return alvo[k];
      }
      return 0;
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
        // template existente que usa item.total.
        return (entry.por_ativo || []).map((a) => ({
          ticker: a.ticker,
          total: a.valor,
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
      if (!container || typeof uPlot === "undefined") return;

      // Destruir instância anterior para evitar canvas orphan.
      if (this.uplotProv) {
        try { this.uplotProv.destroy(); } catch (_) {}
        this.uplotProv = null;
      }
      if (this.resizeObserverProv) {
        try { this.resizeObserverProv.disconnect(); } catch (_) {}
        this.resizeObserverProv = null;
      }
      container.innerHTML = "";

      let labels, valores;
      // 7a.E.8: estado "origem" renderiza buckets anuais de evolucao_anual
      if (this.proventosToggle === "origem") {
        const evol = prov.evolucao_anual || [];
        labels = evol.map((e) => String(e.ano));
        valores = evol.map((e) => e.total);
      } else {
        const m12 = prov.mensal_12m || [];
        // Labels abreviados: "YYYY-MM" → "Mmm/AA"
        const meses = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
        labels = m12.map((e) => {
          const [yy, mm] = (e.mes || "").split("-");
          const idx = parseInt(mm, 10) - 1;
          return (idx >= 0 && idx <= 11) ? `${meses[idx]}/${yy.slice(2)}` : (e.mes || "");
        });
        valores = m12.map((e) => e.valor);
      }

      if (!labels.length) {
        container.innerHTML = '<p class="placeholder">Sem dados de proventos.</p>';
        return;
      }

      const xs = labels.map((_, i) => i);
      const width = Math.max(280, container.clientWidth || 320);
      const ehMensal = this.proventosToggle === "mensal";
      const mesSelecionado = ehMensal ? this.proventosMesSelecionado : null;
      const self = this;
      const opts = {
        width,
        height: 220,
        scales: { x: { time: false }, y: { auto: true } },
        axes: [
          {
            values: (_u, splits) => splits.map((i) => labels[Math.round(i)] ?? ""),
          },
          {
            values: (_u, splits) => splits.map((v) => {
              if (v === null || v === undefined) return "";
              if (v >= 1000) return "R$" + (v / 1000).toFixed(0) + "k";
              return "R$" + Math.round(v);
            }),
          },
        ],
        series: [
          {},
          {
            label: "Proventos (R$)",
            stroke: COLORS.g700(),
            fill: COLORS.g700a12(),
            paths: uPlot.paths.bars({ size: [0.7] }),
          },
        ],
        legend: { show: false },
        hooks: {
          // 7a.E.18: hit-test via uPlot posToIdx só no modo Mensal.
          ready: [
            (u) => {
              if (!ehMensal) return;
              u.over.style.cursor = "pointer";
              u.over.addEventListener("click", (evt) => {
                self._handleClickBarraMes(u, evt);
              });
            },
          ],
          // 7a.E.18: overlay de fade nas barras não-selecionadas + destaque.
          draw: [
            (u) => {
              if (!ehMensal || mesSelecionado === null) return;
              const ctx = u.ctx;
              const plotLeft = u.bbox.left;
              const plotWidth = u.bbox.width;
              const plotTop = u.bbox.top;
              const plotHeight = u.bbox.height;
              const n = u.data[0].length;
              if (!n) return;
              const barSlot = plotWidth / n;
              ctx.save();
              // Fade nas demais (overlay branco translúcido).
              ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
              for (let i = 0; i < n; i++) {
                if (i === mesSelecionado) continue;
                const x = plotLeft + i * barSlot;
                ctx.fillRect(x, plotTop, barSlot, plotHeight);
              }
              // Sublinha a barra selecionada com a cor g-900.
              const g900 = css("--g-900", "#064e3b");
              ctx.fillStyle = g900;
              const xSel = plotLeft + mesSelecionado * barSlot;
              ctx.fillRect(xSel, plotTop + plotHeight, barSlot, 2);
              ctx.restore();
            },
          ],
        },
      };
      try {
        this.uplotProv = new uPlot(opts, [xs, valores], container);
      } catch (err) {
        console.warn("uPlot proventos falhou; renderizando placeholder", err);
        container.innerHTML = '<p class="placeholder">Não foi possível renderizar o gráfico.</p>';
        this.uplotProv = null;
        return;
      }

      // 7a.E.18: hint "Toque na mesma barra ou Esc para limpar".
      const hint = document.getElementById("proventosHintLimpar");
      if (hint) hint.hidden = !(ehMensal && mesSelecionado !== null);

      // 7a.E.18: companion buttons a11y (focáveis ao tab) — só no modo Mensal.
      this._renderCompanionMesesA11y();

      if (typeof ResizeObserver !== "undefined") {
        this.resizeObserverProv = new ResizeObserver(() => {
          if (!this.uplotProv) return;
          const w = Math.max(280, container.clientWidth || 320);
          try { this.uplotProv.setSize({ width: w, height: 220 }); } catch (_) {}
        });
        this.resizeObserverProv.observe(container);
      }
    },

    // 7a.E.18: handler de click no canvas — usa uPlot posToIdx pra hit-test.
    _handleClickBarraMes(u, evt) {
      const rect = u.over.getBoundingClientRect();
      const offsetX = evt.clientX - rect.left;
      // posToIdx mapeia X em pixels relativo ao canvas para índice no eixo X.
      let idx;
      try {
        idx = u.posToIdx(offsetX);
      } catch (_) {
        return;
      }
      const n = (u.data && u.data[0]) ? u.data[0].length : 0;
      if (idx === null || idx === undefined || idx < 0 || idx >= n) return;
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
      const sinal = pct >= 0 ? "+" : "";
      return `${sinal}${(pct * 100).toFixed(1)}%`;
    },

    hidratarPatrimonio() {
      if (this.rota !== "patrimonio" || !this.json) return;
      this.$nextTick(() => this.renderPatrimonioGrafico());
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

      const option = {
        grid: { top: 10, right: 8, bottom: 60, left: 8, containLabel: true },
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
          axisLabel: { interval: Math.max(0, Math.floor(xLabels.length / 6) - 1) },
        },
        yAxis: { type: "value", axisLabel: { formatter: formatBRL } },
        dataZoom: [
          { type: "inside", start: 0, end: 100 },
          {
            type: "slider",
            height: 14,
            bottom: 6,
            start: 0,
            end: 100,
            backgroundColor: "rgba(4,120,87,0.06)",
            fillerColor: "rgba(4,120,87,0.12)",
            borderColor: "transparent",
            handleStyle: { color: dc.tokens.g700 },
            moveHandleStyle: { color: dc.tokens.g700 },
            textStyle: { color: dc.tokens.gray, fontSize: 10 },
            handleSize: 24,
          },
        ],
        series: [
          { name: "Patrimônio", type: "line", data: totais, smooth: false, lineStyle: { width: 2.5 } },
          { name: "Aporte acum.", type: "line", data: aportes, smooth: false, lineStyle: { type: [6, 4], width: 1.8 } },
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
        target.innerHTML = '<p class="placeholder">Dados insuficientes — aguarde próximo aporte.</p>';
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

      const portfolio = serie.map((p) => p.twr);
      const benchmark = serie.map((p) => p.benchmark);
      const xLabels = serie.map((p) => formatarMmmAA(p.data));

      const benchNomePorEscopo = { Total: "CDI", Brasil: "CDI", EUA: "S&P 500" };
      const benchNome = benchNomePorEscopo[this.escopoAtivo] || "Benchmark";

      // 7a.E.1 (F2): precision-aware. <1% mostra 2 casas; resto 1 casa.
      const formatPct = (v) => {
        if (v == null) return "—";
        const abs = Math.abs(v);
        const decimals = abs < 0.01 ? 2 : 1;
        return (v * 100).toFixed(decimals) + "%";
      };

      const dc = window.drarthurChart;
      const chart = echarts.init(target, "drarthur", { renderer: "canvas" });

      const option = {
        grid: { top: 12, right: 12, bottom: 60, left: 8, containLabel: true },
        tooltip: Object.assign({}, dc.tooltipBase, {
          trigger: "axis",
          formatter: (params) => dc.tooltipFormatterAxis(params, formatPct),
        }),
        legend: {
          data: ["Portfólio", benchNome],
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
          axisLabel: { interval: Math.max(0, Math.floor(xLabels.length / 6) - 1) },
        },
        yAxis: { type: "value", axisLabel: { formatter: formatPct } },
        dataZoom: [
          { type: "inside", start: 0, end: 100 },
          {
            type: "slider",
            height: 14,
            bottom: 6,
            start: 0,
            end: 100,
            backgroundColor: "rgba(4,120,87,0.06)",
            fillerColor: "rgba(4,120,87,0.12)",
            borderColor: "transparent",
            handleStyle: { color: dc.tokens.g700 },
            moveHandleStyle: { color: dc.tokens.g700 },
            textStyle: { color: dc.tokens.gray, fontSize: 10 },
            handleSize: 24,
          },
        ],
        series: [
          { name: "Portfólio", type: "line", data: portfolio, smooth: false, lineStyle: { width: 2.5 }, connectNulls: false },
          { name: benchNome, type: "line", data: benchmark, smooth: false, lineStyle: { type: [5, 5], width: 1.5 }, connectNulls: false },
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

      this.echartsRent = chart;
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
        // Janela 7d deslizante — refresca timestamp a cada auto-resume bem-sucedido.
        // PIN só é exigido após 7d de inatividade total.
        localStorage.setItem("pinTimestamp", String(Date.now()));
        this.avaliarAtualizacao(this.json.atualizado_em);
        localStorage.setItem("atualizadoEm", this.json.atualizado_em);
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
      const grad = {
        "EUA": `linear-gradient(90deg, #0b3a5a 0%, ${COLORS.blue500()} 100%)`,
        "Ações BR": "linear-gradient(90deg, var(--g-700) 0%, var(--g-500) 100%)",
        "FII": `linear-gradient(90deg, ${COLORS.amber700()} 0%, var(--amber) 100%)`,
        "Cripto": `linear-gradient(90deg, #6d28d9 0%, ${COLORS.purple500()} 100%)`,
      };
      const dot = {
        "EUA": COLORS.blue500(), "Ações BR": "var(--g-600)", "FII": "var(--amber)", "Cripto": COLORS.purple500(),
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
