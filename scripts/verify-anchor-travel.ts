/**
 * Headless gate for the Wayfinder's Anchor's travel menu, on real floor-3 maps.
 *
 * Builds `RecallSystem` and `TravelMenu` wired the way `DungeonScene` wires
 * them — the menu opened by the system's press, a row handing its destination
 * back to `beginChannelTo` — with the scene's warp reproduced from the same
 * shared pieces (`findWarpLandingTile`, `findPartyArrivalTiles` and the travel
 * landing constants), and checks:
 *
 * - a fresh run offers Skyfowl Town alone; each questline's completion opens
 *   its own row;
 * - every enabled row ends with both crawlers on walkable ground inside that
 *   place;
 * - every press refusal still fires and opens no menu;
 * - closing the menu starts no channel and costs no cooldown;
 * - the row for where the party stands is disabled, and the stone used in the
 *   town square never moves the party anywhere;
 * - a press during a channel gives it up;
 * - a checkpoint keeps the unlocks and the cooldown;
 * - the anchor's bag and hotbar context menu (right-click or long-press) leads
 *   with Travel, and choosing it closes that menu and opens the travel menu,
 *   for whichever crawler's bag holds the stone;
 * - from the menu, every press refusal says exactly what the hotbar press
 *   says and opens no menu, and indoors it gives the open-sky refusal;
 * - no other item offers Travel.
 *
 * Run: npm run verify:anchor-travel
 */
import { level3 } from '../src/levels/level3';
import { GameMap } from '../src/map/GameMap';
import {
  findPartyArrivalTiles,
  findWarpLandingTile,
  hasRoomToMove,
} from '../src/map/findWalkableTile';
import { TILE_SIZE } from '../src/core/constants';
import type { HumanPlayer } from '../src/creatures/HumanPlayer';
import type { CatPlayer } from '../src/creatures/CatPlayer';
import { EventBus } from '../src/core/EventBus';
import { SpellSystem } from '../src/systems/SpellSystem';
import { MobRoster } from '../src/systems/kits/SceneWorld';
import type { SystemContext } from '../src/systems/GameSystem';
import { RecallSystem, RECALL_COOLDOWN_FRAMES } from '../src/systems/RecallSystem';
import {
  TRAVEL_DESTINATIONS,
  TRAVEL_LANDING_SEARCH_TILES,
  TRAVEL_LANDING_STANDOFF_TILES,
  YOU_ARE_HERE_REASON,
  travelDestination,
  type TravelDestinationId,
} from '../src/systems/travel/travelDestinations';
import { TravelMenu } from '../src/ui/TravelMenu';
import {
  CIRCUS_QUEST_NAME,
  captureCircusQuestProgress,
  createCircusQuestProgress,
  restoreCircusQuestProgress,
} from '../src/core/CircusQuestProgress';
import {
  captureBriarHollowState,
  createBriarHollowState,
  restoreBriarHollowState,
} from '../src/core/briarHollowState';
import { createAnchorQuestProgress } from '../src/core/AnchorQuestProgress';
import { BRIAR_HOLLOW_QUEST_NAME } from '../src/core/villageQuestPhase';
import type { LevelDef } from '../src/levels/types';
import { AbilityManager } from '../src/core/AbilityManager';
import { ITEM_DEF, type InventoryItem, type ItemId } from '../src/core/ItemDefs';
import { PlayerManager } from '../src/core/PlayerManager';
import { setViewportSize } from '../src/core/Viewport';
import { MenusKit } from '../src/systems/kits/MenusKit';
import { ANCHOR_INDOORS_REFUSAL, refuseAnchorIndoors } from '../src/systems/kits/hotbarActions';
import type { SceneWorld } from '../src/systems/kits/SceneWorld';

/**
 * Seeds the gate runs on: each one a different town, circus and village
 * layout. Two of them put the circus arch on the east-west axis and one on
 * north-south, so both arch orientations are landed at.
 */
