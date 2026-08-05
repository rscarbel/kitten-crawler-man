# Controls screen, rebindable keys, and shared menu keyboard navigation

Playtest feedback, three complaints, one root cause:

- Controls are not discoverable — nothing in the game lists them beyond two
  12px HUD hint lines (the `platform.controlHints(atkLabel)` call in
  `drawHUD` in `src/ui/HUD.ts`, rendering the strings built by
  `DesktopPlatform.controlHints` / `MobilePlatform.controlHints` in
  `src/core/Platform.ts`).
- The defaults are not everyone's defaults, and nothing is rebindable —
  every key is a hardcoded string literal at its consumption site.
- Menus ignore the keyboard. Players press Space to accept and Tab to move
  between options because every other game taught them to; here most menus
  respond only to the mouse.

The root cause is architectural: the class-doc comment atop `InputManager` in
`src/core/InputManager.ts` states the design outright — _"game-specific
action bindings live in each Scene's onEnter/onExit"_ — so there is no
binding table to display, no single place
to rebind, and no shared notion of menu focus. This plan adds all three as
one layered system: a **binding model** (Phase 1), a **shared focus ring**
riding on the existing `drawButton` registry (Phases 2–4), and a
**Controls screen + rebinding UI** in the pause menu (Phases 5–6).

Each phase ends green on `npm run typecheck`, `npm run lint`, and
`npm run format`, and ends with its `[HUMAN]` checks.

## 1. What is wrong today (measured from the code)

**Keys are string literals scattered across four independent `window`
listeners.** One keypress can be seen by: `InputManager`'s constructor,
which registers the `keydown`/`keyup` listeners that fill its held-key set
(`src/core/InputManager.ts`), the two `window.addEventListener('keydown', …)`
registrations in `DungeonInputHandler.bind`
(`src/systems/DungeonInputHandler.ts`), `DungeonScene.onEnter`'s
`_spiderKeyHandler` (the spider/bopca forwarder, in
`src/scenes/DungeonScene.ts`), and `BuildingInteriorScene.onEnter`'s own
`escHandler` (`src/scenes/BuildingInteriorScene.ts`).

**The desktop keymap** lives in `DungeonInputHandler.bind`'s `actionHandler`
callback, in `src/systems/DungeonInputHandler.ts`: the `escHandler`'s Escape
chain, the `e.key === ' ' && !e.repeat && actions.advanceDialog()`
Space-advances-dialog check, the `e.key === 'Enter'` block for chat, the
`e.key === 'Tab'` block for switch, the `actions.spaceAction()` block for
attack, the `actions.usePotion()` block for Q, the `actions.toggleInventory()`
block for I, the `actions.toggleGear()` block for G, the
`actions.companionFollow()` block for F, the `actions.toggleMiniMap()` block
for M, the `actions.buildAction()`/`actions.mongoSummon()` block for R, the
`hotbarIdx`/`actions.hotbarActivation(hotbarIdx)` block for digits 1–8, and
the `keyupHandler` callback for dynamite release on keyup. Movement is
polled separately in `GameLoopPhases.readMovement()`
(`src/systems/GameLoopPhases.ts`), and a **dead duplicate** of that
polling sits in `readMoveInput` in `src/systems/PlayerMovementSystem.ts`
with no callers.

**Case handling is inconsistent.** `InputManager`'s constructor stores raw
`e.key` (`src/core/InputManager.ts`), and `GameLoopPhases.readMovement`
checks only lowercase `'w'/'a'/'s'/'d'` — so holding Shift while walking
stops the player. Action keys pair both cases by hand (the
`e.key === 'q' || e.key === 'Q'` check in `DungeonInputHandler.bind`'s
`actionHandler` etc.).

