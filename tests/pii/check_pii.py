"""PII scanner recursivo para o sibling investimentos-app.

Usa `pii_redactor.listar_violacoes` (copiado do Investimentos) e varre
arquivos texto, excluindo node_modules, .git, playwright-report, test-results
e extensões binárias conhecidas.

Uso:
    python tests/pii/check_pii.py --mode audit --path .
"""
from __future__ import annotations

import argparse
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


def _deve_varrer(p: Path) -> bool:
    if p.name in EXCLUIR_ARQUIVOS:
        return False
    if any(part in EXCLUIR_DIRS for part in p.parts):
        return False
    return p.suffix.lower() in EXTENSOES_TEXTO


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["precommit", "audit"], default="audit")
    ap.add_argument("--path", default=".")
    args = ap.parse_args()

    root = Path(args.path).resolve()
    violacoes: list[tuple[Path, int, str, str]] = []

    for arquivo in root.rglob("*"):
        if not arquivo.is_file() or not _deve_varrer(arquivo):
            continue
        try:
            texto = arquivo.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
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
