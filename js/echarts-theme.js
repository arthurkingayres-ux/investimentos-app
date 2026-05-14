// Tema 'drarthur' para ECharts — Fase 7a.E.19
// Aplica tokens do DESIGN.md. Source of truth para paleta, eixos, motion.
// Requer echarts global carregado antes (echarts.min.js).

(function () {
  'use strict';

  if (typeof echarts === 'undefined') {
    console.error('[echarts-theme] ECharts não carregou antes do tema.');
    return;
  }

  var tokens = {
    g700: '#047857', g900: '#064e3b',
    blue700: '#1d4ed8', teal700: '#0d7377',
    amber: '#f59e0b', red: '#b91c1c', green: '#047857',
    gray: '#5b605a', ink: '#1a1d1c',
    neutral200: '#e7e5de', neutral300: '#d4d4d0', neutral50: '#fafaf7'
  };

  var fontFamily = '-apple-system, "SF Pro Text", "Segoe UI", system-ui, sans-serif';

  var theme = {
    color: [tokens.g700, tokens.blue700, tokens.amber, tokens.teal700, tokens.g900],
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

  echarts.registerTheme('drarthur', theme);

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

  window.drarthurChart = {
    tokens: tokens,
    fontFamily: fontFamily,
    motionConfig: buildMotion(),
    tooltipBase: {
      backgroundColor: '#fff',
      borderColor: tokens.neutral200,
      borderWidth: 1,
      padding: [10, 12],
      extraCssText: 'border-radius: 8px; box-shadow: 0 1px 2px rgba(6,78,59,0.04), 0 4px 16px rgba(6,78,59,0.07);',
      textStyle: { color: tokens.ink, fontFamily: fontFamily }
    },
    tooltipFormatterAxis: tooltipFormatterAxis
  };

  mql.addEventListener('change', function () {
    window.drarthurChart.motionConfig = buildMotion();
  });
})();