**Menu keyboard support is bespoke where it exists at all.** Five dialogs
have their own `handleSpaceBar()` method (`src/ui/DeathScreen.ts`,
`src/ui/LevelCompleteScreen.ts`, `src/ui/LevelUpDialog.ts`,
`src/ui/RewardGrantedDialog.ts`, `src/ui/AchievementNotification.ts`),
each wired through scene-specific claim chains: the `overlayClaims` getter
and the `triggerSpaceAction` method in `src/scenes/DungeonScene.ts`, and the
`update` method in `src/scenes/BuildingInteriorScene.ts`. The pause menu has
**no** key handling at all (`src/ui/PauseMenu.ts` — Esc toggles it from
outside, via the `actions.togglePause()` call in `DungeonInputHandler.bind`'s
`escHandler`). `QuestDialog.advance()` exists but no key
calls it (`src/ui/QuestDialog.ts`). The start screen's `handleClick` method
(`src/scenes/PostSignupScene.ts`) is mouse-only. Nothing anywhere moves
focus with Tab or arrows.

**Some menus bypass the button utility entirely** — against the CLAUDE.md
UI convention: `StairwellSystem.renderMenu` draws raw `fillRect`/`strokeRect`
menus (`src/systems/StairwellSystem.ts`), `FollowerMenu` keeps its own
`_buttonRects` field (`src/systems/FollowerMenu.ts`), `ShopSystem` its own
`buyRects` field (`src/systems/ShopSystem.ts`), `TowerStairSystem` its own
`menuRects()` method (`src/systems/TowerStairSystem.ts`).

**What already exists to build on:**

- `drawButton` registers every rendered button's hit-rect per frame in the
  module-level `_renderedButtons` array (`src/ui/Button.ts`, pushed to at the
  end of `drawButton`), cleared each frame by `setButtonMouseState`. This
  registry is the natural carrier for a focus ring — it already knows every
  button on screen, in draw order, with pointer-space mapping (the
  `PointerSpace` interface and `setButtonPointerSpace`/
  `resetButtonPointerSpace`/`toSpace` functions).
- `notifyButtonClick` already plays the click sound for whatever button a
  click lands on (`src/ui/Button.ts`) — so keyboard activation that
  _synthesizes a click_ gets sound, action routing, and z-order handling
  for free.
- `Scene.handleClick(mx, my, eventTimeStampMs)` (`src/core/Scene.ts`)
  is the single click entry, dispatched by the `click` listener registered
  in `SceneManager`'s constructor. Synthesized activation must pass a real
  `e.timeStamp` — timing-sensitive consumers score by it
  ([[rhythm-input-must-use-event-timestamp]]).
- `Settings` shows the persistence pattern: versioned localStorage payload,
  per-field validation with fallback (the `readStoredJson` and `load`
  functions in `src/core/Settings.ts`), guarded writes (the `persist` method).
  Adding a field is backward compatible — `load()` falls back per field, and
  the version check in `readStoredJson` only rejects _incompatible_ shapes.
- `PauseTab` union + `ButtonRect` type (`src/ui/pause/types.ts`) is where a
  `'controls'` tab slots in; `SettingsTab` is where its entry button goes.

## 2. Design

### 2.1 The binding model — `src/core/Keybindings.ts`

A closed union of actions, a defaults table that reproduces today's keys
exactly, and a persisted override map.

```ts
export type GameAction =
  | 'moveUp' | 'moveDown' | 'moveLeft' | 'moveRight'
  | 'attack'            // Space today (spaceAction / advance dialogs)
  | 'switchCharacter'   // Tab
  | 'usePotion'         // q
  | 'toggleInventory'   // i
  | 'toggleGear'        // g
  | 'companionFollow'   // f
  | 'toggleMiniMap'     // m
  | 'buildSummon'       // r
  | 'openChat'          // Enter
  | 'hotbar1' | ... | 'hotbar8';   // '1'..'8'

const DEFAULT_BINDINGS: Record<GameAction, readonly string[]> = {
  moveUp: ['w', 'ArrowUp'], /* … exactly the current literals … */
};
```

