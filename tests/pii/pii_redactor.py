"""Redator de PII para JSONs em documentos/extraidos/.

Aplica substituicoes schema-aware (xp_notas, irpf, avenue). Nao faz I/O:
recebe dict, devolve novo dict. Idempotente por construcao.
"""
from __future__ import annotations

import importlib
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
PLACEHOLDER_TOKEN_ARQUIVO = "REDACTED"


# Mesmos padroes do pre-commit hook e do audit-history.sh:
# - CPF formatado: 000.000.000-00
# - CPF limpo: 11 digitos contiguos
# Usamos lookarounds negativos em digitos para nao exigir fronteira de palavra
# (nomes de arquivo usam "_" como separador e "_" e caractere de palavra).
_CPF_FORMATADO_RE = re.compile(r"(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)")
_CPF_LIMPO_RE = re.compile(r"(?<!\d)\d{11}(?!\d)")


# Fonte unica: scripts/git-hooks/pre-commit e scripts/audit-history.sh
# delegam para listar_violacoes (via scripts/security/check_pii.py) desde 7a.25.
_CPF_LIMPO_ADJ_RE = re.compile(
    r"(cpf|CPF|conta|CONTA)[^\n]{0,20}\b\d{11}\b"
)
_CONTA_ADJ_RE = re.compile(
    r"(conta|CONTA)[^\n]{0,20}\b\d{7}\b"
)
# Conta (7 digitos exatos) embutida num nome de arquivo — o ponto cego que deixou
# a conta XP vazar em fonte_arquivo (Fase 7a.31). Desacoplado em dois passos para
# pegar TODAS as contas num mesmo token (nao so a primeira):
#   1. _FILENAME_TOKEN_RE: token que termina em extensao de documento.
#   2. _CONTA_7_RE: cada run de exatamente 7 digitos (lookarounds NAO casam
#      numero_nota de 9 dig nem anos/datas de 2/4 dig).
_FILENAME_TOKEN_RE = re.compile(
    r"[\w.\-]*\.(?:pdf|png|jpe?g|heic)\b",
    re.IGNORECASE,
)
_CONTA_7_RE = re.compile(r"(?<!\d)\d{7}(?!\d)")

# Conta ALFANUMERICA marcada pelo literal `account=` — o ponto cego da Avenue
# (Fase 7a.Y.3). Ela nomeia confirmacoes como
# `Doc_<n>_CONFIRMATIONaccount=<TOKEN>_<TOKEN>_...`: token Avenue alfanumerico
# marcado por `account=`. `_CONTA_7_RE` cobre so a conta XP de 7 digitos, entao
# nem o redator nem o detector alcancavam esse token.
#
# A regra e ancorada no MARCADOR, nao na forma do token, e e isso que a mantem
# estreita — alargar `_CONTA_7_RE` para alfanumerico transformaria ticker, data e
# hash em suspeitos, em toda a arvore. O preco e conhecido e declarado: um token
# solto, sem `account=` em lugar nenhum do texto, nao e detectado.
_CONTA_MARCADA_RE = re.compile(r"account=([A-Za-z0-9]{4,})", re.IGNORECASE)

_WHITELIST_CPF_FORMATADO = {"000.000.000-00"}
_WHITELIST_CPF_LIMPO = {"00000000000"}
_WHITELIST_CONTA = {"9999999"}


# Modulos cuja AUSENCIA significa "nao ha whitelist local" (ex.: no sibling, onde
# este arquivo roda sem o pacote `src`). Qualquer outro erro — inclusive um
# ModuleNotFoundError levantado DENTRO do modulo local — propaga: falha alto em
# vez de sumir com a whitelist.
_MODULOS_LOCAIS_AUSENTES = frozenset(
    {"src", "src.security", "src.security.pii_whitelist_local"}
)


