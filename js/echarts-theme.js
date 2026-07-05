// Tema 'drarthur' para ECharts — Fase 7a.E.19
// Aplica tokens do DESIGN.md. Source of truth para paleta, eixos, motion.
// Requer echarts global carregado antes (echarts.min.js).

(function () {
  'use strict';

  if (typeof echarts === 'undefined') {
    console.error('[echarts-theme] ECharts não carregou antes do tema.');
    return;
  }

  // 7a.E.20.1: tokens semânticos de categoria lidos do :root (single source of truth).
  // Mantemos `tokens.*` para acentos/handles que não são "categoria"; cat-* só viajam
  // pelo array `color` do tema, que é o que cicla por série.
  function readToken(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  // 7a.S.12: objeto ÚNICO e ESTÁVEL (nunca substituído, só mutado in-place) —
  // consumidores guardam `dc.tokens` por referência (hidratarRentabilidade/
  // renderPatrimonioGrafico/hidratarProventos em js/app.js); refreshTokens()
  // reescreve as propriedades, então quem já tinha `dc = window.drarthurChart`
  // enxerga os valores novos sem precisar reobter o objeto.
  var tokens = {};

  // 7a.E.20.1 CRB fix (+ 7a.S.12 Modo Plantão): tudo que tem contraparte em :root
  // passa a derivar via readToken. Elimina divergência silenciosa se um token
  // CSS for ajustado, e é o que permite reregister() reler os valores DARK
  // depois do toggle de tema.
  function refreshTokens() {
    tokens.g700 = readToken('--g-700');
    tokens.g900 = readToken('--g-900');
    tokens.blue700 = readToken('--blue-700');
    tokens.teal700 = readToken('--teal-700');
    tokens.amber = readToken('--amber');
    tokens.amber700 = readToken('--amber-700');
    tokens.red = readToken('--red');
    tokens.green = tokens.g700;  // alias semântico (mesma hex que g700)
    tokens.gray = readToken('--gray');
    tokens.ink = readToken('--ink');
    tokens.neutral200 = readToken('--neutral-200');
    tokens.neutral300 = readToken('--neutral-300');
    tokens.neutral50 = readToken('--neutral-50');
    // 5 cores semânticas de categoria (7a.M.1 adiciona Renda Fixa BR):
    tokens.catAcoesBr = readToken('--cat-acoes-br');
    tokens.catEua = readToken('--cat-eua');
    tokens.catFii = readToken('--cat-fii');
    tokens.catCripto = readToken('--cat-cripto');
    tokens.catRendaFixaBr = readToken('--cat-renda-fixa-br');
    // 7a.S.12: superfície do tooltip (tokenizada — light #fff, dark #0c1510).
    tokens.surface = readToken('--surface') || '#fff';
  }

  var fontFamily = '-apple-system, "SF Pro Text", "Segoe UI", system-ui, sans-serif';

  function buildTheme() {
    return {
      // Slots 0-4 são as 5 categorias na ordem [Ações BR, EUA, FII, Cripto, Renda Fixa BR] (7a.M.1).
      // Slots 5+ = benchmarks do gráfico (7a.E.25: CDI cinza / IBOV âmbar / S&P 500 azul).
      color: [tokens.catAcoesBr, tokens.catEua, tokens.catFii, tokens.catCripto, tokens.catRendaFixaBr, tokens.gray, tokens.amber700, tokens.blue700],
      backgroundColor: 'transparent',
      textStyle: { fontFamily: fontFamily, color: tokens.ink },
      title: { textStyle: { color: tokens.ink, fontWeight: 600, fontFamily: fontFamily } },
      line: {
        itemStyle: { borderWidth: 0 },
        lineStyle: { width: 2 },
        symbolSize: 6,
        smooth: false
      },
      bar: {
        itemStyle: { borderWidth: 0, borderRadius: [4, 4, 0, 0] }
      },
      categoryAxis: {
        axisLine: { lineStyle: { color: tokens.neutral300, width: 1 } },
        axisTick: { show: false },
        axisLabel: { color: tokens.gray, fontSize: 11, fontWeight: 500, fontFamily: fontFamily },
        splitLine: { show: false }
      },
      valueAxis: {
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: tokens.gray, fontSize: 11, fontWeight: 500, fontFamily: fontFamily },
        splitLine: { show: true, lineStyle: { color: tokens.neutral200, width: 1, type: 'solid' } }
      }
    };
  }

  refreshTokens();
  echarts.registerTheme('drarthur', buildTheme());

  var mql = window.matchMedia('(prefers-reduced-motion: reduce)');

  function buildMotion() {
    if (mql.matches) {
      return { animationDuration: 0, animationDelay: 0, animationDurationUpdate: 0 };
    }
    return {
      animationDuration: 600,
      animationDelay: function (idx) { return idx * 30; },
      animationDurationUpdate: 400,
      animationEasing: 'cubicOut',
      animationEasingUpdate: 'cubicOut'
    };
  }

  function tooltipFormatterAxis(params, valueFmt) {
    if (!Array.isArray(params)) params = [params];
    var fmt = valueFmt || function (v) { return String(v); };
    var header = params[0].axisValueLabel || params[0].name || '';
    var rows = params.map(function (p) {
      return (
        '<div style="display:flex;align-items:center;gap:8px;margin:3px 0;font-size:0.8125rem;font-variant-numeric:tabular-nums">' +
          '<span style="width:8px;height:8px;border-radius:50%;background:' + p.color + ';flex-shrink:0"></span>' +
          '<span style="color:' + tokens.gray + ';flex:1;font-weight:400;font-size:0.75rem">' + p.seriesName + '</span>' +
          '<span style="color:' + tokens.ink + ';font-weight:600;font-size:0.875rem">' + fmt(p.value) + '</span>' +
        '</div>'
      );
    }).join('');
    return (
      '<div style="font:600 0.75rem ' + fontFamily + ';color:' + tokens.ink + ';margin-bottom:6px">' +
        header +
      '</div>' + rows
    );
  }

  // 7a.S.12: box-shadow do tooltip é tintado a --g-900 no light; no dark essa
  // rgba(6,78,59,…) sobre fundo quase-preto fica invisível — usa preto puro.
  function tooltipShadow() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    return dark
      ? '0 1px 2px rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.55)'
      : '0 1px 2px rgba(6,78,59,0.04), 0 4px 16px rgba(6,78,59,0.07)';
  }

  function buildTooltipBase() {
    return {
      backgroundColor: tokens.surface,
      borderColor: tokens.neutral200,
      borderWidth: 1,
      padding: [10, 12],
      extraCssText: 'border-radius: 8px; box-shadow: ' + tooltipShadow() + ';',
      textStyle: { color: tokens.ink, fontFamily: fontFamily }
    };
  }

  // 7a.S.12: re-lê os tokens (getComputedStyle, agora sob [data-theme="dark"]
  // ou de volta a light) + re-registra o tema 'drarthur' do ECharts + refresca
  // o tooltip — chamado por alternarTema() (js/app.js) ANTES de re-hidratar o(s)
  // chart(s) vivo(s) da rota atual. `tokens` é mutado in-place (mesmo objeto),
  // então qualquer `dc.tokens.x` já capturado (dc = window.drarthurChart) lido
  // DEPOIS deste ponto enxerga os valores novos.
  function reregister() {
    refreshTokens();
    echarts.registerTheme('drarthur', buildTheme());
    window.drarthurChart.tooltipBase = buildTooltipBase();
  }

  window.drarthurChart = {
    tokens: tokens,
    fontFamily: fontFamily,
    motionConfig: buildMotion(),
    tooltipBase: buildTooltipBase(),
    tooltipFormatterAxis: tooltipFormatterAxis,
    reregister: reregister
  };

  mql.addEventListener('change', function () {
    window.drarthurChart.motionConfig = buildMotion();
  });
})();