- **Normalization.** One `normalizeKey(key: string): string` — lowercase
  single-character keys, named keys (`'ArrowUp'`, `' '`, `'Tab'`,
  `'Enter'`) pass through. `InputManager` normalizes on add/delete, which
  fixes the Shift-stops-movement bug as a side effect. All binding lookups
  go through the same function, killing the `q`/`Q` hand-pairing.
- **API.** A `keybindings` singleton: `keysFor(action)`,
  `actionFor(key): GameAction | null`, `isHeld(input, action)` (polls
  `InputManager.has` over the action's keys), `labelFor(action)` /
  `labelForKey(key)` (a `KEY_DISPLAY_LABELS: Record<string, string>` maps
  `' '` → `Space`, `'ArrowUp'` → `↑`, …), `rebind(action, slot, key)`,
  `resetAction(action)`, `resetAll()`.
- **Multiple keys per action.** `MAX_KEYS_PER_ACTION = 2` (movement already
  ships with two). The Controls screen shows one chip per slot.
- **Reserved keys.** `Escape` is not bindable and not stealable — it is the
  universal dismiss chain (the `escHandler` callback in
  `DungeonInputHandler.bind`, and the `escHandler` callback assigned in
  `BuildingInteriorScene.onEnter`) and the rebind-capture cancel.
  A `RESERVED_KEYS: ReadonlySet<string>` guards it.
- **Persistence.** A new `bindings` field in the `SettingsData` interface
  (`src/core/Settings.ts`) with its own validator, following the
  per-field-fallback pattern in `load()`: unknown action names dropped,
  non-string / reserved keys dropped, result merged over
  `DEFAULT_BINDINGS`. Only _overrides_ are stored, so future default
  changes reach players who never touched that action. No version bump —
  old payloads simply lack the field. `Settings` is deliberately
  device-local (per the class-doc comment atop `Settings.ts`), which is
  right for keyboard layout too.
- **Conflict handling** (rebind time): assigning a key already bound
  elsewhere **steals** it — the key is removed from the other action's list
  and the Controls row for the robbed action flashes a notice ("was:
  Attack"). An action may end up unbound; its row then renders the chip in
  `TEXT_PRESETS.danger` styling so the hole is visible. Steal-with-notice
  beats hard-blocking: it can never wedge the player into "no free key".

### 2.2 The shared focus ring — extension to `src/ui/Button.ts`

The whole point: menus adopt keyboard navigation by adding **one line**, not
by each reimplementing it. Focus rides on the registry `drawButton` already
maintains.

**Per-frame registration.** A menu that wants keyboard navigation calls
`beginMenuFocus(contextId: string)` at the top of its render (e.g.
`'pause'`, `'death'`, `'stairwell'`). Every `drawButton` after that call in
the same frame joins the frame's focus ring in draw order (opt-out:
`focusable: false` in `ButtonOptions`). `setButtonMouseState` in
`src/ui/Button.ts` already clears the registry per frame; it clears the
ring too. Calling `beginMenuFocus` a second time in one frame **resets the
ring** — exactly what an inner confirm dialog needs (the
`if (showResetConfirm) { buttons.length = 0; … }` block in
`renderSettingsTab`, in `src/ui/pause/SettingsTab.ts`, already zeroes its
`ButtonRect[]` the same way for clicks).

**Focus state.** Module-level `{ contextId: string; index: number | null }`.
When the rendered `contextId` changes, focus resets to `null` (no ring drawn
— mouse users never see it until they touch the keyboard). The index clamps
to the ring length each frame, so tab switches inside one context degrade
gracefully.

**Navigation keys** (only consumed while last frame's ring is non-empty):

| Key                                   | Effect                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `Tab` / `ArrowDown` / `ArrowRight`    | focus next (wraps; first press focuses index 0)                           |
| `Shift+Tab` / `ArrowUp` / `ArrowLeft` | focus previous (wraps; first press focuses last)                          |
| `Space` / `Enter`                     | activate focused button; if none focused, activate the **primary** button |
| `Escape`                              | never consumed — falls through to the existing dismiss chains             |

**Activation = a synthesized click.** The handler computes the focused
button's center (mapped back out of its `PointerSpace`, via the
`PointerSpace` interface and `toSpace` function in `src/ui/Button.ts`)
and calls `sceneManager.current.handleClick(cx, cy, e.timeStamp)` — the
same path a mouse click takes (the `click` listener in `SceneManager`'s
constructor, `src/core/Scene.ts`). Every existing
`handleClick` router, `ButtonRect.action`, `positionedAction`, and
`notifyButtonClick` sound then works untouched. `e.timeStamp` is passed
through per the gotcha above.

**Primary button.** New `ButtonOptions.primaryAction?: boolean`. Space with
nothing focused activates it — this is what makes "spacebar accepts
everywhere" true for mouse-first players who never Tab. Single-button
dialogs mark their one button; multi-option menus mark the safe default
(Resume, Close, Cancel — never "Yes, Reset").

**Focus visual.** Drawn _by_ `drawButton` when its ring position matches
the focus index: the existing hover treatment (the `if (hovered && !pressed)`
block in `drawButton`, `src/ui/Button.ts`) plus a
gold ring — named constants `FOCUS_RING_COLOR = '#facc15'`,
`FOCUS_RING_BLUR`, `FOCUS_RING_BORDER_WIDTH`. Composing with any preset
beats adding a parallel "focused" variant of every `BUTTON_PRESETS` entry.

**Where the listener lives.** One `window` `keydown` listener with
`capture: true`, owned by `SceneManager` (`src/core/Scene.ts`, alongside
the canvas listeners registered in its constructor). Capture phase fires
before every existing bubble-phase listener, so when it consumes a key it
calls `preventDefault()` + `stopPropagation()` and the gameplay handlers
never see it. Guards, in order:

1. `document.activeElement` is an `<input>`/`<textarea>` → bail (the chat
   input's `el.addEventListener('keydown', …)` handler in `PlayerChatSystem.open`,
   `src/systems/PlayerChatSystem.ts` — window-capture fires
   before its `e.stopPropagation()` can protect it).
2. Rebind capture active (§2.3) → route the key there, consume, done.
3. Last frame's focus ring empty → bail (gameplay: Space attacks, Tab
   switches, arrows move — untouched).
