# Source-Material Items, Desperado Pass Tattoo, and Equipment UI — Implementation Plan

This plan adds eight items from the source material (with drawn icons and award paths), a
Desperado Pass Tattoo granted for beating the Juicer, an interactive RuneScape-style
Equipment tab, hotbar restrictions with visible "not allowed" feedback, and an inventory
search bar.

**This document is scaffolding for the implementing agent.** Never cite it (or any phase
number in it) from code, comments, or other docs. When a reason matters, write the reason
itself into the code. Delete nothing from `docs/` — the maintainer handles cleanup.

## Read first

Load these skills before touching code:

- `game-architecture` — orientation before any change.
- `add-item` — item recipe. Known drift: it names `InventoryActionSystem`, which does not
  exist; the equip/unequip drain lives in `src/systems/kits/MenusKit.ts` plus
  `InventoryInteraction`/`GearPanel`.
- `add-ui` — for the Equipment tab, search bar, and error feedback.
- `add-sound` — only if a new SoundId is added for the slingshot.
- `dev-workflow` — validation gates.

Ground rules from CLAUDE.md apply throughout: no `as` casts, no `!`, no `any`, no magic
numbers (every literal below that carries meaning must land as a named constant), comments
explain _why_ only. Where this plan shows a constant name and value, use that name; values
marked "tune" may be adjusted to fit neighboring code.

Sub-agents are encouraged: phases 1–8 are largely independent once Phase 0 lands; the
Equipment tab (Phase 9) depends on Phases 0, 1, and 8.

---

## Phase 0 — Shared foundations (types and plumbing)

Everything else builds on these. All in small, mechanical steps.

### 0.1 New `InventoryItem` fields (`src/core/ItemDefs.ts`)

Add these optional fields to `InventoryItem` (JSDoc each — these are module-boundary
types):

```ts
/** Damage channels this item resists while equipped. */
resistances?: ResistanceType[];
/** Fraction of incoming mob melee damage reflected back at the attacker while equipped. */
damageReflectPct?: number;
/** While equipped, momentum-based attacks (e.g. the Ball of Swine's trample) are cancelled on contact. */
cancelsMomentum?: boolean;
/** Effective skill-level bonus granted while equipped; stacks with the trained level, capped at the skill's max. */
skillLevelBonus?: Partial<Record<SkillId, number>>;
/** Stat bonus that applies only to melee damage computation, not to the general stat. */
meleeOnlyStatBonus?: Partial<Record<StatName, number>>;
/** Chance per successful melee hit to stun the target while equipped. */
stunOnHitChance?: number;
/** Which crawler can equip this item; omitted means either. */
wearer?: CrawlerKind;
```

Also in `ItemDefs.ts`:

```ts
export type ResistanceType = 'poison' | 'ice' | 'piercing';
```

Widen `InventoryItem.type` from `'consumable' | 'armor'` to
`'consumable' | 'armor' | 'weapon'` (the slingshot uses `'weapon'`).

Import `SkillId` from `src/core/SkillManager.ts` and `CrawlerKind` (already exported
there). If this creates an import cycle (`SkillManager` ← `ItemDefs` is currently the
direction via `skillId`), it already exists for `skillId` — follow the same pattern.

### 0.2 Sub-slot families (rings and toe rings)

`EQUIP_SUBSLOTS` already contains `Ring 1`–`Ring 4` and `Toe Ring 1`–`Toe Ring 4`. Items
must be able to say "I fit any Ring slot". Add to `ItemDefs.ts`:

```ts
/** Strips a trailing slot index so 'Ring 3' and 'Ring' share the family 'Ring'. */
export function subSlotFamily(subSlot: string): string;
export function itemFitsSubSlot(
  item: Pick<InventoryItem, 'equipSubSlot'>,
  subSlot: string,
): boolean;
```

`subSlotFamily` removes a trailing `" <digits>"` suffix. New multi-slot items declare the
family name (`equipSubSlot: 'Ring'`, `'Toe Ring'`); single-slot items are unaffected
(`subSlotFamily('Pants') === 'Pants'`).

### 0.3 `EquipmentManager` changes (`src/core/EquipmentManager.ts`)

- `equip(item, targetKey?)`: optional `targetKey` (`"Slot:SubSlot"` string). When given
  and `itemFitsSubSlot(item, subSlot)` holds, place there (returning any displaced item).
  When absent, scan `EQUIP_SUBSLOTS[item.equipSlot]` for the first _empty_ matching
  sub-slot; if none is empty, displace the first matching one (current behavior for
  exact-name items is preserved because family(x) === x for them).
- Accept `type === 'weapon'`? **No** — equipment stays armor-only; the slingshot is a
  hotbar item (Phase 5). Keep the `type !== 'armor'` refusal.
- Refuse equipping an id that `isEquipped` already reports true for (inventory items are
  id-keyed; the same id in two ring slots would corrupt lookups).
- Wearer eligibility: `EquipmentManager` gains an `ownerKind: CrawlerKind | null`
  (constructor arg, default null). `equip` refuses items whose `wearer` is set and does
  not match. `Inventory`'s constructor threads an optional `ownerKind` through;
  `Player` subclasses pass `'human'` / `'cat'` (find where `HumanPlayer`/`CatPlayer`
  construct or receive their `Inventory` — `Player` declares
  `readonly inventory = new Inventory()`, so the cleanest route is an `ownerKind`
  parameter on `Inventory` with `Player` gaining a protected way for subclasses to
  set it, or moving the `new Inventory(...)` into the subclass constructors).
- New aggregators alongside `getStatBonuses()` (same un-memoised hot-path style):

```ts
hasResistance(type: ResistanceType): boolean;
getDamageReflectPct(): number;        // summed across equipped items
getCancelsMomentum(): boolean;
getSkillLevelBonus(id: SkillId): number;
getMeleeOnlyStatBonus(stat: StatName): number;
getStunOnHitChance(): number;         // summed
```

### 0.4 `Player` consumers (`src/Player.ts` and subclasses)

- `Player.resists(type: ResistanceType): boolean` — reads
  `inventory.equipment.hasResistance(type)` (same shape as `regenMultiplier`).
- **Poison resistance:** in `Player.tickStatusEffects()` (or wherever poison-family
  status damage ticks against a player), halve tick damage for `'poison'`,
  `'spit_venom'`, and `'sepsis'` when `resists('poison')`. Named constant:
  `RESISTED_DAMAGE_FRACTION = 0.5`. Round down, minimum 0.
- **Ice resistance:** no ice damage source exists in the game today. The field is wired
  (aggregator + `resists('ice')`) but has no consumer yet. Do not invent an ice attack;
  leave a consumer-side note only where the resistance enum is defined (a _why_ comment:
  future ice attacks must consult `resists('ice')`).
- **Piercing resistance:** the mob projectile systems that damage players
  (`src/systems/SkeletonProjectileSystem.ts`, `src/systems/GoblinArrowSystem.ts`, and any
  sibling that models arrows/bolts — grep `ProjectileSystem` under `src/systems/`) check
  `target.resists('piercing')` before applying damage and multiply by
  `RESISTED_DAMAGE_FRACTION`. Acid spit and lava are not piercing; leave them alone.
