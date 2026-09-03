# Udaan Frontend Reimagining — Implementation Plan

**Status:** Design specification, ready for implementation.
**Scope:** Presentation layer only. No functional/mechanical changes, no backend changes.
**Constraint:** Every colour in the app comes from the Udaan logo (as gradient or flat) or the grey surface ladder. Nothing else.

---

## 0. How this plan was derived (not invented)

| Input | Method | Result |
|---|---|---|
| Logo colours | Pixel-sampled `src/assets/udaan-mark.png` per petal | `#2150cc` `#2d6fef` `#2593d7` `#21c1c1`; saturated extremes `#08a3b6`→`#5f95ff` |
| Contrast | WCAG 2.1 relative-luminance computed for every pairing | See §1.4 — **raw indigo fails, this changes the design** |
| Elevation model | [Linear design system](https://github.com/voltagent/awesome-design-md/blob/main/design-md/linear.app/DESIGN.md) — luminance stacking, 4-step ladder, hairline borders over shadows | §1.1 |
| Surface/border craft | [Raycast design system](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/raycast/DESIGN.md) — 4-step ladder, hairline `1px` borders, inset "keyboard key" highlight, 98% achromatic, body weight 500 | §1.1, §2.1, §4 |
| Interaction/motion rules | [Vercel Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines) (fetched live) | §3, §5 |

**The single most important finding:** every surface in the app is currently the *same* value (`#141416` for base, elevated, glass, and chrome). That is mathematically why it "looks flat and everything looks the same" — there is no luminance delta for the eye to read as depth. Both reference systems solve this identically: a **surface ladder**, where elevation is expressed as *increasing luminance*, not drop shadows.

---

## 1. Colour system

### 1.1 Surface ladder (replaces the single flat grey)

Four steps. Each is a real, measured luminance increase. Keep `#141416` as `base` so the background the user already approved is unchanged.

```css
--surface-canvas:   #0d0d0f;  /* L=0.0041 — behind everything; ambient layer, screensaver */
--surface-base:     #141416;  /* L=0.0071 — app window panel, feature view roots (UNCHANGED) */
--surface-raised:   #1a1a1d;  /* L=0.0105 — cards, composer, message bubbles, sidebar tiles */
--surface-overlay:  #212125;  /* L=0.0154 — dropdowns, dialogs, popovers, tooltips, taskbar popups */
```

Rules:
- A surface **never** sits on a sibling of the same step. Nesting always steps up.
- Hover = advance one step (`raised` → `overlay`). Never a white tint overlay.
- Retire `--color-glass-bg`, `--color-bg-elevated`, `--color-chrome-bg` as distinct values → alias them onto the ladder so no consumer breaks.

### 1.2 Borders & highlight (Raycast method — borders carry edges, not shadows)

```css
--border-hairline:  rgb(255 255 255 / 8%);   /* default edge */
--border-strong:    rgb(255 255 255 / 14%);  /* hover / focused container */
--highlight-inset:  rgb(255 255 255 / 6%);   /* inset 0 1px 0 — the "lit top edge" */
```

Every raised/overlay surface gets `border: 1px solid var(--border-hairline)` **and** `box-shadow: inset 0 1px 0 var(--highlight-inset)`. That inset line is what makes a surface read as a physical object rather than a coloured rectangle. Drop shadows only for genuinely floating layers (dialog, dropdown, taskbar).

### 1.3 Brand ramp (logo-derived, the only chromatic colours in the app)

```css
/* Raw logo petals — GRADIENT FILL ONLY. See §1.4 for why. */
--brand-indigo: #2150cc;
--brand-blue:   #2d6fef;
--brand-cyan:   #2593d7;
--brand-teal:   #21c1c1;

/* Functional accent — lifted for contrast. ALL standalone accent use. */
--accent:       #5f95ff;  /* 6.33:1 on base — text, icons, focus rings, active states */
--accent-muted: #4d86f5;  /* 5.30:1 — secondary accent, borders */
--accent-alt:   #2fc4c9;  /* 8.64:1 — the teal end, for "live/success" semantics */
```

**Primary gradient** (verified white-legible end-to-end):
```css
--gradient-brand: linear-gradient(135deg, #2150cc 0%, #2372d2 50%, #2593d7 100%);
```
Stops at cyan, deliberately excluding teal — see §1.4.

### 1.4 Contrast constraints (measured — these are hard rules)

| Colour | On `base` | Verdict |
|---|---|---|
| `#2150cc` indigo | **2.70:1** | ❌ **Fails.** Gradient fill only. Never a border, icon, focus ring, or text. |
| `#2d6fef` blue | 4.06:1 | ⚠️ UI/large text only |
| `#2593d7` cyan | 5.46:1 | ✅ |
| `#21c1c1` teal | 8.29:1 | ✅ |
| `#5f95ff` accent | 6.33:1 | ✅ Use this for anything standalone |

| Text on gradient button | Ratio | Verdict |
|---|---|---|
| White on `#2150cc`→`#2593d7` (worst point) | **3.37:1** | ✅ Passes for **≥14px semibold** only. Keep button labels ≥13px/600. |
| White on `#21c1c1` teal | 2.22:1 | ❌ Teal fills need near-black text (`#0d0d0f`, 8.75:1) |

This is the rule that makes the palette honest: **the beautiful dark logo blues are fill colours; the lifted `--accent` does the functional work.** Do not let an implementer "just use the logo blue" for a focus ring.

### 1.5 Category accents — must change

Current `--color-accent-school/work/creativity/general` are `#6ea8fe` `#7ee2b8` `#d9a8ff` `#7fe0d0` — a purple and two greens that exist nowhere in the logo. Violates the constraint. Replace with four positions sampled along the logo's own ramp:

```css
--color-accent-school:     #2d6fef;  /* blue */
--color-accent-work:       #2593d7;  /* cyan */
--color-accent-creativity: #21c1c1;  /* teal */
--color-accent-general:    #5f95ff;  /* lifted */
```
Distinguishable by luminance + hue position, all logo-native.

---

## 2. Typography

Currently Poppins (display) + Montserrat (body). Both are geometric sans with wide apertures — pleasant, but Montserrat at 400 weight on dark surfaces is the single biggest contributor to "flat." Raycast's finding applies directly: **medium (500) body weight reads meaningfully better on dark backgrounds.**

### 2.1 Changes
- **Keep both typefaces.** No new font files. This is a weight/scale/rhythm change, not a re-typesetting.
- **Body base weight 400 → 500** app-wide. Single highest-impact typographic change.
- Enable `font-feature-settings: "calt", "kern", "liga"` and `font-variant-numeric: tabular-nums` on all numeric/time/count UI.
- Introduce a real type scale (currently sizes are ad-hoc arbitrary values: `text-[13.5px]`, `text-[11.5px]`, `text-[12.5px]` etc. scattered across files):

```css
--text-2xs: 11px;  /* metadata, timestamps */
--text-xs:  12px;  /* labels, badges, secondary controls */
--text-sm:  13px;  /* UI default — buttons, menu items */
--text-base:14px;  /* body, chat messages, inputs */
--text-md:  16px;  /* section headings */
--text-lg:  20px;  /* view titles */
--text-xl:  28px;  /* empty-state / hero */
```
Line-height pairs: `1.2` display, `1.5` body, `1.4` UI.

- `text-wrap: balance` on all headings; `text-wrap: pretty` on body paragraphs.

---

## 3. Interaction states — the "buttons don't look interactable" fix

Current `Button` variants change only `background-color` on hover. Per the Vercel guidelines: *"Interactive states increase contrast: hover/active/focus more prominent than rest."* Every interactive element gets a **four-state contract**:

| State | Treatment |
|---|---|
| Rest | `surface-raised` + hairline border + inset highlight |
| Hover | Surface steps **up one ladder level** + border → `--border-strong` + `translateY(-1px)` |
| Active | Surface steps **down**, `translateY(0)`, inset shadow deepens — a real "press in" |
| Focus-visible | `outline: 2px solid var(--accent)` + `outline-offset: 2px` — never `outline-none` without replacement |
| Disabled | `opacity: 0.4`, `pointer-events: none`, no hover treatment |

### 3.1 `Button` variant rework (`src/shared/components/ui/button.tsx`)

| Variant | Rest | Hover | Active |
|---|---|---|---|
| `brand` | `--gradient-brand` + brand glow shadow | `brightness(1.08)` + lift + stronger glow | `brightness(0.94)` + settle |
| `secondary` | `surface-raised` + hairline | → `surface-overlay` + `--border-strong` + lift | press-in |
| `ghost` | transparent | `surface-raised` fill appears | `surface-overlay` |
| `danger` | red-tinted `surface-raised` | intensify | press-in |

Add `size: 'lg'` (44px) — the send button at 36px is undersized for a primary action.

**Every** button gets `touch-action: manipulation` and an intentional `-webkit-tap-highlight-color` (guidelines requirement, currently unset).

### 3.2 Send button specifically
Currently 36px flat circle. → 40px, `--gradient-brand`, brand-tinted glow shadow at rest, glow intensifies on hover, icon 14px. It's the primary action on the main screen and should look like it.

---

## 4. Motion — the "everything is static" fix

Existing `motion.ts` vocabulary is good and should be **kept**. Additions:

```ts
export const springs = {
  micro:    { type:'spring', stiffness:500, damping:36 },  // existing
  standard: { type:'spring', stiffness:420, damping:34 },  // existing
  panel:    { type:'spring', stiffness:380, damping:34 },  // existing
  emphasis: { type:'spring', stiffness:340, damping:26 },  // existing
  gentle:   { type:'spring', stiffness:260, damping:30 },  // NEW: entrances, list staggers
}
export const stagger = { tight: 0.03, normal: 0.05, loose: 0.08 }
```

Required motion, each with a stated reason (guidelines: animate `transform`/`opacity` only, honour `prefers-reduced-motion`, never `transition: all`):

1. **View transitions** — cross-fade + 4px rise when switching Chat ↔ Calendar. *Reason: spatial continuity.*
2. **List staggers** — message lists, session lists, file lists, Launchpad tiles: `stagger.normal`. *Reason: hierarchy — the eye follows arrival order.*
3. **Overlay entrances** — dialogs/dropdowns/popovers: scale `0.97→1` + 4px rise on `springs.panel`. *Reason: origin cue.*
4. **Press feedback** — universal via `Button`. *Reason: input acknowledgement.*
5. **State transitions** — send↔stop already correct (`popLayout`); extend the same pattern to every mode swap.
6. **Skeleton loaders** — replace all "Loading…" text with shape-matched shimmer skeletons. *Reason: perceived performance + no layout shift.*

**Restraint rule:** no idle/ambient looping animation except a single live-status pulse. Guidelines cap autoplay motion >5s without controls; a decorative infinite loop violates both that and the "polished, not busy" goal.

---

## 5. Depth & materials

- **Retire `backdrop-filter: blur()` on opaque surfaces.** It costs real GPU per frame and does nothing when the surface behind it is opaque. Keep blur *only* on genuinely translucent layers over the wallpaper (dialog scrim, Launchpad backdrop). This is a measurable performance win on the target hardware.
- Shadow scale, tuned per ladder step:
```css
--shadow-raised:  0 1px 2px rgb(0 0 0 / 20%);
--shadow-overlay: 0 8px 24px -6px rgb(0 0 0 / 45%), 0 2px 6px rgb(0 0 0 / 25%);
--shadow-modal:   0 24px 64px -12px rgb(0 0 0 / 60%), 0 4px 12px rgb(0 0 0 / 35%);
--shadow-brand:   0 4px 16px -2px rgb(45 111 239 / 35%);
```
- Radius scale (consistent, currently mixed `rounded-lg`/`xl`/`2xl`/`[26px]` arbitrarily): `sm 8px` (badges) · `md 10px` (buttons/inputs) · `lg 14px` (cards) · `xl 18px` (panels) · `2xl 24px` (windows/overlays) · `full` (pills/avatars).

---

## 6. Per-surface work

### 6.1 Shell chrome
- **TopBar** — group into three explicit zones (brand · context · window controls) with hairline dividers. Window controls: proper Windows-11 hit targets (46×32), close button red only on hover.
- **Sidebar** — tiles to `surface-raised`; active tile = gradient fill + accent left-edge indicator bar (2px, `layoutId` animated); labels appear on rail hover-expand (72px→200px, `springs.panel`).
- **Taskbar** — `surface-overlay` + hairline + `--shadow-modal`; running indicator = 3px accent bar; hover previews on `springs.gentle`.

### 6.2 General Chat
- Composer → `surface-raised`, focus-within lifts to `surface-overlay` + accent border + `--shadow-brand` (already partially done — finish it).
- Message bubbles: user = `--gradient-brand` + `--shadow-brand`; assistant = `surface-raised` + hairline + inset highlight. **Remove `backdrop-blur` from both** (§5).
- Empty state: the dark radial veil is already removed — keep it removed; it existed only to fight a photographic background.
- Tool-call steps: connected timeline with a vertical rail + per-step status dots, not a flat bulleted list.

### 6.3 Every other feature
Apply the ladder + four-state contract + type scale mechanically. Priority order: **General Chat → Shell chrome → Calendar → Notes → File Explorer → Document Reader → News Brief → Private Player → Studio → remaining**.

---

## 7. Implementation sequence (hand-off order)

Each step must end with `npx tsc --noEmit -p .` clean and a Rust build clean.

| # | Step | Files | Risk |
|---|---|---|---|
| 1 | Token foundation: ladder, borders, brand ramp, type scale, radii, shadows. Alias old names → new so nothing breaks. | `tokens.css`, `theme.css` | Low — additive |
| 2 | `Button` four-state contract + `lg` size + `secondary` variant | `ui/button.tsx` | Low — every button improves at once |
| 3 | Remaining primitives to ladder + overlay shadows | `ui/{dialog,dropdown-menu,popover,select,tooltip,slider}.tsx` | Low |
| 4 | Motion additions (`gentle`, `stagger`) + skeleton component | `lib/motion.ts`, new `ui/skeleton.tsx` | Low |
| 5 | Shell chrome | `TopBar`, `Sidebar`, `TaskbarWindow` | Medium — verify drag regions & window controls still work |
| 6 | General Chat | `Composer`, `ChatMessage`, `WorkspacePanel`, `ChatCommandPalette` | Medium — do not disturb sticky-scroll or session logic |
| 7 | Remaining features, in the §6.3 order | per feature | Low each |
| 8 | Performance: strip dead `backdrop-filter`, verify long-list scroll | app-wide | Low |

**Hard constraints for the implementer:**
- Presentation layer only. No hook logic, no data flow, no keyboard behaviour changes.
- Never introduce a colour outside §1. If something needs a colour that isn't there, stop and ask.
- Never use raw `#2150cc` indigo except inside `--gradient-brand`.
- Every animation honours `prefers-reduced-motion`.
- Verify after each step; do not batch steps 5–7 together.