4. Otherwise handle the nav table above.

This ordering means `DialogBox`, `ChestRewardDialog.handleKeyDown`'s any-key
advance (`src/ui/ChestRewardDialog.ts`), and the Bopca digit choices
(`BopcaSystem.handleKeyDown`, `src/systems/BopcaSystem.ts`) keep working
unchanged — none of
them declare a focus ring, so the capture handler passes their keys
through.

### 2.3 The Controls screen and rebinding flow

A new `'controls'` pause tab (`src/ui/pause/ControlsTab.ts`), entered from a
**Controls** button in the Settings tab. Two sub-views toggled by a
two-button row (same pattern as `QUALITY_CHOICES`,
`src/ui/pause/SettingsTab.ts`), defaulting to the current platform
(the `isMobile` property on `PlatformAdapter`, `src/core/Platform.ts`):

- **Keyboard** — one row per `GameAction`: readable name + one chip button
  per bound key (`labelForKey`), plus per-row Reset and a bottom
  **Restore Defaults** (`BUTTON_PRESETS.danger`). Scrollable via the exact
  `statsScrollY` pattern (the `'stats'` branch of `handleWheel`, and
  `touchScrollStart`/`touchScrollMove`, in `src/ui/PauseMenu.ts`) — the
  action list is ~20 rows and will not fit the fixed-height box.
