// 7a.BZ.2 — a reserva no Raio-X (spec 7a.BZ §4.4).
//
// A rotina `reserva.yml` (repo principal) lê todo dia, pelo Open Finance, o saldo
// da reserva, cifra o payload com a frase de acesso e o grava no KV do Worker
// (chave `reserva`, valor {cifra, gravada_em}); o Worker o entrega em GET /reserva.
// O service worker guarda a última resposta para offline ou sessão vencida.
//
// A reserva NÃO é carteira: fica fora do hero do patrimônio e nunca é somada a
// número nenhum da tela. Este código é público, então não nomeia a instituição:
// a origem escrita é "Open Finance".
//
// Payload (o montador da reserva no repo principal, versao 1): lido_em, atualizado_pelo_banco_em,
// status_item, execucao_item, total, n_posicoes, n_sem_saldo.
//
// Mixin do componente raiz (`...window.reservaBloco()`); precisa de `this.segredo`.
// O claro vive só em memória e sai no "Bloquear sessão".

(function () {
  "use strict";

  const LIMITE_MS = 48 * 3600 * 1000; // spec §4.3: mais de 48 h = desatualizada

  function ms(iso) {
    const t = typeof iso === "string" ? Date.parse(iso) : NaN;
    return Number.isFinite(t) ? t : null;
  }
  function ddmm(iso) {
    const t = ms(iso);
    if (t === null) return "";
    const d = new Date(t); // hora local do aparelho
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  function velho(iso, agora) {
    const t = ms(iso);
    return t === null || agora - t > LIMITE_MS;
  }

  // Mesmos gatilhos do backend que dizem respeito à idade do número, mais a
  // idade da própria leitura (rotina parada).
  function desatualizada(p, agora = Date.now()) {
    if (!p) return false;
    if (p.status_item !== "UPDATED") return true;
    if (p.execucao_item != null && p.execucao_item !== "SUCCESS") return true;
    return velho(p.atualizado_pelo_banco_em, agora) || velho(p.lido_em, agora);
  }

  // Payload que a tela sabe mostrar. Sem posição nenhuma ("vazio" no backend),
  // R$ 0,00 seria número falso: a tela diz "indisponível".
  function valida(p) {
    return (
      !!p && p.versao === 1 && typeof p.total === "number" && Number.isFinite(p.total) &&
      typeof p.n_posicoes === "number" && p.n_posicoes > 0
    );
  }

  window.reservaBloco = function reservaBloco() {
    const inicial = () => ({
      reserva: null, // payload decifrado
      reservaEstado: "carregando", // carregando | pronto | indisponivel
    });
    let emVoo = null;
    let geracao = 0; // sobe a cada bloqueio
    let ouvindo = false;

    return {
      ...inicial(),

      _limparEstadoReserva() {
        Object.assign(this, inicial());
        emVoo = null;
        geracao++; // a busca em voo de antes do bloqueio não grava mais nada
      },

      // Chamado no desbloqueio, sem await: nada da 1ª pintura depende dele.
      // Erro numa nova busca deixa o que já havia.
      reservaCarregar() {
        // Ao voltar ao app (aba visível de novo), busca outra vez: num PWA
        // deixado aberto por dias, a leitura nova chega e a marca de
        // desatualizada é reavaliada (o payload novo re-renderiza o bloco).
        if (!ouvindo) {
          ouvindo = true;
          document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible" && this.segredo) this.reservaCarregar();
          });
        }
        if (!this.segredo) return Promise.resolve();
        if (emVoo) return emVoo;
        const minha = geracao;
        const segredo = this.segredo;
        const vale = () => geracao === minha && this.segredo === segredo;
        const busca = (async () => {
          try {
            const r = await fetch("./reserva", { cache: "no-store" });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const corpo = await r.json();
            if (!vale()) return;
            if (typeof corpo?.cifra !== "string" || !corpo.cifra) throw new Error("sem cifra");
            const obj = JSON.parse(await window.decifrar(corpo.cifra, segredo));
            if (!vale()) return;
            if (!valida(obj)) throw new Error("payload");
            this.reserva = obj;
            this.reservaEstado = "pronto";
          } catch {
            if (vale() && !this.reserva) this.reservaEstado = "indisponivel";
          } finally {
            if (emVoo === busca) emVoo = null;
          }
        })();
        emVoo = busca;
        return busca;
      },

      reservaDesatualizada() {
        return desatualizada(this.reserva);
      },

      reservaValorTexto() {
        if (this.reserva) return window.formatBrl(this.reserva.total);
        return this.reservaEstado === "indisponivel" ? "indisponível" : "…";
      },

      reservaFonteTexto() {
        if (!this.reserva) return "";
        const data = ddmm(this.reserva.lido_em);
        return this.reservaDesatualizada()
          ? `Desatualizada: lida em ${data} pelo Open Finance`
          : `Lida em ${data} pelo Open Finance`;
      },

      reservaSemSaldoTexto() {
        const n = (this.reserva && this.reserva.n_sem_saldo) || 0;
        if (n <= 0) return "";
        return n === 1
          ? "1 aplicação veio sem saldo e ficou fora da soma."
          : `${n} aplicações vieram sem saldo e ficaram fora da soma.`;
      },
    };
  };
})();
