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
    pin: "",
    pinError: "",
    carregando: false,
    json: null,
    agora: Date.now(),
    pinBlockUntil: 0,
    shake: false,
    toast: { visible: false, mensagem: "", tom: "verde", timer: null },
    agoraTimer: null,

    async init() {
      this.pinBlockUntil = Number(sessionStorage.getItem("pinBlockUntil")) || 0;
      this.agoraTimer = setInterval(() => { this.agora = Date.now(); }, 1000);
      await this.tentarAutoResume();
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
      const anterior = sessionStorage.getItem("atualizadoEm");
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
      const pin = sessionStorage.getItem("pin");
      const ts = Number(sessionStorage.getItem("pinTimestamp") || 0);
      if (!pin || !ts) return;
      if (Date.now() - ts >= SESSION_TTL_MS) {
        sessionStorage.removeItem("pin");
        sessionStorage.removeItem("pinTimestamp");
        sessionStorage.removeItem("atualizadoEm");
        return;
      }
      this.carregando = true;
      try {
        const response = await fetch("./portfolio.json.enc", { cache: "no-cache" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payloadB64 = (await response.text()).trim();
        const plaintext = await window.decifrar(payloadB64, pin);
        this.json = JSON.parse(plaintext);
        this.pin = pin;
        this.fase = "raiox";
        this.avaliarAtualizacao(this.json.atualizado_em);
        sessionStorage.setItem("atualizadoEm", this.json.atualizado_em);
      } catch (err) {
        console.warn("auto-resume falhou, limpando sessão", err);
        sessionStorage.removeItem("pin");
        sessionStorage.removeItem("pinTimestamp");
        sessionStorage.removeItem("atualizadoEm");
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
      let fails = Number(sessionStorage.getItem("pinFails") || 0);
      let firstAt = Number(sessionStorage.getItem("pinFirstFailAt") || 0);
      if (!firstAt || agora - firstAt > FAIL_WINDOW_MS) {
        fails = 0;
        firstAt = agora;
      }
      fails += 1;
      sessionStorage.setItem("pinFails", String(fails));
      sessionStorage.setItem("pinFirstFailAt", String(firstAt));

      let dur = 0;
      if (fails === 5) dur = BLOCK_5_MS;
      else if (fails === 6) dur = BLOCK_15_MS;
      else if (fails >= 7) dur = BLOCK_60_MS;
      if (dur > 0) {
        const until = agora + dur;
        this.pinBlockUntil = until;
        sessionStorage.setItem("pinBlockUntil", String(until));
      }
    },

    resetarFalhas() {
      sessionStorage.removeItem("pinFails");
      sessionStorage.removeItem("pinFirstFailAt");
      sessionStorage.removeItem("pinBlockUntil");
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
      sessionStorage.clear();
      this.fase = "pin";
      this.json = null;
      this.pin = "";
      this.pinError = "";
      this.pinBlockUntil = 0;
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
        sessionStorage.setItem("pin", this.pin);
        sessionStorage.setItem("pinTimestamp", String(Date.now()));
        sessionStorage.setItem("atualizadoEm", this.json.atualizado_em);
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
