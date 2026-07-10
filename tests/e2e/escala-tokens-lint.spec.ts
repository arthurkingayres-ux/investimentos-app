import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

const CSS = fs.readFileSync(path.join(__dirname, "../../css/app.css"), "utf-8");

// Banda de 10px, deliberadamente estreita. O valor é comparado por igualdade
// exata (não por substring), senão `font-size: 10.5px` — que existe, na tab bar
// — casaria com "10px".
//
// Sem âncora `^`: o app.css tem linhas com VÁRIAS declarações na mesma linha
// (ex.: app.css:3605, 3701, 3711, 3715, 3719, 3727, 3744) — uma âncora em
// `^\s*font-size:` só pega a declaração que abre a linha e deixa passar
// `.foo { font-size: 10px; color: red }` ileso.
// Flag `/i`: CSS é case-insensitive — `10PX`/`0.625REM` são valores válidos
// e um regex case-sensitive os deixa passar.
const LONGHAND = /font-size\s*:\s*(?:0\.625rem|10px)\s*(?:;|\}|$)/i;

// Shorthand `font:` também pode carregar um tamanho da banda
// (`font: 600 10px/1.2 var(--mono);`) e o LONGHAND não cobre isso.
// O lookbehind `(?<![-\w])` impede casar dentro de `font-family:`,
// `font-weight:` ou `-webkit-font-smoothing:` (todas contêm "font" mas não
// são o shorthand). Os lookarounds em volta do valor (`(?<![\w.])` /
// `(?![\w.])`) impedem casar o `10px` dentro de `110px` ou o `10` de `10.5px`.
const SHORTHAND = /(?<![-\w])font\s*:[^;{}]*(?<![\w.])(?:0\.625rem|10px)(?![\w.])/i;

// Marcador da exceção consciente, na MESMA linha da declaração:
//   font-size: 10px; /* fora-da-escala: rótulo uppercase */
// O motivo é obrigatório (`\S` após os dois-pontos): um marcador vazio não
// documenta nada. `.*?` (não-guloso) no lugar de `[^*]*`: um motivo com um
// `*` literal (ex.: "badge com * no motivo") não deve quebrar o casamento —
// `[^*]*` pararia no primeiro `*` do texto e nunca alcançaria o `*/` de fecho.
const MARCADOR = /\/\*\s*fora-da-escala:\s*\S.*?\*\//i;

// Extraído para função pura: permite provar as formas de escape (case,
// múltiplas declarações por linha, shorthand `font:`) contra CSS sintético,
// em vez de depender só do estado atual do app.css real.
function infratores(css: string): string[] {
  return css
    .split("\n")
    .map((linha, i) => ({ linha, n: i + 1 }))
    .filter(({ linha }) => (LONGHAND.test(linha) || SHORTHAND.test(linha)) && !MARCADOR.test(linha))
    .map(({ n, linha }) => `css/app.css:${n}: ${linha.trim()}`);
}

test.describe("Escala numérica — lint da banda de 10px (follow-up 2026-07-10)", () => {
  test("nenhum font-size de 10px sem token --num-2xs ou marcador de exceção", () => {
    expect(
      infratores(CSS),
      "Use var(--num-2xs) se o seletor renderiza um NÚMERO formatado; " +
        "senão declare o motivo com /* fora-da-escala: <motivo> */ na mesma linha.",
    ).toEqual([]);
  });

  test("--num-2xs é declarado uma única vez, com 0.625rem (FONTE ÚNICA)", () => {
    const decls = CSS.split("\n").filter((l) => /^\s*--num-2xs\s*:/.test(l));
    expect(decls).toHaveLength(1);
    expect(decls[0]).toMatch(/--num-2xs:\s*0\.625rem;/);
  });

  test("infratores() pega as formas de escape do regex antigo e preserva os isentos (CSS sintético)", () => {
    const sintetico = [
      // --- deve PEGAR ---
      "  font-size: 10PX;", // case-insensitive
      "a { font-size: 10px; color: red }", // não ancorado no início da linha
      "  font: 600 10px/1.2 var(--mono);", // shorthand `font:`
      "  font-size: 10px;  /* fora-da-escala: */", // marcador com motivo vazio = não documenta
      // --- NÃO deve pegar ---
      "  font-size: 10.5px;", // igualdade exata: 10.5px não é 10px
      "/* prosa citando 0.625rem */", // menção em comentário, não é declaração
      "  font-family: var(--mono);", // "font" não é o shorthand font:
      "  --num-2xs: 0.625rem;", // é a própria declaração do token
      "  font-size: 10px;  /* fora-da-escala: badge com * no motivo */", // '*' interno no motivo
      "  font-size: var(--num-2xs);", // já usa o token
    ].join("\n");

    const resultado = infratores(sintetico);

    expect(resultado).toEqual([
      "css/app.css:1: font-size: 10PX;",
      "css/app.css:2: a { font-size: 10px; color: red }",
      "css/app.css:3: font: 600 10px/1.2 var(--mono);",
      "css/app.css:4: font-size: 10px;  /* fora-da-escala: */",
    ]);
  });
});
