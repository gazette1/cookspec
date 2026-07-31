# Cookspec

cookspec.xyz

Single-file project brief, design system, and reference implementation.
Read Part 1 before writing code. Read Part 2 before writing any UI. Cite
sections explicitly when you generate, for example "applying the rule weights
from Part 2, Effects", rather than silently drifting.

## Contents

1. Project brief. Positioning, object model, screens, guardrails, build order.
2. Design system. Type, color, spacing, motion, effects, components, voice, anti-patterns.
3. Reference implementation. The compiled card as working HTML with the tokens applied.

---

## Part 1. Project brief

### 1. What this is

Cookspec takes any recipe input and compiles it into one canonical table in the
Cooking for Engineers merge notation.

Inputs accepted: TikTok, Instagram Reel, YouTube Short, article URL, pasted
text, photo of a page or card.

Output: a single card. Ingredients down the left edge. Operations merging column
by column to the right, resolving into the finished dish.

It also validates the numbers. Unit conversion, density checks that catch
creators' gram errors, and gap research when a source omits a quantity.

### 2. Positioning

**Frame of reference.** A recipe capture tool, shelved next to recipe savers and
clippers, for people who want the recipe itself out of a link, a video, or a
photo.

**Point of difference.** The only one that returns the recipe as a single merge
table, ingredients on the left folding column by column into the finished dish,
with every unit and density checked before you cook.

**Audience.** Engineers, analysts, and type A home cooks who hate scrolling food
blogs and vertical video to find the actual recipe.

**Competitive set.** ReciMe, Crouton, and similar savers. They import. None
output this notation. None validate the math.

**Governing idea for the interface.** This is a build tool that happens to
output a recipe. Not a recipe app with a technical skin.

### 3. Core object model

```
Source        raw input plus detected type, creator handle, timestamp
Extraction    transcript or DOM text or OCR, with per-claim provenance
Ingredient    name, quantity, unit, normalized mass in grams, confidence
Operation     verb, duration, temperature, the set of inputs it merges
Card          ordered ingredients plus a merge tree of operations
Validation    per-quantity status: ok | converted | corrected | unresolved
```

Every quantity on a card carries a status. Nothing renders without one.

### 4. The three screens

Everything else is secondary navigation.

#### 4.1 The paste bar

One field, centered on the dark counter. Accepts URL, pasted text, or a dropped
photo without asking which is which. The field detects the type.

- No source-type tabs.
- No account gate before the first compile. The card is the demo.
- One quiet line beneath naming accepted sources. Nothing else on the route.
- Do not add a marketing section below the fold on the app route.

#### 4.2 The compile

This is the trust screen. Competitors do not have one. Do not show a spinner.

Stream the build log line by line as steps resolve, with real timings:

```
fetching source          ok    1.2s
extracting transcript    ok    8.4s
parsing ingredients      18 found
resolving units          16 ok, 2 converted
density check            1 correction
researching gaps         1 unresolved
building table           ok
```

It buys patience for a genuinely slow operation, and it is the only moment where
the user watches the math happen. A silent success looks identical to a scrape.

Amber for in-progress lines. Cream for resolved.

#### 4.3 The card

Cream paper, ink rules, sitting on the dark counter with a soft shadow.

Render as a real DOM table. Never an image. You lose selection, search, print,
and accessibility.

Card header carries the validation strip:

```
18 QUANTITIES   2 CONVERTED   1 CORRECTION   1 UNRESOLVED
```

That line is the product in four words. Each segment is tappable and filters the
table to the affected cells.

### 5. Five details that carry the wedge

Build these before anything else on the roadmap.

1. **Corrections shown, not swallowed.** Strike the source value, set yours
   beside it. Tap reveals the reasoning: source said 250 g flour for 2 cups,
   density says 240 g. Fixing silently means the user never learns you are worth
   paying for.

2. **Gaps flagged, never guessed.** An unresolved quantity gets an amber cell
   and a stated confidence where you researched a likely value. Presenting a
   guess as fact is the one failure that kills this product.

3. **Provenance in the footer.** Source thumbnail, creator handle, deep link
   back to the timestamp. Trust for the user, and it defuses the scraping
   complaint from creators.

