import { Page } from "@playwright/test";

// Cold-start numa rota com gráfico: o auto-resume termina com a hidratação da
// rota (tentarAutoResume, depois de `await carregarIndiceRelatorios()`), e na
// #rentabilidade ela descarta o gráfico e o remonta na janela default. O 1º
// desenho já satisfaz "canvas visível": arrastar ou dar zoom antes da
// re-hidratação perde a janela (CI lento, c20c76f: ela voltava ao 12m).
// `segredo` e `json` presentes com `_relIndicePromise` nulo => o índice já
// carregou, e o bloco síncrono que re-hidrata já rodou (não há await entre o
// finally do índice e a hidratação).
export async function esperarResume(page: Page) {
  await page.waitForFunction(() => {
    const d = (window as any).Alpine.$data(document.body);
    return !!d.segredo && !!d.json && !d._relIndicePromise;
  }, undefined, { timeout: 10_000 });
}
