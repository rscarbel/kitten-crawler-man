# Blackjack at the Desperado Club

Replace the casino's high-low guessing game with real blackjack: a true 52-card
shoe that never repeats a card until it reshuffles, a dealer with actual
presence and reactions, dealt-card and chip animations, and a rules explainer
for players who have never sat at a table.

The failure mode this plan exists to prevent is the one the current casino
already fell into: a correct little state machine wearing a flat beige panel.
Blackjack is _tactile_ — cards slide, chips clink, the hole card flips, the
dealer reacts. **Sections 7 (animation) and 10 (review rounds) are the parts
that must not be skipped.** A phase is done when it looks right on a phone and
on a desktop, not when it compiles.

---

## 0. Progress board

Tick a box only when that phase's **exit criterion** is met.

> **For agents working this plan:** update the boxes as you go and append to
> §10.4's review log after every review round. Other agents are active in this
> repo — make targeted edits to this file, never rewrite it wholesale.

| Phase | What                                           | Exit criterion                                      | Status |
| ----- | ---------------------------------------------- | --------------------------------------------------- | ------ |
| 1     | Deck + rules engine (pure, no rendering)       | Invariants in §3.6 hold                             | [ ]    |
| 2     | Table state machine                            | Full round playable via preview, no UI              | [ ]    |
| 3     | Card renderer (`PlayingCard.ts`)               | All 52 faces + back reviewed as a rendered sheet    | [ ]    |
| 4     | Responsive layout engine                       | Both layouts measured at the §6.4 viewport matrix   | [ ]    |
| 5     | Panel wiring — betting/hit/stand/double        | Round playable end to end with mouse and touch      | [ ]    |
| 6     | Dealer visuals (world figure + panel portrait) | Dealer passes review rounds §10                     | [ ]    |
| 7     | Animations + juice                             | Deal/flip/chip/payout all reviewed in motion        | [ ]    |
| 8     | Rules explainer overlay                        | Readable at 360×640 and 1920×1080                   | [ ]    |
| 9     | Audio, achievements, VIP-perk wiring           | `coinsWageredThisVisit` still feeds the escort perk | [ ]    |
| 10    | Review rounds + validation gates               | Two consecutive clean rounds; §15 gates pass        | [ ]    |
| 11    | _(optional, deferred)_ Split hands             | —                                                   | [ ]    |
| 12    | _(optional, deferred)_ Insurance               | —                                                   | [ ]    |

---

## 1. What exists today

| Thing                                                                                                 | Where                                                                                                                                                                                                                                                              | Fate                                                                               |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| High-low game, panel, click routing                                                                   | `src/systems/ClubCasinoSystem.ts` (522 lines)                                                                                                                                                                                                                      | **Rewritten** — file keeps its name and public surface                             |
| `open`, `openTable`, `close`, `handleClick`, `renderPanel`, `coinsWageredThisVisit`, `jackpotPending` | same file                                                                                                                                                                                                                                                          | **Public surface preserved** — `DesperadoClubSystem` calls all of these            |
| Host wiring: construction, `modalOpen`, `dismissModal`, `handleClick`, `renderUI`, jackpot drain      | `src/systems/DesperadoClubSystem.ts:203, 231-239, 260-263, 312-315, 374-395, 555-577`                                                                                                                                                                              | Unchanged if the surface holds                                                     |
| Station tile + prompt                                                                                 | `src/core/clubLayout.ts:56` (`casino` at tile 20,4)                                                                                                                                                                                                                | Label re-flavoured (§9.4)                                                          |
| Casino furniture                                                                                      | `src/core/clubProps.ts:75-79` — `club_casino_table` at (19,5), shelf, two stools. Baked by `drawCasinoTable()` at `scripts/generate-club-furniture-sprite.ts:1294`; family entry at :1715 (3 tiles wide, 2 variants)                                               | Re-baked as a blackjack table in Phase 6                                           |
| Offline card art                                                                                      | `drawPlayingCard(ctx, x, y, angle, pipColor)` at `scripts/generate-club-furniture-sprite.ts:1405` — bakes two dealt cards + three chip stacks into the table PNG                                                                                                   | Node-only, not importable at runtime; useful as a **visual reference** for Phase 3 |
| Dealer figure                                                                                         | `src/sprites/clubNpcSprite.ts:44` — one `FIXED_STYLES.dealer` palette entry (`#14322a` outfit) on the shared humanoid. `poseFor()` (:314) special-cases only `dancer`/`dj`/`patron`, so the dealer falls through to `idlePose` — it has **no dealing pose at all** | **Replaced** by a dedicated dealer renderer                                        |
| Casino audio                                                                                          | Eight recorded mp3s in `src/audio/casino/`, registered as `casino_*` ids in `SOUND_IDS_TUPLE` and `SOUND_MANIFEST`                                                                                                                                                 | Mapped to beats in §9.1                                                            |
| Scene wiring                                                                                          | `BuildingInteriorScene.ts` — club constructed at :442-453, `update` at :1056, click routing :1189-1192, `renderUI` :1664-1666, Y-sort pass :1545/:1560, Esc chain :739-741                                                                                         | Unchanged. The club has **no `dispose()`** and needs none                          |
| Jackpot achievement                                                                                   | `src/core/AchievementManager.ts:126-129` (`casino_jackpot`)                                                                                                                                                                                                        | Description + trigger re-tuned (§9.2)                                              |
| Modal shrink-to-fit                                                                                   | `fitModal` / `beginModalFit` / `modalFitPoint` in `src/ui/Box.ts:441-492`                                                                                                                                                                                          | Reused, but not sufficient alone (§6.1)                                            |

The existing panel is a single fixed 460×500 design-space box that `fitModal`
uniformly shrinks on short viewports. Blackjack needs more rows and a wider
table, so uniform shrink alone would produce unreadable 6px text on a phone.
Phase 4 handles that properly.

---

## 2. Design decisions

Settled, so implementation phases don't relitigate them.

1. **One 52-card deck**, not a multi-deck shoe. One deck makes the "cannot
   resurface" rule visible to the player within a few hands.
2. **Reshuffle when, at the end of a round, 17 or fewer cards remain.** Named
   constant `RESHUFFLE_THRESHOLD = 17`.
