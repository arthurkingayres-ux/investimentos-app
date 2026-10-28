"""Gera portfolio.test.json.enc para testes Playwright E2E.

Uso (rodar do repo Investimentos com PYTHONPATH configurado):
    cd /caminho/Investimentos
    PYTHONPATH=. python ../investimentos-app/tests/fixtures/gerar_fixture.py

Saída: ../investimentos-app/tests/fixtures/portfolio.test.json.enc
PIN de teste: 123456

Schema v2.32 (Fase 7a.BJ.2): bloco top-level ``renda`` — quanto a carteira
sustenta de renda hoje, no passado e na projeção até os 65, com guardrails e
herança, consumido pela tela ``#/raiox/renda`` e pelo card da home. Variantes:
``portfolio_renda_{null,cobrem,zero,curta}`` e ``portfolio_pre_v232`` (2.31,
sem a chave). Números 100% fictícios, coerentes com a projeção sintética.

Schema v2.30 (Fase 7a.BD.1): bloco top-level ``ponte`` — a carteira contra a
mesma carteira feita só de índices, consumido pela #rentabilidade nova
(7a.BD.2). Série mensal por ativo (``brl``/``usd`` com ``[i, D, G]``), índices
por moeda, ``fluxos`` por escopo e ``buracos``. A fixture cobre todas as
classes e linhas, um passivo por cesta, o ``AVNU_REBATE`` (D = 0), um buraco
no mês 4 e um mês com IFIX ``null``. ``portfolio_pre_v230`` é o payload sem a
chave (``versao: "2.29"``) — o estado "payload antigo em cache". Ao lado,
``ponte_esperado.test.json`` (em claro, exceção nominal no ``.gitignore``) traz
o bloco e a saída da referência Python (``src/calculadora/ponte.py``) para o
teste cruzado da gêmea JS. Números 100% fictícios, gerados por fórmula — nunca
lidos do DB real.

Schema v2.27 (Fase 7a.AV.1): bloco top-level ``projecao`` — projeção
patrimonial até os 65 anos (Monte Carlo backend), consumida pela tela nova
``#/raiox/projecao`` (7a.AV.2, Tasks 11-12). Três fixtures cobrem os três
estados que o frontend precisa distinguir: a principal (``projecao`` populado,
com todas as sub-chaves), ``portfolio_projecao_null`` (``projecao: null`` — DB
sem histórico suficiente ou premissas ausentes) e ``portfolio_pre_v227``
(payload sem a chave nenhuma, ``versao: "2.26"`` — simula um payload publicado
antes desta fase, antes de o frontend saber ler o campo nunca). Números do
bloco sintético 100% fictícios, gerados por fórmula — nunca lidos do DB real.

Schema v2.26 (Fase 7a.AE.2): ``frescor_cotacoes`` — de quando e o fechamento
que valorou cada escopo, como intervalo ``{min, max}`` mais a contagem de
tickers por data. A fixture usa DATAS MISTAS de proposito (Total 17->18/08),
porque o intervalo e o caso que a tela precisa saber exibir e o homogeneo e o
facil. Os numeros sao SINTETICOS: o sibling e repo publico e esta fixture
decifra com o PIN de teste publico.

Schema v2.25 (Fase 7a.E.35): ``dividend_yield`` ganha ``por_ativo_parcial`` —
lista ordenada de tickers de posição aberta < 12m (DY trailing-12m subestimado),
que vira o selo "posição < 12 meses" no card DY de ``#ativo``. HGLG11 entra
(sintético) para exercitar o selo; VOO fica de fora (exercita a ausência).

Schema v2.24 (Fase 7a.E.32): ``dividend_yield`` ganha ``por_ativo`` — mapa
``{ticker: dy}`` (fração, 4 casas) com só os tickers de DY válido. A ausência
da chave é o "não há número aqui" (o `#alocacao` renderiza ``—``). BOVA11 fica
de fora de propósito, para exercitar o traço. Os campeões repetem aqui o MESMO
valor de ``campeoes`` (invariante da fase).

Schema v2.23 (Fase 7a.S.7a backend / 7a.S.7b Task 0/1): ``dividend_yield``
ganha ``campeoes`` — pódio top-3 yielders por categoria (``acao_br``/``fii``/
``eua``), cada item ``{ticker, dy, proventos_12m, valor, moeda, bandeira}``.
Consumido pela tela dedicada ``#s-dy``. Os 4 escopos originais (``total``/
``acao_br``/``fii``/``eua``) seguem intactos.

Schema v2.19 (Fase 7a.E.28): cada ativo de bucket ``picks`` em
``politica`` carrega ``quarentena`` (bool); ``False`` para não-quarentenados
e buckets ``passive``. peso_atual_bucket/drift_bucket são intra-categoria.
Schema v2.18 (Fase 7a.E.26): ``Brasil.historico_twr[]`` ganha
``benchmarks={CDI,IBOV}`` (chart BR 3 linhas); ``Total/Brasil.historico_periodo[]``
ganham ``benchmarks_growth`` (Total={CDI,IBOV,SP500}, Brasil={CDI,IBOV})
para o card "Período" multi-benchmark. ``Total.historico_twr[]`` mantém
``benchmarks={CDI,IBOV,SP500}`` da 7a.E.25. EUA inalterado.

Schema v2.5 (Fase 7a.E.9): adiciona bloco top-level ``benchmarks_12m``
com 5 escalares (cdi/ibov/ifix/sp500/usd) consumidos pelo raio-x.
v2.4 (Fase 7a.E.5): payload mínimo que satisfaz raio-x + 4 telas
de detalhe (#rentabilidade com historico_twr mensal por escopo,
#alocacao detalhada por classe, #ativo/:ticker com movimentos +
proventos inline, #proventos com mensal_12m + por_ativo_origem +
por_ativo_12m + evolucao_anual). Inclui 2 tickers em posicoes[] para
drill-down: HGLG11 (com movimentos+proventos) e VOO (só movimentos).
Benchmarks aninhados por janela (xirr_espelhado/twr_espelhado dicts).
"""
from __future__ import annotations

import copy
import json
import math
from datetime import date, timedelta
from pathlib import Path

from src.output.crypto import encriptar_json

# 7a.W: o validador de PUBLICAÇÃO (src/output/segredo.py) recusa 6 dígitos,
# mas ele guarda `resolver_configuracao`, não `encriptar_json`. A fixture
# cifra direto, então o segredo de teste segue "123456" — curto de propósito:
# o sibling é público e o `.enc` de teste decifra com ele por design.
PIN_TESTE = "123456"
OUT = Path(__file__).resolve().parent / "portfolio.test.json.enc"


def _serie_mensal(
    start_twr: float,
    fim_twr: float,
    start_bench: float,
    fim_bench: float,
    benchmarks: dict[str, tuple[float, float]] | None = None,
) -> list[dict]:
    """Gera uma série de 6 pontos linearmente interpolados em meses fictícios.

    Quando ``benchmarks`` é passado (mapa idx → (start, fim)), cada ponto ganha
    um bloco ``benchmarks={idx: twr_interpolado}`` (multi-linha no chart, 7a.E.25
    Total / 7a.E.26 Brasil). Valores divergentes entre índices ⇒ linhas distintas.
    """
    meses = ["2024-01", "2024-06", "2025-01", "2025-06", "2026-01", "2026-04"]
    n = len(meses)
    pontos = []
    for i in range(n):
        ponto = {
            "data": meses[i],
            "twr": round(start_twr + (fim_twr - start_twr) * (i / (n - 1)), 4),
            "benchmark": round(
                start_bench + (fim_bench - start_bench) * (i / (n - 1)), 4
            ),
        }
        if benchmarks:
            ponto["benchmarks"] = {
                idx: round(s + (f - s) * (i / (n - 1)), 4)
                for idx, (s, f) in benchmarks.items()
            }
        pontos.append(ponto)
    return pontos


def _serie_periodo(start_nav: float, fim_nav: float, cashflow_total: float,
                    bench_growth_final: float,
                    benchmarks_growth: dict[str, float] | None = None) -> list[dict]:
    """Schema v2.14 (Fase 7a.L.2.a): serie mensal {data, nav, cashflow, benchmark_growth}
    para card 'Período' do PWA. Mesmos 6 anchors do _serie_mensal — alinha
    índices entre historico_twr e historico_periodo (frontend consome ambos).

    Schema v2.18 (Fase 7a.E.26): quando ``benchmarks_growth`` é passado (mapa
    idx → fator de crescimento final), cada ponto ganha ``benchmarks_growth={idx:
    1+...}`` com fatores DISTINTOS por índice. O accessor ``benchExtras`` deriva
    deltaTwr de ``gB/gA`` por índice ⇒ deltas distintos (anti-regressão: se o
    accessor lesse só CDI, os 3 colapsariam para um único valor)."""
    meses = ["2024-01", "2024-06", "2025-01", "2025-06", "2026-01", "2026-04"]
    n = len(meses)
    # Cashflow concentrado nos meses intermediários (não no primeiro/último).
    cf_por_mes = cashflow_total / (n - 2)
    pontos = []
    for i in range(n):
        nav = round(start_nav + (fim_nav - start_nav) * (i / (n - 1)), 2)
        if i == 0 or i == n - 1:
            cf = 0.0
        else:
            # Aporte = negativo (convenção XIRR).
            cf = round(-cf_por_mes, 2)
        # benchmark_growth: 1.0 no anchor 0, cresce linearmente até bench_growth_final
        bg = round(1.0 + (bench_growth_final - 1.0) * (i / (n - 1)), 6)
        ponto = {
            "data": meses[i],
            "nav": nav,
            "cashflow": cf,
            "benchmark_growth": bg,
        }
        if benchmarks_growth:
            # Crescimento composto por índice: gf(rate, i) = (1+rate)**i. Distinto
            # por índice ⇒ ratios gB/gA distintos. O caller passa o fator final
            # (anchor 5); derivamos a taxa per-anchor de forma composta.
            ponto["benchmarks_growth"] = {
                idx: round(final_g ** (i / (n - 1)), 6)
                for idx, final_g in benchmarks_growth.items()
            }
        pontos.append(ponto)
    return pontos


def _projecao_sintetica_v227() -> dict:
    """CONTEÚDO 100% SINTÉTICO (repo público, PIN de teste público).
    Curva por fórmula: p50 = 400 mil × 1,07^k; faixas simétricas em log.
    Idade/ano de nascimento (1986) e marco são DELIBERADAMENTE diferentes dos
    reais do Dr. Arthur — coincidir com fato biográfico real (idade, ano de
    início de investimento, marco de formação) vazaria dado pessoal num repo
    público (achado do CRB no round 1 da Task 10)."""
    pontos = [{"idade": 40, "ano": 2026, "data": "2026-09-25",
               **{q: 400000.0 for q in ("p10", "p25", "p50", "p75", "p90")}}]
    for k, ano in enumerate(range(2026, 2052)):
        mediana = round(400000.0 * 1.07 ** (k + 1), 2)
        abre = 1 + 0.06 * (k + 1) ** 0.5
        pontos.append({"idade": ano - 1986, "ano": ano, "data": f"{ano}-12-31",
                       "p10": round(mediana / abre**2, 2), "p25": round(mediana / abre, 2),
                       "p50": mediana, "p75": round(mediana * abre, 2), "p90": round(mediana * abre**2, 2)})
    hist = [{"idade": p["idade"], "ano": p["ano"], "data": p["data"],
             "valor": round(400000.0 * 1.05 ** i, 2)} for i, p in enumerate(pontos)]
    return {
        "idade_atual": 40, "idade_final": 65, "ano_atual": 2026,
        "marco": {"ano": 2031, "idade": 45, "rotulo": "fim da formação"},
        "pontos": pontos,
        "historico": {"retorno_real_aa": 0.05, "desde": 2015, "ipca_ate": "2026-08", "pontos": hist},
        "aporte": {"historico_12m": 5000.0, "estimado_ate": None, "estimado_depois": 20000.0,
                   "usado_ate": 5000.0, "usado_depois": 20000.0, "piso_zero_aplicado": False},
        "sensibilidade": [
            {"rotulo": "+R$ 1.000/mês de aporte", "delta_p50_final": 1500000.0},
            {"rotulo": "+1 p.p. de retorno real em todas as classes", "delta_p50_final": 2500000.0}],
        "estresse": [
            {"nome": "Década inicial fraca", "descricao": "Todas as classes rendem 3 p.p. a menos por ano nos primeiros 10 anos.", "p50_final": 3000000.0, "delta_p50_final": -1000000.0},
            {"nome": "Real forte", "descricao": "EUA rende 2 p.p. a menos por ano nos primeiros 10 anos, pela apreciação real do real.", "p50_final": 3500000.0, "delta_p50_final": -500000.0},
            {"nome": "Aporte pela metade depois de 2031", "descricao": "O aporte mensal cai à metade a partir de março de 2031.", "p50_final": 2800000.0, "delta_p50_final": -1200000.0}],
        "premissas": [
            {"categoria": "Ações BR", "peso_alvo": 0.25, "retorno_real": 0.05, "vol": 0.30, "fonte": "Fonte sintética A", "periodo": "2000-2020"},
            {"categoria": "EUA", "peso_alvo": 0.50, "retorno_real": 0.06, "vol": 0.20, "fonte": "Fonte sintética B", "periodo": "1950-2020"},
            {"categoria": "FIIs", "peso_alvo": 0.15, "retorno_real": 0.04, "vol": 0.15, "fonte": "Fonte sintética C", "periodo": "2010-2020"},
            {"categoria": "Renda Fixa BR", "peso_alvo": 0.10, "retorno_real": 0.05, "vol": 0.10, "fonte": "Fonte sintética D", "periodo": "2005-2020"}],
        "simulacao": {"trajetorias": 10000, "retorno_real_carteira_aa": 0.055},
    }


