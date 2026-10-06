---
name: add-ui
description: Build canvas UI in Kitten Crawler Man — surfaces on a scene's UiRoot (bands, Escape, focus, pointer capture), the Ui context, the widget set, theme tokens/skins/glyphs/fonts, panels and phone layout, the HUD model, world painters, Conversation/DialogBox, and the UI guard rails (check:ui-style, verify:ui-input, render:ui-gallery). Use when adding or changing any menu, dialog, HUD element, prompt or on-screen text.
---

# Canvas UI

All UI is immediate-mode canvas drawing, redrawn every frame, in **UI units**
(canvas CSS pixels ÷ `uiScale`). Anything on screen that can take input or hide
the world is a **surface** mounted once on the scene's `UiRoot`. A surface's
`render(ui)` draws with **widgets** (free functions over the `Ui` context) whose
looks come from **theme tokens and skins**. Nothing in feature code calls `ctx`
for chrome.

The look is **dark glass, game-show gold**: deep blue-black semi-opaque panels
with a soft 1px light edge, generous radius and a soft drop shadow. Warm gold is
the one accent, used for the primary action, focus and selection. Category
colours appear only as small accents (icon tints, pills), never as panel fills.
Typography carries the hierarchy, not borders. The UI stays calm so the game
world and its art are the loudest thing on screen.

## Rules

- **New menu:** one file, one `Surface`, mounted with `ui.mount`. Its `render`
  calls `panel(...)` and fills the body with widgets. Escape works if it has
  `close()`. There is no click chain, claims list or Escape chain to add to.
- **New look:** a new skin in `src/ui/theme/skins.ts` (or a token in
  `tokens.ts`) built from tokens. Never an inline colour, font string or size.
- **Spacing:** `inset`, `splitV`/`splitH` and `grid` from `src/ui/core/geom.ts`,
  with `ui.theme.space` values. Never add raw numbers to `x`/`y`. There is one
  `Rect` type; a "maybe" rect is `Rect | null`, never an off-screen sentinel.
- **Phones:** pick a panel `width` token. If a layout genuinely differs, branch
  on `ui.size` (or `ui.density` for touch-vs-mouse copy), never on platform.
  Panels never shrink-scale; content that doesn't fit scrolls.
- **Lists:** `scrollView` or `panel({ scrollBody: true })`. Never keep scroll
  state by hand.
- **Disabled things:** `disabled: 'reason'`. They show the reason, register a
  region that only swallows input, and play the error cue on tap.
- **New items:** fill in `category` and add the `ITEM_ICONS` entry; typecheck
  forces both (see `add-item`).
- **HUD additions:** a dock button goes in `HudModel.dock`, a top-of-screen bar
  in `HudModel.topBand`, a notice to the toasts. Never hand-place them.
- **World input:** only in the scene's `handleWorldPointer`, which receives only
  gestures no surface claimed. Nothing else in a scene hit-tests.
- **Every tap sounds once, from the dispatcher.** `UiRoot` plays the region's
  `sound` (default `UI_TAP_SOUND`, `null` for silent) when a tap or press fires,
  and `UI_ERROR_SOUND` for a disabled one. Never call `audio.play` for a
  button.
- **`onPress` (fire on down) is only for the hotbar and in-combat controls.**
  HUD buttons fire on release; hotbar slots fire on press.
- **Preserve behaviour when restyling:** what pauses the world, which keys do
  what, costs, and the Space/Escape semantics in `src/dialog/` are game rules,
  not styling.

Settled design decisions, not open questions:

- **Inter** is the single UI font. A display face, if ever wanted, is one token.
- **Equipped items keep occupying bag and hotbar slots.** Changing that is a
  game-rule change.
- **There is no item rarity.** Category colour is the only per-item accent. If
  rarity tiers are ever wanted, add a `rarity` field and give `itemSlot` a
  rarity edge from one token map.
- **The phone HUD has no collapse toggle**; the compact unit frames are already
  small.
- **Achievement and System AI announcements stay big modal moments**, part of
  the show's flavour.

## Surfaces (`src/ui/core/UiRoot.ts`)

```ts
interface Surface {
  readonly id: string; // unique per scene; scopes focus, uiState and region ids
  readonly band: Band; // 'world' | 'hud' | 'panel' | 'modal' | 'toast' | 'system'
  isOpen(): boolean;
  render(ui: Ui): void;
  close?(): void; // present: Escape closes it
  wantsEscape?(): boolean; // false: Escape passes beneath as if there were no close
  readonly haltsWorld: boolean; // gameplay pauses and gameplay keys are swallowed
  readonly locksKeyboard?: boolean; // unconsumed keys kept from gameplay, world runs on
  readonly blocksEscape?: boolean; // load-bearing: Escape does nothing at all
  onKey?(key: string, mods: KeyModifiers): boolean; // typed input; true consumes
  readonly takesText?: boolean; // free text (chat): key hooks are not offered keys
}
```

