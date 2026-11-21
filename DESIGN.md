# Design

Este arquivo é um **retrato do app como ele está hoje** — tokens, convenções e
componentes lidos de `css/app.css`, `js/echarts-theme.js`, `js/transitions.js` e
`index.html`. Serve para que um ajuste pontual saia coerente com o que existe,
não para fixar gosto: qualquer fase pode mudar a identidade do app e reescrever
este retrato.

Vanilla CSS, mobile-first. Container: `max-width 520px` no Raio-X, `720px` nas
telas de detalhe. Sem framework, sem biblioteca de motion, sem fonte embarcada.

---

## Atmosfera

Calmo, denso, médico. Layout plano com hierarquia tipográfica clara, teal quente
sobre neutros quentes, sombras tintadas para o verde da marca, motion curto.
A densidade varia por contexto: o Raio-X é arejado; as telas de drilldown são
densas (tabelas com `tabular-nums`, KPIs em grid de 2 ou 3 colunas); os ensaios
— projeção, renda, diagnóstico — são coluna única, com números no meio da prosa.

---

## Cor

Teal como protagonista, neutros quentes como base, saturação contida. Texto base
`--ink: #1a1d1c`, fundo `--neutral-50: #fafaf7`.

### Escala da marca

| Token | Valor | Onde |
|---|---|---|
| `--g-900` | `#064e3b` | hero, links, h1 de telas de detalhe |
| `--g-800` | `#065f46` | cabeçalho de política |
| `--g-700` | `#047857` | botões ativos, chips, âncora do `--accent` |
| `--g-600` | `#059669` | foco de `row-link` |
| `--g-500` | `#10b981` | `--accent-2` |
| `--teal` | `#14b8a6` | realce do hero, foco de hero-link |

### Semânticos

`--amber #f59e0b` (atenção, drift positivo) · `--amber-700 #b45309` (atenção
**como texto**: o âmbar puro não fecha 4,5:1 sobre `--neutral-50`; este degrau
fecha) · `--amber-900 #8a5a00` (texto sobre superfície âmbar clara) ·
`--red #b91c1c` (perda, erro).

Ação: `--sem-up` (= `--cat-acoes-br`, "abaixo do alvo") e `--sem-down`
(= `--cat-fii`, "acima do alvo"), com tints `--sem-up-tint`/`--sem-down-tint` e
`--sem-down-texto #8f5b16` quando o ocre precisa ser texto. `--faixa-ok #4f6b5d`
é o "dentro da faixa", contido para não competir com os outros dois.

### Categorias de ativo — `var(--cat-*)` é a fonte única

| Categoria | Claro | Token |
|---|---|---|
| Ações BR | `#047857` | `--cat-acoes-br` |
| EUA | `#1e6091` | `--cat-eua` |
| FIIs | `#b8731f` | `--cat-fii` |
| Renda Fixa BR | `#0e7490` | `--cat-renda-fixa-br` |
| Cripto (ativo, não categoria) | `#6d4ea8` | `--cat-cripto` |

CSS lê `var(--cat-*)`; JS lê a mesma propriedade por `getComputedStyle`; o tema
do ECharts deriva o array `color` do mesmo lugar, via `readToken` em
`js/echarts-theme.js`. Por isso não há hex de categoria fora do `:root` — a cor
existe num lugar só e não pode divergir entre CSS, JS e gráfico.
`identidade-visual.spec.ts` compara os três e falha se divergirem.

A cor de categoria aparece em dot de 8–12px e nas séries de gráfico. **Texto não
é colorido por categoria** — a hierarquia tipográfica carrega o peso, e isso
mantém o contraste de leitura independente da paleta.

### Contraste e sinal — convenções de acessibilidade

