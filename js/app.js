document.addEventListener("alpine:init", () => {
  Alpine.data("app", () => ({
    fase: "pin",
    pin: "",
    pinError: "",
    carregando: false,
    json: null,

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
          interpretacao: (r.interpretacao && r.interpretacao[k]) || null,
          benchmarks: Object.entries(r[k].benchmarks || {}),
          isFirst: i === 0,
        }));
    },

    async submitPin() {
      if (this.pin.length !== 6 || !/^\d{6}$/.test(this.pin)) {
        this.pinError = "PIN deve ter 6 dígitos";
        return;
      }
      this.pinError = "";
      this.carregando = true;
      try {
        const response = await fetch("./portfolio.json.enc", { cache: "no-cache" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payloadB64 = (await response.text()).trim();
        const plaintext = await window.decifrar(payloadB64, this.pin);
        this.json = JSON.parse(plaintext);
        this.fase = "raiox";
      } catch (err) {
        console.error(err);
        this.pinError = "PIN incorreto ou dados indisponíveis";
        this.pin = "";
      } finally {
        this.carregando = false;
      }
    },
  }));
});