3. **The shoe persists for the whole game session**, stored on `ClubMembership`
   (§3.4) so leaving and re-entering the club cannot reroll it. The panel shows
   a "Cards left: N" readout.
4. **Dealer stands on all 17** (S17), including soft 17.
5. **Payouts**: natural blackjack 3:2, ordinary win 1:1, push returns the stake,
   loss forfeits it. Double down doubles the stake for exactly one more card.
6. **No split, no insurance, no surrender in v1** — both are deferred phases
   (§11, §12).
7. **Betting is chip-stacking**: tap 10 / 25 / 50 chips onto the felt, table
   minimum 10, maximum 100 (§4.4).
8. **Chips are `player.coins` rendered as chips** — one balance, not a buy-in
   wallet. Coins move the instant a chip leaves or returns to the tray, and
   anything on the felt is refunded when the table closes. A player who cannot
   cover the minimum is turned away warmly (§7.8).
9. **Cards are procedural canvas art**, not a PNG sheet — 52 faces at readable
   size is a large bake for art that is fundamentally vector-simple, and the
   panel needs to scale continuously across viewports.
10. **The dealer is procedural too**, matching the rest of the club's cast
    (`clubNpcSprite.ts` draws every club NPC at runtime). No new PNG pipeline.
11. **The dealer is named Deuce** and reacts to the hand (§7.7).

---

## 3. Phase 1 — Deck and rules engine

New file: **`src/systems/casino/Deck.ts`**

```ts
export const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
export type Suit = (typeof SUITS)[number];

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
export type Rank = (typeof RANKS)[number];

export interface Card {
  readonly rank: Rank;
  readonly suit: Suit;
}
```

### 3.1 The deck object

A `Deck` class holding a `Card[]` plus a **draw cursor**, not a shrinking array
— popping from an array and pushing back on reshuffle is where "a dealt card
resurfaced" bugs come from. The cursor makes the invariant structural:

- `private readonly cards: Card[]` — all 52, permuted in place.
- `private cursor = 0` — everything at index `< cursor` has been dealt this
  shoe and is unreachable until `shuffle()` runs.
- `get remaining(): number` → `cards.length - cursor`.
- `draw(): Card | null` → returns `cards[cursor++]`, or `null` when exhausted.
  **Return `null`, do not throw and do not auto-reshuffle mid-round** — a
  mid-round reshuffle would put a dealt card back in play. The table treats
  `null` as a defect-level condition (§3.5).
- `shuffle(): void` → resets `cursor = 0` and Fisher–Yates permutes in place.
  Mirror the existing `shuffleTracks` implementation in
  `src/audio/AudioManager.ts:33-40` for style consistency.
- `get needsReshuffle(): boolean` → `remaining <= RESHUFFLE_THRESHOLD`. Queried
  only between rounds.

Randomness is `Math.random()`. The repo's seeded generator (`mulberry32` in
`src/sprites/person/rng.ts`) is for things that must be reproducible —
appearances, terrain — and a shuffle must not be. The preview harness (§10.1)
may seed its own deck for repeatable review; the shipped table does not.

### 3.2 Rules

New file: **`src/systems/casino/blackjackRules.ts`** — pure functions, no state.

```ts
export interface HandValue {
  readonly total: number;
  /** True when an ace is still counted as 11 — the hand can absorb a bust. */
  readonly soft: boolean;
}

export function handValue(cards: ReadonlyArray<Card>): HandValue;
export function isBust(cards: ReadonlyArray<Card>): boolean;
export function isNaturalBlackjack(cards: ReadonlyArray<Card>): boolean; // exactly 2 cards, total 21
export function dealerShouldHit(cards: ReadonlyArray<Card>): boolean; // total < DEALER_STANDS_ON (17)
export function settleRound(player, dealer): RoundOutcome;
```

Ace handling: count every ace as 1, then promote **one** ace to 11 if that keeps
the total ≤ 21. Named constants — `ACE_LOW = 1`, `ACE_HIGH = 11`,
`BLACKJACK_TOTAL = 21`, `DEALER_STANDS_ON = 17`, `FACE_CARD_VALUE = 10`,
`NATURAL_HAND_SIZE = 2`.

### 3.3 Outcome type

A discriminated union, so the settle logic can't return an impossible pairing of
result and payout:

```ts
export type RoundOutcome =
  | { kind: 'player_blackjack' } // 3:2
  | { kind: 'player_win' } // 1:1
  | { kind: 'dealer_win' } // stake lost
  | { kind: 'push' }; // stake returned
```

Payout is derived from the outcome by a single `payoutFor(outcome, stake)`
function so the number appears in exactly one place. Constants:
`BLACKJACK_NUMERATOR = 3`, `BLACKJACK_DENOMINATOR = 2`, `EVEN_MONEY = 1`.

### 3.4 Where the shoe lives

The shoe outlives the club scene, so `Deck` round-trips through a plain
serializable value rather than being handed around as a live class instance:

```ts
export interface ShoeState {
  readonly cards: ReadonlyArray<Card>;
  readonly cursor: number;
}
export function createShoe(): ShoeState; // fresh, shuffled
// Deck.fromState(state) / deck.toState()
```

`ClubMembership` (`src/core/ClubMembership.ts`) — the plain object already
threaded by reference through the `DungeonScene` ↔ `BuildingInteriorScene`
constructors as the club's cross-scene state bag — carries it:

```ts
export interface ClubMembership {
  hasDesperadoPass: boolean;
  /** The casino's shoe, persisted across club visits so walking out can't reroll a bad deck. */
  casinoShoe: ShoeState | null;
  /** Null until the player answers Deuce's offer to stop calling the plays (§8.3). */
  casinoHintsEnabled: boolean | null;
}
```

`createClubMembership()` initialises both to `null`; `ClubCasinoSystem` hydrates
a `Deck` on construction (creating a fresh shoe when `null`) and writes
`deck.toState()` back after every round. Staying `null` until first play means a
player who never gambles carries no deck state.

### 3.5 The exhausted-deck path