- **Contraste AA.** `--ink` sobre `--neutral-50`/`--surface` fica ≥ 4,5:1 (texto
  normal); `--gray`, `--accent`, `--red`, `--amber` e os `--cat-*` sobre
  `--neutral-50` ficam ≥ 3:1 (texto grande, ícone, dot, série de gráfico). O
  helper `contraste()` de `tests/e2e/comite-comum.ts` calcula a razão pela
  fórmula de luminância relativa da WCAG, e oito specs o usam para travar a
  régua — entre elas `modo-plantao.spec.ts`, `nav-grupos.spec.ts`,
  `reserva.spec.ts` e as três do Comitê. Quando um token não fecha a razão como
  texto, a saída é um degrau escurecido dedicado (`--amber-700`,
  `--sem-down-texto`) ou um véu (`--etq-veu` + `--etq-texto`).
- **Sinal usa forma + texto + cor.** Ganho e perda levam glifo (▲/▼), o valor
  escrito e a cor; os selos de tese do dossiê e do Relatório levam ●/◐/▽ mais o
  grau por extenso e a cor; a vigília usa ▲/◇/· do mesmo modo. A cor é o
  terceiro sinal, nunca o único — é o que torna a tela legível em deuteranopia.
  `dossie.spec.ts` trava os selos, e a ponte da rentabilidade faz o mesmo com o
  "quem pesou".
- **Alvo de toque ≥ 44px** em todo interativo. A altura vem de `padding` e de
  `min-width`/`min-height`, não do `font-size` — por isso um facet-dot de 22×3px
  mora dentro de um `<button>` de 44×44px, e um link em `--num-2xs` ainda tem
  alvo cheio.
- **Foco visível unificado:** `:focus-visible { outline: 2px solid var(--accent);
  outline-offset: 2px; }`, uma regra para todos os controles.
- **Desenho acompanhado de equivalente textual.** Gráficos em SVG inline levam
  `role="img"` mais `aria-label` com os números; a cascata do diagnóstico é
  `aria-hidden` e tem uma `table` em `.sr-only` com as mesmas linhas; listas
  longas anunciam o resumo por `aria-live` numa linha `.sr-only`, não linha a
  linha.

### Superfícies e sombras

`--surface #ffffff` (cards, inputs) · `--surface-2 #f3f3ec` (grifo, pill) ·
`--neutral-100 #f5f5f0` (divisores, hover) · `--neutral-200 #e7e5de` (bordas de
card) · `--neutral-300 #d4d4d0` (reserva) · `--faint #989e97` (eyebrow, caption).

`--card-shadow: 0 1px 2px var(--g-900-04), 0 4px 16px var(--g-900-07)` — tintada
para `--g-900`, não preta. `--shadow-pressed` é a sombra do estado tocado.
Alphas nomeados: `--g-700-06`, `--g-700-12`, `--teal-14`, `--g-900-04`,
`--g-900-07`.

---

## Tipografia

Fontes do sistema, sem fonte embarcada: `-apple-system, "SF Pro Text",
"Segoe UI", system-ui, sans-serif`. Mono por stack também (`--mono`:
`ui-monospace, SF Mono, Cascadia Mono, JetBrains Mono, Menlo, Consolas`). A
hierarquia vem de escala, peso e letterspacing em caixa alta. Pesos em uso: 400,
500, 600, 700, 800.

Como o app não embarca fonte, a métrica muda por sistema operacional (Segoe no
Windows, DejaVu ou Selawik no Linux, SF no iPhone). Layout que depende de largura
de glifo precisa de folga; teste de forma que mede pixel pode passar local e
falhar no CI.

### Escala numérica `--num-*` — fonte única

Todo valor numérico (R$, %, contagem, ticker-pôster) referencia um destes sete
tokens. Mudar um tamanho é editar o token.

| Token | px | Onde |
|---|---|---|
| `--num-poster` | 40 | hero do patrimônio |
| `--num-xl` | 30 | ticker grande, manchete do Relatório |
| `--num-lg` | 20 | delta dos 7 dias, data do aporte |
| `--num-md` | 16 | KPI, métrica de rentabilidade, % de classe |
| `--num-sm` | 15 | valores de tabela, aporte, política |
| `--num-xs` | 13 | percentual de ticker, drift, anotação numérica |
| `--num-2xs` | 10 | anotação densa (DY por ativo, quantidade) |

