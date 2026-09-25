/**
 * Headless gate for the two foods and the ground pickups they lie about as.
 *
 * - Hamburger: heals exactly its fraction; +STR while fed and back to base on
 *   expiry; a second burger refreshes the timer without stacking; refused only
 *   at full HP while already fed.
 * - Hollow Stew: heals exactly what a potion heals; shares the potion's
 *   cooldown both ways, with the same value; a refusal on cooldown raises
 *   `stewRefusedOnCooldown`; a companion with no potions auto-heals on stew.
 * - The three routes to eating — the bag's Eat entry, a hotbar key, and the
 *   context menu that a mobile long-press opens — all reach the same meal.
 * - Ground pickups: a scatter lands on walkable tiles, even when dropped
 *   against a wall; one press in prompt reach collects all of them; a full bag
 *   collects nothing and leaves them down; the lifetime removes them; a
 *   checkpoint round trip keeps them, directly and through `DestructionKit`.
 * - Prompt gating: a hostile in attack range withholds the prompt and the
 *   press (the one helper both the prompt and `triggerSpaceAction` consult);
 *   an ally does not. A chest ahead of the pickups in the Space chain is
 *   predicted by its `wouldInteract` exactly as its `tryInteract` behaves.
 *
 * Not covered, so a green run is not read as more: the scenes themselves
 * (DOM, canvas, frame loop), the sounds, and the art (see `gates:burger-art`).
 *
 * Run: npm run verify:food
 */

import { TILE_SIZE } from '../src/core/constants';
import { AbilityManager } from '../src/core/AbilityManager';
import { EventBus } from '../src/core/EventBus';
import { ITEM_DEF, type ItemId } from '../src/core/ItemDefs';
import { PlayerManager } from '../src/core/PlayerManager';
import { HAMBURGER_HEAL_FRACTION, HAMBURGER_STR_BONUS } from '../src/core/foodEffects';
import { HAMBURGER_FED_STATUS, HAMBURGER_FED_TICKS } from '../src/core/StatusEffect';
import { Mob } from '../src/creatures/Mob';
import { GameMap } from '../src/map/GameMap';
import { FloorTypeValue, type TileContent } from '../src/map/tileTypes';
import { POTION_HEAL_FRACTION, type Player } from '../src/Player';
import {
  GROUND_PICKUP_SETTLE_FRAMES,
  GROUND_PICKUP_TTL_FRAMES,
  GroundPickupSystem,
} from '../src/systems/GroundPickupSystem';
import { shouldShowInteractionPrompts } from '../src/systems/interactionPromptGate';
import { DestructionKit } from '../src/systems/kits/DestructionKit';
import { MenusKit } from '../src/systems/kits/MenusKit';
import { activateHotbarSlot, type HotbarHost } from '../src/systems/kits/hotbarActions';
import { MobRoster, type SceneWorld } from '../src/systems/kits/SceneWorld';
import { PlayerTickSystem } from '../src/systems/PlayerTickSystem';
import { SpellSystem } from '../src/systems/SpellSystem';
import { TreasureChestSystem } from '../src/systems/TreasureChestSystem';

