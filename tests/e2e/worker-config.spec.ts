/**
 * 7a.BW.2 — configuração do Worker `investimentos-app` (Static Assets).
 *
 * O Workers Builds implanta a RAIZ deste repo (`assets.directory: "."`). Tudo
 * que não for o app tem de estar no `.assetsignore`, senão vira URL pública
 * atrás do Access: testes, fixtures, node_modules, mockups, docs internas.
 * Lê os arquivos do disco, sem browser.
 */
import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

const RAIZ = path.resolve(__dirname, "..", "..");

const OBRIGATORIOS = [
  "node_modules",
  "tests",
  "test-results",
  "playwright-report",
  "mockups",
  "scripts",
  "*.md",
  "package*.json",
  "playwright.config.ts",
  "wrangler.jsonc",
  ".git*",
  "worker",
];

/** Remove comentários `//` e `/* *\/` fora de strings (JSONC simples). */
function semComentarios(texto: string): string {
  let saida = "";
  let emString = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (emString) {
      saida += c;
      if (c === "\\") { saida += texto[++i] ?? ""; continue; }
      if (c === '"') emString = false;
      continue;
    }
    if (c === '"') { emString = true; saida += c; continue; }
    if (c === "/" && texto[i + 1] === "/") {
      while (i < texto.length && texto[i] !== "\n") i++;
      saida += "\n";
      continue;
    }
    if (c === "/" && texto[i + 1] === "*") {
      i += 2;
      while (i < texto.length && !(texto[i] === "*" && texto[i + 1] === "/")) i++;
      i++;
      continue;
    }
    saida += c;
  }
  return saida;
}

test.describe("Worker investimentos-app: configuração", () => {
  test(".assetsignore exclui tudo que não é o app", () => {
    const linhas = fs
      .readFileSync(path.join(RAIZ, ".assetsignore"), "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    for (const padrao of OBRIGATORIOS) expect(linhas, padrao).toContain(padrao);
  });

  test("wrangler.jsonc: nome final e assets na raiz, sem main", () => {
    const cfg = JSON.parse(
      semComentarios(fs.readFileSync(path.join(RAIZ, "wrangler.jsonc"), "utf8")),
    );
    expect(cfg.name).toBe("investimentos-app");
    expect(cfg.assets?.directory).toBe(".");
    expect(cfg.main).toBeUndefined();
    expect(cfg.compatibility_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("controle positivo: o removedor de comentários preserva // dentro de string", () => {
    const cfg = JSON.parse(semComentarios('{ "u": "https://x" // c\n, /* b */ "n": 1 }'));
    expect(cfg).toEqual({ u: "https://x", n: 1 });
  });
});