With `RESHUFFLE_THRESHOLD = 17` and a maximum of ~11 cards per round (a hand
cannot exceed 11 cards without busting), the deck can never run dry mid-round.
`draw()` still returns `Card | null` because the type system should not be lied
to (**no `!`, no `as`** — CLAUDE.md). The table's handling of `null`: abort the
round, refund the stake, force a reshuffle, and surface a feedback line. That
path should be unreachable; make it safe rather than asserting.

### 3.6 Exit criterion — invariants to verify

Verify from the preview harness (§10.1) or a throwaway scratchpad script:

1. A freshly shuffled deck contains all 52 `(rank, suit)` pairs exactly once.
2. Drawing all 52 yields 52 distinct cards; the 53rd draw is `null`.
3. Across 10,000 simulated rounds with reshuffles, **no card identity appears
   twice between two consecutive shuffles.** This is the rule the feature exists
   for — test it directly, don't infer it from the code shape.
4. `handValue` on A+A+9 is `{ total: 21, soft: true }`; A+A+A+9 is
   `{ total: 12, soft: false }`; A+K is a natural.
5. Reshuffle fires only at round end, and only when `remaining <= 17`.

---

## 4. Phase 2 — Table state machine

New file: **`src/systems/casino/BlackjackTable.ts`** — all game state, zero
rendering and zero canvas imports. Keeping this separable is what makes Phases 1
and 2 testable and makes the animation layer in Phase 7 a pure presentation
concern.

### 4.1 Phases

```ts
export type TablePhase =
  | 'turned_away' // can't cover the table minimum; Deuce says come back
  | 'betting' // stacking chips; no cards on the felt
  | 'dealing' // animated initial deal — input locked
  | 'player_turn' // hit / stand / double
  | 'dealer_turn' // hole card flips, dealer draws — input locked
  | 'settled'; // outcome shown, "Next Hand" available
```

`turned_away` is entered from `openTable` when `player.coins < TABLE_MINIMUM`,
and from `settled` when the last payout leaves them short. It is a real phase
rather than a refused interaction, so the player still gets the panel and the
dealer (§7.8).

`dealing` and `dealer_turn` exist so the animation layer has real phases to
occupy rather than the panel faking a delay. **The table is frame-driven**: it
exposes `update()`, called once per frame from `ClubCasinoSystem.update()`,
which `DesperadoClubSystem.update` calls beside `barShop.update()` at
`DesperadoClubSystem.ts:245-246`.

### 4.2 State

- `deck: Deck`
- `playerHand: Card[]`, `dealerHand: Card[]`
- `holeCardRevealed: boolean` — the dealer's second card is dealt face down.
- `pendingBet: number[]` — the chip stack on the felt, one entry per chip.
- `stake: number`, `doubled: boolean`
- `outcome: RoundOutcome | null`
- `phase: TablePhase`
- `coinsWagered` — accumulates every coin staked, including the double-down
  increment, feeding `coinsWageredThisVisit`.

### 4.3 Actions

`addChip(denomination, player)`, `clearBet(player)`, `repeatLastBet(player)`,
`deal(player)`, `hit(player)`, `stand()`, `doubleDown(player)`,
`nextHand(player)`. Each is a no-op outside its legal phase — the panel also
must not _draw_ an illegal button, but the guard belongs in the model too.

Double-down legality: exactly two cards in hand, `player.coins >= stake`, and
phase is `player_turn`.

### 4.4 The betting model

```ts
export const CHIP_DENOMINATIONS = [10, 25, 50] as const;
const TABLE_MINIMUM = 10;
const TABLE_MAXIMUM = 100;
/** Unlocks only after the free-escort wager gate is already cleared, so the perk economy can't be short-circuited. */
const HIGH_ROLLER_MAXIMUM = 250;
const HIGH_ROLLER_UNLOCK_WAGERED = 500;
```

The tray beside the felt is `player.coins` rendered as a chip stack. There is no
separate chip balance to reconcile, so no exit path can strand a coin:

- `addChip(d, player)` — refuses when `player.coins < d`, when the stack would
  exceed the effective table maximum, or outside `betting`. Otherwise it
  **debits `player.coins` immediately** and pushes `d` onto `pendingBet`. The
  tray visibly shrinks as the felt stack grows, because they are the same money.
- `clearBet(player)` — pops every chip back, crediting `player.coins`.
- `deal(player)` — requires `pendingBet` to total at least `TABLE_MINIMUM`. The
  coins are already debited, so this deducts nothing; it locks the stake.
- Payouts credit `player.coins` directly, as the current high-low game does at
  `ClubCasinoSystem.ts:202`.
- `effectiveMaximum(player)` = `min(tableMaximum, player.coins + stakedSoFar)`.
  A player with 40 coins cannot stack past 40 — the 50 chip draws disabled with
  a "You're 10 short" feedback line rather than silently failing.
- Double-down debits a second stake when taken, under the same guard.

**The one place coins can leak** is a `pendingBet` still on the felt when the
table closes. `close(player)` therefore calls `clearBet(player)` first and is
idempotent. Most exits route through it — `DesperadoClubSystem.dismissModal()`
(:312), the Leave Table button, the Esc chain — but the _walk-away_ case has no
exit callback at all, so `ClubCasinoSystem.update()` also refunds if the panel
has been closed with a stack pending. Verified in §4.6.

The 100 ceiling keeps the VIP-escort economy intact: the escort is free once
`coinsWageredThisVisit > 500` (`ClubVipLoungeSystem.ts:55, 133-138`), and a
higher base bet would let two hands buy a perk currently priced at roughly six.
`HIGH_ROLLER_MAXIMUM` unlocks only after that gate is cleared, so it can never
accelerate it.

`repeatLastBet` re-stacks the previous hand's chips in one tap, clamped to what
the player can now afford — the reason `settled` has a "Same Bet" button beside
"Next Hand".

### 4.5 Round flow

1. `betting` → chips are stacked, then `deal` locks the staked total, deals
   P, D, P, D-face-down, and enters `dealing`.
2. `dealing` completes (animation driven) → if the player has a natural, skip
   straight to `dealer_turn` to check for a dealer natural (push) and settle.
   Otherwise `player_turn`.
3. `player_turn` → `hit` draws; bust settles immediately as `dealer_win`.
   `stand` / a completed `doubleDown` → `dealer_turn`.