4. **Serving scaler plus mass/volume toggle.** You hold density data, so cups to
   grams converts correctly where competitors cannot. Put the toggle on the
   card, not in settings. It is a live demonstration of the moat.

5. **Library as a table, not a board.** Dense sortable rows. Columns: dish,
   source type, ingredients, unresolved flags, date compiled. This audience
   sorts by unresolved flags. Nobody here browses hero photography.

### 6. The hard problem: the table on a phone

Six operation columns at 390px is unreadable, and most first sessions arrive
from TikTok and Reels on mobile.

Do not build a second recipe format. Build a second projection of the same
structure.

- **Wide view.** Horizontal scroll, ingredient column pinned left. Default on
  tablet and desktop.
- **Step view.** Default on phone. One operation column at a time, full width,
  with the ingredient rows feeding into it highlighted and everything upstream
  collapsed to a summary chip. A small map at the top shows position in the
  merge.
- Toggle between them. Persist the choice.

Step view is also cook mode: large type, high contrast, wake lock on, timers
wired to any operation carrying a duration, tap targets sized for greasy hands.

### 7. Guardrails

- Never present a researched value as a sourced one.
- Never render a quantity without a validation status.
- The card must survive print to one page. Test it.
- No hero food photography anywhere in the product. See Part 2,
  Anti-patterns, for why.
- Amber means attention and active state only. It is never a primary button.
- Do not ship a dark mode toggle. Dark is the product.

### 8. Build order

1. Card renderer. Static JSON in, merge table out. No network.
2. Validation strip and cell states, wired to that JSON.
3. Step view projection from the same JSON.
4. Paste bar plus URL extraction for article pages, the easiest source.
5. Compile log, streaming.
6. Video transcript extraction.
7. Photo OCR.
8. Serving scaler and mass/volume toggle.
9. Library.
10. Print stylesheet and PDF export.

Steps 1 through 3 are the whole product. Everything after is intake.

### 9. Copy rules

Applies to UI strings, marketing, and commit messages.

- Short declarative sentences.
- No em-dashes. No exclamation points.
- No hype words: leverage, unlock, seamless, elevate, empower, harness.
- Name things by what the user controls, not by how the system is built.
- Buttons say what happens. "Compile" produces a toast that says "Compiled".
- Errors state what failed and what to do next. They do not apologize.
- Empty states are an invitation to paste something.

### 10. Stack

Not fixed by this document. Choose per project conventions. The only
requirements: the card is server-renderable, the compile log streams, and the
table is real HTML.


---

## Part 2. Design system

Cookspec visual system. Portable across the app, the marketing site, print, and
social. Read before generating any surface. Cite sections when you apply them.

---

### Identity

A dark kitchen counter at night, one warm light on, and a single sheet of cream
paper ruled in ink sitting on it. The paper is a semiconductor datasheet that
happens to describe a dish: title block at the top, dense measured table below,
revision line at the bottom. Cookspec is a precision instrument, not a content
farm. Everything on screen is either a measurement, a rule that organizes
measurements, or a control that changes them. Warmth comes from the light and
the paper, never from decoration.

### Reference stack

What to steal, and specifically what.

| Reference | Steal |
|---|---|
| Semiconductor datasheets, 1975 to 1990 | The title block, the revision line, a table header sitting under a double rule |
| Antique accounting ledgers | Rule weight hierarchy: hairline between rows, medium under the header, heavy at the total |
| Linear, Railway | App chrome only. Tight spacing, keyboard-first, build log patterns |
| Stripe Docs | Pairing prose with monospace data without the page reading as a terminal |
| Nutrition Facts panel | The validation strip. Three rule weights, all-caps micro-labels, right-aligned numerals |
| Observable notebooks | The framing of a document that is computed rather than written |

### Typography

Family: **IBM Plex**. Three cuts of one family, industrial design heritage, free.

```
--font-mono:   'IBM Plex Mono', ui-monospace, monospace
--font-sans:   'IBM Plex Sans', system-ui, sans-serif
--font-serif:  'IBM Plex Serif', Georgia, serif
```