Banda de pôster, com degraus mais finos: `--num-poster-lg` 46px (capa do
Relatório) e `--num-poster-xl` 54px (o DY da carteira).

**Marcador `fora-da-escala`.** Rótulos em caixa alta, inputs, badges, ícones e
glifos de unidade não são valores de display e ficam fora da escala. Na banda de
10px isso é verificado: toda declaração `font-size: 10px` ou `0.625rem` precisa
**ou** do token `--num-2xs`, **ou** de um marcador na mesma linha dizendo o
motivo —

```css
font-size: 10px;  /* fora-da-escala: rótulo uppercase */
```

— e `tests/e2e/escala-tokens-lint.spec.ts` falha sem um dos dois. O critério de
decisão é único: *o seletor renderiza um número formatado?* Se sim, token; se
não, marcador. A banda é estreita de propósito: 11px e 13px coincidem com
tamanhos de prosa e de controle sem relação com a escala numérica.

### Números

`font-variant-numeric: tabular-nums` em toda exibição de valor, rentabilidade,
data ou contagem — é o que alinha coluna. `--mono` marca número de destaque e de
identidade: o hero, os pôsteres, os valores dos cards do Raio-X, os selos e as
linhas da alocação, o ranking de DY, as datas da linha do tempo. Número em prosa
ou em tabela de leitura fica na fonte do texto, com `tabular-nums`.

**Dinheiro e percentual não são truncados nem reticenciados.** Valor em coluna
estreita leva `nowrap` mais `tabular-nums`, e o rótulo ao lado cede espaço.
Valor ausente rende `—` (com `aria-label` dizendo o quê), nunca `R$ 0,00`: zero
é um número e mentiria.

### Degraus de uso

Hero mono 800, `line-height 1.05`, tracking `-0.025em` · h1 da home 1.75rem 700 ·
breadcrumb 1.375rem 700 · corpo 1rem 400 · título de card em caixa alta 0.75rem
600 tracking `0.08em` · `.eyebrow` 11px 800 tracking `0.2em` em `--faint` (a voz
de abertura de tela) · rótulo de KPI 0.6875rem 400.

---

## Espaço, raio e grid

Escala de espaço, em rem: `0.25` (gap de linha) · `0.4–0.5` (padding de chip) ·
`0.55–0.75` (linha de alocação, espaço de seção) · `1` (gap entre cards) ·
`1.125–1.5` (padding interno de card e do `main`) · `2` (quebra de seção) ·
`3` (topo da tela de acesso).

Raio: `8` (interno de tabela) · `10–12` (botões, KPIs) · `14` (input e submit do
acesso, card de gráfico) · `18` (cards principais) · `22` (hero) · `999`
(chips, pills, dots, toast).

Grids em uso: KPI de 2 colunas (padrão), de 3 (proventos) e empilhado
(patrimônio); item de aporte `1.3rem 1fr auto`; linha de classe
`14px 1fr auto 16px`; benchmark `2.5rem 1fr`.

Mobile-first sem breakpoint: coluna única sempre, 320–375px como ponto de
partida, `max-width` centralizando em telas largas. 320px é a largura de
conferência.

---

## Motion

Motion serve função. Sem biblioteca, sem loop perpétuo, sem auto-play.

**Contrato de tokens:** `--ease cubic-bezier(.16,1,.3,1)` (curva base) ·
`--ease-spring cubic-bezier(.34,1.28,.44,1)` (overshoot sutil: dots do acesso,
indicator, facet-dots) · durações `--d1 .14s`, `--d2 .3s`, `--d3 .55s`.

**Contrato de navegação**, exposto em `window.drarthurNav.motion`
(`js/transitions.js`) e reconstruído quando `prefers-reduced-motion` muda:
cross-fade de tela 220ms · slide do indicator da tab 220ms · count-up do hero
700ms (uma vez por sessão) · push de entrada em tela de ativo ou dossiê 280ms.

