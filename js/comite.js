// 7a.BW.5 — o pedido do Comitê de Aporte, no #aportar.
//
// O Dr. Arthur pede uma proposta para o valor já digitado no simulador. O
// pedido em claro (§6.1 da spec 7a.BW) é
//   {"v":1, "valor_brl", "remetido_usd"|null, "nota"|null (<= 280),
//    "criado_em": ISO-8601, "nonce": 16 bytes hex}
// e sai do aparelho só cifrado com a frase de acesso (`window.cifrar`, o
// mesmo formato de src/output/crypto.py), num POST para /comite/pedido no
// próprio Worker, atrás do Access. O Worker nunca vê o valor; o Python
// decifra na Action (src/comite/pedido.py).
//
// Sem conexão (ou se o POST não chega), o corpo JÁ CIFRADO fica guardado em
// localStorage ("comite:rascunho") e sai quando a conexão volta ou por um
// toque em "Enviar agora". Nada em claro é persistido. O rascunho expira em
// 72 h, a mesma janela que o Python aceita para `criado_em`.
//
// Mixin do componente raiz (`...window.comiteBloco()` no Alpine.data("app")):
// precisa de `this.segredo` (a frase em memória depois do desbloqueio) e do
// valor do simulador (`aporteValor`, `_parseAporteValor`, `aporteFmtBrl0`).
//
// Estados (a resposta, `pronta|outro_valor|recusada|antiga`, chega na BW.6):
//   vazio · offline_rascunho · enviando · na_fila · rodando · falha