def _projecao_sintetica_v228() -> dict:
    """v2.28 (7a.AW), mantida p/ a fixture pre_v229. CONTEÚDO 100% SINTÉTICO (repo público, PIN de teste
    público): idades, anos, taxas, valores, janelas e a tabela ano a ano são
    INVENTADOS e não seguem nenhuma série real. Nascimento 1986, idade 40,
    horizonte 2051: deliberadamente diferentes dos do Dr. Arthur (a 7a.AV.2
    vazou o ano de nascimento real numa fixture; o board pegou)."""
    nasc, ano0, ano_f = 1986, 2026, 2051
    datas = [("2026-09-25", ano0)] + [(f"{a}-12-31", a) for a in range(ano0, ano_f + 1)]
    q = ("p10", "p25", "p50", "p75", "p90")

    def ponto(k, d, a, **v):
        return {"idade": a - nasc, "ano": a, "data": d, **v}

    def ancora(id_, g, nominal, ipca, de, anos=None):
        pts = []
        for k, (d, a) in enumerate(datas):
            med = round(400000.0 * (1 + g) ** k + 40000.0 * k, 2)
            abre = 1 + 0.07 * k ** 0.5
            pts.append(ponto(k, d, a, p10=round(med / abre**2, 2), p25=round(med / abre, 2), p50=med,
                             p75=round(med * abre, 2), p90=round(med * abre**2, 2)))
        det = round(pts[-1]["p50"] / 1.02, 2)
        partida = round(400000.0 * (1 + g) ** 25.25, 2)
        aportes = 3000.0 * (3 + 12 * 25)
        rec = {"taxa_nominal": nominal, "ipca_aa": ipca, "janela": {"de": de, "ate": "2026-08"}}
        if anos is not None:
            rec["anos"] = anos
        return {"id": id_, "papel": "ancora", "taxa_real": g, "receita": rec,
                "final": {**{x: pts[-1][x] for x in q}, "deterministico": det},
                "decomposicao": {"partida_crescida": partida, "aportes": aportes,
                                 "rendimento_aportes": round(det - partida - aportes, 2)},
                "pontos": pts}

    anos = [{"ano": a, "retorno": r, "meses": m, "dinheiro_novo": n} for a, r, m, n in [
        (2016, None, 0, 15000.0), (2017, 0.06, 12, 9000.0), (2018, 0.11, 12, 12000.0),
        (2019, -0.04, 12, 20000.0), (2020, 0.09, 12, 8000.0), (2021, -0.08, 12, 5000.0),
        (2022, 0.02, 12, 18000.0), (2023, 0.13, 12, 25000.0), (2024, 0.05, 12, 30000.0),
        (2025, 0.07, 12, 22000.0), (2026, 0.01, 8, 16000.0)]]
    simples = [{"categoria": "Ações BR", "peso_alvo": 0.25, "retorno_real": 0.05, "parcela": 0.0125},
               {"categoria": "EUA", "peso_alvo": 0.5, "retorno_real": 0.06, "parcela": 0.03},
               {"categoria": "FIIs", "peso_alvo": 0.15, "retorno_real": 0.04, "parcela": 0.006},
               {"categoria": "Renda Fixa BR", "peso_alvo": 0.1, "retorno_real": 0.05, "parcela": 0.005}]
    det_ms = [round(400000.0 * 1.0535 ** k + 45000.0 * k, 2) for k in range(len(datas))]
    p50_mr = [round(400000.0 * 1.065 ** k + 48000.0 * k, 2) for k in range(len(datas))]
    return {
        "idade_atual": 40, "idade_final": 65, "ano_atual": 2026, "ano_final": 2051,
        "partida": {"patrimonio": 400000.0, "data": "2026-09-25"},
        "aporte": {"mensal": 3000.0, "janela": {"de": "2025-09-26", "ate": "2026-09-25"},
                   "compras_menos_vendas": 42000.0, "proventos": 4800.0, "aluguel": 1200.0,
                   "piso_zero_aplicado": False},
        "cenarios": [
            ancora("twr", 0.02, 0.058, 0.0373, "2017-01", anos),
            ancora("xirr", 0.045, 0.084, 0.0373, "2016-03"),
            {"id": "mercado_simples", "papel": "comparacao", "taxa_real": 0.0535,
             "receita": {"parcelas": simples}, "final": {"deterministico": det_ms[-1]},
             "pontos": [ponto(k, d, a, deterministico=v) for k, ((d, a), v) in enumerate(zip(datas, det_ms))]},
            {"id": "mercado_rebalanceado", "papel": "comparacao", "taxa_real": 0.065,
             "receita": {"media_aritmetica": 0.078, "vol_carteira": 0.15},
             "final": {"p50": p50_mr[-1]},
             "pontos": [ponto(k, d, a, p50=v) for k, ((d, a), v) in enumerate(zip(datas, p50_mr))]},
        ],
        "incerteza": {"vol": 0.12, "meses": 110, "vol_modelo_classes": 0.15, "trajetorias": 10000},
        "ponteiro": {
            "sensibilidade": [
                {"rotulo": "+R$ 1.000/mês de aporte", "por_ancora": {"twr": 420000.0, "xirr": 610000.0}},
                {"rotulo": "+1 p.p. de retorno real", "por_ancora": {"twr": 350000.0, "xirr": 480000.0}}],
            "estresse": [
                {"nome": "Década inicial fraca", "descricao": "A carteira rende 3 p.p. a menos por ano nos primeiros 10 anos.",
                 "por_ancora": {"twr": {"p50": 1500000.0, "delta": -300000.0}, "xirr": {"p50": 2100000.0, "delta": -500000.0}}},
                {"nome": "Real forte", "descricao": "EUA rende 2 p.p. a menos por ano nos primeiros 10 anos. Com EUA em 50,0% da carteira, ela rende 1,00 p.p. a menos.",
                 "por_ancora": {"twr": {"p50": 1650000.0, "delta": -150000.0}, "xirr": {"p50": 2400000.0, "delta": -200000.0}}},
                {"nome": "Aporte pela metade", "descricao": "O aporte mensal cai à metade a partir de hoje e fica assim até o fim.",
                 "por_ancora": {"twr": {"p50": 1200000.0, "delta": -600000.0}, "xirr": {"p50": 1800000.0, "delta": -800000.0}}}]},
        "premissas": [
            {"categoria": "Ações BR", "peso_alvo": 0.25, "retorno_real": 0.05, "vol": 0.30, "fonte": "Fonte sintética A", "periodo": "2000-2020"},
            {"categoria": "EUA", "peso_alvo": 0.50, "retorno_real": 0.06, "vol": 0.20, "fonte": "Fonte sintética B", "periodo": "1950-2020"},
            {"categoria": "FIIs", "peso_alvo": 0.15, "retorno_real": 0.04, "vol": 0.15, "fonte": "Fonte sintética C", "periodo": "2010-2020"},
            {"categoria": "Renda Fixa BR", "peso_alvo": 0.10, "retorno_real": 0.05, "vol": 0.10, "fonte": "Fonte sintética D", "periodo": "2005-2020"}],
    }


def _projecao_sintetica(idade: int = 30, vencida: bool = False) -> dict:
    """v2.29 (7a.AY): UM cenario, premissas de fonte externa. CONTEUDO 100%
    SINTETICO (repo publico): fonte inventada ("Casa Sintetica de Premissas",
    edicao 2099), pesos, retornos, descontos, vols, correlacoes, faixas e
    ponteiros sao INVENTADOS. Os NOMES das classes seguem a taxonomia publica
    (so rotulos, nunca numeros). Nascimento ficticio: ano atual 2030, idade
    ``idade``, horizonte 2065 (idade 65)."""
    ano0, ano_f = 2030, 2065
    nasc = ano0 - idade
    datas = [("2030-09-25", ano0)] + [(f"{a}-12-31", a) for a in range(ano0 + 1, ano_f + 1)]
    faixas = []
    for k, (d, a) in enumerate(datas):
        med = round(400000.0 * 1.045 ** k + 40000.0 * k, 2)
        abre = 1 + 0.07 * k ** 0.5
        faixas.append({"idade": a - nasc, "ano": a, "data": d,
                       "p10": round(med / abre**2, 2), "p25": round(med / abre, 2), "p50": med,
                       "p75": round(med * abre, 2), "p90": round(med * abre**2, 2)})
    if idade > 30:
        faixas = faixas[: 65 - idade + 1]
        for k, f in enumerate(faixas):
            f["idade"] = idade + k
            f["ano"] = ano0 + k
            f["data"] = "2030-09-25" if k == 0 else f"{ano0 + k}-12-31"
    ano_f = faixas[-1]["ano"]
    fin = faixas[-1]
    anos_h = 65 - idade
    partida_cr = round(400000.0 * 1.045 ** (anos_h + 0.25), 2)
    aportes = round(3000.0 * (3 + 12 * anos_h), 2)
    classes_def = [
        ("Brazilian Equity", "Ações Brasil", "jpm", 0.22, 0.06, 0.004, 0.18, (0.003, 0.001)),
        ("U.S. Large Cap", "Ações EUA", "jpm", 0.30, 0.05, 0.003, 0.15, (0.002, 0.001)),
        ("European Large Cap", "Ações Europa", "jpm", 0.08, 0.045, 0.003, 0.16, (0.002, 0.001)),
        ("Emerging Markets Equity", "Ações Emergentes", "jpm", 0.07, 0.055, 0.004, 0.19, (0.003, 0.001)),
        ("Brazilian Inflation-Linked Bonds", "Renda Fixa BR (IPCA+)", "jpm", 0.23, 0.045, 0.002, 0.07, (0.002, 0.0)),
        ("FIIs", "Fundos imobiliários", "historico", 0.10, 0.04, 0.005, 0.14, (0.003, 0.002)),
    ]
    classes = []
    for nome, rot, org, peso, ret, desc, vol, (ter, ret_div) in classes_def:
        classes.append({
            "classe": nome, "rotulo": rot, "origem": org, "peso": peso,
            "retorno_real": ret, "desconto": desc, "retorno_liquido": round(ret - desc, 4), "vol": vol,
            "desconto_composicao": {"ter": ter, "retencao_dividendos": ret_div},
            "periodo": "2010-2020 (sintético)" if org == "historico" else None,
            "fonte": "Série sintética de FIIs" if org == "historico" else None,
        })
    n = len(classes)
    matriz = [[1.0 if i == j else round(0.3 + 0.05 * ((i + j) % 4), 2) for j in range(n)] for i in range(n)]
    return {
        "idade_atual": idade, "idade_final": 65, "ano_atual": ano0, "ano_final": ano_f,
        "partida": {"patrimonio": 400000.0, "data": "2030-09-25"},
        "aporte": {"mensal": 3000.0, "janela": {"de": "2029-09-26", "ate": "2030-09-25"},
                   "compras_menos_vendas": 42000.0, "proventos": 4800.0, "aluguel": 1200.0,
                   "piso_zero_aplicado": False},
        "premissas": {
            "fonte": {"nome": "Casa Sintética de Premissas", "edicao": 2099, "data_base": "2099-01-01",
                      "url": "https://exemplo.invalid/premissas-sinteticas"},
            "inflacao": 0.035,
            "classes": classes,
            "correlacoes": {"classes": [c["classe"] for c in classes], "matriz": matriz},
        },
        "premissas_vencidas": vencida,
        "taxa_central": {"taxa": 0.045, "media_aritmetica": 0.052, "vol_carteira": 0.13},
        "faixas": faixas,
        "decomposicao": {"partida_crescida": partida_cr, "aportes": aportes,
                         "rendimento_aportes": round(fin["p50"] - partida_cr - aportes, 2),
                         "final": fin["p50"]},
        "ponteiro": {
            "sensibilidade": [
                {"rotulo": "+R$ 1.000/mês de aporte", "p50": round(fin["p50"] + 450000.0, 2), "delta": 450000.0},
                {"rotulo": "+1 p.p. de retorno real", "p50": round(fin["p50"] + 380000.0, 2), "delta": 380000.0}],
            "estresse": [
                {"nome": "Década inicial fraca", "descricao": "A carteira rende 3 p.p. a menos por ano nos primeiros 10 anos.",
                 "p50": round(fin["p50"] - 300000.0, 2), "delta": -300000.0},
                {"nome": "Real forte", "descricao": "Ações EUA rendem 2 p.p. a menos por ano nos primeiros 10 anos.",
                 "p50": round(fin["p50"] - 150000.0, 2), "delta": -150000.0},
                {"nome": "Aporte pela metade", "descricao": "O aporte mensal cai à metade a partir de hoje e fica assim até o fim.",
                 "p50": round(fin["p50"] - 600000.0, 2), "delta": -600000.0},
                {"nome": "Proventos fora da carteira",
                 "descricao": "Os proventos deixam de voltar à carteira a partir de hoje, e o que você poupa fica igual.",
                 "p50": round(fin["p50"] - 900000.0, 2), "delta": -900000.0}]},
        "trajetorias": 10000,
    }


def _forma(x):
    if isinstance(x, dict):
        return {k: _forma(v) for k, v in x.items()}
    if isinstance(x, list):
        return [_forma(e) for e in x]
    return type(x).__name__


def _confere_forma(real, esperado, caminho="projecao"):
    """Paridade de forma (so tipos) com a arvore medida no backend
    (literal ``_MOLDE_PROJECAO``, abaixo). Listas: TODO elemento segue o molde do 1o.
    ``periodo``/``fonte`` das classes aceitam ``NoneType|str`` (jpm: None,
    historico: str)."""
    if isinstance(esperado, dict):
        assert isinstance(real, dict) and set(real) == set(esperado), (
            f"{caminho}: chaves divergem: {sorted(set(real) ^ set(esperado))}")
        for k in esperado:
            molde = esperado[k]
            if caminho.endswith("classes[]") and k in ("periodo", "fonte"):
                molde = "NoneType|str"
            _confere_forma(real[k], molde, f"{caminho}.{k}")
    elif isinstance(esperado, list):
        assert isinstance(real, list) and real, f"{caminho}: lista vazia ou ausente"
        for e in real:
            _confere_forma(e, esperado[0], f"{caminho}[]")
    else:
        assert real in esperado.split("|"), f"{caminho}: tipo {real} != {esperado}"


# Molde de tipos medido no backend (so tipos, nenhum valor). Embutido como literal:
# o .gitignore engole tests/fixtures/*.json.
_MOLDE_PROJECAO = json.loads(r'''{
    "idade_atual": "int",
    "idade_final": "int",
    "ano_atual": "int",
    "ano_final": "int",
    "partida": {
        "patrimonio": "float",
        "data": "str"
    },
    "aporte": {
        "mensal": "float",
        "janela": {
            "de": "str",
            "ate": "str"
        },
        "compras_menos_vendas": "float",
        "proventos": "float",
        "aluguel": "float",
        "piso_zero_aplicado": "bool"
    },
    "premissas": {
        "fonte": {
            "nome": "str",
            "edicao": "int",
            "data_base": "str",
            "url": "str"
        },
        "inflacao": "float",
        "classes": [
            {
                "classe": "str",
                "rotulo": "str",
                "origem": "str",
                "peso": "float",
                "retorno_real": "float",
                "desconto": "float",
                "retorno_liquido": "float",
                "vol": "float",
                "desconto_composicao": {
                    "ter": "float",
                    "retencao_dividendos": "float"
                },
                "periodo": "NoneType",
                "fonte": "NoneType"
            }
        ],
        "correlacoes": {
            "classes": [
                "str"
            ],
            "matriz": [
                [
                    "float"
                ]
            ]
        }
    },
    "premissas_vencidas": "bool",
    "taxa_central": {
        "taxa": "float",
        "media_aritmetica": "float",
        "vol_carteira": "float"
    },
    "faixas": [
        {
            "idade": "int",
            "ano": "int",
            "data": "str",
            "p10": "float",
            "p25": "float",
            "p50": "float",
            "p75": "float",
            "p90": "float"
        }
    ],
    "decomposicao": {
        "partida_crescida": "float",
        "aportes": "float",
        "rendimento_aportes": "float",
        "final": "float"
    },
    "ponteiro": {
        "sensibilidade": [
            {
                "rotulo": "str",
                "p50": "float",
                "delta": "float"
            }
        ],
        "estresse": [
            {
                "nome": "str",
                "descricao": "str",
                "p50": "float",
                "delta": "float"
            }
        ]
    },
    "trajetorias": "int"
}''')


def _valida_forma_projecao() -> None:
    molde = _MOLDE_PROJECAO
    for variante in (_projecao_sintetica(), _projecao_sintetica(50), _projecao_sintetica(vencida=True)):
        _confere_forma(_forma(variante), molde)
    for v in (_projecao_sintetica(), _projecao_sintetica(50), _projecao_sintetica(vencida=True)):
        d = v["decomposicao"]
        assert min(d["partida_crescida"], d["aportes"], d["rendimento_aportes"]) >= 0, "parcela negativa"
        soma = round(d["partida_crescida"] + d["aportes"] + d["rendimento_aportes"], 2)
        assert abs(soma - d["final"]) < 0.005, f"decomposicao nao fecha: {soma} != {d['final']}"
        assert d["final"] == v["faixas"][-1]["p50"]
    origens = {c["origem"] for c in _projecao_sintetica()["premissas"]["classes"]}
    assert origens == {"jpm", "historico"}, "a fixture precisa das duas especies de classe"