const SEED_NORTH_SOUTH_ARCH = 11;
const SEED_EAST_WEST_ARCH = 4242;
const SEED_EAST_WEST_ARCH_SECOND = 90001;
const WORLD_SEEDS: readonly number[] = [
  SEED_NORTH_SOUTH_ARCH,
  SEED_EAST_WEST_ARCH,
  SEED_EAST_WEST_ARCH_SECOND,
];
/** Comfortably longer than the channel, so a trip that should finish has. */
const CHANNEL_WAIT_FRAMES = 240;
/** How far from every destination's landing the "out in the wild" tile must be. */
const WILDERNESS_MIN_DISTANCE_TILES = 40;
const TILE_CENTRE_FRACTION = 0.5;
/** A desktop-sized screen, so the hotbar and the open bag are laid out the way a player sees them. */
const VIEWPORT_W = 1280;
const VIEWPORT_H = 800;
const TRAVEL_LABEL = 'Travel';
const ANCHOR_ID: ItemId = 'wayfinders_anchor';

let failures = 0;
function check(ok: boolean, message: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${message}`);
  if (!ok) failures++;
}

interface Rig {
  readonly map: GameMap;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly recall: RecallSystem;
  readonly menu: TravelMenu;
  /** The bag, its context menu, and the toast stack, with the dungeon's item use wired in. */
  readonly menus: MenusKit;
  readonly sceneWorld: SceneWorld;
  readonly toasts: string[];
  readonly circus: ReturnType<typeof createCircusQuestProgress>;
  readonly briarHollow: ReturnType<typeof createBriarHollowState>;
  readonly roster: MobRoster;
  /** Flip to stage the refusals the scene answers through its callbacks. */
  readonly world: { bossFight: boolean; enemyNear: boolean };
}

function placeAt(player: HumanPlayer | CatPlayer, tile: { x: number; y: number }): void {
  player.x = tile.x * TILE_SIZE;
  player.y = tile.y * TILE_SIZE;
}

function centreOf(player: HumanPlayer | CatPlayer): { x: number; y: number } {
  return {
    x: player.x + TILE_SIZE * TILE_CENTRE_FRACTION,
    y: player.y + TILE_SIZE * TILE_CENTRE_FRACTION,
  };
}

function tileOf(player: HumanPlayer | CatPlayer): { x: number; y: number } {
  const centre = centreOf(player);
  return { x: Math.floor(centre.x / TILE_SIZE), y: Math.floor(centre.y / TILE_SIZE) };
}

function buildRig(map: GameMap, levelDef: LevelDef = level3): Rig {
  const start = map.startTile;
  const pm = new PlayerManager(start.x, start.y, undefined);
  const { human, cat } = pm;
  const bus = new EventBus();
  const roster = new MobRoster(map, new SpellSystem());
  const sceneWorld: SceneWorld = { gameMap: map, bus, audio: null, pm, roster };
  const menus = new MenusKit({ world: sceneWorld, abilityManager: new AbilityManager() });
  const toasts: string[] = [];
  // Every toast the stone raises goes through the toast stack, as in the scene.
  menus.toasts.post = (message) => toasts.push(message);
  const circus = createCircusQuestProgress();
  const briarHollow = createBriarHollowState();
  const travelState = { circus, briarHollow, anchor: createAnchorQuestProgress() };
  const world = { bossFight: false, enemyNear: false };
  // The scene's `warpPartyForRecall`, minus the companions it dismisses.
  const teleportParty = (tile: { x: number; y: number }): boolean => {
    const landing = findWarpLandingTile(
      map,
      tile.x,
      tile.y,
      TRAVEL_LANDING_STANDOFF_TILES,
      TRAVEL_LANDING_SEARCH_TILES,
    );
    if (landing === null) return false;
    const { leader, follower } = findPartyArrivalTiles(map, landing);
    placeAt(human, leader);
    placeAt(cat, follower);
    return true;
  };
  const rig: { menu: TravelMenu | null; recall: RecallSystem | null } = {
    menu: null,
    recall: null,
  };
  const recall = new RecallSystem(
    map,
    levelDef,
    bus,
    () => world.bossFight,
    () => world.enemyNear,
    teleportParty,
    (message) => menus.toasts.post(message),
    null,
    travelState,
    (caster) => rig.menu?.open(caster),
  );
  const menu = new TravelMenu(map, travelState, (caster, destination) =>
    recall.beginChannelTo(caster, destination),
  );
  rig.menu = menu;
  rig.recall = recall;
  // The dungeon's wiring: the menu's use is the hotbar press, made by the active crawler.
  menus.useSceneItem = (item) => {
    if (item.id === ANCHOR_ID) recall.requestTravel(pm.active());
  };
  return {
    map,
    human,
    cat,
    recall,
    menu,
    menus,
    sceneWorld,
    toasts,
    circus,
    briarHollow,
    roster,
    world,
  };
}

function step(rig: Rig, frames: number): void {
  const ctx: SystemContext = {
    human: rig.human,
    cat: rig.cat,
    active: rig.human,
    inactive: rig.cat,
    activeIsMoving: false,
    roster: rig.roster,
    gameMap: rig.map,
  };
  for (let f = 0; f < frames; f++) rig.recall.update(ctx);
}

/** A roomy tile far from every destination, standing for "out in the Over City". */
function wildernessTile(map: GameMap): { x: number; y: number } | null {
  const landings = TRAVEL_DESTINATIONS.flatMap((destination) => {
    const tile = destination.landingTile(map);
    return tile === null ? [] : [tile];
  });
  const size = map.structure.length;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const farFromAll = landings.every(
        (tile) => Math.hypot(tile.x - x, tile.y - y) >= WILDERNESS_MIN_DISTANCE_TILES,
      );
      const outsideAll = TRAVEL_DESTINATIONS.every(
        (destination) =>
          !destination.contains(
            map,
            (x + TILE_CENTRE_FRACTION) * TILE_SIZE,
            (y + TILE_CENTRE_FRACTION) * TILE_SIZE,
          ),
      );
      if (farFromAll && outsideAll && hasRoomToMove(map, x, y)) return { x, y };
    }
  }
  return null;
}

function rowReason(rig: Rig, id: TravelDestinationId): string | undefined | null {
  const row = rig.menu.options.find((option) => option.key === id);
  return row === undefined ? null : row.unavailable;
}

function enabledRows(rig: Rig): string[] {
  return rig.menu.options
    .filter((option) => option.unavailable === undefined)
    .map((option) => option.key);
}

function standInWild(rig: Rig, wild: { x: number; y: number }): void {
  placeAt(rig.human, wild);
  placeAt(rig.cat, { x: wild.x + 1, y: wild.y });
}

function makeReady(rig: Rig): void {
  rig.recall.restoreCheckpoint({ cooldownFrames: 0 });
  rig.menu.close();
}

function checkFreshState(rig: Rig, wild: { x: number; y: number }): void {
  standInWild(rig, wild);
  rig.recall.requestTravel(rig.human);
  check(rig.menu.isOpen, 'a press out in the wild opens the travel menu');
  check(
    rig.menu.options.map((option) => option.key).join(',') ===
      TRAVEL_DESTINATIONS.map((destination) => destination.id).join(','),
    'the menu lists every destination, in table order',
  );
  check(
    enabledRows(rig).join(',') === 'town',
    `a fresh run offers Skyfowl Town alone (enabled: ${enabledRows(rig).join(',')})`,
  );
  check(
    rowReason(rig, 'circus') === `Complete "${CIRCUS_QUEST_NAME}"`,
    `the circus row names its questline (${String(rowReason(rig, 'circus'))})`,
  );
  check(
    rowReason(rig, 'briar_hollow') === `Complete "${BRIAR_HOLLOW_QUEST_NAME}"`,
    `the Briar Hollow row names its questline (${String(rowReason(rig, 'briar_hollow'))})`,
  );
  rig.menu.close();
}

function checkCancel(rig: Rig, wild: { x: number; y: number }): void {
  makeReady(rig);
  standInWild(rig, wild);
  rig.recall.requestTravel(rig.human);
  rig.menu.close();
  step(rig, CHANNEL_WAIT_FRAMES);
  check(
    !rig.recall.isChannelling && rig.recall.cooldownRemainingFrames === 0,
    'closing the menu starts no channel and costs no cooldown',
  );
  check(
    tileOf(rig.human).x === wild.x && tileOf(rig.human).y === wild.y,
    'and the party has not moved',
  );
}

function checkRefusals(rig: Rig, wild: { x: number; y: number }): void {
  const refusals: ReadonlyArray<{ name: string; stage: () => void; unstage: () => void }> = [
    {
      name: 'a boss fight',
      stage: () => (rig.world.bossFight = true),
      unstage: () => (rig.world.bossFight = false),
    },
    {
      name: 'a hostile nearby',
      stage: () => (rig.world.enemyNear = true),
      unstage: () => (rig.world.enemyNear = false),
    },
    {
      name: 'the cooldown',
      stage: () => rig.recall.restoreCheckpoint({ cooldownFrames: RECALL_COOLDOWN_FRAMES }),
      unstage: () => rig.recall.restoreCheckpoint({ cooldownFrames: 0 }),
    },
  ];
  for (const refusal of refusals) {
    makeReady(rig);
    standInWild(rig, wild);
    refusal.stage();
    const toastsBefore = rig.toasts.length;
    rig.recall.requestTravel(rig.human);
    const toasted = rig.toasts.length > toastsBefore;
    check(
      !rig.menu.isOpen && !rig.recall.isChannelling,
      `${refusal.name} refuses the press and opens no menu`,
    );
    // The cooldown is announced by the hotbar slot's own overlay, not a toast.
    if (refusal.name !== 'the cooldown') check(toasted, `${refusal.name} says why`);
    refusal.unstage();
  }

  const underground = buildRig(rig.map, { ...level3, isOverworld: false });
  standInWild(underground, wild);
  underground.recall.requestTravel(underground.human);
  check(
    !underground.menu.isOpen && underground.toasts.length > 0,
    'underground the stone refuses the press and opens no menu',
  );
}

function travelTo(rig: Rig, wild: { x: number; y: number }, id: TravelDestinationId): void {
  makeReady(rig);
  standInWild(rig, wild);
  rig.recall.requestTravel(rig.human);
  const pressed = rig.menu.pressTravel(id, rig.human, rig.cat);
  check(
    pressed && rig.recall.isChannelling && !rig.menu.isOpen,
    `choosing ${id} closes the menu and starts the channel`,
  );
  step(rig, CHANNEL_WAIT_FRAMES);
  const destination = travelDestination(id);
  const landed = [rig.human, rig.cat].every((crawler) => {
    const tile = tileOf(crawler);
    const centre = centreOf(crawler);
    return rig.map.isWalkable(tile.x, tile.y) && destination.contains(rig.map, centre.x, centre.y);
  });
  check(landed, `both crawlers stand on walkable ground inside ${destination.label}`);
  check(
    rig.recall.cooldownRemainingFrames > 0,
    `the trip to ${destination.label} starts the cooldown`,
  );

  makeReady(rig);
  rig.recall.requestTravel(rig.human);
  check(
    rowReason(rig, id) === YOU_ARE_HERE_REASON,
    `standing in ${destination.label}, its row reads "${YOU_ARE_HERE_REASON}"`,
  );
  rig.menu.close();
}

function checkUnlocksAndTravel(rig: Rig, wild: { x: number; y: number }): void {
  travelTo(rig, wild, 'town');

  rig.circus.stage = 'complete';
  makeReady(rig);
  standInWild(rig, wild);
  rig.recall.requestTravel(rig.human);
  check(
    enabledRows(rig).join(',') === 'town,circus',
    `completing the circus questline opens its row (enabled: ${enabledRows(rig).join(',')})`,
  );
  travelTo(rig, wild, 'circus');

  rig.briarHollow.quest.phase = 'complete';
  makeReady(rig);
  standInWild(rig, wild);
  rig.recall.requestTravel(rig.human);
  check(
    enabledRows(rig).join(',') === 'town,circus,briar_hollow',
    `completing Briar Hollow's questline opens its row (enabled: ${enabledRows(rig).join(',')})`,
  );
  travelTo(rig, wild, 'briar_hollow');

  // The questline ends at `complete` today, so a bound village never sees a
  // siege; the rule is asked directly so it still holds if one is ever added.
  const siegeReason = travelDestination('briar_hollow').closedReason({
    circus: rig.circus,
    briarHollow: { quest: { phase: 'assault' } },
    anchor: createAnchorQuestProgress(),
  });
  check(
    siegeReason === 'The village is under siege',
    `a village under siege closes its row (${String(siegeReason)})`,
  );
}

