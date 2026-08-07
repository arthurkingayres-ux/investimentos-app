"""Alerta de falha do sibling — copia standalone (Fase 7a.AA.3).

`workflow_run` e SAME-REPO, entao o observador precisa existir aqui. Este repo
nao tem `src/`, e fazer checkout cross-repo do principal exigiria um token novo
num repo PUBLICO para economizar ~60 linhas — troca ruim. A logica canonica e
testada vive em `investimentos/src/output/alerta_falha.py`; esta copia e
deliberada, e o teste `alerta-falha.spec.ts` trava as ancoras do YAML daqui.

O detector de drift entre as duas copias vive no repo PRINCIPAL, em
`tests/test_alerta_falha.py::TestParidadeComACopiaDoSibling`, e e LOCAL-ONLY:
ele pula quando o sibling nao esta em disco, o que e o caso no CI.

MEDIDO em 06/08/2026: o canal nativo do GitHub esta morto ha 60+ dias. Nenhum
e-mail de falha de workflow chegou desde 15/05/2026, apesar de terem cabido no
periodo 2 runs agendados vermelhos, 12 runs de CI vermelhos e um deploy do Pages
falho. Um canal que se desliga sozinho, em silencio, e continua parecendo
existir e pior que nao ter canal, porque produz falsa confianca.

O ALERTA NAO IMPEDE FALHA NENHUMA. Ele GRITA, e o julgamento continua humano.

rc: 0 enviado · 1 envio falhou · 2 MAIL_* ausente(s)
"""
from __future__ import annotations

import os
import smtplib
from email.message import EmailMessage

_SMTP_HOST = "smtp.gmail.com"
_SMTP_PORT = 465

_DESCONHECIDO = "desconhecido"


def montar_alerta(ctx: dict) -> dict:
    """{assunto, corpo} do alerta. Tolerante a campo ausente: o payload do
    workflow_run pode vir incompleto, e alerta mudo e pior que alerta feio."""
    repo = ctx.get("repo") or _DESCONHECIDO
    workflow = ctx.get("workflow") or _DESCONHECIDO
    conclusion = ctx.get("conclusion") or _DESCONHECIDO
    url = ctx.get("run_url") or _DESCONHECIDO
    branch = ctx.get("head_branch") or _DESCONHECIDO
    evento = ctx.get("event") or _DESCONHECIDO
    return {
        "assunto": f"[FALHA] {repo} — {workflow}",
        "corpo": (
            f"Um workflow terminou com conclusao '{conclusion}'.\n\n"
            f"  repositorio : {repo}\n"
            f"  workflow    : {workflow}\n"
            f"  branch      : {branch}\n"
            f"  evento      : {evento}\n"
            f"  run         : {url}\n\n"
            f"Este alerta nao impede nem corrige nada — ele so avisa. "
            f"Abra o run acima para ver o log.\n"
        ),
    }


def config_smtp(env: dict) -> dict | None:
    """Config a partir do ambiente, ou None se qualquer MAIL_* faltar."""
    frm = env.get("MAIL_FROM")
    to = env.get("MAIL_TO")
    pwd = env.get("MAIL_APP_PASSWORD")
    if not (frm and to and pwd):
        return None
    return {"from": frm, "to": to, "password": pwd,
            "host": _SMTP_HOST, "port": _SMTP_PORT}


def enviar(alerta: dict, config: dict | None) -> bool:
    """Envia por SMTP_SSL. NUNCA loga a senha nem a mensagem do servidor.

    Falha e RUIDOSA no log — um canal de alerta que falha em silencio e
    exatamente o defeito que esta sub-fase existe para corrigir.
    """
    if config is None:
        print("[alerta_falha] pulado: MAIL_FROM/MAIL_TO/MAIL_APP_PASSWORD ausente(s)")
        return False
    msg = EmailMessage()
    msg["Subject"] = alerta["assunto"]
    msg["From"] = config["from"]
    msg["To"] = config["to"]
    msg.set_content(alerta["corpo"])
    try:
        with smtplib.SMTP_SSL(config["host"], config["port"]) as s:
            s.login(config["from"], config["password"])
            s.send_message(msg)
    except Exception as exc:
        print(f"[alerta_falha] ENVIO FALHOU ({type(exc).__name__}) — "
              f"o alerta NAO chegou a ninguem")
        return False
    print(f"[alerta_falha] enviado: {alerta['assunto']}")
    return True


def ctx_do_ambiente(env: dict) -> dict:
    """Le as ALERTA_* que o YAML preenche a partir do payload do workflow_run.

    Passa pelo ambiente, e nao por argumento de `run:`, para que conteudo
    controlado pelo evento nunca seja interpolado numa linha de shell — mesmo
    padrao adotado na 7a.X.2.
    """
    return {
        "repo": env.get("ALERTA_REPO"),
        "workflow": env.get("ALERTA_WORKFLOW"),
        "conclusion": env.get("ALERTA_CONCLUSION"),
        "run_url": env.get("ALERTA_RUN_URL"),
        "head_branch": env.get("ALERTA_HEAD_BRANCH"),
        "event": env.get("ALERTA_EVENT"),
    }


def main() -> int:
    # Sem parametro de argv: toda a configuracao vem do ambiente, que e como o
    # `workflow_run` entrega o contexto. Um `argv` aceito e ignorado anunciaria
    # um suporte a linha de comando que nao existe (finding do CRB 7a.AA.3).
    env = dict(os.environ)
    config = config_smtp(env)
    if config is None:
        print("[alertar_falha] MAIL_* ausente(s) — nenhum alerta enviado. "
              "Cadastre os secrets neste repo.")
        return 2
    alerta = montar_alerta(ctx_do_ambiente(env))
    return 0 if enviar(alerta, config) else 1


if __name__ == "__main__":
    raise SystemExit(main())