4. `dealer_turn` → reveal hole card, then draw while `dealerShouldHit`, one card
   per animation beat.
5. → `settled`. Pay out. **Then and only then** check `deck.needsReshuffle` and
   shuffle, flagging `reshufflePending` so the panel can play the shuffle
   flourish (§7.5).

### 4.6 The conservation invariant

Chips are coins, so the money must be provably conserved. Verify in the preview
harness alongside the deck invariant:

1. Across 10,000 simulated rounds, `player.coins` after each round equals the
   coins before it, plus the payout, minus the stake — no drift.
2. Stacking chips and then closing the panel mid-bet returns the player to
   **exactly** their starting coins, by every exit path: Leave Table, Esc, and
   walking away without closing.
3. Taking a double-down and then closing mid-hand never refunds the locked
   stake (that money is legitimately on the felt) and never double-refunds it.
4. The tray total plus the felt stack always equals what the player would hold
   if they cashed out right now.
5. 50 stack-then-clear cycles leave `coinsWageredThisVisit` at zero (§9.3) —
   reversible bets must not count as wagers.

Invariant 2 is the one that will actually break. Write it first.

### 4.7 Exit criterion

Playable to completion from the preview scene (§10.1) with keyboard-only input
and a text readout — before any card art exists.

---

## 5. Phase 3 — The card renderer

New file: **`src/ui/casino/PlayingCard.ts`**

```ts
export function drawCardFace(ctx, card: Card, rect: CardRect, opts?: CardDrawOpts): void;
export function drawCardBack(ctx, rect: CardRect, opts?: CardDrawOpts): void;
```

`CardDrawOpts` carries `flipProgress` (0–1, for the horizontal squash during a
flip), `alpha`, `liftShadow`, and `highlight` (a glow for the winning hand).

### 5.1 Visual spec

- **Body**: `drawBox` from `src/ui/Box.ts` with a warm-white fill, gold-ish
  border, and a rounded radius proportional to card width — the current casino
  already does this at `ClubCasinoSystem.ts:375-384`; keep the palette family
  (`#f4ecd8` face, `#c8a840` border) so the cards belong to the club.
- **Corner indices**: rank + small suit glyph at top-left, rotated 180° at
  bottom-right. Red for hearts/diamonds, near-black for spades/clubs — named
  constants `SUIT_RED = '#b02a2a'`, `SUIT_BLACK = '#1a1410'`.
- **Pips**: number cards get the standard pip arrangement for their rank. Face
  cards (J/Q/K) get a simple two-tone court figure; the ace gets one large
  centred suit glyph.
- **Back**: a club-branded pattern — diagonal lattice in the club's green/gold
  over a deep felt colour, with a small centred emblem. It must read as
  _obviously not a face_ at the smallest size the §6.4 matrix produces.

### 5.2 The `ctx` rule

CLAUDE.md forbids raw `ctx.fillRect` / `fillText` for UI chrome. Card **chrome**
(body, border, rank text) therefore goes through `drawBox` / `drawText`. Suit
pip geometry is vector illustration with no utility equivalent, so raw `ctx`
path drawing is confined to this one module, with a file-header comment stating
that boundary explicitly. Raw `ctx` must not leak into the panel layout code.

Suit glyph drawing gets one function per suit behind a
`Record<Suit, (ctx, cx, cy, size, color) => void>` lookup — no `switch` chains,
no string comparisons at call sites.

### 5.3 Sizing

Every dimension derives from a single `width` on `CardRect`; height is
`width * CARD_ASPECT` (`CARD_ASPECT = 1.4`, the poker-card ratio). Corner index
size, pip size, radius and border width are all fractions of width, named:
`CORNER_INDEX_WIDTH_FRACTION`, `PIP_WIDTH_FRACTION`, and so on. This is what
lets Phase 4 shrink cards for phones without a second art path.

### 5.4 Exit criterion

The preview scene (§10.1) renders **all 52 faces plus the back at three sizes**
in a grid, and that sheet passes a review round. Specifically check: no rank
index collides with a pip, face cards are distinguishable at the smallest size,
red/black are distinguishable, and the back cannot be mistaken for a face.

---

## 6. Phase 4 — Responsive layout

New file: **`src/ui/casino/casinoLayout.ts`** — a pure function from viewport to
a fully-resolved layout object. No drawing.

```ts
export type CasinoLayoutMode = 'wide' | 'compact';

export interface CasinoLayout {
  readonly mode: CasinoLayoutMode;
  readonly panel: { x: number; y: number; width: number; height: number };
  readonly dealerPortrait: Rect | null; // null in compact mode
  readonly dealerHand: Rect;
  readonly playerHand: Rect;
  readonly cardWidth: number;
  readonly chipTray: Rect;
  readonly actionRow: Rect;
  readonly statusRow: Rect;
  readonly helpButton: Rect;
  readonly leaveButton: Rect;
}
```

### 6.1 Layout mode first, `fitModal` second

`fitModal` (`src/ui/Box.ts:465`) scales the whole panel about the viewport
centre by a single factor derived from height, flooring at 0.35. On a 360×640
phone a 640px-tall blackjack panel would render at ~0.9 and still overflow
horizontally; on a landscape phone (640×360) it would hit ~0.48 and put the
action buttons at 20px tall — below any usable touch target. So: **choose a
layout first, then let `fitModal` handle the residual.**

- `mode = 'wide'` when `viewportWidth() >= WIDE_LAYOUT_MIN_WIDTH` (760) — dealer
  portrait on the left, felt on the right, chip tray and action row side by side.
- `mode = 'compact'` otherwise — portrait becomes a slim header bust, hands
  stack vertically, buttons become a two-column grid.

Each mode has its own design height; `fitModal` is called with _that_ mode's
height, so the shrink factor stays near 1 in both.

`src/ui/FortuneTellerPanel.ts` is the closest precedent for a self-contained
mini-game modal: it branches on `platform.isMobile` (`src/core/Platform.ts:87`)
for its hint text, supports tap-outside-to-close, and hit-tests using the
`contains` callback that `drawButton` returns rather than hand-recorded rects.
Follow it. The parallel `CasinoButton[]` of raw rects in the current casino
(`ClubCasinoSystem.ts:111-117, 219-239`) is the kind of duplication that lets a
hit box drift from its art.

