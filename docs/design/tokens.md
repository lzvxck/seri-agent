---
version: alpha
name: seri
description: "Design tokens for seri's web surfaces. Two colors, one grid, no accent hue."

colors:
  ink: "#141413"
  canvas: "#faf9f5"
  on-ink: "#ffffff"
  ink-subtle: "rgba(20, 20, 19, 0.64)"
  ink-hairline: "rgba(20, 20, 19, 0.14)"
  on-ink-subtle: "rgba(250, 249, 245, 0.68)"
  on-ink-hairline: "rgba(250, 249, 245, 0.16)"

typography:
  display:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: 58px
    fontWeight: 700
    lineHeight: 1.1
  heading:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: 58px
    fontWeight: 700
    lineHeight: 1.1
  body:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: -0.24px
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.4

spacing:
  base: 2px
  scale: [2, 4, 8, 12, 16, 22, 58, 68]

radius:
  sm: 8px
  md: 16px
  lg: 24px

shadows:
  card: "rgba(0, 0, 0, 0.01) 0px 2px 2px 0px, rgba(0, 0, 0, 0.02) 0px 4px 4px 0px, rgba(0, 0, 0, 0.04) 0px 16px 24px 0px"
  elevated: "rgba(0, 0, 0, 0.01) 0px 2px 2px 0px, rgba(0, 0, 0, 0.02) 0px 4px 4px 0px, rgba(0, 0, 0, 0.04) 0px 16px 24px 0px"

motion:
  duration-fast: 100ms
  duration-base: 200ms
  duration-slow: 800ms
  easing: "cubic-bezier(0.16, 1, 0.3, 1)"

breakpoints: [768px]
---

# Design tokens — web surfaces

The token set for `apps/web`, `apps/lab` and `apps/portal`. The terminal has its own,
narrower system that derives from this one: [`tui.md`](./tui.md).

**These values are the spec, not preferences.** They are implemented in
`packages/ui/styles/globals.css`; that file and this one must agree. Where a token here has
a name (`--ink`, `--canvas`), that name is the one the CSS uses — not a description of it.

## Rationale

Two colors and no accent hue. Every element is either ink or canvas, which removes the
question "what color should this be" from every component decision that follows. The
restraint is the point: when color *is* eventually introduced for a single call to action,
it lands against a page with nothing competing for attention.

The near-black is `#141413` rather than pure black and the ground is `#faf9f5` rather than
pure white. Both are deliberate — a warm off-white reads as paper instead of a screen, and
holds up for long-form reading without the clinical coldness of `#ffffff`.

The type scale is dense on purpose. A 12px body with -0.24px tracking is well under the
contemporary 16px norm; it suits install commands, pricing tables and technical prose read
by someone who came here on purpose. Display and heading both anchor at 58px/1.1 so a hero
line carries weight without a second scale step to maintain.

## 1. Visual theme

**Minimalist and structural.** Generous negative space, hairline borders, and shadows so
faint they are nearly imperceptible (0.01–0.04 opacity). Layering is communicated by
position and space rather than by elevation effects.

## 2. Color system

| Token | Value | Use |
|---|---|---|
| `--ink` | `#141413` | Text, borders, and dark surfaces. Structural anchor and maximum contrast. |
| `--canvas` | `#faf9f5` | The dominant page surface. |
| `--on-ink` | `#ffffff` | Text and elements sitting on an ink fill. |
| `--ink-subtle` | `rgba(20, 20, 19, 0.64)` | Secondary text on canvas. |
| `--ink-hairline` | `rgba(20, 20, 19, 0.14)` | Hairline rules and separators on canvas. |
| `--on-ink-subtle` | `rgba(250, 249, 245, 0.68)` | Secondary text on an ink surface. |
| `--on-ink-hairline` | `rgba(250, 249, 245, 0.16)` | Hairline rules on an ink surface. |

Border, surface and text all resolve to `--ink`. That is not an oversight — a border that
is the same value as the text reads as structure rather than decoration.

There is **no accent hue**. Secondary messaging comes from the subtle tokens above (the ink
at reduced alpha), never from a new color. Adding one is a design-system change, not a
component choice.

`globals.css` also aliases shadcn's token contract (`--background`, `--foreground`,
`--primary`, `--border`, `--ring`, …) onto the tokens above, so shadcn components inherit
this system instead of shipping their own neutral palette.

### The inverse surface

The two colors are a pair, not a hierarchy: the same system read the other way round gives
ink as the ground and canvas as the content. `globals.css` carries the tokens for it —
`--on-ink`, `--on-ink-subtle`, `--on-ink-hairline` — and `[data-surface="ink"]` flips the
focus ring so it never disappears against a `#141413` fill.

**Where it is used, and only there: the holding page.** Every real page in web, lab and
portal is the light reading; `<ComingSoon>` is the single dark screen in the product, and
that is deliberate rather than incidental. A holding page has no navigation, no next step
and no returning visitors — it is the one surface whose entire job is a single first
impression, so it is the one place where being its own moment costs nothing downstream.
`body:has(.holding)` carries the ink onto the body so overscroll does not reveal canvas
behind it.

Accepted on 8 August 2026 as a deliberate exception to that "no next step" framing:
`apps/lab`'s holding page (seriora.ai, the main domain) now carries exactly one next step, a
waitlist email capture rendered through `<ComingSoon>`'s `after` slot, on the same ink
surface. It lives there rather than on `apps/web` (a subdomain, seri-agent.seriora.ai)
because the waitlist belongs on the site visitors actually land on. The tension with the
paragraph above is left standing rather than resolved by editing it away: a holding page can
still be its own moment while offering the one thing worth asking a first-time, one-shot
visitor for. The dark-surface rule below (no *second* dark screen) is untouched by this.

