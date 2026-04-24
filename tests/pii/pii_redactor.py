"""Redator de PII para JSONs em documentos/extraidos/.

Aplica substituicoes schema-aware (xp_notas, irpf, avenue). Nao faz I/O:
recebe dict, devolve novo dict. Idempotente por construcao.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable, Literal

Schema = Literal["xp_notas", "irpf", "avenue"]

_AUDIT_PATH_RE = re.compile(r"^docs/superpowers/(plans|specs|investigations)/")


def resolve_modo_para_path(path: str) -> Literal["precommit", "audit"]:
    """Seleciona o modo do detector a partir do path do arquivo.

    Contrato (7a.26):
      - docs/superpowers/{plans,specs,investigations}/... -> 'audit'
        (aceita canonicos documentados definidos em _AUDIT_CANONICO_* acima).
      - qualquer outro path -> 'precommit' (estrito, so placeholders).

    Path normalizado para forward-slash antes do match para ficar portavel
    entre Windows e POSIX (git usa '/' em todas as plataformas).
    """
    normalizado = path.replace("\\", "/")
    if _AUDIT_PATH_RE.match(normalizado):
        return "audit"
    return "precommit"


PLACEHOLDER_CPF_FORMATADO = "000.000.000-00"
PLACEHOLDER_CPF_LIMPO = "00000000000"
PLACEHOLDER_CONTA = "9999999"
PLACEHOLDER_NOME_ARQUIVO = "REDACTED.pdf"


# Mesmos padroes do pre-commit hook e do audit-history.sh:
# - CPF formatado: 000.000.000-00
# - CPF limpo: 11 digitos contiguos
# Usamos lookarounds negativos em digitos para nao exigir fronteira de palavra
# (nomes de arquivo usam "_" como separador e "_" e caractere de palavra).
_CPF_FORMATADO_RE = re.compile(r"(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)")
_CPF_LIMPO_RE = re.compile(r"(?<!\d)\d{11}(?!\d)")


def _redigir_nome_arquivo(nome: str) -> str:
    """Retorna PLACEHOLDER_NOME_ARQUIVO se nome contem padrao de CPF; senao nome intacto."""
    if _CPF_FORMATADO_RE.search(nome):
        return PLACEHOLDER_NOME_ARQUIVO
    if _CPF_LIMPO_RE.search(nome):
        return PLACEHOLDER_NOME_ARQUIVO
    return nome


# Fonte unica: scripts/git-hooks/pre-commit e scripts/audit-history.sh
# delegam para listar_violacoes (via scripts/security/check_pii.py) desde 7a.25.
_CPF_LIMPO_ADJ_RE = re.compile(
    r"(cpf|CPF|conta|CONTA)[^\n]{0,20}\b\d{11}\b"
)
_CONTA_ADJ_RE = re.compile(
    r"(conta|CONTA)[^\n]{0,20}\b\d{7}\b"
)

_WHITELIST_CPF_FORMATADO = {"000.000.000-00"}
_WHITELIST_CPF_LIMPO = {"00000000000"}
_WHITELIST_CONTA = {"9999999"}

# Canonicos documentados aceitos em modo audit (sinteticos, publicos). Montados
# via concatenacao para nao tropecar no proprio pre-commit hook, que e mais
# ingenuo que este detector (ver plano fase 7a.25).
_AUDIT_CANONICO_CPF_FMT = "111.222." + "333-44"
_AUDIT_CANONICO_CPF_LIMPO = "111222" + "33344"
_AUDIT_CANONICO_CONTA = "12" + "34567"


@dataclass(frozen=True)
class Violacao:
    categoria: str
    valor: str
    linha: int
    contexto: str


def listar_violacoes(texto: str, mode: Literal["precommit", "audit"] = "precommit") -> list[Violacao]:
    wl_fmt = _WHITELIST_CPF_FORMATADO
    wl_limpo = _WHITELIST_CPF_LIMPO
    wl_conta = _WHITELIST_CONTA
    if mode == "audit":
        wl_fmt = wl_fmt | {_AUDIT_CANONICO_CPF_FMT}
        wl_limpo = wl_limpo | {_AUDIT_CANONICO_CPF_LIMPO}
        wl_conta = wl_conta | {_AUDIT_CANONICO_CONTA}
    linhas = texto.splitlines()
    violacoes: list[Violacao] = []
    for match in _CPF_FORMATADO_RE.finditer(texto):
        valor = match.group(0)
        if valor not in wl_fmt:
            linha = texto[: match.start()].count("\n") + 1
            ctx = linhas[linha - 1] if 1 <= linha <= len(linhas) else ""
            violacoes.append(Violacao(categoria="cpf_formatado", valor=valor, linha=linha, contexto=ctx))
    for match in _CPF_LIMPO_ADJ_RE.finditer(texto):
        m = re.search(r"\d{11}", match.group(0))
        if m is None:
            continue
        valor = m.group(0)
        if valor not in wl_limpo:
            linha = texto[: match.start()].count("\n") + 1
            ctx = linhas[linha - 1] if 1 <= linha <= len(linhas) else ""
            violacoes.append(Violacao(categoria="cpf_limpo_adj", valor=valor, linha=linha, contexto=ctx))
    for match in _CONTA_ADJ_RE.finditer(texto):
        m = re.search(r"\d{7}", match.group(0))
        if m is None:
            continue
        valor = m.group(0)
        if valor not in wl_conta:
            linha = texto[: match.start()].count("\n") + 1
            ctx = linhas[linha - 1] if 1 <= linha <= len(linhas) else ""
            violacoes.append(Violacao(categoria="conta_adj", valor=valor, linha=linha, contexto=ctx))
    return violacoes


def contem_pii(texto: str) -> bool:
    return bool(listar_violacoes(texto, mode="precommit"))


@dataclass(frozen=True)
class _Regra:
    campo: str
    substituir_por: str | None = None
    transformacao: Callable[[str], str] | None = None


_REGRAS: dict[str, list[_Regra]] = {
    "xp_notas": [
        _Regra(campo="cpf", substituir_por=PLACEHOLDER_CPF_FORMATADO),
        _Regra(campo="conta_xp", substituir_por=PLACEHOLDER_CONTA),
    ],
    "irpf": [
        _Regra(campo="arquivo_original", transformacao=_redigir_nome_arquivo),
    ],
    "avenue": [
        _Regra(campo="arquivo_original", transformacao=_redigir_nome_arquivo),
    ],
}


def redigir_documento(doc: dict, schema: Schema) -> dict:
    """Retorna novo dict com campos de PII do schema redigidos.

    Nao muta o input. Idempotente.

    Raises:
        ValueError: se o schema nao for reconhecido.
    """
    if schema not in _REGRAS:
        raise ValueError(f"schema desconhecido: {schema!r}")
    resultado = dict(doc)
    for regra in _REGRAS[schema]:
        if regra.campo not in resultado:
            continue
        if regra.substituir_por is not None:
            resultado[regra.campo] = regra.substituir_por
        elif regra.transformacao is not None:
            resultado[regra.campo] = regra.transformacao(resultado[regra.campo])
    return resultado