Upgrade path if budget allows: swap the mono for Berkeley Mono. Keep Plex for
the rest.

#### Roles

| Role | Face | Size | Weight | Tracking |
|---|---|---|---|---|
| Card dish title | serif | 32px | 500 | -0.01em |
| Ingredient name | serif | 15px | 400 | 0 |
| Quantity and unit | mono | 13px | 400 | 0 |
| Operation label | sans | 13px | 500 | 0 |
| Operation detail | mono | 12px | 400 | 0 |
| Micro-label, all caps | sans | 11px | 600 | 0.08em |
| Compile log | mono | 13px | 400 | 0 |
| UI body | sans | 15px | 400 | 0 |
| Marketing headline | serif | 48px | 500 | -0.02em |

#### Non-negotiables

- `font-variant-numeric: tabular-nums` on every numeral. Columns must align.
- Units render in the same mono at 60% opacity, never a different size.
- Ingredient names never set in mono. Mono is for measured things only.
- Micro-labels are always all caps, 11px, 0.08em tracking.
- Body line-height 1.5. Table cell line-height 1.35.
- `-webkit-font-smoothing: antialiased` on the dark surface only. Leave the
  cream card unsmoothed so it reads as ink on paper.

### Color

Start warm. A kitchen at night is not a terminal, so the dark surface carries
brown in it.

```css
:root {
  --counter:        #14110E;  /* page background */
  --counter-raised: #1F1A16;  /* panels, input field, log */
  --counter-line:   #2E2620;  /* dividers on dark */

  --cream:          #F4EDE1;  /* the card */
  --cream-shade:    #E8DFCE;  /* alternating band, card footer */
  --ink:            #1A1A18;  /* text on cream */
  --ink-soft:       #1A1A18A6; /* 65%, secondary text on cream */

  --rule:           #1A1A1826; /* 15%, hairline between rows */
  --rule-heavy:     #1A1A1866; /* 40%, header and resolve rules */

  --amber:          #E0A32E;  /* attention, active, unresolved */
  --amber-dim:      #8A6420;  /* hover, inactive rules on dark */
  --olive:          #6E8B5A;  /* a correction that was applied */
  --brick:          #9C4A38;  /* compile failure only */
}
```

#### Rules of use

- **Amber never becomes a button.** Amber means attention and active state. A
  primary action is cream on dark, which reads as ink on paper and stays inside
  the brand.
- **Olive marks work you did.** A user should be able to scan a card and see
  every cell you corrected.
- **Brick is reserved for a failed compile.** Not for warnings, not for
  destructive buttons.
- Never place amber text on cream below 16px. Contrast fails. Use amber as a
  cell background wash at 12% with ink text instead.

### Spacing

Base unit 4px. The card lives on a 4px baseline grid so the ruled lines land
predictably.

```
--s1: 4px    --s2: 8px    --s3: 12px   --s4: 16px
--s5: 24px   --s6: 32px   --s7: 48px   --s8: 64px   --s9: 96px
```

- Table cell padding: 8px 12px.
- Card padding: 32px desktop, 20px mobile.
- Section rhythm on marketing: 96px desktop, 48px mobile.
- No container wider than its table needs. Let the card be the width of its
  content, capped at 1100px.

### Radius and elevation

- Card radius **2px**. Paper does not have 16px corners.
- App chrome radius **4px** maximum.
- **One shadow in the entire product**, on the card:
  `0 24px 48px -12px #00000080, 0 2px 4px #0000004D`.
- Everything else is flat. Depth comes from rules, not from boxes.

### Motion

```
--ease-standard: cubic-bezier(0.2, 0, 0, 1);
--ease-exit:     cubic-bezier(0.4, 0, 1, 1);
--d-micro:  120ms;
--d-base:   200ms;
--d-merge:  600ms;
```

Nearly nothing moves. Two exceptions.

1. **Compile log.** Lines appear as steps resolve. Real timing, never faked.
   Each line fades in over `--d-micro`.
2. **Card assembly.** See the Effects section below.

Mobile durations drop by 30%. Honor `prefers-reduced-motion: reduce` by
rendering both end states immediately.

### Effects