(function () {
  "use strict";

  const CHAVE_RASCUNHO = "comite:rascunho";
  // Quando ESTE aparelho enviou o último pedido. Só com ele recente o app
  // pergunta ao Worker pelo estado: sem pedido, nada a perguntar (e nenhuma
  // leitura do KV gasta à toa).
  const CHAVE_ENVIADO = "comite:enviado_em";
  const ESTADO_JANELA_MS = 72 * 3600 * 1000;
  const NOTA_MAX = 280;
  // 48 h, e não as 72 h que o Python aceita para `criado_em`: o pedido ainda
  // espera até ~24 h na fila do Worker pelo cron das 03:30. Travado contra a
  // constante do Python em tests/comite/test_pedido.py.
  const RASCUNHO_TTL_MS = 48 * 3600 * 1000;
  // Teto do Python (src/comite/pedido.py VALOR_MAX_BRL), travado no mesmo teste.
  const VALOR_MAX_BRL = 1_000_000;
  // Disparo sem resposta conhecida há mais que isto deixa de ser "rodando".
  const RODANDO_MAX_MS = 2 * 3600 * 1000;

  const TEXTO = {
    enviando: "Enviando o pedido…",
    na_fila: "Pedido na fila; resposta até amanhã às 7h.",
    rodando: "O Comitê está rodando agora; a resposta chega em alguns minutos.",
    offline_rascunho: "Sem conexão; guardei o pedido. Ele sai quando a conexão voltar.",
    limite: "Limite de 3 pedidos por dia atingido. O último pedido segue valendo; amanhã dá para pedir de novo.",
    sessao: "O login do app expirou. Entre de novo e toque em Enviar de novo; o pedido está guardado.",
    expirado: "O pedido guardado tem mais de 2 dias e foi descartado. Peça de novo.",
  };

  function lerRascunho() {
    try {
      const r = JSON.parse(localStorage.getItem(CHAVE_RASCUNHO) || "null");
      if (!r || typeof r.cifra !== "string") return null;
      return r;
    } catch {
      return null;
    }
  }

  function gravarRascunho(r) {
    try {
      localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify(r));
    } catch {
      /* sem storage: o pedido só vive nesta aba */
    }
  }

  function apagarRascunho() {
    try {
      localStorage.removeItem(CHAVE_RASCUNHO);
    } catch {
      /* nada a fazer */
    }
  }

  function lerEnviadoEm() {
    try {
      const t = Date.parse(localStorage.getItem(CHAVE_ENVIADO) || "");
      return Number.isFinite(t) ? t : null;
    } catch {
      return null;
    }
  }

  function gravarEnviadoEm() {
    try {
      localStorage.setItem(CHAVE_ENVIADO, new Date().toISOString());
    } catch {
      /* sem storage: só não pergunta o estado na próxima abertura */
    }
  }

  // Fora do estado do Alpine: o listener de "online" é do documento, uma vez
  // por carga, e uma flag reativa sobreviveria ao "Bloquear sessão" (o
  // lock-higiene.spec.ts compara o estado antes e depois).
  let iniciado = false;

  function nonceHex() {
    const b = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  }

  // "300,50" / "1.234,5" / "300.5" → número; vazio → null; inválido → NaN.
  function lerUsd(raw) {
    const s = String(raw ?? "").trim().replace(/\s/g, "").replace(/^US\$/i, "");
    if (!s) return null;
    const normal = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
    if (!/^\d+(\.\d+)?$/.test(normal)) return NaN;
    return Number(normal);
  }

  window.comiteBloco = function comiteBloco() {
    const inicial = () => ({
      comiteEstado: "vazio",
      comiteMensagem: "",
      comiteRemetido: "",
      comiteNota: "",
      comiteAgora: false,
      comiteErroCampo: "",
    });
    return {
      ...inicial(),
      comiteNotaMax: NOTA_MAX,

      // Chamado por _limparEstadoSensivel (Bloquear sessão): a nota e a
      // remessa digitadas são do Dr. Arthur e não sobrevivem ao bloqueio. O
      // rascunho em localStorage fica: é só a cifra.
      _limparEstadoComite() {
        Object.assign(this, inicial());
      },

      comiteValor() {
        return this._parseAporteValor(this.aporteValor);
      },

      comiteBotaoTexto() {
        const v = this.comiteValor();
        return v > 0 ? `Pedir proposta para ${this.aporteFmtBrl0(v)}` : "Pedir proposta";
      },

      comiteBotaoDesabilitado() {
        return this.comiteEstado === "enviando" || !(this.comiteValor() > 0) || !this.segredo;
      },

      comiteTemRascunho() {
        return this.comiteEstado === "offline_rascunho" || (this.comiteEstado === "falha" && lerRascunho() !== null);
      },

      comiteTextoReenviar() {
        return this.comiteEstado === "offline_rascunho" ? "Enviar agora" : this.comiteMensagem === TEXTO.sessao ? "Enviar de novo" : "Tentar de novo";
      },

      _comitePor(estado, mensagem) {
        this.comiteEstado = estado;
        this.comiteMensagem = mensagem ?? TEXTO[estado] ?? "";
      },

      // x-init do bloco: rascunho guardado, depois o estado do Worker.
      comiteIniciar() {
        if (iniciado) return;
        iniciado = true;
        window.addEventListener("online", () => {
          if (lerRascunho()) this.comiteReenviar();
        });
        const r = lerRascunho();
        if (r) {
          if (Date.now() - Date.parse(r.criado_em) > RASCUNHO_TTL_MS) {
            apagarRascunho();
            this._comitePor("falha", TEXTO.expirado);
          } else {
            this._comitePor("offline_rascunho");
          }
          return;
        }
        this.comiteAtualizarEstado();
      },

      async comiteAtualizarEstado() {
        if (!navigator.onLine) return;
        const enviado = lerEnviadoEm();
        if (enviado === null || Date.now() - enviado > ESTADO_JANELA_MS) return;
        try {
          const r = await fetch("./comite/estado", { cache: "no-store", redirect: "manual" });
          if (!r.ok) return;
          const e = await r.json();
          if (this.comiteEstado !== "vazio") return; // algo aconteceu enquanto lia
          if (e.pendente) {
            this._comitePor("na_fila");
          } else if (e.disparado_em && Date.now() - Date.parse(e.disparado_em) < RODANDO_MAX_MS) {
            this._comitePor("rodando");
          }
        } catch {
          /* sem estado do Worker: fica "vazio" */
        }
      },

      async comiteEnviar() {
        this.comiteErroCampo = "";
        const valor = this.comiteValor();
        if (!(valor > 0) || !this.segredo) return;
        if (valor > VALOR_MAX_BRL) {
          this._comitePor("falha", "O Comitê aceita pedidos de até R$ 1.000.000. Ajuste o valor acima.");
          return;
        }
        const remetido = lerUsd(this.comiteRemetido);
        if (Number.isNaN(remetido)) {
          this.comiteErroCampo = "Valor em US$ inválido. Use só números, como 300 ou 300,50.";
          return;
        }
        const nota = this.comiteNota.trim().slice(0, NOTA_MAX) || null;
        const pedido = {
          v: 1,
          valor_brl: valor,
          remetido_usd: remetido,
          nota,
          criado_em: new Date().toISOString(),
          nonce: nonceHex(),
        };
        this._comitePor("enviando");
        let cifra;
        try {
          cifra = await window.cifrar(JSON.stringify(pedido), this.segredo);
        } catch {
          this._comitePor("falha", "Não consegui cifrar o pedido neste aparelho. Toque em Pedir proposta de novo.");
          return;
        }
        const rascunho = { cifra, imediato: Boolean(this.comiteAgora), criado_em: pedido.criado_em };
        gravarRascunho(rascunho);
        await this._comitePost(rascunho);
      },

      async comiteReenviar() {
        // Um envio por vez: o evento "online" e o toque em "Enviar agora"
        // podem chegar juntos, e cada POST gasta uma das 3 vagas do dia.
        if (this.comiteEstado === "enviando") return;
        const r = lerRascunho();
        if (!r) return;
        if (Date.now() - Date.parse(r.criado_em) > RASCUNHO_TTL_MS) {
          apagarRascunho();
          this._comitePor("falha", TEXTO.expirado);
          return;
        }
        this._comitePor("enviando");
        await this._comitePost(r);
      },

      async _comitePost(rascunho) {
        if (!navigator.onLine) {
          this._comitePor("offline_rascunho");
          return;
        }
        let resp;
        try {
          resp = await fetch("./comite/pedido", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ cifra: rascunho.cifra, imediato: rascunho.imediato }),
            redirect: "manual",
            cache: "no-store",
          });
        } catch {
          this._comitePor("offline_rascunho");
          return;
        }
        // O Access responde redirect para o login quando a sessão venceu.
        if (resp.type === "opaqueredirect" || resp.status === 401 || resp.status === 403 || (resp.status >= 300 && resp.status < 400)) {
          this._comitePor("falha", TEXTO.sessao);
          return;
        }
        if (resp.status === 429) {
          apagarRascunho();
          this._comitePor("falha", TEXTO.limite);
          return;
        }
        if (resp.status !== 202) {
          this._comitePor("falha", `O pedido não chegou ao Comitê (erro ${resp.status}). Toque em Tentar de novo.`);
          return;
        }
        apagarRascunho();
        gravarEnviadoEm();
        let corpo = {};
        try {
          corpo = await resp.json();
        } catch {
          /* 202 sem corpo: na fila */
        }
        this._comitePor(corpo.estado === "disparado" ? "rodando" : "na_fila");
      },
    };
  };
})();