- **Touch** — a read-only `MOBILE_CONTROL_ROWS` table describing the
  gesture bindings measured from `getMoveInput`/`isTap` in
  `src/core/MobileTouchState.ts` and
  `DungeonScene.handleTouchStart`: hold to move toward the
  finger, tap to attack/interact, the Switch/Follower/Bag/Summon buttons
  (`renderMobileButtons` in `src/systems/DungeonUIRenderer.ts`), minimap tap,
  long-press for item menus, hold-to-charge dynamite. Touch gestures are
  **not** rebindable — the screen is for discoverability parity.

**Capture-next-key flow.** Clicking a chip puts it in _listening_ state —
label becomes `Press a key…`, styled by a new `BUTTON_PRESETS.listening`
(gold border + glow; a preset per the house rule, since no existing preset
reads as "armed"). The `SceneManager` capture listener (guard 2 above)
routes the next keydown to `keybindings.rebind(...)`:

- `Escape` → cancel capture, chip reverts.
- Reserved key → rejected, brief inline notice, still listening.
- Already bound elsewhere → steal + notice (§2.1).
- Anything else printable/named → bound, persisted via `settings`.

While the pause menu is open, gameplay input is already suppressed
(the `if (actions.isSuppressed()) return;` gate in `DungeonInputHandler.bind`'s
`actionHandler`; `PauseMenu.isOpen` feeds
`isSuppressed`), so capture cannot fire an attack.

## Phase 1 — Keybindings core + rewire every consumer

Create `src/core/Keybindings.ts` (§2.1) with unit-testable pure parts
(normalization, validation, conflict resolution). Extend
`src/core/Settings.ts` with the validated `bindings` field.

Rewire, preserving behavior exactly (defaults == current literals):

- `InputManager`'s constructor (`src/core/InputManager.ts`) — normalize keys
  into the held set.
- `GameLoopPhases.readMovement` (`src/systems/GameLoopPhases.ts`) — poll via
  `keybindings.isHeld(input, 'moveUp')` etc.
- **Delete** the dead duplicate `readMoveInput` in
  `src/systems/PlayerMovementSystem.ts` (no callers; in-scope cleanup).
- `DungeonInputHandler.bind`'s `actionHandler` and `keyupHandler`
  (`src/systems/DungeonInputHandler.ts`) — replace the if-chain with a
  lookup: `actionFor(normalizeKey(e.key))` dispatching into the existing
  `DungeonInputActions` callbacks. Escape stays literal. The dialog-advance
  Space special case (the `e.key === ' ' && !e.repeat && actions.advanceDialog()`
  check, which runs before suppression) keys off the
  `attack` binding.
- `BuildingInteriorScene.onEnter`'s `escHandler` and `BuildingInteriorScene.update`
  (`src/scenes/BuildingInteriorScene.ts`) — same
  substitution for its Tab/M/F literals and polled Space/Tab checks.
- `KeyboardHeroSystem._keyToColumn` (`src/systems/KeyboardHeroSystem.ts`) — columns map through the
  four movement actions instead of literal `a/w/s/d`.
- `DesktopPlatform.controlHints` / `DesktopPlatform.miniMapHint` and their
  `MobilePlatform` counterparts (`src/core/Platform.ts`) build
  their strings from `labelFor(...)` so the HUD hints stay truthful after
  a rebind. The `'SPACE'` default in `drawInteractionPrompt`
  (`src/ui/InteractionPrompt.ts`) likewise reads
  `labelFor('attack')`.

Out of scope on purpose: Bopca digit choices
(`BopcaSystem.handleKeyDown`, `src/systems/BopcaSystem.ts`) and dev preview scene keys stay literal
— dialog-context and dev-only respectively.

- `[HUMAN]` Full desktop input pass with defaults: move (incl. holding
  Shift mid-walk — must keep walking now), attack, Tab switch, Q/I/G/F/M/R,
  hotbar 1–8 incl. dynamite hold-release, Enter chat, Esc chains in both
  scenes, keyboard-hero minigame.