- **Damage reflect:** find where hostile mobs apply melee/contact damage to players
  (grep for calls that damage `HumanPlayer`/`CatPlayer` from mob attack code — the
  contact-damage path in `Mob` or the per-creature attack resolution). At those sites,
  after applying damage to the player, compute
  `reflected = Math.max(1, Math.ceil(damage * player.inventory.equipment.getDamageReflectPct()))`
  when the pct is > 0, and apply it to the attacking mob via
  `mob.takeDamageFrom(reflected, player, 'melee')` so kill credit and loot behave
  normally. Only melee/contact damage reflects — not projectiles, not AoE.
- **Momentum cancel:** in `src/creatures/BallOfSwine.ts`, where trample damage is applied
  to a player, if `target.inventory.equipment.getCancelsMomentum()` is true: skip the
  damage and knockback, and set the swine's momentum to its floor (the same state a flat
  wall slam produces — reuse the existing momentum-loss path rather than writing to the
  private field a second way). The Juicer's sprint is a movement mode, not a
  momentum-based attack; do not touch it.
- **Melee-only stats and stun proc:** `HumanPlayer.getMeleeDamage()` adds
  `equipment.getMeleeOnlyStatBonus('strength')` alongside `this.strength`. In
  `CombatSystem.resolvePlayerAttacks`, where a human melee hit lands on a mob, roll
  `equipment.getStunOnHitChance()`; on success apply
  `makeStun(GAUNTLET_STUN_TICKS)` (constant, suggest 90 ≈ 1.5 s) to the mob. Do not
  stun bosses unless the existing stun machinery already exempts them — follow whatever
  `makeStun` consumers do for bosses today.
- **Effective skill level:** add
  `Player.effectiveSkillLevel(id: SkillId): number` =
  `Math.min(getSkillDef(id).maxLevel, this.skills.getLevel(id) + this.inventory.equipment.getSkillLevelBonus(id))`.
  Switch the pugilism read in `HumanPlayer.getMeleeDamage()` from
  `this.skills.getLevel('pugilism')` to `this.effectiveSkillLevel('pugilism')` (no
  behavior change until an item grants a bonus).

### 0.5 `PlayerDamageType` addition

`src/creatures/Mob.ts`: extend
`export type PlayerDamageType = 'melee' | 'missile' | 'shell' | 'smush' | 'explosion'`
with `'slingshot'`. Audit the consumers the compiler flags: `HAND_SWUNG_DAMAGE_TYPES`
must **not** include it (a calm SkyFowl is provokable by a slingshot rock, same as a
missile), and achievement checks keyed on specific types (`smush`, `magic_touch`,
pugilism training) are unaffected.

### 0.6 Shared item-effect description helper

`GearPanel.renderTooltip` hand-builds `+N Stat` lines. Extract a shared helper (new file
`src/ui/itemEffectLines.ts` or a function in `ItemDefs.ts`):

```ts
/** Human-readable effect lines for an item: stat bonuses, resistances, reflect, skill bonuses, stun chance, regen. */
export function describeItemEffects(item: InventoryItem): string[];
```

Used by `GearPanel.renderTooltip`, the Equipment tab tooltip (Phase 9), and
`InventoryPanel.renderInfoPopup`. Lines: `+4 Constitution`, `Resists: Poison, Ice,
Piercing`, `Reflects 10% of melee damage`, `+2 Iron Punch`, `2% stun on hit`,
`Momentum attacks cannot touch you`, `Cat only` / `Human only`.

**Gate after Phase 0:** `npm run typecheck` and `npm run lint` must pass before starting
other phases.

---

## Phase 1 — The eight items and their icons

### 1.1 Definitions (`src/core/ItemDefs.ts`)

Add the ids to `ItemId` and entries to `ITEM_DEF`. All armor pieces below get
`stackable: false`, `type: 'armor'`, and `canHotlist: false` (Phase 7 formalizes the
hotbar rule). Descriptions are the source-material text, verbatim.

```ts
nightgaunt_cloak: {
  id: 'nightgaunt_cloak',
  name: 'Enchanted Nightgaunt Cloak of Stoutness',
  stackable: false, canHotlist: false,
  type: 'armor', equipSlot: 'Torso', equipSubSlot: 'Back',
  wearer: 'human',
  statBonus: { constitution: 4 },
  resistances: ['poison', 'ice', 'piercing'],
  description:
    'The wearer of this cloak gains +4 to Constitution and becomes resistant to poison and ' +
    'ice-based attacks. In addition, the cloak adds Anti-Piercing resistance to all worn armor. ' +
    'It also makes you look like a dollar store Batman.',
},

slate_butterfly_talisman: {
  id: 'slate_butterfly_talisman',
  name: 'Talisman of the Slate Butterfly',
  stackable: false, canHotlist: false,
  type: 'armor', equipSlot: 'Head', equipSubSlot: 'Neck',
  wearer: 'cat',
  statBonus: { dexterity: 4, intelligence: 1 },
  description:
    'The Talisman of the Slate Butterfly is a small silver butterfly charm on a small silver ' +
    'ring, so it can be attached to collars or other jewelry. It jingles when it moves. Adds +4 ' +
    'to the Dexterity Skill. Adds +1 to Intelligence. Winged fairies will no longer be ' +
    'automatically hostile toward you.',
},

fae_scale_crupper: {
  id: 'fae_scale_crupper',
  name: 'Enchanted Fae Scale Quadruped Crupper of the Fleet',
  stackable: false, canHotlist: false,
  type: 'armor', equipSlot: 'Torso', equipSubSlot: 'Jacket',
  wearer: 'cat',
  statBonus: { dexterity: 2 },
  description:
    'Light and flexible, this scale armor is made from Fae Steel. While not as strong as Elven ' +
    'mail or even good Orcish steel, it\'s the strongest alloy that fairy folk can wear. It\'s ' +
    'not the best protection, but it\'ll make your ass look oh so pretty.',
},

bracelet_of_dex: {
  id: 'bracelet_of_dex',
  name: 'Bracelet of +2 DEX',
  stackable: false, canHotlist: false,
  type: 'armor', equipSlot: 'Hands', equipSubSlot: 'Gloves',
  wearer: 'cat',
  statBonus: { dexterity: 2 },
  description: 'An agility boosting accessory equipped on the front leg.',
},

splatter_skunk_toe_ring: {
  id: 'splatter_skunk_toe_ring',
  name: 'Enchanted Toe Ring of the Splatter Skunk',
  stackable: false, canHotlist: false,
  type: 'armor', equipSlot: 'Feet', equipSubSlot: 'Toe Ring',
  wearer: 'human',
  statBonus: { strength: 3 },
  skillLevelBonus: { pugilism: 3 },
  description:
    'Imbues wearer with +3 Strength and gives +3 to the Pugilism Skill. Also, it\'s a toe ring. ' +
    'It\'s probably uncomfortable and it makes you look like one of those hippie assholes who ' +
    'sit around in a field juggling and hula-hooping all day.',
},

shade_gnoll_kneepads: {
  id: 'shade_gnoll_kneepads',
  name: 'Enchanted Spiked Kneepads of the Shade Gnoll Riot Forces',
  stackable: false, canHotlist: false,
  type: 'armor', equipSlot: 'Legs', equipSubSlot: 'Knee Pads',
  wearer: 'human',
  damageReflectPct: KNEEPADS_DAMAGE_REFLECT_PCT,   // 0.10, named constant
  cancelsMomentum: true,
  description:
    'Adds 10% Damage Reflect to all equipped armor. Cancels all Momentum-based attacks. Made of ' +
    'skin and fur and the spiky things from the back of Thorn Cadavers, these kneepads are both ' +
    'good protection and they\'re stylish. Stylish, that is, if your knees are cosplaying as ' +
    'hedgehogs.',
},

grull_war_gauntlet: {
  id: 'grull_war_gauntlet',
  name: 'Enchanted War Gauntlet of the Exalted Grull',
  stackable: false, canHotlist: false,
  type: 'armor', equipSlot: 'Hands', equipSubSlot: 'Gloves',
  wearer: 'human',
  statBonus: { dexterity: 1 },
  meleeOnlyStatBonus: { strength: 3 },
  skillLevelBonus: { iron_punch: 2, powerful_strike: 1 },
  stunOnHitChance: GAUNTLET_STUN_CHANCE,           // 0.02, named constant
  description:
    'A wrist bracer that transforms into a spiked war gauntlet made of orcish steel when the ' +
    'hand is shaped into a fist. Grants +3 Strength (in fist mode only), +1 Dexterity, +2 skill ' +
    'levels to the Iron Punch skill, +1 skill level to the Powerful Strike skill, and a 2% ' +
    'chance to Stun an enemy on a successful hit.',
},

slingshot: {
  id: 'slingshot',
  name: 'Slingshot & Rocks',
  stackable: false, canHotlist: true,
  type: 'weapon',
  wearer: 'human',
  description:
    'Slingshots are small, handheld, hand-powered projectile weapons typically made with a ' +
    'Y-shaped frame with an elastic strip tied to the ends of each prong. On Earth, slingshots ' +
    'are common toys but have also been used as military weapons by guerilla forces. During the ' +
    'Siege of Marawi in 2017, the Philippine Army\'s elite Scout Rangers used slingshots to hurl ' +
    'grenades at opposing forces.',
},
```