**Animar `transform` e `opacity`.** São as duas propriedades que o compositor
resolve sem recalcular layout. Propriedade de layout — `top`, `left`, `right`,
`bottom`, `height`, `padding`, `margin` — provoca reflow a cada frame e trava o
scroll no celular; a largura da barra de preenchimento da alocação é a exceção
pontual (barra horizontal isolada, sem reflow em volta).
`tests/e2e/toque.spec.ts` lê o `transition-property` dos estados `:active` e
falha se aparecer uma propriedade de layout ali.

**`prefers-reduced-motion: reduce` zera o motion**, com dupla blindagem: a regra
CSS vive dentro de `@media (prefers-reduced-motion: no-preference)` e o JS checa
`window.drarthurNav.motion.reduced` antes de orquestrar. As transições que
sobram são ≤ 300ms.

**Animações em uso:** shake do acesso errado (420ms) · rotação de chevron no
accordion (150ms) · estados `:active` pressionados em todo interativo (escala
sutil mais `--shadow-pressed`, só `transform`/`box-shadow`;
`-webkit-tap-highlight-color: transparent` global) · preenchimento da trilha de
alocação (300ms) · fade do toast · a cerimônia de abertura (dissolve da tela de
acesso em 550ms, revelação da home em quatro grupos a 100/250/400/550ms, e um
ciclo único de "respiro" no delta do hero, que o próprio JS remove no
`animationend`). A abertura roda uma vez por sessão, com flag em
`sessionStorage`. `window.aberturaMotion` expõe esses tempos para os testes.

**Chegada escalonada de cards de tela** tem orçamento de ≤ 110ms por passo
(`.aporte-card`/`.plan-cat`); é um canal distinto do stagger de barras de
gráfico, que fica em 30ms para não atrasar a leitura do dado.

### Gráficos

ECharts com tema `drarthur` (`js/echarts-theme.js`), que lê todos os tokens do
`:root` por `getComputedStyle`. Entrada em 600ms `cubicOut` (linha desenhada da
esquerda para a direita; barras crescendo da base com 30ms de stagger) · hover
100ms · troca de modo 400ms · seleção de drilldown 200ms. As quatro zeram em
`reduced-motion`. Fonte única: `window.drarthurChart.motionConfig`.

Quatro tratamentos de leitura, com helpers em `js/app.js` e travados por
`dataviz-higiene.spec.ts`: símbolo só no último ponto (círculo vazado mais
rótulo, no lugar de um colar de contas ao longo da linha) · eixo Y ancorado nos
dados no gráfico de patrimônio, com folga de ~12% abaixo e ~14% acima e
linha-zero tracejada só quando o intervalo cruza zero · barra do período em curso
hachurada (`decal` diagonal mais nota abaixo), porque o bucket ainda acumula ·
scrubber de `dataZoom` reduzido a um trilho de 8px na cor da marca, sem a
miniatura dos dados e sem bolha de valor durante o arraste.

Tooltip é HTML custom (`drarthurChart.tooltipFormatterAxis`) sobre `--surface`
com borda `--neutral-200`, acompanhando o tema.

---

## Modo Plantão (tema escuro)

Tema escuro para uso real em plantão e madrugada: OLED quente, teal como luz.
Toggle manual e persistido, default claro. O bloco é aditivo — nada da versão
clara foi tocado.

- Botão `.theme-toggle` (☽/☀, glifo `aria-hidden`, `aria-label` descritivo e
  `aria-pressed`) na linha do eyebrow do cabeçalho de grupo, só na tela Hoje.
- `alternarTema()` inverte `this.tema`, grava `data-theme` no `<html>`, persiste
  em `localStorage` e chama `window.drarthurChart.reregister()`.