**The signature: merge assembly.** One effect, once, on first render of a card.

Ingredient rows fade in top to bottom over 200ms. Then operation columns wipe in
left to right, each column revealing over 120ms and staggered 80ms, resolving
into the final dish cell. Total 600ms.

This is the only decorative moment in the product and it earns its place because
it shows the merge happening. Never replay it on navigation, filter, or scale
change.

Two supporting effects, both quiet:

- **Rule weight as hierarchy.** Hairline between ingredient rows. Medium rule
  under the header and at every column boundary. Heavy rule where the merge
  resolves into the finished dish. This is the brand, expressed structurally.
- **Cell state wash.** Corrected cells carry an olive left border 2px.
  Unresolved cells carry an amber background at 12%. No icons, no badges.

### Components

**Paste bar.** Full width up to 720px. Height 56px. Background
`--counter-raised`, 1px border `--counter-line`, radius 4px. Focus state:
border becomes `--amber`, no glow, no ring. Placeholder in `--font-mono` at 60%
opacity: `paste a link, text, or drop a photo`.

**Primary button.** Cream background, ink text, 4px radius, 40px height,
`--font-sans` 15px weight 500. Hover: background lifts to `#FFFFFF`. No
transitions beyond `--d-micro`.

**Secondary button.** Transparent, 1px `--counter-line` border, cream text.

**Card.** Cream background, 2px radius, the one shadow, 32px padding. Title
block at the top: dish name in serif, then a micro-label row with yield, source
type, and compile date, separated by a heavy rule.

**Validation strip.** Sits directly under the title block. All-caps micro-labels
with mono counts. Segments separated by 24px. Each segment is a toggle that
filters the table. Active segment gets an amber underline 2px.

**Table.** `border-collapse: collapse`. Ingredient column left, quantity column
right-aligned mono, operation columns using `rowspan` for the merge. Sticky
first column on horizontal scroll.

**Compile log.** `--counter-raised` panel, mono 13px, 4px radius, 20px padding.
Status column right-aligned. Amber for pending, cream for resolved, brick for
failed.

### Voice

- Short declarative sentences.
- No em-dashes. No exclamation points.
- Banned: leverage, unlock, seamless, elevate, empower, harness, effortless,
  delightful, magic.
- Never say "AI-powered". Say what it does.
- Buttons state the outcome. "Compile" produces a toast reading "Compiled".
- Errors state what failed and the next action. They do not apologize and they
  are never vague.
- Empty states are an invitation to paste something, not a mood.

Tagline: **Any recipe, one table, numbers checked.**

### Anti-patterns

Explicit refusals. These matter as much as the positive specs.

- **Hero food photography.** This is the visual signature of the content farms
  Cookspec is positioned against. One stock image of a rustic bowl undoes the
  whole brand. If imagery is needed, use engraved or technical line art of
  equipment, ink on cream, at the same weight as the rules. If a photograph is
  unavoidable, photograph the printed card on a real counter.
- Gradients of any kind.
- Glassmorphism, frosted panels, backdrop blur.
- Purple. Terracotta near `#D97757`. Acid green.
- Emoji in the interface.
- Pill buttons and radii above 4px.
- Rounded avatars.
- Stock illustration of people cooking.
- Centered hero with three feature columns and icons in pastel circles.
- A dark mode toggle. Dark is the product.
- Any product name or feature name ending in "ify".

### Remix notes

- **Web to mobile.** Spacing scale tightens one step. Type scale compresses.
  Motion drops 30%. Card becomes step view. Color and effects hold unchanged.
- **Web to print.** Counter disappears, cream becomes the page, shadow is
  removed, rules stay. Must fit one page. This is a real feature, not an export
  afterthought.
- **Web to social card.** One dish title, one merge table cropped to three
  columns, one amber unresolved cell visible. Nothing else.


---

## Part 3. Reference implementation

Saved at `reference/card.html`. Static merge table, no network, no framework.
It exists so you can check rule weights, cell states, and the assembly timing
before building the real renderer.

It demonstrates both validation states: a corrected milk quantity carrying the
density reasoning, and an unresolved salt quantity flagged amber.