function checkTownSquare(rig: Rig): void {
  const square = rig.map.townSquareCentre;
  if (square === undefined) {
    check(false, 'the map has a town square');
    return;
  }
  makeReady(rig);
  const landing = findWarpLandingTile(
    rig.map,
    square.x,
    square.y,
    TRAVEL_LANDING_STANDOFF_TILES,
    TRAVEL_LANDING_SEARCH_TILES,
  );
  if (landing === null) {
    check(false, 'the town square has open ground');
    return;
  }
  placeAt(rig.human, landing);
  placeAt(rig.cat, landing);
  rig.recall.requestTravel(rig.human);
  check(rig.menu.isOpen, 'a press in the town square opens the menu');
  check(
    rowReason(rig, 'town') === YOU_ARE_HERE_REASON,
    `with Skyfowl Town disabled as "${YOU_ARE_HERE_REASON}"`,
  );
  rig.menu.pressTravel('town', rig.human, rig.cat);
  step(rig, CHANNEL_WAIT_FRAMES);
  const stayed = tileOf(rig.human).x === landing.x && tileOf(rig.human).y === landing.y;
  check(
    stayed && !rig.recall.isChannelling && rig.recall.cooldownRemainingFrames === 0,
    'pressing the disabled row warps nobody anywhere and costs nothing',
  );
  rig.menu.close();
}

