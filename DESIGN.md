# Design

> Sistema de design extraído de `css/app.css` (vanilla CSS, ~1500 linhas, mobile-first, max-width 520px raio-x / 720px telas detalhe). Formato baseado em Google Stitch DESIGN.md. Source of truth de tokens e componentes do PWA.

---

## Visual atmosphere

**Calmo, denso, médico.** Layout flat com hierarquia tipográfica clara, paleta teal-quente sobre warm-neutral (não cool gray, não pure white), sombras suavemente tintadas para a cor do brand, motion mínimo (pin shake + chevron rotation + estados `:active` pressionados de toque, 7a.S.2). Densidade calibrada por contexto: raio-X home é airy (cards generosos, ≤5 elementos por viewport); telas de drilldown (#ativo, #proventos) são densas (tabelas com tabular-nums, KPIs em grid 2-col ou 3-col).

Variance baseline: **6.5/10** (assimetria pontual + tipografia Monument no hero + tab bar como elemento de identidade). Motion: **4.5/10** (cross-fade tabs + indicator slide + count-up hero + push slides; tudo gated por `prefers-reduced-motion`, sem GSAP/Framer). Density: **4/10 → 7/10** (varia por tela).

---

## Color palette

Teal-quente como protagonista, neutros warm como base. Saturação contida (<60%). Pure black banido (`--ink: #1a1d1c`). Pure white banido em superfícies grandes (`--neutral-50: #fafaf7`).

### Brand teal (gradient escala-9)
- `--g-900: #064e3b` — Primary teal escuro. Hero gradient anchor, links, h1 em telas detalhe.
- `--g-800: #065f46` — Primary teal médio-escuro. Política header text.
- `--g-700: #047857` — Primary teal médio. Botões active, chip-xirr, ticker-vm, drift-neg.
- `--g-600: #059669` — Primary teal médio-claro. Outline focus em row-link.
- `--g-500: #10b981` — Primary teal claro. Outline focus btn-bloquear, gradient end aporte-pill.
- `--g-400: #34d399` — Primary teal acento. Reservado.

### Accent
- `--teal: #14b8a6` — Accent teal puro. Usado em hero radial highlight e outline focus de hero-link/política.

### Semantic
- `--amber: #f59e0b` — Warning. Drift positivo. (Não é mais a cor de FII desde 7a.E.20.)
- `--amber-light: #fbbf24` — Reserva (não em uso atual).
- `--red: #b91c1c` — Danger / perda. PIN error, chip.is-neg, lado-S, kpi-valor.is-neg, drift-neg.

### Identidade — Paleta oficial de categorias (7a.E.20)

Cada categoria de ativo tem um token semântico em `:root` que é a **fonte única**. CSS, JS e o tema ECharts derivam dali (via `var(--cat-*)` no CSS e `getComputedStyle` no JS) — drift impossível por construção.

| Categoria | Hex | Token semântico |
|---|---|---|
| Ações BR | `#047857` | `--cat-acoes-br` |
| EUA | `#1e6091` | `--cat-eua` |
| FIIs | `#b8731f` | `--cat-fii` |
| Cripto | `#6d4ea8` | `--cat-cripto` |

Regras:
- Hex hardcoded fora de `:root` para essas 4 cores é proibido. Sempre `var(--cat-*)` em CSS ou `getComputedStyle(...).getPropertyValue('--cat-*')` em JS.
- Tema ECharts `drarthur` deriva o array `color` via helper `readToken` (`js/echarts-theme.js`). Slots 0-3 são as 4 categorias na ordem [Ações BR, EUA, FII, Cripto]; slots 4+ são tokens secundários.
- Intensidade: cor aparece em **dot 8-12px** (`.classe-dot.dot-*`) e nas séries de gráfico do PWA. **Texto nunca é colorido por categoria** — hierarquia tipográfica carrega o peso.
- **Theme-aware (7a.S.12):** cada `--cat-*` ganha um 2º valor sob `:root[data-theme="dark"]`, mais claro/saturado que o light (ex.: Ações BR `#047857` claro → `#34d399` dark) — legível como dot/série contra o fundo quase-preto. Ver "Modo Plantão" abaixo.

### Bandeira de origem (7a.E.20)

- Forma: emoji nativo `🇧🇷` / `🇺🇸`, classe global `.flag` (17px default, com overrides contextuais para hero/raio-x).
- Posição: primeiro elemento da row de ativo (`.flag` antes do ticker).
- Origem: campo `bandeira` no JSON, derivado de `moeda` no pipeline via `src/common/bandeira.py::bandeira_de_moeda` (schema v2.12 propaga em 5 shapes; v2.15 muda o caminho de política para `politica.categorias[].buckets[].ativos`).
- Quando aparece: toda linha de ativo individual no PWA (#alocacao, #politica, #proventos drilldown, #aportar, #rentabilidade card hero, card "último aporte", #ativo/:ticker header).
- Quando não aparece: headers de **categoria** (Ações BR / EUA / FIIs / Cripto) — bandeira é por ativo, não por categoria. Total agregado (`🌍 Total`) usa emoji distinto e fica preservado.

### Neutrals (warm-tinted)
- `--ink: #1a1d1c` — Primary text. Levemente tintado pra warm (não pure black).
- `--gray: #5b605a` — Secondary text. Greenish-neutral pra harmonizar com teal (escurecido em 7a.G.2 Pass 1 para WCAG AA contrast).
- `--neutral-50: #fafaf7` — Background body. Off-white quente, não pure white.
- `--neutral-100: #f5f5f0` — Subtle dividers, hover states em política.
- `--neutral-200: #e7e5de` — Card borders, separadores principais.
- `--neutral-300: #d4d4d0` — Reserva (não em uso atual, exceto via transparency).

### Shadows (tintadas)
- `--card-shadow: 0 1px 2px rgba(6, 78, 59, 0.04), 0 4px 16px rgba(6, 78, 59, 0.07)` — Sombra padrão de cards. Tintada para `--g-900` (não preto cru).
- Hero shadow: same as `--card-shadow` (pós-7a.G.2 distill — hero não tem mais sombra densa própria).
- ~~Aporte-pill shadow: `0 2px 8px rgba(4, 120, 87, 0.25)`~~ — Removido em 7a.G.2 Pass 7 (quieter, sem shadow no aporte-pill).
- Toast shadow: `0 6px 24px rgba(6, 78, 59, 0.18)` — Tintada para `--g-900`.

**Color strategy:** Restrained → Committed pontual. Neutros + 1 hue dominante (teal) carregam ~90% da superfície. Amber e red entram como semantic accent (≤10% do uso). Nunca mais de uma família de gray (warm-tinted, jamais cool gray).

**Modo Plantão (dark OLED, 7a.S.12):** todo token acima que varia por tema (neutrals, ink/gray/faint, accent/accent-2, semânticos, `--cat-*`) ganha um valor dark sob `:root[data-theme="dark"]`. Ver seção dedicada "Modo Plantão" mais abaixo para o inventário completo, o mecanismo de toggle/persistência e o repaint dos gráficos ECharts.

---

## Typography

Sistema operacional fonts, sem custom font (zero JS overhead, zero FOIT). Hierarquia através de **scale + weight + uppercase letterspacing**, não através de famílias diferentes.

### Font stack
```css
font-family: -apple-system, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
```

Renderização nativa por OS:
- iOS / iPadOS / macOS: SF Pro
- Windows: Segoe UI
- Android (PWA installed): Roboto (via system-ui)
- Linux: variável

### Mono (números)
**Tabular-nums universal.** Toda exibição de valor monetário, rentabilidade, data ou contagem usa `font-variant-numeric: tabular-nums` para alinhamento vertical em colunas. Nenhuma fonte mono separada (exceto `code` em footer, que usa `ui-monospace, "SF Mono", Menlo`).

### Scale (rem-based, base 16px)

**Escala numérica `--num-*` (7a.E.27 — FONTE ÚNICA).** Todo valor numérico
(R$, %, contagem, ticker-poster) referencia um destes 7 tokens em `:root`;
mudar um tamanho = editar o token, nunca um `font-size` inline. Rótulos/
eyebrows uppercase têm tratamento próprio (ver Hierarchy rules) e ficam fora.

| Token | px | Onde (exemplos) |
|---|---|---|
| `--num-poster` | 40px (2.5rem) | hero patrimônio (`.hero-valor` mono) |
| `--num-xl` | 30px (1.875rem) | `.ticker-vm-grande`, `.rel-secao--manchete .rel-secao__titulo` |
| `--num-lg` | 20px (1.25rem) | `.r7d-delta`, `.aporte-data` |
| `--num-md` | 16px (1rem) | `.kpi-valor`, `.rent-metrica/periodo-valor` |
| `--num-sm` | 15px (0.9375rem) | `.aloca-cat__rs-valor`, `.aporte-valor`, `.tabela-* td.num` |
| `--num-xs` | 13px (0.8125rem) | `.aloca-alvo__delta/cnum`, `.aloca-alvo__valor-ativo`, benchmark rows |
| `--num-2xs` | 10px (0.625rem) | `.aloca-alvo__dy`, `.aloca-alvo__ativo-sub`, `.aporte-compra-qty-sub` |

**Banda "monument display" (7a.S.1)** — posters de herói, degraus finos (razões <1.25), distinta da escada de dados acima:

| Token | px | Onde (exemplos) |
|---|---|---|
| `--num-poster-lg` | 46px (2.875rem) | `.rel-poster` — capa editorial do Relatório (7a.S.9, 1º consumidor real do token) |
| `--num-poster-xl` | 54px (3.375rem) | `.poster` — DY da carteira em `#s-dy` (7a.S.7b, 1º consumidor real do token) |

Razões da escada de display (dados): poster/xl 1.33 · xl/lg 1.5 · lg/md 1.25 (todos ≥1.25).

**Fora da escala (decisão consciente):** glifos de unidade que decoram um número
poster são proporção tipográfica deliberada, não valores de display, e ficam hardcoded.
Idem rótulos/eyebrows uppercase, inputs, badges/pills, ícones e chrome em `px`.

Na banda de 10px essa política deixa de ser prosa e vira regra executável: toda
declaração `font-size: 0.625rem` ou `font-size: 10px` precisa **ou** do token
`--num-2xs`, **ou** de um marcador inline declarando o motivo, na mesma linha:

```css
font-size: 10px;  /* fora-da-escala: rótulo uppercase */
```

Verificado por `tests/e2e/escala-tokens-lint.spec.ts`. O critério de decisão é
único: *o seletor renderiza um número formatado?* (olhe o `x-text` no
`index.html`; `tnum`/`tabular-nums` corrobora). Se sim, token. Se não, marcador.

A banda é estreita de propósito. 11px e 13px coincidem com tamanhos de prosa,
chips e controles que não têm relação nenhuma com a escala numérica — ligá-los
a `var(--num-xs)` faria a bandeira do Brasil em `.champ .flag` mudar de tamanho
no dia em que o `--num-xs` mudasse. Um lint que grita em falso vinte vezes
ensina todo mundo a calá-lo.

| Token de uso | Tamanho | Weight | Line-height | Letter-spacing | Onde |
|---|---|---|---|---|---|
| Hero valor | `--num-poster` 2.5rem (40px) mono | 800 | 1.05 | -0.025em | `.hero-valor` (2ª decl mono, raio-x enxuto pós-7a.I) |
| Poster DY (`#s-dy`) | `--num-poster-xl` 3.375rem (54px) mono | 800 | 1 | -0.035em | `.poster` (7a.S.7b) |
| Ticker hero VM | `--num-xl` 1.875rem (30px) mono | 800 | — | -0.025em | `.ticker-vm-grande` (7a.E.27: era 3rem drift de decl duplicada; consolidado) |
| R$ categoria (#alocacao) | `--num-sm` 0.9375rem (15px) | 700 | — | — | `.aloca-cat__rs-valor` (cor `--cat`; guarda overflow 7 díg a 320px) |
| Ticker hero h2 | 1.5rem (24px) | 700 | — | — | `.ticker-hero h2` |
| Breadcrumb h1 | 1.375rem (22px) | 700 | — | — | `.breadcrumb h1` |
| H1 home | 1.75rem (28px) | 700 | — | — | `h1` |
| Aporte data | 1.125rem (18px) | 700 | — | -0.01em | `.aporte-data` |
| Rent grupo título | 1.05rem (~17px) | 600 | — | 0.01em | `.rent-grupo-titulo` |
| Rent linha inline | 0.9375rem (15px) | 400-700 | — | — | `.rent-linha-inline` |
| Body padrão | 1rem (16px) | 400 | — | — | default |
| Card título (uppercase) | 0.75rem (12px) | 600 | — | 0.08em | `.card-titulo`, `.hero-label` |
| Tabela movimentos | 0.92rem (~15px) | 400 | — | — | `.tabela-movimentos` |
| KPI label (uppercase) | 0.6875rem (11px) | 400 | — | 0.4px | `.kpi-label` |
| KPI valor | 1rem (16px) | 600 | — | — | `.kpi-valor` |
| Política ticker/nota | 0.9375rem (15px) | 600 | — | — | `.politica-ticker`, `.politica-nota` |
| Política sub | 0.75rem (12px) | 400 | — | — | `.politica-categoria-sub` |

### Hierarchy rules
1. **Display headers** (1.75rem+): tight tracking (-0.01em a -0.5px), weight 700-800.
2. **Section labels** (0.75rem-0.8125rem): uppercase + letter-spacing 0.08em + weight 600 + cor `--gray`.
3. **Body** (0.875rem-1rem): weight 400-500, cor `--ink`, line-height padrão do browser.
4. **Numbers**: SEMPRE `font-variant-numeric: tabular-nums`, weight 600-800 conforme densidade.

### Anti-patterns
- ❌ Não usar Inter, Roboto Flex, Geist, Satoshi, ou qualquer custom font.
- ❌ Não usar gradiente em texto. (Pré-7a.S.7b havia uma exceção única, `.proventos-ytd` — removida na reforma do topo de #proventos; sem exceções vigentes.)
- ❌ Não usar serif em qualquer lugar.
- ❌ Não usar mais de 3 weights no mesmo viewport (400, 600, 700/800 são as únicas combinações em uso).

---

## Spacing & layout

### Container scale
- **Raio-X home (`main`):** `max-width: 520px; padding: 1.5rem; margin: 0 auto;` — mobile-first, mas centraliza em telas largas.
- **Telas detalhe (`.tela-detalhes`):** `max-width: 720px; padding: 16px 20px 80px;` — mais espaço para tabelas e KPI grids.
- **Tela política (`.tela-politica`):** `padding: 0 16px 32px;` — full-width controlado por viewport.

### Spacing scale (rem-based)
- `0.1rem` (1.6px) — micro-gap em rent-suffix
- `0.25rem` (4px) — text-row gap, padding mínimo
- `0.4rem-0.5rem` (6.4-8px) — chip padding interno, gap entre elementos relacionados
- `0.55rem-0.75rem` (~9-12px) — alocação line padding, section spacing
- `1rem` (16px) — gap padrão entre cards
- `1.125rem-1.5rem` (18-24px) — padding interno de cards e main
- `2rem` (32px) — section break vertical
- `3rem` (48px) — top padding pin-screen

### Border radius
- `8px` — small, tabela-wrap interno
- `10-12px` — buttons, KPIs, política cards
- `14px` — pin input/submit, chart-rent
- `18px` — cards principais (raio-x), alocação cards, ticker-hero
- `22px` — hero
- `999px` — chips, pills, dots, toast (full pill)

### Grid systems
- **KPI 2-col:** `grid-template-columns: repeat(2, 1fr); gap: 10px;` — padrão.
- **KPI 3-col:** override `.kpi-grid-3` para tela proventos.
- **KPI stack 1-col:** override `.kpi-stack` para #patrimonio (com descrição abaixo).
- **Aporte item:** `grid-template-columns: 1.3rem 1fr auto; gap: 0.6rem;` — bandeira + ticker + valor.
- **Classe row:** `grid-template-columns: 14px 1fr auto 16px;` — dot + nome + pct + arrow.
- **Política header:** grid 2-row 3-col com chevron span vertical.
- **Rent benchmark:** `grid-template-columns: 2.5rem 1fr;`.

### Mobile-first
Todos os layouts assumem 320-375px de largura como ponto de partida. NÃO há breakpoint `md:` ou `lg:` — single-column sempre, com max-widths que centralizam em desktop. Touch targets ≥44px (botões PIN, btn-bloquear, ticker-row).

---

## Components

### Hero (raio-x)
Card sólido `var(--g-900)` (teal escuro), sombra padrão de cards, sem gradient radial/linear. Conteúdo: label uppercase 0.6875rem, valor 2rem peso 700 com tabular-nums, delta-pill flat com tint `rgba(255,255,255,0.12)` (sem `backdrop-filter`), updated label 0.75rem opacity 0.6.

```css
.hero {
  background: var(--g-900);
  border-radius: 18px;
  padding: 1.25rem 1.125rem 1.5rem;
  color: #fff;
  box-shadow: var(--card-shadow);
}
```

Distill 7a.G.2 removeu o `radial-gradient + linear-gradient + ::after`, reduziu `.hero-valor` de 2.625rem peso 800 → 2rem peso 700, e tornou `.hero-delta` flat (sem glassmorphism). DESIGN.md ↔ implementação reconciliados (sem mais "hero metric template" banido).

### Hero Monument (raio-x, 7a.I.2 · reconciliado em 7a.E.27)

Variant tipográfica do hero dentro do shell de tab bar. Card sólido `--g-900` flat (sem gradient/glassmorphism — anti-pattern #8 vigente); a diferença vs hero padrão é só fonte mono + escala + tracking. Escolha de identidade ("Monument"), não decoração.

Implementação real: **não** existe `.hero-valor-monument` nem `--hero-mono-size` (eram drift de doc — removidos aqui). O hero é a 2ª declaração de `.hero-valor`, que sobrescreve a base sans com a variante mono:

```css
.hero-valor {                  /* 2ª decl — Monument */
  font-family: var(--mono);    /* ui-monospace stack — não custom font */
  font-size: var(--num-poster); /* 2.5rem (40px) — 7a.E.27 */
  font-weight: 800;
  letter-spacing: -0.025em;
  line-height: 1.05;
}
```

Hero size = `--num-poster` (2.5rem), calibrada no raio-x enxuto pós-7a.I (cabe em 1-viewport sem sparkline/chips/CTA, removidos no enxuto). **7a.S.5 nota:** o hero-valor de TODAS as 4 facetas (ver seção seguinte) mantém `--num-poster` — o mockup de referência usa 38px (≈ o mesmo degrau), não o degrau maior `--num-poster-lg` (46px) cogitado como possibilidade em S.1; corrigido aqui pra refletir a implementação real.

### Hero de facetas (raio-x, 7a.S.5)

O hero deixou de ser um `<a>` com uma única leitura (patrimônio) e um único destino (clique → `#/raiox/chart`). Virou um **card de facetas**: `<div role="button" tabindex="0">` que cicla **4 fatos read-only**, todos derivados do `portfolio.json` já existente — nenhum campo novo de backend:

1. **Patrimônio total** (`patrimonio.total_brl`) — faceta inicial, com o count-up 1×/sessão preservado.
2. **Divisão Brasil · EUA** (`patrimonio.br_brl` / `patrimonio.eua_brl`, campos diretos, não derivados) — split visual: 2 colunas (bandeira + R$ + % do total) + barra proporcional 2 cores.
3. **Variação · 7 dias** (`patrimonio.variacao_semanal_brl`/`_pct`) — mesma métrica do antigo `.hero-delta`, agora com sua própria leitura em destaque (número grande + subtítulo).
4. **Desde a origem** (`rentabilidade.Total.xirr_origem`, fallback `twr_origem` se o XIRR for `null`) — retorno anualizado acumulado desde o início da carteira.

**Interação:** tap em qualquer ponto do card, `Enter`/`Space` com o card focado, ou tocar num facet-dot pulam pra faceta correspondente. `@click.stop`/`@keydown.stop` nos facet-dots impedem que o toque neles borbulhe pro `@click` do card (senão o dot avançaria a faceta duas vezes). O `aria-label` do card ("Patrimônio — toque para alternar a leitura") mais o `aria-live="polite"` em `#hero-body` tornam a troca anunciável a leitores de tela sem precisar reimplementar o padrão ARIA "tabs" completo (decisão deliberada: os dots são `<button>` nativos com `aria-current`/`aria-label` próprios, não `role="tab"` — esse role exigiria roving-tabindex + navegação por seta que não foi implementada, e um ARIA incompleto é pior que nenhum).

**Facet-dots:** 4 traços de 22×3px (`::before` decorativo), mas o `<button>` que os contém tem hit-area 44×44px (`min-width`/`min-height`, ver a11y de toque) — o traço pequeno preserva a estética discreta do mockup sem violar touch target.

**Transição em duas camadas** (mockup, valores extraídos): o eyebrow (`#hero-eyebrow`) esmaece (`opacity: 0`) por 150ms antes de trocar o texto; o corpo (`#hero-body`) troca via `.hero-face` — a face que sai ganha `.out` (`translateY(-10px)`, opacity 0, removida do DOM 320ms depois) enquanto a que entra começa em `translateY(10px)`/opacity 0 e anima pra `translateY(0)`/opacity 1 em `--d2` `--ease` (double-`requestAnimationFrame` força o navegador a computar o estado inicial antes de aplicar `.on`, senão a transição não dispara). Facet-dots usam `--ease-spring` só no `scaleX` do traço ativo. `prefers-reduced-motion: reduce` (via `window.drarthurNav.motion.reduced`, mesma fonte de verdade do resto do app shell) pula toda a coreografia — troca instantânea, sem RAF nem `setTimeout`.

**Implementação: DOM imperativo, não `x-show`/`x-if`.** `_renderHeroFace(idx, opts)` cria/remove `.hero-face` diretamente via `document.createElement`/`innerHTML`, no mesmo racional de `ativarCountUpHero` (7a.I.6): a transição de duas camadas com remoção atrasada não mapeia bem pra `x-if` do Alpine sem arriscar nós duplicados em modo estrito de teste, e reatividade do Alpine no meio de uma animação RAF reverteria frames intermediários. `heroFacetAtivo` (estado Alpine) permanece single-source pros facet-dots (`x-for` reativo) — só o CONTEÚDO da faceta é imperativo, não o indicador de qual está ativa.

**Count-up preservado, nunca re-disparado.** `ativarCountUpHero(el)` (assinatura estendida em 7a.S.5 pra aceitar um elemento explícito) é chamada toda vez que a faceta "Patrimônio total" é renderizada — inclusive ao voltar pra ela depois de ciclar. Ela mesma decide animar-ou-não via `sessionStorage.heroCountUpDone`: setado uma única vez, na 1ª renderização da sessão; toda visita subsequente (recarregar a página OU ciclar de volta pra faceta 0) cai no branch instantâneo (`el.textContent = formatBrl(...)`, sem RAF). **Gotcha descoberto pelo próprio teste TDD:** o nó antigo de `#hero-patrimonio` fica 320ms no DOM (transição de saída) enquanto um nó novo com o MESMO id é criado pra faceta seguinte — se o usuário ciclasse de volta pra faceta 0 dentro dessa janela, `getElementById` resolvia pro nó errado (o que está saindo, ainda alvo do RAF do 1º count-up em voo), revertendo o texto pro valor parcial. Corrigido de duas formas: (1) o id é removido do nó que está saindo no instante em que ele vira `.out`; (2) `ativarCountUpHero` recebe o elemento explícito (escopado ao nó que `_renderHeroFace` acabou de criar), nunca dependendo de uma busca global ambígua.

**Hint "☞ toque no número"** aparece 1×/sessão (`sessionStorage.heroFacetHintSeen`, mesmo padrão de `heroCountUpDone`) e some no 1º toque (`.hero-hint.gone`, opacity 0). `aria-hidden` (é reforço visual, não informação essencial — o `aria-label` do card já comunica a interação a quem usa leitor de tela).

**Acesso ao histórico completo preservado.** O hero era a ÚNICA entrada pra `#/raiox/chart` (7a.I.5); virando facet-cycling, um affordance discreto e explícito assume esse papel — `.hero-chart-link`, um `<a>` de verdade (não um `<div>` fake), abaixo do card, com texto "Ver histórico" + chevron `›`, `aria-label`, e hit-area ≥44px (`min-height`). `raiox-chart-push.spec.ts`/`raiox.spec.ts` migraram pra clicar esse link; um teste de regressão explícito ("tap no hero NÃO navega") documenta a mudança de comportamento como intencional.

```css
.hero { cursor: pointer; overflow: hidden; }      /* card vira controle interativo */
.hero::before { background: radial-gradient(90% 70% at 78% 4%, var(--hero-glow), transparent 62%); }
.hero:active { transform: scale(.985); box-shadow: var(--shadow-pressed); }  /* migrado de .hero-link */
.hero-face { position: absolute; inset: 0; opacity: 0; transform: translateY(10px); }
.hero-face.on  { opacity: 1; transform: translateY(0); }
.hero-face.out { opacity: 0; transform: translateY(-10px); }
.fd { min-width: 44px; min-height: 44px; }         /* hit-area do facet-dot */
.hero-chart-link { min-height: 44px; color: var(--accent); }
```

O `.hero::before` consome `--hero-glow` (token S.1, transparente no light — inerte até S.12 dark) pela primeira vez; não é o gradiente decorativo banido pelo anti-pattern #8 (que continua vigente — sem gradiente LINEAR no background do card, só o radial glow reservado desde a fundação).

### Voz humana nos estados vazios (raio-x, 7a.S.5)

Três estados que antes eram robóticos ou silenciosos ganharam frase curta e humana — a degradação graciosa (`x-show`) continua intacta, só o TEXTO mudou/apareceu:

- `.aporte-vazio`: "Nenhum aporte registrado." → **"Nenhum aporte por aqui ainda."**
- `.r7d-vazio` (novo): quando `ultimos_7d` existe (schema v2.13+) mas ainda não há dado suficiente (DB recém-bootstrapped, sem snapshot ≥7d e sem movimentos na janela) — **"Sem novidade por aqui nesta semana."** em vez do bloco simplesmente desaparecer sem explicação. Distinto do legado (schema < v2.13, `ultimos_7d` ausente) — aí nem esta mensagem aparece (`x-show="json.ultimos_7d && !ultimos7dVisivel()"`).
- `.r7d-movers-vazio` (novo): semana ativa (headline + decomp + listas visíveis) mas sem cotação-base pra rankear movers — **"Sem destaque de mercado nesta semana."** no lugar do card, sem tocar o resto da semana.

Tipograficamente espelham `.aporte-vazio` (0.875rem/0.8125rem, `--gray`, centralizado) — não competem visualmente com dado real.

### Bloco "Últimos 7 dias" (raio-x, 7a.J.1)

Seção entre hero e último-aporte que decompõe a variação patrimonial de 7 dias em três componentes contábeis: **aportes líquidos** (compras − vendas), **proventos** (dividendos + JCP + rendimentos), **mercado** (residual = delta − aportes − proventos). Identidade contábil garantida no backend (`_build_ultimos_7d`, schema v2.13): `delta_patrim_brl ≡ aportes_liq + proventos + mercado` (até 1 centavo).

```css
.r7d-head    { /* label small-caps 11px + delta mono 1.125rem 700 (--ink/--g-700/--red) */ }
.r7d-row     { /* sans label gray + valor mono 0.9375rem colorido por sinal */ }
.r7d-movers  { /* .grifo consagrado (7a.S.5): bg --surface-2 + border-left 3px --accent + radius 0 14px 14px 0 */ }
.r7d-movers li { /* grid 0.9rem 1fr auto auto auto: ▲▼ · ticker · .flag · R$ · % */ }
.r7d-lista li{ /* grid 1fr auto auto auto: ticker · qty · valor · .flag */ }
```

**Movers de mercado (7a.J.2.b).** Sub-bloco entre a decomposição 3-row e as listas Compras/Vendas/Proventos: lista as **top 3 altas + top 3 baixas por impacto em R$** na semana, "abrindo" a caixa-preta da linha **Mercado** (a única perna da decomposição que o Dr. Arthur não controla e mais quer entender). Cada linha: seta ▲/▼ · ticker · bandeira · impacto R$ com sinal (`formatBrlSigned`) · retorno % (`formatPct`). Ordenação visual: altas (impacto desc) seguidas das baixas (mais negativa primeiro), espelhando a ordem do array do backend (`ultimos_7d.variacao_mercado`, schema JSON v2.22). Cores pelos pares semânticos (`.is-positive`/`.is-negative` → `--g-700`/`--red`). **A11y:** direção codificada em três camadas (forma ▲/▼ + cor + sinal `+/−` no valor — nunca cor sozinha, regra `color-not-only`); seta ▲/▼ e ★ do título são `aria-hidden` (decorativos), o leitor de tela lê "PETR4 +R$ 920,00 +3,10%".

**Grifo consagrado (7a.S.5).** `.r7d-movers` é o **único cartão com border-left** da tela Raio-X — a colocação canônica documentada desde S.1 (anti-pattern #14, Apêndice B da spec: "Raio-X = card Movers"), agora realizada. Antes: `border-left 3px solid var(--ink)` + `background: var(--neutral-50)` + `border-radius: 10px` (uniforme). Depois: `.grifo` (S.1) — `border-left 3px solid var(--accent)` + `background: var(--surface-2)` + `border-radius: 0 14px 14px 0` (assimétrico, "abrindo" visualmente pra direita). É o cartão de maior tensão informativa do bloco (o que o Dr. Arthur mais quer entender), coerente com a régua "grifo = UMA por tela, no ponto de maior tensão".

**Pattern de render:** pure Alpine (sem helper JS externo). `x-show="ultimos7dVisivel()"` esconde o bloco quando schema é v<2.13 (sem `ultimos_7d`) ou quando DB recém-bootstrapped não tem snapshot ≥7d E listas vazias. Cada `.r7d-lista` aparece via `x-show` apenas quando array é não-vazio (semana calma fica só com headline + decomp). O `.r7d-movers` aparece via `x-show="(json.ultimos_7d?.variacao_mercado || []).length > 0"` (some quando não há snapshot-base 7d ou todos os impactos < 1 centavo). Sem ECharts (Monument text-only); sem motion individual (segue regra global do shell — entrada via `x-transition.opacity.duration.220ms` herdada da tab raio-x).

**Tokens reusados (zero novo):** `--mono` (headline + valores), `--num-sm` (linhas movers/decomp), `--g-700` (sinais positivos), `--red` (sinais negativos), `--gray` (labels secundários), `--ink` (texto principal), `--neutral-50` (fundo do cartão movers), `--neutral-100/200` (borders), classe global `.flag` (bandeiras BR/EUA). Helper novo: `formatBrlSigned` (R$ com sinal explícito) em `js/format.js`.

### Tab bar (Monument)

Bottom nav fixa, 5 destinos **por extenso** (Raio-X · Rentabilidade · Alocação · Proventos · Aportar), text-only (sem ícones), indicator 2px no **topo** da tab ativa que desliza via `transform translateX`. Single element (`.tab-bar-indicator`) compartilhado entre todas as tabs — não é pseudo `::before` por tab.

```css
.tab-bar {
  position: fixed;
  bottom: 0; left: 0; right: 0;
  height: calc(var(--tab-bar-height) + env(safe-area-inset-bottom, 0px));
  padding-bottom: env(safe-area-inset-bottom, 0px);
  background: var(--tab-bg);              /* 7a.S.4: frosted (era --tab-bar-bg opaco) */
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
  border-top: 1px solid var(--tab-bar-border);
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  z-index: 100;
}
.tab-bar a {
  font-size: 10.5px; font-weight: 600;    /* 7a.S.4: era 13px/0.02em, abreviado */
  color: var(--faint);
  letter-spacing: 0.01em;
  min-height: 44px;
  min-width: 0;                           /* evita grid blowout com rótulo longo */
  padding: 0 2px;
  text-align: center;
}
.tab-bar a[aria-current="page"] { color: var(--accent); font-weight: 700; }
.tab-bar-indicator {
  position: absolute; top: 0;
  height: var(--tab-indicator-height);
  background: var(--tab-active);
  transform: translateX(var(--tab-indicator-x, 0px));
  transition: transform 220ms cubic-bezier(0.16, 1, 0.3, 1);  /* 7a.S.4: NÃO tocado */
}
```

**Tokens:** `--tab-bar-height: 56px`, `--tab-bg: rgba(250,250,247,.86)` (7a.S.4, frosted; `--tab-bar-bg: var(--neutral-50)` fica só como fallback histórico, não mais referenciado), `--tab-bar-border: var(--neutral-200)`, `--tab-active: var(--g-900)` (ainda usado pelo indicator), `--tab-indicator-height: 2px`. Cor/peso do label agora vêm de `--faint`/`--accent` (S.1), não mais de `--tab-inactive`.

**Rótulos por extenso (7a.S.4):** as abreviações `raio-x/rent/aloca/prov/apt` (pré-7a.S) viraram `Raio-X/Rentabilidade/Alocação/Proventos/Aportar`. Risco medido: "Rentabilidade" (13 caracteres, palavra sem quebra) a 320px em 5 colunas (~64px/tab) — `min-width: 0` no item do grid + `padding: 0 2px` evitam o "grid blowout" (a track de `1fr` cresceria além da viewport com `min-width: auto` padrão). Verificado: 0 overflow horizontal a 320px (`tab-vozes.spec.ts`).

**Persistência:** visível nas 5 tabs e nas telas de push (`#ativo/:ticker`, `#/raiox/chart`). Some apenas na PIN screen (gate de auth, antes do shell ser hidratado).

**Anatomia visual:** indicador 2px no topo (não bottom-underline cliché Material/Bootstrap), peso 600 inativa / 700 ativa, color shift `--faint` → `--accent`. Sem badges, sem ícones, sem dot decorativo. Diferenciação carregada por peso + cor + tracking + indicator.

### Voz única de abertura de tela — `.eyebrow` (7a.S.4)

Antes da 7a.S.4, cada tela abria com um `<h1>` grande e inconsistente (tamanhos/pesos/cores variando tela a tela — ex. `.raiox > h1` já tinha virado um eyebrow ad-hoc 13px/600/.08em/`--gray` só naquela tela, enquanto `.breadcrumb h1` das demais era 22px/700/`--g-900`). A 7a.S.4 consolida tudo em `.eyebrow` (definido em S.1, inerte até aqui):

```css
.eyebrow {
  font-size: 11px; font-weight: 800; letter-spacing: 0.2em;
  text-transform: uppercase; color: var(--faint);
  margin: 0;
}
.eyebrow--accent { color: var(--accent); }  /* 7a.S.4: variante das push screens */
```

**Mapeamento por tela:**
- **Tab screens** (Raio X, Rentabilidade, Alocação, Proventos, Aportar) — o `<h1>` de abertura vira `<p class="eyebrow">`, cor `--faint`. No raio-x, o eyebrow é filho direto de `.raiox` (sem `.breadcrumb`, tela âncora); nas demais 4, o eyebrow substitui o `<h1>` dentro do `<header class="breadcrumb">` já existente (sem botão voltar). O **hero-poster do patrimônio** no raio-x permanece intocado — só o h1 redundante com o rótulo da própria tab bar é rebaixado.
- **Push screens** (`#ativo/:ticker`, `#/raiox/chart` → `.tela-patrimonio`, `#relatorio`) — mesmo `.eyebrow`, variante `.eyebrow--accent` (cor `--accent` em vez de `--faint`), sinalizando "você entrou mais fundo" sem reintroduzir peso/tamanho de h1. O `.breadcrumb` com botão "←" **não é removido** — a variante troca só a cor do label, não a navegação.

Nenhuma tela usa `<h1>` daqui pra frente, exceto a PIN screen (`<h1>Carteira</h1>`, fora do shell autenticado — não é uma "tela" no sentido de navegação por tab/push).

### Card (padrão)
Branco sobre warm-neutral, border 1px tintada, shadow sutil tintada para teal.

```css
.card {
  background: #fff;
  border: 1px solid var(--neutral-200);
  border-radius: 18px;
  padding: 1.125rem 1.125rem 1.25rem;
  margin-top: 1rem;
  box-shadow: var(--card-shadow);
}
```
Variantes: `.card.proventos` (gradient warm green→amber background), `.card-link` (clicável; feedback de toque `:active scale(.99)`, 7a.S.2 — substitui o hover translateY).

### Chip (rentabilidade XIRR/TWR)
Pill compacto com background tintado para a métrica.

```css
.chip-xirr { background: rgba(4, 120, 87, 0.12); color: var(--g-700); }
.chip-twr  { background: rgba(20, 184, 166, 0.14); color: #0d7377; }
.chip.is-neg::before { content: "▼ "; }   /* indicador de sinal usa forma + cor */
```

### Lado pill (Buy/Sell em tabela movimentos)
Pequeno square pill cor sólida com letra única.

```css
.lado-B { color: #fff; background: var(--g-700); }   /* Buy = teal */
.lado-S { color: #fff; background: var(--red); }     /* Sell = red */
```

### Trilha alocação (progress bar com target)
Barra horizontal com preenchimento + marker vertical de alvo.

```css
.aloc-trilha     { height: 0.625rem; border-radius: 999px; background: var(--neutral-100); }
.aloc-preenchimento { transition: width 300ms ease; }
.aloc-alvo       { width: 2px; background: var(--ink); opacity: 0.62; top: -3px; bottom: -3px; }
```

### Aloca unificada (7a.E.31)
`#alocacao` é **uma única lista de cards de categoria colapsáveis** — sem
segmented Atual/Alvo (removido), sem accordion de seção. A tela consolida
política alvo + estado atual lado a lado. Cabeçalho `.breadcrumb` padrão (só
o `<h1>Alocação</h1>`, idêntico às demais telas — sem repetir patrimônio
total, que já é o hero do #raiox).

**Anatomia do card (`.aloca-cat`, `--cat` via `catStyleVar(nome)` inline):**
- **Header-resumo sempre visível** (`.aloca-cat__head`, `<button>`): dot
  `--cat` · nome (1.08rem 800) · `.aloca-cat__rs-valor` (R$ da categoria,
  mono `--num-sm` cor `--cat`) + chevron `▸/▾`. `aria-expanded` +
  `aria-controls` apontando o corpo.
- **Barra** reusa `.aloca-alvo__trilha-cat` (14px, marker preto + cap-dot,
  fill gradient `--cat`; overflow → `fill--over` em `--sem-down`).
- **Foot** (`.aloca-cat__foot`): `atual X%` · `alvo Y%` · drift pp colorido
  (`--sem-up`/`--sem-down`/`--gray` via `formatDelta`).
- **Corpo** (`.aloca-cat__body`, `x-show` por `catAberta[nome]`): cestas
  `.aloca-alvo__cesta` (passiva/picks, `border-top 1px`, sem nested card) +
  ativos `.aloca-alvo__ativo` (grid `18px 1fr auto`).

**Colapso:** todas as categorias **começam fechadas** (`catAberta: {}`
vazio). Estado **não-persistente** (reseta no reload), preservado em memória
Alpine ao trocar de aba. Ordem dos cards por **alvo decrescente**
(`categoriasAlocacaoOrdenadas`). Chevron rotation 150ms ease,
`prefers-reduced-motion: reduce` → `transition: none`.

**Linha de ativo:** coluna direita `.aloca-alvo__ativo-right` empilha R$ de
mercado (`.aloca-alvo__valor-ativo`, mono `--num-xs`) sobre o delta/selo —
evita que o R$ vire 4ª coluna e esprema o subtexto. Mini-bar 3px
(`atual/alvo intra`) + delta pill mono direcional só para picks normais.

**DY do ativo (`.aloca-alvo__dy`, 7a.E.32):** sufixo do ticker em
`.aloca-alvo__ativo-row1` — o único slot que existe idêntico nos 3 estados de
linha (normal / quarentena / fora-do-alvo). Voz secundária compartilhada com
`.aloca-alvo__ativo-sub` (mono, `--gray`, `tnum`, peso 400): o propósito é
**leitura de contexto**, então o DY não pode competir com o drift nem com o
R$ — daí não usar `--num-xs` (13px/700, o tamanho do ticker). Cinza é decisão:
`--cat-*` codifica identidade de categoria e `--sem-*` codifica drift; um yield
alto não é "bom" nem "ruim", é um fato. O rótulo `DY` é obrigatório (a tela é
saturada de percentuais; `9,1%` pelado leria como peso de carteira). Sem número
confiável — sem provento nos 12m **ou** DY > 100% (dust de leilão de fração) —
a linha mostra `—` com `aria-label="sem dividend yield"`. Fonte:
`dividend_yield.por_ativo` (schema v2.24), que compartilha o predicado
`_dy_valido` com o pódio de `#s-dy`: as duas telas **nunca** divergem para o
mesmo ticker. Aluguel de ações (BTC/XP) fica fora do DY.

É **um único `<span>`**, com texto e `aria-label` condicionais — não dois spans
sob `x-show`. `x-show` esconde por `display:none` mas mantém os dois nós no DOM,
o que deixaria um nó fantasma para o leitor de tela e faria o seletor
`.aloca-alvo__dy` resolver a dois elementos.

**DY do ativo — card KPI (`#ativo`, 7a.E.33):** o mesmo dado
(`dividend_yield.por_ativo` via `dyAtivo`) ganha um 7º card na `.kpi-grid` da
ficha do ativo, **depois do XIRR** — ponte com a seção "Proventos · últimos 12
meses" logo abaixo. Aqui o rótulo é por-extenso **`Dividend Yield`** (não o `DY`
compacto do `#alocacao`): a `.kpi-grid` já rotula cada célula, então não há
ambiguidade com peso de carteira. 7 itens numa grade 2-col ⇒ o card cai sozinho
na última linha, célula vizinha vazia — **por design, zero CSS novo**. Fallback
`—` idêntico (`aria-label="sem dividend yield"`). Paridade travada nas **três**
superfícies (`#alocacao`, `#s-dy`, `#ativo`): mesma fonte, mesmo `round(dy,4)` do
backend, nunca divergem.

**Held off-policy (`fora_do_alvo`, schema v2.20):** ativo com posição fora
do YAML, misturado na cesta picks. Selo `.aloca-alvo__selo-fora` "fora do
alvo" (`--sem-down-tint`/`--sem-down`, espelha o selo de quarentena) +
subtexto "a zerar · sem alvo"; **sem** mini-bar nem delta. Guarda
`fora_do_alvo && !quarentena` (quarentena tem precedência se ambos).

**Regra de cor (identidade × semântica):**
- **Identidade** (`--cat-*`): dot, R$ do header, fill da trilha/cesta/minibar normal.
- **Semântica** (fixa): delta `↑ −X pp` em `--sem-up`; `↓ +X pp` + minibar
  overflow + selo fora-do-alvo em `--sem-down`. Verde = aportar; amber = acima/zerar.

**Naming:** "Cesta passiva" / "Cesta de picks" na UI via `labelCestaTipo`;
backend mantém `bucket.tipo: "passive" | "picks"`.

**Princípio de overflow:** dinheiro/percentual nunca é truncado nem
reticenciado — só rótulos textuais. O R$ do header (`.aloca-cat__rs-valor`,
`--num-sm` + `tabular-nums` + `white-space: nowrap`) permanece íntegro até
7 dígitos a 320px.

```css
.aloca-cat__rs-valor { font-size: var(--num-sm); font-family: var(--mono); color: var(--cat); }
.aloca-alvo__minibar .fill--over { background: var(--sem-down); }
.aloca-alvo__selo-fora-tag { background: var(--sem-down-tint); color: var(--sem-down); }
```

### Faixa de composição 100% (7a.S.8)
`#alocacao` abre respondendo "como estou dividido?" — uma **faixa de
composição** (`.compo`) ACIMA de `.aloca-lista`, mapa do todo antes dos
cards individuais. Um `<button class="compo-seg">` por categoria (mesmo
recorte/ordem de `.aloca-lista` — `categoriasAlocacaoOrdenadas`, alvo
decrescente), `background: var(--cat)` via `catStyleVar(nome)` inline
(reusa a identidade 7a.E.20, zero cor nova).

**Larguras — normalizadas, não literais:** `largura% = peso_atual /
Σ(peso_atual das categorias presentes) × 100`. Decisão explícita (não
"neutral remainder segment"): a faixa **sempre preenche exatamente 100%**
do espaço visual, blindada contra (a) resíduo de arredondamento — a
fixture de teste soma 100,2% — e (b) categorias fora do escopo da política
publicada. Mesmo recorte que os cards abaixo já usam: a faixa nunca mostra
mais nem menos categorias do que `.aloca-lista`. Rótulo interno (`.sl`)
mostra o `peso_atual` **real** (não a largura normalizada) — a normalização
é só geometria do desenho, nunca o número reportado.

**Rótulo interno — só o percentual (fix 2026-07-05):** `.compo-seg .sl`
mostra **apenas** `PP%` (ex.: "58%") — nunca o nome da categoria. O nome
vive no card logo abaixo (`.aloca-cat`, em `atual X% · alvo Y%`) e no
`aria-label` completo; repeti-lo dentro de um segmento estreito era o que
colidia os labels no celular.

**Regra dos estreitos — por medição, não por threshold fixo:** qual `.sl`
aparece é decidido por `ajustarLabelsFaixa(band)` (JS): para cada segmento,
compara `sl.scrollWidth` (largura natural do "PP%") com o `clientWidth` do
segmento e mostra o rótulo (`visibility: visible`) só quando ele **cabe** de
fato; senão fica escondido (`visibility: hidden`, o default do `.sl`) e o
segmento fala só por cor + `aria-label`. Assim uma categoria real de ~9-10%
(ex.: Renda Fixa BR) **mostra** seu % num celular normal (≥360px) e some só
onde não caberia (320px), enquanto uma fatia minúscula (ex.: Cripto ~2%)
nunca ganha número. Roda via `x-effect` na `.compo-band` (depende de `rota` +
`composicaoSegmentos`, com `$nextTick` — re-mede ao abrir a tela, quando a
faixa deixa de ser `display:none` e ganha largura real) e num `@resize.window`
debounced (rotação). Guarda contra `clientWidth 0` (faixa oculta → nada é
mostrado até a tela abrir). O threshold fixo anterior (`peso_atual ≥ 7%` →
`larguraPct ≥ 12%`) escondia categorias mesmo quando o número caberia. Rede
de segurança: `.compo-seg { overflow: hidden }` — nenhum rótulo vaza pro
vizinho, p/ qualquer dado/viewport.

**`.compo-ticks` — réguas do alvo:** abaixo da faixa, uma marca (`.mk`,
1.5px × 7px) por categoria **com alvo > 0** em posição **cumulativa** de
`peso_alvo` (normalizada pela soma de `peso_alvo` — defensivo; por construção
`/alocar` já bloqueia categorias que não somem 1.0). O valor exibido (`.tv`)
é o `peso_alvo` **próprio** da categoria (não o acumulado) — leitura "esta
fatia vale X%", não "isto é X% do total". Como os segmentos usam `peso_atual`
e os ticks usam `peso_alvo`, a régua compara visualmente atual × alvo sem
precisar de dois gráficos separados.

**Categoria de alvo 0% não emite tick (fix 2026-07-05):** uma categoria em
quarentena com alvo zerado (ex.: Cripto) tem posição atual mas 0% de
alvo — sua marca cumulativa cairia no mesmo ponto da anterior (soma 0 ao
acumulado) e o label "0%" é só ruído. O tick é omitido (o acumulado ainda
avança por 0, então as posições dos demais ficam intactas); o segmento
correspondente **continua** na faixa (usa `peso_atual`). **Clamp nas bordas:**
o último tick fica sempre em `left:100%` (alvos somam 1.0); centralizado, o
label vazaria a borda direita. `composicaoTicks` marca `edge` (`'end'` se
`leftPct ≥ 96`, `'start'` se `≤ 4`, senão `'center'`) e as classes
`.compo-tick--end`/`--start` reancoram só o label pra dentro — a marca `.mk`
permanece no ponto exato.

**Tap → dim + flash + scroll:** tocar um segmento (`tocarSegmentoComposicao`)
esmaece os irmãos (`.compo-seg.dim`, opacity .35, ~1400ms) sem esmaecer o
próprio segmento tocado, faz o `.aloca-cat` correspondente piscar
(`.aloca-cat.flash`: ring `0 0 0 3px var(--accent-soft)` + `border-color:
var(--accent)`) e chama `scrollIntoView({behavior:'smooth', block:'start'})`
nesse card (`id="aloca-cat-<categoria-slug>"`, `scroll-margin-top: 12px`
evita que o topo cole na borda da viewport). Ambas as classes são
removidas por `setTimeout` após 1400ms.

**`prefers-reduced-motion: reduce`:** o tap ainda rola até o card
(`behavior: 'auto'`, instantâneo) mas **não aplica nem dim nem flash** —
motion zero por design (nenhum pulso), lido de
`window.drarthurNav.motion.reduced` (mesma fonte de verdade do resto do
app shell, ver 7a.S.6 `.chart-sub.live`). Escolha explícita entre as duas
opções da spec ("flash-estado curto sem animar" vs "nada") — optamos por
"nada": sob motion reduzido, o scroll sozinho já entrega a navegação; um
estado visual que aparece e desaparece sem transição ainda seria um
"pulso", só que instantâneo.

**Confirmação não-visual (a11y, CRB 7a.S.8):** o dim/flash/scroll é
puramente visual — um leitor de tela não saberia que o tap registrou. Uma
região `.sr-only` com `aria-live="polite"` (dentro de `.compo`,
`x-text="compoAnuncio"`) narra "{categoria} em destaque" a cada tap.
Setada em `tocarSegmentoComposicao` **fora** do guard de reduced-motion —
o anúncio dispara sempre; é a11y, não motion (quando o pulso visual é
suprimido é justamente quando a confirmação por leitor de tela mais importa).

```css
.compo-band { height: 46px; border-radius: 12px; background: var(--surface-2); overflow: hidden; }
.compo-seg { background: var(--cat); }
.compo-seg.dim { opacity: .35; }
.aloca-cat.flash { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft), 0 2px 6px var(--g-900-07); }
```

### Proventos — linha-razão + chamada DY + KPI scroll affordance (7a.S.7b)

O topo de `#proventos` perdeu o poster de total e o bloco `.dy-bloco`
inline (4 escopos de Dividend Yield mostrados ali). A tela agora abre
direto no `.eyebrow` + `.escopo-toggle` (Anual/Mensal); dois elementos
novos substituem o que saiu:

- **Linha-razão** (`.prov-total`, dentro do MESMO cartão do chart —
  `.prov-chart-card` unifica o chrome do card, evitando card-dentro-de-
  card; o `#proventos-grafico` interno fica "achatado" só ali). Rótulo
  (`.pt-lbl`) + valor mono (`.pt-val`) = **soma exata das barras
  exibidas** (nunca um agregado independente), recalculado a cada
  `renderProventosGrafico()`: `"Total · 2021–2026"` no modo Anual,
  `"Total · 12 meses"` no Mensal — troca com o toggle.
- **Chamada de Dividend Yield** (`.dy-chamada`, idioma do card
  `.rel-card-home` do Relatório do mês): mostra o DY trailing-12m da
  carteira e navega (push) para a tela dedicada `#/proventos/dy`.

```css
.prov-chart-card { background: white; border-radius: 14px; padding: 12px; box-shadow: 0 2px 6px var(--g-900-07); }
.prov-chart-card #proventos-grafico { background: none; box-shadow: none; padding: 0; margin: 0; }
.prov-total { display: flex; justify-content: space-between; border-bottom: 1px solid var(--neutral-100); }
.dy-chamada { display: flex; border: 1px solid var(--neutral-200); border-radius: 18px; box-shadow: var(--card-shadow); }
```

**KPI scroll affordance (Task 4, spec 7a.S §9 — Fable: "3º KPI cortado a
320px").** Substitui o wrap-to-1-col de 7a.G.2 finding #3: `.kpi-grid-3`
vira flex row com `overflow-x: auto` contido no wrapper
`.kpi-scrollwrap` (nunca a página — guard testado em
`responsive-narrow.spec.ts`), `scroll-snap-type: x proximity` por card,
e um `.kpi-scroll-fade` (`linear-gradient(to right, transparent,
var(--neutral-50))`, `pointer-events: none`) sinalizando que há mais
conteúdo. Em viewports largos os 3 cards cabem inteiros e o overflow
fica inerte (sem scroll visível). Container ganha `tabindex="0"` +
`role="group"` para alcance via teclado.

### Dividend Yield dedicado — `#s-dy` (7a.S.7b)

Tela push (`#/proventos/dy`, tab bar **persiste** em "Proventos" —
mesmo mecanismo genérico de `#ativo`/`#/raiox/chart`; `voltar()` usa o
mapa `home["provent"] = "#proventos"`, sem shim dedicado), aberta pela
chamada de `#proventos`. Breadcrumb com `.eyebrow--accent` "Dividend
Yield" + botão voltar.

- **Poster** (`.poster`, mono, `--num-poster-xl` 54px, cor `--accent`)
  = `dividend_yield.total.dy` da carteira + caption `.poster-cap`
  (trailing-12m, "renda recebida ÷ valor de mercado").
- **3 linhas por classe** (`.dy-row`, ordem FII → Ação BR → EUA·USD):
  barra (`.barw i`) proporcional ao maior dy entre as 3, valor mono
  (`.yv`). Clique seleciona (`.dy-row.on`, borda + anel `--accent-soft`)
  e troca qual categoria o pódio abaixo mostra — default é a de
  **maior dy** entre as 3 (não hardcoded).
- **Pódio de campeões** (`.dy-champs`, bandeja `--surface-2` — **não**
  é o `.grifo`): consome `dividend_yield.campeoes.{acao_br,fii,eua}`
  (schema v2.23, 7a.S.7a backend). Cada `.champ` = rank + bandeira +
  ticker + dy (`--accent`) + barra + valor de mercado na moeda nativa
  do item (BRL ou USD, sem conversão FX para EUA). **Empty-safe:**
  categoria com 0 campeões (ou `campeoes` ausente — payload pré-
  7a.S.7a) renderiza a voz "Ainda sem campeões suficientes nesta
  classe" em vez de quebrar.

```css
.poster { font-family: var(--mono); font-weight: 800; font-size: var(--num-poster-xl); color: var(--accent); }
.dy-row { border: 1px solid var(--neutral-200); border-radius: 14px; box-shadow: var(--card-shadow); }
.dy-row.on { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft), var(--card-shadow); }
.dy-champs { background: var(--surface-2); border-radius: 14px; }
```

### Aportar — simulador vivo (7a.S.10)

`#aportar` era o executor de política puro da 7a.H.1 (input + cards
recebedores, sem coreografia). A 7a.S.10 o transforma num **laboratório
vivo** que ensina *por que* o plano é o que é — **aditivo**: o cálculo
cap-5/zero-sobra/gap de `js/aportar.js` (`window.aporteCalculo.calcularAporte`)
permanece **intocado**; toda a nova camada vive em `app.js`/`index.html`/
`app.css`.

**Single source of truth do valor:** `aporteValor` (string, o mesmo
`x-model` do `.aporte-input` de texto pré-existente) é a ÚNICA fonte —
chips e scrubber escrevem nela via `aporteSetValor(v, animar)`/`aporteAdd(delta)`
e chamam `recalcularAporte(animar)`, exatamente como o
`@input.debounce.150ms` já fazia. Digitar, tocar um chip ou arrastar o
scrubber convergem no mesmo estado; nenhum dos três tem uma cópia própria
do valor.

- **Pré-carga (`.aporte-cap`)** — legenda acima dos chips, `aporteApcapHtml()`
  lê `json.ultimo_aporte` ("Seu último aporte foi **R$ X**, em D de mês —
  toque para repetir"); sem dado, cai num convite genérico. Novo formatter
  `window.formatDataExtenso` (`js/format.js`) — parse por **regex**, não
  `new Date(iso)`: uma data-only ISO ("2026-04-20") vira meia-noite UTC, que
  em America/Sao_Paulo (UTC-3) volta pro dia anterior no horário local
  (`getDate()` retornaria 19, não 20). Regex evita o fuso inteiramente.
- **Chips rápidos (`.aporte-chips`)** — `.aporte-chip--hero` "Repetir · R$ X"
  (`x-show` só quando há último aporte) + `+ 5.000`/`+ 10.000` (`aporteAdd`)
  + `zerar` (`aporteSetValor(0, true)`). Reusa `:active { transform: scale(.93) }`
  (S.2); `--accent`-bordered no hero-chip.
- **Scrubber "E se fosse mais?" (`.aporte-scrub-wrap`)** — 0–20.000, passo
  100. Implementado como `<input type="range">` **nativo** (transparente,
  `position:absolute; inset:0`) sobreposto a um trilho decorativo
  (`.aporte-scrub-fill`/`.aporte-scrub-knob`, gradient `--accent`→`--accent-2`) —
  decisão deliberada de acessibilidade sobre o padrão do mockup (2 `<div>`
  com math manual de drag): o `<input>` nativo dá teclado (setas/Home/End)
  e `aria-valuenow`/`min`/`max` de graça, sem reimplementar nada disso.
  `@input` chama `aporteSetValor(valor, animar=false)` — arrasto nunca
  anima (paridade com o mockup: `setAp(v, true)` só nos chips).
- **Poster de valor** — em vez de um `.apval` separado (duplicaria o
  display), o `.aporte-input` existente assumiu a escala tipográfica
  poster (`--num-poster-lg`, token já reservado em S.1) + `--mono`.
  Continua editável — sem redundância visual entre "número grande" e
  "campo de texto".
- **Plano se monta** — ao mudar o valor, `_aporteAnimarPlano(animar)`
  (chamada via `$nextTick` ao fim de `recalcularAporte`) toca:
  - **Stagger reveal** dos `.aporte-card` (`.aporte-card--in`, ~110ms +
    30ms de base por categoria, 1x por categoria via o Set
    `_aporteRevelados` — reseta quando o valor volta a 0, espelhando o
    mockup `wrap.innerHTML=""` quando V≤0). `prefers-reduced-motion`:
    a classe é aplicada no MESMO tick, sem `setTimeout`, e a regra de
    transição fica dentro de `@media (prefers-reduced-motion: no-preference)`
    — o card salta direto pro estado final sem qualquer intervalo.
  - **Count-up de cotas** (`.aporte-compra-qty`) via
    `window.drarthurNav.applyCountUp` — **dono exclusivo do `textContent`**
    desse nó (SEM `x-text`; o valor final vem de `data-cotas`/
    `data-cotas-frac`, atributos reativos via `:data-*`). Mesmo racional
    do `#hero-patrimonio` (`ativarCountUpHero`): `aporteCategoriasRecebedoras`
    é reatribuído por inteiro a cada recálculo, então um `x-text` reativo
    nesse nó disputaria com o RAF e reverteria o frame no meio da animação.
    `animar=false` (digitação/scrubber) escreve o valor final direto —
    só os chips tocam a animação.
  - **Tag "abaixo · aportar" → "fecha o gap"** (`aporteCatTagTexto(cat)`) —
    só reescreve a leitura quando `cat.tag === "subexposta"` (o cálculo
    invariante já diferencia subexposta/balanceado). Usa `atualPct`/`posPct`
    já devolvidos por `calcularAporte` **contra o alvo RAW** (ver abaixo),
    nunca `alvoPct` (arredondado). "no alvo"/"" passam direto.
  - **Grifo do plano (`.aporte-grifo`, `.grifo` de S.1 — Apêndice B "Aportar
    = box do plano", ÚNICO grifo desta tela)** — `aporteGrifoHtml()` narra
    "Com **R$ X** você fecha **N%** do caminho de volta ao alvo — zero
    sobra" (ou "o gap fecha inteiro" quando `N% ≥ 100`). `N%` = fração do
    gap ORIGINAL fechada pela categoria subexposta com **menor** progresso
    relativo (`deltaPct / (alvoRaw − atualPct)`, capado em 1) — a que
    "trava" o caminho quando há mais de uma categoria recebedora. Estado
    balanceado (nenhuma categoria subexposta) narra só o valor, sem "%".
  - **Precisão RAW na math narrativa (CRB #1, Confiança nos Números)** — o
    card de `aportar.js` carrega `alvoPct` **arredondado** (`Math.round`,
    para a trilha DISPLAY "alvo 30%"). Grifo e tag **nunca** misturam esse
    inteiro com os floats raw (`atualPct`/`posPct`/`deltaPct`): para um
    `peso_alvo` não-redondo (0.304 → `alvoPct` 30 vs raw 30,4) a mistura
    desviaria o "% do caminho" em até ~0,5pp e poderia flipar
    **prematuramente** para "fecha o gap"/"gap fecha inteiro". O helper
    `_aporteAlvoRawPct(nome)` recupera `peso_alvo × 100` de
    `json.politica.categorias` (mesma origem que `aportar.js` usa p/ montar
    o card, casada por nome; fallback ao arredondado só se a categoria
    sumir do payload). `aportar.js` permanece intocado — a correção é 100%
    na camada narrativa. A trilha DISPLAY continua arredondada por design.
- **Nota zero-write (`.aporte-nota`)** — **NÃO** é o `.grifo` (distinção
  deliberada: o grifo é o box do plano; a nota é texto simples) — "O plano
  prioriza... zero sobra" + `.writes` "Simulação pura: nada é enviado,
  nada é gravado." **Sempre visível**, independente do valor.
- **Cross-screen (`#alocação` → `#aportar`, Task 4)** — um `.grifo`
  (`.aloca-grifo`) em `#alocação`, entre `.compo` e `.aloca-lista`, aponta
  a categoria com o **drift mais negativo** (mesmo threshold `-0.005` de
  `formatDelta`) — "{Categoria} está **N pp abaixo** do alvo... **Simular
  aporte ›**". Tocar/Enter/Space seta `_aportePresetPendente` (bridge de
  estado, NÃO um parâmetro de URL — evita tocar no parser de hash/query
  do router ou na faixa S.8) com o valor do **último aporte** (mesmo do
  hero-chip "Repetir" — sugestão de ponto de partida familiar, não um
  "aporte ideal" recalculado) e navega `location.hash = "#aportar"`;
  `hidratarAportar()` consome o preset ANTES de tentar restaurar o valor
  persistido em `localStorage` (o tap explícito tem prioridade).

```css
.aporte-input { font-family: var(--mono); font-size: var(--num-poster-lg); }
.aporte-chip--hero { border-color: var(--accent); color: var(--accent); }
.aporte-card { opacity: 0; transform: translateY(10px); }
.aporte-card--in { opacity: 1; transform: translateY(0); }
.aporte-scrub-input { position: absolute; inset: 0; opacity: 0; }
.aporte-grifo, .aloca-grifo { /* .grifo base (S.1) — surface-2 + border-left accent */ }
```

### PIN screen
Input central grande (2rem text + tabular-nums + letter-spacing 0.5rem) + botão full-width primary teal.

### Toast
Fixed top com safe-area-inset, gradient verde, border-radius 999px (pill), pointer-events none.

### Aviso de nova versão — snackbar (`.update-snackbar`)

Snackbar inferior com ação, flutuando acima da tab bar (`bottom: calc(var(--tab-bar-height) + safe-area + 12px)`, `z-index: 95`), centralizado por `margin:auto` (NÃO `transform` — o transform fica livre pra entrada `translateY(8px→0)`). Superfície teal sólida `var(--g-900)` (linguagem "superfície importante" do hero/KPI), pílula `999px`, sem `border-left` (proibição impeccable). Copy sem travessão: **"Nova versão disponível"** + ação **"Recarregar"** + fechar `✕` (`aria-label="Dispensar aviso"`); ícone `↻` decorativo (`aria-hidden`).

- **Surge** via evento window `sw:update-available` (`js/sw-update.js`, dono do ciclo do SW) → estado Alpine `atualizacaoDisponivel`. Dispensável na sessão; reaparece no próximo boot (o worker segue em espera).
- **Motion:** entrada `opacity` + `translateY` em `--d2`/`--ease` (sem overshoot), via classes `.us-enter`/`.us-enter-start`/`.us-enter-end` (espelha `.push-enter`). A transição vive só em `@media (prefers-reduced-motion: no-preference)` → reduced-motion = instantâneo.
- **Dark (Modo Plantão):** `--g-900` flipa p/ teal-claro → o snackbar entra na lista **"seg.on dark ink"** (texto/ícone/botões viram `#04130c`); sombra tintada e o chip da ação `Recarregar` ganham override dedicado. Contraste AA nos dois temas.
- **Ação "Recarregar":** peso 700 + chip translúcido, herdando a tinta da superfície (que flipa por tema) em vez de `--accent-2` — `--accent-2` seria quase invisível sobre o teal-claro do dark. Alvos ≥44×44px; `:focus-visible` com `--accent`.
- **A11y:** `role="status"` + `aria-live="polite"` anuncia ao surgir; ação e fechar são `<button>` reais.

### Tabela (movimentos / proventos)
Sticky `<th>`, `tabular-nums`, font 0.875rem, max-height 320px com scroll-y interno em `.tabela-wrap`.

---

## Motion

**Filosofia: motion serve função, nunca decora.** Sem GSAP. Sem Framer. Sem perpetual loops. Sem auto-play.

### Animações ativas
1. **PIN shake** (420ms cubic-bezier) — feedback de erro de senha. `@media (prefers-reduced-motion: no-preference)` envelopa o keyframe (default off em quem prefere).
2. **Chevron rotation** (150ms ease) em política accordion. Respeita `prefers-reduced-motion: reduce` (transition: none).
3. **Toque — estados `:active` pressionados (7a.S.2)** — todo interativo responde ao toque com escala sutil + `--shadow-pressed` (só `transform`/`box-shadow`; envelopado em `@media (prefers-reduced-motion: no-preference)`). Escalas por tipo: iconbtn .88 · hero .985 · card .988 · relcard .98 · tab .9 · chip .93 · seg .96 · back translateX(-3px) · row .99. `-webkit-tap-highlight-color: transparent` global. Substitui o lift **hover-only** (invisível no celular) por feedback de toque.
4. **Aloc-preenchimento** — width transition 300ms ease quando a barra se atualiza.
5. **Toast fade** — controlado por JS (não CSS), enter/exit suave.

### Curvas
- Padrão: `ease` ou `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out)
- PIN shake: `cubic-bezier(0.36, 0.07, 0.19, 0.97)` (decelerada com pequeno overshoot)

### Hardware acceleration
- Animar APENAS `transform` e `opacity`. Width em `.aloc-preenchimento` é exceção pontual (barra horizontal, sem reflow).
- Nunca animar `top`, `left`, `height`, `padding`, `margin`.

### prefers-reduced-motion
Respeitado em PIN shake (envelope `@media`), chevron (override transition: none) e nos **estados `:active` pressionados (7a.S.2)** — cada regra de toque tem sua transição envelopada em `@media (prefers-reduced-motion: no-preference)`, então o feedback vira instantâneo (sem animar) para quem prefere reduzir. Demais transitions são curtas o suficiente (≤300ms) para não causar problema.

### Motion em gráficos (ECharts, Fase 7a.E.19)

Gráficos do PWA usam motion calibrada — mais expressiva que o resto do app, mas dentro de "calmo médico" (sem celebrar, sem bounce, sem stagger pesado):

1. **Entrada (1º render):** 600ms cubic-out. Lines: path drawing L→R. Bars: growth from baseline com stagger 30ms por barra.
2. **Hover:** 100ms. Tooltip fade-in. Point ring 1.0 → 1.1. Bars não-hover opacity 1.0 → 0.85.
3. **Mode transition:** 400ms cubic-out. `setOption` merge → morph automático (datasets + eixos animados juntos).
4. **Drilldown selection:** 200ms cubic-out. Fade não-selecionadas opacity 1.0 → 0.55 (proventos modo Mensal).

Todas as 4 regras zeram via `prefers-reduced-motion: reduce`. Single source of truth: `js/echarts-theme.js` exporta `window.drarthurChart.motionConfig` (rebuilds on MediaQueryList change).

### Higiene de dataviz (Fase 7a.S.3)

4 tratamentos elevam os 3 gráficos ECharts (rentabilidade/patrimônio/proventos) de classe sem tocar tema/motion/tooltip acima. Implementados em `js/app.js` via 3 helpers puros no escopo do módulo (`criarMarkPointUltimo`, `calcularEixoYAncorado`, `criarDataZoomInstrumento`) + a constante `DECAL_PARCIAL`.

1. **Símbolo só no último ponto.** A série principal (Portfólio em rentabilidade, Patrimônio em patrimônio) usa `showSymbol:false` — sem "colar de contas" ao longo da linha — e ganha um único `markPoint` no ponto mais recente: círculo vazado (`symbol:'circle'`, fundo branco, borda na cor da série) + rótulo do valor acima (`label.position:'top'`). Isso NÃO é o markPoint celebratório banido pelo anti-pattern #20 — sem estrela, sem balão, sem glow; é um marcador discreto de leitura, com label em cor sóbria (`--ink`/cor da série). Benchmarks e a linha "Aporte acum." nunca recebem markPoint (`showSymbol:false` sem exceção). Em rentabilidade, o listener `datazoom` da 7a.L.1 recomputa o markPoint a cada reancoramento (`criarMarkPointUltimo(novaP, ...)`) — o marcador sempre aponta para o último ponto **visível** da janela, não fica preso no índice da janela anterior.
2. **Eixo Y ancorado nos dados** (equity de patrimônio, não em rentabilidade/proventos). `calcularEixoYAncorado(...arrays)` computa `min`/`max` do range combinado de todas as séries visíveis com folga ~12% abaixo / ~14% acima (`lo = menor − span·0.12`, `hi = maior + span·0.14` — mesma fórmula do mockup Monument), em vez de `min:0`. Uma linha-zero tracejada (`markLine`, `--gray` opacity 0.5) só aparece quando o range cruza zero (`min < 0 < max`). Rentabilidade mantém seu próprio comportamento (eixo % sem min forçado, ver reancoramento L.1 abaixo); proventos (barras) fica **fora** deste tratamento — segue zero-anchored (padrão ECharts sem `min` explícito), porque barra parcial (tratamento 3) já comunica honestidade de dado por outra via.
3. **Barra parcial hachurada** (proventos). A última barra de cada série — o ano corrente em Anual, o mês corrente em Mensal — é por construção o bucket ainda acumulando: ganha `itemStyle.decal` (padrão diagonal `DECAL_PARCIAL`, `rotation: Math.PI/4`, cor translúcida sobre o fill) + `opacity:0.65`, e o card exibe uma nota abaixo do gráfico (`#proventosNotaParcial`, `.chart-partial-note`) com o texto `"<rótulo> em curso — hachura · toque numa barra para ler"`. A "última barra do array" é sempre tratada como parcial — decisão estrutural (não compara contra `new Date()` real), robusta independente do dia em que o app é aberto. O decal é atributo do **dado**, não do estado de interação: persiste mesmo quando o drilldown (7a.E.18) seleciona/desseleciona barras — só a `opacity` responde à seleção.
4. **Scrubber-instrumento** (`dataZoom` em rentabilidade e patrimônio). `criarDataZoomInstrumento(dc)` substitui o `dataZoom` default "pesado" por um trilho fino (`height:8`) cor da marca (`fillerColor`/`backgroundColor` via tokens `--g-700-12`/`--g-700-06`), alças em círculo simples (`handleIcon:'circle'`, sem o ícone-ampulheta default), e remove o chrome que compete com o conteúdo: `dataBackground`/`selectedDataBackground` (silhueta em miniatura dos dados) ocultos via `opacity:0`, `showDetail:false` (sem bolha de valor bruto durante o drag), `brushSelect:false`. `minValueSpan:1` é só uma guarda mínima (não deixa o zoom colapsar a 1 ponto). **Deferido:** o overlay HTML custom do mockup (`.zoomtrack` com ticks de ano fixos + bolha de mês flutuando sobre a alça arrastada) não foi portado — exigiria reescrever o listener de `datazoom` da 7a.L.1 e arriscaria quebrar o reancoramento period-relative. O restyle nativo do `dataZoom` entrega o essencial (trilho fino + cor da marca + alças limpas) sem esse risco; a fidelidade extra (ticks/bolha) fica como follow-up caso o Dr. Arthur queira reabrir.

### Motion de navegação (app shell, Fase 7a.I.6)

App shell tem 5 animações calibradas dentro do mesmo orçamento de "calmo médico" — sem slide cliché iOS, sem swoosh:

| Animação | Duração | Curva | Property | Reduced-motion |
|---|---|---|---|---|
| Tab cross-fade (conteúdo) | 220ms | cubic-bezier(0.16,1,0.3,1) | opacity | zera |
| Tab indicator slide | 220ms | cubic-bezier(0.16,1,0.3,1) | transform translateX | zera |
| Hero count-up (Raio-X) | 700ms | cubic-out via RAF | textContent | reveal instantâneo; flag em sessionStorage limita a 1×/sessão |
| Push #ativo / #/raiox/chart | 280ms | cubic-bezier(0.16,1,0.3,1) | transform translateX + opacity | zera |
| Segmented Aloca (Atual/Alvo) | — | — | — | LEGADO: removido em 7a.E.31 (vista única); config `segmented` em transitions.js sem uso |

**Single source of truth:** `js/transitions.js` exporta `window.drarthurNav.motion` (objeto `{tabFade, tabIndicator, countUp, push, segmented, easing, reduced}`); rebuild automático ao alternar `prefers-reduced-motion`. Espelha o padrão de `window.drarthurChart.motionConfig`. O helper `window.drarthurNav.applyCountUp(el, target, formatter)` faz o RAF do hero respeitando o flag `reduced`.

### Reveal stagger de app-shell (distinto do stagger de chart)

Orçamento de motion **separado** do stagger de barras de dataviz (anti-pattern #23, que escopa 30ms/50ms a CHART/ECharts). O *reveal stagger de app-shell* é a chegada escalonada de **cards de tela** (não elementos de gráfico) — comunica "o plano/a home se monta peça por peça", uma dramaturgia deliberada, não atraso de leitura de dado. Orçamento sancionado: **≤ 110ms por passo**, sempre `prefers-reduced-motion`-gated (a classe de reveal é aplicada no mesmo tick, sem `setTimeout`, e a transição vive dentro de `@media (prefers-reduced-motion: no-preference)`). Consumidores atuais: `.aporte-card`/`.plan-cat` (7a.S.10, 110ms/passo + 30ms de base, via `_aporteAnimarPlano`) e A Abertura (7a.S.11, 100–550ms, PIN → home). Se um novo reveal precisar de passo > 110ms, documentar a exceção aqui.

### A Abertura — cerimônia PIN → home (Fase 7a.S.11)

O ritual diário do produto (desbloqueio → home) vira **cena única**, orquestrada em `js/app.js` (`submitPin` + `iniciarAbertura`, x-init da `.raiox`) e `css/app.css`. Três movimentos, sempre nesta ordem:

1. **Dissolve da PIN screen** — no `submitPin` bem-sucedido, `.pin-screen` ganha `.pin-dissolve` (opacity 1→0 + `scale(1.05)`, `--d3`/550ms) ANTES de `fase` virar `"raiox"`; a troca de fase só ocorre ~620ms depois (folga pós-transição, nó sai assentado — mesmo racional do 320ms de saída do `.hero-face`, 7a.S.5).
2. **Reveal em stagger da home** — 4 grupos (`.eyebrow` → `#hero` → `.raiox-7d` → `.rel-card-home`) entram em **100 / 250 / 400 / 550ms** (opacity 0→1 + `translateY(12px)→0`, `--d3`/`--ease`). **Exceção documentada** ao orçamento "reveal stagger de app-shell" (≤110ms/passo, seção acima): aqui o passo é ~150ms — sancionado porque é uma cerimônia de UMA vez por sessão (não uma tela revisitada a cada navegação, como `.aporte-card`/`.plan-cat`), e o hero de facetas (7a.S.5) já materializa com o count-up existente (`ativarCountUpHero`, 1×/sessão via `heroCountUpDone` — a cerimônia não re-dispara, só orquestra o momento em que o card do hero fica visível ao redor dele).
3. **Delta pill "respira"** — ao fim (~980ms), `.hero-delta` ganha `.abertura-breathe`: UM ciclo de `scale(1→1.045→1)` (`animation-iteration-count: 1`, `--d3`/550ms), removido pelo próprio JS no `animationend`. Não é decoração permanente nem loop.

**Trigger e 1×/sessão:** `iniciarAbertura()` é o `x-init` da própria `.raiox` — dispara sempre que a fase vira `"raiox"`, seja via `submitPin` (PIN digitado) OU `tentarAutoResume` (sessão deslizante ≤7d, silencioso). A flag `aberturaFeita` (sessionStorage, mesmo padrão de `heroCountUpDone`/`heroFacetHintSeen`) garante que só a 1ª abertura da sessão toca a cena — refresh/re-navegação dentro da mesma aba mostra a home direto, sem reveal.

**Reduced-motion:** `prefers-reduced-motion: reduce` zera os 3 movimentos — sem dissolve (fase troca instantânea, comportamento pré-7a.S.11), sem stagger (grupos renderizam com opacity 1 desde o início — a classe de reveal nunca é sequer adicionada), sem breathe. A checagem é em JS (`window.drarthurNav.motion.reduced`), e as regras CSS (`.pin-dissolve`/`.abertura-reveal`/`.abertura-breathe`) também vivem inteiras dentro de `@media (prefers-reduced-motion: no-preference)` — dupla blindagem, mesmo padrão de `.pin-screen.is-shaking`.

**Sem celebração, sem loop** (anti-pattern #11): o breathe é um ciclo único que se autorremove; não há confetti/glow/badge. É uma cerimônia calma, não uma recompensa.

**Ground-truth de testes:** `window.aberturaMotion` (`js/app.js`) expõe `{dissolveMs: 550, dissolveRemoveMs: 620, staggerMs: [100,250,400,550], breatheMs: 980}` — mesmo racional de `window.drarthurNav.motion` (7a.I.6), porém **standalone**: não estende o contrato de motion do app shell (`nav-reduced-motion.spec.ts` continua validando só `tabFade`/`tabIndicator`/`countUp`/`push`/`segmented`, intocado).

**Keypad/dots — N/A:** o mockup "Monument v1 refino" desenha a Abertura com um keypad numérico + dots de PIN preenchendo um a um. O app real usa `.pin-input` (campo de texto único, `type=tel` com `pattern=\d{6}`) — não há keypad/dots para reconstruir; o PIN em si é 100% reusado do fluxo existente (`pin-flow.spec.ts` continua sendo a fonte de verdade da autenticação). A cerimônia começa no MOMENTO do submit bem-sucedido, não na digitação dígito-a-dígito.

### Contrato de refino — tokens de motion (7a.S.1)

O Refresh Monument introduz um contrato de motion em `:root`, **aditivo** ao de navegação acima (que permanece 220/280/700ms, ground-truth em `transitions.js` e validado por `nav-reduced-motion.spec.ts`):

| Token | Valor | Papel |
|---|---|---|
| `--ease` | `cubic-bezier(.16,1,.3,1)` | curva base (= literal antes inline; migrado a `var(--ease)` no CSS) |
| `--ease-spring` | `cubic-bezier(.34,1.28,.44,1)` | overshoot sutil: dots do PIN, indicator, facet-dots |
| `--d1` / `--d2` / `--d3` | `.14s` / `.3s` / `.55s` | três durações do motion NOVO de S.2–S.12 |

Regra: motion novo referencia estes tokens; o contrato de nav não é remapeado (durações não coincidem — reconciliação por adição, não substituição, spec §11).

### Hero de facetas — motion (Fase 7a.S.5)

Primeiro consumidor real dos tokens `--d1`/`--d2`/`--d3`/`--ease`/`--ease-spring` reservados em S.1 (até aqui, inertes):

| Elemento | Duração/curva | Property | Reduced-motion |
|---|---|---|---|
| Eyebrow (`#hero-eyebrow`) esmaece antes de trocar o texto | 150ms fixo (`setTimeout`) + `--d2` na volta | opacity | pula o `setTimeout`, troca o texto direto |
| Face entra/sai (`.hero-face`) | `--d2` (`.3s`) `--ease` | opacity + `transform: translateY` (±10px) | `.out` some sem transição, `.on` aplica direto |
| Face que sai — remoção do DOM | 320ms (`setTimeout`, > `--d2` pra garantir que a transição de saída já terminou visualmente) | — | remoção imediata (sem espera) |
| Facet-dot ativo (traço `::before`) | `--d2` `--ease-spring` | background + `scaleX` | sem transição |
| Hint "☞ toque no número" some | `--d3` (`.55s`) ease | opacity | sem transição |
| `.hero`/`.hero-chart-link` `:active` | `--d1` (`.14s`) `--ease` | transform + box-shadow | herda o guard geral de S.2 (`@media (prefers-reduced-motion: no-preference)`) |

Toda a coreografia é gated por `window.drarthurNav.motion.reduced` (mesma fonte de verdade do resto do app shell, `transitions.js`) — não um segundo `matchMedia` paralelo. Nenhuma trava a leitura: o usuário pode ciclar facetas e recarregar a página livremente sem re-disparar o count-up (ver seção "Hero de facetas" em Components).

### Chart #rentabilidade — period-relative reanchoring (Fase 7a.L.1)

Chart histórico do #rentabilidade reanchora dinamicamente conforme o `dataZoom` é movido. Sem zoom (range 100%), Y mostra **cumulativo desde origem** (1 + crescimento_total − 1). Com zoom em `[startIdx, endIdx]`, Y vira **cumulativo desde primeiro ponto visível** via chain rule: `y[i] = growth[i] / growth[startIdx] − 1`. Benchmark recebe o mesmo tratamento. Sub-título `<p class="chart-rent-subtitulo">` acima do chart explicita a âncora ("Cresceu desde Mmm/AA") e atualiza via Alpine state `rentabilidadeSubtitulo`.

Implementação: `hidratarRentabilidade` em `js/app.js` computa `growthPortfolio[]` e `growthBenchmark[]` em init (reconciliando `anualizado=true` → cum via `(1+aa)^(days/365.25)` com `anualizado=false` já cum). Listener `chart.on('datazoom', ...)` lê `getOption().dataZoom[0]` (startValue/endValue em category mode, startValue/endValue ou start/end fallback), mapeia para índices, chama `reancorar(growthArr, startIdx, endIdx)` e atualiza séries via `setOption({series: [...]})`. ECharts faz diff implícito + animação morph via `motionConfig`.

Os 3 cards de métrica abaixo do chart (Ano/12m/Origem, ordem 7a.S.6) **mantêm valores anualizados** — o chart e os cards medem coisas diferentes propositalmente.

### Chart #rentabilidade — múltiplos benchmarks no escopo Total (Fase 7a.E.25)

No escopo **Total**, o chart plota 4 linhas: portfólio + CDI + IBOV + S&P 500 (todas visíveis no load; clique na legenda do ECharts oculta/mostra cada série, comportamento nativo). No escopo **Brasil** (Fase 7a.E.26), o chart plota 3 linhas: Portfólio + CDI + IBOV. EUA segue com **1** linha de benchmark (S&P 500).

- **Portfólio**: `--g-700` #047857, sólido 2.5px (linha-herói, slot 0 do tema).
- **CDI**: `--gray` #5b605a, tracejado `[5,5]` 1.5px — baseline conservador, recua.
- **IBOV**: `--amber-700` #b45309, tracejado `[5,5]` 1.5px — mercado BR.
- **S&P 500**: `--blue-700` #1d4ed8, tracejado `[5,5]` 1.5px — mercado EUA.

As 3 cores de benchmark são tokens **secundários** (não `--cat-*`, que significam classe de ativo) e cada série extra fixa `lineStyle.color` + `itemStyle.color` explícito (marker da legenda casa com a linha). O tema `drarthur` carrega os mesmos 3 hex nos slots 5/6/7 do array `color` como fallback. Schema dependency: `rentabilidade.Total.historico_twr[N].benchmarks = {CDI, IBOV, SP500}` (BRL, schema v2.17); `rentabilidade.Brasil.historico_twr[N].benchmarks = {CDI, IBOV}` (schema v2.18, additive); EUA não emite `benchmarks`. O `dataZoom` reancora todas as linhas (mesma chain rule de L.1).

### Card "Período" (Fase 7a.L.2)

Acima dos 3 cards fixos (Ano/12m/Origem, ordem 7a.S.6) aparece um 4º card `.rent-periodo` que reflete a janela atual do `dataZoom` — e continua o **1º** card visual da tela (Período → Ano → 12m → Origem):

- **Título dinâmico**: `Origem` quando full range (startIdx=0 + endIdx≥maxIdx); `Período · mai/2025 → mai/2026` quando handles arrastados (português, mês abreviado minúsculo).
- **Métricas**: XIRR a.a. + TWR a.a. + linha(s) `vs benchmark` por escopo — **Total**: CDI / IBOV / S&P 500 (3 linhas `.rent-periodo-bench`); **Brasil**: CDI / IBOV (2 linhas); **EUA**: S&P 500 (1 linha). Cada `.rent-periodo-bench` repetida produz o formato multi-row; semântica visual: texto neutro `tabular-nums`, sinal +/− carrega direção (`color-not-only`), sem CSS novo (reutiliza classe existente).
- **Cálculo**: TWR a.a. via chain rule sobre `growthPortfolio[]` que L.1 já calcula; XIRR a.a. via **Newton-Raphson em JS puro** sobre flows da janela (`construirFlows(hist, iA, iB)` = `[-nav[iA], ...cashflows[iA+1..iB-1], +nav[iB]]`). Benchmark simétrico (TWR via `benchmark_growth` ratio; XIRR via `flowsBenchmark` escalado pelo crescimento do índice).
- **Schema dependency**: consome `rentabilidade.{escopo}[.moeda].historico_periodo` (mensal `[{data, nav, cashflow, benchmarks_growth}]`, schema v2.18 — campo renomeado de `benchmark_growth` para `benchmarks_growth` + suporta múltiplos benchmarks).
- **Edge cases**: Newton-Raphson não converge (janela muito curta, all-outflows) → a entrada de `benchExtras` tem `deltaXirr = null` → a `.rent-periodo-bench` correspondente renderiza `'—'` em vez de spread enganoso (`?? 0` mostraria `portfolio_xirr` como diferença).
- **Motion**: zero transição — atualização on-drag direto via Alpine. Mesma diretriz de L.1 sobre subtítulo. (Anti-pattern explícito: animar valores num card que muda em tempo real durante drag é distractor.)
- **Implementação**: hook `this.recomputarPeriodo(startIdx, endIdx)` chamado por (a) final de `hidratarRentabilidade`, (b) `aoMoverZoom(chart)` (mesmo handler que L.1 registra), (c) `selecionarMoeda(m)` quando escopo EUA. Estado Alpine `periodoCustom = {iniIdx, fimIdx, twr, xirr, benchExtras, titulo}`, onde `benchExtras` é um array de `{nome, deltaXirr, deltaTwr}` (deltas = portfólio − benchmark, `null` quando indefinido). Utilitárias puras top-of-file: `newtonRaphsonXirr`, `construirFlows`, `flowsBenchmark`, `parseMesData`, `gerarTituloPeriodo`.
- **CSS isolado**: classe `.rent-periodo` separada de `.rent-grupo` (preserva invariante "3 grupos fixos" dos specs antigos que assertam `toHaveCount(3)`). Estilo espelha `.rent-grupo` intencionalmente.

### #rentabilidade — seletor lidera, ordem de cards, narração do zoom (Fase 7a.S.6)

**Ordem de cards (top→bottom):** `.rent-periodo` (Período, janela do `dataZoom`) → `.rent-grupo` Ano (YTD) → `.rent-grupo` 12 meses → `.rent-grupo` Origem. Origem foi movida do 1º pro **último** lugar dentro de `.rent-grupos` — a leitura vai do mais recente/tático (janela que o dedo está olhando agora, depois o ano corrente, depois 12 meses) para o mais histórico/contexto (desde a origem da carteira). Período continua fora de `.rent-grupos` (classe própria, preserva a invariante "3 grupos fixos" dos specs). Nenhum grupo foi removido — `rentabilidade-3-grupos.spec.ts` e `rentabilidade.spec.ts` seguem exigindo `toHaveCount(3)`, só migradas para a nova ordem.

**Seletor lidera:** a tela já abria pelo `escopo-toggle` (Total/Brasil/EUA) — sem número-poster acima dele, gráfico e cards vêm depois. A 7a.S.6 reforça esse tratamento (a seleção **é** o gesto de abertura, não um controle secundário perdido entre o header e o gráfico):

```css
.escopo-toggle button        { font-weight: 600; }                          /* era 500 */
.escopo-toggle button.active {
  font-weight: 700;
  box-shadow: 0 0 0 2px var(--accent-soft);  /* 1º uso real do token (reservado S.1) */
}
```

**Escopo APP-WIDE (não só #rentabilidade):** `.escopo-toggle` é a classe única de segmented-control do app — usada tanto em #rentabilidade (Total/Brasil/EUA) quanto em #proventos (Origem/Mensal). A ênfase da seleção (600/700 + anel `--accent-soft`) é **linguagem única deliberada** em toda a marca, não um estilo local — o mesmo gesto de "a seleção lidera" vale para os dois segmented-controls. Coberto por `proventos.spec.ts` (ênfase do toggle ativo do Proventos) além dos specs de rentabilidade.

`.moeda-toggle` (BRL/US$, secundário, só visível em escopo EUA) **não muda** — preserva a hierarquia visual "escopo > moeda" já documentada acima. `--accent-soft` (`rgba(4, 120, 87, 0.09)`) tinha sido reservado em S.1 e ficou "Reservado (não em uso atual)" até esta fase.

**Narração do zoom (`.live`):** o subtítulo `<p class="chart-rent-subtitulo">` ("Cresceu desde Mmm/AA", L.1) ganha um micro-pulse enquanto o usuário arrasta o `dataZoom` — o texto já narrava a âncora; o pulse narra o *movimento em si* (mockup `.chart-sub.live`).

```css
@media (prefers-reduced-motion: no-preference) {
  .chart-rent-subtitulo         { transition: transform var(--d1) ease; }
  .chart-rent-subtitulo.live    { transform: scale(1.04); }
}
```

- **Wiring**: `aoMoverZoom` (o mesmo handler `chart.on('datazoom', ...)` de L.1) adiciona `.live` ao subtítulo a cada evento e agenda um `setTimeout` de 300ms (`LIVE_SETTLE_MS`) que remove a classe; cada novo evento **cancela e reagenda** o timer (debounce clássico) — o ECharts `datazoom` não expõe limites nativos de "início/fim do arrasto" (dispara continuamente durante o drag e também via `dispatchAction` programático), então o settle-sem-novos-eventos é o proxy usado para "o arrasto parou".
- **Reduced-motion**: gated por `window.drarthurNav.motion.reduced` (mesma fonte de verdade do resto do app shell — hero de facetas S.5, motion de navegação) — sob reduced-motion a classe **nunca é adicionada** (blindagem dupla com o CSS, que também envelopa o efeito inteiro em `@media (prefers-reduced-motion: no-preference)`). Só o texto do subtítulo muda; zero pulse.
- **Não é o anti-pattern do card Período**: a seção "Card Período" acima bane animar os *valores numéricos* do `.rent-periodo` (distractor num card que já muda em tempo real). O pulse aqui é num elemento diferente (`.chart-rent-subtitulo`, texto de âncora temporal, não um valor de retorno) e serve como narração do gesto de arrastar — não conflita com aquele anti-pattern.

---

## Anti-patterns banidos

Aplicações futuras e refactors NUNCA podem introduzir:

1. **Pure black** (`#000000`). Use `--ink: #1a1d1c` no light. **Modo Plantão (7a.S.12) também não usa preto puro** — `--neutral-50` dark é `#040906` (quase-preto, warm-tinted), nunca `#000`.
2. **Pure white** em backgrounds amplos. Use `--neutral-50` ou `--neutral-100`. Branco puro só em elementos pequenos (cards, inputs).
3. **Cool gray** (azul/violeta tintado). Toda escala neutral é warm-tinted.
4. **Inter, Roboto, Geist, Satoshi** ou qualquer custom font. System fonts são suficientes.
5. **Glassmorphism decorativo.** Banido em todo o app. (Exceção pré-7a.G.2 do `hero-delta` foi removida na distill — chip agora é flat tint rgba sem `backdrop-filter`.) Sem exceções vigentes; qualquer reintrodução exige justificativa explícita em PR.
6. **Gradient text decorativo.** Nenhum `background-clip: text` em uso. (A única exceção histórica, `.proventos-ytd`, foi removida em 7a.S.7b junto com o poster de total do topo de #proventos.)
7. **AI-purple/blue glow shadow.** Toda sombra é tintada para teal `--g-900`.
8. **Hero metric template** (big number + label + supporting stats + gradient accent). Hero do app pós-7a.G.2 distill é card sólido `var(--g-900)` flat: label uppercase, valor 2rem peso 700, delta-pill flat. Sem gradients, sem `::after`, sem glassmorphism — explicitamente NÃO o template SaaS genérico.
9. **3-equal-cards horizontal grid.** O app não tem isso. Se feature row for necessária, usar zig-zag ou stack vertical.
10. **Cards-inside-cards-inside-cards.** Nesting máximo é 2: `.card > .conteúdo`. Política accordion é `.politica-card > .politica-ativos > .politica-ativo` mas os filhos não são cards visualmente (sem border, sem shadow, só padding).
11. **Animação celebratória** (confetti, glow, badge unlock, ECharts markPoints decorativos como estrelas/balões). Banido por design principle (calma sob qualquer condição de mercado).
12. **Bouncing chevron / scroll arrow** em hero. Banido — assume que o usuário sabe scrollar.
13. **Custom mouse cursor.** Banido — quebra acessibilidade e perf.
14. **Side-stripe borders decorativas.** `border-left` como enfeite genérico em card/alert é banido. **EXCEÇÃO CONSAGRADA (7a.S §5.4) — o grifo do assessor:** `.grifo` = `border-left: 3px solid var(--accent)` + radius `0 14px 14px 0` + fundo `var(--surface-2)`, **UMA por tela**, no ponto de maior tensão informativa. Variante `.grifo--amber` (`border-left: 3px solid var(--amber)` + `--amber-bg`/`--amber-bd`) reservada ao box "NÃO funcionando" do Relatório — cor distinta para que os dois grifos **nunca** leiam como o mesmo sinal. Colocações canônicas (Apêndice B da spec): **Raio-X = card Movers (realizado em 7a.S.5 — `.r7d-movers`)** · **Alocação = callout "abaixo do alvo" (realizado em 7a.S.10 — `.aloca-grifo`, deep-link p/ `#aportar` com preset)** · Proventos = leitura de run-rate · **Aportar = box do plano (realizado em 7a.S.10 — `.aporte-grifo`, "fecha N% do caminho... zero sobra")** · Relatório = âmbar "NÃO funcionando" · Rentabilidade = nenhum (grifo removido a pedido).
15. **Emoji em UI text.** Não usado. Bandeiras (🇧🇷, 🇺🇸) são ícone funcional, não decoração — são exceção legítima.
16. **Tema default ECharts** (paleta azul/amarelo/vermelho cliché). Sempre usar tema `'drarthur'` (`js/echarts-theme.js`).
17. **Gradient fill em series area** de chart ECharts. Linhas sólidas (ou dashed para aporte cumulativo / benchmark) sem fill decorativo.
18. **3D charts.** O PWA é 2D plano, mobile-first.
19. **Animação bounce / elastic / scale > 1.1** em gráficos. Apenas `cubicOut` / `cubicInOut`, durações ≤600ms.
20. **markPoint celebratório** (estrelas, balões, glow pulsante) em gráficos. O markPoint de "símbolo no último ponto" (7a.S.3, `criarMarkPointUltimo`) é a exceção deliberadamente compliant: círculo vazado + label sóbrio, sem estrela/balão/glow — instrumento de leitura, não celebração.
21. **Tooltip default ECharts** com border colorida acompanhando a série. Tooltip do app sempre `var(--surface)` (branco no light, `#0c1510` no dark, 7a.S.12) + border `--neutral-200` (custom HTML via `drarthurChart.tooltipFormatterAxis`).
22. **Legend toggle persistente em mobile.** Em viewport `< 360px`, legenda escondida ou inline minimal.
23. **Stagger > 50ms entre barras de CHART/dataviz.** Default em barras (ECharts) é 30ms — a regra escopa dataviz, onde stagger longo faz o gráfico "montar devagar" e atrasa a leitura do dado. **NÃO** se aplica ao *reveal stagger de app-shell* (chegada de cards de tela) — orçamento de motion distinto e sancionado (ver Motion → "Reveal stagger de app-shell"): `.plan-cat`/`.aporte-card` (7a.S.10, 110ms/passo) e A Abertura (7a.S.11, 100–550ms), todos reduced-motion-gated.
24. **Tab bar com ícones decorativos** (lucide/feather/emoji). Monument é text-only — peso 600 inativa / 700 ativa + letter-spacing + indicator 2px topo carregam a diferenciação. Se feedback de usabilidade vier, fallback documentado é hairline SVG monoline 1.5px; até lá, banido.
25. **Bottom-underline cliché** em tab ativa (linha grossa colorida abaixo do label, padrão Material/Bootstrap). O app usa indicator 2px no **topo** da tab — escolha estética + reduz competição visual com border-top da própria tab bar.

---

## Accessibility

- Touch targets ≥44px em interativos (PIN, btn-bloquear, `.aloca-cat__head`).
- Contrast WCAG AA (a paleta foi escolhida com isso em mente; verificar antes de mudar tokens).
- Foco visível **unificado (7a.S.2)**: `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }` — uma regra para todos os controles (substitui as cores divergentes `--teal`/`--g-500`/`--g-600` anteriores). `--accent` = teal âncora (#047857) no light; vira luz no dark (S.12).
- Sinal positivo/negativo usa **forma + texto + cor** (▲/▼ + valor + cor), nunca cor sozinha. Daltonismo (deuteranopia) coberto.
- **Modo Plantão (7a.S.12) — contraste dark verificado**: `--ink` sobre `--neutral-50`/`--surface` ≥ 4.5:1 (texto normal); `--gray`/`--accent`/`--red`/`--amber`/`--cat-*` sobre `--neutral-50` ≥ 3:1 (texto grande/uso gráfico). Fórmula WCAG relative-luminance + Playwright spec `modo-plantao.spec.ts` (Task 3) trava a régua.
- `prefers-reduced-motion: reduce` honored em PIN shake e chevron.
- `.sr-only` utility presente para texto screen-reader-only.
- `[x-cloak] { display: none !important; }` previne flash of unstyled content do Alpine.

---

## Tokens summary (TLDR)

```css
/* Brand teal */     --g-900 #064e3b  --g-800 #065f46  --g-700 #047857
                     --g-600 #059669  --g-500 #10b981  --g-400 #34d399
                     --teal  #14b8a6
/* Semantic */       --amber #f59e0b  --amber-light #fbbf24  --red #b91c1c
/* Text */           --ink   #1a1d1c  --gray   #5b605a
/* Surfaces */       --neutral-50 #fafaf7  --neutral-100 #f5f5f0
                     --neutral-200 #e7e5de  --neutral-300 #d4d4d0
/* Shadow */         --card-shadow: tinted to --g-900

/* Cores semânticas adicionais (7a.G.2) */
/* Blues   */        --blue-500 #0284c7  --blue-700 #1d4ed8
/* Purple  */        --purple-500 #a855f7
/* Reds    */        --red-50 #fef2f2  --red-200 #fecaca  --red-800 #991b1b
/* Ambers  */        --amber-700 #b45309  --amber-900 #8a5a00
/* Teal    */        --teal-700 #0d7377

/* Alphas nomeados (7a.G.2) */
/* Greens  */        --g-700-06 rgba(4,120,87,0.06)  --g-700-12 rgba(4,120,87,0.12)
/* Teal    */        --teal-14  rgba(20,184,166,0.14)
/* G-900   */        --g-900-04 rgba(6,78,59,0.04)
                     --g-900-07 rgba(6,78,59,0.07)

/* Mono (Monument) */ --mono ui-monospace, SF Mono, Cascadia Mono, JetBrains Mono, Menlo, Consolas
                      --hero-mono-size 3.25rem  --hero-mono-tracking -0.025em

/* Tab bar */        --tab-bar-height 56px  --tab-bar-bg var(--neutral-50) (histórico, não referenciado pós-7a.S.4)
                     --tab-bar-border var(--neutral-200)  --tab-active var(--g-900)
                     --tab-inactive var(--gray) (histórico)  --tab-indicator-height 2px
                     /* 7a.S.4: label usa --faint (inativa)/--accent+700 (ativa); fundo frosted --tab-bg */

/* Class dots */     EUA #1e6091  FIIs #b8731f  Renda Fixa BR #0e7490  Ações BR #047857  Cripto #6d4ea8

/* Refresh Monument (7a.S.1) — valores LIGHT (default); bloco dark = 7a.S.12 */
/* Motion   */       --ease cubic-bezier(.16,1,.3,1)  --ease-spring cubic-bezier(.34,1.28,.44,1)
                     --d1 .14s  --d2 .3s  --d3 .55s
/* Monument num */   --num-poster-lg 46px (2.875rem)  --num-poster-xl 54px (3.375rem)
/* Semantic */       --accent var(--g-700)  --accent-2 var(--g-500)  --accent-soft rgba(4,120,87,.09)
                     --surface #ffffff  --surface-2 #f3f3ec  --faint #989e97  --hero-glow transparent
                     --card-topline transparent  --pill #f3f3ec  --tab-bg rgba(250,250,247,.86)
                     --amber-bg #fbf3e3  --amber-bd #eeddb8
                     --shadow-pressed 0 1px 2px rgba(6,78,59,.06), 0 3px 10px -4px rgba(6,78,59,.14)
/* Componentes */    .eyebrow (11px/800/.2em/upper/--faint; 7a.S.4 = voz única de abertura de tela) .eyebrow--accent (cor --accent, push screens)
                     .grifo (border-left 3px --accent, "uma por tela"; 7a.S.5 realiza em .r7d-movers)
                     .grifo--amber (border-left 3px --amber + --amber-bg/--amber-bd; 7a.S.9 realiza em .rel-secao--destaque, Apêndice B "Relatório = âmbar")
                     .poster/.dy-row/.dy-champs (#s-dy, 7a.S.7b) · .prov-total/.dy-chamada (#proventos) · .kpi-scroll-fade (KPI affordance)
                     .rel-poster/.rel-veredito-linha/.rel-dot (capa editorial + evento mensal do Relatório, 7a.S.9)
                     .aporte-chips/.aporte-scrub/.aporte-card--in/.aporte-grifo (simulador vivo #aportar, 7a.S.10) · .aloca-grifo (cross-screen #alocação→#aportar)
                     .pin-dissolve/.abertura-reveal(-in)/.abertura-breathe (A Abertura — cerimônia PIN→home, 7a.S.11)
                     .theme-toggle (☽/☀ Modo Plantão, topo do Raio-X — 7a.S.12, ver seção dedicada abaixo)

/* Modo Plantão (7a.S.12) — bloco :root[data-theme="dark"], warm OLED, teal-como-luz */
/* Surfaces */       --neutral-50 #040906  --neutral-100 #0c1510  --neutral-200 #1c2b23  --neutral-300 #14211a
                     --surface #0c1510  --surface-2 #101d16
/* Texto   */        --ink #f1efe4  --gray #8fa598  --faint #5d7065
/* Accent  */        --accent #34d399  --accent-2 #6ee7b7  --accent-soft rgba(52,211,153,.12)  --hero-glow rgba(52,211,153,.2)
/* Legado  */        --g-900 #6ee7b7  --g-700 #34d399  --g-500 #6ee7b7  --teal-700 #5eead4 (headings/links/positivos pré-7a.E.23; .hero/.pin-submit têm override dedicado)
/* Semantic*/        --red #f87171  --amber #fbbf24  --amber-700 #fdba74  --amber-bg #1b1608  --amber-bd #3a2f12
                     --pill #12201a  --card-topline rgba(255,255,255,.045)  --tab-bg rgba(6,12,9,.84)
                     --shadow-pressed 0 1px 2px rgba(0,0,0,.5), 0 5px 14px -6px rgba(0,0,0,.6)
/* Categorias */     --cat-eua #5aa7dc  --cat-acoes-br #34d399  --cat-fii #e0a24a  --cat-cripto #b294e8  --cat-renda-fixa-br #22d3ee

/* Container */      max-width 520px (raio-x) / 720px (telas detalhe)
/* Padding base */   1.5rem (main) / 1.125rem (cards)
/* Radius scale */   8 / 12 / 14 / 18 / 22 / 999

/* Font */           system stack — -apple-system, "SF Pro Text", "Segoe UI"
/* Mono */           font-variant-numeric: tabular-nums (sem font separada)
/* Weights */        400, 500, 600, 700, 800

/* Motion */         pin-shake 420ms · chevron 150ms · :active toque (scale, 7a.S.2) · fill 300ms
/* prefers-reduced-motion: reduce */ respected
```

---

## Modo Plantão — dark OLED (Fase 7a.S.12, FECHA a umbrella 7a.S)

Tema escuro para uso real (plantão, madrugada, sala escura): **warm OLED, teal-como-luz**. Toggle manual + persistido, **default light**. Bloco 100% ADITIVO — nenhuma regra light foi tocada; todo o sistema pré-existente (S.1–S.11) continua funcionando idêntico.

### Toggle, persistência, boot

- `<button class="theme-toggle">` (☽/☀, glifo `aria-hidden`) no topo do Raio-X (`index.html`, dentro de `.raiox`, ao lado do `.eyebrow`) — `aria-label="Alternar tema (claro/plantão)"` + `:aria-pressed="tema === 'dark'"`.
- `alternarTema()` (`js/app.js`): flip `this.tema` → `document.documentElement.setAttribute('data-theme', tema)` (via `_aplicarTema`) → `localStorage.setItem('tema', tema)` → `window.drarthurChart.reregister()`.
- Boot (`init()`, ANTES de `tentarAutoResume()`): `this.tema = localStorage.getItem('tema') === 'dark' ? 'dark' : 'light'` — **NUNCA lê `prefers-color-scheme`** (spec §5.5: só o Dr. Arthur decide, manual + persistido; SO em dark não muda nada sem o toggle).
- `_aplicarTema` também atualiza `<meta name="theme-color">` (`#064e3b` light / `#03110a` dark) — chrome do navegador/status bar acompanha o tema.
- O toggle só existe dentro de `.raiox` (`x-show="rota === ''"`) — no instante do clique nenhuma tela de chart pode estar ativa, por construção. `alternarTema()` não re-hidrata chart nenhum: a próxima entrada em `#rentabilidade`/`#/raiox/chart`/`#proventos` já dispara `hidratarX()` (dispose+init incondicional a cada navegação) lendo os tokens recém-reregistrados — zero flash de cor antiga, porque o chart nunca fica "vivo e desatualizado" (ou não existe ainda, ou é reconstruído do zero a cada entrada na tela).

### Bloco `:root[data-theme="dark"]` — remap completo

Todo token que varia por tema ganha um 2º valor (ver tabela em "Tokens summary" acima). Categorias de tokens:
- **Surfaces**: `--neutral-50..300`, `--surface` (novo em 7a.S.12 — tokeniza os antigos `background:#fff/white` hardcoded de ~20 componentes: `.card`, `.aloca-cat`, `.dy-row`, `.chart-rent`, `.rel-card-home` etc.), `--surface-2`.
- **Texto**: `--ink`/`--gray`/`--faint`.
- **Accent (teal vira luz)**: `--accent`/`--accent-2`/`--accent-soft`/`--hero-glow`.
- **Brand teal legado**: `--g-900`/`--g-700`/`--g-500`/`--teal-700` + alphas (`--g-700-06/-12`, `--teal-14`, `--g-900-04/-07`) — tokens pré-7a.E.23 ainda referenciados diretamente por ~20 seletores (headings, "positivo" indicators, chips). Remapeados para a MESMA família cromática do `--accent` no dark.
- **Semânticos**: `--red`, `--amber`/`--amber-700`, `--amber-bg`/`-bd`, `--pill`, `--card-topline`, `--tab-bg`, `--shadow-pressed`, `--red-50/-200/-800` (usados só por `.erro-nao-encontrado`, 100% token-based).
- **Categorias** (`--cat-*`): mais claras/saturadas que o light — legíveis como dot/série contra o fundo quase-preto (mantém a regra "texto nunca colorido por categoria", 7a.E.20).

**Aliased-token trap**: `--accent`/`--accent-2` são declarados como `var(--g-700)`/`var(--g-500)` no LIGHT — no dark ambos são sobrescritos DIRETO (não dependem do flip de `--g-700`/`--g-500`, embora estes TAMBÉM sejam sobrescritos, por consistência com os ~20 seletores legados que os referenciam sem passar por `--accent`). `--sem-up`/`--sem-down` (aliases de `--cat-acoes-br`/`--cat-fii`) NÃO precisam de override próprio — CSS custom properties resolvem `var()` no ponto de uso (computed-value time), então herdam o valor dark de `--cat-*` automaticamente via cascata; só os tints literais (`--sem-up-tint`/`--sem-down-tint`, rgba hardcoded) precisam de override direto.

**Component-level overrides** (fora do bloco `:root`, sob `[data-theme="dark"] .seletor`):
- `.hero` — fica um card "monumento" escuro nos DOIS temas (`background: #03110a` direto), independente do flip de `--g-900` (que vira claro para servir de heading/link em outros lugares).
- **"seg.on dark ink"** — `.pin-submit`, `.aporte-pill`, `.toast`, `.escopo-toggle button.active`, `.moeda-toggle button.active`, `.lado-B`, `.lado-S`, `.compo-seg .sl` ganham `color: #04130c` (tinta escura) — seus fundos derivam de `--g-700`/`--g-900`/`--red`/`--cat-*`, que viram claros no dark; texto branco sobre um fundo agora claro falharia AA. Um único valor de tinta, mesma convenção do mockup (`.seg.on`).
- `.champ-bar .bw` (trilho da barrinha #s-dy) → `background: var(--neutral-50)` — "afunda" no fundo da página (groove), distinto do `--surface-2` do card em volta.

### Teal-como-luz treatments

- **Card hairline**: `.card`, `.dy-row`, `.dy-chamada`, `.chart-rent`, `.prov-chart-card`, `.ticker-hero`, `.rel-radar-card`, `.rel-card-home`, `.aloca-cat`, `.kpi`, `.dy-champs` ganham `box-shadow: inset 0 1px 0 var(--card-topline), ...` — fio de luz no topo, profundidade sem gradiente (anti-pattern #8 preservado).
- **Tab indicator glow**: `.tab-bar-indicator` ganha `box-shadow: 0 0 14px rgba(52,211,153,.55)`.
- **Poster text-shadow**: `.poster` (#s-dy) e `.rel-poster` (capa do Relatório) ganham `text-shadow: 0 0 38px rgba(52,211,153,.3)`.
- **Sombras literais tintadas a --g-900** (fora do token `--card-shadow`/`--g-900-04/07`): `.toast`, `.tabela-wrap`, `.vazio`, `.card-link:hover/:focus-visible`, `.rel-seletor__lista` recebem `rgba(0,0,0,…)` — a versão tintada ficaria invisível contra o fundo quase-preto.
- **Polish de badges/tints** (não é correção de contraste de texto — o texto já lê via tokens): `.chip.is-neg`, `.rel-selo--intacta`, `.rel-selo--deteriorando`, `.provento-tipo-tag` ganham tints ligeiramente mais claros/visíveis no dark.

### Repaint dos gráficos ECharts (o ponto técnico)

O tema `'drarthur'` do ECharts (`js/echarts-theme.js`) e o `tooltipBase` são registrados **uma vez** no load, lendo os tokens via `getComputedStyle` — sem re-leitura, ficariam presos nos valores LIGHT mesmo depois do toggle. Mecanismo:
- `tokens` é um objeto **único e estável** (`var tokens = {}`, nunca substituído — só mutado in-place por `refreshTokens()`). Consumidores guardam `dc = window.drarthurChart` e leem `dc.tokens.x` no momento de montar cada chart — como o objeto nunca troca de referência, qualquer `dc` obtido ANTES ou DEPOIS de um `reregister()` sempre reflete os valores atuais.
- `window.drarthurChart.reregister()` — chamado por `alternarTema()`: `refreshTokens()` (re-lê todos os tokens do `:root` corrente) → `echarts.registerTheme('drarthur', buildTheme())` (novo objeto de tema com as cores frescas) → `window.drarthurChart.tooltipBase = buildTooltipBase()` (novo tooltip, `backgroundColor: tokens.surface` + `box-shadow` theme-aware via `tooltipShadow()`, que lê `data-theme` diretamente).
- `tokens.surface` (novo, lê `--surface`) — o tooltip do ECharts era hardcoded `#fff`; agora acompanha o tema.
- **Verificado**: L.1 (period-relative reanchoring via dataZoom) e L.2 (card "Período") sobrevivem a um repaint — como `hidratarRentabilidade()` sempre faz dispose+init completo a cada entrada na rota, o dataZoom/card são reconstruídos do zero lendo os dados atuais, sem estado stale.
- **Gotcha de autoria (achado nesta sub-fase)**: um comentário CSS contendo a sequência literal `*/` no meio do texto (ex. `/* ...(--g-*/--teal-700)... */`) fecha o comentário PREMATURAMENTE — todo o texto entre esse `*/` acidental e o próximo `*/` real vira CSS "solto" (não-comentário), corrompendo o parse da declaração seguinte. Causou um bug real: `--g-900` não recebia o override dark (ficava preso no valor light) enquanto `--g-700`/`--g-500`, declarados 1-2 linhas depois na mesma regra, funcionavam normalmente. Lição: nunca escrever `--algo-*/` ou qualquer `*/` não-intencional dentro de um comentário CSS.

### Contraste WCAG AA (verificado)

`--ink` sobre `--neutral-50`/`--surface` ≥ 4.5:1 (texto normal). `--gray`/`--accent`/`--red`/`--amber`/`--cat-*` sobre `--neutral-50` ≥ 3:1 (texto grande, ícones, uso gráfico dot/série). Fórmula de luminância relativa (WCAG) + trava em Playwright (`tests/e2e/modo-plantao.spec.ts`, Task 3).

### Testes e screenshots

`tests/e2e/modo-plantao.spec.ts` — 4 tasks: (1) toggle flip/persist/boot (ignora `prefers-color-scheme`) + bloco dark resolve; (2) repaint dos charts (rentabilidade/patrimônio/proventos, markPoint + tooltip mudam de cor pós-toggle, L.1/L.2 sobrevivem); (3) treatments teal-como-luz + contraste AA; (4) screenshots `page.screenshot()` (não MCP) capturando raiox/rentabilidade/alocação/proventos/#s-dy/relatório/aportar nos DOIS temas, salvos em `tests/screenshots/modo-plantao-*-{light,dark}.png` (commitados, mesma convenção dos screenshots pré-existentes de `#aportar`).

---

## Relatório Mensal (7a.Q.3) — componentes

Tela push `#/raiox/relatorio` reusa a casca `.tela-detalhes` + `.breadcrumb`. **Zero token novo** — toda a tela é composta de tokens existentes (`--num-*`, `--sem-*`, `--cat-*`/class dots, `--ink`, `--neutral-*`, `--gray`, `--g-*`, `--mono`, `--red`, `--amber*`, `.kpi`, `.flag`, `.grifo--amber`):

- `.rel-card-home` — card de entrada na home Raio-X (surface branca, `--neutral-200` border, chevron `--g-700`); empty-safe (`x-show="relUltimoMes"`).
- `.rel-secao` / `.rel-secao__titulo` / `.rel-prosa` — seções de prosa (título `--num-lg`/`--g-900`; corpo `--ink`, max 68ch, prosa escapada antes de linkificar `[n]`). `.rel-secao--manchete` (§leitura_mes — título `--num-xl`) e `.rel-secao--destaque` (§nao_funcionando — layout: borda-esquerda arredondada + padding/gap; peso por hierarquia, **calma, sem vermelho gritante**). Desde 7a.S.9 a *cor* de `.rel-secao--destaque` vem inteira de `.grifo--amber` (abaixo) — a classe de layout não carrega mais `--sem-down` própria.
- `.rel-selo` (+ `--intacta` cinza / `--pressao` `--sem-down` âmbar / `--deteriorando` `--red`) — veredito de tese por ticker. **Forma (glyph `aria-hidden` ●/◐/▽) + texto + cor**, nunca cor sozinha (deuteranopia coberta). Modelado em `.aloca-alvo__delta`.
- `.rel-kpis` reusa `.kpi` para os mini-cards do dossiê (performance/decomposição/renda). `.rel-radar` / `.rel-concentracao` / `.rel-evidencias` / `.rel-prestacao` — listas. `.rel-seletor` — dropdown de meses (botão + itens ≥44px). `.rel-loading`/`.rel-erro`/`.rel-vazio` — estados mutuamente exclusivos (skeleton com `prefers-reduced-motion: reduce` honored; degradação graciosa).

### Capa editorial + evento mensal (7a.S.9)

- **Capa editorial** — `.rel-capa` no header (abaixo do `.breadcrumb`, que mantém botão "←" + `.eyebrow.eyebrow--accent` intactos): `.rel-poster` mostra o mês do artefato como poster de 2 linhas (mês / ano, `--num-poster-lg` 46px mono `--accent`, via `formatMesAno(relMes.mes)` partido em `relPosterMes`/`relPosterAno`) + `.rel-veredito-linha` logo abaixo ("Veredito do mês: …", `--num-sm`/`--surface-2`). **Sem fabricar dado**: o artefato `relatorio_mensal_v1` não tem campo `veredito`/`headline`/`resumo` (ver `validar_artefato` no repo principal) — o getter `relVeredito` deriva a **1ª frase literal** da seção `leitura_mes` ("Leitura do mês", o panorama narrativo já escrito pelo motor `/relatorio-mensal`) via `_primeiraFrase`; só o rótulo "Veredito do mês:" é UI, o texto é 100% do artefato. `.rel-seletor__btn` ganha `white-space: nowrap` (corrige o micro-atrito Fable §3 — "Maio 2026 ▾" não quebra em 2 linhas @320px); dropdown inalterado.
- **Evento mensal — dot "não lido"** — `.rel-dot` (7px, `var(--amber)`) no `.rel-card-home` (quando o último mês não foi lido) e em cada `.rel-seletor__item` cujo mês ainda não foi aberto. Estado 100% client-side: `relRead` (Alpine state, espelhado em `localStorage.relRead`) é um mapa `{'YYYY-MM': true}`; `mesLido(mes)` lê, `_marcarMesLido(mes)` grava e é chamado dentro de `carregarRelatorioMes` no sucesso — abrir um mês marca ele lido e o dot some (home + seletor), sem backend/schema. **A11y**: dot é `aria-hidden` + par `.sr-only` "não lido" (textual, não só cor+pulse). **Motion**: `.rel-dot::after` anima um anel via `transform: scale`/`opacity` (nunca `box-shadow` com `rgba()` ad-hoc — zero cor hardcoded fora de `:root`); a animação só existe dentro de `@media (prefers-reduced-motion: no-preference)`, então reduced-motion vira um dot estático (o `::after` fica parado sobre o próprio dot, mesma cor/tamanho).
- **Grifo âmbar consagrado** — `classeSecao('nao_funcionando')` retorna `"rel-secao--destaque grifo--amber"`: o box ganha `.grifo--amber` (S.1: `border-left: 3px solid var(--amber)` + `--amber-bg`/`--amber-bd`), a colocação canônica do Apêndice B ("Relatório = âmbar", variante distinta do `.grifo` accent — nunca leem como o mesmo sinal). Os selos de veredito dentro do box (ex.: SMAL11/KISU11) são preservados intactos.
