"""Gera portfolio.test.json.enc para testes Playwright E2E.

Uso (rodar do repo Investimentos com PYTHONPATH configurado):
    cd /caminho/Investimentos
    PYTHONPATH=. python ../investimentos-app/tests/fixtures/gerar_fixture.py

Saída: ../investimentos-app/tests/fixtures/portfolio.test.json.enc
PIN de teste: 123456

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

import json
from pathlib import Path

from src.output.crypto import encriptar_json

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


PAYLOAD = {
    "versao": "2.25",
    "atualizado_em": "2026-04-26T15:00:00",
    "patrimonio": {
        "total_brl": 258000.0,
        "br_brl": 149640.0,
        "eua_brl": 87720.0,
        "cripto_brl": 20640.0,
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
        "atual": {"EUA": 0.40, "Ações BR": 0.27, "FIIs": 0.21, "Cripto": 0.07, "Renda Fixa BR": 0.05},
        "alvo":  {"EUA": 0.30, "Ações BR": 0.30, "FIIs": 0.20, "Cripto": 0.10, "Renda Fixa BR": 0.10},
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
}


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


def gerar_relatorios() -> None:
    maio = _relatorio("2026-05", "Maio 2026", "2026-05-31", mes1=False)
    abril = _relatorio("2026-04", "Abril 2026", "2026-04-30", mes1=True)
    indice = {
        "schema": "relatorios_index_v1",
        "atualizado_em": "2026-06-01",
        "meses": [
            {"mes": "2026-05", "titulo": maio["titulo"], "gerado_para": "2026-05-31",
             "arquivo": "relatorio_2026-05.json.enc"},
            {"mes": "2026-04", "titulo": abril["titulo"], "gerado_para": "2026-04-30",
             "arquivo": "relatorio_2026-04.json.enc"},
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
             numeros: dict, fontes: list[dict]) -> dict:
    return {
        "data": data,
        "gatilho": gatilho,
        "veredito": veredito,
        "numeros_reportados": numeros,
        "leitura": leitura,
        "observar": "Sinal de exemplo a observar na próxima leitura.",
        "gatilho_reavaliacao": "Gatilho de exemplo para reavaliar a tese.",
        "fontes": fontes,
    }


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
            _entrada(
                "2026-07-15", "deteriorando", "leitura contemporânea de exemplo",
                "Segunda leitura sintética do mesmo ano: o sinal de exemplo piorou.",
                {"vacancia_exemplo": "acima do trimestre de exemplo anterior"},
                [_fonte("fato-relevante-exemplo", "Fato relevante de exemplo", "2026-07-15")],
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
            _entrada(
                "2025-12-31", "deteriorando", "backfill histórico — leitura retrospectiva de FY2025",
                "Leitura sintética de FY2025: o sinal de exemplo piorou o suficiente para "
                "mudar o veredito nesta fixture.",
                {"margem_exemplo": "0,0% (exemplo, abaixo do ano anterior)"},
                [_fonte("release-exemplo-dois", "Release de exemplo (FY2025)", "2026-07-12")],
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
                "Leitura sintética de FY2025 em dólar de exemplo.",
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
                "arquivo": nome_arquivo_cifrado(d["ticker"]),
                "sha256": hash_conteudo(d),
            }
            for d in dossies
        ],
    }
    alvos = [("dossies_index.test.json.enc", indice)]
    alvos += [(f"dossie_{d['ticker']}.test.json.enc", d) for d in dossies]
    for nome, obj in alvos:
        enc = encriptar_json(json.dumps(obj, ensure_ascii=False), PIN_TESTE)
        (base / nome).write_text(enc, encoding="ascii")
        print(f"Fixture gerada: {base / nome}")


def main() -> None:
    enc = encriptar_json(json.dumps(PAYLOAD, ensure_ascii=False), PIN_TESTE)
    OUT.write_text(enc, encoding="ascii")
    print(f"Fixture gerada: {OUT}")
    print(f"  Tamanho B64: {len(enc)} chars · PIN={PIN_TESTE}")
    gerar_relatorios()  # 7a.Q.3
    gerar_dossies()     # 7a.R.3.b


if __name__ == "__main__":
    main()
