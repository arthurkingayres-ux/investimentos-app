// 7a.BX.4 — o Olho no app (spec 7a.BX §13).
//
// A rotina `olho.yml` (repo principal) lê toda segunda, na fonte oficial (CVM,
// fnet, EDGAR), o fato novo de cada ativo com tese e o confronta com o
// `quebra_se`. O `publicar` cifra o resultado com a frase de acesso e o grava no
// KV do Worker (chave `olho`, valor {cifra, gravada_em}); o Worker o entrega em
// GET /olho. O service worker guarda a última resposta e, offline ou com a
// sessão do Access vencida, devolve essa cópia com `x-olho-cache: 1`.
//
// Três superfícies, só leitura (D1): a seção "Vigília" no dossiê, UMA linha no
// Raio-X quando existe tese sob ameaça ainda não examinada, e a rota #olho. Nada
// se dispensa por toque: o aviso some quando o reexame do Relatório confronta a
// tese, porque a verdade mudou (o `publicar` marca `examinado`).
//
// Payload (src/olho/payload.py, versao 1): ultima_rodada, primeira_rodada,
// vigiados {ticker: fonte}, alertas[], sem_efeito_por_ticker, falhas_leitura[],
// fila. `primeira_rodada` e `vigiados` chegaram na BX.4: payload anterior não os
// tem, e a tela degrada (sem "vigiado desde", sem "fora da vigília").
//
// Mixin do componente raiz (`...window.olhoBloco()`); precisa de `this.segredo`.
// O claro vive só em memória e sai no "Bloquear sessão".