Adding a second dark screen is not a small decision and should not be made by analogy to
this one. If a real page ever needs the inverse surface, the question to answer first is
what happens at the boundary — a visitor moving between a dark page and a light one inside
the same product reads it as two products.

## 3. Typography

**Both faces are system stacks.** This repo ships no font file and makes no `@font-face` or
`next/font` call, so what renders is whatever the OS provides:

- `--font-sans`: `Arial, Helvetica, sans-serif` — display, heading and body
- `--font-mono`: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` — code, install
  commands, technical content

The mono stack is not negotiable in the way the sans stack is: a proportional fallback would
break column alignment in the install commands, which are the landing page's primary call to
action.

| Role | Size | Weight | Line height | Tracking |
|---|---|---|---|---|
| Display / heading | 58px | 700 | 1.1 | — |
| Body | 12px | 400 | 1.4 | -0.24px |
| Mono | 16px | 400 | 1.4 | — |

Display and heading share one step deliberately — the tight 1.1 leading concentrates weight
for a hero statement, and a second heading size would be a scale to maintain for no gain.
Mono sits *above* body so code and commands stand out rather than recede.

## 4. Components and patterns

What `globals.css` actually establishes, rather than what a component library might add:

- **Radius scale:** `sm` 8px, `md` 16px, `lg` 24px.
- **Shadows:** `card` and `elevated` are identical — three stacked layers at 0.01 / 0.02 /
  0.04 opacity. If two elevations ever need to differ visually, that is a token change, not
  a per-component override.
- **Focus ring:** 2px solid `--ink` at 2px offset with `sm` radius, applied on
  `:focus-visible`. It inverts on `[data-surface="ink"]`.
- **Buttons:** ink fill, `--on-ink` text, `sm` or `md` radius.
- **Inputs:** ink border, canvas ground, body-size text.

**Interaction states** come from opacity shifts, not from color. That follows from having no
accent hue — there is nothing else for a hover state to be.

## 5. Spacing and layout

**Base unit: 2px.** Every Tailwind step therefore lands on this grid. The scale
`[2, 4, 8, 12, 16, 22, 58, 68]` maps to Tailwind steps 1, 2, 4, 6, 8, 11, 29, 34.

- **Micro (2–4px):** icon-to-text gaps, optical adjustments
- **Small (8–12px):** padding inside buttons, gaps between inline elements
- **Medium (16–22px):** section padding, gaps between components
- **Large (58–68px):** major section breaks, hero spacing

**One breakpoint, at 768px** — a two-tier responsive strategy. Below it: single column, full
width, generous vertical spacing for touch. At or above it: multi-column, tighter horizontal
spacing.

## 6. Motion

| Token | Value | Use |
|---|---|---|
| `duration-fast` | 100ms | Micro-interactions — button press, tooltip, icon swap |
| `duration-base` | 200ms | Standard transitions — modal entrance, hover shift |
| `duration-slow` | 800ms | Longer reveals — hero entrance, staggered lists |
| `--ease-brand` | `cubic-bezier(0.16, 1, 0.3, 1)` | Everything |

The easing curve is biased hard toward ease-out: it leaves immediately and settles quickly,
so interactions read as responsive rather than floaty.

## Accessibility

### Contrast ratios

**Main pair — `#141413` on `#faf9f5`**
- Luminance of `#141413` ≈ 0.02, of `#faf9f5` ≈ 0.97
- Contrast ratio ≈ **20.7:1**

This exceeds WCAG AAA (7:1) by a wide margin.

**Inverse pair — `#ffffff` on `#141413`**
- Luminance of `#ffffff` = 1.0, of `#141413` ≈ 0.02
- Contrast ratio ≈ **21:1**

### Minimum requirements

- **Touch target size:** every interactive element must be at least 44×44 CSS pixels
  (WCAG 2.1 AAA). Given a 12px body, careful padding is critical — a 12px link inside a
  tight card needs roughly 28–32px of vertical padding to clear the threshold.
- **Focus indicator:** a visible 2px stroke in `--ink` at 2px offset, never obscured by
  shadows or borders; `--on-ink` on dark surfaces.
- **Motion:** under `prefers-reduced-motion: reduce`, transitions collapse to 50–100ms. No
  parallax, no auto-playing video without pause controls.

  **Collapsing duration alone is not enough, and the failure is not obvious.** The blanket
  rule in `globals.css` sets `animation-duration: 0.01ms` but leaves `animation-delay`
  untouched — so a staged entrance keeps its full schedule and plays as a sequence of hard
  pops over seconds, which is worse than either extreme. A reduced-motion path has to drop
  the stagger too, or it is not near-instant in any sense a visitor experiences.

  **Reduce means less movement, not less design.** What the preference guards against is
  vestibular triggers: translation, scale, parallax, looping motion. Opacity is not one of
  them, and a short cross-fade is the correct substitute for a movement-based entrance — a
  hard cut is not. `<ComingSoon>` is the worked example: under `reduce` every element fades
  in place at 100ms on a stagger finishing in ~400ms, and the idle loops are removed
  outright.

  **Verify it by measuring, not by looking.** Headless Chrome reports
  `prefers-reduced-motion: reduce` by default, so a screenshot run that does not emulate the
  media feature explicitly captures the collapsed path while appearing to capture the normal
  one. Read `document.getAnimations()[i].effect.getTiming().duration` under both values
  rather than trusting an image.