def _carregar_whitelist_local() -> frozenset[str]:
    # `import_module`, nao `from src.security import ...`: com o pacote presente e
    # o modulo ausente, o `from` levanta ImportError generico, sem `e.name` util.
    try:
        pii_whitelist_local = importlib.import_module("src.security.pii_whitelist_local")
    except ModuleNotFoundError as e:
        if e.name in _MODULOS_LOCAIS_AUSENTES:
            return frozenset()
        raise
    return frozenset(pii_whitelist_local.WHITELIST_CONTA_MARCADA)


# Whitelist publica: so placeholders (`REDACTED` mantem a redacao idempotente);
# a local, se existir, soma (`src/security/pii_whitelist_local.py`).
_WHITELIST_CONTA_MARCADA = frozenset({PLACEHOLDER_TOKEN_ARQUIVO}) | _carregar_whitelist_local()


def redigir_nome_arquivo(nome: str) -> str:
    """Redige PII em nome de arquivo.

    CPF (formatado ou limpo) -> nome inteiro vira PLACEHOLDER_NOME_ARQUIVO.
    Conta (cada run de 7 digitos exatos num token de filename, fora da whitelist)
    -> troca SO o(s) token(s) da conta por PLACEHOLDER_TOKEN_ARQUIVO, preservando
    o resto. Redige TODAS as contas do token, nao so a primeira.
    Idempotente (REDACTED nao tem digitos). (Fase 7a.31)
    """
    if _CPF_FORMATADO_RE.search(nome):
        return PLACEHOLDER_NOME_ARQUIVO
    if _CPF_LIMPO_RE.search(nome):
        return PLACEHOLDER_NOME_ARQUIVO

    def _redigir_contas_no_token(conta: "re.Match[str]") -> str:
        return conta.group(0) if conta.group(0) in _WHITELIST_CONTA else PLACEHOLDER_TOKEN_ARQUIVO

    def _sub_token(token: "re.Match[str]") -> str:
        return _CONTA_7_RE.sub(_redigir_contas_no_token, token.group(0))

    # Conta alfanumerica da Avenue: o TOKEN se repete no mesmo nome FORA do
    # marcador (`account=<TOKEN>_<TOKEN>_...`), entao redige o VALOR em todas as
    # posicoes — redigir so a ocorrencia casada deixaria a conta em claro logo ao
    # lado. Roda ANTES do passo de 7 digitos, que e independente.
    for marcada in set(_CONTA_MARCADA_RE.findall(nome)):
        if marcada not in _WHITELIST_CONTA_MARCADA:
            nome = nome.replace(marcada, PLACEHOLDER_TOKEN_ARQUIVO)

    return _FILENAME_TOKEN_RE.sub(_sub_token, nome)


# Alias interno: `_REGRAS` referencia o nome privado desde a 7a.31, e o
# publico foi introduzido na 7a.Y.3 para consumo fora deste modulo.
_redigir_nome_arquivo = redigir_nome_arquivo

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
    for match in _CONTA_MARCADA_RE.finditer(texto):
        valor = match.group(1)
        if valor not in _WHITELIST_CONTA_MARCADA:
            linha = texto[: match.start()].count("\n") + 1
            ctx = linhas[linha - 1] if 1 <= linha <= len(linhas) else ""
            violacoes.append(Violacao(categoria="conta_marcada", valor=valor, linha=linha, contexto=ctx))
    for fmatch in _FILENAME_TOKEN_RE.finditer(texto):
        token = fmatch.group(0)
        for cmatch in _CONTA_7_RE.finditer(token):
            valor = cmatch.group(0)
            if valor not in wl_conta:
                abspos = fmatch.start() + cmatch.start()
                linha = texto[:abspos].count("\n") + 1
                ctx = linhas[linha - 1] if 1 <= linha <= len(linhas) else ""
                violacoes.append(Violacao(categoria="conta_arquivo", valor=valor, linha=linha, contexto=ctx))
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
        _Regra(campo="fonte_arquivo", transformacao=_redigir_nome_arquivo),
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
