// Fase 7a.H.1 — Algoritmo do executor de política #aportar.
// Recebe um valor R$ + portfolio (já decifrado) e devolve uma lista de
// compras (cotas por ticker) que executa a política em config/alocacao.yaml.
// Read-only puro: sem escrita no banco, sem persistência no JSON.
//
// Cap de 5 picks por aporte (controle de custo de corretagem). O aporte
// inteiro é distribuído entre os 5 ativos mais subexpostos por gap em R$;
// resíduo de arredondamento absorvido por pick fracionário (EUA) quando
// existir, senão +1 cota no top-priority.
//
// Fonte de verdade: docs/superpowers/specs/2026-05-14-fase-7a-h1-aportar-design.md
// (seções 4 e 8).
//
// 7a.AU: opcoes.mercado restringe o plano a uma categoria-mercado; ver
// docs/superpowers/specs/2026-09-24-fase-7a-au-aporte-por-mercado-design.md.

(function () {
  "use strict";

  const PICKS_MAX = 5;

  // ── 7a.AU: mercado do aporte ──────────────────────────────────────────
  // Mercado = CATEGORIA da política, não moeda (decisão do Dr. Arthur,
  // spec 2026-09-24 §2): INTR/XP são USD mas categoria "Ações BR", logo
  // entram no Brasil. É a ÚNICA definição de mercado deste arquivo —
  // candidatos, diagnósticos e cards leem daqui. O literal "EUA" é o mesmo
  // de `fracionario: cat.nome === "EUA"`; nenhuma fonte nova de verdade.
  const MERCADOS = Object.freeze(["tudo", "brasil", "eua"]);

  // Valor desconhecido cai em "tudo": falha para o comportamento de hoje,
  // nunca para um plano vazio silencioso.
  function _normalizarMercado(mercado) {
    return MERCADOS.includes(mercado) ? mercado : "tudo";
  }

  function _categoriaNoMercado(nomeCategoria, mercado) {
    if (mercado === "eua") return nomeCategoria === "EUA";
    if (mercado === "brasil") return nomeCategoria !== "EUA";
    return true;
  }

  // Fonte única dos rótulos de mercado (7a.AU CRB #2): app.js lê daqui via
  // window.aporteCalculo.ROTULO_MERCADO em vez de manter cópia própria —
  // duas cópias do mesmo "dos EUA"/"do Brasil" dessincronizam na primeira
  // edição feita num só lado.
  const _ROTULO_MERCADO = Object.freeze({
    eua: Object.freeze({ onde: "nos EUA", de: "dos EUA", curto: "EUA" }),
    brasil: Object.freeze({ onde: "no Brasil", de: "do Brasil", curto: "Brasil" }),
  });

  // ── Helpers de formatação ─────────────────────────────────────────────
  function formatBrl(v) {
    if (v == null || Number.isNaN(v)) return "—";
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(v);
  }

  function formatCotasFracionarias(cotas) {
    return new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cotas) + " cotas";
  }

  function formatCotasInteiras(cotas) {
    const n = Math.trunc(cotas);
    return n + (n === 1 ? " cota" : " cotas");
  }

  // ── Derivação de preço atual em BRL por ticker ────────────────────────
  function derivarPrecoBrlPorTicker(portfolio) {
    const precos = {};
    const posicoes = (portfolio && portfolio.posicoes) || [];
    for (const p of posicoes) {
      if (p && p.quantidade > 0 && p.valor_mercado_brl != null) {
        precos[p.ticker] = p.valor_mercado_brl / p.quantidade;
      }
    }
    return precos;
  }

  // Itera (cat, bucket, ativo) — schema v3 (7a.E.22). Status derivado de drift_intra.
  // 7a.AU: só categorias do `mercado` (default "tudo" = todas).
  function _iterarAtivos(portfolio, mercado = "tudo") {
    const cats = (portfolio.politica && portfolio.politica.categorias) || [];
    const out = [];
    for (const cat of cats) {
      if (!_categoriaNoMercado(cat.nome, mercado)) continue;
      const buckets = cat.buckets || [];
      for (const bucket of buckets) {
        const ativos = bucket.ativos || [];
        for (const a of ativos) {
          out.push({ cat, bucket, ativo: a });
        }
      }
    }
    return out;
  }

  // ── Ranking + seleção top-K dos candidatos ────────────────────────────
  function _candidatosOrdenados(portfolio, preco_brl_por_ticker, patrimonio_atual, patrimonio_pos, mercado) {
    const candidatos = [];
    for (const { cat, bucket, ativo: a } of _iterarAtivos(portfolio, mercado)) {
      // 7a.E.28: quarentena genuína (investidor qualificado) — alvo 0%, nunca
      // recomendar, mesmo com drift_intra ≤ 0 (posição residual ou zerada).
      if (a.quarentena) continue;
      // Pausar: drift_intra > 0 → ativo acima do alvo (não compramos quando valoriza).
      // Tickers fora do YAML não aparecem em politica.categorias[].buckets[].ativos[].
      if ((a.drift_intra || 0) > 0) continue;
      const preco = preco_brl_por_ticker[a.ticker];
      if (!preco || preco <= 0) continue;
      // peso_alvo já vem portfolio-wide do pipeline (cat.peso × bucket.peso × peso_intra)
      const peso_alvo_total = a.peso_alvo || 0;
      const peso_atual_total = a.peso_atual || 0;
      const valor_atual = peso_atual_total * patrimonio_atual;
      const valor_alvo = peso_alvo_total * patrimonio_pos;
      candidatos.push({
        ticker: a.ticker,
        tipo: a.tipo || (bucket.tipo === "passive" ? "passive" : "pick"),
        peso_intra: a.peso_intra || 0,
        categoria: cat.nome,
        bandeira: a.bandeira,
        fracionario: cat.nome === "EUA",
        preco: preco,
        peso_alvo_efetivo: peso_alvo_total,
        valor_atual: valor_atual,
        valor_alvo: valor_alvo,
        gap_brl: valor_alvo - valor_atual,
      });
    }

    const algumGapPositivo = candidatos.some((c) => c.gap_brl > 0);
    candidatos.sort((x, y) => {
      const a = algumGapPositivo ? x.gap_brl : x.peso_alvo_efetivo;
      const b = algumGapPositivo ? y.gap_brl : y.peso_alvo_efetivo;
      if (b !== a) return b - a;
      return x.ticker.localeCompare(y.ticker);
    });

    return { candidatos: candidatos, algumGapPositivo: algumGapPositivo };
  }

  // ── Distribuição entre os picks já selecionados ───────────────────────
  // Cada pick recebe valor proporcional ao seu peso (gap_brl ou
  // peso_alvo_efetivo). Cotas inteiras flooreadas + cascade do resíduo nos
  // próprios picks em ordem de prioridade. Resíduo final absorvido em
  // pick fracionário (EUA) quando existir, senão +1 cota no top-priority.
  function _distribuirPicks(picks, valorAporte, usaGap) {
    const allocs = picks.map((p) => ({ pick: p, cotas: 0, valor_real: 0 }));
    if (allocs.length === 0) return allocs;

    const pesos = picks.map((p) =>
      Math.max(0, usaGap ? p.gap_brl : p.peso_alvo_efetivo),
    );
    let totalPeso = pesos.reduce((s, x) => s + x, 0);
    if (totalPeso <= 0) {
      // Sem sinal de prioridade — distribui igual.
      for (let i = 0; i < pesos.length; i++) pesos[i] = 1;
      totalPeso = pesos.length;
    }

    for (let i = 0; i < allocs.length; i++) {
      const a = allocs[i];
      const valor_target = valorAporte * (pesos[i] / totalPeso);
      if (a.pick.fracionario) {
        a.cotas = valor_target / a.pick.preco;
        a.valor_real = a.cotas * a.pick.preco;
      } else {
        a.cotas = Math.floor(valor_target / a.pick.preco);
        a.valor_real = a.cotas * a.pick.preco;
      }
    }

    let residual = valorAporte - allocs.reduce((s, a) => s + a.valor_real, 0);

    // Cascade: top-up dos picks inteiros em ordem de prioridade até
    // resíduo não caber em nenhum.
    let mudou = true;
    while (mudou && residual > 0) {
      mudou = false;
      for (const a of allocs) {
        if (a.pick.fracionario) continue;
        if (residual + 1e-9 >= a.pick.preco) {
          a.cotas += 1;
          a.valor_real += a.pick.preco;
          residual -= a.pick.preco;
          mudou = true;
        }
      }
    }

    // Absorve resíduo final em pick fracionário (EUA) se houver.
    if (residual > 0.005) {
      const frac = allocs.find((a) => a.pick.fracionario);
      if (frac) {
        frac.valor_real += residual;
        frac.cotas = frac.valor_real / frac.pick.preco;
        residual = 0;
      }
    }

    return allocs;
  }

  // ── Montagem de linha de compra ───────────────────────────────────────
  function _montarLinha(pick, cotas, valor_real) {
    // 7a.E.20.3 CRB fix: bandeira vem do pipeline (pick.bandeira via schema v2.12).
    // Fallback via categoria preserva compat com mocks legados que não trazem
    // o campo; em produção `pick.bandeira` é sempre populado pelo pipeline.
    const bandeira = pick.bandeira || (pick.categoria === "EUA" ? "🇺🇸" : "🇧🇷");
    const bandeiraLabel = bandeira === "🇺🇸" ? "Estados Unidos" : "Brasil";
    const tipoLabel = pick.tipo === "passive" ? "Passivo" : "Pick";
    return {
      ticker: pick.ticker,
      cotas: cotas,
      cotasFormatadas: pick.fracionario
        ? formatCotasFracionarias(cotas)
        : formatCotasInteiras(cotas),
      valor: valor_real,
      valorFormatado: "≈ " + formatBrl(valor_real),
      tipo: pick.tipo,
      tipoLabel: tipoLabel,
      pesoIntraPct: (pick.peso_intra * 100).toFixed(0),
      categoria: pick.categoria,
      bandeira: bandeira,
      bandeiraLabel: bandeiraLabel,
    };
  }

  function _montarCard(cat, compras, valor_cat, patrimonio_atual, patrimonio_pos, tipo) {
    const atualPct = (cat.peso_atual || 0) * 100;
    const alvoPct = (cat.peso_alvo || 0) * 100;
    const valor_pos = ((cat.peso_atual || 0) * patrimonio_atual) + valor_cat;
    const posPct = patrimonio_pos > 0 ? (valor_pos / patrimonio_pos) * 100 : atualPct;
    const deltaPct = Math.max(0, posPct - atualPct);
    let tag = "";
    if (tipo === "subexposta") tag = "subexposta";
    else if (tipo === "balanceado") tag = "no alvo";
    return {
      nome: cat.nome,
      atualPct: atualPct,
      posPct: posPct,
      alvoPct: Math.round(alvoPct),
      deltaPct: deltaPct,
      tag: tag,
      compras: compras,
    };
  }

  function _linhaNaoRecebedora(cat, label) {
    return {
      nome: cat.nome,
      atualPct: (cat.peso_atual || 0) * 100,
      alvoPct: Math.round((cat.peso_alvo || 0) * 100),
      label: label,
    };
  }

  // Resíduo não alocado, em reais com centavos. `0` abaixo de 1 centavo:
  // a absorção fracionária deixa ruído de ponto flutuante (1e-12), e ele
  // não pode virar "Sobram R$ 0,00" na tela.
  function _sobra(valorAporte, allocs) {
    const alocado = allocs.reduce((s, a) => s + a.valor_real, 0);
    const sobra = Math.round((valorAporte - alocado) * 100) / 100;
    return sobra >= 0.01 ? sobra : 0;
  }

  // ── Algoritmo principal ───────────────────────────────────────────────
  function calcularAporte(valorAporte, portfolio, opcoes) {
    const mercado = _normalizarMercado(opcoes && opcoes.mercado);
    const rot = _ROTULO_MERCADO[mercado];
    const vazio = {
      estado: "vazio",
      categorias: [],
      categoriasNaoRecebedoras: [],
      banner: null,
      pausados: [],
      tickersSemPosicao: [],
      sobra: _sobra(valorAporte > 0 ? valorAporte : 0, []),
    };
    if (!portfolio || !portfolio.politica || !portfolio.politica.categorias) {
      return vazio;
    }
    if (!valorAporte || valorAporte <= 0) {
      return vazio;
    }

    const patrimonio_atual = (portfolio.patrimonio && portfolio.patrimonio.total_brl) || 0;
    const patrimonio_pos = patrimonio_atual + valorAporte;
    const cats = portfolio.politica.categorias;
    const preco_brl_por_ticker = derivarPrecoBrlPorTicker(portfolio);

    // Diagnóstico "pausar": drift_intra > 0 (ativo acima do alvo). Renomeado
    // de `quarentena` na 7a.E.28 para liberar o termo ao conceito genuíno de
    // quarentena por-pick (investidor qualificado), que é filtrado antes daqui.
    // Predicado simétrico ao filtro em _candidatosOrdenados.
    const pausados = [];
    const tickersSemPosicao = [];
    for (const { ativo: a } of _iterarAtivos(portfolio, mercado)) {
      if (a.quarentena) continue; // quarentena genuína: fora do aporte, sem rótulo "pausar"
      if ((a.drift_intra || 0) > 0) {
        pausados.push(a.ticker);
      } else if (preco_brl_por_ticker[a.ticker] == null) {
        tickersSemPosicao.push(a.ticker);
      }
    }

    const { candidatos, algumGapPositivo } = _candidatosOrdenados(
      portfolio,
      preco_brl_por_ticker,
      patrimonio_atual,
      patrimonio_pos,
      mercado,
    );

    if (candidatos.length === 0) {
      // 7a.AU: no modo restrito "nada aparece" precisa de explicação. Texto
      // NEUTRO de propósito (G1): a condição inclui quarentena e falta de
      // cotação, então "acima do alvo" afirmaria uma causa não garantida.
      // As listas de pausados/sem-posição logo abaixo dizem a causa de cada
      // ticker. No modo "tudo" segue sem banner, como antes.
      return {
        estado: "vazio",
        categorias: [],
        categoriasNaoRecebedoras: rot
          ? cats
              .filter((c) => !_categoriaNoMercado(c.nome, mercado))
              .map((c) => _linhaNaoRecebedora(c, "fora deste aporte"))
          : [],
        banner: rot ? `Nenhum ativo ${rot.de} disponível para compra dentro da política.` : null,
        pausados: pausados,
        tickersSemPosicao: tickersSemPosicao,
        sobra: _sobra(valorAporte, []), // Σ = 0: sobra = valor (spec §3.1)
      };
    }

    const picks = candidatos.slice(0, PICKS_MAX);
    const allocs = _distribuirPicks(picks, valorAporte, algumGapPositivo);
    const allocsValidos = allocs.filter((a) => a.cotas > 0);

    if (allocsValidos.length === 0) {
      return {
        estado: "aporte_pequeno",
        categorias: [],
        categoriasNaoRecebedoras: [],
        banner:
          "Valor abaixo do mínimo para 1 cota completa. Aumente o valor ou guarde para o próximo mês.",
        pausados: pausados,
        tickersSemPosicao: tickersSemPosicao,
        sobra: _sobra(valorAporte, []),
      };
    }

    // Agrupa picks por categoria mantendo ordem por prioridade.
    const porCategoria = new Map();
    for (const a of allocsValidos) {
      const nome = a.pick.categoria;
      if (!porCategoria.has(nome)) porCategoria.set(nome, []);
      porCategoria.get(nome).push(_montarLinha(a.pick, a.cotas, a.valor_real));
    }

    const tipoCard = algumGapPositivo ? "subexposta" : "balanceado";
    const categoriasRecebedoras = [];
    for (const cat of cats) {
      const compras = porCategoria.get(cat.nome);
      if (!compras || compras.length === 0) continue;
      const valor_cat = compras.reduce((s, c) => s + c.valor, 0);
      categoriasRecebedoras.push(
        _montarCard(cat, compras, valor_cat, patrimonio_atual, patrimonio_pos, tipoCard),
      );
    }

    const categoriasNaoRecebedoras = [];
    for (const cat of cats) {
      if (categoriasRecebedoras.some((c) => c.nome === cat.nome)) continue;
      let label;
      if (!_categoriaNoMercado(cat.nome, mercado)) {
        // 7a.AU: sem isto, um Só EUA mostraria FIIs "abaixo, sem aporte",
        // como se o algoritmo tivesse esquecido a categoria.
        label = "fora deste aporte";
      } else {
        const drift = (cat.peso_atual || 0) - (cat.peso_alvo || 0);
        label =
          drift > 0.005 ? "acima do alvo" : drift < -0.005 ? "abaixo, sem aporte" : "no alvo";
      }
      categoriasNaoRecebedoras.push(_linhaNaoRecebedora(cat, label));
    }

    const nPicks = allocsValidos.length;
    let banner;
    if (rot && algumGapPositivo) {
      banner =
        nPicks === 1
          ? `Aporte só ${rot.onde}, concentrado no ativo ${rot.de} mais abaixo do alvo.`
          : `Aporte só ${rot.onde}, distribuído entre os ${nPicks} ativos mais abaixo do alvo.`;
    } else if (rot) {
      // A spec §3.2 fixa a forma de N ativos; a de 1 ativo é a flexão
      // gramatical dela, no molde do N=1 do modo Tudo logo abaixo.
      banner =
        nPicks === 1
          ? `Nenhum ativo ${rot.de} está abaixo do alvo. Aporte concentrado no único ativo ${rot.de} alinhado aos pesos-alvo.`
          : `Nenhum ativo ${rot.de} está abaixo do alvo. Aporte distribuído pelos pesos-alvo dos ${nPicks} ativos ${rot.de}.`;
    } else if (algumGapPositivo) {
      banner =
        nPicks === 1
          ? "Aporte concentrado no ativo mais subexposto."
          : `Aporte distribuído entre os ${nPicks} ativos mais subexpostos (cap de ${PICKS_MAX} por aporte).`;
    } else {
      banner =
        nPicks === 1
          ? "Carteira dentro da política. Aporte concentrado no único ativo alinhado aos pesos-alvo."
          : `Carteira dentro da política. Aporte distribuído entre ${nPicks} ativos alinhados aos pesos-alvo.`;
    }

    return {
      estado: algumGapPositivo ? "ok" : "balanceado",
      categorias: categoriasRecebedoras,
      categoriasNaoRecebedoras: categoriasNaoRecebedoras,
      banner: banner,
      pausados: pausados,
      tickersSemPosicao: tickersSemPosicao,
      sobra: _sobra(valorAporte, allocs),
    };
  }

  // ── Export pra window (padrão vanilla do projeto) ─────────────────────
  window.aporteCalculo = {
    calcularAporte: calcularAporte,
    derivarPrecoBrlPorTicker: derivarPrecoBrlPorTicker,
    PICKS_MAX: PICKS_MAX,
    MERCADOS: MERCADOS,
    ROTULO_MERCADO: _ROTULO_MERCADO,
  };
})();
