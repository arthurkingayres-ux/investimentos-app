const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FAIL_WINDOW_MS = 30 * 60 * 1000;
const BLOCK_5_MS = 5 * 60 * 1000;
const BLOCK_15_MS = 15 * 60 * 1000;
const BLOCK_60_MS = 60 * 60 * 1000;

function derivarTomInterpretacao(texto) {
  if (!texto) return "neutro";
  if (texto === "Boas escolhas de ativos e timing favorável") return "bom";
  if (texto === "Seleção e timing abaixo do índice") return "ruim";
  if (texto.startsWith("Dados insuficientes")) return "neutro";
  return "misto";
}

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
      const totalCarteira =
        (this.json && this.json.patrimonio && this.json.patrimonio.total_brl) || 0;
      return tickers.map((p) => ({
        ...p,
        peso_na_classe: totalClasse > 0 ? (p.valor_mercado_brl || 0) / totalClasse : 0,
        peso_no_total: totalCarteira > 0 ? (p.valor_mercado_brl || 0) / totalCarteira : 0,
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

    pctAlvoClasse(classe) {
      const alvo = (this.json && this.json.alocacao && this.json.alocacao.alvo) || {};
      for (const k of this._aliasesClasse(classe)) {
        if (alvo[k] != null) return alvo[k];
      }
      return 0;
    },

    hidratarRentabilidade() {
      if (this.rota !== "rentabilidade" || !this.json) return;
      const target = document.getElementById("chart-rent");
      if (!target || typeof uPlot === "undefined") return;
      const rent = (this.json.rentabilidade || {})[this.escopoAtivo];
      const serie = (rent && rent.historico_twr) || [];
      // Limpa instância anterior antes de redesenhar.
      if (this.uplotInstance) {
        try { this.uplotInstance.destroy(); } catch (_) {}
        this.uplotInstance = null;
      }
      // Desliga ResizeObserver anterior se existir.
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
      const portfolio = serie.map((p) => (p.twr ?? null));
      const benchmark = serie.map((p) => (p.benchmark ?? null));
      const datas = serie.map((p) => p.data);
      const width = Math.max(280, target.clientWidth || 320);
      const opts = {
        width,
        height: 280,
        scales: { x: { time: false }, y: { auto: true } },
        axes: [
          { values: (_u, vals) => vals.map((v) => datas[Math.round(v)] || "") },
          { values: (_u, vals) => vals.map((v) => (v * 100).toFixed(1) + "%") },
        ],
        series: [
          {},
          { label: "Portfólio", stroke: "#047857", width: 2 },
          { label: "Benchmark", stroke: "#9ca3af", width: 1.5, dash: [5, 5] },
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
      // ResizeObserver: rotação portrait↔landscape ou split-screen ajusta o canvas.
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
        .map((k, i) => {
          const interpretacao = (r.interpretacao && r.interpretacao[k]) || null;
          return {
            key: k,
            flag: flags[k],
            data: r[k],
            interpretacao,
            tom: derivarTomInterpretacao(interpretacao),
            benchmarks: Object.entries(r[k].benchmarks || {}),
            isFirst: i === 0,
          };
        });
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