/** A walled square room, big enough that a scatter from its middle never reaches a wall. */
const ROOM_TILES = 16;
const ROOM_CENTRE_TILE = 8;
/** A tile against the west wall, for the scatter-into-a-wall check. */
const WALL_HUGGING_TILE_X = 1;
/** Drops against the wall: enough that some are sure to be aimed into it. */
const WALL_SCATTER_COUNT = 40;
const BURGER_SCATTER = 3;
const STARTING_BURGERS = 5;
const STARTING_STEWS = 3;
const STARTING_POTIONS = 3;
/** How far into a fed status to eat again for the refresh check. */
const REFRESH_AFTER_TICKS = 600;
/** Long enough for the companion's own auto-heal pacing to allow one more heal. */
const AUTO_HEAL_WINDOW_FRAMES = 600;
/** HP a test crawler is dropped to, low enough that no heal here can overflow max. */
const HURT_HP_FRACTION = 0.2;
const HALF = 0.5;
const PERCENT = 100;
/** A seeded stream for the scatter, so a failure reproduces. */
const SCATTER_SEED = 1234567;
const LCG_MULTIPLIER = 1664525;
const LCG_INCREMENT = 1013904223;
const LCG_STATE_BITS = 32;
const LCG_MODULUS = 2 ** LCG_STATE_BITS;
const PROBE_MOB_HP = 10;
const PROBE_MOB_SPEED = 1;
const PROBE_MOB_XP = 1;
/** A hostile this close is well inside either crawler's attack range. */
const HOSTILE_OFFSET_TILES = 1;
/** Where the chest check puts its chest, beside the crawler. */
const CHEST_OFFSET_TILES = 1;
const CHEST_GUARD_BOUNDS = { x: 0, y: 0, w: 0, h: 0 };
/** An item that is neither food nor stackable, to fill a bag with. */
const FILLER_ITEM: ItemId = 'basic_axe';

let failures = 0;

function check(ok: boolean, label: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}`);
  if (!ok) failures++;
}

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * LCG_MULTIPLIER + LCG_INCREMENT) % LCG_MODULUS;
    return state / LCG_MODULUS;
  };
}

function makeRoom(): GameMap {
  const grid: TileContent[][] = Array.from({ length: ROOM_TILES }, (_, y) =>
    Array.from({ length: ROOM_TILES }, (_, x) => {
      const isBorder = x === 0 || y === 0 || x === ROOM_TILES - 1 || y === ROOM_TILES - 1;
      return {
        tileId: `${x}#${y}`,
        type: isBorder ? FloorTypeValue.wall : FloorTypeValue.tile_floor,
      };
    }),
  );
  return new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: grid });
}

interface Stage {
  readonly map: GameMap;
  readonly bus: EventBus;
  readonly pm: PlayerManager;
  readonly world: SceneWorld;
  readonly menus: MenusKit;
}

function makeStage(): Stage {
  const map = makeRoom();
  const bus = new EventBus();
  const pm = new PlayerManager(ROOM_CENTRE_TILE, ROOM_CENTRE_TILE, undefined);
  const roster = new MobRoster(map, new SpellSystem());
  const world: SceneWorld = { gameMap: map, bus, audio: null, pm, roster };
  const menus = new MenusKit({ world, abilityManager: new AbilityManager() });
  return { map, bus, pm, world, menus };
}

function hurt(player: Player): void {
  player.hp = Math.max(1, Math.floor(player.maxHp * HURT_HP_FRACTION));
}

function tick(player: Player, frames: number): void {
  for (let i = 0; i < frames; i++) player.tickTimers();
}

function fedTicksLeft(player: Player): number | null {
  return player.statusEffects.find((e) => e.type === HAMBURGER_FED_STATUS)?.ticksRemaining ?? null;
}

class ProbeMob extends Mob {
  readonly xpValue = PROBE_MOB_XP;
  constructor(
    tileX: number,
    tileY: number,
    private readonly hostile: boolean,
  ) {
    super(tileX, tileY, TILE_SIZE, PROBE_MOB_HP, PROBE_MOB_SPEED);
  }
  override get isHostile(): boolean {
    return this.hostile;
  }
  override updateAI(): void {
    // Driven by hand; never decides anything.
  }
  protected override drawSelf(): void {
    // Never rendered.
  }
}

// ── Hamburger ────────────────────────────────────────────────────────────────

