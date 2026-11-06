import { expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

// Fase 7a.BR.2 — utilitários comuns dos e2e do Diagnóstico (índice e
// capítulos 2 e 3). Fixtures 100% sintéticas (gerar_fixture.py, seção da
// fase): o bloco `selecao` sai de construir_bloco_selecao sobre a ponte
// sintética própria, e `portfolio_selecao_aportes` publica a ponte longa
// (3a/5a/desde com XIRR). Não é spec: o Playwright só coleta `*.spec.ts`.
export const fx = (n: string) => fs.readFileSync(path.join(__dirname, "../fixtures", n), "utf-8");

export async function autenticar(page: Page, corpo: string) {
  await page.route("**/portfolio.json.enc", (r) => r.fulfill({ status: 200, body: corpo, contentType: "text/plain" }));
  await page.addInitScript(() => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem("pinTimestamp", String(Date.now() - 86_400_000));
  });
  await page.goto("/");
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
}

// Abre a rota e espera o fim do push-enter da tela (lição 7a.AW.2).
export async function abrirTela(page: Page, hash: string, tela: string, gate: string) {
  await page.goto("/" + hash);
  await expect(page.locator(`${tela} ${gate}`).first()).toBeVisible();
  await page
    .waitForFunction((sel) => {
      const el = document.querySelector(sel);
      return !!el && getComputedStyle(el).transform === "none";
    }, tela, { timeout: 2000 })
    .catch(() => {});
}

// O Alpine engole erro de expressão em x-if: sem este coletor, um guard
// quebrado ficaria verde.
export function coletarErros(page: Page) {
  const erros: string[] = [];
  page.on("pageerror", (e) => erros.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error" || m.text().includes("Alpine Expression Error")) erros.push(m.type() + ": " + m.text());
  });
  return erros;
}

export const norm = (s: string | null) => (s || "").replace(/\s+/g, " ").trim();

// Texto visível da face (fora de <details> e de .sr-only), para as regras de
// forma da spec §6.6.
export async function faceTexto(page: Page, tela: string) {
  return page.evaluate((sel) => {
    const raiz = document.querySelector(sel)!;
    const textos: string[] = [];
    const walker = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const el = n.parentElement!;
      const t = (n.textContent || "").trim();
      if (!t || el.closest("details") || el.closest(".sr-only")) continue;
      if (!(el as HTMLElement).offsetParent && getComputedStyle(el).position !== "fixed") continue;
      textos.push(t);
    }
    return textos.join(" ");
  }, tela);
}

export const PROIBIDOS = /TWR|XIRR|Information Ratio|tracking error|estatística t/i;

// Overflow da coluna, texto vazando do botão, folga dt/dd em todo dl e a
// largura da página. Mede a folga (flex space-between falha nela, não no
// transbordo).
export async function medirForma(page: Page, tela: string, coluna: string) {
  return page.evaluate(([sel, colSel]) => {
    const raiz = document.querySelector(sel)!;
    const texto = (el: Element) => { const rg = document.createRange(); rg.selectNodeContents(el); return rg.getBoundingClientRect(); };
    const nrm = (s: string | null) => (s || "").replace(/\s+/g, " ").trim();
    const folgas: { linha: string; folga: number }[] = [];
    for (const dl of Array.from(raiz.querySelectorAll("dl"))) {
      for (const dt of Array.from(dl.querySelectorAll("dt"))) {
        if (!(dt as HTMLElement).offsetParent) continue;
        let dd = dt.nextElementSibling;
        while (dd && dd.tagName !== "DD") dd = dd.nextElementSibling;
        if (!dd) continue;
        const a = texto(dt), b = texto(dd);
        const mesma = a.top < b.bottom && b.top < a.bottom;
        folgas.push({ linha: nrm(dt.parentElement!.textContent), folga: mesma ? b.left - a.right : 999 });
      }
    }
    const col = raiz.querySelector(colSel)!.getBoundingClientRect();
    const fora = Array.from(raiz.querySelectorAll(`${colSel} *`))
      .filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && (b.right > col.right + 0.5 || b.left < col.left - 0.5); })
      .filter((el) => !el.closest(".sr-only"))
      .map((el) => (el as HTMLElement).getAttribute("class") + " " + nrm(el.textContent).slice(0, 30));
    for (const b of Array.from(raiz.querySelectorAll("button"))) {
      if ((b as HTMLElement).offsetParent && b.scrollWidth > b.clientWidth + 0.5) fora.push("texto vaza do botão: " + nrm(b.textContent));
    }
    return { folgas, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, fora };
  }, [tela, coluna] as const);
}

// Cor resolvida de um token, para comparar com getComputedStyle.
export async function corDoToken(page: Page, token: string) {
  return page.evaluate((v) => {
    const s = document.createElement("span");
    s.style.color = `var(${v})`;
    document.body.appendChild(s);
    const c = getComputedStyle(s).color;
    s.remove();
    return c;
  }, token);
}

// A ponte longa da fixture tem |XIRR − TWR| abaixo de 0,5 ponto em todas as
// janelas ("quase não mudou"): para travar o SINAL na tela, o teste escala o
// valor final de cada escopo nos fluxos. Isso move só o XIRR (os fluxos não
// entram no TWR, que sai das séries brl/usd), e o esperado é recalculado por
// ponteJanelasFixas sobre o mesmo bloco mutado.
export async function escalarValorFinal(page: Page, fator: number) {
  if (fator === 1) return;
  await page.evaluate((f) => {
    const d = (window as any).Alpine.$data(document.body);
    const p = JSON.parse(JSON.stringify(d.json.ponte));
    const n = p.meses.length - 1;
    for (const k of Object.keys(p.fluxos)) p.fluxos[k].v[n] = p.fluxos[k].v[n] * f;
    d.json = { ...d.json, ponte: p };
  }, fator);
}
