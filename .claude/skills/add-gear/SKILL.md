---
name: add-gear
description: Add or change how a weapon, tool, prop, hat or garment looks on Carl or Donut in Kitten Crawler Man — grip archetypes and motion sets, defineHeldVisual / defineGarment, weapon stat blocks and onStrike procs, envelopes, layers and hide rules, the required item `look`, gates:equipment and the per-item render and review loop. Use whenever an item is held, carried, swung or worn by a crawler. For the item's non-visual data (loot, shop, hotbar) also read add-item; for new rows, a new archetype or a new motion set go to bipedal-figure.
---

# Add Gear

What a crawler holds or wears is data, checked when its module loads and
measured by one gate suite. A new item of an existing archetype, or a new
garment on an existing body part, needs no new row, no overlay, no `drawSelf`
branch and no combat branch. If the work seems to need one of those, it is
figure work: read the last section first.

## The archetypes and what each provides

`src/sprites/held/gripArchetypes.ts` is the closed list (`GRIP_ARCHETYPES`).
An item's held visual names exactly one archetype. The archetype decides:

- which sockets hold it (`heldIn`; two sockets means the axis runs from the
  butt hand through the upper hand);
- which handle radius classes it accepts (`thin` / `standard` / `thick`,
  `HANDLE_HALF_WIDTH`, which sets how far the fingers curl);
- the weights it comes in;
- the ranges for handle length, head length, head width and grip point;
- where each weight rests while stowed (`hip`, `back` or `none`);
- whether it is carried level (`heldLevel`: reflected, never rotated).

All lengths are rig units, the units Carl is drawn in (2.03 sole to crown).

| Archetype     | Wearer | Held in                | What plays it                                                                                                                                              |
| ------------- | ------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `oneHandHaft` | Carl   | main hand              | light → `oneHandLight` set (slash, backhand, chop, thrust; drawn from the hip); heavy → `oneHandHeavy` set (shouldered, smash, swing; drawn from the back) |
| `twoHandHaft` | Carl   | off hand (butt) + main | `twoHand` set (sweep, across the body, from the back); the tools' chop and mine rows                                                                       |
| `thrown`      | Carl   | main hand              | the dynamite light / hold / throw rows                                                                                                                     |
| `slingshot`   | Carl   | main hand              | its own shot rows; otherwise carried in a bare-handed figure's fist, rests at the hip                                                                      |
| `carriedFlat` | Carl   | both hands, level      | the place / build / repair rows (board, crate)                                                                                                             |
| `smallHeld`   | Carl   | main hand              | the drink and zippo rows                                                                                                                                   |
| `mouthCarry`  | Donut  | `mouth`                | `carry_walk`, `carry_idle` in every view                                                                                                                   |
| `pawTool`     | Donut  | `forePaw`              | her `chop` and `mine` rows                                                                                                                                 |

Only the first two are motion sets: `src/sprites/art/human/motionSets.ts`
maps a weapon look to its set by archetype × weight (`motionSetOf`), and every
item of a set plays the same rows (`human/armedRows.ts`). The others are the
scripted rows that always hold their own prop. Weapon items may only name
`WEAPON_GRIP_ARCHETYPES` (`oneHandHaft`, `twoHandHaft`, `slingshot`); the
type system refuses anything else.

Donut reuses Carl's looks: `catGripOf(look)` (`src/sprites/art/catSockets.ts`)
turns any `twoHandHaft` tool into her `pawTool` swing and draws it at 0.7× his
size, so the tool tiers need no second definition. Her `Mouth:Held` slot
draws a `mouthCarry` look, but no item can carry one yet: a weapon's held
visual must be a weapon archetype, and `verify:held-visuals` refuses a weapon
whose look does not belong to every crawler its `wearer` allows. A first mouth
item therefore widens those types; `?donut`'s carry control shows the rows
with `carried_wrench` meanwhile.

## A held thing: `defineHeldVisual`

