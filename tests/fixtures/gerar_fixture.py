"""Gera portfolio.test.json.enc para testes Playwright E2E.

Uso (rodar do repo Investimentos com PYTHONPATH configurado):
    cd /caminho/Investimentos
    PYTHONPATH=. python ../investimentos-app/tests/fixtures/gerar_fixture.py

Saída: ../investimentos-app/tests/fixtures/portfolio.test.json.enc
PIN de teste: 123456

Schema v2.3 (Fase 7a.E.4): payload mínimo que satisfaz raio-x + 3 telas
de detalhe (#rentabilidade com historico_twr mensal por escopo,
#alocacao detalhada por classe, #ativo/:ticker com movimentos +
proventos inline). Inclui 2 tickers em posicoes[] para drill-down:
HGLG11 (com movimentos+proventos) e VOO (só movimentos).
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


PAYLOAD = {
    "versao": "2.3",
    "atualizado_em": "2026-04-24T15:00:00",
    "patrimonio": {
        "total_brl": 258000.0,
        "br_brl": 149640.0,
        "eua_brl": 87720.0,
        "cripto_brl": 20640.0,
        "variacao_semanal_brl": 3100.0,
        "variacao_semanal_pct": 0.012,
        "evolucao": [],
    },
    "alocacao": {
        "atual": {"EUA": 0.42, "Ações BR": 0.28, "FII": 0.22, "Cripto": 0.08},
        "alvo": {"EUA": 0.40, "Ações Brasil": 0.30, "FIIs BR": 0.20, "Cripto": 0.10},
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
        },
        "EUA": {
            "xirr_origem": 0.138,
            "xirr_ytd": 0.058,
            "xirr_12m": 0.112,
            "twr_origem": 0.118,
            "twr_ytd": 0.051,
            "twr_12m": 0.098,
            "benchmarks": {
                "S&P 500": {
                    "xirr_espelhado": {"origem": 0.058, "ytd": 0.022, "12m": 0.041},
                    "twr_espelhado":  {"origem": 0.052, "ytd": 0.020, "12m": 0.039},
                },
            },
            "historico_twr": _serie_mensal(0.06, 0.118, 0.05, 0.058),
        },
        "interpretacao": {
            "Total": "Boas escolhas de ativos e timing favorável",
            "Brasil": "Seleção e timing abaixo do índice",
            "EUA": "Boas escolhas de ativos e timing favorável",
        },
    },
    "proventos": {
        "ytd_brl": 3240.0,
        "ano_anterior_brl": 9820.0,
        "mensal": [
            {"mes": "2026-04", "brl": 820.0},
            {"mes": "2026-03", "brl": 790.0},
            {"mes": "2026-02", "brl": 810.0},
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
}


def main() -> None:
    enc = encriptar_json(json.dumps(PAYLOAD, ensure_ascii=False), PIN_TESTE)
    OUT.write_text(enc, encoding="ascii")
    print(f"Fixture gerada: {OUT}")
    print(f"  Tamanho B64: {len(enc)} chars · PIN={PIN_TESTE}")


if __name__ == "__main__":
    main()