- **Bands**, bottom to top: `world` (interaction prompts), `hud`, `panel`
  (floats; blocks only what it draws), `modal`, `toast`, `system`. Within a
  band, surfaces stack in the order they opened (`UiRoot` notices `isOpen()`
  flipping). Draw order, pointer order, Escape order and focus all come from
  this one stack.
- Every `modal` and `system` surface gets a full-screen block registered
  **before** its `render` runs, so a modal cannot forget to claim the screen. A
  modal or system surface that opened since the last frame covers everything
  below it even before it has drawn.
- `band`, `haltsWorld`, `locksKeyboard` and `blocksEscape` are read live, so a
  surface whose claim changes while open (a conversation that halts for one
  request and floats for the next) implements them as getters.
- Closing is instant: a closed surface registers nothing, and its `uiState` is
  dropped so it reopens fresh.
- Ready-made surface builders: `choiceModalSurface`, `pagedOverlaySurface`,
  `promptSurface`, `HudSurface` (+ `.overlay()`), `conversation.surface(...)`,
  and the `surface(...)` methods on screens (`ConfirmDialog`, `QuantityDialog`,
  `CraftExplainers`, `LoadingOverlay`, end screens, …).

## `UiRoot`

A scene builds one (`createSceneUi({ audio, handleWorldPointer })` in
`src/ui/core/sceneUi.ts` reads the live browser viewport), mounts each surface
once (`mount`; `unmount` removes one), calls `ui.frame(ctx)` once per render
after the world, and exposes it as the scene's `ui` field. `SceneManager`
(`src/core/Scene.ts`) feeds it every pointer gesture through `PointerInput`
(`src/ui/core/pointer.ts`, which divides by `uiScale` once), offers it every
keydown before any gameplay listener, and calls `ui.dispose()` when the scene
exits. The browser's `click` event never reaches a scene with a `UiRoot`.

**Frame.** `frame(ctx)` renders open surfaces bottom to top inside one
`ctx.scale(uiScale)`, rebuilding the hit registry as they go, then freezes it.
Input always reads the frozen copy, so what was drawn and what can be hit are
the same data. A surface that throws loses only its own drawing.

**Pointer.**

- **Capture on down.** The topmost region under the pointer owns the whole
  gesture. With no region there, the owner is the world.
- **Tap on up**, for the owner only, and only if its region is still in the
  current registry, the release is inside it (plus its `dragSlop`), and nothing
  registered above it now covers the point. An overlay that appeared
  mid-gesture therefore eats the tap, and a dialog that closes on tap cannot
  pass the same tap to the world.
- `onPress` fires on down and the release is then ignored — hotbar and combat
  controls only. `onDown` + `onRelease` observe a press without claiming it;
  `onRelease` is captured at down and fires once however the gesture ends, with
  `{ dragged, cancelled, covered }`.
- **Drag:** once the pointer leaves `dragSlop` (default `TAP_SLOP`), the owner's
  `onDrag` takes over; a region without one hands the drag to the region beneath
  it in the same surface that has one (dragging a list row scrolls its list). A
  drag never also taps.
- `onSecondaryTap` is the only handler that sees a non-primary button
  (right-click); every other handler is primary-only.
- `onOutsideDown` fires when a gesture goes down anywhere outside the region,
  without taking the press (a search field letting go of the keyboard).
- **Wheel** goes to the topmost `onWheel` region under the pointer in the
  topmost surface there; any region swallows it; otherwise the world gets it.
- **World:** `handleWorldPointer(gesture: WorldGesture)` sees `down`, `move`,
  `up`, `cancel` and `wheel` only for gestures it owned on down. `x`/`y` are UI
  units, `cssX`/`cssY` canvas CSS pixels; `up` carries `tap` (stayed within
  `TAP_SLOP`). A release over something that opened since the down arrives as
  `cancel`.

**Keys** — `ui.key(key, mods)` returns `'consumed' | 'gameplay' | 'blocked'`,
routing in this order:

1. **Key hooks** (`addKeyHook`) see every key first — world input that must
   beat open menus, such as a timing-graded press. Skipped while a `takesText`
   surface is open.
2. **The topmost surface's `onKey`**, then each one below it, stopping after the
   first `panel`/`modal`/`system` surface that halts the world or locks the
   keyboard. A surface that floats over live play (an achievement card) passes
   what it doesn't take to the menu beneath.
3. **Focus navigation**, only while the focus scope halts the world or locks the
   keyboard (otherwise Space, Enter, Tab and the arrows stay gameplay keys).
   Tab / Shift+Tab walk the ring in registration order; arrows pick the nearest
   region in that direction (sideways distance weighted double) and fall back
   to ring order. Space/Enter call the focused region's `onTap` **directly** —
   no click is synthesised — or, when no ring is showing, the scope's
   `primary` region. A disabled target answers with the error cue.
