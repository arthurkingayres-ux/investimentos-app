"""PII scanner recursivo para o sibling investimentos-app.

Usa `pii_redactor.listar_violacoes` (copiado do Investimentos) e varre
arquivos texto, excluindo node_modules, .git, playwright-report, test-results
e extensões binárias conhecidas.

Uso:
    python tests/pii/check_pii.py --mode audit --path .     # CI (arvore inteira)
    python tests/pii/check_pii.py --mode audit --staged     # pre-commit (index)

`--staged` (7a.BE.1) le o BLOB do index de cada arquivo staged, nao o disco, com
a mesma elegibilidade (`_arquivo_elegivel`) e o mesmo modo do CI: uma regra so
nas duas camadas. Alem disso barra pelo NOME as extensoes de `EXTENSOES_PROIBIDAS`.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))

from pii_redactor import listar_violacoes  # noqa: E402

EXCLUIR_DIRS = {
    "node_modules",
    ".git",
    "playwright-report",
    "test-results",
    ".vscode",
}

EXTENSOES_TEXTO = {
    ".js",
    ".ts",
    ".tsx",
    ".mjs",
    ".cjs",
    ".json",
    ".html",
    ".css",
    ".md",
    ".yml",
    ".yaml",
    ".py",
    ".toml",
    ".webmanifest",
    ".txt",
}

EXCLUIR_ARQUIVOS = {
    "package-lock.json",
    "portfolio.json.enc",
    "portfolio.test.json.enc",
}


# So no --staged: documento de corretora e planilha nunca entram no repo publico,
# limpos ou nao. Barrados pelo nome, sem ler o conteudo.
EXTENSOES_PROIBIDAS = {".db", ".xlsx", ".xls", ".pdf", ".csv"}


def _arquivo_elegivel(p: Path) -> bool:
    if p.name in EXCLUIR_ARQUIVOS:
        return False
    return p.suffix.lower() in EXTENSOES_TEXTO


def _git_bytes(*args: str) -> bytes:
    """`git <args>` -> stdout cru. Falha de git LEVANTA: o hook falha fechado."""
    return subprocess.run(["git", *args], capture_output=True, check=True).stdout


def _scan_staged(mode: str) -> int:
    """Varre o index. `-z` porque `core.quotePath` escapa nome com espaco ou
    acento na saida normal, e o nome escapado nao acha o blob.

    `ACMRT`: o T (mudanca de tipo, ex.: symlink -> arquivo regular) tambem e
    escaneado. Paridade com `--path`/CI: caminhos com algum componente em
    `EXCLUIR_DIRS` (ex.: `node_modules/`) sao ignorados, como o CI faz."""
    saida = _git_bytes("diff", "--cached", "--name-only", "--diff-filter=ACMRT", "-z")
    nomes = [
        n.decode("utf-8") for n in saida.split(b"\0")
        if n and not (set(Path(n.decode("utf-8")).parts) & EXCLUIR_DIRS)
    ]
    violacoes: list[tuple[str, str, str]] = []
    for nome in nomes:
        p = Path(nome)
        if p.suffix.lower() in EXTENSOES_PROIBIDAS:
            violacoes.append(("extensao_proibida", nome, f"extensao {p.suffix.lower()}"))
            continue
        if not _arquivo_elegivel(p):
            continue
        # errors="replace": texto latin-1/cp1252 e escaneado (digitos ASCII sobrevivem).
        texto = _git_bytes("show", f":{nome}").decode("utf-8", errors="replace")
        for h in listar_violacoes(texto, mode=mode):
            violacoes.append((h.categoria, nome, f"linha {h.linha}: {h.contexto}"))

    if not violacoes:
        return 0
    print(f"PII scan FAIL ({mode}, staged): {len(violacoes)} violacao(oes)", file=sys.stderr)
    for cat, nome, detalhe in violacoes:
        print(f"  {cat}:{nome}:{detalhe}", file=sys.stderr)
    return 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["precommit", "audit"], default="audit")
    grupo = ap.add_mutually_exclusive_group()
    grupo.add_argument("--path", default=".")
    grupo.add_argument("--staged", action="store_true")
    args = ap.parse_args()

    if args.staged:
        return _scan_staged(args.mode)

    root = Path(args.path).resolve()
    violacoes: list[tuple[Path, int, str, str]] = []

    # os.walk com prune em dirs[:] evita descer em node_modules/.git/etc.
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in EXCLUIR_DIRS]
        for nome in filenames:
            arquivo = Path(dirpath) / nome
            if not _arquivo_elegivel(arquivo):
                continue
            texto = arquivo.read_text(encoding="utf-8", errors="replace")
            hits = listar_violacoes(texto, mode=args.mode)
            for h in hits:
                violacoes.append((arquivo.relative_to(root), h.linha, h.categoria, h.contexto))

    if not violacoes:
        print(f"PII scan OK ({args.mode}): nenhuma violacao em {root}")
        return 0

    print(f"PII scan FAIL ({args.mode}): {len(violacoes)} violacao(oes) em {root}")
    for rel, linha, cat, ctx in violacoes:
        print(f"  {cat}:{rel}:linha {linha}: {ctx}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