(function () {
  "use strict";

  const ATRASO_DIAS = 10; // spec §13.1 item 6: vigília atrasada
  const FONTES = ["cvm", "fnet", "edgar"];
  const NOME_FONTE = { cvm: "CVM", fnet: "fnet", edgar: "EDGAR" };
  // O que cada fonte cobre, para a frase de fonte fora do ar.
  const COBRE = {
    cvm: ["ação brasileira", "ações brasileiras"],
    fnet: ["FII", "FIIs"],
    edgar: ["ação americana", "ações americanas"],
  };
  const GRAU = {
    tese_sob_ameaca: { rotulo: "Tese sob ameaça", glifo: "▲" },
    observar: { rotulo: "Observar", glifo: "◇" },
  };
  const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

  // "YYYY-MM-DD" por regex (nunca `new Date(iso)`: meia-noite UTC volta um dia
  // em America/Sao_Paulo).
  function partes(iso) {
    const m = typeof iso === "string" ? iso.match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
    return m ? { a: +m[1], m: +m[2], d: +m[3] } : null;
  }
  function ddmm(iso) {
    const p = partes(iso);
    return p ? `${String(p.d).padStart(2, "0")}/${String(p.m).padStart(2, "0")}` : "";
  }
  function diaDaSemana(iso) {
    const p = partes(iso);
    return p ? DIAS_SEMANA[new Date(Date.UTC(p.a, p.m - 1, p.d)).getUTCDay()] : "";
  }
  function hojeIso(agora = new Date()) {
    const z = (n) => String(n).padStart(2, "0");
    return `${agora.getFullYear()}-${z(agora.getMonth() + 1)}-${z(agora.getDate())}`;
  }
  function diasEntre(isoA, isoB) {
    const a = partes(isoA), b = partes(isoB);
    if (!a || !b) return null;
    return Math.round((Date.UTC(b.a, b.m - 1, b.d) - Date.UTC(a.a, a.m - 1, a.d)) / 86400000);
  }
  // A próxima segunda (o cron é segunda 11:00 UTC = 08:00 BRT); hoje, se hoje é segunda.
  function proximaSegunda(agora = new Date()) {
    const d = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
    while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
    return hojeIso(d);
  }
  function plural(n, um, varios) {
    // Espaço não separável: o número nunca fica no fim de uma linha e a palavra na outra.
    return `${n} ${n === 1 ? um : varios}`;
  }

  window.olhoBloco = function olhoBloco() {
    const inicial = () => ({
      olho: null, // payload decifrado
      olhoEstado: "ausente", // ausente | carregando | pronto | nunca | erro
      olhoDoCache: false, // veio da cópia do service worker (offline/sessão vencida)
      olhoGravadaEm: null,
      olhoSemEfeitoAberto: false,
    });
    let emVoo = null;
    let cifraDecifrada = null;
    let geracao = 0; // sobe a cada bloqueio

    return {
      ...inicial(),

      _limparEstadoOlho() {
        Object.assign(this, inicial());
        emVoo = null;
        cifraDecifrada = null;
        geracao++; // a busca em voo de antes do bloqueio não grava mais nada
      },

      // Chamado no desbloqueio (sem await: nada da 1ª pintura depende dele) e ao
      // entrar em #olho. Uma busca por vez; erro de rede deixa o que já havia.
      olhoCarregar() {
        if (!this.segredo) return Promise.resolve();
        if (emVoo) return emVoo;
        const minha = geracao;
        const vale = () => geracao === minha && !!this.segredo;
        if (this.olhoEstado === "ausente") this.olhoEstado = "carregando";
        const busca = (async () => {
          try {
            const r = await fetch("./olho", { cache: "no-store" });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const corpo = await r.json();
            if (!vale()) return;
            const doCache = r.headers.get("x-olho-cache") === "1";
            if (typeof corpo?.cifra !== "string" || !corpo.cifra) {
              // KV sem chave: a rotina ainda não publicou nada.
              if (!this.olho) this.olhoEstado = "nunca";
              return;
            }
            // Só a cópia que decifrou muda a idade mostrada.
            if (await this._olhoDecifrar(corpo.cifra, vale)) {
              this.olhoDoCache = doCache;
              this.olhoGravadaEm = corpo.gravada_em ?? null;
            }
          } catch {
            if (vale() && !this.olho) this.olhoEstado = "erro";
          } finally {
            if (emVoo === busca) emVoo = null;
          }
        })();
        emVoo = busca;
        return busca;
      },

      // true se `this.olho` passou a ser (ou já era) esta cifra.
      async _olhoDecifrar(cifra, vale) {
        const segredo = this.segredo;
        if (!segredo) return false;
        if (this.olho && cifraDecifrada === cifra) return true;
        let obj;
        try {
          obj = JSON.parse(await window.decifrar(cifra, segredo));
        } catch {
          if (vale() && !this.olho) this.olhoEstado = "erro";
          return false;
        }
        if (!vale() || this.segredo !== segredo) return false; // bloqueado durante a decifra
        if (!obj || obj.versao !== 1) {
          if (!this.olho) this.olhoEstado = "erro";
          return false;
        }
        cifraDecifrada = cifra;
        this.olho = obj;
        this.olhoEstado = obj.ultima_rodada ? "pronto" : "nunca";
        return true;
      },

      // ── leitura derivada ──────────────────────────────────────────────
      olhoGrau(g) {
        return GRAU[g] || { rotulo: "", glifo: "" };
      },

      olhoAlertas(grau) {
        const todos = (this.olho && this.olho.alertas) || [];
        return grau ? todos.filter((a) => a.grau === grau) : todos;
      },

      olhoAmeacasPendentes() {
        return this.olhoAlertas("tese_sob_ameaca").filter((a) => !a.examinado);
      },

      // Raio-X: só existe com tese sob ameaça não examinada (D1).
      olhoLinhaRaiox() {
        const n = this.olhoAmeacasPendentes().length;
        return n ? `${n} ${n === 1 ? "tese sob ameaça" : "teses sob ameaça"}` : "";
      },

      olhoUltima() {
        return (this.olho && this.olho.ultima_rodada) || null;
      },

      olhoAtrasado() {
        const u = this.olhoUltima();
        const dias = u ? diasEntre(u.data, hojeIso()) : null;
        return dias !== null && dias > ATRASO_DIAS;
      },

      olhoAvisoAtraso() {
        const u = this.olhoUltima();
        if (!u || !this.olhoAtrasado()) return "";
        const dias = diasEntre(u.data, hojeIso());
        return `A vigília está parada: a última leitura foi em ${ddmm(u.data)}, há ${dias} dias. Nada lido depois disso aparece aqui.`;
      },

      olhoAvisoCache() {
        if (!this.olhoDoCache) return "";
        const t = this.olhoGravadaEm ? new Date(this.olhoGravadaEm) : null;
        // `gravada_em` é UTC; o dia mostrado é o do aparelho (gravação às 22h BRT é do mesmo dia).
        const quando = t && !Number.isNaN(t.getTime()) ? ddmm(hojeIso(t)) : "";
        return quando ? `Sem conexão: mostrando a vigília guardada em ${quando}.` : "Sem conexão: mostrando a última vigília guardada.";
      },

      olhoPrimeiraVigilia() {
        return `A primeira vigília roda na segunda ${ddmm(proximaSegunda())}.`;
      },

      olhoCabecalho() {
        const u = this.olhoUltima();
        if (!u) return "";
        const partesTxt = [`Última vigília ${diaDaSemana(u.data)} ${ddmm(u.data)}`];
        if (Number.isFinite(u.vigiados)) partesTxt.push(plural(u.vigiados, "ativo", "ativos"));
        if (Number.isFinite(u.lidos)) partesTxt.push(plural(u.lidos, "documento lido", "documentos lidos"));
        return partesTxt.join(" · ");
      },

      // Uma entrada por fonte, na ordem fixa; `ok` curto, o resto com o que deixou
      // de ser vigiado.
      olhoFontes() {
        const u = this.olhoUltima();
        const fontes = (u && u.fontes) || {};
        return FONTES.filter((f) => fontes[f]).map((f) => {
          const e = fontes[f].estado;
          const ok = e === "ok";
          let texto = `${NOME_FONTE[f]} ok`;
          if (!ok) {
            const n = Number(fontes[f].ids) || this.olhoVigiadosPorFonte(f);
            const como = e === "muda" ? "respondeu vazio nesta semana" : "sem resposta nesta semana";
            texto = `${NOME_FONTE[f]} ${como}`;
            if (n > 0) texto += `: ${plural(n, COBRE[f][0], COBRE[f][1])} sem vigília`;
          }
          return { fonte: f, ok, texto };
        });
      },


      olhoVigiadosPorFonte(f) {
        const v = (this.olho && this.olho.vigiados) || {};
        return Object.values(v).filter((x) => x === f).length;
      },

      olhoSemNovidade() {
        const u = this.olhoUltima();
        return !!u && Number(u.novidades) === 0 && this.olhoAlertas().length === 0;
      },

      olhoFraseSemNovidade() {
        const u = this.olhoUltima();
        const n = u && Number.isFinite(u.vigiados) ? plural(u.vigiados, "ativo vigiado", "ativos vigiados") : "Ativos vigiados";
        return `${n}, nada novo.`;
      },

      olhoFila() {
        const n = Number((this.olho && this.olho.fila) || 0);
        return n > 0 ? `${plural(n, "documento ficou", "documentos ficaram")} na fila para a próxima vigília.` : "";
      },

      olhoFalhas(ticker) {
        const f = (this.olho && this.olho.falhas_leitura) || [];
        return ticker ? f.filter((x) => x.ticker === ticker) : f;
      },

      olhoSemEfeitoTotal() {
        const s = (this.olho && this.olho.sem_efeito_por_ticker) || {};
        return Object.values(s).reduce((a, n) => a + (Number(n) || 0), 0);
      },

      olhoSemEfeitoLinhas() {
        const s = (this.olho && this.olho.sem_efeito_por_ticker) || {};
        return Object.keys(s).sort().map((t) => ({ ticker: t, n: Number(s[t]) || 0 }));
      },

      olhoSemEfeitoRotulo() {
        return `${plural(this.olhoSemEfeitoTotal(), "lido", "lidos")} sem efeito`;
      },

      // ── um alerta ─────────────────────────────────────────────────────

      // Data de entrega e categoria (o ticker vai à parte: link na rota, ausente no dossiê).
      olhoMetaSemTicker(a) {
        return [ddmm(a.data_entrega), a.categoria].filter(Boolean).join(" · ");
      },

      olhoEstadoAlerta(a) {
        return a.examinado ? `examinado no Relatório de ${ddmm(a.examinado_em)}` : "aguarda o reexame";
      },

      olhoRotuloAlerta(a) {
        const g = this.olhoGrau(a.grau);
        return `${g.rotulo}: ${a.ticker}, ${a.titulo || a.categoria || "documento"}`;
      },

      // ── o dossiê ──────────────────────────────────────────────────────
      // fora | vigiado | desconhecido (payload sem `vigiados` e nada do ticker).
      olhoSituacaoDe(ticker) {
        if (!this.olho || !ticker) return "desconhecido";
        const v = this.olho.vigiados;
        if (v && typeof v === "object") return Object.prototype.hasOwnProperty.call(v, ticker) ? "vigiado" : "fora";
        const tem =
          this.olhoAlertas().some((a) => a.ticker === ticker) ||
          this.olhoFalhas(ticker).length > 0 ||
          Object.prototype.hasOwnProperty.call(this.olho.sem_efeito_por_ticker || {}, ticker);
        return tem ? "vigiado" : "desconhecido";
      },

      // A seção existe quando há o que dizer: nunca rodou, fora, ou vigiado.
      olhoMostraVigilia(ticker) {
        return this.olhoEstado === "nunca" || (this.olhoEstado === "pronto" && this.olhoSituacaoDe(ticker) !== "desconhecido");
      },

      // A linha do Olho no índice do Diagnóstico.
      olhoEstadoIndice() {
        if (this.olhoEstado === "nunca") return this.olhoPrimeiraVigilia();
        if (this.olhoEstado !== "pronto") return "A vigília semanal dos fatos das empresas.";
        const u = this.olhoUltima();
        const n = this.olhoAmeacasPendentes().length;
        const base = `Última vigília ${ddmm(u.data)}`;
        if (this.olhoAtrasado()) return `${base}: a vigília está parada.`;
        if (n) return `${base}: ${n === 1 ? "1 tese sob ameaça" : n + " teses sob ameaça"}.`;
        return `${base}: nenhuma tese sob ameaça.`;
      },

      olhoAlertasDe(ticker) {
        return this.olhoAlertas().filter((a) => a.ticker === ticker);
      },

      olhoFonteForaDe(ticker) {
        const f = this.olho && this.olho.vigiados && this.olho.vigiados[ticker];
        if (!f) return "";
        const item = this.olhoFontes().find((x) => x.fonte === f);
        if (!item || item.ok) return "";
        const e = this.olhoUltima().fontes[f].estado;
        return `${NOME_FONTE[f]} ${e === "muda" ? "respondeu vazio" : "sem resposta"} nesta semana: este ativo não foi vigiado.`;
      },

      olhoRodapeDe(ticker) {
        const u = this.olhoUltima();
        if (!u) return "";
        const p = [];
        if (this.olho.primeira_rodada) p.push(`vigiado desde ${ddmm(this.olho.primeira_rodada)}`);
        p.push(`última vigília ${ddmm(u.data)}`);
        const n = Number((this.olho.sem_efeito_por_ticker || {})[ticker] || 0);
        p.push(plural(n, "documento lido sem efeito", "documentos lidos sem efeito"));
        const t = p.join(" · ");
        return t.charAt(0).toUpperCase() + t.slice(1);
      },
    };
  };

})();