4. **Escape:** the topmost surface's open `ui.layer` gets it first, then a
   `blocksEscape` surface stops it, then the topmost surface with `close` (and
   `wantsEscape() !== false`) closes. An unclaimed Escape returns `'gameplay'`
   so the scene toggles pause. A held Escape closes one surface, not one per
   repeat.

Any other key returns `'gameplay'` unless something open halts the world or
locks the keyboard (`'blocked'`).

**Focus scope and repeats.** The ring belongs to the topmost open `panel`,
`modal` or `system` surface; it resets whenever that surface changes, and only
its regions on its top layer are in it. Regions join when they have `onTap` and
are enabled (override with `focusable`). The ring is drawn only after keyboard
navigation; a pointer press hides it. `ui.focus(id)` preselects a region.
Auto-repeat focus steps are throttled to `FOCUS_REPEAT_INTERVAL_MS` (a fresh
press never is); a repeat of a key not struck since the ring appeared, a held
accept key, and any key already held when the surface appeared
(`mods.predatesSurface`, from `SceneManager`'s held-key snapshot) never move or
activate anything. `SceneManager` also treats a consumed key as spent until it
is released, so it cannot reach gameplay mid-hold after the surface closes.

**Queries:** `worldHalted()`, `keyboardLocked()`, `keyReachesGameplay()`,
`pointerOverUi()` (world hover such as entity tooltips stays quiet while true),
`isOpen(id)`, `openSurfaceIds()`, `anyOpenAbove(band)` /
`openSurfaceIdsAbove(band)`, `focusSurfaceId()`, `mouse`, `regions()`,
`viewport`, `uiScale`. `surfacesOverHud(ui)` (`src/ui/hud/HudSurface.ts`) lists
what the player must deal with above the HUD, ignoring its toast overlay — use
it to withhold world interaction prompts.

## The `Ui` context

What each `render(ui)` receives:

- `ctx`, `theme` (tokens resolved for the density), `viewport` (safe-area rect,
  lay content out in this), `screen` (whole canvas; scrims cover this), `size`,
  `density`, `uiScale`, `now`, `surfaceId`, `openedAt`, `pointer`, `clipRect`.
- `hit(id, rect, handlers): HitState` — registers a region (intersected with the
  active clip; a row scrolled out of view registers nothing, a half-visible one
  is live only on its visible part) and returns `{ hovered, pressed, focused }`.
  Later registrations sit above earlier ones. The full id is
  `${surfaceId}/${id}`; two regions sharing an id in one surface warn in dev and
  are told apart by registration order. Hit rects follow the live transform, so
  an opening panel's controls are hit where they are seen.
- `block(rect)` — a region that swallows input and does nothing.
- `clip(rect, draw)` — clips drawing and hit registration together.
- `state(slot, id, init?)` / `setState(slot, id, value)` — per-surface widget
  state through a `UiStateSlot<T>` declared once at module level
  (`src/ui/core/uiState.ts`); cleared when the surface closes.
- `tween(id, target, { ms?, from? })` — eases a number toward its target
  (default `motion.base`).
- `defer(draw)` — runs after the surface finishes, above and unclipped; its
  regions sit above the surface's others. Context menus and popovers (things
  that take input) draw through it.