console.log('Hamburger');
{
  const { pm, menus } = makeStage();
  const human = pm.human;
  human.inventory.addItem('hamburger', STARTING_BURGERS);
  const baseStrength = human.strength;

  hurt(human);
  const hpBefore = human.hp;
  const expectedHeal = Math.round(human.maxHp * HAMBURGER_HEAL_FRACTION);
  check(menus.eatFood(human, 'hamburger', null), 'a hurt crawler eats a burger');
  check(
    human.hp - hpBefore === expectedHeal,
    `it heals exactly ${HAMBURGER_HEAL_FRACTION * PERCENT}% (${human.hp - hpBefore} of ${expectedHeal})`,
  );
  check(human.inventory.countOf('hamburger') === STARTING_BURGERS - 1, 'and one burger is spent');
  check(
    human.strength === baseStrength + HAMBURGER_STR_BONUS,
    `STR is +${HAMBURGER_STR_BONUS} while fed (${human.strength} vs base ${baseStrength})`,
  );

  tick(human, REFRESH_AFTER_TICKS);
  hurt(human);
  check(menus.eatFood(human, 'hamburger', null), 'a second burger while fed is eaten');
  check(
    fedTicksLeft(human) === HAMBURGER_FED_TICKS,
    `and refreshes the timer to the full ${HAMBURGER_FED_TICKS} ticks (${fedTicksLeft(human)})`,
  );
  check(
    human.strength === baseStrength + HAMBURGER_STR_BONUS,
    `and STR stays at +${HAMBURGER_STR_BONUS}, never stacking (${human.strength - baseStrength})`,
  );

  tick(human, HAMBURGER_FED_TICKS - 1);
  check(fedTicksLeft(human) !== null, 'still fed one tick before the boon ends');
  tick(human, 2);
  check(fedTicksLeft(human) === null, 'the boon expires');
  check(human.strength === baseStrength, `and STR is back to base (${human.strength})`);

  human.hp = human.maxHp;
  check(menus.eatFood(human, 'hamburger', null), 'at full HP but not fed, a burger is still eaten');
  const countWhenFull = human.inventory.countOf('hamburger');
  check(!menus.eatFood(human, 'hamburger', null), 'at full HP and fed, it is refused');
  check(human.inventory.countOf('hamburger') === countWhenFull, 'and the refusal spends nothing');
  hurt(human);
  check(menus.eatFood(human, 'hamburger', null), 'hurt and fed, it is eaten again');
  check(human.potionCooldownFrames === 0, 'and a burger never starts the potion cooldown');
}

// ── Hollow Stew ──────────────────────────────────────────────────────────────

console.log('\nHollow Stew');
{
  const { pm, menus, bus } = makeStage();
  const human = pm.human;
  human.inventory.addItem('health_potion', STARTING_POTIONS);
  human.inventory.addItem('hollow_stew', STARTING_STEWS);
  let stewRefusals = 0;
  let potionEvents = 0;
  bus.on('stewRefusedOnCooldown', () => stewRefusals++);
  bus.on('healingPotionUsed', () => potionEvents++);

  hurt(human);
  const hurtHp = human.hp;
  check(menus.drinkPotion(human, 'health_potion', null), 'a hurt crawler drinks a potion');
  const potionHeal = human.hp - hurtHp;
  const potionCooldown = human.potionCooldownFrames;

  check(!menus.eatFood(human, 'hollow_stew', null), 'stew straight after a potion is refused');
  check(stewRefusals === 1, 'and the refusal raises stewRefusedOnCooldown');
  check(human.inventory.countOf('hollow_stew') === STARTING_STEWS, 'and spends no stew');

  human.potionCooldownFrames = 0;
  human.hp = hurtHp;
  check(menus.eatFood(human, 'hollow_stew', null), 'off cooldown, the stew is eaten');
  check(
    human.hp - hurtHp === potionHeal,
    `it heals exactly what a potion heals (${human.hp - hurtHp} vs ${potionHeal})`,
  );
  check(
    potionHeal === Math.round(human.maxHp * POTION_HEAL_FRACTION),
    'which is the potion fraction of max HP',
  );
  check(
    human.potionCooldownFrames === potionCooldown && potionCooldown > 0,
    `the cooldown after stew equals the one after a potion (${human.potionCooldownFrames} vs ${potionCooldown})`,
  );
  check(potionEvents === 2, 'stew raises healingPotionUsed like a potion');

  hurt(human);
  const potionsBefore = human.inventory.countOf('health_potion');
  check(
    !menus.drinkPotion(human, 'health_potion', null),
    'a potion straight after stew is refused',
  );
  check(human.inventory.countOf('health_potion') === potionsBefore, 'and spends no potion');

  human.potionCooldownFrames = 0;
  human.hp = human.maxHp;
  check(!menus.eatFood(human, 'hollow_stew', null), 'stew at full HP is refused, as a potion is');
}