function checkSecondPressCancels(rig: Rig, wild: { x: number; y: number }): void {
  makeReady(rig);
  standInWild(rig, wild);
  rig.recall.requestTravel(rig.human);
  rig.menu.pressTravel('town', rig.human, rig.cat);
  step(rig, 1);
  rig.recall.requestTravel(rig.human);
  check(
    !rig.recall.isChannelling && !rig.menu.isOpen,
    'a second press during the channel gives it up and opens no menu',
  );
  step(rig, CHANNEL_WAIT_FRAMES);
  check(
    tileOf(rig.human).x === wild.x &&
      tileOf(rig.human).y === wild.y &&
      rig.recall.cooldownRemainingFrames === 0,
    'and the given-up trip neither moves the party nor costs the cooldown',
  );
}

function checkCheckpoint(rig: Rig, wild: { x: number; y: number }): void {
  makeReady(rig);
  standInWild(rig, wild);
  rig.recall.requestTravel(rig.human);
  rig.menu.pressTravel('town', rig.human, rig.cat);
  step(rig, CHANNEL_WAIT_FRAMES);
  const cooldown = rig.recall.captureCheckpoint();
  const circus = captureCircusQuestProgress(rig.circus);
  const village = captureBriarHollowState(rig.briarHollow);

  const restored = buildRig(rig.map);
  restored.recall.restoreCheckpoint(cooldown);
  restoreCircusQuestProgress(restored.circus, circus);
  restoreBriarHollowState(restored.briarHollow, village);
  check(
    restored.recall.cooldownRemainingFrames === cooldown.cooldownFrames &&
      cooldown.cooldownFrames > 0,
    `a checkpoint restore keeps the cooldown (${restored.recall.cooldownRemainingFrames} frames)`,
  );
  restored.recall.restoreCheckpoint({ cooldownFrames: 0 });
  standInWild(restored, wild);
  restored.recall.requestTravel(restored.human);
  check(
    enabledRows(restored).join(',') === 'town,circus,briar_hollow',
    `and keeps the unlocks (enabled: ${enabledRows(restored).join(',')})`,
  );
}

