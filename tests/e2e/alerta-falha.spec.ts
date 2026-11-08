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

/**
 * Os ITENS da lista `workflows:` do observador.
 *
 * Casa os itens de lista com aspas em vez de fatiar o texto entre
 * `indexOf("workflows:")` e `indexOf("types:")`: a chave `workflows:` também
 * aparece dentro do COMENTÁRIO que explica a armadilha do nome literal, e a
 * fatia arrastaria junto a prosa. Um assert que lê comentário mede
 * documentação, não configuração — e passaria verde sobre um YAML errado.
 */
function itensObservados(): string[] {
  return [...ler(ALERTA).matchAll(/^\s*-\s*"(.+?)"\s*$/gm)].map((m) => m[1]);
}

/**
 * O `if:` de cada job, pelo nome do job (chave com 2 espaços sob `jobs:`).
 * Lê só a configuração, não os comentários.
 */
function ifPorJob(): Record<string, string> {
  const t = ler(ALERTA);
  const corpo = t.slice(t.indexOf("\njobs:"));
  const out: Record<string, string> = {};
  let job = "";
  for (const linha of corpo.split(/\r?\n/)) {
    const mJob = linha.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (mJob) { job = mJob[1]; continue; }
    const mIf = linha.match(/^ {4}if:\s*(.+)$/);
    if (mIf && job) out[job] = mIf[1];
  }
  return out;
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
    // DERIVAR dos próprios arquivos e exigir cobertura. Workflow novo no repo
    // ⇒ este teste vermelho até ser observado.
    const arquivos = fs
      .readdirSync(DIR_WF)
      .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
    const esperados = arquivos
      .map((f) => nomeDoWorkflow(path.join(DIR_WF, f)))
      // O próprio alerta fica de fora: auto-observação é loop (teste abaixo).
      .filter((n) => n !== nomeDoWorkflow(ALERTA));

    const observados = itensObservados();
    expect(observados).toEqual(expect.arrayContaining(esperados));

    // Sem extras: o único que havia era o Pages (dinâmico, sem arquivo aqui),
    // que saiu na 7a.BW.2. Um extra novo é nome que não existe, ou seja,
    // observação muda.
    const extras = observados.filter((n) => !esperados.includes(n));
    expect(extras).toEqual([]);
  });

  test("observa o deploy do Workers Builds pelo CHECK RUN do app da Cloudflare", () => {
    // 7a.BW.2: o deploy saiu do Pages (workflow dinâmico deste repo) para o
    // Workers Builds, que não é workflow daqui e não tem alerta de build com
    // falha na Cloudflare. O sinal que existe é o check run que o app
    // `cloudflare-workers-and-pages` publica no commit (medido em a5206a5).
    // Slug errado = alerta mudo, o mesmo modo de falha do nome literal.
    const t = ler(ALERTA);
    expect(t).toMatch(/^\s{2}check_run:\s*$/m);
    expect(t).toContain("github.event.check_run.app.slug == 'cloudflare-workers-and-pages'");
    expect(t).toContain("github.event.check_run.conclusion != 'success'");
    expect(t).toContain("github.event.check_run.conclusion != 'skipped'");
    // O job do workflow_run não pode reagir a check_run (o contexto dele
    // viria vazio): cada job é guardado pelo próprio evento.
    expect(t).toContain("github.event_name == 'workflow_run'");
    expect(t).toContain("github.event_name == 'check_run'");
    expect(itensObservados()).not.toContain("pages-build-deployment");
  });

  test("o script standalone não importa nada que não exista neste repo", () => {
    // Este repo não tem `src/`. A cópia é standalone de propósito, e um import
    // relativo introduzido por engano falharia só no runner — ou seja, o alerta
    // ficaria mudo justamente quando fosse preciso.
    const script = fs.readFileSync(
      path.resolve(__dirname, "..", "..", "scripts", "ci", "alertar_falha.py"),
      "utf-8",
    );
    expect(script).not.toContain("from src.");
    expect(script).not.toContain("import src");
  });

  test("não observa a si mesmo", () => {
    // Auto-observação faria o alerta que falha disparar um alerta, em loop.
    //
    // Usa `itensObservados()` e não uma fatia entre `indexOf("workflows:")` e
    // `indexOf("types:")`: a substring `workflows:` aparece ANTES, dentro do
    // comentário que explica a armadilha do nome literal, então a fatia começa
    // ~25 linhas cedo demais e mede prosa junto com configuração. Passava hoje
    // só porque o próprio nome não aparece naquele trecho — e este arquivo é
    // densamente comentado, narrando a própria história, então é questão de
    // tempo até alguém escrever "Alerta de falha" ali e ficar vermelho por um
    // motivo que nada tem a ver com a invariante.
    expect(itensObservados()).not.toContain(nomeDoWorkflow(ALERTA));
  });

  test("age em TODA conclusão ruim, não só em 'failure'", () => {
    // O gate é por forma NEGATIVA, e isso é o ponto: `== 'failure'` cobria 1 de
    // ~9 conclusões possíveis, e os que ficavam mudos não são exóticos
    // (`timed_out`, `startup_failure` por YAML inválido). Um canal criado para
    // substituir outro que "parou sozinho" não pode nascer mudo num modo de
    // falha plausível — e enumerar o que alerta envelhece pelo mesmo motivo que
    // `workflows:` envelhece.
    //
    // `skipped` fica de fora porque é o que ESTE workflow conclui a cada
    // sucesso do observado; incluí-lo faria o canal alertar sobre si mesmo.
    //
    // Travado POR JOB (CRB da 7a.BW.2, provado por mutação): com dois jobs, um
    // `toContain` no arquivo inteiro casava a substring no `if` do outro job, e
    // o gate do `alertar` podia sumir com a suíte verde.
    const ifs = ifPorJob();
    const ifCi = ifs["alertar"];
    expect(ifCi, "job alertar sem if").toBeDefined();
    expect(ifCi).toContain("github.event_name == 'workflow_run'");
    expect(ifCi).toContain("github.event.workflow_run.conclusion != 'success'");
    expect(ifCi).toContain("github.event.workflow_run.conclusion != 'skipped'");
    const ifDeploy = ifs["alertar-deploy"];
    expect(ifDeploy, "job alertar-deploy sem if").toBeDefined();
    expect(ifDeploy).toContain("github.event_name == 'check_run'");
    expect(ifDeploy).toContain("github.event.check_run.conclusion != 'success'");
    expect(ifDeploy).toContain("github.event.check_run.conclusion != 'skipped'");
    for (const [job, cond] of Object.entries(ifs)) {
      expect(cond, `${job}: gate voltou a enumerar um valor único`).not.toContain(
        "conclusion == 'failure'",
      );
    }
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