console.log('\nCompanion auto-heal');
{
  const { pm } = makeStage();
  const { human, cat } = pm;
  const ticker = new PlayerTickSystem();
  // Crawlers can start with potions in their packs; this check is about one without.
  cat.inventory.removeItems('health_potion', cat.inventory.countOf('health_potion'));
  check(cat.inventory.countOf('health_potion') === 0, 'the companion carries no potions');
  cat.inventory.addItem('hollow_stew', 1);
  hurt(cat);
  const catHpBefore = cat.hp;
  ticker.tickAutoPotion(human, cat);
  check(cat.hp > catHpBefore, 'a companion with no potions auto-heals on stew');
  check(cat.inventory.countOf('hollow_stew') === 0, 'and the stew is spent');

  cat.potionCooldownFrames = 0;
  cat.inventory.addItem('hollow_stew', 1);
  cat.inventory.addItem('health_potion', 1);
  hurt(cat);
  for (let i = 0; i < AUTO_HEAL_WINDOW_FRAMES; i++) ticker.tickAutoPotion(human, cat);
  check(
    cat.inventory.countOf('health_potion') === 0 && cat.inventory.countOf('hollow_stew') === 1,
    'with both, the potion goes first',
  );
}

console.log('\nEvery route to a meal');
{
  const { pm, menus, world } = makeStage();
  const human = pm.human;
  human.inventory.addItem('hamburger', STARTING_BURGERS);
  const burger = human.inventory.bag.slots.findIndex((slot) => slot?.id === 'hamburger');
  const onHotbar = human.inventory.actionBar.slots.findIndex((slot) => slot?.id === 'hamburger');
  const interaction = menus.inventoryPanel.interaction;
  const hotbarBurger = onHotbar >= 0 ? human.inventory.actionBar.slots[onHotbar] : null;
  const bagBurger = burger >= 0 ? human.inventory.bag.slots[burger] : null;
  const anyBurger = hotbarBurger ?? bagBurger;
  check(anyBurger !== null, 'the burgers landed in the pack');
  if (anyBurger !== null) {
    const options = interaction.contextMenuOptions(anyBurger, 'inv');
    check(
      options[0] === 'Eat',
      `the context menu (right-click or long-press) leads with Eat (${options.join(', ')})`,
    );
  }
  const stewOptions = interaction.contextMenuOptions(
    { ...ITEM_DEF.hollow_stew, quantity: 1 },
    'inv',
  );
  check(stewOptions[0] === 'Eat', 'and so does stew');

  hurt(human);
  const source = onHotbar >= 0 ? 'hotbar' : 'inv';
  const slotIdx = onHotbar >= 0 ? onHotbar : burger;
  interaction.pendingEatSlot = { source, slotIdx, id: 'hamburger' };
  menus.resolvePendingInventoryActions(human);
  check(
    human.inventory.countOf('hamburger') === STARTING_BURGERS - 1,
    'the menu Eat entry eats one',
  );
  // Read through a call: a direct read here is narrowed by the assignment above.
  const pendingEatCleared = (): boolean => interaction.pendingEatSlot === null;
  check(pendingEatCleared(), 'and the pending entry is cleared');

  human.statusEffects.length = 0;
  const hotbarIdx = human.inventory.actionBar.slots.findIndex((slot) => slot === null);
  const placed = hotbarIdx >= 0 && human.inventory.placeOnHotbar('hamburger', hotbarIdx);
  const barIdx = human.inventory.actionBar.slots.findIndex((slot) => slot?.id === 'hamburger');
  check(placed || barIdx >= 0, 'a burger sits on the hotbar');
  const host: HotbarHost = {
    world,
    menus,
    abilityManager: new AbilityManager(),
    spells: world.roster.spells,
    dynamite: null,
  };
  hurt(human);
  const beforeKey = human.inventory.countOf('hamburger');
  activateHotbarSlot(host, barIdx);
  check(human.inventory.countOf('hamburger') === beforeKey - 1, 'the hotbar key eats one');
}

