import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

// Fase 7a.U — higiene de sessão no lock. Fixtures 100% SINTÉTICAS: o sibling é
// público e o `.enc` decifra com o PIN de teste público
// (feedback_sibling_fixtures_sinteticas).

const F = (n: string) =>
  fs.readFileSync(path.join(__dirname, "../fixtures/" + n), "utf-8");
const PORTFOLIO = F("portfolio.test.json.enc");
const IDX_REL = F("relatorios_index.test.json.enc");
const MAIO = F("relatorio_2026-05.test.json.enc");
const ABRIL = F("relatorio_2026-04.test.json.enc");
const IDX_DOSSIES = F("dossies_index.test.json.enc");
const DOSSIES: Record<string, string> = {
  AMZN: F("dossie_AMZN.test.json.enc"),
  HGLG11: F("dossie_HGLG11.test.json.enc"),
  ITSA4: F("dossie_ITSA4.test.json.enc"),
  SMAL11: F("dossie_SMAL11.test.json.enc"),
};
// 7a.W.2: o nome PEDIDO virou HMAC e não carrega mais o ticker. O mapa
// (gerado por gerar_fixture.py) faz a ponte URL → fixture; o nome EM DISCO
// segue legível.
const MAPA: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../fixtures/dossies_map.test.json"), "utf-8"),
);

test.use({ viewport: { width: 390, height: 844 } });

// `**/d_*.json.enc` NÃO casa `dossies_index.json.enc` — as duas rotas
// convivem sem ordem de registro importar (mesmo padrão de dossie.spec.ts).
async function mockTudo(page: Page) {
  await page.route("**/portfolio.json.enc", (r) =>
    r.fulfill({ status: 200, body: PORTFOLIO, contentType: "text/plain" }));
  await page.route("**/relatorios_index.json.enc", (r) =>
    r.fulfill({ status: 200, body: IDX_REL, contentType: "text/plain" }));
  await page.route("**/relatorio_*.json.enc", (r) =>
    r.fulfill({
      status: 200,
      body: r.request().url().includes("2026-04") ? ABRIL : MAIO,
      contentType: "text/plain",
    }));
  await page.route("**/dossies_index.json.enc", (r) =>
    r.fulfill({ status: 200, body: IDX_DOSSIES, contentType: "text/plain" }));
  await page.route("**/d_*.json.enc", (r) => {
    const nome = r.request().url().split("/").pop()!.split("?")[0];
    const ticker = MAPA[nome];
    const body = ticker && DOSSIES[ticker];
    return body
      ? r.fulfill({ status: 200, body, contentType: "text/plain" })
      : r.fulfill({ status: 404, body: "", contentType: "text/plain" });
  });
}

// Sessão já válida via localStorage (caminho auto-resume). Usado por todos os
// testes MENOS o de snapshot, que precisa da tela de PIN virgem antes.
async function autenticar(page: Page) {
  await mockTudo(page);
  await page.addInitScript(() => {
    localStorage.setItem("pin", "123456");
    localStorage.setItem("pinTimestamp", String(Date.now() - 24 * 60 * 60 * 1000));
  });
  await page.goto("/");
  await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });
}

// Acesso ao componente Alpine raiz: `x-data="app"` vive em <body>, então
// `Alpine.$data(document.body)` é a raiz. Cada teste faz seu próprio
// `page.evaluate` inline (padrão de dossie.spec.ts/dataviz-higiene.spec.ts) —
// o $data não é serializável, logo não pode ser devolvido nem passado como
// argumento; o que cruza a fronteira é sempre um objeto de valores simples.

// Barreiras nos nós que são gate de DADO (x-if), nunca no x-show da tela
// (feedback_barreira_no_no_que_e_gate_de_dado). Locators SEMPRE escopados à
// tela: `.rel-erro`/`.rel-vazio` têm gêmeos de classe própria no dossiê, e um
// locator sem escopo resolveria a 2 elementos (strict mode).
async function abrirRelatorio(page: Page, mes?: string) {
  await page.goto("/#/raiox/relatorio" + (mes ? "/" + mes : ""));
  await expect(page.locator(".tela-relatorio")).toBeVisible();
  await expect(page.locator(".tela-relatorio .rel-corpo")).toBeVisible();
}

async function abrirDossie(page: Page, ticker: string) {
  await page.goto("/#/dossie/" + ticker);
  await expect(page.locator(".tela-dossie")).toBeVisible();
  await expect(page.locator(".tela-dossie .dossie-corpo")).toBeVisible();
}

// Plano de aporte só existe com valor > 0 — sem preencher o input, as quatro
// listas ficam vazias e o teste 3 passaria por vacuidade.
async function abrirAportar(page: Page, valor = "5000") {
  await page.goto("/#aportar");
  await expect(page.locator(".tela-aportar")).toBeVisible();
  await page.locator(".aporte-input").fill(valor);
  await expect(page.locator(".aporte-card").first()).toBeVisible({ timeout: 5_000 });
}

// Cada render dá dispose só no PRÓPRIO gráfico, então as 3 instâncias
// coexistem depois de visitar as 3 rotas.
async function renderizarOsTresGraficos(page: Page) {
  await page.goto("/#proventos");
  await expect(page.locator("#proventos-grafico canvas[data-zr-dom-id]"))
    .toBeVisible({ timeout: 5_000 });
  await page.goto("/#/raiox/chart");
  await expect(page.locator("#patrimonio-grafico canvas[data-zr-dom-id]"))
    .toBeVisible({ timeout: 5_000 });
  await page.goto("/#rentabilidade");
  await expect(page.locator(".tela-rentabilidade canvas[data-zr-dom-id]"))
    .toBeVisible({ timeout: 5_000 });
}

// CRB final 7a.U Finding 1 — 3 rotas que o roteiro do teste-invariante não
// visitava, cada uma populando exatamente o campo que a família precisa:
// `tickerAtual` (#ativo), `dySelecionado` (#/proventos/dy, auto-populado por
// hidratarDY() — sem toque manual, ver cold-start em sdy.spec.ts) e
// `catAberta` (#alocacao, exige 1 clique real: sem ele o mapa fica `{}` e o
// campo segue invisível ao comparador). HGLG11 já é fixture reusada por
// abrirDossie()/ativo.spec.ts — nenhum ticker novo.
async function abrirAtivo(page: Page, ticker: string) {
  await page.goto("/#ativo/" + ticker);
  await expect(page.locator(".tela-ativo .kpi-grid")).toBeVisible({ timeout: 5_000 });
}

async function abrirDY(page: Page) {
  await page.goto("/#/proventos/dy");
  await expect(page.locator('[data-testid="dy-champs"]')).toBeVisible({ timeout: 5_000 });
}

