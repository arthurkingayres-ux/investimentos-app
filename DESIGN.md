# Design

> Sistema de design extraído de `css/app.css` (vanilla CSS, ~1500 linhas, mobile-first, max-width 520px raio-x / 720px telas detalhe). Formato baseado em Google Stitch DESIGN.md. Source of truth de tokens e componentes do PWA.

---

## Visual atmosphere

**Calmo, denso, médico.** Layout flat com hierarquia tipográfica clara, paleta teal-quente sobre warm-neutral (não cool gray, não pure white), sombras suavemente tintadas para a cor do brand, motion mínimo (pin shake + chevron rotation + card lift sutil). Densidade calibrada por contexto: raio-X home é airy (cards generosos, ≤5 elementos por viewport); telas de drilldown (#ativo, #proventos) são densas (tabelas com tabular-nums, KPIs em grid 2-col ou 3-col).

Variance baseline: **5/10** (assimetria pontual, não cinemática). Motion: **3/10** (estática + microtransições funcionais, sem GSAP/Framer). Density: **4/10 → 7/10** (varia por tela).

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
- `--amber: #f59e0b` — Warning. Cripto-related, drift positivo, classe-dot.dot-fiis, gradient end de proventos-ytd.
- `--amber-light: #fbbf24` — Reserva (não em uso atual).
- `--red: #b91c1c` — Danger / perda. PIN error, chip.is-neg, lado-S, kpi-valor.is-neg, drift-neg.

### Cores secundárias por classe (alocação)
- EUA: `#0284c7` (sky blue) — `.classe-dot.dot-eua`
- FIIs: `var(--amber)` — `.classe-dot.dot-fiis`
- Ações BR: `var(--g-700)` — `.classe-dot.dot-acoes-br`
- Cripto: `#a855f7` (purple) — `.classe-dot.dot-cripto`

### Neutrals (warm-tinted)
- `--ink: #1a1d1c` — Primary text. Levemente tintado pra warm (não pure black).
- `--gray: #6b7065` — Secondary text. Greenish-neutral pra harmonizar com teal.
- `--neutral-50: #fafaf7` — Background body. Off-white quente, não pure white.
- `--neutral-100: #f5f5f0` — Subtle dividers, hover states em política.
- `--neutral-200: #e7e5de` — Card borders, separadores principais.
- `--neutral-300: #d4d4d0` — Reserva (não em uso atual, exceto via transparency).

### Shadows (tintadas)
- `--card-shadow: 0 1px 2px rgba(6, 78, 59, 0.04), 0 4px 16px rgba(6, 78, 59, 0.07)` — Sombra padrão de cards. Tintada para `--g-900` (não preto cru).
- Hero shadow: `0 12px 32px rgba(6, 78, 59, 0.22), 0 2px 6px rgba(6, 78, 59, 0.12)` — Mesma família, mais densa.
- Aporte-pill shadow: `0 2px 8px rgba(4, 120, 87, 0.25)` — Tintada para `--g-700`.
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
| Hero valor | 2.625rem (42px) | 800 | 1.05 | -0.025em | `.hero-valor` |
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
Gradient teal escuro com radial highlight + box-shadow tintada. Conteúdo em camadas: label uppercase, valor grande tabular-nums, delta-pill com backdrop-blur.

```css
.hero {
  background:
    radial-gradient(120% 180% at 0% 0%, rgba(20, 184, 166, 0.35) 0%, transparent 55%),
    linear-gradient(145deg, var(--g-900) 0%, var(--g-700) 55%, var(--teal) 140%);
  border-radius: 22px;
  padding: 1.5rem 1.25rem 1.75rem;
  color: #fff;
}
```
Delta-pill é o ÚNICO uso intencional de glassmorphism (`backdrop-filter: blur(10px)` + `border: 1px solid rgba(255,255,255,0.22)`).

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

### Política accordion
Card com header em grid 2-row + chevron rotacionável + lista de ativos colapsável.

```css
.politica-card[data-collapsed="true"] .politica-chevron { transform: rotate(-90deg); }
@media (prefers-reduced-motion: reduce) { .politica-chevron { transition: none; } }
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

---

## Anti-patterns banidos

Aplicações futuras e refactors NUNCA podem introduzir:

1. **Pure black** (`#000000`). Use `--ink: #1a1d1c`.
2. **Pure white** em backgrounds amplos. Use `--neutral-50` ou `--neutral-100`. Branco puro só em elementos pequenos (cards, inputs).
3. **Cool gray** (azul/violeta tintado). Toda escala neutral é warm-tinted.
4. **Inter, Roboto, Geist, Satoshi** ou qualquer custom font. System fonts são suficientes.
5. **Glassmorphism decorativo.** O único uso aceito é hero-delta pill (`.hero-delta` com backdrop-blur). Cartões com blur "porque fica bonito" são banidos.
6. **Gradient text decorativo.** O único `background-clip: text` aceito é `.proventos-ytd` (intencional, semantic green→amber).
7. **AI-purple/blue glow shadow.** Toda sombra é tintada para teal `--g-900`.
8. **Hero metric template** (big number + label + supporting stats + gradient accent). Hero do app já é deliberadamente diferente: gradient teal + radial highlight + delta pill, NÃO o template SaaS genérico.
9. **3-equal-cards horizontal grid.** O app não tem isso. Se feature row for necessária, usar zig-zag ou stack vertical.
10. **Cards-inside-cards-inside-cards.** Nesting máximo é 2: `.card > .conteúdo`. Política accordion é `.politica-card > .politica-ativos > .politica-ativo` mas os filhos não são cards visualmente (sem border, sem shadow, só padding).
11. **Animação celebratória** (confetti, glow, badge unlock). Banido por design principle (calma sob qualquer condição de mercado).
12. **Bouncing chevron / scroll arrow** em hero. Banido — assume que o usuário sabe scrollar.
13. **Custom mouse cursor.** Banido — quebra acessibilidade e perf.
14. **Side-stripe borders** (`border-left: 4px solid` em alerts/cards). Não usados.
15. **Emoji em UI text.** Não usado. Bandeiras (🇧🇷, 🇺🇸) são ícone funcional, não decoração — são exceção legítima.

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
/* Text */           --ink   #1a1d1c  --gray   #6b7065
/* Surfaces */       --neutral-50 #fafaf7  --neutral-100 #f5f5f0
                     --neutral-200 #e7e5de  --neutral-300 #d4d4d0
/* Shadow */         --card-shadow: tinted to --g-900

/* Class dots */     EUA #0284c7  FIIs #f59e0b  Ações BR #047857  Cripto #a855f7

/* Container */      max-width 520px (raio-x) / 720px (telas detalhe)
/* Padding base */   1.5rem (main) / 1.125rem (cards)
/* Radius scale */   8 / 12 / 14 / 18 / 22 / 999

/* Font */           system stack — -apple-system, "SF Pro Text", "Segoe UI"
/* Mono */           font-variant-numeric: tabular-nums (sem font separada)
/* Weights */        400, 500, 600, 700, 800

/* Motion */         pin-shake 420ms · chevron 150ms · card-lift 150ms · fill 300ms
/* prefers-reduced-motion: reduce */ respected
```
