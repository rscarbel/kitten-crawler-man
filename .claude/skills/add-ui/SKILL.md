---
name: add-ui
description: Build canvas UI in Kitten Crawler Man — drawText/drawBox/drawButton utilities and presets, DialogBox, pause menu tabs, click routing. Use when adding or changing any menu, dialog, HUD element, or on-screen text.
---

# Canvas UI

All UI is immediate-mode canvas drawing, redrawn every frame. **Never use raw `ctx.fillText` / `strokeText` / `fillRect` for UI chrome** — use the shared utilities (CLAUDE.md rule; raw ctx is fine only for game-world rendering).

## The utilities

- **`src/ui/TextBox.ts`** — `drawText(ctx, text, opts)` handles font, color, outline, glow, shadow, word-wrap (`width`), scrolling (`height` + `scrollY`), background, border, alignment. Use `TEXT_PRESETS` (`label, hint, heading, value, success, danger, title, tooltip, controls, muted, human, cat, ability`). `measureTextBox` for layout math.
- **`src/ui/Box.ts`** — `drawBox` (returns `{ inner, contains() }`), `drawModal` (canvas-centered), `drawProgressBar`, `drawDivider`, `drawOverlay`, `drawScrollbar`; layout helpers `centerX/centerY/stackV/stackH`. Presets: `BOX_PRESETS` (`panel, modal, tooltip, button, highlight, achievement, safeRoom, danger, boss, ...`), `PROGRESS_PRESETS` (`hp, mana, xp, stamina, boss`).
- **`src/ui/Button.ts`** — `drawButton(ctx, opts)` with automatic hover brighten / press darken. `BUTTON_PRESETS` (`primary, danger, success, purple, gold, safeRoom, toggle, toggleActive, mobile*, blue`). If a button needs a new look, **add a preset** rather than hand-rolling inline styles.
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
3. Add a nav button in `MainTab.ts` (`setTab('yourtab')`), a `case` in `PauseMenu.render`'s switch, and a box-height entry for the tab.
4. Clicks are already handled — `PauseMenu.handleClick` iterates the shared `buttons` array.

Finish with the `dev-workflow` gates (typecheck, lint, format).
