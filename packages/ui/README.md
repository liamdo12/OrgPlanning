# @occasion/ui

The glass design system. Tokens, surfaces and the primitives every screen
composes from.

Every value here is transcribed from `design/Event Marketplace Glass.dc.html` and
cites the line it came from. Nothing is chosen; where the prototype is
inconsistent, the citation says which occurrence won. See `design/README.md` for
why that rule exists, and `docs/design-gaps.md` for the places this package
deliberately differs.

## Where things live

| Path                                   | What                                                              |
| -------------------------------------- | ----------------------------------------------------------------- |
| `@occasion/config/tailwind/preset.css` | The tokens, as Tailwind v4 `@theme` variables                     |
| `src/styles/base.css`                  | Reset, role themes, ambient background, focus, preference queries |
| `src/styles/components.css`            | The glass recipe and each primitive's surface                     |
| `src/components/**`                    | The components: layout and markup only                            |
| `src/theme/**`                         | `RoleTheme` and the `Role` type                                   |

`apps/web` imports one file — `@occasion/ui/styles.css` — which pulls in all
three stylesheets in order.

Appearance lives in CSS classes (`.oc-glass`, `.oc-button`, …) rather than in
utility strings on every element, for two reasons: the glass recipe is six
declarations that must stay identical across the 63 surfaces that carry it in
the prototype, and `prefers-reduced-transparency` has to be able to replace it
in one place. Components carry layout; the stylesheets carry appearance.

Both stylesheets live inside a cascade layer — `@layer base` and
`@layer components`. That is load-bearing: unlayered CSS beats layered CSS
whatever the specificity, and Tailwind emits every utility into
`@layer utilities`, so a rule written outside a layer would silently override
every `className` a caller passes. `packages/ui/test/stylesheets.test.ts`
fails if one escapes.

## Using it

```tsx
import { AppBackground, DataTable, PageHeader, StatusBadge } from "@occasion/ui";

<AppBackground role="admin">
  <PageHeader title="Orders and payments" blurb="…" />
  <DataTable caption="Orders" columns={COLUMNS} rows={rows} rowKey={(r) => r.id} />
</AppBackground>;
```

The kitchen sink at `/kitchen-sink` renders every component in every state, in
all three role themes. It is the surface to compare against the prototype, and
it is withheld on the production tier.

**Add to it when you add a component here.** That page is not only a showroom:
it is the regression surface an additive change to this package is proved
against — its rendered markup is diffed before and after, and a component it
does not draw is a component nothing would have caught changing. The states
worth drawing are the ones a screen cannot conveniently reach: a disabled
primary beside a disabled secondary, a stepper sitting on each of its bounds, a
tab that is deliberately inert.

## Role theming

A role theme rewrites three custom properties — `--color-role`,
`--color-role-hover`, `--color-role-tint` — and nothing else (prototype lines
1993–1997). Set `data-role` on any element, or use `<RoleTheme role="vendor">`,
and everything inside re-themes. Nesting works, so an administrator previewing a
customer surface gets the customer palette in that subtree and nowhere else.

| Role     | Primary   | Hover     | Tint      |
| -------- | --------- | --------- | --------- |
| customer | `#3E6B34` | `#2E5127` | `#F2F7EC` |
| vendor   | `#C2374B` | `#A02637` | `#FDF0F2` |
| admin    | `#1F4D3A` | `#163527` | `#F3F7F3` |

## Two breakpoints

`S.vw < 860` is the prototype's mobile/desktop switch (line 1989) and is the
`desk:` variant, so our layouts change where the prototype's do.

`--breakpoint-wide: 1080px` is the `wide:` variant, and the header's search
control is the only thing that uses it: the pill shows at `S.vw >= 1080` and
the compact button below it (lines 2320–2321). That is a third layout state at
a width `desk:` cannot express, so the band between 860 and 1080 — desktop
chrome, compact search — is a state of its own and has to be checked as one.

## Contrast

Measured against WCAG 2.1 AA (4.5:1 for text under 24px, or under 18.66px
bold), and measured over the **worst** backdrop rather than the easiest one:
every translucent surface is composited over the strongest ambient gradient at
its centre — the green one at 10% 6% (line 200), which is exactly where a page
header sits. Over the bare paper base every pair below is 1.5 to 4 points
better, which is why the paper figure is the wrong one to publish.

`packages/ui/test/contrast.test.ts` asserts the tightest of these, so a token
edit that breaks one fails `pnpm test` rather than a later audit.

**Two kinds of assertion, and the difference matters.** `contrast.test.ts`
computes ratios from hex literals: it never opens a stylesheet, so it can only
say that a pair _would_ be legible, not that any rule uses it.
`stylesheets.test.ts` parses `src/styles/components.css` and reads the rules
themselves. The disabled primary button needs both and is the reason the
distinction is written down — the colour pair alone is worth nothing, because
`.oc-button:disabled` fades every variant and composites anything written
underneath it back down. Before adding a pair, ask which of the two a new
assertion belongs in; if the answer is "the rendered element has to use it",
it is the second.

