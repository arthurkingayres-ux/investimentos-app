"""Gera portfolio.test.json.enc para testes Playwright E2E.

Uso (rodar do repo Investimentos com PYTHONPATH configurado):
    cd /caminho/Investimentos
    PYTHONPATH=. python ../investimentos-app/tests/fixtures/gerar_fixture.py

Saída: ../investimentos-app/tests/fixtures/portfolio.test.json.enc
PIN de teste: 123456

Payload mínimo que satisfaz todos os caminhos consumidos por js/app.js e
index.html (hero, rentabilidade com xirr/twr origem/ytd/12m + benchmarks,
alocacao.atual/alvo, proventos ytd + ano_anterior + mensal, ultimo_aporte).
"""
from __future__ import annotations

import json
from pathlib import Path

from src.output.crypto import encriptar_json

PIN_TESTE = "123456"
OUT = Path(__file__).resolve().parent / "portfolio.test.json.enc"

PAYLOAD = {
    "versao": "2.1",
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
                "IBOV": {"xirr_espelhado": 0.021},
                "S&P 500": {"xirr_espelhado": 0.058},
            },
        },
        "Brasil": {
            "xirr_origem": 0.091,
            "xirr_ytd": 0.028,
            "xirr_12m": 0.061,
            "twr_origem": 0.078,
            "twr_ytd": 0.024,
            "twr_12m": 0.055,
            "benchmarks": {
                "IBOV": {"xirr_espelhado": 0.021},
                "CDI": {"xirr_espelhado": 0.025},
            },
        },
        "EUA": {
            "xirr_origem": 0.138,
            "xirr_ytd": 0.058,
            "xirr_12m": 0.112,
            "twr_origem": 0.118,
            "twr_ytd": 0.051,
            "twr_12m": 0.098,
            "benchmarks": {
                "S&P 500": {"xirr_espelhado": 0.058},
            },
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
    "posicoes": [],
}


def main() -> None:
    enc = encriptar_json(json.dumps(PAYLOAD, ensure_ascii=False), PIN_TESTE)
    OUT.write_text(enc, encoding="ascii")
    print(f"Fixture gerada: {OUT}")
    print(f"  Tamanho B64: {len(enc)} chars · PIN={PIN_TESTE}")


if __name__ == "__main__":
    main()
