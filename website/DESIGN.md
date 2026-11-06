---
name: Possistem QR Order Menu
description: The guest's table page, opened from the table QR code; white-label per restaurant, one accent as the cloth's band.
colors:
  accent-blue: "#1f56b8"
  accent-green: "#1d6a49"
  accent-burgundy: "#922c49"
  accent-amber: "#94520c"
  on-accent: "#ffffff"
  linen-base: "#fbf7f0"
  paper: "#fffdf9"
  ink-base: "#1b1814"
  linen: "#efefee"
  ink: "#1e232c"
  muted: "#555960"
  rule: "#d5d6d6"
  soft: "#e8ecf4"
  signal-red: "#b3261e"
  signal-red-deep: "#9b1c14"
  notice-amber: "#c27a10"
typography:
  display:
    fontFamily: "Bitter, Georgia, serif"
    fontSize: "25px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.015em"
  headline:
    fontFamily: "Bitter, Georgia, serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  brand:
    fontFamily: "Bitter, Georgia, serif"
    fontSize: "21px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Onest, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 650
    lineHeight: 1.25
  body:
    fontFamily: "Onest, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.45
  body-small:
    fontFamily: "Onest, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Onest, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.2
  meta:
    fontFamily: "Onest, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 650
    lineHeight: 1.3
  price:
    fontFamily: "Onest, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 650
    lineHeight: 1.25
    fontFeature: "\"tnum\" 1, \"lnum\" 1"
rounded:
  pill: "999px"
  plate: "50%"
  sheet: "26px"
  card: "20px"
  notice: "16px"
  field: "14px"
spacing:
  gap-xs: "4px"
  gap-sm: "8px"
  gap-md: "12px"
  gutter: "16px"
  sheet: "20px"
  section: "22px"
  footer: "48px"
components:
  button-primary:
    backgroundColor: "{colors.accent-blue}"
    textColor: "{colors.on-accent}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 22px"
    height: "52px"
  button-primary-disabled:
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
  add-button:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.plate}"
    size: "44px"
  add-button-chosen:
    backgroundColor: "{colors.accent-blue}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.plate}"
    size: "44px"
  category-tab:
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 15px"
    height: "40px"
  category-tab-active:
    backgroundColor: "{colors.accent-blue}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.pill}"
  table-band:
    backgroundColor: "{colors.accent-blue}"
    textColor: "{colors.on-accent}"
    typography: "{typography.body-small}"
    height: "40px"
  dish-photo:
    backgroundColor: "{colors.soft}"
    rounded: "{rounded.plate}"
    size: "76px"
  option-choice:
    backgroundColor: "{colors.linen}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "0 14px"
    height: "52px"
  option-choice-on:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
  input-field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "12px 14px"
    height: "48px"
  spread-bar:
    backgroundColor: "{colors.accent-blue}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.pill}"
    padding: "10px 16px 10px 12px"
    height: "64px"
  sheet:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
    padding: "{spacing.sheet}"
  out-pill:
    backgroundColor: "{colors.rule}"
    textColor: "{colors.muted}"
    typography: "{typography.meta}"
    rounded: "{rounded.pill}"
    padding: "5px 10px"
---

# Design System: Possistem QR Order Menu

> **Scope.** This file covers only the QR order menu, the page a restaurant's guest opens from the table QR code at `/qr/<menu>/<table>/` (`src/components/qr/QrMenu.tsx`, `QrVisuals.tsx`, `qr-menu.css`, mounted by `src/app/qr/[menu]/[table]/page.tsx`). Every token here is scoped under the `.qr-menu` root and its `--qr-*` custom properties. The rest of possistem.az (marketing pages, downloads, demo, plans; Montserrat / Space Grotesk, `src/styles/site.css`) is a different, undocumented system and is out of scope: do not apply these tokens there, and do not read that stylesheet as part of this one.

## Overview

**Creative North Star: "The Laid Table" (Süfrə)**

The guest's table is the page. A warm linen ground, deep ink type, and the restaurant's own colour running through it as the band of the tablecloth: the strip that names the table, the active category, the chosen dishes and the button that sends the order. Dishes sit on round plates, chosen dishes land as overlapping plates on the spread at the foot of the screen, and prices stand in one tabular column on the right. The menu begins in the first screen; there is no introduction to scroll past.