// Abre a 1ª categoria (única forma de popular catAberta — a tela nasce com
// todas fechadas por design, 7a.E.31). Nenhum 2º clique: 1 categoria aberta
// já é suficiente para o mapa divergir de `{}`.
async function abrirAlocacaoComCategoriaAberta(page: Page) {
  await page.goto("/#alocacao");
  await expect(page.locator(".tela-alocacao")).toBeVisible();
  const head = page.locator(".tela-alocacao .aloca-cat__head").first();
  await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "true");
}

// Ciclo completo lock→unlock preservando a hash. `bloquear()` é chamado pelo
// $data (não pelo botão) porque o botão só existe na home `.raiox` — chamar
// pelo botão exigiria sair da rota sob teste, que é exatamente o que o teste
// precisa preservar.
async function bloquearEDestravar(page: Page) {
  await page.evaluate(() => (window as any).Alpine.$data(document.body).bloquear());
  await expect(page.locator(".pin-screen")).toBeVisible();
  await page.locator("input.pin-input").fill("123456");
  await page.locator("button.pin-submit").click();
  await expect(page.locator(".raiox")).toBeAttached({ timeout: 10_000 });
}

// CRB Task 5 Finding 1 (+ round 2, mesma classe no 4º loader): reatribui
// window.decifrar para atrasar a RESOLUÇÃO (não o fetch de rede) — reproduz
// fielmente a janela real de PBKDF2 (~centenas de ms): o pin ainda válido já
// foi passado POR VALOR quando a chamada começa (como todo call site faz —
// `window.decifrar(payloadB64, this.pin)`), só o retorno chega tarde, depois
// que bloquear() já pode ter rodado.
//
// Chamar SÓ DEPOIS de `autenticar()`/boot, nunca via addInitScript antes da
// navegação: `crypto.js` declara `async function decifrar(...)` como function
// declaration de topo-de-script, que o motor JS hoisteia via
// CreateGlobalFunctionBinding ANTES de qualquer linha do script rodar — isso
// redefine `window.decifrar` como propriedade de dado NÃO-configurável
// (porém gravável), o que silenciosamente destrói um
// `Object.defineProperty` getter/setter registrado cedo demais (medido: o
// setter nunca disparava, a chamada real nunca ficava lenta — falso-positivo
// descoberto só ao investigar por que o teste do 4º loader passava rápido
// demais sem o guard). Reatribuir DEPOIS que `window.decifrar` já é a função
// real (pós-boot) é uma atribuição simples — funciona porque a propriedade é
// gravável, só não é redefinível via defineProperty.
async function atrasarDecifrar(page: Page, ms: number) {
  await page.evaluate((delayMs) => {
    const real = (window as any).decifrar as (...args: unknown[]) => Promise<unknown>;
    (window as any).decifrar = async (...args: unknown[]) => {
      const resultado = await real(...args);
      await new Promise((r) => setTimeout(r, delayMs));
      return resultado;
    };
  }, ms);
}

// Assinatura de repouso do escopo Alpine `x-data="app"`. NÃO é cópia profunda:
// valores viram marcador de TIPO/tamanho. Regras que importam:
//  · só data properties — descriptors com `get` são pulados (os getters do
//    Alpine leem `json`, que é null pós-lock, e podem lançar)
//  · `null` e `undefined` colapsam no MESMO marcador (campos legitimamente
//    `null`/`undefined` nos dois lados não inflam a allowlist com ruído).
//    Esse colapso NÃO resolve "chave ausente" vs. "chave presente valendo
//    null": os 7 campos echarts*/resizeObserver*/_rentCtx só batem virgem ==
//    pós-lock porque `js/app.js` os PRÉ-DECLARA com `null` (7a.U) — sem essa
//    pré-declaração, `Object.keys()` os omite do snapshot virgem (nunca
//    renderizados ainda) e os inclui no pós-lock (`_descartarGraficos()` os
//    zera), e "ausente" não é o mesmo marcador que "presente valendo null"
//    para este comparador. Campo novo dessa classe → pré-declare em
//    `js/app.js`, não tente resolver aqui
//  · plain objects recursionam 2 níveis (senão `periodoCustom` viria "obj" nos
//    dois lados e a divergência de twr/xirr passaria batida); instâncias
//    (ECharts/ResizeObserver/Promise) param em "obj"
const ASSINATURA_FN = `(function () {
  // Hash de 32 bits (FNV-1a) do CONTEUDO da string — só o dígito (base36)
  // entra no marcador; a string crua NUNCA aparece na assinatura nem na
  // mensagem de falha do teste. CRB final round (Finding C): o marcador
  // anterior era só "str:<len>", então duas strings de MESMO tamanho e
  // conteúdo DIFERENTE colidiam (ex.: "aloca"/"raiox", ambas 5 chars) — uma
  // divergência real passava batida, e isso já havia forçado um hack de
  // ORDENAR o roteiro do teste só para os comprimentos de tab não colidirem
  // por acaso. Com o hash, duas strings de mesmo tamanho só compartilham
  // marcador se tiverem o MESMO conteúdo — a ordem do roteiro deixa de
  // importar para a suíte passar (o comentário no roteiro abaixo foi
  // simplificado, mas o registro da colisão original foi mantido ali).
  function hash32(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return h.toString(36);
  }
  function sig(v, prof) {
    if (v === null || v === undefined) return "vazio";
    var t = typeof v;
    if (t === "function") return "fn";
    if (t === "number") return v === 0 ? "0" : "num";
    if (t === "boolean") return String(v);
    if (t === "string") return v === "" ? "" : "str:" + v.length + ":" + hash32(v);
    if (v instanceof Set) return "Set(" + v.size + ")";
    if (v instanceof Map) return "Map(" + v.size + ")";
    if (Array.isArray(v)) return "Array(" + v.length + ")";
    var proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return "obj";
    if (prof >= 2) return "obj";
    var out = {};
    Object.keys(v).forEach(function (k) { out[k] = sig(v[k], prof + 1); });
    return out;
  }
  // O escopo x-data="app" CRU, não o merge proxy de Alpine.$data(): o merge
  // proxy trapeia ownKeys/has/get/set mas NÃO getOwnPropertyDescriptor, então a
  // checagem de enumerabilidade de Object.keys() cai no target ({objects:[...]})
  // e filtra TODA chave — medido: Object.keys($data)=0 vs Reflect.ownKeys=209.
  // Com o proxy a assinatura sairia {} nos dois lados e o teste passaria por
  // vacuidade. closestDataStack é API pública do Alpine; [0] é o escopo do
  // <body>, cujo proxy reativo (@vue/reactivity) encaminha descriptors ao alvo.
  var stack = window.Alpine.closestDataStack(document.body);
  var d = stack && stack[0];
  var chaves = d ? Object.keys(d) : [];
  // Guarda contra vacuidade: assinatura vazia = duas assinaturas idênticas =
  // suíte verde sem medir nada. Falhar alto é o único desfecho aceitável.
  if (chaves.length === 0) {
    throw new Error("assinatura vazia: o escopo x-data do <body> nao foi enumerado");
  }
  var out = {};
  chaves.forEach(function (k) {
    var desc = Object.getOwnPropertyDescriptor(d, k);
    if (!desc || desc.get) return;
    out[k] = sig(d[k], 0);
  });
  return out;
})()`;