### 6.2 Touch targets

`MIN_TOUCH_TARGET_PX = 44` in **post-fit** space. Because `fitModal` scales
everything, the layout divides 44 by `fit.scale` when sizing buttons in design
space. Getting this backwards is the easy mistake — compute the fit first, then
derive design-space button heights from it.

### 6.3 Card fan geometry

Hands overlap rather than sitting in a row: each card after the first is offset
by `cardWidth * CARD_OVERLAP_FRACTION` with a slight per-card rotation
(`CARD_FAN_DEGREES` scaled by index) so a five-card hand still fits the felt at
360px wide. The overlap fraction tightens as hand size grows. A `handSpread()`
helper returns per-card `(x, y, rotation)` and is used by both the renderer and
the animation layer, so a card in flight lands exactly where the static layout
would have put it.

### 6.4 Exit criterion

The preview scene renders the panel at this matrix and every one is screenshot-
reviewed:

| Viewport    | Mode                                 | Notes                                           |
| ----------- | ------------------------------------ | ----------------------------------------------- |
| 360 × 640   | compact                              | phone portrait — the hard case                  |
| 390 × 844   | compact                              | modern phone portrait                           |
| 844 × 390   | wide                                 | phone landscape — the _other_ hard case (short) |
| 768 × 1024  | compact-or-wide (check the boundary) | tablet portrait                                 |
| 1280 × 720  | wide                                 | laptop                                          |
| 1920 × 1080 | wide                                 | desktop — must not look sparse/stretched        |

Checks: nothing clipped, no overlap, all text legible, every button ≥ 44px on
screen, a 5-card hand fits at every size.

---

## 7. Phases 5–7 — Panel, dealer, and juice

**Phase 5 (panel wiring)** is the unglamorous middle: `ClubCasinoSystem` becomes
a thin presentation host over `BlackjackTable` — it draws the layout from §6,
renders hands with §5's card renderer, draws the chip tray and the Hit / Stand /
Double / Next Hand buttons through `drawButton` (hit-tested via the returned
`contains`), calls `notifyButtonClick` so the panel's buttons make a sound, and
forwards every press to a table action. No game logic lives here. Exit
criterion: a full round playable with mouse **and** touch, cards as plain static
rectangles if Phase 3 isn't landed yet.

**Phases 6 (dealer) and 7 (juice)** are what make it fun. Everything below is
time-based off an accumulating `animTime` in `ClubCasinoSystem.update()`,
mirroring `DesperadoClubSystem.animTime`.

### 7.1 Card dealing

