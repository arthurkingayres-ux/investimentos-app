"""Gera portfolio.test.json.enc para testes Playwright E2E.

Uso (rodar do repo Investimentos com PYTHONPATH configurado):
    cd /caminho/Investimentos
    PYTHONPATH=. python ../investimentos-app/tests/fixtures/gerar_fixture.py

Saída: ../investimentos-app/tests/fixtures/portfolio.test.json.enc
PIN de teste: 123456

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


def _serie_mensal(start_twr: float, fim_twr: float, start_bench: float, fim_bench: float) -> list[dict]:
    """Gera uma série de 6 pontos linearmente interpolados em meses fictícios."""
    meses = ["2024-01", "2024-06", "2025-01", "2025-06", "2026-01", "2026-04"]
    n = len(meses)
    return [
        {
            "data": meses[i],
            "twr": round(start_twr + (fim_twr - start_twr) * (i / (n - 1)), 4),
            "benchmark": round(
                start_bench + (fim_bench - start_bench) * (i / (n - 1)), 4
            ),
        }
        for i in range(n)
    ]


def _serie_periodo(start_nav: float, fim_nav: float, cashflow_total: float,
                    bench_growth_final: float) -> list[dict]:
    """Schema v2.14 (Fase 7a.L.2.a): serie mensal {data, nav, cashflow, benchmark_growth}
    para card 'Período' do PWA. Mesmos 6 anchors do _serie_mensal — alinha
    índices entre historico_twr e historico_periodo (frontend consome ambos)."""
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
        pontos.append({
            "data": meses[i],
            "nav": nav,
            "cashflow": cf,
            "benchmark_growth": bg,
        })
    return pontos


PAYLOAD = {
    "versao": "2.14",
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
        "atual": {"EUA": 0.42, "Ações BR": 0.28, "FIIs": 0.22, "Cripto": 0.08},
        "alvo": {"EUA": 0.40, "Ações BR": 0.30, "FIIs": 0.20, "Cripto": 0.10},
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
            "historico_twr": _serie_mensal(0.05, 0.118, 0.04, 0.08),
            # Schema v2.14 (Fase 7a.L.2.a): historico_periodo flat (Total/Brasil).
            "historico_periodo": _serie_periodo(200000.0, 258000.0, 50000.0, 1.08),
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
            "historico_twr": _serie_mensal(0.04, 0.078, 0.02, 0.025),
            "historico_periodo": _serie_periodo(120000.0, 150000.0, 25000.0, 1.025),
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
    # 7a.E.16.3: ativo.peso_intra_atual + drift_intra; status binário usa drift_intra.
    "politica": {
        "escala_max": 10,
        "categorias": [
            {
                "nome": "Ações BR",
                "peso_alvo": 0.30,
                "peso_atual": 0.27,
                "drift": -0.03,
                "ativos": [
                    # cat_atual = 0.27. BBAS3 atual=0.10 → intra_atual=0.3704, intra_alvo=0.5
                    # → drift_intra=-0.1296 → aportar.
                    {
                        "ticker": "BBAS3",
                        "nota": 2,
                        "peso_intra": 0.5,
                        "peso_intra_atual": 0.3704,
                        "peso_alvo": 0.15,
                        "peso_atual": 0.10,
                        "drift": -0.05,
                        "drift_intra": -0.1296,
                        "status": "aportar",
                    },
                    # ITSA4 atual=0.17 → intra_atual=0.6296, intra_alvo=0.5
                    # → drift_intra=+0.1296 → pausar.
                    {
                        "ticker": "ITSA4",
                        "nota": 2,
                        "peso_intra": 0.5,
                        "peso_intra_atual": 0.6296,
                        "peso_alvo": 0.15,
                        "peso_atual": 0.17,
                        "drift": 0.02,
                        "drift_intra": 0.1296,
                        "status": "pausar",
                    },
                    {
                        "ticker": "GRND3",
                        "nota": 0,
                        "peso_intra": 0.0,
                        "peso_intra_atual": 0.0185,
                        "peso_alvo": 0.0,
                        "peso_atual": 0.005,
                        "drift": 0.005,
                        "drift_intra": 0.0185,
                        "status": "fora_da_politica",
                    },
                ],
            },
            {
                "nome": "EUA",
                "peso_alvo": 0.70,
                "peso_atual": 0.73,
                "drift": 0.03,
                "ativos": [
                    {
                        "ticker": "VOO",
                        "nota": 3,
                        "peso_intra": 1.0,
                        "peso_intra_atual": 1.0,
                        "peso_alvo": 0.70,
                        "peso_atual": 0.73,
                        "drift": 0.03,
                        "drift_intra": 0.0,
                        "status": "no_alvo",
                    },
                ],
            },
        ],
    },
}


def main() -> None:
    enc = encriptar_json(json.dumps(PAYLOAD, ensure_ascii=False), PIN_TESTE)
    OUT.write_text(enc, encoding="ascii")
    print(f"Fixture gerada: {OUT}")
    print(f"  Tamanho B64: {len(enc)} chars · PIN={PIN_TESTE}")


if __name__ == "__main__":
    main()