- `[HUMAN]` Hand-edit localStorage to a hostile payload (unknown actions,
  numbers, `"Escape"`); game must boot on defaults without a console error.

## Phase 2 — Focus ring in Button.ts + SceneManager nav listener

Implement §2.2: `beginMenuFocus`, ring registration inside `drawButton`,
focus visual, `primaryAction`, and the capture-phase listener in
`SceneManager` with its four guards. Adopt in the two simplest surfaces to
prove the loop end to end:

- `PauseMenu.render()` (`src/ui/PauseMenu.ts`) — one `beginMenuFocus('pause')`
  covers all eight tabs, because every tab already renders through
  `addButton` into `ButtonRect[]` and routes through
  `PauseMenu.handleClick`. Mark Resume (MainTab) and each
  tab's Back button `primaryAction`. The reset-confirm dialog
  (the `if (showResetConfirm)` block in `renderSettingsTab`,
  `src/ui/pause/SettingsTab.ts`) calls `beginMenuFocus('pause-confirm')` so the
  ring shrinks to Cancel + Yes, with **Cancel** primary.
- `PostSignupScene.render()` (`src/scenes/PostSignupScene.ts`) — the start
  screen's two buttons
  become Tab-navigable, "Continue to Tutorial" primary. Also replace its
  hand-rolled `inRect` geometry re-derivation in `PostSignupScene.handleClick`
  with the
  `ButtonResult` rects it already gets back from `drawButton`.

- `[HUMAN]` Pause menu: Tab/Shift+Tab/arrows cycle visibly, wrap at both
  ends, Space activates, Space with no focus resumes, Esc still closes,
  mouse hover/click unaffected, click sound fires on keyboard activation.
- `[HUMAN]` Volume sliders (not in the ring — they are raw `ButtonRect`s
  pushed in `renderVolumeSlider`, `src/ui/pause/SettingsTab.ts`): confirm
  focus skips them cleanly rather than trapping.
- `[HUMAN]` With chat input open, Space/Tab type into the field instead of
  driving the ring.

## Phase 3 — Spacebar-accept adoption across the drawButton dialogs

Add `beginMenuFocus` + `primaryAction` to every dialog already on the
button utility, and **delete the bespoke space plumbing it replaces** (a
dialog must not advance twice on one press):