function assinatura(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(ASSINATURA_FN) as Promise<Record<string, unknown>>;
}

// Cada entrada é uma DECISÃO documentada: este campo sobrevive ao lock de
// propósito. Sem entrada aqui, um campo divergente derruba a suíte — quem
// adicionar estado novo é forçado a limpar no choke point ou justificar.
const ALLOWLIST: Record<string, string> = {
  rota: "hash é a fonte de verdade; bloquear() preserva a rota por design (spec §3.2) e o unlock a re-deriva",
  tab: "tab top-level derivada do hash, mesma classe de `rota`",
  relRead: "meses lidos (localStorage): metadado de leitura, não payload — o dot de não-lido sobrevive ao lock por design (7a.S.9)",
  _escListenerProventos:
    "handle do keydown (Esc) registrado 1× por sessão em `document` (dentro de `hidratarProventos()`): guarda de IDEMPOTÊNCIA, não payload — o listener lê `rota`/`proventosMesSelecionado` no evento; anulá-lo sem removeEventListener duplicaria o listener no próximo #proventos",
  _heroFaceGen:
    "contador monotônico de geração da troca de faceta do hero (CRB 7a.S.5, incrementado em `_renderHeroFace()`): zerá-lo deixaria um RAF em voo passar a guarda `gen !== this._heroFaceGen`",
  // CRB final 7a.U Finding 1: o roteiro passou a visitar #ativo/<TICKER>
  // (rota `ativo` casada dentro de `atualizarRota()`), então este campo
  // agora diverge de verdade — a entrada deixa de ser morta.
  tickerAtual:
    "ponteiro derivado da hash, mesma classe de `rota`/`tab`; a própria URL já sobrevive ao lock, então o valor não é segredo novo",
};
// NOTA: `dySelecionado`/`catAberta`/`proventosMesSelecionado` NÃO entram —
// são derivados do CONTEÚDO do payload (não preferência/infra/ponteiro de
// hash), então pela regra da fase são LIMPOS no choke point
// (`_limparEstadoProventosDY()`/`_limparEstadoAlocacao()`, js/app.js), não
// justificados aqui. Depois do lock eles voltam ao literal `null`/`{}` da
// declaração — o mesmo valor do snapshot virgem — então nem chegam a aparecer
// em `divergentes`.

