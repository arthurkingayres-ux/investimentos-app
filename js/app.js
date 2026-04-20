document.addEventListener("alpine:init", () => {
  Alpine.data("app", () => ({
    fase: "pin",
    pin: "",
    pinError: "",
    carregando: false,
    json: null,

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