- `overlay(draw)` — runs after **every** surface has rendered, above all bands,
  unclipped, under the transform and alpha of the call. It takes no input (a
  region registered inside is refused with a dev warning). Hover descriptions
  (`tooltip`, so every widget's tooltip) and drag ghosts draw through it, so a
  HUD slot's tooltip reads over a menu opened above the HUD.
- `layer({ onEscape? })` — starts a dismissable layer (context menu, popover):
  focus, Enter's primary, wheel and drag hand-off stop at it, and Escape calls
  `onEscape` before any surface closes.
- `focus(id)` — puts keyboard focus on one of this surface's regions.
- `playSound(id)` — for a cue that is not a tap (taps sound on their own).

## Widgets (`src/ui/widgets/`)

Free functions that draw and register in one call. `id`s are unique within the
surface.

- `text(ui, rect, { text, role?, style?, color?, align?, valign?, wrap?, maxLines?, tabular?, halo? })` — every string. Without `wrap`, a long line ends in an ellipsis; `maxLines` caps a wrapped block. `tabular: true` (or `tabularNumber`) for numbers that change every frame. `measureText`, `measureTextHeight`, `lineHeightOf`, `wrapToWidth` for layout.
- `button(ui, rect, { id?, label, variant?, size?, icon?, selected?, disabled?, primary?, sound?, onTap })` — `measureButton`, `buttonHeight`.
- `iconButton(ui, rect, { id, icon, label, variant?, size?, selected?, disabled?, badge?, tooltip?, primary?, sound?, onTap })` — the label is a tooltip, never drawn; `iconButtonSize`.
- `panel(ui, { id, title?, subtitle?, width, height?, contentHeight?, onClose?, onBack?, footer?, footerLayout?, footerSize?, scrollBody?, content?, scrim?, onScrimTap?, onCardTap? })` → `{ frame, body, sheet }` — the one container; see below.
- `scrollView(ui, rect, { id, contentHeight, draw })` → `{ offset, maxOffset, visible }` — wheel, drag anywhere, draggable thumb; `scrollIntoView`.
- `tabs(ui, rect, { id, items, selected, onSelect, variant? })` — `segmented` or `underline`; `measureTabs`.
- `listRow(ui, rect, { id, title, subtitle?, leading?, trailing?, accent?, selected?, disabled?, onTap?, … })` — priced rows, journal rows, roster rows; `listRowHeight`.
- `card(ui, rect, { id, kind?, overline?, title?, accent?, selected?, disabled?, onTap?, content? })` → content rect.
- `meter(ui, rect, { id, value, max, kind?, lowBelow?, label?, valueText?, ghost? })` — eases to its value and leaves a draining ghost.
- `badge(ui, rect, { label, tone?, … })`, `keycap(ui, rect, { label, pressed?, small? })` — no input; `badgeSize`, `keycapSize`.
- `tooltip(ui, anchor, { id, show, text, title?, lines?, placement?, immediate? })` — after `TOOLTIP_DELAY_MS`, kept on screen.
- `contextMenu(ui, { id, at, title?, items, onDismiss })` and `popover(ui, { id, anchor, w, h, placement?, onDismiss?, draw })` — layered, deferred, flip and clamp to the viewport.
- `searchField(ui, rect, { id, input, placeholder? })` — the surface's `onKey` delegates to `input.handleKey` (`SearchInput`).
- `stepper(ui, rect, { id, state, large?, max? })` over a `QuantityPickerState`; digits via `stepperKey` from `onKey`.
- `itemSlot(ui, rect, { id, item, quantity?, keycap?, cooldown?, selected?, dragging?, dropTarget?, equipped?, disabled?, tooltip?, onTap?, onPress?, onDrag?, … })` — icon from `ITEM_ICONS`, category accent, quantity, cooldown sweep.
- `costChips(ui, rect, { costs, align? })` — have/need chips; `costsMet`, `measureCostChips`.
- `choiceModal(ui, config)` / `choiceModalSurface({ id, band?, isOpen, haltsWorld?, locksKeyboard?, escape, onKey?, content })` — title, optional icon or hero art, body, extra content, 1–N buttons; `escape` is `close`, `block` or `pass`. Every confirm, stair/door prompt, level-up and reward announcement.
- `pagedOverlay` / `pagedOverlaySurface({ id, pages, onDone, … isOpen })` — multi-page explainers, rules sheets, tutorials, readable notes; arrows turn pages.

`paint.ts` holds the shared primitives (rounded paths, glass, focus ring,
hover/press treatment). Feature code never calls it; it calls widgets.

## Panels, sizes and phones

- **Width tokens** (`panelWidths`): `sm` 360, `md` 520, `lg` 760, `xl` 960 UI
  units. `height: 'content'` sizes to `contentHeight` (capped by the screen);
  `'fill'` takes the available height.
- `regular` / `wide`: a centred glass card on a scrim. `compact` (phones): `md`
  and wider become a **bottom sheet** at full width and up to
  `SHEET_MAX_HEIGHT_FRACTION` of the height, inside the safe area; `sm` stays a
  centred card.
- `scrollBody: true` with `content` and `contentHeight` wraps the body in a
  `scrollView`. Otherwise fill the returned `body` yourself.
- A panel blocks its own frame; with a scrim (the default) it blocks the whole
  screen. `onClose` draws ✕ (Escape is the surface's own `close`); `onBack`
  draws a back chevron for drill-in navigation. Helpers: `panelBodyWidth`,
  `panelBodyMaxHeight`, `panelChromeHeight`.
- **Motion:** a surface fades in and scales from `OPEN_SCALE_FROM` (a sheet
  slides) over `motion.base`; close is instant; hover brightens and strengthens
  the border over `motion.fast`; the pressed look shows on down (darken, drop
  `PRESS_DROP`) though the tap fires on up; focus is a `FOCUS_RING` outside the
  control with a soft glow.

**Viewport** (`src/ui/core/viewport.ts`) owns every breakpoint:

- Size class from `SIZE_CLASS_BREAKPOINTS` in UI units: `compact` below 640
  wide or 440 tall, `wide` from 1280, else `regular`.
- Density: `touch` when the primary pointer is coarse, decided once per load.
  Touch raises `theme.size.control`/`row`/`slot` to touch targets (44/48/56).
- `uiScale` = `DENSITY_BASE_SCALE[density] × UI_SIZE_SCALE[settings.uiSize]`
  (Small / Medium / Large in Settings), clamped by `clampedUiScale` so the screen
  keeps at least `MIN_LAYOUT_VIEWPORT` (568×320) of room, never below
  `MIN_UI_SCALE`.
- Safe-area insets come from CSS `env(safe-area-inset-*)` via the
  `#safe-area-probe` rule in `main.css`, re-read only when the canvas size
  changes; `ui.viewport` already excludes them.

**Input-mode copy** (`src/ui/core/inputMode.ts`): inside a surface pass
`ui.density`; outside one, `activeInputMode()` (the density the last framed
`UiRoot` resolved). `byInputMode(mode, { touch, pointer })`, `tapVerb`,
`TOUCH_GESTURES`, `keyLabel(action)`, `keycapLabel(action)`, and
`actionPrompt(mode, { deed, action, gesture? })` ("Double tap to reload" /
"Press R to reload"). Never hard-code a key name or "Click".

## Theme (`src/ui/theme/`)

- **`tokens.ts`** — `palette` (surface, border, text, accent, state, meter,
  crawler, category, tier, material), `space`, `radius`, `type` ramp
  (`caption`, `body`, `label`, `title`, `heading`, `display`, `overline`),
  `elevation`, `motion`, `sizes`, `panelWidths`, `OPEN_SCALE_FROM`,
  `FOCUS_RING`, `PRESS_DROP`, `SHEET_MAX_HEIGHT_FRACTION`. Widgets read them
  through `ui.theme` (`resolveTheme(density)`), never from the raw objects.
  `fontFor(style)` builds a font string; only text primitives use it.
- **`skins.ts`** — `skinsFor(theme)`: button variants (`primary`, `secondary`,
  `ghost`, `danger`, `success`, `quiet`) and `selected`, control sizes
  `sm | md | lg`, panel kinds (`card`, `sheet`, `raised`, `inset`, `hud`,
  `tooltip`, `popover`), text roles, meter kinds, focus ring, and the domain
  skins (casino chip, dialog choice, brass, keycap). A new look is a new entry.
- **`fonts.ts`** — Inter, bundled under `src/fonts/` with `OFL.txt`, registered
  as `UI_FONT_FAMILY` and used through `UI_FONT_STACK`. `loadUiFont()` loads it
  behind the loading screen and falls back to `system-ui` after
  `FONT_LOAD_TIMEOUT_MS`; the service worker precaches it (`scripts/shipped-assets.js`);
  render scripts register the static weights through `scripts/nodeUiFont.ts`
  so review PNGs match. `TERMINAL_FONT_STACK` is for a machine voice, chosen
  per speaker in `src/dialog/speakers.ts`. `WORLD_FONT_STACK` is the
  pixel-era monospace for labels painted into the world.
- **`glyphs.ts`** — the UI icon set as Lucide path data (ISC licence notice at
  the top) compiled to `Path2D`; `GlyphId`, `drawGlyph(ctx, id, rect, style)`.
  No emoji in chrome.
- **`color.ts`** — `mix`, `withAlpha`, `lighten`, `darken` for deriving skins
  (hex only).
- **Ink modules** for non-chrome palettes: `worldInk.ts` (world text, bars and
  plates), `minimapColors.ts` (one tile-colour table for every minimap),
  `previewInk.ts` (review scenes), `townMapInk.ts`, `scytheSwingInk.ts`.
- Item icons are registered in `src/ui/icons/itemIcons.ts` (`ITEM_ICONS:
Record<ItemId, ItemIconPainter>`, painters take `(ctx, rect)`); `drawItemIcon`
  serves code outside widgets. The coordinate-heavy item painters live in
  `src/sprites/art/itemIcons/` and paint in a unit square through
  `paintIconArt` (`iconPaint.ts`); older painters and skill art remain in
  `src/ui/icons/`.

## World painters vs screen widgets

Screen chrome inside a surface uses widgets. Anything painted **into the game
world** — nameplates, floating combat numbers, structure captions, health and
build bars over a creature, plates behind speech, a full-canvas tint — uses the
bare-context painters in `src/ui/world/`, in the caller's own space (usually
camera-relative CSS pixels), styled from `theme/worldInk.ts`:

- `worldText(ctx, text, { x, y, style | size/bold/color/outline/family, width?, align?, baseline?, … })`,
  `measureWorldText`, `wrapWorldText`, `worldLineHeight`, `worldTextInkExtent`.
  Looks are `WORLD_TEXT` entries.
- `worldBar(ctx, rect, opts)`, `worldPlate(ctx, rect, opts?)`, `worldTint(ctx, color, alpha)`
  with `WORLD_BAR` / `WORLD_PLATE` entries.

`worldText` also serves the few screen-pixel strings drawn outside any surface
(the tutorial hint box, labels inside preview art, icon stack counts, text
inside explainer illustrations). It and the `text` widget are the only places
that set canvas text. Raw `ctx` calls are fine for sprites, particles and world
geometry, never for UI chrome. Floating "SPACE — Talk" prompts are raised in the
world pass with `drawInteractionPrompt` (`src/ui/InteractionPrompt.ts`), which
only queues them; `promptSurface()` (`src/ui/hud/prompt.ts`, band `world`)
draws the queue above the darkness and fog with the HUD's keycap and glass.

## The HUD (`src/ui/hud/`)

One `HudSurface` (band `hud`) serves every gameplay scene, drawn from a
`HudModel` the scene builds each frame through its `HudHost`
(`{ id?, visible(), model(), toasts(), liftTopBand?() }`). Its `overlay()`
companion (band `toast`) carries the toast stack, and the top band whenever the
host lifts it over its own panels. Mount both.

- **Layout** is `hudLayout` (`hudLayout.ts`), pure in its inputs and shared by
  both scenes, so walking through a door moves nothing: unit frames and the coin
  pill top left, the minimap top right with the dock under it, the hotbar bottom
  centre, the top band between frames and minimap (under the frames on
  `compact`), toasts above the hotbar. `liveHudLayout` gives the same answer
  outside the render (the interior camera frames the room clear of it).
  `HudSurface.frame` (and `cssDockRect`) report what was last drawn, for code
  that aims at the HUD.
- **`HudModel`**: `crawlers` (active first), `activeCrawler`, `coins`,
  `skillPoints`, `minimap` (`MinimapModel` with its own `paint`, `toggle`,
  `pan?`), `dock`, `summon`, `lootBanner`, `hotbar`, `topBand`.
- **Dock:** `DockButtonModel { id, icon, label, key?, badge?, selected?, pulse?, bounce?, onTap }`.
  Buttons fire on release. `hudButtonLayout` fixes the column order (Pause, Bag,
  Build, achievement chip, Journal, then a scene's `extras`, which never shift
  the shared ones); on touch the cluster is packed into free room by
  `hudPacking.ts`, keeping clear of the HP meters, unit frames, the fight-bar
  reserve and the hotbar. Pointer screens show keycap hints.
- **Top band** (`topBand.ts`, `topBandStack.ts`): a `TopBandEntry
{ id, priority, maxWidth, height(ui, w), render(ui, rect) }` asks for a slot;
  `TOP_BAND_PRIORITIES` stacks `boss` > `encounter` > `countdown` > `banner`.
  Build entries from rows with `stackedBandEntry`, or draw into `topBandCard`.
  An entry with no clear place above the floor is left out rather than laid over
  a button. Boss and encounter bars, timers, banners and village counters all
  live here.
- **Toasts** (`toasts.ts`): `menus.toasts.post(text, { icon?, tone?, urgent?, merge?, key?, durationTicks? })`
  on the scene's `MenusKit`. At most `MAX_VISIBLE_TOASTS`; they age by update
  tick, slide in and fade on their own. `key` updates one toast in place.
- **Hotbar** (`hotbar.ts`): slots fire on **press** through
  `HotbarInput.press(index)`; `release` matters only to a slot that charges
  while held.
- The HUD shows only what reads at a glance; complete lists (stats, controls)
  live behind the pause screen.

## Speech: `Conversation` and `DialogBox`

All spoken dialog — a villager's greeting, a quest beat, a boss's taunt, a
sign's text — goes through `src/dialog/`. Read that directory before writing a
new line of dialog.

- **`Conversation`** (`src/dialog/Conversation.ts`) is the one conversation
  panel every speaker talks through. A scene owns exactly one: construct it once
  (`new Conversation(audio)`), call `update(playerPosition)` once per frame
  (`null` when there's no in-world speaker to walk away from), and mount
  `conversation.surface({ handOffPress?, dismiss?, wantsEscape?, offBoxClick? })`
  once. A request that halts the world sits in the `modal` band and its choice
  row is the focus ring; one the player can walk away from floats in the
  `panel` band and leaves the arrows to walking. Start with `open(request)`,
  which returns a `ConversationHandle` (`play(nextRequest)` chains the next beat
  without closing the box, `close()` ends it). Systems that talk take the
  scene's `Conversation` through their constructor deps.
- **`ConversationRequest`** (`src/dialog/request.ts`) is one beat: `lines`
  (`NonEmpty<DialogLine | PendingLine>` — a `PendingLine` shows "…" until its
  `Promise<string>` resolves), `reward` (a `DialogReward | null` preview drawn
  under the box on the final page, not a grant), `questRelated`, `ending`,
  `dismiss`, `haltsWorld` (required, never derived from `dismiss`), and
  `anchor` (the speaker's live position and the `talkRangeTiles` it opens from,
  for `dismiss: 'allowed'`). The walk-away distance is
  `walkAwayRangeTiles(talkRangeTiles)` from `src/dialog/walkAway.ts`, the talk
  range plus one tile; any other walk-off surface derives its close distance the
  same way. Between the two ranges the box stays up but an interact press goes
  to whoever the player has walked up to (`Conversation.handOff`).
- **`Ending`** runs once the last line has been _read_: `{ kind: 'close', onClosed() }`;
  `{ kind: 'choices', choices: NonEmpty<Choice> }`; `{ kind: 'confirm', accept, decline }`.
  A `Choice` is `{ label, tone: 'normal' | 'quest' | 'exit', run(convo) }`.
  Side effects belong in `onClosed` or `Choice.run`, never earlier. Rows are
  picked by number key, click or tap — keep to nine or fewer. **Space accepts;
  Escape is the only way out.** Space takes the row's default: a confirm row's
  accept side (`keyboardDefault: 'accept'`, or `'none'`; there is no decline
  default); on a choices row `defaultChoiceIndex` picks a choice marked
  `keyboard: 'default'`, else the first `quest`, else the first `normal`; an
  `exit` choice is picked only when the row holds nothing else. Mark a choice
  `keyboard: 'never'` when a stray press would regret it. A press that finishes
  a page never also answers the row it opens (the advance takes only a fresh
  press, and a key held as the row appears predates it). `npm run
verify:dialog-accept` walks this with Space alone.
- **`DismissPolicy`**: `{ kind: 'blocked' }` for a load-bearing scene;
  `{ kind: 'allowed', onDismissed() }` where Escape and walking away close it.
- **Topics** — `topicMenu(topics, spent, exitChoice, reopen)`
  (`src/dialog/topics.ts`) turns `ConversationTopic[]` into a choice row.
- **Custom advance labels** — `say.button(label, text)` / `say.fnButton(label, build)`
  from a speaker's `LineBuilder` (`src/dialog/line.ts`).
- **Auto-pagination** — a line's `paragraphs` is `readonly [string, ...string[]]`:
  one string wraps and paginates on its own; an extra element is a forced page
  break. Never index pages by hand.
- **Speakers** — `SPEAKERS` (`src/dialog/speakers.ts`) keyed by `SpeakerId`; a
  name picked at runtime uses `transientSpeaker(name, style)` with a
  `TRANSIENT_STYLES` preset.
- **`DialogBox`** (`src/ui/DialogBox.ts`) is the box `Conversation` wraps
  (typing reveal, voice, pagination); its chrome is in
  `src/ui/screens/dialogs/conversationChrome.ts`. Never construct one for
  speech.

Reach for `Conversation` for any narrative text. A bespoke panel is justified
only when the content is interactive in a way the choice row doesn't cover (a
shop, the casino).

## Screens to copy from

- **`src/ui/screens/inventory/`** — `InventoryScreen` (one per scene on
  `MenusKit.inventoryScreen`, band `panel`, no scrim): Bag tab (category rail,
  filtered/sorted scrolling grid, Tidy, its own hotbar row, detail pane,
  context menu, number-key hotbar assignment) and Character tab (paper doll,
  stats). I/G call `MenusKit.toggleInventory`/`toggleGear`; the pause screen
  opens it with a back chevron. Item actions queue `pending*` fields on
  `MenusKit.inventoryActions` for `resolvePendingInventoryActions`; tutorial
  narrowing is the host's `restrictions()`. `npm run verify:inventory-screen`.
- **`src/ui/screens/shop/`** — `ShopSession` (state) + `shopScreenSurface` for
  every priced menu and store counter (Buy/Sell `tabs`, `listRow`s, the stepper
  modal for selling a stack; pricing stays in `src/systems/market/`).
  `FortuneScreen`, `VipLoungeScreen` and `MercenaryDeskScreen` are variants.
- **`src/ui/screens/pause/`** — `PauseScreen` (one per scene on
  `MenusKit.pauseScreen`, band `modal`): a sidebar card on `regular`/`wide`, a
  drill-in list with a back chevron on `compact`. `open()` or
  `open('journal' | 'character' | …)`. Its confirms are `choiceModal` surfaces
  from `confirmSurfaces()`, mounted beside it. Key rebinding is the Controls
  page's `RebindCapture`. `npm run verify:pause-keyboard`.
- **`src/ui/screens/construction/`** — `ConstructionScreen` (option cards in a
  `grid()` with structure art, `costChips`, a state ribbon, tabs past
  `CONSTRUCTION_TABS_FROM` options, the world placement ghost while a card is
  hovered or focused) and `StructurePopover` (a `popover` over a world object,
  anchored in canvas CSS px, wrapped by `ConstructionKit` and
  `GrateSpikesMenu`). **`src/ui/screens/follower/FollowerScreen.ts`** — radio
  `listRow` sections.
- **`src/ui/screens/dialogs/`** — `ConfirmDialog` (mount `confirm.surface(id)`,
  then `open({...})`; No is the default, Y answers Yes; use it for anything
  destructive), `QuantityDialog` (`dialog.surface(id, afterChoice?)`, locks the
  keyboard but leaves the world running), the stair/door/tower prompts as
  `choiceModalSurface`s fed by their system's state (`stairwellPrompt.ts` reads
  `StairwellSystem.menuOpen`/`descentPrompt`/`descend`/`closeMenu`), end screens
  (death, level complete, run complete, quest reward, chest reward), explainers
  (`CraftExplainers`: `register(id, entry)` once, `open(id)`, one surface per
  scene), `NoticeBoard`, `ReadableOverlay`.