# ── Fase 7a.BJ.2: bloco ``renda`` sintético (schema v2.32) ───────────────────
# CONTEÚDO 100% SINTÉTICO (repo público, PIN de teste público): renda, série,
# guardrails e pisos são números redondos INVENTADOS, coerentes com
# ``_projecao_sintetica()`` (idade 30, patrimônio de partida 400.000, hoje
# 2030-09-25, mesma fonte inventada) — nunca lidos do investimentos.db.
# Variantes (o que cada uma exercita no front):
# - ``normal``: proventos < renda (barra de 2 segmentos), chip positivo.
# - ``cobrem``: proventos cobrem a renda (100% proventos), chip NEGATIVO.
# - ``zero``: piso de herança acima do patrimônio — renda de hoje 0, a tabela
#   de pisos continua e traz o piso configurado de 7 dígitos (teste de 320 px).
# - ``curta``: 6 pontos de histórico, sem o mês de 12 meses atrás (chip some).
_RENDA_P = 400000.0
_RENDA_MESES = [f"{a}-{m:02d}" for a, m in
                [(2028 + (9 + i) // 12, (9 + i) % 12 + 1) for i in range(24)]]  # 2028-10..2030-09


def _eom(ym: str) -> str:
    a, m = map(int, ym.split("-"))
    if ym == "2030-09":
        return "2030-09-25"   # o último ponto é o "hoje" (data da partida da projeção)
    prox = date(a + m // 12, m % 12 + 1, 1)
    return (prox - timedelta(days=1)).isoformat()


def _renda_historico(inicio: float, ha12: float, fim: float, n: int = 24) -> list[dict]:
    """Série linear por trechos: ``inicio`` no 1º mês, ``ha12`` no mês de 12
    meses atrás (índice 11 de 24) e ``fim`` hoje. ``n`` < 13 corta o começo."""
    vals = []
    for i in range(24):
        if i <= 11:
            v = inicio + (ha12 - inicio) * i / 11
        else:
            v = ha12 + (fim - ha12) * (i - 11) / 12
        vals.append(round(v, 2))
    pontos = [{"data": _eom(ym), "mensal": v} for ym, v in zip(_RENDA_MESES, vals)]
    return pontos[-n:]


def _renda_sintetica(variante: str = "normal") -> dict:
    assert variante in ("normal", "cobrem", "zero", "curta"), variante
    proj = _projecao_sintetica()
    zero = variante == "zero"
    piso_cfg = 1200000.0 if zero else 0.0
    mensal = 0.0 if zero else 1250.0
    if variante == "cobrem":
        historico = _renda_historico(700.0, 1345.5, mensal)
    elif zero:
        historico = [{**p, "mensal": 0.0} for p in _renda_historico(1.0, 1.0, 1.0)]
    else:
        historico = _renda_historico(600.0, 1070.0, mensal, n=6 if variante == "curta" else 24)
    variacao = None if variante == "curta" else round(mensal - historico[-13]["mensal"], 2)
    dividendos = {"normal": 520.0, "curta": 520.0, "cobrem": 1250.0, "zero": 0.0}[variante]
    linhas = []
    for f in proj["faixas"][1:]:   # o ponto 0 da projeção é "hoje"
        cresce = f["p50"] / _RENDA_P * (1 + 0.01 * (f["idade"] - 30))
        p50 = 1250.0 * cresce
        lin = {"idade": f["idade"], "ano": f["ano"],
               "p10": p50 * f["p10"] / f["p50"], "p50": p50, "p90": p50 * f["p90"] / f["p50"]}
        if zero:
            lin.update({k: max(0.0, lin[k] - 3000.0) for k in ("p10", "p50", "p90")})
        linhas.append({k: (round(v, 2) if isinstance(v, float) else v) for k, v in lin.items()})
    guard = {0.2: 1530.0, 0.0: 1250.0, -0.2: 980.0, -0.35: 780.0}
    guardrails = [{"choque": s, "patrimonio": round(_RENDA_P * (1 + s), 2),
                   "mensal": 0.0 if zero else m} for s, m in guard.items()]
    pisos = [(0.0, 1250.0), (200000.0, 1010.0), (400000.0, 760.0)]
    if zero:
        pisos.append((piso_cfg, 0.0))
    return {
        "premissas": {"idade_atual": 30, "idade_horizonte": 95, "probabilidade": 0.9,
                      "piso_heranca_brl": piso_cfg,
                      "fonte": {"nome": proj["premissas"]["fonte"]["nome"],
                                "edicao": proj["premissas"]["fonte"]["edicao"]}},
        "hoje": {"anual": round(mensal * 12, 2), "mensal": mensal,
                 "variacao_12m_mensal": variacao, "dividendos_mensal": dividendos,
                 "vendas_mensal": round(mensal - dividendos, 2),
                 "proventos_cobrem": variante == "cobrem"},
        "historico": historico,
        "projecao": linhas,
        "marcos": [i for i in range(5, 66, 5) if i > 30],
        "guardrails": guardrails,
        "heranca": {"mediana_horizonte": 0.0 if zero else 1850000.0,
                    "pisos": [{"piso": p, "mensal": m, "configurado": p == piso_cfg} for p, m in pisos]},
    }


# Molde de tipos medido no bloco ``renda`` real do backend (24/10/2026, só
# tipos, nenhum valor). ``variacao_12m_mensal`` é ``None`` sem 12 meses.
_MOLDE_RENDA = json.loads(r'''{
    "premissas": {"idade_atual": "int", "idade_horizonte": "int", "probabilidade": "float",
                  "piso_heranca_brl": "float", "fonte": {"nome": "str", "edicao": "int"}},
    "hoje": {"anual": "float", "mensal": "float", "variacao_12m_mensal": "float|NoneType",
             "dividendos_mensal": "float", "vendas_mensal": "float", "proventos_cobrem": "bool"},
    "historico": [{"data": "str", "mensal": "float"}],
    "projecao": [{"idade": "int", "ano": "int", "p10": "float", "p50": "float", "p90": "float"}],
    "marcos": ["int"],
    "guardrails": [{"choque": "float", "patrimonio": "float", "mensal": "float"}],
    "heranca": {"mediana_horizonte": "float",
                "pisos": [{"piso": "float", "mensal": "float", "configurado": "bool"}]}
}''')


def _valida_forma_renda() -> None:
    """Paridade de forma com o backend + as invariantes que o bloco real
    garante (``src/output/renda_bloco.py``), para a fixture não ensinar ao
    front um estado que o backend não produz."""
    for v in ("normal", "cobrem", "zero", "curta"):
        b = _renda_sintetica(v)
        _confere_forma(_forma(b), _MOLDE_RENDA, "renda")
        h = b["hoje"]
        assert b["historico"][-1]["mensal"] == h["mensal"], f"{v}: costura do hoje"
        assert [g["choque"] for g in b["guardrails"]] == [0.2, 0.0, -0.2, -0.35]
        assert b["guardrails"][1]["mensal"] == h["mensal"], f"{v}: guardrail 0 != hoje"
        assert round(h["anual"] / 12, 2) == h["mensal"]
        assert h["dividendos_mensal"] <= h["mensal"] or h["mensal"] == 0
        assert h["vendas_mensal"] >= 0
        assert h["proventos_cobrem"] == (h["mensal"] > 0 and h["vendas_mensal"] == 0)
        assert all(p["p10"] <= p["p50"] <= p["p90"] for p in b["projecao"])
        assert all(m > b["premissas"]["idade_atual"] for m in b["marcos"])
        pisos = [p["piso"] for p in b["heranca"]["pisos"]]
        assert pisos == sorted(pisos) and len(set(pisos)) == len(pisos)
        assert sum(p["configurado"] for p in b["heranca"]["pisos"]) == 1
        if h["variacao_12m_mensal"] is not None:
            assert len(b["historico"]) >= 13
    assert _renda_sintetica("cobrem")["hoje"]["variacao_12m_mensal"] < 0, "chip negativo"
    assert _renda_sintetica("curta")["hoje"]["variacao_12m_mensal"] is None
    assert max(p["piso"] for p in _renda_sintetica("zero")["heranca"]["pisos"]) >= 1_000_000, "7 dígitos"


# ── Fase 7a.BD.1/BD.2: bloco ``ponte`` sintético (schema v2.30) ──────────────
# CONTEÚDO 100% SINTÉTICO, GERADO POR FÓRMULA (repo público, PIN de teste
# público): valores, aportes, retornos e índices saem das senoides abaixo —
# nunca do investimentos.db, nunca pesos ou patrimônio reais. Os tickers são
# rótulos (os já presentes nesta fixture mais genéricos), sem relação com
# posição real.
#
# Desenho (o que cada pedaço exercita no front):
# - 30 meses, 2024-04..2026-09 (``ate`` = "2026-09"); índice 0 = null em todas
#   as séries, por contrato.
# - Todas as classes e linhas: acoes_br (2 picks + BOVA11 passivo), fiis (2),
#   renda_fixa passivo (IMAB11), eua picks (2), eua passive (VOO), eua fora
#   (um REIT, mais ``AVNU_REBATE`` com D = 0 e G pequeno). Sem cripto desde a
#   7a.BG.1 (só a variante ``pre_v231`` a carrega, via ``legado_cripto``).
# - EUA começa no mês 2 (``desde`` do EUA ≠ do Total).
# - Buraco no mês 4 (BBAS3): meses 4 e 5 em ``buracos`` de Total e Brasil.
# - IFIX null no mês 8 (2024-12): janela de Total/Brasil que o cruze fica
#   "índice IFIX sem dado em 12/24".
# - Salto de +100 % no S&P 500 TR (USD) no mês 16 (2025-08): retorno de janela
#   curta grande, cujo XIRR anual passa de 1000 % (1 mês ≈ 4e3; 3 meses
#   > 10) — o caso em que o Newton-Raphson da gêmea JS desistia (teto
#   |taxa| > 10) e o pyxirr não (fix round 1 da Task 7).
# - ``fluxos`` coerentes com Σ G por construção:
#   v_t − v_{t−1} − entrou_t + prov_t = Σ G (conferido em ``_confere_ponte``).
_PONTE_MESES = 30
_PONTE_INICIO = (2024, 4)
_PONTE_MES_BURACO = 4
_PONTE_MES_IFIX_NULO = 8
_PONTE_MES_SALTO = 16
_PONTE_SALTO_SP = 1.00

# (ticker, classe, passivo, cesta_eua, mes_inicio, valor_inicial, aporte, alfa, fase)
# valor_inicial e aporte em BRL (Brasil/cripto) ou USD (eua).
_PONTE_ATIVOS = [
    ("ITSA4", "acoes_br", False, None, 0, 9000.0, 400.0, 0.0030, 0.3),
    ("BBAS3", "acoes_br", False, None, 0, 7000.0, 300.0, -0.0020, 1.1),
    ("BOVA11", "acoes_br", True, None, 0, 6000.0, 250.0, 0.0002, 2.0),
    ("HGLG11", "fiis", False, None, 0, 8000.0, 350.0, 0.0025, 0.7),
    ("XPML11", "fiis", False, None, 0, 5000.0, 200.0, -0.0020, 1.9),
    ("IMAB11", "renda_fixa", True, None, 0, 4000.0, 150.0, 0.0, 2.6),
    ("AMZN", "eua", False, "picks", 2, 1500.0, 80.0, 0.0050, 0.4),
    ("MSFT", "eua", False, "picks", 2, 1200.0, 60.0, -0.0030, 1.5),
    ("VOO", "eua", True, "passive", 2, 2500.0, 120.0, 0.0001, 2.2),
    ("O", "eua", False, "fora", 2, 800.0, 0.0, -0.0015, 0.9),
    ("AVNU_REBATE", "eua", False, "fora", 3, 0.0, 0.0, 0.0, 0.0),
]

# 7a.BG.1: o backend (schema 2.31) não publica cripto no bloco ``ponte``; a
# fixture espelha isso. O ativo abaixo existe só para a variante ``pre_v231``
# (forma 2.30, com a linha ``cripto`` e o índice BTC), o payload "antigo em
# cache" que o PWA novo precisa reconhecer como desatualizado. Vai por último,
# então o id dele não desloca os dos demais.
_PONTE_ATIVO_CRIPTO_LEGADO = ("HASH11", "cripto", False, None, 6, 3000.0, 150.0, 0.0, 0.0)


def _ponte_meses(n: int = _PONTE_MESES, inicio: tuple[int, int] = _PONTE_INICIO) -> list[str]:
    ano, mes = inicio
    out = []
    for _ in range(n):
        out.append(f"{ano:04d}-{mes:02d}")
        ano, mes = (ano + 1, 1) if mes == 12 else (ano, mes + 1)
    return out


def _ponte_fx(t: int) -> float:
    """Câmbio sintético de fim de mês (BRL por USD)."""
    return round(5.0 + 0.3 * math.sin(t / 4.0) + 0.01 * t, 4)


def _ponte_indices(n: int = _PONTE_MESES, anomalias: bool = True,
                   legado_cripto: bool = False) -> tuple[dict, dict]:
    """Retornos mensais sintéticos; índice 0 sempre null; com ``anomalias``,
    IFIX null no mês 8 e salto do S&P no mês 16. Sem ``legado_cripto``, sem BTC
    (7a.BG.1)."""
    ibov, ifix, sp_usd, btc_usd, cdi = ([None] * n for _ in range(5))
    sp_brl, btc_brl = [None] * n, [None] * n
    for t in range(1, n):
        ibov[t] = round(0.008 + 0.035 * math.sin(0.7 * t), 6)
        ifix[t] = round(0.006 + 0.015 * math.sin(0.5 * t + 1.0), 6)
        sp_usd[t] = round(0.010 + 0.030 * math.sin(0.6 * t + 0.5), 6)
        btc_usd[t] = round(0.020 + 0.120 * math.sin(0.9 * t + 0.2), 6)
        cdi[t] = round(0.0085 + 0.0005 * math.sin(0.3 * t), 6)
        fx = _ponte_fx(t) / _ponte_fx(t - 1)
        sp_brl[t] = round((1.0 + sp_usd[t]) * fx - 1.0, 6)
        btc_brl[t] = round((1.0 + btc_usd[t]) * fx - 1.0, 6)
    if anomalias:
        ifix[_PONTE_MES_IFIX_NULO] = None
        sp_usd[_PONTE_MES_SALTO] = _PONTE_SALTO_SP
        fx = _ponte_fx(_PONTE_MES_SALTO) / _ponte_fx(_PONTE_MES_SALTO - 1)
        sp_brl[_PONTE_MES_SALTO] = round((1.0 + _PONTE_SALTO_SP) * fx - 1.0, 6)
    brl = {"IBOV": ibov, "IFIX": ifix, "SP500TR": sp_brl, "CDI": cdi}
    if legado_cripto:
        brl = {**brl, "BTC": btc_brl}
    usd = {"SP500TR": sp_usd}
    return brl, usd


def _ponte_sintetica(n: int = _PONTE_MESES, inicio: tuple[int, int] = _PONTE_INICIO,
                     anomalias: bool = True, legado_cripto: bool = False,
                     extras: tuple = ()) -> dict:
    """Bloco ``ponte`` sintético (ver o comentário da seção). ``extras`` são
    ativos a mais, na forma de ``_PONTE_ATIVOS``, anexados DEPOIS de toda a
    lista (nenhum id existente se desloca). Sem
    ``anomalias``: sem IFIX null, sem salto e ``buracos`` vazio em todos os escopos.
    ``legado_cripto`` devolve a forma 2.30 (HASH11 + BTC), só para ``pre_v231``."""
    meses = _ponte_meses(n, inicio)
    ind_brl, ind_usd = _ponte_indices(n, anomalias, legado_cripto)
    base_classe = {"acoes_br": ind_brl["IBOV"], "fiis": ind_brl["IFIX"],
                   "renda_fixa": ind_brl["CDI"], "eua": ind_usd["SP500TR"]}
    lista = list(_PONTE_ATIVOS)
    if legado_cripto:
        base_classe["cripto"] = ind_brl["BTC"]
        lista.append(_PONTE_ATIVO_CRIPTO_LEGADO)
    lista.extend(extras)
    ativos = [{"t": tk, "classe": c, "passivo": p, "cesta_eua": cesta}
              for (tk, c, p, cesta, *_resto) in lista]
    brl: list[list] = [[] for _ in range(n)]
    usd: list[list] = [[] for _ in range(n)]
    chaves = ("Total", "Brasil", "EUA_BRL", "EUA_USD")
    fluxos = {k: {"v": [0.0] * n, "entrou": [0.0] * n, "prov": [0.0] * n} for k in chaves}

    def _soma(chave: str, campo: str, t: int, x: float) -> None:
        fluxos[chave][campo][t] = round(fluxos[chave][campo][t] + x, 2)

    for i, (tk, classe, passivo, _cesta, ini, v0, aporte, alfa, fase) in enumerate(lista):
        eua = classe == "eua"
        escopos = ["Total"]
        if eua:
            escopos.append("EUA_BRL")
        if classe in ("acoes_br", "fiis", "renda_fixa"):
            escopos.append("Brasil")
        v_nat = 0.0   # valor na moeda nativa (USD para eua)
        v_brl = 0.0
        for t in range(ini, n):
            if tk == "AVNU_REBATE":
                # pseudoativo sem posição: D = 0, ganho pequeno pago como provento
                if t % 2 == 1:
                    continue
                g_nat = round(0.6 + 0.3 * math.sin(t), 2)
                f_nat, prov_nat, d_nat, v_novo = 0.0, g_nat, 0.0, 0.0
            else:
                f_nat = v0 if t == ini else (aporte if (t + i) % 3 == 0 else 0.0)
                b = base_classe[classe][t] or 0.0
                if classe == "cripto":
                    r = b + (0.00002 if t % 2 else -0.00002)  # colado no BTC
                elif t > 0:
                    r = b + alfa + 0.004 * math.sin(1.3 * t + fase)
                else:
                    r = 0.0
                d_nat = round(v_nat + 0.5 * f_nat, 2)
                g_nat = round(r * d_nat, 2)
                prov_nat = 0.0
                if not passivo and classe in ("fiis", "acoes_br") and t % 3 == 1:
                    prov_nat = round(0.004 * v_nat, 2)
                if not passivo and eua and t % 3 == 2:
                    prov_nat = round(0.003 * v_nat, 2)
                v_novo = round(v_nat + f_nat + g_nat - prov_nat, 2)
            if eua:
                fx = _ponte_fx(t)
                f_brl = round(f_nat * fx, 2)
                prov_brl = round(prov_nat * fx, 2)
                vb_novo = round(v_novo * fx, 2)
                g_brl = round(vb_novo - v_brl - f_brl + prov_brl, 2)
                d_brl = round(v_brl + 0.5 * f_brl, 2)
                if d_nat != 0 or g_nat != 0:
                    usd[t].append([i, d_nat, g_nat])
                for campo, x in (("v", v_novo), ("entrou", f_nat), ("prov", prov_nat)):
                    _soma("EUA_USD", campo, t, x)
            else:
                f_brl, prov_brl, vb_novo, g_brl, d_brl = f_nat, prov_nat, v_novo, g_nat, d_nat
            if d_brl != 0 or g_brl != 0:
                brl[t].append([i, d_brl, g_brl])
            for k in escopos:
                for campo, x in (("v", vb_novo), ("entrou", f_brl), ("prov", prov_brl)):
                    _soma(k, campo, t, x)
            v_nat, v_brl = v_novo, vb_novo

    buraco = [_PONTE_MES_BURACO, _PONTE_MES_BURACO + 1] if anomalias else []  # t e t+1 (Decisão 7)
    bloco = {
        "ate": meses[-1],
        "meses": meses,
        "indices": {"BRL": ind_brl, "USD": ind_usd},
        "ativos": ativos,
        "brl": brl,
        "usd": usd,
        "fluxos": fluxos,
        "buracos": {"Total": buraco, "Brasil": list(buraco), "EUA_BRL": [], "EUA_USD": []},
    }
    return bloco


def _ponte_curta() -> dict:
    """O bloco ``ponte`` da fixture: 30 meses, com as anomalias."""
    bloco = _ponte_sintetica()
    _confere_ponte(bloco)
    return bloco


# 7a.BE.2: bloco longo, só do teste cruzado (``bloco_longo`` em
# ponte_esperado.test.json, nunca no payload cifrado). 72 meses terminando no
# mesmo ``ate`` do curto, SEM anomalias -- buraco e IFIX null tornariam 5a/desde
# indisponíveis, e o salto já é coberto pelo curto. Existe para que 3a e 5a da
# gêmea JS sejam conferidos com valor, não só com o motivo de indisponível.
_PONTE_LONGO_MESES = 72
_PONTE_LONGO_INICIO = (2020, 10)


def _ponte_longa() -> dict:
    from src.calculadora.ponte import janelas_fixas

    bloco = _ponte_sintetica(_PONTE_LONGO_MESES, _PONTE_LONGO_INICIO, anomalias=False)
    _confere_ponte(bloco, "2020-10")
    for escopo, moeda in _PONTE_ESCOPOS:
        fixas = janelas_fixas(bloco, escopo, moeda)
        for k in ("12m", "3a", "5a", "desde"):
            assert fixas[k]["indisponivel"] is None, (
                f"bloco longo {escopo}/{moeda} {k}: {fixas[k]['indisponivel']!r}")
    return bloco


# 7a.BH.1: linha longa. 9 ativos SINT* a mais em ``acoes_br`` (4 de alfa
# positivo, 4 de negativo e 1 minúsculo, que cai em "junto"): com ITSA4 e BBAS3
# a linha ``acoes_br`` tem 11 ativos, para o e2e de "todos os ativos, sem Outros".
_PONTE_EXTRAS_MUITOS = [
    ("SINTA3", "acoes_br", False, None, 0, 5000.0, 200.0, 0.0090, 0.2),
    ("SINTB3", "acoes_br", False, None, 0, 4500.0, 180.0, 0.0060, 0.8),
    ("SINTC3", "acoes_br", False, None, 0, 4000.0, 160.0, 0.0040, 1.4),
    ("SINTD3", "acoes_br", False, None, 0, 3500.0, 140.0, 0.0025, 2.1),
    ("SINTE3", "acoes_br", False, None, 0, 5000.0, 200.0, -0.0180, 0.5),
    ("SINTF3", "acoes_br", False, None, 0, 4500.0, 180.0, -0.0120, 1.1),
    ("SINTG3", "acoes_br", False, None, 0, 4000.0, 160.0, -0.0080, 1.7),
    ("SINTH3", "acoes_br", False, None, 0, 3500.0, 140.0, -0.0050, 2.4),
    ("SINTI3", "acoes_br", False, None, 0, 20.0, 0.0, 0.0, 0.0),
]


def _ponte_muitos() -> dict:
    """Bloco ``ponte`` da fixture de linha longa: a forma do curto (30 meses,
    com anomalias) mais ``_PONTE_EXTRAS_MUITOS``. Afirma, pela referência
    Python e com a conta da tela, que a janela 12m do Brasil exercita os três
    grupos de ``acoes_br`` e que existem linhas exibidas > 0 e < 0."""
    from src.calculadora.ponte import arredondar_fechando, janelas_fixas

    bloco = _ponte_sintetica(extras=tuple(_PONTE_EXTRAS_MUITOS))
    _confere_ponte(bloco)
    j = janelas_fixas(bloco, "Brasil", "BRL")["12m"]
    assert j["indisponivel"] is None, j["indisponivel"]
    sua_d = round(j["sua"] * 100, 1)
    ind_d = round(j["ind"] * 100, 1)
    exib = arredondar_fechando([l["contrib"] * 100 for l in j["linhas"]], round(sua_d - ind_d, 1))
    linhas = {l["id"]: v for l, v in zip(j["linhas"], exib)}
    ativos = j["ativos"]["acoes_br"]
    itens = arredondar_fechando([a["contrib"] * 100 for a in ativos], linhas["acoes_br"])
    pos = sum(1 for v in itens if v >= 0.05)
    neg = sum(1 for v in itens if v <= -0.05)
    zero = sum(1 for v in itens if abs(v) < 0.05)
    assert len(itens) == 11, len(itens)
    assert pos >= 4 and neg >= 4 and zero >= 1, (pos, neg, zero, itens)
    # Escopos nomeados do e2e "ordem dos grupos na tela": uma linha exibida < 0
    # (``acoes_br``) e uma > 0 (``fiis``) na 12m do Brasil.
    assert linhas["acoes_br"] < 0 < linhas["fiis"], linhas
    print("ponte_muitos 12m Brasil:", linhas, "itens acoes_br:", itens)
    return bloco


def _confere_ponte(bloco: dict, primeiro: str = "2024-04") -> None:
    """Fluxos coerentes com Σ G por escopo: v_t − v_{t−1} − entrou_t + prov_t = Σ G."""
    ativos = bloco["ativos"]
    brasil = ("acoes_br", "fiis", "renda_fixa")
    filtros = {
        "Total": ("brl", lambda a: True),
        "Brasil": ("brl", lambda a: a["classe"] in brasil),
        "EUA_BRL": ("brl", lambda a: a["classe"] == "eua"),
        "EUA_USD": ("usd", lambda a: a["classe"] == "eua"),
    }
    for chave, (serie, filtro) in filtros.items():
        fl = bloco["fluxos"][chave]
        for t in range(len(bloco["meses"])):
            v_ant = fl["v"][t - 1] if t > 0 else 0.0
            soma_g = sum(g for i, _d, g in bloco[serie][t] if filtro(ativos[i]))
            lado = fl["v"][t] - v_ant - fl["entrou"][t] + fl["prov"][t]
            assert abs(lado - soma_g) < 0.015, f"fluxos {chave} mes {t}: {lado} != {soma_g}"
    assert bloco["meses"][0] == primeiro and bloco["ate"] == "2026-09"
    assert all(s[0] is None for m in bloco["indices"].values() for s in m.values())


PAYLOAD = {
    "versao": "2.32",
    "atualizado_em": "2026-04-26T15:00:00",
    # 7a.AE.2/AE.3 — `atualizado_em` acima e o carimbo de PUBLICACAO; este e o
    # do FECHAMENTO. Datas MISTAS de proposito: o intervalo e o caso que a tela
    # precisa saber exibir, e o homogeneo e o facil. Numeros sinteticos.
    "frescor_cotacoes": {
        "Total": {"min": "2026-08-17", "max": "2026-08-18",
                  "por_data": {"2026-08-17": 5, "2026-08-18": 33},
                  "sem_cotacao": 0},
        "Brasil": {"min": "2026-08-17", "max": "2026-08-18",
                   "por_data": {"2026-08-17": 5, "2026-08-18": 21},
                   "sem_cotacao": 0},
        "EUA": {"min": "2026-08-18", "max": "2026-08-18",
                "por_data": {"2026-08-18": 12}, "sem_cotacao": 0},
    },
    "patrimonio": {
        "total_brl": 258000.0,
        # 7a.BG.1 (2.31): ``br_brl`` INCLUI a cripto (149640 + 20640), como o
        # backend; ``carteira_*`` é o recorte sem cripto. 170280 + 87720 = 258000.
        "br_brl": 170280.0,
        "eua_brl": 87720.0,
        "cripto_brl": 20640.0,
        "carteira_brl": 237360.0,
        "carteira_br_brl": 149640.0,
        "variacao_semanal_brl": 3100.0,
        "variacao_semanal_pct": 0.012,
        "evolucao": [
            # Série mensal EOM v2.4 (7a.E.6): {data, total_brl, aportes_acum_brl}
            {"data": "2024-04-30", "total_brl": 150000.0, "aportes_acum_brl": 140000.0},
            {"data": "2024-05-31", "total_brl": 158500.0, "aportes_acum_brl": 148000.0},
            {"data": "2024-06-30", "total_brl": 168200.0, "aportes_acum_brl": 156000.0},
            {"data": "2024-07-31", "total_brl": 176800.0, "aportes_acum_brl": 164000.0},
            {"data": "2024-08-31", "total_brl": 185100.0, "aportes_acum_brl": 172000.0},
            {"data": "2024-09-30", "total_brl": 194600.0, "aportes_acum_brl": 180000.0},
            {"data": "2024-10-31", "total_brl": 202900.0, "aportes_acum_brl": 188000.0},
            {"data": "2024-11-30", "total_brl": 212500.0, "aportes_acum_brl": 196000.0},
            {"data": "2024-12-31", "total_brl": 220300.0, "aportes_acum_brl": 204000.0},
            {"data": "2025-01-31", "total_brl": 228700.0, "aportes_acum_brl": 212000.0},
            {"data": "2025-02-28", "total_brl": 238400.0, "aportes_acum_brl": 220000.0},
            {"data": "2026-04-24", "total_brl": 258000.0, "aportes_acum_brl": 240000.0},
        ],
    },
    "alocacao": {
        # 7a.M.1: +Renda Fixa BR (5ª categoria; EUA 0.40→0.30, RF BR 0.10 conforme spec).
        "atual": {"EUA": 0.43, "Ações BR": 0.29, "FIIs": 0.22, "Renda Fixa BR": 0.06},
        "alvo":  {"EUA": 0.33, "Ações BR": 0.33, "FIIs": 0.22, "Renda Fixa BR": 0.12},
    },
    "rentabilidade": {
        "Total": {
            "xirr_origem": 0.1118,
            "xirr_ytd": 0.034,
            "xirr_12m": 0.089,
            "twr_origem": 0.095,
            "twr_ytd": 0.030,
            "twr_12m": 0.078,
            "benchmarks": {
                "IBOV": {
                    "xirr_espelhado": {"origem": 0.021, "ytd": 0.012, "12m": 0.018},
                    "twr_espelhado":  {"origem": 0.019, "ytd": 0.011, "12m": 0.017},
                },
                "S&P 500": {
                    "xirr_espelhado": {"origem": 0.058, "ytd": 0.022, "12m": 0.041},
                    "twr_espelhado":  {"origem": 0.052, "ytd": 0.020, "12m": 0.039},
                },
            },
            # 7a.E.25/7a.E.26: Total chart = Portfólio + CDI + IBOV + S&P 500 (4 linhas).
            "historico_twr": _serie_mensal(
                0.05, 0.118, 0.04, 0.08,
                benchmarks={"CDI": (0.04, 0.08), "IBOV": (0.03, 0.067), "SP500": (0.06, 0.19)},
            ),
            # Schema v2.14 (Fase 7a.L.2.a): historico_periodo flat (Total/Brasil).
            # Schema v2.18 (7a.E.26): benchmarks_growth {CDI,IBOV,SP500} distintos
            # ⇒ card "Período" mostra 3 deltas distintos (anti-regressão accessor).
            "historico_periodo": _serie_periodo(
                200000.0, 258000.0, 50000.0, 1.08,
                benchmarks_growth={"CDI": 1.05101, "IBOV": 1.093299, "SP500": 1.066712},
            ),
        },
        "Brasil": {
            "xirr_origem": 0.091,
            "xirr_ytd": 0.028,
            "xirr_12m": 0.061,
            "twr_origem": 0.078,
            "twr_ytd": 0.024,
            "twr_12m": 0.055,
            "benchmarks": {
                "IBOV": {
                    "xirr_espelhado": {"origem": 0.021, "ytd": 0.012, "12m": 0.018},
                    "twr_espelhado":  {"origem": 0.019, "ytd": 0.011, "12m": 0.017},
                },
                "CDI": {
                    "xirr_espelhado": {"origem": 0.025, "ytd": 0.013, "12m": 0.022},
                    "twr_espelhado":  {"origem": 0.024, "ytd": 0.012, "12m": 0.021},
                },
            },
            # 7a.E.26: Brasil chart = Portfólio + CDI + IBOV (3 linhas). CDI segue
            # o benchmark principal (baixo); IBOV diverge para cima ⇒ linhas distintas.
            "historico_twr": _serie_mensal(
                0.04, 0.078, 0.02, 0.025,
                benchmarks={"CDI": (0.02, 0.025), "IBOV": (0.03, 0.067)},
            ),
            "historico_periodo": _serie_periodo(
                120000.0, 150000.0, 25000.0, 1.025,
                benchmarks_growth={"CDI": 1.05101, "IBOV": 1.093299},
            ),
        },
        # Schema v2.7 (Fase 7a.E.14): EUA.historico_twr aninhado {brl, usd}.
        # Trilho USD tem só SP500 nos benchmarks (CDI/IBOV/IFIX são BRL-only).
        # USD série mensal histórica vem sem coluna benchmark (chart só portfolio).
        "EUA": {
            "brl": {
                "xirr_origem": 0.138,
                "xirr_ytd": 0.058,
                "xirr_12m": 0.112,
                "twr_origem": 0.118,
                "twr_ytd": 0.051,
                "twr_12m": 0.098,
                "benchmarks": {
                    "SP500": {
                        "xirr_espelhado": {"origem": 0.058, "ytd": 0.022, "12m": 0.041},
                        "twr_espelhado":  {"origem": 0.052, "ytd": 0.020, "12m": 0.039},
                    },
                },
            },
            "usd": {
                "xirr_origem": 0.155,
                "xirr_ytd": 0.048,
                "xirr_12m": 0.275,
                "twr_origem": 0.142,
                "twr_ytd": 0.046,
                "twr_12m": 0.268,
                "benchmarks": {
                    "SP500": {
                        "xirr_espelhado": {"origem": 0.142, "ytd": 0.041, "12m": 0.284},
                        "twr_espelhado":  {"origem": 0.138, "ytd": 0.040, "12m": 0.281},
                    },
                },
            },
            "historico_twr": {
                "brl": _serie_mensal(0.06, 0.118, 0.05, 0.058),
                # 7a.E.15: USD agora também emite benchmark (S&P 500 USD-nativo).
                "usd": _serie_mensal(0.04, 0.275, 0.03, 0.214),
            },
            # Schema v2.14: historico_periodo aninhado {brl, usd} em EUA.
            "historico_periodo": {
                "brl": _serie_periodo(60000.0, 88000.0, 22000.0, 1.058),
                "usd": _serie_periodo(12000.0, 17000.0, 4000.0, 1.214),
            },
        },
    },
    "benchmarks_12m": {
        "cdi":   0.108,
        "ibov":  0.064,
        "ifix":  0.052,
        "sp500": 0.187,
        "usd":   0.031,
    },
    # Schema v2.16 (Fase 7a.E.24): dividend yield trailing-12m por escopo.
    # Keys: total/acao_br/fii/eua. dy pode ser null → PWA renderiza "—".
    "dividend_yield": {
        "total":   {"dy": 0.0303, "proventos_12m": 7441.76, "valor": 245479.66, "moeda": "BRL"},
        "acao_br": {"dy": 0.0482, "proventos_12m": 1266.05, "valor": 26240.34, "moeda": "BRL"},
        "fii":     {"dy": 0.0780, "proventos_12m": 4798.97, "valor": 61556.69, "moeda": "BRL"},
        "eua":     {"dy": 0.0082, "proventos_12m": 248.17, "valor": 30199.95, "moeda": "USD"},
        # Schema v2.23 (Fase 7a.S.7a backend / 7a.S.7b frontend Task 0/1):
        # pódio top-3 yielders por categoria, consumido pela tela #s-dy.
        # Valores 100% SINTÉTICOS (repo público) — tickers reaproveitados do
        # universo já presente no fixture (politica/posicoes/relatorio) por
        # coerência narrativa, sem relação com o portfólio real do Dr. Arthur.
        "campeoes": {
            "acao_br": [
                {"ticker": "ITSA4", "dy": 0.082, "proventos_12m": 1394.0,
                 "valor": 17000.0, "moeda": "BRL", "bandeira": "🇧🇷"},
                {"ticker": "BBAS3", "dy": 0.065, "proventos_12m": 585.0,
                 "valor": 9000.0, "moeda": "BRL", "bandeira": "🇧🇷"},
                {"ticker": "SMAL11", "dy": 0.034, "proventos_12m": 170.0,
                 "valor": 5000.0, "moeda": "BRL", "bandeira": "🇧🇷"},
            ],
            "fii": [
                {"ticker": "HGLG11", "dy": 0.091, "proventos_12m": 682.5,
                 "valor": 7500.0, "moeda": "BRL", "bandeira": "🇧🇷"},
                {"ticker": "XPML11", "dy": 0.078, "proventos_12m": 727.0,
                 "valor": 9320.0, "moeda": "BRL", "bandeira": "🇧🇷"},
                {"ticker": "KISU11", "dy": 0.062, "proventos_12m": 303.8,
                 "valor": 4900.0, "moeda": "BRL", "bandeira": "🇧🇷"},
            ],
            "eua": [
                {"ticker": "VWO", "dy": 0.036, "proventos_12m": 442.8,
                 "valor": 12300.0, "moeda": "USD", "bandeira": "🇺🇸"},
                {"ticker": "IJS", "dy": 0.024, "proventos_12m": 194.4,
                 "valor": 8100.0, "moeda": "USD", "bandeira": "🇺🇸"},
                {"ticker": "VOO", "dy": 0.019, "proventos_12m": 513.76,
                 "valor": 27040.0, "moeda": "USD", "bandeira": "🇺🇸"},
            ],
        },
        # Schema v2.24 (Fase 7a.E.32): DY por ticker, consumido pelo #alocacao.
        # Valores 100% SINTÉTICOS (repo público). Os 9 campeões repetem o
        # MESMO dy de `campeoes` — a invariante da fase é que pódio e linha
        # nunca divergem. BOVA11 é omitido DE PROPÓSITO: é o ticker que
        # exercita o traço "—" nos testes.
        "por_ativo": {
            "ITSA4": 0.082,
            "BBAS3": 0.065,
            "SMAL11": 0.034,
            "HGLG11": 0.091,
            "XPML11": 0.078,
            "KISU11": 0.062,
            "VWO": 0.036,
            "IJS": 0.024,
            "VOO": 0.019,
            "KNIP11": 0.108,   # quarentena: a linha muda, o DY não some
            "LREN3": 0.021,    # fora do alvo: idem
        },
        # Schema v2.25 (Fase 7a.E.35): tickers de posição aberta < 12m (DY
        # trailing-12m subestimado) → selo "posição < 12 meses" no card DY de
        # #ativo. Lista 100% SINTÉTICA (repo público): HGLG11 marcado só para
        # exercitar o selo — nenhuma relação com o portfólio real do Dr. Arthur.
        # VOO fica DE FORA (é o ticker que exercita a ausência do selo).
        "por_ativo_parcial": ["HGLG11"],
    },
    "proventos": {
        "ytd_brl": 3240.0,
        "ano_anterior_brl": 9820.0,
        "mensal": [
            {"mes": "2026-04", "brl": 820.0},
            {"mes": "2026-03", "brl": 790.0},
            {"mes": "2026-02", "brl": 810.0},
        ],
        # v2.4 — campos adicionados pela Fase 7a.E.5
        "evolucao_anual": [
            {"ano": 2021, "total": 4200.0},
            {"ano": 2022, "total": 7350.0},
            {"ano": 2023, "total": 8600.0},
            {"ano": 2024, "total": 9820.0},
            {"ano": 2025, "total": 9820.0},
            {"ano": 2026, "total": 3240.0},
        ],
        "mensal_12m": [
            {"mes": "2025-05", "valor": 810.0},
            {"mes": "2025-06", "valor": 790.0},
            {"mes": "2025-07", "valor": 820.0},
            {"mes": "2025-08", "valor": 800.0},
            {"mes": "2025-09", "valor": 830.0},
            {"mes": "2025-10", "valor": 795.0},
            {"mes": "2025-11", "valor": 815.0},
            {"mes": "2025-12", "valor": 840.0},
            {"mes": "2026-01", "valor": 780.0},
            {"mes": "2026-02", "valor": 810.0},
            {"mes": "2026-03", "valor": 790.0},
            {"mes": "2026-04", "valor": 820.0},
        ],
        "por_ativo_origem": [
            {"ticker": "HGLG11", "total": 18540.0},
            {"ticker": "XPML11", "total": 9320.0},
            {"ticker": "ITSA4",  "total": 4210.0},
        ],
        "por_ativo_12m": [
            {"ticker": "HGLG11", "total": 4820.0},
            {"ticker": "XPML11", "total": 2380.0},
            {"ticker": "ITSA4",  "total": 1020.0},
        ],
    },
    "ultimo_aporte": {
        "data": "2026-04-20",
        "dias_atras": 4,
        "total_brl": 5000.0,
        "itens": [
            {
                "ticker": "ITSA4",
                "bandeira": "🇧🇷",
                "quantidade": 500,
                "preco_unitario": 10.0,
                "valor_brl": 5000.0,
            },
        ],
    },
    "top5_xirr": [],
    "posicoes": [
        {
            "ticker": "HGLG11",
            "classe": "FIIs",
            "moeda": "BRL",
            "quantidade": 50,
            "custo_medio": 130.0,
            "ultimo_preco": 150.0,
            "valor_mercado_brl": 7500.0,
            "ganho_perda_brl": 1000.0,
            "ganho_perda_pct": 0.1538,
            "xirr_aa": 0.092,
            "movimentos": [
                {
                    "data": "2026-04-15",
                    "lado": "Compra",
                    "quantidade": 8,
                    "preco_unitario": 131.25,
                    "total_brl": 1050.0,
                },
                {
                    "data": "2026-03-10",
                    "lado": "Compra",
                    "quantidade": 5,
                    "preco_unitario": 129.80,
                    "total_brl": 649.0,
                },
            ],
            "proventos": [
                {
                    "data_pagamento": "2026-04-05",
                    "valor_liquido_brl": 87.20,
                    "tipo": "Rendimento",
                },
                {
                    "data_pagamento": "2026-03-05",
                    "valor_liquido_brl": 85.10,
                    "tipo": "Rendimento",
                },
            ],
        },
        {
            "ticker": "VOO",
            "classe": "Exterior",
            "moeda": "USD",
            "quantidade": 10,
            "custo_medio": 480.0,
            "ultimo_preco": 520.0,
            "valor_mercado_brl": 27040.0,
            "ganho_perda_brl": 2080.0,
            "ganho_perda_pct": 0.0833,
            "xirr_aa": 0.118,
            "movimentos": [
                {
                    "data": "2026-04-20",
                    "lado": "Compra",
                    "quantidade": 1,
                    "preco_unitario": 520.0,
                    "total_brl": 2704.0,
                },
            ],
            "proventos": [],
        },
    ],
    # Schema v3 (7a.E.22): politica.categorias[].buckets[] (passive + picks).
    # Status agora derivado no cliente a partir de drift_intra.
    "politica": {
        "categorias": [
            {
                "nome": "Ações BR",
                "peso_alvo": 0.30,
                # peso_atual_cat = 0.05+0.05+0.17+0.0+0.002 (KNIP11 residual) = 0.272
                "peso_atual": 0.272,
                "drift": -0.028,
                # 7a.E.31 (v2.20): valor_brl da categoria = soma dos ativos
                # (inclui off-policy). 5000+5000+17000+0+200+3000 = 30200.
                "valor_brl": 30200.0,
                "buckets": [
                    {
                        "tipo": "passive",
                        "peso_bucket": 0.40,
                        # peso_atual_bucket é intra-categoria (= 0.10/0.272).
                        "peso_atual_bucket": 0.367647,
                        "drift_bucket": -0.032353,
                        "ativos": [
                            {
                                "ticker": "BOVA11",
                                "tipo": "passive",
                                "quarentena": False,
                                "peso_intra": 0.60,
                                "peso_intra_atual": 0.50,
                                "drift_intra": -0.10,
                                "peso_alvo": 0.072,
                                "peso_atual": 0.05,
                                "drift": -0.022,
                                "valor_brl": 5000.0,
                                "bandeira": "🇧🇷",
                            },
                            {
                                "ticker": "SMAL11",
                                "tipo": "passive",
                                "quarentena": False,
                                "peso_intra": 0.40,
                                "peso_intra_atual": 0.50,
                                "drift_intra": 0.10,
                                "peso_alvo": 0.048,
                                "peso_atual": 0.05,
                                "drift": 0.002,
                                "valor_brl": 5000.0,
                                "bandeira": "🇧🇷",
                            },
                        ],
                    },
                    {
                        "tipo": "picks",
                        "equal_weight": True,
                        "peso_bucket": 0.60,
                        # peso_atual_bucket é intra-categoria; raw inclui KNIP11
                        # quarentenado (0.17+0.002 = 0.172 / 0.272).
                        "peso_atual_bucket": 0.632353,
                        "drift_bucket": 0.032353,
                        "ativos": [
                            {
                                "ticker": "ITSA4",
                                "tipo": "pick",
                                "quarentena": False,
                                "peso_intra": 0.50,
                                "peso_intra_atual": 1.0,
                                "drift_intra": 0.50,
                                "peso_alvo": 0.09,
                                "peso_atual": 0.17,
                                "drift": 0.08,
                                "valor_brl": 17000.0,
                                "bandeira": "🇧🇷",
                            },
                            {
                                "ticker": "BBAS3",
                                "tipo": "pick",
                                "quarentena": False,
                                "peso_intra": 0.50,
                                "peso_intra_atual": 0.0,
                                "drift_intra": -0.50,
                                "peso_alvo": 0.09,
                                "peso_atual": 0.0,
                                "drift": -0.09,
                                "valor_brl": 0.0,
                                "bandeira": "🇧🇷",
                            },
                            {
                                # 7a.E.28: pick quarentenado (investidor
                                # qualificado). Fora do equal-weight (peso_intra
                                # 0, peso_alvo 0) com posição residual. O backend
                                # ainda computa peso_intra_atual = atual/ew
                                # (0.002/0.17 ≈ 0.011765) — o denominador EW exclui
                                # o quarentenado, mas o numerador do próprio ticker
                                # não é zerado. Como drift_intra > 0, o guard
                                # explícito `quarentena` (não o filtro drift>0) é
                                # o que o exclui do #aportar.
                                "ticker": "KNIP11",
                                "tipo": "pick",
                                "quarentena": True,
                                "peso_intra": 0.0,
                                "peso_intra_atual": 0.011765,
                                "drift_intra": 0.011765,
                                "peso_alvo": 0.0,
                                "peso_atual": 0.002,
                                "drift": 0.002,
                                "valor_brl": 200.0,
                                "bandeira": "🇧🇷",
                            },
                            {
                                # 7a.E.31: held off-policy (posição fora do YAML).
                                # Injetado na cesta picks como fora_do_alvo; drift/
                                # peso_intra neutros (0); selo "fora do alvo" no PWA.
                                "ticker": "LREN3",
                                "tipo": "pick",
                                "fora_do_alvo": True,
                                "quarentena": False,
                                "peso_intra": 0,
                                "peso_intra_atual": 0,
                                "drift_intra": 0,
                                "peso_alvo": 0,
                                "peso_atual": 0.03,
                                "drift": 0,
                                "valor_brl": 3000.0,
                                "bandeira": "🇧🇷",
                            },
                        ],
                    },
                ],
            },
            {
                "nome": "EUA",
                "peso_alvo": 0.70,
                "peso_atual": 0.73,
                "drift": 0.03,
                "valor_brl": 73000.0,
                "buckets": [
                    {
                        "tipo": "passive",
                        "peso_bucket": 1.00,
                        # Single-bucket: intra-categoria = 1.0, drift 0.
                        "peso_atual_bucket": 1.0,
                        "drift_bucket": 0.0,
                        "ativos": [
                            {
                                "ticker": "VOO",
                                "tipo": "passive",
                                "quarentena": False,
                                "peso_intra": 1.0,
                                "peso_intra_atual": 1.0,
                                "drift_intra": 0.0,
                                "peso_alvo": 0.70,
                                "peso_atual": 0.73,
                                "drift": 0.03,
                                "valor_brl": 73000.0,
                                "bandeira": "🇺🇸",
                            },
                        ],
                    },
                ],
            },
        ],
    },
    # Schema v2.28 (Fase 7a.AW): projeção como ensaio (4 cenários: âncoras
    # twr/xirr + comparações mercado_simples/mercado_rebalanceado).
    "projecao": _projecao_sintetica(),
    # Schema v2.30 (Fase 7a.BD.1): ponte de rentabilidade (série mensal por
    # ativo + índices + fluxos). 100% sintético, gerado por fórmula.
    "ponte": _ponte_curta(),
    # Schema v2.32 (Fase 7a.BJ.1/BJ.2): renda da carteira. 100% sintético.
    "renda": _renda_sintetica("normal"),
}

# Payloads de versão anterior à 2.32 não carregam ``renda``.
_PRE_RENDA = {k: v for k, v in PAYLOAD.items() if k != "renda"}


# ── Fase 7a.Q.3: fixtures do Relatório Mensal (índice + 2 meses) ─────────────
def _secoes(mes_label: str, *, mes1: bool) -> list[dict]:
    p_contas = (
        "Primeiro relatório — sem mês anterior a prestar contas."
        if mes1 else
        "No mês passado sinalizei HASH11 no radar [1]. Resultado: seguiu de lado, "
        "tese intacta."
    )
    return [
        {"id": "prestacao_contas", "titulo": "Prestação de contas", "corpo": p_contas},
        {"id": "leitura_mes", "titulo": "Leitura do mês",
         "corpo": f"{mes_label} foi um mês de avanço sólido, puxado pela ponta nos EUA."},
        {"id": "como_voce_foi", "titulo": "Como você foi",
         "corpo": "A carteira rendeu acima do CDI e do IBOV na janela [2]."},
        {"id": "funcionando", "titulo": "O que está funcionando",
         "corpo": "VOO e AMZN lideraram as altas, ambos em dólar."},
        {"id": "nao_funcionando", "titulo": "O que NÃO está funcionando",
         "corpo": "HASH11 e SMAL11 recuaram. Acompanho de perto a tese de cada um [3]."},
        {"id": "renda", "titulo": "Renda",
         "corpo": "Os proventos do mês vieram em linha com o run-rate."},
        {"id": "alinhamento", "titulo": "Alinhamento",
         "corpo": "A concentração no topo segue dentro do esperado."},
        {"id": "radar", "titulo": "Radar",
         "corpo": "O que observar adiante, sem ação imediata."},
        {"id": "evidencias", "titulo": "Evidências & fontes",
         "corpo": "Fontes citadas ao longo do relatório."},
    ]


def _relatorio(mes: str, mes_label: str, gerado_para: str, *, mes1: bool) -> dict:
    return {
        "schema": "relatorio_mensal_v1",
        "mes": mes,
        "gerado_em": gerado_para,
        "gerado_para": gerado_para,
        "titulo": f"{mes_label} — Relatório do assessor",
        "secoes": _secoes(mes_label, mes1=mes1),
        "radar": [
            {"ticker": "HASH11", "observar": "fluxo de cripto e prêmio/desconto",
             "gatilho": "desconto > 5% por 2 meses", "veredito": "intacta"},
            {"ticker": "SMAL11", "observar": "juros longos e small caps",
             "gatilho": "rompimento de suporte", "veredito": "sob_pressao"},
            {"ticker": "KISU11", "observar": "vacância e dividendos",
             "gatilho": "corte de provento", "veredito": "deteriorando"},
        ],
        "prestacao_contas": ([] if mes1 else [
            {"ticker": "HASH11", "sinalizado": "fluxo de cripto — reavaliar em desconto > 5%",
             "resultado": "seguiu de lado, tese intacta"},
        ]),
        "citacoes": [
            {"id": 1, "afirmacao": "HASH11 no radar do mês anterior",
             "fonte": "Relatório anterior", "url": "https://example.com/hash11",
             "confianca": "alta"},
            {"id": 2, "afirmacao": "Carteira acima do CDI na janela",
             "fonte": "Dossiê determinístico", "url": "https://example.com/perf",
             "confianca": "alta"},
            {"id": 3, "afirmacao": "Tese de small caps sob pressão",
             "fonte": "Pesquisa focada", "url": "https://example.com/smal",
             "confianca": "baixa"},
        ],
        # NOTA: valores 100% SINTÉTICOS (não correspondem ao patrimônio/câmbio reais
        # do Dr. Arthur). O sibling é repo PÚBLICO e o `.enc` decifra com o PIN de
        # teste público 123456 — qualquer número aqui é efetivamente plaintext.
        # Mantêm as identidades do dossiê: delta = fim − base = aportes + proventos +
        # mercado, e os escopos somam ao Total. Espelha a convenção sintética do
        # portfolio.test (patrimônio fictício).
        "dossie": {
            "mes": mes,
            "janela": {"base_data": "2026-04-30", "fim_data": gerado_para, "mes_em_curso": False},
            "patrimonio": {
                "Total": {"base_brl": 160000.0, "fim_brl": 164200.0, "delta_brl": 4200.0},
                "Brasil": {"base_brl": 95000.0, "fim_brl": 96200.0, "delta_brl": 1200.0},
                "EUA": {"base_brl": 65000.0, "fim_brl": 68000.0, "delta_brl": 3000.0},
            },
            "decomposicao": {
                "Total": {"aportes_liq_brl": 2000.0, "proventos_brl": 380.0, "mercado_brl": 1820.0},
                "Brasil": {"aportes_liq_brl": 0.0, "proventos_brl": 380.0, "mercado_brl": 820.0},
                "EUA": {"aportes_liq_brl": 2000.0, "proventos_brl": 0.0, "mercado_brl": 1000.0},
            },
            "movers": [
                {"ticker": "VOO", "moeda": "USD", "bandeira": "🇺🇸", "impacto_brl": 1500.0, "retorno_pct": 0.0231},
                {"ticker": "HASH11", "moeda": "BRL", "bandeira": "🇧🇷", "impacto_brl": -300.0, "retorno_pct": -0.017},
            ],
            "performance": {
                "Total": {"retorno_mes_pct": 0.0114, "benchmarks": {"CDI": 0.0089, "IBOV": 0.006, "SP500": 0.014}},
                "Brasil": {"retorno_mes_pct": 0.0086, "benchmarks": {"CDI": 0.0089, "IBOV": 0.006}},
                "EUA": {"retorno_mes_pct": 0.0154, "benchmarks": {"SP500": 0.014}},
            },
            "renda": {
                "proventos_mes_brl": 380.0,
                "por_ativo": [{"ticker": "ITSA4", "moeda": "BRL", "bandeira": "🇧🇷", "tipo": "Dividendo", "valor_brl": 380.0}],
                "dy_trailing": {
                    "total": {"dy": 0.049, "proventos_12m": 13500.0, "valor": 275000.0, "moeda": "BRL"},
                    "acao_br": {"dy": 0.058, "proventos_12m": 5800.0, "valor": 100000.0, "moeda": "BRL"},
                    "fii": {"dy": 0.091, "proventos_12m": 4500.0, "valor": 49000.0, "moeda": "BRL"},
                    "eua": {"dy": 0.014, "proventos_12m": 560.0, "valor": 40000.0, "moeda": "USD"},
                },
                "proventos_12m_brl": 13500.0,
                "run_rate_mes_anualizado_brl": 4560.0,
            },
            "alinhamento": {
                "referencia": "atual",
                "categorias": [],
                "concentracao_top": [
                    {"ticker": "VOO", "peso": 0.18, "valor_brl": 29000.0, "bandeira": "🇺🇸"},
                    {"ticker": "ITSA4", "peso": 0.09, "valor_brl": 14500.0, "bandeira": "🇧🇷"},
                ],
            },
            "sinais": [],
        },
    }


# ── Fase 7a.AT.1: fixture com MARCAÇÃO (lista, negrito, [n] em item) ─────────
# CONTEÚDO 100% SINTÉTICO — repo público, PIN de teste público.
# O `url` em `javascript:` e o payload em `<img onerror>` são DELIBERADOS: são o
# controle da allowlist de esquema e do escape-antes-da-marcação. Nenhum dos
# dois é conteúdo que o agente produziria; existem para que o teste falhe se a
# proteção sumir.
#
# É o mês MAIS ANTIGO de propósito: o índice é DESC e `abrirRelatorio()` abre o
# ÚLTIMO mês — um mês novo no topo mudaria o alvo de todos os testes existentes.
def _relatorio_marcado() -> dict:
    base = _relatorio("2026-03", "Março 2026", "2026-03-31", mes1=False)
    base["secoes"] = [
        {"id": "prestacao_contas", "titulo": "Prestação de contas",
         "corpo": "Dois nomes sinalizados em fevereiro."},
        {"id": "leitura_mes", "titulo": "Leitura do mês",
         "corpo": "**Março** fechou de lado. O detalhe vive nas seções abaixo."},
        {"id": "como_voce_foi", "titulo": "Como você foi",
         "corpo": "Por escopo:\n- **Brasil:** de lado, puxado por FIIs [1].\n"
                  "- **EUA:** avanço em dólar."},
        {"id": "funcionando", "titulo": "O que está funcionando",
         "corpo": "VOO seguiu firme."},
        {"id": "nao_funcionando", "titulo": "O que NÃO está funcionando",
         "corpo": "HASH11 recuou.\n\nUm bloco depois da lista fecha a lista."},
        {"id": "renda", "titulo": "Renda",
         "corpo": "Proventos em linha com o run-rate [3]."},
        {"id": "alinhamento", "titulo": "Alinhamento",
         "corpo": "Drift dentro do esperado."},
        {"id": "radar", "titulo": "Radar", "corpo": "Três nomes adiante."},
        {"id": "evidencias", "titulo": "Evidências & fontes",
         "corpo": "Fontes citadas ao longo do relatório."},
    ]
    base["radar"] = [
        {"ticker": "HASH11",
         "observar": "- prêmio/desconto\n- fluxo de cripto",
         "gatilho": "Fechamento de fevereiro (~março/2026).\n"
                    "- **Segue intacta se:** o desconto voltar a menos de 3%.\n"
                    "- **Vira sob pressão se:** o desconto passar de 5% por dois meses.",
         "veredito": "intacta"},
        {"ticker": "SMAL11",
         "observar": "- juros longos",
         "gatilho": "Ata do Copom.\n- **Volta a intacta se:** a curva ceder [2].\n"
                    "- **Vira deteriorando se:** a curva abrir de novo.",
         "veredito": "sob_pressao"},
        {"ticker": "KISU11", "observar": "- vacância", "gatilho": "Relatório gerencial.",
         "veredito": "deteriorando"},
    ]
    base["prestacao_contas"] = [
        # Item COM selo conhecido + marcação nos dois campos.
        {"ticker": "HASH11", "veredito": "intacta",
         "sinalizado": "Fechamento de fevereiro.\n- **Segue intacta se:** desconto < 3%.\n"
                       "- **Vira sob pressão se:** desconto > 5%.",
         "resultado": "O desconto fechou em 2%.\n- **Prêmio:** voltou ao normal [1].\n"
                      "- **Fluxo:** estável."},
        # Item SEM veredito → nenhum selo (relatório antigo é assim).
        {"ticker": "SMAL11", "sinalizado": "Ata do Copom.",
         "resultado": "A curva cedeu de leve."},
        # Veredito DESCONHECIDO → nenhum selo, e em nenhuma hipótese o otimista.
        {"ticker": "KISU11", "veredito": "Intacta",
         "sinalizado": "Relatório gerencial.", "resultado": "Vacância estável."},
        # Escape hostil dentro de negrito e dentro de item de lista.
        {"ticker": "VOO", "veredito": "intacta",
         "sinalizado": "- **<img src=x onerror=alert(1)>** rótulo hostil",
         "resultado": "<script>alert(2)</script> fora de lista"},
    ]
    base["citacoes"] = [
        {"id": 1, "afirmacao": "FIIs puxaram o Brasil", "fonte": "Dossiê",
         "url": "https://example.com/fii", "confianca": "alta"},
        # Esquema hostil: tem de cair em #rel-evidencias, nunca virar link vivo.
        {"id": 2, "afirmacao": "Curva de juros", "fonte": "Fonte suspeita",
         "url": "javascript:alert(3)", "confianca": "baixa"},
        # ASPA dentro de uma URL que PASSA na allowlist de esquema. Exercita o
        # unico ponto do renderizador que monta um atributo HTML a mao
        # (`href="${href}"` em `_inlineParaHtml`): sem o `_escHtml` da URL, a
        # aspa fecharia o atributo e o resto viraria markup. O teste do
        # `javascript:` NAO cobre este caminho — ele so prova o esquema.
        {"id": 3, "afirmacao": "Aspa na URL", "fonte": "Fonte com aspa",
         "url": 'https://example.com/a"onmouseover=alert(1)//', "confianca": "media"},
    ]
    return base


def gerar_relatorios() -> None:
    maio = _relatorio("2026-05", "Maio 2026", "2026-05-31", mes1=False)
    abril = _relatorio("2026-04", "Abril 2026", "2026-04-30", mes1=True)
    marco = _relatorio_marcado()
    indice = {
        "schema": "relatorios_index_v1",
        "atualizado_em": "2026-06-01",
        "meses": [
            {"mes": "2026-05", "titulo": maio["titulo"], "gerado_para": "2026-05-31",
             "arquivo": "relatorio_2026-05.json.enc"},
            {"mes": "2026-04", "titulo": abril["titulo"], "gerado_para": "2026-04-30",
             "arquivo": "relatorio_2026-04.json.enc"},
            {"mes": "2026-03", "titulo": marco["titulo"], "gerado_para": "2026-03-31",
             "arquivo": "relatorio_2026-03.json.enc"},
        ],
    }
    # Payload decifrável (PIN de teste) mas com schema ERRADO — exercita o branch
    # `art.schema !== "relatorio_mensal_v1"` → estado de erro no frontend (Q.3.c).
    schema_ruim = {"schema": "nao_e_relatorio_v1", "mes": "2026-05"}
    base = OUT.parent  # tests/fixtures/
    for nome, obj in (
        ("relatorios_index.test.json.enc", indice),
        ("relatorio_2026-05.test.json.enc", maio),
        ("relatorio_2026-04.test.json.enc", abril),
        ("relatorio_2026-03.test.json.enc", marco),
        ("relatorio_badschema.test.json.enc", schema_ruim),
    ):
        enc = encriptar_json(json.dumps(obj, ensure_ascii=False), PIN_TESTE)
        (base / nome).write_text(enc, encoding="ascii")
        print(f"Fixture gerada: {base / nome}")


# ── Fase 7a.R.3.b: fixtures do dossiê de empresa (índice + 4 dossiês) ───────
# CONTEÚDO 100% SINTÉTICO. O sibling é repo PÚBLICO e o `.enc` decifra com o
# PIN de teste público 123456 — qualquer tese, número, nome de empresa ou URL
# real aqui é efetivamente plaintext. Os TICKERS são reaproveitados do universo
# já presente no fixture (posicoes/politica/relatorio) por coerência narrativa;
# tudo o mais é inventado. URLs sem dígitos: uma URL terminando em 7 dígitos +
# `.pdf` é lida como número de conta pelo detector de PII (gotcha 7a.R.2).
def _fonte(slug: str, titulo: str, data_leitura: str) -> dict:
    return {
        "tipo": "primaria",
        "categoria_fonte": "release_resultados",
        "titulo": titulo,
        "url": f"https://example.com/{slug}",
        "data_leitura": data_leitura,
        "confianca": "alta",
    }


def _entrada(data: str, veredito: str, gatilho: str, leitura: str,
             numeros: dict, fontes: list[dict],
             confronto: dict | None = None) -> dict:
    e = {
        "data": data,
        "gatilho": gatilho,
        "veredito": veredito,
        "numeros_reportados": numeros,
        "leitura": leitura,
        "observar": "Sinal de exemplo a observar na próxima leitura.",
        "gatilho_reavaliacao": "Gatilho de exemplo para reavaliar a tese.",
        "fontes": fontes,
    }
    # 7a.AD.2: `confronto_tese` é OPCIONAL. A AUSÊNCIA da chave é o que faz o
    # dossiê do AMZN representar o mundo PRÉ-AD.1 (payload antigo, selo ausente)
    # — por isso ela não entra com valor default.
    if confronto is not None:
        e["confronto_tese"] = confronto
    return e


def _dossie(ticker: str, nome: str, escopo: str, categoria: str,
            tese: dict, timeline: list[dict], verificacao_leve) -> dict:
    return {
        "schema": "dossie_empresa_v1",
        "ticker": ticker,
        "nome": nome,
        "escopo": escopo,
        "categoria": categoria,
        "ri_portal_url": f"https://example.com/ri/{ticker.lower()}",
        "aberto_em": "2026-06-26",
        "tese": tese,
        "ultima_verificacao_leve": verificacao_leve,
        "timeline": timeline,
    }


def _dossies_sinteticos() -> list[dict]:
    # `nome` == ticker é o caso MAJORITÁRIO em produção (29 dos 39 dossiês
    # reais), então é o que a fixture principal exercita: a sub-linha do
    # cabeçalho não pode repetir o ticker que está logo acima em corpo grande.
    hglg = _dossie(
        "HGLG11", "HGLG11", "Brasil", "FII",
        tese={
            "resumo": "Veículo de exemplo usado só para exercitar a tela do dossiê. "
                      "A tese sintética é que o ativo de exemplo compõe renda estável "
                      "com contratos longos e inquilinos diversificados.",
            "quebra_se": "A tese de exemplo quebra se a vacância de exemplo subir de "
                         "forma estrutural ou se a distribuição de exemplo cair abaixo "
                         "do piso combinado por dois trimestres seguidos.",
            "revisada_em": "2026-06-27",
        },
        timeline=[
            _entrada(
                "2024-12-31", "intacta", "backfill histórico — leitura retrospectiva de FY2024",
                "Leitura sintética de FY2024: os números de exemplo vieram em linha com a "
                "tese e não houve deterioração observável no período.",
                {"receita_exemplo": "R$ 00,0 mi (exemplo)",
                 "vacancia_exemplo": "física de exemplo e financeira de exemplo, ambas estáveis no período",
                 "distribuicao_exemplo": "R$ 0,00 por cota (exemplo)"},
                [_fonte("relatorio-exemplo-um", "Relatório de exemplo do emissor (FY2024)", "2026-07-11")],
            ),
            _entrada(
                "2025-12-31", "intacta", "backfill histórico — leitura retrospectiva de FY2025",
                "Leitura sintética de FY2025: o ativo de exemplo manteve o padrão do ano "
                "anterior, sem sinal novo que mude a tese.",
                {"receita_exemplo": "R$ 00,0 mi (exemplo)",
                 "distribuicao_exemplo": "R$ 0,00 por cota (exemplo)"},
                [_fonte("relatorio-exemplo-dois", "Relatório de exemplo do emissor (FY2025)", "2026-07-11")],
            ),
            _entrada(
                "2026-06-27", "sob_pressao", "leitura contemporânea de exemplo",
                "Leitura sintética contemporânea: apareceu um sinal de exemplo que ainda não "
                "quebra a tese, mas justifica acompanhamento mais próximo.",
                # O token longo INDIVISÍVEL é deliberado: prova que o guard de
                # overflow a 320px (`overflow-wrap: anywhere`) é real, e não um
                # teste que passa só porque a fixture é curta. Sem hífens de
                # propósito — o navegador quebra linha DEPOIS de um hífen, então
                # um token hifenizado não estressaria nada. Valores de
                # numeros_reportados são texto livre da fonte.
                {"vacancia_exemplo": "acima do patamar de exemplo do ano anterior",
                 "referencia_exemplo": "IDENTIFICADORSINTETICOMUITOLONGOSEMESPACONEMHIFENPARATESTARQUEBRA"},
                [_fonte("comunicado-exemplo",
                        "Comunicado de exemplo ao mercado com titulo sinteticamente longo "
                        "para exercitar a quebra do rodape da entrada", "2026-06-27"),
                 # Título de fonte também é texto livre vindo de fora e pode
                 # trazer um identificador de documento sem espaço — o token
                 # indivisível aqui prova o guard do rodapé da entrada.
                 _fonte("apresentacao-exemplo",
                        "Apresentação IDENTIFICADORDEDOCUMENTOSINTETICOLONGOSEMESPACONEMHIFEN",
                        "2026-06-27")],
            ),
            # Segunda entrada NO MESMO ANO: 12 dos 39 dossiês reais têm mais de
            # uma entrada por ano (KNRI11 tem três em 2026), e o mini-mapa não
            # pode repetir o rótulo do ano em cada glifo.
            # 7a.AD.2: confronto DISPARADO e datado DEPOIS de tese.revisada_em
            # (2026-06-27) ⇒ este dossiê exercita o selo PRESENTE.
            _entrada(
                "2026-07-15", "deteriorando", "leitura contemporânea de exemplo",
                "Segunda leitura sintética do mesmo ano: o sinal de exemplo piorou.",
                {"vacancia_exemplo": "acima do trimestre de exemplo anterior"},
                [_fonte("fato-relevante-exemplo", "Fato relevante de exemplo", "2026-07-15")],
                confronto={
                    "estado": "disparado",
                    "justificativa": "O indício de exemplo tensiona o critério de "
                                     "falsificação de exemplo declarado na tese.",
                },
            ),
        ],
        verificacao_leve=None,
    )
    smal = _dossie(
        "SMAL11", "Empresa de Exemplo Dois", "Brasil", "Ação BR",
        tese={
            "resumo": "Tese sintética de crescimento composto usada só para exercitar a tela.",
            "quebra_se": "A tese de exemplo quebra se a margem de exemplo comprimir de forma sustentada.",
            "revisada_em": "2026-06-20",
        },
        timeline=[
            _entrada(
                "2024-12-31", "intacta", "backfill histórico — leitura retrospectiva de FY2024",
                "Leitura sintética de FY2024 sem sinal de deterioração.",
                {"margem_exemplo": "0,0% (exemplo)"},
                [_fonte("release-exemplo-um", "Release de exemplo (FY2024)", "2026-07-12")],
            ),
            # 7a.AD.2: confronto DISPARADO, mas datado ANTES de tese.revisada_em
            # (2026-06-20) ⇒ o Dr. Arthur já revisou a tese depois do disparo,
            # e o selo NÃO deve aparecer. É o par negativo do HGLG11.
            _entrada(
                "2025-12-31", "deteriorando", "backfill histórico — leitura retrospectiva de FY2025",
                "Leitura sintética de FY2025: o sinal de exemplo piorou o suficiente para "
                "mudar o veredito nesta fixture.",
                {"margem_exemplo": "0,0% (exemplo, abaixo do ano anterior)"},
                [_fonte("release-exemplo-dois", "Release de exemplo (FY2025)", "2026-07-12")],
                confronto={
                    "estado": "disparado",
                    "justificativa": "Disparo de exemplo ANTERIOR à revisão da tese — "
                                     "o selo não deve aparecer.",
                },
            ),
        ],
        verificacao_leve="2026-06-15",
    )
    amzn = _dossie(
        "AMZN", "Empresa de Exemplo Três", "EUA", "Exterior",
        tese={
            "resumo": "Tese sintética de plataforma usada só para exercitar o escopo EUA.",
            "quebra_se": "A tese de exemplo quebra se a vantagem de exemplo deixar de existir.",
            "revisada_em": "2026-06-18",
        },
        timeline=[
            _entrada(
                "2025-12-31", "intacta", "backfill histórico — leitura retrospectiva de FY2025",
                # 7a.AT.1: a `leitura` exercita a marcação (lista + negrito) e o
                # `[1]`, que nesta tela tem de ficar TEXTO — a tela do dossiê não
                # tem lista de evidências, e `#rel-evidencias` é ROTA neste SPA.
                # Medido em produção: 7 das 188 entradas reais já têm `[n]` aqui.
                "Leitura sintética de FY2025 em dólar de exemplo [1].\n"
                "- **Receita:** de exemplo, estável.\n"
                "- **Margem:** de exemplo, sem mudança.",
                {"receita_exemplo": "US$ 0,0 bi (exemplo)"},
                [_fonte("annual-report-exemplo", "Annual report de exemplo (FY2025)", "2026-07-13")],
            ),
        ],
        verificacao_leve=None,
    )
    itsa = _dossie(
        "ITSA4", "Empresa de Exemplo Quatro", "Brasil", "Ação BR",
        tese={
            "resumo": "Tese sintética ainda não redigida — dossiê esqueleto de exemplo.",
            "quebra_se": "",
            "revisada_em": None,
        },
        timeline=[],
        verificacao_leve=None,
    )
    return [amzn, hglg, itsa, smal]  # ordem por ticker


def gerar_dossies() -> None:
    from src.output.sync_dossies import hash_conteudo, nome_arquivo_cifrado

    base = OUT.parent  # tests/fixtures/
    dossies = _dossies_sinteticos()
    # 7a.W.2: o nome publicado virou HMAC-SHA256(segredo, ticker) — o frontend
    # nunca o calcula, só lê `arquivo` do índice. O mapa abaixo existe para o
    # page.route do Playwright saber qual fixture servir para cada URL, já que
    # a URL não carrega mais o ticker (que é o ponto da mudança).
    indice = {
        "schema": "dossies_index_v1",
        "atualizado_em": "2026-07-26",
        "dossies": [
            {
                "ticker": d["ticker"],
                "nome": d["nome"],
                "categoria": d["categoria"],
                "escopo": d["escopo"],
                # O NOME PUBLICADO (sem `.test`) é o que o frontend pede; só o
                # arquivo em disco leva o sufixo de fixture — o page.route do
                # Playwright faz a ponte entre os dois.
                "arquivo": nome_arquivo_cifrado(d["ticker"], PIN_TESTE),
                "sha256": hash_conteudo(d),
            }
            for d in dossies
        ],
    }
    mapa = {nome_arquivo_cifrado(d["ticker"], PIN_TESTE): d["ticker"] for d in dossies}
    (base / "dossies_map.test.json").write_text(
        json.dumps(mapa, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8")
    print(f"Fixture gerada: {base / 'dossies_map.test.json'} ({len(mapa)} nomes)")

    alvos = [("dossies_index.test.json.enc", indice)]
    alvos += [(f"dossie_{d['ticker']}.test.json.enc", d) for d in dossies]

    # 7a.AD.2 — variante do edge `revisada_em: null` + confronto disparado: o
    # caso que falha sem o `|| ""` do predicado, porque em JS `"data" > null`
    # avalia FALSO e o dossiê NUNCA revisado (o mais urgente) ficaria sem selo.
    # Vive FORA do índice de propósito: `dossie.spec.ts` afirma `indice: 4` na
    # contagem exata do teste de lock, e um 5º dossiê no índice a quebraria. O
    # teste do edge serve este corpo por override de rota no nome de arquivo do
    # AMZN — mecânica que aquele arquivo já usa (`page.route("**/" + arqDe(...))`).
    variante = json.loads(json.dumps(
        next(d for d in dossies if d["ticker"] == "AMZN"), ensure_ascii=False))
    variante["tese"]["revisada_em"] = None
    variante["timeline"][-1]["confronto_tese"] = {
        "estado": "disparado",
        "justificativa": "Disparo de exemplo num dossiê cuja tese nunca foi revisada.",
    }
    alvos.append(("dossie_AMZN_tese_nula.test.json.enc", variante))

    for nome, obj in alvos:
        enc = encriptar_json(json.dumps(obj, ensure_ascii=False), PIN_TESTE)
        (base / nome).write_text(enc, encoding="ascii")
        print(f"Fixture gerada: {base / nome}")


# 7a.W.3.b: a tela de enrollment exige SEIS palavras, então uma fixture cifrada
# com `PIN_TESTE` (1 token) não consegue exercitar o fluxo — o submit nunca
# habilita. Esta segunda fixture representa o mundo PÓS-VIRADA, que é o único em
# que a tela de cadastro tem sentido. Frase 100% genérica, sem qualquer relação
# com a frase de acesso real (que nunca aparece em teste, log ou commit).
FRASE_TESTE = "alfa beta gama delta epsilon zeta"


def gerar_portfolio_frase() -> None:
    base = OUT.parent
    enc = encriptar_json(json.dumps(PAYLOAD, ensure_ascii=False), FRASE_TESTE)
    alvo = base / "portfolio_frase.test.json.enc"
    alvo.write_text(enc, encoding="ascii")
    print(f"Fixture gerada: {alvo} (cifrada com a FRASE de teste, não com o PIN)")


# 7a.AV.2 (Task 10): as duas variantes que a tela nova `#/raiox/projecao` (Tasks
# 11-12) precisa distinguir de um payload com `projecao` populado — o estado
# "sem projeção calculável" (chave presente, `null`) e o estado "payload antigo,
# a chave nem existe" (publicado antes desta fase). Cifradas com o mesmo
# PIN_TESTE do fixture principal — só o conteúdo difere.
def gerar_portfolio_projecao_variantes() -> None:
    base = OUT.parent
    # 7a.BD.2: variantes de versão anterior à 2.30 não carregam ``ponte``.
    sem_ponte = {k: v for k, v in _PRE_RENDA.items() if k != "ponte"}

    # 7a.BJ: sem projeção o backend também não publica a renda.
    payload_null = {**PAYLOAD, "projecao": None, "renda": None}
    enc_null = encriptar_json(json.dumps(payload_null, ensure_ascii=False), PIN_TESTE)
    alvo_null = base / "portfolio_projecao_null.test.json.enc"
    alvo_null.write_text(enc_null, encoding="ascii")
    print(f"Fixture gerada: {alvo_null}")

    payload_pre = {k: v for k, v in sem_ponte.items() if k != "projecao"} | {"versao": "2.26"}
    enc_pre = encriptar_json(json.dumps(payload_pre, ensure_ascii=False), PIN_TESTE)
    alvo_pre = base / "portfolio_pre_v227.test.json.enc"
    alvo_pre.write_text(enc_pre, encoding="ascii")
    print(f"Fixture gerada: {alvo_pre}")

    payload_v227 = {**sem_ponte, "versao": "2.27", "projecao": _projecao_sintetica_v227()}
    alvo = base / "portfolio_pre_v228.test.json.enc"
    alvo.write_text(encriptar_json(json.dumps(payload_v227, ensure_ascii=False), PIN_TESTE), encoding="ascii")
    print(f"Fixture gerada: {alvo}")

    payload_v228 = {**sem_ponte, "versao": "2.28", "projecao": _projecao_sintetica_v228()}
    alvo = base / "portfolio_pre_v229.test.json.enc"
    alvo.write_text(encriptar_json(json.dumps(payload_v228, ensure_ascii=False), PIN_TESTE), encoding="ascii")
    print(f"Fixture gerada: {alvo}")

    for nome, proj in (("portfolio_projecao_vencida", _projecao_sintetica(vencida=True)),
                       ("portfolio_projecao_idade50", _projecao_sintetica(50))):
        alvo = base / f"{nome}.test.json.enc"
        alvo.write_text(encriptar_json(json.dumps({**PAYLOAD, "projecao": proj}, ensure_ascii=False), PIN_TESTE), encoding="ascii")
        print(f"Fixture gerada: {alvo}")


# 7a.BG.1: payload 2.30 (antes da cripto sair da carteira): sem ``carteira_brl``
# e ``carteira_br_brl``, ponte COM a linha ``cripto`` (HASH11) e o índice BTC.
# O PWA novo deve tratá-lo como desatualizado; não tem valores esperados.
def gerar_portfolio_pre_v231() -> None:
    pat = {k: v for k, v in PAYLOAD["patrimonio"].items()
           if k not in ("carteira_brl", "carteira_br_brl")}
    pat["br_brl"] = 170280.0   # forma 2.30 real: ``br_brl`` COM a cripto (149640 + 20640)
    bloco = _ponte_sintetica(legado_cripto=True)
    _confere_ponte(bloco)
    payload = _PRE_RENDA | {"versao": "2.30", "patrimonio": pat, "ponte": bloco}
    alvo = OUT.parent / "portfolio_pre_v231.test.json.enc"
    alvo.write_text(encriptar_json(json.dumps(payload, ensure_ascii=False), PIN_TESTE), encoding="ascii")
    print(f"Fixture gerada: {alvo}")


# 7a.BG.1: carteira sem nenhuma cripto (``cripto_brl`` = 0, ``carteira_brl`` =
# ``total_brl``) — o e2e do rodapé ausente. Mínimo, derivado de PAYLOAD.
def gerar_portfolio_cripto_zero() -> None:
    pat = dict(PAYLOAD["patrimonio"])
    carteira = pat["carteira_brl"]
    pat.update(cripto_brl=0.0, br_brl=pat["carteira_br_brl"], total_brl=carteira,
               carteira_brl=carteira)
    pat["evolucao"] = [*pat["evolucao"][:-1], {**pat["evolucao"][-1], "total_brl": carteira}]
    payload = PAYLOAD | {"patrimonio": pat}
    alvo = OUT.parent / "portfolio_cripto_zero.test.json.enc"
    alvo.write_text(encriptar_json(json.dumps(payload, ensure_ascii=False), PIN_TESTE), encoding="ascii")
    print(f"Fixture gerada: {alvo}")


# 7a.BD.2 (Task 6): payload antigo (sem ``ponte``, v2.29) — o estado que a tela
# nova precisa distinguir ("Rentabilidade indisponível nesta versão dos dados").
def gerar_portfolio_pre_v230() -> None:
    payload = {k: v for k, v in _PRE_RENDA.items() if k != "ponte"} | {"versao": "2.29"}
    alvo = OUT.parent / "portfolio_pre_v230.test.json.enc"
    alvo.write_text(encriptar_json(json.dumps(payload, ensure_ascii=False), PIN_TESTE), encoding="ascii")
    print(f"Fixture gerada: {alvo}")


# 7a.BJ.2 (Task 5): os estados da tela ``#/raiox/renda`` — ``renda: null``
# (builder falhou ou sem projeção), as três variantes do bloco e o payload
# 2.31, de antes da chave existir.
def gerar_portfolio_renda_variantes() -> None:
    alvos = [("portfolio_renda_null", PAYLOAD | {"renda": None}),
             ("portfolio_pre_v232", _PRE_RENDA | {"versao": "2.31"})]
    alvos += [(f"portfolio_renda_{v}", PAYLOAD | {"renda": _renda_sintetica(v)})
              for v in ("cobrem", "zero", "curta")]
    for nome, payload in alvos:
        alvo = OUT.parent / f"{nome}.test.json.enc"
        alvo.write_text(encriptar_json(json.dumps(payload, ensure_ascii=False), PIN_TESTE), encoding="ascii")
        print(f"Fixture gerada: {alvo}")


# 7a.BK.1 (Task 2): a #alocacao por faixa de tolerância. Duas variantes do
# PAYLOAD com a ``politica`` trocada por pesos SINTÉTICOS redondos (repo
# público). Regra da faixa: tol = max(0,02; 0,10 × alvo), bordas inclusivas.
def _ativo_aloca(ticker: str, cat_alvo: float, bucket_alvo: float, peso_intra: float,
                 peso_intra_atual: float, valor: float, base: float = 100000.0,
                 **extra) -> dict:
    """Ativo na forma do PAYLOAD: ``peso_alvo``/``peso_atual`` sobre a carteira."""
    peso_alvo = round(cat_alvo * bucket_alvo * peso_intra, 6)
    peso_atual = round(valor / base, 6)
    return {
        "ticker": ticker, "tipo": extra.pop("tipo", "pick"), "quarentena": False,
        "peso_intra": peso_intra, "peso_intra_atual": peso_intra_atual,
        "drift_intra": round(peso_intra_atual - peso_intra, 6),
        "peso_alvo": peso_alvo, "peso_atual": peso_atual,
        "drift": round(peso_atual - peso_alvo, 6),
        "valor_brl": valor, "bandeira": extra.pop("bandeira", "🇧🇷"), **extra,
    }


def _cat_simples(nome: str, alvo: float, atual: float, ticker: str,
                 bandeira: str = "🇧🇷") -> dict:
    """Categoria de cesta única e ativo único (o ativo herda o peso da categoria)."""
    valor = round(atual * 100000.0, 2)
    ativo = _ativo_aloca(ticker, alvo, 1.0, 1.0, 1.0, valor, tipo="passive",
                         bandeira=bandeira)
    return {
        "nome": nome, "peso_alvo": alvo, "peso_atual": atual,
        "drift": round(atual - alvo, 6), "valor_brl": valor,
        "buckets": [{"tipo": "passive", "peso_bucket": 1.0, "peso_atual_bucket": 1.0,
                     "drift_bucket": 0.0, "ativos": [ativo]}],
    }


def _politica_alocacao_faixa() -> dict:
    """As quatro situações da faixa (abaixo, na faixa, acima, sem alvo).

    Base de peso: carteira de 100 000. ATENÇÃO: a soma dos ``valor_brl`` das
    categorias dá 102 000 (o off-policy LREN3 entra no valor da Ações BR, como
    no backend), e não fecha com os ``peso_atual`` (base 100 000). Nenhum assert
    cruza os dois.

    Ações BR (a categoria asserida por ativo): passiva 0,45 / picks 0,55 —
    splits deliberadamente diferentes dos da política real. Os
    ``peso_intra_atual`` dos picks são valor ÷ 11 000 (o universo
    equal-weight, que exclui KNIP11 em quarentena e LREN3 fora do alvo).
    """
    ca = 0.25  # alvo da categoria Ações BR
    passiva = [_ativo_aloca("BOVA11", ca, 0.45, 1.0, 1.0, 6000.0, tipo="passive")]
    picks = [
        _ativo_aloca("ITSA4", ca, 0.55, 0.333333, 0.545455, 6000.0),
        _ativo_aloca("BBAS3", ca, 0.55, 0.333333, 0.090909, 1000.0),
        _ativo_aloca("WEGE3", ca, 0.55, 0.333333, 0.363636, 4000.0),
        # Quarentena: fora do equal-weight (peso_intra 0), numerador próprio
        # sobre o universo EW (3000 / 11000), como o backend computa.
        _ativo_aloca("KNIP11", ca, 0.55, 0.0, 0.272727, 3000.0) | {"quarentena": True},
        # Off-policy (fora do YAML): ``peso_atual`` não zero; zera só
        # ``peso_intra*``, ``peso_alvo`` e ``drift`` (forma de construir_bloco_politica).
        {"ticker": "LREN3", "tipo": "pick", "fora_do_alvo": True, "quarentena": False,
         "peso_intra": 0, "peso_intra_atual": 0, "drift_intra": 0, "peso_alvo": 0,
         "peso_atual": 0.02, "drift": 0, "valor_brl": 2000.0, "bandeira": "🇧🇷"},
    ]
    acoes = {
        "nome": "Ações BR", "peso_alvo": ca, "peso_atual": 0.20, "drift": -0.05,
        "valor_brl": 22000.0,
        "buckets": [
            {"tipo": "passive", "peso_bucket": 0.45, "peso_atual_bucket": 0.30,
             "drift_bucket": -0.15, "ativos": passiva},
            {"tipo": "picks", "equal_weight": True, "peso_bucket": 0.55,
             "peso_atual_bucket": 0.70, "drift_bucket": 0.15, "ativos": picks},
        ],
    }
    classe_x = _cat_simples("Classe X", 0.0, 0.03, "XPTO3")
    return {"categorias": [
        _cat_simples("EUA", 0.50, 0.58, "VOO", "🇺🇸"),
        acoes,
        _cat_simples("FIIs", 0.15, 0.14, "HGLG11"),
        _cat_simples("Renda Fixa BR", 0.10, 0.05, "IMAB11"),
        classe_x,
    ]}


def _politica_alocacao_na_faixa() -> dict:
    """Tudo na faixa. Ações BR com drift de −1,5 pp: o grifo antigo (qualquer
    drift ≤ −0,5 pp) apareceria, o novo (só abaixo da faixa) não."""
    return {"categorias": [
        _cat_simples("EUA", 0.50, 0.51, "VOO", "🇺🇸"),
        _cat_simples("Ações BR", 0.30, 0.285, "BOVA11"),
        _cat_simples("FIIs", 0.20, 0.205, "HGLG11"),
    ]}


def gerar_portfolio_alocacao_variantes() -> None:
    alvos = [("portfolio_alocacao_faixa", _politica_alocacao_faixa()),
             ("portfolio_alocacao_na_faixa", _politica_alocacao_na_faixa())]
    for nome, politica in alvos:
        payload = copy.deepcopy(PAYLOAD)
        payload["politica"] = politica
        alvo = OUT.parent / f"{nome}.test.json.enc"
        alvo.write_text(encriptar_json(json.dumps(payload, ensure_ascii=False), PIN_TESTE), encoding="ascii")
        print(f"Fixture gerada: {alvo}")


def gerar_portfolio_ponte_muitos() -> None:
    """7a.BH.1: PAYLOAD com a linha ``acoes_br`` de 11 ativos (e2e de "quem pesou")."""
    payload = PAYLOAD | {"ponte": _ponte_muitos()}
    alvo = OUT.parent / "portfolio_ponte_muitos.test.json.enc"
    alvo.write_text(encriptar_json(json.dumps(payload, ensure_ascii=False), PIN_TESTE), encoding="ascii")
    print(f"Fixture gerada: {alvo}")


def gerar_portfolio_ponte_longa() -> None:
    """7a.BE.2: PAYLOAD com o bloco longo (72 meses) para o e2e de 3a e 5a."""
    payload = PAYLOAD | {"ponte": _ponte_longa()}
    alvo = OUT.parent / "portfolio_ponte_longa.test.json.enc"
    alvo.write_text(encriptar_json(json.dumps(payload, ensure_ascii=False), PIN_TESTE), encoding="ascii")
    print(f"Fixture gerada: {alvo}")


# 7a.BD.2 (Task 6): valores esperados para o teste cruzado da gêmea JS
# (``ponteJanela``), saídos da referência Python ``src.calculadora.ponte`` sobre
# o MESMO bloco sintético. JSON em claro: tudo aqui é fórmula, sem PIN nem
# frase. Forma: {"bloco": ..., "casos": [{"funcao", "chamada", "esperado"}]}.
_PONTE_ESCOPOS = (("Total", "BRL"), ("Brasil", "BRL"), ("EUA", "BRL"), ("EUA", "USD"))
# Primeiro mes do escopo EUA, derivado de _PONTE_ATIVOS (tupla na forma dela).
_PONTE_MES_EUA_INICIO = min(
    ini for (_t, c, *_x, ini, _v, _a, _al, _f) in _PONTE_ATIVOS if c == "eua")
_PONTE_JANELAS_EXTRAS = (
    # (escopo, moeda, i_ini, i_fim, confere, por quê) -- indices derivados das
    # constantes do bloco; ``confere`` e so do gerador (_confere_caso), nao vai ao JSON.
    ("Total", "BRL", _PONTE_MES_BURACO - 1, _PONTE_MES_BURACO + 2, "buraco",
     "cruza o buraco do mês 4"),
    ("Brasil", "BRL", _PONTE_MES_IFIX_NULO - 1, _PONTE_MES_IFIX_NULO + 1, "ifix_nulo",
     "cruza o IFIX null do mês 8"),
    ("Total", "BRL", _PONTE_MES_IFIX_NULO + 1, _PONTE_MESES - 1, "longa",
     "longa anualizada depois do buraco e do IFIX null"),
    ("EUA", "USD", _PONTE_MES_EUA_INICIO, _PONTE_MES_EUA_INICIO, "um_mes",
     "um mês só, o primeiro do escopo"),
    ("EUA", "USD", _PONTE_MES_SALTO, _PONTE_MES_SALTO, "salto",
     "um mês com salto de +100 %: XIRR anual > 1000 %"),
    ("EUA", "BRL", _PONTE_MES_SALTO - 1, _PONTE_MES_SALTO + 1, "salto",
     "três meses em torno do salto: XIRR anual > 1000 %"),
)


def _confere_caso(bloco: dict, chamada: dict, esperado: dict, confere: str) -> None:
    """Falha alto se o caso extra deixou de exercitar o que a nota promete."""
    from src.calculadora.ponte import _chave_escopo

    ini, fim = chamada["i_ini"], chamada["i_fim"]
    janela_t = range(ini, fim + 1)
    indisp = esperado["indisponivel"]
    if confere == "buraco":
        chave = _chave_escopo(chamada["escopo"], chamada["moeda"])
        assert any(t in bloco["buracos"][chave] for t in janela_t), (
            f"caso buraco: janela {ini}-{fim} nao cruza bloco['buracos'][{chave!r}]")
        assert indisp and indisp.startswith("cotação ausente em"), (
            f"caso buraco: indisponivel inesperado: {indisp!r}")
    elif confere == "ifix_nulo":
        ifix = bloco["indices"]["BRL"]["IFIX"]
        assert any(ifix[t] is None for t in janela_t), (
            f"caso ifix_nulo: janela {ini}-{fim} nao cruza IFIX nulo")
        assert indisp and indisp.startswith("índice IFIX sem dado em"), (
            f"caso ifix_nulo: indisponivel inesperado: {indisp!r}")
    elif confere == "longa":
        assert indisp is None and esperado["anualizado"] is True, (
            f"caso longa: indisponivel={indisp!r} anualizado={esperado['anualizado']!r}")
    elif confere == "um_mes":
        assert esperado["n_meses"] == 1 and indisp is None, (
            f"caso um_mes: n_meses={esperado['n_meses']!r} indisponivel={indisp!r}")
    elif confere == "salto":
        x = esperado["xirr"]
        assert isinstance(x, (int, float)) and (1 + x) ** (12 / esperado["n_meses"]) - 1 > 10, (
            f"caso salto: xirr={x!r} nao e extremo")
    else:
        raise AssertionError(f"confere desconhecido: {confere!r}")


# Mini-blocos de um ativo sintético ("SINT1", EUA/picks, sem aporte), um por
# sequência de retornos mensais: o XIRR de janela curta com retorno extremo,
# onde o Newton-Raphson de 0.10 da gêmea JS não converge e o pyxirr acha a
# raiz pelo fallback dele (fix round 1 da Task 7). A janela é toda a série
# depois do mês 0 (âncora), em EUA/USD.
_PONTE_MINI_RETORNOS = (
    ((-0.90,), "um mês de -90 %: XIRR anual ≈ -100 %"),
    ((4.00,), "um mês de +400 %: XIRR anual ≈ 1,7e8"),
    ((1.50, 1.50, 1.50), "três meses de +150 %: XIRR anual > 1e4"),
    ((-0.70, -0.70, -0.70), "três meses de -70 %"),
)


def _ponte_mini(retornos: tuple[float, ...]) -> dict:
    n = len(retornos) + 1
    meses = _ponte_meses()[:n]
    v = [1000.0]
    usd: list[list] = [[]]
    for r in retornos:
        d = v[-1]
        g = round(d * r, 2)
        usd.append([[0, d, g]])
        v.append(round(d + g, 2))
    zeros = [0.0] * n
    fl = {"v": v, "entrou": [1000.0] + zeros[1:], "prov": list(zeros)}
    return {
        "ate": meses[-1],
        "meses": meses,
        "indices": {"BRL": {}, "USD": {"SP500TR": [None] + [0.0] * (n - 1)}},
        "ativos": [{"t": "SINT1", "classe": "eua", "passivo": False, "cesta_eua": "picks"}],
        "brl": [[] for _ in range(n)],
        "usd": usd,
        "fluxos": {"EUA_USD": fl},
        "buracos": {},
    }


def gerar_ponte_esperado() -> None:
    from src.calculadora.ponte import arredondar_fechando, janela, janelas_fixas

    bloco = PAYLOAD["ponte"]
    casos: list[dict] = []
    for escopo, moeda in _PONTE_ESCOPOS:
        casos.append({"funcao": "janelas_fixas",
                      "chamada": {"escopo": escopo, "moeda": moeda},
                      "esperado": janelas_fixas(bloco, escopo, moeda)})
        casos.append({"funcao": "janela",
                      "chamada": {"escopo": escopo, "moeda": moeda, "i_ini": 10, "i_fim": 14},
                      "esperado": janela(bloco, escopo, moeda, 10, 14)})
    for escopo, moeda, i_ini, i_fim, confere, motivo in _PONTE_JANELAS_EXTRAS:
        chamada = {"escopo": escopo, "moeda": moeda, "i_ini": i_ini, "i_fim": i_fim}
        esperado = janela(bloco, escopo, moeda, i_ini, i_fim)
        _confere_caso(bloco, chamada, esperado, confere)
        casos.append({"funcao": "janela", "nota": motivo, "chamada": chamada,
                      "esperado": esperado})

    for retornos, motivo in _PONTE_MINI_RETORNOS:
        mini = _ponte_mini(retornos)
        n = len(retornos)
        casos.append({"funcao": "janela", "nota": motivo,
                      "chamada": {"escopo": "EUA", "moeda": "USD", "i_ini": 1, "i_fim": n, "bloco": mini},
                      "esperado": janela(mini, "EUA", "USD", 1, n)})

    # arredondar_fechando: em pontos percentuais (fração × 100), como o front chama
    arred: list[tuple[list[float], float, str]] = []
    for escopo, moeda in _PONTE_ESCOPOS:
        j = janelas_fixas(bloco, escopo, moeda)["12m"]
        pp = [j["ind"] * 100] + [l["contrib"] * 100 for l in j["linhas"]]
        arred.append((pp, j["sua"] * 100, f"12m {escopo}/{moeda}: índice + linhas fecham na sua"))
        for l in j["linhas"]:
            arred.append(([a["contrib"] * 100 for a in j["ativos"][l["id"]]], l["contrib"] * 100,
                          f"12m {escopo}/{moeda}: ativos fecham na linha {l['id']}"))
    arred += [
        ([], 5.0, "entrada vazia devolve lista vazia"),
        ([0.04, -0.04, 1.25], 1.3, "dois neutros (±0,0) e uma linha"),
        ([0.35, 0.35, 0.35], 1.0, "empate de restos: a primeira posição leva"),
        ([0.16, 0.16, 0.16], 0.4, "falta negativa: tira das de menor resto"),
        ([-1.26, 2.47, -0.04], 1.2, "sinais mistos"),
        ([0.00048828125, 0.0004882813], 0.1,
         "empate exato a 9 casas (5/1024): round(x, 9) do Python é meio-para-par"),
        ([0.125, 0.125], 0.25, "total em empate exato (2,5 unidades): round() vai ao par"),
    ]
    for valores, total, nota in arred:
        casos.append({"funcao": "arredondar_fechando", "nota": nota,
                      "chamada": {"valores": valores, "total": total, "casas": 1},
                      "esperado": arredondar_fechando(valores, total, 1)})

    # 7a.BE.2: 3a e 5a com valor, sobre o bloco longo (referenciado, não copiado)
    longo = _ponte_longa()
    for escopo, moeda in _PONTE_ESCOPOS:
        casos.append({"funcao": "janelas_fixas",
                      "chamada": {"escopo": escopo, "moeda": moeda, "bloco_ref": "longo"},
                      "esperado": janelas_fixas(longo, escopo, moeda)})

    alvo = OUT.parent / "ponte_esperado.test.json"
    corpo = {"descricao": "7a.BD.2: saída de src/calculadora/ponte.py sobre o bloco "
                          "ponte sintético da fixture (100% fórmula)",
             "bloco": bloco, "bloco_longo": longo, "casos": casos}
    alvo.write_text(json.dumps(corpo, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"Fixture gerada: {alvo} ({len(casos)} casos)")


def main() -> None:
    _valida_forma_projecao()               # 7a.AY.2 (Task 9): paridade de forma
    _valida_forma_renda()                  # 7a.BJ.2 (Task 5): paridade de forma
    enc = encriptar_json(json.dumps(PAYLOAD, ensure_ascii=False), PIN_TESTE)
    OUT.write_text(enc, encoding="ascii")
    print(f"Fixture gerada: {OUT}")
    print(f"  Tamanho B64: {len(enc)} chars · PIN={PIN_TESTE}")
    gerar_relatorios()                     # 7a.Q.3
    gerar_dossies()                        # 7a.R.3.b
    gerar_portfolio_frase()                # 7a.W.3.b
    gerar_portfolio_projecao_variantes()   # 7a.AV.2 (Task 10)
    gerar_portfolio_pre_v230()             # 7a.BD.2 (Task 6)
    gerar_portfolio_pre_v231()             # 7a.BG.1 (Task 7)
    gerar_portfolio_cripto_zero()          # 7a.BG.1 (Task 7)
    gerar_ponte_esperado()                 # 7a.BD.2 (Task 6)
    gerar_portfolio_ponte_longa()          # 7a.BE.2 (Task 7)
    gerar_portfolio_ponte_muitos()         # 7a.BH.1 (Task 2)
    gerar_portfolio_renda_variantes()      # 7a.BJ.2 (Task 5)
    gerar_portfolio_alocacao_variantes()   # 7a.BK.1 (Task 2)


if __name__ == "__main__":
    main()