type AnchorSlot = { readonly source: 'inv' | 'hotbar'; readonly slotIdx: number };

/** Puts a Wayfinder's Anchor in `slot` of `holder`'s pack, the way the quest hands one over. */
function giveAnchor(holder: HumanPlayer | CatPlayer, slot: AnchorSlot): void {
  const anchor: InventoryItem = { ...ITEM_DEF[ANCHOR_ID], quantity: 1 };
  const container = slot.source === 'hotbar' ? holder.inventory.actionBar : holder.inventory.bag;
  container.slots[slot.slotIdx] = anchor;
}

/** Where the screen's item menu is opened from, in UI units: anywhere on screen will do. */
const MENU_POINT = { x: 0, y: 0 } as const;

/**
 * Opens the inventory screen on `holder`'s pack and the item menu on `slot`,
 * as a right-click there does, and returns the menu's actions, or null when
 * none opened.
 */
function openSlotMenu(
  rig: Rig,
  holder: HumanPlayer | CatPlayer,
  slot: AnchorSlot,
): string[] | null {
  const screen = rig.menus.inventoryScreen;
  const kind = holder === rig.human ? 'human' : 'cat';
  if (!screen.isOpen) screen.open({ tab: 'bag', member: kind });
  else screen.switchMember(kind);
  const container = slot.source === 'hotbar' ? holder.inventory.actionBar : holder.inventory.bag;
  const item = container.slots[slot.slotIdx] ?? null;
  if (item === null) return null;
  screen.openItemMenu({ source: slot.source, slotIdx: slot.slotIdx, item }, MENU_POINT);
  const menu = screen.menu;
  if (menu?.kind !== 'item') return null;
  return screen.entriesFor(menu.target, holder.inventory).map((entry) => entry.action);
}

