---
name: add-ui
description: Build canvas UI in Kitten Crawler Man — drawText/drawBox/drawButton utilities and presets, DialogBox, pause menu tabs, click routing. Use when adding or changing any menu, dialog, HUD element, or on-screen text.
---

# Canvas UI

All UI is immediate-mode canvas drawing, redrawn every frame. **Never use raw `ctx.fillText` / `strokeText` / `fillRect` for UI chrome** — use the shared utilities (CLAUDE.md rule; raw ctx is fine only for game-world rendering).

## The utilities

- **`src/ui/TextBox.ts`** — `drawText(ctx, text, opts)` handles font, color, outline, glow, shadow, word-wrap (`width`), scrolling (`height` + `scrollY`), background, border, alignment. Use `TEXT_PRESETS` (`label, hint, heading, value, success, danger, title, tooltip, controls, muted, human, cat, ability`). `measureTextBox` for layout math.
- **`src/ui/Box.ts`** — `drawBox` (returns `{ inner, contains() }`), `drawModal` (canvas-centered), `drawProgressBar`, `drawDivider`, `drawOverlay`, `drawScrollbar`; layout helpers `centerX/centerY/stackV/stackH`. Presets: `BOX_PRESETS` (`panel, modal, tooltip, button, highlight, achievement, safeRoom, danger, boss, ...`), `PROGRESS_PRESETS` (`hp, mana, xp, stamina, boss`).
- **`src/ui/Button.ts`** — `drawButton(ctx, opts)` with automatic hover brighten / press darken. `BUTTON_PRESETS` (`primary, danger, success, purple, gold, safeRoom, toggle, toggleActive, mobile*, blue, trackerRow, trackerRowPinned, keyChip, ...` — read the object, it is longer than this list). If a button needs a new look, **add a preset** rather than hand-rolling inline styles.
- **`src/ui/DialogBox.ts`** — reusable speech box: construct once with `(audio, { speakerName, speakerIcon?, revealMode: 'all'|'sentence'|'word'|'letter', ... })`, then `show(text)`, `update()`, `render(ctx, canvas)`, `isFullyRevealed()`, `skipToEnd()`, `contains()`. Plays `typing_click` automatically as text reveals — you never have to trigger that sound yourself.
- **`src/ui/QuestDialog.ts`** — reusable paged announcement modal (title + fixed body lines + one advance button per page): construct once with `(audio)`, then `open(pages: DialogPage[], onComplete)`, `render(ctx, canvas)`, `handleClick(mx, my)` (mouse), `advance()` (keyboard/tap "interact" — no coordinates needed), `dismiss()` (Esc: closes without firing `onComplete`), `isOpen`. Also plays `typing_click` automatically on open and page-advance. `DialogPage.lines` are **not** word-wrapped — write each line short enough to fit `DIALOG_WIDTH` (see existing `*QuestDialogs.ts` data files for the convention).

**Any modal/panel that isn't `DialogBox` or `QuestDialog` gets neither the sound nor the mobile-safe width for free — you must add both yourself:**