test.describe("7a.U — higiene de sessão no lock", () => {
  test("rate-limit sobrevive ao lock (pinBlockUntil/pinFails intactos)", async ({ page }) => {
    await autenticar(page);
    // Semeia o rate-limit DEPOIS de autenticar: pinBlockUntil no futuro antes
    // do boot bloquearia o próprio submitPin.
    const futuro = await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      const t = Date.now() + 15 * 60 * 1000;
      localStorage.setItem("pinBlockUntil", String(t));
      localStorage.setItem("pinFails", "2");
      localStorage.setItem("pinFirstFailAt", String(Date.now()));
      d.pinBlockUntil = t;
      return t;
    });

    const depois = await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      d.bloquear();
      return {
        memoria: d.pinBlockUntil,
        lsBlock: localStorage.getItem("pinBlockUntil"),
        lsFails: localStorage.getItem("pinFails"),
        lsFirst: localStorage.getItem("pinFirstFailAt") !== null,
        // limparSessao() remove SÓ estas três chaves.
        lsPin: localStorage.getItem("pin"),
        lsTs: localStorage.getItem("pinTimestamp"),
      };
    });

    expect(depois.memoria).toBe(futuro);
    expect(depois.lsBlock).toBe(String(futuro));
    expect(depois.lsFails).toBe("2");
    expect(depois.lsFirst).toBe(true);
    expect(depois.lsPin).toBeNull();
    expect(depois.lsTs).toBeNull();
  });

  test("lock descarta o artefato do Relatório Mensal", async ({ page }) => {
    await autenticar(page);
    await abrirRelatorio(page);

    const antes = await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      return { mes: !!d.relMes, indice: !!d.relIndice, atual: d.relMesAtual };
    });
    expect(antes.mes).toBe(true);
    expect(antes.indice).toBe(true);
    expect(antes.atual).not.toBe("");

    const depois = await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      d.bloquear();
      return {
        mes: d.relMes, indice: d.relIndice, atual: d.relMesAtual,
        rotaMes: d.relRotaMes, erro: d.relErro,
        carregando: d.relCarregando, seletor: d.relSeletorAberto,
      };
    });
    expect(depois).toEqual({
      mes: null, indice: null, atual: "", rotaMes: null,
      erro: "", carregando: false, seletor: false,
    });
  });

  // CRB Task 5 Finding 1: carregarRelatorioMes() lê `this.pin` e chama
  // window.decifrar(payloadB64, this.pin) — a pin é capturada POR VALOR no
  // argumento nesse instante, então um bloquear() que rode DEPOIS da chamada
  // mas ANTES da promise resolver não impede a decifra de terminar com
  // sucesso; sem um guard pós-await, a linha `this.relMes = art` reescreveria
  // o artefato de volta no $data já travado.
  test("race: bloquear() durante a decifra do Relatório não repopula relMes", async ({ page }) => {
    await autenticar(page);
    await atrasarDecifrar(page, 2_000);

    // Dispara a navegação sem aguardar — o hashchange chama hidratarRelatorio
    // (setTimeout 0) → carregarRelatorioMes → window.decifrar, que agora fica
    // preso 2s na resolução envelopada por atrasarDecifrar().
    const nav = page.goto("/#/raiox/relatorio");
    await page.waitForTimeout(300);

    // Bloqueia durante a janela: a decifra em voo já capturou o pin correto
    // por valor; this.pin some do $data agora.
    await page.evaluate(() => (window as any).Alpine.$data(document.body).bloquear());
    await expect(page.locator(".pin-screen")).toBeVisible();

    await nav;
    // Espera a decifra atrasada terminar (2s de delay + margem).
    await page.waitForTimeout(3_000);

    // O guard pós-await deve ter recusado popular relMes de volta.
    const relMes = await page.evaluate(
      () => (window as any).Alpine.$data(document.body).relMes,
    );
    expect(relMes).toBeNull();
    await expect(page.locator(".pin-screen")).toBeVisible();
  });

  // CRB Task 5 Finding 1, round 2 — mesma classe de corrida no 4º loader
  // (carregarIndiceRelatorios(), que também lê `this.pin` e atribui
  // `this.relIndice` só depois do await de window.decifrar). Chamada direta
  // via $data (em vez de navegação): carregarIndiceRelatorios() já roda uma
  // vez no boot (tentarAutoResume), então chamá-la de novo aqui isola
  // especificamente o guard novo, sem depender do caminho de navegação do
  // Relatório (já coberto pelo teste acima).
  test("race: bloquear() durante a decifra do índice de Relatórios não repopula relIndice", async ({ page }) => {
    await autenticar(page);
    await atrasarDecifrar(page, 2_000);

    // Dispara a chamada sem aguardar — fica presa 2s na decifra envelopada.
    const carga = page.evaluate(() =>
      (window as any).Alpine.$data(document.body).carregarIndiceRelatorios(),
    );
    await page.waitForTimeout(300);

    // Bloqueia durante a janela: a decifra em voo já capturou o pin correto
    // por valor; this.pin some do $data agora.
    await page.evaluate(() => (window as any).Alpine.$data(document.body).bloquear());
    await expect(page.locator(".pin-screen")).toBeVisible();

    // await na própria chamada: ela só resolve depois da decifra atrasada.
    await carga;

    // O guard pós-await deve ter recusado popular relIndice de volta.
    const relIndice = await page.evaluate(
      () => (window as any).Alpine.$data(document.body).relIndice,
    );
    expect(relIndice).toBeNull();
    await expect(page.locator(".pin-screen")).toBeVisible();
  });

  // Review final pós-7a.U, Finding 1 — o ramo "ticker fora do índice" de
  // carregarDossie() retornava sem anular `_dossiePromise`/
  // `_dossiePromiseTicker` nem desligar `dossieCarregando`. Cenário: A
  // (HGLG11, no índice) fica em voo → navega para B (BOVA11, fora do
  // índice) antes de A resolver. Sem o fix, A segue "vigente" pelo critério
  // de identidade (`_dossiePromise === promessa`) — o spinner (herdado de A)
  // fica preso em vez de cair pra `.dossie-vazio`, e quando A resolve, ela
  // escreve o dossiê de A por cima da tela (ainda) de B.
  test("navegar para ticker fora do índice com outro em voo não herda o dossiê alheio nem trava o spinner", async ({ page }) => {
    await autenticar(page);
    // `carregarIndiceDossies()` do boot (tentarAutoResume) é fire-and-forget
    // e roda DEPOIS do await de carregarIndiceRelatorios() — `.raiox` pode
    // ficar visível (fase já virou "raiox") ANTES dele sequer começar. Sem
    // esperar o índice carregar aqui, atrasarDecifrar() abaixo atrasaria a
    // decifra do PRÓPRIO índice (window.decifrar é lido dinamicamente no
    // call site, não capturado por referência) — hidratarDossie() ficaria
    // preso no gate `!dossieIndice.length`, carregarDossie("HGLG11") nunca
    // chegaria a rodar, e o teste passaria por VACUIDADE (sem promise real
    // em voo pra disputar).
    await page.waitForFunction(() => {
      const d = (window as any).Alpine.$data(document.body);
      return d.dossieIndice && d.dossieIndice.length > 0;
    });
    await atrasarDecifrar(page, 2_000);

    // A (HGLG11) começa a carregar — a decifra fica presa 2s.
    await page.goto("/#/dossie/HGLG11");
    await page.waitForTimeout(300); // A em voo (fetch feito, decifra pendente)

    // Self-guard: prova que A está de fato em voo antes do próximo passo.
    // Se `atrasarDecifrar()` parasse de atrasar window.decifrar — o modo de
    // falha que esta fase já viu — A resolveria ANTES da navegação para B e
    // o resto do teste passaria por VACUIDADE (o estado final bateria com o
    // esperado mesmo sem nenhuma disputa real acontecer).
    const aEmVoo = await page.evaluate(
      () => (window as any).Alpine.$data(document.body)._dossiePromiseTicker,
    );
    expect(aEmVoo).toBe("HGLG11");

    // B (BOVA11, fora do índice) — o ramo `!entrada` é síncrono, sem fetch.
    await page.goto("/#/dossie/BOVA11");
    await page.waitForTimeout(200); // setTimeout(0)+hidratarDossie de B já rodaram
    await expect(page.locator(".tela-dossie")).toBeVisible();

    // Ainda dentro da janela de A: nem spinner preso, nem dado de A.
    const emVoo = await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      return {
        carregando: d.dossieCarregando,
        atual: d.dossieAtual,
        carregado: d.dossieCarregado,
        ticker: d.dossieTicker,
      };
    });
    expect(emVoo).toEqual({ carregando: false, atual: null, carregado: "", ticker: "BOVA11" });
    await expect(page.locator(".tela-dossie .dossie-vazio")).toBeVisible();
    await expect(page.locator(".tela-dossie .dossie-loading")).toBeHidden();

    // Espera A terminar de decifrar (2s + folga). A resolução SUPERADA não
    // pode escrever o dossiê de A por cima da tela (ainda) de B.
    await page.waitForTimeout(2_200);

    const posA = await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      return { atual: d.dossieAtual, carregado: d.dossieCarregado, carregando: d.dossieCarregando };
    });
    expect(posA).toEqual({ atual: null, carregado: "", carregando: false });
    await expect(page.locator(".tela-dossie .dossie-vazio")).toBeVisible();
    await expect(page.locator(".tela-dossie .dossie-corpo")).toHaveCount(0);
  });

  // Review final pós-7a.U, Finding 2 — `_limparEstadoDossie()` (chamado por
  // `bloquear()`) zerava o estado mas deixava `_dossiePromise`/
  // `_dossiePromiseTicker` apontando pra a requisição anterior em voo. O
  // guard pós-await de carregarDossie() só olha `this.pin` (afere pin no
  // INSTANTE DA RESOLUÇÃO, não identidade de sessão) — se o pin voltar
  // (unlock) ANTES da decifra atrasada resolver, o guard passa e o payload
  // pré-lock atravessa o lock pra dentro do $data já travado.
  test("race: pin restaurado durante o lock não deixa a decifra pré-lock repopular dossieAtual", async ({ page }) => {
    await autenticar(page);
    // Mesmo cuidado do teste do Finding 1: espera o índice de dossiês do
    // boot (fire-and-forget) carregar ANTES de atrasar window.decifrar,
    // senão hidratarDossie() fica preso no gate `!dossieIndice.length` e
    // carregarDossie("HGLG11") nunca chega a criar a promise em voo que
    // este teste precisa disputar contra o lock.
    await page.waitForFunction(() => {
      const d = (window as any).Alpine.$data(document.body);
      return d.dossieIndice && d.dossieIndice.length > 0;
    });
    await atrasarDecifrar(page, 1_500);

    // A (HGLG11) começa a carregar — decifra presa 1.5s.
    await page.goto("/#/dossie/HGLG11");
    await page.waitForTimeout(300); // A em voo

    // Self-guard: idem ao teste do Finding 1 — prova que A está de fato em
    // voo antes de travar. Sem isto, se `atrasarDecifrar()` parasse de
    // atrasar window.decifrar, A resolveria ANTES do lock e a race que este
    // teste existe para provar nunca aconteceria — o `posUnlock` bateria com
    // o esperado por vacuidade, não porque o guard funcionou.
    const aEmVoo = await page.evaluate(
      () => (window as any).Alpine.$data(document.body)._dossiePromiseTicker,
    );
    expect(aEmVoo).toBe("HGLG11");

    // Trava — limpa dossieAtual/dossieTicker, mas (bug) não anula
    // _dossiePromise/_dossiePromiseTicker: a requisição de A segue "vigente".
    await page.evaluate(() => (window as any).Alpine.$data(document.body).bloquear());
    await expect(page.locator(".pin-screen")).toBeVisible();
    const trancado = await page.evaluate(
      () => (window as any).Alpine.$data(document.body).dossieAtual,
    );
    expect(trancado).toBeNull();

    // "Destrava" no sentido mínimo do guard afetado: o pin volta ao $data —
    // é literalmente o que `x-model="pin"` faz a cada tecla digitada, antes
    // mesmo do submit completar — SEM re-navegar/re-chamar carregarDossie,
    // pra isolar exatamente o guard `if (!this.pin) return` da resolução
    // atrasada, sem se misturar com um fetch novo e legítimo.
    await page.evaluate(() => {
      (window as any).Alpine.$data(document.body).pin = "123456";
    });

    // Espera a decifra pré-lock de A terminar (1.5s + folga). O guard de
    // identidade (`_dossiePromise === promessa`) é a única coisa que pode
    // impedir a escrita agora que `this.pin` voltou.
    await page.waitForTimeout(1_800);

    const posUnlock = await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      return { atual: d.dossieAtual, carregado: d.dossieCarregado };
    });
    expect(posUnlock).toEqual({ atual: null, carregado: "" });
  });

  test("lock descarta as 3 instâncias ECharts, os 3 observers e o estado derivado", async ({ page }) => {
    await autenticar(page);
    await renderizarOsTresGraficos(page);

    const antes = await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      return {
        prov: !!d.echartsProv, patr: !!d.echartsPatr, rent: !!d.echartsRent,
        oProv: !!d.resizeObserverProv, oPatr: !!d.resizeObserverPatr,
        oRent: !!d.resizeObserverChart, ctx: !!d._rentCtx,
      };
    });
    // Se algum vier false, o roteiro não instanciou os 3 — o teste passaria
    // por vacuidade depois do lock.
    expect(antes).toEqual({
      prov: true, patr: true, rent: true,
      oProv: true, oPatr: true, oRent: true, ctx: true,
    });

    const depois = await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      d.bloquear();
      return {
        prov: d.echartsProv == null, patr: d.echartsPatr == null,
        rent: d.echartsRent == null,
        oProv: d.resizeObserverProv == null, oPatr: d.resizeObserverPatr == null,
        oRent: d.resizeObserverChart == null,
        ctx: d._rentCtx == null,
        provLabel: d.proventosTotalLabel, provValor: d.proventosTotalValor,
        subtitulo: d.rentabilidadeSubtitulo,
        periodoTwr: d.periodoCustom.twr, periodoXirr: d.periodoCustom.xirr,
        periodoFim: d.periodoCustom.fimIdx,
        periodoBench: d.periodoCustom.benchExtras.length,
      };
    });
    expect(depois).toEqual({
      prov: true, patr: true, rent: true,
      oProv: true, oPatr: true, oRent: true, ctx: true,
      provLabel: "", provValor: 0, subtitulo: "",
      periodoTwr: null, periodoXirr: null, periodoFim: null, periodoBench: 0,
    });
  });

  test("lock descarta o plano de aporte", async ({ page }) => {
    await autenticar(page);
    await abrirAportar(page, "5000");

    // `aporteBanner` (string do card de topo) e `_aportePresetPendente` (a
    // ponte cross-screen do grifo `#alocação` → `#aportar`, 7a.S.10) NUNCA
    // ficam não-nulos neste roteiro — o 1º só popula num caso específico do
    // cálculo do aporte, o 2º só chegando pelo deep-link do grifo. Sem
    // popular os dois aqui, a asserção do `depois` (`banner: null, preset:
    // null`) passaria por VACUIDADE: não prova que `_limparEstadoAporte()`
    // zera algo que já era `null` antes do lock. Injeção direta via $data é
    // deliberada — dirigir a UI até um banner real ou entrar pela ponte do
    // grifo custaria muito mais e provaria exatamente a mesma coisa (que o
    // choke point zera os dois campos). Valores sintéticos, sem parecido com
    // dado real (o sibling é público).
    const antes = await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      d.aporteBanner = "teste sintético — banner não-nulo";
      d._aportePresetPendente = 999;
      return {
        valor: d.aporteValor,
        recebedoras: d.aporteCategoriasRecebedoras.length,
        banner: d.aporteBanner,
        preset: d._aportePresetPendente,
      };
    });
    expect(antes.valor).not.toBe("");
    expect(antes.recebedoras).toBeGreaterThan(0);
    expect(antes.banner).not.toBeNull();
    expect(antes.preset).not.toBeNull();

    const depois = await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      d.bloquear();
      return {
        valor: d.aporteValor, banner: d.aporteBanner,
        receb: d.aporteCategoriasRecebedoras.length,
        naoReceb: d.aporteCategoriasNaoRecebedoras.length,
        pausados: d.aportePausados.length,
        semPosicao: d.aporteTickersSemPosicao.length,
        revelados: d._aporteRevelados.size,
        preset: d._aportePresetPendente,
      };
    });
    expect(depois).toEqual({
      valor: "", banner: null, receb: 0, naoReceb: 0, pausados: 0,
      semPosicao: 0, revelados: 0, preset: null,
    });
  });

  // Fechamento de escopo 7a.U: `escopoAtivo` e `toast` são estado de
  // app-shell (não pertenciam a nenhuma família de tela existente, ficavam
  // no limbo — nem limpos pelo choke point, nem justificados na ALLOWLIST).
  // Mesmo padrão do teste "lock descarta o plano de aporte" acima: injeção
  // direta via $data (valores sintéticos, sem parecido com dado real — o
  // sibling é público), `antes` afirma não-default para o comparador
  // distinguir de verdade, `depois` prova o literal exato da declaração.
  // O timer de 100ms com callback diagnóstico prova o cuidado extra: que
  // `_limparEstadoAppShell()` (renomeado do antigo `_limparEstadoEscopoEToast`
  // no review final pós-7a.U, Finding 4) CANCELA o setTimeout pendente antes
  // de trocar o objeto `toast`. Não é pra evitar escrita num objeto "morto"
  // — o callback de `mostrarToast()` resolve `this.toast` no instante do
  // disparo, então escreveria no objeto NOVO (inofensivo, Finding 5); o
  // motivo real é não deixar esse timer sobrevivente esconder PREMATURAMENTE
  // um toast legítimo mostrado depois do unlock.
  test("lock descarta escopoAtivo e toast, cancelando o timer pendente", async ({ page }) => {
    await autenticar(page);

    const antes = await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      d.escopoAtivo = "EUA";
      d.toast = {
        visible: true,
        mensagem: "teste sintético — toast não-default 01/01/2000",
        tom: "verde",
        timer: setTimeout(() => {
          (window as any).__toastTimerFired = true;
        }, 100),
      };
      return {
        escopo: d.escopoAtivo,
        visible: d.toast.visible,
        mensagem: d.toast.mensagem,
      };
    });
    expect(antes.escopo).not.toBe("Total");
    expect(antes.visible).toBe(true);
    expect(antes.mensagem).not.toBe("");

    const depois = await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      d.bloquear();
      return { escopo: d.escopoAtivo, toast: d.toast };
    });
    expect(depois).toEqual({
      escopo: "Total",
      toast: { visible: false, mensagem: "", tom: "verde", timer: null },
    });

    // Espera além dos 100ms do timer original — se `_limparEstadoAppShell()`
    // não tivesse cancelado o timer, o callback já teria escrito o marcador.
    await page.waitForTimeout(300);
    const disparou = await page.evaluate(() => (window as any).__toastTimerFired);
    expect(disparou).toBeUndefined();
  });

  test("logout multi-aba descarta as mesmas famílias (mesmo choke point)", async ({ context }) => {
    const abaA = await context.newPage();
    await mockTudo(abaA);
    const abaB = await context.newPage();
    await mockTudo(abaB);

    // A autentica pelo PIN (semeia o localStorage compartilhado do origin).
    await abaA.goto("/");
    await abaA.locator("input.pin-input").fill("123456");
    await abaA.locator("button.pin-submit").click();
    await expect(abaA.locator(".raiox")).toBeVisible({ timeout: 10_000 });

    // B reusa a sessão e popula as 3 famílias.
    await abaB.goto("/");
    await expect(abaB.locator(".raiox")).toBeVisible({ timeout: 10_000 });
    await abrirRelatorio(abaB);
    await abrirAportar(abaB, "5000");
    await renderizarOsTresGraficos(abaB);

    const antes = await abaB.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      return {
        rel: !!d.relMes, aporte: d.aporteCategoriasRecebedoras.length > 0,
        chart: !!d.echartsRent,
        // CRB final 7a.U Finding 4: sem checar `antes`, a asserção `depois`
        // (dossieIdx: 0) passaria por VACUIDADE se carregarIndiceDossies()
        // falhasse silenciosamente em B — tentarAutoResume() chama-o
        // incondicionalmente, então o índice JÁ é 4 aqui.
        dossieIdx: d.dossieIndice.length > 0,
      };
    });
    expect(antes).toEqual({ rel: true, aporte: true, chart: true, dossieIdx: true });

    // A bloqueia pelo botão → evento storage em B.
    await abaA.goto("/#raiox");
    await abaA.getByRole("button", { name: /bloquear/i }).click();
    await expect(abaA.locator(".pin-screen")).toBeVisible();
    await expect(abaB.locator(".pin-screen")).toBeVisible({ timeout: 5_000 });

    const depois = await abaB.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      return {
        rel: d.relMes, relIdx: d.relIndice, aporte: d.aporteValor,
        receb: d.aporteCategoriasRecebedoras.length,
        rent: d.echartsRent == null, prov: d.echartsProv == null,
        patr: d.echartsPatr == null, ctx: d._rentCtx == null,
        dossieIdx: d.dossieIndice.length,
      };
    });
    expect(depois).toEqual({
      rel: null, relIdx: null, aporte: "", receb: 0,
      rent: true, prov: true, patr: true, ctx: true, dossieIdx: 0,
    });
  });

  test("deep-link de dossiê sobrevive a lock→unlock (volta no ticker da URL)", async ({ page }) => {
    await autenticar(page);
    await abrirDossie(page, "HGLG11");
    await expect(page.locator(".tela-dossie .dossie-ticker")).toHaveText("HGLG11");

    await bloquearEDestravar(page);

    await expect(page).toHaveURL(/#\/dossie\/HGLG11$/);
    await expect(page.locator(".tela-dossie .dossie-corpo")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".tela-dossie .dossie-ticker")).toHaveText("HGLG11");
    // A tela vazia é o sintoma exato do defeito de §4.
    await expect(page.locator(".tela-dossie .dossie-vazio")).toBeHidden();
    expect(
      await page.evaluate(() => (window as any).Alpine.$data(document.body).dossieTicker),
    ).toBe("HGLG11");
  });

  test("deep-link de Relatório com mês explícito volta no mês da URL, não no último", async ({ page }) => {
    await autenticar(page);
    // 2026-04 é o mês ANTERIOR ao último do índice (2026-05) — se a rota for
    // perdida, hidratarRelatorio cai no fallback do último mês e o teste vê Maio.
    await abrirRelatorio(page, "2026-04");
    await expect(page.locator(".tela-relatorio .breadcrumb")).toContainText("Abril 2026");

    await bloquearEDestravar(page);

    await expect(page).toHaveURL(/#\/raiox\/relatorio\/2026-04$/);
    await expect(page.locator(".tela-relatorio .rel-corpo")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".tela-relatorio .breadcrumb")).toContainText("Abril 2026");
    expect(
      await page.evaluate(() => {
        const d = (window as any).Alpine.$data(document.body);
        return { rota: d.relRotaMes, atual: d.relMesAtual };
      }),
    ).toEqual({ rota: "2026-04", atual: "2026-04" });
  });

  // 7a.U Task 6 (CRB round 2, Finding 2): submitPin() chama atualizarRota()
  // ao promover a fase (§4 acima), que agenda hidratarRelatorio() via
  // setTimeout(0) — a MESMA hidratação que a linha explícita duas linhas
  // abaixo (`if (this.rota === "relatorio") this.hidratarRelatorio();`) já
  // dispara. Sem promise em voo nos loaders, as duas cadeias corriam em
  // paralelo: 2 fetches + 2 decifras PBKDF2 (600k iterações cada) do MESMO
  // payload. Conta requisições de rede (determinístico, não depende de
  // timing) em vez de tentar flagrar 2 decifras concorrentes por relógio.
  test("deep-link de Relatório destravado busca índice e mês UMA vez, não duas (regressão CRB round 2)", async ({ page }) => {
    await autenticar(page);
    await abrirRelatorio(page, "2026-04");
    await expect(page.locator(".tela-relatorio .breadcrumb")).toContainText("Abril 2026");

    // Contador registrado DEPOIS da carga inicial — só a janela do
    // lock→unlock interessa. No Playwright o handler mais recente tem
    // precedência (LIFO); aqui ele fulfilla direto, sem repassar ao de
    // `mockTudo`.
    let hitsIndice = 0;
    await page.route("**/relatorios_index.json.enc", (r) => {
      hitsIndice++;
      return r.fulfill({ status: 200, body: IDX_REL, contentType: "text/plain" });
    });
    let hitsMes = 0;
    await page.route("**/relatorio_2026-04.json.enc", (r) => {
      hitsMes++;
      return r.fulfill({ status: 200, body: ABRIL, contentType: "text/plain" });
    });

    await bloquearEDestravar(page);
    await expect(page.locator(".tela-relatorio .rel-corpo")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".tela-relatorio .breadcrumb")).toContainText("Abril 2026");
    // Folga > custo de uma 2ª decifra PBKDF2 (centenas de ms): se a corrida
    // ainda existisse, a 2ª cadeia completaria DEPOIS do 1º render e o
    // hit apareceria só se esperarmos por ele — sem a folga, o RED seria
    // sorte de timing (mesma armadilha da Task 5).
    await page.waitForTimeout(800);

    expect(hitsIndice).toBe(1);
    expect(hitsMes).toBe(1);
  });

  // ── Fase 7a.V (Item E) ────────────────────────────────────────────────
  // MESMA CLASSE fechada pela 7a.U, um nível acima: o guard que falta não é
  // dentro da carregadora, é no CHAMADOR que decide iniciar trabalho novo.
  // `hidratarRelatorio()` cede o thread no `await carregarIndiceRelatorios()`
  // e, ao retomar, chamava `carregarRelatorioMes()` mesmo se um lock tivesse
  // rodado no meio — disparando fetch + decifra PBKDF2 com `pin` vazio numa
  // sessão travada, cujo erro emerge depois do unlock (erro fantasma).
  //
  // Duas escolhas de roteiro que NÃO são decorativas:
  //
  // 1. O índice é servido por um PORTÃO (promise resolvida pelo teste), não por
  //    um atraso de relógio: a janela do await tem duração determinística e o
  //    teste não depende do custo de PBKDF2 da máquina.
  //
  // 2. `atualizarRota()` é chamada DEPOIS do lock. O choke point
  //    (`_limparEstadoRelatorio`) zera `relRotaMes`, então sem re-derivar o
  //    ponteiro da hash o `alvo` sairia null e a função pararia no
  //    early-return — o furo ficaria MASCARADO e este teste passaria por
  //    VACUIDADE, medindo o mascaramento em vez do guard. Um back/forward do
  //    browser na tela de PIN é exatamente o que re-deriva o ponteiro na vida
  //    real (o hash sobrevive ao lock por design, 7a.U §3.2), e nada garante
  //    que `relRotaMes` siga sendo limpo: `tickerAtual` já vive na ALLOWLIST
  //    com a justificativa de "ponteiro derivado da hash", que se aplica
  //    igualmente a ele.
  //
  // Asserção PRIMÁRIA = contagem de fetch do payload do mês: determinística,
  // não depende de relógio, e é literalmente "trabalho novo iniciado sob lock".
  test("lock durante a carga do índice não deixa hidratarRelatorio buscar o mês", async ({ page }) => {
    await autenticar(page);
    await abrirRelatorio(page, "2026-04");

    // Portão do índice: o fulfill só acontece quando `liberar()` roda.
    let liberar!: () => void;
    const portao = new Promise<void>((r) => { liberar = r; });
    await page.route("**/relatorios_index.json.enc", async (r) => {
      await portao;
      return r.fulfill({ status: 200, body: IDX_REL, contentType: "text/plain" });
    });

    // Contador do payload do mês. Registrado DEPOIS da carga inicial (no
    // Playwright o handler mais recente tem precedência, LIFO) — só a janela
    // do lock→unlock→lock interessa. 0 é o veredito da fase.
    let hitsMes = 0;
    await page.route("**/relatorio_2026-04.json.enc", (r) => {
      hitsMes++;
      return r.fulfill({ status: 200, body: ABRIL, contentType: "text/plain" });
    });

    // 1º lock: zera relIndice (é o que força o await do índice no unlock).
    await page.evaluate(() => (window as any).Alpine.$data(document.body).bloquear());
    await expect(page.locator(".pin-screen")).toBeVisible();

    // Unlock REAL (sem await do fim): submitPin promove a fase, chama
    // atualizarRota() (que re-deriva relRotaMes e agenda hidratarRelatorio via
    // setTimeout 0) e então PARA no `await carregarIndiceRelatorios()` — que
    // está preso no portão. A hidratação agendada entra no mesmo await.
    await page.locator("input.pin-input").fill("123456");
    await page.locator("button.pin-submit").click();

    // Self-guard contra vacuidade: prova que a janela do await está ABERTA.
    // Sem isto, um portão que não segurasse nada faria o resto do teste passar
    // sem nenhuma corrida real acontecer.
    await page.waitForFunction(() => {
      const d = (window as any).Alpine.$data(document.body);
      return !!d._relIndicePromise && !!d.pin;
    }, undefined, { timeout: 10_000 });

    // 2º lock, DENTRO da janela: pin vai a "", relRotaMes é zerado.
    await page.evaluate(() => (window as any).Alpine.$data(document.body).bloquear());
    await expect(page.locator(".pin-screen")).toBeVisible();

    // Re-deriva o ponteiro da hash durante o lock (o back/forward do browser).
    // Sem esta linha o teste mede o mascaramento, não o guard.
    await page.evaluate(() => (window as any).Alpine.$data(document.body).atualizarRota());
    expect(
      await page.evaluate(() => (window as any).Alpine.$data(document.body).relRotaMes),
    ).toBe("2026-04");

    // Libera o índice: a decifra roda com pin "" e o loader respeita o lock
    // (relIndice segue null). A continuação de hidratarRelatorio é retomada
    // agora — é aqui que o guard novo age.
    liberar();
    await page.waitForFunction(
      () => (window as any).Alpine.$data(document.body)._relIndicePromise === null,
      undefined, { timeout: 10_000 },
    );
    // Folga para a continuação retomada disparar (ou não) o fetch do mês.
    await page.waitForTimeout(500);

    // Veredito: nenhum trabalho novo foi iniciado sob lock.
    expect(hitsMes).toBe(0);
    const estado = await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      return {
        promessa: d._relMesPromise, alvo: d._relMesPromiseAlvo,
        carregando: d.relCarregando, erro: d.relErro, indice: d.relIndice,
      };
    });
    expect(estado).toEqual({
      promessa: null, alvo: null, carregando: false, erro: "", indice: null,
    });
    await expect(page.locator(".pin-screen")).toBeVisible();
  });

  // Fase 7a.V (Item E), fechamento de CLASSE: `hidratarDossie()` tem a mesma
  // estrutura de `hidratarRelatorio()` — await do índice, sem re-checar o pin
  // na retomada — e o mesmo racional de guard-no-chamador se aplica.
  //
  // Por que a asserção aqui NÃO é contagem de rede (como no teste acima): o
  // caminho do dossiê é mascarado DUAS vezes. Além de `dossieTicker` ser
  // zerado pelo choke point, o índice fica `[]` sob lock, então
  // `carregarDossie()` cai no ramo `!entrada` ("sem fetch às cegas") e nenhuma
  // requisição sai — a contagem de rede seria 0 com ou sem o guard, ou seja,
  // passaria por vacuidade. O único observável que discrimina é a INVOCAÇÃO da
  // carregadora, daí o contador instalado sobre o método no $data.
  test("lock durante a carga do índice não deixa hidratarDossie chamar a carregadora", async ({ page }) => {
    await autenticar(page);
    await abrirDossie(page, "HGLG11");

    let liberar!: () => void;
    const portao = new Promise<void>((r) => { liberar = r; });
    await page.route("**/dossies_index.json.enc", async (r) => {
      await portao;
      return r.fulfill({ status: 200, body: IDX_DOSSIES, contentType: "text/plain" });
    });

    // 1º lock: zera dossieIndice (força o await) e dossieTicker.
    await page.evaluate(() => (window as any).Alpine.$data(document.body).bloquear());
    await expect(page.locator(".pin-screen")).toBeVisible();

    // Contador sobre a carregadora, instalado ANTES do unlock.
    await page.evaluate(() => {
      const d = (window as any).Alpine.$data(document.body);
      const real = d.carregarDossie.bind(d);
      (window as any).__chamadasCarregarDossie = [];
      d.carregarDossie = function (ticker: string) {
        (window as any).__chamadasCarregarDossie.push({ ticker, pin: !!this.pin });
        return real(ticker);
      };
    });

    // Unlock real, sem aguardar o fim: submitPin re-deriva dossieTicker via
    // atualizarRota() e agenda hidratarDossie, que entra no await do índice
    // preso no portão.
    await page.locator("input.pin-input").fill("123456");
    await page.locator("button.pin-submit").click();

    // Self-guard contra vacuidade: a janela do await tem de estar ABERTA.
    await page.waitForFunction(() => {
      const d = (window as any).Alpine.$data(document.body);
      return !!d._dossieIndicePromise && !!d.pin;
    }, undefined, { timeout: 10_000 });

    // 2º lock dentro da janela + re-derivação do ponteiro da hash (sem ela o
    // early-return `!dossieTicker` mascara o furo e o teste mede nada).
    await page.evaluate(() => (window as any).Alpine.$data(document.body).bloquear());
    await expect(page.locator(".pin-screen")).toBeVisible();
    await page.evaluate(() => (window as any).Alpine.$data(document.body).atualizarRota());
    expect(
      await page.evaluate(() => (window as any).Alpine.$data(document.body).dossieTicker),
    ).toBe("HGLG11");

    liberar();
    await page.waitForFunction(
      () => (window as any).Alpine.$data(document.body)._dossieIndicePromise === null,
      undefined, { timeout: 10_000 },
    );
    await page.waitForTimeout(500);

    // Veredito: a carregadora não foi chamada em nenhuma sessão sem pin.
    const chamadas = await page.evaluate(() => (window as any).__chamadasCarregarDossie);
    expect(chamadas.filter((c: { pin: boolean }) => !c.pin)).toEqual([]);
    await expect(page.locator(".pin-screen")).toBeVisible();
  });

  test("invariante: nenhum campo do $data retém dado decifrado pós-lock", async ({ page }) => {
    await mockTudo(page);
    // SEM pin no localStorage: o snapshot virgem precisa da tela de PIN antes
    // de qualquer decifra.
    await page.goto("/");
    await expect(page.locator(".pin-screen")).toBeVisible({ timeout: 10_000 });
    const virgem = await assinatura(page);

    await page.locator("input.pin-input").fill("123456");
    await page.locator("button.pin-submit").click();
    await expect(page.locator(".raiox")).toBeVisible({ timeout: 10_000 });

    // Roteiro: só o necessário para instanciar cada família. Nenhum ciclo de
    // faceta do hero — inflaria a allowlist com ruído de UI (spec §5).
    //
    // CRB final 7a.U Finding 1: o roteiro original não visitava #ativo,
    // #/proventos/dy nem #alocacao, e 4 campos derivados do payload escapavam
    // do teste sem limpeza E sem entrada na allowlist. Os 3 helpers abaixo
    // cobrem 3 deles com o mínimo de interação (abrirDY não exige clique —
    // hidratarDY() auto-seleciona; abrirAlocacaoComCategoriaAberta clica 1×,
    // o mínimo pra popular catAberta). `proventosMesSelecionado` (o 4º campo
    // da tabela do finding) fica FORA do roteiro de propósito: só populado
    // por um clique de drilldown em #proventos Mensal (ver
    // clicarBarraIdx/_handleClickBarraMes em proventos-drilldown.spec.ts), e
    // adicioná-lo aqui seria o "clique decorativo" que a nota original deste
    // teste já advertia contra. A limpeza em `_limparEstadoProventosDY()`
    // cobre o campo do mesmo jeito — a fase decidiu LIMPAR por classificação
    // (derivado do payload), não porque este teste o flagrou divergindo.
    await abrirRelatorio(page);
    await abrirDossie(page, "HGLG11");
    await abrirAportar(page, "5000");
    await renderizarOsTresGraficos(page);
    await abrirAtivo(page, "HGLG11");
    // Ordem histórica preservada, mas não mais obrigatória: #alocacao antes
    // de #/proventos/dy vinha de quando sig() marcava strings só por
    // COMPRIMENTO — `tab`="aloca" (5 chars) colidia por acaso com o "raiox"
    // (5 chars) virgem se fosse a última navegação, e a entrada `tab` da
    // ALLOWLIST ficava MORTA (medido). CRB final round Finding C trocou o
    // marcador por comprimento+hash de conteúdo (ver ASSINATURA_FN), então a
    // colisão por tamanho não acontece mais e a ordem deixou de importar.
    await abrirAlocacaoComCategoriaAberta(page);
    await abrirDY(page);

    await page.evaluate(() => (window as any).Alpine.$data(document.body).bloquear());
    await expect(page.locator(".pin-screen")).toBeVisible();
    const posLock = await assinatura(page);

    const chaves = Array.from(new Set([...Object.keys(virgem), ...Object.keys(posLock)])).sort();
    const divergentes = chaves.filter(
      (k) => JSON.stringify(virgem[k]) !== JSON.stringify(posLock[k]),
    );

    const semJustificativa = divergentes.filter((k) => !(k in ALLOWLIST));
    expect(
      semJustificativa,
      "campos divergentes sem entrada na ALLOWLIST — limpe no choke point " +
        "(_limparEstadoSensivel) ou justifique com motivo:\n" +
        semJustificativa
          .map((k) => `  ${k}: virgem=${JSON.stringify(virgem[k])} pós-lock=${JSON.stringify(posLock[k])}`)
          .join("\n"),
    ).toEqual([]);

    // Entrada morta na allowlist = permissão que ninguém exerce. Sem esta
    // segunda asserção a lista apodrece em carta-branca.
    const mortas = Object.keys(ALLOWLIST).filter((k) => !divergentes.includes(k));
    expect(mortas, "entradas da ALLOWLIST que não divergem mais — remova").toEqual([]);
  });
});
