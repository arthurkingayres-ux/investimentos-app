/**
 * Todo job de todo workflow deste repo declara `timeout-minutes` (Fase 7a.BW.3).
 *
 * Com o repo privado, cada minuto de runner sai da cota gratuita da conta, a
 * mesma das cotações diárias e do relatório mensal. O default do GitHub é
 * 360 min por job: um `npm ci` pendurado ou uma quebra sistêmica dos testes
 * (30 s cada) queimaria ~18% da cota num run só. A margem de 2× do gate de
 * minutos protege contra crescimento de cadência, não contra job pendurado;
 * isto é o que protege.
 *
 * Sem parser YAML (ver alerta-falha.spec.ts): os jobs são as chaves com
 * indentação de 2 espaços sob `jobs:`, e cada bloco vai até a próxima chave
 * desse nível. O controle positivo garante que o fatiador acha jobs.
 */
import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

const DIR_WF = path.resolve(__dirname, "..", "..", ".github", "workflows");

/** Blocos de job: nome → texto do bloco. */
function jobs(texto: string): Map<string, string> {
  const linhas = texto.split(/\r?\n/);
  const ini = linhas.findIndex((l) => /^jobs:\s*$/.test(l));
  const out = new Map<string, string>();
  if (ini < 0) return out;
  let atual: string | null = null;
  let corpo: string[] = [];
  for (const l of linhas.slice(ini + 1)) {
    if (/^\S/.test(l)) break; // fim de `jobs:`
    const m = l.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (m) {
      if (atual) out.set(atual, corpo.join("\n"));
      atual = m[1];
      corpo = [];
    } else if (atual) {
      corpo.push(l);
    }
  }
  if (atual) out.set(atual, corpo.join("\n"));
  return out;
}

const TETO: Record<string, number> = { test: 30 };
const TETO_PADRAO = 10;

test("controle positivo: o fatiador acha jobs e a ausência de timeout", () => {
  const exemplo = "on: push\njobs:\n  a:\n    runs-on: x\n  b:\n    timeout-minutes: 5\n    runs-on: x\n";
  const j = jobs(exemplo);
  expect([...j.keys()]).toEqual(["a", "b"]);
  expect(j.get("a")).not.toMatch(/^ {4}timeout-minutes:/m);
  expect(j.get("b")).toMatch(/^ {4}timeout-minutes:\s*5\s*$/m);
});

test("todo job de todo workflow tem timeout-minutes dentro do teto", () => {
  const arquivos = fs.readdirSync(DIR_WF).filter((f) => /\.ya?ml$/.test(f));
  expect(arquivos.length).toBeGreaterThan(0);
  let total = 0;
  for (const arq of arquivos) {
    const js = jobs(fs.readFileSync(path.join(DIR_WF, arq), "utf-8"));
    for (const [nome, corpo] of js) {
      total++;
      const m = corpo.match(/^ {4}timeout-minutes:\s*(\d+)\s*$/m);
      expect(m, `${arq} › ${nome} sem timeout-minutes`).not.toBeNull();
      const teto = TETO[nome] ?? TETO_PADRAO;
      expect(Number(m![1]), `${arq} › ${nome} acima do teto`).toBeLessThanOrEqual(teto);
    }
  }
  expect(total).toBeGreaterThanOrEqual(4); // test, pii-scan, alertar, alertar-deploy
});
