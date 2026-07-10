// js/sw-update.js — aviso de nova versão (snackbar de update do SW).
// Dono único do registro do service worker + detecção de nova versão do shell
// + aplicação (SKIP_WAITING → controllerchange → reload). Sem dependência de
// Alpine: só emite o evento window "sw:update-available" e expõe window.swUpdate.
// A UI (js/app.js) escuta o evento e chama window.swUpdate.aplicar().
(function () {
  "use strict";

  // Guarda anti-falso-positivo (função PURA, testável isolada via
  // window.ehAtualizacaoDisponivel no Playwright — spec §7 camada 1).
  // Update real = worker novo chegou a "installed" COM um controller já ativo.
  // Sem controller = 1ª instalação (não avisa).
  function ehAtualizacaoDisponivel(estadoObj) {
    return estadoObj.estado === "installed" && estadoObj.temController === true;
  }
  window.ehAtualizacaoDisponivel = ehAtualizacaoDisponivel;

  var avisado = false; // idempotência do evento (os 3 caminhos convergem)
  var recarregando = false; // idempotência do reload
  var registration = null;

  // Exposto SEMPRE (mesmo sem SW disponível) p/ a UI chamar sem checar.
  window.swUpdate = {
    aplicar: function () {
      if (recarregando) return;
      recarregando = true;
      var esperando = registration && registration.waiting;
      if (esperando) {
        // O SW novo assume → controllerchange → recarrega (uma única vez).
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          function () { window.location.reload(); },
          { once: true },
        );
        esperando.postMessage({ type: "SKIP_WAITING" });
      } else {
        // Worker já ativo (waiting nulo): só recarrega.
        window.location.reload();
      }
    },
  };

  if (!("serviceWorker" in navigator)) return;

  function emitirAviso() {
    if (avisado) return;
    avisado = true;
    window.dispatchEvent(new CustomEvent("sw:update-available"));
  }

  function temController() {
    return navigator.serviceWorker.controller !== null;
  }

  function observarWorker(worker) {
    if (!worker) return;
    if (ehAtualizacaoDisponivel({ estado: worker.state, temController: temController() })) {
      emitirAviso();
      return;
    }
    worker.addEventListener("statechange", function () {
      if (ehAtualizacaoDisponivel({ estado: worker.state, temController: temController() })) {
        emitirAviso();
      }
    });
  }

  function ligarDeteccao(reg) {
    registration = reg;
    // Caminho 1: worker já em espera no registro (update baixado com o app fechado).
    if (reg.waiting && temController()) emitirAviso();
    // Caminho 2: worker instalando agora.
    observarWorker(reg.installing);
    // Caminho 3: update encontrado no futuro.
    reg.addEventListener("updatefound", function () {
      observarWorker(reg.installing);
    });
  }

  window.addEventListener("load", function () {
    try {
      navigator.serviceWorker
        .register("./service-worker.js")
        .then(ligarDeteccao)
        .catch(function (err) { console.warn("SW register falhou:", err); });
    } catch (err) {
      console.warn("SW register erro:", err);
    }
  });

  // Deploy ocorrido com o app em 2º plano: ao voltar ao foreground, força um
  // check de update (guardado — não lança sem registro).
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && registration) {
      registration.update().catch(function () {});
    }
  });
})();