/**
 * Picks the open menu's `label` entry and resolves what it queued, the way
 * the scene does. False when the menu had no such entry.
 */
function chooseMenuOption(rig: Rig, holder: HumanPlayer | CatPlayer, label: string): boolean {
  const screen = rig.menus.inventoryScreen;
  const menu = screen.menu;
  if (menu?.kind !== 'item') return false;
  const offered = screen
    .entriesFor(menu.target, holder.inventory)
    .some((entry) => entry.action === label);
  if (!offered) return false;
  screen.choose(label, menu.target);
  rig.menus.resolvePendingInventoryActions(holder);
  return true;
}

/** Opens the menu on `slot` and picks Travel; false when either step could not happen. */
function travelFromMenu(rig: Rig, holder: HumanPlayer | CatPlayer, slot: AnchorSlot): boolean {
  const options = openSlotMenu(rig, holder, slot);
  if (options === null) return false;
  return chooseMenuOption(rig, holder, TRAVEL_LABEL);
}

const HOTBAR_ANCHOR: AnchorSlot = { source: 'hotbar', slotIdx: 1 };
const BAG_ANCHOR: AnchorSlot = { source: 'inv', slotIdx: 0 };

function checkContextMenuTravel(map: GameMap, wild: { x: number; y: number }): void {
  const rig = buildRig(map);
  standInWild(rig, wild);
  giveAnchor(rig.human, HOTBAR_ANCHOR);
  giveAnchor(rig.cat, BAG_ANCHOR);

  const hotbarOptions = openSlotMenu(rig, rig.human, HOTBAR_ANCHOR) ?? [];
  check(
    hotbarOptions[0] === TRAVEL_LABEL,
    `the anchor's hotbar context menu leads with Travel (${hotbarOptions.join(', ')})`,
  );
  check(
    hotbarOptions.includes('Move to Bag') &&
      hotbarOptions.includes('Description') &&
      !hotbarOptions.includes('Drop'),
    'and keeps its other entries, with no Drop for an undroppable stone',
  );
  chooseMenuOption(rig, rig.human, TRAVEL_LABEL);
  check(
    rig.menus.inventoryScreen.menu === null && rig.menu.isOpen,
    'choosing Travel closes the context menu and opens the travel menu',
  );
  makeReady(rig);

  check(rig.human.isActive, 'the human is the active crawler for the bag check');
  rig.menus.inventoryScreen.switchMember('cat');
  const bagOptions = openSlotMenu(rig, rig.cat, BAG_ANCHOR) ?? [];
  check(
    bagOptions[0] === TRAVEL_LABEL,
    `the anchor in the companion's bag offers Travel too (${bagOptions.join(', ')})`,
  );
  chooseMenuOption(rig, rig.cat, TRAVEL_LABEL);
  check(rig.menu.isOpen, 'and choosing it there opens the travel menu');
  // The stone moves the party, so the active crawler casts: a channel bound to
  // the companion would be given up on its first tick as a crawler switch.
  const chosen = rig.menu.pressTravel('town', rig.human, rig.cat);
  step(rig, 1);
  check(
    chosen && rig.recall.isChannelling,
    "a trip chosen from the companion's bag survives its first tick with the human active",
  );
  step(rig, CHANNEL_WAIT_FRAMES);
  const town = travelDestination('town');
  const arrived = [rig.human, rig.cat].every((crawler) => {
    const centre = centreOf(crawler);
    return town.contains(rig.map, centre.x, centre.y);
  });
  check(arrived, `and the party lands in ${town.label}`);
  standInWild(rig, wild);
  makeReady(rig);
  rig.menus.inventoryScreen.close();

  const refusals: ReadonlyArray<{ name: string; stage: () => void; unstage: () => void }> = [
    {
      name: 'a boss fight',
      stage: () => (rig.world.bossFight = true),
      unstage: () => (rig.world.bossFight = false),
    },
    {
      name: 'a hostile nearby',
      stage: () => (rig.world.enemyNear = true),
      unstage: () => (rig.world.enemyNear = false),
    },
    {
      name: 'the cooldown',
      stage: () => rig.recall.restoreCheckpoint({ cooldownFrames: RECALL_COOLDOWN_FRAMES }),
      unstage: () => rig.recall.restoreCheckpoint({ cooldownFrames: 0 }),
    },
  ];
  for (const refusal of refusals) {
    makeReady(rig);
    refusal.stage();
    const beforePress = rig.toasts.length;
    rig.recall.requestTravel(rig.human);
    const pressSaid = rig.toasts.slice(beforePress);
    const beforeMenu = rig.toasts.length;
    const chose = travelFromMenu(rig, rig.human, HOTBAR_ANCHOR);
    const menuSaid = rig.toasts.slice(beforeMenu);
    check(
      chose && !rig.menu.isOpen && !rig.recall.isChannelling,
      `from the context menu, ${refusal.name} refuses Travel and opens no menu`,
    );
    check(
      menuSaid.join('|') === pressSaid.join('|'),
      `and says what the hotbar press says (${menuSaid.join('|') || 'nothing'})`,
    );
    refusal.unstage();
  }

  const underground = buildRig(map, { ...level3, isOverworld: false });
  standInWild(underground, wild);
  giveAnchor(underground.human, HOTBAR_ANCHOR);
  underground.recall.requestTravel(underground.human);
  const pressSaid = underground.toasts.join('|');
  underground.toasts.length = 0;
  travelFromMenu(underground, underground.human, HOTBAR_ANCHOR);
  check(
    !underground.menu.isOpen && underground.toasts.join('|') === pressSaid && pressSaid !== '',
    `underground, Travel from the menu gives the hotbar's refusal (${pressSaid})`,
  );

  const indoors = buildRig(map);
  giveAnchor(indoors.human, HOTBAR_ANCHOR);
  // The interior's wiring: no travel system under a roof, only its refusal.
  indoors.menus.useSceneItem = (item) => {
    if (item.id === ANCHOR_ID)
      refuseAnchorIndoors({ world: indoors.sceneWorld, menus: indoors.menus });
  };
  travelFromMenu(indoors, indoors.human, HOTBAR_ANCHOR);
  check(
    !indoors.menu.isOpen && indoors.toasts.join('|') === ANCHOR_INDOORS_REFUSAL,
    `indoors, Travel gives the open-sky refusal (${indoors.toasts.join('|')})`,
  );

  const offenders = Object.values(ITEM_DEF).filter((def) => {
    if (def.id === ANCHOR_ID) return false;
    const item: InventoryItem = { ...def, quantity: 1 };
    return (['inv', 'hotbar'] as const).some((source) =>
      rig.menus.inventoryActions.contextMenuOptions(item, source).includes(TRAVEL_LABEL),
    );
  });
  check(
    offenders.length === 0,
    `no item but the anchor offers Travel (${offenders.map((def) => def.id).join(', ') || 'none'})`,
  );
}

setViewportSize(VIEWPORT_W, VIEWPORT_H);

for (const seed of WORLD_SEEDS) {
  console.log(`\nSeed ${seed}`);
  const map = new GameMap({
    mapSize: level3.mapSize,
    tileHeight: TILE_SIZE,
    mapType: 'overworld',
    worldSeed: seed,
  });
  const wild = wildernessTile(map);
  if (wild === null) {
    check(false, 'the map has open wilderness far from every destination');
    continue;
  }
  const rig = buildRig(map);
  checkFreshState(rig, wild);
  checkCancel(rig, wild);
  checkRefusals(rig, wild);
  checkTownSquare(rig);
  checkUnlocksAndTravel(rig, wild);
  checkSecondPressCancels(rig, wild);
  checkCheckpoint(rig, wild);
  checkContextMenuTravel(map, wild);
}

console.log(
  failures === 0 ? '\nAll anchor travel checks passed.' : `\n${failures} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
