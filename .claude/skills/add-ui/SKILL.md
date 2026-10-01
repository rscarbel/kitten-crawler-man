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
- **`src/ui/DialogBox.ts`** — the low-level speech panel: construct once with `(audio, options)`, then `show(paragraphs, speaker, opts)`, `update()`, `render(ctx)`, `isFullyRevealed()`, `skipToEnd()`, `advancePage()`, `pageCount()`, `currentPageNumber()`, `isLastPageOfLine()`, `contains()`. Plays its speaker's voice automatically as text reveals. **Never construct a `DialogBox` directly for speech** — that's what `Conversation` is for; a scene owns at most one `DialogBox`, wrapped inside its one `Conversation`.

### Speech: `Conversation`

All spoken dialog — a villager's greeting, a quest beat, a boss's taunt, a sign's text — goes through `src/dialog/`. Read that directory before writing a new line of dialog; the pieces are:

- **`Conversation`** (`src/dialog/Conversation.ts`) is the one conversation panel every speaker in the game talks through. A scene owns exactly one: construct it once (`new Conversation(audio)`), call `update(playerPosition)` once per frame (pass `null` when there's no in-world speaker to walk away from), `render(ctx)` once, and fold its `overlayClaim()` into the scene's shared claim list (`src/systems/kits/OverlayClaims.ts`). Start a conversation with `open(request)`, which returns a `ConversationHandle` (`play(nextRequest)` to chain into the next beat without closing the box, `close()` to end it). Systems that need to talk take the scene's `Conversation` through their constructor deps rather than building their own.
- **`ConversationRequest`** (`src/dialog/request.ts`) is one beat: `lines` (a `NonEmpty<DialogLine | PendingLine>` — a `PendingLine` shows "…" until its `Promise<string>` resolves), `reward` (a `DialogReward | null`, drawn under the box on the final page — a preview of what's on offer, not a grant), `questRelated` (boolean), `ending` (an `Ending`), `dismiss` (a `DismissPolicy`), `haltsWorld` (boolean — required, not derived from `dismiss`, so an uncommon pairing has to be stated rather than falling out of a default), and `anchor` (a `ConversationAnchor | null` — the speaker's live position and the `talkRangeTiles` the owner opens it from, for `dismiss: 'allowed'`). The walk-away distance is never per surface: it is `walkAwayRangeTiles(talkRangeTiles)` from `src/dialog/walkAway.ts`, the talk range plus one tile, and any other walk-off surface (a counter, a structure menu) derives its close distance the same way. Between the two ranges the box stays up but an interact press goes to whoever the player has walked up to (`Conversation.handOff`).
- **`Ending`** is what happens once the request's last line has been _read_, not queued: `{ kind: 'close', onClosed() }` ends the conversation and runs the side effect; `{ kind: 'choices', choices: NonEmpty<Choice> }` brings up the choice row; `{ kind: 'confirm', accept, decline }` brings up the two-button accept/decline pair. A `Choice` is `{ label, tone: 'normal' | 'quest' | 'exit', run(convo: ConversationHandle) }`. Side effects (granting an item, starting a quest phase) belong in `onClosed` or a `Choice.run`, after the pages are read — never earlier. The choice/confirm row is picked by number key, click or tap — keep a menu to nine or fewer numbered choices. It joins the shared focus ring only when the request's `haltsWorld` is true, so a conversation that leaves the world running keeps arrow keys as movement (that row names its Space pick in the footer instead). **Space accepts; Escape is the only way out.** Space takes the row's default: a confirm row's accept side (`keyboardDefault: 'accept'`, or `'none'` for no default — there is no decline default), and on a choices row `defaultChoiceIndex` picks a `Choice` marked `keyboard: 'default'`, else the first `quest`, else the first `normal` choice; an `exit` choice (Goodbye, Back, Not now) is picked only when the row holds nothing else. Mark a choice `keyboard: 'never'` when a stray press would regret it (a wager, a sale). A press that finishes a page never also answers the row it opens, and each row declares a fresh focus ring id, so a Space held across it cannot confirm it. `npm run verify:dialog-accept` walks this with Space alone.
- **`DismissPolicy`** is what Esc and walking away do: `{ kind: 'blocked' }` for a load-bearing scene where neither does anything; `{ kind: 'allowed', onDismissed() }` where both close the conversation and run the side effect.
- **Topics** — `src/dialog/topics.ts`'s `topicMenu(topics, spent, exitChoice, reopen)` turns a speaker's `ConversationTopic[]` into a choice row: questions group under one "I have a question" row, a non-repeatable topic already picked this conversation drops off the list, and the exit choice always sits last.
- **Custom advance labels** — a `DialogLine` built with `say.button(label, text)` or `say.fnButton(label, build)` (from a speaker's `LineBuilder`, `src/dialog/line.ts`) wears a labelled button instead of the standard "Continue" footer hint — for a line whose advance is itself a choice of tone ("Let's do this!").
- **Auto-pagination** — authors write paragraphs, not pages. A line's `paragraphs` (`Paragraphs`, from `src/dialog/line.ts`) is a `readonly [string, ...string[]]`: write the whole beat as one string and it wraps and paginates on its own; an extra array element is a **forced** page break, for when the author wants a deliberate pause. Never index pages by hand.
- **Speakers** — every recurring cast member is an entry in `SPEAKERS` (`src/dialog/speakers.ts`), keyed by `SpeakerId`; a name picked at runtime (a townsperson, a sign) uses `transientSpeaker(name, style)` with a `TransientStyleId` preset from `TRANSIENT_STYLES` instead of inventing a one-off style inline.

**Any modal/panel that isn't `DialogBox`/`Conversation` gets neither the sound nor the mobile-safe width for free — you must add both yourself:**

- Sound: call `audio?.play('typing_click')` (or another appropriate cue) whenever new dialog text appears on screen. `drawModal`/`drawBox` never play sounds themselves.
- Mobile width: `drawModal` clamps `width` to `canvasWidth` as a hard floor, so a modal can never render wider than the viewport — but that floor is edge-to-edge with zero side margin, which looks cramped. For a proper margin, compute your own `const panelW = Math.min(IDEAL_WIDTH, canvas.width - SIDE_MARGIN)` (see `DialogBox.ts`'s `DIALOG_SIDE_MARGIN` for the convention) and pass `panelW`. Either way, use the **returned** `box.width` / `box.inner.width` — not the original constant — for every downstream layout calculation derived from the panel's width (centered text, card widths, button rows). Threading the resolved value through is the part that's easy to miss: recomputing `IDEAL_WIDTH - padding` from the constant instead of reading it off the box result reintroduces overflow one line below a correctly-clamped box.

Prefer reaching for `Conversation` (any spoken line, single or many, with or without choices) over rolling a new bespoke modal for narrative text — a bespoke panel is only justified when the content is genuinely interactive in a way `Conversation`'s choice row doesn't cover (a shop or casino panel with live inventory state).

### Standalone widgets and worked examples

- **`src/ui/LoadingScreen.ts`** — the loading screen. `drawLoadingScreen` draws one frame from a view record; `LoadingOverlay` is what a scene holds while it loads (ticks a `LoadRunner` from `src/core/LoadRunner.ts`, fades out, exposes `overlayClaim()`). Work is a list of `LoadTask`s — stepped, iterator or promise — run under a per-frame budget. `npm run render:loading-screen` writes review PNGs.
- **`src/ui/questReward/`** — the shared quest-complete screen (`QuestRewardScreen`, one per scene on `MenusKit`), built from a `QuestRewardSpec` a quest emits as `questRewardShown`. See `add-quest`.
- **`src/ui/QuantityPicker.ts`** — a "how many?" modal (−10/−1/+1/+10/Max, live cost line, hold-to-repeat, optional `detail(qty)`). Its header lists the handful of hooks an owner wires, including `overlayClaim()`.
- **`src/ui/ConfirmModal.ts`** — a yes/no modal; Esc answers No, Enter Yes. Use it for anything destructive (the trebuchet/snare Destroy confirm).
- **`src/ui/ConstructionMenu.ts`** — a full panel with a resource row, option rows that stay visible when disabled (with the reason), a world placement ghost while a row is hovered or focused, and a compact two-column layout on short screens. **`src/ui/StructureMenu.ts`** — a small presenter anchored over a world object whose model is rebuilt every frame by its owner; it owns its own confirm and picker.
- **Explainers.** Craft explainers are `HowToPlayOverlay` wrappers hosted by `MenusKit.craftExplainers` (`src/ui/CraftExplainers.ts`): `register(id, explainer)` once, `open(id)` from anywhere; the host already wires claim, Esc and click in both scenes.
- **Crafts pause tab** — `src/ui/pause/CraftsTab.ts`: both crawlers' Resourcing and Construction levels, with "How it works" reopening the explainers.
- **HUD buttons, indoors and out.** One function, `hudButtonLayout` in `src/ui/hudButtons/hudButtonLayout.ts`, places Pause, Bag, Build, the achievement chip, the Journal and the Follower button (and the phone's level timer) for both `DungeonScene` (through the rect functions in `DungeonUIRenderer`) and `BuildingInteriorScene` (through `interiorHudLayout`): same viewport and same buttons in, same rects out, so walking through a door moves nothing. It is laid out against the overworld minimap's footprint (`hudMiniMapRect` in `hudMiniMap.ts`), which the smaller interior minimap sits inside. The Follower slot is always held, shown or not, so refusing it (the Big Top maze) moves nothing else. A button only one scene has goes in the input's `extras`, placed after every shared button so it shifts none of them. `npm run verify:hud-parity` compares the two scenes across desktop and phone sizes.
- **Interior HUD layout.** Inside buildings every piece of chrome (HUD panel, room-name plate, minimap, the shared buttons above, Switch/Summon) is placed by `interiorHudLayout` in `src/scenes/interiorHudLayout.ts`. The scene draws from it and the interior camera frames the room clear of `interiorHudOccluders(layout)` (`hudClearView` in `interiorCamera.ts`), so a new on-screen button indoors belongs in that layout, not at a hand-computed position — otherwise the camera will happily park a rat under it. The room-name plate (`drawInteriorNameplate`, `BOX_PRESETS.roomNameplate`) sits between the HUD panel and the button column when there is room, else under the panel, and steps its text down, drops "Inside: ", then ellipsizes with `measureTextWidth` (`TextBox.ts`). `npm run verify:interior-camera` checks every floor tile against the layout; `npm run render:interior-hud` renders review shots.
- **Phone button packing.** On phones, the HUD buttons (timer, Follower, Pause, Bag, Build, chip, Journal) are placed one at a time by `src/ui/hudPacking.ts` into the nearest clear space, in that order, by `hudButtonLayout`. Placement avoids the minimap, hotbar, Switch/Summon, the HP bars and the HUD collapse toggle, and the input includes whether the HUD panel is collapsed. Never hand-stack a new phone button under the minimap: landscape phones run out of height. Add it to the packing order instead. `npm run gates:phone-hud` checks 384 phone layouts (in view, no overlaps, no button over HP bars), and `npm run render:phone-hud` renders review sheets.
- **Top-centre HUD strip.** A HUD element in the top band takes its slot from `topCentreStripSlot` (`src/systems/DungeonUIRenderer.ts`), which fits it between the HUD panel and the minimap and drops it under the panel on a narrow phone; `BOX_PRESETS.hudTranslucent` is the resource HUD's look.

## Button plumbing (per frame / per click)

1. In render, call `setButtonMouseState(mx, my, isDown)` once before drawing buttons; `setButtonAudio(audio)` once at setup.
2. In `handleClick`, call `notifyButtonClick(mx, my)` first — it auto-plays the button sound.
3. For menu-style lists, prefer `addButton(ctx, buttons, opts & { action })` — draws and pushes a hit-rect + action into an array; the owner's `handleClick` iterates the array and invokes `action`.

## Click routing

A scene's `handleClick` routes to consumers in priority order (dialogs before panels before world). Each consumer's `handleClick` returns `boolean`; the scene early-returns on `true`. New UI must be inserted at the right point in that chain — position determines stacking priority. Keyboard dismissal goes in `GameplayInputHandler`'s Esc chain, and anything that owns the screen also needs an `overlayClaims` entry (`src/systems/kits/OverlayClaims.ts`) so the keyboard gate, the Space chain and the world-halt test agree with the draw order.

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