- **`src/ui/LoadingScreen.ts`** — `LoadingOverlay` ticks a `LoadRunner` and is
  mounted through its `surface(id)` (band `system`); gameplay scenes hold it
  through `ArrivalLoader` (`src/scenes/ArrivalLoader.ts`); `npm run
render:loading-screen`.
- **`src/ui/questReward/`** — the quest-complete screen model, drawn by
  `questRewardSurface`; see `add-quest`.

### Adding a pause screen section

1. Add the id to `PAUSE_SECTION_IDS` in `src/ui/screens/pause/section.ts`.
2. Create `src/ui/screens/pause/yourSection.ts` returning a `PauseSection`:
   `{ id, label, glyph, available?, badge?, title?, subtitle?, render(layout, ctx), subView?, onKey? }`.
   Draw top to bottom through the `SectionLayout` (`heading`, `paragraph`,
   `row`, `track`) with widgets; the screen scrolls the page, reveals keyboard
   focus and handles Escape, so a section keeps no scroll state or back button.
3. Add it to the list in `PauseScreen`'s constructor, in menu order, and a
   gallery state in `src/dev/uiGallery/pause.ts`.
4. A control the arrows should adjust (a slider) passes `adjust` to
   `layout.track`. A confirmation is a `choiceModal` surface, never a ring drawn
   inside the page.

