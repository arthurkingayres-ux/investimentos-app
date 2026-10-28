const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FAIL_WINDOW_MS = 30 * 60 * 1000;
const BLOCK_5_MS = 5 * 60 * 1000;
const BLOCK_15_MS = 15 * 60 * 1000;
const BLOCK_60_MS = 60 * 60 * 1000;

// 7a.S.11 — A Abertura: orquestra o dissolve da PIN screen + o reveal em
// stagger da home + o breathe do delta pill (cerimônia PIN → home, 1×/sessão,
// reduced-motion-gated). Ground-truth exposta em window.aberturaMotion pros
// specs Playwright (mesmo racional de window.drarthurNav.motion, 7a.I.6) —
// STANDALONE: não estende o contrato de motion do app shell em
// transitions.js (nav-reduced-motion.spec.ts continua validando só
// tabFade/tabIndicator/countUp/push/segmented).
const ABERTURA_MOTION = {
  dissolveMs: 550,       // --d3: opacity + scale da .pin-screen ao desbloquear
  dissolveRemoveMs: 620, // folga pós-transição antes de trocar `fase` (nó sai assentado)
  staggerMs: [100, 250, 400, 550], // eyebrow, hero, raiox-7d, rel-card-home
  breatheMs: 980,        // delta pill "respira" 1 ciclo, ao fim do stagger
};
window.aberturaMotion = ABERTURA_MOTION;

// 7a.G.2 Pass 1 (colorize): cores resolvidas a partir dos tokens CSS em :root.
// Lê via getComputedStyle pra que o JS consuma a mesma source-of-truth do CSS.
const css = (token, fallback = "") =>
  getComputedStyle(document.documentElement).getPropertyValue(token).trim() || fallback;

// 7a.L.2.b: Newton-Raphson XIRR (top-level, fora do Alpine.data), nascido no
// card "Período" do #rentabilidade (removido na 7a.BD.2); hoje o único
// chamador é ponteXirr. Convenção de sinal igual a calcular_xirr_from_flows
// do backend: aporte = negativo, retirada = positiva. `opcoes`: `diasAno` é a
// base da contagem de tempo — 365.25 (default) ou 365 (ACT/365, a convenção
// do pyxirr, que a ponte passa); `maxRate` é o teto de |taxa| anual em que o
// iterador desiste (default 10 = 1000 % a.a.; a ponte passa Infinity).
function newtonRaphsonXirr(flows, guess = 0.10, maxIter = 50, tol = 1e-7, opcoes = {}) {
  const { diasAno = 365.25, maxRate = 10 } = opcoes;
  if (!Array.isArray(flows) || flows.length < 2) return null;
  const d0 = flows[0][0];
  // Requer pelo menos um valor negativo E um positivo, senão XIRR é indefinida.
  let temNeg = false, temPos = false;
  for (const [, v] of flows) {
    if (v < 0) temNeg = true;
    if (v > 0) temPos = true;
  }
  if (!temNeg || !temPos) return null;
  let rate = (typeof guess === "number" && isFinite(guess)) ? guess : 0.10;
  for (let i = 0; i < maxIter; i++) {
    let npv = 0, dnpv = 0;
    for (const [d, v] of flows) {
      const dt = (d - d0) / (1000 * 60 * 60 * 24) / diasAno;
      const base = 1 + rate;
      if (base <= 0) return null;
      const denom = Math.pow(base, dt);
      npv += v / denom;
      dnpv += -dt * v / Math.pow(base, dt + 1);
    }
    if (Math.abs(dnpv) < 1e-12) return null;
    const newRate = rate - npv / dnpv;
    if (!isFinite(newRate)) return null;
    if (Math.abs(newRate - rate) < tol) return newRate;
    rate = newRate;
    if (Math.abs(rate) > maxRate) return null;
  }
  return null;
}

// 7a.BD.2 — gêmea JS de src/calculadora/ponte.py (repo principal): a ponte de
// rentabilidade, a carteira contra a MESMA carteira feita só de índices. A
// conta, as guardas e os textos são os da referência Python, que é a fonte da
// verdade (docstring "Paridade com a gêmea JS"); o teste cruzado
// tests/e2e/rentabilidade-ponte-calculo.spec.ts compara campo a campo contra a
// saída dela (tests/fixtures/ponte_esperado.test.json). Python None = null.
// - Ligação GRAP (Frongello, 1997): c_t · Π_{s<t}(1+R_p,s) · Π_{s>t}(1+R_ind,s).
// - Ordem de `ativos` por (contrib, t), com t comparado por `<`/`>` (code
//   unit; tickers são ASCII, então coincide com o code point do Python) —
//   nunca localeCompare — e já reetiquetado ("Rebates da corretora").
// - XIRR: newtonRaphsonXirr com diasAno = 365 (ACT/365, a convenção do pyxirr)
//   e datas em UTC no último dia de cada mês, sem fuso nem horário de verão;
//   sem teto de taxa e, se o Newton falhar, bissecção no NPV (o pyxirr também
//   tem fallback e acha a raiz onde o Newton de 0.10 diverge).
// - Somas: o sum() do Python ≥ 3.12 é compensado (Neumaier) e o laço JS é
//   ingênuo; a diferença é ~1e-12 em valores em reais, dentro da tolerância.
// - round() do Python: ponteRoundPy (meio-para-par sobre o valor exato).
const PONTE_REBATE_TICKER = "AVNU_REBATE";
const PONTE_REBATE_ROTULO = "Rebates da corretora";
const PONTE_INDICE_CLASSE = { acoes_br: "IBOV", fiis: "IFIX", eua: "SP500TR" };
const PONTE_ORDEM_LINHAS = {
  Total: ["acoes_br", "fiis", "eua"],
  Brasil: ["acoes_br", "fiis"],
  EUA: ["picks", "fora"],
};
const PONTE_CLASSES_ESCOPO = {
  Total: null, // todas
  Brasil: ["acoes_br", "fiis", "renda_fixa"],
  EUA: ["eua"],
};
const PONTE_INDICES_DETALHES = {
  Total: ["CDI", "IBOV", "IFIX", "SP500TR"],
  Brasil: ["CDI", "IBOV", "IFIX"],
  EUA: ["SP500TR"],
};
const PONTE_MIN_DENOMINADOR = 0.01;
const PONTE_GUARDA_DIF = 1e-9;
const PONTE_JANELAS_FIXAS = [["12m", 12], ["3a", 36], ["5a", 60]];

function ponteMmAa(ym) {
  return `${ym.slice(5, 7)}/${ym.slice(2, 4)}`;
}

// Último dia do mês `ym` deslocado de `delta` meses, em UTC (Date.UTC com dia 0
// = último dia do mês anterior ao índice passado).
function ponteFimMes(ym, delta = 0) {
  const ano = Number(ym.slice(0, 4));
  const mes = Number(ym.slice(5, 7));
  return new Date(Date.UTC(ano, mes + delta, 0));
}

function ponteChaveEscopo(escopo, moeda) {
  if (!Object.hasOwn(PONTE_CLASSES_ESCOPO, escopo)) throw new Error(`escopo desconhecido: ${escopo}`);
  if (moeda !== "BRL" && moeda !== "USD") throw new Error(`moeda desconhecida: ${moeda}`);
  if (escopo === "EUA") return `EUA_${moeda}`;
  if (moeda !== "BRL") throw new Error(`escopo ${escopo} só existe em BRL`);
  return escopo;
}

function ponteNoEscopo(ativo, escopo) {
  const classes = PONTE_CLASSES_ESCOPO[escopo];
  return classes === null || classes.includes(ativo.classe);
}

// Linha da ponte e nome do índice de um ativo não passivo.
function ponteLinhaEIndice(ativo, escopo) {
  const classe = ativo.classe;
  if (!Object.hasOwn(PONTE_INDICE_CLASSE, classe)) {
    throw new Error(`ativo ${ativo.t} da classe ${classe} sem índice na ponte`);
  }
  if (escopo === "EUA") {
    const cesta = ativo.cesta_eua;
    if (cesta !== "picks" && cesta !== "fora") throw new Error(`ativo ${ativo.t} sem cesta EUA de linha: ${cesta}`);
    return [cesta, "SP500TR"];
  }
  return [classe, PONTE_INDICE_CLASSE[classe]];
}

function ponteVazio(nMeses, motivo) {
  return {
    n_meses: nMeses,
    anualizado: nMeses >= 12,
    sua: null,
    ind: null,
    dif: null,
    linhas: [],
    ativos: {},
    entrou: null,
    ganho: null,
    valor_fim: null,
    xirr: null,
    indices: {},
    indisponivel: motivo,
  };
}

// (1+acum)^(12/n) − 1; acum < −1 daria número complexo (quem chama já filtra).
function ponteAnualizar(acum, n) {
  if (acum < -1.0) throw new Error(`acumulado abaixo de -100%: ${acum}`);
  return Math.pow(1.0 + acum, 12.0 / n) - 1.0;
}

// Primeiro mês com ΣD > 0 no escopo (meses.length se nunca).
function ponteInicioEscopo(bloco, escopo, moeda) {
  ponteChaveEscopo(escopo, moeda);
  const ativos = bloco.ativos;
  const serie = moeda === "USD" ? bloco.usd : bloco.brl;
  for (let t = 0; t < serie.length; t++) {
    let somaD = 0;
    for (const [i, d] of serie[t]) if (ponteNoEscopo(ativos[i], escopo)) somaD += d;
    if (somaD > 0) return t;
  }
  return bloco.meses.length;
}

// Fallback do XIRR: bissecção no NPV (ACT/365) sobre x = ln(1+taxa), com
// 1+taxa ∈ [e^(-500/T), e^40], T = prazo em anos (≥ 1), para v·exp(−x·t) não
// estourar em janela longa. Em x a precisão é relativa em (1+taxa), o que
// importa porque, com n < 12, o XIRR é reportado "no período" como
// (1+taxa)^(n/12) − 1: um mês de −90 % tem taxa anual ≈ −1 + 1,7e-12, e um
// de +400 % ≈ 1,7e8 — fora de qualquer faixa linear como (−0.9999, 1e6).
// Exige troca de sinal nas pontas; sem ela, null (como o pyxirr sem raiz).
function ponteXirrBisseccao(flows) {
  const d0 = flows[0][0];
  const anos = flows.map(([d]) => (d - d0) / 86400000 / 365);
  const npv = (x) => {
    let s = 0;
    for (let k = 0; k < flows.length; k++) s += flows[k][1] * Math.exp(-x * anos[k]);
    return s;
  };
  let lo = -500 / Math.max(1, anos[anos.length - 1]);
  let hi = 40;
  let fLo = npv(lo);
  const fHi = npv(hi);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi)) return null;
  if (fLo === 0) return Math.expm1(lo);
  if (fHi === 0) return Math.expm1(hi);
  if ((fLo > 0) === (fHi > 0)) return null;
  for (let it = 0; it < 200; it++) {
    const mid = (lo + hi) / 2;
    if (mid === lo || mid === hi) break;
    const fMid = npv(mid);
    if (fMid === 0) return Math.expm1(mid);
    if ((fMid > 0) === (fLo > 0)) { lo = mid; fLo = fMid; } else { hi = mid; }
  }
  return Math.expm1((lo + hi) / 2);
}

// Fluxos no fim de cada mês: −v_ini no fim do mês anterior à janela; em cada
// mês −entrou_t + prov_t; +v_fim no último. Com n < 12, "no período".
function ponteXirr(bloco, fl, iIni, iFim) {
  const meses = bloco.meses;
  const vIni = iIni > 0 ? fl.v[iIni - 1] : 0.0;
  const flows = [[ponteFimMes(meses[iIni], -1), -vIni]];
  for (let t = iIni; t <= iFim; t++) {
    let x = -fl.entrou[t] + fl.prov[t];
    if (t === iFim) x += fl.v[iFim];
    flows.push([ponteFimMes(meses[t]), x]);
  }
  let r = newtonRaphsonXirr(flows, 0.10, 50, 1e-7, { diasAno: 365, maxRate: Infinity });
  if (r === null || !Number.isFinite(r)) r = ponteXirrBisseccao(flows);
  if (r === null || !Number.isFinite(r)) return null;
  const n = iFim - iIni + 1;
  if (n < 12) return Math.pow(1.0 + r, n / 12.0) - 1.0;
  return r;
}

// Ponte da janela iIni..iFim (inclusivos) para escopo e moeda, em frações.
function ponteJanela(bloco, escopo, moeda, iIni, iFim) {
  const chave = ponteChaveEscopo(escopo, moeda);
  const meses = bloco.meses;
  if (!(0 <= iIni && iIni <= iFim && iFim < meses.length)) {
    throw new Error(`janela fora de meses: ${iIni}..${iFim}`);
  }
  const n = iFim - iIni + 1;
  const ativos = bloco.ativos;
  const serie = moeda === "USD" ? bloco.usd : bloco.brl;
  const tabInd = bloco.indices[moeda];
  const buracos = new Set(bloco.buracos[chave] || []);

  // 1) contribuições mensais por ativo, R_p e R_ind de cada mês
  const rP = [];
  const rI = [];
  const mensal = []; // por mês: Map idx_ativo -> c_a,t
  const presentes = new Map(); // idx_ativo -> [linha, índice]
  for (let t = iIni; t <= iFim; t++) {
    if (buracos.has(t)) return ponteVazio(n, `cotação ausente em ${ponteMmAa(meses[t])}`);
    const entradas = serie[t].filter((e) => ponteNoEscopo(ativos[e[0]], escopo));
    let somaD = 0;
    let somaG = 0;
    for (const [, d, g] of entradas) { somaD += d; somaG += g; }
    if (Math.abs(somaD) < PONTE_MIN_DENOMINADOR) {
      if (Math.abs(somaG) < PONTE_MIN_DENOMINADOR) {
        rP.push(0.0);
        rI.push(0.0);
        mensal.push(new Map());
        continue;
      }
      return ponteVazio(n, `mês sem base de cálculo em ${ponteMmAa(meses[t])}`);
    }
    let numInd = 0.0;
    const contribs = new Map();
    for (const [i, d, g] of entradas) {
      const ativo = ativos[i];
      if (ativo.passivo) {
        numInd += g;
        continue;
      }
      const [linha, nome] = ponteLinhaEIndice(ativo, escopo);
      if (!presentes.has(i)) presentes.set(i, [linha, nome]);
      let b;
      if (d !== 0) {
        const s = tabInd[nome];
        b = s ? s[t] : null;
        if (b === null || b === undefined) return ponteVazio(n, `índice ${nome} sem dado em ${ponteMmAa(meses[t])}`);
      } else {
        b = 0.0;
      }
      numInd += d * b;
      contribs.set(i, (contribs.get(i) || 0.0) + (g - d * b) / somaD);
    }
    rP.push(somaG / somaD);
    rI.push(numInd / somaD);
    mensal.push(contribs);
  }

  // 2) GRAP: fator do mês k = Π_{s<k}(1+R_p,s) · Π_{s>k}(1+R_ind,s)
  const sufixo = new Array(n + 1).fill(1.0);
  for (let k = n - 1; k >= 0; k--) sufixo[k] = sufixo[k + 1] * (1.0 + rI[k]);
  let ligado = new Map();
  for (const i of presentes.keys()) ligado.set(i, 0.0);
  let prefixo = 1.0;
  for (let k = 0; k < n; k++) {
    const fator = prefixo * sufixo[k + 1];
    for (const [i, c] of mensal[k]) ligado.set(i, ligado.get(i) + c * fator);
    prefixo *= 1.0 + rP[k];
  }
  const acumP = prefixo - 1.0;
  const acumI = sufixo[0] - 1.0;
  if (acumP < -1.0 || acumI < -1.0) {
    // valor implícito negativo (Dietz degenerado): sem retorno com sentido
    return ponteVazio(n, "retorno acumulado abaixo de -100% entre "
      + `${ponteMmAa(meses[iIni])} e ${ponteMmAa(meses[iFim])}`);
  }

  // 3) anualização com escala proporcional (guarda ii)
  const anualizado = n >= 12;
  let sua;
  let ind;
  if (anualizado) {
    sua = ponteAnualizar(acumP, n);
    ind = ponteAnualizar(acumI, n);
    const difAcum = acumP - acumI;
    const kEsc = Math.abs(difAcum) < PONTE_GUARDA_DIF ? 0.0 : (sua - ind) / difAcum;
    for (const [i, c] of ligado) ligado.set(i, Math.abs(difAcum) < PONTE_GUARDA_DIF ? 0.0 : c * kEsc);
  } else {
    sua = acumP;
    ind = acumI;
  }

  // 4) linhas e ativos (ordenados por contribuição, nunca por retorno)
  const porLinha = {};
  const indiceLinha = {};
  for (const [i, [linha, nome]] of presentes) {
    const t = ativos[i].t === PONTE_REBATE_TICKER ? PONTE_REBATE_ROTULO : ativos[i].t;
    (porLinha[linha] = porLinha[linha] || []).push({ t, contrib: ligado.get(i) });
    indiceLinha[linha] = nome;
  }
  const linhas = [];
  const ativosOut = {};
  for (const lid of PONTE_ORDEM_LINHAS[escopo]) {
    if (!(lid in porLinha)) continue;
    porLinha[lid].sort((a, b) => {
      if (a.contrib !== b.contrib) return a.contrib < b.contrib ? -1 : 1;
      if (a.t === b.t) return 0;
      return a.t < b.t ? -1 : 1;
    });
    let soma = 0;
    for (const a of porLinha[lid]) soma += a.contrib;
    linhas.push({ id: lid, indice: indiceLinha[lid], contrib: soma });
    ativosOut[lid] = porLinha[lid];
  }

  // 5) índices dos Detalhes (anualizados como a carteira; null se faltar mês)
  const detalhes = {};
  for (const nome of PONTE_INDICES_DETALHES[escopo]) {
    const s = tabInd[nome];
    const valores = s ? s.slice(iIni, iFim + 1) : [null];
    if (valores.some((x) => x === null || x === undefined)) {
      detalhes[nome] = null;
      continue;
    }
    let prod = 1.0;
    for (const x of valores) prod *= 1.0 + x;
    const acum = prod - 1.0;
    if (acum < -1.0) detalhes[nome] = null;
    else detalhes[nome] = anualizado ? ponteAnualizar(acum, n) : acum;
  }

  // 6) reais e XIRR
  const fl = bloco.fluxos[chave];
  const vIni = iIni > 0 ? fl.v[iIni - 1] : 0.0;
  let entrou = 0;
  let prov = 0;
  for (let t = iIni; t <= iFim; t++) { entrou += fl.entrou[t]; prov += fl.prov[t]; }
  const valorFim = fl.v[iFim];

  return {
    n_meses: n,
    anualizado,
    sua,
    ind,
    dif: sua - ind,
    linhas,
    ativos: ativosOut,
    entrou,
    ganho: (valorFim + prov) - (vIni + entrou),
    valor_fim: valorFim,
    xirr: ponteXirr(bloco, fl, iIni, iFim),
    indices: detalhes,
    indisponivel: null,
  };
}

// Janelas 12m, 3a, 5a e desde, todas terminando no último mês. Fixa com
// iIni < max(s, 1) (s = início do escopo) é "histórico curto".
function ponteJanelasFixas(bloco, escopo, moeda) {
  const meses = bloco.meses;
  const nTotal = meses.length - 1;
  const s = ponteInicioEscopo(bloco, escopo, moeda);
  const m0 = Math.max(s, 1);
  const out = {};
  for (const [chave, tamanho] of PONTE_JANELAS_FIXAS) {
    const iIni = nTotal - tamanho + 1;
    if (m0 > nTotal) out[chave] = ponteVazio(tamanho, "sem histórico no escopo");
    else if (iIni < m0) out[chave] = ponteVazio(tamanho, `histórico começa em ${ponteMmAa(meses[m0])}`);
    else out[chave] = ponteJanela(bloco, escopo, moeda, iIni, nTotal);
  }
  out.desde = m0 > nTotal ? ponteVazio(0, "sem histórico no escopo") : ponteJanela(bloco, escopo, moeda, m0, nTotal);
  return out;
}

// round(x, casas) do Python: arredonda o valor EXATO do double a `casas`
// decimais, empate para o par. toFixed também usa o valor exato, mas desempata
// para longe do zero; o empate exato existe (ex.: múltiplos ímpares de 1/1024
// a 9 casas). O double x = m/2^k tem expansão decimal de exatamente k casas,
// e um empate a `casas` decimais termina em 5 na casa casas+1: x·2^(casas+1)
// inteiro e x·2^casas não (escala por potência de 2 é exata). Aí os candidatos
// são piso e teto de x·10^casas (exato nesse caso) e vence o par. O resultado,
// n/10^casas, é a divisão corretamente arredondada — o mesmo double do Python.
function ponteRoundPy(x, casas = 0) {
  const p2 = 2 ** casas;
  if (Number.isInteger(x * p2 * 2) && !Number.isInteger(x * p2)) {
    const esc = 10 ** casas;
    const f = Math.floor(x * esc);
    const n = f % 2 === 0 ? f : f + 1;
    return casas === 0 ? n : n / esc;
  }
  return casas === 0 ? Math.round(x) : Number(x.toFixed(casas));
}

// Arredonda `valores` a `casas` com a soma exibida igual a `total`, em PONTOS
// percentuais (fração × 100; casas = 1 é o décimo de ponto). Maior resto:
// trunca em unidades de 10^-casas e as unidades que faltam (sobram) vão às
// posições de maior (menor) resto; empate fica com a primeira posição.
// Entrada vazia devolve [] qualquer que seja o total.
function arredondarFechando(valores, total, casas = 1) {
  if (!valores.length) return [];
  const escala = 10 ** casas;
  const unidades = valores.map((v) => ponteRoundPy(v * escala, 9));
  const pisos = unidades.map((u) => Math.floor(u));
  const restos = unidades.map((u, i) => ponteRoundPy(u - pisos[i], 9));
  const falta = ponteRoundPy(total * escala) - pisos.reduce((a, b) => a + b, 0);
  const idx = valores.map((_, i) => i);
  if (falta >= 0) {
    const ordem = idx.slice().sort((a, b) => (restos[b] - restos[a]) || (a - b));
    for (let j = 0; j < falta; j++) pisos[ordem[j % ordem.length]] += 1;
  } else {
    const ordemInv = idx.slice().sort((a, b) => (restos[a] - restos[b]) || (a - b));
    for (let j = 0; j < -falta; j++) pisos[ordemInv[j % ordemInv.length]] -= 1;
  }
  return pisos.map((p) => ponteRoundPy(p / escala, casas) + 0.0);
}

// ── 7a.BK.1: faixa de tolerância da #alocacao (spec 7a.BK §3.1) ────────────
// Funções puras de topo. Uma categoria está "na faixa" enquanto o peso atual
// fica a no máximo `tol` do alvo, com bordas inclusivas; `tol` é o maior entre
// um piso absoluto e uma fração do alvo. Nenhum valor real mora aqui.
const ALOC_TOL_MIN = 0.02; // piso absoluto da tolerância (2 pontos de peso)
const ALOC_TOL_REL = 0.10; // fração do alvo (10%)
// Folga de ponto flutuante: 0.05 − 0.02 dá 0.030000000000000002 em IEEE 754 e,
// sem ela, a borda inclusiva viraria "abaixo".
const ALOC_EPS = 1e-9;

function alocFaixa(alvo, atual) {
  const semDado = atual === null || atual === undefined || Number.isNaN(atual);
  const nulo = { tol: null, min: null, max: null };
  if (!(alvo > 0)) return { estado: "sem_alvo", ...nulo };
  if (semDado) return { estado: "sem_dado", ...nulo };
  const tol = Math.max(ALOC_TOL_MIN, ALOC_TOL_REL * alvo);
  const min = alvo - tol;
  const max = alvo + tol;
  let estado = "na_faixa";
  if (atual < min - ALOC_EPS) estado = "abaixo";
  else if (atual > max + ALOC_EPS) estado = "acima";
  return { estado, tol, min, max };
}

// Posições (em % da largura) da faixa e da etiqueta no trilho. A janela vai de
// alvo − R a alvo + R, com R = max(2,2 × tol, 0,05); a etiqueta fica presa
// entre 5% e 95% para não vazar a cápsula.
function alocTrilho(alvo, atual) {
  const f = alocFaixa(alvo, atual);
  if (f.estado !== "abaixo" && f.estado !== "na_faixa" && f.estado !== "acima") return null;
  const R = Math.max(2.2 * f.tol, 0.05);
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  return {
    naIni: ((R - f.tol) / (2 * R)) * 100,
    naFim: ((R + f.tol) / (2 * R)) * 100,
    etiqueta: clamp((atual - (alvo - R)) / (2 * R), 0.05, 0.95) * 100,
  };
}

// "A", "A e B", "A, B e C".
function alocListaNomes(nomes) {
  if (nomes.length <= 1) return nomes.join("");
  return nomes.slice(0, -1).join(", ") + " e " + nomes[nomes.length - 1];
}

// Frase-resumo: uma oração por estado não vazio (pedindo aporte, depois acima).
// `cats` já vem ordenada; sem alvo ou sem dado fica fora, e sem nenhuma
// categoria classificável a frase é "" (a tela esconde o elemento).
function alocFraseResumo(cats) {
  const abaixo = [];
  const acima = [];
  let naFaixa = 0;
  for (const c of cats || []) {
    const e = alocFaixa(c.peso_alvo, c.peso_atual).estado;
    if (e === "abaixo") abaixo.push(c.nome);
    else if (e === "acima") acima.push(c.nome);
    else if (e === "na_faixa") naFaixa += 1;
  }
  if (!abaixo.length && !acima.length) {
    return naFaixa ? "Todas as categorias estão na faixa." : "";
  }
  const verbo = (n, sing, plur) => (n.length === 1 ? sing : plur);
  const partes = [];
  if (abaixo.length) {
    partes.push(`${alocListaNomes(abaixo)} ${verbo(abaixo, "está", "estão")} pedindo aporte.`);
  }
  if (acima.length) {
    partes.push(`${alocListaNomes(acima)} ${verbo(acima, "está", "estão")} acima da faixa.`);
  }
  if ((!abaixo.length || !acima.length) && naFaixa) partes.push("O resto está na faixa.");
  return partes.join(" ");
}

