/**
 * Âncoras do workflow de alerta de falha (Fase 7a.AA.3).
 *
 * `workflow_run` é SAME-REPO: o observador precisa existir neste repo, e o
 * script que ele chama é uma CÓPIA STANDALONE deliberada do canônico em
 * `investimentos/src/output/alerta_falha.py` — fazer checkout cross-repo
 * exigiria um token novo num repo PÚBLICO para economizar ~60 linhas.
 *
 * O que estas âncoras travam: a lista de workflows observados (nome LITERAL —
 * typo produz alerta MUDO, o modo de falha mais caro num canal de alerta), o
 * gate de `conclusion == failure`, e a passagem do contexto por ENV em vez de
 * interpolação numa linha de shell.
 *
 * Sem parser YAML aqui de propósito: a única devDependency deste repo é o
 * Playwright, e acrescentar `js-yaml` para 7 asserts textuais seria custo sem
 * retorno. O nome do CI é DERIVADO do próprio ci.yml por regex, então renomear
 * o CI sem atualizar o observador deixa este teste vermelho.
 */
import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

const DIR_WF = path.resolve(__dirname, "..", "..", ".github", "workflows");
const ALERTA = path.join(DIR_WF, "alerta-falha.yml");

function ler(p: string): string {
  return fs.readFileSync(p, "utf-8");
}

/** Primeira linha `name:` de um workflow, sem aspas. */
function nomeDoWorkflow(arquivo: string): string {
  const m = ler(arquivo).match(/^name:\s*(.+?)\s*$/m);
  if (!m) throw new Error(`${path.basename(arquivo)} sem 'name:'`);
  return m[1].replace(/^["']|["']$/g, "");
}

test.describe("guard: workflow de alerta de falha", () => {
  test("dispara em workflow_run completed", () => {
    const t = ler(ALERTA);
    expect(t).toContain("workflow_run:");
    expect(t).toContain("types: [completed]");
  });

  test("observa o CI pelo nome LITERAL derivado do próprio ci.yml", () => {
    // Nome errado = alerta mudo. Derivar em vez de repetir a string é o que
    // faz um rename do CI quebrar este teste em vez de matar o alerta em
    // silêncio.
    const nomeCI = nomeDoWorkflow(path.join(DIR_WF, "ci.yml"));
    expect(nomeCI.length).toBeGreaterThan(0);
    expect(ler(ALERTA)).toContain(`"${nomeCI}"`);
  });

  test("observa também o deploy do Pages", () => {
    // `pages build and deployment` é o workflow DINÂMICO do GitHub: não tem
    // arquivo neste repo, por isso é literal aqui e não derivado. Foi o deploy
    // falho do Pages em 06/08/2026 que originou esta sub-fase.
    expect(ler(ALERTA)).toContain("pages build and deployment");
  });

  test("não observa a si mesmo", () => {
    // Auto-observação faria o alerta que falha disparar um alerta, em loop.
    const t = ler(ALERTA);
    const proprioNome = nomeDoWorkflow(ALERTA);
    const bloco = t.slice(t.indexOf("workflows:"), t.indexOf("types:"));
    expect(bloco).not.toContain(proprioNome);
  });

  test("só age em falha", () => {
    expect(ler(ALERTA)).toContain("conclusion == 'failure'");
  });

  test("contexto vai por ENV, nunca interpolado em run:", () => {
    // Conteúdo controlado pelo evento nunca entra numa linha de shell — mesmo
    // padrão da 7a.X.2. O filtro casa `run:` e não `python `, porque filtrar
    // pela segunda forma devolveria lista VAZIA e o assert passaria por
    // VACUIDADE.
    const t = ler(ALERTA);
    expect(t).toContain("ALERTA_RUN_URL:");
    const linhasRun = t.split("\n").filter((l) => l.includes("run:"));
    expect(linhasRun.length).toBeGreaterThan(0);
    for (const l of linhasRun) {
      expect(l, `interpolação em run: ${l}`).not.toContain("${{");
    }
  });

  test("os 3 secrets MAIL_* estão ligados", () => {
    const t = ler(ALERTA);
    for (const chave of ["MAIL_FROM", "MAIL_TO", "MAIL_APP_PASSWORD"]) {
      expect(t).toContain(`secrets.${chave}`);
    }
  });

  test("permissões mínimas", () => {
    expect(ler(ALERTA)).toContain("contents: read");
  });

  test("o script standalone existe e está rastreado pelo git", () => {
    // Mesma lição da AA.2: presença em disco não basta, o CI faz checkout
    // limpo. Um workflow apontando para script não-rastreado falha com ENOENT
    // no runner — e um ALERTA que falha assim é mudo por construção.
    const { execFileSync } = require("child_process");
    const raiz = path.resolve(__dirname, "..", "..");
    const saida = execFileSync("git", ["ls-files", "scripts/ci"], {
      cwd: raiz,
      encoding: "utf-8",
    });
    expect(saida).toContain("scripts/ci/alertar_falha.py");
  });
});