- O boot lê `localStorage.tema` e **não** consulta `prefers-color-scheme`: o tema
  é escolha explícita do usuário, e o sistema em escuro não muda o app sozinho.
  `_aplicarTema` também atualiza `<meta name="theme-color">` (`#064e3b` claro,
  `#03110a` escuro).
- Um boot que já nasce escuro precisa de `reregister()` dentro do `init()`: o
  tema do ECharts é registrado no `<head>`, antes de `data-theme` existir.

Valores do bloco `:root[data-theme="dark"]`: superfícies `--neutral-50 #040906`,
`--neutral-100 #0c1510`, `--neutral-200 #1c2b23`, `--neutral-300 #14211a`,
`--surface #0c1510`, `--surface-2 #101d16` · texto `--ink #f1efe4`,
`--gray #8fa598`, `--faint #5d7065` · acento `--accent #34d399`,
`--accent-2 #6ee7b7`, `--accent-soft rgba(52,211,153,.12)`,
`--hero-glow rgba(52,211,153,.2)` · semânticos `--red #f87171`,
`--amber #fbbf24`, `--amber-700 #fdba74` · categorias `--cat-eua #5aa7dc`,
`--cat-acoes-br #34d399`, `--cat-fii #e0a24a`, `--cat-cripto #b294e8`,
`--cat-renda-fixa-br #22d3ee`.

Tratamentos de "teal como luz": fio de luz no topo dos cards
(`inset 0 1px 0 var(--card-topline)`), brilho no indicator da tab, `text-shadow`
nos pôsteres, e sombras em preto onde a versão tintada ficaria invisível contra o
fundo quase preto. Componente cujo fundo clareia no escuro recebe tinta escura no
texto (`#04130c`) — branco sobre fundo claro não fecharia AA. O hero continua
escuro nos dois temas (`#03110a` direto).

`--sem-up`/`--sem-down` são `var()` de `--cat-*` e herdam o valor escuro na
cascata; só os tints literais em rgba precisam de override próprio.

**Detalhe de autoria:** um `*/` acidental dentro de um comentário CSS fecha o
comentário cedo e transforma o texto seguinte em CSS solto, corrompendo a
declaração de baixo — já custou um override de token que não se aplicava.

---

## Componentes

**Shell e navegação** — `.tab-bar` com os cinco grupos, texto sem ícone, peso 600
inativo e 700 ativo, indicator de 2px no **topo** da tab, fundo `--tab-bg`
translúcido, `--tab-bar-height 56px`, safe-area honrada ·
`.grupo-cab`/`.grupo-cab__linha`/`.faixa` — cabeçalho de grupo fixo com a faixa
de telas do grupo, a ativa em pílula opaca de raio 999px, rolagem horizontal sem
barra e sem quebra de linha, posicionada por `scrollLeft` · `.faixa-ativo` — a
mesma faixa nas três telas de um ativo, abaixo do `.breadcrumb` (o "←" e o
ticker em `.eyebrow--accent`) · `.eyebrow` — a voz de abertura de tela.

**Raio-X** — `.hero`, card sólido `var(--g-900)` com rótulo em caixa alta, valor
em `--num-poster` mono e delta em pill plana; quatro facetas cicláveis por toque,
`Enter`/`Space` ou facet-dot, com count-up uma vez por sessão · `.raiox-7d`, o
bloco "Últimos 7 dias", com decomposição de três linhas e as listas de compras,
vendas e proventos · `.r7d-movers`, as três maiores altas e baixas por impacto
em R$ na semana, com grifo · `.pede-atencao`, lista de bordas finas com o que
pede ação hoje (vigília, relatório novo, notas pendentes), sem card e sem
contagem animada · `.aporte-bloco`, o último aporte.

