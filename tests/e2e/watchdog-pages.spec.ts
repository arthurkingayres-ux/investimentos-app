/**
 * Âncoras do watchdog do Pages (Fase 7a.AA.3, Step 7).
 *
 * O watchdog existe porque as DUAS formas orientadas a evento foram medidas e
 * eliminadas em 07/08/2026:
 *
 *   1. `workflow_run` não observa `pages build and deployment` — o Pages
 *      concluiu 10:51:34Z sem gerar run de alerta; o CI concluiu 10:55:16Z e
 *      gerou 2 s depois. Nome literal conferido contra a API: batia.
 *   2. `on: deployment_status` não cobre o caso originador — nos dois runs de
 *      Pages falhos de 06/08 o job `deploy` saiu `skipped` e NENHUM deployment
 *      foi criado, então não há status para observar.
 *
 * Sobra perguntar em vez de esperar. O que estas âncoras travam é o que faria
 * o vigia ficar mudo: o agendamento, os secrets, a permissão de leitura da API
 * e a passagem do input por ENV.
 */
import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

const DIR_WF = path.resolve(__dirname, "..", "..", ".github", "workflows");
const WATCHDOG = path.join(DIR_WF, "watchdog-pages.yml");
const ALERTA = path.join(DIR_WF, "alerta-falha.yml");

function ler(p: string): string {
  return fs.readFileSync(p, "utf-8");
}

test.describe("guard: watchdog do Pages", () => {
  test("roda agendado e também sob demanda", () => {
    const t = ler(WATCHDOG);
    expect(t).toContain("schedule:");
    expect(t).toMatch(/cron:\s*'0 \*\/6 \* \* \*'/);
    expect(t).toContain("workflow_dispatch:");
  });

  test("tem permissão de LER a API de Actions", () => {
    // Sem `actions: read` a consulta volta 403 e o watchdog sai rc=3 — vermelho
    // recorrente em vez de vigia. É o modo de falha mais provável deste YAML.
    const t = ler(WATCHDOG);
    expect(t).toContain("actions: read");
    expect(t).toContain("contents: read");
  });

  test("os 3 secrets MAIL_* estão ligados", () => {
    const t = ler(WATCHDOG);
    for (const chave of ["MAIL_FROM", "MAIL_TO", "MAIL_APP_PASSWORD"]) {
      expect(t).toContain(`secrets.${chave}`);
    }
  });

  test("o input vai por ENV, nunca interpolado em run:", () => {
    // Mesmo padrão da 7a.X.2. O filtro casa `run:` e não `python `, porque
    // filtrar pela segunda forma devolveria lista VAZIA e o assert passaria por
    // vacuidade — a lição que esta fase já pagou uma vez.
    const t = ler(WATCHDOG);
    expect(t).toContain("WATCHDOG_JANELA_HORAS:");
    const linhasRun = t.split("\n").filter((l) => l.includes("run:"));
    expect(linhasRun.length).toBeGreaterThan(0);
    for (const l of linhasRun) {
      expect(l, `interpolação em run: ${l}`).not.toContain("${{");
    }
  });

  test("o script existe e está rastreado pelo git", () => {
    // Mesma lição da AA.2: presença em disco não basta, o CI faz checkout
    // limpo. Um workflow apontando para script não-rastreado falha com ENOENT
    // — e um vigia que falha assim é mudo por construção.
    const { execFileSync } = require("child_process");
    const raiz = path.resolve(__dirname, "..", "..");
    const saida = execFileSync("git", ["ls-files", "scripts/ci"], {
      cwd: raiz,
      encoding: "utf-8",
    });
    expect(saida).toContain("scripts/ci/watchdog_pages.py");
  });

  test("o vigia é ele próprio vigiado pelo canal de alerta", () => {
    // Um watchdog que morre em silêncio não vigia nada. Ele não pode se
    // auto-observar (loop), então quem o observa é o `alerta-falha.yml`.
    const nomeWatchdog = ler(WATCHDOG).match(/^name:\s*(.+?)\s*$/m)![1];
    expect(ler(ALERTA)).toContain(`"${nomeWatchdog}"`);
  });
});