The page belongs to the restaurant, not to Possistem. The accent, logo and name are the restaurant's; the whole neutral palette is tinted from that accent, so a burgundy restaurant gets a rosy linen and a green one a sage linen without anyone choosing a second colour. Possistem appears only as a small signature link in the footer. Density is a printed menu's: flat rows divided by hairlines, one column, generous touch targets, nothing boxed.

Light only (`color-scheme: light`). The world is a laid table in restaurant light; there is no dark variant.

**Key Characteristics:**
- One accent per restaurant (blue, green, burgundy, amber), set by `data-accent`, used only for what is active or chosen.
- Neutrals derived from the accent by oklab mixing; never chosen per restaurant.
- Bitter for names of things (restaurant, category, dish sheet, receipt), Onest for everything read or tapped.
- Round plates for every dish image and every chosen dish; an empty plate when there is no photo.
- Hairline-ruled rows, not cards; prices tabular and right-aligned.
- Bottom sheets on phones, centred dialogs from 760px.

## Colors

One saturated accent on a tinted linen-and-ink neutral set; every neutral leans toward the accent.

The frontmatter lists the four accents as literals and the derived neutrals resolved for the default blue accent. The derived tokens are formulas, recomputed per restaurant: `linen` = accent 5% into linen-base, `ink` = accent 16% into ink-base, `muted` = ink 70% into linen, `rule` = ink 11% into linen, `soft` = accent 10% into paper (all `color-mix(in oklab, ...)`). The sidecar records each formula as the canonical value.

### Primary
- **Cloth Band Blue** (`accent-blue`): the default accent and the only colour that signals "active" or "chosen": the table band under the header, the active category tab, the restaurant mark's fallback plate, an add button that already holds a count, the selected option outline, the order-progress steps, the spread bar, the primary button, the focus ring and the text caret.
- **Bottle Green** (`accent-green`), **Wine Burgundy** (`accent-burgundy`), **Copper Amber** (`accent-amber`): the restaurant's alternative accents. Each replaces blue everywhere; never two on one page. White text on each passes 6:1 or better.
- **On Accent** (`on-accent`): white text and icons on any accent surface; the band's secondary text is white mixed 84% toward the accent.

### Neutral
- **Linen** (`linen`, from `linen-base`): the page ground, the option rows, the stepper and close-button wells. With blue it resolves to a cool off-white; with burgundy and amber it is visibly warm.
- **Paper** (`paper`): the lifted surfaces: sheets, the receipt card, inputs, the language select, the rim around every plate.
- **Ink** (`ink`, from `ink-base`): all primary text, and the 2px rule under each category heading.
- **Muted Ink** (`muted`): descriptions, counts, inactive tabs, unavailable dishes, fees, footer.
- **Hairline** (`rule`): 1px dividers between dishes and lines, field borders, the unavailable pill, the outer ring of plates.
- **Soft Tint** (`soft`): photo placeholders, the selected option fill, the search toggle when on.

### Status
- **Signal Red** (`signal-red`, deep `signal-red-deep`): a rejected or expired order step, and the hover colour of the "remove" text button. Fixed, not tinted by the accent.
- **Notice Amber** (`notice-amber`): the "till is not taking orders" notice, at 12% into paper, with its text a dark amber mixed into ink. Fixed, not tinted.

### Named Rules
**The Cloth Band Rule.** The accent marks what is active or chosen and nothing else. If an element is neither the table, the current category, a chosen dish, a selected option, progress, or the action that sends the order, it is not accent-coloured.

**The Tinted Linen Rule.** Neutrals are never picked per restaurant. They are mixed from the accent so the whole page shifts with one setting; a new neutral is added as another `color-mix` of the existing tokens, not as a fixed hex.

## Typography

**Display Font:** Bitter (with Georgia, serif), self-hosted variable 300–800 from `public/assets/fonts`
**Body Font:** Onest (with system-ui, sans-serif), self-hosted variable 300–800

**Character:** A sturdy slab serif for the names a menu card would print, set against a clear, slightly warm grotesque for everything the guest reads closely or taps. Both carry full latin-ext for Azerbaijani and Turkish (ə, ğ, ı, ş).

