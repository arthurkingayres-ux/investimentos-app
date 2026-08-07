"""Watchdog do deploy do Pages — copia standalone (Fase 7a.AA.3, Step 7).

POR QUE UM WATCHDOG E NAO UM OBSERVADOR DE EVENTO. Medido em 07/08/2026, e as
duas medicoes eliminam as duas alternativas mais baratas:

1. `workflow_run` NAO observa `pages build and deployment`. A sonda: o Pages
   concluiu 10:51:34Z e nenhum run de "Alerta de falha" apareceu nos 3,7 min
   seguintes; o CI concluiu 10:55:16Z e o alerta nasceu 10:55:18Z, 2 segundos
   depois. O nome literal foi conferido contra a API antes e bate byte a byte,
   entao nao e typo — e job pulado por `if:` CRIA run listavel, provado no mesmo
   experimento, entao a ausencia e informativa e nao ambigua.

2. `on: deployment_status` NAO cobre o caso originador. Nos dois runs de Pages
   falhos de 06/08 o job `deploy` saiu `skipped` e NENHUM deployment foi criado
   — a falha acontece antes de existir deployment. Por isso a fonte aqui e
   `actions/runs`, e nao `deployments` como o plano supunha.

A logica canonica e testada vive em
`investimentos/src/output/watchdog_pages.py`; esta copia e deliberada, pelo
mesmo motivo de `alertar_falha.py` — nao acoplar um consumidor novo ao
CROSS_REPO_TOKEN (vence ~19/09) num repo PUBLICO. O detector de drift vive no
repo principal, em `tests/test_watchdog_pages.py::TestParidadeComACopiaDoSibling`,
e tem uma ancora de COMPORTAMENTO alem da de simbolo.

rc: 0 nada a alertar ou alerta enviado · 1 envio falhou · 2 MAIL_* ausente(s)
    3 erro ao consultar a API
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from alertar_falha import config_smtp, enviar, montar_alerta  # noqa: E402

_API = "https://api.github.com"

# O workflow dinamico do Pages tem DOIS nomes, e a diferenca custou uma
# conclusao errada em 07/08/2026:
#
#   /actions/workflows  ->  name: "pages-build-deployment"    (hifens)
#   /actions/runs       ->  name: "pages build and deployment" (espacos)
#
# Conferir "o nome literal contra a API" no endpoint de RUNS e depois usa-lo
# onde se espera o nome do WORKFLOW passa despercebido: os dois existem, os dois
# parecem certos, e o erro se manifesta como silencio. O `path` nao tem essa
# ambiguidade.
_PATH_PAGES = "dynamic/pages/pages-build-deployment"
_NOMES_PAGES = ("pages-build-deployment", "pages build and deployment")

# `cancelled` fica DE FORA de proposito: e ruido de outage (limitacao 4 da §9.6
# do runbook), e o gate do canal de evento tambem e `failure`. Os dois criterios
# se mantem identicos para que "o que alerta" tenha uma definicao so.
_CONCLUSAO_ALERTAVEL = "failure"


def _quando(run: dict) -> datetime:
    """`updated_at` como datetime tz-aware. Run sem data vai para o passado
    remoto, nunca para o futuro: assim ele nunca ganha de um run real na
    selecao do mais recente."""
    bruto = run.get("updated_at")
    if not bruto:
        return datetime.min.replace(tzinfo=timezone.utc)
    return datetime.fromisoformat(bruto.replace("Z", "+00:00"))


def selecionar_run_falho(
    runs: list, janela_horas: int, agora: datetime
) -> dict | None:
    """O run MAIS RECENTE do Pages, se ele falhou e caiu dentro da janela.

    Olha so o mais recente de proposito. O watchdog responde "o Pages esta
    quebrado AGORA?", nao "houve falha algum dia" — uma falha seguida de um
    verde significa que o problema passou, e alertar sobre ela seria ruido.

    A janela existe para que a mesma falha nao seja re-alertada a cada rodada,
    para sempre; com intervalo de 6h e janela de 8h, cada falha grita uma ou
    duas vezes e cala. Alerta repetido e alerta ignorado, que e como o canal
    nativo do GitHub morreu sem ninguem notar.

    NAO confia na ordem recebida: a API costuma devolver decrescente, mas
    depender disso faria um Pages quebrado passar por verde se a ordem viesse
    trocada.
    """
    if not runs:
        return None
    mais_recente = max(runs, key=_quando)
    if mais_recente.get("conclusion") != _CONCLUSAO_ALERTAVEL:
        return None
    if _quando(mais_recente) < agora - timedelta(hours=janela_horas):
        return None
    return mais_recente


def ctx_do_run(run: dict, repo: str) -> dict:
    """Traduz um run da API para o ctx que `montar_alerta` espera.

    As chaves sao as mesmas que o YAML do `workflow_run` preenche por ENV, para
    que a mensagem seja identica venha ela de qual caminho vier — um alerta que
    muda de forma conforme a origem obriga quem le a aprender dois formatos.
    """
    return {
        "repo": repo,
        "workflow": run.get("name"),
        "conclusion": run.get("conclusion"),
        "run_url": run.get("html_url"),
        "head_branch": run.get("head_branch"),
        "event": run.get("event"),
    }


def escolher_workflow_pages(workflows: list) -> dict | None:
    """O workflow dinamico do Pages, por `path` e com os nomes como reserva.

    `path` primeiro porque e o unico identificador que nao muda de forma
    conforme o endpoint que o devolve.
    """
    for w in workflows:
        if w.get("path") == _PATH_PAGES:
            return w
    for w in workflows:
        if w.get("name") in _NOMES_PAGES:
            return w
    return None


def _get(url: str, token: str | None) -> dict:
    req = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "watchdog-pages",
        **({"Authorization": f"Bearer {token}"} if token else {}),
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def buscar_runs_do_pages(repo: str, token: str | None) -> list:
    """Runs do workflow dinamico do Pages, resolvido POR NOME.

    Resolver o id a partir do nome, em vez de filtrar uma lista geral de runs,
    da uma propriedade que vale o request extra: se o nome nao existir, isto
    LEVANTA em vez de devolver lista vazia. Lista vazia seria indistinguivel de
    "o Pages esta verde" — o mesmo modo de falha mudo que `workflow_run` por
    nome literal tem, e que esta fase inteira existe para nao repetir.
    """
    wfs = _get(f"{_API}/repos/{repo}/actions/workflows?per_page=100", token)
    alvo = escolher_workflow_pages(wfs.get("workflows", []))
    if alvo is None:
        raise RuntimeError(
            f"nenhum workflow de Pages em {repo} (procurei o path "
            f"'{_PATH_PAGES}' e os nomes {_NOMES_PAGES}) — "
            f"um watchdog que nao acha o alvo e MUDO"
        )
    dados = _get(f"{_API}/repos/{repo}/actions/workflows/{alvo['id']}/runs"
                 f"?per_page=10&status=completed", token)
    return dados.get("workflow_runs", [])


def main() -> int:
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    token = os.environ.get("GITHUB_TOKEN") or None
    janela = int(os.environ.get("WATCHDOG_JANELA_HORAS", "8"))

    config = config_smtp(dict(os.environ))
    if config is None:
        print("[watchdog_pages] MAIL_* ausente(s) — nenhum alerta possivel. "
              "Cadastre os secrets neste repo.")
        return 2

    try:
        runs = buscar_runs_do_pages(repo, token)
    except (urllib.error.URLError, RuntimeError, KeyError, ValueError) as exc:
        # Ruidoso de proposito: um watchdog que falha em silencio e o defeito
        # que ele existe para corrigir.
        print(f"[watchdog_pages] CONSULTA FALHOU ({type(exc).__name__}: {exc})")
        return 3

    falho = selecionar_run_falho(runs, janela, datetime.now(timezone.utc))
    if falho is None:
        print(f"[watchdog_pages] Pages ok (janela {janela}h, "
              f"{len(runs)} run(s) inspecionado(s)) — nada a alertar")
        return 0

    alerta = montar_alerta(ctx_do_run(falho, repo))
    return 0 if enviar(alerta, config) else 1


if __name__ == "__main__":
    raise SystemExit(main())
