// 7a.I.3: helpers do Raio-X 1-viewport.
//
// Sparkline 12m sob o hero + derivações para os 4 chips (rent/aloca/prov/política).
// Mantém app.js enxuto: as funções aqui são pure (recebem JSON, retornam shape)
// exceto renderRaioxSparkline que toca o DOM via ECharts.

(function () {
  "use strict";

  function readToken(name, fallback) {
    const v = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
    return v || fallback;
  }

  function ultimos13(serie) {
    if (!Array.isArray(serie) || serie.length === 0) return [];
    return serie.slice(-13);
  }

  function renderRaioxSparkline(domId, json) {
    if (typeof echarts === "undefined") return;
    const el = document.getElementById(domId);
    if (!el) return;

    const serie = ultimos13(json && json.patrimonio && json.patrimonio.evolucao);
    if (serie.length < 2) {
      el.innerHTML = "";
      return;
    }

    // Re-render seguro: dispose instância anterior se existir.
    const prev = echarts.getInstanceByDom(el);
    if (prev) prev.dispose();

    const stroke = readToken("--g-700", "#047857");
    const fillRgba = readToken("--g-700-12", "rgba(4, 120, 87, 0.12)");
    const inst = echarts.init(el, "drarthur", { renderer: "canvas" });

    inst.setOption({
      animation: false,
      grid: { left: 0, right: 0, top: 4, bottom: 4 },
      xAxis: { type: "category", show: false, data: serie.map((p) => p.data) },
      yAxis: { type: "value", show: false, scale: true },
      series: [
        {
          type: "line",
          data: serie.map((p) => p.total_brl),
          showSymbol: false,
          smooth: false,
          lineStyle: { width: 1.5, color: stroke },
          areaStyle: { color: fillRgba },
        },
      ],
    });
  }

  function chipAloca(json) {
    const a = (json && json.alocacao) || {};
    const atual = a.atual || {};
    const alvo = a.alvo || {};
    const aliases = {
      "FIIs BR": "FIIs",
      "Ações Brasil": "Ações BR",
      "Exterior": "EUA",
    };
    const cats = new Set();
    Object.keys(atual).forEach((k) => cats.add(aliases[k] || k));
    Object.keys(alvo).forEach((k) => cats.add(aliases[k] || k));
    let maxAbs = 0;
    let nDesvio = 0;
    for (const cat of cats) {
      const pa = atual[cat] != null ? atual[cat] : 0;
      const pv = alvo[cat] != null ? alvo[cat] : 0;
      const d = pa - pv;
      if (Math.abs(d) > 0.005) nDesvio += 1;
      if (Math.abs(d) > Math.abs(maxAbs)) maxAbs = d;
    }
    if (nDesvio === 0) return { valor: "ok", drift: 0 };
    return {
      valor: nDesvio + " em desvio",
      drift: maxAbs,
    };
  }

  function chipPolitica(json) {
    const pol = (json && json.politica) || null;
    if (!pol || !Array.isArray(pol.categorias)) {
      return { valor: "—", n_desvio: 0 };
    }
    let nDesvio = 0;
    for (const c of pol.categorias) {
      for (const ativo of c.ativos || []) {
        if (ativo.status === "pausar" || ativo.status === "fora_da_politica") {
          nDesvio += 1;
        }
      }
    }
    if (nDesvio === 0) return { valor: "ok", n_desvio: 0 };
    return { valor: nDesvio + " em desvio", n_desvio: nDesvio };
  }

  window.renderRaioxSparkline = renderRaioxSparkline;
  window.chipAloca = chipAloca;
  window.chipPolitica = chipPolitica;
})();
