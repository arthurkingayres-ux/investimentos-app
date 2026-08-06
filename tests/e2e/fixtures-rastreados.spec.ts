/**
 * Guard: todo fixture referenciado por uma spec está RASTREADO PELO GIT.
 *
 * Commitar dossies_map.test.json conserta hoje. O defeito de CLASSE é que um
 * fixture referenciado por spec pode não estar no git e ninguém descobre até o
 * CI quebrar — e o CI quebrado passou 6 dias despercebido (31/07 a 06/08/2026),
 * então "o CI quebra" não é detecção suficiente. Este teste falha na máquina de
 * quem esqueceu de commitar, ANTES do push.
 *
 * O critério é `git ls-files`, não `fs.existsSync`: presença em disco foi
 * exatamente a ilusão que fez o baseline local passar verde por 6 dias
 * enquanto o remoto estava vermelho.
 */
import { test, expect } from "@playwright/test";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

const RAIZ = path.resolve(__dirname, "..", "..");
const DIR_SPECS = path.resolve(__dirname);
const ESTE_ARQUIVO = path.basename(__filename).replace(/\.[jt]s$/, ".ts");

/**
 * Extrai caminhos `tests/fixtures/<arquivo>` citados no texto das specs.
 *
 * Não exportada: um `export` num .spec.ts é desnecessário aqui e levantaria a
 * dúvida de como o runner do Playwright o trata. Os testes deste mesmo arquivo
 * a exercitam diretamente.
 */
function fixturesReferenciados(
  fontes: { arquivo: string; texto: string }[],
): string[] {
  const achados = new Set<string>();
  // Casa o nome do fixture com extensão; para de propósito em aspas, crase,
  // parênteses e espaço. `fixtures/` sozinho (concatenação dinâmica) não casa.
  //
  // A cadeia de extensão é `\.[alnum]+` repetida, e NÃO `\.[alnum.]+`: a segunda
  // forma absorve o ponto que ENCERRA UMA FRASE. Medido no primeiro run deste
  // guard — `proventos-drilldown.spec.ts:6` cita "…gerada por
  // tests/fixtures/gerar_fixture.py." em prosa, e o guard reportou
  // `gerar_fixture.py.` (com o ponto) como fixture ausente. Um falso-positivo
  // assim deixaria o guard vermelho para sempre, e guard cronicamente vermelho
  // é guard que se aprende a ignorar — o defeito exato que ele existe para
  // corrigir. Duas extensões (`.json.enc`) seguem casando pela repetição.
  const re = /fixtures\/([A-Za-z0-9_.-]+\.[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*)/g;
  for (const { texto } of fontes) {
    for (const m of texto.matchAll(re)) {
      achados.add(`tests/fixtures/${m[1]}`);
    }
  }
  return [...achados].sort();
}

test.describe("guard: fixtures referenciados estão no git", () => {
  test("a extração casa nome com extensão, ignora prefixo dinâmico e não engole ponto final", () => {
    // As entradas sintéticas são montadas por CONCATENAÇÃO de propósito. Escritas
    // como literais, a varredura do teste seguinte — que lê todos os .spec.ts do
    // diretório, INCLUSIVE este — as capturaria como fixtures referenciados, e o
    // guard nasceria vermelho por auto-referência. Cinto e suspensório: o
    // arquivo também se exclui da varredura lá embaixo.
    const A = "fixtures/" + "a.test.json";
    const B = "fixtures/" + "b.test.json.enc";
    // Citado em PROSA, encerrando a frase. É a forma real que existe hoje em
    // proventos-drilldown.spec.ts:6 e que quebrou o primeiro run deste guard.
    const C = "fixtures/" + "gerar_fixture.py";
    const achados = fixturesReferenciados([
      {
        arquivo: "x.spec.ts",
        texto:
          `read('tests/${A}'); url('${B}'); const p = 'fixtures/' + nome;\n` +
          `// A fixture acima é gerada por tests/${C}.`,
      },
    ]);
    expect(achados).toEqual([
      "tests/fixtures/a.test.json",
      "tests/fixtures/b.test.json.enc",
      "tests/fixtures/gerar_fixture.py",
    ]);
  });

  test("todo fixture referenciado por spec está rastreado pelo git", () => {
    const fontes = fs
      .readdirSync(DIR_SPECS)
      .filter((f) => f.endsWith(".spec.ts") && f !== ESTE_ARQUIVO)
      .map((f) => ({
        arquivo: f,
        texto: fs.readFileSync(path.join(DIR_SPECS, f), "utf-8"),
      }));

    const referenciados = fixturesReferenciados(fontes);
    expect(referenciados.length).toBeGreaterThan(0);

    const rastreados = new Set(
      execFileSync("git", ["ls-files", "tests/fixtures"], {
        cwd: RAIZ,
        encoding: "utf-8",
      })
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    );

    const ausentes = referenciados.filter((f) => !rastreados.has(f));
    expect(
      ausentes,
      `Fixture(s) referenciados por spec mas NÃO rastreados pelo git: ` +
        `${ausentes.join(", ")}. Provável causa: engolidos por .gitignore. ` +
        `Rode 'git check-ignore -v <arquivo>'. Presença em disco NÃO basta — ` +
        `o CI faz checkout limpo.`,
    ).toEqual([]);
  });
});