| Foreground on background                             | Ratio           | AA  |
| ---------------------------------------------------- | --------------- | --- |
| ink on the page                                      | 6.6             | ✓   |
| ink on glass                                         | 10.3            | ✓   |
| body on glass                                        | 6.5             | ✓   |
| body on the table-header wash                        | 5.3             | ✓   |
| body on chrome                                       | 6.4             | ✓   |
| neutral badge (`#3C4A43` on white 45%)               | 6.1             | ✓   |
| danger text (`#8E2334` on glass)                     | 6.0             | ✓   |
| danger button text (`#8A3D1E` on glass)              | 5.3             | ✓   |
| link on glass (customer / vendor / admin)            | 6.3 / 5.2 / 9.3 | ✓   |
| success badge (`#1F4D3A` on `#E8F0EA`)               | 8.3             | ✓   |
| warning badge (`#6E3318` on `#F7E7DF`)               | 8.1             | ✓   |
| danger badge (`#8E2334` on `#FBE4E7`)                | 7.1             | ✓   |
| surface on the role fill (customer / vendor / admin) | 5.5 / 4.7 / 8.5 | ✓   |
| avatar initials, all five tones                      | 5.6 – 9.8       | ✓   |
| muted on the customer role fill (`#DCE8CE`)          | 4.9             | ✓   |
| disabled primary button (`#3C4A43` on `#DDE3DF`)     | 7.2             | ✓   |

Badges and role fills are opaque, so what is behind them does not matter; the
rest are worst-case figures.

Two pairs are measured against the **3:1 graphics floor** instead, because
neither is text:

| Graphic on background                    | Ratio | 3:1 |
| ---------------------------------------- | ----- | --- |
| the save heart (`#C2374B` on card glass) | 3.7   | ✓   |
| a progress fill on its track (`#EFE9DF`) | 5.2   | ✓   |

The heart is the one to be careful with. It is published elsewhere as 4.99:1,
which is a figure over an opaque card; over the glass a service card actually
uses — the same worst-case compositing as every row above — it is **3.71:1**.
That clears the floor as a glyph and does not clear AA as text, so it must not
be reused for a word, and an assertion written at 4.5 would fail on a colour
that is correct.

### The disabled primary button

`.oc-button:disabled { opacity: 0.55 }` renders a primary button's label at
**2.32:1**, under even the graphics floor, and the checkout's Pay button is
disabled until the agreement is ticked (line 2432) — so it is the most-seen
disabled control in the product. `.oc-button--primary:disabled` takes
`--color-disabled-bg` / `--color-disabled-fg` instead, which is the pair the
prototype itself draws at that line.

`opacity: 1` in that rule is the load-bearing half. Colours written under the
base rule do not replace the fade, they composite through it: this pair at 0.55
measures **2.61:1**, no better than what it replaced. That is why the rule is
asserted in `stylesheets.test.ts` for all three declarations and the ratio in
`contrast.test.ts` — either alone passes over a button nobody fixed.

Three things follow from the measurements and are built in rather than left to
each screen:

- **Links take the role's darker shade.** The prototype's link colour is the
  lighter one (line 206), which reaches 3.7:1 for a vendor over that gradient.
  The darker shade — the prototype's own hover colour — clears AA, and hover
  still says so with the underline.
- **A page-level blurb is ink, not the body grey.** `PageHeader` sits where the
  gradient is strongest, and the prototype's `#3C4A43` falls to 4.1:1 there.
- **`#5C6B62` is not in the token set at all.** The prototype uses it for table
  headings and secondary text; over the gradient it reaches 3.2:1.

The one thing this does not fix: a **link** placed directly on the page, rather
than on a panel or in the chrome, reaches 3.3–4.0 at the centre of that
gradient. Put links on a surface.

Avatar tones are five of the prototype's six. The sixth, `#C2603F`, gives white
initials 4.17:1 — under AA at 14px bold — and is not in the list.

## Preferences

`prefers-reduced-transparency` swaps every blurred fill for an opaque one and
drops the ambient gradients. All four blurred surfaces are covered — glass,
chrome, overlays, and the secondary button, which composes the glass recipe
rather than restating it. The fallback keeps the hierarchy rather than
flattening to one colour: panels stay lighter than the page, chrome stays
lighter than panels.

`prefers-reduced-motion` removes the entrance animation and the skeleton
shimmer. Everything still arrives; it arrives already in place.

## Keyboard

The prototype has no focus styling at all. This package adds a role-coloured
ring on `:focus-visible`, and the components that need behaviour have it:

- **Dialog and Sheet** move focus in on open, trap Tab, close on Escape, and put
  focus back where it was on close.
- **SectionNav** is links in a `<nav>` with `aria-current="page"`, not a tab
  list: these change the page rather than a panel inside it, and `role="tab"`
  without a `tabpanel` is ARIA that lies.
- **DataTable** rows respond to Enter and Space when they are clickable, on both
  the desktop grid and the mobile card.
- **Switch** is a checkbox underneath, so it keeps Space and announces its state.

## Rules

This package may never import `@occasion/core` or `@occasion/db`; ESLint
enforces it and `pnpm lint` fails if it is broken. Domain data arrives as props,
which is what keeps a component reusable by the customer and vendor views that
have not been built yet.

Fonts are Instrument Serif and Plus Jakarta Sans, both Google Fonts under the
Open Font License. `apps/web` loads them from Google with a preconnect pair, the
way the prototype does. Self-hosting them with `next/font/google` removes the
third-party request and is a one-line change in the root layout; it needs a
build machine that can reach Google Fonts.
