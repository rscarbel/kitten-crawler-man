/**
 * A headless Briar Hollow for the questline and siege gates: a real floor-3
 * map with the village on it, the whole village kit built exactly as the
 * scene builds it, and one `step()` that runs a gameplay update in the order
 * `DungeonScene` does — the kit, the siege, the mob loop, the necromancer's
 * raises and bolts, then kill resolution.
 *
 * The map is built once per seed and shared: every structure on it is
 * re-derived from the state a new kit is handed, so a fresh state is a fresh
 * village.
 */

import { TILE_SIZE } from '../src/core/constants';
import { EventBus } from '../src/core/EventBus';
import { createBriarHollowState, type BriarHollowState } from '../src/core/briarHollowState';
import { createPartyCraftsState, type PartyCraftsState } from '../src/core/partyCrafts';
import { PartyTools } from '../src/core/PartyTools';
import { PlayerManager } from '../src/core/PlayerManager';
import { AbilityManager } from '../src/core/AbilityManager';
import { keybindings } from '../src/core/Keybindings';
import type { GrantedReward } from '../src/core/GrantedReward';
import type { ItemId } from '../src/core/ItemDefs';
import type { SiegeMusicClaim } from '../src/systems/briarHollow/VillageAssaultSystem';
import type { HumanPlayer } from '../src/creatures/HumanPlayer';
import type { CatPlayer } from '../src/creatures/CatPlayer';
import type { Player } from '../src/Player';
import { GameMap } from '../src/map/GameMap';
import type { BriarHollowSite } from '../src/map/overworld/briarHollowSite';
import { SpellSystem } from '../src/systems/SpellSystem';
import { MobRoster, type SceneWorld } from '../src/systems/kits/SceneWorld';
import { MenusKit } from '../src/systems/kits/MenusKit';
import { CombatKit } from '../src/systems/kits/CombatKit';
import type { SystemContext } from '../src/systems/GameSystem';
import { SkeletonSummonSystem } from '../src/systems/SkeletonSummonSystem';
import { SkeletonProjectileSystem } from '../src/systems/SkeletonProjectileSystem';
import { GroundPickupSystem } from '../src/systems/GroundPickupSystem';
import { DynamiteSystem } from '../src/systems/DynamiteSystem';
import { BriarHollowKit } from '../src/systems/briarHollow/BriarHollowKit';

export const SIEGE_MAP_SIZE = 280;
export const UPDATES_PER_SECOND = 60;

const maps = new Map<number, GameMap>();

/** The floor-3 map for `seed`, generated once and shared by every rig built on it. */
export function villageMap(seed: number): { map: GameMap; site: BriarHollowSite } {
  let map = maps.get(seed);
  if (map === undefined) {
    map = new GameMap({
      mapSize: SIEGE_MAP_SIZE,
      tileHeight: TILE_SIZE,
      mapType: 'overworld',
      worldSeed: seed,
    });
    maps.set(seed, map);
  }
  const site = map.briarHollow;
  if (site === null) throw new Error(`seed ${seed} has no Briar Hollow`);
  return { map, site };
}

export interface SiegeRig {
  readonly map: GameMap;
  readonly site: BriarHollowSite;
  readonly state: BriarHollowState;
  readonly crafts: PartyCraftsState;
  readonly pm: PlayerManager;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly bus: EventBus;
  readonly world: SceneWorld;
  readonly menus: MenusKit;
  readonly kit: BriarHollowKit;
  readonly combat: CombatKit;
  /** The skeletons' arrows and the necromancer's bolts in flight. */
  readonly projectiles: SkeletonProjectileSystem;
  /** Names of every "New Item!" card the rig was asked to show. */
  readonly rewardCards: string[];
  /** Every announce, in order. */
  readonly announced: string[];
  /** Items dropped on the floor as a loot pile. */
  readonly droppedItems: Array<{ id: ItemId; quantity: number }>;
  /** How many times each craft explainer was opened. */
  readonly explainerOpens: Map<string, number>;
  /** How many boss intros played. */
  bossIntros: number;
  context(): SystemContext;
  /** One gameplay update, in the scene's order. */
  step(): void;
  dispose(): void;
}