### Hierarchy
- **Display** (Bitter 700, 25px, 30px from 760px; 1.15; -0.015em): category headings, balanced wrap, over a 2px ink rule.
- **Headline** (Bitter 700, 24px; 1.2; -0.01em): the dish sheet title; the order receipt title runs at 22px.
- **Brand** (Bitter 700, 21px, 24px from 760px; 1.15; -0.01em): the restaurant name in the header, single line with ellipsis. The footer repeats the name at 650 17px.
- **Title** (Onest 650, 17px, 18px from 760px; 1.25): dish names in rows; 16px for lines in the basket.
- **Body** (Onest 400, 16px; 1.45): base text; inputs stay at 16px so phones do not zoom.
- **Body Small** (Onest 400, 14–15px): dish descriptions (clamped to two lines), the intro (max 60ch), sheet descriptions, the band text.
- **Label** (Onest 600–700, 14–16px): category tabs, option group legends, field labels, button text.
- **Meta** (Onest 600–650, 12–13px): option-group summaries, counts, step names, the unavailable pill, fees.
- **Price** (Onest 650–750, tabular lining figures): every price, total, count and quantity.

### Named Rules
**The Two Voices Rule.** Bitter names places and things (restaurant, category, the dish in its sheet, the receipt). Onest does everything else. Bitter never appears on a button, price, tab or form.

**The Tabular Column Rule.** Every number the till will charge is set in tabular lining figures, never wraps, and sits right-aligned in its own column, so prices read down the page like a printed bill.

## Layout

One centred column: `min(760px, 100% - 32px)`, widening to `min(860px, 100% - 64px)` from 1100px, so the side gutter on phones is 16px. The header (64px, 72px from 760px), the accent table band (40px) and the category tab bar (52px) stick together at the top on a 92% linen veil with a blur; sections scroll under them with a matching scroll margin. Category tabs scroll horizontally with snap and a 28px fade mask on whichever edge has more.