| Surface                                  | One-line adoption                                                                                                                             | Bespoke path removed                                                                                                                                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/ui/DeathScreen.ts`                  | ring + primary on its button (the `drawButton` call in `render`)                                                                              | `handleSpaceBar` method; claims at the `this.deathScreen.handleSpaceBar()` call in `DungeonScene.triggerSpaceAction`, and the `this.combat.deathScreen.handleSpaceBar()` call in `BuildingInteriorScene.update`   |
| `src/ui/LevelCompleteScreen.ts`          | the `drawButton` call in `render`                                                                                                             | `handleSpaceBar` method; claim: the `levelCompleteScreen.isActive` entry in `DungeonScene`'s `overlayClaims` getter                                                                                               |
| `src/ui/LevelUpDialog.ts`                | the `drawButton` call in `render`                                                                                                             | `handleSpaceBar` method; claims: the `levelUpDialog.isShowing` entry in `DungeonScene`'s `overlayClaims` getter, and the `this.levelUpDialog.handleSpaceBar()` call in `BuildingInteriorScene.update`             |
| `src/ui/RewardGrantedDialog.ts`          | the `drawButton` call in `render`                                                                                                             | `handleSpaceBar` method; claims: the `rewardGrantedDialog.isShowing` entry in `DungeonScene`'s `overlayClaims` getter, and the `this.rewardGrantedDialog.handleSpaceBar()` call in `BuildingInteriorScene.update` |
| `src/ui/AchievementNotification.ts`      | the `drawButton` call in `render`                                                                                                             | `handleSpaceBar` method; `AchievementUISystem.handleSpaceBar`, claim: the `achievementUI.isBlocking` entry in `DungeonScene`'s `overlayClaims` getter                                                             |
| `src/ui/QuestDialog.ts`                  | ring; Continue primary, Decline focusable (the `drawButton` calls in `render`)                                                                | none existed — this is the fix                                                                                                                                                                                    |
| `src/ui/SkillBookPrompt.ts`              | ring; **Read** primary (the `drawButton` calls in `render`)                                                                                   | the Space swallow at the `skillBookPrompt.isOpen` entry in `DungeonScene`'s `overlayClaims` getter                                                                                                                |
| `src/ui/PricedMenuPanel.ts`              | ring; Close primary (the `this.closeButton = drawButton(...)` call in `render`)                                                               | scene-owned Space close stays (the `closeHint` label in `render` already promises it) — dedupe, keep one path                                                                                                     |
| `src/ui/FortuneTellerPanel.ts`           | ring; Close primary (the `drawButton` calls in `renderCards` and `renderFortune`)                                                             | claim: the `fortuneTeller?.isOpen` entry in `DungeonScene`'s `overlayClaims` getter                                                                                                                               |
| `src/systems/BuildingSystem.ts`          | ring on its menu (the `drawButton` calls in `renderMenu`)                                                                                     | Space swallow: the `this.building?.menuOpen === true` entry in `DungeonScene`'s `overlayClaims` getter                                                                                                            |
| `src/ui/casino/BlackjackRulesOverlay.ts` | ring; Close primary (the `this.closeButton = drawButton(...)` call in `renderFooter`)                                                         | —                                                                                                                                                                                                                 |
| `src/systems/ClubCasinoSystem.ts`        | ring on Hit/Stand (`renderTurnActions`) and Next Hand (`renderSettledActions`); **no** primary on bet spots — Space must not place bets blind | —                                                                                                                                                                                                                 |

Untouched by design: `DialogBox`, `CitizenDialog`, `NoticeBoardPanel`,
`ChestRewardDialog`, `LootBoxOpener` (advance-anywhere surfaces with no
buttons — their existing Space/any-key paths already match the feedback),
and `InventoryPanel`/`GearPanel` (item grids; a 1-D ring over ~40 slots is
worse than the mouse — deferred, see the non-goals).

- `[HUMAN]` Space-mash a full run: level-up, reward, chest, quest,
  skill-book, shop close, death, level-complete. Every dialog advances
  exactly once per press; no dialog behind another one advances.
- `[HUMAN]` Blackjack: Space never places a bet; Hit/Stand reachable by Tab.

## Phase 4 — Migrate the hand-rolled menus onto addButton

These predate the utility and violate the UI convention besides being
un-navigable. Migrating them is the whole of their adoption cost:

- `StairwellSystem.renderMenu` (`src/systems/StairwellSystem.ts`) — raw
  `fillRect` menu →
  `addButton` rows; ring + primary on the first destination.
- `TowerStairSystem.renderMenu` (`src/systems/TowerStairSystem.ts`) — same.
- `FollowerMenu`'s `_buttonRects` field and `render` method
  (`src/systems/FollowerMenu.ts`) — `_buttonRects` → `addButton`;
  preserve `restrictedToButtonIndex` (tutorial) by drawing restricted-out
  rows `disabled` (disabled buttons already stay out of the registry — the
  `if (!disabled) { _renderedButtons.push(...) }` check in `drawButton`,
  `src/ui/Button.ts` — so the ring skips them for free).
- `ShopSystem`'s `buyRects` field and `renderShopPanel` method
  (`src/systems/ShopSystem.ts`) — `buyRects` → `addButton` rows;
  ring; Close primary.

- `[HUMAN]` Stairwell, tower stairs, follower menu (incl. the tutorial's
  restricted state), and shop all drive by keyboard and look unchanged.

## Phase 5 — The Controls tab (view all bindings)

- the `PauseTab` union (`src/ui/pause/types.ts`) — add `'controls'` to `PauseTab`.
- `src/ui/pause/SettingsTab.ts` — a **Controls** button
  (`BUTTON_PRESETS.primary`) in a new "Controls" section; its Back returns
  to `'settings'`, not `'main'`. Grow the hardcoded settings box height
  constants (the `SETTINGS_BOX_H_MOBILE`/`SETTINGS_BOX_H_DESKTOP` constants
  and their comment in `src/ui/PauseMenu.ts` document that chore).
- New `src/ui/pause/ControlsTab.ts` — §2.3's two sub-views, read-only in
  this phase. Row layout from `stackV` (`src/ui/Box.ts`), text via
  `drawText` + `TEXT_PRESETS.label`/`muted`, chips as small disabled-free
  `drawButton`s with `focusable: false` until Phase 6 arms them. Scroll
  plumbing cloned from the stats tab (the `'stats'` branch of `handleWheel`,
  and `touchScrollStart`/`touchScrollMove`, in `PauseMenu.ts`,
  wheel + touch drag).
- Box height: new `CONTROLS_BOX_H` beside `STATS_BOX_H`, `SPEND_BOX_H`,
  `SKILLS_BOX_H` and `SETTINGS_BOX_H` in `src/ui/PauseMenu.ts`.

- `[HUMAN]` Desktop: every action listed matches what the key actually
  does. Mobile device: Touch view is the default, lists every gesture, and
  the keyboard list is still reachable.
- `[HUMAN]` Short-viewport landscape phone: rows scroll; Back never
  unreachable.

## Phase 6 — Rebinding UI (capture, conflicts, reset)

Arm the chips per §2.3: listening state (`BUTTON_PRESETS.listening`),
capture routing through the `SceneManager` listener (guard 2), steal +
inline notice, per-row Reset, bottom Restore Defaults behind the same
confirm-dialog pattern as Reset Game (`renderResetConfirmDialog` in
`src/ui/pause/SettingsTab.ts`).
Persistence and HUD-hint refresh already work from Phase 1.

- `[HUMAN]` Rebind attack to `j`: HUD hint line updates, `j` attacks,
  Space no longer attacks in the world but still accepts in menus.
- `[HUMAN]` Steal flow: bind Q onto inventory — potion row shows unbound in
  the warning style and the notice names where the key went.
- `[HUMAN]` Escape during capture cancels; Escape cannot be bound.
- `[HUMAN]` Reload the page: bindings survive. Restore Defaults returns
  every row and the HUD hints to stock.
- `[HUMAN]` Rebind movement to arrows-only, then play the keyboard-hero
  minigame — columns must follow the rebind.

## Sequencing

1 → 2 are the foundations and land in order. 3 and 4 both depend only on 2
and can land in either order or in parallel. 5 depends on 1; 6 depends on
1 + 2 + 5. Ship no more than one adoption phase per playtest so a
double-advance regression is attributable.

## What we are deliberately NOT doing

- **No rebindable touch gestures.** The mobile scheme is positional and
  gestural (`MobileTouchState.ts`), not a keymap; the Controls screen gives
  mobile discoverability, which is what the feedback asked for.
- **No 2-D spatial focus.** Draw order is already visual order in every
  menu here; a 1-D ring with wrap is predictable and costs one integer.
- **No focus ring in the item grids** (`InventoryPanel`, `GearPanel`) or on
  the volume sliders. Grid/slider keyboard editing is real scope with its
  own UX questions; nothing in the feedback asks for it. The ring skipping
  them cleanly is a Phase 2 `[HUMAN]` check.
- **No gamepad support.** The action abstraction in Phase 1 is the
  prerequisite if it is ever wanted; nothing here forecloses it.
- **No chorded bindings** (Shift+X). One normalized key per slot, two slots
  per action.
