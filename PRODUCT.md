# Product

## Register

product

## Users

Um único usuário: investidor médico em formação cirúrgica, com responsabilidades clínicas longas e horários imprevisíveis. Acessa o app majoritariamente do celular, em janelas curtas (entre cirurgias, deslocamentos, plantões) ou em momentos de planejamento financeiro mais focado em casa. Investe em ativos mobiliários no Brasil e nos Estados Unidos desde 2019; a carteira representa 100% do patrimônio destinado à aposentadoria. O app não tem login multi-tenant, não tem público externo, e não compartilha tela — é um espaço pessoal de leitura e decisão.

A tarefa primária varia por momento:
- **Glance rápido (90% das aberturas):** "Como está minha carteira hoje? Algo crítico precisa de mim agora?" Resposta esperada em ≤5s, sem precisar tocar em nada além de abrir o app.
- **Análise dedicada (raio-X mensal/trimestral):** drilldown por classe (BR/EUA/FII/Cripto), por ticker, por janela de tempo (Origem/YTD/12m). Compara rentabilidade contra benchmarks, avalia drift de alocação, decide rebalanceamento.
- **Suporte a decisão de aporte:** ver onde está abaixo do alvo na política de alocação, quanto de cada ativo comprar/reduzir.
- **Suporte ao IRPF anual:** verificar custos médios e proventos consolidados por ano.

## Product Purpose

PWA mobile-first como projeção read-only da carteira de investimentos do usuário. O sistema autoritativo é um SQLite (`investimentos.db`) reconstruído a partir de documentos originais (notas de corretagem, extratos, eventos B3); o PWA exibe um snapshot cifrado desse SQLite (`portfolio.json.enc`), gerado pelo pipeline Python e publicado via GitHub Pages.

Sucesso = **confiança absoluta nos números** (todo dado rastreável ao documento-fonte) + **acesso instantâneo** (mobile, offline-first, PIN-gated) + **mínimo esforço de manutenção** (ingestão automatizada via Drive Inbox PWA + skills do Claude Code que orquestram o pipeline). Não é um aplicativo de trading, não é um broker, não é um agregador SaaS multi-conta — é o raio-X privado de uma carteira específica, otimizado para clareza de leitura sob restrição de tempo.

**Nav model: bottom tab bar fixa, 5 destinos top-level.** Indicator 2px no topo da tab ativa; safe-area iOS honored. Tab bar persiste em telas de push (`#ativo/:ticker`, `#/raiox/chart`); some apenas na PIN screen.

Tabs (top-level):
- **Raio-X** (`#`) — hero patrimônio Monument + bloco "Últimos 7 dias" (delta Δ + decomposição contábil Aportes/Proventos/Mercado + listas de compras/vendas/proventos da semana) + bloco "Último aporte". Glance airy de 3 blocos: estado (quanto), delta (o que mudou em 7d), evento (última compra). Sem charts no home — sparkline/chips removidos no raio-x enxuto (7a.I pós-fechamento); chart histórico full vive em `#/raiox/chart` (push).
- **Rentabilidade** (`#rentabilidade`) — XIRR/TWR vs benchmarks por janela (Origem · 12m · YTD) com toggle BRL/USD para grupo EUA. 3 grupos (Brasil · EUA · Cripto). O gráfico histórico do escopo **Total** compara o portfólio contra CDI, IBOV e S&P 500 simultaneamente (4 linhas, toggle nativo da legenda); **Brasil** plota Portfólio + CDI + IBOV (3 linhas); EUA plota 1 linha (S&P 500). O card "Período" (reflete janela do dataZoom) exibe benchmarks por escopo: Total vs CDI / IBOV / S&P 500 (3 linhas de comparação); Brasil vs CDI / IBOV (2 linhas); EUA vs S&P 500 (1 linha).
- **Alocação** (`#alocacao`) — **vista única** (7a.E.31): uma lista de cards de categoria colapsáveis que consolida política alvo + estado atual, sem o antigo segmented Atual/Alvo. Cabeçalho `.breadcrumb` padrão (só o título "Alocação", igual às demais telas — sem repetir patrimônio total nem nº de categorias). Cada card tem um **header-resumo sempre visível** (dot da categoria · nome · R$ da categoria · barra com marcador no alvo · `atual X% / alvo Y%` · drift pp colorido) e um corpo colapsável que abre ao tocar. **Todas as categorias começam fechadas**; estado não-persistente (reseta no reload), preservado ao trocar de aba; ordem por **alvo decrescente**. O corpo expandido mostra as duas **cestas** da política híbrida v3: `Cesta passiva` (ETFs broad-index com peso fixo, ex.: BOVA11 60 % + SMAL11 40 % em Ações BR) + `Cesta de picks` (seleção individual equal-weight). Cada ativo tem R$ de mercado + mini-bar `atual / alvo intra` + delta pill mono direcional (`↑ −5,98 pp` = precisa aportar; `↓ +4,30 pp` = acima do alvo). **Held off-policy** (posição fora do YAML, ex.: LREN3, HASH11) aparece misturado na cesta da categoria com selo "fora do alvo" + "a zerar · sem alvo" (sem alvo, sem mini-bar/delta). Backend mantém `bucket.tipo: "passive" | "picks"` em `config/alocacao.yaml` (`schema_version: 3`) e carrega `valor_brl` + `fora_do_alvo` no JSON (schema v2.20); o rebrand "Cesta passiva" / "Cesta de picks" é só de apresentação.
- **Proventos** (`#proventos`) — toggle Mensal / Anual + chart ECharts + drilldown mês × ativo.
- **Aportar** (`#aportar`) — executor de política: valor → cotas (cap-5 picks, zero sobra).