Dish rows are flex rows: plate (76px; 96px from 760px; 58/64px in the owner's "list" layout; 62px under 360px), then name, two-line description and option-group summary, then a right column with the price above the 44px add button. Rows are 16px tall in padding (20px from 760px) and divided by hairlines. Sections are 22px apart. The optional cover picture is a short strip (21:9, 3:1 from 760px) under the header, never a slider.

The spread is a fixed pill at the bottom, inside the column (560px wide from 1100px), clear of the safe-area inset and fading the menu out behind it. Sheets rise from the bottom on phones (full width, up to 92svh) and become centred 560px dialogs with all corners rounded from 760px. The page reserves 120px at the bottom so the last dish clears the spread.

## Elevation & Depth

Mostly flat: the menu itself is ink on linen with hairlines, and depth belongs to things that sit on the table. Plates are lifted by a paper rim plus a hairline ring and a soft downward shadow; the spread bar and sheets cast long, diffuse shadows tinted by ink or accent; the sticky header separates by blur and a hairline, not a shadow. No offset or hard-edged shadows anywhere.

### Shadow Vocabulary
- **Plate rim** (`box-shadow: 0 0 0 4px paper, 0 0 0 5px rule, 0 6px 14px -6px ink@45%`): dish photos and empty plates in rows.
- **Small plate** (`0 0 0 2px paper, 0 3px 8px -3px ink@50%`): plates in the spread and basket; on the spread bar the ring is the accent instead of paper so plates overlap cleanly.
- **Brand mark ring** (`0 0 0 3px paper, 0 0 0 4px rule`): the restaurant's logo plate.
- **Spread glow** (`0 14px 30px -12px accent@70% into black, 0 2px 6px -2px ink@40%`): the spread bar only.
- **Sheet** (`0 -20px 60px -20px ink@60%`): dish and basket sheets.
- **Receipt** (`0 1px 0 rule, 0 18px 40px -28px ink@55%`): the order status card.

### Named Rules
**The Things On The Table Rule.** Only objects that sit on the table (plates, the spread, the receipt, sheets) cast shadows. Rows, headings, tabs and the page ground stay flat.

## Shapes

Two shapes do almost all the work: the circle and the pill. Every image of food, the restaurant mark, the add button, the search toggle and the close button are circles; every tab, the language select, the search field, the primary button, the spread bar and small status pills are full pills. Rounded rectangles are reserved for surfaces that hold content: sheets (26px, top corners only on phones), the cover and receipt (20px), the notice (16px), option rows and text fields (14px). Dish rows have no shape at all: they are bands between hairlines. Empty plates are drawn, not imaged: a radial gradient of well, glaze line and rim, tinted by the accent.

### Named Rules
**The Round Plate Rule.** Food is always on a round plate. A dish without a photo gets the empty plate in the same slot, never a letter, icon or stock picture.

## Components

### Buttons
Confident and soft-edged, the accent spent only on the one action that moves the order forward.
- **Shape:** full pill (`pill`), 52px tall.
- **Primary:** accent fill, white 700 text with tabular figures; in the dish sheet it spreads full width with label left and running price right.
- **Hover / Focus:** brightness 1.08 on hover (real pointers only); press scales to 0.98; focus is a 2px accent outline offset 2px.
- **Disabled:** ink 22% into paper, paper-coloured text.
- **Text button:** muted 650 13px underlined with 3px offset, 44px tall; turns signal red on hover (it removes a line).
- **Icon button:** 44px circle on linen (close); hairline fill on hover.

### Add Button
- **Rest:** 44px paper circle with a 1.5px inset ink-28% ring and a plus icon.
- **Chosen:** fills with the accent and shows the count in tabular 750 figures instead of the plus.
- **States:** soft tint on hover (pointer only), scales to 0.9 on press, 35% opacity when the till is closed or the dish is unavailable.

### Category Tabs
- **Style:** 40px pills, Onest 600 14px, muted text on no fill; the current category fills with the accent and white text. Inactive tabs darken to ink on hover.
- **Search:** a 40px round toggle left of the tabs opens a pill search field (42px, paper, hairline border that turns accent on focus).

### Dish Row (signature)
- **Slots:** plate, text, side column. When any dish in the menu has a photo, every row keeps the plate slot (empty plate if none); when none do, the plate column is dropped for the whole menu.
- **Unavailable:** restyled in place: name and price go muted, the price is struck through, the photo goes greyscale at 60%, and a meta pill replaces the add button. The column never breaks.
- **Hover:** the photo inside its plate scales to 1.06 (pointer only).

### Table Band
The cloth's band: a 40px accent strip directly under the header with a table icon and "order to the table" followed by the table label in white 700. It is how the guest knows the order is theirs.

### The Spread (signature)
- **Bar:** a 64px accent pill fixed at the bottom: overlapping small plates (12px overlap) of the chosen dishes, the count and table line, and the total with an arrow. It rises in on first use; each newly added dish drops onto it with a short overshoot.
- **Basket sheet:** lines with 46px plates, options and notes in meta, a small stepper and a remove text button, then fees, total (22px tabular ink) and the full-width send button.

### Sheets
- **Style:** paper, 26px top corners, optional 16:10 photo, Bitter headline with price beneath, close button top right, scrollable body, footer with stepper and primary button over a hairline.
- **Option groups:** a legend with the group name and a meta summary (accent when a choice is still required); each choice a 52px linen row with native radio or checkbox in the accent; the selected row turns soft tint with a 1.5px inset accent ring. Extra price sits right in tabular muted figures.

### Inputs / Fields
- **Style:** 48px (textarea 76px), paper, 1px hairline, 14px radius, 16px text, muted placeholder.
- **Focus:** the border turns the accent; no glow.

### Order Status
A paper receipt card (20px radius, receipt shadow) with a three-step progress strip (3px top rules: hairline, then accent when done; the current step breathes; a failed step turns signal red), the Bitter title, table and total, and an explanatory line. Notices about the till being closed use the amber notice with a pill action.

### Loading
Three empty plates breathing in sequence (0.15s apart) beside a muted line.

## Do's and Don'ts

### Do:
- **Do** take every derived colour from the `--qr-*` mixes of the accent; adding a fifth accent means one new `data-accent` value and nothing else.
- **Do** keep every touch target at 44px or more and inputs at 16px.
- **Do** set every price, total and count in tabular lining figures, right-aligned, nowrap.
- **Do** put food on round plates and keep the plate slot fixed across rows, using the empty plate when there is no photo.
- **Do** restyle unavailable dishes in place (muted, struck price, greyscale plate, pill) rather than hiding or reordering them.
- **Do** gate hover styles behind `@media (hover: hover)` and drop all animation under `prefers-reduced-motion: reduce`.
- **Do** keep Possistem to the footer signature; the restaurant's name, mark and colour lead.

### Don't:
- **Don't** box dishes in cards or a photo grid; dishes are hairline-ruled rows.
- **Don't** open with a hero banner or a slider; the cover is at most a short strip under the header.
- **Don't** use the accent for decoration, headings or body text.
- **Don't** fill a missing dish photo with a letter, icon or stock food picture (the restaurant mark's initial is the logo fallback, not a dish placeholder).
- **Don't** set Bitter on controls, prices or tabs.
- **Don't** use offset or hard-edged shadows; only objects on the table cast soft ones.