## Review scenes, the gallery and `?ui`

- **`PreviewScene`** (`src/scenes/PreviewScene.ts`) is the base for localhost
  review scenes (creature previews, art benches). It owns a `UiRoot` with a
  header surface: implement `previewTitle()`, `previewControls()` (buttons that
  wrap on narrow screens), optionally `previewCaptions()`, `previewBack()` and
  `handlePreviewWorldPointer(gesture)`; paint the art in `render`, lay it out
  under `headerBottom`, and call `renderChrome(ctx)` last.
- **`npm run render:ui-gallery`** renders every widget in every state (rest,
  hover, pressed, focused, disabled, selected — produced by feeding real
  gestures and Tab presses into a `UiRoot`) and every screen with fixture data,
  at 1440×900, 1024×640, 844×390 and 568×320 and at each UI size, into
  `preview/ui-gallery/` (`--only=568x320`, `--match=dialogs/`,
  `--size=medium`). Fixtures live in `src/dev/uiGallery/`; a new widget state
  or screen gets one. **Open the PNGs**: a layout you haven't seen isn't done.
- **`?ui`** (`UiGalleryScene`, localhost only via `devBoot`) shows the same
  fixtures live, with sheet switching, UI-size cycling and a pointer/touch
  density toggle.

## Guard rails

