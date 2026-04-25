# investimentos-app

[![CI](https://github.com/arthurkingayres-ux/investimentos-app/actions/workflows/ci.yml/badge.svg)](https://github.com/arthurkingayres-ux/investimentos-app/actions/workflows/ci.yml)

PWA estático para visualização de carteira pessoal. Dados cifrados no client-side com PIN. Hospedado no GitHub Pages.

## Rotas

Hash routing — todas as telas convivem na mesma página estática.

| Rota                   | Tela                  | O que mostra                                                                |
|------------------------|-----------------------|-----------------------------------------------------------------------------|
| `/`                    | Raio X (home)         | Patrimônio, rentabilidade, alocação, último aporte, proventos.              |
| `/#rentabilidade`      | Detalhe de rentabilidade | Série mensal de TWR vs benchmark (CDI / S&P 500), por escopo, gráfico uPlot. |
| `/#alocacao`           | Detalhe de alocação   | 4 classes (EUA / FIIs / Ações BR / Cripto) expansíveis com tickers dentro.  |
| `/#ativo/:ticker`      | Drill-down por ativo  | Header + KPIs (qty, custo, VM, ganho, XIRR) + tabelas de movimentos e proventos. |

Hash inválido cai em raio-x via `history.replaceState` (sem entrar no histórico do navegador).

## Tests

Suite end-to-end em Playwright (Chromium, viewport Pixel 7 mobile). Cobre PIN flow, sessão 7d deslizante, toast de atualização, sincronização multi-tab, hash routing das 3 telas de detalhe e drill-down por ticker. Offline/SW fica como smoke manual no dispositivo real.

```bash
npm install
npx playwright install chromium
npx playwright test
```

CI roda os mesmos testes + scanner PII a cada `push`/`pull_request` em `main` (veja `.github/workflows/ci.yml`).

PIN de teste: `123456` · fixture cifrada em `tests/fixtures/portfolio.test.json.enc` · gerador reprodutível em `tests/fixtures/gerar_fixture.py` (requer repo `Investimentos` sibling com `PYTHONPATH=.`).

Licença MIT.