// "R$ 450", "R$ 4,2 mil", "R$ 38 mil" (valor absoluto). Arredonda na casa da
// faixa ANTES de escolher a faixa: 9960 vira "R$ 10 mil", nunca "R$ 10,0 mil".
function alocRsCurto(v) {
  const abs = Math.abs(v);
  const fmt = (n, casas) =>
    new Intl.NumberFormat("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(n);
  if (Math.round(abs) < 1000) return "R$ " + fmt(Math.round(abs), 0);
  const mil1 = Math.round(abs / 100) / 10;
  if (mil1 < 10) return "R$ " + fmt(mil1, 1) + " mil";
  return "R$ " + fmt(Math.round(abs / 1000), 0) + " mil";
}

// Acordeão da categoria: ativos agrupados por estado (spec 7a.BK §3.4).
// - quarentena / fora_do_alvo → semAlvo (quarentena vence se os dois valem);
// - valor EW da cesta = soma dos elegíveis (sem quarentena e sem fora_do_alvo),
//   o mesmo universo do peso_intra_atual no payload;
// - cesta com UM elegível herda a cesta: alocFaixa(peso_bucket,
//   peso_atual_bucket) e R$ = |Δ| × valor da categoria sem o off-policy (o
//   denominador do peso_atual_bucket em construir_bloco_politica, que inclui a
//   quarentena; cat.valor_brl inclui o off-policy e daria outro número);
// - demais: alocFaixa(peso_intra, peso_intra_atual), R$ = |Δ| × valor EW.
// `cestas` só com 2+ cestas; com uma, `cesta` é null nas linhas.
const ALOC_NOME_CESTA = { passive: "Passivo", picks: "Picks" };

function alocAgruparAtivos(cat) {
  const buckets = (cat && cat.buckets) || [];
  const multi = buckets.length > 1;
  const valor = (a) => (a && typeof a.valor_brl === "number" ? a.valor_brl : 0);
  const elegivel = (a) => !a.quarentena && !a.fora_do_alvo;
  let valorPolitica = 0;
  for (const b of buckets) {
    for (const a of b.ativos || []) if (!a.fora_do_alvo) valorPolitica += valor(a);
  }
  const out = { cestas: [], pedindo: [], acima: [], naFaixa: [], semAlvo: [] };
  for (const b of buckets) {
    const nome = ALOC_NOME_CESTA[b.tipo] || b.tipo || "";
    // Cesta única: é a categoria inteira, então está sempre na faixa (letra do
    // §3.4). Sem isso, uma categoria sem posição (peso_atual_bucket 0) poria o
    // ativo único em "pedindo aporte" com "faltam R$ 0".
    const fCesta = multi ? alocFaixa(b.peso_bucket, b.peso_atual_bucket) : { estado: "na_faixa" };
    if (multi) {
      out.cestas.push({ nome, estado: fCesta.estado, atual: b.peso_atual_bucket, alvo: b.peso_bucket });
    }
    const ativos = b.ativos || [];
    const eleg = ativos.filter(elegivel);
    const valorEW = eleg.reduce((s, a) => s + valor(a), 0);
    for (const a of ativos) {
      if (!elegivel(a)) {
        out.semAlvo.push({ ticker: a.ticker, motivo: a.quarentena ? "quarentena" : "a zerar" });
        continue;
      }
      let estado;
      let rs;
      if (eleg.length === 1) {
        estado = fCesta.estado;
        rs = Math.abs((b.peso_bucket || 0) - (b.peso_atual_bucket || 0)) * valorPolitica;
      } else {
        estado = alocFaixa(a.peso_intra, a.peso_intra_atual).estado;
        rs = Math.abs((a.peso_intra || 0) - (a.peso_intra_atual || 0)) * valorEW;
      }
      if (!Number.isFinite(rs)) rs = 0;
      const linha = { ticker: a.ticker, cesta: multi ? nome : null, rs };
      if (estado === "abaixo") out.pedindo.push(linha);
      else if (estado === "acima") out.acima.push(linha);
      // na_faixa — e também sem_alvo/sem_dado de um ativo elegível, que o
      // payload não produz: fica como etiqueta sem número, nunca some.
      else out.naFaixa.push(a.ticker);
    }
  }
  const porRs = (x, y) => (y.rs - x.rs) || (x.ticker < y.ticker ? -1 : x.ticker > y.ticker ? 1 : 0);
  out.pedindo.sort(porRs);
  out.acima.sort(porRs);
  return out;
}

// ── 7a.BD.2: apresentação da #rentabilidade como ponte ─────────────────────
// Funções puras de topo que transformam a saída de `ponteJanela` (frações) no
// que a tela mostra. Nenhum número é recalculado aqui: todo valor vem de
// `ponteJanela`/`ponteJanelasFixas`, e a exibição a 1 casa passa por
// `arredondarFechando` (maior resto), para a soma exibida fechar — as linhas
// da ponte somam `sua − ind` exibidos, e os ativos de "quem pesou" somam a
// linha exibida. Copy: brief de design da 7a.BD.2 (§2); os itens marcados ali
// "conferência" vão ao Dr. Arthur no critério 3 da spec.
const RENT2_MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const RENT2_ROTULO_LINHA = {
  acoes_br: "Ações BR", fiis: "FIIs", eua: "EUA",
  picks: "Picks", fora: "Fora da política atual",
};
// Concordância da frase de "quem pesou" (somaram/somou, andaram/andou).
const RENT2_LINHA_PLURAL = { acoes_br: true, fiis: true, eua: true, picks: true, fora: false };
const RENT2_COR_LINHA = {
  acoes_br: "var(--cat-acoes-br)", fiis: "var(--cat-fii)", eua: "var(--cat-eua)",
  picks: "var(--cat-eua)", fora: "var(--cat-eua)",
};
// Nome do índice na tela (nunca o id interno do payload).
const RENT2_NOME_INDICE = {
  CDI: "CDI", IBOV: "Ibovespa", IFIX: "IFIX", SP500TR: "S&P 500 com dividendos",
};
const RENT2_ALVO_VEREDITO = {
  Total: "sua carteira de índices",
  Brasil: "sua carteira brasileira de índices",
  EUA: "sua carteira americana de índices",
};
// [chave, rótulo do botão, prefixo da frase]; "desde" depende do início do
// escopo (rent2RotuloDesde).
const RENT2_JANELAS = [
  ["12m", "12 meses", "Nos últimos 12 meses"],
  ["3a", "3 anos", "Nos últimos 3 anos"],
  ["5a", "5 anos", "Nos últimos 5 anos"],
  ["desde", null, null],
];
// Tamanho das fixas em meses: a mesma tabela da gêmea (PONTE_JANELAS_FIXAS).
const RENT2_TAMANHO_FIXA = Object.fromEntries(PONTE_JANELAS_FIXAS);
const RENT2_NEUTRO = 0.05; // |valor exibido| abaixo disto é "±0,0" (spec §6)
const RENT2_SETTLE_MS = 150; // fim do arrasto: sem evento de zoom por este tempo

// "2026-09" → "set/26", o formato da TELA. Não é duplicata de ponteMmAa
// ("09/26"): aquele reproduz o texto da referência Python nos `indisponivel`
// (o teste cruzado compara a string exata), e rent2MmAaParaMmm converte um no
// outro na hora de mostrar.
function rent2MmmAa(ym) {
  const mm = Number(String(ym).slice(5, 7));
  if (!(mm >= 1 && mm <= 12)) return String(ym);
  return `${RENT2_MESES[mm - 1]}/${String(ym).slice(2, 4)}`;
}

// "mm/aa" do backend → "mmm/aa" da tela.
function rent2MmAaParaMmm(mmaa) {
  const m = /^(\d{2})\/(\d{2})$/.exec(mmaa);
  if (!m) return mmaa;
  const mm = Number(m[1]);
  return mm >= 1 && mm <= 12 ? `${RENT2_MESES[mm - 1]}/${m[2]}` : mmaa;
}

// Texto do `indisponivel` do backend na voz da tela (brief §2.10).
function rent2MotivoTexto(motivo) {
  if (!motivo) return "";
  let m;
  if ((m = /^histórico começa em (\d{2}\/\d{2})$/.exec(motivo))) return `Histórico começa em ${rent2MmAaParaMmm(m[1])}.`;
  if (motivo === "sem histórico no escopo") return "Sem histórico neste escopo.";
  if ((m = /^cotação ausente em (\d{2}\/\d{2})$/.exec(motivo))) return `Falta a cotação de um ativo em ${rent2MmAaParaMmm(m[1])}.`;
  if ((m = /^mês sem base de cálculo em (\d{2}\/\d{2})$/.exec(motivo))) return `Sem valor na carteira para calcular ${rent2MmAaParaMmm(m[1])}.`;
  if ((m = /^índice (\S+) sem dado em (\d{2}\/\d{2})$/.exec(motivo))) {
    const nome = RENT2_NOME_INDICE[m[1]];
    return nome ? `O ${nome} não tem dado em ${rent2MmAaParaMmm(m[2])}.` : "Janela indisponível.";
  }
  if ((m = /^retorno acumulado abaixo de -100% entre (\d{2}\/\d{2}) e (\d{2}\/\d{2})$/.exec(motivo))) {
    return `O cálculo não fecha entre ${rent2MmAaParaMmm(m[1])} e ${rent2MmAaParaMmm(m[2])}.`;
  }
  return "Janela indisponível.";
}

// Valor absoluto a 1 casa, vírgula decimal ("1,0").
function rent2Abs1(v) {
  return Math.abs(v).toFixed(1).replace(".", ",");
}

// Percentual já em pontos (exibido): "19,7%" / "−3,2%".
function rent2PctPts(p) {
  const r = ponteRoundPy(p, 1);
  return (r < 0 ? "−" : "") + rent2Abs1(r) + "%";
}

// Diferença em pontos (exibida): seta + sinal, nunca cor sozinha.
function rent2Pontos(p) {
  const r = ponteRoundPy(p, 1);
  if (Math.abs(r) < RENT2_NEUTRO) return { texto: "±0,0", sinal: "neutro", valor: 0 };
  if (r > 0) return { texto: `▲ +${rent2Abs1(r)}`, sinal: "pos", valor: r };
  return { texto: `▼ −${rent2Abs1(r)}`, sinal: "neg", valor: r };
}

function rent2PontoPontos(p) {
  return Math.abs(p) < 2 ? "ponto" : "pontos";
}

// Dinheiro inteiro, sem abreviar (Confiança nos números): "R$ 60.000".
function rent2Dinheiro(v, moeda) {
  const inteiro = Math.round(v);
  const s = new Intl.NumberFormat("pt-BR", {
    style: "currency", currency: moeda === "USD" ? "USD" : "BRL",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(Math.abs(inteiro));
  return inteiro < 0 ? `− ${s}` : s;
}

// "Desde 2019" quando o escopo nasce no começo do histórico; senão a data da
// âncora (brief §2.3, conferência).
function rent2RotuloDesde(bloco, m0) {
  const ancora = bloco.meses[m0 - 1];
  return ancora <= "2019-01" ? "Desde 2019" : `Desde ${rent2MmmAa(ancora)}`;
}

// [iIni, iFim] de uma janela fixa (convenção de ponteJanelasFixas).
function rent2IndicesFixa(chave, nTotal, m0) {
  if (chave === "desde") return [m0, nTotal];
  return [nTotal - RENT2_TAMANHO_FIXA[chave] + 1, nTotal];
}

// Janela fixa que coincide com (iIni, iFim), ou null (período livre).
function rent2ChaveDe(iIni, iFim, nTotal, m0) {
  if (iFim !== nTotal) return null;
  for (const [chave] of RENT2_JANELAS) {
    const [a] = rent2IndicesFixa(chave, nTotal, m0);
    if (a >= m0 && a === iIni) return chave;
  }
  return null;
}

// Geometria do waterfall, em frações do trilho. Spec §8: os totais (início
// e fim) são barra cheia neutra, os dois do mesmo tamanho; o valor escrito ao
// lado é que diz o retorno. Um eixo truncado nos totais fazia 18,7% contra
// 19,7% parecer muitas vezes mais. Só os degraus flutuantes ficam num eixo
// comum entre si (domínio dos acumulados, com 12% de folga).
function rent2Geometria(ind, linhas, sua) {
  const acum = [ind];
  for (const l of linhas) acum.push(acum[acum.length - 1] + l);
  const vals = acum.concat([sua]);
  const lo0 = Math.min(...vals);
  const hi0 = Math.max(...vals);
  const span = (hi0 - lo0) || Math.max(Math.abs(hi0), 1) * 0.1;
  const lo = lo0 - span * 0.12;
  const hi = hi0 + span * 0.12;
  const cheia = { L: 0, W: 1 };
  const x = (v) => (v - lo) / (hi - lo);
  const barra = (a, b) => {
    const xa = x(a);
    const xb = x(b);
    return { L: Math.min(xa, xb), W: Math.max(Math.abs(xb - xa), 0.012) };
  };
  return {
    ind: cheia,
    sua: cheia,
    linhas: linhas.map((_, i) => ({ ...barra(acum[i], acum[i + 1]), guia: x(acum[i]) })),
    acum,
  };
}

function rent2EstiloBarra(b) {
  return `transform: translateX(${(b.L * 100).toFixed(3)}%) scaleX(${b.W.toFixed(5)})`;
}

// "Quem pesou" da linha `lid` (spec 7a.BH §3): TODOS os ativos da linha, em
// até três grupos — tiraram, somaram e "junto" (|valor exibido| < RENT2_NEUTRO)
// —, cada um com contagem e subtotal (o "junto" não tem). O grupo sai do valor
// EXIBIDO (pós `arredondarFechando`), nunca do bruto, então os subtotais fecham
// com a linha exibida. Ordem dos grupos: o do sinal da linha primeiro; linha
// neutra, maior |subtotal| (empate: tiraram); "junto" sempre por último; grupo
// vazio não entra. Dentro do grupo: |valor| decrescente, empate pelo ticker.
function rent2Pesou(r, lid, valorLinha, sufixo) {
  const rotulo = RENT2_ROTULO_LINHA[lid];
  const plural = RENT2_LINHA_PLURAL[lid];
  const linha = r.linhas.find((l) => l.id === lid);
  const indice = RENT2_NOME_INDICE[linha.indice] || linha.indice;
  const neutra = Math.abs(valorLinha) < RENT2_NEUTRO;
  const ativos = r.ativos[lid] || [];
  const exib = arredondarFechando(ativos.map((a) => a.contrib * 100), valorLinha);
  const lista = ativos.map((a, i) => ({ t: a.t, v: exib[i] }));
  const porTamanho = (a, b) => (Math.abs(b.v) - Math.abs(a.v)) || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0);
  const porTicker = (a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0);
  const fmt = (a) => ({ t: a.t, ...rent2Pontos(a.v) });
  const qtdAtivos = (n) => `${n} ${n === 1 ? "ativo" : "ativos"}`;
  const monta = (id, itens, titulos) => {
    if (!itens.length) return null;
    const soma = ponteRoundPy(itens.reduce((s, a) => s + a.v, 0), 1);
    return {
      id,
      titulo: itens.length === 1 ? titulos[1] : titulos[0],
      contagem: qtdAtivos(itens.length),
      sub: id === "junto" ? null : rent2Pontos(soma),
      itens: itens.map(fmt),
    };
  };
  const junto = lista.filter((a) => Math.abs(a.v) < RENT2_NEUTRO).sort(porTicker);
  const tiraram = lista.filter((a) => a.v <= -RENT2_NEUTRO).sort(porTamanho);
  const somaram = lista.filter((a) => a.v >= RENT2_NEUTRO).sort(porTamanho);
  const gT = monta("tiraram", tiraram, ["Tiraram pontos", "Tirou pontos"]);
  const gS = monta("somaram", somaram, ["Somaram pontos", "Somou pontos"]);
  const gJ = monta("junto", junto, ["Andaram junto", "Andou junto"]);
  // Spec 7a.BH §3.1: "maior |subtotal| primeiro; empate, tiraram". Na linha neutra
  // o valorLinha é 0 e arredondarFechando fecha a soma exibida em 0, então
  // |somaram| = |tiraram| sempre: a regra se reduz a "tiraram primeiro".
  const sinais = neutra ? [gT, gS] : valorLinha > 0 ? [gS, gT] : [gT, gS];
  const grupos = sinais.concat([gJ]).filter(Boolean);
  if (neutra) {
    return {
      neutra: true,
      linha: rotulo,
      verbo: "",
      qtd: "",
      resto: `${plural ? "andaram" : "andou"} junto com o ${indice} nesta janela.`,
      grupos,
    };
  }
  const positivo = valorLinha > 0;
  return {
    neutra: false,
    linha: rotulo,
    verbo: positivo ? (plural ? "somaram" : "somou") : (plural ? "tiraram" : "tirou"),
    qtd: `${rent2Abs1(valorLinha)} ${rent2PontoPontos(valorLinha)}`,
    resto: `${sufixo} contra o ${indice}.`,
    grupos,
  };
}

// Texto do aria-live de "quem pesou": a frase da linha e, por grupo, só
// cabeçalho, contagem e subtotal — nenhum ticker (spec 7a.BH §3).
function rent2AnuncioPesou(p) {
  if (!p) return "";
  const base = p.neutra ? `${p.linha} ${p.resto}` : `${p.linha} ${p.verbo} ${p.qtd} ${p.resto}`;
  return base + p.grupos.map((g) => (g.sub
    ? ` ${g.titulo}, ${g.contagem}, ${g.sub.valor > 0 ? "mais" : "menos"} ${rent2Abs1(g.sub.valor)}.`
    : ` ${g.titulo}, ${g.contagem}.`)).join("");
}

// Vista completa da tela para a janela iIni..iFim (inclusivos). `r` é a saída
// de ponteJanela; `ctx` = {bloco, escopo, moeda, chave, m0, linhaUsuario}.
function rent2Vista(r, iIni, iFim, ctx) {
  const { bloco, escopo, moeda, chave, m0, linhaUsuario } = ctx;
  const ancora = rent2MmmAa(bloco.meses[iIni - 1]);
  const fim = rent2MmmAa(bloco.meses[iFim]);
  const n = iFim - iIni + 1;
  let rot;
  let subtitulo;
  if (chave) {
    rot = chave === "desde" ? rent2RotuloDesde(bloco, m0) : RENT2_JANELAS.find((j) => j[0] === chave)[2];
    subtitulo = `Cresceu desde ${ancora} · até ${fim}`;
  } else {
    rot = `De ${ancora} a ${fim}`;
    subtitulo = `Período livre · de ${ancora} a ${fim} (${n === 1 ? "1 mês" : `${n} meses`})`;
  }
  const ariaGrafico = `Sua carteira e a mesma carteira só com índices, ${subtitulo}`;
  if (r.indisponivel) {
    return { indisponivel: rent2MotivoTexto(r.indisponivel), subtitulo, ariaGrafico };
  }
  const sufixo = r.anualizado ? "ao ano" : "no período";
  // Exibição a 1 casa: os dois totais pelo arredondamento simples e só as
  // LINHAS absorvem o ajuste (spec §4.4, maior resto), para fecharem em
  // `sua − ind` exibidos. Com os totais no mesmo rateio, "Só com índices"
  // ganhava empates de resto como 1ª posição e saía 0,1 fora do valor.
  const indD = ponteRoundPy(r.ind * 100, 1);
  const suaD = ponteRoundPy(r.sua * 100, 1);
  const linhasD = arredondarFechando(r.linhas.map((l) => l.contrib * 100), ponteRoundPy(suaD - indD, 1));
  const dif = rent2Pontos(suaD - indD);
  const alvo = RENT2_ALVO_VEREDITO[escopo];
  let frase;
  if (dif.sinal === "pos") frase = `${rot}, você ganhou da ${alvo}.`;
  else if (dif.sinal === "neg") frase = `${rot}, você ficou atrás da ${alvo}.`;
  // Empate verbatim do rascunho aprovado: "empatou com sua carteira…", sem artigo.
  else frase = `${rot}, você empatou com ${alvo}.`;

  const geo = rent2Geometria(indD, linhasD, suaD);
  const linhas = r.linhas.map((l, i) => {
    const v = rent2Pontos(linhasD[i]);
    const rotulo = RENT2_ROTULO_LINHA[l.id];
    const indice = RENT2_NOME_INDICE[l.indice] || l.indice;
    const unidade = rent2PontoPontos(v.valor);
    const falado = v.sinal === "neutro" ? `0,0 ${unidade}`
      : `${v.sinal === "pos" ? "mais" : "menos"} ${rent2Abs1(v.valor)} ${unidade}`;
    return {
      id: l.id,
      rotulo,
      sub: `vs ${indice}`,
      estiloPonto: `background: ${RENT2_COR_LINHA[l.id]}`,
      ...v,
      estiloBarra: rent2EstiloBarra(geo.linhas[i]),
      // Guia por transform (nada de animar `left`): a caixa ocupa o trilho
      // inteiro e a borda esquerda dela é a linha tracejada.
      estiloGuia: `transform: translateX(${(geo.linhas[i].guia * 100).toFixed(3)}%)`,
      ariaLabel: `${rotulo} contra o ${indice}, ${falado} ${sufixo}. Mostrar quem pesou`,
      tabelaLinha: `${rotulo}, contra o ${indice}:`,
      tabelaValor: falado,
      tabelaAcum: rent2PctPts(geo.acum[i + 1]),
    };
  });
  // Linha selecionada: a do usuário, se existir nesta janela; senão a de menor
  // contribuição exibida (a que mais tirou; empate fica com a primeira).
  let sel = linhas.find((l) => l.id === linhaUsuario) || null;
  if (!sel && linhas.length) sel = linhas.reduce((m, l) => (l.valor < m.valor ? l : m), linhas[0]);

  const ganhoR = Math.round(r.ganho);
  let ganho;
  if (ganhoR > 0) ganho = `▲ + ${rent2Dinheiro(ganhoR, moeda)}`;
  else if (ganhoR < 0) ganho = `▼ ${rent2Dinheiro(ganhoR, moeda)}`;
  else ganho = rent2Dinheiro(0, moeda);

  return {
    indisponivel: null,
    subtitulo,
    ariaGrafico,
    sufixo,
    frase,
    numero: dif.texto,
    sinal: dif.sinal,
    unidade: `${rent2PontoPontos(dif.valor)} ${sufixo}`,
    sua: rent2PctPts(suaD),
    ind: rent2PctPts(indD),
    suaValor: suaD,
    indValor: indD,
    ponte: {
      unidade: `Em pontos ${sufixo}. Toque numa linha.`,
      caption: `Ponte entre a carteira só com índices e a sua carteira, em pontos ${sufixo}`,
      estiloInd: rent2EstiloBarra(geo.ind),
      estiloSua: rent2EstiloBarra(geo.sua),
      linhas,
    },
    linhaSel: sel ? sel.id : null,
    pesou: sel ? rent2Pesou(r, sel.id, sel.valor, sufixo) : null,
    reais: {
      titulo: moeda === "USD" ? "Em dólares, na janela" : "Em reais, na janela",
      entrou: rent2Dinheiro(r.entrou, moeda),
      ganho,
      ganhoSinal: ganhoR > 0 ? "pos" : ganhoR < 0 ? "neg" : "neutro",
      rotuloFim: `Em ${fim}`,
      valorFim: rent2Dinheiro(r.valor_fim, moeda),
    },
    detalhes: {
      indices: PONTE_INDICES_DETALHES[escopo].map((id) => ({
        id,
        nome: RENT2_NOME_INDICE[id],
        texto: r.indices[id] === null || r.indices[id] === undefined ? "—" : rent2PctPts(r.indices[id] * 100),
      })),
      xirr: r.xirr === null || r.xirr === undefined ? "—" : rent2PctPts(r.xirr * 100),
    },
  };
}

// Curvas do gráfico: as duas séries em Π(1+r) − 1 a partir da âncora (fim do
// mês iIni − 1), com os retornos mensais que `ponteJanela` dá para cada mês
// (n = 1, não anualizado). Mês sem retorno (buraco, índice nulo) corta as duas
// curvas dali em diante: valor sem fonte não é desenhado.
function rent2Curvas(rP, rI, off, nTotal, iIni, iFim) {
  const tam = nTotal - off + 1;
  const cart = new Array(tam).fill(null);
  const ind = new Array(tam).fill(null);
  let gP = 1;
  let gI = 1;
  cart[iIni - 1 - off] = 0;
  ind[iIni - 1 - off] = 0;
  for (let t = iIni; t <= iFim; t++) {
    if (rP[t] === null || rI[t] === null || rP[t] === undefined || rI[t] === undefined) break;
    gP *= 1 + rP[t];
    gI *= 1 + rI[t];
    cart[t - off] = gP - 1;
    ind[t - off] = gI - 1;
  }
  return [cart, ind];
}

// 7a.BG.2: valor de uma curva (fração) como texto do gráfico, "19,7%". O
// mesmo formatter do tooltip, do markPoint e do aria (nada desenhado num
// lugar e calculado noutro).
function rent2FmtCurva(v) {
  return v === null || v === undefined ? "—" : rent2PctPts(v * 100);
}

// 7a.BG.2: os textos do fim das duas curvas (último ponto DESENHADO de cada
// uma; "—" sem ponto). Pura e sem `dc` de propósito: `_rent2Aplicar` a usa
// para o aria e roda antes do guard de echarts/drarthurChart do
// renderRentabilidade, e o placeholder de degradação tem de sobreviver.
function rent2TextosFim(cart, ind, fmtPct) {
  const iC = ultimoIndiceValido(cart);
  const iI = ultimoIndiceValido(ind);
  return {
    textoCart: iC === -1 ? "—" : fmtPct(cart[iC]),
    textoInd: iI === -1 ? "—" : fmtPct(ind[iI]),
  };
}

// 7a.BG.2: os dois marcadores de fim de curva. Regra SEM limiar: o maior dos
// dois valores finais leva o rótulo em cima e o menor embaixo, sempre (não só
// quando estão próximos) — uma regra sem limiar não tem fronteira que possa
// falhar, e nenhum rótulo se esconde. Empate: a carteira em cima. As duas
// curvas são cortadas no mesmo t (rent2Curvas), então o último índice da
// carteira serve às duas. A carteira segue protagonista (--ink, 700, 8 px);
// os índices ficam subordinados (--gray, 600, 6 px), no mesmo círculo vazado.
function rent2MarcadoresFim(cart, ind, fmtPct, dc) {
  const idx = ultimoIndiceValido(cart);
  const vC = idx === -1 ? null : cart[idx];
  const vI = idx === -1 ? null : ind[idx];
  const cartEmCima = vC === null || vI === null || vC >= vI;
  const marcas = {
    cart: criarMarkPointUltimo(cart, fmtPct, dc.tokens.ink, dc.fontFamily,
      { posicao: cartEmCima ? "top" : "bottom" }),
    ind: criarMarkPointUltimo(ind, fmtPct, dc.tokens.gray, dc.fontFamily,
      { posicao: cartEmCima ? "bottom" : "top", peso: 600, tamanho: 6 }),
  };
  // Contorno na cor da superfície do card: o rótulo `bottom` fica no caminho
  // da própria curva quando ela sobe íngreme até o fim (conferência visual,
  // janela curta), e a linha cortava os dígitos. É legibilidade, não enfeite.
  for (const m of [marcas.cart, marcas.ind]) {
    if (m.label) Object.assign(m.label, { textBorderColor: dc.tokens.surface, textBorderWidth: 3 });
  }
  return marcas;
}

// 7a.BG.2: folga do eixo y embaixo, só quando o rótulo `bottom` precisa. O
// rótulo de baixo é o do MENOR valor final; quando ele está perto do mínimo
// das curvas (a janela termina em queda), caía abaixo do chão do grid, na
// faixa dos mmm/aa do eixo x (medido: 16 px abaixo). A folga garante que o
// valor final de baixo fique a ≥ RENT2_FOLGA_ROTULO da altura do eixo acima
// do piso: com o gráfico de ~150 px de área útil, ~33 px, contra os ~23 px
// que o rótulo ocupa (raio 4 + distância 8 + texto 11). Fora desse caso, a
// folga é 0 e o eixo fica como sempre foi. Devolve o `boundaryGap` do yAxis,
// em fração do intervalo dos dados. O ECharts arredonda o extent depois: o
// piso arredondado só aumenta a folga; o teto arredondado a encolhe um pouco
// em px, daí a margem entre os ~23 px e os ~33 px.
const RENT2_FOLGA_ROTULO = 0.22;
function rent2FolgaEixoY(cart, ind) {
  const idx = ultimoIndiceValido(cart);
  const vals = cart.concat(ind).filter((v) => v !== null && v !== undefined);
  if (idx === -1 || ind[idx] === null || ind[idx] === undefined || !vals.length) return ["0%", 0];
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo;
  if (!(span > 0)) return ["0%", 0];
  const e = (Math.min(cart[idx], ind[idx]) - lo) / span; // altura do valor final de baixo, 0..1
  const f = RENT2_FOLGA_ROTULO;
  const g = Math.max(0, (f - e) / (1 - f));
  return [`${(g * 100).toFixed(1)}%`, 0];
}

// "2.30" ≥ [2, 30], comparando número a número (nunca como texto: "2.4" > "2.30").
function rent2VersaoAoMenos(versao, minimo) {
  const partes = String(versao || "").split(".").map((x) => Number(x));
  for (let i = 0; i < minimo.length; i++) {
    const v = Number.isFinite(partes[i]) ? partes[i] : 0;
    if (v !== minimo[i]) return v > minimo[i];
  }
  return true;
}

// Estado da tela. Função de topo (não método) porque a declaração do x-data é
// um literal sem `this` — o mesmo default serve à declaração e ao reset do
// lock (`_descartarGraficos`), sem dois literais para derivar.
function rent2Vazio() {
  return {
    semBloco: false, // false | "versao" (payload sem a chave) | "nulo" (ponte null) | "erro" (falha ao montar)
    chave: "12m",
    iIni: null,
    iFim: null,
    motivo: "",
    linhaUsuario: null,
    arrastando: false,
    janelas: [],
    vista: null,
    anuncio: "",
    anuncioPesou: "",
  };
}

// 7a.S.3 Task 1: "símbolo só no último ponto" — a série principal (linha)
// não desenha marcador em cada ponto ("colar de contas"); só o ponto mais
// recente ganha um marcador discreto (círculo vazado, não celebratório —
// DESIGN.md anti-pattern #20) + rótulo do valor acima. Usa markPoint em vez
// de per-point symbol callback: mais simples de recomputar a cada zoom
// (L.1 já reancora a série; aqui só recalculamos coord+label do markPoint).
// Benchmarks não recebem markPoint, com uma exceção nomeada (7a.BG.2): a
// curva "Mesma carteira, só com índices" da #rentabilidade ganha o marcador
// subordinado (rent2MarcadoresFim). "Aporte acum." do #patrimonio, nunca.
function ultimoIndiceValido(dataArr) {
  if (!Array.isArray(dataArr)) return -1;
  for (let i = dataArr.length - 1; i >= 0; i--) {
    if (dataArr[i] !== null && dataArr[i] !== undefined) return i;
  }
  return -1;
}

// 7a.S.3 Task 2: "eixo Y ancorado nos dados" — a curva de equity (patrimônio)
// NÃO é zero-anchored (min:0 esconderia a variação real, que nesse domínio
// nunca é perto de zero). Folga honesta: ~12% abaixo / ~14% acima do range
// combinado de todas as séries visíveis (mesma fórmula do mockup Monument:
// lo = min − span*0.12, hi = max + span*0.14). Barras (proventos) NÃO usam
// isso — ficam zero-anchored (padrão ECharts, sem min explícito).
function calcularEixoYAncorado(...arrays) {
  const vals = [].concat(...arrays).filter((v) => v !== null && v !== undefined && isFinite(v));
  if (vals.length === 0) return { min: undefined, max: undefined, cruzaZero: false };
  const menor = Math.min(...vals);
  const maior = Math.max(...vals);
  const span = (maior - menor) || Math.max(Math.abs(maior), 1) * 0.1;
  const min = menor - span * 0.12;
  const max = maior + span * 0.14;
  return { min, max, cruzaZero: min < 0 && max > 0 };
}

// 7a.S.3 Task 3: "barra parcial hachurada" — a última barra de cada série de
// proventos (ano corrente em Anual, mês corrente em Mensal) está por
// definição incompleta (ainda acumulando). Hachura + opacity reduzida
// sinalizam "honestidade de dado" sem esconder o valor parcial. Padrão
// diagonal espelha o SVG do mockup Monument (rotation 45°, traço fino).
const DECAL_PARCIAL = {
  symbol: "rect",
  dashArrayX: [1, 0],
  dashArrayY: [3, 4],
  rotation: Math.PI / 4,
  color: "rgba(255,255,255,0.55)",
};

// 7a.S.3 Task 4: "scrubber-instrumento" — restyle do dataZoom nativo do
// ECharts (patrimônio + rentabilidade). Trilho fino cor da marca, alças
// discretas (círculo simples em vez do ícone-ampulheta default), sem o
// chrome pesado default (dataBackground/selectedDataBackground — a
// silhueta em miniatura dos dados — e showDetail — bolha com valor bruto
// durante o drag). NÃO porta o overlay HTML custom do mockup (.zoomtrack
// com ticks de ano + bolha de mês na alça) — exigiria reescrever o listener
// de zoom e arriscaria quebrar o reancoramento L.1; fica como follow-up
// (ver relato da sub-fase). minValueSpan:1 é só a guarda mínima (não deixa
// zoom colapsar pra 1 ponto) — valor conservador pra não colidir com a
// fixture de teste sintética (6 pontos esparsos); dados reais mensais têm
// dezenas/centenas de pontos onde essa guarda nunca bina.
function criarDataZoomInstrumento(dc) {
  const hidden = { lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 } };
  return [
    { type: "inside", start: 0, end: 100, minValueSpan: 1 },
    {
      type: "slider",
      height: 8,
      bottom: 6,
      start: 0,
      end: 100,
      minValueSpan: 1,
      backgroundColor: COLORS.g700a06(),
      fillerColor: COLORS.g700a12(),
      borderColor: "transparent",
      brushSelect: false,
      showDetail: false,
      dataBackground: hidden,
      selectedDataBackground: hidden,
      handleIcon: "circle",
      handleSize: 14,
      handleStyle: { color: dc.tokens.g700, borderColor: "#fff", borderWidth: 1, opacity: 0.95 },
      moveHandleSize: 4,
      moveHandleStyle: { color: dc.tokens.g700, opacity: 0.35 },
      textStyle: { color: dc.tokens.gray, fontSize: 10 },
    },
  ];
}

// `opcoes` (7a.BG.2): `posicao` ("top" default), `peso` (700) e `tamanho` (8);
// sem elas, o comportamento de antes (os chamadores do #patrimonio e da
// carteira não mudam).
function criarMarkPointUltimo(dataArr, formatFn, cor, fontFamily, opcoes = {}) {
  const { posicao = "top", peso = 700, tamanho = 8 } = opcoes;
  const idx = ultimoIndiceValido(dataArr);
  if (idx === -1) return { data: [] };
  const valor = dataArr[idx];
  return {
    symbol: "circle",
    symbolSize: tamanho,
    itemStyle: { color: "#fff", borderColor: cor, borderWidth: 2.5 },
    label: {
      show: true,
      position: posicao,
      distance: 8,
      color: cor,
      fontWeight: peso,
      fontSize: 11,
      fontFamily: fontFamily,
      formatter: () => formatFn(valor),
    },
    animation: false,
    data: [{ coord: [idx, valor] }],
  };
}

// 7a.AY: marcos de idade do gráfico de faixas (só os ainda no futuro entram).
const PROJ_MARCOS = Object.freeze([45, 55, 65]);
// 7a.AX: os cinco percentis da simulação, na ordem da tabela do "ver a conta"
// final (7a.AY: uma coluna por marco de idade). Siglas só dentro do "ver a conta" (regra de copy da tela).
const PROJ_PERCENTIS = Object.freeze([
  { k: "p10", rotulo: "p10" }, { k: "p25", rotulo: "p25" }, { k: "p50", rotulo: "p50, a mediana" },
  { k: "p75", rotulo: "p75" }, { k: "p90", rotulo: "p90" },
]);
// 7a.AX: as três parcelas da decomposição, na ordem da barra e da tabela.
// Fonte única do rótulo: a barra, a tabela e o teste leem daqui.
const PROJ_PARTES = Object.freeze([
  { chave: "partida", campo: "partida_crescida", rotulo: "Seu patrimônio de hoje, crescido" },
  { chave: "aportes", campo: "aportes", rotulo: "Aportes somados" },
  { chave: "rendimento", campo: "rendimento_aportes", rotulo: "Rendimento dos aportes" },
]);

const COLORS = {
  g700:      () => css("--g-700", "#047857"),
  g700a06:   () => css("--g-700-06", "rgba(4, 120, 87, 0.06)"),
  g700a12:   () => css("--g-700-12", "rgba(4, 120, 87, 0.12)"),
  blue700:   () => css("--blue-700", "#1d4ed8"),
  blue500:   () => css("--blue-500", "#0284c7"),
  purple500: () => css("--purple-500", "#a855f7"),
  amber:     () => css("--amber", "#f59e0b"),
  amber700:  () => css("--amber-700", "#b45309"),
  red:       () => css("--red", "#b91c1c"),
  ink:       () => css("--ink", "#1a1d1c"),
  gray:      () => css("--gray", "#5b605a"),
  // 7a.E.20.1: tokens semânticos de categoria (fonte única em :root).
  // 7a.M.1: +Renda Fixa BR (5ª categoria).
  catAcoesBr:    () => css("--cat-acoes-br",      "#047857"),
  catEua:        () => css("--cat-eua",           "#1e6091"),
  catFii:        () => css("--cat-fii",           "#b8731f"),
  catCripto:     () => css("--cat-cripto",        "#6d4ea8"),
  catRendaFixaBr: () => css("--cat-renda-fixa-br", "#0e7490"),
};

document.addEventListener("alpine:init", () => {
  Alpine.data("app", () => ({
    fase: "pin",
    rota: "",
    tab: "raiox",
    tickerAtual: "",
    // 7a.S.12 — Modo Plantão: tema manual + persistido, NUNCA prefers-color-
    // scheme (só localStorage). Lido no boot (init()) e aplicado a
    // document.documentElement ANTES do 1º chart ser desenhado.
    tema: "light",
    // 7a.S.5: hero de facetas — índice ativo (0..3) + labels estáticos (usados
    // tanto pelo eyebrow quanto pelo aria-label dos facet-dots). heroFacetHintGone
    // reflete sessionStorage.heroFacetHintSeen (1×/sessão, como heroCountUpDone).
    heroFacetAtivo: 0,
    heroFacetHintGone: false,
    heroFacetLabels: [
      "Patrimônio total",
      "Divisão Brasil · EUA",
      "Variação · 7 dias",
      "Desde a origem",
    ],
    // CRB 7a.S.5 — re-entrância de _renderHeroFace: geração da troca +
    // handles de timers/RAF em voo (ver comentários na própria função).
    _heroFaceGen: 0,
    _heroEyebrowSwapTimeout: null,
    _heroFaceRafOuter: null,
    _heroFaceRafInner: null,
    _heroSettleTimeout: null,
    // 7a.Q.3 — Relatório Mensal (payloads cifrados separados do portfolio.json)
    relIndice: null,        // {schema, atualizado_em, meses:[…]} | null
    relMes: null,           // artefato relatorio_mensal_v1 do mês carregado | null
    relMesAtual: "",        // 'YYYY-MM' atualmente renderizado
    relRotaMes: null,       // mês pedido pela rota (#/raiox/relatorio/:mes) | null
    relCarregando: false,   // decifra do mês em andamento
    relErro: "",            // mensagem de erro de arquivo/decifra
    relSeletorAberto: false,// dropdown de meses aberto/fechado
    // 7a.S.9 Task 2: evento mensal — meses já lidos (mapa 'YYYY-MM' → true).
    // 100% client-side, sem backend/schema. Sobrevive a reload (localStorage);
    // aberto pela 1ª vez → marcarMesLido some com o dot (home + seletor).
    // CRB: JSON.parse pode ter SUCESSO com um não-objeto ("null"/"42"/"[]")
    // sem lançar — coage a plain object p/ mesLido nunca fazer null[mes].
    relRead: (() => {
      try {
        const parsed = JSON.parse(localStorage.getItem("relRead") || "{}");
        return (parsed && typeof parsed === "object" && !Array.isArray(parsed))
          ? parsed : {};
      } catch (_) { return {}; }
    })(),
    // 7a.R.3.b — Dossiê de empresa (payloads cifrados separados do portfolio:
    // 1 índice leve no boot + 1 .enc por ticker, lazy). A tela é read-only e
    // NÃO é um segundo #ativo: nenhum preço, DY, KPI vivo ou delta colorido.
    dossieIndice: [],       // [{ticker,nome,categoria,escopo,arquivo,sha256}] — [] = sem índice
    dossieTicker: "",       // ticker pedido pela rota #/dossie/<TICKER>
    dossieAtual: null,      // dossie_empresa_v1 carregado | null
    dossieCarregado: "",    // ticker já renderizado (evita refetch na re-entrada)
    dossieCarregando: false,
    dossieErro: "",
    // Hash da tela de origem, gravado no clique da entrada. voltar() mapeia
    // tab → home da seção, o que perderia o ticker — o dossiê chega de DUAS
    // telas diferentes (#ativo e #relatorio), então precisa da origem literal.
    dossieOrigem: "",
    // Promise da carga do índice em voo. A carga é disparada em DOIS pontos
    // (boot não-bloqueante + hidratarDossie de um deep-link) e cada decifra
    // custa uma derivação PBKDF2 de 600k iterações — duas em paralelo custam
    // o dobro e atrasariam a hidratação dos gráficos.
    _dossieIndicePromise: null,
    // 7a.U Task 6 (CRB round 2, Finding 2): mesmo racional do
    // `_dossieIndicePromise` acima, agora nos outros 3 loaders que decifram
    // payload — `submitPin()` chama `atualizarRota()` ao promover a fase, que
    // agenda a MESMA hidratação (deep-link de Relatório/dossiê) que a linha
    // explícita duas linhas abaixo já dispara; sem promise em voo, as duas
    // cadeias corriam em paralelo e pagavam PBKDF2 em dobro. Os dois loaders
    // COM CHAVE (`carregarDossie`/`carregarRelatorioMes`) guardam a chave
    // junto — chave diferente NÃO compartilha (entregar o dossiê de HGLG11
    // para quem pediu ITSA4 seria dado errado).
    _relIndicePromise: null,
    _dossiePromise: null,
    _dossiePromiseTicker: null,
    _relMesPromise: null,
    _relMesPromiseAlvo: null,
    // 7a.W.3.a — o app trata o segredo como STRING OPACA (é o que
    // `encriptar_json(json_str, pin: str)` sempre fez no backend). Foi isso
    // que permitiu trocar 6 dígitos por uma frase de 6 palavras sem dois
    // códigos, dois formatos nem duas branches.
    //
    // `segredo` = o que decifra os payloads. Argumento de TODA chamada de
    //   window.decifrar e marcador de "sessão viva" nos guards pós-await.
    //   NUNCA vai para o localStorage em claro.
    // `pin`     = os 6 dígitos digitados NESTE aparelho, que só abrem o
    //   envelope. Ligado a x-model na tela de PIN. Vai para o localStorage em
    //   claro, e isso é decisão consciente: é o que faz o auto-resume de 7
    //   dias funcionar sem pedir nada. O aparelho é o perímetro de confiança
    //   e a 7a.W não muda isso (spec §2.3).
    segredo: "",
    pin: "",
    pinError: "",

    // 7a.W.3.b — três fases, não duas. `frase` é a cerimônia de PAREAMENTO do
    // aparelho (uma vez por aparelho); `pin` é o desbloqueio do dia a dia.
    //
    //   sem `pin` e sem envelope        → "frase" (virgem)
    //   com envelope                    → "pin"
    //   com `pin` e sem envelope        → migra em silêncio → "pin"
    //   envelope abre mas payload não   → "frase" com voz de republicação
    //
    // O último caso é o único que NÃO é decidido no boot: só se descobre
    // tentando decifrar o payload de verdade.
    //
    // Governa a voz da tela de enrollment. "" enquanto ela não está em cena.
    fraseMotivo: "",
    frase: "",
    fraseErro: "",
    // Duas etapas: as palavras e, só em aparelho virgem, a escolha do PIN
    // local. Aparelho que JÁ tem PIN guardado reusa o existente e digita só as
    // palavras (refinamento sobre o brief, spec §7.4).
    fraseEtapa: "frase",
    frasePinNovo: "",

    get fraseTokens() {
      return window.canonicalizarFrase(this.frase).split(" ").filter(Boolean).length;
    },
    carregando: false,
    json: null,
    agora: Date.now(),
    pinBlockUntil: 0,
    shake: false,
    // 7a.S.11: dissolve da PIN screen no unlock — ver `iniciarAbertura()`/
    // `submitPin`. Resetado em `bloquear()` e no handler multi-tab (senão a
    // PRÓXIMA vez que a PIN screen montar já nasceria com opacity 0).
    pinDissolvendo: false,
    toast: { visible: false, mensagem: "", tom: "verde", timer: null },
    // Aviso de nova versão do app (shell): setado true pelo evento window
    // "sw:update-available" (js/sw-update.js). Dispensável na sessão
    // (dispensarAtualizacao) — reaparece no próximo boot pois o worker segue
    // em espera. Não persistido.
    atualizacaoDisponivel: false,
    agoraTimer: null,
    escopoAtivo: "Total",
    moeda: localStorage.getItem("moedaEUA") || "BRL",
    // 7a.E.31: tela #alocação unificada — uma lista de cards de categoria
    // colapsáveis. catAberta mapeia nome→bool; todas começam fechadas (map
    // vazio = false). Não-persistente (reseta no reload), preservado ao
    // trocar de aba (vive só em memória Alpine).
    catAberta: {},
    proventosToggle: "origem",
    proventosMesSelecionado: null, // 7a.E.18: índice em mensal_12m ou null
    // 7a.S.7b: linha-razão do card do chart (= soma exata das barras exibidas;
    // troca com o toggle Anual/Mensal). Ver renderProventosGrafico().
    proventosTotalLabel: "",
    proventosTotalValor: 0,
    // 7a.S.7b: categoria (acao_br/fii/eua) do pódio de campeões em #s-dy.
    dySelecionado: null,
    _escListenerProventos: null,
    // 7a.BD.2: estado da #rentabilidade como ponte — janela (chave fixa ou
    // livre), motivo de indisponível, linha tocada da ponte e a vista pronta
    // (rent2Vista). Default via rent2Vazio(), o mesmo do reset do lock.
    rent2: rent2Vazio(),
    // Flag de um disparo: o próximo evento `datazoom` veio de um botão de
    // janela (anima), não do arrasto (sem animação).
    _rent2ViaBotao: false,
    _rent2SettleTimer: null,
    // 7a.U: handles dos 3 gráficos ECharts + seus ResizeObserver + o contexto
    // derivado do chart de rentabilidade, pré-declarados com `null` — um handle
    // vazio deve ter UMA representação (`null`), não duas (ausente antes do
    // 1º render, `null` depois do lock). Mesmo padrão de
    // `_heroEyebrowSwapTimeout` acima; zero mudança de
    // comportamento (todo consumidor usa checagem de truthy). Populados por
    // renderProventosGrafico/renderPatrimonioGrafico/hidratarRentabilidade,
    // zerados por _descartarProv/_descartarPatr/_descartarRent. Ver o
    // comentário de ASSINATURA_FN em lock-higiene.spec.ts para o porquê da
    // dupla representação quebrar o teste de invariante.
    echartsProv: null,
    resizeObserverProv: null,
    echartsPatr: null,
    resizeObserverPatr: null,
    echartsRent: null,
    resizeObserverChart: null,
    _rentCtx: null,
    // 7a.H.1: estado da tela #aportar
    aporteValor: "",
    aporteBanner: null,
    aporteCategoriasRecebedoras: [],
    aporteCategoriasNaoRecebedoras: [],
    aportePausados: [],
    aporteTickersSemPosicao: [],
    // 7a.AU: mercado do aporte. Em memória só: volta a "tudo" em toda
    // entrada na tela (hidratarAportar) e no lock. "Voltar sozinho num
    // Só EUA de ontem" é o erro caro, por isso NÃO vai ao localStorage.
    aporteMercado: "tudo",
    aporteSobra: 0,
    // 7a.S.10 — simulador vivo: bookkeeping puro (nunca lido por template),
    // não precisa ser reativo mas Alpine envolve mesmo assim por viver em
    // data(). _aporteRevelados: nomes de categoria cujo .aporte-card já
    // tocou o stagger-reveal 1x (reseta quando o valor volta a 0, ver
    // recalcularAporte). _aportePresetPendente: ponte cross-screen do grifo
    // #alocação → #aportar (evita tocar no parser de hash/query do router).
    _aporteRevelados: new Set(),
    _aportePresetPendente: null,
    aporteScrubMax: 20000,

    async init() {
      // 7a.S.12 — Modo Plantão: aplica o tema salvo ANTES de qualquer render
      // (inclusive do 1º chart, se o boot cair direto numa sub-rota). Fonte
      // ÚNICA é localStorage — NUNCA `prefers-color-scheme` (manual+persist,
      // spec §5.5). Default "light" quando não há chave salva.
      this.tema = localStorage.getItem("tema") === "dark" ? "dark" : "light";
      this._aplicarTema(this.tema);
      // 7a.AV.2 (bug achado ao olhar o leque no Plantão): echarts-theme.js roda
      // no <head>, ANTES desta linha pôr [data-theme="dark"], então os tokens
      // do ECharts nasciam com os valores CLAROS num boot frio em Plantão
      // (grade --neutral-200 clara quase branca sobre o fundo OLED, --g-700
      // escuro). Só o toggle chamava reregister(). Relê aqui, uma vez.
      if (this.tema === "dark" && window.drarthurChart
          && typeof window.drarthurChart.reregister === "function") {
        window.drarthurChart.reregister();
      }
      this.pinBlockUntil = Number(localStorage.getItem("pinBlockUntil")) || 0;
      this.agoraTimer = setInterval(() => { this.agora = Date.now(); }, 1000);
      // 7a.E.17: cleanup de chaves legadas do toggle de #politica (versões
      // anteriores persistiam o estado collapsed por categoria).
      try {
        ["Ações BR", "Cripto", "EUA", "FIIs"].forEach((cat) =>
          localStorage.removeItem("politica.collapsed." + cat)
        );
      } catch (_) {}
      window.addEventListener("storage", (e) => {
        // Multi-tab sync: se outra aba limpou a sessão, esta aba cai para PIN.
        if (e.key === "pin" && e.newValue === null && this.fase === "raiox") {
          this.fase = "pin";
          this.rota = "";
          this.json = null;
          this.pin = "";
          this.pinError = "";
          this.pinDissolvendo = false;
          this._limparEstadoSensivel(); // 7a.U: idem no logout multi-tab
        }
      });
      window.addEventListener("hashchange", () => this.atualizarRota());
      // Aviso de nova versão: o módulo dono do ciclo do SW (js/sw-update.js)
      // detecta o worker novo em espera e emite este evento; a UI mostra o
      // snackbar. Listener no init() garante escopo `this` do Alpine data.
      window.addEventListener("sw:update-available", () => {
        this.atualizacaoDisponivel = true;
      });
      this.atualizarRota();
      // 7a.I.6: posiciona indicator. A tab-bar só vira DOM quando fase virar
      // 'raiox' (template x-if), então também observamos `fase`.
      this.$nextTick(() => this.updateTabIndicator());
      this.$watch("fase", () => this.$nextTick(() => this.updateTabIndicator()));
      this.$watch("tab", () => this.$nextTick(() => this.updateTabIndicator()));
      // Resize debounce via rAF: teclado virtual mobile dispara dezenas de eventos
      // — coalesce em 1 update por frame evita layout thrashing.
      let resizeRaf = 0;
      window.addEventListener("resize", () => {
        if (resizeRaf) return;
        resizeRaf = requestAnimationFrame(() => {
          resizeRaf = 0;
          this.updateTabIndicator();
        });
      });
      // 7a.W.3.b: decide a fase inicial ANTES do auto-resume.
      //
      // NÃO chama `_migrarSePreciso()` aqui, de propósito. A pergunta "este
      // aparelho é virgem?" não depende de ter migrado: quem tem `pin` não é
      // virgem, com ou sem envelope, e quem não tem nem `pin` nem envelope não
      // tem o que migrar. Chamar a migração aqui custaria uma derivação
      // PBKDF2 de 600k no boot de TODO aparelho e atrasaria o auto-resume o
      // suficiente para o `limparSessao()` da sessão expirada chegar tarde
      // demais (medido: `session.spec.ts` "sessao > 7d" lia o `pin` ainda
      // presente). A migração roda onde a derivação já é obrigatória, dentro
      // de `tentarAutoResume`.
      if (!localStorage.getItem("pin") && !this._temEnvelope()) {
        // Aparelho virgem: nem PIN guardado, nem envelope. Nada a desbloquear
        // — o que falta é PAREAR o aparelho.
        this.fase = "frase";
        this.fraseMotivo = "virgem";
        return;   // sem auto-resume: não há o que retomar
      }
      await this.tentarAutoResume();
    },

    // 7a.S.12 — aplica [data-theme] na raiz + atualiza a meta theme-color
    // (chrome do navegador/status bar acompanha o tema). Não mexe em nenhum
    // chart — reregister()+re-hidratação é responsabilidade de alternarTema().
    _aplicarTema(tema) {
      document.documentElement.setAttribute("data-theme", tema);
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", tema === "dark" ? "#03110a" : "#064e3b");
    },

    // Toggle ☽/☀ do topo do Raio-X. Flip + persist + reregister do tema
    // ECharts (tokens frescos). NÃO re-hidrata chart nenhum aqui: o botão só
    // existe dentro de `.raiox` (x-show="rota === ''"), então no instante do
    // clique `this.rota` é SEMPRE "" — nenhuma tela de chart (rentabilidade/
    // patrimônio/proventos) pode estar ativa ao mesmo tempo, por construção.
    // hidratarRentabilidade/hidratarPatrimonio/hidratarProventos fazem
    // dispose+init TODA vez que a rota é (re)visitada (atualizarRota chama
    // incondicionalmente, mesmo se já era a rota atual) — então a próxima
    // navegação à tela do chart já lê os tokens recém-reregistrados, sem
    // flash de cor antiga (o chart nunca fica "vivo e desatualizado": ou não
    // existe ainda, ou é reconstruído do zero a cada entrada na tela).
    alternarTema() {
      const novo = this.tema === "dark" ? "light" : "dark";
      this.tema = novo;
      try { localStorage.setItem("tema", novo); } catch (_) {}
      this._aplicarTema(novo);
      if (window.drarthurChart && typeof window.drarthurChart.reregister === "function") {
        window.drarthurChart.reregister();
      }
    },

    // Aviso de nova versão — delega ao módulo dono do ciclo do SW
    // (js/sw-update.js). `?.` protege caso o módulo não tenha carregado.
    recarregarVersao() {
      window.swUpdate?.aplicar();
    },

    // Dispensa o aviso na sessão; reaparece no próximo boot (o worker segue
    // em espera até um reload de verdade).
    dispensarAtualizacao() {
      this.atualizacaoDisponivel = false;
    },

    atualizarRota() {
      // 7a.I.1/7a.I.4: deriva tab top-level (1 de 5) de rota. Hash pode trazer
      // querystring (ex.: `#alocacao?v=alvo`) — separamos `path` e `params`.
      // #ativo/:ticker é push e PRESERVA a tab anterior (não reseta).
      // 7a.I.5: rotas push-child usam `/` líder no path (ex.: `/raiox/chart`)
      // — `replace(/^#/, "")` mantém a barra. Rotas top-level são sem barra.
      const raw = (location.hash || "").replace(/^#/, "");
      const qIdx = raw.indexOf("?");
      const path = qIdx === -1 ? raw : raw.slice(0, qIdx);
      const params = new URLSearchParams(qIdx === -1 ? "" : raw.slice(qIdx + 1));
      if (path === "") {
        this.rota = ""; this.tab = "raiox";
        // 7a.S.11 CRB: dispara A Abertura quando a home é 1º vista (cobre o caso
        // deep-link: sessão que nasce numa sub-rota e só depois vai à home).
        // Idempotente — os guards jaFeita/fase/rota de iniciarAbertura garantem 1×.
        setTimeout(() => this.iniciarAbertura(), 0);
        return;
      }
      if (path === "rentabilidade") {
        this.rota = "rentabilidade";
        this.tab = "rentab";
        // Hidrata o gráfico após Alpine renderizar a section.
        setTimeout(() => this.hidratarRentabilidade(), 0);
        return;
      }
      if (path === "alocacao") {
        // 7a.E.31: vista única. Sem ?v= (segmented Atual/Alvo removido). As
        // categorias começam fechadas; catAberta vive em memória Alpine.
        this.rota = "alocacao";
        this.tab = "aloca";
        return;
      }
      if (path === "politica") {
        // 7a.I.4 shim mantido (7a.E.31): `#politica` foi fundida em `#alocacao`.
        // replaceState não dispara hashchange — sem loop com este handler.
        history.replaceState(null, "", "#alocacao");
        this.rota = "alocacao";
        this.tab = "aloca";
        return;
      }
      if (path === "proventos") {
        this.rota = "proventos";
        this.tab = "provent";
        setTimeout(() => this.hidratarProventos(), 0);
        return;
      }
      if (path === "/raiox/projecao") {
        // 7a.AV.2: projeção até os 65 é push child da tab Raio-X, como
        // #/raiox/chart. voltar() cai em home["raiox"] = "" (mapa genérico).
        this.rota = "projecao";
        this.tab = "raiox";
        return;
      }
      if (path === "/raiox/renda") {
        // 7a.BJ.2: renda da carteira, push child da tab Raio-X, irmã da
        // projeção. voltar() cai em home["raiox"] = "" (mapa genérico).
        this.rota = "renda";
        this.tab = "raiox";
        return;
      }
      if (path === "/raiox/chart") {
        // 7a.I.5: chart full é push child da tab Raio-X. URL canônica.
        this.rota = "patrimonio";
        this.tab = "raiox";
        setTimeout(() => this.hidratarPatrimonio(), 0);
        return;
      }
      if (path === "/proventos/dy") {
        // 7a.S.7b: tela dedicada de Dividend Yield é push child da tab
        // Proventos — tab persiste (não reseta pra raiox), voltar() usa
        // home["provent"] = "#proventos" (mapa genérico, sem shim dedicado).
        this.rota = "dy";
        this.tab = "provent";
        setTimeout(() => this.hidratarDY(), 0);
        return;
      }
      // 7a.R.3.b: dossiê é push child alcançado de DUAS tabs (#ativo, que
      // preserva a tab de origem, e #relatorio, que vive sob raiox). Por isso
      // NÃO reseta `tab` — como `ativo/:ticker`. O voltar usa dossieOrigem.
      // Charclass idêntica à de #ativo (16 chars cobrem BR/EUA + sintéticos).
      const mdos = path.match(/^\/dossie\/([A-Z0-9_-]{2,16})$/);
      if (mdos) {
        this.rota = "dossie";
        this.dossieTicker = mdos[1];
        setTimeout(() => this.hidratarDossie(), 0);
        return;
      }
      const mr = path.match(/^\/raiox\/relatorio(?:\/(\d{4}-\d{2}))?$/);
      if (mr) {
        this.rota = "relatorio";
        this.tab = "raiox";
        this.relRotaMes = mr[1] || null;
        this.relSeletorAberto = false;
        setTimeout(() => this.hidratarRelatorio(), 0);
        return;
      }
      if (path === "patrimonio") {
        // 7a.I.5 shim: rota legada `#patrimonio` virou push child de raiox.
        // replaceState não dispara hashchange — sem loop.
        history.replaceState(null, "", "#/raiox/chart");
        this.rota = "patrimonio";
        this.tab = "raiox";
        setTimeout(() => this.hidratarPatrimonio(), 0);
        return;
      }
      if (path === "aportar") {
        // 7a.AU (correção pré-merge, achada pela suíte completa): entrada na tela abre em Tudo (spec §3.3).
        // Guardado em `this.rota !== "aportar"` porque atualizarRota()/
        // hidratarAportar() são re-chamadas DEPOIS de um await (boot em
        // tentarAutoResume, unlock em submitPin) mesmo já estando na tela —
        // sem o guard, um toque em EUA feito durante essa espera era desfeito
        // pela re-hidratação tardia, silenciosamente. Lock reseta à parte,
        // em `_limparEstadoAporte`.
        if (this.rota !== "aportar") this.aporteMercado = "tudo";
        this.rota = "aportar";
        this.tab = "aportar";
        this.hidratarAportar();
        return;
      }
      // Limite de 16 chars cobre tickers BR/EUA + sintéticos longos como
      // AVNU_REBATE (Fase 7a.28). Caso surjam tickers com `.` (ex.: BRK.B),
      // expandir a charclass — nenhum ativo da carteira atual usa.
      const m = path.match(/^ativo\/([A-Z0-9_-]{2,16})$/);
      if (m) { this.rota = "ativo"; this.tickerAtual = m[1]; return; /* tab preserva valor anterior */ }
      // Fallback: hash inválido vira raio-x sem entrar no histórico.
      history.replaceState(null, "", location.pathname + location.search);
      this.rota = "";
      this.tab = "raiox";
    },

    tabIndex() {
      // 7a.I.6: mapa tab → índice (0..4) usado pelo indicator slide.
      const ordem = ["raiox", "rentab", "aloca", "provent", "aportar"];
      const i = ordem.indexOf(this.tab);
      return i === -1 ? 0 : i;
    },

    updateTabIndicator() {
      // 7a.I.6: posiciona .tab-bar-indicator via translateX baseado no índice.
      // Grid 5 colunas iguais → cada tab = 20% do nav; indicator tem width 10%
      // → para centralizá-lo: offset = índice*tabWidth + (tabWidth - indicatorWidth)/2.
      const nav = document.querySelector(".tab-bar");
      if (!nav) return;
      const navWidth = nav.getBoundingClientRect().width;
      if (navWidth === 0) return;
      const tabWidth = navWidth / 5;
      const indicatorWidth = navWidth * 0.10;
      const x = this.tabIndex() * tabWidth + (tabWidth - indicatorWidth) / 2;
      nav.style.setProperty("--tab-indicator-x", x + "px");
    },

    ativarCountUpHero(elParam, onDone) {
      // 7a.I.6: dono exclusivo do textContent de #hero-patrimonio. Removido o
      // x-text para não disputar com o RAF (Alpine re-renderiza no meio dos
      // 700ms reverteria o frame intermediário para o valor final).
      // 7a.S.5: aceita um elemento explícito (passado por _renderHeroFace,
      // escopado ao nó recém-criado da faceta ativa). Isso evita uma corrida
      // real: com o hero de facetas, o nó ANTIGO com o mesmo id só é removido
      // 320ms depois (transição de saída) — se o usuário ciclar de volta pra
      // faceta 0 dentro desse intervalo, document.getElementById encontraria
      // o nó velho (1º em ordem no DOM) em vez do novo, e o RAF do 1º count-up
      // (ainda em voo) continuaria escrevendo nele, revertendo o texto pro
      // valor parcial. Passar o elemento explícito elimina a ambiguidade.
      //
      // CRB 7a.S.5: `onDone` opcional (chamado 1x, síncrono nos caminhos
      // instantâneos/refresh, assíncrono no caminho RAF) — usado por
      // _renderHeroFace para saber quando o count-up terminou e liberar o
      // aria-busy do #hero-body. Todo caminho de saída chama onDone, inclusive
      // os guards antecipados (senão o aria-busy travaria em "true").
      const done = () => { if (onDone) onDone(); };
      if (!this.json || !this.json.patrimonio) { done(); return; }
      const target = this.json.patrimonio.total_brl;
      if (typeof target !== "number" || !isFinite(target)) { done(); return; }
      const el = elParam || document.getElementById("hero-patrimonio");
      if (!el) { done(); return; }
      // Refresh dentro da mesma sessão (heroCountUpDone=1) = valor final direto,
      // sem animação. Primeira load por sessão = count-up 700ms via RAF.
      // transitions.js carrega síncrono antes de app.js em index.html, então
      // drarthurNav está sempre definido nesse ponto — sem fallback redundante.
      if (sessionStorage.getItem("heroCountUpDone") === "1") {
        el.textContent = window.formatBrl(target);
        done();
        return;
      }
      window.drarthurNav.applyCountUp(el, target, (n) => window.formatBrl(n), done);
      sessionStorage.setItem("heroCountUpDone", "1");
    },

    // ── Hero de facetas (7a.S.5) ────────────────────────────────────────
    // Conteúdo de #hero-body é gerido via DOM imperativo (mesmo racional de
    // ativarCountUpHero: a transição de duas camadas .hero-face.out/.on —
    // com remoção atrasada 320ms — não mapeia bem pra x-show/x-if do Alpine
    // sem arriscar nós duplicados/strict-mode). heroFacetAtivo (estado Alpine)
    // permanece a single source pros facet-dots (x-for reativo).

    // Deriva os 4 fatos a partir de `this.json` — chamado a cada troca de
    // faceta (barato: 4 objetos pequenos), nunca cacheado, pra sempre refletir
    // o JSON corrente.
    _heroFacetsData() {
      const j = this.json || {};
      const p = j.patrimonio || {};
      const rentTotal = (j.rentabilidade && j.rentabilidade.Total) || {};
      const origem = rentTotal.xirr_origem ?? rentTotal.twr_origem ?? null;
      return [
        {
          tipo: "big",
          eyebrow: this.heroFacetLabels[0],
          valor: p.total_brl,
          delta: p.variacao_semanal_brl,
          deltaPct: p.variacao_semanal_pct,
        },
        {
          // 7a.BG.1: a divisão vale sobre a CARTEIRA (patrimônio sem a cripto).
          // `br_brl` segue com a cripto (não muda de sentido no payload); o
          // R$ Brasil exibido é `carteira_br_brl`. Payload < 2.31 não tem os
          // campos: cai no total/br de antes, sem rodapé.
          tipo: "split",
          eyebrow: this.heroFacetLabels[1],
          totalBrl: p.carteira_brl ?? p.total_brl,
          brBrl: p.carteira_br_brl ?? p.br_brl,
          euaBrl: p.eua_brl,
          criptoRodape: this.rodapeCriptoTexto(),
        },
        {
          tipo: "variacao7d",
          eyebrow: this.heroFacetLabels[2],
          valor: p.variacao_semanal_brl,
          pct: p.variacao_semanal_pct,
        },
        {
          tipo: "origem",
          eyebrow: this.heroFacetLabels[3],
          valor: origem,
        },
      ];
    },

    // Monta o innerHTML de UMA faceta. Números são sempre computados (nunca
    // texto vindo do usuário) — sem risco de XSS na concatenação.
    _heroFaceHtml(f) {
      if (f.tipo === "big") {
        const temDelta = f.delta !== null && f.delta !== undefined;
        const temPct = f.deltaPct !== null && f.deltaPct !== undefined;
        const deltaHtml = temDelta
          ? '<div class="hero-delta ' + (f.delta >= 0 ? "is-positive" : "is-negative") + '">' +
            '<span class="seta" aria-hidden="true">' + (f.delta >= 0 ? "▲" : "▼") + "</span>" +
            "<span>" + window.formatBrl(f.delta) + "</span>" +
            (temPct ? "<span>(" + window.formatPct(f.deltaPct) + ")</span>" : "") +
            '<span class="texto">· 7d</span></div>'
          : "";
        return '<p class="hero-valor" id="hero-patrimonio"></p>' + deltaHtml;
      }
      if (f.tipo === "split") {
        const total = f.totalBrl || 0;
        const brPct = total > 0 ? (f.brBrl || 0) / total : 0;
        const euaPct = total > 0 ? (f.euaBrl || 0) / total : 0;
        return (
          '<div class="hero-split">' +
          '<div class="col"><div class="cap">🇧🇷 Brasil</div>' +
          '<div class="num">' + window.formatBrl(f.brBrl) + "</div>" +
          '<div class="pct">' + window.formatPctSemSinal(brPct, 1) + "</div></div>" +
          '<div class="col"><div class="cap">🇺🇸 EUA</div>' +
          '<div class="num">' + window.formatBrl(f.euaBrl) + "</div>" +
          '<div class="pct">' + window.formatPctSemSinal(euaPct, 1) + "</div></div>" +
          "</div>" +
          '<div class="hero-splitbar' + (f.criptoRodape ? " hero-splitbar--com-rodape" : "") + '">' +
          '<i style="width:' + (brPct * 100).toFixed(2) + '%;background:var(--cat-acoes-br)"></i>' +
          '<i style="width:' + (euaPct * 100).toFixed(2) + '%;background:var(--cat-eua)"></i>' +
          "</div>" +
          (f.criptoRodape
            ? '<p class="hero-split-cripto" data-testid="cripto-rodape">' + f.criptoRodape + "</p>"
            : "")
        );
      }
      if (f.tipo === "variacao7d") {
        if (f.valor === null || f.valor === undefined) {
          return (
            '<p class="hero-valor">—</p>' +
            '<p class="hero-sub">Sem histórico de 7 dias ainda — volte em breve.</p>'
          );
        }
        const seta = f.valor >= 0 ? "▲" : "▼";
        const temPct = f.pct !== null && f.pct !== undefined;
        return (
          '<p class="hero-valor"><span aria-hidden="true">' + seta + "</span> " +
          window.formatBrlSigned(f.valor) + "</p>" +
          '<p class="hero-sub">' +
          (temPct ? window.formatPct(f.pct) + " " : "") +
          "nesta semana · mercado + aportes + proventos</p>"
        );
      }
      if (f.tipo === "origem") {
        if (f.valor === null || f.valor === undefined) {
          return (
            '<p class="hero-valor">—</p>' +
            '<p class="hero-sub">Ainda sem dado suficiente para calcular o retorno desde a origem.</p>'
          );
        }
        return (
          '<p class="hero-valor">' + window.formatPct(f.valor) + "</p>" +
          '<p class="hero-sub">ao ano · retorno acumulado desde o início da carteira</p>'
        );
      }
      return "";
    },

    // Troca a faceta ativa. opts.instant pula a transição (mount inicial);
    // caso contrário, respeita prefers-reduced-motion (drarthurNav.motion.reduced).
    // Facet "big" sempre delega o número a ativarCountUpHero() — que já resolve
    // sozinho "1ª vez anima, revisitas mostram valor final direto" via
    // sessionStorage.heroCountUpDone (nunca reseta ao trocar de faceta).
    _renderHeroFace(idx, opts) {
      opts = opts || {};
      const dados = this._heroFacetsData();
      const f = dados[idx];
      if (!f) return;
      this.heroFacetAtivo = idx;
      const reduced = window.drarthurNav.motion.reduced;
      const instant = !!(opts.instant || reduced);

      // CRB 7a.S.5 (re-entrância): geração desta troca. Um settle assíncrono
      // (RAF/timeout) de uma troca ANTERIOR ainda em voo confere este número
      // antes de agir; se mudou, a troca foi superada e o settle é descartado
      // — evita que um callback tardio limpe o aria-busy no meio de uma
      // transição mais nova (ver tentarLimparBusy abaixo).
      this._heroFaceGen = (this._heroFaceGen || 0) + 1;
      const gen = this._heroFaceGen;

      // Cancela timers/RAFs pendentes de uma troca anterior. Sem isso, num
      // ciclo rápido (auto-repeat de tecla segurando Enter/Space, ou toques/
      // cliques em sequência nos dots) o double-RAF pendente da troca
      // anterior ainda acrescentaria `.on` a um nó já retirado — a raiz do
      // órfão que este fix elimina — e o setTimeout do eyebrow escreveria um
      // label fora de ordem.
      if (this._heroEyebrowSwapTimeout) {
        clearTimeout(this._heroEyebrowSwapTimeout);
        this._heroEyebrowSwapTimeout = null;
      }
      if (this._heroFaceRafOuter) {
        cancelAnimationFrame(this._heroFaceRafOuter);
        this._heroFaceRafOuter = null;
      }
      if (this._heroFaceRafInner) {
        cancelAnimationFrame(this._heroFaceRafInner);
        this._heroFaceRafInner = null;
      }
      if (this._heroSettleTimeout) {
        clearTimeout(this._heroSettleTimeout);
        this._heroSettleTimeout = null;
      }

      const bodyEl = document.getElementById("hero-body");
      // CRB 7a.S.5 (a11y): #hero-body é aria-live="polite" — sem isto, o SR
      // lê ~42 frames parciais do count-up (RAF reescreve textContent) e,
      // durante a transição de saída de 320ms, duas `.hero-face` coexistem
      // no DOM. `aria-busy="true"` faz assistive tech ignorar a churn; só
      // volta a "false" (tentarLimparBusy) quando a entrada assentar E — se
      // for a faceta "big" — o count-up também tiver terminado.
      if (bodyEl) bodyEl.setAttribute("aria-busy", "true");

      const eyebrowEl = document.getElementById("hero-eyebrow");
      if (eyebrowEl) {
        if (instant) {
          eyebrowEl.textContent = f.eyebrow;
        } else {
          eyebrowEl.classList.add("swap");
          this._heroEyebrowSwapTimeout = setTimeout(() => {
            eyebrowEl.textContent = f.eyebrow;
            eyebrowEl.classList.remove("swap");
            this._heroEyebrowSwapTimeout = null;
          }, 150);
        }
      }
      if (!bodyEl) return;

      // Retira TODAS as faces pré-existentes — não só `.hero-face.on`. Numa
      // troca rápida, a face recém-entrante ainda não ganhou `.on` (double-
      // RAF pendente) quando a próxima troca chega; buscar só `.on` não a
      // encontraria, e ela ficaria órfã em #hero-body, ganhando `.on` mais
      // tarde e piscando um fato velho na tela.
      bodyEl.querySelectorAll(".hero-face").forEach((node) => {
        // Mesmo racional do fix original (7a.I.6/7a.S.5): nunca dois nós com
        // #hero-patrimonio coexistindo — getElementById resolveria pro nó
        // errado. Agora aplicado a QUALQUER face retirada, não só a `.on`.
        const valorId = node.querySelector("#hero-patrimonio");
        if (valorId) valorId.removeAttribute("id");
        if (instant) {
          node.remove();
        } else {
          node.classList.remove("on");
          node.classList.add("out");
          setTimeout(() => node.remove(), 320);
        }
      });

      const el = document.createElement("div");
      el.className = "hero-face";
      el.innerHTML = this._heroFaceHtml(f);
      bodyEl.appendChild(el);

      // "Entrada pronta" = a face nova assentou visualmente (instantâneo, ou
      // 320ms após o double-RAF — mesma folga usada pra remoção do nó de
      // saída, cobre a transição --d2 de opacity/transform). "Count-up
      // pronto" só existe pra faceta "big"; as demais já nascem prontas.
      let entradaPronta = false;
      let countUpPronto = f.tipo !== "big";
      const tentarLimparBusy = () => {
        if (gen !== this._heroFaceGen) return; // troca superada — ignora
        if (entradaPronta && countUpPronto && bodyEl) {
          bodyEl.setAttribute("aria-busy", "false");
        }
      };
      const marcarEntradaPronta = () => { entradaPronta = true; tentarLimparBusy(); };
      const marcarCountUpPronto = () => { countUpPronto = true; tentarLimparBusy(); };

      if (instant) {
        el.classList.add("on");
        marcarEntradaPronta();
      } else {
        this._heroFaceRafOuter = requestAnimationFrame(() => {
          this._heroFaceRafOuter = null;
          this._heroFaceRafInner = requestAnimationFrame(() => {
            this._heroFaceRafInner = null;
            el.classList.add("on");
            this._heroSettleTimeout = setTimeout(() => {
              this._heroSettleTimeout = null;
              marcarEntradaPronta();
            }, 320);
          });
        });
      }

      if (f.tipo === "big") {
        // Escopado ao nó recém-criado (não document.getElementById) — ver
        // comentário em ativarCountUpHero sobre a corrida com o nó antigo
        // ainda pendente de remoção (transição de saída, 320ms).
        this.ativarCountUpHero(el.querySelector("#hero-patrimonio"), marcarCountUpPronto);
      }
    },

    // x-init da `.raiox` — dispara 1× por transição de fase pin→raiox
    // (via submitPin OU tentarAutoResume, ambas montam esta subtree). "A
    // Abertura" (7a.S.11): reveal em stagger de 4 grupos (eyebrow/hero/7d/
    // relcard) + breathe do delta pill ao fim, tocada só na 1ª vez da sessão
    // (flag aberturaFeita em sessionStorage — mesmo padrão de
    // heroCountUpDone/heroFacetHintSeen). Reduced-motion ou sessão já servida
    // = sem efeito nenhum (grupos renderizam normais, sem classe alguma —
    // nunca ficam presos invisíveis).
    iniciarAbertura() {
      const marcarFeita = () => {
        try { sessionStorage.setItem("aberturaFeita", "1"); } catch (_) {}
      };
      let jaFeita = false;
      try { jaFeita = sessionStorage.getItem("aberturaFeita") === "1"; } catch (_) {}
      if (jaFeita) return;
      // 7a.S.11 CRB: cerimônia 1×/sessão, na 1ª vez que a HOME é vista. Só
      // roda/marca com fase raiox + home visível (rota===''): se a 1ª montagem
      // do raiox cair numa sub-rota (deep-link), NÃO roda off-screen — o trigger
      // em atualizarRota() dispara quando a home é 1º navegada. Flag SÍNCRONO no
      // entry (como heroCountUpDone) mata a janela de double-fire (re-lock < 980ms).
      if (this.fase !== "raiox" || this.rota !== "") return;
      marcarFeita();
      if (window.drarthurNav.motion.reduced) return;

      const secao = document.querySelector(".raiox");
      const grupos = [
        secao && secao.querySelector(".eyebrow"),
        document.getElementById("hero"),
        secao && secao.querySelector(".raiox-7d"),
        secao && secao.querySelector(".rel-card-home"),
      ];
      grupos.forEach((el, i) => {
        if (!el) return;
        el.classList.add("abertura-reveal");
        setTimeout(() => el.classList.add("abertura-reveal-in"), ABERTURA_MOTION.staggerMs[i]);
      });
      // Delta pill "respira" 1 ciclo ao fim (nunca loop — anti-pattern #11:
      // sem celebração). A classe é removida pelo próprio JS no animationend
      // (não fica presa; CSS já garante animation-iteration-count: 1).
      setTimeout(() => {
        const delta = secao && secao.querySelector(".hero-delta");
        if (delta) {
          delta.classList.add("abertura-breathe");
          delta.addEventListener(
            "animationend",
            () => delta.classList.remove("abertura-breathe"),
            { once: true },
          );
        }
        // marcarFeita() já foi chamado no entry (7a.S.11 CRB) — não repetir.
      }, ABERTURA_MOTION.breatheMs);
    },

    // x-init do #hero — mount inicial (faceta 0, instantâneo) + hidrata o
    // flag do hint a partir do sessionStorage (mesmo padrão de heroCountUpDone).
    montarHeroFacetas() {
      try {
        this.heroFacetHintGone = sessionStorage.getItem("heroFacetHintSeen") === "1";
      } catch (_) {
        this.heroFacetHintGone = false;
      }
      this._renderHeroFace(0, { instant: true });
    },

    _hintGoneHero() {
      if (this.heroFacetHintGone) return;
      this.heroFacetHintGone = true;
      try { sessionStorage.setItem("heroFacetHintSeen", "1"); } catch (_) {}
    },

    // @click do card inteiro — cicla sequencialmente (wrap-around).
    ciclarHeroFacet() {
      this._hintGoneHero();
      const proximo = (this.heroFacetAtivo + 1) % this.heroFacetLabels.length;
      this._renderHeroFace(proximo, {});
    },

    // @click.stop de um facet-dot — pula direto pro índice tocado.
    irParaFacetHero(idx) {
      this._hintGoneHero();
      if (idx === this.heroFacetAtivo) return;
      this._renderHeroFace(idx, {});
    },

    // 7a.E.31: alterna o card de uma categoria na vista #alocação unificada.
    // Não-persistente; map vazio = todas fechadas.
    toggleCategoria(nome) {
      this.catAberta = {
        ...this.catAberta,
        [nome]: !this.catAberta[nome],
      };
    },

    // 7a.E.31: R$ de mercado da categoria / do ativo (schema v2.20).
    valorBrlCategoria(cat) { return (cat && cat.valor_brl) || 0; },

    // 7a.BG.1 — rodapé de reconciliação. Toda divisão percentual (faceta
    // split do hero, cartões da #alocacao) vale sobre a carteira, que exclui a
    // cripto; esta linha devolve a cripto à vista para as partes fecharem com
    // o número do topo. Só existe com payload 2.31+ (`carteira_brl` presente:
    // num payload antigo a divisão ainda inclui a cripto, e o rodapé a
    // contaria duas vezes) e com cripto > 0. Texto numérico computado, nunca
    // vindo do usuário: seguro para o innerHTML do hero.
    rodapeCriptoTexto() {
      const p = (this.json && this.json.patrimonio) || {};
      const cripto = p.cripto_brl;
      if (typeof p.carteira_brl !== "number") return "";
      if (typeof cripto !== "number" || !(cripto > 0)) return "";
      return "+ " + window.formatBrl(cripto) + " em cripto, fora da divisão";
    },

    // 7a.E.32/7a.E.33: DY trailing-12m do ativo (schema v2.24). `por_ativo`
    // carrega SÓ tickers com DY válido — a ausência da chave É o "não há número
    // aqui", e vira "—" no card. Nunca devolver 0: 0 é um DY legítimo impossível
    // (o backend já o barra), e confundir os dois esconderia um ativo sem provento
    // atrás de um número. Consumido pelo card DY de #ativo e pelo pódio #s-dy
    // (o sufixo inline de #alocacao foi removido na 7a.E.34). Empty-safe: payload
    // antigo (pré-v2.24) não tem o mapa -> o card mostra o traço.
    dyAtivo(ticker) {
      const dy = this.json?.dividend_yield?.por_ativo?.[ticker];
      return typeof dy === "number" ? dy : null;
    },

    // 7a.E.35: posição aberta < 12m → DY trailing-12m subestima (numerador não
    // cobre a posição cheia por um ano). Empty-safe p/ payload pré-v2.25 (campo
    // ausente → []). Consumido só pelo selo do card DY de #ativo. É propriedade
    // da POSIÇÃO (idade), não do DY: pode ser true mesmo com dyAtivo(t) === null
    // ("—").
    dyParcial(ticker) {
      return (this.json?.dividend_yield?.por_ativo_parcial || []).includes(ticker);
    },

    voltar() {
      // history.length é heurística frágil — em link compartilhado aberto
      // numa aba com histórico prévio, history.back() saída do PWA.
      // Sempre reescrevemos o hash via replaceState; mais previsível e mantém
      // o usuário dentro do app.
      //
      // O back de uma tela drill-down (#ativo, #/raiox/chart) retorna para a
      // HOME da seção de origem — nunca pula para a Raio-X a partir de outra
      // seção. `this.tab` preserva a tab de origem (atualizarRota não a reseta
      // em push #ativo/:ticker), então mapeamos tab → hash da home e deixamos
      // atualizarRota() re-derivar rota/tab/hidratação a partir do hash.
      // 7a.I.7 forçava `tab=raiox` aqui: o back de #ativo aberto em
      // #alocacao/#proventos caía na Raio-X em vez da seção de origem.
      const home = {
        raiox: "",
        rentab: "#rentabilidade",
        aloca: "#alocacao",
        provent: "#proventos",
        aportar: "#aportar",
      };
      const hash = Object.prototype.hasOwnProperty.call(home, this.tab)
        ? home[this.tab]
        : "";
      history.replaceState(null, "", hash || location.pathname);
      this.atualizarRota();
    },

    selecionarEscopo(escopo) {
      this.escopoAtivo = escopo;
      this.hidratarRentabilidade();
    },

    // Drift em pontos percentuais com sinal explícito (ex: "+0.34pp" / "−1.20pp").
    // Não usa Intl.NumberFormat porque o sufixo "pp" não é parte do locale.
    formatPctSinalPP(v) {
      if (v === null || v === undefined || Number.isNaN(v)) return "—";
      const pp = v * 100;
      const sign = pp > 0 ? "+" : pp < 0 ? "−" : "±";
      return sign + Math.abs(pp).toFixed(2) + "pp";
    },

    // ── Últimos 7 dias (Fase 7a.J.1) ────────────────────────────────────
    // Bloco invisível quando schema v<2.13 (sem ultimos_7d) ou em DB
    // recém-bootstrapped sem snapshot ≥7d E sem movs/proventos na janela.
    ultimos7dVisivel() {
      const u = this.json && this.json.ultimos_7d;
      if (!u) return false;
      const temDelta = u.delta_patrim_brl !== null && u.delta_patrim_brl !== undefined;
      const temListas =
        (u.compras || []).length > 0 ||
        (u.vendas || []).length > 0 ||
        (u.proventos || []).length > 0;
      return temDelta || temListas;
    },

    // Headline "+R$ 4.270  +1,6%" / "−R$ 1.200  −0,5%" / "—"
    formatDeltaR7d(brl, pct) {
      if (brl === null || brl === undefined) return "—";
      const partes = [window.formatBrl(brl)];
      if (pct !== null && pct !== undefined) partes.push(window.formatPct(pct));
      return partes.join("  ");
    },

    // Linha de decomposicao: "+R$ 11.300" / "−R$ 7.530" / "R$ 0" / "—"
    formatDecompR7d(brl) {
      if (brl === null || brl === undefined) return "—";
      return window.formatBrl(brl);
    },

    // Classe semântica para colorir delta/decomp.
    sinalClasse(brl) {
      if (brl === null || brl === undefined) return "";
      if (brl > 0) return "is-positive";
      if (brl < 0) return "is-negative";
      return "";
    },

    // Quantidade pt-BR com tabular-nums; ações inteiras, ETF/cripto podem ter casas.
    formatQtyR7d(q) {
      if (q === null || q === undefined || Number.isNaN(q)) return "";
      const digits = Number.isInteger(q) ? 0 : Math.min(4, q.toString().split(".")[1]?.length || 0);
      return new Intl.NumberFormat("pt-BR", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(q);
    },

    // 7a.BK.1: faixa de tolerância da categoria (spec 7a.BK §3.3). Delegam
    // às funções puras de topo (alocFaixa/alocTrilho) — a regra mora lá.
    catFaixa(cat) { return alocFaixa(cat?.peso_alvo, cat?.peso_atual); },
    catTrilho(cat) { return alocTrilho(cat?.peso_alvo, cat?.peso_atual); },
    // "alvo 50,0% · faixa 45,0% a 55,0%"; "" sem alvo ou sem dado (o x-show
    // esconde o elemento pela própria string).
    catFaixaTexto(cat) {
      const f = this.catFaixa(cat);
      if (f.min === null) return "";
      const p = (v) => window.formatPctSemSinal(v, 1);
      return `alvo ${p(cat.peso_alvo)} · faixa ${p(f.min)} a ${p(f.max)}`;
    },
    // Copy fixa do estado (spec 7a.BK §3.3/§3.5). "—" para sem dado.
    rotuloEstado(estado) {
      return {
        abaixo: "Pedindo aporte",
        na_faixa: "Na faixa",
        acima: "Acima da faixa",
        sem_alvo: "Sem alvo",
      }[estado] || "—";
    },

    // 7a.BK.1: acordeão agrupado por estado (spec 7a.BK §3.4). A regra mora
    // na função pura de topo alocAgruparAtivos.
    gruposCategoria(cat) { return alocAgruparAtivos(cat); },
    // Estado da cesta em minúscula, dentro da frase da linha das cestas:
    // "Passivo pedindo aporte (30,0% de 45%)".
    rotuloEstadoCesta(estado) { return (this.rotuloEstado(estado) || "").toLowerCase(); },
    cestaPctTexto(c) {
      return `(${window.formatPctSemSinal(c.atual, 1)} de ${window.formatPctSemSinal(c.alvo, 0)})`;
    },
    // "" quando o R$ arredonda a zero (ex.: cesta em que só o quarentenado
    // está em carteira, valor EW 0): a linha fica com ticker e cesta, sem
    // "faltam R$ 0".
    linhaRsTexto(linha, grupo) {
      if (!(Math.round(Math.abs(linha.rs)) > 0)) return "";
      return (grupo === "pedindo" ? "faltam " : "sobram ") + alocRsCurto(linha.rs);
    },

    // Map nome categoria → token CSS de identidade.
    catCssVar(nome) {
      const map = {
        "Ações BR": "--cat-acoes-br",
        "EUA": "--cat-eua",
        "FII": "--cat-fii",
        "FIIs": "--cat-fii",
        "Cripto": "--cat-cripto",
        "Renda Fixa BR": "--cat-renda-fixa-br",
      };
      return map[nome] || "--g-700";
    },

    catStyleVar(nome) {
      return `--cat: var(${this.catCssVar(nome)});`;
    },

    // Tipo de provento abreviado: "Dividendo" → "Div"; "Rendimento" → "Rend"; "JCP" → "JCP".
    abreviarTipoR7d(tipo) {
      if (!tipo) return "";
      const abrev = { "Dividendo": "Div", "Rendimento": "Rend", "JCP": "JCP" };
      return abrev[tipo] || tipo;
    },

    selecionarMoeda(m) {
      // Schema v2.6: toggle só ativo em escopo=EUA. Para Total/Brasil é no-op.
      if (m !== "BRL" && m !== "USD") return;
      this.moeda = m;
      try { localStorage.setItem("moedaEUA", m); } catch (_) {}
      // 7a.E.14: re-renderizar chart histórico com a série da moeda ativa.
      // hidratarRentabilidade é guardado por (rota === "rentabilidade").
      if (this.escopoAtivo === "EUA") {
        this.hidratarRentabilidade();
      }
    },

    moedaToggleVisivel() {
      // 7a.BD.2: toggle BRL/USD só em escopo EUA, e só com o bloco ponte (que
      // traz a série em dólar); sem ele a tela é o aviso de indisponível.
      if (this.escopoAtivo !== "EUA") return false;
      const ponte = this.json && this.json.ponte;
      return !!(ponte && Array.isArray(ponte.usd));
    },

    get posicaoAtual() {
      if (!this.json || !this.json.posicoes || !this.tickerAtual) return null;
      return (
        this.json.posicoes.find((p) => p.ticker === this.tickerAtual) || null
      );
    },

    // 7a.Q.3: carrega o índice de relatórios mensais (payload cifrado separado).
    // 7a.U Task 6 (CRB round 2): chamadas concorrentes compartilham a promise
    // em voo — mesmo padrão de `carregarIndiceDossies()` (guarda síncrona
    // ANTES do 1º await, então a 2ª chamada no mesmo tick já vê o handle
    // setado). Sem chave: um único índice para todo o app.
    carregarIndiceRelatorios() {
      if (!this.segredo) return Promise.resolve();
      if (this._relIndicePromise) return this._relIndicePromise;
      this._relIndicePromise = (async () => {
        try {
          const resp = await fetch("./relatorios_index.json.enc", { cache: "no-cache" });
          if (!resp.ok) { this.relIndice = null; return; }
          const payloadB64 = (await resp.text()).trim();
          const idx = JSON.parse(await window.decifrar(payloadB64, this.segredo));
          // Race guard: bloquear() (ou o handler storage) pode ter rodado
          // durante o await da decifra. Se o pin sumiu do $data, respeitar o
          // lock e não popular o payload de volta.
          if (!this.segredo) return;
          this.relIndice =
            idx && idx.schema === "relatorios_index_v1" && Array.isArray(idx.meses)
              ? idx
              : null;
        } catch (err) {
          console.warn("índice de relatórios indisponível", err);
          // Race guard (CRB final 7a.U Finding 3): um throw ANTES do guard de
          // sucesso (HTTP != 200, schema inesperado) cai aqui incondicional —
          // sem checar `this.segredo`, um bloquear() no meio do await deixaria a
          // sessão travada com erro fantasma na tela após o unlock.
          if (!this.segredo) return;
          this.relIndice = null; // degradação graciosa — o resto do app segue
        } finally {
          this._relIndicePromise = null;
        }
      })();
      return this._relIndicePromise;
    },

    // 7a.AY: bloco `projecao` v2.29 — UM cenário (premissas prospectivas por
    // classe), faixas por idade. Só é "disponível" com a forma completa: o
    // v2.28 (tem `cenarios`, não tem `faixas`) e `projecao: null` caem em null,
    // e o card some e a rota diz "indisponível hoje" (como na 7a.AV/AW).
    // Board AY.2 (iteração 1): um bloco PARCIAL também cai em null — sem a
    // faixa da idade final, a decomposição, as duas listas do ponteiro ou a
    // fonte das premissas, o template estouraria TypeError (projResposta().p50)
    // em vez de dizer "indisponível hoje".
    get projecao() {
      const p = this.json && this.json.projecao;
      if (!(p && Array.isArray(p.faixas) && p.taxa_central && p.premissas && Array.isArray(p.premissas.classes))) return null;
      // Board AY.2 (iteração 2): exige TODA chave que o template lê sem guarda
      // própria; número tem de ser finito (Number.isFinite), não só presente.
      const num = Number.isFinite;
      if (!num(p.idade_atual) || !num(p.idade_final) || !num(p.ano_final) || !num(p.trajetorias)) return null;
      if (!p.faixas.some((f) => f && f.idade === p.idade_final)) return null;
      if (!p.partida || !num(p.partida.patrimonio)) return null;
      if (!p.aporte || !num(p.aporte.mensal) || !p.aporte.janela || !p.aporte.janela.de || !p.aporte.janela.ate) return null;
      const d = p.decomposicao;
      if (!d || !num(d.partida_crescida) || !num(d.aportes) || !num(d.rendimento_aportes) || !num(d.final)) return null;
      if (!p.premissas.fonte) return null;
      if (!p.ponteiro || !Array.isArray(p.ponteiro.sensibilidade) || !Array.isArray(p.ponteiro.estresse)) return null;
      return p;
    },
    // A faixa da idade final (65): a resposta da tela.
    projFinal() {
      const p = this.projecao;
      return p ? p.faixas.find((f) => f.idade === p.idade_final) || null : null;
    },
    projResposta() {
      const f = this.projFinal();
      return f ? { p50: f.p50, p10: f.p10, p90: f.p90 } : null;
    },
    projCardTexto() {
      const r = this.projResposta();
      return r ? "Aos " + this.projecao.idade_final + ", cerca de " + this.formatBrlCompacto(r.p50) : "";
    },
    // Marcos do gráfico de faixas: 45, 55 e 65 até a idade final, e a idade
    // final SEMPRE (mesmo que deixe de ser 65); só os que ainda estão no futuro
    // (idade > idade_atual) e que a série publicada traz. Lista vazia é estado
    // válido: o capítulo 4 e a tabela da conta final dizem isso em uma linha.
    projMarcos() {
      const p = this.projecao;
      if (!p) return [];
      const idades = [...new Set([...PROJ_MARCOS.filter((i) => i < p.idade_final), p.idade_final])].sort((a, b) => a - b);
      return idades.filter((i) => i > p.idade_atual).map((i) => p.faixas.find((f) => f.idade === i)).filter(Boolean);
    },
    // Eixo de R$ 0 ao teto "redondo" do MAIOR p90 dos marcos desenhados;
    // cada percentil vira % do eixo (sempre dentro de 0-100). `valores` leva
    // os números em R$ para a linha escrita fora do gráfico.
    projFaixas() {
      const ms = this.projMarcos();
      const max = this.projEixoTeto(Math.max(0, ...ms.map((m) => m.p90)));
      const x = (v) => Math.min(100, Math.max(0, (v / max) * 100));
      return {
        max,
        linhas: ms.map((m) => ({
          idade: m.idade, p10: x(m.p10), p25: x(m.p25), p50: x(m.p50), p75: x(m.p75), p90: x(m.p90),
          valores: { p10: m.p10, p50: m.p50, p90: m.p90 },
        })),
      };
    },
    // aria-label de um marco: os cinco percentis por extenso (p25/p75 só
    // existem aqui e no "ver a conta").
    projFaixaLabel(idade) {
      const p = this.projecao, f = p && p.faixas.find((e) => e.idade === idade);
      if (!f) return "";
      const fmt = (v) => this.formatBrlCompacto(v);
      return "Aos " + idade + ", em reais de hoje: 1 em 10 cenários abaixo de " + fmt(f.p10)
        + "; 1 em 4 abaixo de " + fmt(f.p25) + "; mediana " + fmt(f.p50) + "; 3 em 4 abaixo de " + fmt(f.p75)
        + "; 9 em 10 abaixo de " + fmt(f.p90);
    },
    projClasses() {
      const p = this.projecao;
      return p ? p.premissas.classes : [];
    },
    // Linha de fonte: de onde vêm as premissas e quais classes ficaram no
    // histórico (ninguém publica premissa prospectiva para elas).
    projFonteTexto() {
      const p = this.projecao;
      if (!p) return "";
      const f = p.premissas.fonte;
      let t = "Premissas da " + f.nome + " (edição " + f.edicao + ", data-base " + this.projFmtData(f.data_base) + "), em reais.";
      for (const c of p.premissas.classes.filter((e) => e.origem === "historico")) {
        t += " " + c.rotulo + ": histórico " + c.periodo + ", porque ninguém publica premissa prospectiva para eles.";
      }
      return t;
    },
    projDecomposicao() {
      const p = this.projecao;
      if (!p) return [];
      const partes = PROJ_PARTES.map((q) => ({ chave: q.chave, rotulo: q.rotulo, valor: p.decomposicao[q.campo] }));
      // A barra 100% só desenha o que é positivo; uma parcela negativa
      // aparece em texto com sinal, na tabela.
      const total = partes.reduce((s, q) => s + Math.max(0, q.valor), 0);
      return partes.map((q) => ({ ...q, pct: q.valor > 0 && total > 0 ? (q.valor / total) * 100 : 0 }));
    },
    // Spec §4.1: a mediana é o histórico composto; com aportes ela fica quase
    // igual à linha determinística. Acima de 1% de desvio a frase diz "praticamente".
    projPraticamente() {
      const p = this.projecao, f = this.projFinal();
      if (!p || !f || !p.decomposicao.final) return "";
      return Math.abs(f.p50 / p.decomposicao.final - 1) > 0.01 ? "praticamente " : "";
    },
    // O ponteiro como lista: as sensibilidades, depois os cenários hipotéticos.
    projAlavancas() {
      const p = this.projecao;
      if (!p) return [];
      return [
        ...p.ponteiro.sensibilidade.map((s) => ({ nome: s.rotulo, descricao: null, p50: s.p50, delta: s.delta })),
        ...p.ponteiro.estresse.map((e) => ({ nome: e.nome, descricao: e.descricao, p50: e.p50, delta: e.delta })),
      ];
    },
    // Tabela do capítulo 3, uma linha por classe na ordem do payload. Real e
    // líquido arredondados a 1 casa (0,1 p.p.); o desconto EXIBIDO é a
    // diferença dos dois já arredondados, para que real − desconto = líquido
    // feche no que se lê (com o desconto exato arredondado à parte, 3,46/3,24
    // leria 3,5 − 0,2 = 3,2, conta errada na tela). O exato, com 2 casas e a
    // composição, fica no "ver a conta".
    projTabelaClasses() {
      // Valor ausente fica ausente ("—" na tela), nunca vira 0: Math.round(null) daria 0.
      const r1 = (v) => (typeof v === "number" && !Number.isNaN(v) ? Math.round(v * 1000) / 1000 : null);
      return this.projClasses().map((c) => {
        const real = r1(c.retorno_real), liquido = r1(c.retorno_liquido);
        return { classe: c.classe, rotulo: c.rotulo, peso: c.peso, real, liquido,
                 desconto: real == null || liquido == null ? null : Math.round((real - liquido) * 1000) / 1000,
                 composicao: c.desconto_composicao || {} };
      });
    },
    // A linha americana do grifo, lida do payload (null se a classe sair da
    // matriz: o grifo cala a comparação em vez de inventar número).
    projEua() {
      return this.projClasses().find((c) => c.classe === "U.S. Large Cap") || null;
    },
    projHistoricas() { return this.projClasses().filter((c) => c.origem === "historico"); },
    // Pares da matriz de correlação (triângulo superior), com os rótulos em
    // português das classes. Lista em vez de matriz: 6 × 6 não cabe a 320 px.
    projCorrelacoes() {
      const p = this.projecao;
      if (!p) return [];
      const rot = Object.fromEntries(p.premissas.classes.map((c) => [c.classe, c.rotulo]));
      const { classes = [], matriz = [] } = p.premissas.correlacoes || {};
      const pares = [];
      for (let i = 0; i < classes.length; i++)
        for (let j = i + 1; j < classes.length; j++)
          pares.push({ chave: i + "-" + j, nome: (rot[classes[i]] || classes[i]) + " e " + (rot[classes[j]] || classes[j]),
                       rho: matriz && matriz[i] ? matriz[i][j] : null });
      return pares;
    },
    projFmtRho(v) {
      if (typeof v !== "number" || Number.isNaN(v)) return "—";
      return (v < 0 ? "−" : "") + Math.abs(v).toFixed(2).replace(".", ",");
    },
    projFmtTaxa(v, casas = 2) { return v == null || Number.isNaN(v) ? "—" : window.formatPctSemSinal(v, casas); },
    projFmtData(iso) { return iso ? iso.split("-").reverse().join("/") : "—"; },
    // R$ compacto ("R$ 2,4 mi" / "R$ 850 mil" / "R$ 400"). Limiar mil→mi
    // (spec §3.5 item 10, decidido na execução): R$ 1 milhão. Arredonda ANTES
    // de escolher a banda (achado do G2): sem isso 999.600 viraria
    // "R$ 1000 mil". O "—" de valor ausente é o fallback de DADO da casa, não
    // copy; com a projeção completa nenhum valor é nulo.
    formatBrlCompacto(v) {
      if (v == null || Number.isNaN(v)) return "—";
      const a = Math.abs(v), s = v < 0 ? "−" : "";
      const mil = Math.round(a / 1000);
      if (mil >= 1000) return s + "R$ " + (a / 1_000_000).toFixed(1).replace(".", ",") + " mi";
      if (mil >= 1) return s + "R$ " + mil + " mil";
      return s + "R$ " + Math.round(a);
    },
    // Δ com sinal explícito em TEXTO (+/−): a seta ▲/▼ é decorativa
    // (aria-hidden) e a cor nunca carrega a direção sozinha.
    formatDeltaCompacto(v) {
      if (v == null || Number.isNaN(v)) return "—";
      return (v >= 0 ? "+" : "") + this.formatBrlCompacto(v);
    },
    // R$ sem centavos, para a tabela de aporte da projeção. Os valores ali são
    // médias e estimativas mensais (centavo é ruído). Medido a 320 px: o
    // conteúdo de .tela-detalhes tem 232 px; em 4 colunas a tabela media
    // 342 px com centavos e 253 px sem eles (253 > 232), então a TRANSPOSIÇÃO
    // (colunas = antes/depois do marco) também é requisito de largura, não
    // estética: sem ela a tabela volta a transbordar. Reusa window.formatBrl
    // (mesmo Intl), pedindo 0 casas; o guarda de nulo fica aqui porque
    // formatBrl trata null como 0 e aqui ausência não é zero.
    formatBrlInteiro(v) {
      if (v == null || Number.isNaN(v)) return "—";
      return window.formatBrl(v, 0);
    },
    projAnosTotal() { const p = this.projecao; return p ? p.idade_final - p.idade_atual : 0; },
    // 7a.AX: teto "redondo" do eixo do gráfico de faixas — o menor m × 10^k ≥ v
    // com m na escada abaixo. Arredondar à potência de 10 jogaria 10,4 mi para
    // 20 mi e deixaria metade do eixo vazia.
    projEixoTeto(v) {
      if (!(v > 0)) return 1;
      const p = Math.pow(10, Math.floor(Math.log10(v)));
      for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
      return 10 * p;
    },
    projPercentis() { return PROJ_PERCENTIS; },

    // 7a.BJ.2: bloco `renda` v2.32 — quanto a carteira sustenta de renda hoje,
    // no passado e na projeção (src/output/renda_bloco.py). Como na projeção,
    // só é "disponível" com a forma completa: payload < 2.32, `renda: null` ou
    // bloco parcial caem em null (card some, rota diz "indisponível hoje"),
    // nunca em TypeError no template. Número tem de ser finito, não só presente.
    get renda() {
      const j = this.json, r = j && j.renda;
      if (!r || !rent2VersaoAoMenos(j.versao, [2, 32])) return null;
      const num = Number.isFinite;
      const p = r.premissas, h = r.hoje, he = r.heranca;
      if (!p || !num(p.idade_atual) || !num(p.idade_horizonte) || !num(p.probabilidade) || !num(p.piso_heranca_brl)) return null;
      if (!p.fonte || !p.fonte.nome) return null;
      if (!h || !["anual", "mensal", "dividendos_mensal", "vendas_mensal"].every((k) => num(h[k]))) return null;
      if (!(h.variacao_12m_mensal == null || num(h.variacao_12m_mensal))) return null;
      if (!Array.isArray(r.historico) || !r.historico.length || !r.historico.every((x) => x && x.data && num(x.mensal))) return null;
      if (!Array.isArray(r.projecao) || !r.projecao.every((x) => x && num(x.idade) && num(x.ano) && num(x.p10) && num(x.p50) && num(x.p90))) return null;
      if (!Array.isArray(r.marcos)) return null;
      // Board BJ.2: sem cardinalidade fixa (o backend publica 4 choques hoje);
      // o que o template exige é o choque 0, régua dos pisos, e os booleanos.
      if (!Array.isArray(r.guardrails) || !r.guardrails.every((g) => g && num(g.choque) && num(g.patrimonio) && num(g.mensal))) return null;
      if (!r.guardrails.some((g) => g.choque === 0)) return null;
      if (typeof h.proventos_cobrem !== "boolean") return null;
      if (!he || !num(he.mediana_horizonte) || !Array.isArray(he.pisos) || !he.pisos.length) return null;
      if (!he.pisos.every((x) => x && num(x.piso) && num(x.mensal) && typeof x.configurado === "boolean")) return null;
      return r;
    },
    // Renda 0 por piso alto (spec §5.4): a frase do piso toma o lugar do herói.
    rendaZero() { const r = this.renda; return !!r && !(r.hoje.mensal > 0); },
    rendaCardTexto() {
      const r = this.renda;
      if (!r) return "";
      return this.rendaZero() ? "Com o piso atual, ainda não sustenta renda"
        : "Sua carteira já pagaria " + this.formatBrlInteiro(r.hoje.mensal) + " por mês";
    },
    // Chip de 12 meses (reais de cada época, spec §6 a): informa, não celebra.
    // O sinal vai em TEXTO (+/−); a cor do chip é neutra nos dois sentidos.
    rendaChip() {
      const r = this.renda;
      if (!r || this.rendaZero() || r.hoje.variacao_12m_mensal == null) return null;
      // Arredonda o MÓDULO: Math.round(−95,5) daria −95, e o mesmo valor
      // positivo daria 96 (assimetria do JS, achada pelo e2e do chip negativo).
      const v = r.hoje.variacao_12m_mensal, a = Math.round(Math.abs(v));
      if (a === 0) return "Igual a 12 meses atrás";
      return (v < 0 ? "−" : "+") + this.formatBrlInteiro(a) + " por mês em 12 meses";
    },
    // "De onde viria": proventos e vendas por mês. Se os proventos cobrem a
    // renda, uma linha só, 100% proventos.
    rendaOrigem() {
      const r = this.renda;
      if (!r || this.rendaZero()) return [];
      const h = r.hoje, pct = (v) => Math.min(100, Math.max(0, (v / h.mensal) * 100));
      const prov = { chave: "proventos", rotulo: "Dividendos e aluguéis", valor: h.dividendos_mensal, pct: pct(h.dividendos_mensal) };
      if (h.proventos_cobrem) return [{ ...prov, valor: h.mensal, pct: 100 }];
      return [prov, { chave: "vendas", rotulo: "Vendas de cotas", valor: h.vendas_mensal, pct: pct(h.vendas_mensal) }];
    },
    rendaFmtProb() { const r = this.renda; return r ? Math.round(r.premissas.probabilidade * 100) + "%" : ""; },
    // Linhas da projeção que são marcos da tabela (o backend já os filtra para
    // o futuro); marco sem linha publicada sai.
    rendaMarcos() {
      const r = this.renda;
      return r ? r.projecao.filter((l) => r.marcos.includes(l.idade)) : [];
    },
    rendaFinal() { const r = this.renda; return r && r.projecao.length ? r.projecao[r.projecao.length - 1] : null; },
    // Gráfico SVG (viewBox 0..100 nos dois eixos, preserveAspectRatio none,
    // traço com vector-effect: non-scaling-stroke). Tempo em anos fracionários:
    // o passado nas datas da série, a projeção em 31/12 de cada ano. Eixo de
    // R$ 0 ao teto redondo do maior valor desenhado (a escada da projeção). O
    // marcador de hoje é HTML posicionado em %, para não se deformar.
    rendaGrafico() {
      const r = this.renda;
      const vazio = { passado: "", mediana: "", faixa: "", hoje: { x: 0, y: 100 }, teto: 1, inicio: "", fim: "", mostrarInicio: false };
      if (!r) return vazio;
      const anos = (iso) => { const [a, m, d] = iso.split("-").map(Number); return a + (m - 1) / 12 + (d - 1) / 365; };
      const hist = r.historico.map((x) => ({ t: anos(x.data), v: x.mensal }));
      const h = hist[hist.length - 1];
      const proj = r.projecao.map((l) => ({ t: l.ano + 1, p10: l.p10, p50: l.p50, p90: l.p90, idade: l.idade })).filter((l) => l.t > h.t);
      const t0 = hist[0].t, t1 = proj.length ? proj[proj.length - 1].t : h.t;
      const span = t1 - t0 > 0 ? t1 - t0 : 1;
      const teto = this.projEixoTeto(Math.max(0, ...hist.map((x) => x.v), ...proj.map((l) => l.p90)));
      const X = (t) => +(((t - t0) / span) * 100).toFixed(2);
      const Y = (v) => +(100 - Math.min(100, Math.max(0, (v / teto) * 100))).toFixed(2);
      const linha = (pts) => pts.map((p, i) => (i ? "L" : "M") + p[0] + " " + p[1]).join(" ");
      const hoje = [X(h.t), Y(h.v)];
      return {
        passado: linha(hist.map((x) => [X(x.t), Y(x.v)])),
        mediana: proj.length ? linha([hoje, ...proj.map((l) => [X(l.t), Y(l.p50)])]) : "",
        faixa: proj.length ? [hoje, ...proj.map((l) => [X(l.t), Y(l.p90)]), ...proj.slice().reverse().map((l) => [X(l.t), Y(l.p10)])].map((p) => p.join(",")).join(" ") : "",
        hoje: { x: hoje[0], y: hoje[1] },
        teto,
        inicio: r.historico[0].data.slice(0, 4),
        fim: proj.length ? "aos " + proj[proj.length - 1].idade : "",
        // "hoje" perto do começo do eixo colidiria com o ano inicial: o ano sai.
        mostrarInicio: hoje[0] >= 18,
      };
    },
    rendaGraficoLabel() {
      const r = this.renda, f = this.rendaFinal();
      if (!r) return "";
      const ini = r.historico[0];
      let t = "Renda que a carteira sustentaria por mês: " + this.formatBrlInteiro(ini.mensal) + " em "
        + window.formatMesAno(ini.data.slice(0, 7)) + ", " + this.formatBrlInteiro(r.hoje.mensal) + " hoje";
      if (f) t += " e, no cenário central, " + this.formatBrlInteiro(f.p50) + " aos " + f.idade + ", em reais de hoje";
      return t + ".";
    },
    rendaResumo() {
      const r = this.renda, f = this.rendaFinal();
      if (!r) return "";
      const ini = r.historico[0];
      // Mês em prosa: "outubro de 2028" (formatMesAno é rótulo: "Outubro 2028").
      const mes = window.formatMesAno(ini.data.slice(0, 7)).toLowerCase().replace(" ", " de ");
      let t = "Em " + mes + ", o patrimônio de então sustentaria "
        + this.formatBrlInteiro(ini.mensal) + " por mês, em reais da época. Hoje, " + this.formatBrlInteiro(r.hoje.mensal) + ".";
      if (f) t += " Aos " + f.idade + ", no cenário central, " + this.formatBrlInteiro(f.p50) + " por mês, em reais de hoje.";
      return t;
    },
    // Guardrails em reais: +20%, hoje, −20%, −35% (na ordem do backend).
    rendaGuardrails() {
      const r = this.renda;
      if (!r) return [];
      return r.guardrails.map((g) => {
        const pct = Math.round(Math.abs(g.choque) * 100);
        // Curto de propósito: "Se a carteira subir 20%" quebrava em duas linhas
        // a 320 px; a frase de abertura da seção já diz que é a carteira.
        const rotulo = g.choque === 0 ? "Hoje" : "Se " + (g.choque > 0 ? "subir " : "cair ") + pct + "%";
        return { ...g, rotulo };
      });
    },
    // Pisos relativos ao patrimônio de hoje (decisão do Dr. Arthur): sem piso,
    // metade, o patrimônio inteiro, e o configurado quando for outro valor.
    rendaPisos() {
      const r = this.renda;
      if (!r) return [];
      const P = r.guardrails.find((g) => g.choque === 0).patrimonio, H = r.premissas.idade_horizonte;
      const perto = (a, b) => Math.abs(a - b) <= Math.max(1, 0.005 * b);
      return r.heranca.pisos.map((p) => {
        // Rótulo curto: "Deixar R$ 1.200.000" não quebra (espaço inseparável
        // depois do "R$") e, ao lado do valor nowrap, transbordava a 320 px na
        // DejaVu do CI. O valor vai na linha de baixo, que quebra.
        let rotulo = "O seu piso";
        if (p.piso === 0) rotulo = "Sem piso";
        else if (perto(p.piso, P / 2)) rotulo = "Metade do patrimônio";
        else if (perto(p.piso, P)) rotulo = "O patrimônio inteiro";
        const detalhe = p.piso === 0 ? "a carteira só não pode zerar antes dos " + H
          : "deixa ao menos " + this.formatBrlInteiro(p.piso) + " aos " + H;
        // O template só acrescenta "· o seu piso" quando o rótulo ainda não o diz.
        return { ...p, rotulo, detalhe, rotuloDizSeuPiso: rotulo === "O seu piso" };
      });
    },
    rendaHerancaTexto() {
      const r = this.renda;
      if (!r) return "";
      const H = r.premissas.idade_horizonte;
      if (this.rendaZero()) return "Com o piso atual não há renda a sacar; aos " + H + " ficaria ao menos o piso, "
        + this.formatBrlInteiro(r.premissas.piso_heranca_brl) + ", em reais de hoje.";
      return "Sacando " + this.formatBrlInteiro(r.hoje.mensal) + " por mês de hoje até os " + H + ", no cenário central sobrariam "
        + this.formatBrlInteiro(r.heranca.mediana_horizonte) + " aos " + H + ", em reais de hoje.";
    },
    rendaFonteTexto() {
      const r = this.renda;
      if (!r) return "";
      const f = r.premissas.fonte;
      return f.nome + (f.edicao ? " (edição " + f.edicao + ")" : "") + ", em retorno acima da inflação, as mesmas da projeção até os 65.";
    },

    get relUltimoMes() {
      const meses = this.relIndice && this.relIndice.meses;
      return meses && meses.length ? meses[0] : null; // índice é mês DESC
    },

    // 7a.R.3.b: índice de dossiês (payload cifrado separado, decifrado no boot).
    // 404 → [] silencioso: um PWA servido ANTES da primeira publicação continua
    // funcionando, só sem as entradas (spec §5.2/§5.5).
    // Chamadas concorrentes compartilham a promise em voo (ver
    // _dossieIndicePromise). A promise é liberada no fim para que uma
    // navegação posterior possa tentar de novo se a carga não trouxe nada.
    carregarIndiceDossies() {
      if (!this.segredo) return Promise.resolve();
      if (this._dossieIndicePromise) return this._dossieIndicePromise;
      this._dossieIndicePromise = (async () => {
        try {
          const resp = await fetch("./dossies_index.json.enc", { cache: "no-cache" });
          if (!resp.ok) { this.dossieIndice = []; return; }
          const idx = JSON.parse(await window.decifrar((await resp.text()).trim(), this.segredo));
          // Race guard: bloquear() (ou o handler storage) pode ter rodado
          // durante o await da decifra. Se o pin sumiu do $data, respeitar o
          // lock e não popular o payload de volta.
          if (!this.segredo) return;
          this.dossieIndice =
            idx && idx.schema === "dossies_index_v1" && Array.isArray(idx.dossies)
              ? idx.dossies
              : [];
        } catch (err) {
          console.warn("índice de dossiês indisponível", err);
          // Race guard (CRB final 7a.U Finding 3): mesmo racional do loader
          // acima — um throw pré-guard não pode escrever no $data já travado.
          if (!this.segredo) return;
          this.dossieIndice = []; // degradação graciosa — o resto do app segue
        } finally {
          this._dossieIndicePromise = null;
        }
      })();
      return this._dossieIndicePromise;
    },

    entradaDossie(ticker) {
      return (this.dossieIndice || []).find((d) => d.ticker === ticker) || null;
    },

    // Predicado ÚNICO que decide se a entrada aparece (no #ativo e no Relatório).
    temDossie(ticker) {
      return !!this.entradaDossie(ticker);
    },

    // 7a.U Task 6 (CRB round 2): promise em voo POR CHAVE (ticker). Duas
    // chamadas para o MESMO ticker compartilham a requisição/decifra; chaves
    // diferentes NÃO compartilham — cada uma corre em paralelo, mas só a
    // requisição AINDA VIGENTE (CRB final round Finding A) escreve estado:
    // `this._dossiePromise === promessa` é o mesmo guard usado pra limpar o
    // handle no finally, reaplicado ANTES de qualquer escrita em `dossieAtual`/
    // `dossieCarregado`/`dossieErro`. Sem isso, navegando A→B com A ainda em
    // voo, quem RESOLVE por último vencia o estado final (não quem foi pedido
    // por último) — e o finally da requisição alheia apagava o spinner
    // (`dossieCarregando`) da vigente.
    async carregarDossie(ticker) {
      if (this.dossieCarregado === ticker && this.dossieAtual) return; // já carregado
      if (this._dossiePromise && this._dossiePromiseTicker === ticker) {
        return this._dossiePromise; // mesma chave em voo — compartilha
      }
      const entrada = this.entradaDossie(ticker);
      if (!entrada) { // ticker fora do índice → estado vazio, sem fetch às cegas
        // Review final pós-7a.U (Finding 1): esta chamada só chega aqui com
        // uma chave DIFERENTE da que está em voo (a mesma chave já
        // compartilhou/retornou acima). Sem anular os dois handles, a
        // requisição anterior (outro ticker, ainda decifrando) seguia
        // "vigente" pelo critério de identidade (`_dossiePromise ===
        // promessa`) — quando resolvesse, escrevia o dossiê alheio por cima
        // desta tela, e `dossieCarregando` ficava preso em `true` (herdado
        // da requisição anterior) em vez de cair para `.dossie-vazio`.
        this.dossieAtual = null; this.dossieCarregado = ""; this.dossieErro = "";
        this.dossieCarregando = false;
        this._dossiePromise = null;
        this._dossiePromiseTicker = null;
        return;
      }
      this.dossieCarregando = true;
      this.dossieErro = "";
      const promessa = (async () => {
        try {
          const resp = await fetch("./" + entrada.arquivo, { cache: "no-cache" });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const d = JSON.parse(await window.decifrar((await resp.text()).trim(), this.segredo));
          // Race guard: bloquear() (ou o handler storage) pode ter rodado
          // durante o await da decifra. Se o pin sumiu do $data, respeitar o
          // lock e não popular o payload de volta.
          if (!this.segredo) return;
          // Race guard (CRB final round Finding A): esta requisição pode ter
          // sido SUPERADA por uma chamada mais nova para OUTRO ticker enquanto
          // decifrava — se `_dossiePromise` já aponta para outra promise, a
          // vigente já está resolvendo/resolvida e esta não pode sobrescrevê-la.
          if (this._dossiePromise !== promessa) return;
          if (!d || d.schema !== "dossie_empresa_v1") throw new Error("schema inesperado");
          this.dossieAtual = d;
          this.dossieCarregado = ticker;
        } catch (err) {
          console.warn("dossiê indisponível", err);
          // Race guard (CRB final 7a.U Finding 3): idem — sem isso,
          // `dossieErro` sobreviveria ao lock como texto estático (dano
          // cosmético), mas também vira vetor de flake do teste-invariante
          // se um fetch falhar dentro da janela do lock.
          if (!this.segredo) return;
          // Idem guard de superada — um erro de uma requisição já superada
          // não pode apagar o resultado bom que a vigente já escreveu.
          if (this._dossiePromise !== promessa) return;
          this.dossieAtual = null;
          this.dossieCarregado = "";
          this.dossieErro = "Não foi possível abrir o dossiê deste ativo.";
        } finally {
          // Só resolve o estado desta requisição (inclusive o spinner) se
          // AINDA for a vigente — mesmo guard usado pra limpar o handle logo
          // abaixo. Uma requisição SUPERADA que resolve depois não pode
          // apagar `dossieCarregando` da requisição vigente ainda em voo.
          if (this._dossiePromise === promessa) {
            this.dossieCarregando = false;
            this._dossiePromise = null;
            this._dossiePromiseTicker = null;
          }
        }
      })();
      this._dossiePromise = promessa;
      this._dossiePromiseTicker = ticker;
      return promessa;
    },

    async hidratarDossie() {
      if (this.rota !== "dossie") return;
      if (!this.segredo) return; // pré-auth: re-chamado no boot (submitPin/auto-resume)
      if (!this.dossieIndice.length) await this.carregarIndiceDossies();
      // 7a.V (Item E): mesmo guard de `hidratarRelatorio()` — re-checa o pin no
      // ponto onde a função retoma o controle. Hoje o furo é mascarado duas
      // vezes (o choke point zera `dossieTicker` e o índice vazio manda
      // `carregarDossie` pro ramo sem fetch), mas o mascaramento é incidental:
      // basta reclassificar `dossieTicker` como ponteiro-de-hash sobrevivente
      // (o argumento que a ALLOWLIST já aceita para `tickerAtual`) para o
      // trabalho sob lock voltar a acontecer.
      if (!this.segredo) return;
      if (!this.dossieTicker) return;
      await this.carregarDossie(this.dossieTicker);
    },

    // Grava a origem ANTES do hash mudar. As entradas do dossiê são <a href>
    // REAIS (deep-linkáveis, middle-clicáveis) — o handler não navega, só
    // registra de onde viemos e deixa o link fazer o resto. Um método nomeado
    // em vez da expressão inline: são 3 call sites (entrada do #ativo + radar
    // + prestação do Relatório) e um só lugar para mudar o comportamento.
    registrarOrigemDossie() {
      this.dossieOrigem = location.hash || "";
    },

    // URL de fonte só vira link se for http(s). O payload é auto-produzido e
    // cifrado, mas o `href` é o único lugar da tela onde um valor do arquivo
    // vira comportamento do browser — a guarda custa uma linha. Scheme
    // não-http degrada para texto puro (o ramo `x-if` sem link).
    urlFonteSegura(u) {
      return typeof u === "string" && /^\s*https?:\/\//i.test(u) ? u.trim() : null;
    },

    // Descarta o payload decifrado do dossiê da memória. Chamado via
    // `_limparEstadoSensivel()` no lock manual e no logout multi-tab: sessão
    // travada não deve reter a tese das empresas em memória. Segue nomeado (e
    // não absorvido pelo agregador) porque a família tem dono próprio.
    //
    // Review final pós-7a.U (Finding 2): `_dossiePromise`/`_dossiePromiseTicker`
    // TAMBÉM precisam ser anulados aqui, não só o estado visível. Sem isso,
    // uma decifra em voo no instante do lock segue "vigente" pelo critério de
    // identidade de `carregarDossie()` (`this._dossiePromise === promessa`) —
    // e o guard `if (!this.segredo) return` dessa promise só olha o PIN no
    // instante em que ela resolve, não a identidade da sessão. Se o unlock
    // devolver o PIN antes da decifra atrasada terminar (janela estreita, mas
    // real — PBKDF2 pode ser mais lento que a digitação, mas nunca mais
    // rápido que ela indefinidamente), o guard passa e a promise pré-lock
    // escreve o payload decifrado direto no `$data` já destravado (ou pior,
    // ainda travado). Anular os dois aqui fecha essa janela pela raiz: a
    // promise antiga falha o teste de identidade e nunca escreve; o próximo
    // `carregarDossie()` (pós-unlock) não encontra handle "em voo" para
    // compartilhar e refaz o fetch+decifra do zero, com `dossieCarregando`
    // corretamente ligado durante a espera.
    _limparEstadoDossie() {
      this.dossieIndice = [];
      this.dossieAtual = null;
      this.dossieCarregado = "";
      this.dossieTicker = "";
      this.dossieOrigem = "";
      this.dossieErro = "";
      this.dossieCarregando = false;
      this._dossiePromise = null;
      this._dossiePromiseTicker = null;
    },

    // 7a.U — choke point único de higiene de sessão. Os DOIS caminhos de lock
    // (bloquear() manual e o handler do evento `storage`) chamam este método, e
    // só ele: cada família de dado decifrado tem um limpador nomeado, e o
    // agregador é o lugar onde a próxima família entra. Um campo novo que
    // retenha payload sem passar por aqui derruba `lock-higiene.spec.ts`
    // (invariante de snapshot virgem × pós-lock).
    // ── 7a.W.3.a — envelope local ────────────────────────────────────────────
    // `localStorage.envelope` = o SEGREDO cifrado sob o PIN LOCAL, usando as
    // mesmas primitivas do payload (nenhum formato novo, nenhum código novo de
    // cripto). Desbloqueio = desenvelopa com o PIN, decifra o payload com o
    // segredo.
    //
    // O que isto NÃO faz, e precisa estar escrito: não melhora nada contra
    // roubo do aparelho. O `localStorage` guarda o PIN local em claro (é o que
    // faz o auto-resume de 7 dias funcionar sem pedir nada) e o envelope mora
    // ao lado. Quem tiver o celular destravado lê os dois e chega no segredo.
    // Isso é aceitável — o aparelho é o perímetro de confiança — mas é decisão
    // consciente, não problema resolvido. O propósito do envelope é impedir
    // que um segredo de alta entropia seja a coisa digitada no dia a dia
    // (spec §2.3).
    //
    // Custo: DUAS derivações PBKDF2 por unlock em vez de uma (~2× o anterior).
    // Regra de decisão da spec §7.2: se a medição em aparelho real mostrar
    // unlock acima de 3 s, baixar as iterações DO ENVELOPE (não as do payload)
    // para 100k. As duas saídas já estão autorizadas; a medição decide.

    _temEnvelope() {
      const env = localStorage.getItem("envelope");
      return typeof env === "string" && env.length > 0;
    },

    async _criarEnvelope(segredo, pinLocal) {
      const env = await window.cifrar(segredo, pinLocal);
      localStorage.setItem("envelope", env);
    },

    // Devolve o segredo, ou null se o PIN não abre / o envelope está corrompido.
    // NÃO apaga o envelope em caso de falha: PIN errado é erro de digitação, e
    // apagar despareria o aparelho a cada dedo trocado.
    async _abrirEnvelope(pinLocal) {
      const env = localStorage.getItem("envelope");
      if (!env) return null;
      try {
        return await window.decifrar(env, pinLocal);
      } catch (err) {
        // InvalidTag (PIN errado) e base64 inválido (envelope corrompido) caem
        // no mesmo lugar de propósito: do ponto de vista do usuário são o
        // mesmo evento ("não abriu"), e distinguir só daria ao atacante um
        // oráculo de "o envelope existe e é válido".
        console.warn("envelope não abriu", err);
        return null;
      }
    },

    // Migração silenciosa dos aparelhos que já têm sessão (spec §7.1): se
    // existe `pin` e não existe envelope, cria o envelope usando o valor
    // guardado como segredo E como PIN local. Nada é pedido, nada quebra, e o
    // aparelho já entra no modelo novo enquanto o payload ainda está na chave
    // velha.
    //
    // Idempotente por construção (o guard `_temEnvelope()`), o que importa
    // porque `init()` roda em toda carga de página.
    async _migrarSePreciso() {
      const pinGuardado = localStorage.getItem("pin");
      if (!pinGuardado || this._temEnvelope()) return;
      try {
        await this._criarEnvelope(pinGuardado, pinGuardado);
      } catch (err) {
        // Falha na migração não pode trancar ninguém: o caminho de sempre
        // (segredo = valor digitado) continua funcionando sem envelope.
        console.warn("migração do envelope falhou", err);
      }
    },

    // 7a.W.3.a — o segredo DESENVELOPADO é estado sensível e sai no lock,
    // como o `pin` já saía. Nomeado (e não inline no `bloquear()`) para que os
    // DOIS caminhos de lock o percam: o manual e o handler do evento
    // `storage`. O `envelope` em localStorage NÃO entra aqui — ver
    // `limparSessao()`.
    _limparSegredo() {
      this.segredo = "";
    },

    _limparEstadoSensivel() {
      this._limparSegredo();
      this._limparEstadoDossie();
      this._limparEstadoRelatorio();
      this._limparEstadoAporte();
      this._descartarGraficos();
      this._limparEstadoProventosDY();
      this._limparEstadoAlocacao();
      this._limparEstadoAppShell();
    },

    // CRB final 7a.U (Finding 1): estado de SELEÇÃO das telas #proventos e
    // #s-dy — não é o payload em si (isso é `json`), mas aponta para "qual
    // pedaço do payload está em foco" e por isso é LIMPO, não justificado na
    // allowlist (é derivado do conteúdo, não preferência/infra/ponteiro de
    // hash). `proventosMesSelecionado` é o índice do drilldown mensal
    // (7a.E.18); `dySelecionado` é a categoria em foco no pódio de campeões
    // de #s-dy (7a.S.7b). Os dois voltam ao literal `null` da declaração —
    // `atualizarRota()`/`hidratarDY()` repopulam `dySelecionado` sozinhos se
    // a sessão destravar de volta em `#/proventos/dy` (mesmo padrão do
    // dossiê/Relatório); `proventosMesSelecionado` só repopula com um clique
    // novo do Dr. Arthur, por design (não é deep-linkável).
    //
    // Review final pós-7a.U (Finding 3): `proventosToggle` é a mesma classe
    // de decisão dos dois campos acima — seleção em memória de qual corte do
    // payload está em foco (Origem × Mensal, 7a.E.18), não-persistida. Não
    // era limpo nem justificado na ALLOWLIST: escapava do teste-invariante
    // porque o roteiro de `lock-higiene.spec.ts` nunca aciona o toggle
    // (`setProventosToggle`/`hidratarProventos` são os únicos escritores).
    // Volta ao literal exato da declaração (`proventosToggle: "origem"`) —
    // o mesmo valor que `hidratarProventos()` já usa ao (re)entrar na tela.
    _limparEstadoProventosDY() {
      this.proventosMesSelecionado = null;
      this.dySelecionado = null;
      this.proventosToggle = "origem";
    },

    // CRB final 7a.U (Finding 1): quais categorias o Dr. Arthur tem abertas
    // em #alocação (7a.E.31) — mesma classe de decisão do limpador acima
    // (derivado do payload, não preferência persistida). Volta ao objeto
    // vazio literal da declaração, que já é o comportamento documentado da
    // tela (todas as categorias nascem fechadas, sem hidratação especial).
    //
    _limparEstadoAlocacao() {
      this.catAberta = {};
    },

    // 7a.Q.3: o artefato `relatorio_mensal_v1` do mês aberto (prosa + radar +
    // prestação de contas, com valores da carteira). `relRead` NÃO é limpo —
    // meses lidos são metadado de leitura, e o dot de "não lido" sobrevive ao
    // lock por design (7a.S.9).
    //
    // Review final pós-7a.U (Finding 2): mesmo racional de `_limparEstadoDossie()`
    // acima — `_relMesPromise`/`_relMesPromiseAlvo` precisam ser anulados
    // aqui, não só `relMes`/`relIndice`. Sem isso, uma decifra do mês em voo
    // no instante do lock segue "vigente" pelo critério de identidade de
    // `carregarRelatorioMes()`, e o guard `if (!this.segredo) return` dessa
    // promise só olha o PIN no instante da resolução — se o unlock devolver o
    // PIN antes da decifra atrasada terminar, o payload pré-lock atravessa o
    // lock. Anular os dois aqui faz a promise antiga falhar o teste de
    // identidade (`this._relMesPromise !== promessa`) e força o próximo
    // `carregarRelatorioMes()` a refazer o fetch+decifra do zero.
    _limparEstadoRelatorio() {
      this.relIndice = null;
      this.relMes = null;
      this.relMesAtual = "";
      this.relRotaMes = null;
      this.relErro = "";
      this.relCarregando = false;
      this.relSeletorAberto = false;
      this._relMesPromise = null;
      this._relMesPromiseAlvo = null;
    },

    // 7a.H.1/7a.S.10: a simulação (R$ por categoria, por ticker, cotas).
    // `aporteScrubMax` fica: é configuração da régua do scrubber, não dado da
    // carteira.
    //
    // CRB final round (Finding D): o localStorage `aporte.valor`/`aporte.ts`
    // (TTL 24h, ver `hidratarAportar()`) NÃO é tocado aqui, de propósito —
    // é entrada do usuário persistida (mesma classe de `tema`/`moeda`), não
    // payload decifrado. `submitPin()` chama `atualizarRota()` no unlock, que
    // re-hidrata #aportar quando essa é a rota corrente e repovoa o plano a
    // partir do valor persistido. Comportamento correto: o que o lock
    // descarta é o PLANO derivado (calculado sobre `json`, que É limpo); o
    // valor digitado volta como preferência do usuário, não como dado da
    // carteira retido em memória.
    _limparEstadoAporte() {
      this.aporteValor = "";
      this.aporteBanner = null;
      this.aporteCategoriasRecebedoras = [];
      this.aporteCategoriasNaoRecebedoras = [];
      this.aportePausados = [];
      this.aporteTickersSemPosicao = [];
      if (this._aporteRevelados) this._aporteRevelados.clear();
      this._aportePresetPendente = null;
      this.aporteMercado = "tudo";
      this.aporteSobra = 0;
    },

    // Par dispose()/disconnect() do gráfico de #proventos. Chamado tanto do
    // cleanup no topo de renderProventosGrafico() quanto de
    // _descartarGraficos() — um só idioma de descarte, um só lugar por par:
    // uma mudança futura no render (ex. novo listener, trocar o container)
    // não fica esquecida no caminho do lock, que é o que importa para
    // segurança (CRB Task 5 Finding 2/7a.U).
    _descartarProv() {
      if (this.echartsProv) { try { this.echartsProv.dispose(); } catch (_) {} this.echartsProv = null; }
      if (this.resizeObserverProv) { try { this.resizeObserverProv.disconnect(); } catch (_) {} this.resizeObserverProv = null; }
    },
    // Idem para o gráfico de #patrimonio.
    _descartarPatr() {
      if (this.echartsPatr) { try { this.echartsPatr.dispose(); } catch (_) {} this.echartsPatr = null; }
      if (this.resizeObserverPatr) { try { this.resizeObserverPatr.disconnect(); } catch (_) {} this.resizeObserverPatr = null; }
    },
    // Idem para o gráfico de #rentabilidade — o único dos 3 que registra um
    // listener custom (chart.on("datazoom", aoMoverZoom), dentro de
    // hidratarRentabilidade()).
    // dispose() derruba a instância inteira e leva o listener junto, então
    // nenhum chart.off("datazoom") explícito é necessário aqui; mas se esse
    // padrão mudar um dia (ex. listener vivendo num objeto externo ao chart,
    // sobrevivendo ao dispose), este é o lugar a atualizar — realocado do
    // helper de #proventos, que nunca teve esse listener (CRB final 7a.U
    // Finding 6).
    _descartarRent() {
      if (this.echartsRent) { try { this.echartsRent.dispose(); } catch (_) {} this.echartsRent = null; }
      if (this.resizeObserverChart) { try { this.resizeObserverChart.disconnect(); } catch (_) {} this.resizeObserverChart = null; }
      // 7a.BD.2: o settle do arrasto mora fora do chart (setTimeout) — sem
      // cancelar, dispararia sobre um chart já descartado.
      if (this._rent2SettleTimer) { clearTimeout(this._rent2SettleTimer); this._rent2SettleTimer = null; }
      this._rent2ViaBotao = false;
      // Quem tira a classe de arrasto é o settle; cancelado o settle, tira
      // aqui — senão ela fica na seção (x-show só esconde) e as transições
      // seguem desligadas até o próximo arrasto terminar.
      const tela = document.querySelector(".tela-rentabilidade");
      if (tela) tela.classList.remove("is-arrastando");
    },
    // Agrega o descarte dos 3 gráficos (a projeção teve ECharts de 7a.AV.2 a 7a.AW.2; saiu na 7a.AX) (cada um via seu próprio helper — o
    // agregado continua POR-GRÁFICO; nenhum helper chama este método de
    // volta, senão um render sozinho descartaria os outros dois indevidamente)
    // + os derivados do render que carregam número da carteira: `_rentCtx`
    // (bloco ponte + retornos mensais do escopo), `proventosTotal*` (soma em
    // R$ das barras exibidas) e `rent2` (a vista da ponte: números, ativos de
    // "quem pesou", reais). O estado derivado fica só aqui — os helpers não o
    // tocam, os renders o repovoam em seguida.
    _descartarGraficos() {
      this._descartarProv();
      this._descartarPatr();
      this._descartarRent();
      this._rentCtx = null;
      this.proventosTotalLabel = "";
      this.proventosTotalValor = 0;
      this.rent2 = rent2Vazio();
    },

    // Fechamento de escopo 7a.U: `escopoAtivo` (seletor Total/Brasil/EUA,
    // 7a.E.13) e `toast` (banner de notificação) são estado de APP-SHELL —
    // não pertencem a nenhuma família de tela existente, e por isso ficavam
    // no LIMBO: nem limpos pelo choke point, nem justificados na ALLOWLIST.
    // `escopoAtivo` cai não porque o conteúdo seja sensível (vocabulário
    // fixo de 3 strings, não deriva do payload) — cai porque limbo é
    // exatamente a condição que produz o PRÓXIMO campo esquecido; a decisão
    // é registrar cada campo como limpo ou justificado, nunca como "nenhum
    // dos dois". `toast` cai porque `mostrarToast()` embute
    // `formatDataHora(atualizado_em)` do payload na mensagem
    // (`avaliarAtualizacao()`) — depois que o toast se esconde, só
    // `visible` vira `false`; `mensagem` persiste com o texto derivado do
    // payload.
    //
    // Review final pós-7a.U (Finding 4): o nome anterior deste método
    // (`_limparEstadoEscopoEToast`) enumerava os dois campos de HOJE em vez
    // de nomear a família — e este método é justamente o ponto de entrada
    // para o PRÓXIMO campo de app-shell que aparecer (mesmo racional do
    // parágrafo acima, aplicado ao próprio nome). Um nome-inventário ou
    // envelhece mentindo (campo novo entra e o nome já não cobre) ou força
    // um rename a cada adição — `_limparEstadoAppShell` nomeia o CRITÉRIO
    // ("estado de app-shell", já usado acima), não o inventário.
    //
    // Review final pós-7a.U (Finding 5): `toast.timer` é handle de
    // `setTimeout` (mesma classe de `_escListenerProventos`) e é cancelado
    // ANTES de reatribuir `this.toast` —
    // mas NÃO pelo motivo que uma versão anterior deste comentário afirmava
    // ("o callback em voo escreveria em `toast`, que já é outro objeto,
    // deixando um timer órfão"): o callback de `mostrarToast()` é
    // `() => { this.toast.visible = false; }`, que resolve `this.toast`
    // dinamicamente no INSTANTE do disparo (não por closure sobre o objeto
    // antigo) — sem o clearTimeout, ele escreveria no objeto NOVO (já
    // `visible: false`), o que é inofensivo. O motivo real é mais forte: um
    // timer sobrevivente do toast pré-lock dispararia MAIS TARDE, já numa
    // sessão destravada, e esconderia PREMATURAMENTE um toast LEGÍTIMO
    // mostrado depois do unlock (ex.: "Carteira atualizada") antes da
    // duração normal de 3s expirar.
    _limparEstadoAppShell() {
      this.escopoAtivo = "Total";
      if (this.toast && this.toast.timer) clearTimeout(this.toast.timer);
      this.toast = { visible: false, mensagem: "", tom: "verde", timer: null };
    },

    voltarDoDossie() {
      // Mesmo racional de voltar(): replaceState + atualizarRota, NUNCA
      // history.back() (em link compartilhado, back sai do PWA). A diferença é
      // o destino: voltar() mapeia tab → home da seção e perderia o ticker;
      // aqui o destino é a origem literal. Deep-link direto (sem origem) cai
      // no #ativo do próprio ticker.
      const fallback = this.dossieTicker ? "#ativo/" + this.dossieTicker : "";
      const destino = this.dossieOrigem || fallback;
      this.dossieOrigem = "";
      history.replaceState(null, "", destino || location.pathname);
      this.atualizarRota();
    },

    // O dossiê carrega o vocabulário do BACKEND (o bootstrap copia
    // `posicoes_view.classe`: "Ação BR"/"Exterior"/"FII"/"Cripto"/"Renda Fixa
    // BR"), que NÃO é o vocabulário da política lido por catCssVar
    // ("Ações BR"/"EUA"/...). Sem esta ponte o dot cairia no fallback --g-700 e
    // TODA categoria ficaria teal. catCssVar NÃO muda: ele é do #alocação.
    dossieCatStyle(categoria) {
      const ponte = { "Ação BR": "Ações BR", "Exterior": "EUA" };
      return this.catStyleVar(ponte[categoria] || categoria);
    },

    dossieBandeira(escopo) {
      return escopo === "EUA" ? "🇺🇸" : "🇧🇷";
    },

    // Sub-linha do cabeçalho: "nome · categoria". Em 29 dos 39 dossiês reais
    // `nome` É o próprio ticker (o bootstrap não tinha razão social a copiar),
    // e repeti-lo logo sob o ticker em corpo grande é ruído — nesses casos
    // sobra só a categoria.
    get dossieSubtitulo() {
      const d = this.dossieAtual;
      if (!d) return "";
      const nome = (d.nome || "").trim();
      const cat = (d.categoria || "").trim();
      const partes = nome && nome.toUpperCase() !== String(d.ticker || "").toUpperCase()
        ? [nome, cat] : [cat];
      return partes.filter(Boolean).join(" · ");
    },

    // Mini-mapa do arco: um glifo de veredito por ENTRADA, em ordem
    // cronológica — o arco de 2 anos lido em um segundo, antes de qualquer
    // scroll. O RÓTULO do ano sai só na primeira entrada de cada ano: 12 dos
    // 39 dossiês reais têm mais de uma entrada no mesmo ano (KNRI11 tem três
    // em 2026) e "2026 2026 2026" gagueja sem informar nada. O par .sr-only
    // (dossieArcoTexto) segue nomeando o ano de TODAS, senão a leitura
    // auditiva perde a ancoragem temporal.
    // Ano por `slice` da data ISO (NÃO `new Date`: data sem hora vira
    // meia-noite UTC e volta um dia em America/Sao_Paulo).
    get dossieArco() {
      let anterior = null;
      return (this.dossieAtual?.timeline || []).map((e) => {
        const selo = this.vereditoSelo(e.veredito);
        const ano = String(e.data || "").slice(0, 4);
        const rotuloAno = ano === anterior ? "" : ano;
        anterior = ano;
        return { ano, rotuloAno, marca: selo.marca, label: selo.label };
      });
    },

    // Par .sr-only do mini-mapa: forma + texto, nunca cor sozinha.
    get dossieArcoTexto() {
      return this.dossieArco.map((p) => `${p.ano} ${p.label.toLowerCase()}`).join(", ");
    },

    // Memória viva envelhece em silêncio — a tela diz a idade dela. A âncora é
    // a data da ÚLTIMA entrada da timeline (existe sempre que há timeline). A
    // cláusula de verificação leve é ADITIVA e condicional: 28 dos 39 dossiês
    // reais têm `ultima_verificacao_leve: null`, então um "sem verificação
    // leve" apareceria na maioria das telas e leria como defeito — quando é o
    // estado normal (o carimbo é do motor /relatorio-mensal, não uma obrigação
    // de todo dossiê).
    get dossieFrescor() {
      const tl = this.dossieAtual?.timeline || [];
      if (!tl.length) return "";
      let s = `última leitura em ${window.formatDataIso(tl[tl.length - 1].data)}`;
      const uv = this.dossieAtual?.ultima_verificacao_leve;
      if (uv) s += ` · verificação leve em ${window.formatDataIso(uv)}`;
      return s;
    },

    // 7a.AD.2 — "esta tese pede revisão": estado DERIVADO do payload que já é
    // publicado (`tese.revisada_em` + a `timeline`). Nada é gravado no dossiê:
    // um campo no cabeçalho seria mutável pelo agente unattended e exigiria
    // alargar a fronteira de ingestão que a 7a.X fechou. O selo aparece sozinho
    // quando o confronto dispara e some sozinho quando o Dr. Arthur revisa a
    // tese, porque `revisada_em` avança — não há estado a limpar.
    //
    // O `|| ""` NÃO é defensivo: `abrir_dossie` cria a tese placeholder com
    // `revisada_em: null`, e em JS `"2026-09-06" > null` avalia FALSO — o
    // dossiê NUNCA revisado com confronto disparado, que é o caso mais urgente,
    // ficaria sem selo. Com `|| ""`, "nunca revisada" ordena como infinitamente
    // antiga. Espelha `tese_pede_revisao` (src/output/dossie_empresa.py).
    get dossiePedeRevisao() {
      const d = this.dossieAtual;
      if (!d) return false;
      const revisada = (d.tese && d.tese.revisada_em) || "";
      return (d.timeline || []).some(
        (e) => e && e.confronto_tese && e.confronto_tese.estado === "disparado"
          && String(e.data || "") > revisada,
      );
    },

    // `dividend_yield` → `DIVIDEND YIELD`. O rótulo é DERIVADO da chave: as
    // chaves de numeros_reportados são heterogêneas por tipo de ativo (FII,
    // ação, ETF), então não há tabela fixa a manter.
    rotuloNumero(chave) {
      return String(chave || "").replace(/_/g, " ").toUpperCase();
    },

    // numeros_reportados é `dict OU list` no schema (validar_dossie aceita os
    // dois; os 39 dossiês reais usam dict). Normaliza para pares — a lista
    // entra sem rótulo, e o <dt> vazio some no template.
    paresNumeros(nr) {
      if (!nr) return [];
      if (Array.isArray(nr)) return nr.map((v) => ({ rotulo: "", valor: String(v) }));
      return Object.entries(nr).map(([k, v]) => ({
        rotulo: this.rotuloNumero(k), valor: String(v),
      }));
    },

    bandeiraDaPosicao(p) {
      if (!p) return "";
      return p.moeda === "USD" ? "🇺🇸" : "🇧🇷";
    },

    // 7a.E.1: abrevia o lado do movimento para 1-3 chars com semantic class.
    // B/S são vermelho/verde; demais lados ficam neutros mas legíveis.
    formatarLado(lado) {
      const mapa = {
        "Compra":      { texto: "B",   classe: "lado-B"      },
        "Venda":       { texto: "S",   classe: "lado-S"      },
        "Subscrição":  { texto: "Sub", classe: "lado-neutro" },
        "Direito":     { texto: "Dir", classe: "lado-neutro" },
        "Desdobro":    { texto: "Spl", classe: "lado-neutro" },
        "Atualização": { texto: "Atu", classe: "lado-neutro" },
        "Fração":      { texto: "Fra", classe: "lado-neutro" },
        "Cessão":      { texto: "Ces", classe: "lado-neutro" },
        "Exercido":    { texto: "Exe", classe: "lado-neutro" },
        "Não Exercido":{ texto: "NEx", classe: "lado-neutro" },
      };
      return mapa[lado] || { texto: lado, classe: "lado-neutro" };
    },

    // 7a.E.31: categorias da vista #alocação unificada ordenadas por peso_alvo
    // decrescente (renomeia categoriasAlvoOrdenadas da 7a.E.29). .slice() copia
    // o array reativo do json antes do sort — nunca o muta. peso_alvo ausente
    // resolve 0 (categoria cai pro fim). Sort estável; empate por nome.
    get categoriasAlocacaoOrdenadas() {
      const cats =
        (this.json && this.json.politica && this.json.politica.categorias) || [];
      return cats
        .slice()
        .sort((a, b) => (b.peso_alvo || 0) - (a.peso_alvo || 0) || a.nome.localeCompare(b.nome));
    },

    // 7a.BK.1: frase-resumo do topo (spec 7a.BK §3.2). "" quando nenhuma
    // categoria é classificável — o x-show usa a própria string.
    get alocFrase() {
      return alocFraseResumo(this.categoriasAlocacaoOrdenadas);
    },

    // 7a.BK.1: categorias ABAIXO da faixa, na ordem da lista. Alimenta o
    // grifo e o guard de irSimularAporteAlvo (spec 7a.BK §3.2, decisão (c)).
    get alocCategoriasAbaixo() {
      return (this.categoriasAlocacaoOrdenadas || []).filter(
        (c) => alocFaixa(c.peso_alvo, c.peso_atual).estado === "abaixo",
      );
    },

    // Texto do grifo; "" sem categoria abaixo da faixa — x-show usa a MESMA
    // string. Entra por x-text: um nome de categoria com "<" aparece literal.
    get alocGrifoTexto() {
      const abaixo = this.alocCategoriasAbaixo;
      if (!abaixo.length) return "";
      // Copy aprovada verbatim (spec 7a.BK §3.2, §4(h)): sem ponto final.
      return "Próximo aporte vai para " + alocListaNomes(abaixo.map((c) => c.nome));
    },

    // Deep-link cross-screen: preset = último aporte (mesmo valor do
    // hero-chip "Repetir" em #aportar) — não recalcula um "aporte ideal"
    // pro gap, só sugere um ponto de partida familiar pro simulador.
    irSimularAporteAlvo() {
      if (!this.alocCategoriasAbaixo.length) return;
      const total = (this.json && this.json.ultimo_aporte && this.json.ultimo_aporte.total_brl) || 0;
      this._aportePresetPendente = total;
      location.hash = "#aportar";
    },

    // ── #proventos ──────────────────────────────────────────────────

    get totalProventosOrigem() {
      const evol = this.json?.proventos?.evolucao_anual || [];
      return evol.reduce((acc, e) => acc + (e.total || 0), 0);
    },

    tabelaProventosAtual() {
      const prov = this.json?.proventos || {};
      // 7a.E.18: quando Mensal + mês selecionado, filtra para por_ativo do mês.
      if (
        this.proventosToggle === "mensal" &&
        this.proventosMesSelecionado !== null
      ) {
        const m12 = prov.mensal_12m || [];
        const entry = m12[this.proventosMesSelecionado];
        if (!entry) return [];
        // Normaliza shape {ticker, valor} → {ticker, total} pra colar com o
        // template existente que usa item.total. Preserva bandeira e tipo
        // (7a.O.2): o aluguel de ações entra como entrada própria tipo
        // "Aluguel", que coexiste com o dividendo do mesmo ticker no mês.
        return (entry.por_ativo || []).map((a) => ({
          ticker: a.ticker,
          total: a.valor,
          bandeira: a.bandeira,
          tipo: a.tipo,
        }));
      }
      return this.proventosToggle === "origem"
        ? (prov.por_ativo_origem || [])
        : (prov.por_ativo_12m || []);
    },

    // 7a.E.18: rótulo "Maio/2026" do mês selecionado.
    proventosMesLabel() {
      const idx = this.proventosMesSelecionado;
      if (idx === null) return "";
      const m12 = this.json?.proventos?.mensal_12m || [];
      const entry = m12[idx];
      if (!entry || !entry.mes) return "";
      const [ano, mes] = entry.mes.split("-");
      const nomes = [
        "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
        "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro",
      ];
      const nomeMes = nomes[parseInt(mes, 10) - 1] || "";
      return `${nomeMes}/${ano}`;
    },

    setProventosToggle(modo) {
      this.proventosToggle = modo;
      this.proventosMesSelecionado = null; // 7a.E.18: troca de modo limpa drill
      this.renderProventosGrafico();
    },

    hidratarProventos() {
      if (this.rota !== "proventos" || !this.json) return;
      this.proventosToggle = "origem";
      this.proventosMesSelecionado = null;
      // 7a.E.18: Esc limpa o drill enquanto a tela #proventos está visível.
      if (!this._escListenerProventos) {
        this._escListenerProventos = (evt) => {
          if (
            evt.key === "Escape" &&
            this.rota === "proventos" &&
            this.proventosMesSelecionado !== null
          ) {
            this.proventosMesSelecionado = null;
            this.renderProventosGrafico();
          }
        };
        document.addEventListener("keydown", this._escListenerProventos);
      }
      this.$nextTick(() => this.renderProventosGrafico());
    },

    renderProventosGrafico() {
      const prov = this.json?.proventos || {};
      const container = document.getElementById("proventos-grafico");
      if (!container) return;

      // Cleanup
      this._descartarProv();
      container.innerHTML = "";

      let labels, valores;
      if (this.proventosToggle === "origem") {
        const evol = prov.evolucao_anual || [];
        labels = evol.map((e) => String(e.ano));
        valores = evol.map((e) => e.total);
        // 7a.S.7b: linha-razão "Total · <anoInicio>–<anoFim>" — soma exata
        // das barras exibidas (nunca um agregado independente do gráfico).
        this.proventosTotalLabel = evol.length
          ? `Total · ${evol[0].ano}–${evol[evol.length - 1].ano}`
          : "Total";
      } else {
        const m12 = prov.mensal_12m || [];
        const meses = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
        labels = m12.map((e) => {
          const [yy, mm] = (e.mes || "").split("-");
          const idx = parseInt(mm, 10) - 1;
          return (idx >= 0 && idx <= 11) ? `${meses[idx]}/${yy.slice(2)}` : (e.mes || "");
        });
        valores = m12.map((e) => e.valor);
        this.proventosTotalLabel = "Total · 12 meses";
      }
      this.proventosTotalValor = valores.reduce((acc, v) => acc + (v || 0), 0);

      const notaParcialEl = document.getElementById("proventosNotaParcial");

      if (!labels.length) {
        container.innerHTML = '<p class="placeholder">Sem dados de proventos.</p>';
        if (notaParcialEl) notaParcialEl.textContent = "";
        return;
      }
      if (typeof echarts === "undefined" || !window.drarthurChart) {
        container.innerHTML = '<p class="placeholder">Não foi possível renderizar o gráfico.</p>';
        if (notaParcialEl) notaParcialEl.textContent = "";
        return;
      }

      const ehMensal = this.proventosToggle === "mensal";
      const mesSelecionado = ehMensal ? this.proventosMesSelecionado : null;

      const dc = window.drarthurChart;
      const formatBRL = (v) => {
        if (v == null) return "—";
        if (v >= 1000) return "R$ " + (v / 1000).toFixed(0) + "k";
        return "R$ " + Math.round(v);
      };

      // 7a.S.3 Task 3: a última barra do array é sempre o bucket em curso
      // (ano corrente em Anual, mês corrente em Mensal) — honestidade de
      // dado, independente da data real do sistema (ver DESIGN.md).
      const ultimoIdx = valores.length - 1;

      // barData: aplica fade + destaque quando há seleção, e hachura na
      // barra parcial (persiste independente da seleção — é atributo do
      // dado, não do estado de interação).
      const barData = valores.map((v, i) => {
        const item = { value: v };
        const ehParcial = i === ultimoIdx;
        let color = dc.tokens.g700;
        let opacity = 1.0;
        if (mesSelecionado !== null && i !== mesSelecionado) {
          opacity = 0.55;
        } else if (mesSelecionado !== null && i === mesSelecionado) {
          color = dc.tokens.g900;
          opacity = 1.0;
        } else if (ehParcial) {
          opacity = 0.65;
        }
        item.itemStyle = { color, opacity };
        if (ehParcial) item.itemStyle.decal = DECAL_PARCIAL;
        return item;
      });

      if (notaParcialEl) {
        notaParcialEl.textContent = `${labels[ultimoIdx]} em curso — hachura · toque numa barra para ler`;
      }

      const chart = echarts.init(container, "drarthur", { renderer: "canvas" });
      const self = this;

      const option = {
        grid: { top: 10, right: 8, bottom: 24, left: 8, containLabel: true },
        tooltip: Object.assign({}, dc.tooltipBase, {
          trigger: "item",
          formatter: (p) => dc.tooltipFormatterAxis([{
            axisValueLabel: p.name,
            seriesName: "Proventos",
            color: dc.tokens.g700,
            value: p.value,
          }], formatBRL),
        }),
        xAxis: { type: "category", data: labels },
        yAxis: { type: "value", axisLabel: { formatter: formatBRL } },
        series: [{
          name: "Proventos",
          type: "bar",
          data: barData,
          barWidth: "60%",
          itemStyle: { color: dc.tokens.g700 },
        }],
        aria: { enabled: true },
      };
      Object.assign(option, dc.motionConfig);

      try {
        chart.setOption(option);
      } catch (err) {
        console.warn("ECharts proventos falhou; placeholder", err);
        chart.dispose();
        container.innerHTML = '<p class="placeholder">Não foi possível renderizar o gráfico.</p>';
        return;
      }

      // 7a.E.18: handler de click — só no modo Mensal
      container.classList.remove("is-clickable");
      if (ehMensal) {
        chart.on("click", function (params) {
          if (params && params.componentType === "series") {
            self._handleClickBarraMes(params.dataIndex);
          }
        });
        // Cursor pointer no container (não no canvas — ECharts pode trocar canvas no resize)
        container.classList.add("is-clickable");
      }

      // 7a.E.18: hint "Toque na mesma barra ou Esc para limpar"
      const hint = document.getElementById("proventosHintLimpar");
      if (hint) hint.hidden = !(ehMensal && mesSelecionado !== null);

      // 7a.E.18: companion buttons a11y
      this._renderCompanionMesesA11y();

      if (typeof ResizeObserver !== "undefined") {
        this.resizeObserverProv = new ResizeObserver(() => {
          try { chart.resize(); } catch (_) {}
        });
        this.resizeObserverProv.observe(container);
      }

      this.echartsProv = chart;
    },

    // 7a.E.18: handler de click no gráfico — agora recebe dataIndex direto do ECharts
    _handleClickBarraMes(idx) {
      const m12 = this.json?.proventos?.mensal_12m || [];
      if (idx === null || idx === undefined || idx < 0 || idx >= m12.length) return;
      if (this.proventosMesSelecionado === idx) {
        this.proventosMesSelecionado = null;
      } else {
        this.proventosMesSelecionado = idx;
      }
      this.renderProventosGrafico();
    },

    // 7a.E.18: lista de <button> visualmente oculta com 12 meses; foco visível.
    _renderCompanionMesesA11y() {
      const ul = document.getElementById("proventosMesesA11y");
      if (!ul) return;
      if (this.proventosToggle !== "mensal") {
        ul.innerHTML = "";
        return;
      }
      const m12 = this.json?.proventos?.mensal_12m || [];
      const nomes = [
        "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
        "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro",
      ];
      ul.innerHTML = m12
        .map((entry, idx) => {
          const [ano, mes] = (entry.mes || "").split("-");
          const nome = nomes[parseInt(mes, 10) - 1] || "";
          const valor = (entry.valor || 0).toLocaleString("pt-BR", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });
          const label = (entry.valor || 0) > 0
            ? `${nome} de ${ano}, R$ ${valor}, toque para detalhar`
            : `${nome} de ${ano}, sem proventos, toque para detalhar`;
          return `<li><button type="button" data-idx="${idx}" aria-label="${label}">${nome}</button></li>`;
        })
        .join("");
      const self = this;
      ul.querySelectorAll("button").forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = parseInt(btn.dataset.idx, 10);
          if (self.proventosMesSelecionado === idx) {
            self.proventosMesSelecionado = null;
          } else {
            self.proventosMesSelecionado = idx;
          }
          self.renderProventosGrafico();
        });
      });
    },

    // ── 7a.S.7b: #s-dy (Dividend Yield — tela dedicada) ───────────────

    // Entrada na rota: escolhe a categoria default do pódio de campeões —
    // a de MAIOR dy entre os 3 sub-escopos (empty-safe: fica null se os 3
    // vierem sem dado, ou se dividend_yield ainda não existir no payload).
    hidratarDY() {
      if (this.rota !== "dy" || !this.json) return;
      const dy = this.json?.dividend_yield || {};
      let melhor = null;
      let melhorValor = -Infinity;
      ["fii", "acao_br", "eua"].forEach((key) => {
        const v = dy[key]?.dy;
        if (typeof v === "number" && v > melhorValor) {
          melhorValor = v;
          melhor = key;
        }
      });
      this.dySelecionado = melhor;
    },

    // As 3 linhas por classe (ordem do mockup: FII, Ação BR, EUA·USD) com a
    // largura da barra proporcional ao maior dy entre elas.
    dyClassesLista() {
      const dy = this.json?.dividend_yield || {};
      const linhas = [
        { key: "fii", nm: "FII" },
        { key: "acao_br", nm: "Ação BR" },
        { key: "eua", nm: "EUA · USD" },
      ].map((l) => ({ ...l, dy: dy[l.key]?.dy ?? null }));
      const max = Math.max(0.0001, ...linhas.map((l) => l.dy || 0));
      return linhas.map((l) => ({
        ...l,
        barPct: Math.max(0, ((l.dy || 0) / max) * 100),
      }));
    },

    selecionarDY(key) {
      this.dySelecionado = key;
    },

    // Campeões (0-3 itens) da categoria selecionada. Empty-safe: `campeoes`
    // pode não existir ainda (payload antigo pré-7a.S.7a) ou a categoria
    // pode vir com lista vazia — em ambos os casos retorna [].
    dyCampeoesAtuais() {
      if (!this.dySelecionado) return [];
      const campeoes = this.json?.dividend_yield?.campeoes || {};
      return campeoes[this.dySelecionado] || [];
    },

    dyCampeoesLabelAtual() {
      const map = { fii: "FII", acao_br: "Ação BR", eua: "EUA · USD" };
      return map[this.dySelecionado] || "";
    },

    // Largura da barra de cada campeão, proporcional ao maior dy da lista atual.
    dyBarPctCampeao(item) {
      const lista = this.dyCampeoesAtuais();
      const max = Math.max(0.0001, ...lista.map((p) => p.dy || 0));
      return Math.max(0, ((item.dy || 0) / max) * 100);
    },

    // Formata o valor de mercado do campeão na moeda nativa do item — BRL
    // (Ação BR/FII) ou USD (EUA, USD-nativo, sem conversão FX).
    formatMoedaCampeao(valor, moeda) {
      if (moeda === "USD") {
        return new Intl.NumberFormat("en-US", {
          style: "currency", currency: "USD",
        }).format(valor ?? 0);
      }
      return window.formatBrl(valor);
    },

    // ── 7a.E.6: Histórico patrimonial ─────────────────────────────────
    patrimonioAtual() {
      const ev = this.json?.patrimonio?.evolucao || [];
      if (!ev.length) return 0;
      return ev[ev.length - 1].total_brl ?? 0;
    },

    aporteCumulativo() {
      const ev = this.json?.patrimonio?.evolucao || [];
      if (!ev.length) return 0;
      return ev[ev.length - 1].aportes_acum_brl ?? 0;
    },

    retornoAcumuladoBrl() {
      return this.patrimonioAtual() - this.aporteCumulativo();
    },

    retornoAcumuladoPctTexto() {
      const a = this.aporteCumulativo();
      if (!a) return "—";
      const pct = (this.patrimonioAtual() / a) - 1;
      return window.formatPct(pct, 1);
    },

    hidratarPatrimonio() {
      if (this.rota !== "patrimonio" || !this.json) return;
      this.$nextTick(() => this.renderPatrimonioGrafico());
    },

    // 7a.Q.3: hidratação + lazy-load + navegação do relatório mensal
    async hidratarRelatorio() {
      if (this.rota !== "relatorio") return;
      if (!this.json || !this.segredo) return; // pré-auth: re-chamado no boot
      if (!this.relIndice) await this.carregarIndiceRelatorios();
      // 7a.V (Item E): re-checa o pin no ponto onde a função RETOMA o controle
      // depois de ceder o thread. O guard não pertence a `carregarRelatorioMes`
      // — ela já protege o próprio ciclo de vida (7a.U) e não pode saber que
      // não deveria ter sido CHAMADA. Sem esta linha, um lock durante o await
      // acima deixava a continuação disparar fetch + decifra PBKDF2 com pin
      // vazio numa sessão travada, e o erro emergia depois do unlock.
      if (!this.segredo) return;
      const alvo = this.relRotaMes || (this.relUltimoMes ? this.relUltimoMes.mes : null);
      if (!alvo) { this.relMes = null; this.relMesAtual = ""; this.relErro = ""; return; }
      await this.carregarRelatorioMes(alvo);
    },

    // 7a.U Task 6 (CRB round 2): promise em voo POR CHAVE (mês) — mesmo
    // desenho de `carregarDossie()` acima, inclusive o guard de requisição
    // SUPERADA (CRB final round Finding A): chave diferente não compartilha,
    // mas só a requisição AINDA VIGENTE (`this._relMesPromise === promessa`)
    // pode escrever `relMes`/`relMesAtual`/`relErro` ou zerar o spinner.
    async carregarRelatorioMes(mes) {
      if (this.relMesAtual === mes && this.relMes) return; // já carregado
      if (this._relMesPromise && this._relMesPromiseAlvo === mes) {
        return this._relMesPromise; // mesma chave em voo — compartilha
      }
      const entrada = (this.relIndice && this.relIndice.meses || []).find((m) => m.mes === mes);
      const arquivo = entrada ? entrada.arquivo : `relatorio_${mes}.json.enc`;
      this.relCarregando = true;
      this.relErro = "";
      const promessa = (async () => {
        try {
          const resp = await fetch("./" + arquivo, { cache: "no-cache" });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const art = JSON.parse(await window.decifrar((await resp.text()).trim(), this.segredo));
          // Race guard: bloquear() (ou o handler storage) pode ter rodado
          // durante o await da decifra. Se o pin sumiu do $data, respeitar o
          // lock e não popular o payload de volta.
          if (!this.segredo) return;
          // Race guard (CRB final round Finding A): idem carregarDossie() —
          // uma chamada mais nova para OUTRO mês pode ter sobrescrito
          // `_relMesPromise` enquanto esta decifrava; se já não é mais a
          // vigente, esta resolução está SUPERADA e não escreve estado.
          if (this._relMesPromise !== promessa) return;
          if (!art || art.schema !== "relatorio_mensal_v1") throw new Error("schema inesperado");
          this.relMes = art;
          this.relMesAtual = mes;
          this._marcarMesLido(mes);
        } catch (err) {
          console.warn("relatório do mês indisponível", err);
          // Race guard (CRB final 7a.U Finding 3): idem carregarDossie() —
          // `relErro` fantasma pós-unlock é o mesmo risco de flake.
          if (!this.segredo) return;
          // Idem guard de superada — não sobrescreve o resultado bom da
          // requisição vigente com o erro de uma já superada.
          if (this._relMesPromise !== promessa) return;
          this.relMes = null;
          this.relErro = "Não foi possível abrir o relatório deste mês.";
        } finally {
          // Só resolve o estado desta requisição (inclusive o spinner) se
          // AINDA for a vigente — mesma lógica de `carregarDossie()`.
          if (this._relMesPromise === promessa) {
            this.relCarregando = false;
            this._relMesPromise = null;
            this._relMesPromiseAlvo = null;
          }
        }
      })();
      this._relMesPromise = promessa;
      this._relMesPromiseAlvo = mes;
      return promessa;
    },

    selecionarMesRelatorio(mes) {
      this.relSeletorAberto = false;
      location.hash = "#/raiox/relatorio/" + mes; // hashchange → atualizarRota → hidrata
    },

    voltarDoRelatorio() {
      location.hash = "";
    },

    // 7a.S.9 Task 2: evento mensal — dot "não lido". mesLido é lido a cada
    // render (Alpine re-avalia x-show); _marcarMesLido persiste em
    // localStorage e é best-effort (quota/privado não deve quebrar o app).
    mesLido(mes) {
      // CRB: guarda defensiva (belt-and-suspenders com a coerção no init) —
      // this.relRead sempre deve ser objeto, mas nunca faz null[mes].
      return !!(mes && this.relRead && this.relRead[mes]);
    },
    _marcarMesLido(mes) {
      if (!mes || this.relRead[mes]) return;
      this.relRead = { ...this.relRead, [mes]: true };
      try { localStorage.setItem("relRead", JSON.stringify(this.relRead)); } catch (_) {}
    },

    // 7a.S.9 Task 1: mês em poster ("Maio" / "2026") — deriva de formatMesAno,
    // sem novo parsing de data (evita duplicar a tabela _MESES_PT de format.js).
    get relPosterMes() {
      const s = this.relMes ? window.formatMesAno(this.relMes.mes) : "";
      return s ? s.split(" ")[0] : "";
    },
    get relPosterAno() {
      const s = this.relMes ? window.formatMesAno(this.relMes.mes) : "";
      return s ? s.split(" ")[1] : "";
    },

    // 7a.S.9 Task 1 — "linha de veredito" da capa editorial: SEM FABRICAR
    // DADO (Confiança nos Números). O artefato relatorio_mensal_v1 não tem
    // campo veredito/headline/resumo dedicado (ver validar_artefato no repo
    // principal) — deriva-se da 1ª frase da seção "leitura_mes" ("Leitura do
    // mês"), o panorama narrativo do mês já escrito pelo motor /relatorio-mensal.
    // Texto 100% literal do artefato; só o rótulo "Veredito do mês:" é UI.
    get relVeredito() {
      const secoes = (this.relMes && this.relMes.secoes) || [];
      const leitura = secoes.find((s) => s && s.id === "leitura_mes");
      return leitura ? this._primeiraFrase(leitura.corpo) : "";
    },

    // Primeira frase de um texto: até o 1º '.'/'!'/'?' seguido de espaço ou
    // fim de string. Pontos de milhar pt-BR ("R$ 3.240") não têm espaço após
    // o ponto, então não quebram a frase indevidamente.
    _primeiraFrase(texto) {
      if (!texto) return "";
      // 7a.AT.1: tira `**` ANTES de cortar a frase — um negrito contendo ponto
      // cortaria a frase no lugar errado, e a capa não renderiza marcação.
      const limpo = String(texto).replace(/\*\*/g, "");
      const m = limpo.match(/^.*?[.!?](?=\s|$)/);
      return m ? m[0] : limpo;
    },

    // 7a.Q.3: helpers de renderização das seções
    // 7a.S.9 Task 3: nao_funcionando ganha .grifo--amber (S.1) — a colocação
    // canônica do Apêndice B (Relatório = âmbar), distinta do grifo accent
    // (.grifo, sinal diferente — nunca lem como o mesmo). .rel-secao--destaque
    // segue só com o layout (radius/padding/gap); a cor vem do grifo--amber.
    classeSecao(id) {
      if (id === "leitura_mes") return "rel-secao--manchete";
      if (id === "nao_funcionando") return "rel-secao--destaque grifo--amber";
      return "";
    },

    vereditoSelo(v) {
      if (v === "sob_pressao")
        return { label: "Sob pressão", marca: "◐", classe: "rel-selo--pressao" };
      if (v === "deteriorando")
        return { label: "Deteriorando", marca: "▽", classe: "rel-selo--deteriorando" };
      return { label: "Tese intacta", marca: "●", classe: "rel-selo--intacta" };
    },

    radarFiltrado(apenasAtencao) {
      const r = (this.relMes && this.relMes.radar) || [];
      return apenasAtencao ? r.filter((x) => x.veredito !== "intacta") : r;
    },

    // 7a.AT.1 — marcação mínima (spec §3.4): parágrafo, lista `- `, negrito
    // `**`, citação `[n]`. Nada além disso.
    //
    // ORDEM É SEGURANÇA: `_escHtml` roda ANTES de negrito e de `[n]`. O texto
    // vem do agente unattended e é conteúdo, não template — inverter a ordem
    // deixaria `<img onerror>` autorado virar nó vivo. `*` e `[` não são
    // tocados pelo escape, então a marcação sobrevive a ele intacta.
    _escHtml(s) {
      return String(s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    },

    // Allowlist POSITIVA e ancorada. Uma denylist de `javascript:` é furada por
    // maiúsculas, espaços e entidades; `^https?://` só deixa passar o que é
    // literalmente http(s). Defeito anterior a esta fase, corrigido aqui porque
    // a fase reescreve a função que injeta o href.
    _hrefCitacaoSegura(url) {
      const u = String(url || "").trim();
      return /^https?:\/\//i.test(u) ? u : "#rel-evidencias";
    },

    // Inline: negrito e citação sobre texto JÁ escapado.
    // `[^*]+` no negrito: não-guloso por construção, e `**` órfão fica literal.
    // `porId === null` = esta tela NÃO linkifica: o `[n]` fica texto literal.
    _inlineParaHtml(texto, porId) {
      const comNegrito = String(texto).replace(
        /\*\*([^*]+)\*\*/g, (m, t) => `<strong>${t}</strong>`);
      if (porId === null) return comNegrito;
      return comNegrito.replace(/\[(\d+)\]/g, (m, n) => {
        const c = porId[parseInt(n, 10)];
        const url = this._hrefCitacaoSegura(c && c.url);
        const href = this._escHtml(url);
        // `target="_blank"` só quando o destino é EXTERNO. O fallback
        // `#rel-evidencias` é âncora da própria página: abri-la em aba nova
        // seria abrir o app de novo em vez de rolar até as fontes.
        const alvo = url === "#rel-evidencias"
          ? "" : ` target="_blank" rel="noopener"`;
        return `<a class="rel-cit" href="${href}"${alvo} `
             + `aria-label="Fonte ${n}">[${n}]</a>`;
      });
    },

    // Blocos: linha em branco separa blocos (como antes). DENTRO de um bloco,
    // linhas consecutivas com `- ` viram <ul>; linhas sem marcador viram <p>
    // unidas por espaço — que é o que o navegador já fazia com quebra simples,
    // então relatório ANTIGO renderiza exatamente como antes.
    _blocosParaHtml(texto, porId) {
      const normalizado = String(texto || "")
        .replace(/\r\n?/g, "\n")
        // Uma linha só com espaço/tab NÃO produz `\n\n` literal, então o split
        // abaixo a atravessaria e fundiria os dois blocos num parágrafo só.
        // Esvaziá-la antes faz a separação valer para o que o autor viu como
        // linha em branco.
        .replace(/[ \t]+$/gm, "");
      const html = [];
      normalizado.split(/\n{2,}/).forEach((bloco) => {
        let paragrafo = [];
        let itens = [];
        const fecharParagrafo = () => {
          if (!paragrafo.length) return;
          html.push(`<p>${this._inlineParaHtml(paragrafo.join(" "), porId)}</p>`);
          paragrafo = [];
        };
        const fecharLista = () => {
          if (!itens.length) return;
          const lis = itens
            .map((t) => `<li>${this._inlineParaHtml(t, porId)}</li>`).join("");
          html.push(`<ul class="rel-lista">${lis}</ul>`);
          itens = [];
        };
        bloco.split("\n").forEach((linhaCrua) => {
          const linha = this._escHtml(linhaCrua.trim());
          if (!linha) return;
          // `linha === "-"` é o marcador SEM conteúdo: a normalização de espaço
          // à direita, logo acima, já comeu o espaço que o separava do vazio.
          // Sem este ramo ele cairia em parágrafo e a tela mostraria um traço
          // solto — que foi o que o teste desta borda pegou.
          if (linha === "-" || linha.startsWith("- ")) {
            fecharParagrafo();
            // Item sem conteúdo não vira `<li></li>` vazio: marcador sozinho é
            // ruído do autor, e um item mudo na tela é saída degradada em
            // silêncio.
            const conteudo = linha === "-" ? "" : linha.slice(2).trim();
            if (conteudo) itens.push(conteudo);
          } else {
            fecharLista();
            paragrafo.push(linha);
          }
        });
        fecharParagrafo();
        fecharLista();
      });
      return html.join("");
    },

    prosaParaHtml(corpo, citacoes) {
      const porId = {};
      (citacoes || []).forEach((c) => { porId[c.id] = c; });
      return this._blocosParaHtml(corpo, porId);
    },

    // A `leitura` do dossiê usa a MESMA marcação, com `[n]` ficando TEXTO
    // LITERAL. `porId` vazio não basta: o replace ainda rodaria e produziria
    // `href="#rel-evidencias"` — uma âncora que não existe nesta tela e que,
    // neste SPA, É ROTA: tocar nela mudaria `location.hash` e engataria a
    // re-derivação de rota da 7a.U. Medido em 17/09/2026: 7 das 188 entradas
    // reais de timeline já têm `[n]` na `leitura`, então o caso é corrente, não
    // hipotético. Daí o `porId` ser `null` e não `{}` — a distinção entre "não
    // achei a citação" e "esta tela não linkifica".
    leituraParaHtml(texto) {
      return this._blocosParaHtml(texto, null);
    },

    // O selo da prestação só sai para veredito CONHECIDO. `vereditoSelo`
    // devolve "Tese intacta" para qualquer valor não-reconhecido (fallback que
    // o radar e o dossiê dependem), então mostrar o selo sem checar antes
    // renderizaria o selo mais OTIMISTA para um erro de digitação.
    temSeloVeredito(v) {
      return v === "intacta" || v === "sob_pressao" || v === "deteriorando";
    },

    renderPatrimonioGrafico() {
      const ev = this.json?.patrimonio?.evolucao || [];
      const container = document.getElementById("patrimonio-grafico");
      if (!container) return;

      // Cleanup
      this._descartarPatr();
      container.innerHTML = "";

      if (!ev.length) {
        container.innerHTML = '<p class="placeholder">Sem histórico de patrimônio.</p>';
        return;
      }
      if (typeof echarts === "undefined" || !window.drarthurChart) {
        container.innerHTML = '<p class="placeholder">Não foi possível renderizar o gráfico.</p>';
        return;
      }

      const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
      const xLabels = ev.map((e) => {
        const d = new Date(e.data + "T00:00:00");
        return MESES[d.getMonth()] + "/" + String(d.getFullYear()).slice(2);
      });
      const totais = ev.map((e) => e.total_brl);
      const aportes = ev.map((e) => e.aportes_acum_brl);

      const formatBRL = (v) => {
        if (v == null) return "—";
        const a = Math.abs(v);
        if (a >= 1_000_000) return "R$ " + (v / 1_000_000).toFixed(1) + "M";
        if (a >= 1000) return "R$ " + Math.round(v / 1000) + "k";
        return "R$ " + Math.round(v);
      };

      const dc = window.drarthurChart;
      const chart = echarts.init(container, "drarthur", { renderer: "canvas" });
      const eixoY = calcularEixoYAncorado(totais, aportes);

      const option = {
        grid: { top: 10, right: 24, bottom: 60, left: 8, containLabel: true },
        tooltip: Object.assign({}, dc.tooltipBase, {
          trigger: "axis",
          formatter: (params) => dc.tooltipFormatterAxis(params, formatBRL),
        }),
        legend: {
          data: ["Patrimônio", "Aporte acum."],
          bottom: 28,
          icon: "circle",
          itemWidth: 8,
          itemHeight: 8,
          textStyle: { color: dc.tokens.gray, fontSize: 11, fontFamily: dc.fontFamily },
        },
        xAxis: {
          type: "category",
          data: xLabels,
          boundaryGap: false,
          axisLabel: {
            interval: Math.max(0, Math.floor(xLabels.length / 6) - 1),
            hideOverlap: true,
          },
        },
        yAxis: { type: "value", min: eixoY.min, max: eixoY.max, axisLabel: { formatter: formatBRL } },
        dataZoom: criarDataZoomInstrumento(dc),
        series: [
          {
            name: "Patrimônio", type: "line", data: totais, smooth: false,
            lineStyle: { width: 2.5 }, showSymbol: false,
            // 7a.S.3: markPoint fixo no ÚLTIMO ponto real (= patrimônio de hoje),
            // âncora ABSOLUTA — diferente do markPoint period-relative da rentabilidade
            // (que reancora no aoMoverZoom). Ao dar zoom numa janela passada o rótulo
            // sai de vista de propósito: rotular um ponto passado como se fosse "hoje"
            // enganaria. Assimetria intencional (CRB 7a.S.3 general-swe).
            markPoint: criarMarkPointUltimo(totais, formatBRL, dc.tokens.g700, dc.fontFamily),
            markLine: eixoY.cruzaZero ? {
              silent: true, symbol: "none", label: { show: false },
              lineStyle: { type: "dashed", color: dc.tokens.gray, width: 1, opacity: 0.5 },
              data: [{ yAxis: 0 }],
            } : undefined,
          },
          {
            name: "Aporte acum.", type: "line", data: aportes, smooth: false,
            lineStyle: { type: [6, 4], width: 1.8 }, showSymbol: false,
          },
        ],
        aria: { enabled: true },
      };
      Object.assign(option, dc.motionConfig);

      try {
        chart.setOption(option);
      } catch (err) {
        console.warn("ECharts patrimonio falhou; placeholder", err);
        chart.dispose();
        container.innerHTML = '<p class="placeholder">Não foi possível renderizar o gráfico.</p>';
        return;
      }

      if (typeof ResizeObserver !== "undefined") {
        this.resizeObserverPatr = new ResizeObserver(() => {
          try { chart.resize(); } catch (_) {}
        });
        this.resizeObserverPatr.observe(container);
      }

      this.echartsPatr = chart;
    },

    // ── 7a.BD.2: #rentabilidade como ponte ──────────────────────────────
    // Monta a tela a partir do bloco `ponte` do payload (v2.30). Todo número
    // vem de ponteJanela/ponteJanelasFixas; botão e arrasto passam pela MESMA
    // função (spec §4.5), então nunca discordam. Sem o bloco (payload antigo
    // em cache do SW), a tela diz que está indisponível e oferece recarregar;
    // nunca desenha a tela antiga (spec §6). dispose+init a cada entrada na
    // rota, troca de escopo ou de moeda (padrão dos três gráficos).
    // Porta única da hidratação: uma falha ao montar a ponte (ex. classe nova
    // no payload, mais novo que o app) fica NESTA tela — loga e mostra o
    // estado indisponível. Sem isso a exceção subia ao try do auto-resume,
    // cujo catch trata "payload não abriu" e mandava para a tela da frase.
    hidratarRentabilidade() {
      try {
        this._hidratarRentabilidade();
      } catch (err) {
        console.error("rentabilidade: falha ao montar a ponte", err);
        this._descartarRent();
        this._rentCtx = null;
        // Estado próprio: um erro de conta/render não pode se passar por
        // payload de versão antiga ("versao") nem por ponte não publicada.
        this.rent2 = { ...rent2Vazio(), semBloco: "erro" };
      }
    },

    _hidratarRentabilidade() {
      if (this.rota !== "rentabilidade" || !this.json) return;
      const target = document.getElementById("chart-rent2");
      this._descartarRent();
      this._rentCtx = null;
      const chaveAnterior = this.rent2.chave;
      const bloco = this.json.ponte;
      // 7a.BG.1: a ponte só vale a partir da 2.31 (cripto fora da carteira). Um
      // payload 2.30, em cache do SW, ainda traz a linha Cripto e o BTC: cai no
      // estado "versão" (recarregar traz o payload novo), nunca no de "erro".
      const v231 = rent2VersaoAoMenos(this.json.versao, [2, 31]);
      if (!v231 || !bloco || !Array.isArray(bloco.meses) || bloco.meses.length < 2) {
        // Payload v2.31+ com `ponte: null`: o builder do backend falhou nesta
        // publicação (recarregar não resolve). Sem a chave (schema antigo, em
        // cache do SW): recarregar traz o payload novo.
        this.rent2 = { ...rent2Vazio(), semBloco: v231 && "ponte" in this.json ? "nulo" : "versao" };
        if (target) target.innerHTML = "";
        return;
      }
      const escopo = this.escopoAtivo;
      const moeda = escopo === "EUA" && this.moeda === "USD" ? "USD" : "BRL";
      const nTotal = bloco.meses.length - 1;
      const m0 = Math.max(ponteInicioEscopo(bloco, escopo, moeda), 1);
      const estado = rent2Vazio();
      // Janela fixa escolhida antes sobrevive à troca de escopo/moeda; o
      // período livre volta ao padrão (12 meses). A linha tocada volta ao
      // padrão (a que mais tirou).
      estado.chave = chaveAnterior || "12m";
      if (m0 > nTotal) {
        estado.vista = { indisponivel: rent2MotivoTexto("sem histórico no escopo"), subtitulo: "", ariaGrafico: "" };
        this.rent2 = estado;
        if (target) target.innerHTML = "";
        return;
      }
      const fixas = ponteJanelasFixas(bloco, escopo, moeda);
      // A fixa trazida de outro escopo/moeda pode não existir aqui (histórico
      // mais curto, ou um buraco no caminho): volta a 12 meses e diz por quê,
      // em vez de deixar marcado um botão desabilitado e a tela sem números.
      if (estado.chave !== "12m" && fixas[estado.chave].indisponivel) {
        estado.motivo = rent2MotivoTexto(fixas[estado.chave].indisponivel);
        estado.chave = "12m";
      }
      estado.janelas = RENT2_JANELAS.map(([chave, rotulo]) => ({
        chave,
        rotulo: chave === "desde" ? rent2RotuloDesde(bloco, m0) : rotulo,
        disponivel: !fixas[chave].indisponivel,
        motivo: rent2MotivoTexto(fixas[chave].indisponivel),
      }));
      // Retornos mensais do escopo, para as curvas: ponteJanela de um mês só.
      const rP = new Array(nTotal + 1).fill(null);
      const rI = new Array(nTotal + 1).fill(null);
      for (let t = m0; t <= nTotal; t++) {
        const r = ponteJanela(bloco, escopo, moeda, t, t);
        if (!r.indisponivel) { rP[t] = r.sua; rI[t] = r.ind; }
      }
      const off = m0 - 1;
      this._rentCtx = { bloco, escopo, moeda, nTotal, m0, off, rP, rI, ultimaValida: null, pendente: null };

      // Janela inicial: a fixa escolhida. Se ela começa antes do histórico, o
      // gráfico mostra o histórico inteiro e a tela diz o motivo (não troca de
      // janela em silêncio).
      let [iIni, iFim] = rent2IndicesFixa(estado.chave, nTotal, m0);
      this.rent2 = estado;
      if (iIni < m0) {
        [iIni, iFim] = [m0, nTotal];
        const vista = this._rent2Aplicar(iIni, iFim, rent2ChaveDe(iIni, iFim, nTotal, m0));
        this.rent2.chave = estado.chave;
        this.rent2.vista = { ...vista, indisponivel: rent2MotivoTexto(fixas[estado.chave].indisponivel) };
        this._rent2Anunciar();
      } else {
        this._rent2Aplicar(iIni, iFim, estado.chave);
      }

      if (!target) return;
      target.innerHTML = "";
      if (typeof echarts === "undefined" || !window.drarthurChart) {
        target.innerHTML = '<p class="placeholder">Não foi possível renderizar o gráfico.</p>';
        return;
      }
      const dc = window.drarthurChart;
      const xLabels = bloco.meses.slice(off).map(rent2MmmAa);
      const [cart, ind] = rent2Curvas(rP, rI, off, nTotal, iIni, iFim);
      const fmtPct = rent2FmtCurva;
      const marcas = rent2MarcadoresFim(cart, ind, fmtPct, dc);
      const zoom = criarDataZoomInstrumento(dc).map((z) => {
        const { start, end, ...resto } = z;
        return { ...resto, startValue: iIni - 1 - off, endValue: iFim - off };
      });
      const chart = echarts.init(target, "drarthur", { renderer: "canvas" });
      const option = {
        // 7a.BG.2: right 20 → 28. O rótulo do fim de curva é centrado no último
        // ponto, que fica na borda direita do grid; com o contorno, um "−17,6%"
        // tem ~42 px e passava 1 px da borda do canvas (medido pela caixa do
        // zrender). 28 comporta até ~56 px ("−99,9%" com folga).
        grid: { top: 28, right: 28, bottom: 40, left: 8, containLabel: true },
        tooltip: Object.assign({}, dc.tooltipBase, {
          trigger: "axis",
          formatter: (params) => dc.tooltipFormatterAxis(params, fmtPct),
        }),
        legend: { show: false },
        xAxis: {
          type: "category",
          data: xLabels,
          boundaryGap: false,
          axisLabel: { hideOverlap: true },
        },
        // 7a.BG.2: folga embaixo só quando o rótulo `bottom` precisa
        // (rent2FolgaEixoY). Em cima, a margem do grid (top: 28) já comporta o
        // rótulo `top`.
        yAxis: {
          type: "value",
          boundaryGap: rent2FolgaEixoY(cart, ind),
          axisLabel: { formatter: (v) => rent2PctPts(v * 100).replace(",0%", "%") },
        },
        dataZoom: zoom,
        series: [
          {
            name: "Sua carteira", type: "line", data: cart, smooth: false, showSymbol: false, connectNulls: false,
            lineStyle: { width: 2.5, color: dc.tokens.g700 }, itemStyle: { color: dc.tokens.g700 },
            markPoint: marcas.cart,
          },
          {
            name: "Mesma carteira, só com índices", type: "line", data: ind, smooth: false, showSymbol: false,
            connectNulls: false,
            lineStyle: { width: 1.8, type: [5, 5], color: dc.tokens.gray }, itemStyle: { color: dc.tokens.gray },
            markPoint: marcas.ind,
          },
        ],
        // 7a.BG.2: sem a descrição automática do ECharts. Ela grava o próprio
        // aria-label (em inglês, com as frações cruas) no MESMO contêiner, depois
        // do binding do Alpine, e o aria que diz os dois números (rent2Vista +
        // _rent2Aplicar) sumia ao abrir a tela. O contêiner é role="img" e o
        // único escritor do aria-label é o :aria-label do index.html.
        aria: { enabled: false },
      };
      Object.assign(option, dc.motionConfig);
      try {
        chart.setOption(option);
      } catch (err) {
        console.warn("ECharts rentabilidade falhou; placeholder", err);
        chart.dispose();
        target.innerHTML = '<p class="placeholder">Não foi possível renderizar o gráfico.</p>';
        return;
      }
      if (typeof ResizeObserver !== "undefined") {
        this.resizeObserverChart = new ResizeObserver(() => {
          try { chart.resize(); } catch (_) {}
        });
        this.resizeObserverChart.observe(target);
      }
      chart.on("datazoom", () => this._rent2AoMoverZoom());
      this.echartsRent = chart;
    },

    // Aplica a janela iIni..iFim: calcula a vista e, se válida, vira a última
    // janela aceita (para onde o arrasto volta se terminar num mês sem dado).
    // Devolve a vista (null fora de contexto).
    // `r` opcional: a saída de ponteJanela já calculada para esta janela (o
    // arrasto a calcula para saber se é indisponível), para não refazer a
    // conta inteira — XIRR com bissecção incluso — a cada evento de zoom.
    _rent2Aplicar(iIni, iFim, chave, r = null) {
      const ctx = this._rentCtx;
      if (!ctx) return null;
      if (!r) r = ponteJanela(ctx.bloco, ctx.escopo, ctx.moeda, iIni, iFim);
      const vista = rent2Vista(r, iIni, iFim, {
        bloco: ctx.bloco, escopo: ctx.escopo, moeda: ctx.moeda, chave, m0: ctx.m0,
        linhaUsuario: this.rent2.linhaUsuario,
      });
      // 7a.BG.2: o aria do gráfico diz os dois números do fim das curvas, das
      // MESMAS curvas que _rent2Curvas desenha para esta janela (também na vista
      // indisponível: o rótulo segue a curva desenhada, cortada no buraco).
      const [cart, ind] = rent2Curvas(ctx.rP, ctx.rI, ctx.off, ctx.nTotal, iIni, iFim);
      const { textoCart, textoInd } = rent2TextosFim(cart, ind, rent2FmtCurva);
      vista.ariaGrafico = `${vista.ariaGrafico}. Sua carteira ${textoCart}; só com índices ${textoInd}.`;
      this.rent2.iIni = iIni;
      this.rent2.iFim = iFim;
      this.rent2.chave = chave;
      this.rent2.vista = vista;
      if (!vista.indisponivel) ctx.ultimaValida = [iIni, iFim, chave];
      if (!this.rent2.arrastando) this._rent2Anunciar();
      return vista;
    },

    // Texto das regiões aria-live (sr-only). Escrito fora do arrasto e no
    // settle — nunca a cada evento de zoom, que inundaria o leitor de tela;
    // a parte visual troca direto, sem esperar (brief §5).
    _rent2Anunciar() {
      const v = this.rent2.vista;
      if (!v) { this.rent2.anuncio = ""; this.rent2.anuncioPesou = ""; return; }
      if (v.indisponivel) { this.rent2.anuncio = v.indisponivel; this.rent2.anuncioPesou = ""; return; }
      const numero = v.numero.replace(/[▲▼]\s*/, "");
      this.rent2.anuncio = `${v.frase} ${numero} ${v.unidade}.`;
      this.rent2.anuncioPesou = rent2AnuncioPesou(v.pesou);
    },

    // Redesenha as duas curvas reancoradas na janela (7a.L.1) e os dois
    // markPoints (7a.BG.2: o da carteira e o dos índices, com o ranking novo).
    // Sem animação durante o arrasto; com a do tema quando veio de botão.
    _rent2Curvas(iIni, iFim, animar) {
      const ctx = this._rentCtx;
      const chart = this.echartsRent;
      if (!ctx || !chart) return;
      const dc = window.drarthurChart;
      const [cart, ind] = rent2Curvas(ctx.rP, ctx.rI, ctx.off, ctx.nTotal, iIni, iFim);
      const marcas = rent2MarcadoresFim(cart, ind, rent2FmtCurva, dc);
      try {
        chart.setOption({
          animationDurationUpdate: animar ? dc.motionConfig.animationDurationUpdate : 0,
          yAxis: { boundaryGap: rent2FolgaEixoY(cart, ind) },
          series: [
            { name: "Sua carteira", data: cart, markPoint: marcas.cart },
            { name: "Mesma carteira, só com índices", data: ind, markPoint: marcas.ind },
          ],
        });
      } catch (_) {}
    },

    // Janela (iIni, iFim) do dataZoom atual, presa ao histórico do escopo.
    _rent2LerZoom() {
      const ctx = this._rentCtx;
      const chart = this.echartsRent;
      const ultimo = ctx.nTotal - ctx.off;
      let s = 0;
      let e = ultimo;
      try {
        const dz = chart.getOption().dataZoom[0];
        if (typeof dz.startValue === "number") s = Math.round(dz.startValue);
        else if (typeof dz.start === "number") s = Math.round((dz.start / 100) * ultimo);
        if (typeof dz.endValue === "number") e = Math.round(dz.endValue);
        else if (typeof dz.end === "number") e = Math.round((dz.end / 100) * ultimo);
      } catch (_) {}
      s = Math.max(0, Math.min(ultimo - 1, s));
      e = Math.max(s + 1, Math.min(ultimo, e));
      return [s + ctx.off + 1, e + ctx.off];
    },

    _rent2AoMoverZoom() {
      const ctx = this._rentCtx;
      if (!ctx || !this.echartsRent) return;
      const viaBotao = this._rent2ViaBotao;
      this._rent2ViaBotao = false;
      const [iIni, iFim] = this._rent2LerZoom();
      const chave = rent2ChaveDe(iIni, iFim, ctx.nTotal, ctx.m0);
      this._rent2Curvas(iIni, iFim, viaBotao);
      if (viaBotao) {
        this._rent2Aplicar(iIni, iFim, chave);
        return;
      }
      // Arrasto: zero transição enquanto o dedo move (classe direto no DOM,
      // no mesmo tick do evento); o número troca o texto sem animar.
      const tela = document.querySelector(".tela-rentabilidade");
      if (tela) tela.classList.add("is-arrastando");
      this.rent2.arrastando = true;
      const r = ponteJanela(ctx.bloco, ctx.escopo, ctx.moeda, iIni, iFim);
      if (r.indisponivel) {
        // Durante o movimento o número fica no último valor válido.
        ctx.pendente = rent2MotivoTexto(r.indisponivel);
      } else {
        ctx.pendente = null;
        this._rent2Aplicar(iIni, iFim, chave, r);
      }
      clearTimeout(this._rent2SettleTimer);
      this._rent2SettleTimer = setTimeout(() => this._rent2Soltar(), RENT2_SETTLE_MS);
    },

    // Fim do arrasto. Janela sem dado não é aceita: volta à última válida e
    // diz o motivo (Review Focus 4). Sem janela válida anterior, mostra a
    // janela com o motivo no lugar dos números.
    _rent2Soltar() {
      this._rent2SettleTimer = null;
      const ctx = this._rentCtx;
      const tela = document.querySelector(".tela-rentabilidade");
      if (tela) tela.classList.remove("is-arrastando");
      this.rent2.arrastando = false;
      if (!ctx || !this.echartsRent) return;
      if (!ctx.pendente) {
        this.rent2.motivo = "";
        this._rent2Anunciar();
        return;
      }
      const motivo = ctx.pendente;
      ctx.pendente = null;
      if (ctx.ultimaValida) {
        const [a, b, chave] = ctx.ultimaValida;
        this._rent2ViaBotao = true;
        try {
          this.echartsRent.dispatchAction({ type: "dataZoom", startValue: a - 1 - ctx.off, endValue: b - ctx.off });
        } catch (_) {}
        this._rent2ViaBotao = false;
        this._rent2Curvas(a, b, true);
        this._rent2Aplicar(a, b, chave);
      } else {
        const [iIni, iFim] = this._rent2LerZoom();
        this._rent2Aplicar(iIni, iFim, rent2ChaveDe(iIni, iFim, ctx.nTotal, ctx.m0));
      }
      this.rent2.motivo = motivo;
      this._rent2Anunciar();
    },

    // Botão de janela fixa. Indisponível: diz o motivo e não muda a janela.
    rent2EscolherJanela(chave) {
      const ctx = this._rentCtx;
      const j = this.rent2.janelas.find((x) => x.chave === chave);
      if (!ctx || !j) return;
      if (!j.disponivel) {
        this.rent2.motivo = j.motivo;
        return;
      }
      this.rent2.motivo = "";
      const [a, b] = rent2IndicesFixa(chave, ctx.nTotal, ctx.m0);
      if (this.echartsRent) {
        this._rent2ViaBotao = true;
        try {
          this.echartsRent.dispatchAction({ type: "dataZoom", startValue: a - 1 - ctx.off, endValue: b - ctx.off });
        } catch (_) {}
        this._rent2ViaBotao = false;
        this._rent2Curvas(a, b, true);
      }
      this._rent2Aplicar(a, b, chave);
    },

    // Toque numa linha da ponte: troca "quem pesou". A escolha fica enquanto a
    // linha existir no escopo (rent2Vista cai no padrão quando ela some).
    rent2EscolherLinha(id) {
      this.rent2.linhaUsuario = id;
      const { iIni, iFim, chave } = this.rent2;
      if (iIni !== null) this._rent2Aplicar(iIni, iFim, chave);
    },

    rent2Recarregar() {
      location.reload();
    },

    // ── 7a.H.1 / 7a.S.10: Tela #aportar (simulador vivo) ───────────────
    hidratarAportar() {
      // 7a.AU (correção pré-merge, achada pela suíte completa): o reset para "tudo" na ENTRADA da tela mora em
      // atualizarRota() (guard `this.rota !== "aportar"`), não aqui — esta
      // função é re-chamada depois de um await (boot/unlock) mesmo já
      // estando na tela, e resetar aqui desfazia um toque feito durante essa
      // espera. Ver o comentário lá para o racional completo.
      if (!this.json) return;
      // 7a.S.10: preset cross-screen (grifo #alocação → #aportar) tem
      // prioridade sobre o valor persistido — o Dr. Arthur veio de um tap
      // explícito "Simular aporte", não de reabrir a tela por conta própria.
      if (this._aportePresetPendente != null) {
        const preset = this._aportePresetPendente;
        this._aportePresetPendente = null;
        this.aporteSetValor(preset, true);
        return;
      }
      // Restaurar valor persistido se dentro da janela TTL 24h
      try {
        const ts = parseInt(localStorage.getItem("aporte.ts") || "0", 10);
        const TTL_MS = 24 * 60 * 60 * 1000;
        if (ts > 0 && Date.now() - ts < TTL_MS) {
          const v = localStorage.getItem("aporte.valor") || "";
          if (v && !this.aporteValor) {
            this.aporteValor = v;
          }
        } else if (ts > 0) {
          // Janela expirou — limpa pra não restaurar ao próximo entrar
          localStorage.removeItem("aporte.valor");
          localStorage.removeItem("aporte.ts");
        }
      } catch (_) {}
      this.recalcularAporte();
    },

    // Parsing pt-BR compartilhado (extraído 7a.S.10 — antes duplicado em
    // aporteHelperText/recalcularAporte). "" ou não-finito → 0 (mesmo
    // comportamento anterior via `parseFloat(...) || 0`).
    _parseAporteValor(raw) {
      const limpo = String(raw || "")
        .replace(/[^\d.,]/g, "")
        .replace(/\./g, "")
        .replace(",", ".");
      const valor = parseFloat(limpo);
      return isFinite(valor) ? valor : 0;
    },

    aporteHelperText() {
      const valor = this._parseAporteValor(this.aporteValor);
      if (valor <= 0) {
        return "Digite quanto você tem disponível para investir.";
      }
      return `Com ${window.formatBrl(valor)} você compraria:`;
    },

    // 7a.S.10: legenda acima dos chips — pré-carrega o último aporte
    // (json.ultimo_aporte). Sem dado (ainda sem nenhuma compra no DB) cai
    // num convite genérico; o hero-chip "Repetir" fica oculto (x-show).
    aporteApcapHtml() {
      const ua = this.json && this.json.ultimo_aporte;
      if (!ua || !ua.total_brl) {
        return "Toque nos atalhos ou arraste o controle abaixo para montar um plano.";
      }
      const dataFmt = window.formatDataExtenso ? window.formatDataExtenso(ua.data) : "";
      const quando = dataFmt ? `, em ${dataFmt}` : "";
      return `Seu último aporte foi <b>${this.aporteFmtBrl0(ua.total_brl)}</b>${quando}. Toque para repetir — ou monte outro valor.`;
    },

    // Currency pt-BR sem centavos — usado nos rótulos curtos (chips/apcap/
    // grifo do plano). Distinto de window.formatBrl (sempre 2 casas).
    aporteFmtBrl0(v) {
      return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
        maximumFractionDigits: 0,
      }).format(v || 0);
    },

    // 7a.S.10: single source of truth do valor — chips/scrubber escrevem
    // em `aporteValor` (o MESMO x-model do input de texto) e chamam
    // recalcularAporte, exatamente como o @input.debounce já fazia. `animar`
    // liga o count-up/stagger (chips) vs instantâneo (scrubber em arrasto,
    // digitação — preserva o timing das specs pré-existentes).
    aporteSetValor(v, animar = false) {
      const num = Math.max(0, Math.round((Number(v) || 0) * 100) / 100);
      this.aporteValor = String(num);
      this.recalcularAporte(animar);
    },

    aporteAdd(delta) {
      this.aporteSetValor(this._parseAporteValor(this.aporteValor) + delta, true);
    },

    // % (0–100) do valor atual sobre aporteScrubMax, clampado — usado pelo
    // preenchimento visual (.aporte-scrub-fill/-knob) do scrubber 7a.S.10.
    aporteScrubPct() {
      const v = this._parseAporteValor(this.aporteValor);
      return Math.max(0, Math.min(100, (v / this.aporteScrubMax) * 100));
    },

    // 7a.AU: toque no seletor Tudo/Brasil/EUA. Valor fora da lista cai em
    // "tudo" (mesma regra de aportar.js). Remonta o plano com a animação de
    // chips (respeita prefers-reduced-motion por dentro).
    selecionarAporteMercado(mercado) {
      const lista = (window.aporteCalculo && window.aporteCalculo.MERCADOS) || ["tudo"];
      const m = lista.includes(mercado) ? mercado : "tudo";
      if (m === this.aporteMercado) return;
      this.aporteMercado = m;
      this.recalcularAporte(true);
    },

    // null no modo Tudo; rótulos da copy restrita (spec §3.2) nos outros.
    // Fonte única em aportar.js (7a.AU CRB #2) — sem cópia própria aqui.
    // Retorna null se aportar.js nao carregou (window.aporteCalculo ausente); grifo e nota tratam null como Tudo.
    _aporteMercadoRotulo() {
      const rotulos = window.aporteCalculo && window.aporteCalculo.ROTULO_MERCADO;
      return (rotulos && rotulos[this.aporteMercado]) || null;
    },

    // "zero sobra" só é verdade quando não sobra nada (spec §3.2).
    aporteNotaTexto() {
      return this.aporteSobra > 0
        ? "O plano prioriza as categorias abaixo do alvo, equal-weight nos picks."
        : "O plano prioriza as categorias abaixo do alvo, equal-weight nos picks — zero sobra.";
    },

    aporteNotaMercado() {
      const r = this._aporteMercadoRotulo();
      return r
        ? `Só ${r.curto}: o plano cobre apenas a parte ${r.de} da política; o resto fica para outro aporte.`
        : "";
    },

    recalcularAporte(animar = false) {
      const valor = this._parseAporteValor(this.aporteValor);
      const aporteValorStr = String(this.aporteValor || "").trim();
      try {
        if (valor > 0) {
          localStorage.setItem("aporte.valor", this.aporteValor);
          localStorage.setItem("aporte.ts", String(Date.now()));
        } else if (valor === 0 || aporteValorStr === "") {
          // Input limpo pelo usuário — remove valor stale do localStorage
          // pra não restaurar fantasma na próxima entrada da tela.
          localStorage.removeItem("aporte.valor");
          localStorage.removeItem("aporte.ts");
        }
      } catch (_) {}
      if (valor <= 0 && this._aporteRevelados) {
        // Plano esvaziado — próxima vez que cards aparecerem, stagger de novo
        // (espelha o mockup: wrap.innerHTML="" quando V<=0).
        this._aporteRevelados.clear();
      }
      if (!window.aporteCalculo || !this.json) {
        this.aporteBanner = null;
        this.aporteCategoriasRecebedoras = [];
        this.aporteCategoriasNaoRecebedoras = [];
        this.aportePausados = [];
        this.aporteTickersSemPosicao = [];
        this.aporteSobra = 0;
        return;
      }
      const r = window.aporteCalculo.calcularAporte(valor, this.json, {
        mercado: this.aporteMercado,
      });
      this.aporteBanner = r.banner;
      this.aporteCategoriasRecebedoras = r.categorias || [];
      this.aporteCategoriasNaoRecebedoras = r.categoriasNaoRecebedoras || [];
      this.aportePausados = r.pausados || [];
      this.aporteTickersSemPosicao = r.tickersSemPosicao || [];
      this.aporteSobra = r.sobra || 0;
      this.$nextTick(() => this._aporteAnimarPlano(animar));
    },

    // Alvo % em precisão RAW (7a.S.10, CRB #1 — Confiança nos Números): o
    // card de aportar.js carrega `alvoPct` ARREDONDADO (Math.round, p/ a
    // trilha DISPLAY). A math narrativa (grifo/tag) NÃO pode misturar esse
    // inteiro com os floats raw (atualPct/posPct/deltaPct): p/ um peso_alvo
    // não-redondo (0.304 → alvoPct 30 vs raw 30,4), o "% do caminho" desvia
    // até ~0,5pp e pode flipar PREMATURAMENTE p/ "fecha o gap"/"gap fecha
    // inteiro". Fonte raw = json.politica.categorias (mesma origem que
    // aportar.js usa p/ montar o card), casada por nome. Fallback ao
    // arredondado só se a categoria sumir do payload (defensivo — não
    // acontece: o card DERIVA dela). aportar.js permanece intocado (até a
    // 7a.AU, que o estendeu com opcoes.mercado; os formatters seguem
    // espelhados).
    _aporteAlvoRawPct(nome) {
      const cats =
        (this.json && this.json.politica && this.json.politica.categorias) || [];
      const c = cats.find((x) => x.nome === nome);
      return c ? (c.peso_alvo || 0) * 100 : null;
    },

    // Tag de categoria no plano (7a.S.10): só reescreve a leitura quando a
    // categoria está subexposta (aportar.js `cat.tag === "subexposta"`);
    // "no alvo"/"" (estado balanceado) passam direto — não há "gap" a fechar
    // nesse caso. Usa o alvo RAW (não o alvoPct arredondado) contra os
    // floats raw atualPct/posPct — ver _aporteAlvoRawPct (CRB #1).
    aporteCatTagTexto(cat) {
      if (!cat || cat.tag !== "subexposta") return (cat && cat.tag) || "";
      const alvoRawPct = this._aporteAlvoRawPct(cat.nome);
      const alvo = alvoRawPct != null ? alvoRawPct : cat.alvoPct;
      const restante = alvo - cat.atualPct;
      const fechou = restante <= 0 || cat.posPct + 0.05 >= alvo;
      return fechou ? "fecha o gap" : "abaixo · aportar";
    },

    // Grifo do plano (7a.S.10, Apêndice B "Aportar = box do plano"): narra
    // quanto do caminho de volta ao alvo o aporte fecha. Usa a categoria
    // subexposta com MENOR progresso relativo (a que "trava" o caminho) e o
    // alvo RAW (não o alvoPct arredondado) — ver _aporteAlvoRawPct (CRB #1).
    aporteGrifoHtml() {
      const cats = this.aporteCategoriasRecebedoras || [];
      if (cats.length === 0) return "";
      const valorNum = this._parseAporteValor(this.aporteValor);
      const valorFmt = this.aporteFmtBrl0(valorNum);
      const rot = this._aporteMercadoRotulo();
      // 7a.AU: a sobra existe sempre que nenhum pick fracionário (EUA) entra
      // no plano — Só Brasil por construção, Tudo quando o top 5 não tem EUA.
      // Antes ela sumia calada sob um "zero sobra" falso.
      const sobra =
        this.aporteSobra > 0
          ? ` Sobram ${window.formatBrl(this.aporteSobra)}, que ficam para o próximo aporte.`
          : "";
      const fim = sobra || " Zero sobra.";
      const sub = cats.filter((c) => c.tag === "subexposta");
      if (sub.length === 0) {
        if (rot) {
          return `Com <b>${valorFmt}</b>, o aporte segue os pesos-alvo dos ativos ${rot.de}.${fim}`;
        }
        return sobra
          ? `Com <b>${valorFmt}</b>, o aporte segue os pesos-alvo da política.${sobra}`
          : `Com <b>${valorFmt}</b>, o aporte segue os pesos-alvo da política — zero sobra.`;
      }
      let pior = null;
      for (const c of sub) {
        const alvoRawPct = this._aporteAlvoRawPct(c.nome);
        const alvo = alvoRawPct != null ? alvoRawPct : c.alvoPct;
        const restante = alvo - c.atualPct;
        const percorrido = restante > 0 ? Math.min(1, c.deltaPct / restante) : 1;
        if (pior === null || percorrido < pior) pior = percorrido;
      }
      const pct = Math.round((pior ?? 0) * 100);
      if (pct >= 100) {
        return `Com <b>${valorFmt}</b>, o gap fecha inteiro — as categorias abaixo do alvo voltam à política.${fim}`;
      }
      return `Com <b>${valorFmt}</b>, você fecha <b>${pct}%</b> do caminho de volta ao alvo.${fim}`;
    },

    // Formata cotas para os frames do count-up (7a.S.10). Espelha os
    // formatters privados de aportar.js (formatCotasFracionarias/Inteiras)
    // sem importar nada de lá — aportar.js permanece intocado (invariante
    // até a 7a.AU, que o estendeu com opcoes.mercado; os formatters seguem
    // espelhados).
    _aporteFormatarCotas(valor, fracionario) {
      if (fracionario) {
        return (
          new Intl.NumberFormat("pt-BR", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }).format(valor) + " cotas"
        );
      }
      const n = Math.trunc(valor);
      return n + (n === 1 ? " cota" : " cotas");
    },

    // Coreografia aditiva (7a.S.10): stagger reveal dos .aporte-card (1x por
    // categoria, via data-cat-nome) + count-up de cotas (.aporte-compra-qty,
    // via data-cotas/data-cotas-frac). Dono exclusivo do textContent dos nós
    // animados (mesmo racional de ativarCountUpHero — Alpine reatribui
    // aporteCategoriasRecebedoras inteiro a cada recálculo; um x-text
    // reativo nesses nós disputaria com o RAF e reverteria o frame no meio
    // da animação). `animar=false` (digitação/scrubber) escreve o valor
    // final direto — só chips tocam a animação (mesma nuance do mockup:
    // setAp(v, true) nos chips vs setAp(v, false) no arrasto do scrubber).
    _aporteAnimarPlano(animar) {
      const tela = document.querySelector(".tela-aportar");
      if (!tela) return;
      const reduced = !!(
        window.drarthurNav &&
        window.drarthurNav.motion &&
        window.drarthurNav.motion.reduced
      );
      if (!this._aporteRevelados) this._aporteRevelados = new Set();

      const cards = tela.querySelectorAll(".aporte-card");
      cards.forEach((card, idx) => {
        const nome = card.getAttribute("data-cat-nome") || String(idx);
        if (this._aporteRevelados.has(nome)) {
          card.classList.add("aporte-card--in");
          return;
        }
        this._aporteRevelados.add(nome);
        if (reduced) {
          card.classList.add("aporte-card--in");
        } else {
          setTimeout(() => card.classList.add("aporte-card--in"), idx * 110 + 30);
        }
      });

      const qtyEls = tela.querySelectorAll(".aporte-compra-qty");
      qtyEls.forEach((el) => {
        const target = parseFloat(el.getAttribute("data-cotas"));
        if (!isFinite(target)) return;
        const fracionario = el.getAttribute("data-cotas-frac") === "1";
        const formatter = (n) => this._aporteFormatarCotas(n, fracionario);
        if (!animar || reduced) {
          el.textContent = formatter(target);
          return;
        }
        window.drarthurNav.applyCountUp(el, target, formatter);
      });
    },

    limparSessao() {
      // Remove apenas credenciais de sessão. NÃO toca pinBlockUntil/pinFails/pinFirstFailAt
      // — rate-limit persiste intencionalmente (atacante não escapa via bloquear manual).
      //
      // 7a.W.3.a: NÃO toca `envelope` tampouco, e isso é decisão, não
      // esquecimento. O envelope é ciphertext em repouso, inútil sem o PIN, e
      // sua persistência é o que separa "trancar a sessão" (pede o PIN de
      // novo) de "desparear o aparelho" (pede a frase de novo). Limpá-lo aqui
      // faria o Dr. Arthur recadastrar a frase toda semana e o modelo inteiro
      // perderia o sentido (spec §7.6). Travado por teste em lock-higiene.spec.ts.
      localStorage.removeItem("pin");
      localStorage.removeItem("pinTimestamp");
      localStorage.removeItem("atualizadoEm");
    },

    mostrarToast(mensagem, tom = "verde", duracaoMs = 3000) {
      if (this.toast.timer) clearTimeout(this.toast.timer);
      this.toast = {
        visible: true,
        mensagem,
        tom,
        timer: setTimeout(() => { this.toast.visible = false; }, duracaoMs),
      };
    },

    // 7a.AE.3 — de quando e o fechamento que esta tela esta exibindo.
    //
    // Ancorado em `frescor_cotacoes.Total`, que ja E a uniao de Brasil e EUA:
    // divergencia ENTRE escopos aparece automaticamente como min != max, sem o
    // helper precisar comparar escopo a escopo. E a divergencia nao e ruido a
    // esconder — ela e a assinatura da degradacao por ticker, e escondê-la
    // reintroduziria a cegueira que a fase existe para tirar.
    //
    // Empty-safe em DOIS estados distintos, e os dois acontecem: a chave
    // AUSENTE (payload pre-v2.26, que o sibling serve entre o merge desta
    // sub-fase e o primeiro run do cron) e a chave PRESENTE com min/max nulos
    // (o que `frescor_por_escopo` devolve para escopo sem posicao). Os dois
    // caem no carimbo de publicacao: hero mudo seria pior que o rotulo antigo.
    frescorTexto() {
      const t = this.json?.frescor_cotacoes?.Total;
      const min = t?.min;
      const max = t?.max;
      if (!min || !max) return window.formatDataHora(this.json?.atualizado_em);
      const dMin = window.formatDataDiaMes(min);
      const dMax = window.formatDataDiaMes(max);
      // Terceiro estado de degradacao, achado no CRB da 7a.AE.3: a chave existe
      // e nao e nula, mas nao formata (data impossivel vinda de um bug de
      // backend). Sem esta linha o slot exibiria "Fechamento de " pendurado —
      // pior que o carimbo, e pior que ficar mudo.
      if (!dMin || !dMax) return window.formatDataHora(this.json?.atualizado_em);
      if (min === max) return `Fechamento de ${dMin}`;
      return `Fechamentos de ${dMin}–${dMax}`;
    },

    avaliarAtualizacao(atualizadoEmNovo) {
      const anterior = localStorage.getItem("atualizadoEm");
      if (!navigator.onLine) {
        this.mostrarToast(
          `Offline · última atualização: ${window.formatDataHora(atualizadoEmNovo)}`,
          "cinza",
          3000,
        );
        return;
      }
      if (anterior && anterior !== atualizadoEmNovo) {
        this.mostrarToast(
          `Carteira atualizada · ${window.formatDataHora(atualizadoEmNovo)}`,
          "verde",
          3000,
        );
      }
    },

    async tentarAutoResume() {
      const pin = localStorage.getItem("pin");
      const ts = Number(localStorage.getItem("pinTimestamp") || 0);
      if (!pin || !ts) return;
      if (Date.now() - ts >= SESSION_TTL_MS) {
        this.limparSessao();
        return;
      }
      // 7a.W.3.a: migra ANTES de usar o envelope, e aqui (não no `init()`)
      // porque este é o único caminho em que a derivação PBKDF2 já é
      // obrigatória — no `init()` ela custaria 600k a mais no boot de todo
      // aparelho, inclusive os que nem têm sessão.
      await this._migrarSePreciso();
      // O segredo vem do envelope. O fallback para `pin` cobre (a) envelope
      // corrompido e (b) a janela entre o deploy e a primeira migração — nos
      // dois casos o comportamento é o de antes da fase, que é exatamente a
      // degradação desejada.
      const segredo = (await this._abrirEnvelope(pin)) || pin;
      this.carregando = true;
      // 7a.W.3.b: rede e decifra em `try` SEPARADOS. Antes os dois caíam no
      // mesmo catch, e o estado novo ("a carteira foi republicada") precisa
      // distingui-los: só é honesto pedir a frase de novo quando o payload
      // chegou EM MÃOS e não abriu.
      let payloadB64;
      try {
        const response = await fetch("./portfolio.json.enc", { cache: "no-cache" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        payloadB64 = (await response.text()).trim();
      } catch (err) {
        // Rede. NÃO é motivo para desparear o aparelho nem para pedir a frase:
        // o segredo pode estar perfeito e o metrô estar sem sinal.
        console.warn("auto-resume: fetch falhou", err);
        this.carregando = false;
        return;
      }
      try {
        const plaintext = await window.decifrar(payloadB64, segredo);
        // Race guard: outra aba pode ter chamado bloquear() durante o await.
        // Se o pin sumiu do localStorage, respeitar o logout e não promover a fase.
        if (localStorage.getItem("pin") === null) {
          return;
        }
        this.json = JSON.parse(plaintext);
        this.pin = pin;
        this.segredo = segredo;
        this.fase = "raiox";
        // Janela 7d deslizante — refresca o timestamp assim que o auto-resume
        // valida a sessão, ANTES do carregamento (lento) do índice de
        // relatórios. PIN só é exigido após 7d de inatividade total.
        localStorage.setItem("pinTimestamp", String(Date.now()));
        // 7a.Q.3: carga do índice de relatórios (payload separado).
        await this.carregarIndiceRelatorios();
        // Race guard: o lock (bloquear() ou o handler storage) pode ter rodado
        // durante o await acima, já com a fase em raiox. Ele zera `json`, e o
        // resto deste try lê `this.json.atualizado_em`: o throw cairia no catch
        // abaixo e pintaria "carteira republicada" no lugar do PIN.
        if (!this.segredo) return;
        // 7a.R.3.b: índice de dossiês — carga NÃO-bloqueante, fora do caminho
        // crítico. Nada na primeira pintura depende dele: as duas superfícies
        // que o consomem (a entrada no #ativo e os links do Relatório) são
        // reativas e acendem quando ele chega. Aguardá-lo aqui empurraria a
        // hidratação dos gráficos por uma derivação PBKDF2 inteira (600k).
        this.carregarIndiceDossies();
        if (this.rota === "relatorio") this.hidratarRelatorio();
        // Deep-link direto no dossiê: hidratarDossie aguarda o índice por
        // dentro, compartilhando a promise em voo disparada acima.
        if (this.rota === "dossie") this.hidratarDossie();
        this.avaliarAtualizacao(this.json.atualizado_em);
        localStorage.setItem("atualizadoEm", this.json.atualizado_em);
        // 7a.H.1: se a rota já é #aportar (reload), hidratar agora que temos json.
        if (this.rota === "aportar") {
          this.hidratarAportar();
        }
        // 7a.E.31: a vista #alocação unificada começa com todas as categorias
        // fechadas (catAberta vazio) — sem hidratação pós-resume necessária.
        // 7a.I.5: cold-start em `#/raiox/chart` chamou hidratarPatrimonio
        // antes do json — gráfico ECharts não renderiza no primeiro tick.
        if (this.rota === "patrimonio") {
          this.hidratarPatrimonio();
        }
        // 7a.S.7b: mesmo padrão de #/raiox/chart — cold-start em
        // `#/proventos/dy` (bookmark/share-link) chega aqui sem json ainda,
        // então hidratarDY() precisa rodar agora que o payload chegou; senão
        // dySelecionado fica null e o pódio (x-show) nunca aparece por default.
        if (this.rota === "dy") this.hidratarDY();
        // 7a.BD.2: cold-start em `#rentabilidade` (o PWA reabre na última
        // hash) — a tela inteira sai de hidratarRentabilidade, que no 1º
        // atualizarRota rodou sem json; sem isto ela abriria vazia.
        if (this.rota === "rentabilidade") this.hidratarRentabilidade();
      } catch (err) {
        // 7a.W.3.b: chegamos aqui com o payload EM MÃOS e ele não abriu com o
        // segredo que este aparelho guarda. Isso não é "PIN errado" (o PIN
        // abriu o envelope) — é a carteira ter sido republicada com uma frase
        // nova. A tela tem voz própria e não acusa o PIN (spec §7.4).
        console.warn("auto-resume: payload não abriu com o segredo guardado", err);
        this.fase = "frase";
        this.fraseMotivo = "republicado";
        // NÃO chama `limparSessao()` aqui, e isso é decisão medida, não
        // esquecimento. Três razões, nesta ordem:
        //
        // 1. O PIN LOCAL continua válido — ele abriu o envelope. Quem mudou foi
        //    o segredo lá dentro. Apagar o `pin` faria o enrollment perder o
        //    PIN que deveria REUSAR, e a tela pediria ao Dr. Arthur para
        //    escolher um PIN novo num aparelho que ele nunca despareou
        //    (contraria o refinamento da spec §7.4, e o teste de re-enrollment
        //    pega isso).
        // 2. Apagar o `pinTimestamp` seria pior no boot SEGUINTE: sem ele o
        //    auto-resume sai cedo, a fase fica "pin", e o Dr. Arthur veria
        //    "PIN incorreto" — exatamente a mensagem que a spec §7.4 proíbe,
        //    porque acusa o PIN por um problema que é do segredo.
        // 3. A sessão não expirou. Republicação da carteira não é logout, e
        //    tratá-la como tal aplica o remédio errado ao evento.
        //
        // O envelope velho também fica: ele será SOBRESCRITO quando a frase
        // nova for cadastrada. Apagá-lo aqui criaria um estado intermediário
        // sem envelope, sem nada em troca.
      } finally {
        this.carregando = false;
      }
    },

    get estaBloqueado() {
      return this.agora < this.pinBlockUntil;
    },

    get bloqueioRestanteMin() {
      if (!this.estaBloqueado) return 0;
      return Math.max(1, Math.ceil((this.pinBlockUntil - this.agora) / 60000));
    },

    registrarFalha() {
      const agora = Date.now();
      let fails = Number(localStorage.getItem("pinFails") || 0);
      let firstAt = Number(localStorage.getItem("pinFirstFailAt") || 0);
      if (!firstAt || agora - firstAt > FAIL_WINDOW_MS) {
        fails = 0;
        firstAt = agora;
      }
      fails += 1;
      localStorage.setItem("pinFails", String(fails));
      localStorage.setItem("pinFirstFailAt", String(firstAt));

      let dur = 0;
      if (fails === 5) dur = BLOCK_5_MS;
      else if (fails === 6) dur = BLOCK_15_MS;
      else if (fails >= 7) dur = BLOCK_60_MS;
      if (dur > 0) {
        const until = agora + dur;
        this.pinBlockUntil = until;
        localStorage.setItem("pinBlockUntil", String(until));
      }
    },

    resetarFalhas() {
      localStorage.removeItem("pinFails");
      localStorage.removeItem("pinFirstFailAt");
      localStorage.removeItem("pinBlockUntil");
      this.pinBlockUntil = 0;
    },

    dispararShake() {
      this.shake = true;
      setTimeout(() => { this.shake = false; }, 420);
    },

    get anoCorrente() {
      return this.json?.proventos?.mensal?.[0]?.mes?.slice(0, 4)
             ?? String(new Date().getFullYear());
    },

    get anoAnterior() {
      return String(Number(this.anoCorrente) - 1);
    },

    bloquear() {
      // Lock manual: limpa sessão mas preserva rate-limit (pinBlockUntil/pinFails).
      // Invariante: atacante não escapa do bloqueio progressivo chamando bloquear().
      this.limparSessao();
      this.fase = "pin";
      this.json = null;
      this.pin = "";
      this.pinError = "";
      this.pinDissolvendo = false;
      this._limparEstadoSensivel(); // 7a.U: nenhum payload decifrado sobrevive ao lock
    },

    get escoposRentabilidade12m() {
      // 7a.E.15: layout inline ("XIRR · TWR") aplicado aos 3 escopos para uniformidade.
      // Sufixo "· em BRL" preservado só em EUA via flag mostrar_em_brl — Total/Brasil
      // são BRL nativo, explicitar é ruído. Schema v2.6+ aninha EUA em {brl,usd};
      // raio-x sempre lê BRL (glance único, sem toggle).
      const r = (this.json && this.json.rentabilidade) || {};
      const flags = { Total: "🌍", Brasil: "🇧🇷", EUA: "🇺🇸" };
      return ["Total", "Brasil", "EUA"]
        .filter((k) => r[k])
        .map((k) => {
          const fonte = (k === "EUA" && r.EUA && r.EUA.brl) ? r.EUA.brl : r[k];
          return {
            key: k,
            flag: flags[k],
            data: { xirr_12m: fonte.xirr_12m, twr_12m: fonte.twr_12m },
            rent_inline: true,
            mostrar_em_brl: k === "EUA",
          };
        });
    },

    get benchmarks12m() {
      // Raio-x: lista única de 5 benchmarks 12m (valores de mercado, independem do escopo).
      const bm = (this.json && this.json.benchmarks_12m) || {};
      return [
        { key: "cdi",   label: "CDI",     valor: bm.cdi   ?? null },
        { key: "ibov",  label: "IBOV",    valor: bm.ibov  ?? null },
        { key: "ifix",  label: "IFIX",    valor: bm.ifix  ?? null },
        { key: "sp500", label: "S&P 500", valor: bm.sp500 ?? null },
        { key: "usd",   label: "USD",     valor: bm.usd   ?? null },
      ];
    },

    get escoposRentabilidade() {
      // Mantido para a tela detalhada `#rentabilidade` (lê origem/ytd/12m + benchmarks por escopo).
      const r = (this.json && this.json.rentabilidade) || {};
      const flags = { Total: "🌍", Brasil: "🇧🇷", EUA: "🇺🇸" };
      return ["Total", "Brasil", "EUA"]
        .filter((k) => r[k])
        .map((k, i) => ({
          key: k,
          flag: flags[k],
          data: r[k],
          benchmarks: Object.entries(r[k].benchmarks || {}),
          isFirst: i === 0,
        }));
    },

    // 7a.W.3.b — a ÚNICA validação possível da frase é tentar decifrar o
    // payload de verdade. Não há lista embarcada para conferir (spec §6.4:
    // milhares de palavras no bundle por nada, e validar contra lista criaria
    // falso-negativo se a frase um dia mudar de forma), e não dá para saber
    // qual palavra errou — nem deve.
    async submitFrase() {
      if (this.carregando || this.fraseTokens !== 6) return;
      this.fraseErro = "";
      this.carregando = true;
      const candidato = window.canonicalizarFrase(this.frase);
      let payloadB64;
      try {
        const response = await fetch("./portfolio.json.enc", { cache: "no-cache" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        payloadB64 = (await response.text()).trim();
      } catch (err) {
        // Estado próprio: o cadastro exige rede UMA vez, porque valida contra
        // o payload real. Confundir isto com "frase errada" mandaria ele
        // reconferir palavras que estão certas.
        console.warn("enrollment: fetch falhou", err);
        this.fraseErro = "Sem conexão. O primeiro acesso neste aparelho precisa de internet.";
        this.carregando = false;
        return;
      }
      try {
        const plaintext = await window.decifrar(payloadB64, candidato);
        this.json = JSON.parse(plaintext);
      } catch (err) {
        console.warn("enrollment: frase não abriu o payload", err);
        this.fraseErro = "Não foi possível abrir a carteira com essa frase. Confira as palavras e a ordem.";
        this.carregando = false;
        return;
      }
      this.segredo = candidato;
      // Aparelho que JÁ tem PIN local reusa o existente e entra direto; virgem
      // vai para a etapa 2 (spec §7.4).
      const pinExistente = localStorage.getItem("pin");
      if (pinExistente) {
        await this._concluirEnrollment(pinExistente);
      } else {
        this.fraseEtapa = "pin";
        this.carregando = false;
      }
    },

    async submitFrasePin() {
      if (this.carregando || !/^\d{6}$/.test(this.frasePinNovo)) return;
      this.fraseErro = "";
      this.carregando = true;
      await this._concluirEnrollment(this.frasePinNovo);
    },

    // Fecha o pareamento: envelopa o segredo sob o PIN local, grava a sessão,
    // limpa os campos da cerimônia e entra. O sucesso cai n'A Abertura
    // existente (7a.S.11), não numa tela de "pronto" — a cerimônia de entrada
    // do app já existe e é ela que celebra.
    async _concluirEnrollment(pinLocal) {
      try {
        await this._criarEnvelope(this.segredo, pinLocal);
        localStorage.setItem("pin", pinLocal);
        localStorage.setItem("pinTimestamp", String(Date.now()));
        if (this.json && this.json.atualizado_em) {
          localStorage.setItem("atualizadoEm", this.json.atualizado_em);
        }
      } catch (err) {
        console.error("enrollment: falha ao gravar o envelope", err);
        this.fraseErro = "Não foi possível concluir neste aparelho. Tente de novo.";
        this.carregando = false;
        return;
      }
      this.pin = pinLocal;
      // Campos da cerimônia não sobrevivem a ela: a frase em claro sai do
      // $data assim que deixa de ser necessária.
      this.frase = "";
      this.frasePinNovo = "";
      this.fraseErro = "";
      this.fraseEtapa = "frase";
      this.fraseMotivo = "";
      this.resetarFalhas();
      this.fase = "raiox";
      this.carregando = false;
      this.atualizarRota();
      await this.carregarIndiceRelatorios();
      this.carregarIndiceDossies();
      if (this.rota === "relatorio") this.hidratarRelatorio();
      if (this.rota === "dossie") this.hidratarDossie();
      if (this.rota === "patrimonio") this.hidratarPatrimonio();
      if (this.rota === "dy") this.hidratarDY();
      if (this.rota === "aportar") this.hidratarAportar();
    },

    async submitPin() {
      if (this.estaBloqueado) return;
      if (this.pin.length !== 6 || !/^\d{6}$/.test(this.pin)) {
        this.pinError = "PIN deve ter 6 dígitos";
        return;
      }
      this.pinError = "";
      this.carregando = true;
      // 7a.W.3.a: o valor digitado é o PIN LOCAL. O segredo vem do envelope;
      // sem envelope (aparelho virgem), o digitado é os dois — que é o
      // comportamento pré-fase e o que a 7a.W.3.b substitui pela tela de
      // enrollment.
      const pinLocal = this.pin;
      const segredo = (await this._abrirEnvelope(pinLocal)) || pinLocal;
      let payloadB64;
      try {
        const response = await fetch("./portfolio.json.enc", { cache: "no-cache" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        payloadB64 = (await response.text()).trim();
      } catch (err) {
        console.warn("fetch portfolio falhou", err);
        this.pinError = "Dados indisponíveis · verifique sua conexão";
        this.carregando = false;
        return;
      }
      try {
        const plaintext = await window.decifrar(payloadB64, segredo);
        this.json = JSON.parse(plaintext);
        this.segredo = segredo;
        this.avaliarAtualizacao(this.json.atualizado_em);
        localStorage.setItem("pin", pinLocal);
        localStorage.setItem("pinTimestamp", String(Date.now()));
        localStorage.setItem("atualizadoEm", this.json.atualizado_em);
        // Só cria o envelope DEPOIS que a decifra do payload provou que o
        // segredo está certo. Criar antes gravaria um envelope de segredo
        // errado, e o aparelho passaria a "abrir" para um segredo que não
        // decifra nada. Por isso está DENTRO do try e DEPOIS do JSON.parse.
        if (!this._temEnvelope()) {
          await this._criarEnvelope(segredo, pinLocal);
        }
        this.resetarFalhas();
        // 7a.S.11: dissolve da PIN screen antes de trocar de fase (a cena
        // única "A Abertura"). Reduced-motion preserva o comportamento
        // anterior — troca instantânea, sem dissolve.
        if (window.drarthurNav.motion.reduced) {
          this.fase = "raiox";
        } else {
          this.pinDissolvendo = true;
          await new Promise((resolve) => setTimeout(resolve, ABERTURA_MOTION.dissolveRemoveMs));
          this.fase = "raiox";
        }
        // 7a.U: o lock zera os campos que são CACHE da hash (dossieTicker,
        // relRotaMes) e não toca a URL — sem re-derivar aqui, um deep-link
        // destravado renderizaria vazio (dossiê, que sai na guarda
        // `!dossieTicker`) ou no mês errado (Relatório, que cai no fallback do
        // último mês). atualizarRota() é a função que já faz esse parsing e já
        // roda no init() do boot — reusá-la evita duplicar os padrões de hash.
        // (`tickerAtual` NÃO entra nessa lista — nada zera esse campo, nem
        // mesmo o lock, CRB final 7a.U Finding 2; ele fica na ALLOWLIST do
        // teste-invariante como ponteiro de hash. atualizarRota() segue
        // necessária aqui pelos outros dois: sem ela, um `#ativo/<TICKER>`
        // travado voltaria com `rota` errada mesmo com tickerAtual intacto.)
        //
        // Efeito colateral reconhecido (CRB final 7a.U Finding 5): o handler
        // `storage` do logout multi-aba (init(), acima) zera `rota` mas nunca
        // toca `location.hash`. Antes desta task, a aba derrubada por outra
        // aba reentrava o PIN e pousava na home — nada re-derivava `rota` a
        // partir do hash ainda presente, já que não havia hashchange. Agora
        // ela também volta pelo deep-link, porque o MESMO submitPin() serve
        // os dois caminhos até fase="raiox": corrigir o deep-link do lock
        // manual corrige (e muda) o do logout multi-aba junto. Os dois
        // handlers de lock seguem intocados, e a divergência que a fase
        // promete preservar (bloquear() preserva `rota`; `storage` zera)
        // continua valendo — só o efeito observável PÓS-unlock mudou.
        //
        // As hidratações que ela agenda via setTimeout(…, 0) se somam às
        // chamadas explícitas abaixo. A duplicação é benigna: os 4 loaders
        // que decifram payload (carregarIndiceRelatorios/carregarIndiceDossies/
        // carregarDossie/carregarRelatorioMes) compartilham a MESMA promise em
        // voo entre chamadas concorrentes — os dois últimos por CHAVE
        // (ticker/mês), os dois primeiros sem chave (índice único). Nenhuma
        // decifra PBKDF2 extra acontece: quem chega 2º nesta janela recebe o
        // handle do 1º em vez de re-fazer o fetch+decifra (CRB round 2,
        // Finding 2 — a versão anterior deste comentário afirmava isso citando
        // só o guard de entrada sequencial de carregarDossie/carregarRelatorioMes,
        // que protege reentrada em SÉRIE, não sobreposição CONCORRENTE; era falsa
        // até esses dois loaders ganharem promise em voo nesta rodada).
        this.atualizarRota();
        // 7a.Q.3: carga do índice de relatórios (payload separado).
        await this.carregarIndiceRelatorios();
        // 7a.R.3.b: índice de dossiês — não-bloqueante, mesmo racional do
        // auto-resume. Cold-start em `#/dossie/<TICKER>` (bookmark/share-link)
        // chega aqui sem pin ainda, então hidratarDossie roda agora que a
        // sessão existe, aguardando o índice por dentro.
        this.carregarIndiceDossies();
        if (this.rota === "relatorio") this.hidratarRelatorio();
        if (this.rota === "dossie") this.hidratarDossie();
        // 7a.E.31: #alocação unificada abre com todas as categorias fechadas;
        // sem re-hidratação de colapso necessária pós-PIN.
        // 7a.I.5: mesmo padrão — bookmark direto de `#/raiox/chart` precisa
        // re-hidratar o gráfico depois que `json` chegou via submitPin.
        if (this.rota === "patrimonio") {
          this.hidratarPatrimonio();
        }
        // 7a.S.7b: bookmark direto de `#/proventos/dy` — re-hidrata o DY
        // depois que `json` chegou via submitPin (espelha #/raiox/chart).
        if (this.rota === "dy") this.hidratarDY();
      } catch (err) {
        console.error("decifra falhou", err);
        this.registrarFalha();
        this.dispararShake();
        if (this.estaBloqueado) {
          this.pinError = `Aguarde ${this.bloqueioRestanteMin} min`;
        } else {
          this.pinError = "PIN incorreto";
        }
        this.pin = "";
      } finally {
        this.carregando = false;
      }
    },
  }));
});
