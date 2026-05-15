// js/transitions.js — Fase 7a.I.6
// Single source of truth para motion da navegacao (tabs, indicator, hero count-up, push).
// Espelha o padrao de echarts-theme.js (drarthurChart.motionConfig).
// Le prefers-reduced-motion via matchMedia e reage live.

(function () {
  'use strict';

  var mql = window.matchMedia('(prefers-reduced-motion: reduce)');

  // Contrato auditável das 5 motions do app shell. countUp é consumido por
  // applyCountUp; as outras 4 (tabFade/tabIndicator/push/segmented) sao
  // ground-truth para os specs Playwright (nav-reduced-motion.spec.ts valida
  // que o objeto bate com as durações implementadas no CSS). Se alterar uma
  // duração aqui sem atualizar o CSS — ou vice-versa — o spec quebra,
  // detectando a divergência que justifica este objeto existir.
  function build() {
    if (mql.matches) {
      return {
        tabFade: 0,
        tabIndicator: 0,
        countUp: 0,
        push: 0,
        segmented: 0,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        reduced: true,
      };
    }
    return {
      tabFade: 220,
      tabIndicator: 220,
      countUp: 700,
      push: 280,
      segmented: 280,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      reduced: false,
    };
  }

  // applyCountUp anima textContent de `el` de 0 ao valor `target` ao longo de motion.countUp ms.
  // `formatter(n)` converte numero para string (ex.: formatBrl). Se reduced=true, set instantaneo.
  function applyCountUp(el, target, formatter) {
    if (!el || typeof target !== 'number' || !isFinite(target)) return;
    var motion = window.drarthurNav.motion;
    if (motion.reduced || motion.countUp === 0) {
      el.textContent = formatter(target);
      return;
    }
    var start = performance.now();
    var duration = motion.countUp;
    function frame(now) {
      var t = Math.min(1, (now - start) / duration);
      var eased = 1 - Math.pow(1 - t, 3);
      el.textContent = formatter(target * eased);
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  window.drarthurNav = {
    motion: build(),
    applyCountUp: applyCountUp,
  };

  mql.addEventListener('change', function () {
    window.drarthurNav.motion = build();
  });
})();
