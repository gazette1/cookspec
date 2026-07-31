# design.md, CookSpec

Portable design system. Source DNA: Russ's inspo screenshot (dark mobile recipe app, honey-amber accent, photography-forward) fused with the product's core artifact, the Cooking for Engineers table. Voice and anti-slop gates inherit from the vault note "Voice and Brand Rules" and are restated here so this file stands alone.

## Identity

A compiler for recipes. The site is a dark kitchen counter at night: warm near-black surfaces, honey-amber light, appetite-driven photography, quiet chrome. The output is the deliberate opposite: a cream paper spec card ruled in ink, the compiled table, sitting on the counter like a printed artifact. The interface recedes, the card is the hero. The product should feel like a precision tool that respects cooking, never like a content farm.

## Typography

- Display (h1, h2, card titles): Charter, "Iowan Old Style", "Palatino Linotype", Georgia, serif. Weight 700. Editorial serif against a dark app shell is the identity pairing.
- UI and body sans: "Segoe UI", "Avenir Next", system-ui, sans-serif. Weights 400 and 600.
- Paper card interior: the serif stack, weight 400, ink color. The card reads as print.
- Scale (px): 13 micro, 14 UI, 16 body, 18 lead, 22 h3, 28 h2, 40 h1, 56 hero. Line height 1.1 display, 1.55 body. Letter spacing 0 (serifs carry character without tracking tricks).
- Later upgrade: a bundled display face (Fraunces class) is allowed only as self-hosted files, and fetching them needs a network go-ahead first. Never Inter, Roboto, Arial, or Space Grotesk as primary.

## Color

- Counter (page ground): #14110C
- Surface (cards, inputs, chips): #201C15
- Surface border: #3A342A
- Text primary: #F4EFE6
- Text secondary: #A69F92
- Placeholder: #7D7668
- Accent, honey amber, always a solid fill: #EFA352. Hover: #D98D3F. Text on accent: #1A1408. Brand meaning: oven glow and caramelized honey, the moment cooking happens.
- Paper card ground: #FBF6E3
- Paper ink (text and table rules): #26231B
- Paper secondary: #5C5648
- Correction marker on paper: #B8722C (darker amber, readable on cream)
- No other hues. Data-encoding color ramps are permitted later for real data only.

## Spacing

Base 4px. Scale: 4, 8, 12, 16, 24, 32, 48, 64, 96. Page gutter 24. Content measure: 920px shell, 620px prose.

## Motion

- Durations: 150ms hover, 250ms entrance. Easing: cubic-bezier(0.2, 0.8, 0.2, 1).
- Permitted: color and border shifts on hover, one fade-rise when a compiled card first renders.
- Forbidden: parallax, scroll-jacking, infinite loops, animated backgrounds, anything decorative without function.

## Effects (signature, exactly two)

1. Paper on counter: the compiled card is cream paper with one soft shadow, 0 6px 24px rgba(0, 0, 0, 0.35), square-ruled table cells inside a 14px-radius sheet. Print CSS strips the counter and shadow entirely; the card must print clean on white.
2. Compile stamp: correction footnote markers render in accent and are the only colored marks inside the paper, so the eye lands on what the validator changed.

## Components

- CTA button: solid #EFA352 pill, 14px sans 600, text #1A1408, no gradient, no glow.
- Input: #201C15 surface, 1.5px #3A342A border, 10px radius, 16px text, placeholder #7D7668. Focus: border #EFA352.
- Chip: pill, surface fill, 14px sans; active chip is solid accent.
- Radius scale (never uniform): 999px chips and CTA, 20px dark surface cards, 14px paper card sheet, 10px inputs, 0 table cells.
- Stat row: 14px secondary sans, inline icons only when they encode information.
- Recipe card (paper): title 22px serif 700 ink, table 15px serif, cell padding 7px 10px, 1.5px ink rules, prep rows centered, ingredient cells left-aligned, step cells centered and vertically middled, footnotes 13px paper-secondary.

## Voice

- Plain factual statements. No em-dashes. No exclamation points. No superlatives or hype.
- Banned words: leverage, unlock, harness, empower, seamless, elevate.
- Copy must fail if a competitor name is swapped in (say what only this product does: compiles any recipe into one table).
- Temperatures in Fahrenheit. Cite sources when the card corrects a creator's numbers.

## Anti-patterns (hard gates)

- No gradients anywhere: not on buttons, text, or backgrounds. Accent is solid.
- No glassmorphism, glow orbs, animated blobs, or animated light.
- No purple. No blue-to-purple SaaS wash.
- No centered hero with three icon-in-circle feature columns. No decorative logo grids. No border-left accent stripes.
- No uniform border radius; use the radius scale.
- No stock shadcn or Tailwind default components.
- No Inter, Roboto, Arial, or Space Grotesk as the primary face.
- Left-align body and headings; center only prep rows and step cells inside the table, where the notation demands it.
- Every hover or animation needs a functional reason.
- Audit every artifact for em-dashes and exclamation points before shipping.
