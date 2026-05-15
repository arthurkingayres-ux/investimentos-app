// Fase 7a.H.1 — Algoritmo do executor de política #aportar.
// Recebe um valor R$ + portfolio (já decifrado) e devolve uma lista de
// compras (cotas por ticker) que executa a política em config/alocacao.yaml.
// Read-only puro: sem escrita no banco, sem persistência no JSON.
//
// Fonte de verdade: docs/superpowers/specs/2026-05-14-fase-7a-h1-aportar-design.md
// (seções 4 e 8).

(function () {
  "use strict";

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

  // ── Distribuição inteira (BR/FII/Cripto) ──────────────────────────────
  // Loop iterativo: tickers cujo valor não cobre 1 cota são removidos
  // até o conjunto estabilizar. Pesos restantes são renormalizados.
  function distribuirInteiro(valor_cat, ativos_validos, preco_brl_por_ticker, nomeCategoria) {
    let tickers = ativos_validos.slice();
    let estavel = false;
    while (!estavel && tickers.length > 0) {
      estavel = true;
      const totalPesoIntra = tickers.reduce((acc, t) => acc + (t.peso_intra || 0), 0);
      if (totalPesoIntra <= 0) break;
      for (const t of tickers) {
        const valor_t = valor_cat * ((t.peso_intra || 0) / totalPesoIntra);
        const preco = preco_brl_por_ticker[t.ticker];
        if (!preco || preco <= 0) {
          tickers = tickers.filter((x) => x.ticker !== t.ticker);
          estavel = false;
          break;
        }
        const cotas_int = Math.floor(valor_t / preco);
        if (cotas_int === 0) {
          tickers = tickers.filter((x) => x.ticker !== t.ticker);
          estavel = false;
          break;
        }
      }
    }

    const resultado = [];
    const totalPesoIntraFinal = tickers.reduce(
      (acc, t) => acc + (t.peso_intra || 0),
      0,
    );
    if (totalPesoIntraFinal <= 0) return resultado;
    for (const t of tickers) {
      const valor_t = valor_cat * ((t.peso_intra || 0) / totalPesoIntraFinal);
      const preco = preco_brl_por_ticker[t.ticker];
      const cotas_int = Math.floor(valor_t / preco);
      if (cotas_int <= 0) continue;
      const valor_real = cotas_int * preco;
      resultado.push(_montarLinha(t, cotas_int, valor_real, nomeCategoria, false));
    }
    return resultado;
  }

  // ── Distribuição fracionária (EUA) ────────────────────────────────────
  function distribuirFracionaria(valor_cat, ativos_validos, preco_brl_por_ticker, nomeCategoria) {
    const resultado = [];
    const totalPesoIntra = ativos_validos.reduce(
      (acc, t) => acc + (t.peso_intra || 0),
      0,
    );
    if (totalPesoIntra <= 0) return resultado;
    for (const t of ativos_validos) {
      const preco = preco_brl_por_ticker[t.ticker];
      if (!preco || preco <= 0) continue;
      const valor_t = valor_cat * ((t.peso_intra || 0) / totalPesoIntra);
      const cotas = valor_t / preco;
      if (cotas <= 0) continue;
      resultado.push(_montarLinha(t, cotas, valor_t, nomeCategoria, true));
    }
    return resultado;
  }

  function _montarLinha(ativo, cotas, valor, nomeCategoria, fracionario) {
    const bandeira = nomeCategoria === "EUA" ? "US" : "BR";
    const bandeiraLabel = nomeCategoria === "EUA" ? "Estados Unidos" : "Brasil";
    return {
      ticker: ativo.ticker,
      cotas: cotas,
      cotasFormatadas: fracionario
        ? formatCotasFracionarias(cotas)
        : formatCotasInteiras(cotas),
      valor: valor,
      valorFormatado: "≈ " + formatBrl(valor),
      nota: ativo.nota,
      pesoIntraPct: ((ativo.peso_intra || 0) * 100).toFixed(0),
      categoria: nomeCategoria,
      bandeira: bandeira,
      bandeiraLabel: bandeiraLabel,
    };
  }

  // ── Modo balanceado / sobra: distribui proporcional aos pesos-alvo ────
  // Renormaliza pelos pesos-alvo presentes — se a soma for < 1.0 (YAML
  // mal-calibrado ou cats filtradas), o valor residual não é descartado.
  function distribuirProporcionalPesoAlvo(valor, portfolio, preco_brl_por_ticker) {
    const resultado = [];
    const cats = (portfolio.politica && portfolio.politica.categorias) || [];
    const total_peso = cats.reduce(
      (acc, c) => acc + Math.max(0, c.peso_alvo || 0),
      0,
    );
    if (total_peso <= 0) return resultado;
    for (const cat of cats) {
      const peso = cat.peso_alvo || 0;
      if (peso <= 0) continue;
      const valor_cat = valor * (peso / total_peso);
      const ativos_validos = _ativosValidos(cat, preco_brl_por_ticker);
      if (ativos_validos.length === 0) continue;
      const compras =
        cat.nome === "EUA"
          ? distribuirFracionaria(valor_cat, ativos_validos, preco_brl_por_ticker, cat.nome)
          : distribuirInteiro(valor_cat, ativos_validos, preco_brl_por_ticker, cat.nome);
      resultado.push({ nome: cat.nome, compras: compras, valor_cat: valor_cat });
    }
    return resultado;
  }

  function _ativosValidos(cat, preco_brl_por_ticker) {
    const ativos = (cat && cat.ativos) || [];
    return ativos.filter(
      (a) =>
        (a.nota || 0) > 0 &&
        a.status !== "pausar" &&
        a.status !== "fora_da_politica" &&
        preco_brl_por_ticker[a.ticker] != null,
    );
  }

  // ── Algoritmo principal ───────────────────────────────────────────────
  function calcularAporte(valorAporte, portfolio) {
    const vazio = {
      estado: "vazio",
      categorias: [],
      categoriasNaoRecebedoras: [],
      banner: null,
      quarentena: [],
      tickersSemPosicao: [],
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

    // Quarentena: tickers com nota==0 OU status "pausar" OU status
    // "fora_da_politica". Os três significam "não comprar agora".
    // `fora_da_politica` (nota==0) é permanente; `pausar` é temporário
    // (drift_intra > +0.10). Predicado simétrico ao de `_ativosValidos`.
    const quarentena = [];
    const tickersSemPosicao = [];
    for (const cat of cats) {
      const ativos = cat.ativos || [];
      for (const a of ativos) {
        if (
          (a.nota || 0) === 0 ||
          a.status === "pausar" ||
          a.status === "fora_da_politica"
        ) {
          quarentena.push(a.ticker);
        } else if (preco_brl_por_ticker[a.ticker] == null) {
          tickersSemPosicao.push(a.ticker);
        }
      }
    }

    // Passo 1: gap por categoria (em R$ pós-aporte)
    const gaps = {};
    const valor_atual_cat = {};
    for (const cat of cats) {
      valor_atual_cat[cat.nome] = (cat.peso_atual || 0) * patrimonio_atual;
      const alvo_pos = (cat.peso_alvo || 0) * patrimonio_pos;
      const gap = alvo_pos - valor_atual_cat[cat.nome];
      if (gap > 0) {
        gaps[cat.nome] = gap;
      }
    }

    const temGap = Object.keys(gaps).length > 0;

    // ── Estado balanceado ────────────────────────────────────────────────
    if (!temGap) {
      const distribuicao = distribuirProporcionalPesoAlvo(
        valorAporte,
        portfolio,
        preco_brl_por_ticker,
      );
      const categoriasRecebedoras = [];
      for (const cat of cats) {
        const dist = distribuicao.find((d) => d.nome === cat.nome);
        if (!dist || dist.compras.length === 0) continue;
        categoriasRecebedoras.push(
          _montarCard(cat, dist.compras, dist.valor_cat, patrimonio_atual, patrimonio_pos, "balanceado"),
        );
      }
      // Se nenhuma categoria conseguiu emitir 1+ cota → aporte pequeno
      if (categoriasRecebedoras.length === 0) {
        return {
          estado: "aporte_pequeno",
          categorias: [],
          categoriasNaoRecebedoras: [],
          banner:
            "Valor abaixo do mínimo para 1 cota completa. Aumente o valor ou guarde para o próximo mês.",
          quarentena: quarentena,
          tickersSemPosicao: tickersSemPosicao,
        };
      }
      return {
        estado: "balanceado",
        categorias: categoriasRecebedoras,
        categoriasNaoRecebedoras: [],
        banner:
          "Carteira dentro da política. Aporte distribuído proporcionalmente aos pesos-alvo.",
        quarentena: quarentena,
        tickersSemPosicao: tickersSemPosicao,
      };
    }

    // Passo 3: distribui entre categorias com gap, maior gap primeiro
    const gapsOrdenados = Object.entries(gaps).sort((a, b) => b[1] - a[1]);
    const aporte_por_categoria = {};
    let capital_restante = valorAporte;
    for (const [nome, gap] of gapsOrdenados) {
      const a_alocar = Math.min(gap, capital_restante);
      aporte_por_categoria[nome] = a_alocar;
      capital_restante -= a_alocar;
      if (capital_restante <= 0) break;
    }

    // Passo 5: dentro de cada categoria, distribuir entre tickers
    const categoriasRecebedoras = [];
    for (const [nome, valor_cat] of Object.entries(aporte_por_categoria)) {
      const cat = cats.find((c) => c.nome === nome);
      if (!cat) continue;
      const ativos_validos = _ativosValidos(cat, preco_brl_por_ticker);
      if (ativos_validos.length === 0) continue;
      const compras =
        nome === "EUA"
          ? distribuirFracionaria(valor_cat, ativos_validos, preco_brl_por_ticker, nome)
          : distribuirInteiro(valor_cat, ativos_validos, preco_brl_por_ticker, nome);
      if (compras.length === 0) continue;
      categoriasRecebedoras.push(
        _montarCard(cat, compras, valor_cat, patrimonio_atual, patrimonio_pos, "subexposta"),
      );
    }

    // Categorias não-recebedoras (sem gap ou que perderam todos os tickers)
    const categoriasNaoRecebedoras = [];
    for (const cat of cats) {
      const recebeu = categoriasRecebedoras.some((c) => c.nome === cat.nome);
      if (recebeu) continue;
      const atualPct = (cat.peso_atual || 0) * 100;
      const alvoPct = (cat.peso_alvo || 0) * 100;
      const drift = (cat.peso_atual || 0) - (cat.peso_alvo || 0);
      const label = drift > 0.005 ? "acima do alvo" : drift < -0.005 ? "abaixo, sem aporte" : "no alvo";
      categoriasNaoRecebedoras.push({
        nome: cat.nome,
        atualPct: atualPct,
        alvoPct: Math.round(alvoPct),
        label: label,
      });
    }

    // Sobra: capital restante após fechar todos os gaps
    let banner = null;
    if (capital_restante > 0) {
      const distribuicao = distribuirProporcionalPesoAlvo(
        capital_restante,
        portfolio,
        preco_brl_por_ticker,
      );
      // mescla extras nas categorias recebedoras existentes ou cria novos cards
      for (const dist of distribuicao) {
        if (dist.compras.length === 0) continue;
        const existing = categoriasRecebedoras.find((c) => c.nome === dist.nome);
        if (existing) {
          for (const compra of dist.compras) {
            const linhaExistente = existing.compras.find((r) => r.ticker === compra.ticker);
            if (linhaExistente) {
              linhaExistente.cotas += compra.cotas;
              linhaExistente.valor += compra.valor;
              const fracionario = dist.nome === "EUA";
              linhaExistente.cotasFormatadas = fracionario
                ? formatCotasFracionarias(linhaExistente.cotas)
                : formatCotasInteiras(linhaExistente.cotas);
              linhaExistente.valorFormatado = "≈ " + formatBrl(linhaExistente.valor);
            } else {
              existing.compras.push(compra);
            }
          }
        } else {
          const cat = cats.find((c) => c.nome === dist.nome);
          if (cat) {
            categoriasRecebedoras.push(
              _montarCard(cat, dist.compras, dist.valor_cat, patrimonio_atual, patrimonio_pos, "extra"),
            );
          }
        }
      }
      banner = "Sobrou R$ " + capital_restante.toFixed(2).replace(".", ",") + " após fechar drifts. Aplicação proporcional aos pesos-alvo:";
    }

    // Se nenhuma categoria conseguiu emitir 1+ cota → aporte pequeno
    if (categoriasRecebedoras.length === 0) {
      return {
        estado: "aporte_pequeno",
        categorias: [],
        categoriasNaoRecebedoras: categoriasNaoRecebedoras,
        banner:
          "Valor abaixo do mínimo para 1 cota completa. Aumente o valor ou guarde para o próximo mês.",
        quarentena: quarentena,
        tickersSemPosicao: tickersSemPosicao,
      };
    }

    return {
      estado: "ok",
      categorias: categoriasRecebedoras,
      categoriasNaoRecebedoras: categoriasNaoRecebedoras,
      banner: banner,
      quarentena: quarentena,
      tickersSemPosicao: tickersSemPosicao,
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
    else if (tipo === "extra") tag = "extra";
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

  // ── Export pra window (padrão vanilla do projeto) ─────────────────────
  window.aporteCalculo = {
    calcularAporte: calcularAporte,
    distribuirInteiro: distribuirInteiro,
    distribuirFracionaria: distribuirFracionaria,
    distribuirProporcionalPesoAlvo: distribuirProporcionalPesoAlvo,
    derivarPrecoBrlPorTicker: derivarPrecoBrlPorTicker,
  };
})();
