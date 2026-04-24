# investimentos-app

[![CI](https://github.com/arthurkingayres-ux/investimentos-app/actions/workflows/ci.yml/badge.svg)](https://github.com/arthurkingayres-ux/investimentos-app/actions/workflows/ci.yml)

PWA estático para visualização de carteira pessoal. Dados cifrados no client-side com PIN. Hospedado no GitHub Pages.

## Tests

Suite end-to-end em Playwright (Chromium, viewport Pixel 7 mobile). Cobre PIN flow, sessão 7d deslizante, toast de atualização e sincronização multi-tab. Offline/SW fica como smoke manual no dispositivo real.

```bash
npm install
npx playwright install chromium
npx playwright test
```

CI roda os mesmos testes + scanner PII a cada `push`/`pull_request` em `main` (veja `.github/workflows/ci.yml`).

PIN de teste: `123456` · fixture cifrada em `tests/fixtures/portfolio.test.json.enc` · gerador reprodutível em `tests/fixtures/gerar_fixture.py` (requer repo `Investimentos` sibling com `PYTHONPATH=.`).

Licença MIT.