- Sound: call `audio?.play('typing_click')` (or another appropriate cue) whenever new dialog text appears on screen. `drawModal`/`drawBox` never play sounds themselves.
- Mobile width: `drawModal` clamps `width` to `canvasWidth` as a hard floor, so a modal can never render wider than the viewport — but that floor is edge-to-edge with zero side margin, which looks cramped. For a proper margin, compute your own `const panelW = Math.min(IDEAL_WIDTH, canvas.width - SIDE_MARGIN)` (see `QuestDialog.ts`'s `DIALOG_CANVAS_PADDING` for the convention) and pass `panelW`. Either way, use the **returned** `box.width` / `box.inner.width` — not the original constant — for every downstream layout calculation derived from the panel's width (centered text, card widths, button rows). Threading the resolved value through is the part that's easy to miss: recomputing `IDEAL_WIDTH - padding` from the constant instead of reading it off the box result reintroduces overflow one line below a correctly-clamped box.

Prefer reaching for `DialogBox` (single speaker line, revealed live) or `QuestDialog` (paged announcement with a button) over rolling a new bespoke modal — a bespoke panel is only justified when the content is genuinely interactive (multiple buttons/choices per screen, like a shop or casino panel), not for plain narrative text.

## Button plumbing (per frame / per click)

1. In render, call `setButtonMouseState(mx, my, isDown)` once before drawing buttons; `setButtonAudio(audio)` once at setup.
2. In `handleClick`, call `notifyButtonClick(mx, my)` first — it auto-plays the button sound.
3. For menu-style lists, prefer `addButton(ctx, buttons, opts & { action })` — draws and pushes a hit-rect + action into an array; the owner's `handleClick` iterates the array and invokes `action`.

## Click routing

`DungeonScene.handleClick` routes to consumers in priority order (dialogs before panels before world). Each consumer's `handleClick` returns `boolean`; the scene early-returns on `true`. New UI must be inserted at the right point in that chain — position determines stacking priority. Keyboard dismissal goes in `DungeonInputHandler`'s Esc chain.

## Adding a pause menu tab

1. Add the name to the `PauseTab` union in `src/ui/pause/types.ts`.
2. Create `src/ui/pause/YourTab.ts` exporting `renderYourTab(ctx, buttons, boxX, boxY, boxW, ...)` that pushes `ButtonRect`s via `addButton`.
3. Add the nav button on the right level, a `case` in `PauseMenu.render`'s switch, and a box-height entry for the tab. **`MainTab` is for things that act on the game** — Resume, Inventory, Settings, Spend Skill Points. Anything that just _describes the run_ goes in `GameTab` alongside the Quest Journal, Stats, Abilities, Achievements and Skills, and its Back button returns to `'game'`, not `'main'`. Main was eight buttons once; on a short phone viewport that compresses every one of them toward `MIN_BUTTON_HEIGHT`, which is what the split exists to prevent.
4. Clicks are already handled — `PauseMenu.handleClick` iterates the shared `buttons` array.

### If the tab scrolls

Copy `JournalTab.ts` or `ControlsTab.ts` rather than inventing the plumbing. Export
a `*_SCROLL_TOP_Y` and `*_FOOTER_H` and return the content height; `PauseMenu` needs
matching `yourScrollY`/`yourContentH` fields, a `yourScrollH` getter derived from the
**same** two constants, a `_lastYourBoxH` written each render, branches in
`handleWheel` / `touchScrollStart` / `touchScrollMove`, and a reset in `setTab`.

Four rules that are easy to get wrong and invisible when you do:

- **Do not `ctx.translate` the scroll band.** A button's hit-rect comes from the
  coordinates it is handed, so place rows in screen space and let `ctx.clip()` do
  the hiding.
- **A row must be wholly visible to be a live button.** A half-clipped row that
  keeps a hit-rect leaves a click target out in the footer with nothing to aim at;
  a row scrolled fully past the band sits _outside the modal_ on the dimmed
  backdrop, where a click on empty screen answers with the row's click sound.
  Cull rows entirely off-band, and draw the rest `disabled: true` — that is the one
  flag that keeps a button out of `_renderedButtons` (the sound registry) and the
  focus ring as well as suppressing hover and press.
- **A row nobody can act on must not look like a button either.** `addButton` gives
  it hover, press and a click sound, so tapping it looks like it worked.
- **Keyboard players cannot scroll.** `Scene.handleMenuNavigation` only moves and
  activates focus, and the ring only holds wholly-drawn buttons — so without an
  explicit control, anything below the fold is unreachable without a mouse. Add
  ▲/▼ buttons and register them **before** any row, so they hold focus-ring indices
  scrolling cannot shift; register them after and pressing ▼ walks focus off them
  as the registered row count changes.

### Holding text to one line

`drawText` wraps at `width` and clips at `height`. Set `lineHeight` and `height` to
the **same** value: line two then starts exactly on the clip's bottom edge and is
excluded whole, while line one keeps its descenders. Clipping _below_ the resolved
line height — the obvious way to do it — shaves the tails off `g`, `y` and `p`.
Leaving `height` above it lets a wrapped line spill onto the row beneath.

Finish with the `dev-workflow` gates (typecheck, lint, format).
