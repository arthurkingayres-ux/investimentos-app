const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FAIL_WINDOW_MS = 30 * 60 * 1000;
const BLOCK_5_MS = 5 * 60 * 1000;
const BLOCK_15_MS = 15 * 60 * 1000;
const BLOCK_60_MS = 60 * 60 * 1000;

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
    classeExpandida: null,
    uplotInstance: null,
    uplotProv: null,
    proventosToggle: "origem",

    async init() {
      this.pinBlockUntil = Number(localStorage.getItem("pinBlockUntil")) || 0;
      this.agoraTimer = setInterval(() => { this.agora = Date.now(); }, 1000);
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
      return this.proventosToggle === "origem"
        ? (prov.por_ativo_origem || [])
        : (prov.por_ativo_12m || []);
    },

    setProventosToggle(modo) {
      this.proventosToggle = modo;
      this.renderProventosGrafico();
    },

    hidratarProventos() {
      if (this.rota !== "proventos" || !this.json) return;
      this.proventosToggle = "origem";
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
            stroke: "#047857",
            fill: "#04785720",
            paths: uPlot.paths.bars({ size: [0.7] }),
          },
        ],
        legend: { show: false },
      };
      try {
        this.uplotProv = new uPlot(opts, [xs, valores], container);
      } catch (err) {
        console.warn("uPlot proventos falhou; renderizando placeholder", err);
        container.innerHTML = '<p class="placeholder">Não foi possível renderizar o gráfico.</p>';
        this.uplotProv = null;
        return;
      }

      if (typeof ResizeObserver !== "undefined") {
        this.resizeObserverProv = new ResizeObserver(() => {
          if (!this.uplotProv) return;
          const w = Math.max(280, container.clientWidth || 320);
          try { this.uplotProv.setSize({ width: w, height: 220 }); } catch (_) {}
        });
        this.resizeObserverProv.observe(container);
      }
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
      if (!container || typeof uPlot === "undefined") return;

      // Destruir instância anterior
      if (this.uplotPatr) {
        try { this.uplotPatr.destroy(); } catch (_) {}
        this.uplotPatr = null;
      }
      if (this.resizeObserverPatr) {
        try { this.resizeObserverPatr.disconnect(); } catch (_) {}
        this.resizeObserverPatr = null;
      }
      container.innerHTML = "";

      if (!ev.length) {
        container.innerHTML = '<p class="placeholder">Sem histórico de patrimônio.</p>';
        return;
      }

      // X = Unix seconds (uPlot time scale)
      const xs = ev.map((e) => Math.floor(new Date(e.data + "T00:00:00").getTime() / 1000));
      const totais = ev.map((e) => e.total_brl);
      const aportes = ev.map((e) => e.aportes_acum_brl);

      const width = Math.max(280, container.clientWidth || 320);
      const opts = {
        width,
        height: 240,
        scales: { x: { time: true }, y: { auto: true } },
        axes: [
          {},
          {
            values: (_u, splits) => splits.map((v) => {
              if (v === null || v === undefined) return "";
              if (v >= 1_000_000) return "R$" + (v / 1_000_000).toFixed(1) + "M";
              if (v >= 1000) return "R$" + Math.round(v / 1000) + "k";
              return "R$" + Math.round(v);
            }),
          },
        ],
        series: [
          {},
          { label: "Patrimônio", stroke: "#047857", width: 2 },
          { label: "Aporte acum.", stroke: "#1d4ed8", width: 2, dash: [4, 3] },
        ],
        legend: { show: true },
      };
      try {
        this.uplotPatr = new uPlot(opts, [xs, totais, aportes], container);
      } catch (err) {
        console.warn("uPlot patrimonio falhou; renderizando placeholder", err);
        container.innerHTML = '<p class="placeholder">Não foi possível renderizar o gráfico.</p>';
        this.uplotPatr = null;
        return;
      }

      if (typeof ResizeObserver !== "undefined") {
        this.resizeObserverPatr = new ResizeObserver(() => {
          if (!this.uplotPatr) return;
          const w = Math.max(280, container.clientWidth || 320);
          try { this.uplotPatr.setSize({ width: w, height: 240 }); } catch (_) {}
        });
        this.resizeObserverPatr.observe(container);
      }
    },

    hidratarRentabilidade() {
      if (this.rota !== "rentabilidade" || !this.json) return;
      const target = document.getElementById("chart-rent");
      if (!target || typeof uPlot === "undefined") return;

      const rent = (this.json.rentabilidade || {})[this.escopoAtivo];
      let serie = (rent && rent.historico_twr) || [];

      // 7a.E.7.3: backend retorna pontos com `anualizado: bool` — pontos
      // cumulativos (anualizado=false, <365d desde a origem) não explodem
      // por anualização. Pontos anualizados ainda podem oscilar em janelas
      // com poucos dias dentro de um mês irregular.
      // Defesa secundária (CRB 7a.E.7 #9): cap de 200% para cumulativos
      // (sanity contra bug futuro) e 100% para anualizados (preserva
      // bull/bear reais). Backend correto, mas frontend não confia cego.
      const firstStable = serie.findIndex((p) => {
        if (p.twr === null) return false;
        const cap = p.anualizado === false ? 2.0 : 1.0;
        return Math.abs(p.twr) < cap;
      });
      serie = firstStable === -1 ? [] : serie.slice(firstStable);

      if (this.uplotInstance) {
        try { this.uplotInstance.destroy(); } catch (_) {}
        this.uplotInstance = null;
      }
      if (this.resizeObserverChart) {
        try { this.resizeObserverChart.disconnect(); } catch (_) {}
        this.resizeObserverChart = null;
      }
      target.innerHTML = "";
      if (serie.length === 0) {
        target.innerHTML = '<p class="placeholder">Dados insuficientes — aguarde próximo aporte.</p>';
        return;
      }

      const xs = serie.map((_, i) => i);
      const portfolio = serie.map((p) => p.twr);
      const benchmark = serie.map((p) => p.benchmark);
      const datas = serie.map((p) => p.data); // "YYYY-MM"

      // 7a.E.1: eixo X em "Mmm/AA". uPlot escolhe quantos ticks por largura.
      const meses = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
      const formatarMmmAA = (yyyymm) => {
        if (!yyyymm) return "";
        const [yy, mm] = yyyymm.split("-");
        const idx = parseInt(mm, 10) - 1;
        if (idx < 0 || idx > 11) return yyyymm;
        return `${meses[idx]}/${yy.slice(2)}`;
      };

      // Label do benchmark conforme escopo.
      const benchNomePorEscopo = { Total: "CDI", Brasil: "CDI", EUA: "S&P 500" };
      const benchNome = benchNomePorEscopo[this.escopoAtivo] || "Benchmark";

      const width = Math.max(280, target.clientWidth || 320);
      const opts = {
        width,
        height: 280,
        scales: { x: { time: false }, y: { auto: true } },
        axes: [
          {
            values: (_u, vals) => vals.map((v) => formatarMmmAA(datas[Math.round(v)])),
          },
          {
            // 7a.E.1 (F2): precision-aware. Valores < 1% mostram 2 casas;
            // resto mostra 1 casa. Evita "todos 0,0%" em escala automática.
            values: (_u, vals) => vals.map((v) => {
              if (v === null || v === undefined) return "";
              const abs = Math.abs(v);
              const decimals = abs < 0.01 ? 2 : 1;
              return (v * 100).toFixed(decimals) + "%";
            }),
          },
        ],
        series: [
          {},
          { label: "Portfólio", stroke: "#047857", width: 2 },
          { label: benchNome, stroke: "#9ca3af", width: 1.5, dash: [5, 5] },
        ],
        legend: { show: true },
      };
      try {
        this.uplotInstance = new uPlot(opts, [xs, portfolio, benchmark], target);
      } catch (err) {
        console.warn("uPlot falhou; renderizando placeholder", err);
        target.innerHTML = '<p class="placeholder">Não foi possível renderizar o gráfico.</p>';
        this.uplotInstance = null;
        return;
      }

      if (typeof ResizeObserver !== "undefined") {
        this.resizeObserverChart = new ResizeObserver(() => {
          if (!this.uplotInstance) return;
          const w = Math.max(280, target.clientWidth || 320);
          try { this.uplotInstance.setSize({ width: w, height: 280 }); } catch (_) {}
        });
        this.resizeObserverChart.observe(target);
      }
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
        "EUA": "linear-gradient(90deg, #0b3a5a 0%, #0284c7 100%)",
        "Ações BR": "linear-gradient(90deg, var(--g-700) 0%, var(--g-500) 100%)",
        "FII": "linear-gradient(90deg, #b45309 0%, var(--amber) 100%)",
        "Cripto": "linear-gradient(90deg, #6d28d9 0%, #a855f7 100%)",
      };
      const dot = {
        "EUA": "#0284c7", "Ações BR": "var(--g-600)", "FII": "var(--amber)", "Cripto": "#a855f7",
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

    get escoposRentabilidade() {
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