// ── Ground pickups ───────────────────────────────────────────────────────────

function isOnWalkableTile(map: GameMap, x: number, y: number): boolean {
  return map.isWalkable(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE));
}

function settle(system: GroundPickupSystem): void {
  for (let i = 0; i < GROUND_PICKUP_SETTLE_FRAMES; i++) system.update();
}

console.log('\nGround pickups');
{
  const { map, pm } = makeStage();
  const human = pm.human;
  const centreX = human.x + TILE_SIZE * HALF;
  const centreY = human.y + TILE_SIZE * HALF;

  const system = new GroundPickupSystem(map, seededRandom(SCATTER_SEED));
  system.spawnBurgers(centreX, centreY, BURGER_SCATTER);
  settle(system);
  check(
    system.all.length === BURGER_SCATTER,
    `a scatter of ${BURGER_SCATTER} gives ${system.all.length}`,
  );
  check(
    system.all.every((p) => p.settleFrames === 0 && p.hop === 0),
    'every one has settled on the ground',
  );
  check(
    system.all.every((p) => isOnWalkableTile(map, p.x, p.y)),
    'every one lies on a walkable tile',
  );

  const againstWall = new GroundPickupSystem(map, seededRandom(SCATTER_SEED));
  againstWall.spawnBurgers((WALL_HUGGING_TILE_X + HALF) * TILE_SIZE, centreY, WALL_SCATTER_COUNT);
  settle(againstWall);
  check(
    againstWall.all.every((p) => isOnWalkableTile(map, p.x, p.y)),
    `dropped against a wall, all ${WALL_SCATTER_COUNT} still land on open ground`,
  );

  const snapshot = system.captureCheckpoint();
  check(
    system.nearestInReach(human) !== null,
    'the crawler standing on the drop is in prompt reach',
  );
  check(system.tryPickupNear(human), 'one press is claimed');
  check(system.all.length === 0, 'and gathers every burger');
  check(
    human.inventory.countOf('hamburger') === BURGER_SCATTER,
    `all ${BURGER_SCATTER} are in the bag`,
  );
  check(system.drainPickupCues().pickedUp, 'and the pickup cue is raised');

  system.restoreCheckpoint(snapshot);
  check(system.all.length === BURGER_SCATTER, 'a checkpoint restore puts them back');
  check(
    system.all.every((p, i) => p.x === snapshot.pickups[i].x && p.y === snapshot.pickups[i].y),
    'where they lay',
  );

  // Moved out of prompt reach: nothing is claimed, so the press can fall through.
  const farAway = system.all.map((p) => ({ x: p.x, y: p.y }));
  human.x = TILE_SIZE;
  human.y = TILE_SIZE;
  check(!system.tryPickupNear(human), 'out of prompt reach, the press is not claimed');
  human.x = farAway[0].x - TILE_SIZE * HALF;
  human.y = farAway[0].y - TILE_SIZE * HALF;

  // A full bag.
  const crammed = pm.cat;
  crammed.x = human.x;
  crammed.y = human.y;
  while (crammed.inventory.bag.slots.includes(null)) crammed.inventory.addItem(FILLER_ITEM, 1);
  check(!crammed.inventory.hasRoomFor('hamburger'), 'the companion bag is full of axes');
  crammed.pendingSystemNotices.length = 0;
  check(system.tryPickupNear(crammed), 'a press with a full bag is still claimed');
  check(system.all.length === BURGER_SCATTER, 'and leaves every burger on the ground');
  check(crammed.inventory.countOf('hamburger') === 0, 'and puts none in the bag');
  check(crammed.pendingSystemNotices.includes('Your bag is full.'), 'and says the bag is full');
  check(system.drainPickupCues().refused, 'and raises the refusal cue');

  for (let i = 0; i < GROUND_PICKUP_TTL_FRAMES - GROUND_PICKUP_SETTLE_FRAMES - 1; i++)
    system.update();
  check(system.all.length === BURGER_SCATTER, 'still there one frame before their lifetime ends');
  system.update();
  check(system.all.length === 0, 'the lifetime removes them');
}