Push (não-tab, mantém tab bar):
- `#/raiox/chart` — patrimônio full-screen (curva de equity + decomposição aporte × retorno). Acessado via tap na sparkline / hero do Raio-X.
- `#ativo/:ticker` — drilldown por ativo (KPIs, movimentos, proventos, posição). Acessado de qualquer lista (Alocação, Proventos, Aportar).

Legacy shims (rotas antigas redirecionam, `history.replaceState`): `#patrimonio` → `#/raiox/chart`; `#politica` → `#alocacao`.

## Brand Personality

**Calmo, denso, médico.** Em três palavras: *clinical, terse, trustworthy*.

Voz e tom: técnica, em português, sem hype, sem "celebrar" números. Apresenta fato com precisão decimal e contexto suficiente — não enfeita ganhos nem suaviza perdas. Tipografia respira em headers; corpo é compacto onde a densidade serve à leitura rápida (tabelas de movimentos, listas de proventos). A sensação alvo é a de abrir um prontuário médico bem mantido: tudo onde se espera, ninguém te empurrando atenção pra lugar nenhum.

Emoção que o app deve evocar:
- **Confiança serena** — não euforia em alta, não pânico em queda. Os números falam por si.
- **Foco** — uma intenção por tela; nada compete pela atenção do usuário no momento errado.
- **Reverência aos dados** — todo número é rastreável; o app trata o histórico financeiro como artefato sério.

Emoções que o app deve EVITAR:
- Gamificação (badges, streaks, "parabéns por consultar a carteira hoje!")
- Animação celebratória (confetti, glow, push pra checagem compulsiva)
- Ansiedade visual (vermelho gritante em ticker que caiu 0.5%)
- Persuasão a ação (CTAs sugerindo compra/venda; o app NÃO opera ordens)

## Anti-references

**Robinhood / Avenue / XP app (consumer-trading).** Tom celebratório, gamificado, com push pra ação. O app é o oposto — read-only, sem celebração, sem nudge de comportamento.

**Bloomberg Terminal / TradingView (cockpit denso multi-monitor).** Densidade extrema otimizada pra trader profissional em desktop. O app vai pelo caminho oposto: mobile-first, máximo 3-4 KPIs por viewport, hierarquia clara em telas pequenas.

**Notion / Linear (productivity dashboard).** Referência válida para minimalismo tipográfico, mas missão diferente — Notion/Linear servem produtividade colaborativa multi-usuário; o app serve uma única pessoa olhando o próprio patrimônio.

**Aesthetic AI-genérico.** Sem purple/blue glow gradient, sem neon, sem dark "cool tech", sem hero-metric template (big number + label + supporting stats + gradient accent), sem 3-card grid horizontal genérico, sem glassmorphism decorativo, sem text-fill gradient em headers. Tudo isso é signature de "AI fez isso" e contradiz a estética calma/médica.

**SaaS B2B landing.** Não tem hero "Elevate your portfolio with AI-powered insights", não tem "Trusted by 10,000+ investors", não tem "Get started in 30 seconds". O app não vende, não converte, não onboards.

## Design Principles

1. **Confiança nos números acima de tudo.** Cada dado exibido tem origem rastreável (documento, evento, cálculo determinístico). Nunca arredondar pra "ficar bonito"; nunca esconder número porque ele é desconfortável. Decimal vale mais que estética.

2. **Calma sob qualquer condição de mercado.** O design não muda de tom entre alta e queda. Vermelho informa perda; não grita. Verde informa ganho; não celebra. A neutralidade é proposital — o usuário precisa pensar com clareza, não reagir.

3. **Densidade calibrada por momento de uso.** Glance (Raio-X home) é airy, ≤5 elementos visíveis. Análise (#rentabilidade, #ativo) é denso, otimizado pra escanear muitos números. Nunca densidade homogênea — densidade é resposta ao job-to-be-done.

4. **Mobile-first, gesture-second.** Tudo precisa caber em 320-375px de largura. Toques são generosos (≥44px de hit area). Hash routing serve histórico do navegador; sem swipe gestures customizados que confundem com scroll vertical.

5. **PWA como projeção, não fonte.** O app NUNCA escreve no SQLite. Se um dado parece errado no PWA, a correção é no pipeline backend, não no JSON exibido. Essa restrição protege a integridade da fonte de verdade.

6. **Cor e bandeira codificam taxonomias ortogonais.** Cor = categoria contábil (Ações BR / EUA / FIIs / Cripto), aparece em dots e séries de gráfico. Bandeira = país de listagem do ativo (BR / EUA), aparece em toda linha de ativo individual. As duas convivem porque respondem perguntas diferentes ("a que classe isso pertence?" vs "onde isso é negociado?") — não substituem uma à outra.

## Accessibility & Inclusion

- **Toques de 44px+** em todos os elementos interativos.
- **Contraste WCAG AA** mínimo em texto sobre fundo. Os tokens semânticos (verde/amarelo/vermelho para ganho/atenção/perda) precisam funcionar em deuteranopia (a forma mais comum de daltonismo) — usar **forma + texto + cor**, nunca cor sozinha. Ex.: perda mostra valor negativo + cor vermelha; nunca apenas a cor sinaliza o sinal.
- **Tamanho de texto base 16px**; usuário pode aumentar via zoom do sistema sem quebrar layout.
- **Reduced motion respected:** PIN shake e toast fade respeitam `prefers-reduced-motion: reduce`.
- **Leitura em luz forte (consultórios, ambulâncias, sol):** evitar paletas de baixo contraste; testar legibilidade em tela com brightness 100%.
- **PIN como única auth:** 6 dígitos numéricos, sem dependência de biometria (que pode falhar com luvas cirúrgicas). Sessão de 7 dias por padrão.