- **`npm run check:ui-style`** (part of `npm run lint`, strict) walks the AST of
  `src/ui/`, `src/dialog/`, `src/dev/`, every `*PreviewScene.ts` and a listed set
  of scene and HUD/menu files in `src/systems/`, and fails on: a hex or
  `rgb/rgba/hsl` colour literal, a font string, `fillText`/`strokeText` outside
  the text primitives (`widgets/text.ts`, `world/worldText.ts`),
  `platform.isMobile`/`IS_MOBILE`, or an import of a deleted module. `theme/`
  and `icons/` are style sources and unscanned; files that paint world art are
  exempt by a short, commented path list in the script. A new HUD or menu file
  outside `src/ui/` joins the scanned list; never widen the exemptions to make
  it pass — move the literal into a token or skin.
- **ESLint `no-restricted-imports`** (`eslint.config.js`) keeps feature code off
  the modules it must not reach for directly; read the rule for the current
  list.
- **`npm run verify:ui-input`** — the click-through gate. It first runs its
  probe against a deliberately leaky surface (a panel that forgets to block its
  frame) and must catch it, so a probe that stops detecting click-through goes
  red itself. Then unit checks of `UiRoot` (capture, scrim, a modal opening
  mid-gesture, Escape order, clip-intersected hits, focus scoping, keyboard
  activation, wheel, drag hand-off, press-on-down, state clearing, scaling),
  then the real `DungeonScene` on desktop and phone. A new input rule gets a
  check here, and the check is watched failing before the fix lands.
- **`npm run verify:menus`** — run-time focus audit (`scripts/menuFocusAudit.ts`):
  every panel, modal and system surface mounted in the town, Briar Hollow and the
  interiors, plus every gallery fixture, must be reachable and operable by
  keyboard alone while it is the topmost focus scope. Its self-test feeds it a
  ringless halting surface and a focus-stealing floating one and must catch both.
- **`npm run render:ui-gallery`** — above. Also the HUD gates, kept on the
  current API, never deleted: `verify:hud-parity`, `gates:hud-column`,
  `gates:phone-hud`, `verify:interior-camera`, `verify:interior-hud-clicks`,
  `verify:level-timer-safe-room`, `verify:dialog-accept`,
  `verify:loading-screen`, and `render:phone-hud` / `render:interior-hud`.

Finish with the `dev-workflow` gates (typecheck, lint, format).
