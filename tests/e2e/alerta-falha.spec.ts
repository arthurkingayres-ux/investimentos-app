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

  test("observa TODO workflow com arquivo neste repo, por igualdade de conjunto", () => {
    // Workflow novo nasce MUDO: `workflows:` é lista de nomes literais, sem
    // glob. Enumeração envelhece, então a defesa não é repetir as strings — é
    // DERIVAR dos próprios arquivos e exigir igualdade. Workflow novo no repo
    // ⇒ este teste vermelho até ser observado (ou isento aqui, com motivo).
    const arquivos = fs
      .readdirSync(DIR_WF)
      .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
    const esperados = arquivos
      .map((f) => nomeDoWorkflow(path.join(DIR_WF, f)))
      // O próprio alerta fica de fora: auto-observação é loop (teste abaixo).
      .filter((n) => n !== nomeDoWorkflow(ALERTA));

    const t = ler(ALERTA);
    const bloco = t.slice(t.indexOf("workflows:"), t.indexOf("types:"));
    const observados = [...bloco.matchAll(/^\s*-\s*"(.+?)"\s*$/gm)].map((m) => m[1]);

    expect(observados.sort()).toEqual(esperados.sort());
  });

  test("NÃO observa o Pages por workflow_run — foi medido que não funciona", () => {
    // 07/08/2026: o Pages concluiu 10:51:34Z e nenhum run de alerta apareceu
    // nos 3,7 min seguintes; o CI concluiu 10:55:16Z e o run nasceu 2 s depois.
    // O nome literal batia byte a byte com a API, então não era typo — e job
    // pulado por `if:` cria run listável, provado no mesmo experimento, então a
    // ausência é informativa.
    //
    // Este assert é uma trava contra o reflexo de "acrescentar o Pages de
    // volta": declarar cobertura que não existe é a falsa confiança que matou
    // o canal nativo do GitHub. O Pages vai pelo `watchdog-pages.yml`.
    //
    // Extrai os ITENS da lista, não uma fatia de texto: `indexOf("workflows:")`
    // casa primeiro no COMENTÁRIO que explica a armadilha do nome literal, e a
    // fatia arrastaria junto toda a prosa que — corretamente — cita o Pages.
    // Um assert que lê comentário mede documentação, não configuração.
    const observados = [...ler(ALERTA).matchAll(/^\s*-\s*"(.+?)"\s*$/gm)].map(
      (m) => m[1],
    );
    expect(observados).not.toContain("pages build and deployment");
    expect(observados.length).toBeGreaterThan(0);
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
