// 7a.BZ.3 — as notas pendentes no Raio-X (spec 7a.BZ §4.5).
//
// O job `conferencia` do reserva.yml (repo principal) compara todo dia, pelo
// Open Finance, as operações e posições da corretora com o banco, cifra a lista
// do que falta no banco com a frase de acesso e a grava no KV do Worker (chave
// `conferencia`, valor {cifra, gravada_em}); o Worker a entrega em
// GET /conferencia. O service worker guarda a última resposta para offline ou
// sessão vencida.
//
// Nada daqui é somado a número nenhum da tela. Este código é público, então não
// nomeia a instituição: a origem escrita é "Open Finance".
//
// Payload (versao 1): lido_em, itens[]. Cada item é
//   {tipo: "operacao", data: "aaaa-mm-dd", ticker, lado: "Compra"|"Venda"} ou
//   {tipo: "posicao", ticker}.
// Payload fora dessa forma, inteiro, é tratado como indisponível: o bloco não
// aparece (nunca uma lista pela metade).
//
// Mixin do componente raiz (`...window.conferenciaBloco()`); precisa de
// `this.segredo`. O claro vive só em memória e sai no "Bloquear sessão".

(function () {
  "use strict";

  const LIMITE_MS = 48 * 3600 * 1000; // mesma régua da reserva: mais de 48 h = desatualizada
  const RE_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

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
  // Data de pregão (sem hora nem fuso): só reordena, nunca passa por Date.
  function ddmmaaaa(data) {
    const m = RE_DATA.exec(data);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
  }

  const texto = (v) => typeof v === "string" && v.trim() !== "";

  function itemValido(i) {
    if (!i || typeof i !== "object") return false;
    if (i.tipo === "operacao") {
      return RE_DATA.test(i.data ?? "") && texto(i.ticker) && (i.lado === "Compra" || i.lado === "Venda");
    }
    if (i.tipo === "posicao") return texto(i.ticker);
    return false;
  }

  function valida(p) {
    return (
      !!p && p.versao === 1 && ms(p.lido_em) !== null &&
      Array.isArray(p.itens) && p.itens.every(itemValido)
    );
  }

  window.conferenciaBloco = function conferenciaBloco() {
    const inicial = () => ({
      conferencia: null, // payload decifrado e válido
    });
    let emVoo = null;
    // A última busca iniciada, que o bloqueio não esquece: é o sinal de "já
    // resolveu" para quem precisa saber sem relógio (os testes).
    let ultima = null;
    let geracao = 0; // sobe a cada bloqueio
    let ouvindo = false;

    return {
      ...inicial(),

      _limparEstadoConferencia() {
        Object.assign(this, inicial());
        emVoo = null;
        geracao++; // a busca em voo de antes do bloqueio não grava mais nada
      },

      // Chamado no desbloqueio, sem await: nada da 1ª pintura depende dele.
      // Erro numa nova busca deixa o que já havia.
      conferenciaCarregar() {
        // Ao voltar ao app, busca outra vez (a conferência é diária e a marca
        // de 48 h precisa ser reavaliada num PWA aberto por dias).
        if (!ouvindo) {
          ouvindo = true;
          document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible" && this.segredo) this.conferenciaCarregar();
          });
        }
        if (!this.segredo) return Promise.resolve();
        if (emVoo) return emVoo;
        const minha = geracao;
        const segredo = this.segredo;
        const vale = () => geracao === minha && this.segredo === segredo;
        const busca = (async () => {
          try {
            const r = await fetch("./conferencia", { cache: "no-store" });
            if (!r.ok) return;
            const corpo = await r.json();
            if (!vale()) return;
            if (typeof corpo?.cifra !== "string" || !corpo.cifra) return;
            const obj = JSON.parse(await window.decifrar(corpo.cifra, segredo));
            if (!vale() || !valida(obj)) return;
            this.conferencia = obj;
          } catch {
            // Sem conferência legível o bloco simplesmente não aparece.
          } finally {
            if (emVoo === busca) emVoo = null;
          }
        })();
        emVoo = busca;
        ultima = busca;
        return busca;
      },

      // Promise da última busca (null antes da primeira). Resolve quando ela
      // termina, tenha mostrado o bloco ou não; nunca rejeita.
      conferenciaUltimaBusca() {
        return ultima;
      },

      conferenciaVisivel() {
        return !!this.conferencia && this.conferencia.itens.length > 0;
      },

      conferenciaContagemTexto() {
        const n = this.conferencia ? this.conferencia.itens.length : 0;
        return n === 1 ? "1 pendente" : `${n} pendentes`;
      },

      conferenciaData(data) {
        return ddmmaaaa(data);
      },

      conferenciaDesatualizada() {
        if (!this.conferencia) return false;
        const t = ms(this.conferencia.lido_em);
        return t === null || Date.now() - t > LIMITE_MS;
      },

      conferenciaFonteTexto() {
        if (!this.conferencia) return "";
        const data = ddmm(this.conferencia.lido_em);
        return this.conferenciaDesatualizada()
          ? `Desatualizada: conferida em ${data} pelo Open Finance`
          : `Conferida em ${data} pelo Open Finance`;
      },
    };
  };
})();