Each card gets an entry in an `AnimatingCard[]` queue: origin (the shoe, drawn
at the felt's top-right), destination (from `handSpread()`), start time, and
duration. Position is an ease-out interpolation; the card also scales slightly
up mid-flight and settles with a small overshoot. Cards deal **sequentially**
with `DEAL_STAGGER_MS` between them, so the opening deal reads as
player-dealer-player-dealer rather than four cards appearing.

The table's `dealing` phase ends when the queue drains — the model waits on the
animation, not a fixed timer.

### 7.2 The hole-card flip

The dealer's face-down card flips by scaling X from 1 → 0 (back) → 1 (face)
across `FLIP_DURATION_MS`, with the face swapping at the midpoint. This is the
single most satisfying beat in blackjack; give it its own moment — a short pause
before the flip, and the dealer's draw beats staggered by
`DEALER_DRAW_STAGGER_MS` after it.

### 7.3 Chips — the player's gold on the felt

Two stacks, and between them they always account for every coin the player owns:

- **The tray** — `player.coins` rendered as chips, greedily broken into the
  largest denominations that fit, capped at `TRAY_MAX_VISIBLE_CHIPS` with a
  numeric total beneath so a rich player doesn't produce a skyscraper.
- **The felt stack** — the `pendingBet` array, one drawn chip per entry,
  coloured by denomination and offset slightly from the one below so a 100 bet
  reads as a real stack rather than one fat token.

Every movement is a chip physically travelling between the two, because that is
what the model does:

- **Betting** — the chip lifts off the tray, arcs to the felt, lands with a
  small bounce and a settle wobble. Removing it reverses the same arc. The
  tray's total ticks down as it leaves, never after.
- **Winning** — the dealer's matching stack slides in from Deuce's side, merges
  with the player's, and the whole pile arcs back into the tray with a coin
  burst. The coin counter counts up during the arc, not on impact.
- **Losing** — the player's stack slides away to the dealer's rack. No burst,
  no lingering; the felt clears fast.
- **Push** — the stack arcs straight back to the tray, unhurried, no fanfare.
- **Cashing out** — on leaving the table with chips still on the felt, they
  sweep back to the tray and the coin counter reconciles before the panel
  closes. The player must _see_ the money come back, or the refund reads as a
  loss no matter what the number says.

Chip colours get named constants reusing the palette already baked into the club
table art (`generate-club-furniture-sprite.ts:1377-1378`: `#c8323c` red,
`#2f5ec8` blue, `#d8b432` gold) so the chips in the tray match the chips painted
on the furniture.

### 7.4 Outcome feedback

- **Win**: gold pulse around the player's hand, the total readout scales up and
  settles, a burst of coin particles, and the dealer portrait plays its
  "concede" reaction.
- **Blackjack**: a distinct banner treatment (`BLACKJACK!` in the gold preset
  with a glow sweep) — it pays 3:2 and should _feel_ different from a plain win.
- **Bust**: the hand's cards shake briefly and desaturate; a red vignette pulses
  once. Keep it short — losing repeatedly with a long animation is miserable.
- **Push**: neutral; chips slide back, no fanfare.

### 7.5 The shuffle flourish

When `reshufflePending` fires at round end (§4.5), play a 1-second riffle: the
deck splits into two halves that interleave with a quick cascade, then the
"Cards left: 52" readout ticks back up. This is the moment the player _learns_
the deck is real — it must be visible and unmissable, not a silent counter
reset.

### 7.6 The dealer's animation

Two renderings of the dealer, both procedural:

- **World figure** — the standing NPC at tile (20,4). Add a `dealing` motion to
  `ClubNpcMotion` (`clubNpcSprite.ts:307`) and a `dealerPose()` branch in
  `poseFor()` (:314), so that while the table is open the figure in the room
  sweeps a hand across the felt instead of idling.
- **Panel portrait** — an upper-body render inside the modal (wide mode) or a
  slim bust header (compact). This is the one the player looks at, and it needs
  real states: `idle`, `dealing`, `flipping`, `waiting_on_player`, `concede`
  (player wins), `smug` (house wins), `impressed` (player blackjack), `bust`
  (dealer busts). Drive it from the table phase plus the settled outcome.

The portrait is where the character lives — hands, sleeves, a visible deck and
shoe, eyes that track the player's hand. Budget real time here; it is the single
biggest lever on "the casino feels alive."

### 7.7 Deuce — the dealer as a character

The dealer is **Deuce**, a named regular of the club's cast alongside Sledge,
Bomo, Rosemarie and Mordecai. Unfailingly courteous, entirely unbothered by
either outcome, and quietly delighted when someone plays well.

Banter is a one-line speech strip under the portrait, drawn with `drawText` in
the muted preset, shown for `BANTER_HOLD_MS` then fading. Lines live in a data
file — `src/ui/casino/deuceLines.ts` — as a
`Record<BanterTrigger, readonly string[]>`, picked at random with the last-used
index tracked so the same line never fires twice running:

| Trigger            | Feel                                      |
| ------------------ | ----------------------------------------- |
| `first_sit`        | Welcome + a nudge toward the rules button |
| `player_blackjack` | Genuine appreciation                      |
| `player_bust`      | Sympathetic, never mocking                |
| `dealer_bust`      | Wry self-deprecation                      |
| `push`             | Neutral                                   |
| `big_win`          | Impressed                                 |
| `reshuffle`        | Flags the fresh deck out loud             |
| `turned_away`      | Warm "come back any time" (§7.8)          |
| `cashed_out`       | Sees the player off with their chips      |
| `long_session`     | A warm word after ~20 hands               |

Keep every line to one rendered line at the compact panel width, and keep
Deuce's tone consistent: the house always wins eventually, and Deuce knows it,
so there is nothing to gloat about. A dealer who taunts the player on a loss
turns a losing streak from a story into an insult.

### 7.8 Turned away, warmly

A player who cannot cover the table minimum still gets the panel — Deuce, the
felt, an empty tray — and a line to the effect of _"House minimum's ten, friend.
Table's here whenever you are — come back with a few coins and I'll deal you
in."_ One button: **Leave Table**. No bet controls draw at all.

Two entry points: sitting down broke (`openTable` → `turned_away`), and busting
out mid-session (the payout that empties the tray drops `settled` →
`turned_away` after the outcome has been shown, never cutting the result short).

Tone is the whole feature. This is a player who just lost everything, and the
line has to land as an open invitation rather than a rejection — Deuce is
holding a seat for them, not showing them the door. Written badly it is the most
deflating screen in the game; written well it is a reason to come back with the
next dungeon's loot.

The empty tray is drawn, not hidden — an outline where the chips were, so the
turn-away is legible at a glance without reading the line.

### 7.9 Idle life

Between hands the dealer breathes, occasionally squares the deck or taps the
felt. The felt has a subtle vignette and the club's dance-floor colour bleeds
faintly across the panel edge, tying the modal to the room behind it.

### 7.10 Reduced motion

If a motion/quality setting is available (check the `RenderQuality` / `Settings`
singletons), gate the particle bursts and shuffle flourish behind it, keeping
the deal and flip since those carry information. Otherwise skip — do not invent
a settings surface for this.

---

## 8. Phase 8 — The rules explainer

New file: **`src/ui/casino/BlackjackRulesOverlay.ts`**

A paged overlay opened by a persistent **`?` / "How to Play"** button on the
panel, and **auto-shown the first time** a player sits at the table in a given
club visit (tracked by a `hasSeenRules` flag on `ClubCasinoSystem`).

`QuestDialog` (`src/ui/QuestDialog.ts`) is the closest existing pattern — paged
title + lines + advance button, with `typing_click` and mobile width handled —
but the explainer needs **illustrations** (real card renders showing a soft 17,
a bust, a natural), which `QuestDialog`'s fixed-line format can't carry. So the
overlay borrows QuestDialog's conventions — same padding constant convention,
same `audio?.play('typing_click')` on page turn, same `advance()` / `dismiss()`
/ `handleClick()` shape — and adds an optional illustration band per page.

### 8.1 Pages

1. **The goal** — beat the dealer's hand without going over 21. Illustration:
   a 20 beating a 19.
2. **Card values** — 2–10 face value, J/Q/K are 10, ace is 1 **or** 11.
   Illustration: A♠ + K♥ shown as 21.
3. **Your turn** — Hit takes another card; Stand keeps what you have; going over
   21 is a bust and loses immediately. Illustration: a bust.
4. **Soft hands** — an ace counted as 11 makes a "soft" hand you can't bust by
   hitting once. Illustration: A + 6 = soft 17.
5. **The dealer's turn** — the dealer reveals the hole card and must draw until
   reaching 17, then must stop. Illustration: the flip.
6. **Blackjack** — an ace plus a ten-value card on the first two cards pays
   3:2. Illustration: a natural.
7. **Double down** — double your bet for exactly one more card. Best on a hard
   9, 10 or 11.
8. **Chips and coins** — your chips _are_ your gold. Tap chips from the tray to
   build a bet (table minimum 10, maximum 100), tap them back to take it down,
   and anything you haven't bet comes home as coins when you leave the table.
   "Same Bet" repeats the last hand. Illustration: a chip stack.
9. **The deck** — one 52-card deck. A card that has been dealt cannot come back
   until the deck reshuffles, which happens once 17 or fewer cards remain — and
   the deck remembers you between visits. Watch the counter. Illustration: the
   shuffle.

Page 9 is not filler: it is the one rule that differs from a naive digital
blackjack, and the counter on the panel is meaningless without it.

A **hints toggle** sits on the last page (§8.3), so the player who wants the
strategy line back always has one place to look for it.

### 8.2 Constraints

- Word-wrapped via `drawText`'s `width` option — no hand-split lines, because
  the panel width differs between layout modes.
- On compact viewports the illustration band shrinks or drops to zero height and
  the text takes the space; the layout function returns `illustration: Rect |
null` the same way §6 does for the portrait.
- Page dots + Back/Next, both ≥ 44px, plus a Close that returns to the table.
- Esc / Space closes the overlay without closing the table — the Esc chain in
  `DungeonInputHandler` → `DesperadoClubSystem.dismissModal` checks the overlay
  _before_ the casino at `DesperadoClubSystem.ts:312`.

### 8.3 The live advice line

Under the action buttons, a one-line contextual hint in the muted preset:
"Dealer shows 6 — standing on 12 or more is the book play." Basic-strategy hints
for the current situation, from a small lookup table in
`src/systems/casino/basicStrategy.ts`. It teaches the game while playing, which
no static explainer does. Keep it factual and short.

The line is **on by default** and retires itself: after
`HINTS_AUTO_FADE_HANDS = 15` hands, Deuce says a version of "you've got the hang
of this — want me to stop calling the plays?" and the line stops. The rules
overlay toggles it back on or off at any time; the choice lives in
`casinoHintsEnabled` on `ClubMembership` (§3.4) so it survives leaving the club.

---

## 9. Phase 9 — Audio, achievements, perks

### 9.1 Audio

The casino's sounds live in `src/audio/casino/` and are registered in
`SOUND_IDS_TUPLE` and `SOUND_MANIFEST`. Preloading is automatic via
`ALL_SOUND_IDS`.

| `SoundId`                | File                  | Use                                                       |
| ------------------------ | --------------------- | --------------------------------------------------------- |
| `casino_deal_card`       | `deal_card.mp3`       | One card sliding out — every `hit`, and each dealer draw  |
| `casino_deal_four_cards` | `deal_four_cards.mp3` | The opening deal, as **one** cue under all four cards     |
| `casino_blackjack_check` | `blackjack_check.mp3` | The hole-card peek/reveal (§7.2)                          |
| `casino_chips_bet_small` | `chips_bet_small.mp3` | A 10 or 25 chip landing on the felt                       |
| `casino_chips_bet_big`   | `chips_bet_big.mp3`   | A 50 chip, or any stack reaching the table maximum        |
| `casino_chips_stack`     | `chips_stack.mp3`     | Payout sweep and cash-out — chips coming home to the tray |
| `casino_shuffle_1`       | `shuffle_1.mp3`       | Reshuffle flourish (§7.5)                                 |
| `casino_shuffle_2`       | `shuffle_2.mp3`       | Reshuffle alternate — `playRandom` between the two        |

Mixing notes that matter more than the mapping:

- **`casino_deal_four_cards` is one cue, not four.** Firing `casino_deal_card`
  four times over the staggered opening deal phases against itself and sounds
  like a stutter. Use the four-card recording for the opening deal and align
  `DEAL_STAGGER_MS` to it, then use the single-card cue for everything after.
- **Chip cues pick by denomination**, so a 50 lands heavier than a 10 — the
  audio does the work of communicating stake size that the chip art also does.
- **Shuffles alternate** via `playRandom(['casino_shuffle_1', 'casino_shuffle_2'])`
  so a long session doesn't loop one recording.
- Cards and chips sit **under** the club music (`CLUB_MUSIC_TRACKS`) and the
  `ambient_bar_crowd` bed already playing in the room — pass reduced `volume`
  and check the stack on a real device ([HUMAN], §10.3).

Existing ids cover the outcome beats: `treasure_chest_reward` on a win,
`achievement_awarded` on a natural, `powering_off` on a loss, `coin_pouch` for
the coin-counter tick during a payout arc.

Button clicks are handled by `setButtonAudio`/`notifyButtonClick` — do **not**
add per-button `play` calls.

### 9.2 Achievements

`casino_jackpot` (`src/core/AchievementManager.ts:126-129`) currently reads
"Win a top-tier wager at the Desperado Club casino." Retarget it to **win a
natural blackjack on a top-tier (100) wager** and update the description text.
The `jackpotPending` flag and its drain at `DesperadoClubSystem.ts:260-263` stay
exactly as they are.

Deferred: a second achievement for a count-aware play (e.g. hitting a hard 16
and drawing the 5). It needs a new `AchievementId`.

### 9.3 The VIP perk

`coinsWageredThisVisit` (`DesperadoClubSystem.ts:220-222` →
`ClubVipLoungeSystem.openPanel`) keeps accumulating **every** coin staked,
including double-down increments. Verify by hand: wager 100, double, and confirm
the VIP lounge sees 200 more.

**It accumulates on `deal`, never on `addChip`.** Chip-stacking makes the bet
reversible, so counting a chip the moment it lands on the felt would let a
player stack and clear 100 five times over and unlock the free bodyguard escort
without ever playing a hand — the coins never actually leave. Increment once,
when the stake locks at `deal`, and again by the increment at `doubleDown`. The
turned-away and cash-out paths must not touch it at all (§4.6, invariant 5).

### 9.4 Interaction prompt

`promptLabel` for the casino station and the station's `label` in
`clubLayout.ts:56` read blackjack-flavoured ("Play Blackjack") rather than a
generic "Casino" prompt.

---

## 10. Phase 10 — Review rounds and verification

### 10.1 Preview harness

New file: **`src/scenes/CasinoPreviewScene.ts`**, routed as `?casino` in
`devBootScene` (`src/game.ts:46-64`, beside `?tiles` / `?bopca` / `?people`).
It offers:

- **Cards tab** — all 52 faces + the back at three sizes (§5.4).
- **Panel tab** — the live table at a selectable viewport from the §6.4 matrix,
  letterboxed so a desktop reviewer sees the phone layout accurately.
- **Dealer tab** — the dealer figure and portrait cycling every animation state.
- **Deck tab** — a live readout: cards remaining, cards dealt this shoe, and a
  "deal 1000 rounds" button that asserts the §3.6 no-repeat invariant and the
  §4.6 conservation invariants, printing a pass/fail line for each.

This scene is dev-only (localhost-gated like the others) and ships no behaviour
to players.

### 10.2 Review rounds

Minimum **three** rounds per visual subject; exit on **two consecutive clean
rounds**. A round means: render it, look at it, write findings in §10.4, fix,
re-render.

| Subject                           | R1  | R2  | R3  | R4  | R5  | Passed |
| --------------------------------- | --- | --- | --- | --- | --- | ------ |
| Card faces + back                 | [ ] | [ ] | [ ] | [ ] | [ ] | [ ]    |
| Panel — compact (360×640)         | [ ] | [ ] | [ ] | [ ] | [ ] | [ ]    |
| Panel — landscape phone (844×390) | [ ] | [ ] | [ ] | [ ] | [ ] | [ ]    |
| Panel — desktop (1920×1080)       | [ ] | [ ] | [ ] | [ ] | [ ] | [ ]    |
| Dealer figure + portrait          | [ ] | [ ] | [ ] | [ ] | [ ] | [ ]    |
| Deal / flip animation in motion   | [ ] | [ ] | [ ] | [ ] | [ ] | [ ]    |
| Chips + payout juice              | [ ] | [ ] | [ ] | [ ] | [ ] | [ ]    |
| Rules overlay, both layouts       | [ ] | [ ] | [ ] | [ ] | [ ] | [ ]    |

### 10.3 [HUMAN] verification

Browser automation in this repo can drive the game, but **rAF stalls to ~1 fps
when the window is occluded**, so animation timing cannot be trusted from an
automated pass. These need a person:

- [ ] Animation _timing_ feels good — deal stagger, flip pause, payout length.
- [ ] `DEAL_STAGGER_MS` is aligned to the `casino_deal_four_cards` recording, so
      each card lands on its own hit rather than drifting against the cue (§9.1).
- [ ] `casino_blackjack_check` reads as the hole-card reveal in context; remap
      it if it plays better on another beat.
- [ ] Real touch interaction on a phone (hit/stand targets, no mis-taps).
- [ ] The panel is fun across ~20 hands, not just correct.
- [ ] Audio mix — cards and chips sit under the club music, don't stack harshly.

Also: the service worker serves a stale bundle. **Unregister it** before
trusting any browser check.

### 10.4 Review log

_(append findings per round — subject, round number, what was wrong, what
changed)_

---

## 11. Deferred — split hands

Not in v1. When wanted: `playerHands: Hand[]` with an `activeHandIndex`, split
legal on a matching-rank pair with the coins to cover a second stake, aces split
receive exactly one card each, the layout needs a second felt row in compact
mode, and `settleRound` becomes per-hand. Budget it as its own plan.

## 12. Deferred — insurance

Not in v1. Offered when the dealer's up card is an ace, costs half the stake,
pays 2:1 on a dealer natural. Needs an extra pre-turn phase, a prompt row, and
an explainer page.

---

## 13. File manifest

**New**

- `src/systems/casino/Deck.ts`
- `src/systems/casino/blackjackRules.ts`
- `src/systems/casino/BlackjackTable.ts`
- `src/systems/casino/basicStrategy.ts` — the hint lookup table (§8.3)
- `src/ui/casino/PlayingCard.ts`
- `src/ui/casino/casinoLayout.ts`
- `src/ui/casino/ChipStack.ts` — chip art + the stack animation (§7.3)
- `src/ui/casino/BlackjackRulesOverlay.ts`
- `src/ui/casino/deuceLines.ts` — banter data, keyed by trigger (§7.7)
- `src/sprites/casinoDealerSprite.ts`
- `src/scenes/CasinoPreviewScene.ts`

**Rewritten**

- `src/systems/ClubCasinoSystem.ts` — becomes the presentation/input host over
  `BlackjackTable`; public surface (`open`, `openTable`, `close`, `handleClick`,
  `renderPanel`, `coinsWageredThisVisit`, `jackpotPending`) preserved, plus a
  new `update()`.

**Edited**

- `src/systems/DesperadoClubSystem.ts` — call `casino.update()` (beside
  `barShop.update()` at :245); route the rules overlay ahead of the casino in
  `dismissModal` (:312); swap the dealer figure to the new renderer (:446).
- `src/sprites/clubNpcSprite.ts` — add the dealing motion/pose (`ClubNpcMotion`
  :307, `poseFor` :314); remove the `dealer` entry from `FIXED_STYLES` (:44)
  once the dedicated dealer lands (**delete it, don't leave a shim** — repo
  rule).
- `scripts/generate-club-furniture-sprite.ts` — re-bake `drawCasinoTable()`
  (:1294) as a blackjack table: the curved dealer's side, painted betting
  circle, chip tray, and card shoe. Re-run the generator and commit the PNG.
- `src/core/ClubMembership.ts` — add `casinoShoe` and `casinoHintsEnabled`
  (§3.4); update `createClubMembership()` and the docblock, which currently
  describes the object as membership-only.
- `src/core/AchievementManager.ts` — `casino_jackpot` description.
- `src/core/clubLayout.ts` — station label.
- `src/game.ts` — `?casino` dev route.

---

## 14. Type-safety notes

CLAUDE.md makes type safety the top priority; these are the spots where this
feature will tempt a violation.

- `Deck.draw()` returns `Card | null`. **Do not** `!` it at the call site —
  handle it (§3.5).
- Suit/rank pools are `as const` tuples with types derived from them; `as const`
  is the only permitted assertion.
- Suit glyph dispatch is a `Record<Suit, DrawGlyph>`, so adding a suit would be
  a compile error rather than a silent fallthrough.
- `RoundOutcome` and `TablePhase` are discriminated unions; every `switch` over
  them is exhaustive with no `default` that swallows new cases.
- Layout returns `Rect | null` for optional regions rather than a sentinel
  zero-rect — narrowing at the draw site, not a magic `width === 0` check.
- No magic numbers: every duration, offset, fraction and threshold in §5–§7 is a
  named constant declared at the top of its module.
- Comments explain _why_ (why the cursor instead of pop, why the fit is computed
  before button sizing), never _what_.

## 15. Validation gates

Run after every phase, not just at the end:

```
npm run typecheck   # must exit 0
npm run lint        # must exit 0
npm run format
```

Other agents are active in this repo. If a gate fails in a file this plan never
touches, or `git status` shows changes unrelated to the casino, that is another
agent's work — note it and move on.
