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

  test("wrangler.jsonc: nome final e assets na raiz", () => {
    const cfg = JSON.parse(
      semComentarios(fs.readFileSync(path.join(RAIZ, "wrangler.jsonc"), "utf8")),
    );
    expect(cfg.name).toBe("investimentos-app");
    expect(cfg.assets?.directory).toBe(".");
    expect(cfg.compatibility_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // 7a.BW.5: o Worker ganha `main` só para /comite/*; o resto segue Static Assets.
  test("wrangler.jsonc: rotas do Comitê (main, run_worker_first, KV, cron)", () => {
    const cfg = JSON.parse(
      semComentarios(fs.readFileSync(path.join(RAIZ, "wrangler.jsonc"), "utf8")),
    );
    expect(cfg.main).toBe("worker/index.js");
    expect(cfg.assets?.binding).toBe("ASSETS");
    expect(cfg.assets?.run_worker_first).toEqual(["/comite/*"]);
    expect(cfg.kv_namespaces).toHaveLength(1);
    expect(cfg.kv_namespaces[0].binding).toBe("COMITE");
    expect(cfg.kv_namespaces[0].id).toMatch(/^[0-9a-f]{32}$/);
    // 06:30 UTC = 03:30 BRT; nunca o horário do gatilho do relatório (08:30 UTC).
    expect(cfg.triggers?.crons).toEqual(["30 6 * * *"]);
    expect(cfg.vars?.GITHUB_REPO).toBe("arthurkingayres-ux/investimentos");
    expect(cfg.vars?.WORKFLOW).toBe("comite-aporte.yml");
  });

  // Enquanto o repo for público, o time do Access (e qualquer segredo) não entra
  // no arquivo: ACCESS_AUD, ACCESS_TEAM_DOMAIN e GITHUB_PAT_COMITE são secrets.
  test("wrangler.jsonc: nada do Access nem token em texto", () => {
    const bruto = fs.readFileSync(path.join(RAIZ, "wrangler.jsonc"), "utf8");
    const cfg = JSON.parse(semComentarios(bruto));
    for (const nome of ["ACCESS_AUD", "ACCESS_TEAM_DOMAIN", "GITHUB_PAT_COMITE"]) {
      expect(cfg.vars?.[nome], nome).toBeUndefined();
    }
    expect(bruto).not.toMatch(/cloudflareaccess\.com/);
    expect(bruto).not.toMatch(/github_pat_/);
  });

  test("controle positivo: o removedor de comentários preserva // dentro de string", () => {
    const cfg = JSON.parse(semComentarios('{ "u": "https://x" // c\n, /* b */ "n": 1 }'));
    expect(cfg).toEqual({ u: "https://x", n: 1 });
  });
});
