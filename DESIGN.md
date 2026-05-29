# Design

> Sistema de design extraído de `css/app.css` (vanilla CSS, ~1500 linhas, mobile-first, max-width 520px raio-x / 720px telas detalhe). Formato baseado em Google Stitch DESIGN.md. Source of truth de tokens e componentes do PWA.

---

## Visual atmosphere

**Calmo, denso, médico.** Layout flat com hierarquia tipográfica clara, paleta teal-quente sobre warm-neutral (não cool gray, não pure white), sombras suavemente tintadas para a cor do brand, motion mínimo (pin shake + chevron rotation + card lift sutil). Densidade calibrada por contexto: raio-X home é airy (cards generosos, ≤5 elementos por viewport); telas de drilldown (#ativo, #proventos) são densas (tabelas com tabular-nums, KPIs em grid 2-col ou 3-col).

Variance baseline: **6.5/10** (assimetria pontual + tipografia Monument no hero + tab bar como elemento de identidade). Motion: **4.5/10** (cross-fade tabs + indicator slide + count-up hero + push slides + segmented; tudo gated por `prefers-reduced-motion`, sem GSAP/Framer). Density: **4/10 → 7/10** (varia por tela).

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
- `--amber: #f59e0b` — Warning. Drift positivo, gradient end de proventos-ytd. (Não é mais a cor de FII desde 7a.E.20.)
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

| Token de uso | Tamanho | Weight | Line-height | Letter-spacing | Onde |
|---|---|---|---|---|---|
| Hero valor | 2rem (32px) | 700 | 1.1 | -0.015em | `.hero-valor` (post-7a.G.2 Pass 4 distill) |
| Proventos YTD | 1.875rem (30px) | 800 | — | -0.01em | `.proventos-ytd` |
| Ticker hero VM | 2rem (32px) | 800 | — | -0.5px | `.ticker-vm-grande` |
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
- ❌ Não usar gradiente em texto exceto no `.proventos-ytd` (caso intencional, único, tintado teal→amber).
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

### Hero Monument (raio-x, 7a.I.2)

Variant tipográfica do hero quando renderizado dentro do shell de tab bar. Mantém o card sólido `--g-900` flat (sem gradient/glassmorphism — anti-pattern #8 vigente); a diferença vs hero padrão é apenas a fonte mono + escala + tracking. Escolha de identidade ("Monument"), não decoração.

```css
.hero-valor-monument {
  font-family: var(--mono);            /* ui-monospace stack — não custom font */
  font-size: var(--hero-mono-size);    /* 3.25rem */
  font-weight: 800;
  letter-spacing: var(--hero-mono-tracking);  /* -0.025em */
  font-variant-numeric: tabular-nums;
  line-height: 1.0;
  color: #fff;
}
```

Hero size foi calibrada para `2.5rem` no raio-x enxuto pós-7a.I (cabe em 1-viewport sem sparkline/chips/CTA, que foram removidos como parte do enxuto).

### Bloco "Últimos 7 dias" (raio-x, 7a.J.1)

Seção entre hero e último-aporte que decompõe a variação patrimonial de 7 dias em três componentes contábeis: **aportes líquidos** (compras − vendas), **proventos** (dividendos + JCP + rendimentos), **mercado** (residual = delta − aportes − proventos). Identidade contábil garantida no backend (`_build_ultimos_7d`, schema v2.13): `delta_patrim_brl ≡ aportes_liq + proventos + mercado` (até 1 centavo).

```css
.r7d-head    { /* label small-caps 11px + delta mono 1.125rem 700 (--ink/--g-700/--red) */ }
.r7d-row     { /* sans label gray + valor mono 0.9375rem colorido por sinal */ }
.r7d-lista li{ /* grid 1fr auto auto auto: ticker · qty · valor · .flag */ }
```

**Pattern de render:** pure Alpine (sem helper JS externo). `x-show="ultimos7dVisivel()"` esconde o bloco quando schema é v<2.13 (sem `ultimos_7d`) ou quando DB recém-bootstrapped não tem snapshot ≥7d E listas vazias. Cada `.r7d-lista` aparece via `x-show` apenas quando array é não-vazio (semana calma fica só com headline + decomp). Sem ECharts (Monument text-only); sem motion individual (segue regra global do shell — entrada via `x-transition.opacity.duration.220ms` herdada da tab raio-x).

**Tokens reusados (zero novo):** `--mono` (headline + valores), `--g-700` (sinais positivos), `--red` (sinais negativos), `--gray` (labels secundários), `--ink` (texto principal), `--neutral-100/200` (borders), classe global `.flag` (bandeiras BR/EUA).

### Tab bar (Monument)

Bottom nav fixa, 5 destinos text-only (sem ícones), indicator 2px no **topo** da tab ativa que desliza via `transform translateX`. Single element (`.tab-bar-indicator`) compartilhado entre todas as tabs — não é pseudo `::before` por tab.

```css
.tab-bar {
  position: fixed;
  bottom: 0; left: 0; right: 0;
  height: calc(var(--tab-bar-height) + env(safe-area-inset-bottom, 0px));
  padding-bottom: env(safe-area-inset-bottom, 0px);
  background: var(--tab-bar-bg);
  border-top: 1px solid var(--tab-bar-border);
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  z-index: 100;
}
.tab-bar a {
  font-size: 13px; font-weight: 600;
  color: var(--tab-inactive);
  letter-spacing: 0.02em;
  min-height: 44px;
}
.tab-bar a[aria-current="page"] { color: var(--tab-active); }
.tab-bar-indicator {
  position: absolute; top: 0;
  height: var(--tab-indicator-height);
  background: var(--tab-active);
  transform: translateX(var(--tab-indicator-x, 0px));
  transition: transform 220ms cubic-bezier(0.16, 1, 0.3, 1);
}
```

**Tokens:** `--tab-bar-height: 56px`, `--tab-bar-bg: var(--neutral-50)`, `--tab-bar-border: var(--neutral-200)`, `--tab-active: var(--g-900)`, `--tab-inactive: var(--gray)`, `--tab-indicator-height: 2px`.

**Persistência:** visível nas 5 tabs e nas telas de push (`#ativo/:ticker`, `#/raiox/chart`). Some apenas na PIN screen (gate de auth, antes do shell ser hidratado).

**Anatomia visual:** indicador 2px no topo (não bottom-underline cliché Material/Bootstrap), peso 600 ativa / 400 inativa, color shift `--gray` → `--g-900`. Sem badges, sem ícones, sem dot decorativo. Diferenciação carregada por peso + tracking + indicator.

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
Variantes: `.card.proventos` (gradient warm green→amber background), `.card-link` (clicável com hover translateY).

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

> **7a.E.23:** a vista "Alvo" de #alocacao usa uma variante refinada — ver `### Aloca Alvo v2` abaixo. A trilha-categoria nessa variante ganha cap-dot superior no marker e gradient muted no fill.

### Política accordion (DEPRECATED — substituído em 7a.E.23)
A vista "Alvo" de #alocacao não usa mais accordion. Mantida só pra histórico:
o markup `.politica-card[data-collapsed]` + chevron rotacionável foi
removido na reforma visual; cards agora são sempre expandidos com
identidade --cat-* (ver `### Aloca Alvo v2`).

### Aloca Alvo v2 (7a.E.23)
Vista "Alvo" de #alocacao reescrita com hierarquia baseada em identidade
de categoria. Sempre expandida (sem accordion).

**Anatomia do card:** header grid `auto 1fr` (lead esquerdo: overline
"CATEGORIA" + nome + "ALVO" + número-poster mono 2.375rem cor `--cat-*`;
breakdown direito: atual mono + drift chip semantic) + trilha-categoria
14 px com marker preto + cap-dot pseudo-elemento + label "alvo" minúsculo
+ foot ticks "0 %" / "X % (alvo)" + sections `.aloca-alvo__cesta`
separadas só por `border-top 1px` (anti-card overuse) + lista de ativos
`.aloca-alvo__ativo` com mini-bar 3 px + delta pill mono direcional.

**Regra de cor crítica (identidade × semântica):**
- **Identidade** (cor da categoria via `--cat-*`): número-poster,
  fill da trilha-categoria + cesta-trilha + mini-bar normal.
- **Semântica** (fixa, independente de `--cat`): delta pill `↑ −X pp` em
  `--sem-up` (= `--cat-acoes-br`); delta pill `↓ +X pp` em `--sem-down`
  (= `--cat-fii`); mini-bar overflow em `--sem-down`. O colapso semântico
  → identidade é intencional: a paleta corporativa já carrega significado
  de ação (verde = aportar; amber = acima do alvo).

**Naming:** "Cesta passiva" e "Cesta de picks" na UI. Backend mantém
`bucket.tipo: "passive" | "picks"` no JSON / Python / `alocacao.yaml`.
Rebrand é 100 % de apresentação via helper `labelCestaTipo(tipo)`.

**Motion:** trilha-categoria + cesta-trilha + minibar animam
`transform: scaleX(--fill-pct)` em 700 ms `cubic-bezier(.16, 1, .3, 1)`,
cascade com stagger 60 ms por cesta e por ativo. Tudo sob
`@media (prefers-reduced-motion: no-preference)`. Default off em quem
prefere redução.

```css
.aloca-alvo__alvo-big    { font-size: 2.375rem; font-family: var(--mono); color: var(--cat); }
.aloca-alvo__minibar .fill--over { background: var(--sem-down); }
```

### PIN screen
Input central grande (2rem text + tabular-nums + letter-spacing 0.5rem) + botão full-width primary teal.

### Toast
Fixed top com safe-area-inset, gradient verde, border-radius 999px (pill), pointer-events none.

### Tabela (movimentos / proventos)
Sticky `<th>`, `tabular-nums`, font 0.875rem, max-height 320px com scroll-y interno em `.tabela-wrap`.

---

## Motion

**Filosofia: motion serve função, nunca decora.** Sem GSAP. Sem Framer. Sem perpetual loops. Sem auto-play.

### Animações ativas
1. **PIN shake** (420ms cubic-bezier) — feedback de erro de senha. `@media (prefers-reduced-motion: no-preference)` envelopa o keyframe (default off em quem prefere).
2. **Chevron rotation** (150ms ease) em política accordion. Respeita `prefers-reduced-motion: reduce` (transition: none).
3. **Card-link hover** — `transform: translateY(-1px)` + shadow lift, 0.15s. Hover-only (não mobile).
4. **Aloc-preenchimento** — width transition 300ms ease quando a barra se atualiza.
5. **Toast fade** — controlado por JS (não CSS), enter/exit suave.

### Curvas
- Padrão: `ease` ou `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out)
- PIN shake: `cubic-bezier(0.36, 0.07, 0.19, 0.97)` (decelerada com pequeno overshoot)

### Hardware acceleration
- Animar APENAS `transform` e `opacity`. Width em `.aloc-preenchimento` é exceção pontual (barra horizontal, sem reflow).
- Nunca animar `top`, `left`, `height`, `padding`, `margin`.

### prefers-reduced-motion
Respeitado em PIN shake (envelope `@media`) e chevron (override transition: none). Demais transitions são curtas o suficiente (≤300ms) para não causar problema, mas idealmente futuras animações também deveriam respeitar.

### Motion em gráficos (ECharts, Fase 7a.E.19)

Gráficos do PWA usam motion calibrada — mais expressiva que o resto do app, mas dentro de "calmo médico" (sem celebrar, sem bounce, sem stagger pesado):

1. **Entrada (1º render):** 600ms cubic-out. Lines: path drawing L→R. Bars: growth from baseline com stagger 30ms por barra.
2. **Hover:** 100ms. Tooltip fade-in. Point ring 1.0 → 1.1. Bars não-hover opacity 1.0 → 0.85.
3. **Mode transition:** 400ms cubic-out. `setOption` merge → morph automático (datasets + eixos animados juntos).
4. **Drilldown selection:** 200ms cubic-out. Fade não-selecionadas opacity 1.0 → 0.55 (proventos modo Mensal).

Todas as 4 regras zeram via `prefers-reduced-motion: reduce`. Single source of truth: `js/echarts-theme.js` exporta `window.drarthurChart.motionConfig` (rebuilds on MediaQueryList change).

### Motion de navegação (app shell, Fase 7a.I.6)

App shell tem 5 animações calibradas dentro do mesmo orçamento de "calmo médico" — sem slide cliché iOS, sem swoosh:

| Animação | Duração | Curva | Property | Reduced-motion |
|---|---|---|---|---|
| Tab cross-fade (conteúdo) | 220ms | cubic-bezier(0.16,1,0.3,1) | opacity | zera |
| Tab indicator slide | 220ms | cubic-bezier(0.16,1,0.3,1) | transform translateX | zera |
| Hero count-up (Raio-X) | 700ms | cubic-out via RAF | textContent | reveal instantâneo; flag em sessionStorage limita a 1×/sessão |
| Push #ativo / #/raiox/chart | 280ms | cubic-bezier(0.16,1,0.3,1) | transform translateX + opacity | zera |
| Segmented Aloca (Atual/Alvo) | 280ms | cubic-bezier(0.16,1,0.3,1) | opacity + transform | zera |

**Single source of truth:** `js/transitions.js` exporta `window.drarthurNav.motion` (objeto `{tabFade, tabIndicator, countUp, push, segmented, easing, reduced}`); rebuild automático ao alternar `prefers-reduced-motion`. Espelha o padrão de `window.drarthurChart.motionConfig`. O helper `window.drarthurNav.applyCountUp(el, target, formatter)` faz o RAF do hero respeitando o flag `reduced`.

### Chart #rentabilidade — period-relative reanchoring (Fase 7a.L.1)

Chart histórico do #rentabilidade reanchora dinamicamente conforme o `dataZoom` é movido. Sem zoom (range 100%), Y mostra **cumulativo desde origem** (1 + crescimento_total − 1). Com zoom em `[startIdx, endIdx]`, Y vira **cumulativo desde primeiro ponto visível** via chain rule: `y[i] = growth[i] / growth[startIdx] − 1`. Benchmark recebe o mesmo tratamento. Sub-título `<p class="chart-rent-subtitulo">` acima do chart explicita a âncora ("Cresceu desde Mmm/AA") e atualiza via Alpine state `rentabilidadeSubtitulo`.

Implementação: `hidratarRentabilidade` em `js/app.js` computa `growthPortfolio[]` e `growthBenchmark[]` em init (reconciliando `anualizado=true` → cum via `(1+aa)^(days/365.25)` com `anualizado=false` já cum). Listener `chart.on('datazoom', ...)` lê `getOption().dataZoom[0]` (startValue/endValue em category mode, startValue/endValue ou start/end fallback), mapeia para índices, chama `reancorar(growthArr, startIdx, endIdx)` e atualiza séries via `setOption({series: [...]})`. ECharts faz diff implícito + animação morph via `motionConfig`.

Os 3 cards de métrica abaixo do chart (Origem/YTD/12m) **mantêm valores anualizados** — o chart e os cards medem coisas diferentes propositalmente.

### Card "Período" (Fase 7a.L.2)

Acima dos 3 cards fixos (Origem/YTD/12m) aparece um 4º card `.rent-periodo` que reflete a janela atual do `dataZoom`:

- **Título dinâmico**: `Origem` quando full range (startIdx=0 + endIdx≥maxIdx); `Período · mai/2025 → mai/2026` quando handles arrastados (português, mês abreviado minúsculo).
- **Métricas**: XIRR a.a. + TWR a.a. + linha `vs {CDI|S&P 500}` (label segue escopo ativo).
- **Cálculo**: TWR a.a. via chain rule sobre `growthPortfolio[]` que L.1 já calcula; XIRR a.a. via **Newton-Raphson em JS puro** sobre flows da janela (`construirFlows(hist, iA, iB)` = `[-nav[iA], ...cashflows[iA+1..iB-1], +nav[iB]]`). Benchmark simétrico (TWR via `benchmark_growth` ratio; XIRR via `flowsBenchmark` escalado pelo crescimento do índice).
- **Schema dependency**: consome `rentabilidade.{escopo}[.moeda].historico_periodo` (mensal `[{data, nav, cashflow, benchmark_growth}]`, schema v2.14).
- **Edge cases**: Newton-Raphson não converge (janela muito curta, all-outflows) → `benchXirr = null` → bench row renderiza `'—'` em vez de spread enganoso (`?? 0` mostraria `portfolio_xirr` como diferença).
- **Motion**: zero transição — atualização on-drag direto via Alpine. Mesma diretriz de L.1 sobre subtítulo. (Anti-pattern explícito: animar valores num card que muda em tempo real durante drag é distractor.)
- **Implementação**: hook `this.recomputarPeriodo(startIdx, endIdx)` chamado por (a) final de `hidratarRentabilidade`, (b) `aoMoverZoom(chart)` (mesmo handler que L.1 registra), (c) `selecionarMoeda(m)` quando escopo EUA. Estado Alpine `periodoCustom = {iniIdx, fimIdx, twr, xirr, benchTwr, benchXirr, titulo}`. Utilitárias puras top-of-file: `newtonRaphsonXirr`, `construirFlows`, `flowsBenchmark`, `parseMesData`, `gerarTituloPeriodo`.
- **CSS isolado**: classe `.rent-periodo` separada de `.rent-grupo` (preserva invariante "3 grupos fixos" dos specs antigos que assertam `toHaveCount(3)`). Estilo espelha `.rent-grupo` intencionalmente.

---

## Anti-patterns banidos

Aplicações futuras e refactors NUNCA podem introduzir:

1. **Pure black** (`#000000`). Use `--ink: #1a1d1c`.
2. **Pure white** em backgrounds amplos. Use `--neutral-50` ou `--neutral-100`. Branco puro só em elementos pequenos (cards, inputs).
3. **Cool gray** (azul/violeta tintado). Toda escala neutral é warm-tinted.
4. **Inter, Roboto, Geist, Satoshi** ou qualquer custom font. System fonts são suficientes.
5. **Glassmorphism decorativo.** Banido em todo o app. (Exceção pré-7a.G.2 do `hero-delta` foi removida na distill — chip agora é flat tint rgba sem `backdrop-filter`.) Sem exceções vigentes; qualquer reintrodução exige justificativa explícita em PR.
6. **Gradient text decorativo.** O único `background-clip: text` aceito é `.proventos-ytd` (intencional, semantic green→amber).
7. **AI-purple/blue glow shadow.** Toda sombra é tintada para teal `--g-900`.
8. **Hero metric template** (big number + label + supporting stats + gradient accent). Hero do app pós-7a.G.2 distill é card sólido `var(--g-900)` flat: label uppercase, valor 2rem peso 700, delta-pill flat. Sem gradients, sem `::after`, sem glassmorphism — explicitamente NÃO o template SaaS genérico.
9. **3-equal-cards horizontal grid.** O app não tem isso. Se feature row for necessária, usar zig-zag ou stack vertical.
10. **Cards-inside-cards-inside-cards.** Nesting máximo é 2: `.card > .conteúdo`. Política accordion é `.politica-card > .politica-ativos > .politica-ativo` mas os filhos não são cards visualmente (sem border, sem shadow, só padding).
11. **Animação celebratória** (confetti, glow, badge unlock, ECharts markPoints decorativos como estrelas/balões). Banido por design principle (calma sob qualquer condição de mercado).
12. **Bouncing chevron / scroll arrow** em hero. Banido — assume que o usuário sabe scrollar.
13. **Custom mouse cursor.** Banido — quebra acessibilidade e perf.
14. **Side-stripe borders** (`border-left: 4px solid` em alerts/cards). Não usados.
15. **Emoji em UI text.** Não usado. Bandeiras (🇧🇷, 🇺🇸) são ícone funcional, não decoração — são exceção legítima.
16. **Tema default ECharts** (paleta azul/amarelo/vermelho cliché). Sempre usar tema `'drarthur'` (`js/echarts-theme.js`).
17. **Gradient fill em series area** de chart ECharts. Linhas sólidas (ou dashed para aporte cumulativo / benchmark) sem fill decorativo.
18. **3D charts.** O PWA é 2D plano, mobile-first.
19. **Animação bounce / elastic / scale > 1.1** em gráficos. Apenas `cubicOut` / `cubicInOut`, durações ≤600ms.
20. **markPoint celebratório** (estrelas, balões, glow pulsante) em gráficos.
21. **Tooltip default ECharts** com border colorida acompanhando a série. Tooltip do app sempre branco + border `--neutral-200` (custom HTML via `drarthurChart.tooltipFormatterAxis`).
22. **Legend toggle persistente em mobile.** Em viewport `< 360px`, legenda escondida ou inline minimal.
23. **Stagger entre elementos > 50ms.** Default em barras é 30ms.
24. **Tab bar com ícones decorativos** (lucide/feather/emoji). Monument é text-only — peso 600/400 + letter-spacing + indicator 2px topo carregam a diferenciação. Se feedback de usabilidade vier, fallback documentado é hairline SVG monoline 1.5px; até lá, banido.
25. **Bottom-underline cliché** em tab ativa (linha grossa colorida abaixo do label, padrão Material/Bootstrap). O app usa indicator 2px no **topo** da tab — escolha estética + reduz competição visual com border-top da própria tab bar.

---

## Accessibility

- Touch targets ≥44px em interativos (PIN, btn-bloquear, classe-row).
- Contrast WCAG AA (a paleta foi escolhida com isso em mente; verificar antes de mudar tokens).
- Foco visível com `outline: 2px solid var(--teal/--g-500/--g-600); outline-offset: 2-4px;` em hero-link, btn-bloquear, política-header, row-link.
- Sinal positivo/negativo usa **forma + texto + cor** (▲/▼ + valor + cor), nunca cor sozinha. Daltonismo (deuteranopia) coberto.
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
/* Greens  */        --g-700-12 rgba(4,120,87,0.12)
/* Teal    */        --teal-14  rgba(20,184,166,0.14)
/* G-900   */        --g-900-04 rgba(6,78,59,0.04)
                     --g-900-07 rgba(6,78,59,0.07)

/* Mono (Monument) */ --mono ui-monospace, SF Mono, Cascadia Mono, JetBrains Mono, Menlo, Consolas
                      --hero-mono-size 3.25rem  --hero-mono-tracking -0.025em

/* Tab bar */        --tab-bar-height 56px  --tab-bar-bg var(--neutral-50)
                     --tab-bar-border var(--neutral-200)  --tab-active var(--g-900)
                     --tab-inactive var(--gray)  --tab-indicator-height 2px

/* Class dots */     EUA #1e6091  FIIs #b8731f  Renda Fixa BR #0e7490  Ações BR #047857  Cripto #6d4ea8

/* Container */      max-width 520px (raio-x) / 720px (telas detalhe)
/* Padding base */   1.5rem (main) / 1.125rem (cards)
/* Radius scale */   8 / 12 / 14 / 18 / 22 / 999

/* Font */           system stack — -apple-system, "SF Pro Text", "Segoe UI"
/* Mono */           font-variant-numeric: tabular-nums (sem font separada)
/* Weights */        400, 500, 600, 700, 800

/* Motion */         pin-shake 420ms · chevron 150ms · card-lift 150ms · fill 300ms
/* prefers-reduced-motion: reduce */ respected
```