export interface SiegeRigOptions {
  readonly seed: number;
  readonly state?: BriarHollowState;
  readonly crafts?: PartyCraftsState;
  /** The level the siege's undead and the militia come at: a number, or a roll per spawn. */
  readonly assaultLevel: number | (() => number);
  /** The zone music the siege takes the track over from; none by default. */
  readonly music?: () => SiegeMusicClaim | null;
}

export function buildSiegeRig(options: SiegeRigOptions): SiegeRig {
  const { map, site } = villageMap(options.seed);
  const state = options.state ?? createBriarHollowState();
  const crafts = options.crafts ?? createPartyCraftsState();
  const bus = new EventBus();
  const pm = new PlayerManager(site.gate.inside.x, site.gate.inside.y, undefined);
  const roster = new MobRoster(map, new SpellSystem());
  const world: SceneWorld = { gameMap: map, bus, audio: null, pm, roster };
  const menus = new MenusKit({ world, abilityManager: new AbilityManager() });
  const combat = new CombatKit({ world, abilityManager: new AbilityManager(), safeRoom: null });
  const rewardCards: string[] = [];
  const announced: string[] = [];
  const droppedItems: Array<{ id: ItemId; quantity: number }> = [];
  const explainerOpens = new Map<string, number>();
  // Reward cards halt the world in the scene and wait on a click; here they
  // are recorded and read at once, so whatever waits on them runs.
  menus.rewardGrantedDialog.enqueue = (reward: GrantedReward) => {
    rewardCards.push(reward.name);
  };
  menus.rewardGrantedDialog.afterQueueDrains = (run: () => void) => run();
  menus.announce = (message: string) => {
    announced.push(message);
  };
  const openExplainer = menus.craftExplainers.open.bind(menus.craftExplainers);
  menus.craftExplainers.open = (id) => {
    explainerOpens.set(id, (explainerOpens.get(id) ?? 0) + 1);
    const opened = openExplainer(id);
    menus.craftExplainers.close();
    return opened;
  };
  const rigRef: { rig: SiegeRig | null } = { rig: null };
  const kit = new BriarHollowKit(world, {
    human: pm.human,
    cat: pm.cat,
    partyTools: new PartyTools(crafts.tools),
    partyCrafts: crafts,
    state,
    menus,
    audio: null,
    keybindings,
    groundPickups: new GroundPickupSystem(map),
    dynamite: new DynamiteSystem(map),
    noteResourceActivity: () => undefined,
    onTileChanged: () => undefined,
    worldHalted: () => false,
    assaultLevel: () => {
      const level = options.assaultLevel;
      return typeof level === 'number' ? level : level();
    },
    music: options.music,
    bossIntro: () => {
      if (rigRef.rig !== null) rigRef.rig.bossIntros++;
    },
    dropItems: (_x, _y, items) => {
      for (const item of items) droppedItems.push({ ...item });
    },
  });
  const summons = new SkeletonSummonSystem(map, (mob) => roster.add(mob));
  const projectiles = new SkeletonProjectileSystem(map);
  const targets: Player[] = [];
  const context = (): SystemContext => {
    targets.length = 0;
    kit.pushAlliedDefenders(targets);
    return {
      human: pm.human,
      cat: pm.cat,
      active: pm.active(),
      inactive: pm.inactive(),
      activeIsMoving: false,
      roster,
      gameMap: map,
      extraTargets: targets.length > 0 ? targets : undefined,
    };
  };
  const rig: SiegeRig = {
    map,
    site,
    state,
    crafts,
    pm,
    human: pm.human,
    cat: pm.cat,
    bus,
    world,
    menus,
    kit,
    combat,
    projectiles,
    rewardCards,
    announced,
    droppedItems,
    explainerOpens,
    bossIntros: 0,
    context,
    step: () => {
      const ctx = context();
      kit.update(ctx);
      kit.updateSiege(ctx);
      combat.updateMobs(ctx);
      summons.update(ctx);
      projectiles.update(ctx);
      combat.resolveKills();
      combat.playerTick.update(ctx);
    },
    dispose: () => {
      kit.dispose();
      combat.dispose();
      bus.clear();
    },
  };
  rigRef.rig = rig;
  return rig;
}

/** Stands a crawler with its top-left on tile (`x`, `y`). */
export function standAt(player: Player, tileX: number, tileY: number): void {
  player.x = tileX * TILE_SIZE;
  player.y = tileY * TILE_SIZE;
}