`src/sprites/held/heldVisualDef.ts`. A look is painted in **item-local
space**: origin at the grip point, +X along the haft toward the head, +Y the
side the head's leading edge faces, rig units. The shared painter
(`heldPaint.ts`) places it at the socket, foreshortens it, draws the shared
handle (or the item's own `paintHandle`), then calls `paintHead`. Painters
never see the body. `HeldLook` tells the painter its `facing` (`flat` or
`edge`, from the palm normal), `phase`, `shaded` (in a hand behind the body),
the key light in item-local space, `frameRotation` and `mirrored`.

`defineHeldVisual` throws `HeldVisualRangeError` at module load, naming the
item and every range it broke. Do not widen an archetype's ranges to fit an
item: the ranges are what keep a swing inside the cell and off the face.

The plain arming sword (`src/sprites/held/art/provingWeapons.ts`):

```ts
export const PLAIN_ARMING_SWORD = defineHeldVisual({
  id: 'plain_arming_sword',
  name: 'Plain arming sword',
  archetype: 'oneHandHaft',
  weight: 'light',
  handle: { length: SWORD_HANDLE_LENGTH, radius: 'thin' },
  head: { length: SWORD_BLADE_LENGTH + SWORD_GUARD_HALF_THICK, width: SWORD_GUARD_HALF_SPAN * 2 },
  gripPoint: SWORD_GRIP_POINT,
  phases: 1,
  handleLook: { colour: LEATHER_GRIP, butt: 'knob' },
  paintHead: (ctx, look, handle) => {
    if (look.facing === 'flat') {
      paintSwordBlade(ctx, look, handle.headBase);
      return;
    }
    seenOnEdge(ctx, () => paintSwordBlade(ctx, look, handle.headBase));
    paintBladeEdgeGlint(ctx, handle.headBase, handle.headBase + SWORD_BLADE_LENGTH, STEEL_EDGE);
  },
});
```

Exactly one of `handleLook` (the shared handle) or `paintHandle` (one of the
item's own) — the type enforces it. Shade with `heldShade(colour, look)` and
fill with `outlineAndFill` so the item takes the body's outline and far-limb
shade. Edge-on, squeeze the head with `seenOnEdge` and add a glint
(`held/art/bladeEdge.ts`). An animated look (a crackle, a flame) sets
`phases` and reads `look.phase`.

Registering it:

1. Its id in `src/sprites/held/heldVisualIds.ts` — `WEAPON_HELD_VISUAL_IDS`
   for a weapon, `TOOL_HELD_VISUAL_IDS` for a tool tier,
   `SCRIPTED_PROP_VISUAL_IDS` for a row's prop, `MOUTH_CARRY_VISUAL_IDS` for
   something in Donut's jaws. That file imports no art, so item data can name
   the id.
2. The def in `HELD_VISUALS` (`src/sprites/held/heldVisuals.ts`); the record
   is complete by type, and a weapon id must map to a `WeaponHeldVisualDef`.
3. The item names it: a weapon's `weapon.heldVisual`, a working tool's
   `heldVisual` (tools resolve through their tier's item,
   `workingToolHeldVisual`). A new tool tier also needs its `TOOL_TIERS` entry
   (`src/core/toolTiers.ts`) and its row in `TOOL_HELD` (`held/art/toolHeld.ts`).
   A new scripted prop is a painter in `carl/props/` registered in `PROP_ART`
   (see the header of `src/sprites/art/carl/props.ts`) plus its entry in
   `held/art/scriptedPropHeld.ts`, and a row that holds it — figure work.
4. The icon: `heldVisual('<id>')` in `ITEM_ICONS` (`src/ui/icons/itemIcons.ts`)
   draws it from the look, fitted to its measured ink.

Pictures are cached per id × 32 axis-angle steps × 4 foreshortening steps ×
facing × mirroring × shade × phase (`heldVisualCache.ts`, 4 MB LRU); the
residual rotation is applied at blit, so nothing snaps. `paintHeldVisual` is
the bake-time path, `drawHeldVisual` the runtime one; both go through
`compositeHeldItem` (`held/heldComposite.ts`).

## A weapon: item, stat block, procs

The item (`src/core/ItemDefs.ts`, see `add-item` for the rest of an item):

```ts
dev_plain_sword: {
  id: 'dev_plain_sword',
  category: 'weapon',
  type: 'weapon',
  equipSlot: 'Hand',
  equipSubSlot: 'Main',
  wearer: 'human',
  weapon: {
    delivery: 'melee',
    strike: 'blade',
    damageMultiplier: PROVING_WEAPON_DAMAGE_MULTIPLIER,
    reachTiles: HUMAN_ARM_REACH_TILES,
    heldVisual: 'plain_arming_sword',
  },
  // name, stackable: false, canHotlist: true, baseValue, unsellable, description
},
```

- **Stat block** (`src/core/weapons.ts`): `MeleeWeaponStats` (`strike:
'blade' | 'blunt'` picks the hit sound; `damageMultiplier` times the blow
  his bare arm would land; `reachTiles`, read by `HumanPlayer.getMeleeRange`)
  or `SlingWeaponStats` (the attack key looses a stone). Every melee weapon
  swings through one function, `strikeWithWeapon` in `CombatSystem.ts`.
  Never tune existing numbers; the user balances by playtest.
- **Procs.** A special effect is an `onStrike` name: add it to
  `WeaponProcId` in `weapons.ts`, implement `WeaponProc` (`onStrike(ctx,
swing)`, run after the edge has landed, with what was struck, cut and
  earned) and register it in `CombatKit`'s `weaponProcs` (a complete
  record). The Fury of Taranis's lightning is `taranisStorm`,
  `TaranisStrikeSystem`. A weapon with a proc is sounded by its proc;
  otherwise `strikeWithWeapon` emits `weaponSwing`.
- **Sounds** are all `src/audio/gearSoundCues.ts`, read off what the weapon
  already declares: the swing by `heldWeightOf` (light, heavy one-hander, or
  anything `twoHandHaft`), the hit by `strike`, the draw and stow by
  `holsterKindOf` (a blade at the hip leaves a scabbard; anything on the back
  or blunt comes off a strap; a sling comes out of a pocket). A
  new weapon of an existing kind needs no audio work. Taking gear off plays
  the same equip sound as putting it on.
- **Draw and stow** need nothing: a hotbar press of any item with
  `weaponStatsOf(id) !== null` calls `toggleWeaponDrawn`, which equips it in
  `Hand:Main` and plays the set's draw or stow rows; `activateHotbarSlot`
  (`src/systems/kits/hotbarActions.ts`) then emits `weaponHolstered`, which
  sounds it. A draw or stow made any other way calls `drawWeapon` /
  `stowWeapon` directly and is silent: `PlayerManager` putting the sling away
  when Donut becomes the active crawler, and the `?human` preview scene.
  Stowed, it is drawn at its archetype's place (`stowedPlacementOfHeld`).
- `?human` lists every human-wearable weapon in its weapon picker, read off
  `ITEM_DEF`; no edit there.

## A garment: `defineGarment`

`src/sprites/garments/garmentDef.ts`. A garment paints on the wearer's own
part frames, never in screen or cell coordinates: Carl's in
`src/sprites/art/carl/carlParts.ts` (`head`, `torso`, `neck`, `hips`,
`forearm`, `back`, `foot`, `leg`), Donut's in `src/sprites/art/catParts.ts`
(`head`, `neck`, `body`, `foreleg`, `hindleg`, `tail`). The anatomy hands
each piece to the dressing as it paints it, so later pieces of the body cover
the garment and it shares the figure's light. A garment never draws its own
silhouette outline.

The kettle helm, on each crawler:

```ts
// src/sprites/garments/human/carlKettleHelm.ts
export const CARL_KETTLE_HELM = defineGarment({
  id: 'carl_kettle_helm',
  name: 'Issue Kettle Helm',
  wearer: 'human',
  material: 'metal',
  layer: 'outer',
  region: ['head'],
  hides: [{ kind: 'feature', feature: 'hair' }],
  paint: { head: carlEveryView(paintHead) },
});

// src/sprites/garments/cat/catKettleHelm.ts
export const CAT_KETTLE_HELM = defineGarment({
  id: 'cat_kettle_helm',
  name: 'Issue Kettle Helm',
  wearer: 'cat',
  material: 'metal',
  layer: 'outer',
  region: ['head'],
  hides: [{ kind: 'feature', feature: 'ears' }],
  paint: {
    head: withViewFallback(
      { front: paintFront, side: paintSide, back: paintBack },
      CAT_VIEW_FALLBACK,
    ),
  },
});
```

Carl's `paintHead(ctx, frame: CarlHeadFrame)` branches on `frame.view`
(profile, or head-on with the face shown or not) and paints in head units
(`HEAD_RX`, `HEAD_RY`, `HEAD_DEPTH` from `carl/proportions.ts`). Donut's
painters each paint one view in her head frame.

Registering it: the id in `HUMAN_GARMENT_IDS` / `CAT_GARMENT_IDS`
(`garments/garmentIds.ts`, no art imports), the def in `HUMAN_GARMENTS` /
`CAT_GARMENTS` (`garments/garments.ts`, complete by type), and the item's
`look`.

### The rules

- **Every view.** `paint` needs a painter per part in `region` for every
  `FacingView`; a missing one does not compile, and `defineGarment` throws
  `GarmentDefinitionError` naming the garment for an empty or repeated region,
  a painter outside the region, a missing view, or a garment hiding itself.
- **Diagonals draw a cardinal neighbour.** Neither crawler has rows of her or
  his own for the three-quarter views: `CARL_VIEW_FALLBACK`
  (`src/sprites/carlViews.ts`: front diagonal → side, back diagonal → back)
  and `CAT_VIEW_FALLBACK` (`src/sprites/catViews.ts`: both → profile, east or
  west twin). Anything keyed by `FacingView` fills its diagonals through the
  same table, never by hand: `withViewFallback(cardinal, fallback)`, or for
  Carl `carlViews({front, side, back})` / `carlEveryView(painter)`
  (`garments/human/views.ts`). Then a view that gains rows changes in one
  place. Why there are no three-quarter rows: `bipedal-figure`
  `references/carl.md` (Carl) and `add-sprite` (Donut).
- **Envelope.** Ink stays inside the part's envelope: the silhouettes the
  part's pieces publish, grown by `margin` and swept by `rise` / `drop` in each
  piece's frame (`GARMENT_ENVELOPES` in `garments/envelopes.ts`, a named
  allowance per wearer and part — a hat may rise above the skull, a cloak drop
  to the calves). Ink that stands off the body on Carl (the cloak's stream)
  states a `reach` so his cell is sized for it. Change an allowance only with
  a reason written on its constant.
- **Layer.** Stacking is `layer` — `skin < under < over < outer < back`
  (`GARMENT_LAYERS`), then id — never paint order inside a painter. Two
  garments in one sub-slot cannot be worn together (`EQUIP_SUBSLOTS`).
- **Hiding is declared.** `hides` names a feature the anatomy leaves
  unpainted (`CarlHideableFeature` `'hair'`, `CatHideableFeature` `'ears'`)
  or another garment left off the figure (the boots hide the toe ring and the
  pedicure). Never paint a skin- or fur-coloured patch over something.
- **Base garments** (`base: true`, no material, may hide nothing) are in every
  outfit: Carl's `carl_jacket` and `carl_boxers`, Donut's `cat_coat`.
- **Material** (`cloth | leather | metal | jewelry`) picks the equip sound
  (`equipCue` in `src/audio/gearSoundCues.ts`, read through
  `garmentMaterialOf` in `garments/itemLooks.ts`). An item that shows as no
  garment on the crawler putting it on is heard as its garment on the other
  crawler; one that shows on neither declares `heardAs` on its `NoLook`
  (`RING_LOOK` is jewelry), or it goes on silently. A base-garment look
  (the boxers) is heard as cloth.

### The item's `look`

Every armour item declares `look` and `wearer` (`'human' | 'cat' | 'both'`);
the compiler refuses an armour item without them. `look` is
`{ kind: 'garment', garment }` for a crawler-specific item, `{ human, cat }`
for a `'both'` item (a look for each). Where nothing can show, the look is
`{ kind: 'none', reason }`, and the reason says why — what makes it unreadable
at the tile, or what paints that crawler instead: `RING_LOOK` (a ring is under
a pixel at 32 px) and `UNDRAWN_ON_DONUT` in `ItemDefs.ts`. An invisible item
is a decision, never an omission. A weapon carries no `look`; its look is
`weapon.heldVisual`.

`wearer` also decides who can equip it (`EquipmentManager.canEquip`, with
`EQUIP_SLOT_WEARER` per section), who `!give` hands it to, and who a reward
split hands it to; `lootRecipient` overrides the split for a signature drop
either crawler could wear (the Sepsis Whore crown goes to Donut).

Outfits are baked, not drawn per frame: `setOutfit(wearer, garments)`
(`src/sprites/outfits.ts`) swaps the outfit figure (id from the sorted visible
garment ids) and releases the old one; the players call it from
`onEquipmentChanged`.

## Gate it, render it, look at it

- `npm run gates:equipment -- --item=<id>` runs only that item: a held
  visual id for something held (`plain_arming_sword`, `basic_axe`), an item or
  garment id for something worn. E1 grip registration, E2 inside the cell and
  out of the floor, E3 not across the face, E4 the fingers wrap the handle,
  E5 garment envelope, E6 a row prop's bake matches its runtime composite,
  E7 mirroring keeps the hand; Donut's held gates run in the same command.
  Each check is listed in `bipedal-figure` `references/gates.md`. With no
  `--item` it runs everything (Carl's garment envelope pass alone takes about
  half a minute).
- `npm run verify:held-visuals` — registry, ranges, tool items, weapon
  wearers. `npm run verify:item-icons` — the icon.
- One held item's contact sheet across its archetype's rows, every view and
  the west-facing profile, large, at the 32 px tile and blown up:
  `npx tsx scripts/render-equipment.ts --item=<held visual id>` (runs the
  gates first; `--part=hands` paints the grip roll at 6×; `--out=`).
- The look alone, beside the art it reproduces, through an 8-angle sweep,
  foreshortened, edge-on, mirrored and shaded, then at the tile through the
  cache: `npx tsx scripts/render-held-visuals.ts --item=<held visual id>`.
- A garment across walking, standing, striking, casting and lying rows in
  every view, at the tile then large: `npx tsx scripts/render-garments.ts
--wear=<garment ids, comma-separated> [--compare] [--rows=row:frame,…]`.
  Carl in a full outfit with his art gates: `npx tsx scripts/render-human.ts
--gear=<id>+<id>`; Donut: `npx tsx scripts/render-cat.ts --wear=<ids>`.
- Live: `?human` (weapon picker, draw/stow, the set's rows) and `?donut`
  (outfit picker listing every cat-wearable item with the garment it is drawn
  as, tool and carry pickers, a compass of all eight headings).

**The review loop.** Look at the PNGs yourself first. Then hand the 32 px
strip (blown up nearest-neighbour, unlabelled) to fresh blind reviewers and
ask them to name the item, the body part and the view — the procedure is
`bipedal-figure` `references/review.md`. Fix only complaints you reproduce;
an item passes when two fresh reviewers in a row name it with no major.
Judge at the tile, not at the large render.

## Size ceilings already found

Some things cannot read at a 32 px tile however they are painted; each is
written up with the fixes tried. Read them before spending a review round on
the same thing:

- **Tiny garments** — Carl's crown, bracers and kneepad spikes, the helm's
  chin strap: `bipedal-figure` `references/carl.md`, his garments' review
  section. Donut's talisman (reads as a bow), bracelet (3×2 px), crupper
  scales and the helm's ear pockets: `add-sprite`, "Donut's garments".
- **Head-on and from-behind blows**: a weapon across his front reads as a
  belt, one behind his back vanishes, a two-hander head-on turns round folded
  arms — `references/carl.md`, the motion-sets ceiling.
- **The grip at 6×** reads as a cartoon fist from the knuckle side, "a fist
  stuck on a stick" from the palm side — `references/carl.md`, sockets and
  grip. At the tile the hand is three pixels.
- **Something across Donut's jaws head-on** reads as a muzzle or gag —
  `add-sprite`, "What Donut holds".

## When it is figure work instead

Go to `bipedal-figure` (and `references/carl.md`) when the item needs:

- **a new archetype** — a new way of holding things means new rows, socket
  occupancy and hand orientation authored per frame (`turnHand`), new ranges,
  and the gates' row lists;
- **a new motion set or weight** — a spear's thrust family, a dual wield: rows
  in `armedRows.ts`, animator lookups, per-set residency, and Carl's
  `HUMAN_FIGURE_BUDGET_MEGABYTES` re-measured with G9b;
- **a new body part** for garments (a garment painted where the anatomy
  publishes no frame), or a hideable feature;
- **diagonal rows of its own** — both attempts at three-quarter views failed
  review; read the ceilings before trying a third.

Finish with the `dev-workflow` gates: `npm run check` while iterating,
`npm run check:full` to sign off.
