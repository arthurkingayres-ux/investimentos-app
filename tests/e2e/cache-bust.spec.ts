/**
 * Guard: arquivo do shell mudou ⇒ o service-worker.js mudou junto.
 *
 * O shell (index.html, manifest, css/, js/, assets/) é servido cache-first
 * pelo service worker. O navegador só instala um worker novo — e só então
 * re-baixa o shell — quando o service-worker.js muda em algum byte. A 7a.BG.2
 * (c20c76f) mudou js/app.js sem subir o CACHE_VERSION: o código estava no
 * Pages, e o aparelho com o PWA instalado seguiu servindo o app.js antigo
 * (medido no celular em 23/10/2026, corrigido em 82a30ac).
 *
 * O resto da suíte não pega isso: o Playwright roda com `serviceWorkers:
 * "block"` e contexto limpo, sem worker instalado de antes.
 *
 * A regra: desde o último commit que tocou o service-worker.js, nenhum arquivo
 * do shell pode ter mudado — salvo se o CACHE_VERSION da árvore de trabalho já
 * difere do daquele commit (bump pendente, ainda não commitado). Lê o histórico
 * do git, então clone raso é recusado em vez de passar vácuo.
 */
import { test, expect } from "@playwright/test";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

const RAIZ = path.resolve(__dirname, "..", "..");
const SHELL = ["index.html", "manifest.webmanifest", "css", "js", "assets"];

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: RAIZ, encoding: "utf8" }).trim();
}

function versaoDe(texto: string): string {
  const m = texto.match(/const CACHE_VERSION = "([^"]+)";/);
  if (!m) throw new Error("CACHE_VERSION não encontrado no service-worker.js");
  return m[1];
}

/**
 * Arquivos do shell alterados sem bump. `ref` ausente = árvore de trabalho
 * (inclui mudança não commitada); presente = o estado daquele commit.
 */
function shellSemBump(ref?: string): string[] {
  const alvo = ref ?? "HEAD";
  // A base é o último commit que mudou o VALOR do CACHE_VERSION, não o último
  // que tocou o arquivo: um worker novo com o mesmo nome de cache reusa o
  // cache antigo, e o shell stale continua sendo servido.
  const ultimoSw = git(
    "log", "-1", "--format=%H", "-G", "const CACHE_VERSION = ", alvo, "--", "service-worker.js",
  );
  const mudados = git("diff", "--name-only", ultimoSw, ...(ref ? [ref] : []), "--", ...SHELL)
    .split("\n")
    .filter(Boolean);
  if (mudados.length === 0) return [];
  const versaoAgora = ref
    ? versaoDe(git("show", `${ref}:service-worker.js`))
    : versaoDe(fs.readFileSync(path.join(RAIZ, "service-worker.js"), "utf8"));
  const versaoBase = versaoDe(git("show", `${ultimoSw}:service-worker.js`));
  return versaoAgora === versaoBase ? mudados : [];
}

test.describe("guard: shell mudou ⇒ CACHE_VERSION subiu", () => {
  test("o clone tem histórico (clone raso tornaria o guard vácuo)", () => {
    expect(
      git("rev-parse", "--is-shallow-repository"),
      "clone raso: o CI precisa de `fetch-depth: 0` no checkout",
    ).toBe("false");
  });

  test("controle positivo: o guard acusa a regressão real da 7a.BG.2", () => {
    for (const sha of ["c20c76f", "82a30ac"]) {
      let existe = true;
      try { git("cat-file", "-e", `${sha}^{commit}`); } catch { existe = false; }
      expect(existe, `commit ${sha} sumiu do histórico (squash/rebase?): troque o controle positivo`).toBe(true);
    }
    expect(shellSemBump("c20c76f")).toEqual(["js/app.js"]);
    expect(shellSemBump("82a30ac")).toEqual([]);
  });

  test("a árvore de trabalho não tem arquivo do shell mudado sem bump", () => {
    expect(
      shellSemBump(),
      "suba o CACHE_VERSION do service-worker.js (e o ?v= do arquivo no index.html)",
    ).toEqual([]);
  });
});