Notes:

- The talisman's fairy clause and the cloak's flavor sentence follow the trollskin-shirt
  precedent: description text that describes the fiction. No fairy mobs exist, so the
  fairy pacification has no consumer today. When fairies are added, the seam is the
  `accept` predicate passed to `Mob.acquireTarget` (plus `noticeTarget` and `forceAggro`
  guards) — record that as a _why_ comment where the talisman is defined, phrased as a
  constraint on future fairy creatures, not as a reference to this plan.
- The crupper uses `Torso:Jacket` (body armor worn over a shirt; the sub-slot exists and
  is unused). The bracelet and gauntlet share `Hands:Gloves` on different characters, so
  they never conflict.
- `KNEEPADS_DAMAGE_REFLECT_PCT`, `GAUNTLET_STUN_CHANCE` are module constants in
  `ItemDefs.ts`.

### 1.2 New skills: Iron Punch and Powerful Strike (`src/core/SkillManager.ts`)

Extend `SkillId` with `'iron_punch' | 'powerful_strike'` and add defs:

- `iron_punch` — name "Iron Punch", `eligibleFor: 'human'`, `maxLevel: SKILL_MAX_LEVEL`.
  Effect: `+10% punch damage per level while a war gauntlet is worn.` Constant
  `IRON_PUNCH_DAMAGE_FRACTION_PER_LEVEL = 0.1`. Flavor: write one line in the house
  style (see `pugilism`'s "Formalised hitting. The paperwork is the fist.").
- `powerful_strike` — name "Powerful Strike", `eligibleFor: 'human'`,
  `maxLevel: SKILL_MAX_LEVEL`. Effect: `+4% chance per level for a melee hit to land
double damage.` Constants `POWERFUL_STRIKE_CHANCE_PER_LEVEL = 0.04`,
  `POWERFUL_STRIKE_DAMAGE_MULTIPLIER = 2`.

Consumers, both in the human melee path:

- `HumanPlayer.getMeleeDamage()`: multiply the final total by
  `1 + IRON_PUNCH_DAMAGE_FRACTION_PER_LEVEL * this.effectiveSkillLevel('iron_punch')`
  **only when a gauntlet is equipped** — gate on
  `this.inventory.hasEquipped('grull_war_gauntlet')` (Iron Punch is defined as a
  gauntlet skill; without the gauntlet the level is inert).
- Powerful Strike: in `CombatSystem.resolvePlayerAttacks` where human melee damage is
  applied, roll `POWERFUL_STRIKE_CHANCE_PER_LEVEL * human.effectiveSkillLevel('powerful_strike')`
  and double the damage on success. (Doing it in CombatSystem rather than
  `getMeleeDamage` keeps `getMeleeDamage` deterministic for the companion-AI DPS math.)

These two skills have no skill books and no training — their levels come entirely from
equipment (`skillLevelBonus`). They will render as locked cards in the Skills tab, which
is correct: the player has not learned them; the gauntlet performs them. Confirm
`SkillsTab` renders locked skills gracefully (it already lists defs).

### 1.3 Icons

Follow the issue-kit pattern: one new file `src/ui/icons/enchantedGearIcons.ts` exporting

```ts
export type EnchantedGearItemId =
  | 'nightgaunt_cloak'
  | 'slate_butterfly_talisman'
  | 'fae_scale_crupper'
  | 'bracelet_of_dex'
  | 'splatter_skunk_toe_ring'
  | 'shade_gnoll_kneepads'
  | 'grull_war_gauntlet'
  | 'slingshot';
export const ENCHANTED_GEAR_IDS: ReadonlySet<string>;
export function isEnchantedGearItem(id: string): id is EnchantedGearItemId;
export function drawEnchantedGearIcon(ctx, x, y, size, id: EnchantedGearItemId): void;
```

with an internal `switch (id)` of procedural canvas drawings (raw `ctx` is fine here —
icons are sprite-like art, and this is the established pattern in
`src/ui/icons/issueKitIcon.ts`). Every coordinate/radius that isn't self-evident gets a
named constant, following the `HP_POTION_CX`-style naming in `InventoryPanel.ts`.

Art direction per icon (32–54 px canvas cell; bold silhouettes, 2–3 value bands, one
accent color each — subtle gradients vanish at this size):

- **Cloak** — dark indigo bat-scalloped cape silhouette with a lighter collar clasp;
  a thin cyan rim light on one edge so it reads against dark slot backgrounds.
- **Talisman** — silver butterfly (two triangle wing pairs) on a small ring, slate-gray
  wings with a white glint dot.
- **Crupper** — overlapping teal-green scale rows shaped as a rounded quadruped rump
  guard with two hanging straps; a pale shine arc across the scales.
- **Bracelet** — simple gold torus at a 3/4 angle (two ellipses), one gem dot.
- **Toe ring** — a foot outline in skin tone with a single chunky ring on the big toe,
  ring in bright brass; tiny green stink-wisp above (the "splatter skunk").
- **Kneepads** — a pair of dome pads with 3 spikes each, dark leather with steel spikes.
- **Gauntlet** — a clenched fist in dark orcish steel with knuckle spikes and rivet dots.
- **Slingshot** — a Y-frame in brown wood, a taut band, and a gray pebble in the pouch;
  two loose pebbles beside the frame.

Dispatch: in `InventoryPanel.renderItemIcon`, add
`if (isEnchantedGearItem(item.id)) { drawEnchantedGearIcon(ctx, x, y, size, item.id); return-style guard as the file does it; }`
next to the `isIssueKitItem` guard.

**Gate:** typecheck + lint. Then a quick visual smoke: `npm run build` and grant the items
via the dev/AI path (`src/ai/aiActions.ts` allow-list is updated in Phase 10 — do that
edit early if needed for the check) or via `src/dev/playtestPresets.ts`.

---

## Phase 2 — Award mechanism: achievements that grant specific items

Today an achievement can only grant a tier/category loot box whose contents come from the
shared `BOX_CONTENTS` table. Add a per-achievement item reward.

### 2.1 `AchievementDef.itemReward` (`src/core/AchievementManager.ts`)

```ts
/** Specific item granted when this achievement's loot box is opened. Delivered to the box owner's inventory. */
itemReward?: { id: ItemId; quantity: number };
```

(`ItemId` import from `ItemDefs.ts` — check for cycles; `AchievementManager` is a core
module with no current `ItemDefs` import, and `ItemDefs` does not import
`AchievementManager`, so a one-way import is safe.)

### 2.2 Delivery (`src/systems/AchievementUISystem.ts` + `src/ui/LootBoxOpener.ts`)

- `LootBoxOpener.startQueue` currently resolves contents internally via
  `getBoxContents(box.tier, box.category)` in `loadCurrent`. Change it to accept a
  resolver: a `getContents: (box: LootBox) => BoxContents` parameter (or field set
  before `startQueue`). `AchievementUISystem` supplies one that takes the base
  `getBoxContents(tier, category)` result and, when
  `ACHIEVEMENT_DEFS[box.fromAchievement].itemReward` exists, returns a copy whose
  `bonus` is that reward (so the reveal renders the item name via the existing bonus
  line rendering — confirm how `LootBoxOpener` renders `bonus` today and make the line
  show `ITEM_DEF[id].name`).
- In `AchievementUISystem.openBoxQueue`'s `onBoxOpened` callback: when the achievement
  has an `itemReward`, grant it with `target.inventory.addItem(...)` — `target` is the
  player whose queue is being opened, which fixes the "bonus always goes to the human"
  quirk _for item rewards only_; leave the legacy bonus path untouched for existing
  boxes.
- Full-bag caveat: `Inventory.addItem` silently drops when the bag is full. For
  achievement rewards, check capacity first and, if full, fall back to
  `LootSystem.addLoot` at the player's feet as boss-style loot (never fades). If that
  is awkward from `AchievementUISystem` (no LootSystem reference), give the system an
  optional `onRewardOverflow` callback the scene wires to its loot drop.

### 2.3 The five new achievements

Extend `AchievementId` and `ACHIEVEMENT_DEFS`:

| id              | name                            | playerType | lootBox             | itemReward                    |
| --------------- | ------------------------------- | ---------- | ------------------- | ----------------------------- |
| `no_pants`      | "Why Aren't You Wearing Pants?" | human      | Bronze / Spicy      | `nightgaunt_cloak` ×1         |
| `first_hundred` | "First Hundred"                 | cat        | Bronze / Adventurer | `slate_butterfly_talisman` ×1 |
| `podophilia`    | "Podophilia"                    | human      | Bronze / Spicy      | `splatter_skunk_toe_ring` ×1  |
| `crowd_control` | "Crowd Control"                 | human      | Silver / Spicy      | `shade_gnoll_kneepads` ×1     |
| `big_brawler`   | "Big Brawler"                   | human      | Silver / Boss       | `grull_war_gauntlet` ×1       |

Descriptions (shown in the award overlay and Achievements tab):

- `no_pants`: "Entered the dungeon without wearing any pants."
- `first_hundred`: "One of the first 100 crawlers to level Magic Missile to level three."
- `podophilia`: "Killed a goblin with Smush."
- `crowd_control`: "Killed 10 enemies in a single attack."
- `big_brawler`: "Killed a roided-out mutant troglodyte and his minions."

### 2.4 Triggers

All follow the canonical pattern (guarded `tryUnlock` + `bus.emit('achievementUnlocked', …)`),
gated on `this.tutorial === null` like the existing dungeon unlocks. All wiring in
`src/scenes/DungeonScene.ts` unless noted.

- **`no_pants`** — at floor entry (after players and tutorial state are established in
  the `DungeonScene` constructor or first-update hook where other one-shot floor checks
  live): if `human.inventory.equipment.getEquippedItem('Legs:Pants') === null`, unlock on
  `humanAchievements`. This fires on any floor entered pantsless, which matches the
  book's joke (`minimum_floor: 1`).
- **`first_hundred`** — inside the existing `this.abilityManager.onLevelUp` closure:
  `if (id === 'magic_missile' && newLevel >= MAGIC_MISSILE_TALISMAN_LEVEL)` (constant 3)
  unlock on `catAchievements`. Also a retroactive check at scene construction for
  resumed saves (`restoreSerializedStates` loads levels silently): the manager needs a
  real-level accessor because `getLevel` is inflated by god mode — add
  `AbilityManager.getRealLevel(id)` returning the un-inflated stored level, and use it
  here.
- **`podophilia`** — in the `bus.on('mobKilled', …)` handler:
  `killer === this.human && mob.killType === 'smush' && mob instanceof Goblin`
  (import the `Goblin` class; the goblin archer is a Goblin variant — verify by reading
  `src/creatures/Goblin.ts` and include any archer subclass in the check via
  `instanceof Goblin` covering it, or an explicit union if the archer is a separate
  class).
- **`crowd_control`** — no multi-kill tracking exists. Count deaths per attack at the
  two AoE resolution sites:
  - the Smush loop in `CombatSystem.resolvePlayerAttacks` (it already iterates
    `mobGrid.queryCircle` calling `mob.takeDamageFrom(damage, human, 'smush')`): before
    each hit record `wasAlive = mob.hp > 0`, after it check `mob.hp <= 0`; count the
    flips within the single peak resolution;
  - the dynamite explosion damage loop in `src/systems/DynamiteSystem.ts`, same
    technique.
    Constant `MULTIKILL_ACHIEVEMENT_THRESHOLD = 10`. When a single loop reaches it,
    unlock on `humanAchievements`. Death resolves synchronously inside `takeDamageFrom`,
    so the hp-flip check is reliable; do not use `justDied` (it is frame-latched, see the
    `isAlive`-through-death-animation invariant).
- **`big_brawler`** — the Juicer has no in-room minions; his "minions" are the three
  gateway troglodytes placed by `extraSpawns` with `origin: 'bossRoom:1'` in
  `src/levels/level1.ts`. Award when _both_ conditions hold, checked at two moments:
  when the Juicer dies (in the `bossDefeated` handler for `bossType === 'juicer'`), and
  when a troglodyte dies while the Juicer is already dead (in the `mobKilled` handler).
  The predicate: no living mob with `spawnTypeKey === 'troglodyte'` within
  `BIG_BRAWLER_GUARD_RADIUS_TILES` (suggest 20) of the Juicer boss room center —
  `DungeonScene.countLivingMobsOfTypeNear` already exists for exactly this shape.
  Track "juicer dead" with the same latch added in Phase 6 (`juicerKilled`).

**Gate:** typecheck + lint. For each trigger, do a negative sanity pass in code review:
the condition must be impossible to satisfy in the tutorial and impossible to satisfy
twice (`tryUnlock` handles the second, but the emit must sit inside the `if`).

---

## Phase 3 — Boss, drop, and shop wiring for the non-achievement items

- **Crupper (Juicer bronze boss box):** in `src/creatures/Juicer.ts`
  `rollLootItems`, push `{ id: 'fae_scale_crupper', quantity: 1 }` alongside the crown.
  It arrives via the existing boss-chest flow. Add `'fae_scale_crupper'` to
  `FORCED_TO_CAT` in `DungeonScene.ts`; add `'slate_butterfly_talisman'` and
  `'bracelet_of_dex'` there too; add the five human items + `'slingshot'` to
  `FORCED_TO_HUMAN`.
- **Slingshot (Krakaren guaranteed):** `src/creatures/KrakarenClone.ts` currently has no
  `rollLootItems` override — add one pushing `{ id: 'slingshot', quantity: 1 }` on top
  of `super.rollLootItems(killer)`.
- **Slingshot (0.5% world drop, floor 2+):** the base table in `Mob.rollLootItems` has
  no floor context. Add an optional `LevelDef` flag (in `src/levels/types.ts`)
  `slingshotDrops?: boolean`, set `true` in `src/levels/level2.ts` and
  `src/levels/level3.ts`. The spawner (`src/levels/spawner.ts`) copies it onto the mob
  (`mob.allowSlingshotDrop = def.slingshotDrops === true`, a new public field on `Mob`
  defaulting `false`). In `Mob.rollLootItems`, alongside the other chance rolls:
  `if (this.allowSlingshotDrop && this.slingshotEligible && Math.random() < SLINGSHOT_DROP_CHANCE)`
  push a slingshot. `SLINGSHOT_DROP_CHANCE = 0.005`. `protected get slingshotEligible()`
  returns `true` on `Mob`; `BrindleGrub` overrides it to `false` (that covers all three
  evolution stages, which are one class).
- **Bracelet (shop):** stock it in the town armoury (`src/systems/townArmoury.ts`) with
  a named price constant sized to sit between the existing light-armor prices there
  (read the neighboring entries and pick the band; suggest ~120–180 coins). The
  armoury is human-facing but purchases route to a chosen player — verify how the
  armoury delivers purchases; if delivery is "active player's bag", that's fine, the
  `wearer: 'cat'` gate protects mis-equipping.

**Gate:** typecheck + lint.

---

## Phase 4 — Slingshot weapon behavior

The slingshot is a hotbar-wielded ranged weapon for the human, modeled on the cat's
magic missile projectile (player-owned array, resolved in `CombatSystem`), with a
wield/unwield toggle per the design: activating its hotbar slot equips it; activating
again unequips it.

### 4.1 Wield state (`src/creatures/HumanPlayer.ts`)

- `wieldedWeaponId: ItemId | null = null` on `HumanPlayer` (not `Player`; the cat never
  wields).
- In `src/systems/kits/hotbarActions.ts`, add a branch in `activateHotbarSlot` before
  the skill-book branch:
  `if (slot.id === 'slingshot' && pm.human.isActive) { toggle wieldedWeaponId between null and 'slingshot'; play a click/equip sound; return; }`
- While wielded, `HumanPlayer.triggerAttack()` fires a rock instead of starting a melee
  swing: guard at the top — if `wieldedWeaponId === 'slingshot'`, call
  `this.triggerSlingshot()` and return. Unequipping restores normal melee. (This gives
  "press Space to shoot", matching how the cat's Space is claw and hotbar-1 is missile —
  but for the human the wield toggle redirects the attack key, which is the RuneScape-
  style weapon feel the design asks for.)
- If the slingshot leaves the hotbar/bag entirely (dropped), clear `wieldedWeaponId` —
  hook where drops are processed in `MenusKit` (it already auto-unequips armor before a
  drop; mirror that for the wield state).
- HUD: in `InventoryPanel.renderSlot`, treat a hotbar slot holding the wielded weapon
  like an equipped item (same blue border + "E" badge path, driven by a new check —
  `renderSlot` receives `isEquipped`; compute it for the slingshot from
  `human.wieldedWeaponId`). The wiring point is `renderHotbar`, which currently passes
  `inventory.hasEquipped(item.id)`.

### 4.2 Projectile (`HumanPlayer` + `CombatSystem`)

Mirror the `Missile` shape (`src/sprites/catSprite.ts`) with a leaner struct in a new
module `src/sprites/slingshotSprite.ts`:

```ts
export interface SlingshotRock {
  x: number; y: number; vx: number; vy: number;
  distTraveled: number; maxDist: number;
  state: 'flying' | 'done';
  hit: boolean;
}
export function drawSlingshotRocks(ctx, rocks, camX, camY, scale): void;
export function drawSlingshotWield(...): void;  // small Y-frame held in front of the human, optional polish
```

Constants (in `slingshotSprite.ts` or a `src/core/slingshot.ts` if shared with combat):
`SLINGSHOT_COOLDOWN_FRAMES = 45`, `SLINGSHOT_RANGE_TILES = 6`,
`SLINGSHOT_SPEED = ...` (match missile speed order of magnitude),
`SLINGSHOT_BASE_DAMAGE = 2`, `SLINGSHOT_STRENGTH_FRACTION = 0.25`
(damage = `SLINGSHOT_BASE_DAMAGE + Math.floor(strength * SLINGSHOT_STRENGTH_FRACTION)`
— deliberately weaker than melee `1 + strength`, per the design note "relatively weak").

- `HumanPlayer.triggerSlingshot()`: cooldown-gated (`slingshotCooldown` frames field),
  spawns a rock along `facingX/facingY` (no homing, no splash), plays a fire sound.
- `HumanPlayer.updateRocks()`: ticked where `CatPlayer.updateMissiles` is ticked (grep
  its call site — mirror placement exactly); wall collision via `map.isWalkable`;
  distance expiry; drop `'done'` rocks.
- Resolution: in `CombatSystem.resolvePlayerAttacks`, loop `human.getRocks()` in the
  same shape as the missile loop — destructibles, trees, then mobs, using
  `mob.takeDamageFrom(damage, human, 'slingshot')`. No AoE. Emit the same impact-style
  event or play an impact sound directly, matching how missiles do it.
- Death cleanup: wherever `CatPlayer`'s airborne attacks are cleared
  (checkpoint restore / scene transitions — grep `clearAirborneAttacks` or
  `missiles = []` sites), clear rocks the same way.
- Sound: follow the `add-sound` skill. If a suitable existing whoosh/impact pair exists
  in the manifest (check `src/audio/sounds.ts` for throw/impact ids), reuse; otherwise
  add `slingshot_fire` mapped to the closest existing asset file rather than a new mp3.
- Companion behavior: when the human is the follower, `CompanionSystem` keeps using
  melee — do not teach the companion the slingshot in this pass (its DPS model reads
  `getMeleeDamage`; a wielded slingshot on the _follower_ should be treated as
  unwielded: simplest is to auto-unwield on switching the human to follower, in the
  character-switch path, with a _why_ comment).

### 4.3 Persistence

`src/core/PlayerSnapshot.ts`: optional field
`wieldedWeaponId?: ItemId | null` following the documented convention for post-hoc
optional fields (`skillTattoo` is the model). `snapPlayer` writes it (human only — it's
on `HumanPlayer`; `snapPlayer` takes `Player`, so either widen with an
`instanceof HumanPlayer` narrow or lift the field to `Player` with a doc comment that
only the human wields). Restore in `restorePlayer` with `?? null`.

**Gate:** typecheck + lint. Behavior check: build, wield, fire at a wall and a mob,
unwield, confirm melee returns.

---

## Phase 5 — Desperado Pass Tattoo

### 5.1 The flag

- `src/Player.ts`: next to `tattooStat` / `skillTattoo`:

```ts
/** Earned by defeating the Juicer; the Desperado Club recognizes it at the door. Permanent, one per crawler. */
hasDesperadoPassTattoo = false;
```

- `src/core/PlayerSnapshot.ts`: optional `desperadoPassTattoo?: boolean` (same
  convention as `skillTattoo`); `snapPlayer` writes it, `restorePlayer` applies
  `snap.desperadoPassTattoo ?? false`.
- Checkpoint semantics: the flag rides the player snapshot, so a death-rewind behaves
  like `krakarenKilled` — if the checkpoint predates the Juicer kill, the boss is also
  rewound and the refight re-awards. No extra checkpoint plumbing.

### 5.2 Award on Juicer defeat (`src/scenes/DungeonScene.ts`)

In the `bossDefeated` handler, next to the existing `krakaren_clone` latch, add a
`juicerKilled` latch (also used by `big_brawler` in Phase 2):

```ts
if (e.bossType === 'juicer' && !this.juicerKilled) {
  this.juicerKilled = true;
  this.human.hasDesperadoPassTattoo = true;
  this.cat.hasDesperadoPassTattoo = true;
  // announce via the system-notice path so it lands even if the chest is never opened
}
```

- Mirror `krakarenKilled` for checkpoint capture/restore of `juicerKilled` in
  `WorldCheckpoint` (`src/core/WorldCheckpoint.ts`), including the boss room index if
  the chest line below needs it.
- Player-facing announcement: use the same surface the Mongo unlock uses. Preferred:
  special-case the Juicer's chest in the `TreasureChestSystem.setOnOpen` callback
  (exact template: the `krakarenBossRoomIdx` branch) to append a display line
  `'Desperado Pass Tattoo (both crawlers)'` to the reward dialog via its
  `displayLabels`/custom-entries support. Additionally show a one-line notice at award
  time ("New tattoo: the Desperado Pass. The Club will know you.") through
  `SystemNoticeSystem`/announce so a player who skips the chest still learns of it.

### 5.3 The club recognizes the tattoo (`src/systems/DesperadoClubSystem.ts`)

`DesperadoClubSystem` is constructed by `BuildingInteriorScene` with the club membership
in hand. Thread the tattoo in: pass a `hasPassTattoo: boolean` (computed by the scene as
`human.hasDesperadoPassTattoo || cat.hasDesperadoPassTattoo`) or the players themselves,
whichever fits the existing constructor shape better.

Constructor logic becomes:

```ts
if (membership.hasDesperadoPass) {
  this.unlockAchievement('desperado_member');
} else if (hasPassTattoo) {
  membership.hasDesperadoPass = true;
  this.openTattooGreeting(); // acknowledges the pass; unlocks 'desperado_member' on dismissal
} else {
  this.openGreeting(); // legacy free-pass fallback (dev boots, sequence breaks)
}
```

New greeting constants next to `GREETING_LINES` (keep Sledge's voice):

```
TATTOO_GREETING_TITLE = '🔪  The Desperado Club  🔪'
TATTOO_GREETING_LINES:
  'A seven-foot slab of tuxedoed granite blocks the doorway — then clocks the ink on your skin.'
  '"That\'s a Desperado Pass. Earned, not bought. Welcome to the Desperado Club."'
  '"Two house rules: no fighting inside — the club is neutral ground, always. And spend well."'
Button label: 'Enter the Club'
```

Dismissal sets nothing further (the pass was set before opening), unlocks
`desperado_member` on both managers via the existing helper, and plays
`achievement_awarded` — mirroring `openGreeting`'s callback minus the pass grant.

Note: `ClubMembership.hasDesperadoPass` is checkpoint-rewound with the purse by design;
the tattoo re-derives it on the next club entry, so no membership persistence changes
are needed. Do not add the pass to `GameProgress` — the tattoo rides `PlayerSnapshot`
for free.

**Gate:** typecheck + lint. Behavior check: dev-boot past the Juicer, enter the club,
confirm the tattoo greeting; fresh boot without the kill, confirm the legacy greeting.

---

## Phase 6 — Hotbar restrictions, cancel overlay, and error feedback

Goal: gear with no hotbar action can never occupy a hotbar slot, and the UI makes the
refusal visible instead of silent.

### 6.1 Make `canHotlist` truthful (`src/core/ItemDefs.ts`)

Set `canHotlist: false` on every item with no activation:
`trollskin_shirt`, `enchanted_crown_sepsis_whore`, `issue_kettle_helm`,
`padded_gambeson`, `riveted_bracers`, `marching_boots`, and all Phase 1 armor.
`enchanted_bigboi_boxers` stays `true` (its hotbar slot triggers Protective Shell).
Tomes, potions, scrolls, dynamite, skill books, gym placeables, quest items, and the
slingshot stay `true`.

**Stale-instance hazard:** bag/hotbar items are spread copies of the def
(`ItemBag.addToEmpty` does `{ ...ITEM_DEF[id], quantity }`), so items already in a save
carry the old `canHotlist: true`. Every guard must consult the _def_, not the instance:
change the checks in `Inventory.swapInvToHotbar` / `swapHotbarToInv` (currently
`!inv.canHotlist` on the instance) to read `ITEM_DEF[item.id].canHotlist`. Add a
helper in `ItemDefs.ts`:

```ts
export function itemCanHotlist(id: ItemId): boolean;
```

and use it at every enforcement point (the two `Inventory` swaps, the drag-drop
resolution, and the Equipment tab in Phase 9).

Armor already sitting in a saved hotbar: leave it — it renders and can be dragged _out_;
it just can't be dragged back in. Don't write a migration.

### 6.2 Cancel overlay during drag (`src/ui/InventoryPanel.ts` + `InventoryInteraction`)

While a drag is active (`InventoryInteraction.drag !== null`) and the dragged item fails
`itemCanHotlist`, `renderHotbar` draws a prohibition mark over every hotbar slot
(including the quest slot): a red circle with a diagonal bar, drawn procedurally
(constants `HOTBAR_DENY_RADIUS_FRACTION`, `HOTBAR_DENY_COLOR = '#ef4444'`,
`HOTBAR_DENY_ALPHA = 0.8`, `HOTBAR_DENY_BAR_WIDTH`). The panel needs read access to the
current drag item — `InventoryPanel` already renders the floating dragged icon, so the
drag state is reachable; follow that existing access path.

### 6.3 Refusal feedback (`src/ui/InventoryInteraction.ts` + host wiring)

In `handleMouseUp`, when the drop target is a hotbar slot and the item fails
`itemCanHotlist`: cancel the drag (item returns home — the swap already refuses, so the
visible change is feedback only), and fire a new optional hook
`onBlockedHotbarDrop: (() => void) | null` — the same shape as
`TutorialInventoryInteraction.onBlockedDragAttempt`. Wire it in both scenes
(`DungeonScene`, `BuildingInteriorScene`) to:

- `this.audio?.play('error')`
- `HotbarToast.show('That can\'t go on the hotbar — equip it from the Equipment screen.')`
  (or the `_companionErrorMsg` red-text pattern if the toast strip is unavailable in a
  context; prefer the toast — it's the established mid-play one-liner surface).

The no-op silent case stays silent for a drop back on the origin slot, matching the
tutorial interaction's documented exception.

**Gate:** typecheck + lint + `npm run verify:menus` (no new surfaces yet, must stay
green).

---

## Phase 7 — Inventory search bar

### 7.1 Canvas search field (`src/ui/SearchField.ts`, new)

A reusable canvas text field, following the `rebindCapture` module pattern (the only
existing modal key-capture precedent):

```ts
export class SearchField {
  text: string;
  readonly maxLength: number; // SEARCH_MAX_LENGTH = 24
  isFocused(): boolean;
  focus(): void;
  blur(): void;
  clear(): void;
  handleCapturedKey(key: string): void; // length-1 chars append; 'Backspace' deletes; 'Escape'/'Enter' blur
  render(ctx, x, y, w, h): void; // drawBox + drawText + blinking caret; placeholder 'Search…' when empty
  hits(mx, my): boolean; // uses the rect from the last render
}
```

Key capture: module-level registry `beginSearchCapture(field)` / `endSearchCapture()` /
`activeSearchField()` consulted in `SceneManager.handleMenuNavigation`
(`src/core/Scene.ts`) **immediately after the `isRebindCaptureActive()` block and with
the same shape**: `e.preventDefault(); e.stopPropagation();` then route the key to the
field. That suppression is what keeps hotbar keys 1–8, WASD, and the focus ring inert
while typing (both `GameplayInputHandler` and the ring live on window listeners behind
this capture-phase handler). Blur must always call `endSearchCapture()` — including on
panel close, scene exit, and overlay open (`MenusKit.cancelInventoryDragForOverlay` is
the precedent for "an overlay stole the screen mid-interaction"; add the search blur
there).

Render with `drawBox`/`drawText` per the add-ui rules; caret is a 1px vertical line
toggling on a frame counter (`SEARCH_CARET_BLINK_FRAMES = 30`).

### 7.2 Wiring into the bag panel (`src/ui/InventoryPanel.ts`)

- Add a `SearchField` to the panel header (right of the title, left of the [X]); clicking
  it focuses (`handleClick` addition before the "absorb clicks inside panel" fallback).
- Filter semantics: **dim, don't hide** — hiding would re-index slots and break every
  `invSlotRect`-based hit test. With a non-empty query, `renderSlot` draws non-matching
  items at `SEARCH_MISS_ALPHA = 0.25` (the existing `dimmed`/alpha plumbing in
  `renderSlot` supports this); matching items render normally. Matching =
  case-insensitive substring of `item.name` (also match `item.id` so `dex` finds the
  bracelet).
- Interaction guard: `handleMouseDown` refuses to start a drag from a dimmed
  (non-matching) slot while a query is active — a filtered-out item is visually "not
  there".
- Clear the query when the panel closes (`toggle`/`close` paths).
- Page navigation stays as-is (search dims across all pages; the player can still page).

**Gate:** typecheck + lint + verify:menus. Behavior check: open bag, type, confirm
hotkeys are dead while typing and alive after Escape.

---

## Phase 8 — Equipment tab (RuneScape-style)

An interactive equipment screen as a pause-menu tab under the **Game** sub-menu, with
clickable slots, drag-and-drop between bag and slots, click-to-filter, and per-crawler
paper dolls. This intentionally overrides the add-ui skill's "acts on the game → MainTab"
placement heuristic — the product decision is a Game-tab entry.

### 8.1 Shared slot layout extraction

`GearPanel.buildSlotInfos` / `slotKeyAt` duplicate layout math. Extract into
`src/ui/equipmentLayout.ts`:

```ts
export interface EquipSlotInfo {
  key: string;
  slot: EquipSlot;
  subSlot: string;
  x: number;
  y: number;
}
export function buildEquipSlotInfos(panelX, startY, panelW, slotSize, slotGap): EquipSlotInfo[];
export function equipSlotKeyAt(mx, my, infos, slotSize): string | null;
```

Refactor `GearPanel` to consume it (behavior-preserving; `GearPanel` keeps its G-key
role unchanged).

### 8.2 Tab scaffolding

- `src/ui/pause/types.ts`: add `'equipment'` to `PauseTab`.
- `src/ui/pause/GameTab.ts`: add an **Equipment** button (above Stats) switching to
  `'equipment'`; update `gameTabHeight`.
- `src/ui/pause/EquipmentTab.ts` (new): exports `renderEquipmentTab(...)` and a
  stateful controller class `EquipmentTabController` owned by `PauseMenu` (the tab has
  drag state, a selected-slot filter, a player toggle, and a `SearchField`, so a bare
  render function isn't enough — mirror how scrolling tabs keep state on `PauseMenu`,
  but bundle it in one controller object to keep `PauseMenu` lean).
- `PauseMenu.render`: `case 'equipment'` + box-height entry (this tab wants the tall
  box; follow `INVENTORY_TAB_BOX_H`'s pattern with its own constant, sized to fit the
  doll + grid; it may need the full 530+ and a wider layout — reuse whatever width the
  pause box maths allow).
- Back button returns to `'game'`.
- Focus ring: free — the tab renders inside `beginMenuFocus(\`pause-${this.tab}\`)`/`endMenuFocus()`. Register every interactive element via `addButton` so keyboard
  navigation works (see 8.5).
- `PauseMenu.setTab` resets the controller (drag cancelled, filter cleared, search
  blurred).

### 8.3 Layout

Two columns inside the pause box:

- **Left — paper doll** for the selected crawler: header row of two toggle buttons
  (`human.displayName` / cat name — read the names the pause menu already uses),
  then the five `EquipSlot` groups via `buildEquipSlotInfos`, each sub-slot a
  `EQUIPMENT_SLOT_SIZE = 46` cell (match `GearPanel`) labeled with its sub-slot name
  in `TEXT_PRESETS.label`. Below the doll, a compact totals line from
  `getStatBonuses()` plus resistance/reflect summaries via `describeItemEffects`
  aggregation (cap the lines — a HUD panel cannot show everything; overflow is visible
  in tooltips).
- **Right — bag grid** for the same crawler: the standard 4×4 page (reuse the slot
  metrics from `InventoryPanel` via exported constants or local equivalents), page nav,
  and a `SearchField` above it (Phase 7's class, second instance).

### 8.4 Interactions

All mouse routing is new plumbing: `PauseMenu` gains `handleMouseDown/Move/Up(mx, my)`
that delegate to the controller only when `tab === 'equipment'`; both scenes' handlers
(`DungeonScene.handleMouseDown` etc., mirrored in `BuildingInteriorScene`) currently
early-return when the pause menu is open — change that early-return to delegate:
`if (this.menus.pauseMenu.isOpen) { this.menus.pauseMenu.handleMouseDown(mx, my); return; }`.
Touch: route the scenes' existing touch→drag translation the same way (touchstart→down,
touchmove→move, touchend→up) when the pause menu is open on the equipment tab; the
pause-scroll touch path must skip the equipment tab to avoid fighting the drag.

Controller behaviors:

- **Drag bag → slot:** on drop over a sub-slot cell, validate with
  `item.type === 'armor'`, `item.equipSlot === slotName`,
  `itemFitsSubSlot(item, subSlot)`, and wearer eligibility; call
  `inventory.equipment`-backed equip via `Inventory` (extend `Inventory.equip` to
  accept the target key — thread `targetKey` through to
  `EquipmentManager.equip(item, targetKey)`), then `player.onEquipmentChanged()`.
  A displaced item stays in the bag (equipment is by-id; nothing moves physically).
  Invalid drop: error sound + drag cancels home (Phase 6 feedback pattern).
- **Drag slot → bag / anywhere off-doll:** unequip (`inventory.unequip(key)` +
  `onEquipmentChanged`).
- **Click a slot (no drag):** enter **filter mode** for that sub-slot. Bag items that
  cannot go there render dimmed (`SEARCH_MISS_ALPHA` reuse) and are unclickable;
  eligible items render highlighted; clicking an eligible item equips it into the
  clicked slot. Clicking the slot again, clicking empty space, pressing Escape, or
  switching tabs exits filter mode. A filled slot's click-with-no-drag unequips
  (matching `GearPanel`) **only when not entering filter mode** — resolve the
  ambiguity by: filled slot click = unequip; empty slot click = filter mode. (This
  matches RuneScape muscle memory: click worn item to remove, click empty slot to see
  what fits.)
- **Hotbar note:** the gameplay hotbar is not rendered inside the pause menu; the
  Phase 6 cancel-overlay behavior lives in the in-game `InventoryPanel`, not here.
- **Tooltips:** hover over any slot or bag item shows the `describeItemEffects` tooltip
  (reuse the extracted logic from `GearPanel.renderTooltip`).
- **Search:** second `SearchField` instance filtering the bag grid, same dim semantics
  as Phase 7; its capture must end on tab switch and pause close.

### 8.5 Keyboard accessibility

Register the player toggles, each sub-slot cell, page nav, and Back through
`addButton` with `action`/`positionedAction` so the pause ring reaches them. In filter
mode, eligible bag cells are also `addButton`-registered (dimmed ones use
`disabled: true`, which keeps them out of the ring — the documented flag for exactly
this). Drag remains mouse/touch-only; every drag outcome must also be reachable by the
click flows above, so keyboard users lose nothing.

### 8.6 Compliance

- `npm run verify:menus` rule 3 will see `EquipmentTab.ts` draw buttons; it renders
  inside `PauseMenu`'s ring, so ensure the file itself doesn't trip the
  "full-screen panel with buttons but no ring" heuristic — it only fires on files
  containing `drawOverlay(`/`drawModal(`; the tab draws neither (the pause menu owns
  the modal), so it stays green. If the implementation does add a modal call, add the
  `beginMenuFocus`/`endMenuFocus` pair the rule demands.
- `auditOverlayFocus` runs off the existing `pause` claim — no new claim needed since
  the tab lives inside the pause menu.

**Gate:** typecheck + lint + verify:menus. Behavior check: equip/unequip each new item
on the right crawler via drag and via filter-click; confirm the cat cannot receive
human-only pieces and vice versa; confirm stat totals move.

---

## Phase 9 — Incidental registries and polish

- `src/ai/aiActions.ts`: add all eight new ids to `VALID_ITEM_IDS`.
- `src/dev/playtestPresets.ts`: add a preset (or extend the gear-focused one) seeding
  all eight items — human items on the human, cat items on the cat, slingshot in the
  human hotbar — so the whole feature is playtestable in one boot.
- `src/ui/pause/InventoryTab.ts`: generic (lists by `equipSubSlot ?? equipSlot`); no
  change expected — confirm the new sub-slot families render sensibly (`Ring` vs
  `Ring 2` labels).
- `GearPanel` tooltip: now uses `describeItemEffects`, so the new fields show there
  too.
- `src/ui/DeathExplanations.ts` and difficulty docs: no changes — none of the new
  items alter fairness rules (`docs/difficulty-fairness-rules.md` governs enemy-side
  changes; these are player buffs).
- Audio: confirm every new click path plays a sound per the Button rules
  (`addButton`/`drawButton` + `notifyButtonClick` cover the tab; the drag refusal and
  wield toggle have explicit sounds from their phases).

---

## Phase 10 — Validation

Run after each phase and finally over the whole tree:

1. `npm run typecheck` — exit 0.
2. `npm run lint` — exit 0.
3. `npm run format`.
4. `npm run verify:menus` — the Equipment tab and search capture must not regress the
   focus-ring rules.
5. Build and boot (`dev-workflow` skill) with the playtest preset from Phase 9; walk:
   - pantsless floor entry → achievement → box in safe room → cloak lands in the
     human's bag;
   - magic missile to level 3 (preset/god-mode paths must NOT trigger it — verify
     `getRealLevel` gating, then earn a level legitimately);
   - smush a goblin → toe ring; smush/dynamite a 10-pack (spawn via dev tools) →
     kneepads;
   - kill the Juicer + gateway troglodytes → gauntlet achievement, crupper in the
     chest, tattoo notice, chest dialog line;
   - enter the Desperado Club → tattoo greeting;
   - kill the Krakaren → slingshot in her chest; wield, fire, unwield;
   - drag the trollskin shirt toward the hotbar → 🚫 overlay + error + toast;
   - search the bag; equip everything through the Equipment tab both by drag and by
     filter-click, on both crawlers.
6. Negative checks (a fix round needs its own negative test): temporarily break one
   condition per achievement trigger (e.g. flip the pants check) and confirm the
   achievement does _not_ fire in the tutorial and does not double-fire; revert.

Remember the service-worker gotcha: unregister `sw.js`'s worker before trusting any
browser-based check, or the stale bundle will lie.