console.log('\nGround pickups through DestructionKit');
{
  const { world, pm } = makeStage();
  const kit = new DestructionKit(world, 1);
  kit.groundPickups.spawnBurgers(pm.human.x + TILE_SIZE * HALF, pm.human.y, BURGER_SCATTER);
  const snapshot = kit.captureCheckpoint();
  kit.groundPickups.tryPickupNear(pm.human);
  check(kit.groundPickups.all.length === 0, 'collected through the kit');
  kit.restoreCheckpoint(snapshot);
  check(
    kit.groundPickups.all.length === BURGER_SCATTER,
    'and the kit checkpoint round trip keeps them',
  );
}

// ── Prompt gating ────────────────────────────────────────────────────────────

console.log('\nPrompt gating');
{
  const { world, pm } = makeStage();
  const human = pm.human;
  const humanTileX = Math.floor(human.x / TILE_SIZE);
  const humanTileY = Math.floor(human.y / TILE_SIZE);
  check(shouldShowInteractionPrompts(human, world.roster.grid), 'with nobody about, prompts show');

  const ally = new ProbeMob(humanTileX + HOSTILE_OFFSET_TILES, humanTileY, false);
  world.roster.add(ally);
  check(
    shouldShowInteractionPrompts(human, world.roster.grid),
    'an ally in reach does not withhold them',
  );

  const hostile = new ProbeMob(humanTileX, humanTileY + HOSTILE_OFFSET_TILES, true);
  world.roster.add(hostile);
  check(
    !shouldShowInteractionPrompts(human, world.roster.grid),
    'a hostile in attack range withholds the prompt, and the press goes to the swing',
  );
}

console.log('\nA chest ahead of the pickups in the Space chain');
{
  const { pm } = makeStage();
  const human = pm.human;
  const chests = new TreasureChestSystem();
  const chestTileX = Math.floor(human.x / TILE_SIZE) + CHEST_OFFSET_TILES;
  const chestTileY = Math.floor(human.y / TILE_SIZE);
  chests.addWoodenChest(chestTileX, chestTileY, CHEST_GUARD_BOUNDS, { coins: 0, items: [] }, false);
  // `wouldInteract` is what the pickup prompt asks to stand aside for a chest;
  // it must agree with what the chain's `tryInteract` then does with the press.
  const predicted = chests.wouldInteract(human);
  check(predicted, 'a chest beside the crawler would take the press ahead of a pickup');
  check(chests.tryInteract(human) === predicted, 'and the chest does take it');
  human.x = TILE_SIZE;
  human.y = TILE_SIZE;
  check(
    !chests.wouldInteract(human) && !chests.tryInteract(human),
    'out of reach, neither the prediction nor the chest claims it',
  );
}

if (failures > 0) {
  console.log(`\n${failures} food check(s) failed`);
  process.exit(1);
}
console.log('\nverify:food — all checks pass');