**Alocação e aporte** — `.aloca-cat`, accordion por categoria (dot, nome, R$ em
mono na cor da categoria, chevron, `aria-expanded`/`aria-controls`) ·
`.aloca-trilho`, barra de progresso com alvo e etiqueta · faixa de tolerância com
os três estados (abaixo, na faixa, acima) · `.aloca-grifo`, deep-link para o
aporte com preset · `.aporte-chips`/`.aporte-scrub`/`.aporte-input`, o simulador
vivo, com `<input type=range>` real (que traz `aria-valuenow` de graça) e o valor
em `--num-poster-lg` mono · `.aporte-grifo`, o plano em uma frase · seleção de
mercado.

**Retorno** — `.chip` XIRR/TWR · `.rent2-grande`, o número-veredito em
`--num-poster` mono com ▲/▼ e cor do sinal · a ponte da rentabilidade, com
`.grifo.ponte-pesou` listando quem somou e quem tirou dentro da linha tocada ·
`.prov-total` e a nota de barra parcial em proventos ·
`.poster`/`.dy-row`/`.dy-champs`, a tela de DY, com pôster de 54px e ranking por
ativo · `.kpi-scroll-fade`, a dica de que a faixa de KPIs rola.

**Ensaios** — `.diag-ensaio` e família (`.diag-frase`, `.diag-mono`,
`.diag-janela`, `.diag-grafico`, `.diag-conta`, `.diag-indice__*`) nos cinco
capítulos do diagnóstico, com réguas (`.sel-regua`, `.cons-regua`) e cascata
(`.pol-cascata`) · `.proj-ensaio` e família (`.proj-cap`, `.proj-faixas`,
`.proj-decomp`, `.proj-ponteiro`, `.proj-tabela`, `.proj-conta`) na projeção ·
`.renda-ensaio` e família (`.renda-tabela`, `.renda-grafico`, `.renda-origem`,
`.renda-pisos`) na renda da carteira. Os gráficos desses três são SVG inline com
`viewBox 0 0 100 100`, `preserveAspectRatio="none"` e traço
`vector-effect: non-scaling-stroke`.

**Relatório e dossiê** — `.rel-poster`/`.rel-veredito-linha`/`.rel-dot` na capa
editorial e no seletor de meses · `.rel-selo`, com glifo, texto e cor ·
`.grifo--amber` no box do que não funcionou · `.dossie-grifo` no "quebra se" da
tese · `.dossie-pede-revisao` quando a tese pede revisão ·
`section.dossie-vigilia`, entre a tese e a linha do tempo.

**Vigília e reserva** — `.tela-olho`, com cabeçalho de estado da rodada e os
graus em forma mais texto · a reserva de emergência, que fica **fora** do hero e
não é somada a número nenhum da carteira · o bloco de notas pendentes.

**Comuns** — `.card` (aninhamento de no máximo dois níveis) · `.grifo`
(`border-left: 3px solid var(--accent)`, raio `0 14px 14px 0`, fundo
`--surface-2`), um por tela, no ponto de maior tensão informativa, com a variante
`--amber` reservada ao Relatório para que os dois não leiam como o mesmo sinal ·
`.chip` · `.lado-B`/`.lado-S` · `.tabela-movimentos` e `.tabela-wrap` ·
`.classe-dot` · `.flag` (🇧🇷/🇺🇸, ícone funcional por ativo, não por categoria) ·
`.provento-tipo-tag` e `.provento-a-confirmar` · `.update-snackbar`, com
`role="status"` e ação "Recarregar" · `.toast` · `.pin-screen` com `.pin-input`
(campo único, `type=tel`, seis dígitos) · `.sr-only` ·
`[x-cloak] { display: none !important; }`, que evita o flash de conteúdo sem
estilo do Alpine.

---

## Tela de acesso

A frase de acesso decifra os payloads e vive só em memória, nunca em
`localStorage`. O aparelho guarda um envelope local cifrado com um PIN de seis
dígitos, e errar o PIN dá uma mensagem diferente de ter a frase errada — a
segunda não acusa o PIN, porque o PIN está certo e quem mudou foi a frase. As
iterações de PBKDF2 do envelope local são um parâmetro separado em
`js/crypto.js`, distinto do usado no payload.
